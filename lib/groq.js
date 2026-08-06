import { OpenAI } from 'openai'
import { resolveStylePreset } from './style-presets.mjs'
import { detectIndustryMismatch, buildTransferableSkillsSection, pickCvText } from './transferable-skills.js'

/**
 * LLM client + cover-letter generator.
 *
 * Provider priority (first non-empty key wins):
 *   1. `GROQ_API_KEY`   - canonical soft-launch provider (default). Routes
 *                          via Groq's OpenAI-compatible endpoint, model
 *                          `qwen/qwen3.6-27b` (2026-08-02: swapped from
 *                          llama-3.3-70b-versatile, which Groq schedules
 *                          for shutdown 2026-08-16).
 *   2. `OPENAI_API_KEY` - direct OpenAI access. Uses the SDK's default
 *                          `https://api.openai.com/v1/` baseURL, model
 *                          `gpt-4o-mini` (closest equivalent in cost /
 *                          latency to the Groq llama model).
 *   3. `EMERGENT_LLM_KEY` - Universal-key proxy hosted at
 *                          `https://api.emergent.sh/v1` (the Emergent
 *                          soft-launch preview platform). The proxy is
 *                          OpenAI-compatible at the wire level — direct
 *                          OpenAI SDK calls work by setting `baseURL` +
 *                          `Authorization: Bearer ${EMERGENT_LLM_KEY}`.
 *                          The proxy accepts standard OpenAI model names;
 *                          we default to `gpt-4o-mini` for parity with
 *                          the OpenAI tier so a fallback switch carries
 *                          the least behavioural drift. Operators can
 *                          override via the `EMERGENT_MODEL` env var.
 *
 * Round-45: the prior code comment asserted EMERGENT was "NOT supported"
 * because an outdated belief that the proxy would 401 on direct OpenAI
 * SDK calls. That assumption was incorrect — the proxy is OpenAI-
 * compatible at the wire level, verified 2026-07-13 against the
 * provider's documented OpenAI-compat endpoint. The legacy Python
 * integration package historically associated with this provider has
 * been flagged by independent security researchers as potentially
 * malicious (credential-exfiltration reports), so we deliberately
 * never depend on it — the direct OpenAI SDK is the only integration
 * path here. Round-45 adds the EMERGENT branch in the LOWEST priority
 * slot so a separate env without GROQ/OPENAI keys still gets LLM
 * responses on the Emergent-hosted preview (the user's reported `.env`
 * carries EMERGENT_LLM_KEY as a fallback for the soft-launch cluster).
 *
 * The selected provider is logged once at module-load so misconfiguration
 * is loud in server logs rather than silent (silent would surface only as
 * a bad fallback later in /api/apply-now).
 *
 * Round-35: this file is now ESM (was CommonJS pre-Round-35). The
 * `@/lib/style-presets` module is also ESM, and the Next.js
 * `import { generateCoverLetter } from '@/lib/groq'` call sites
 * already use ESM syntax — converting this file to ESM removes the
 * only CJS<->ESM boundary in the AI code path. The openai SDK
 * supports both module systems; `import { OpenAI } from 'openai'`
 * is the canonical ESM form.
 */

// 2026-07-17 (Round-59 DRY polish): the canonical key order is
// hoisted to module scope AND the per-provider config lives in a
// single `LLM_PROVIDER_BY_KEY` lookup table. Adding a 4th provider
// (e.g. ANTHROPIC_API_KEY) becomes two edits (extend
// `LLM_KEY_NAMES` for precedence + add the matching factory entry
// below for config) instead of duplicating the precedence if-chain
// AND the bottom lookup helper.
//
// 2026-07-17 (Round-74 followup): `LLM_KEY_NAMES` is the SINGLE
// SOURCE OF TRUTH for TWO consumers — (1) `pickProvider()` below
// walks this array in declaration order to pick the first non-empty
// key, and (2) `isLlmAvailable()` at the bottom of this file checks
// the same array to decide whether ANY provider is configured
// (used by routes + UI to render "no AI key" copy). Adding a new
// provider means editing this array AND adding the matching factory
// entry to `LLM_PROVIDER_BY_KEY` — the two must stay co-located so
// a future regression that drops a key from one but not the other
// surfaces immediately. The tests/unit/groq-* suite locks both
// consumers (provider-priority.test.mjs + provider-behavior.test.mjs)
// so a single edit that breaks either one fails the build.
//
// The `// if (process.env.X)` comment stubs BEFORE each provider
// entry are load-bearing for tests/unit/groq-provider-priority.test.mjs
// which locks the priority order via `SRC.indexOf('if (process.env.X)')`.
// Do NOT remove these comments without updating that test.
const LLM_KEY_NAMES = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'EMERGENT_LLM_KEY', 'OPENROUTER_API_KEY']

// Round-72/74 (4th provider choice): OpenRouter was picked as the
// 4th provider because it speaks the OpenAI API natively — no new
// SDK, no new abstraction layer. The same `openai` package + the
// same `client.chat.completions.create({...})` call signature
// serves all four providers below. OpenRouter's `vendor/model` slug
// scheme (e.g. `anthropic/claude-3.5-sonnet`,
// `meta-llama/llama-3.1-405b-instruct`, `mistralai/mistral-large`)
// gives us a single auth surface for Anthropic + Llama + Mistral
// + many others, with model override via OPENROUTER_MODEL without
// a code deploy. Operators that want NATIVE Anthropic access can
// swap the baseURL + add @anthropic-ai/sdk later — today, OpenRouter
// is the cheapest path to multi-vendor coverage with zero new
// dependencies. Alternative considered: direct Anthropic SDK (would
// have required adding @anthropic-ai/sdk AND maintaining a parallel
// code path; rejected as over-engineered for the soft-launch tier).
const LLM_PROVIDER_BY_KEY = {
  // if (process.env.GROQ_API_KEY)
  GROQ_API_KEY: (apiKey) => ({
    name: 'groq',
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
    // 2026-08-02 (Round-80 followup): primary swapped from
    // llama-3.3-70b-versatile to qwen/qwen3.6-27b — llama-3.3-70b is
    // on Groq's published shutdown schedule (2026-08-16), and qwen is
    // live-verified with this key via the OCR smoke. The TEXT_MODELS
    // chain below mirrors this entry as its first element.
    model: 'qwen/qwen3.6-27b',
  }),
  // if (process.env.OPENAI_API_KEY)
  OPENAI_API_KEY: (apiKey) => ({
    name: 'openai',
    apiKey,
    // No baseURL override - default https://api.openai.com/v1.
    // gpt-4o-mini is the closest equivalent to the Groq llama model
    // in cost / latency.
    model: 'gpt-4o-mini',
  }),
  // if (process.env.EMERGENT_LLM_KEY)
  EMERGENT_LLM_KEY: (apiKey) => ({
    name: 'emergent',
    apiKey,
    baseURL: 'https://api.emergent.sh/v1',
    // EMERGENT_MODEL override hook (Round-45) — operators can pin a
    // different proxy-fronted model (e.g. claude-3-5-sonnet) without
    // a code deploy. Default `gpt-4o-mini` matches the OpenAI tier
    // so a fallback switch carries the least behavioural drift.
    model: process.env.EMERGENT_MODEL || 'gpt-4o-mini',
  }),
  // if (process.env.OPENROUTER_API_KEY)
  OPENROUTER_API_KEY: (apiKey) => ({
    name: 'openrouter',
    apiKey,
    // OpenRouter is OpenAI-API-compatible (no new SDK needed) and
    // provides a unified gateway to Anthropic / Claude, Llama,
    // Mistral, and many others via `vendor/model` slugs. Operators
    // pin a different model via OPENROUTER_MODEL without a code
    // deploy — same hook pattern as EMERGENT_MODEL.
    baseURL: 'https://openrouter.ai/api/v1',
    model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet',
  }),
}

function pickProvider() {
  for (const key of LLM_KEY_NAMES) {
    const raw = process.env[key]
    // Trim whitespace-only placeholders so a `GROQ_API_KEY=   `
    // (or any white-space-padded value) falls through to the next
    // provider — mirrors the `isLlmAvailable()` contract so the
    // canonical key order is the single source of truth for both
    // "is AI configured" and "which provider wins".
    const apiKey = raw && raw.trim()
    if (apiKey && LLM_PROVIDER_BY_KEY[key]) {
      return LLM_PROVIDER_BY_KEY[key](apiKey)
    }
  }
  return null
}

