// tests/unit/saved-answers-auth-arg.test.mjs
//
// Round-40 — Regression-prevention structural lock for the
// `requireAuth(req)` contract in app/api/saved-answers/route.js.
//
// BACKGROUND
// ----------
// In Round-38 the saved-answers route was added with all 3 handlers
// (GET, POST, DELETE) calling `requireAuth()` with no argument.
// `requireAuth(request)` then calls `resolveAuthState(request)` →
// `getDemoUserId(request)`, which does
// `request.headers?.get('x-demo-user-id')`. With `request = undefined`,
// this threw "Cannot read properties of undefined (reading 'headers')"
// — silently caught by the route's try/catch and returned as 500 with
// a generic "Kunde inte spara svaret." message. The bug was caught
// only by the live smoke in Round-40 (scripts/smoke-saved-answers.mjs)
// because the unit tests (509/509 at the time) mocked or skipped the
// runtime auth path.
//
// FIX
// ---
// app/api/saved-answers/route.js now passes `req` to `requireAuth(req)`
// in all 3 handlers. The GET handler additionally got the `req`
// parameter (it was `GET()` — no parameter at all).
//
// This test pins the post-fix shape so a future maintainer who
// refactors the route and accidentally drops the `req` argument
// trips a unit test BEFORE the smoke (or a production POST) breaks.
//
// TEST DESIGN
// -----------
// Source-grep on the route file. Same pattern as
// tests/unit/route-precedence.test.mjs and
// tests/unit/demo-button-call-sites.test.mjs. A 3-test file, one
// per handler, each asserting the `requireAuth(req)` literal appears
// INSIDE the handler body — not just in the file.
//
// A future maintainer who:
//   • removes the `req` argument from `requireAuth(...)` → all 3
//     tests fail with a precise handler name in the error message
//   • renames `req` to something else → all 3 tests fail
//   • reverts the fix to call `requireAuth()` (no arg) → all 3
//     tests fail
//
// A behavioural test (mocking `@/lib/auth` → `requireAuth` and calling
// the handler with a mock request) would also catch this, but the
// source-grep approach is the project's established convention for
// structural-lock regression tests and avoids the Next.js handler
// invocation complexity (Next.js wraps the exported handler in a
// runtime adapter that doesn't accept a plain Request — the test
// would need to go through a full `fetch` call against a running
// server, which is the smoke's job, not a unit test's).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROUTE_PATH = resolve(__dirname, '../../app/api/saved-answers/route.js')

const src = readFileSync(ROUTE_PATH, 'utf-8')

// Helper: extract the body of a handler function (signature up to
// the matching closing brace) so the assertion is scoped to the
// specific handler rather than the whole file. A future maintainer
// who re-introduces a `requireAuth()` (no arg) call OUTSIDE a
// handler (e.g. in a top-level helper) would not be caught by this
// test, but the project's convention is that the 3 handlers are
// the only places that call requireAuth.
function handlerBody(handlerName) {
  // Match `export async function HANDLER(` and capture up to the
  // first top-level `}` that closes the handler. Next.js's
  // route.js files keep the handlers top-level (no nesting), so
  // a brace-count scan from the first `{` after the function
  // signature is sufficient.
  const sigRe = new RegExp(
    `export\\s+async\\s+function\\s+${handlerName}\\s*\\([^)]*\\)\\s*\\{`,
  )
  const sigMatch = sigRe.exec(src)
  if (!sigMatch) return null
  const start = sigMatch.index + sigMatch[0].length - 1 // index of `{`
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

test('GET handler must call requireAuth(req) — Round-40 regression lock', () => {
  const body = handlerBody('GET')
  assert.ok(body, 'GET handler must exist in app/api/saved-answers/route.js')
  // The lock: the literal `requireAuth(req)` must appear inside the
  // GET handler body. A future regression that drops the `req`
  // argument (back to `requireAuth()`) would not match this pattern.
  assert.match(
    body,
    /requireAuth\(\s*req\s*\)/,
    'GET handler must call requireAuth(req) — the Round-40 fix. A regression to requireAuth() (no arg) throws "Cannot read properties of undefined (reading headers)" inside getDemoUserId and surfaces as a confusing 500.',
  )
})

test('POST handler must call requireAuth(req) — Round-40 regression lock', () => {
  const body = handlerBody('POST')
  assert.ok(body, 'POST handler must exist in app/api/saved-answers/route.js')
  assert.match(
    body,
    /requireAuth\(\s*req\s*\)/,
    'POST handler must call requireAuth(req) — the Round-40 fix. A regression to requireAuth() (no arg) throws inside getDemoUserId and surfaces as a generic 500 with "Kunde inte spara svaret."',
  )
})

test('DELETE handler must call requireAuth(req) — Round-40 regression lock', () => {
  const body = handlerBody('DELETE')
  assert.ok(body, 'DELETE handler must exist in app/api/saved-answers/route.js')
  assert.match(
    body,
    /requireAuth\(\s*req\s*\)/,
    'DELETE handler must call requireAuth(req) — the Round-40 fix. A regression to requireAuth() (no arg) throws inside getDemoUserId and surfaces as a generic 500 with "Kunde inte radera svaret."',
  )
})
