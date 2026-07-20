// tests/unit/dashboard-contracts.test.mjs
//
// Source-grep locks for the new contracts added in the prior fix
// batch (visa fler jobb, login persistence, API hardening, 401
// redirect). Each test reads the relevant source file as a string
// and asserts an exact-phrase contract — so a future refactor that
// silently regresses one of the new behaviours trips a test before
// it ships. Mirrors the structural-lock pattern used in
// `tests/unit/load-more-jobs-visa-fler.test.mjs` and
// `tests/unit/popup-resolver.test.mjs`.
//
// The two files are split per concern so a future reader can grep
// for the specific bug and find the lock that guards it:
//   - `tests/unit/load-more-jobs-visa-fler.test.mjs`
//     (existing) → the `{jobs, hasMore}.filter()` shape bug
//   - `tests/unit/dashboard-contracts.test.mjs` (this file) → the
//     frontend slice / 401 / pagination / pageSize contracts
//   - `tests/unit/auth-cookie.test.mjs` → the cookie helper pure
//     functions

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const DASHBOARD = readFileSync('app/dashboard/page.js', 'utf8')
const API_ROUTE = readFileSync('app/api/[[...path]]/route.js', 'utf8')

// ================================================================
// app/dashboard/page.js
// ================================================================

// ---- Bug lock: visa fler jobb (the "Fler matchningar" hardcode) ----

