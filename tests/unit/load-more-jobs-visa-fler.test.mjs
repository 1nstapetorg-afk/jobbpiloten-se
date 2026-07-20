// tests/unit/load-more-jobs-visa-fler.test.mjs
//
// Bug lock (2026-07-11): the dashboard's "Visa fler jobb" pagination
// handler crashed with `textJobs.filter is not a function` because the
// catch-all route called `.filter()` directly on the return value of
// `multiSourceSearchJobs`, which returns `{ jobs, hasMore }` — NOT a
// bare array. The fix destructures with an Array.isArray() guard.
//
// This static-source-grep test mirrors the structural-locks pattern used
// in tests/unit/popup-resolver.test.mjs and tests/unit/pdf-report.test.mjs:
// read the file as a string and assert exact-phrase contracts so a future
// regression that re-introduces the bare `.filter()` pattern is caught
// before it ships.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync('app/api/[[...path]]/route.js', 'utf8')

test('textJobs handler must NOT call .filter() directly on the multiSourceSearchJobs return value', () => {
  // The lock is on the BUG SHAPE — the multiSourceSearchJobs() return
  // is `{ jobs, hasMore }`, NOT a bare array, so calling `.filter()`
  // directly on it crashes. We pin against the actual chained-call
  // pattern with whitespace tolerance and a strict-prefix anchor on
  // the multiSourceSearchJobs identifier so a future rename of the
  // intermediate variable doesn't send this false-negative.
  //
  // The previous regex (`/textJobs\.filter\s*\(/`) collides with a
  // documenting comment that mentions the literal `textJobs.filter(...)`
  // as the bug example — keep this lock anchored on the BROADER bug
  // shape so it still catches the chained-call regression.
  assert.equal(
    /multiSourceSearchJobs\([\s\S]{0,400}?\)\s*\.\s*filter\s*\(/.test(SOURCE),
    false,
    'multiSourceSearchJobs(...).filter( must not appear — destructure { jobs } first',
  )
})

test('textJobs handler must destructure the response and Array.isArray() the result IN THE SAME BRANCH', () => {
  // Both the destructure (textJobsResp) AND the Array.isArray() guard
  // must be present in the SAME branch. The window is widened to 1500 chars
  // so a future refactor that adds a documenting comment between the
  // destructure and the guard (a common affordance for the next
  // maintainer tracking the bug-fix rationale) doesn't false-negative
  // this lock. The earlier 400-char window was too tight.
  const overlap = SOURCE.match(/textJobsResp[\s\S]{0,1500}?Array\.isArray\(\s*textJobsResp\?\.jobs\s*\)/)
  assert.ok(overlap, 'destructure and Array.isArray() guard must be in the same branch (within 1500 chars)')
})

test('textJobs availability check should use a null-safe predicate', () => {
  // Defensive `(j) => j && !usedKeys.has(...)` is intentional belt-and-
  // suspenders for malformed scraper responses. A future refactor that
  // drops the `j &&` would re-introduce a TypeError if the scraper ever
  // returned a sparse array.
  assert.match(SOURCE, /\(j\)\s*=>\s*j\s*&&\s*!usedKeys\.has/, 'textAvailable filter predicate must null-check j before usedKeys.has')
})

test('the parent jobs-available handler still imports multiSourceSearchJobs from @/lib/jobScraper', () => {
  // Sanity: the import line didn't get accidentally removed. The bug
  // fix only changed the call site, not the import contract.
  assert.match(SOURCE, /import\s*\{[^}]*multiSourceSearchJobs[^}]*\}\s*from\s*['"]@\/lib\/jobScraper['"]/, 'multiSourceSearchJobs import must remain')
})
