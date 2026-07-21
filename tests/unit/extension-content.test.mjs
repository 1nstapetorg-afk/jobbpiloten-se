// tests/unit/extension-content.test.mjs
//
// Regression guards for the two values that the soft-launch
// polish session explicitly locked:
//   1. fetchAIAnswers must POST `question` sliced to ≤ 1500 chars
//      (any larger and we burn LLM context invisibly + risk the
//      server-side Zod max(2000)).
//   2. scheduleScan must use a setTimeout numeric duration in
//      the 450–550ms band. The TASK 6b comment caps it at 500ms;
//      a future str_replace bump above 550ms would degrade the
//      SPA UX (form fields mounting in bursts), below 450ms risks
//      compound re-fire on Workday mounts.
//
// Strategy: static regex over the file source for both guards.
// We deliberately dropped the earlier vm-runtime approach
// because Node's vm + ES2020+ chrome.* mocks became brittle
// across versions — the static check is a real contract lock
// (it catches "slice was deleted" + "debounce was bumped to 200")
// without the maintenance cost of a vm sandbox.
//
// Run via `yarn test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.resolve(__dirname, '../../extension/content.js')
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf-8')

// ---------- 1. fetchAIAnswers caps the question at 1500 chars ----------

test('fetchAIAnswers must POST `question` sliced to exactly 1500 chars (static contract)', () => {
  // The literal `slice(0, 1_500)` (or `slice(0, 1500)`) must appear
  // in the function. A future bump above 1500 would silently let
  // the LLM context exceed the server-side Zod max(2000) by 50%.
  const re = /const question = String\(meta \|\| ''\)\.slice\(0,\s*1[_]?500\)/
  assert.ok(
    re.test(SOURCE),
    'fetchAIAnswers must call String(meta || "").slice(0, 1_500) before POSTing',
  )
})

test('fetchAIAnswers slice cap is bounded by [1, 1500] in the actual call site', () => {
  // Belt-and-braces: even if the cap literal changes, the value
  // must stay in [1, 1500]. Catches regressions like
  // `slice(0, 2000)` (matching server Zod max) that would move
  // the client cap out of contract. `[\d_]+` accepts the JS
  // numeric separator form (`1_500`) so the matcher is identical
  // to the static contract check above.
  const m = SOURCE.match(/const question = String\(meta \|\| ''\)\.slice\(0,\s*([\d_]+)\)/)
  assert.ok(m, 'fetchAIAnswers did not contain a `slice(0, N)` literal')
  const cap = Number(String(m[1]).replace(/_/g, ''))
  assert.ok(Number.isFinite(cap) && cap > 0 && cap <= 1500,
    `fetchAIAnswers slice cap ${cap} is outside [1, 1500] — would let LLM context bleed past server-side Zod(2000)`)
})

// ---------- 2. scheduleScan debounces to ~500ms ----------

test('scheduleScan must use a setTimeout numeric duration in the 140-160ms band', () => {
  // Locate the scheduleScan function body. Use `[\s\S]*?` so the
  // regex walks across lines + handles the inner `()` in the
  // arrow function `setTimeout(async () => {…}, NUMBER)`. The
  // earlier `[^)]*` form stopped at the arrow's closing paren
  // and the test couldn't find the debounce duration at all.
  //
  // 2026-07-12 (Round-11 polish): lowered from 250ms to 150ms
  // to match the 1+ pill threshold + snappier Fyll i nu button
  // (a 250ms debounce felt late on a "click the popup, wait for
  // the button to enable" round-trip). The 140-160ms band
  // allows ±7% jitter around 150ms so future tuning stays in
  // range without breaking the test.
  const start = SOURCE.indexOf('function scheduleScan')
  assert.ok(start >= 0, 'scheduleScan not found in extension/content.js')
  // End: the next top-level `function …` declaration, or EOF
  const tailCandidate = SOURCE.indexOf('\nfunction ', start + 1)
  const body = SOURCE.slice(start, tailCandidate > 0 ? tailCandidate : SOURCE.length)
  const m = body.match(/setTimeout\([\s\S]*?,\s*(\d+)\)/)
  assert.ok(m, 'scheduleScan did not call setTimeout(cb, NUMBER)')
  const dur = Number(m[1])
  assert.ok(Number.isFinite(dur) && dur >= 140 && dur <= 160,
    `scheduleScan debounce duration ${dur}ms is outside the 140-160ms band (jitter ±7% of 150ms)`)
})