test('Fler matchningar list uses slice(3) — no hardcoded upper bound', () => {
  // Bug: the previous code used `availableJobs.slice(3, 10).map(...)`.
  // After pagination the array could grow to 20 items but the
  // visible list capped at index 9 (10 visible). Jobs 10-19 were
  // silently hidden. Lock the slice has no upper bound.
  assert.match(
    DASHBOARD,
    /\{availableJobs\.slice\(3\)\.map\(/,
    'Fler matchningar must use slice(3) so all loaded jobs render',
  )
})

test('Fler matchningar does NOT use the old hardcoded slice(3, 10)', () => {
  // Inverse lock — if the bug regresses, this fires even if the
  // positive `slice(3)` lock above is satisfied by a separate
  // `slice(3, 10).map` somewhere else in the file.
  assert.doesNotMatch(
    DASHBOARD,
    /availableJobs\.slice\(\s*3\s*,\s*10\s*\)\.map\(/,
    'Fler matchningar must not regress to the slice(3, 10) hardcode',
  )
})

// ---- Bug lock: count hint survives end-of-stream ----

test('Count hint is inside the availableJobs.length > 0 guard (not just somewhere after it)', () => {
  // The hint text "Visar N jobb just nu" must stay visible after
  // pagination ends. Previously it was nested inside
  // `{serverHasMore && (...)}` and vanished the moment the page-1
  // fetch returned hasMore=false. Tight lock: assert the hint
  // testid appears within 2000 chars of an `availableJobs.length > 0`
  // opening paren. The window is wide enough to span the wrapper
  // <div> + the inner `{serverHasMore && (<Button/>)}` conditional
  // + the <p> that carries the hint testid, but tight enough to
  // require the hint to be inside the same conditional block (an
  // unrelated `availableJobs.length > 0` reference + a distant
  // `jobs-load-more-hint` outside the guard would be > 2000 chars
  // apart in the current source).
  assert.match(
    DASHBOARD,
    /availableJobs\.length\s*>\s*0\s*&&\s*\([\s\S]{0,2000}?jobs-load-more-hint/,
    'jobs-load-more-hint must be inside the `availableJobs.length > 0 &&` guard',
  )
})

test('Hint text appends "— alla hämtade" when serverHasMore is false', () => {
  // UX upgrade so the user knows pagination ended, not that the
  // count "disappeared". Lock the suffix is present.
  assert.match(
    DASHBOARD,
    /Visar\s*\{availableJobs\.length\}\s*jobb\s*just\s*nu\{serverHasMore\s*\?\s*''\s*:\s*['"]\s*—\s*alla\s*hämtade['"]\s*\}/,
    'hint must append "— alla hämtade" when serverHasMore is false',
  )
})

// ---- Bug lock: 401 on /api/profile redirects to /sign-in ----

test('load() detects Unauthorized response and redirects to /sign-in', () => {
  // The dashboard's load() Promise.all fetches 5 endpoints. When
  // /api/profile returns 401 (cookie expired / wiped), the previous
  // `!p?.profile` check redirected the user to /onboarding — a
  // profile-fill wizard — which is wrong: the profile exists in
  // Mongo, the user just needs to re-establish the cookie. Lock
  // the contract loosely: the source contains both the
  // `Unauthorized` string check AND a `router.replace('/sign-in')`
  // call within 800 chars (well under any reasonable function size).
  assert.match(
    DASHBOARD,
    /Unauthorized[\s\S]{0,800}router\.replace\(['"]\/sign-in['"]\)/,
    'load() must detect Unauthorized and redirect to /sign-in',
  )
})

test('load() does NOT also redirect to /onboarding in the 401 branch', () => {
  // Defensive inverse lock: make sure no future "simplification"
  // moves the 401 redirect into the same branch as the missing-
  // profile redirect. The /onboarding redirect is correct ONLY for
  // a real "no profile in Mongo" case. Anchor on the `if (` that
  // opens the 401 branch (not on the `Unauthorized` literal, which
  // could appear in a JSDoc comment 1500 chars from the redirect
  // and offset the window).
  const block = DASHBOARD.match(
    /if\s*\([\s\S]{0,800}?router\.replace\(['"]\/sign-in['"]\)/
  )
  assert.ok(block, '401 branch must exist and redirect to /sign-in')
  assert.doesNotMatch(
    block[0],
    /router\.replace\(['"]\/onboarding['"]\)/,
    '401 branch must NOT also redirect to /onboarding',
  )
})

// ================================================================
// app/api/[[...path]]/route.js
// ================================================================

// ---- Bug lock: page cap at 100 (DOS hardening) ----

test('/api/jobs-available caps `page` at 100', () => {
  // Prevents a client (or curl) from pushing a huge offset to the
  // upstream AF / Blocket API. Lock the structure of the clamp
  // (`Math.max(0, Math.min(<expr>, 100))`) using a non-greedy
  // any-character class so the inner `parseInt(..., 10)` (which
  // itself contains a comma) doesn't break the regex. The
  // non-greedy `+?` finds the first `, 100)` — which is exactly
  // the closing of the Math.min call.
  assert.match(
    API_ROUTE,
    /Math\.max\(\s*0\s*,\s*Math\.min\([\s\S]+?,\s*100\s*\)\)/,
    '`page` query param must be clamped to [0, 100]',
  )
  // The inner argument must reference the 'page' query param so a
  // future rename of the param name surfaces here.
  assert.match(
    API_ROUTE,
    /parseInt\([^)]*['"]page['"][^)]*\)/,
    'the clamp must read the `page` query param',
  )
})

// ---- Bug lock: pageSize cap at 50 (DOS hardening) ----

test('/api/jobs-available caps `pageSize` at 50', () => {
  // Prevents a single request from pulling thousands of jobs at
  // once. Lock both bounds: min 1, max 50.
  assert.match(
    API_ROUTE,
    /Math\.max\(\s*1\s*,\s*Math\.min\(\s*rawPageSize\s*,\s*50\s*\)\)/,
    '`pageSize` must be clamped to [1, 50] (Math.max(1, Math.min(rawPageSize, 50)))',
  )
})

test('/api/jobs-available honours a non-default pageSize query param', () => {
  // The route previously hardcoded `const PAGE_SIZE = 10` and
  // ignored the pageSize query param — a pre-existing test bug
  // ("page 0 with pageSize=2 returns a small slice") that we
  // fixed in the prior batch. Lock the parser reads the param.
  assert.match(
    API_ROUTE,
    /parseInt\([^)]*['"]pageSize['"][^)]*\)/,
    '`pageSize` query param must be parsed (not ignored)',
  )
})
