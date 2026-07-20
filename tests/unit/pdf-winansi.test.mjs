// tests/unit/pdf-winansi.test.mjs
//
// Regression locks for the WinAnsi-encoding fix on lib/pdf-report.js
// AND its helper module lib/sanitise-winansi.js (extracted in the
// round-8 followup).
//
// pdf-lib's StandardFonts encode WinAnsi (CP1252 + smart-quote/dash/ellipsis
// extension block). Any codepoint OUTSIDE that range passed to `page.drawText`
// throws "WinAnsi cannot encode …" BEFORE any PDF object is written.
//
// After the round-8 refactor, the lock structure is split:
//
//   • CONST TABLE + FUNCTION PRESENCE — checked against the LIVE
//     helper module lib/sanitise-winansi.js. A regression that
//     REMOVES or replaces the helper would break these locks.
//
//   • USAGE — checked against lib/pdf-report.js. The PDF generator
//     must call sanitiseForWinAnsi() everywhere user data flows into
//     drawText, AND must not contain any ✈ glyph, AND must label the
//     header with "JobbPiloten" (not "✈ JobbPiloten"), AND must use
//     "J" as the avatar fallback glyph (not "✈").
//
// Run via `yarn test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_PATH = path.resolve(__dirname, '../../lib/pdf-report.js')
const HELPER_PATH = path.resolve(__dirname, '../../lib/sanitise-winansi.js')
const REPORT_SOURCE = fs.readFileSync(REPORT_PATH, 'utf-8')
const HELPER_SOURCE = fs.readFileSync(HELPER_PATH, 'utf-8')

// =============================================================================
// PART A — locks on the helper module (lib/sanitise-winansi.js)
// =============================================================================

test('lib/sanitise-winansi.js must declare a `sanitiseForWinAnsi` helper', () => {
  // The helper lives in its own module (round-8 followup). The
  // function declaration must still be present so direct callers
  // (lib/pdf-report.js) + behavioural tests can import.
  assert.match(
    HELPER_SOURCE,
    /function\s+sanitiseForWinAnsi\s*\(\s*value\s*\)/,
    'must declare `function sanitiseForWinAnsi(value)` in lib/sanitise-winansi.js',
  )
})