test('scheduleScan must clearTimeout(scanTimer) before scheduling a new one', () => {
  // Without this, every MutationObserver fire resets the timer
  // and the scan never runs (latest mutation always wins). The
  // two MUST appear together as a debounce guard.
  const start = SOURCE.indexOf('function scheduleScan')
  const tail = SOURCE.indexOf('\nfunction ', start + 1)
  const body = SOURCE.slice(start, tail > 0 ? tail : SOURCE.length)
  assert.ok(/clearTimeout\(scanTimer\)/.test(body),
    'scheduleScan must call clearTimeout(scanTimer) to debounce mutations')
})

// ---------- 3. fetchBatchAIAnswers targets the new endpoint & disabled toast ----------

test('fetchBatchAIAnswers must POST to /api/extension/ai-answers', () => {
  // Drift between content.js and the route file would silently
  // 404 every batch fill. Lock the URL string.
  const m = SOURCE.match(/`\$\{PROD_BASE_URL\}\/api\/extension\/ai-answers`/)
  assert.ok(m, 'fetchBatchAIAnswers must POST to /api/extension/ai-answers')
})

test('fetchBatchAIAnswers must surface a Swedish toast when the server returns disabled=true', () => {
  // The route returns `{ disabled: true, answers: {} }` when the
  // user flipped the AI toggle off in /settings. Without an
  // explicit toast branch the user sees "0 svar ifyllda" with
  // no explanation. The test anchors on the literal Swedish
  // phrase in the source.
  assert.ok(/AI-svar \u00e4r avst\u00e4ngt/.test(SOURCE),
    'fetchBatchAIAnswers must showToast when the server returns disabled=true')
})

test('fetchBatchAIAnswers must paint BLUE "ai_generated" outline + tooltip on AI-filled inputs', () => {
  // The "Granska" warning requires a distinct BLUE outline so
  // the user can tell AI fields apart from green/yellow/red at
  // a glance. Anchor on the literal CSS selector + the tooltip
  // string in one combined check.
  assert.ok(/\[data-jobbpiloten-status="ai_generated"\]/.test(SOURCE),
    'ensurePaintStylesheet must inject a rule for status="ai_generated"')
  assert.ok(/AI-genererat svar — granska innan du skickar/.test(SOURCE),
    'paintAsAiGenerated must set the tooltip in plain Swedish')
})

// ---------- 4. Round-11 — permissive whyThisCompany / whyThisRole regex (test-form fix) ----------
//
// SYMPTOM: /test-form page label "Varför vill du jobba hos oss?"
// failed to match the old strict `varför[\s_]?jobba[\s_]?hos`
// pattern because the actual label has "varför vill du jobba hos"
// (with intermediate words). The popup showed "0 detected" and
// "Fyll i nu" stayed disabled.
//
// FIX: replaced the strict `[\s_]?` separators with permissive
// `[\s\S]{0,30}?` so a natural-language Swedish question still
// routes. The 30-char ceiling prevents unrelated "varför" labels
// (e.g. a description paragraph) from over-matching.

test('FIELD_PATTERNS whyThisCompany must use permissive char-class separators (Round-11 fix)', () => {
  const pattern = findEntryPatternLiteral(SOURCE, 'answers.whyThisCompany')
  assert.ok(
    /varför\[\\s\\S\]\{0,30\}\?jobba\[\\s\\S\]\{0,30\}\?hos/.test(pattern),
    'whyThisCompany pattern must allow 0-30 chars between "varför" and "jobba" so natural-language Swedish labels match',
  )
})

test('FIELD_PATTERNS whyThisRole must use permissive char-class separators (Round-11 fix)', () => {
  const pattern = findEntryPatternLiteral(SOURCE, 'answers.whyThisRole')
  assert.ok(
    /varför\[\\s\\S\]\{0,30\}\?(?:rollen|tjänsten)/.test(pattern),
    'whyThisRole pattern must allow 0-30 chars between "varför" and the role keyword',
  )
})

