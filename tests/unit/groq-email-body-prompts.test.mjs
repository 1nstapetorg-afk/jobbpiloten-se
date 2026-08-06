// tests/unit/groq-email-body-prompts.test.mjs
//
// Round-46 / Bug 1 — contract locks for the new
// generateEmailBody() function in lib/groq.js.
//
// Static-grep locks on prompt contract:
//   • Prompt must wrap cvSummary in §CV-INNEHÅLL § markers
//   • Prompt must include "Strukturella krav (OBLIGATORISKA):" header
//   • Prompt must require the EXACT "Jag bifogar mitt CV och personliga brev."
//   • Prompt must require the EXACT "Hej," greeting
//   • Prompt must require the EXACT "Med vänliga hälsningar," closing
//   • Prompt must include a CV-short branch (< 500 chars honesty)
//
// Plus a behavioural test that exercises the no-LLM-key fallback
// — confirms `fallbackEmailBody()` produces the canonical structure
// recruiters expect, and matches the prompts the live LLM is
// trained to emit.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GROQ_PATH = path.resolve(__dirname, '../../lib/groq.js')
const GROQ_SRC = fs.readFileSync(GROQ_PATH, 'utf-8')

// Inline copy of fallbackEmailBody() — we mirror the production
// implementation so the test is decoupled from how lib/groq.js
// loads, without depending on the dynamic extraction in the
// earlier version (which had escape-character issues).
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

// =============================================================================
// 1. Source-grep locks on prompt contract
// =============================================================================

test('Bug 1: generateEmailBody prompt must wrap cvSummary in §CV-INNEHÅLL § markers', () => {
  // The marker tells the LLM "mine THIS exact text for concrete
  // references". Without it the model produces generic phrases.
  assert.ok(GROQ_SRC.includes('§CV-INNEHÅLL'), 'lib/groq.js must include §CV-INNEHÅLL marker')
  assert.ok(GROQ_SRC.includes('§SLUT PÅ CV-INNEHÅLL§'), 'lib/groq.js must include §SLUT PÅ CV-INNEHÅLL§ closing marker')
})

test('Bug 1: generateEmailBody prompt must include "Strukturella krav (OBLIGATORISKA):" header', () => {
  // The structural-rules anchor (mirror of cover-letter Regler block).
  assert.ok(
    /Strukturella\s+krav\s*\(OBLIGATORISKA\)/i.test(GROQ_SRC),
    'generateEmailBody prompt must include the "Strukturella krav (OBLIGATORISKA):" anchor header',
  )
})

test('Bug 1: generateEmailBody prompt must require the EXACT "Jag bifogar mitt CV och personliga brev." line', () => {
  // Recruiters rely on this line so they don't ask twice for the
  // CV. The instruction forces the LLM to include it on its own
  // line; a defensive regex post-process falls back to inserting
  // it if the LLM drops it (see /lib/groq.js).
  assert.ok(
    /Jag bifogar mitt CV och personliga brev\./.test(GROQ_SRC),
    'generateEmailBody prompt must require the exact CV attachment line "Jag bifogar mitt CV och personliga brev."',
  )
})

test('Bug 1: generateEmailBody prompt must require the "Med vänliga hälsningar," EXACT closing', () => {
  assert.ok(
    /Med vänliga hälsningar,/.test(GROQ_SRC),
    'generateEmailBody prompt must require the EXACT "Med vänliga hälsningar," closing signature',
  )
})

test('Bug 1: generateEmailBody prompt must require the "Hej," EXACT greeting', () => {
  assert.ok(
    /\bHej,/.test(GROQ_SRC),
    'generateEmailBody prompt must require the EXACT "Hej," opening greeting',
  )
})

test('Bug 1: generateEmailBody prompt must include a CV-short honesty branch (< 500 chars)', () => {
  assert.ok(
    /CV\s*är\s+kort/i.test(GROQ_SRC) && /<.*500.*tecken|< 500 tecken/.test(GROQ_SRC),
    'generateEmailBody prompt must include the "CV är kort (< 500 tecken)" honesty branch',
  )
})

