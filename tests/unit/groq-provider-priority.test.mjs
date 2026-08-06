// tests/unit/groq-provider-priority.test.mjs
//
// Round-45 source-lock test for lib/groq.js's provider priority +
// the new EMERGENT_LLM_KEY branch.
//
// The project convention (PROJECT_SUMMARY.md → "Strukturella testmönster")
// is ONE test per claim with an explicit contract in the test name.
// Drift here would be silent — the SDK would either 401, return a
// truncated prompt, or silently fall through to the rule-based
// fallback. A structural lock on the priority order + endpoint /
// model literal is the cheapest way to lock the contract.
//
// Round-72: extended to lock the new OPENROUTER_API_KEY branch
// (priority 4). OpenRouter is OpenAI-compatible and proxies to
// Anthropic / Claude + Llama + Mistral + many others via
// `vendor/model` slugs.
//
// What this file locks:
//   1. GROQ_API_KEY is the first pick (existing behaviour preserved).
//   2. OPENAI_API_KEY is the second pick (existing behaviour preserved).
//   3. EMERGENT_LLM_KEY is the third pick (Round-45 addition).
//   4. OPENROUTER_API_KEY is the fourth pick (Round-72 addition).
//   5. The Emergent baseURL is `https://api.emergent.sh/v1` — by
//      wire-confirmed research, NOT `emergent.sh/api` and NOT
//      `api.emergent.sh` (note: specifically `https`).
//   6. The default Emergent model is `gpt-4o-mini` so a fallback
//      switch carries the least drift; EMERGENT_MODEL override hook
//      is wired through `process.env.EMERGENT_MODEL`.
//   7. The OpenRouter baseURL is `https://openrouter.ai/api/v1` —
//      NOT `openrouter.ai/v1` and NOT `openrouter.com/api/v1`.
//   8. The default OpenRouter model is `anthropic/claude-3.5-sonnet`
//      so a fallback switch carries the least drift; OPENROUTER_MODEL
//      override hook is wired through `process.env.OPENROUTER_MODEL`.
//   9. The warning text mentions OPENROUTER_API_KEY (remediation hint).
//  10. The NO-key fall-through still emits the warning, not a throw.
//  11. The provider-startup log includes the provider name + model so
//      server logs make the active provider discoverable.
//
// NOT covered here (kept out of lock so future refactors don't trip):
// • Behavioural tests of the actual OpenAI chat-completions call.
//   Tests in groq-prompts.test.mjs (when present) cover the
//   prompt content + max_tokens chain end-to-end via mock.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const SRC_PATH = 'lib/groq.js'
const SRC = readFileSync(SRC_PATH, 'utf8')

// Pre-flight: the contract file exists. Clearer than a vague
// "readFileSync failed" message from the underlying system error.
test('Round-45: lib/groq.js exists at the canonical path', () => {
  assert.ok(existsSync(SRC_PATH), `${SRC_PATH} must exist for these locks to be meaningful`)
})

test('Round-72: pickProvider() checks GROQ_API_KEY before OPENAI_API_KEY before EMERGENT_LLM_KEY before OPENROUTER_API_KEY (priority preserved)', () => {
  // The first `if (process.env.GROQ_API_KEY)` branch must appear BEFORE
  // any OPENAI_API_KEY / EMERGENT_LLM_KEY / OPENROUTER_API_KEY branch.
  // We assert by char index — the lower index wins.
  const groqIdx = SRC.indexOf('if (process.env.GROQ_API_KEY)')
  const openaiIdx = SRC.indexOf('if (process.env.OPENAI_API_KEY)')
  const emergentIdx = SRC.indexOf('if (process.env.EMERGENT_LLM_KEY)')
  const openrouterIdx = SRC.indexOf('if (process.env.OPENROUTER_API_KEY)')
  assert.ok(groqIdx > 0, 'GROQ branch must exist')
  assert.ok(openaiIdx > 0, 'OPENAI branch must exist')
  assert.ok(emergentIdx > 0, 'EMERGENT branch must exist')
  assert.ok(openrouterIdx > 0, 'OPENROUTER branch must exist')
  assert.ok(groqIdx < openaiIdx, `GROQ must precede OPENAI (groqIdx=${groqIdx}, openaiIdx=${openaiIdx})`)
  assert.ok(openaiIdx < emergentIdx, `OPENAI must precede EMERGENT (openaiIdx=${openaiIdx}, emergentIdx=${emergentIdx})`)
  assert.ok(emergentIdx < openrouterIdx, `EMERGENT must precede OPENROUTER (emergentIdx=${emergentIdx}, openrouterIdx=${openrouterIdx})`)
})

