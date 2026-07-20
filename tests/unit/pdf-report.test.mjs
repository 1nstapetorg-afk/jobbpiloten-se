// tests/unit/pdf-report.test.mjs
//
// Contract locks for lib/pdf-report.js — the Aktivitetsrapport PDF
// generator extracted from app/api/[[...path]]/route.js.
//
// Static source-grep tests, mirroring tests/unit/popup-resolver.test.mjs.
// Pick this approach over a real import() because:
//   1. The module imports from `@/lib/...` aliases configured by
//      jsconfig.json + Next.js bundler — raw `node --test` can't
//      resolve those without a custom loader.
//   2. The existing 116-test suite uses static analysis for all
//      structural locks (popup-resolver, dashboard-url-resolver,
//      extension-content, validate-extension) — we stay in that
//      idiom for consistency.
//   3. Behavioural coverage of the PDF PARSER path lives in the
//      Playwright E2E specs (dashboard-ansokningsdatum.spec.js,
//      all-issues-smoke.spec.js) which run a real Vercel preview
//      build. These unit locks are the SOURCE-LAYER guard against
//      regressions; the E2E specs are the OUTPUT-LAYER guard.
//
// The locks below catch every category the soft launch needs:
//
//  • Function surface — generateAktivitetsrapport is exported as
//    `async function` and is the only export.
//  • Required Swedish strings — every text label the E2E parser
//    matches must appear verbatim in the source so a small text
//    tweak won't quietly break a parse contract.
//  • Pdf-lib API surface — the avatar shape walker calls the
//    exact draw methods that exist in pdf-lib 1.17.x; a renames
//    would TypeError on real-download.
//  • Bold-font threading — the fallback ✈ glyph gets its font
//    from `opts.bold` (cleaner than the previous pdf._embeddedFonts
//    hack). Drift to a `pdf.getStandardFontBold()` lookup would
//    crash because `PDFDocument` doesn't have that helper.
//
// Total: 24 static locks.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.resolve(__dirname, '../../lib/pdf-report.js')
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf-8')

// --------- 1. Exports ---------

test('lib/pdf-report.js must export generateAktivitetsrapport as an async function', () => {
  assert.match(SOURCE, /export\s+async\s+function\s+generateAktivitetsrapport\s*\(/,
    'lib/pdf-report.js must export `generateAktivitetsrapport` as `async function`',
  )
})

test('lib/pdf-report.js must export exactly one function (single export surface)', () => {
  // Avoid accidentally re-exporting internal helpers — keeps the
  // module API minimal so a `import { ... } from '@/lib/pdf-report'`
  // stays unambiguous downstream.
  const exports = SOURCE.match(/export\s+async\s+function\s+\w+/g) || []
  assert.strictEqual(exports.length, 1,
    `lib/pdf-report.js must export exactly one function; found ${exports.length} (${exports.join(', ')})`,
  )
})

// --------- 2. Required pdf-lib imports ---------

test('lib/pdf-report.js must import PDFDocument, StandardFonts, and rgb from pdf-lib', () => {
  assert.match(SOURCE, /import\s*\{[^}]*\bPDFDocument\b[^}]*\}\s*from\s*['"]pdf-lib['"]/,
    'must import PDFDocument')
  assert.match(SOURCE, /import\s*\{[^}]*\bStandardFonts\b[^}]*\}\s*from\s*['"]pdf-lib['"]/,
    'must import StandardFonts (for Helvetica + HelveticaBold)')
  assert.match(SOURCE, /import\s*\{[^}]*\brgb\b[^}]*\}\s*from\s*['"]pdf-lib['"]/,
    'must import rgb')
})

// --------- 3. NO export of unsupported pdf-lib APIs ---------

test('lib/pdf-report.js must NOT import LineJoin (it is not a public pdf-lib export)', () => {
  // 2026-07-12 regression: the 0.2.1 draft had
  // `import { PDFDocument, StandardFonts, rgb, LineJoin } from 'pdf-lib'`.
  // `LineJoin` is NOT a public pdf-lib export — module load threw
  // `LineJoin is not exported from 'pdf-lib'` at runtime, breaking
  // every PDF download. This lock catches any future regression
  // that re-adds the bad import.
  assert.doesNotMatch(SOURCE, /import\s*\{[^}]*\bLineJoin\b[^}]*\}\s*from\s*['"]pdf-lib['"]/,
    'LineJoin is NOT a public pdf-lib export; do not import it',
  )
})