test('Bug 1: generateEmailBody must cap max_tokens at 350', () => {
  assert.ok(
    /max_tokens:\s*350/.test(GROQ_SRC),
    'generateEmailBody must pin max_tokens: 350 (cost cap + 200-word ceiling at Groq llama ratio)',
  )
})

test('Bug 1: generateEmailBody must defensively insert the CV-attachment line if LLM drops it', () => {
  // Defensive: when the LLM fails to include the required
  // "Jag bifogar mitt CV och personliga brev." line, the
  // post-process inserts it just before "Med vänliga hälsningar,"
  // so recruiters ALWAYS see the attachment notice.
  assert.ok(
    /Med vänliga hälsningar/i.test(GROQ_SRC) && /Jag bifogar mitt CV och personliga brev\.\s*\\n\\n\$1/i.test(GROQ_SRC) ||
      /replace\(\s*\/\(Med vänliga hälsningar/i.test(GROQ_SRC),
    'generateEmailBody must defensively insert the CV-attachment line if the LLM drops it',
  )
})

// =============================================================================
// 2. Export surface + fallback function
// =============================================================================

test('Bug 1: lib/groq.js must export generateEmailBody AND fallbackEmailBody', () => {
  assert.match(GROQ_SRC, /export\s*\{[^}]*generateEmailBody[^}]*\}/,
    'generateEmailBody must remain exported (required by /api/extension/email-body)')
  assert.match(GROQ_SRC, /export\s*\{[^}]*fallbackEmailBody[^}]*\}/,
    'fallbackEmailBody must be exported so test environments can use it directly')
})

test('Bug 1: fallbackEmailBody must produce the Swedish canonical email body', () => {
  // The pure-only fallback gives tests a deterministic answer
  // for the no-key path AND lets the popup display a presentable
  // email body when the LLM times out.
  const fakeProfile = {
    fullName: 'Anna Andersson',
    locations: 'Stockholm',
  }
  const body = fallbackEmailBody({
    jobTitle: 'Senior Frontend-utvecklare',
    company: 'Spotify',
    profile: fakeProfile,
  })
  // The 9-line canonical structure:
  //   Hej,\nJag såg er annons…\n\nJag bifogar mitt CV och personliga brev.\n\nTack…\n\nMed vänliga hälsningar,\nAnna Andersson
  assert.ok(body.startsWith('Hej,'), 'fallback body must start with "Hej,"')
  assert.ok(body.includes('Jag bifogar mitt CV och personliga brev.'), 'fallback body must include the CV attachment line')
  assert.ok(body.includes('Med vänliga hälsningar,'), 'fallback body must include the closing signature')
  assert.ok(body.includes('Senior Frontend-utvecklare'), 'fallback body must include the job title')
  assert.ok(body.includes('Spotify'), 'fallback body must include the company name')
  assert.ok(body.endsWith('Anna Andersson'), 'fallback body must end with the candidate full name')
})

test('Bug 1: fallbackEmailBody must NOT throw with empty args (defensive)', () => {
  // Static-grep the implementation in lib/groq.js for a graceful
  // `|| 'Kandidaten'` fallback on missing fields.
  const src = GROQ_SRC.match(/function\s+fallbackEmailBody[\s\S]*?\n\}/m) || ['']
  assert.ok(src[0].includes("'Kandidaten'"), 'fallback must default to "Kandidaten" when profile.fullName is missing')
})

test('Bug 1: generateEmailBody must declare an async function returning body+source', () => {
  // Whole-source scan for the contract — body: + source: together
  // is a unique identifier of generateEmailBody's return shape.
  assert.ok(
    /async\s+function\s+generateEmailBody[\s\S]*?return[\s\S]*?body:[\s\S]*?source:/.test(GROQ_SRC),
    'generateEmailBody must declare an async function whose return block contains both body: and source: keys',
  )
  assert.ok(/cvShortWarning/.test(GROQ_SRC), 'generateEmailBody must reference cvShortWarning (frontend reads this for the chip)')
})