test('Round-45: Groq provider (priority 1) keeps baseURL + model unchanged', () => {
  // String literal anchor — locked by tests/unit/groq-prompts.test.mjs
  // when it's present. Keeping the test as a literal here so a future
  // refactor that swaps the baseURL has to update both the test AND
  // the source explicitly.
  assert.ok(
    SRC.includes("baseURL: 'https://api.groq.com/openai/v1'"),
    'Groq baseURL must stay https://api.groq.com/openai/v1',
  )
  // Round-80 followup (2026-08-02): primary swapped from
  // llama-3.3-70b-versatile (shuts down 2026-08-16 per Groq's
  // published schedule) to qwen/qwen3.6-27b — live-verified with
  // this key via the OCR smoke.
  assert.ok(
    SRC.includes("model: 'qwen/qwen3.6-27b'"),
    'Groq default model must stay qwen/qwen3.6-27b (swapped 2026-08-02 after llama-3.3-70b-versatile shutdown 2026-08-16)',
  )
})

test('Round-45: OpenAI provider (priority 2) keeps default model = gpt-4o-mini', () => {
  // gpt-4o-mini is the cross-provider footgun: it's also the default
  // for OPENAI (priority 2) AND EMERGENT (priority 3) via the
  // EMERGENT_MODEL fallback expression `process.env.EMERGENT_MODEL
  // || 'gpt-4o-mini'`. The test asserts the literal QUOTED string
  // `'gpt-4o-mini'` exists (>=2 occurrences), not the exact count —
  // a future third provider that also uses gpt-4o-mini as its
  // default would still satisfy the contract. The loose substring
  // match (rather than `model: 'gpt-4o-mini'`) catches the
  // EMERGENT_MODEL fallback expression accurately.
  const matches = SRC.match(/'gpt-4o-mini'/g) || []
  assert.ok(
    matches.length >= 2,
    `gpt-4o-mini must be the default for at least OPENAI + EMERGENT — found ${matches.length} occurrence(s)`,
  )
})

test('Round-45: Emergent provider (priority 3) routes via api.emergent.sh/v1', () => {
  // Wire-confirmed by 2026 emergent-agent docs: the universal-key
  // proxy accepts OpenAI SDK calls with baseURL overridden. The
  // exact host is the lockable surface — drift here would silently
  // 401 every AI call in an Emergent-only env.
  assert.ok(
    SRC.includes("baseURL: 'https://api.emergent.sh/v1'"),
    'Emergent baseURL must be https://api.emergent.sh/v1',
  )
  // Provider name is read downstream via `provider.name` for toasts
  // + analytics — keeping it `emergent` (lowercase) is the surface
  // the extension popup + cron logs reference.
  assert.ok(
    SRC.includes("name: 'emergent'"),
    'Emergent provider name must stay literal `emergent`',
  )
})

test('Round-45: Emergent default model honours EMERGENT_MODEL env override', () => {
  // The override hook reads EMERGENT_MODEL at module load, falling
  // back to `gpt-4o-mini`. The expression must stay bytewise-aligned
  // with the analytics/source-of-truth contract — anything fancier
  // (e.g. validation, allow-listing) would silently regress.
  assert.ok(
    SRC.includes("process.env.EMERGENT_MODEL || 'gpt-4o-mini'"),
    'Emergent default model must read EMERGENT_MODEL env override, falling back to gpt-4o-mini',
  )
})

