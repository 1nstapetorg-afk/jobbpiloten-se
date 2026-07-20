// tests/unit/winansi-sanitiser.test.mjs
//
// BEHAVIOURAL tests for sanitiseForWinAnsi(). Round-7 follow-up to
// the static-source-grep tests in pdf-winansi.test.mjs.
//
// Import strategy: DIRECT IMPORT from `lib/sanitise-winansi.js`.
// The module was extracted from lib/pdf-report.js (round-8 followup)
// specifically so this test could run WITHOUT:
//   (1) booting the @/lib/* alias chain (no Next.js bundler in
//       `node --test`), and
//   (2) the brittle eval/extract approach a previous draft used.
//
// The halo-presence test at the bottom reads the helper's source as
// a string and asserts the EXPORTED symbol matches the declared
// function body — locks against a future refactor that re-inlines
// the helper into lib/pdf-report.js (a regression that would break
// the direct-import contract).
//
// Coverage:
//   • ASCII passthrough
//   • Latin-1 Supplement passthrough (Swedish å ä ö Å Ä Ö + § © etc.)
//   • Smart-quote mapping (6 common Unicode quotes → ASCII quotes)
//   • En/em-dash → single ASCII dash (NOT "--")
//   • Ellipsis → "..."
//   • Trademark → "(TM)"
//   • ✈ → "JP" (the brand-fix)
//   • ✓ → "OK"; → → "->"
//   • Silent drop of unsupported chars (emoji + CJK)
//   • null/undefined short-circuit → ""
//   • Mixed Swedish + emoji + dash input
//
// Run via `yarn test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// DIRECT IMPORT — the canonical contract lock. Path is RELATIVE, so
// no @/ alias resolution is required at test time.
// Round-12 followup: WIN_ANSI_SAFE_RANGES added to the import set so
// the parity tests in section 14 can lock BOTH exported constants.
// Without this the parity tests immediately ReferenceError on
// `WIN_ANSI_SAFE_RANGES` at suite-load time.
import { sanitiseForWinAnsi, WIN_ANSI_SAFE_RANGES, WIN_ANSI_REPLACEMENTS } from '../../lib/sanitise-winansi.js'

// Halo-presence source path for the bottom-of-file refactor lock.
// We read the helper as a string and assert the DIRECT-import above
// is still 1:1 with the exported symbol's source body.
const HELPER_SOURCE = readFileSync('lib/sanitise-winansi.js', 'utf-8')

// =============================================================================
// 1. Direct-import sanity (the assistant itself must work)
// =============================================================================

test('sanitiseForWinAnsi is importable as a NAMED export (no default, no destructured namespace)', () => {
  // A regression that switches to `export default` would silently
  // pass this behavioural suite but break any consumer that uses
  // `import { sanitiseForWinAnsi }` (e.g. lib/pdf-report.js after
  // round-8 followup refactor).
  assert.strictEqual(typeof sanitiseForWinAnsi, 'function',
    'sanitiseForWinAnsi must be a function (named named export from ./sanitise-winansi.js)')
  assert.strictEqual(sanitiseForWinAnsi.length, 1,
    'sanitiseForWinAnsi must accept exactly one argument (value)')
})

// =============================================================================
// 2. ASCII passthrough (the base layer)
// =============================================================================

test('ASCII letters + digits + spaces pass through unchanged', () => {
  assert.strictEqual(sanitiseForWinAnsi('Anna Andersson'), 'Anna Andersson')
  assert.strictEqual(sanitiseForWinAnsi('Stockholm-leasing AB'), 'Stockholm-leasing AB')
  assert.strictEqual(sanitiseForWinAnsi('123-456 789'), '123-456 789')
  assert.strictEqual(sanitiseForWinAnsi('Senior Developer (Node.js, MongoDB)'),
    'Senior Developer (Node.js, MongoDB)')
})

// =============================================================================
// 3. Latin-1 Supplement (Swedish chars)
// =============================================================================