// ---- Round-80 followup — ordered TEXT-model fallback chain ----
//
// lib/cv-ocr.js got a vision-model chain for the same reason this
// block exists: providers decommission models with ~weeks of notice
// (Groq retired llama-3.2-90b-vision-preview on 2025-04-14, and the
// former primary TEXT model llama-3.3-70b-versatile is scheduled for
// shutdown 2026-08-16 per Groq's deprecation schedule). A single
// hardcoded `provider.model` means one decommissioned model takes down
// ALL cover-letter / email / answer generation until a code deploy
// lands.
//
// 2026-08-02 (Round-80 followup): the groq chain now LEADS with
// qwen/qwen3.6-27b — the same multimodal model lib/cv-ocr.js uses
// (live-verified with this key on 2026-08-02) — with
// meta-llama/llama-4-maverick-17b-128e-instruct as the verified
// secondary (mirrors the vision chain's pair, so the app carries one
// consistent set of Groq slugs). llama-3.3-70b-versatile is REMOVED
// from the chain entirely: keeping it would make it the fallback that
// 400s after 2026-08-16, wasting the retry on a dead model.
//
// Each provider gets an ordered chain: the FIRST entry is the current
// primary (must stay aligned with `LLM_PROVIDER_BY_KEY` above so the
// startup log + tests keep matching), later entries are retried when
// the primary is rejected at the MODEL level (decommissioned /
// deprecated / does not exist). Transient errors (429 rate limit,
// network blip) are NOT retried — they propagate so the caller's
// existing catch falls back to the rule-based template, exactly as
// before. The secondary picks are verified-stable replacements:
//   • groq secondary = meta-llama/llama-4-maverick-17b-128e-instruct
//     — mirrors lib/cv-ocr.js's vision chain so the app carries one
//     consistent set of verified Groq slugs.
//   • openai/emergent/openrouter keep single-entry chains (env-model
//     override hooks already cover operator pinning there).
const TEXT_MODELS = {
  groq: ['qwen/qwen3.6-27b', 'meta-llama/llama-4-maverick-17b-128e-instruct'],
  openai: ['gpt-4o-mini'],
  emergent: [process.env.EMERGENT_MODEL || 'gpt-4o-mini'],
  openrouter: [process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet'],
}

/**
 * Ordered text-model chain for a provider (primary first). Unknown
 * providers yield a single-entry chain of the fallback model. Used
 * by createChatWithFallback() to retry a secondary model when the
 * primary is rejected at the model level.
 */
export function textModelChainForProvider(name, fallbackModel) {
  const chain = TEXT_MODELS[name]
  if (Array.isArray(chain) && chain.length > 0) return chain.slice()
  return [fallbackModel]
}

/**
 * Model-level rejection detector — mirror of the one in lib/cv-ocr.js.
 * True only for "this model doesn't exist / was decommissioned" style
 * errors, so the fallback chain is NOT burned on transient 429s or
 * network blips (those should fail soft to the rule-based template).
 */
export function isModelLevelError(msg) {
  return /decommissioned|deprecated|does not exist|not supported|model not found/i.test(String(msg || ''))
}

/**
 * Round-86 — daily-token-quota (TPD) exhaustion detector. Groq's 429
 * payload is a long human-readable string:
 *
 *   "429 Rate limit reached for model `qwen/qwen3.6-27b` ... on tokens
 *    per day (TPD): Limit 200000, Used 199741, Requested 914. Please
 *    try again in 4m42.96s. Need more tokens? Upgrade to Dev Tier..."
 *
 * When the daily quota is gone, EVERY LLM call 429s until the reset —
 * the app degrades to the rule-based fallback (correct fail-soft), but
 * an operator needs a LOUD signal that this is a billing/quota issue,
 * not a code bug (the Round-86 onboarding tester wasted time hunting a
 * "502" that was really an exhausted quota). This predicate is the
 * discriminator: true ONLY for the TPD-exhaustion class, so the caller
 * can emit a prominent warning without firing on transient 429s
 * (per-second rate limits, concurrent bursts) which legitimately
 * recover on retry.
 */
export function isTpdQuotaError(msg) {
  return /tokens per day \(TPD\)|Limit \d+, Used \d+/i.test(String(msg || ''))
}

/**
 * Round-86 — extract the quota numbers from a TPD-exhaustion message
 * for the operator warning (limit / used / percent). Returns null for
 * non-TPD messages. Pure + exported so unit tests can lock the parse
 * without hitting the network.
 */
export function parseTpdQuota(msg) {
  const s = String(msg || '')
  const limit = /Limit (\d+)/i.exec(s)?.[1]
  const used = /Used (\d+)/i.exec(s)?.[1]
  if (!limit || !used) return null
  const l = Number(limit)
  const u = Number(used)
  return {
    limit: l,
    used: u,
    percent: l > 0 ? Math.round((u / l) * 1000) / 10 : 0,
  }
}

/**
 * Round-87 — E2E mock mode. When the Playwright suite runs with
 * `SKIP_LLM_E2E=true` (local) or `CI=true` (GitHub Actions), every
 * LLM call short-circuits to a deterministic local response instead
 * of hitting the real provider. The Round-86/87 E2E 429 rate-limit
 * test fires 20 sequential /api/email-draft calls — against the real
 * API those either burn Groq quota or (when the TPD daily quota is
 * exhausted) each wait on the 429 fail-fast, blowing the test
 * timeout. Mock mode keeps the suite fast, deterministic, and
 * quota-free while still exercising the full route stack (auth,
 * rate limiter, tier cap, response shaping). Exported for unit
 * locks.
 */
export function isLlmMockMode() {
  // SKIP_LLM_E2E is the explicit local opt-in — always honoured.
  // CI=true is only honoured OUTSIDE production (round-87 code-review
  // hardening): CI=true is set in many non-E2E contexts (Vercel build
  // env, some CD runtimes), and a production runtime must NEVER serve
  // the canned mock text to real users. Caveat: a CI pipeline that
  // runs E2E against a `next start` prod build (NODE_ENV=production)
  // must pass SKIP_LLM_E2E=true explicitly — the playwright config
  // boots `yarn dev` (NODE_ENV=development) by default, so the
  // standard CI flow still gets mock mode from CI=true alone.
  return process.env.SKIP_LLM_E2E === 'true' ||
    (process.env.CI === 'true' && process.env.NODE_ENV !== 'production')
}

// Deterministic plain-text mock: a plausible Swedish application
// email. Deliberately passes every generator guard (length > 80,
// no `[placeholders]`, no PROMPT_ECHO signature, matches
// /Hej|Med vänliga hälsningar|annons/ so the onboarding-email-preview
// E2E assertion holds).
const LLM_MOCK_TEXT =
  'Hej,\n\n' +
  'Jag såg er annons för tjänsten och vill gärna skicka in min ansökan. ' +
  'Jag har arbetat i team och levererat resultat under flera år, och jag ser fram emot att bidra till ert företag.\n\n' +
  'Jag bifogar mitt CV och personliga brev.\n\n' +
  'Med vänliga hälsningar,\n' +
  'Kandidaten'

// Deterministic JSON mock for lib/cv-extract.js's strict-JSON prompt
// (the route's review panel is optional — this just keeps the
// aiExtracted contract exercised instead of returning parse garbage).
const LLM_MOCK_CV_EXTRACT_JSON = JSON.stringify({
  skills: ['React', 'TypeScript', 'Next.js'],
  experience: 'Medior',
  yearsExperience: 5,
  currentJobTitle: 'Frontendutvecklare',
  currentOrganization: 'Acme AB',
  education: 'Civilingenjör Datateknik',
  summary: 'Frontendutvecklare med 5+ års erfarenhet av React och TypeScript.',
})

/**
 * Deterministic mock of the OpenAI chat-completions wire shape
 * (`{ choices: [{ message: { content } }] }`) — the only field the
 * generators read. Prompt-aware: the cv-extract prompt (`CV-TEXT:`
 * … `JSON:`) gets valid JSON matching its schema; every other
 * surface (email body, cover letter, answers, CV enhance) gets the
 * Swedish application-email text above. Exported for unit locks.
 */
export function mockChatCompletion(params) {
  const prompt = (params?.messages || []).map((m) => m?.content || '').join('\n')
  const wantsJson = /CV-TEXT:[\s\S]*JSON:/i.test(prompt)
  return {
    choices: [{ message: { content: wantsJson ? LLM_MOCK_CV_EXTRACT_JSON : LLM_MOCK_TEXT } }],
  }
}

/**
 * Round-87 — structured prompt-echo error. Thrown from the shared
 * choke point when the LLM reproduced the prompt instead of
 * generating content. `code` (and `error`, for belt-and-braces) both
 * carry `PROMPT_ECHO` so routes can branch on either. Callers that
 * soft-fail by design (email-preview) catch it and return a usable
 * fallback; routes that surface raw LLM output map it to a 503.
 */
export const PROMPT_ECHO_ERROR_CODE = 'PROMPT_ECHO'

export function promptEchoError() {
  const err = new Error('LLM returned prompt echo — retrying')
  err.code = PROMPT_ECHO_ERROR_CODE
  err.error = PROMPT_ECHO_ERROR_CODE
  return err
}

/**
 * OpenAI chat-completions call that retries the provider's fallback
 * model chain on MODEL-LEVEL rejections only. `params` may already
 * carry `model` (e.g. `provider.model`) — it is overridden per
 * attempt with each chain entry, so existing call sites only need to
 * swap `client.chat.completions.create(` for `createChatWithFallback(`.
 * Non-model errors rethrow unchanged so the caller's try/catch →
 * rule-based fallback semantics are preserved byte-for-byte.
 *
 * Round-87 — two additions at this single choke point:
 *   • E2E mock mode (SKIP_LLM_E2E / CI) short-circuits before any
 *     network call.
 *   • A successful response whose content echoes the prompt throws
 *     a PROMPT_ECHO error — EVERY text-generation surface funnels
 *     through here (cover letter, answers, adaptive answers, email
 *     body, generateText → cv-extract / cv-enhance), so one guard
 *     protects them all.
 */
async function createChatWithFallback(params) {
  if (isLlmMockMode()) {
    console.warn(
      '[E2E] Groq call mocked — ' +
      (process.env.SKIP_LLM_E2E === 'true' ? 'SKIP_LLM_E2E active' : 'CI=true active'),
    )
    return mockChatCompletion(params)
  }
  const models = textModelChainForProvider(provider.name, provider.model)
  let lastErr = null
  for (const model of models) {
    try {
      const response = await client.chat.completions.create({ ...params, model })
      // Round-87 — prompt-echo guard. The response content is
      // checked BEFORE it reaches any generator so an echo can
      // never be surfaced to a job-seeker (or pass a generator's
      // length/placeholder guards). Throw inside the try so the
      // existing rethrow path below propagates it with its code
      // intact — callers decide: soft-fail (email-preview) or 503
      // (routes that surface LLM output).
      const content = response?.choices?.[0]?.message?.content
      if (content && isPromptEcho(content)) {
        throw promptEchoError()
      }
      return response
    } catch (err) {
      lastErr = err
      const msg = String(err?.message || err || '')
      if (isModelLevelError(msg) && models.length > 1) {
        console.warn(`[groq] text model ${model} rejected (${msg}) — trying next in chain`)
        continue
      }
      // Round-86 — daily-token-quota (TPD) exhaustion is an OPERATOR
      // alert, not a transient blip: warn loudly with the actual
      // numbers so a support log line explains the streak of
      // fallback-template responses without grepping for the raw 429.
      // The pre-Round-86 code rethrew silently and the caller's
      // generic `console.error('[groq] LLM error:', error.message)`
      // buried it — the Round-86 onboarding tester saw "502" and had
      // no idea the Groq daily quota was 99.9% spent.
      if (isTpdQuotaError(msg)) {
        const quota = parseTpdQuota(msg)
        console.warn(
          `[groq] ⚠ TPD QUOTA EXHAUSTED — daily token limit reached. ${quota ? `Used ${quota.used}/${quota.limit} (${quota.percent}%). ` : ''}AI generation degrades to the rule-based fallback until the daily reset. Upgrade the Groq tier at https://console.groq.com/settings/billing or wait. Raw: ${msg.slice(0, 300)}`,
        )
      }
      throw err
    }
  }
  // All models rejected at the model level — propagate the last error
  // so the caller's catch runs the rule-based fallback.
  throw lastErr
}

const provider = pickProvider()

// ---- Round-80 followup — model decommission schedule ----
//
// Known provider decommission dates (published schedules). Startup
// warns when the CONFIGURED primary model is within 30 days of its
// shutdown so an operator can swap before the 400s start. The
// TEXT_MODELS retry chain is the safety net; this warning is the
// tripwire that surfaces the deadline BEFORE it bites. Keep dates as
// ISO strings (YYYY-MM-DD).
const MODEL_DECOMMISSION_DATES = {
  // Groq published deprecation schedule: llama-3.3-70b-versatile is
  // being retired 2026-08-16. Removed from the groq text chain on
  // 2026-08-02 (primary is now qwen/qwen3.6-27b); the entry stays so
  // an operator who re-pins the old model via an env override still
  // gets the warning.
  'llama-3.3-70b-versatile': '2026-08-16',
}

const DECOMMISSION_WARN_DAYS = 30

/**
 * Days until a model's known decommission date (ceil, negative if
 * already past), or `null` when the model has no scheduled date.
 * Exported so unit tests can lock the tripwire arithmetic.
 */
export function daysUntilDecommission(model) {
  const date = MODEL_DECOMMISSION_DATES[model]
  if (!date) return null
  const ms = new Date(`${date}T00:00:00Z`).getTime() - Date.now()
  return Math.ceil(ms / 86_400_000)
}

// Provider-load logs are gated behind NODE_ENV so production cold starts
// don't leak provider/model choices into support / log-aggregation
// dashboards. The 'no key configured' warning is louder because it's the
// first signal that the LLM is silently defaulting to the rule-based
// fallback — that branch needs to be surfaced at every startup.
if (!provider) {
  console.warn(
    '[groq] no LLM API key configured (set GROQ_API_KEY, OPENAI_API_KEY, EMERGENT_LLM_KEY, or OPENROUTER_API_KEY). ' +
    'Cover-letter generation will fall back to the rule-based template.',
  )
} else if (process.env.NODE_ENV !== 'production') {
  console.log(`[groq] using provider=${provider.name} model=${provider.model}`)
}

// Round-80 followup — decommission tripwire. Warns in ALL envs
// (production included): a primary model inside 30 days of its
// published shutdown is an operational deadline, not a debug log.
// Deliberate exception to the NODE_ENV-gating convention above:
// an imminent outage trumps log-hygiene, and the "no key" warning
// already fires in production too.
if (provider) {
  const days = daysUntilDecommission(provider.model)
  if (days !== null && days <= DECOMMISSION_WARN_DAYS) {
    console.warn(
      `[groq] WARNING: primary model ${provider.model} is scheduled for decommission in ${Math.max(days, 0)} day(s) — swap the model before it starts returning 400s.`,
    )
  }
}

// ---- Round-49 fix — PROMPT_CV_CHAR_CAP at module scope ----
//
// The pre-fix shape of this file declared `PROMPT_CV_CHAR_CAP`
// locally INSIDE `normaliseProfile()`. That was invisible to the
// prompt builders (`generateCoverLetter()` + `generateEmailBody()`)
// which read the same constant at module scope during the
// `const prompt = [...].join('\n')` step.
//
// For any user with a non-empty `profile.cvSummary`, the prompt
// array contains:
//
//   p.cvSummary ? '\n§CV-INNEHÅLL [...]§\n' +
//     p.cvSummary.slice(0, PROMPT_CV_CHAR_CAP) + '\n' +
//     '§SLUT PÅ CV-INNEHÅLL§' : '',
//
// which evaluates synchronously BEFORE the LLM client's try/catch.
// `PROMPT_CV_CHAR_CAP` resolved to a ReferenceError, the throw
// bypassed the LLM fallback branch, and the route's outer
// try/catch surfaced a generic 500 — visible on the hosted Emergent
// preview at /api/email-preview + /api/extension/email-body + (to a
// lesser extent) /api/apply-now, all of which set the user's
// profile.cvSummary before invoking the LLM.
//
// The fix lifts the const to module scope so all three call sites
// share one definition. The value (5 000 chars) is unchanged —
// Round-46 / Bug 2 deliberately settled on this cap because it
// fits a one-page CV summary section while crowding the LLM prompt
// back to the structural-instructions zone if the CV is longer.
const PROMPT_CV_CHAR_CAP = 5_000
const client = provider
  ? new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL })
  : null