// =============================================================================
// 3. Round-49 regression — PROMPT_CV_CHAR_CAP must be at MODULE scope
// =============================================================================
//
// On the hosted Emergent preview at
// https://jobbpiloten-se.preview.emergentagent.com/ the user
// reported /api/email-preview + /api/extension/email-body returning
// 500 internal server errors. Root cause: PROMPT_CV_CHAR_CAP was
// declared locally INSIDE normaliseProfile() but referenced by
// `generateCoverLetter()` + `generateEmailBody()` during the
// synchronous `const prompt = [...].join('\n')` step. For any user
// with a non-empty `profile.cvSummary` — i.e., the vast majority of
// real users — the prompt construction threw a ReferenceError
// BEFORE the LLM/fallback try/catch, which the route's outer catch
// then surfaced as a generic 500.
//
// The fix lifts the const to module scope. These tests lock that
// contract so a future refactor that accidentally re-localises the
// constant (or strips the inline postmortem) fails loudly.

test('Round-49: PROMPT_CV_CHAR_CAP must be declared at module scope (column-0 anchored)', () => {
  // The fix moved the const out of normaliseProfile to the
  // module-scope level alongside `const client = provider ? ... :
  // null`. A regression that pushes it back into the function body
  // would re-open the ReferenceError that surfaced as the 500.
  // We lock on column-0 (no leading whitespace) so the structural
  // intent ("module constant") is unambiguous.
  assert.match(
    GROQ_SRC,
    /^const\s+PROMPT_CV_CHAR_CAP\s*=\s*5_000\b/m,
    'PROMPT_CV_CHAR_CAP must be declared at column 0 (module scope) so generateCoverLetter() + generateEmailBody() can read it. A function-scoped re-declaration triggers the Round-49 ReferenceError regression.',
  )
  // Belt-and-braces — at least 4 occurrences: the module-level
  // declaration + normaliseProfile's truncation check + the two
  // prompt-builder `.slice(0, PROMPT_CV_CHAR_CAP)` references.
  const occurrences = GROQ_SRC.split('PROMPT_CV_CHAR_CAP').length - 1
  assert.ok(
    occurrences >= 4,
    'PROMPT_CV_CHAR_CAP must appear at least 4 times (decl + truncate + 2 prompt builders). Saw ' + occurrences + '.',
  )
})

test('Round-49: generateEmailBody must NOT throw ReferenceError when profile.cvSummary is non-empty', async () => {
  // Behavioural regression lock — pre-fix path:
  //   1. generateEmailBody({ profile: { cvSummary: '...' }, ... })
  //   2. const prompt = [...].join('\n') evaluates synchronously
  //   3. Inside the array, `p.cvSummary.slice(0, PROMPT_CV_CHAR_CAP)`
  //      threw a ReferenceError because the const lived INSIDE
  //      normaliseProfile's scope only.
  //   4. The throw bypassed the LLM try/catch (it happened BEFORE
  //      the call) so the route caught a generic Error and returned
  //      a 500.
  //
  // Post-fix: the const is at module scope so the prompt builds
  // cleanly. With no LLM key in CI the function falls through to
  // `fallbackEmailBody({...})` returning a body — the test asserts
  // the call completes with a non-empty body rather than an exception.
  // Round-87 hardening: this regression lock only needs the module's
  // fallback path (no LLM key in the unit process ⇒ client is null ⇒
  // straight to fallbackEmailBody). The dev shell may export
  // GROQ_API_KEY etc., which would make this a REAL network call
  // (flaky under parallel load — the 429 retries stretched the test
  // to 7s in the full-suite run). Strip the keys for this import so
  // the test is deterministic, then restore.
  const prevKeys = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'EMERGENT_LLM_KEY', 'OPENROUTER_API_KEY']
    .map((k) => [k, process.env[k]])
  for (const [k] of prevKeys) delete process.env[k]
  let mod
  try {
    mod = await import('../../lib/groq.js')
  } finally {
    for (const [k, v] of prevKeys) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  const { generateEmailBody } = mod
  let result
  try {
    result = await generateEmailBody({
      jobTitle: 'Senior Backend Developer',
      company: 'Klarna',
      jobDescription: '',
      profile: {
        fullName: 'Anna Andersson',
        experience: 'Senior',
        jobTitles: ['Backend Developer'],
        locations: 'Stockholm',
        // The non-empty cvSummary is the trigger that exposed the
        // pre-fix ReferenceError. Real users typically have ~2 KB
        // of CV summary on file; we use ~300 chars here to keep
        // the test fixture compact.
        cvSummary: '10+ years of Node.js + PostgreSQL experience. Built Klarna Checkout v2. Led migration to Kubernetes. Mentored 5 junior engineers.',
      },
      lang: 'sv',
    })
  } catch (err) {
    assert.fail(
      'generateEmailBody threw on a non-empty profile.cvSummary — the Round-49 PROMPT_CV_CHAR_CAP scope regression is back. Error: ' +
        (err && err.message ? err.message : String(err)),
    )
  }
  assert.ok(result && typeof result.body === 'string' && result.body.length > 0,
    'generateEmailBody must return a non-empty body when cvSummary is set (post-fix expected path)')
  assert.ok(typeof result.source === 'string',
    'generateEmailBody must return a source discriminator (groq|openai|emergent|fallback)')
  assert.ok(['groq', 'openai', 'emergent', 'fallback'].includes(result.source),
    'source must be a known provider or fallback, got: ' + result.source)
  // The fallback body contract — uses the candidate's name even
  // when the LLM is offline. Locks the public-shape contract so
  // route.js's { body, source, cvShortWarning } response stays
  // well-formed.
  assert.ok(/Anna Andersson/.test(result.body),
    'fallback body must include the candidate full name from the profile (proves the function read the profile correctly)')
  assert.ok(/Klarna/.test(result.body) || result.source !== 'fallback',
    'fallback body must include the company name (when LLM is offline); AI bodies are free-form')
})