test('sanitiseForWinAnsi must short-circuit null/undefined → ""', () => {
  assert.match(
    HELPER_SOURCE,
    /if\s*\(\s*value\s*==\s*null\s*\)\s*return\s*['"]['"]/,
    'sanitiseForWinAnsi must short-circuit null/undefined to "" so a missing profile field does not crash',
  )
})

test('WIN_ANSI_SAFE_RANGES must include ASCII (0x00-0x7f)', () => {
  assert.match(
    HELPER_SOURCE,
    /\[\s*0x00\s*,\s*0x7f\s*\]\s*[,\s]*\/\/\s*ASCII/,
    'WIN_ANSI_SAFE_RANGES must include [0x00, 0x7f] tagged as ASCII',
  )
})

test('WIN_ANSI_SAFE_RANGES must include Latin-1 Supplement (0xa0-0xff) for Swedish å ä ö Å Ä Ö', () => {
  // CRITICAL for the JobbPiloten brand. å = 0xE5, ä = 0xE4, ö = 0xF6
  // (uppercase: Å = 0xC5, Ä = 0xC4, Ö = 0xD6). All in 0xA0-0xFF. A
  // regression that NARROWS the range would substitute every
  // Swedish character in the report.
  assert.match(
    HELPER_SOURCE,
    /\[\s*0xa0\s*,\s*0xff\s*\]\s*[,\s]*\/\/\s*Latin-1 Supplement/,
    'WIN_ANSI_SAFE_RANGES must include [0xa0, 0xff] tagged as Latin-1 Supplement (covers Swedish å ä ö)',
  )
})

test('replacement table must map ✈ (U+2708) → "JP" (the brand-side fix)', () => {
  assert.match(
    HELPER_SOURCE,
    /\[\s*0x2708\s*,\s*['"]JP['"]\s*\]/,
    'WIN_ANSI_REPLACEMENTS must map 0x2708 (✈) to "JP" in the helper module',
  )
})

test('replacement table must map smart quotes → ASCII quotes', () => {
  const expectedMappings = [
    [0x2018, "'"],
    [0x2019, "'"],
    [0x201a, "'"],
    [0x201c, '"'],
    [0x201d, '"'],
    [0x201e, '"'],
  ]
  for (const [cp, ascii] of expectedMappings) {
    assert.match(
      HELPER_SOURCE,
      new RegExp(`\\[\\s*0x${cp.toString(16)}\\s*,\\s*['"]${ascii.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*\\]`),
      `replacement table must map U+${cp.toString(16).toUpperCase()} → ${ascii} (in the helper module)`,
    )
  }
})

test('replacement table must map en-dash / em-dash → single ASCII dash (not "--")', () => {
  assert.match(
    HELPER_SOURCE,
    /\[\s*0x2013\s*,\s*['"]-['"]\s*\]/,
    'must map U+2013 (en-dash) → "-"',
  )
  assert.match(
    HELPER_SOURCE,
    /\[\s*0x2014\s*,\s*['"]-['"]\s*\]/,
    'must map U+2014 (em-dash) → "-"',
  )
})

test('helper module must export sanitiseForWinAnsi as a NAMED export (not default)', () => {
  // Required so lib/pdf-report.js's `import { sanitiseForWinAnsi }`
  // line + the direct import in tests/unit/winansi-sanitiser.test.mjs
  // resolve consistently.
  assert.match(
    HELPER_SOURCE,
    /export\s*\{[^}]*\bsanitiseForWinAnsi\b[^}]*\}/,
    'lib/sanitise-winansi.js must `export { ... sanitiseForWinAnsi ... }` (named export contract)',
  )
})

test('helper module must have ZERO @/* imports (zero-dep contract)', () => {
  // A regression that adds `import { … } from '@/lib/…'` would break
  // the direct-import contract — node --test cannot resolve the
  // @/ alias without a custom loader.
  assert.doesNotMatch(
    HELPER_SOURCE,
    /from\s+['"]@\//,
    'lib/sanitise-winansi.js must NOT import anything from the @/ alias — it is a zero-dep module',
  )
})

// =============================================================================
// PART B — locks on lib/pdf-report.js (USAGE + BRAND GLYPHS)
// =============================================================================

test('lib/pdf-report.js must IMPORT sanitiseForWinAnsi from the new helper module (round-8 contract)', () => {
  // Companion lock: the new contract says pdf-report.js consumes
  // the helper via a RELATIVE import `./sanitise-winansi.js`. A
  // regression that switches back to inline definition would break
  // this lock.
  assert.match(
    REPORT_SOURCE,
    /import\s*\{\s*sanitiseForWinAnsi\s*\}\s*from\s*['"]\.\/sanitise-winansi\.js['"]/,
    'lib/pdf-report.js must `import { sanitiseForWinAnsi } from "./sanitise-winansi.js"`',
  )
})

test('lib/pdf-report.js must NOT pass ✈ (U+2708) to ANY drawText call', () => {
  // The biggest visible regression: a ✈ glyph rendered anywhere
  // (header, avatar fallback, badge, footer, watermark) would now
  // crash pdf-lib. The fix dropped the ✈ from BOTH the header AND
  // the avatar fallback — these locks catch a re-introduction in
  // either spot.
  assert.doesNotMatch(
    REPORT_SOURCE,
    /['"]\\u2708['"]/,
    'must NOT contain the literal string "\\u2708" anywhere in lib/pdf-report.js',
  )
  assert.doesNotMatch(
    REPORT_SOURCE,
    /'✈'|"✈"/u,
    'must NOT contain the literal ✈ char (U+2708) anywhere in lib/pdf-report.js',
  )
})

test('header banner must use the wordmark "JobbPiloten" only (no plane-icon drawText)', () => {
  assert.match(
    REPORT_SOURCE,
    /page\.drawText\(\s*['"]JobbPiloten['"]\s*,[^)]*bold[^)]*\)/,
    'header must draw exactly "JobbPiloten" in bold (no plane-icon line before)',
  )
})

test('avatar fallback glyph must be capital "J" (not ✈)', () => {
  assert.match(
    REPORT_SOURCE,
    /const\s+glyph\s*=\s*['"]J['"]/,
    'drawProfilePicture fallback must set `const glyph = "J"`',
  )
  assert.doesNotMatch(
    REPORT_SOURCE,
    /const\s+glyph\s*=\s*['"]✈['"]/,
    'must NOT set `const glyph = "✈"` — regression to the brand-plane-icon fallback',
  )
})

test('every drawText call in the row loop must wrap company/title/location/source in sanitiseForWinAnsi', () => {
  // Row-loop USAGE lock: the per-application data fields are the
  // highest-risk path. Each MUST sanitise before drawText.
  const loopStart = REPORT_SOURCE.indexOf('for (const app of applications)')
  assert.ok(loopStart > 0, 'must iterate applications via `for (const app of applications)`')
  const loopBody = REPORT_SOURCE.slice(loopStart, loopStart + 4000)
  // Substring search for each field — robust against the nested
  // comma+paren in `sanitiseForWinAnsi(truncate(app.<field>, N))`.
  const expectedFields = ['company', 'title', 'location', 'source']
  for (const field of expectedFields) {
    const wrapSubstr = `sanitiseForWinAnsi(truncate(app.${field},`
    assert.ok(
      loopBody.includes(wrapSubstr),
      `row loop must wrap truncate(app.${field}, …) in sanitiseForWinAnsi() — missing substring ${JSON.stringify(wrapSubstr)}`,
    )
    const drawSubstr = `{ x: colX.${field},`
    assert.ok(
      loopBody.includes(drawSubstr),
      `row loop must draw on column colX.${field} — missing substring ${JSON.stringify(drawSubstr)}`,
    )
  }
})

test('every personal-detail row value must pass through sanitiseForWinAnsi', () => {
  // Personal details flow from MongoDB profile.fullName / profile.email
  // / etc. The labels are hard-coded Swedish text so they're fine
  // raw, but the values MUST go through the sanitiser. Use substring
  // search — a brittle two-character-class regex tripped on the
  // em-dash fallback (the empty-value sentinel we wrote is the U+2014
  // char, which falls OUTSIDE the ['"] so the prior regex missed).
  assert.ok(
    REPORT_SOURCE.includes('page.drawText(sanitiseForWinAnsi(v)'),
    'personal-detail row must wrap v (the value) in sanitiseForWinAnsi() before drawText (substring search)',
  )
  assert.ok(
    REPORT_SOURCE.includes("sanitiseForWinAnsi(v) || '—'"),
    'personal-detail row must use em-dash as empty-value fallback (literal `sanitiseForWinAnsi(v) || "\\u2014"` substring)',
  )
})