/**
 * Maps the profile shape sent by callers (see app/api/[[...path]]/route.js
 * /api/apply-now -> generateCoverLetter({ ... })) into a normalised object
 * the prompt can read. The historical prompt assumed field names
 * `name` / `experienceLevel` / `desiredTitles` that don't actually exist
 * on the stored profile - those fields would always come through as
 * empty/undefined. This adapter turns the real shape (`fullName`,
 * `experience`, `jobTitles`, `locations`, ...) into the same prompt without
 * losing fidelity. Old callers passing the legacy shape still work
 * because every lookup has a default.
 *
 * CV text resolution — the settings page now lets the user upload a
 * PDF/DOCX file that gets parsed server-side and stored as `cvText`.
 * The prompt prefers `cvText` (the rich, full-CV body) and only falls
 * back to `cvSummary` (the manual short summary) if no file was ever
 * uploaded. We also cap the bytes that the LLM actually sees — sending
 * a 20KB CV verbatim into the prompt would crowd out the system
 * instructions and cause the Llama model to drift off-task. 5 000
 * characters comfortably fits the typical 1-page CV summary section.
 */
function normaliseProfile(profile = {}) {
  const jobTitles = Array.isArray(profile.jobTitles)
    ? profile.jobTitles.join(', ')
    : (profile.desiredTitles || '')
  const locations = Array.isArray(profile.locations)
    ? profile.locations.join(', ')
    : (typeof profile.locations === 'string' ? profile.locations : 'Sverige')
  // Pick the richer source. cvText wins; if absent, cvSummary is the
  // user's own hand-written fallback (still respected even if a file
  // was uploaded earlier).
  const sourceCv = (profile.cvText && profile.cvText.trim()) || (profile.cvSummary && profile.cvSummary.trim()) || ''
  const cvForPrompt = sourceCv.length > PROMPT_CV_CHAR_CAP
    ? sourceCv.slice(0, PROMPT_CV_CHAR_CAP) + '\n[…truncated for prompt fit]'
    : sourceCv
  return {
    fullName: profile.fullName || profile.name || 'Kandidaten',
    experience: profile.experience || profile.experienceLevel || 'medior',
    jobTitles,
    locations,
    salaryMin: profile.salaryMin,
    workPreference: profile.workPreference,
    employmentType: profile.employmentType,
    industriesToAvoid: Array.isArray(profile.industriesToAvoid)
      ? profile.industriesToAvoid.join(', ')
      : '',
    cvSummary: cvForPrompt,
  }
}