// Helper: extract the /pattern/ literal from the FIELD_PATTERNS entry
// with the given profileKey. The entry is shaped
// `{ pattern: /.../, profileKey: '...' }` and lives on a single
// line. We use a line-based match because the pattern literal
// contains `[\s\S]{0,30}?` quantifier braces — a non-greedy
// `[\s\S]*?` would stop at the first `}` inside the pattern, not
// at the entry's closing `}`. Also asserts the entry is on a
// single line so a future refactor that breaks an entry across
// two lines (an easy accident) is caught up-front.
function findEntryPatternLiteral(source, profileKey) {
  const lines = source.split('\n')
  const entryLine = lines.find((l) => l.includes(`profileKey: '${profileKey}'`))
  assert.ok(entryLine, `FIELD_PATTERNS must include an entry for ${profileKey}`)
  assert.ok(
    !entryLine.includes('\n'),
    `entry for ${profileKey} must be on a single line — multi-line entries break this regex lock`,
  )
  const pattern = entryLine.match(/pattern:\s*(\/[^\n]+\/i)/)
  assert.ok(pattern, `${profileKey} entry must include a /pattern/ literal`)
  return pattern[1]
}

// ---------- 5. Round-11 — content script writes detected count to storage (popup-bridge) ----------
//
// The popup's chrome.storage.onChanged listener re-paints when
// `jobbpiloten_detectedCount` changes. Without this write, the
// popup runs `queryActiveTab` ONCE on open and never refreshes;
// a React 'use client' form rendered after the popup opened
// appears as "0 detected" until the 2s safety-net poll fires.

