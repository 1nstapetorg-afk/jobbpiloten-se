// tests/unit/af-compliance-pace.test.mjs
//
// Round-41 / Part 7 (Sub-feature 3 — AF compliance check) —
// Unit tests for the getAfCompliancePace helper exported from
// app/dashboard/page.js.
//
// The helper computes the user's current-month application count
// (status: applied / user-sent / confirmed), the AF standardmål
// (14/month), and a linear-pace interpolation that tells the
// dashboard whether the user is "behind", "on-track", or
// "complete" relative to the standardmål.
//
// The dashboard's Aktivitetsrapport card and the PDF report
// (lib/pdf-report.js) both consume this logic (or its surface
// contract) so the helper's behaviour is load-bearing for the
// user-visible compliance messaging.
//
// Why we export it from the dashboard page rather than a lib
// module: the helper is a pure date math function with zero
// React/Next.js dependencies. Co-locating with the only
// consumer keeps the diff small. The export is named so an
// import is possible without circular-dep risk.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAfCompliancePace } from '../../lib/af-compliance.js'

// Build a fixed "now" at a known point in the month so the
// linear-pace interpolation is deterministic across runs.
// 2026-07-15T12:00:00 local — mid-month, 15 elapsed days of 31.
const NOW_MID_MONTH = new Date(2026, 6, 15, 12, 0, 0)
const NOW_END_MONTH = new Date(2026, 6, 30, 12, 0, 0)
const NOW_START_MONTH = new Date(2026, 6, 1, 12, 0, 0)

const app = (overrides = {}) => ({
  status: 'applied',
  appliedAt: new Date(2026, 6, 10, 12, 0, 0).toISOString(),
  ...overrides,
})

test('returns target=14 and pace fields', () => {
  const pace = getAfCompliancePace([], NOW_MID_MONTH)
  assert.equal(pace.target, 14, 'AF standardmål is 14/month')
  assert.equal(pace.applied, 0, 'no apps → applied=0')
  // Mid-month (day 15 of 31) → paceRequired = floor(15/31 * 14) = 6
  assert.equal(pace.paceRequired, 6, 'mid-month linear-pace interpolation')
  assert.equal(pace.elapsedDays, 15, 'elapsed days at mid-month')
  assert.equal(pace.totalDays, 31, 'July has 31 days')
  assert.equal(pace.status, 'behind', '0 apps at day 15 = behind')
})

test('complete when applied >= 14', () => {
  const apps = Array.from({ length: 14 }, () => app())
  const pace = getAfCompliancePace(apps, NOW_MID_MONTH)
  assert.equal(pace.applied, 14, '14 applied apps counted')
  assert.equal(pace.status, 'complete', '14+ apps = complete')
})

test('on-track when applied >= paceRequired but < target', () => {
  // Day 15 of 31, paceRequired = 6. 7 apps is on-track.
  const apps = Array.from({ length: 7 }, () => app())
  const pace = getAfCompliancePace(apps, NOW_MID_MONTH)
  assert.equal(pace.applied, 7)
  assert.equal(pace.status, 'on-track', '7 apps at day 15 = on-track')
})

test('behind when applied < paceRequired', () => {
  // Day 15 of 31, paceRequired = 6. 2 apps is behind.
  const apps = Array.from({ length: 2 }, () => app())
  const pace = getAfCompliancePace(apps, NOW_MID_MONTH)
  assert.equal(pace.applied, 2)
  assert.equal(pace.status, 'behind', '2 apps at day 15 = behind')
})

test('ignores prepared-only apps (user has not sent yet)', () => {
  // 'prepared' alone does NOT count — the user might never click
  // "Skicka". Only applied/user-sent/confirmed count.
  const apps = [
    app({ status: 'prepared', appliedAt: new Date(2026, 6, 10).toISOString() }),
    app({ status: 'prepared', appliedAt: new Date(2026, 6, 12).toISOString() }),
    app({ status: 'applied', appliedAt: new Date(2026, 6, 14).toISOString() }),
  ]
  const pace = getAfCompliancePace(apps, NOW_MID_MONTH)
  assert.equal(pace.applied, 1, 'only the one applied app counts')
})