/**
 * Resolve the style preference for a given call. Looks up
 * `profile.stylePreference` (the canonical storage location) and
 * falls back to the default ('lagom') if missing or unknown. This
 * is the SINGLE gate the prompt builders use — the rest of the
 * file just calls `getStyleBlock(profile)` and appends the result.
 *
 * Round-35: new function. Centralises the style lookup so the three
 * prompt builders (generateCoverLetter, generateAnswer,
 * generateAdaptiveAnswer) all read from the same place.
 */
function getStyleBlock(profile) {
  const preset = resolveStylePreset(profile?.stylePreference)
  return preset.prompt
}

async function generateCoverLetter({ jobTitle, company, profile } = {}) {
  const p = normaliseProfile(profile)
  const styleBlock = getStyleBlock(profile)

  // Round-46 / Bug 2 — explicit CV-reference enforcement. The
  // pre-fix prompt passively listed `CV-sammanfattning: <text>` but
  // never commanded the LLM to USE it. Output was a generic
  // "Min erfarenhet inom X..." letter with no concrete references
  // — the user reported "Generic, no reference to CV specifics".
  //
  // The fix adds an enumerated Rules block at the end of the prompt
  // with an explicit absolute directive ("DU MÅSTE referera till 2–3
  // specifika saker") plus two bonus regex-shaped instructions that
  // match how Groq's Llama-3.3-70b interprets lists. Trailing
  // absolute rules bias the model harder than the same directive
  // buried mid-prompt — Round-46 user test confirmed the response
  // starts with a real concrete reference (company name, technology,
  // or project) within the first 30 words.
  const cvIsShort = !p.cvSummary || p.cvSummary.length < 500
  const prompt = [
    `Du är en svensk jobbansökningsexpert. Skriv ett personligt brev på svenska för följande specifika jobb:`,
    ``,
    `Företag: ${company}`,
    `Titel: ${jobTitle}`,
    `Ort: ${p.locations}`,
    ``,
    `Kandidatens profil:`,
    `- Namn: ${p.fullName}`,
    `- Erfarenhetsnivå: ${p.experience}`,
    `- Önskade jobbtitlar: ${p.jobTitles || 'relevanta'}`,
    `- Arbetsform: ${p.workPreference || 'flexibel'}`,
    `- Anställningstyp: ${p.employmentType || 'heltid'}`,
    `- Minimilön: ${p.salaryMin ? p.salaryMin + ' kr/mån' : 'ingen specifik'}`,
    `- Branscher att undvika: ${p.industriesToAvoid || 'ingen specifik'}`,
    p.cvSummary ? `- CV-sammanfattning: ${p.cvSummary}` : '',
    // Round-46 / Bug 2 — second-order CV context for the LLM. If
    // cvSummary exists, surface a §CV-INNEHÅLL § marker so the model
    // knows to mine THIS specific text for concrete references.
    // This is the structural change the previous prompt was
    // missing — without it the LLM defaults to glowing generalities.
    p.cvSummary ? '\n§CV-INNEHÅLL (referenser att välja från)§\n' +
      p.cvSummary.slice(0, PROMPT_CV_CHAR_CAP) + '\n' +
      '§SLUT PÅ CV-INNEHÅLL§' : '',
    '',
    // Round-35 (Part 3 — Answer Diversity): inject the user's
    // selected style modifier. This is the only place in the prompt
    // builder where the style affects the output. The `styleBlock`
    // string is the verbatim `prompt` field of the resolved preset
    // (see lib/style-presets.mjs). Unknown / null / undefined
    // values collapse to the default 'lagom' preset via
    // resolveStylePreset, so the worst-case regression is "the
    // user doesn't get their custom voice" — never a broken prompt.
    `Skrivstil: ${styleBlock}`,
    '',
    // Round-46 / Bug 2 — Hard CV-reference rules. These four lines
    // are the prompt contract; they MUST remain in this exact order
    // because Groq Llama-3 weights recent tokens (an "anchor + list"
    // layout). The first rule is the absolute directive, the next
    // two are validity gates, the fourth is the closing signature.
    'Regler (ABSOLUTA):',
    // 2-3 concrete references — the user-named spec. Bumping to
    // 4-5 wasn't chosen because three gives the LLM room to pick
    // the most relevant from a long CV while still meeting the
    // "concrete" bar (4-5 forces padding — risk of repetition).
    '1. DU MÅSTE referera till 2–3 specifika saker från CV-innehållet ovan (t.ex. tekniknamn, projekt, företagsnamn, årtal, certifieringar).',
    '2. Varje referens MÅSTE kopplas till rollen eller företaget — aldrig bara nämnas i förbigående.',
    '3. ALDRIG skriv generiska fraser som "min erfarenhet inom X", "jag är en bra kandidat" eller "min bakgrund inom branschen" utan konkret backup från CV:t.',
    '4. Om CV-innehållet är tomt eller för generiskt: skriv ett märkbart kortare brev och var ärlig om att du inte kan gå in på detaljer.',
    // Round-51 / Bug 2+3 followup — relevance filter + career-transition
    // handling. The pre-fix prompt forced a 2–3 concrete CV reference for
    // every application, which meant a frontend-dev CV got hard-wired into
    // a warehouse job's cover letter ("React, TypeScript, Node.js,
    // Spotify, Klarna, Docker, AWS"). That made the email look spammy
    // and obvious-AI. The new rules below tell the LLM to (a) ONLY
    // reference CV items that are directly relevant OR transferable,
    // (b) acknowledge career transitions honestly and focus on
    // transferable skills instead of forcing a fit, and (c) never
    // claim direct experience in the target industry unless it
    // genuinely exists. The target industry is deduced from jobTitle +
    // company + jobDescription (when the caller supplied one — not all
    // routes do). Rules 5–7 are intentionally placed AFTER the existing
    // rules 1–4 so the reader sees the structural rules first and the
    // honesty/relevance guards as final filters the LLM must obey before
    // producing any CV citation.
    '5. RELEVANSFILTER: Identifiera bransch + roll utifrån jobbtitel + företaget. Jämför med kandidatens CV (ovan) och referera ENDAST erfarenheter som är direkt relevanta för rollen — ELLER tydligt överförbara (problemlösning, teamwork, struktur, att snabbt sätta sig in i nya system).',
    '6. Om kandidatens bakgrund är i en HELT ANNAN bransch än jobbets: var ärlig om karriärväxlingen, fokusera på överförbara färdigheter, och visa motivation för den nya branschen. NÄMN ALDRIG orelaterade tekniska detaljer (t.ex. React för ett lagerjobb, eller en specifik klinikprocedur för en administrativ tjänst).',
    '7. Hitta ALDRIG på kopplingar mellan orelaterade fält ("min React-erfarenhet är relevant för terminalarbete"). Ett personligt brev som känns AI-genererat eller påtvingat skadar användarens chanser mer än ett ärligt och konkret brev.',
    cvIsShort ? 'OBS: Kandidatens CV är kort (< 500 tecken) — skriv ärligt om att specifika erfarenheter saknas och fokusera på motivation och lärvilja istället.' : '',
    // Round-56 / Bug 3 ACTUAL FIX — runtime cross-industry
    // detection. The pre-Round-56 prompt had rule 6 ("Om
    // kandidatens bakgrund är i en HELT ANNAN bransch...") as
    // a NEGATIVE directive, but the LLM had to figure out the
    // mismatch on its own. detectIndustryMismatch() runs the
    // ats-keyword overlap test before the prompt is built; when
    // a real cross-industry gap is detected, the prompt gets
    // one POSITIVE "Cross-industry transferable skills" section
    // that names the canonical 5 transferable skills
    // (problemlösning, teamwork, struktur, snabb inlärning,
    // kommunikation) and tells the model to lean on them. The
    // section is appended AFTER the existing rules 1–7 so the
    // structural rules read first and the runtime hint is the
    // final "this is a cross-industry app" flag. When
    // detectIndustryMismatch returns mismatch=false (the
    // common case), the section is not appended and the prompt
    // is byte-identical to the pre-Round-56 prompt.
    (() => {
      const m = detectIndustryMismatch({
        cvText: pickCvText(profile),
        jobDescription: '',
        jobTitle: jobTitle || '',
        company: company || '',
      })
      return m && m.mismatch ? buildTransferableSkillsSection() : ''
    })(),
    `Skriv ett professionellt personligt brev (max 220 ord) på svenska. Hälsa "Hej ${company},", använd kandidatens riktiga namn och avsluta med det. Inga rubriker, inget datum, ingen adressrad. Inga platshållare som [Namn] eller [Företag].`,
  ].join('\n')

  if (client) {
    try {
      const response = await createChatWithFallback({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 400,
      })
      const text = response?.choices?.[0]?.message?.content
      if (text && text.length > 60 && !containsPlaceholder(text)) {
        // 2026-08-02 (Bug 4): strip <think>…</think> reasoning traces
        // qwen emits (they were leaking into the dashboard modal),
        // then stray code fences the LLM sometimes wraps its output in.
        return stripReasoningTraces(text)
          .replace(/^```[a-z]*\n/i, '').replace(/\n```\s*$/i, '').trim()
      }
      // Empty / placeholder-laden response - fall through to the rule-based
      // safe default so the user always sees *something* presentable.
      console.warn('[groq] response looked empty or templated; using fallback')
      return fallbackCoverLetter({ jobTitle, company, profile: p })
    } catch (error) {
      // Round-87 — a prompt-echo must NOT be masked by the rule-based
      // fallback: the route maps it to a retryable 503 so the user
      // knows the AI is degraded (vs silently receiving a template).
      if (error?.code === PROMPT_ECHO_ERROR_CODE) throw error
      console.error('[groq] LLM error:', error.message)
      return fallbackCoverLetter({ jobTitle, company, profile: p })
    }
  }
  // No key configured - fall through directly.
  return fallbackCoverLetter({ jobTitle, company, profile: p })
}

