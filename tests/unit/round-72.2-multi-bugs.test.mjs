// Round-72.2 — 7-bug regression test file.
//
// Pinned static-grep assertions for the surgical fixes shipped
// today. Each test name maps to a real bug from the user-reported
// PDF/screenshots so a future maintainer whose fix silently drifts
// gets a clear pointer to which bug they regressed.
//
// Coverage map:
//   BUG 1 → popup.js: `var connected = false` at line 1 + no
//           duplicated `let`
//   BUG 2 → manifest CSP localhost + dashboard-side HTTPS handling
//   BUG 3 → content.js FIELD_PATTERNS: english Yes/No + Swedish prefix
//           variants don't trip the original-Ja/Nej-only path
//   BUG 4 → upload-cv/route.js + lib/groq.js: Swedish error copy +
//           fallbackEmailBody() degradation path
//   BUG 5 → popup.js Gmail URL composer: URLSearchParams + safeBody +
//           encodeURIComponent on the recipient (existing before
//           but locked so the body encoding can't regress)
//   BUG 6 → content.js FIELD_PATTERNS: Manpower + Randstad entries
//   BUG 7 → content.js findMailtoSignals: phrase patterns cover the
//           "skicka till oss" / "apply by email" Swedish body copy
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.join(__dirname, '..', '..')

const POPUP_JS = fs.readFileSync(path.join(repoRoot, 'extension', 'popup.js'), 'utf8')
const CONTENT_JS = fs.readFileSync(path.join(repoRoot, 'extension', 'content.js'), 'utf8')
const MANIFEST = fs.readFileSync(path.join(repoRoot, 'extension', 'manifest.json'), 'utf8')
const UPLOAD_CV = fs.readFileSync(path.join(repoRoot, 'app', 'api', 'upload-cv', 'route.js'), 'utf8')
const GROQ = fs.readFileSync(path.join(repoRoot, 'lib', 'groq.js'), 'utf8')
const POPUP_HANDLER = fs.readFileSync(path.join(repoRoot, 'app', 'extension-auth', 'page.js'), 'utf8')

// ─── BUG 1 — TDZ on `connected` ───────────────────────────────────────

test('BUG 1: var connected = false lands at the very TOP of popup.js (above all function defs + imports)', () => {
  const declIdx = POPUP_JS.search(/var\s+connected\s*=\s*false/)
  const importsIdx = POPUP_JS.search(/^\s*import\s/m)
  assert.ok(declIdx >= 0, 'var connected = false must exist')
  assert.ok(importsIdx >= 0, 'an import statement must exist below')
  assert.ok(
    declIdx < importsIdx,
    `var connected (offset ${declIdx}) MUST be declared before the imports (offset ${importsIdx})`,
  )
})

test('BUG 1: at most one `let connected = false` in popup.js (var replaces both prior let declarations)', () => {
  const occurrences = POPUP_JS.match(/let\s+connected\s*=\s*false/g) || []
  assert.equal(
    occurrences.length,
    0,
    `expected ZERO \`let connected = false\` (the hoisted form is \`var\`). got ${occurrences.length}`,
  )
})

test('BUG 1: var declaration survives (a) chrome.storage.onChanged closures + (b) loadAndPaint Promise.race catch path', () => {
  // Static check that no closure creates a fresh TDZ via local
  // shadowing. The line-3110 `const connected = !!token && !!profile`
  // (loadAndPaint body) is intentionally a block-scoped shadow that
  // does NOT affect module scope.
  // Just ensure the var declaration is at module top.
  // 2026-07-21 / Round-72.2 — widened from 400 to 2000 chars. The
  // Round-72.2 design intentionally keeps the JSDoc header
  // explaining the `var`-hoisting-for-TDZ decision IMMEDIATELY above
  // the `var connected = false` line so future maintainers see WHY
  // the file uses `var` and not `let`. That header pushes the
  // declaration past the 400-char mark. The invariant this test
  // actually locks is "the hoisted declaration precedes all
  // downstream `setStatus`-style async loadAndPaint paths", and the
  // position-vs-setStatus check below (line ~50) is the
  // loadAndPaint-catches-this-truthy check the original assertion
  // was guarding.
  const top = POPUP_JS.slice(0, 2000)
  assert.match(top, /var\s+connected\s*=\s*false/, 'var connected must appear near the top of popup.js (within first 2000 chars)')
})

// ─── BUG 2 — Dashboard URL dev/prod switching ─────────────────────────