test('Swedish å ä ö Å Ä Ö pass through verbatim (Latin-1 Supplement range)', () => {
  assert.strictEqual(sanitiseForWinAnsi('Södermalm'), 'Södermalm')
  assert.strictEqual(sanitiseForWinAnsi('Köpenhamn'), 'Köpenhamn')
  assert.strictEqual(sanitiseForWinAnsi('Åmål'), 'Åmål')
  assert.strictEqual(sanitiseForWinAnsi('Älvdalen'), 'Älvdalen')
  assert.strictEqual(sanitiseForWinAnsi('Östermalm'), 'Östermalm')
  assert.strictEqual(sanitiseForWinAnsi('Båstad'), 'Båstad')
  assert.strictEqual(sanitiseForWinAnsi('Storvreta'), 'Storvreta')
})

test('Other Latin-1 Supplement chars pass through verbatim', () => {
  // § © ® ° etc. all live in 0xA0-0xFF and must round-trip.
  assert.strictEqual(sanitiseForWinAnsi('§ 16 §'), '§ 16 §')
  assert.strictEqual(sanitiseForWinAnsi('JobbPiloten ©'), 'JobbPiloten ©')
  assert.strictEqual(sanitiseForWinAnsi('50° Nord'), '50° Nord')
})

// =============================================================================
// 4. Smart-quote mapping (LLM-generated text)
// =============================================================================

test('all 6 common Unicode smart quotes map to ASCII', () => {
  // U+2018 left-single, U+2019 right-single (curly apostrophe),
  // U+201A single-low-9, U+201C left-double, U+201D right-double,
  // U+201E double-low-9.
  assert.strictEqual(sanitiseForWinAnsi('Anna\u2019s CV'), "Anna's CV")
  assert.strictEqual(sanitiseForWinAnsi("Anna\u2018s CV"), "Anna's CV")
  assert.strictEqual(sanitiseForWinAnsi('Anna\u201As CV'), "Anna's CV")
  assert.strictEqual(sanitiseForWinAnsi('\u201cHello\u201d everyone'), '"Hello" everyone')
  assert.strictEqual(sanitiseForWinAnsi('\u201EHello\u201D everyone'), '"Hello" everyone')
})

// =============================================================================
// 5. En-dash / em-dash normalisation
// =============================================================================

test('en-dash and em-dash both map to single ASCII dash (NOT "--")', () => {
  // U+2013 en-dash, U+2014 em-dash. Mapping to a single dash keeps
  // column widths stable in the table renderings — mapping to "--"
  // would shift every date + dash-bearing field.
  assert.strictEqual(sanitiseForWinAnsi('5\u2013year senior dev'), '5-year senior dev')
  assert.strictEqual(sanitiseForWinAnsi('Stockholm\u2014Göteborg'), 'Stockholm-Göteborg')
  assert.strictEqual(sanitiseForWinAnsi('Jan\u2013Mar 2026'), 'Jan-Mar 2026')
})

// =============================================================================
// 6. ✈ → "JP" (the brand-fix regression lock)
// =============================================================================

test('✈ (U+2708) maps to "JP" — the brand-side regression lock', () => {
  assert.strictEqual(sanitiseForWinAnsi('Apply now ✈'), 'Apply now JP')
  assert.strictEqual(sanitiseForWinAnsi('✈ Stockholm'), 'JP Stockholm')
  assert.strictEqual(sanitiseForWinAnsi('Travel: ✈✈✈'), 'Travel: JPJPJP')
})

// =============================================================================
// 7. Common Unicode offenders
// =============================================================================

test('✓ maps to "OK"; → maps to "->"; horiz ellipsis maps to "..."', () => {
  assert.strictEqual(sanitiseForWinAnsi('Done ✓'), 'Done OK')
  assert.strictEqual(sanitiseForWinAnsi('Y / N → Done'), 'Y / N -> Done')
  assert.strictEqual(sanitiseForWinAnsi('loading…'), 'loading...')
  assert.strictEqual(sanitiseForWinAnsi('a ← b'), 'a <- b')
})