/**
 * Generate a short Swedish open-ended answer for the extension's
 * motivation-class textareas (whyThisCompany / whyThisRole /
 * strengths / weaknesses / challenge). Mirrors generateCoverLetter's
 * model + normaliseProfile flow so the cron doesn't have to choose
 * between two LLM caches. Returns a `source` discriminator so the
 * extension can show different toasts for AI vs fallback answers.
 *
 * Rate-limit / cost rationale: the only callers are the content
 * script's fill loop, which is gated behind the dashboard's
 * per-token rate limit in /api/extension/answer. We deliberately
 * keep max_tokens low (180 ≈ 2-3 sentences) so a hot answering
 * loop doesn't burn the LLM budget.
 */
async function generateAnswer({ question, field, profile } = {}) {
  const p = normaliseProfile(profile)
  const fieldLabel = {
    whyThisCompany: 'varför du vill jobba hos just det här företaget',
    whyThisRole: 'varför just den här rollen passar dig',
    strengths: 'dina starkaste sidor för rollen',
    weaknesses: 'en sak du vill förbättra och hur du gör det',
    challenge: 'den tuffaste utmaningen du löst och vad du lärde dig',
    availability: 'när du kan börja',
  }[field] || 'frågan'

  const styleBlock = getStyleBlock(profile)

  const prompt = [
    'Du är en svensk jobbansökningsexpert. Skriv ett kort, ärligt svar på svenska (2-3 meningar, max 220 tecken) på följande öppna fråga i en jobbansökan:',
    '',
    `Fråga: ${question || fieldLabel}`,
    `Tema: ${fieldLabel}`,
    '',
    'Använd kandidatens profil som grund:',
    `- Namn: ${p.fullName}`,
    `- Erfarenhetsnivå: ${p.experience}`,
    `- Önskade jobbtitlar: ${p.jobTitles || 'relevanta'}`,
    `- Arbetsform: ${p.workPreference || 'flexibel'}`,
    p.cvSummary ? `- CV-sammanfattning: ${p.cvSummary}` : '',
    '',
    // Round-35: same style modifier injection as generateCoverLetter.
    `Skrivstil: ${styleBlock}`,
    '',
    'Regler:',
    '- Inga rubriker, inga platshållare, inga hakparenteser.',
    '- Skriv i första person ("jag"), inte tredje person.',
    '- Håll det konkret och ärligt — hellre kort och specifikt än långt och fluffigt.',
    '- Om CV-sammanfattningen är tom, skriv ett rakt svar som fokuserar på den specifika frågan och jobbtitlarna.',
  ].filter(Boolean).join('\n')

  if (client) {
    try {
      const response = await createChatWithFallback({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 180,
      })
      const text = response?.choices?.[0]?.message?.content
      if (text && text.length > 20 && !containsPlaceholder(text)) {
        // 2026-08-02 (Bug 4): strip reasoning traces before returning.
        return {
          answer: stripReasoningTraces(text)
            .replace(/^```[a-z]*\n/i, '').replace(/\n```\s*$/i, '').trim(),
          source: provider.name,
        }
      }
      // Empty / placeholder response — fall through to the rule-based
      // default. The route still gets a real value to fill so the
      // user never sees an empty box.
      console.warn('[groq] answer response looked empty or templated; using fallback')
      return { answer: fallbackAnswer({ field, profile: p }), source: 'fallback' }
    } catch (error) {
      // Round-87 — propagate prompt-echo so the route can 503 (see
      // generateCoverLetter's comment).
      if (error?.code === PROMPT_ECHO_ERROR_CODE) throw error
      console.error('[groq] LLM error:', error.message)
      return { answer: fallbackAnswer({ field, profile: p }), source: 'fallback' }
    }
  }
  // No key configured — go straight to fallback.
  return { answer: fallbackAnswer({ field, profile: p }), source: 'fallback' }
}

/**
 * Adaptive answer for the JobbPiloten batch endpoint
 * POST /api/extension/ai-answers. Used when a form-field label
 * doesn't match any known profile key (free-text "Vad motiverar dig…"
 * on Workday, an unusual motivation-class prompt on Greenhouse, etc).
 * Pulls in the user's profile + their pre-written `profile.answers`
 * map + the job description snippet, then returns one short Swedish
 * answer per field.
 *
 * The prompt is the literal "spec" template promised in the round-3
 * product spec — keeping every clause verbatim makes the test
 * suite's "max 200 words" assertion meaningful. Adding ad-hoc
 * instructions here shifts that contract and would silently break
 * the unit tests in tests/unit/groq-prompts.test.js (when present),
 * so be deliberate when extending it.
 *
 * Language handling: the prompt enforces Swedish unless `lang` is
 * set to `'en'` (used when the host-page label is in English). The
 * extension computes `lang` via a tiny SV/EN stopword heuristic
 * before posting; this server-side branch is the fallback for the
 * case where the extension shipped without the classification helper
 * (older clients).
 *
 * Tokens budgeting: `max_tokens: 350` ≈ 200 Swedish words at the
 * Groq llama ratio (5-6 Swedish chars per token). Bumping higher
 * wastes $$ on answers that exceed the user-visible word cap.
 */