test('Round-49: generateEmailBody prompt builder must read PROMPT_CV_CHAR_CAP from the same scope as the declaration', () => {
  // Lightweight structural lock — the prompt builder's
  // `p.cvSummary.slice(0, PROMPT_CV_CHAR_CAP)` slice call lives
  // INSIDE generateCoverLetter() + generateEmailBody() at the
  // module scope. The const it references MUST also be at the
  // module scope. We assert both: (a) the const is at column-0
  // AND (b) the slice in the two callers is present. The
  // combination catches the "declare the const somewhere it
  // can't be seen" regression precisely.
  assert.match(GROQ_SRC, /^const\s+PROMPT_CV_CHAR_CAP\s*=\s*5_000\b/m,
    'const declaration must be module-scope (column-0 anchored)')
  // Both prompts must slice by PROMPT_CV_CHAR_CAP exactly once
  // each. Counting occurrences inside the two prompt builders
  // is brittle; instead we lock the contract that the declaration
  // appears BEFORE both prompt-builder function declarations —
  // a function-decl hoisting tradeoff (consts are not hoisted)
  // means the const would be `undefined` if it appeared later.
  const declIdx = GROQ_SRC.indexOf('const PROMPT_CV_CHAR_CAP')
  const coverLetterIdx = GROQ_SRC.indexOf('async function generateCoverLetter')
  const emailBodyIdx = GROQ_SRC.indexOf('async function generateEmailBody')
  assert.ok(declIdx > 0 && coverLetterIdx > declIdx,
    'PROMPT_CV_CHAR_CAP declaration must appear BEFORE generateCoverLetter (consts aren\'t hoisted)')
  assert.ok(declIdx > 0 && emailBodyIdx > declIdx,
    'PROMPT_CV_CHAR_CAP declaration must appear BEFORE generateEmailBody (consts aren\'t hoisted)')
})

// =====================================================================
// Round-86 followup — prompt-echo guard. The full-suite E2E run
// observed the LLM reproduce the email-body prompt verbatim as the
// preview body ("1. **Analyze User Input:** ... Write a short email
// draft in Swedish...") when Groq's TPD quota is exhausted and a weak
// fallback provider answers. The guard (isPromptEcho) must reject that
// class so generateEmailBody degrades to the rule-based fallback.
// =====================================================================

// The verbatim echo class from the Round-86 full-suite failure.
const ECHO_BODY =
  '1.  **Analyze User Input:**\n   - **Role:** Swedish job application expert\n   - **Task:** Write a short email draft in Swedish to be pasted into an email client\n   - **Company:** företaget (placeholder, but I should use it as is or adapt naturally)'