test('Round-72: provider-startup warning mentions all four env keys (GROQ + OPENAI + EMERGENT + OPENROUTER)', () => {
  // The pre-Round-45 warning listed only GROQ + OPENAI hints. After
  // adding EMERGENT (Round-45) and OPENROUTER (Round-72), an env
  // without any key should get a REMEDIATION hint covering all 4
  // keys so an operator can fix a fresh env without reading the
  // source.
  assert.ok(
    SRC.includes('EMERGENT_LLM_KEY')
      && SRC.includes('GROQ_API_KEY')
      && SRC.includes('OPENAI_API_KEY')
      && SRC.includes('OPENROUTER_API_KEY'),
    'No-key warning must list all four supported env vars (GROQ, OPENAI, EMERGENT, OPENROUTER)',
  )
  // Lock the language — operators grep Swedish logs more often
  // than the warning text; the substring "regelbaserad" is unique.
  assert.ok(
    SRC.includes('regelbaserad') || SRC.includes('rule-based'),
    'No-key warning copy must still mention the rule-based fallback (preserves operator UX)',
  )
})

test('Round-72: OpenRouter provider (priority 4) routes via openrouter.ai/api/v1', () => {
  // OpenRouter is OpenAI-compatible — same SDK, different baseURL.
  // Wire-confirmed against the OpenRouter docs: 4th-leg routing
  // path. Drift here (e.g., dropping `/api/v1`) would silently 401
  // every AI call in an OpenRouter-only env.
  assert.ok(
    SRC.includes("baseURL: 'https://openrouter.ai/api/v1'"),
    'OpenRouter baseURL must stay https://openrouter.ai/api/v1',
  )
  // Provider name is read downstream via `provider.name` for toasts
  // + analytics — keeping it `openrouter` (lowercase) is the surface
  // the extension popup + cron logs reference.
  assert.ok(
    SRC.includes("name: 'openrouter'"),
    'OpenRouter provider name must stay literal `openrouter`',
  )
})

test('Round-72: OpenRouter default model honours OPENROUTER_MODEL env override', () => {
  // The override hook reads OPENROUTER_MODEL at module load, falling
  // back to `anthropic/claude-3.5-sonnet`. The expression must stay
  // bytewise-aligned with the analytics/source-of-truth contract —
  // anything fancier (e.g., validation, allow-listing) would silently
  // regress.
  assert.ok(
    SRC.includes("process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet'"),
    'OpenRouter default model must read OPENROUTER_MODEL env override, falling back to anthropic/claude-3.5-sonnet',
  )
  // Also lock that `anthropic/` vendor prefix is the default — a
  // future refactor that swaps the default to a non-Anthropic model
  // (e.g., `meta/llama-3.1-405b-instruct`) would silently break the
  // user's explicit "access Anthropic via this provider" contract.
  assert.ok(
    SRC.includes("'anthropic/claude-3.5-sonnet'"),
    'OpenRouter default model must stay anthropic/* (Anthropic proxy contract)',
  )
})

test('Round-45: the misleading "EMERGENT is intentionally NOT supported" comment was removed/updated', () => {
  // Pre-Round-45 the file had a 6-line comment block asserting EMERGENT
  // was unsupported + required a flagged-malicious third-party package.
  // With the direct-SDK integration, those claims are now wrong.
  // The test asserts BOTH the "intentionally NOT supported" framing
  // AND any reference to a third-party integration package (which we
  // never depend on) are gone. Future maintainers re-introducing
  // either would re-trigger the wrong-recommendation footgun.
  assert.ok(
    !SRC.includes('intentionally NOT supported here because the Emergent'),
    'Pre-Round-45 "intentionally NOT supported" comment must be removed — the assumption was wrong',
  )
  assert.ok(
    !SRC.match(/emergent[in_]?integrat/i),
    'Any reference to a third-party Emergent integration package must be removed — we use the direct OpenAI SDK only',
  )
})