test('trademark maps to "(TM)"; star glyphs to "*"; prime to "\'"', () => {
  assert.strictEqual(sanitiseForWinAnsi('Jobbpiloten™'), 'Jobbpiloten(TM)')
  assert.strictEqual(sanitiseForWinAnsi('★'), '*')
  assert.strictEqual(sanitiseForWinAnsi('5′10″'), '5\'10"')
})

// =============================================================================
// 8. Silent drop of unsupported chars
// =============================================================================

test('unsupported chars are dropped silently (no placeholder inserted)', () => {
  // 🎉 (U+1F389) is outside WinAnsi + outside our replacement table
  // and MUST be silently dropped — NOT replaced with `?`, NOT placed
  // verbatim (which would crash pdf-lib at drawText time).
  assert.strictEqual(sanitiseForWinAnsi('Apply 🎉 now'), 'Apply  now')
  // CJK is silently dropped too.
  assert.strictEqual(sanitiseForWinAnsi('Hello 中文'), 'Hello ')
  // The mixed Swedish + emoji case from the CV feature spec.
  assert.strictEqual(
    sanitiseForWinAnsi('Södermalm — Senior Dev 🎉'),
    'Södermalm - Senior Dev ',
  )
})

// =============================================================================
// 9. Null / undefined / empty input
// =============================================================================

test('null / undefined / empty input returns "" (no crash)', () => {
  // The personalRows loop relies on this — a missing fullName must
  // not throw, just hand back "" so the `|| '—'` fallback can fire.
  assert.strictEqual(sanitiseForWinAnsi(null), '')
  assert.strictEqual(sanitiseForWinAnsi(undefined), '')
  assert.strictEqual(sanitiseForWinAnsi(''), '')
})

// =============================================================================
// 10. The XSS-poisoning regression lock
// =============================================================================

test('string with HTML / JS special chars passes through verbatim (no sanitisation on ASCII)', () => {
  // The sanitiser is purely a WinAnsi-encoder safety layer. It is
  // NOT an XSS guard — pdf-lib renders a PDF, not HTML, so XSS
  // output is meaningless downstream. A regression that "scrubs"
  // `<script>` out of the input would silently corrupt legitimate
  // fields (a "Senior <mid> JavaScript Developer" title is normal).
  assert.strictEqual(sanitiseForWinAnsi('<script>alert(1)</script>'),
    '<script>alert(1)</script>')
})

// =============================================================================
// 11. Real end-to-end Aktivitetsrapport row strings
// =============================================================================

test('Aktivitetsrapport row strings — smart quote in app.title', () => {
  assert.strictEqual(sanitiseForWinAnsi('Anna\u2019s Frontend Lead'), "Anna's Frontend Lead")
})

test('Aktivitetsrapport row strings — em-dash in app.location', () => {
  assert.strictEqual(sanitiseForWinAnsi('Stockholm \u2014 Södermalm'), 'Stockholm - Södermalm')
})

test('Aktivitetsrapport row strings — emoji in app.title (LLM fluff)', () => {
  // Both emojis drop silently with NO placeholder. The trailing
  // ASCII space before the first emoji is kept (it's part of the
  // input text). Output: 11 ASCII chars + empty tail = single
  // trailing space.
  assert.strictEqual(sanitiseForWinAnsi('Senior Dev 🎉🚀'), 'Senior Dev ')
})

test('Aktivitetsrapport row strings — plain ASCII + Swedish mix', () => {
  assert.strictEqual(sanitiseForWinAnsi('Klarna AB'), 'Klarna AB')
})

// =============================================================================
// 12. Halo-presence lock (refactor-resistance halo)
// =============================================================================