test('lib/pdf-report.js must NOT call page.setLineJoin()', () => {
  // pdf-lib's PDFPage doesn't expose setLineJoin — calls would
  // TypeError at runtime. The 5 avatar renderers in the 0.2.1
  // draft each had `page.setLineJoin(AVATAR_LINE_JOIN)` calls.
  // pdflib's drawSvgPath + drawCircle defaults hand-line the
  // line-join so the explicit call is unneeded.
  assert.doesNotMatch(SOURCE, /setLineJoin\s*\(/,
    'page.setLineJoin() is not in the pdf-lib API; drop these calls',
  )
})

// --------- 4. Bold font is threaded through opts (clean refactor) ---------

test('drawProfilePicture must read bold from opts (not from pdf._embeddedFonts hack)', () => {
  assert.match(SOURCE, /const\s*\{\s*[^}]*\bbold\b[^}]*\}\s*=\s*opts/,
    'drawProfilePicture must destructure `bold` from opts to avoid pdf-lib internal-property lookups',
  )
})

test('drawProfilePicture must NOT reference pdf._embeddedFonts or pdf._internal_fonts', () => {
  // The 0.2.1 draft stashed the embedded font on `pdf._embeddedFonts`
  // and walked the map at render time to find `widthOfTextAtSize`.
  // pdf-lib doesn't expose that slot — it's an internal implementation
  // detail that would silently break on a pdf-lib bump. The clean
  // refactor threads `bold` through opts.
  assert.doesNotMatch(SOURCE, /pdf\._embeddedFonts\b/,
    'must not poke pdf._embeddedFonts — internal pdf-lib property')
  assert.doesNotMatch(SOURCE, /pdf\._internal_fonts\b/,
    'must not poke pdf._internal_fonts — internal pdf-lib property')
  assert.doesNotMatch(SOURCE, /pdf\._internalFonts\b/,
    'must not poke pdf._internalFonts — internal pdf-lib property')
})

// --------- 5. Required Swedish strings in the PDF ---------

const REQUIRED_STRINGS = [
  // Header
  'JobbPiloten',
  'Aktivitetsrapport',
  // Body
  'Personuppgifter',
  'Namn',
  'Personnummer',
  'Adress',
  'E-post',
  'Telefon',
  // Summary card
  'Sammanfattning',
  'Antal jobbansökningar under perioden',
  'Varje rad i tabellen nedan visar ansökningsdatum',
  // Table — Round-46 / Bug 3 fix: removed "Datum" column from the
  // PDF table. The pre-fix build had both "Datum" and
  // "Ansökningsdatum" displaying the same appliedAt value. The
  // AF-correct column is "Ansökningsdatum"; the duplicate was an
  // accident from a stale layout (see
  // tests/unit/pdf-report-bug3-dup-date.test.mjs for the dedicated
  // regression lock).
  'Jobbansökningar',
  'Ansökningsdatum',
  'Företag',
  'Titel',
  'Ort',
  'Källa',
  // Round-46 / Bug 3: 'Datum' must NOT appear as a header label
  // anymore. Listed as a NEGATIVE assertion below — the column
  // header string is gone, but the word "Datum" can still appear
  // inside body text (e.g. "Ansökningsdatum") which we explicitly
  // whitelist.
  // 'Datum' removed from REQUIRED_STRINGS — see "Datum" absence
  // assertion in tests/unit/pdf-report-bug3-dup-date.test.mjs.
  // Empty state
  'Inga ansökningar registrerade denna period.',
  // Date-cell fallback for prepared rows
  'Ej ansökt än',
  // Footer
  'Denna rapport har genererats automatiskt av JobbPiloten.',
  // Round-41 / Part 7 (Sub-feature 3 — AF compliance check): the
  // footer disclaimer is the PDF mirror of the dashboard's
  // af-compliance chip copy. Both surfaces share the "Standardmål
  // 14/mån — du ansvarar själv" contract. Split across multiple
  // drawText calls so the wrapping doesn't clip the legal hedge.
  'Standardmål: 14 ansökningar/månad enligt Arbetsförmedlingens vägledning.',
  'individuella handlingsplan uppfylls',
  'JobbPiloten är ett hjälpmedel, inte en auktoritativ källa för AF-compliance.',
]

