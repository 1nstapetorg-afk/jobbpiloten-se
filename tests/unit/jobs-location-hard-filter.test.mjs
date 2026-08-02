// tests/unit/jobs-location-hard-filter.test.mjs
//
// 2026-08-02 — locks the "location is a HARD filter" fix for the
// AI job matching feed. The reported bug: a user with "Göteborg" as
// their preferred location still saw jobs from Skellefteå / Stockholm
// because /api/jobs-available silently fell back from the strict
// Län-filter pass to a NATIONWIDE pass (and Blocket jobs ignore the
// AF region filter entirely). Expected behaviour: every job shown
// must be in the user's preferred location or its commuting area —
// no exceptions, unless the user explicitly opts into allSweden=1.
//
// These are structural-lock tests (source-grep style, matching the
// repo's test culture — see tests/unit/dashboard-contracts.test.mjs).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const API_ROUTE = readFileSync('app/api/[[...path]]/route.js', 'utf8')

// ---- The hard post-filter gate ----

test('jobs-available applies a hard doesJobMatchUserLocation post-filter', () => {
  // Every job returned to a user with preferred (non-remote)
  // locations must be re-checked against their locations. This is
  // the line that makes out-of-area jobs IMPOSSIBLE to surface.
  assert.match(
    API_ROUTE,
    /available\s*=\s*available\.filter\(\s*\(j\)\s*=>\s*doesJobMatchUserLocation\(\s*j\s*,\s*userLocations\s*\)\s*\)/,
    'jobs-available must hard-filter every result through doesJobMatchUserLocation',
  )
})

test('the hard gate only fires when the user HAS locations and did NOT opt into allSweden', () => {
  // The gate must not run for (a) users with no location preference
  // (they legitimately see nationwide) or (b) the explicit
  // allSweden=1 override (the dashboard's blue banner explains it).
  assert.match(
    API_ROUTE,
    /userLocations\.length\s*>\s*0\s*&&\s*!forceAllSweden/,
    'hard gate must be gated on userLocations.length > 0 && !forceAllSweden',
  )
})

test('empty result after the gate resets hasMore so pagination stops', () => {
  // If the gate (or the strict passes) leave zero jobs, the cursor
  // must not claim more pages exist — otherwise the dashboard's
  // "Visa fler jobb" button keeps requesting pages of nothing.
  assert.match(
    API_ROUTE,
    /if\s*\(\s*available\.length\s*===\s*0\s*\)\s*serverHasMore\s*=\s*false/,
    'empty available[] must reset serverHasMore to false',
  )
})

// ---- No silent nationwide fallback in the region-codes branch ----

test('region-codes branch no longer assigns fallback-nationwide', () => {
  // The reported bug's root cause: when the strict Län pass found
  // nothing, the code fell back to a nationwide pass and set
  // `locationFilterMode = 'fallback-nationwide'` — silently showing
  // Skellefteå/Stockholm jobs to a Göteborg user. After the fix,
  // `fallback-nationwide` may only be produced by the EXPLICIT
  // allSweden=1 override branch. We assert the assignment appears
  // at most twice (forceAllSweden branch + the no-locations branch)
  // and never inside the `regionCodes.length > 0` block.
  const matches = API_ROUTE.match(/locationFilterMode\s*=\s*'fallback-nationwide'/g) || []
  assert.ok(
    matches.length <= 2,
    `fallback-nationwide must only be produced by the explicit override / no-locations branches (found ${matches.length})`,
  )
})

test('the text-only pass is the ONLY loosening inside the region branch', () => {
  // After strict fails, the code may try a text-only pass, but the
  // `locationFilterMode = 'fallback-nationwide'` assignment must never
  // appear inside the `regionCodes.length > 0` block (that assignment
  // is what silently switched a Göteborg user to nationwide).
  const start = API_ROUTE.indexOf('regionCodes.length > 0')
  const endMarker = '// No locations OR all are remote-friendly'
  const end = API_ROUTE.indexOf(endMarker, start)
  assert.ok(start !== -1 && end !== -1 && end > start, 'region branch must be locatable')
  const regionBranch = API_ROUTE.slice(start, end)
  assert.ok(
    !regionBranch.includes("locationFilterMode = 'fallback-nationwide'"),
    'region-codes branch must not assign fallback-nationwide',
  )
  assert.ok(
    !regionBranch.includes("searchMode = 'loose'"),
    'region-codes branch must not assign loose search mode',
  )
  assert.match(regionBranch, /text-only/, 'region branch may still loosen to a text-only pass')
})

// ---- apply-now sample fallback respects the user's locations ----

test('apply-now prefers in-area SAMPLE_JOBS for the AI-assistenten CTA', () => {
  // The "Kör AI-assistenten nu" hero CTA previously picked a RANDOM
  // sample job — a Göteborg user could get the Northvolt row in
  // Skellefteå. The fix filters the sample pool by the user's
  // locations first.
  assert.match(
    API_ROUTE,
    /inAreaSamples\s*=\s*userLocations\.length\s*>\s*0\s*\n\s*\?\s*samplePool\.filter\(\s*j\s*=>\s*doesJobMatchUserLocation\(\s*j\s*,\s*userLocations\s*\)\s*\)\s*\n\s*:\s*samplePool/,
    'apply-now must prefer location-matching sample jobs when the user has locations',
  )
})

test('apply-now real AF candidates are also location-filtered', () => {
  // The real-search branch that feeds the AI modal must not hand a
  // Göteborg user an out-of-area AF hit either.
  assert.match(
    API_ROUTE,
    /inAreaCandidates\s*=\s*userLocations\.length\s*>\s*0\s*\n\s*\?\s*candidates\.filter\(\s*j\s*=>\s*doesJobMatchUserLocation\(\s*j\s*,\s*userLocations\s*\)\s*\)\s*\n\s*:\s*candidates/,
    'apply-now real-job candidates must be filtered by the user locations',
  )
})
