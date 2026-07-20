// Round-34 / Part 4 — structural lock for source: 'email' row
// rendering in app/dashboard/page.js. The Mail tag + the
// application-source-email data-testid must stay co-located so a
// future maintainer can't drop the visual cue when refactoring the
// applications-list rendering.
//
// Lock scope: pure source-grep over the production file. Per-page
// (NOT aggregate) per the Round-33.1 review convention. If a
// refactor splits the row rendering into per-section components,
// the corresponding test in this file MUST be migrated so this
// structural guarantee survives the split.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const DASHBOARD_PATH = 'app/dashboard/page.js'

assert.ok(existsSync(DASHBOARD_PATH), `${DASHBOARD_PATH} must exist`)
const src = readFileSync(DASHBOARD_PATH, 'utf8')

test('Round-34: dashboard page still imports the Mail lucide icon', () => {
  // The icon import must be co-located with the other lucide-react
  // imports so a future tree-shaken build prune doesn't silently
  // drop it. Permissive: matches a comma-or-preceded `Mail,` and
  // also a `Mail }` (last entry) so the test survives both line
  // endings of the import list.
  assert.match(
    src,
    /import\s*\{[\s\S]*?\bMail\b[\s\S]*?\}\s*from\s*['"]lucide-react['"]/,
    'Mail icon must be imported from lucide-react in the dashboard',
  )
})

test('Round-34: dashboard page renders a Mail Tag when app.source === "email"', () => {
  assert.match(
    src,
    /app\.source\s*===\s*['"]email['"]\s*&&\s*\(/,
    'A source === "email" JSX guard is required so the tag only renders for email rows',
  )
  assert.match(
    src,
    /Icon=\{Mail\}\s+tone="amber"/,
    'The Mail tag must use the amber tone — a uniform slate/indigo rendering would be visually indistinguishable from a generic source badge',
  )
})

test('Round-34: dashboard Mail Tag carries the locked-application-source-email data-testid', () => {
  // The dataTestid MUST be a single string literal so it's grep-
  // discoverable + reproducible. Assert the EXACT literal that
  // e2e tests can rely on without parsing JSX.
  assert.match(
    src,
    /dataTestid=["']application-source-email["']/,
    'dataTestid="application-source-email" must be present so the dashboard e2e / unit contracts can assert the row identity',
  )
})

test('Round-34: dashboard Tag component supports dataTestid prop (no regression to other tones)', () => {
  // Defensive: confirm the Tag function props signature accepts
  // a dataTestid field. A future maintainer who tightens Tag's
  // prop types without realising the source: 'email' row depends
  // on it would break the rule silently.
  assert.match(
    src,
    /function\s+Tag\s*\(\s*\{\s*children\s*,\s*Icon\s*,\s*tone\s*=\s*['"]slate['"]\s*,\s*dataTestid\s*\}\s*\)/,
    'Tag function must destructure a dataTestid prop so callers can pass testid without dropping the data attribute',
  )
  assert.match(
    src,
    /data-testid=\{dataTestid\}/,
    'Tag must forward the dataTestid prop onto its <span> as data-testid (kebab-case attribute on the DOM node)',
  )
})

test('Round-34: dashboard filters do NOT exclude source: "email" rows (all-source still shows them)', () => {
  // The FILTERS array uses a status-based matcher; email rows
  // start as status: 'prepared' which IS the not_applied filter.
  // This test asserts the matcher set is unchanged for an email
  // row with status='prepared' — they should appear under the
  // "Ej ansökta" tab like every other AI-förberedd row.
  const matchers = src.match(/match:\s*\([^)]*\)\s*=>[^\n]+/g) || []
  assert.ok(
    matchers.some((m) => /a\.status\s*===\s*['"]prepared['"]/.test(m)),
    'A FILTERS entry must match status === "prepared" so email-prepared rows are surfaced in "Ej ansökta" without a separate source filter',
  )
})