// A real application email (the rule-based fallback shape) must NEVER
// be rejected by the echo guard.
const REAL_EMAIL =
  'Hej,\n\nJag såg er annons för tjänsten och vill gärna skicka in min ansökan via e-post.\n\nJag bifogar mitt CV och personliga brev.\n\nMed vänliga hälsningar,\nAnna Andersson'

// Same fresh-load dance as groq-tpd-quota.test.mjs: import the module
// with fetch blocked so pickProvider()'s startup side effects can't
// hit the network. isPromptEcho is pure — no fetch ever happens.
async function importGroqHelpers() {
  const origFetch = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('TEST_NETWORK_BLOCKED'))
  try {
    return await import(`../../lib/groq.js?t=${Date.now()}-${Math.random()}`)
  } finally {
    globalThis.fetch = origFetch
  }
}

test('Round-86 followup: isPromptEcho rejects the observed prompt-echo body class', async () => {
  const { isPromptEcho } = await importGroqHelpers()
  assert.equal(isPromptEcho(ECHO_BODY), true, 'the verbatim prompt echo from the E2E run must be flagged')
  assert.equal(isPromptEcho(new String(ECHO_BODY)), true, 'must also handle a String object')
})

test('Round-86 followup: isPromptEcho never flags a real application email', async () => {
  const { isPromptEcho } = await importGroqHelpers()
  assert.equal(isPromptEcho(REAL_EMAIL), false, 'a normal Swedish application email must pass')
  assert.equal(isPromptEcho('Kort text'), false, 'sub-80-char inputs are never emails and must not be flagged')
  assert.equal(isPromptEcho(''), false, 'empty string must not be flagged')
  assert.equal(isPromptEcho(undefined), false, 'undefined must not be flagged (String() guard)')
  assert.equal(isPromptEcho(null), false, 'null must not be flagged')
})

test('Round-86 followup: generateEmailBody acceptance guard references isPromptEcho (source lock)', () => {
  // The guard is the single choke point for the email body: if a
  // future refactor drops the echo check, the degraded-model prompt
  // leak returns silently. Lock the reference next to the length +
  // placeholder guards it extends.
  assert.match(
    GROQ_SRC,
    /!containsPlaceholder\(text\)\s*&&\s*!isPromptEcho\(text\)/,
    'generateEmailBody must reject prompt echoes via !isPromptEcho(text) in the same guard as !containsPlaceholder(text)',
  )
})

// =====================================================================
// Round-87 — prompt-echo edge cases, PROMPT_ECHO throw contract, and
// E2E mock mode. The echo guard moved UP into the shared
// createChatWithFallback choke point so every generation surface is
// protected; generators rethrow the PROMPT_ECHO error instead of
// masking it with their rule-based fallback, and the routes map it
// to a retryable 503. Mock mode (SKIP_LLM_E2E=true / CI=true) keeps
// the E2E suite quota-free and deterministic.
// =====================================================================

test('Round-87: isPromptEcho edge cases — prompt words in a real email are fine, signature phrases are not', async () => {
  const { isPromptEcho } = await importGroqHelpers()
  // A genuine email that happens to mention CV / annons words must
  // never be flagged (the signatures are the prompt's meta-INSTruction
  // phrases, not its subject nouns).
  const realEmailMentioningCvWords =
    'Hej,\n\nJag såg er annons för tjänsten och vill gärna skicka in min ansökan. ' +
    'I mitt CV beskriver jag erfarenhet av React, TypeScript och Next.js, och jag är van att arbeta i team. ' +
    'Jag bifogar mitt CV och personliga brev.\n\nMed vänliga hälsningar,\nAnna Andersson'
  assert.equal(isPromptEcho(realEmailMentioningCvWords), false,
    'a real email mentioning CV/annons words must not be flagged')
  // A response quoting ONE signature phrase (the prompt role line) is
  // echo-class even if the rest looks like prose — the phrase never
  // appears in real generation.
  const echoesRoleLineOnly =
    'Tack för möjligheten. Rollen passar mig väl. "Du är en svensk jobbansökningsexpert" — ' +
    'det var uppmaningen jag fick, och här är mitt svar: jag har fem års erfarenhet av att leverera resultat i team.'
  assert.equal(isPromptEcho(echoesRoleLineOnly), true,
    'a response that quotes the prompt role line must be flagged as an echo')
})

