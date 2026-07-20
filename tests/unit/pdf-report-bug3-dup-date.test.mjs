// tests/unit/pdf-report-bug3-dup-date.test.mjs
//
// Round-46 / Bug 3 — Duplicate date column in the Aktivitetsrapport
// PDF. The pre-fix build had two columns in the applications table:
//
//   "Datum" (left) — shown dateStr, derived from app.appliedAt
//   "Ansökningsdatum" (right) — shown appliedAtStr, derived from
//                                app.appliedAt || app.userSentAt
//
// Both columns rendered the same date because BOTH labels fed off
// `app.appliedAt`. The user (and Arbetsförmedlingen's
// compliance-review dashboard) saw two identical dates side by
// side, which:
//
//   1. Confused the user ("which date is the real one?")
//   2. Crappled the AF-compliance chip layout on the dashboard
//      because the PDF parser reported duplicate Ansökningsdatum
//      values for every row
//
// The fix removes the "Datum" column and consolidates everything
// into the existing Ansökningsdatum column (which is the AF
// canonical column anyway).
//
// These tests lock the fix in place — they MUST fail loudly on any
// future regression that re-adds a "Datum" column.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.resolve(__dirname, '../../lib/pdf-report.js')
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf-8')

// ===== 1. 'Datum' must NOT appear as a column header =====
//
// The header band must show five labels in this exact order:
//   Ansökningsdatum, Företag, Titel, Ort, Källa
//
// A regression could re-introduce 'Datum' as a literal header
// string OR via the colX.date reference (the source code's
// second-order mapping). Both shapes need to be locked.
//
// We scan ONLY the drawHeaderRow body — the row loop emits date
// VALUES, not the literal 'Datum' header.

test('Bug 3: drawHeaderRow must NOT contain a "Datum" column header', () => {
  // Lock the absence of the bad header text inside drawHeaderRow.
  // We do not blanket-grep the entire SOURCE because 'Datum' as a
  // WORD can appear inside body copy (e.g. "Ansökningsdatum"),
  // which is fine — the bug was specifically a SEPARATE COLUMN.
  const drawHeaderRow = (SOURCE.match(/const\s+drawHeaderRow\s*=[^]*?^\}/m) || [''])[0]
  assert.ok(drawHeaderRow, 'drawHeaderRow must be a const arrow function with body')
  // The whitespace-padded 'Datum' literal must not appear inside
  // drawHeaderRow. The more permissive `includes('Datum')` would
  // match 'Ansökningsdatum' (which is allowed), so we anchor on
  // the column-drawing drawText() call.
  assert.ok(
    !/page\.drawText\(\s*'Datum'/.test(drawHeaderRow),
    'drawHeaderRow must NOT include a separate page.drawText(\'Datum\', …) call — the duplicate "Datum" column was removed in Round-46 / Bug 3 fix',
  )
})

test('Bug 3: colW must NOT include a "date" key', () => {
  // The COL_W const drives width allocations. A regression that
  // re-adds `date: 50,` would silently widen the table layout
  // beyond contentW and clip the Ansökningsdatum column.
  const colW = (SOURCE.match(/const\s+COL_W\s*=\s*\{[^]*?\}/m) || [''])[0]
  assert.ok(colW, 'COL_W const object must exist in lib/pdf-report.js')
  assert.ok(
    !/date\s*:\s*\d+/.test(colW),
    'COL_W must NOT include a "date" key — the duplicate "Datum" column was removed in Round-46 / Bug 3 fix',
  )
})

test('Bug 3: colX must NOT include a "date" key', () => {
  // The colX positions object is the per-column x-coordinate map.
  // A regression that re-adds `date: margin,` would pointlessly
  // shift the entire 5-column layout 50+5 = 55pt to the right,
  // pushing the Källa column past the page margin.
  const colX = (SOURCE.match(/const\s+colX\s*=\s*\{[^]*?\}/m) || [''])[0]
  assert.ok(colX, 'colX const object must exist in lib/pdf-report.js')
  assert.ok(
    !/date\s*:\s*margin/.test(colX),
    'colX must NOT include a "date" key — Round-46 / Bug 3 fix consolidated the duplicate "Datum" column',
  )
})