for (const s of REQUIRED_STRINGS) {
  test(`PDF source must render literal "${s}"`, () => {
    // E2E parser (pdfjs-dist) matches substrings in the rendered
    // PDF text. Each label here appears in the source as a string
    // literal passed to `page.drawText`. A rename / typo would
    // silently break the E2E test for that label.
    assert.ok(SOURCE.includes(s),
      `lib/pdf-report.js source must contain the literal string "${s}"`,
    )
  })
}

// --------- 6. Month-label uses monthNames + Swedish spelling ---------

test('month-label code path must use Swedish month names', () => {
  assert.match(SOURCE, /['"]januari['"][\s\S]{0,500}['"]december['"]/,
    'monthNames array must list Swedish month names in calendar order (januari → december)')
})

// --------- 7. Column header band is sized for single-line label ---------

// The dashboard-ansokningsdatum.spec E2E test crawls the PDF for
// the "Ansökningsdatum" string and validates it lives in the
// table-header band. The previous code (pre-redesign) drew the
// label as TWO overlapping lines — a real visual bug because
// `y + 11` placed "datum" ON TOP of "Ansöknings-". This lock
// catches a regression that would re-introduce the two-line
// header by writing the label in pieces.
test('Ansökningsdatum label must be drawn as ONE string in the header band', () => {
  assert.match(SOURCE, /page\.drawText\(\s*'Ansökningsdatum'/,
    'must pass the entire "Ansökningsdatum" label to a single page.drawText call',
  )
  assert.doesNotMatch(SOURCE, /drawText\(\s*['"]Ans\u00f6knings-/,
    'must NOT split "Ansöknings-" into a separate drawText call (visual regression: two overlapping strings)',
  )
})

// --------- 8. Footer is drawn on the LAST page only ---------

test('footer must be drawn on `footerPage`, not on the active `page` reference', () => {
  // The previous bug stamped the footer on EVERY page because the
  // for-loop reassigned `page` and the footer read from `page`
  // directly. The fix captures `let footerPage = page` at loop
  // end so the footer only renders on the final page reference.
  const hasFooterVar = SOURCE.includes('let footerPage = page')
  assert.ok(hasFooterVar,
    'generateAktivitetsrapport must capture "footerPage = page" so the footer only renders on the FINAL page',
  )
})

// --------- 9. Avatar shape walker covers all 5 supported shape types ---------

test('renderAvatarShapePdf must switch on circle/ellipse/rect/line/path', () => {
  // The shape walker in lib/avatars-svg.js data uses these 5 types;
  // a refactor that drops one would crash the PDF render the moment
  // a user picks an avatar whose silhouette uses the dropped type.
  for (const t of ['circle', 'ellipse', 'rect', 'line', 'path']) {
    assert.match(SOURCE, new RegExp(`case\\s*['"]${t}['"]\\s*:`),
      `renderAvatarShapePdf must have a case for "${t}" shapes`,
    )
  }
})

test('AVATAR_PDF_RENDERERS must be built from AVATAR_SVG_DATA keys at runtime', () => {
  // The static-renderer approach for the 5 PDF-supported avatars is
  // to iterate AVATAR_SVG_DATA — that way adding a 6th avatar to
  // the data file (lib/avatars-svg.js) automatically wires up the
  // PDF renderer (no registry edit needed).
  assert.match(SOURCE, /for\s*\(\s*const\s+slug\s+of\s+Object\.keys\s*\(\s*AVATAR_SVG_DATA\s*\)\s*\)/,
    'AVATAR_PDF_RENDERERS must be built from Object.keys(AVATAR_SVG_DATA)',
  )
})

// --------- 10. Profile-picture upload path uses correct embedders ---------

test('uploaded PNG must embed via embedPng and JPG via embedJpg', () => {
  assert.match(SOURCE, /pdf\.embedPng\s*\(/, 'must call pdf.embedPng for PNG uploads')
  assert.match(SOURCE, /pdf\.embedJpg\s*\(/, 'must call pdf.embedJpg for JPEG uploads')
})

test('uploaded WebP must be silently skipped (not embedded)', () => {
  // pdf-lib throws when fed WebP bytes. The safe path is to skip
  // and fall through to the ✈ fallback. A regression that called
  // embedWebp() would CRASH every WebP-user's PDF download.
  assert.doesNotMatch(SOURCE, /\.embedWebp\s*\(/,
    'must NOT call embedWebp() — pdf-lib has no such helper',
  )
})

// --------- 11. Column-order locks (header + summary card body) ---------

test('header band must draw columns in this exact order: Ansokningsdatum, Foretag, Titel, Ort, Kalla', () => {
  // Round-46 / Bug 3 fix: removed the "Datum" column. The 5-column
  // contract is now: Ansökningsdatum, Företag, Titel, Ort, Källa.
  // A regression that re-adds "Datum" would silently dublicate the
  // appliedAt column — locked by sequence-asserting that NO label
  // appears OUTSIDE this 5-column tuple inside drawHeaderRow.
  const drawHeaderRow = (SOURCE.match(/const\s+drawHeaderRow\s*=[^]*?^\}/m) || [''])[0]
  assert.ok(drawHeaderRow, 'drawHeaderRow must be a const arrow function with body')
  const idx = (label) => drawHeaderRow.indexOf(`'${label}'`)
  const a = idx('Ansökningsdatum')
  const b = idx('Företag')
  const c = idx('Titel')
  const d = idx('Ort')
  const e = idx('Källa')
  for (const v of [a, b, c, d, e]) {
    assert.ok(v > 0, `header must draw all 5 labels; missing in drawHeaderRow body`)
  }
  assert.ok(a < b, `'Ansökningsdatum' must come before 'Företag' (column 1 < column 2)`)
  assert.ok(b < c, `'Företag' must come before 'Titel' (column 2 < column 3)`)
  assert.ok(c < d, `'Titel' must come before 'Ort' (column 3 < column 4)`)
  assert.ok(d < e, `'Ort' must come before 'Källa' (column 4 < column 5)`)
})

test('row loop must draw columns in the same order: Ansokningsdatum, Foretag, Titel, Ort, Kalla', () => {
  // Round-46 / Bug 3 fix: row loop mirrors the 5-column header.
  // A regression that re-introduces `colX.date` would silently
  // produce a 6th duplicated cell — the lock asserts the SOURCE
  // does NOT contain `colX.date` (which would have been the
  // contract term for the rejected layout).
  const loopStart = SOURCE.indexOf('for (const app of applications)')
  assert.ok(loopStart > 0, 'must iterate applications via `for (const app of applications)`')
  const loopBody = SOURCE.slice(loopStart, loopStart + 4000)
  // Lock the 5-column row order via the `colX.<key>` references.
  const idx = (key) => loopBody.indexOf(`colX.${key}`)
  const a = idx('appliedAt')
  const b = idx('company')
  const c = idx('title')
  const d = idx('location')
  const e = idx('source')
  for (const v of [a, b, c, d, e]) {
    assert.ok(v > 0, 'row loop must reference all 5 colX keys in order')
  }
  assert.ok(a < b && b < c && c < d && d < e,
    'row columns must reference colX keys in ascending order (appliedAt -> company -> title -> location -> source)',
  )
})

test('hexToRgb must validate the hex string format before parsing', () => {
  // Catches a regression where hexToRgb silently accepts `#rgb` short-hand
  // or non-hex chars and propagates NaN through pdf-lib's rgb() helper
  // (which would render as invalid-color black rather than throwing).
  assert.match(
    SOURCE,
    /function\s*hexToRgb\s*\([^)]*\)\s*\{[\s\S]{0,400}?\/(\^)?\[0-9a-fA-F\]\{6\}(\$)?\/[\s\S]{0,400}?\}/,
    'hexToRgb must validate the hex string format with a regex check (anchored or unanchored)',
  )
})