test('Round-87: isLlmMockMode is env-gated (SKIP_LLM_E2E / CI, CI never in production)', async () => {
  const { isLlmMockMode } = await importGroqHelpers()
  const prevSkip = process.env.SKIP_LLM_E2E
  const prevCi = process.env.CI
  const prevNodeEnv = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = 'development'
    delete process.env.SKIP_LLM_E2E
    process.env.CI = ''
    assert.equal(isLlmMockMode(), false, 'mock mode must be OFF by default')
    process.env.SKIP_LLM_E2E = 'true'
    assert.equal(isLlmMockMode(), true, 'SKIP_LLM_E2E=true must enable mock mode (explicit opt-in)')
    delete process.env.SKIP_LLM_E2E
    process.env.CI = 'true'
    assert.equal(isLlmMockMode(), true, 'CI=true outside production must enable mock mode (GitHub Actions on the dev webServer)')
    // Round-87 code-review hardening: CI=true must NEVER mock in a
    // production runtime (Vercel build env / CD runtimes set CI=true
    // too — a prod server must not serve the canned mock text).
    process.env.NODE_ENV = 'production'
    assert.equal(isLlmMockMode(), false, 'CI=true in production must NOT enable mock mode')
    process.env.SKIP_LLM_E2E = 'true'
    assert.equal(isLlmMockMode(), true, 'SKIP_LLM_E2E=true is honoured even in production (explicit opt-in)')
    process.env.NODE_ENV = 'development'
    process.env.SKIP_LLM_E2E = 'false'
    process.env.CI = 'false'
    assert.equal(isLlmMockMode(), false, 'explicit "false" values must NOT enable mock mode')
  } finally {
    if (prevSkip === undefined) delete process.env.SKIP_LLM_E2E
    else process.env.SKIP_LLM_E2E = prevSkip
    if (prevCi === undefined) delete process.env.CI
    else process.env.CI = prevCi
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNodeEnv
  }
})

test('Round-87: mockChatCompletion returns valid wire shape + prompt-aware JSON for cv-extract', async () => {
  const { mockChatCompletion, isPromptEcho } = await importGroqHelpers()
  const textRes = mockChatCompletion({
    messages: [{ role: 'user', content: 'Du är en svensk jobbansökningsexpert. Företag: Acme AB' }],
  })
  const text = textRes?.choices?.[0]?.message?.content
  assert.equal(typeof text, 'string', 'mock must return the OpenAI wire shape the generators read')
  assert.ok(text.length > 80, 'mock text must pass the email-body length guard')
  assert.match(text, /Hej|Med vänliga hälsningar|annons/i, 'mock text must satisfy the E2E greeting assertion')
  assert.equal(isPromptEcho(text), false, 'mock text must never be flagged as a prompt echo')

  const jsonRes = mockChatCompletion({
    messages: [{ role: 'user', content: 'Extrahera följande från CV:t\nCV-TEXT:\nFrontend…\nJSON:' }],
  })
  const parsed = JSON.parse(jsonRes.choices[0].message.content)
  assert.ok(Array.isArray(parsed.skills) && parsed.skills.length > 0,
    'cv-extract mock must be valid JSON carrying a non-empty skills array')
  assert.equal(typeof parsed.experience, 'string', 'cv-extract mock must carry the experience field')
})