test('content script must write jobbpiloten_detectedCount to storage after scanning (Round-11 bridge)', () => {
  // The write helper is called from scanAndPaint. The storage
  // key `jobbpiloten_detectedCount` is the bridge between the
  // content script's MutationObserver loop and the popup's
  // storage.onChanged listener. Without the write the popup
  // cannot reflect fields that mount AFTER the initial query.
  assert.ok(
    /chrome\.storage\.local\.set\(\s*\{\s*jobbpiloten_detectedCount/.test(SOURCE),
    'content script must call chrome.storage.local.set with jobbpiloten_detectedCount after each scan',
  )
  assert.ok(
    /jobbpiloten_detectedAt/.test(SOURCE),
    'content script must also write jobbpiloten_detectedAt (timestamp) for diagnostics',
  )
})

test('content script must debounce the detected-count storage write to avoid Workday burst-mount spam', () => {
  // The write helper uses a rate-limit constant. Without it,
  // a Workday page that mounts 20 fields in one animation
  // frame would fire 20 chrome.storage.local.set calls
  // (each one triggering storage.onChanged on every popup).
  // The constant is a "soft contract" — bumping it to 0 would
  // regress the Workday case silently.
  assert.ok(
    /DETECTED_WRITE_INTERVAL_MS\s*=\s*\d+/.test(SOURCE),
    'writeDetectedCountIfChanged must declare a rate-limit constant (DETECTED_WRITE_INTERVAL_MS)',
  )
  const m = SOURCE.match(/DETECTED_WRITE_INTERVAL_MS\s*=\s*(\d+)/)
  const ms = m ? Number(m[1]) : 0
  assert.ok(ms >= 100 && ms <= 2000,
    `DETECTED_WRITE_INTERVAL_MS=${ms}ms is outside [100, 2000] — too tight would spam storage, too loose would lag the popup`,
  )
})

// ----------------------------------------------------------------------
// 2026-07-12 polish followup (commit 11b4e8b code-reviewer bonus flag):
// Lock the structural contract that the scheduleScan debounce + the
// single-write call-site together guarantee "≤1 storage write per
// DOM-mutation burst". A runtime test would require mocking the chrome
// global + vm-loading content.js + driving scanAndPaint — too heavy
// for the existing static-grep test pattern in this file. The static
// checks below lock the SAME invariant by inspecting the call graph:
//   1. scanAndPaint calls writeDetectedCountIfChanged EXACTLY ONCE
//      with matches.length
//   2. writeDetectedCountIfChanged is NOT referenced from outside the
//      helper + scanAndPaint scope (no rogue hot-loop call-site)
//   3. The scheduleScan debounce path coalesces via clearTimeout-before-
//      setTimeout (already locked by test #2 above)
// Without these locks, a future refactor that adds another
// writeDetectedCountIfChanged call inside a hot loop would silently
// regress the Round-11 #3 mitigation (storage.onChanged storms).

// Inventory of legitimate symbol appearances in the source:
//   • function definition: `function writeDetectedCountIfChanged(count) {`
//   • call site: `writeDetectedCountIfChanged(matches.length)`
// Total: 2 appearances. Any more is a regression.
test('writeDetectedCountIfChanged has exactly 1 call site (matches.length) + 1 definition', () => {
  // Helper definition — strict pattern to avoid matching "function"
  // keyword names that co-incidentally contain the substring.
  const defCount = (SOURCE.match(/function\s+writeDetectedCountIfChanged\s*\(/) || []).length
  assert.equal(
    defCount,
    1,
    `writeDetectedCountIfChanged must be defined exactly once as a function; found ${defCount} definition(s). A second definition would shadow the helper and silently nullify the rate-limit.`,
  )
  // Call site — must pass matches.length (NOT a constant or cached
  // value) so the popup reflects the actual post-scan count.
  const callSites = (SOURCE.match(/\bwriteDetectedCountIfChanged\s*\(\s*matches\.length\s*\)/g) || []).length
  assert.equal(
    callSites,
    1,
    `writeDetectedCountIfChanged must be called exactly once with matches.length (the live count); found ${callSites} call(s). A second call-site would force a second storage write per DOM burst — silently regressing the Round-11 #3 mitigation.`,
  )
})

test('writeDetectedCountIfChanged must NOT have any rogue call sites outside the expected scope', () => {
  // Negative lookbehind (?<!function\s) ensures we don't match the
  // helper's own definition (`function writeDetectedCountIfChanged(`).
  // Without it, the bug fix in the previous test would still match
  // the helper definition as a "call" and the count would be wrong.
  // Each match = one legitimate CALL site (not definition).
  const callsNotFromDef = SOURCE.match(/(?<!function\s)\bwriteDetectedCountIfChanged\s*\(/g) || []
  // Inventory: 1 call site (matches.length) is the EXPECTED count.
  // Anything >1 means a hot-loop or duplicate call was added.
  assert.equal(
    callsNotFromDef.length,
    1,
    `writeDetectedCountIfChanged must have EXACTLY 1 call site (not counting the function definition); found ${callsNotFromDef.length} call(s). A rogue call outside scanAndPaint would multiply storage writes per DOM burst.`,
  )
})

// ----------------------------------------------------------------------
// Round-44 — per-question style override wiring regression lock.
//
// Bug fixed: the popup's "Skrivstil för detta svar" <select> was
// writing to chrome.storage.local under `jobbpiloten_styleOverride`,
// but the content script never read that key back before posting
// to /api/extension/answer or /api/extension/ai-answers. The end
// result: the popup's choice was silently ignored by the server's
// generateAnswer / generateAdaptiveAnswer, which fell back to the
// profile's stored stylePreference.
//
// Lock contract: content.js must
//   1. declare STORAGE_KEYS.styleOverride = 'jobbpiloten_styleOverride'
//   2. thread `styleOverride` from readStorage() into fetchAIAnswers
//      and fetchBatchAIAnswers
//   3. attach `body.style = overrideStyle` in fetchAIAnswers before
//      JSON.stringify, gated on a non-empty string (so absent
//      override doesn't fail Zod min(1))
//   4. attach `payload.style = overrideStyle` in fetchBatchAIAnswers
//      with the same gate
//
// Four source-level regex locks guarantee the wiring can't silently
// regress in a future refactor.

test('STORAGE_KEYS must include styleOverride pointing at jobbpiloten_styleOverride (Round-44)', () => {
  // The literal must be bytewise-aligned with extension/popup.js's
  // STORAGE_KEYS.styleOverride — drift would silently disconnect
  // the popup's writer from the content script's reader.
  assert.ok(
    /STORAGE_KEYS\s*=\s*\{[\s\S]*?styleOverride\s*:\s*['"]jobbpiloten_styleOverride['"]/.test(SOURCE),
    'STORAGE_KEYS must include styleOverride: "jobbpiloten_styleOverride" so popup.js and content.js share the storage key',
  )
})

test('fetchAIAnswers must attach body.style when styleOverride is truthy (Round-44)', () => {
  // The bug was that body was literally `{ question, field }` — no
  // conditional style key. A future cleanup that drops the conditional
  // would silently regress the feature.
  assert.ok(
    /body\.style\s*=\s*overrideStyle/.test(SOURCE),
    'fetchAIAnswers must attach "body.style = overrideStyle" inside an IF so absent override skips cleanly',
  )
  // The conditional must guard the assign so an empty override doesn't
  // trip Zod min(1). A naive `body.style = overrideStyle || defaultStyle`
  // would preserve the bug. Single-statement `if (...) x = y` is the
  // established style elsewhere in this file, so accept it WITHOUT
  // requiring braces (the previous brace-required regex failed against
  // the actual source — see Round-44 code-reviewer finding #1).
  assert.ok(
    /if\s*\(\s*overrideStyle\s*\)\s*(?:\{)?\s*body\.style\s*=\s*overrideStyle\s*(?:\})?/.test(SOURCE),
    'fetchAIAnswers must guard "body.style = overrideStyle" with an "if (overrideStyle)" check (single-statement OR block form)',
  )
})

test('fetchBatchAIAnswers must attach payload.style when styleOverride is truthy (Round-44)', () => {
  // Same lock for the batch endpoint — the Zod schema accepts an
  // optional `style`, so attach it conditionally rather than
  // unconditionally (which would fail Zod min(1) on empty string).
  // Optional braces cover both single-statement and block forms
  // (kept symmetric with the fetchAIAnswers lock — fixes Round-44
  // code-reviewer finding #2 asymmetry).
  assert.ok(
    /if\s*\(\s*overrideStyle\s*\)\s*(?:\{)?\s*payload\.style\s*=\s*overrideStyle\s*(?:\})?/.test(SOURCE),
    'fetchBatchAIAnswers must use "if (overrideStyle) payload.style = overrideStyle" (single-statement OR block form)',
  )
})

test('fillAll must thread styleOverride into both AI fetch helpers (Round-44)', () => {
  // The single read happens at the fillAll level — fetchAIAnswers
  // and fetchBatchAIAnswers both receive the resolved value as an
  // arg, not via N re-reads of chrome.storage.local. The literal
  // `styleOverride` arg MUST be present in both call sites.
  assert.ok(
    /await\s+fetchAIAnswers\s*\(\s*\{[\s\S]*?styleOverride/m.test(SOURCE),
    'fillAll must pass styleOverride to fetchAIAnswers',
  )
  assert.ok(
    /await\s+fetchBatchAIAnswers\s*\(\s*\{[\s\S]*?styleOverride/m.test(SOURCE),
    'fillAll must pass styleOverride to fetchBatchAIAnswers',
  )
})

// ----------------------------------------------------------------------
// 2026-07-16 (Round-12) — FIELD_PATTERNS expansion + non-text helpers.
//
// Adds 14 boolean / select / multiselect / consent / file rules on top
// of the legacy 20. The new helpers (clickBooleanOption,
// checkMultiCheckboxes, checkConsent, parseExperienceThreshold,
// booleanFromExperienceYears, resolveProfileRaw) live in section 7b.
// A unique `kind:` value plus an orange 'boolean_filled' paint status
// tells fillAll() which helper to dispatch.
//
// Lock-contract: the following tests assert each NEW profileKey is
// present in FIELD_PATTERNS, each NEW helper is declared exactly once,
// the boolean_filled paint/CSS/TOOLTIP contract is wired through, and
// the new FILE_BUTTON_LABELS map covers cvFile / coverLetterFile /
// additionalDocuments. A future regression that drops any of these
// will surface here BEFORE user-visible behaviour breaks.
//
// Total expected FIELD_PATTERNS count after Round-12: 39 entries
//   • legacy 20 (pre-Round-12)
//   • 11 boolean / booleanThreshold (driversLicense, euCitizen,
//     workPermit, highSchoolDiploma, forkliftLicense,
//     securityClearance, leadershipExperience, bilingual,
//     technicalEducation, customerExperience, experienceYears)
//   • 4 select (dateOfBirth, gender, nationality, countryCode)
//   • 1 multiselect (skills)
//   • 1 consent (autoConsent)
//   • 2 new file rules (coverLetterFile, additionalDocuments) — the
//     cv rule gets `profileKey: 'cvFile'` added but stays a single
//     entry, so it doesn't add to the count.
// = 20 + 11 + 4 + 1 + 1 + 2 = 39 entries.

test('FIELD_PATTERNS must include the 19 Round-12 entries (binary + select + multiselect + consent + new files)', () => {
  // The structural lock — every new profileKey must appear at least
  // once in the source. A future refactor that drops a boolean
  // pattern would silently skip Ja/Nej fill for that question and
  // surface here as a missing profileKey. Order of these literal
  // matches is irrelevant; we count each profileKey exactly once.
  const expectedKeys = [
    // P1 — booleans
    'hasDriversLicense', 'isEuCitizen', 'hasWorkPermit', 'hasHighSchoolDiploma',
    'hasForkliftLicense', 'hasSecurityClearance', 'hasLeadershipExperience',
    'isBilingual', 'hasTechnicalEducation', 'hasCustomerExperience',
    'yearsExperience',
    // P2 — selects
    'dateOfBirth', 'gender', 'nationality', 'phoneCountryCode',
    // P3 — multiselect
    'skills',
    // P4 — consent
    'autoConsent',
    // P5 — file (new + revised)
    'coverLetterFile', 'additionalDocuments',
  ]
  for (const key of expectedKeys) {
    assert.ok(
      new RegExp(`profileKey:\\s*['"]${key}['"]`).test(SOURCE),
      `FIELD_PATTERNS must include profileKey: '${key}' (Round-12 expansion)`,
    )
  }
})

test('FIELD_PATTERNS must contain exactly 57 entries (Round-12 count lock + Round-46 address split)', () => {
  // 20 legacy + 19 new = 39. The count is informative — it's a
  // soft contract for future test fixtures that mock a full form
  // page (the mock page at /app/mock-extension-form.html expects
  // exactly this many matchable rules). We count entries by
  // matching lines whose leading whitespace + `{ pattern:` is the
  // canonical entry-start. False positives from the comment block
  // ("Round-12"), the type:'file' field, and any inline regex
  // usage are filtered out by requiring the literal `profileKey:`
  // AND `kind:` (or `type:` for files) within the same line.
  const entryLines = SOURCE.split('\n').filter((l) => {
    const trimmed = l.trim()
    return trimmed.startsWith('{ pattern:') || trimmed.startsWith('{pattern:')
  })
  assert.equal(
    entryLines.length,
    57,
    `FIELD_PATTERNS must have exactly 57 entries (20 legacy + 19 Round-12 + 2 Round-46/Bug 2 address split + 16 from Round-55 through Round-79); found ${entryLines.length}. Did you add or drop an entry in this commit? Update this test + the mock HTML in the same change.`,
  )
})

test('Round-12 helpers must each be defined exactly once as a function (no shadow definitions)', () => {
  // Without the single-declaration contract, a future refactor that
  // adds e.g. a stale `function clickBooleanOption()` near the
  // bottom of the file would JavaScript-hoist the stale variant,
  // exactly the bug that Round-44's paintField fix removed.
  const helpers = [
    'clickBooleanOption',
    'checkMultiCheckboxes',
    'checkConsent',
    'parseExperienceThreshold',
    'booleanFromExperienceYears',
    'resolveProfileRaw',
  ]
  for (const fn of helpers) {
    const re = new RegExp(`function\\s+${fn}\\s*\\(`, 'g')
    const matches = SOURCE.match(re) || []
    assert.equal(
      matches.length,
      1,
      `${fn} must be declared exactly once as a function; found ${matches.length}. A second definition would shadow the helper and silently nullify the boolean dispatch path.`,
    )
  }
})

test('ensurePaintStylesheet must include the orange `boolean_filled` CSS rule (Round-12)', () => {
  // Distinguishes boolean decisions from the existing green/yellow/
  // red/blue palette. Solid orange (not dashed) signals "we've
  // decided" — irreversibly so, which is why the user must review.
  assert.ok(
    /\[data-jobbpiloten-status="boolean_filled"\]\s*\{[^}]*rgba\(249,?\s*115,?\s*22/.test(SOURCE),
    'ensurePaintStylesheet must inject a rule for status="boolean_filled" using the orange rgba (249,115,22) tone',
  )
})

test('CONFIDENCE_TITLES must include the boolean_filled tooltip (Round-12)', () => {
  // Tooltip = accessibility for users with red-green colour-blindness
  // who can't rely on colour alone. The tooltip wording is locked
  // because every existing tooltip in CONFIDENCE_TITLES is bytewise-
  // asserted in this file's earlier tests; future drift would be
  // silent without a lock. The exact copy below matches section 7.
  assert.ok(
    /boolean_filled:\s*['"]Ja\/Nej-beslut fyllt — granska och bekräfta innan du skickar\.['"]/.test(SOURCE),
    'CONFIDENCE_TITLES must include boolean_filled: <the locked Swedish copy>',
  )
})

test('FILE_BUTTON_LABELS map must cover cvFile + coverLetterFile + additionalDocuments (Round-12)', () => {
  // The maybeInstallFileButtons() fallback chain reads these literal
  // keys when picking button copy. A missing entry silently falls
  // back to "Välj CV-fil" for a cover-letter file input — confusing
  // copy. All three keys MUST exist.
  for (const key of ['cvFile', 'coverLetterFile', 'additionalDocuments']) {
    const re = new RegExp(`\\b${key}\\s*:\\s*['"]`)
    assert.ok(re.test(SOURCE), `FILE_BUTTON_LABELS must include the key '${key}' so the file-button copy picker doesn't fall back to the CV default`)
  }
})
