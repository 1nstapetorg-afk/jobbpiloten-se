// tests/unit/groq-tpd-quota.test.mjs
//
// Round-86 — locks the Groq daily-token-quota (TPD) exhaustion
// detector added to lib/groq.js. The Round-86 onboarding tester hit
// "Servern returnerade 502" on the email preview; the log showed the
// real cause was Groq's TPD quota (Limit 200000, Used 199741) — every
// LLM call 429'd. The app degrades gracefully to the rule-based
// fallback, but the operator needed a LOUD warning. This test locks:
//   • isTpdQuotaError(msg) — true ONLY for the TPD-exhaustion class
//     (not transient per-second 429s, not model-level errors).
//   • parseTpdQuota(msg) — extracts limit/used/percent.
//
// Importing lib/groq.js at module scope would fire pickProvider()'s
// startup log + construct the OpenAI client. The helpers are pure and
// don't need the module's side effects, so we import the module with
// the same fresh-load dance the provider-behavior test uses but keep
// it network-safe (no fetch ever happens in these pure helpers).
import test from 'node:test'
import assert from 'node:assert/strict'

// The exact 429 payload shape Groq returns when the daily quota is
// exhausted (verbatim class from the Round-86 dev-server log, only the
// numbers/timing made generic).
const REAL_TPD_MESSAGE =
  '429 Rate limit reached for model `qwen/qwen3.6-27b` in organization `org_01kx16e59cfp2b0whhhh3qwsqa` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199741, Requested 914. Please try again in 4m42.96s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing'

// A transient (non-TPD) rate limit — e.g. per-second burst limit or a
// concurrent-request cap — must NOT trip the TPD detector (those
// recover on retry; the caller keeps its normal soft-fail path).
const TRANSIENT_429 =
  '429 Too Many Requests: requests per minute limit reached. Retry after 30s.'

async function loadGroqHelpers() {
  const origFetch = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('TEST_NETWORK_BLOCKED'))
  try {
    const mod = await import(`../../lib/groq.js?t=${Date.now()}-${Math.random()}`)
    return mod
  } finally {
    globalThis.fetch = origFetch
  }
}

test('Round-86: isTpdQuotaError detects the real Groq TPD-exhaustion payload', async () => {
  const { isTpdQuotaError } = await loadGroqHelpers()
  assert.equal(isTpdQuotaError(REAL_TPD_MESSAGE), true, 'the verbatim TPD 429 payload must be detected')
  assert.equal(isTpdQuotaError(new Error(REAL_TPD_MESSAGE).message), true, 'must also detect when passed the unwrapped .message string')
})

test('Round-86: isTpdQuotaError does NOT fire on transient 429s, model-level errors, or empty strings', async () => {
  const { isTpdQuotaError } = await loadGroqHelpers()
  assert.equal(isTpdQuotaError(TRANSIENT_429), false, 'per-second / transient 429 must NOT be flagged as TPD exhaustion')
  assert.equal(isTpdQuotaError('model does not exist: foo'), false, 'model-level rejection must NOT be flagged')
  assert.equal(isTpdQuotaError(''), false, 'empty message must not be flagged')
  assert.equal(isTpdQuotaError(undefined), false, 'undefined must not be flagged (String() guard)')
  assert.equal(isTpdQuotaError(null), false, 'null must not be flagged')
})

test('Round-86: parseTpdQuota extracts limit / used / percent from the real payload', async () => {
  const { parseTpdQuota } = await loadGroqHelpers()
  const q = parseTpdQuota(REAL_TPD_MESSAGE)
  assert.ok(q, 'parseTpdQuota must return an object for a TPD message')
  assert.equal(q.limit, 200000)
  assert.equal(q.used, 199741)
  assert.equal(q.percent, 99.9) // 199741/200000 = 0.9987 → 99.9%
  assert.equal(parseTpdQuota(TRANSIENT_429), null, 'non-TPD messages must parse to null')
  assert.equal(parseTpdQuota(''), null, 'empty message must parse to null')
})

test('Round-86: TPD warning is wired into createChatWithFallback (source lock)', async () => {
  // Source-lock: the single choke point used by generateCoverLetter /
  // generateAnswer / generateAdaptiveAnswer / generateEmailBody must
  // emit a prominent TPD warning before rethrowing — otherwise a
  // future refactor that bypasses the helper silently drops the
  // operator alert and the app falls back without a trace.
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../../lib/groq.js', import.meta.url), 'utf8')
  assert.match(src, /isTpdQuotaError\(msg\)/, 'createChatWithFallback must call isTpdQuotaError(msg) on the catch path')
  assert.match(src, /TPD QUOTA EXHAUSTED/, 'the TPD warning must carry the prominent TPD QUOTA EXHAUSTED marker')
  assert.match(src, /parseTpdQuota\(msg\)/, 'the warning must surface the parsed quota numbers (limit/used/percent)')
})