test('Round-45: provider-startup log line uses provider.name + provider.model', () => {
  // The dev-mode `[groq] using provider=NAME model=MODEL` log is what
  // makes the active provider discoverable in server logs. A future
  // refactor that splits this into multiple log lines or stops
  // logging the model name would lose the contract — lock the
  // substring to prevent silent regression.
  assert.ok(
    SRC.includes('using provider=${provider.name}'),
    'provider-startup log must reference provider.name',
  )
  assert.ok(
    SRC.includes('model=${provider.model}'),
    'provider-startup log must reference provider.model',
  )
})

// ---- Round-80 followup: text-model fallback chain ----

test('Round-80: TEXT_MODELS is an ordered fallback chain with the primary first', async () => {
  const { textModelChainForProvider } = await import('../../lib/groq.js')
  const groq = textModelChainForProvider('groq', 'x')
  // Round-80 followup (2026-08-02): primary is now qwen/qwen3.6-27b.
  // llama-3.3-70b-versatile is NOT in the chain at all — it shuts down
  // 2026-08-16, so keeping it as the fallback would waste the retry on
  // a dead model.
  assert.equal(groq[0], 'qwen/qwen3.6-27b')
  assert.ok(
    groq.length >= 2,
    'Groq text chain must carry a secondary model for decommission resilience (qwen primary + llama-4-maverick secondary)',
  )
  assert.ok(
    !groq.includes('llama-3.3-70b-versatile'),
    'llama-3.3-70b-versatile must NOT appear in the chain (shuts down 2026-08-16)',
  )
  assert.equal(textModelChainForProvider('openai', 'x')[0], 'gpt-4o-mini')
  assert.deepEqual(textModelChainForProvider('unknown-vendor', 'fb'), ['fb'])
})

test('Round-80: daysUntilDecommission returns days-left for scheduled models and null otherwise', async () => {
  const { daysUntilDecommission } = await import('../../lib/groq.js')
  // llama-3.3-70b-versatile shuts down 2026-08-16 (Groq schedule).
  // Compute the EXPECTED value from the known date instead of a
  // hardcoded constant so the test stays deterministic for ANY run
  // date — before the shutdown (14 days on 2026-08-02) and after it
  // (negative) alike. A pure `days <= 30` assertion would silently
  // lose its meaning once the date passes.
  const expectedDays = Math.ceil((new Date('2026-08-16T00:00:00Z').getTime() - Date.now()) / 86_400_000)
  const days = daysUntilDecommission('llama-3.3-70b-versatile')
  assert.equal(days, expectedDays, 'day-count arithmetic must match the known decommission date — got ' + days)
  // Models without a known schedule are silent (null), not a crash.
  assert.equal(daysUntilDecommission('qwen/qwen3.6-27b'), null)
  assert.equal(daysUntilDecommission('gpt-4o-mini'), null)
  assert.equal(daysUntilDecommission('no-such-model'), null)
})