async function generateAdaptiveAnswer({
  question, label, field, profile,
  jobTitle, company, jobDescription, lang = 'sv',
} = {}) {
  const p = normaliseProfile(profile)
  const profileSummary = [
    `- Namn: ${p.fullName}`,
    `- Erfarenhetsnivå: ${p.experience}`,
    `- Önskade jobbtitlar: ${p.jobTitles || 'relevanta'}`,
    `- Arbetsform: ${p.workPreference || 'flexibel'}`,
    `- Anställningstyp: ${p.employmentType || 'heltid'}`,
    `- Minimilön: ${p.salaryMin ? p.salaryMin + ' kr/mån' : 'ingen specifik'}`,
    `- Branscher att undvika: ${p.industriesToAvoid || 'ingen specifik'}`,
    p.cvSummary ? `- CV-sammanfattning: ${p.cvSummary}` : '',
  ].filter(Boolean).join('\n')
  const userAnswersText = (profile?.answers && typeof profile.answers === 'object')
    ? Object.entries(profile.answers)
        .filter(([, v]) => v && String(v).trim())
        .slice(0, 6)
        .map(([k, v]) => `- ${k}: ${String(v).slice(0, 300)}`)
        .join('\n')
    : ''
  const userAnswersBlock = userAnswersText
    ? userAnswersText
    : '(inga förskrivna svar \u2014 basera dig endast på profilen)'
  const langRule = lang === 'en'
    ? '4. Writes in English to match an English question.'
    : '4. Is in Swedish.'
  const styleBlock = getStyleBlock(profile)
  const prompt = [
    'You are a job application assistant writing in Swedish.',
    '',
    `The user is applying for: ${jobTitle || 'rollen'} at ${company || 'f\u00f6retaget'}.`,
    '',
    'Their profile:',
    profileSummary,
    '',
    'Their pre-written answers:',
    userAnswersBlock,
    '',
    `The form question: ${label || question || 'fr\u00e5gan'}`,
    '',
    'Write a concise, professional answer (max 200 words) that:',
    '1. Uses the user\'s real experience and skills',
    '2. Adapts their pre-written answer to this specific company/role',
    '3. Sounds natural and personal, not generic',
    langRule,
    '',
    jobDescription ? `Job description (truncated):\n${String(jobDescription).slice(0, 1200)}` : '',
    '',
    // Round-35: the adaptive prompt is the one that benefits MOST
    // from the style modifier because each call is a single
    // short-form answer (the cover letter gets more weight from
    // its length). We append the style block as rule #5 so the
    // model reads the numbered rules first and the voice tweak
    // last — a subtle ordering choice that improves adherence
    // to the structural rules (the LLM sees the numbered list
    // first and the modifier after).
    '5. Adopts the user\'s selected writing voice: ' + styleBlock,
    '',
    'Return ONLY the answer text, no JSON, no markdown.',
  ].filter(Boolean).join('\n')
  if (client) {
    try {
      const response = await createChatWithFallback({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 350,
      })
      const text = response?.choices?.[0]?.message?.content
      if (text && text.length > 20 && !containsPlaceholder(text)) {
        // 2026-08-02 (Bug 4): strip reasoning traces before returning.
        return {
          answer: stripReasoningTraces(text)
            .replace(/^```[a-z]*\n/i, '').replace(/\n```\s*$/i, '').trim(),
          source: provider.name,
        }
      }
      console.warn('[groq] adaptive answer looked empty or templated; using fallback')
      return { answer: fallbackAnswer({ field, profile: p }), source: 'fallback' }
    } catch (error) {
      // Round-87 — propagate prompt-echo (batch callers map it to a
      // per-field source:'error' entry, single-field callers 503).
      if (error?.code === PROMPT_ECHO_ERROR_CODE) throw error
      console.error('[groq] adaptive LLM error:', error.message)
      return { answer: fallbackAnswer({ field, profile: p }), source: 'fallback' }
    }
  }
  return { answer: fallbackAnswer({ field, profile: p }), source: 'fallback' }
}

/**
 * Generate an AI-written email-application body for the
 * "Ansök via mejl" extension flow.
 *
 * Round-46 / Bug 1 — pre-fix the compose panel fell back to a
 * generic static template (\`COMPOSE_BODY_TEMPLATE_DEFAULT\` in
 * extension/popup.js). Users reported empty subject + body when
 * clicking "Öppna mailto:". The fix introduces a dedicated
 * AI-generated body that pulls the user's profile + their CV
 * text + the job description (when available) so a recruiter
 * sees a real cover letter, not a stock paste.
 *
 * Prompt contract (locked by
 * tests/unit/groq-email-body-prompts.test.mjs):
 *   • Begins with "Hej," (lowercase Swedish greeting)
 *   • Mentions the job title + source/källa (knappa in text from
 *     `jobDescription` when present)
 *   • References 2–3 concrete details from the candidate's
 *     CV-sammanfattning (the same absolute-must rule used in
 *     generateCoverLetter)
 *   • Includes the literal "Jag bifogar mitt CV och personliga brev."
 *     so the user never has to remember to mention the attachment
 *   • Closes with "Med vänliga hälsningar," + kandidatens namn
 *   • No placeholders, no JSON, no markdown
 *
 * Token budget: `max_tokens: 350` keeps the response under the
 * 1500-char mailto: limit on Windows/legacy clients (the
 * popup's mailto button truncates to 2000 chars anyway).
 *
 * Caller responsibility (enforced in route.js, not here): rate
 * limit per token + tier-cap so a runaway extension invocation
 * can't burn the LLM budget on a single page.
 */
async function generateEmailBody({
  jobTitle,
  company,
  jobDescription,
  profile,
  lang = 'sv',
} = {}) {
  const p = normaliseProfile(profile)
  const styleBlock = getStyleBlock(profile)
  const cvIsShort = !p.cvSummary || p.cvSummary.length < 500

  const prompt = [
    lang === 'en'
      ? 'You are a Swedish job-application expert. Write a short email-apply body in ENGLISH (or SWEDISH if the recipient\'s domain is .se) for the following job:'
      : 'Du är en svensk jobbansökningsexpert. Skriv ett kort e-postutkast på svenska som klistras in i användarens e-postklient (Outlook/Gmail/Apple Mail):',
    '',
    `Företag: ${company || 'företaget'}`,
    `Titel: ${jobTitle || 'tjänsten'}`,
    `Ort: ${p.locations}`,
    '',
    'Kandidatens profil:',
    `- Namn: ${p.fullName}`,
    `- Erfarenhetsnivå: ${p.experience}`,
    `- Önskade jobbtitlar: ${p.jobTitles || 'relevanta'}`,
    `- Arbetsform: ${p.workPreference || 'flexibel'}`,
    p.cvSummary ? `- CV-sammanfattning: ${p.cvSummary}` : '',
    // Round-46 / Bug 1 — second-order CV context for the LLM.
    // Same §CV-INNEHÅLL § marker used by generateCoverLetter so
    // the model knows to mine THIS specific text for concrete
    // references (technology names, project names, past
    // employers) rather than producing glowing generalities.
    p.cvSummary ? '\n§CV-INNEHÅLL (referenser att välja från)§\n' +
      p.cvSummary.slice(0, PROMPT_CV_CHAR_CAP) + '\n' +
      '§SLUT PÅ CV-INNEHÅLL§' : '',
    jobDescription ? `Jobbannons (utdrag, max 1200 tecken):\n${String(jobDescription).slice(0, 1200)}` : '',
    '',
    // Style modifier injection (Round-35 contract — mirror of
    // generateCoverLetter + generateAnswer styleBlock).
    `Skrivstil: ${styleBlock}`,
    '',
    // Round-46 / Bug 1 — REQUIRED structural clauses. Each
    // literal phrase is locked by the test suite. The LLM is
    // instructed to add the CV+cover-letter attachment line UNLESS
    // the user has explicitly toggled the cover-letter accompanying
    // setting off (none today, so always true).
    'Strukturella krav (OBLIGATORISKA):',
    '1. Inled med "Hej," följt av en kort rad (max 1 mening) som refererar till annonsen, t.ex. "Jag såg er annons för ' + (jobTitle || 'tjänsten') + ' på ' + (company || 'er hemsida') + '."',
    '2. Brödtexten MÅSTE referera till 2–3 specifika saker från kandidatens CV (teknik, projekt, företagsnamn).',
    '3. Inkludera den EXAKTA meningen "Jag bifogar mitt CV och personliga brev." på en egen rad.',
    '4. Avsluta med EXAKT "Med vänliga hälsningar," följt av en ny rad och kandidatens fullständiga namn.',
    '5. Ingen markdown, inga rubriker, inga platshållare i hakparenteser.',
    // Round-51 / Bug 2+3 followup — same relevance + career-transition
    // rules as generateCoverLetter above. The email body is even more
    // dangerous when forced cross-industry references slip through — a
    // recruiter reading "Spotify + Klarna + Docker" on a warehouse role
    // sees a candidate who clearly never read the posting. The LLM
    // reads company + jobTitle + jobDescription to decide which
    // industry the role lives in. The rules are appended after the
    // existing rules 1–5 (anchored by tests/unit/groq-email-body-prompts.test.mjs)
    // so the structural clauses land first and the honesty/relevance
    // guards close the contract.
    '6. RELEVANSFILTER: Använd ENDAST CV-ämnen som är direkt relevanta för tjänsten ELLER tydligt överförbara (problemlösning, teamwork, struktur, snabb inlärning). Hitta ALDRIG på tekniska kopplingar ("min Docker-upplevelse är relevant för lagerarbete").',
    '7. Om kandidatens bakgrund är i en HELT ANNAN bransch: var ärlig om övergången, fokusera på överförbara färdigheter och motivation för den nya branschen. NÄMN ALDRIG orelaterade tekniska detaljer.',
    cvIsShort ? 'OBS: Kandidatens CV är kort (< 500 tecken) — var ärlig om att specifika erfarenheter saknas och håll texten kompakt.' : '',
    // Round-56 / Bug 3 ACTUAL FIX — runtime cross-industry
    // detection (mirror of the cover-letter wiring above). The
    // email body has the same mismatch risk as the cover
    // letter: a frontend CV submitted for a warehouse job
    // would happily produce "Spotify + Klarna + Docker" if the
    // model doesn't know to lean on transferable skills. The
    // email body has richer job-side context (jobDescription
    // is in scope here) so the heuristic gets to use the
    // description as its primary source — this is more
    // sensitive than the cover-letter path which only sees
    // title+company. When the heuristic returns mismatch=true,
    // the same Swedish transferable-skills section is appended
    // to the prompt. When false, the prompt is byte-identical
    // to pre-Round-56.
    (() => {
      const m = detectIndustryMismatch({
        cvText: pickCvText(profile),
        jobDescription: jobDescription || '',
        jobTitle: jobTitle || '',
        company: company || '',
      })
      return m && m.mismatch ? buildTransferableSkillsSection() : ''
    })(),
    'Skriv nu mejlet.',
  ].filter(Boolean).join('\n')

  if (client) {
    try {
      const response = await createChatWithFallback({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
        max_tokens: 350,
      })
      let text = response?.choices?.[0]?.message?.content
      if (text && text.length > 80 && !containsPlaceholder(text) && !isPromptEcho(text)) {
        // Round-86 followup: the added isPromptEcho guard rejects
        // prompt-reproducing output so a degraded model can never
        // surface the raw prompt as the email body — fall through
        // to the rule-based fallback instead (the observed Round-86
        // full-suite E2E flake).
        // 2026-08-02 (Bug 4): strip <think>…</think> reasoning traces
        // qwen emits, then stray code fences the LLM sometimes wraps
        // its output in.
        text = stripReasoningTraces(text)
          .replace(/^```[a-z]*\n/i, '').replace(/\n```\s*$/i, '').trim()
        // Defensive: if the LLM dropped the required CV-attachment
        // line, insert it just before the closing signature so
        // recruiters always hear about the attached CV. The "Med
        // vänliga hälsningar" closing line is the anchor.
        if (!/Jag bifogar mitt CV och personliga brev\./i.test(text)) {
          text = text.replace(
            /(Med vänliga hälsningar,)/i,
            'Jag bifogar mitt CV och personliga brev.\n\n$1',
          )
        }
        return {
          body: text,
          source: provider.name,
          cvShortWarning: cvIsShort,
        }
      }
      console.warn('[groq] email body response looked empty or templated; using fallback')
      return {
        body: fallbackEmailBody({ jobTitle, company, profile: p }),
        source: 'fallback',
        cvShortWarning: cvIsShort,
      }
    } catch (error) {
      // Round-87 — propagate prompt-echo. NOTE: email-preview's own
      // catch-all still soft-fails it to the fallback body (Round-86
      // contract: the preview surface must never error), while the
      // email-draft / extension-email-body routes map it to a 503.
      if (error?.code === PROMPT_ECHO_ERROR_CODE) throw error
      console.error('[groq] email body LLM error:', error.message)
      return {
        body: fallbackEmailBody({ jobTitle, company, profile: p }),
        source: 'fallback',
        cvShortWarning: cvIsShort,
      }
    }
  }
  // No key configured — straight to fallback so the user always
  // sees a presentable body, never an empty textarea.
  return {
    body: fallbackEmailBody({ jobTitle, company, profile: p }),
    source: 'fallback',
    cvShortWarning: cvIsShort,
  }
}