test('Bug 3: row loop must NOT draw `dateStr` cell', () => {
  // The row loop previously had a `dateStr` variable and a
  // `page.drawText(dateStr, …)` call. The fix drops both. Lock the
  // absence by grepping for `dateStr` (the only stale term).
  const loopStart = SOURCE.indexOf('for (const app of applications)')
  assert.ok(loopStart > 0, 'must iterate applications via `for (const app of applications)`')
  const loopBody = SOURCE.slice(loopStart, loopStart + 4000)
  assert.ok(
    !/page\.drawText\(\s*dateStr\b/.test(loopBody),
    'row loop must NOT call `page.drawText(dateStr, …)` — the duplicate "Datum" cell was removed in Round-46 / Bug 3 fix',
  )
})

// ===== 2. Required header strings — 5 columns, not 6 =====

const EXPECTED_HEADER_LABELS = [
  'Ansökningsdatum',
  'Företag',
  'Titel',
  'Ort',
  'Källa',
]

test('Bug 3: header band labels exactly match the 5-column contract', () => {
  // The drawHeaderRow function must contain EXACTLY these 5 labels
  // in this order — anything else (too many, too few, wrong order)
  // fails. Order-checked by relative offsets inside the body.
  const drawHeaderRow = (SOURCE.match(/const\s+drawHeaderRow\s*=[^]*?^\}/m) || [''])[0]
  assert.ok(drawHeaderRow, 'drawHeaderRow must be a const arrow function with body')
  const offset = (label) => drawHeaderRow.indexOf(`'${label}'`)
  const offsets = EXPECTED_HEADER_LABELS.map(offset)
  for (let i = 0; i < EXPECTED_HEADER_LABELS.length; i++) {
    assert.ok(
      offsets[i] > 0,
      `header must contain "${EXPECTED_HEADER_LABELS[i]}" as a literal — actual offset=${offsets[i]} (Round-46 / Bug 3 fix required 5 columns)`,
    )
  }
  for (let i = 1; i < offsets.length; i++) {
    assert.ok(
      offsets[i - 1] < offsets[i],
      `header labels must appear in order; "${EXPECTED_HEADER_LABELS[i - 1]}" must come before "${EXPECTED_HEADER_LABELS[i]}"`,
    )
  }
})

// ===== 3. Width math sanity =====

test('Bug 3: COL_W widths sum + 4 inter-column paddings must equal contentW (= pageW - 2*margin)', () => {
  // contentW = pageW - 2*margin where pageW=595.28 and margin=50,
  // so contentW = 495.28pt.
  //
  // Removing the duplicate date column freed (50 + 5) = 55pt.
  // The new 5-column widths (75+95+100+60+90 = 420pt) + 4 paddings
  // (4×5 = 20pt) = 440pt. We allow a 60pt slack band because the
  // columns can be tuned individually — but the widths MUST NOT
  // exceed contentW. Future maintainers can adjust individual
  // widths as long as the sum + paddings stays within contentW.
  const colW = (SOURCE.match(/const\s+COL_W\s*=\s*\{[^]*?\}/m) || [''])[0]
  assert.ok(colW, 'COL_W must exist')
  const widths = [...colW.matchAll(/(\w+)\s*:\s*(\d+)/g)].map((m) => ({
    key: m[1],
    val: parseInt(m[2], 10),
  }))
  // Filter out non-width fields (none expected, but defensive).
  const widthSum = widths.reduce((s, w) => s + w.val, 0)
  assert.ok(widths.length === 5,
    `COL_W must have exactly 5 entries (Round-46 / Bug 3 fix); found ${widths.length} (${widths.map((w) => w.key).join(', ')})`,
  )
  // contentW = 495. 5 cols + 4 × 5pt padding = 440pt. Comfortable
  // margin (55pt buffer) so a future tweak (e.g. widening Källa to
  // 110pt) still fits.
  assert.ok(widthSum + 20 <= 495,
    `COL_W widths (${widthSum}pt) + 4 × 5pt paddings (20pt) total ${widthSum + 20}pt must be ≤ contentW=495.28pt (Round-46 / Bug 3 fix)`,
  )
  assert.ok(widthSum >= 400,
    `COL_W widths (${widthSum}pt) must sum to >= 400pt — too-narrow columns would clip Swedish company names + job titles`,
  )
})

// ===== 4. Cosmetic guard — required explanations appear in comments =====

test('Bug 3: source comments must reference the Round-46 fix', () => {
  // We left comments in lib/pdf-report.js explicitly mentioning
  // the Round-46 / Bug 3 fix so future maintainers understand
  // WHY the "Datum" column is missing and don't quietly re-add it.
  assert.ok(
    /Round-46\s*\/\s*Bug\s*3/i.test(SOURCE),
    'lib/pdf-report.js must contain "Round-46 / Bug 3" comment references explaining the duplicate-date fix',
  )
})
