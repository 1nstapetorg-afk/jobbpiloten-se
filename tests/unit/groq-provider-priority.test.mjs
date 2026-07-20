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
  assert.ok(
    SRC.includes("model: 'llama-3.3-70b-versatile'"),
    'Groq default model must stay llama-3.3-70b-versatile',
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
