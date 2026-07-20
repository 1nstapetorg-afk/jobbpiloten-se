// Round-46 behavioural test for lib/groq.js's pickProvider().
// Loads the module fresh per case (cache-buster ?t=) so process.env
// mutations don't leak and the captured startup log is exactly the
// line pickProvider emitted at module-load. The earlier structural
// test (tests/unit/groq-provider-priority.test.mjs) locks the source;
// THIS file locks the BEHAVIOUR: provider pick + model pick + warn-on-
// no-key. Matches the codebase's analytics.test.mjs console-capture
// pattern (array.push) to dodge the literal-newline-in-string trap the
// Round-46 v1 patch hit.
import test from 'node:test'
import assert from 'node:assert/strict'

const NET_BLOCK = 'TEST_NETWORK_BLOCKED'
const ENV_KEYS = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'EMERGENT_LLM_KEY', 'EMERGENT_MODEL', 'NODE_ENV']

async function loadGroqWithEnv(envOverrides = {}) {
  const ORIG = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

  // Reset every key we touch + apply test-specific overrides.
  for (const k of ENV_KEYS) delete process.env[k]
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined || v === null) delete process.env[k]
    else process.env[k] = String(v)
  }

  // Capture both .log and .warn into a single array (array.push is
  // immune to literal-newline-in-string bugs that bit the v1 patch).
  const logs = []
  const origLog = console.log
  const origWarn = console.warn
  console.log = (...args) => logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  console.warn = (...args) => logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  const origFetch = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error(NET_BLOCK))

  try {
    // ?t= cache-buster forces V8 to re-evaluate lib/groq.js so
    // pickProvider() runs against the freshly-set process.env.
    await import(`../../lib/groq.js?t=${Date.now()}-${Math.random()}`)
  } finally {
    console.log = origLog
    console.warn = origWarn
    globalThis.fetch = origFetch
    for (const [k, v] of Object.entries(ORIG)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  return logs.join('\n')
}

test('Round-46 behaviour: EMERGENT_LLM_KEY alone picks provider=emergent with default model=gpt-4o-mini', async () => {
  const log = await loadGroqWithEnv({ EMERGENT_LLM_KEY: 'fake-emergent-key' })
  assert.match(log, /provider=emergent/, 'EMERGENT-only env must select provider=emergent — actual log: ' + JSON.stringify(log))
  assert.match(log, /model=gpt-4o-mini/, 'EMERGENT default model must be gpt-4o-mini (caller did not set EMERGENT_MODEL) — actual log: ' + JSON.stringify(log))
})

test('Round-46 behaviour: EMERGENT_MODEL env override flows through to startup log (no default leak)', async () => {
  const log = await loadGroqWithEnv({
    EMERGENT_LLM_KEY: 'fake-emergent-key',
    EMERGENT_MODEL: 'claude-3-5-sonnet',
  })
  assert.match(log, /provider=emergent/, 'must remain provider=emergent with model override — actual log: ' + JSON.stringify(log))
  assert.match(log, /model=claude-3-5-sonnet/, 'EMERGENT_MODEL override must flow through — actual log: ' + JSON.stringify(log))
  // Negative lock: ensure the DEFAULT ('gpt-4o-mini') did NOT leak
  // through alongside the override. Both count-match and .includes()
  // would catch a single leak; .includes() wins on intent readability
  // ("log should not mention gpt-4o-mini at all") and avoids the
  // magic-zero count idiom.
  assert.ok(
    !log.includes('model=gpt-4o-mini'),
    'default gpt-4o-mini must NOT leak alongside the override — actual log: ' + JSON.stringify(log),
  )
})

test('Round-46 behaviour: GROQ_API_KEY wins over EMERGENT_LLM_KEY (precedence lock, no emergent leak)', async () => {
  const log = await loadGroqWithEnv({
    GROQ_API_KEY: 'fake-groq-key',
    EMERGENT_LLM_KEY: 'fake-emergent-key',
  })
  assert.match(log, /provider=groq/, 'GROQ must take precedence over EMERGENT — actual log: ' + JSON.stringify(log))
  assert.match(log, /llama-3\.3-70b-versatile/, 'must use the GROQ default model llama-3.3-70b-versatile — actual log: ' + JSON.stringify(log))
  // Negative lock: ensure EMERGENT did NOT leak alongside GROQ.
  // .includes() over count-match: a future debug log that incidentally
  // mentions provider=emergent once still fails the lock (count-based
  // match would silently turn false-negative on the count).
  assert.ok(
    !log.includes('provider=emergent'),
    'provider=emergent must NOT leak alongside GROQ — actual log: ' + JSON.stringify(log),
  )
})

test('Round-46 behaviour: OPENAI_API_KEY wins over EMERGENT_LLM_KEY (precedence lock, no emergent leak)', async () => {
  const log = await loadGroqWithEnv({
    OPENAI_API_KEY: 'fake-openai-key',
    EMERGENT_LLM_KEY: 'fake-emergent-key',
  })
  assert.match(log, /provider=openai/, 'OPENAI must take precedence over EMERGENT — actual log: ' + JSON.stringify(log))
  assert.match(log, /model=gpt-4o-mini/, 'must use the OPENAI default model gpt-4o-mini — actual log: ' + JSON.stringify(log))
  // Negative lock: ensure EMERGENT did NOT leak alongside OPENAI.
  // .includes() over count-match (see test 3 comment for rationale).
  assert.ok(
    !log.includes('provider=emergent'),
    'provider=emergent must NOT leak alongside OPENAI — actual log: ' + JSON.stringify(log),
  )
})

test('Round-46 behaviour: no key configured triggers an explicit warning (operator remediation aid)', async () => {
  // Note: passing loadGroqWithEnv({}) after the loadGroqWithEnv reset
  // guarantees a clean baseline (no GROQ/OPENAI/EMERGENT left over).
  const log = await loadGroqWithEnv({})
  assert.match(
    log,
    /no LLM API key configured/i,
    'No-key env MUST emit an explicit warning so an operator can fix it — actual log: ' + JSON.stringify(log),
  )
})

test('Round-46 behaviour: all three providers in env — GROQ wins (full precedence chain end-to-end)', async () => {
  // Round-46 review feedback: locks GROQ>OPENAI and GROQ>EMERGENT
  // (via the strong positive; GROQ-wins alone proves OPENAI and
  // EMERGENT were outranked by GROQ). The OPENAI>EMERGENT subchain
  // is locked by test 4. Together tests 3, 4, and 6 form the full
  // precedence triangle. Defense-in-depth: test 6 also catches a
  // sneaky future swap of GROQ<->OPENAI in lib/groq.js (test 4 alone
  // wouldn't notice that swap, since OPENAI is chosen either way).
  const log = await loadGroqWithEnv({
    GROQ_API_KEY: 'fake-groq-key',
    OPENAI_API_KEY: 'fake-openai-key',
    EMERGENT_LLM_KEY: 'fake-emergent-key',
  })
  assert.match(log, /provider=groq/, 'GROQ must beat OPENAI and EMERGENT in the precedence chain — actual log: ' + JSON.stringify(log))
  assert.match(log, /llama-3\.3-70b-versatile/, 'must use the GROQ default model llama-3.3-70b-versatile — actual log: ' + JSON.stringify(log))
  assert.ok(!log.includes('provider=openai'), 'OPENAI must NOT be mentioned — actual log: ' + JSON.stringify(log))
  assert.ok(!log.includes('provider=emergent'), 'EMERGENT must NOT be mentioned — actual log: ' + JSON.stringify(log))
})