/**
 * Heuristic that distinguishes an LLM-emitted unfilled placeholder
 * (e.g. `[Namn]`, `[Företag]`, `[Company Name]`) from legitimate
 * square-bracket usage in Swedish text (legal references like
 * `[1]`, year citations like `[Smith 2020]`, advisory brackets
 * like `[sic!]`). Returns `true` ONLY when the bracketed content
 * looks like a real placeholder name.
 *
 * Implementation (Round-46.2 polish, replaces `text.includes('[')`):
 *   1. Cheap pre-check: if the text has no `[`, return false.
 *   2. Extract every bracketed substring of 2-40 chars (excludes
 *      single-char legal refs like `[1]`, `[a]`).
 *   3. Skip any bracket containing digits (year citations
 *      `[2020]`, numbered refs `[1]`, math `[1+2]`).
 *   4. Match the lowercased content against a curated whitelist of
 *      common Swedish + English placeholder nouns. A single
 *      keyword hit anywhere in the bracketed content rejects the
 *      entire generation so the LLM never leaks a placeholder to
 *      the recruiter.
 *
 * False-positive rate: ~0% in practice (the keyword whitelist
 * covers only dedicated placeholder nouns; Swedish legal/citation
 * usage never contains them).
 *
 * False-negative rate: low. Llama-3 / GPT-4o cluster heavily around
 * the canonical `[Namn]/[Företag]/[Datum]/[Company Name]` set;
 * exotic placeholders like `[Länk till portfolio]` would slip
 * through. Acceptable trade-off for the soft-launch tier.
 */
/**
 * 2026-08-02 (Bug 4 — AI cover-letter modal leaks <think> reasoning):
 * strip reasoning traces the LLM sometimes emits inline. qwen/qwen3.6-27b
 * (now the Groq primary) has been observed prefixing/embedding
 * `<think>…</think>` blocks in its chat-completions output — the raw
 * trace showed up verbatim in the dashboard's "Personligt brev
 * (AI-genererat)" modal and in saved-answer memory. Mirrors the
 * truncation-safe strip in lib/cv-ocr.js:
 *   1. removes every CLOSED <think>…</think> block;
 *   2. if the trace was cut off by max_tokens (an unclosed <think> has
 *      no closing tag), strips from a leading <think> up to the first
 *      blank line so the user never sees reasoning scaffolding.
 * Returns the cleaned text (non-destructive for output with no trace).
 */
function stripReasoningTraces(text) {
  if (!text || typeof text !== 'string') return text
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*<think>[\s\S]*?\n\n/i, '')
}

/**
 * Round-86 followup (2026-08-04) — prompt-echo detector. A degraded
 * LLM (weak fallback model, misconfigured proxy) sometimes answers the
 * email-body prompt by REPRODUCING the prompt itself (observed verbatim
 * as the onboarding preview body in the Round-86 full-suite E2E run:
 * "1. **Analyze User Input:** ... Write a short email draft in
 * Swedish..."). Such output passes the length + placeholder guards
 * (long, bracket-free) but is useless as an application email. This
 * predicate rejects any generation that quotes the prompt's own
 * instruction scaffolding so callers degrade to the rule-based
 * fallback instead of surfacing the raw prompt to a job-seeker.
 *
 * Signatures are the prompt's meta-instruction phrases (role line,
 * task line, structural header, CV marker) — none of which ever
 * appear in a real application email. The 80-char floor keeps tiny
 * inputs off the regexes (they'd never be emails anyway).
 * Exported so unit tests can lock the behaviour without a network
 * call.
 */
const PROMPT_ECHO_SIGNATURES = [
  'Analyze User Input',
  'Du är en svensk jobbansökningsexpert',
  'Skriv ett kort e-postutkast',
  '§CV-INNEHÅLL',
  'Strukturella krav (OBLIGATORISKA)',
]

export function isPromptEcho(text) {
  const s = String(text || '')
  if (s.length < 80) return false
  return PROMPT_ECHO_SIGNATURES.some((sig) => s.includes(sig))
}

function containsPlaceholder(text) {
  if (!text || !text.includes('[')) return false
  const BRACKETS = /\[([^\]]{2,40})\]/g
  const TRIGGERS = [
    // Swedish
    'namn', 'företag', 'foretag', 'datum', 'titel', 'adress',
    'epost', 'e-post', 'telefon', 'ort', 'stad', 'plats',
    // English fallbacks (Llama-3 occasionally slips in EN placeholders)
    'company', 'date', 'title', 'address', 'name', 'your',
  ]
  let m
  while ((m = BRACKETS.exec(text)) !== null) {
    const content = String(m[1] || '').toLowerCase()
    if (/\d/.test(content)) continue
    if (TRIGGERS.some((kw) => content.includes(kw))) return true
  }
  return false
}

/**
 * Rule-based fallback that the no-key / LLM-error branch falls
 * back to. Mirrors the same shape Swedish recruiters expect:
 * greeting + job-mention + CV attachment line + closing signature.
 * Useful as a deterministic test fixture too (no LLM dependency).
 */
function fallbackEmailBody({ jobTitle, company, profile } = {}) {
  const name = (profile && profile.fullName) || 'Kandidaten'
  const titlePart = jobTitle ? `för ${jobTitle}` : 'för tjänsten'
  return [
    'Hej,',
    '',
    `Jag såg er annons ${titlePart}${company ? ` på ${company}` : ''} och vill gärna skicka in min ansökan via e-post.`,
    '',
    'Jag bifogar mitt CV och personliga brev.',
    '',
    'Tack för att ni tog er tid — jag ser fram emot att höra från er.',
    '',
    'Med vänliga hälsningar,',
    name,
  ].join('\n')
}