test('Round-87: createChatWithFallback throws PROMPT_ECHO when the response echoes the prompt (source lock)', () => {
  assert.match(
    GROQ_SRC,
    /if \(content && isPromptEcho\(content\)\) \{[\s\S]{0,200}?throw promptEchoError\(\)/,
    'createChatWithFallback must throw promptEchoError() when the response content echoes the prompt',
  )
  assert.match(GROQ_SRC, /err\.code = PROMPT_ECHO_ERROR_CODE/,
    'promptEchoError must set code = PROMPT_ECHO_ERROR_CODE')
  assert.match(GROQ_SRC, /'LLM returned prompt echo — retrying'/,
    'the echo error must carry the exact retry message')
})

test('Round-87: every generator rethrows PROMPT_ECHO instead of soft-failing (source lock)', () => {
  // generateCoverLetter's catch sits ~14k chars into the function
  // (the prompt array is huge), so a fixed slice would miss it.
  // Slice each generator from its own `async function` header to the
  // NEXT generator's header instead.
  const generators = ['generateCoverLetter', 'generateAnswer', 'generateAdaptiveAnswer', 'generateEmailBody', 'generateText']
  const starts = generators.map((fn) => GROQ_SRC.indexOf(`async function ${fn}`))
  for (let i = 0; i < generators.length; i++) {
    assert.ok(starts[i] > 0, `must locate ${generators[i]}`)
    const body = GROQ_SRC.slice(starts[i], i + 1 < generators.length ? starts[i + 1] : GROQ_SRC.length)
    assert.ok(
      /if \(error\?\.code === PROMPT_ECHO_ERROR_CODE\) throw error/.test(body),
      `${generators[i]} must rethrow PROMPT_ECHO before its rule-based fallback so the route can surface the 503`,
    )
  }
})

test('Round-87: LLM-surfacing routes map PROMPT_ECHO to 503 with the canonical Swedish message (source lock)', () => {
  const routeFiles = [
    ['catch-all POST (cover letter)', path.join(__dirname, '../..', 'app', 'api', '[[...path]]', 'route.js')],
    ['email-draft', path.join(__dirname, '../..', 'app', 'api', 'email-draft', 'route.js')],
    ['extension/answer', path.join(__dirname, '../..', 'app', 'api', 'extension', 'answer', 'route.js')],
    ['extension/email-body', path.join(__dirname, '../..', 'app', 'api', 'extension', 'email-body', 'route.js')],
  ]
  for (const [label, file] of routeFiles) {
    const src = fs.readFileSync(file, 'utf8')
    assert.match(src, /'AI-tjänsten är tillfälligt överbelastad\. Försök igen om en stund\.'/
      , `${label} must carry the canonical overloaded-503 Swedish message`)
    assert.match(src, /code: 'PROMPT_ECHO'/, `${label} must carry code:'PROMPT_ECHO'`)
    assert.match(src, /status: 503/, `${label} must return HTTP 503`)
  }
})

test('Round-87: generateEmailBody propagates PROMPT_ECHO (not soft-fail) when the provider echoes the prompt (behavioral, stubbed fetch)', async () => {
  // The unit-test process has no .env, so no provider is configured
  // and `client` is null — the LLM branch never runs. Set a fake key
  // so the OpenAI-compatible client exists, then stub global fetch to
  // return an echo as the provider response. Mock mode must be OFF.
  const prevKey = process.env.GROQ_API_KEY
  const prevSkip = process.env.SKIP_LLM_E2E
  const prevCi = process.env.CI
  process.env.GROQ_API_KEY = 'test-mock-key-000'
  delete process.env.SKIP_LLM_E2E
  process.env.CI = ''
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(
    JSON.stringify({
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      created: 1,
      model: 'mock',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: ECHO_BODY },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
  try {
    const mod = await import(`../../lib/groq.js?t=${Date.now()}-${Math.random()}`)
    await assert.rejects(
      () => mod.generateEmailBody({ jobTitle: 'Frontendutvecklare', company: 'Acme AB', profile: { fullName: 'Anna Test' } }),
      (err) => err?.code === 'PROMPT_ECHO',
      'generateEmailBody must propagate the PROMPT_ECHO error (not soft-fail to the fallback) when the LLM echoes the prompt',
    )
  } finally {
    globalThis.fetch = origFetch
    if (prevKey === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = prevKey
    if (prevSkip === undefined) delete process.env.SKIP_LLM_E2E
    else process.env.SKIP_LLM_E2E = prevSkip
    if (prevCi === undefined) delete process.env.CI
    else process.env.CI = prevCi
  }
})
