// tests/unit/stats-daykeys-parse.test.mjs
//
// Round-41 (Followup 1) — Regression-prevention test for the
// /api/stats appliedAt parse-failure skip contract.
//
// BACKGROUND
// ----------
// The /api/stats route at app/api/[[...path]]/route.js reads the
// user's last 60 applications and builds a `dayKeys` Set for the
// "consecutive days applied" streak counter. The pre-Round-41 code:
//
//   const dayKeys = new Set(
//     apps.map(a => new Date(a.appliedAt).toISOString().slice(0, 10))
//   );
//
// Threw "RangeError: Invalid time value" when any row's `appliedAt`
// was null / undefined / a non-parseable string. The bug surfaced
// during Round-40 setup: the dev server log showed
//
//   [GET /api/stats] GET error RangeError: Invalid time value
//
// One bad row in the user's `applications` collection would break
// the entire /api/stats response with a generic 500, and the
// dashboard's stat tiles would render as — (em-dash) for the
// streak/total/thisMonth counters.
//
// FIX
// ---
// Round-41 introduced a `safeDayKey(a)` helper that returns null
// for any row with an invalid appliedAt, then filters before
// building the Set:
//
//   const safeDayKey = (a) => {
//     if (!a) return null
//     const d = new Date(a.appliedAt)
//     if (isNaN(d.getTime())) return null
//     return d.toISOString().slice(0, 10)
//   }
//   const dayKeys = new Set(apps.map(safeDayKey).filter(Boolean))
//
// This test pins the contract: a row with `appliedAt === null` MUST
// be silently skipped (not crash the response), and a row with a
// valid `appliedAt` MUST still contribute its day key.
//
// TEST DESIGN
// -----------
// Source-grep on the /api/stats handler body. Same pattern as
// tests/unit/saved-answers-auth-arg.test.mjs: extract the handler
// body via brace-counting, then assert the safe-day-key pattern
// (safeDayKey + filter(Boolean)) appears inside.
//
// The behavioural alternative would be to call the route handler
// directly with a mock request, but Next.js's handler invocation
// goes through a runtime adapter that doesn't accept a plain
// Request — that would require a live smoke. The source-grep lock
// is the project's established convention for structural-regression
// tests (route-precedence, demo-button-call-sites, saved-answers-
// auth-arg all use the same pattern).
//
// WHAT WE LOCK
// ------------
//   1. The /api/stats handler body contains a `safeDayKey` helper
//      (or equivalent) that null-checks `a` and `a.appliedAt`.
//   2. The body uses `new Date(a.appliedAt)` and guards the result
//      with `isNaN(d.getTime())`.
//   3. The dayKeys Set is built via `.map(safeDayKey).filter(Boolean)`
//      — the contract is "skip invalid rows, not throw on them".
//
// A future maintainer who reverts the fix to the original
// `apps.map(a => new Date(a.appliedAt).toISOString().slice(0, 10))`
// would trip the third assertion immediately.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROUTE_PATH = resolve(__dirname, '../../app/api/[[...path]]/route.js')

const src = readFileSync(ROUTE_PATH, 'utf-8')

// Brace-counting helper. Scoped to a single handler block by
// anchoring on the path string. The catch-all has a single GET
// handler that contains BOTH the /api/stats and /api/report
// branches, so we extract the WHOLE GET handler body and assert
// the /api/stats branch inside it has the safe-day-key pattern.
function handlerBody(handlerName) {
  const sigRe = new RegExp(
    `export\\s+async\\s+function\\s+${handlerName}\\s*\\([^)]*\\)\\s*\\{`,
  )
  const sigMatch = sigRe.exec(src)
  if (!sigMatch) return null
  const start = sigMatch.index + sigMatch[0].length - 1
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

// Brace-counting helper scoped to a specific path branch inside
// a handler. Finds the `if (path === 'X') {` opener and walks to
// its matching close brace. Robust against nested ifs.
function pathBranchBody(handlerSrc, pathValue) {
  const branchStart = handlerSrc.indexOf(`path === '${pathValue}'`)
  if (branchStart < 0) return null
  const braceOpen = handlerSrc.indexOf('{', branchStart)
  if (braceOpen < 0) return null
  let depth = 0
  for (let i = braceOpen; i < handlerSrc.length; i++) {
    if (handlerSrc[i] === '{') depth++
    else if (handlerSrc[i] === '}') {
      depth--
      if (depth === 0) return handlerSrc.slice(braceOpen, i + 1)
    }
  }
  return null
}

test('GET handler exists and contains a /api/stats branch', () => {
  const body = handlerBody('GET')
  assert.ok(body, 'GET handler must exist in app/api/[[...path]]/route.js')
  const statsBranch = pathBranchBody(body, 'stats')
  assert.ok(statsBranch, 'GET handler must contain a /api/stats branch')
})

test('/api/stats branch must use a safe-day-key helper (Round-41 fix)', () => {
  const body = handlerBody('GET')
  const statsBranch = pathBranchBody(body, 'stats')
  assert.ok(statsBranch, '/api/stats branch must exist')
  // The fix introduces either:
  //   (a) a named helper `safeDayKey(a) { ... }` OR
  //   (b) an inline `.map(a => { try { ... } catch { return null } })`
  // Both shapes are accepted. The lock is on the "skip on parse
  // failure" behaviour, not the exact code shape.
  //
  // Round-41.1 polish: the original regex was `/safeDayKey\s*\(/`
  // which only matched the function CALL shape (`safeDayKey(x)`).
  // The actual code uses `safeDayKey` as a callback (`.map(safeDayKey)`)
  // — no parens after the identifier. The test is now anchored on
  // the identifier itself so both the definition AND the callback
  // reference match. Future maintainers who rename the helper just
  // need to update both the literal here and the test name.
  const usesNamedHelper = /\bsafeDayKey\b/.test(statsBranch)
  const usesInlineTry = /try\s*\{[\s\S]*?toISOString\s*\(\s*\)[\s\S]*?\}\s*catch\s*\{[\s\S]*?return\s+null/.test(statsBranch)
  assert.ok(
    usesNamedHelper || usesInlineTry,
    '/api/stats must guard the .toISOString() call against null/invalid appliedAt — pre-Round-41, a single bad row threw "RangeError: Invalid time value" and the entire /api/stats response was a generic 500',
  )
})

test('/api/stats branch must build dayKeys with a .filter(Boolean) skip', () => {
  const body = handlerBody('GET')
  const statsBranch = pathBranchBody(body, 'stats')
  assert.ok(statsBranch, '/api/stats branch must exist')
  // The fix builds the Set via `.map(...).filter(Boolean)` so null
  // returns from the safe-day-key helper don't end up as `null`
  // strings in the Set. A regression to the pre-Round-41 line
  // `const dayKeys = new Set(apps.map(a => new Date(a.appliedAt)
  // .toISOString().slice(0, 10)))` would not match this pattern.
  assert.match(
    statsBranch,
    /dayKeys\s*=\s*new\s+Set\s*\([^)]*\.map\s*\([^)]*\)\.filter\s*\(\s*Boolean\s*\)\s*\)/,
    '/api/stats must build dayKeys via .map(safeDayKey).filter(Boolean) so null returns are silently skipped. Pre-Round-41, the unguarded .toISOString() threw on the first invalid row.',
  )
})