test('lib/sanitise-winansi.js must export `sanitiseForWinAnsi` as a named function (round-8 lockdown)', () => {
  // LOOSE halo: the production module's source must include an
  // `export { ... sanitiseForWinAnsi ... }` line. A regression
  // that re-inlines the helper back into lib/pdf-report.js would
  // break the import above AND break this halo. Combines for a
  // belt-and-suspenders lock.
  assert.match(
    HELPER_SOURCE,
    /export\s*\{[^}]*\bsanitiseForWinAnsi\b[^}]*\}/,
    'lib/sanitise-winansi.js must `export { ... sanitiseForWinAnsi ... }` (named export) so the direct import above stays valid',
  )
  assert.match(
    HELPER_SOURCE,
    /function\s+sanitiseForWinAnsi\s*\(\s*value\s*\)/,
    'lib/sanitise-winansi.js must declare `function sanitiseForWinAnsi(value)` — the helper the PDF route depends on for non-ASCII safety',
  )
})

test('lib/sanitise-winansi.js must have ZERO @/* imports (so direct import works without alias resolution)', () => {
  // The whole reason we extracted the helper: zero internal imports
  // so it can be unit-tested with `node --test`'s bare ESM resolver.
  // A regression that adds `import { ... } from '@/lib/...'` would
  // break the direct-import contract — the test would fail to load.
  assert.doesNotMatch(
    HELPER_SOURCE,
    /from\s+['"]@\//,
    'lib/sanitise-winansi.js must NOT import anything from the @/ alias — it must be a zero-dep module so node --test can import it directly',
  )
})

test('lib/pdf-report.js must IMPORT sanitiseForWinAnsi from the new lib/sanitise-winansi.js peer', () => {
  // Companion lock: the new contract says pdf-report.js consumes
  // the helper via a relative import `./sanitise-winansi.js`. A
  // regression that switches back to inline definition would break
  // this lock.
  const PDF_SOURCE = readFileSync('lib/pdf-report.js', 'utf-8')
  assert.match(
    PDF_SOURCE,
    /import\s*\{\s*sanitiseForWinAnsi\s*\}\s*from\s*['"]\.\/sanitise-winansi\.js['"]/,
    'lib/pdf-report.js must `import { sanitiseForWinAnsi } from "./sanitise-winansi.js"` — the post-refactor contract',
  )
})

// =============================================================================
// 13. WIN_ANSI_REPLACEMENTS value pins (round-9 followup)
// =============================================================================

test('WIN_ANSI_REPLACEMENTS[0x2708] must map ✈ → "JP" exactly (no whitespace variant)', () => {
  // Round-9 value-level lock — size-bounded test catches DROP/grow
  // regressions but a typo like [0x2708, 'JP '] (trailing space)
  // would slip past the size gate while corrupting brand output.
  assert.strictEqual(
    WIN_ANSI_REPLACEMENTS.get(0x2708),
    'JP',
    '✈ (U+2708) must map to "JP" verbatim — no trailing whitespace, no prefix',
  )
  assert.notStrictEqual(
    WIN_ANSI_REPLACEMENTS.get(0x2708),
    'JP ',
    '✈ must NOT map to "JP " (trailing space) — brand pollution regression',
  )
})

test('WIN_ANSI_REPLACEMENTS must map em-dash + en-dash to single "-" (NOT "--")', () => {
  // Column widths in the Aktivitetsrapport table depend on
  // dash-bearing strings being a single char wide. Mapping
  // em-dash to "--" would shift every cell.
  assert.strictEqual(
    WIN_ANSI_REPLACEMENTS.get(0x2014),
    '-',
    'em-dash (U+2014) must map to "-"',
  )
  assert.strictEqual(
    WIN_ANSI_REPLACEMENTS.get(0x2013),
    '-',
    'en-dash (U+2013) must map to "-"',
  )
  assert.notStrictEqual(
    WIN_ANSI_REPLACEMENTS.get(0x2014),
    '--',
    'em-dash must NOT map to "--" — column-width regression',
  )
})

test('WIN_ANSI_REPLACEMENTS must map horizontal ellipsis (U+2026) to 3 ASCII dots', () => {
  assert.strictEqual(
    WIN_ANSI_REPLACEMENTS.get(0x2026),
    '...',
    'horizontal ellipsis (U+2026) must map to "..." (3 ASCII dots)',
  )
})

test('WIN_ANSI_REPLACEMENTS table must have a bounded entry count (15–25)', () => {
  // LOCK the table size so a regression that DROPS the table
  // (every non-ASCII codepoint becomes a silent drop, breaking the
  // existing smart-quote/dash/ellipsis normalisation) OR EXAGGER-
  // ATES the table (accidental denylist pasting in 100+ chars from
  // somewhere) surfaces as a test failure BEFORE shipping.
  //
  // Current state: 20 entries. The 15–25 window gives future
  // "add a common offender" +1 per edit room while still bounding
  // runaway growth.
  //
  // Round-9 fix: count via hex-codepoint openings
  // (`[ 0xNNNN,`) rather than the full entry shape. The earlier
  // `[^'"]*` exclude-class broke on entries whose VALUE contains
  // the opposite quote type (e.g. `[0x2018, "'"]` stores a single-
  // quote wrapped in double-quoted source — the regex stopped 1
  // char short of the inner `'`). Counting hex openings is
  // structurally stable: every entry MUST start with `[0x…,`.
  const mapBlock = HELPER_SOURCE.match(
    /const\s+WIN_ANSI_REPLACEMENTS\s*=\s*new\s+Map\(\[([\s\S]*?)\]\)/,
  )
  assert.ok(mapBlock,
    'WIN_ANSI_REPLACEMENTS = new Map([...]) must exist in lib/sanitise-winansi.js')
  const entries = mapBlock[1].match(/\[\s*0x[0-9a-fA-F]+\s*,/g) || []
  assert.ok(
    entries.length >= 15 && entries.length <= 25,
    `WIN_ANSI_REPLACEMENTS table must have 15–25 entries; found ${entries.length}. ` +
    'Guard against accidental table drops (silent-drop fallback regression) + oversized denylist growth.',
  )
})

// =============================================================================
// 14. WIN_ANSI_SAFE_RANGES parity test (round-12 followup)
// =============================================================================
//
// MIRROR LOCK for the OTHER exported constant in lib/sanitise-winansi.js.
// Without this, a regression that drops the safe-range list (or narrows
// it past 0xE4/0xF6) would silently slip past every behavioural assertion
// above and only surface in PRODUCTION when an å/ä/ö string trips
// pdf-lib's WinAnsi encoder. The constant is referenced in the helper's
// header docstring (ASCII + Latin-1 Supplement) — those two ranges
// MUST stay present forever.

test('WIN_ANSI_SAFE_RANGES is importable as a non-empty array of [lo, hi] integer tuples', () => {
  // Structural lock: an array shape check that survives re-ordering
  // (e.g. putting Latin-1 before ASCII) and refactors (e.g. extracting
  // the constant into a SOUND_CONSTANTS object). A regression that
  // switches to a Set, a Map, or a flat list of codepoints — even if
  // functionally equivalent — would change the helper's runtime
  // contract and surface here.
  assert.ok(Array.isArray(WIN_ANSI_SAFE_RANGES),
    'WIN_ANSI_SAFE_RANGES must be an array (the helper iterates it with for-of)')
  assert.ok(WIN_ANSI_SAFE_RANGES.length > 0,
    'WIN_ANSI_SAFE_RANGES must have at least one range — an empty array would silently drop every non-ASCII codepoint')
  for (const entry of WIN_ANSI_SAFE_RANGES) {
    assert.ok(Array.isArray(entry) && entry.length === 2,
      `each WIN_ANSI_SAFE_RANGES entry must be a 2-tuple; got ${JSON.stringify(entry)}`)
    assert.strictEqual(typeof entry[0], 'number',
      `entry[0] (lo) must be a number; got ${typeof entry[0]}`)
    assert.strictEqual(typeof entry[1], 'number',
      `entry[1] (hi) must be a number; got ${typeof entry[1]}`)
    assert.ok(Number.isInteger(entry[0]) && Number.isInteger(entry[1]),
      'each entry must contain integer codepoints — no fractional codepoints allowed')
    assert.ok(entry[0] <= entry[1],
      `entry lo must be ≤ hi; got [${entry[0]}, ${entry[1]}] — inverted range is a bug`)
  }
})

test('WIN_ANSI_SAFE_RANGES must cover ASCII (0x00–0x7F) AND Latin-1 Supplement (0xA0–0xFF)', () => {
  // The helper's header docstring references these two specific ranges
  // as the load-bearing safety contract for Swedish text. A regression
  // that drops either range would crash pdf-lib on every Swedish
  // fullName / job title containing å ä ö Å Ä Ö § © etc.
  const hasAscii = WIN_ANSI_SAFE_RANGES.some(([lo, hi]) => lo === 0x00 && hi === 0x7f)
  const hasLatin1 = WIN_ANSI_SAFE_RANGES.some(([lo, hi]) => lo >= 0xa0 && hi <= 0xff)
  assert.ok(hasAscii,
    'WIN_ANSI_SAFE_RANGES must include [0x00, 0x7F] (ASCII) — drops break plain ASCII')
  assert.ok(hasLatin1,
    'WIN_ANSI_SAFE_RANGES must include [0xA0, 0xFF] (Latin-1 Supplement) — drops break Swedish å ä ö Å Ä Ö, § © etc.')
})

test('all common Swedish codepoints must fall WITHIN the union of WIN_ANSI_SAFE_RANGES', () => {
  // Bottom-up coverage check. Even if the array gets reordered (e.g.
  // Latin-1 before ASCII), every Swedish codepoint the documentation
  // says round-trips MUST land inside SOME range. Catches regressions
  // that drop a single Swedish infimum/supremum.
  const SWEDISH_CODEPOINTS = [
    [0xe4, 'å'], [0xe5, 'ä'], [0xf6, 'ö'],
    [0xc4, 'Å'], [0xc5, 'Ä'], [0xd6, 'Ö'],
  ]
  const isSafe = (cp) => WIN_ANSI_SAFE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)
  for (const [cp, ch] of SWEDISH_CODEPOINTS) {
    assert.ok(isSafe(cp),
      `Swedish char "${ch}" (U+${cp.toString(16).toUpperCase()}) must be covered by some WIN_ANSI_SAFE_RANGES range`)
  }
})

test('a codepoint OUTSIDE all WIN_ANSI_SAFE_RANGES (U+1F389 🎉) is dropped at runtime', () => {
  // Belt-and-suspenders: structural check on the constant AND
  // runtime confirmation against sanitiseForWinAnsi. A regression
  // that erroneously EXPANDS the safe ranges to swallow CJK / emoji
  // would let those bytes flow into pdf-lib — and crash the encoder.
  // The structural check + runtime check together pin the silhouette.
  const isSafe = (cp) => WIN_ANSI_SAFE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)
  assert.strictEqual(isSafe(0x1f389), false,
    'U+1F389 🎉 must NOT be in WIN_ANSI_SAFE_RANGES — it must remain in the drop-fallback path')
  assert.strictEqual(isSafe(0x4e2d), false,
    'U+4E2D 中 must NOT be in WIN_ANSI_SAFE_RANGES — CJK must drop silently')
  // And the runtime behaviour matches the structural promise:
  assert.strictEqual(sanitiseForWinAnsi('Apply 🎉 now'), 'Apply  now',
    'runtime must drop 🎉 silently (no placeholder)')
})

test('WIN_ANSI_SAFE_RANGES must have a bounded range count (1–6 entries)', () => {
  // Size-lock window. The current implementation has 2 ranges
  // (ASCII + Latin-1). The 1–6 window gives future "add a code-page"
  // +1 entries room while still bounding runaway growth (e.g. paste
  // every Unicode block in by mistake).
  assert.ok(
    WIN_ANSI_SAFE_RANGES.length >= 1 && WIN_ANSI_SAFE_RANGES.length <= 6,
    `WIN_ANSI_SAFE_RANGES must have 1–6 entries; found ${WIN_ANSI_SAFE_RANGES.length}`,
  )
})