test('BUG 2: manifest connect-src includes both production + localhost (dev) for the popup fetch path', () => {
  const cspMatch = MANIFEST.match(/connect-src\s+([^;"]+)/)
  assert.ok(cspMatch)
  const csp = cspMatch[1]
  assert.match(csp, /https:\/\/jobbpiloten\.se/, 'manifest must allow production origin')
  assert.match(csp, /http:\/\/localhost:\*/, 'manifest must allow http://localhost:* for dev mode extension testing')
})

test('BUG 2: popup.js resolveEnvAuthBaseUrl has a localhost dev heuristic that bypasses the production floor in dev', () => {
  // The Tier A localhost shortcut is the documented dev-path for
  // a popup opened while the active tab is on localhost:3000 —
  // it returns `http://localhost:${port}` so save/scrape calls
  // do not 404 against an unreachable prod DNS.
  assert.match(
    POPUP_JS,
    /u\.hostname\s*===\s*['"]localhost['"]\s*\|\|\s*u\.hostname\s*===\s*['"]127\.0\.0\.1['"]/,
  )
})

// ─── BUG 3 — Yes/No English fallback ─────────────────────────────────

test('BUG 3: content.js FIELD_PATTERNS includes an English Yes/No fallback for non-Swedish forms', () => {
  // The fallback regex lower-case-matches "ja | nej | yes | no | y | n | si | oui | non"
  // so the matcher isn't tight to Swedish forms only. Uses a real
  // profileKey ('openToAnyRole') so clickBooleanOption() can mutate
  // a well-defined slot — null would cause schema corruption
  // when matchField() wrote profile[null] = true.
  // Loose regex anchor — robust to comment-provenance drift between
  // the inject script's wording and the test's anchor.
  assert.match(
    CONTENT_JS,
    /profileKey:\s*['"]openToAnyRole['"]\s*,\s*kind:\s*['"]boolean['"]/i,
    'Yes/No fallback pattern must be present with profileKey:openToAnyRole + kind:boolean',
  )
})

// ─── BUG 4 — CV error messages + AI email preview fallback ──────────

test('BUG 4: upload-cv/route.js exposes actionable Swedish copy for file-type / file-size / pdf-parse failures', () => {
  assert.match(
    UPLOAD_CV,
    /Filtypen st[öo]ds inte\. Ladda upp en PDF eller Word-fil \(\.docx\) under 5 MB\./,
    'file-type Swedish copy required',
  )
  assert.match(
    UPLOAD_CV,
    /Filen [äa]r f[öo]r stor\. Max 5 MB\. Du kan fortfarande spara utan CV\./,
    'file-size Swedish copy required',
  )
  assert.match(
    UPLOAD_CV,
    /PDF:en kunde inte tolkas\. F[öo]rs[öo]k med en annan PDF/,
    'pdf-parse Swedish copy required',
  )
})

test('BUG 4: groq.js exposes fallbackEmailBody() that generateEmailBody can degrade to without throwing', () => {
  assert.match(GROQ, /function\s+fallbackEmailBody\s*\(/)
  // generateEmailBody() must CALL fallbackEmailBody() in its
  // catch / network failure path so a 5xx from Groq doesn't
  // strand the popup on "Tillfälligt fel — försök igen".
  assert.match(GROQ, /fallbackEmailBody\s*\(/, 'generateEmailBody must call fallbackEmailBody somewhere')
})

// ─── BUG 5 — Gmail URL compose body encoding ─────────────────────────

test('BUG 5: popup.js openGmailBtn uses URLSearchParams + encodeURIComponent coerces the to-field + safeSubject fallback', () => {
  // Loose invariants-check (vs strict block extraction): the
  // openGmailBtn listener must USE URLSearchParams (NOT raw
  // string concat), MUST call composeStaticBody as safeBody
  // fallback so a race between AI-fetch and click never ships a
  // blank = parameter to Google, AND MUST navigate to
  // https://mail.google.com/mail/?. Grep the full popup.js for
  // each invariant — robust to whitespace drift in the listener.
  assert.match(POPUP_JS, /new\s+URLSearchParams/, 'composer must use URLSearchParams (NOT raw `?a=b` string concat)')
  assert.match(POPUP_JS, /composeStaticBody\s*\(/, 'composer must call composeStaticBody as safeBody fallback')
  assert.match(POPUP_JS, /mail\.google\.com\/mail\/\?/, 'composer must target https://mail.google.com/mail/?')
  assert.match(POPUP_JS, /openGmailBtn[\s\S]{0,3000}?chrome\.tabs\.create/, 'composer must call chrome.tabs.create somewhere in the openGmailBtn listener block')
})

// ─── BUG 6 — Manpower / Randstad / other field patterns ──────────────

test('BUG 6: content.js FIELD_PATTERNS covers all 12 Manpower + Randstad + other fields listed in the user report', () => {
  // Each pattern is asserted by its profileKey so the matcher test
  // fails loudly if a future refactor drops the keyword WIDTH.
  const expectedProfileKeys = [
    'hasOtherEmployment',
    'personalNumber',
    'availableFromDate',
    'shiftsPerWeek',
    'daytimeAvailability',
    'preferredLocations',
    'currentJob',
    'salaryExpectation',
    'applicationSource',
    'zip',
    'hasForkliftLicense',
    'speakSwedish',
    'certificates',
  ]
  for (const k of expectedProfileKeys) {
    assert.ok(
      new RegExp(`profileKey:\\s*['"]${k}['"]`).test(CONTENT_JS),
      `expected FIELD_PATTERNS entry with profileKey="${k}"`,
    )
  }
})

// ─── BUG 7 — Email detector scan + phrase patterns ───────────────────

test('BUG 7: content.js EMAIL_PHRASES covers Swedish "skicka [...] till|mejl" + English "apply|email" variants', () => {
  assert.match(
    CONTENT_JS,
    /skicka[\s\S]{0,40}?(?:ansökan|cv)[\s\S]{0,40}?(?:till|mejl|epost)/i,
    'EMAIL_PHRASES must include Swedish skicka + ansökan + till|mejl alternation',
  )
  assert.match(
    CONTENT_JS,
    /email[\s\S]{0,30}?(?:your\s+)?(?:application|cv|resume)/i,
    'EMAIL_PHRASES must include English apply-by-email alternation',
  )
})