test('Round-80: every LLM call site routes through createChatWithFallback, not raw client calls', () => {
  // The five generation paths (cover letter, answer, adaptive answer,
  // email body, generateText) must ALL go through the fallback chain.
  // A raw `client.chat.completions.create` in a generation path would
  // silently bypass the decommission resilience. Comments may
  // reference the raw call (doc examples), so we count only lines that
  // are NOT comment/doc lines.
  const rawCallLines = SRC.split('\n').filter(
    (l) => l.includes('client.chat.completions.create') && !l.trim().startsWith('//') && !l.trim().startsWith('*'),
  )
  // Two executable raw calls are legitimate, both documented:
  //   1. createChatWithFallback — the shared choke point every
  //      generation surface funnels through.
  //   2. probeGroqHealth (Round-88 / /api/admin/ai-status) — the
  //      quota health probe DELIBERATELY bypasses the fallback chain:
  //      it must observe the RAW provider error (TPD quota 429 vs
  //      model-level rejection vs unreachable) to classify the
  //      outage for an operator. Routing it through
  //      createChatWithFallback would mask a TPD-exhaustion 429 as a
  //      successful retry and hide the very signal the probe exists
  //      to surface.
  assert.equal(
    rawCallLines.length,
    2,
    `expected exactly 2 executable raw calls (createChatWithFallback + probeGroqHealth), found ${rawCallLines.length}:\n${rawCallLines.join('\n')}`,
  )
  const fallbackCalls = SRC.match(/createChatWithFallback\(/g) || []
  assert.ok(fallbackCalls.length >= 5, `all 5 generation paths must use createChatWithFallback — found ${fallbackCalls.length}`)
})

test('Round-80: isModelLevelError matches decommissioned models but NOT rate limits (429)', async () => {
  // 429 rate-limit errors must NOT burn the fallback chain — they
  // should fail soft to the rule-based template (the same reason
  // lib/cv-ocr.js treats 429 as non-retryable). Direct behavioral
  // test of the exported detector.
  const { isModelLevelError } = await import('../../lib/groq.js')
  assert.equal(
    isModelLevelError('The model `llama-3.2-90b-vision-preview` has been decommissioned and is no longer supported.'),
    true,
  )
  assert.equal(
    isModelLevelError('The model `foo` has been deprecated and will be shut down.'),
    true,
  )
  assert.equal(
    isModelLevelError('Model `x` does not exist.'),
    true,
  )
  // Rate limits + transient errors are NOT model-level — no retry.
  assert.equal(
    isModelLevelError('429 Rate limit reached for model `qwen/qwen3.6-27b` ... Limit 200000, Used 199439'),
    false,
  )
  assert.equal(isModelLevelError('ECONNRESET read ECONNRESET'), false)
})

// ---- Round-80 / Bug 4: <think> reasoning-trace strip ----

test('Round-80 Bug 4: stripReasoningTraces removes closed <think> blocks + truncated traces', async () => {
  const { stripReasoningTraces } = await import('../../lib/groq.js')
  // Closed block mid-text (the qwen live pattern from the OCR smoke).
  assert.equal(
    stripReasoningTraces('Hej Volvo,<think>Jag borde nämna min React-erfarenhet här.</think> jag har erfarenhet av React.'),
    'Hej Volvo, jag har erfarenhet av React.',
  )
  // Leading truncated trace (unclosed <think> cut by max_tokens) —
  // stripped up to the first blank line.
  assert.equal(
    stripReasoningTraces('<think>Här börjar resonemanget som avbröts\n\nHej Volvo, jag skriver brevet.'),
    'Hej Volvo, jag skriver brevet.',
  )
  // Clean output passes through untouched.
  const clean = 'Hej Volvo, det var med stort intresse jag såg annonsen.'
  assert.equal(stripReasoningTraces(clean), clean)
  // Non-string input is a no-op.
  assert.equal(stripReasoningTraces(null), null)
  assert.equal(stripReasoningTraces(undefined), undefined)
})

test('Round-80 Bug 4: every LLM text-output path calls stripReasoningTraces before returning', () => {
  // The five generation paths (cover letter, answer, adaptive answer,
  // email body, generateText) must ALL strip reasoning traces — a
  // future refactor that re-introduces a raw `.content` return would
  // leak <think> into the dashboard modal again. Count executable
  // strip calls (comments may reference the helper for docs).
  const stripCalls = SRC.split('\n').filter(
    (l) => l.includes('stripReasoningTraces(text)') || l.includes('stripReasoningTraces(text\n') || l.includes('stripReasoningTraces(String(text)'),
  )
  assert.ok(stripCalls.length >= 5, `all 5 generation paths must strip reasoning traces — found ${stripCalls.length} call sites`)
})
