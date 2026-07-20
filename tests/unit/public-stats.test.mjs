// Round-34 / Public stats route — source-grep + privacy contract
// tests for the GET /api/public/stats aggregate endpoint.
//
// The route is the soft-launch landing-page widget: no auth, no
// per-user data, just aggregate counts formatted for direct
// rendering. The structural tests below pin the response shape so
// the landing page (app/page.js) and the route stay bytewise
// aligned. The privacy tests pin the rounding + minimum-count
// floors — a regression that exposed `appsCount: 7` to a public
// visitor would be an immediate GDPR concern at the moment the
// first sign-up happens.
//
// Lock scope: source-grep over app/api/[[...path]]/route.js. Per
// the Round-33.1 review convention, this is a SINGLE-file lock so
// a maintainer who refactors the route knows exactly which test
// to migrate.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const ROUTE_PATH = 'app/api/[[...path]]/route.js'

assert.ok(existsSync(ROUTE_PATH), `${ROUTE_PATH} must exist`)
const src = readFileSync(ROUTE_PATH, 'utf8')

test('Round-34: /api/public/stats GET handler is unauthenticated (no Clerk "auth()" check inside the block)', () => {
  // Pull out the handler block. The auth-protected handlers in the
  // same file (e.g. /api/profile) use await auth() — a public
  // route MUST NOT gate on it. Cheap heuristic: the public/stats
  // branch must appear BEFORE any resolveUserId() call within
  // itself.
  const startIdx = src.indexOf("path === 'public/stats'")
  assert.ok(startIdx > -1, '/api/public/stats GET handler block must exist in the catchall route')
  const inside = src.slice(startIdx, startIdx + 2000)
  const block = [inside]
  // Forbidden tokens — none of these should appear inside the
  // public/stats block (defence-in-depth; catches accidental
  // copy-paste from a protected handler).
  assert.equal(
    /await\s+auth\s*\(/.test(block[0]),
    false,
    'public/stats MUST NOT call auth() — it is a no-auth widget for the landing page',
  )
  assert.equal(
    /resolveUserId\s*\(/.test(block[0]),
    false,
    'public/stats MUST NOT call resolveUserId() — it is no-auth and never writes to per-user collections',
  )
})

test('Round-34: /api/public/stats returns the locked response shape (appsCount + interviewRate + cities)', () => {
  const startIdx = src.indexOf("path === 'public/stats'")
  assert.ok(startIdx > -1, 'public/stats block must exist')
  const inside = src.slice(startIdx, startIdx + 2000)
  const block = [inside]
  assert.match(inside, /appsCount/, 'response must include appsCount')
  assert.match(inside, /appsCountDisplayText/, 'response must include appsCountDisplayText (Swedish-formatted)')
  assert.match(inside, /interviewRate/, 'response must include interviewRate')
  assert.match(inside, /interviewRateDisplayText/, 'response must include interviewRateDisplayText')
  assert.match(inside, /cities/, 'response must include cities array')
})

test('Round-34: /api/public/stats enforces a MIN_VISIBLE_COUNT floor to prevent per-user delta leakage', () => {
  const startIdx = src.indexOf("path === 'public/stats'")
  assert.ok(startIdx > -1, 'public/stats block must exist')
  const inside = src.slice(startIdx, startIdx + 2000)
  const block = [inside]
  // Acceptable floors: 100 (the docstring's chosen default). The
  // soft-launch minimum protects against +1 inference attacks when
  // user N is small.
  assert.match(
    inside,
    /MIN_VISIBLE_COUNT\s*=\s*\d+/,
    'MIN_VISIBLE_COUNT constant must be defined inside the route so the floor is locally grep-discoverable',
  )
  assert.match(
    inside,
    /appsCount\s*>=\s*MIN_VISIBLE_COUNT/,
    'Display-text branch must gate on MIN_VISIBLE_COUNT so a small-N cohort never broadcasts per-user counts',
  )
})

test('Round-34: /api/public/stats uses countDocuments against the applications collection (no raw doc exposure)', () => {
  // Aggregate-only reads — never return individual application docs
  // to the public visitor. The catchall route reads applications
  // for /api/applications (per-user) — public/stats MUST use
  // countDocuments so leakage is impossible.
  const startIdx = src.indexOf("path === 'public/stats'")
  assert.ok(startIdx > -1, 'public/stats block must exist')
  const inside = src.slice(startIdx, startIdx + 2000)
  const block = [inside]
  assert.match(
    inside,
    /countDocuments\s*\(/,
    'public/stats MUST use countDocuments{} for aggregate read — .find() would expose per-user docs',
  )
  assert.equal(
    /\.find\s*\(/.test(inside),
    false,
    'public/stats MUST NOT use .find() — per-user docs would be exposed',
  )
})

test('Round-34: /api/public/stats failsoft fallback never throws 500 (landing widget must always render)', () => {
  const startIdx = src.indexOf("path === 'public/stats'")
  assert.ok(startIdx > -1, 'public/stats block must exist')
  const inside = src.slice(startIdx, startIdx + 2000)
  const block = [inside]
  assert.match(
    inside,
    /catch\s*\(/,
    'public/stats GET handler must have a try/catch — a Mongo blip during launch week must surface as placeholder copy, not a 500',
  )
  // Round-36 fix: the prior assertion was self-contradicting — it
  // used `assert.match` for `status: 500` while the test NAME and
  // error message both said "must NOT return 500". The failsoft
  // catch is correctly written to return placeholder data WITHOUT
  // a 500 status, so the test now uses `assert.doesNotMatch` to
  // verify that. The other test (Round-34 catch exists) is
  // unchanged. Cheap insurance: a future regression that adds
  // `status: 500` to the failsoft catch (e.g. "for clarity")
  // would now fail the test loudly.
  assert.doesNotMatch(
    inside,
    /status:\s*(?:500|\{500\})/,
    'public/stats failsoft catch must NOT return 500 — return placeholder data instead so the landing widget always renders',
  )
})

test('Round-74: /api/public/stats GET branch is positioned BEFORE requireAuth(req) in the catchall route', () => {
  // Regression guard for the pre-Round-74 bug: the public/stats block
  // lived inside the protected section (after `await requireAuth(req)`),
  // so unauth callers hit 401 on the landing-page widget despite the
  // Round-34 test passing (which only checked the block exists, not
  // its position). The fix moves the block into the public endpoints
  // section above the auth gate.
  const startIdx = src.indexOf("path === 'public/stats'")
  assert.ok(startIdx > -1, '/api/public/stats GET handler block must exist in the catchall route')
  const requireAuthIdx = src.indexOf('await requireAuth(req)')
  assert.ok(requireAuthIdx > -1, 'await requireAuth(req) must exist in the catchall route')
  assert.ok(
    startIdx < requireAuthIdx,
    'public/stats branch MUST be positioned BEFORE requireAuth(req) — a regression would re-introduce the 401 on the landing-page widget for unauth visitors',
  )
})

test('Round-74: /api/public/stats handler uses req.method (NOT request.method)', () => {
  // The Round-34 draft accidentally wrote `request.method` but the
  // handler param is `req`. Pre-Round-74 the typo was harmless because
  // the block never ran (it sat AFTER requireAuth → 401). Post-Round-74
  // it runs, so a stray `request.method` would throw a ReferenceError.
  const startIdx = src.indexOf("path === 'public/stats'")
  assert.ok(startIdx > -1, 'public/stats block must exist')
  const inside = src.slice(startIdx, startIdx + 200)
  assert.doesNotMatch(
    inside,
    /request\s*\.\s*method/,
    'public/stats handler MUST use req.method (NOT request.method) — the GET handler param is `req`, never `request`',
  )
  assert.match(
    inside,
    /req\s*\.\s*method\s*===\s*['"]GET['"]/,
    'public/stats handler MUST check req.method === "GET" so other HTTP methods (POST/PUT) cannot leak the aggregate route',
  )
})

test('Round-34: landing page (/api/public/stats call site) is in app/page.js, NOT server-rendered inline', () => {
  // The landing is a "use client" component, so the fetch runs
  // from a useEffect block. Detect the fetch call + useState
  // binding + useEffect wiring so a future maintainer who moves
  // this to an SSR-only fetch can re-evaluate whether the cost of
  // a server round-trip on every page load is justified.
  const landing = readFileSync('app/page.js', 'utf8')
  assert.ok(existsSync('app/page.js'))
  assert.match(
    landing,
    /publicStats/,
    'app/page.js must declare a publicStats state binding to hold the /api/public/stats response',
  )
  assert.match(
    landing,
    /fetch\(\s*['"]\/api\/public\/stats['"]\s*\)/,
    'app/page.js must call fetch("/api/public/stats") — the wired landing-page widget',
  )
  assert.match(
    landing,
    /useEffect\s*\([\s\S]*?fetch\(\s*['"]\/api\/public\/stats['"]/,
    'app/page.js must call the public/stats fetch inside a useEffect (client-side; SSR-safe)',
  )
})
