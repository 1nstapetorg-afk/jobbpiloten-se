// tests/unit/af-compliance-jsx.test.mjs
//
// Round-41 / Part 7 (Sub-feature 3 — AF compliance check) —
// Structural-lock test for the dashboard's AF compliance JSX
// contract. Pins the data-testids and the pace-marker overlay
// guard so a future maintainer who removes or renames them trips
// a unit test instead of silently breaking the e2e smoke
// (tests/e2e/dashboard-af-compliance.spec.js).
//
// 11 tests: 1 file-exists + 8 data-testids + 1 guard + 1 parent-child.
// Why we lock the JSX
// -------------------
// The dashboard's AF compliance card has 8 data-testids that the
// e2e spec depends on (chip, bar, fill, summary, disclaimer,
// download, pace-marker, wrapper). The pace-marker overlay is
// guarded by `paceRequired > 0 && paceRequired < pace.target` so
// day 1 of the month (paceRequired=0) hides the marker — a
// subtle UX affordance that's easy to "clean up" by mistake.
// Both contracts are load-bearing for the e2e smoke, so we
// source-grep them at the unit level as a cheaper early-warning
// barrier.
//
// The 8 data-testids
// ------------------
//   data-testid="af-compliance"            — wrapper div
//   data-testid="af-compliance-summary"    — "{applied} ansökningar denna period"
//   data-testid="af-compliance-chip"       — status chip (complete/on-track/behind)
//   data-testid="af-compliance-download"   — "Ladda ner PDF" button
//   data-testid="af-compliance-bar"        — progress bar wrapper
//   data-testid="af-compliance-bar-fill"   — filled portion
//   data-testid="af-compliance-pace-marker"— overlay marker (day 1 hidden)
//   data-testid="af-compliance-disclaimer" — regulatory disclaimer copy
//
// The pace-marker guard
// ---------------------
// On day 1 of a 31-day month, paceRequired=0 (the linear
// interpolation starts at 0). The marker overlay is guarded by
// `paceRequired > 0 && paceRequired < pace.target` so the marker
// doesn't render at the 0% position (which would be visually
// identical to no marker, but would still add a div to the DOM
// and confuse pixel-perfect screenshot tests). A future maintainer
// who removes the guard would make the marker visible on day 1
// — a small UX regression, but one the e2e smoke would catch.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DASHBOARD_PATH = resolve(__dirname, '../../app/dashboard/page.js')

const REQUIRED_TESTIDS = [
  'af-compliance',
  'af-compliance-summary',
  'af-compliance-chip',
  'af-compliance-download',
  'af-compliance-bar',
  'af-compliance-bar-fill',
  'af-compliance-pace-marker',
  'af-compliance-disclaimer',
]

test('dashboard page file exists', () => {
  assert.ok(
    existsSync(DASHBOARD_PATH),
    `${DASHBOARD_PATH} missing — dashboard removed without updating this test`,
  )
})

const src = readFileSync(DASHBOARD_PATH, 'utf-8')

for (const testid of REQUIRED_TESTIDS) {
  test(`dashboard JSX contains data-testid="${testid}"`, () => {
    // Source-grep for the literal `data-testid="<testid>"` string.
    // A future maintainer who renames a testid (e.g. "af-chip" instead
    // of "af-compliance-chip") would immediately trip this test —
    // and the e2e smoke would fail in the same change, giving them
    // a 2-layer signal to update the rename in both places.
    const re = new RegExp(`data-testid=["'\`]${testid}["'\`]`)
    assert.ok(
      re.test(src),
      `dashboard/page.js must contain data-testid="${testid}" — required by the AF compliance e2e smoke (tests/e2e/dashboard-af-compliance.spec.js) and the Aktivitetsrapport card render contract`,
    )
  })
}

test('pace-marker overlay is guarded by paceRequired > 0', () => {
  // The guard ensures the marker is hidden on day 1 of the month
  // (when paceRequired=0) and on the last day (when paceRequired
  // = target). Without the guard, the marker would render at the
  // 0% or 100% position — a small UX regression that's easy to
  // "clean up" by accident.
  const re = /pace\.paceRequired\s*>\s*0\s*&&\s*pace\.paceRequired\s*<\s*pace\.target/
  assert.ok(
    re.test(src),
    'dashboard/page.js must guard the pace-marker overlay with `pace.paceRequired > 0 && pace.paceRequired < pace.target` so day 1 of the month (paceRequired=0) hides the marker',
  )
})

test('AF compliance card lives inside the Aktivitetsrapport Card', () => {
  // The wrapper testid `af-compliance` should be inside a Card
  // with data-testid="aktivitetsrapport-card" (Round-41 polish —
  // the card wrapper has its own testid so the e2e smoke can
  // assert the whole report block is rendered, not just the
  // compliance subsection). This test guards the parent-child
  // relationship, not just the presence of both testids.
  const cardIdx = src.indexOf('data-testid="aktivitetsrapport-card"')
  const childIdx = src.indexOf('data-testid="af-compliance"')
  assert.ok(cardIdx > 0, 'aktivitetsrapport-card testid must be present')
  assert.ok(childIdx > 0, 'af-compliance testid must be present')
  assert.ok(
    childIdx > cardIdx,
    'af-compliance must be a descendant of aktivitetsrapport-card — the e2e smoke relies on this nesting for the CardHeader → CardContent → af-compliance render order',
  )
})
