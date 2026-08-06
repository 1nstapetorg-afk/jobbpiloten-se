// tests/unit/round88-ai-status.test.mjs
//
// Round-88 — locks /api/admin/ai-status (Priority-1 #1: Groq quota
// health check). Two layers:
//   1. BEHAVIOURAL — lib/groq.js#probeGroqHealth() against a stubbed
//      globalThis.fetch (same fresh-load dance as
//      groq-provider-behavior.test.mjs): mock mode, no key, success,
//      TPD-exhaustion 429, generic failure.
//   2. SOURCE LOCKS — the route's auth gate (401 / 403 allow-list),
//      response shape, and the never-leak-the-API-key contract.
//
// Network-safety: every behavioural case stubs fetch before import;
// no real LLM call ever fires (the Groq TPD quota is exhausted in
// this env — this test must not touch it).

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const ROUTE = fs.readFileSync(path.join(ROOT, 'app', 'api', 'admin', 'ai-status', 'route.js'), 'utf8')

const TPD_MESSAGE =
  '429 Rate limit reached for model `qwen/qwen3.6-27b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199997, Requested 1900. Please try again in 14m11s.'

// Strip every LLM key + mock flags so each fresh import starts from a
// known state, then invoke fn(probeGroqHealth) with fetch stubbed.
// IMPORTANT: env + fetch are restored ONLY after fn returns — the
// earlier helper restored them before the caller ran the probe, which
// made the probe execute against the REAL shell env (real GROQ_API_KEY
// + real network). The callback shape keeps the stub active for the
// whole probe call.
const LLM_ENV_KEYS = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'EMERGENT_LLM_KEY', 'EMERGENT_MODEL', 'OPENROUTER_API_KEY', 'SKIP_LLM_E2E', 'CI']

async function withProbe({ env = {}, fetchImpl }, fn) {
  const ORIG = Object.fromEntries(LLM_ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of LLM_ENV_KEYS) delete process.env[k]
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || v === null) delete process.env[k]
    else process.env[k] = String(v)
  }
  const origFetch = globalThis.fetch
  globalThis.fetch = fetchImpl
  try {
    const mod = await import(`../../lib/groq.js?t=${Date.now()}-${Math.random()}`)
    return await fn(mod.probeGroqHealth)
  } finally {
    globalThis.fetch = origFetch
    for (const [k, v] of Object.entries(ORIG)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

// OpenAI-SDK-compatible stubs — the SDK reads res.ok / res.status /
// res.headers.get('content-type') / res.json(), so the stubs carry a
// real Headers instance.
// The OpenAI SDK also calls res.text() while constructing errors, so
// every stub carries text() alongside json()/headers/ok/status.
function okResponse() {
  const body = JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1700000000,
    model: 'qwen/qwen3.6-27b',
    choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => JSON.parse(body),
    text: async () => body,
  }
}

function tpd429Response() {
  const body = JSON.stringify({ error: { message: TPD_MESSAGE } })
  return {
    ok: false,
    status: 429,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => JSON.parse(body),
    text: async () => body,
  }
}

// =============================================================================
// 1. probeGroqHealth — behavioural
// =============================================================================

test('Round-88: probe returns mockMode:true when SKIP_LLM_E2E is active (no fetch)', async () => {
  await withProbe(
    {
      env: { SKIP_LLM_E2E: 'true' },
      fetchImpl: () => Promise.reject(new Error('must not fetch in mock mode')),
    },
    async (probe) => {
      const r = await probe()
      assert.equal(r.mockMode, true, 'mock mode must be reported so an operator does not mistake it for a quota outage')
      assert.equal(r.status, 'ok')
      assert.equal(r.quotaExhausted, false)
      assert.equal(r.reachable, true)
      assert.equal(r.detail, 'mock-mode')
    },
  )
})

test('Round-88: probe reports not-configured when no LLM key is set', async () => {
  await withProbe(
    {
      env: {},
      fetchImpl: () => Promise.reject(new Error('must not fetch without a key')),
    },
    async (probe) => {
      const r = await probe()
      assert.equal(r.status, 'degraded')
      assert.equal(r.detail, 'not-configured')
      assert.equal(r.mockMode, false)
      assert.equal(r.quotaExhausted, false)
    },
  )
})

test('Round-88: probe returns ok on a healthy 200 response', async () => {
  await withProbe(
    { env: { GROQ_API_KEY: 'fake-key' }, fetchImpl: async () => okResponse() },
    async (probe) => {
      const r = await probe()
      assert.equal(r.status, 'ok')
      assert.equal(r.quotaExhausted, false)
      assert.equal(r.reachable, true)
      assert.equal(r.detail, 'ok')
    },
  )
})

test('Round-88: probe flags quotaExhausted on a TPD 429', async () => {
  await withProbe(
    { env: { GROQ_API_KEY: 'fake-key' }, fetchImpl: async () => tpd429Response() },
    async (probe) => {
      const r = await probe()
      assert.equal(r.status, 'degraded')
      assert.equal(r.quotaExhausted, true, 'TPD-exhaustion must be the operator signal')
      assert.equal(r.reachable, false)
      assert.equal(r.detail, 'quota-exhausted')
    },
  )
})

test('Round-88: probe degrades gracefully on a generic network failure', async () => {
  await withProbe(
    { env: { GROQ_API_KEY: 'fake-key' }, fetchImpl: () => Promise.reject(new Error('ECONNREFUSED connect ::1:443')) },
    async (probe) => {
      const r = await probe()
      assert.equal(r.status, 'degraded')
      assert.equal(r.quotaExhausted, false)
      assert.equal(r.detail, 'unreachable')
    },
  )
})

// =============================================================================
// 2. Route — auth gate, shape, no key leak
// =============================================================================

test('Round-88: route uses resolveClerkId (401) + ADMIN_USER_IDS allow-list (403)', () => {
  assert.ok(
    ROUTE.includes("import { resolveClerkId } from '@/lib/auth'"),
    'route must resolve the Clerk-or-demo identity server-side',
  )
  assert.ok(
    /ADMIN_USER_IDS/.test(ROUTE),
    'admin gate must be env-driven (ADMIN_USER_IDS, comma-separated)',
  )
  assert.ok(
    ROUTE.includes("String(process.env.ADMIN_USER_IDS || 'demo-user-001')"),
    'default allow-list must include the soft-launch admin demo-user-001',
  )
  assert.ok(ROUTE.includes("status: 401"), 'not-signed-in must 401')
  assert.ok(ROUTE.includes("status: 403"), 'non-admin must 403')
})

test('Round-88: route response shape is stable and NEVER serialises the API key', () => {
  assert.ok(
    ROUTE.includes("import { probeGroqHealth } from '@/lib/groq'"),
    'route must delegate the probe to lib/groq.js',
  )
  for (const key of ['status:', 'groq:', 'quotaExhausted:', 'mockMode:', 'reachable:', 'timestamp:']) {
    assert.ok(ROUTE.includes(key), `response must include ${key}`)
  }
  // The route may MENTION the key in comments (documenting the
  // no-leak contract) but must never READ it nor serialise it.
  assert.ok(
    !/process\.env\.GROQ_API_KEY/.test(ROUTE),
    'the route must not read GROQ_API_KEY itself (the probe owns provider access)',
  )
  assert.ok(
    !/apiKey\s*:/.test(ROUTE),
    'no apiKey field may be serialised into the response JSON',
  )
})