test('counts confirmed and user-sent as well as applied', () => {
  // Legacy status values + the new 'confirmed' value all count.
  const apps = [
    app({ status: 'user-sent' }),
    app({ status: 'confirmed' }),
    app({ status: 'applied' }),
  ]
  const pace = getAfCompliancePace(apps, NOW_START_MONTH)
  assert.equal(pace.applied, 3, 'all three status values count')
})

test('excludes apps from previous months', () => {
  // June 1 — apps from late June should NOT count toward July pace.
  const apps = [
    app({ appliedAt: new Date(2026, 5, 28, 12, 0, 0).toISOString() }), // June
    app({ appliedAt: new Date(2026, 6, 5, 12, 0, 0).toISOString() }),  // July
  ]
  const pace = getAfCompliancePace(apps, NOW_START_MONTH)
  assert.equal(pace.applied, 1, 'only the July app counts at month start')
})

test('falls back to userSentAt when appliedAt is missing', () => {
  // Legacy rows from the pre-status-rework window carry
  // userSentAt but not appliedAt. The helper should accept
  // either field.
  const apps = [
    { status: 'applied', userSentAt: new Date(2026, 6, 10, 12, 0, 0).toISOString() },
  ]
  const pace = getAfCompliancePace(apps, NOW_MID_MONTH)
  assert.equal(pace.applied, 1, 'userSentAt fallback works')
})

test('handles missing appliedAt/userSentAt gracefully', () => {
  // A bad row with no date should NOT crash — the helper skips it.
  // Round-41.1 (Code-reviewer catch): the pre-fix test passed 3 rows
  // (null appliedAt, no date fields at all, and a valid `app()` call)
  // but only the third row had a valid date — so applied=1, not 2.
  // The fix gives the second row a valid `userSentAt` so the test
  // exercises BOTH the skip-on-invalid-appliedAt path AND the
  // userSentAt-fallback path. applied=2 is now correct: row 2 via
  // userSentAt fallback, row 3 directly.
  const apps = [
    { status: 'applied', appliedAt: null },
    { status: 'confirmed', userSentAt: new Date(2026, 6, 12, 12, 0, 0).toISOString() },
    app(),
  ]
  const pace = getAfCompliancePace(apps, NOW_MID_MONTH)
  assert.equal(pace.applied, 2, 'null appliedAt row is skipped, userSentAt row counted via fallback, app() row counted directly')
})

test('end-of-month complete state', () => {
  // Day 30 of 31, paceRequired = floor(30/31 * 14) = 13.
  const apps = Array.from({ length: 13 }, () => app())
  const pace = getAfCompliancePace(apps, NOW_END_MONTH)
  assert.equal(pace.applied, 13)
  assert.equal(pace.paceRequired, 13, 'end-of-month paceRequired is 13')
  assert.equal(pace.status, 'on-track', '13 apps at day 30 = on-track (not yet complete)')
})

test('empty input returns 0 / behind at mid-month', () => {
  const pace = getAfCompliancePace([], NOW_MID_MONTH)
  assert.equal(pace.applied, 0)
  assert.equal(pace.paceRequired, 6)
  assert.equal(pace.status, 'behind')
})

test('handles null/undefined input without throwing', () => {
  // The dashboard may pass `apps` as null during the initial
  // load (before the /api/applications fetch resolves). The
  // helper must not crash.
  const fromNull = getAfCompliancePace(null, NOW_MID_MONTH)
  assert.equal(fromNull.applied, 0)
  const fromUndefined = getAfCompliancePace(undefined, NOW_MID_MONTH)
  assert.equal(fromUndefined.applied, 0)
})

test('paceRequired=0 on day 1 of month (no pace marker expected)', () => {
  // The dashboard's pace-marker overlay is guarded by
  // `paceRequired > 0 && paceRequired < target`. Day 1 of a
  // 31-day month yields paceRequired = floor(1/31 * 14) = 0
  // (the linear interpolation starts at 0). The helper still
  // returns a valid pace — the guard is a UI-side concern.
  const day1 = new Date(2026, 6, 1, 12, 0, 0)
  const pace = getAfCompliancePace([], day1)
  assert.equal(pace.paceRequired, 0, 'day 1 of 31-day month → paceRequired=0')
  assert.equal(pace.elapsedDays, 1)
  assert.equal(pace.status, 'behind', '0 apps on day 1 = behind (would be on-track if paceRequired >= 1)')
})