/**
 * Concurrency-bounded batch wrapper around generateAdaptiveAnswer.
 * The /api/extension/ai-answers route may pass up to 12 fields in a
 * single POST. Calling Groq 12× in parallel would queue behind a
 * single TCP connection per host AND compound the rate-limit
 * pressure. `concurrency = 3` matches the existing single-field
 * POOL in extension/content.js's fetchAIAnswers so the two paths
 * look the same to the LLM gateway.
 *
 * Failure mode: every individual call is wrapped in try/catch — a
 * per-field Groq 429 / network blip MUST NOT crash the whole batch.
 * Failing fields get `{ answer: '', source: 'error' }` so the route
 * can drop them from the response without breaking the remaining
 * answers.
 */
async function generateBatchAnswers({
  fields, profile, jobTitle, company, jobDescription, lang = 'sv', concurrency = 3,
} = {}) {
  if (!Array.isArray(fields) || fields.length === 0) return {}
  const out = {}
  const workerCount = Math.max(1, Math.min(concurrency, fields.length))
  let cursor = 0
  const tasks = []
  for (let w = 0; w < workerCount; w++) {
    tasks.push((async () => {
      while (true) {
        const i = cursor++
        if (i >= fields.length) return
        const f = fields[i]
        try {
          out[f.id] = await generateAdaptiveAnswer({
            question: f.question || f.label || f.id,
            label: f.label,
            field: f.id,
            profile,
            jobTitle,
            company,
            jobDescription,
            lang,
          })
        } catch (err) {
          console.warn('[groq] batch failed for id=' + f.id + ': ' + (err?.message || err))
          out[f.id] = { answer: '', source: 'error' }
        }
      }
    })())
  }
  await Promise.all(tasks)
  return out
}

/**
 * Rule-based answer for the absence of an LLM key. Trims a sentence
 * from cvSummary (or composes a generic sentence from jobTitles)
 * so the user gets a real draft to edit, never an empty box.
 */
function fallbackAnswer({ field, profile } = {}) {
  const titles = (profile && profile.jobTitles) || 'relevanta områden'
  const cv = (profile && profile.cvSummary) || ''
  const firstCvSentence = cv.split(/[.!?]\s/).slice(0, 1).join(' ').trim()
  switch (field) {
    case 'whyThisCompany':
      return firstCvSentence
        ? `${firstCvSentence}. Det här företaget känns som en naturlig plats att bidra utifrån den bakgrunden.`
        : `Min erfarenhet inom ${titles} gör att jag tror mig passa bra hos er.`
    case 'whyThisRole':
      return firstCvSentence
        ? `${firstCvSentence}. Den beskrivningen matchar vad jag har byggt upp under de senaste åren.`
        : `Rollens fokus på ${titles} ligger nära det jag redan gör idag.`
    case 'strengths':
      return `Min styrka ligger i att snabbt sätta mig in i ${titles} och omsätta det i konkret leverans.`
    case 'weaknesses':
      return `Jag kan ibland vara för detaljfokuserad — jag jobbar medvetet med att stanna upp och prioritera leveransen framför perfektion.`
    case 'challenge':
      return `Den tuffaste utmaningen jag löst handlade om att strukturera om ett ${titles}-flöde — jag lärde mig att tidig avstämning med intressenter sparar veckor av omarbete.`
    case 'availability':
      return `Jag kan börja omgående efter en normal uppsägningsperiod.`
    default:
      return firstCvSentence || `Min erfarenhet inom ${titles} gör att jag passar bra för rollen.`
  }
}

/**
 * Local rule-based fallback. Kept in lib/groq.js so the import path is
 * stable even if /api/[[...path]]/route.js's seeded-application path is
 * removed later. The route file has a separate `fallbackCoverLetter`
 * that uses raw arrays (jobTitles[].join(', ')) - the two are
 * intentionally kept aligned so seeded apps read identically to live
 * generations.
 */
function fallbackCoverLetter({ jobTitle, company, profile } = {}) {
  const titles = profile && profile.jobTitles ? profile.jobTitles : 'relevanta områden'
  const location = profile && profile.locations && profile.locations !== 'Sverige'
    ? profile.locations
    : ''
  const name = profile && profile.fullName ? profile.fullName : 'Kandidaten'
  const exp = profile && profile.experience ? profile.experience : 'medior'
  const lines = [
    `Hej ${company},`,
    '',
    location
      ? `Det var med stort intresse jag såg er annons för ${jobTitle} i ${location}.`
      : `Det var med stort intresse jag såg er annons för ${jobTitle}.`,
    '',
    `Som ${exp} inom ${titles} har jag byggt en grund som passar rollens krav på erfarenhet och drivkrafter. Jag tror att mina kompetenser kan bidra till ert team och ser fram emot möjligheten att visa det i praktiken.`,
    '',
    'Tack för att ni tog er tid att läsa min ansökan - jag ser fram emot att höra från er.',
    '',
    'Med vänliga hälsningar,',
    name,
  ]
  return lines.join('\n')
}

/**
 * Generic text-completion helper used by lib/cv-enhance.js for
 * CV rewriting. Smaller surface than generateCoverLetter — no
 * profile normalisation, no style injection. Caller supplies the
 * full prompt. Returns the raw text (or '' on failure so the
 * caller's pure-fallback path is the source of truth).
 */
export async function generateText(prompt, { maxTokens = 400, temperature = 0.4 } = {}) {
  if (!client || !prompt) return ''
  try {
    const response = await createChatWithFallback({
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
    })
    const text = response?.choices?.[0]?.message?.content
    if (!text) return ''
    // 2026-08-02 (Bug 4): strip reasoning traces before returning.
    return stripReasoningTraces(text)
      .replace(/^```[a-z]*\n/i, '').replace(/\n```\s*$/i, '').trim()
  } catch (error) {
    // Round-87 — propagate prompt-echo so callers decide: cv-extract
    // / cv-enhance catch it and use their pure fallbacks (soft by
    // design), routes that surface LLM output map it to a 503.
    if (error?.code === PROMPT_ECHO_ERROR_CODE) throw error
    console.error('[groq] generateText error:', error?.message || error)
    return ''
  }
}

/**
 * Single source of truth for whether any LLM provider is configured
 * in the runtime env. Routes + UI can call this to decide whether
 * to surface a "no AI key" UX without duplicating the provider
 * precedence used by the getProvider() selection below (GROQ →
 * OPENAI → EMERGENT). Empty / whitespace-only strings are treated
 * as unset so a `GROQ_API_KEY=   ` placeholder count as MISSING.
 *
 * 2026-07-17 (Round-59 polish): centralised so app/api/upload-cv
 * /route.js and any future AI-aware route / UI surface don't drift.
 * Adding a new provider to the chain (e.g. ANTHROPIC_API_KEY) means
 * editing getProvider() AND this helper; tests/unit/groq-* lock
 * the shape so a future regression that drops a key here surfaces
 * immediately.
 */// NB: The order here MUST match the precedence in `pickProvider()`
// above (the `LLM_KEY_NAMES` array + the `LLM_PROVIDER_BY_KEY`
// table are co-located there) — both consumers pick the first
// non-empty key in declaration order. If a new provider is added
// (e.g. ANOTHER OPENAI-COMPATIBLE PROXY), update BOTH sites (extend
// the array AND add the matching factory entry) in the same patch.
// (Round-72 replaced the ANTHROPIC_API_KEY hint with the
// OpenRouter key — OpenRouter is OpenAI-compatible and proxies
// Anthropic + Llama + Mistral + many others via `vendor/model` slugs,
// so the same OpenAI SDK instance serves them all.)
export function isLlmAvailable() {
  return LLM_KEY_NAMES.some((k) => String(process.env[k] || '').trim())
}

/**
 * 2026-08-02 (CV OCR): expose the resolved provider config so
 * lib/cv-ocr.js can reuse the SAME key-priority + credentials as
 * every other LLM call (GROQ → OPENAI → EMERGENT → OPENROUTER)
 * without re-implementing the precedence chain. Returns
 * `{ name, apiKey, baseURL, model }` or `null` when no key is set.
 *
 * Vision note: the returned `model` is the provider's TEXT default
 * (e.g. qwen/qwen3.6-27b for Groq — swapped from llama-3.3-70b-versatile
 * on 2026-08-02). lib/cv-ocr.js maps it to a vision-capable model per
 * provider (qwen/qwen3.6-27b is itself multimodal; the old
 * llama-3.2-90b-vision-preview was decommissioned 2025-04-14); `name`
 * is the discriminator it switches on.
 */
export function getProviderInfo() {
  return provider
    ? {
        name: provider.name,
        apiKey: provider.apiKey,
        baseURL: provider.baseURL,
        model: provider.model,
      }
    : null
}

export {
  generateCoverLetter,
  generateAnswer,
  generateAdaptiveAnswer,
  generateBatchAnswers,
  generateEmailBody,
  fallbackEmailBody,
  containsPlaceholder,
  stripReasoningTraces,
}
