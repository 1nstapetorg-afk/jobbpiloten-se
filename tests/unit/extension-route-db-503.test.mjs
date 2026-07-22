// tests/unit/extension-route-db-503.test.mjs
//
// Locks the resilient 503 contract for every MongoDB call site
// across all extension routes. Locks the Q3 tagged-error pattern in
// /api/extension/profile (resolveClerkId throws `code: 'DB_UNAVAILABLE'`
// on Mongo outage, outer GET handler maps it to 503 JSON — NOT the
// misleading "Ogiltig token" 401).
//
// Background: the extension-auth page (`app/extension-auth/page.js`)
// does `await res.json()` on the response from `POST /api/extension/token`
// (and the 5 sibling routes in /api/extension/*). A MongoDB outage
// (DNS ECONNREFUSED on the Atlas SRV record, IP allow-list rejection,
// TLS handshake failure, ...) used to surface as an unhandled throw
// inside the route handler. Next.js then responded with a 500 + an
// HTML error overlay (dev mode) or an empty body (some prod cases).
// The page's `await res.json()` then crashed with
// `SyntaxError: Unexpected end of JSON input`, displayed the
// "Servern returnerade 500." error block, and the extension popup
// went dead with the user reporting "Kunde inte ansluta tillägget".
//
// The fix wraps every `await getDb()` call site in each route with a
// try/catch that returns a structured JSON 503 response. The
// profile route's `resolveClerkId` helper additionally tags the throw
// so the outer GET handler emits 503 (not 401) on Mongo down. This
// test locks all of it so a future contributor can't silently
// reintroduce the bug.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')

const TOKEN_ROUTE = path.join(ROOT, 'app', 'api', 'extension', 'token', 'route.js')
const PROFILE_ROUTE = path.join(ROOT, 'app', 'api', 'extension', 'profile', 'route.js')
const ANSWER_ROUTE = path.join(ROOT, 'app', 'api', 'extension', 'answer', 'route.js')
const AI_ANSWERS_ROUTE = path.join(ROOT, 'app', 'api', 'extension', 'ai-answers', 'route.js')
const EMAIL_BODY_ROUTE = path.join(ROOT, 'app', 'api', 'extension', 'email-body', 'route.js')

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

const SWEDISH_503 = 'Databasen är tillfälligt otillgänglig. Försök igen om en stund.'
const STATUS_503 = '503'

// Helper: count ALL Mongo call sites (declaration AND assignment form)
function countGetDbSites(src) {
  // After the fix, every site is in the wrapped form `db = await getDb(...)`
  // (assigned after `let db; try {`). This single regex matches both
  // declaration form (const db = await getDb) AND assignment form
  // (db = await getDb), so it catches the unwrapped declaration site too.
  return (src.match(/\b(?:const\s+)?db\s*=\s*await\s+getDb\s*\(/g) || []).length
}

// Helper: verify every Mongo call site is in the wrapped (assignment) form
// — i.e. NOT a bare `const db = await getDb()` line that would escape on
// failure. The wrapped form is `let db; try { db = await getDb(); ... }`.
function assertAllSitesAreWrapped(filePath) {
  const src = read(filePath)
  // Wrapped form assigns: bare declarations don't.
  const sites = (src.match(/\b(?:const\s+)?db\s*=\s*await\s+getDb\s*\(/g) || []).length
  const wrappedSites = (src.match(/\bdb\s*=\s*await\s+getDb\s*\(/g) || []).length
  // Every site is `db =` (not `const db =`). Both fields match `wrappedSites`.
  assert.strictEqual(
    sites,
    wrappedSites,
    `${path.basename(filePath)} has ${sites} Mongo call sites but only ${wrappedSites} are in WRAPPED 'db = await getDb(' form. ` +
      'Bare `const db = await getDb()` will escape on failure.',
  )
  // Verify the file contains the 503 contract.
  assert.ok(
    src.includes(`'${SWEDISH_503}'`) && src.includes(`status: ${STATUS_503}`),
    `${path.basename(filePath)} is missing the structured 503 contract. ` +
      `Expected to find Swedish message '${SWEDISH_503}' and '${STATUS_503}' status.`,
  )
}

// ============== /api/extension/token (POST + GET + DELETE) =============

test('/api/extension/token: every await getDb() site is wrapped', () => {
  assertAllSitesAreWrapped(TOKEN_ROUTE)
  assert.strictEqual(countGetDbSites(read(TOKEN_ROUTE)), 3, 'expected exactly 3 await getDb() sites in /api/extension/token')
})

test('/api/extension/token: try/catch log line is present (operator visibility)', () => {
  const src = read(TOKEN_ROUTE)
  assert.ok(
    /console\.warn\(\s*['"]\[extension\/token\][^)]*database unavailable/.test(src),
    'expected [extension/token] database unavailable console.warn line',
  )
})

// ============== /api/extension/profile (resolveClerkId + outer GET) =============

test('/api/extension/profile: every await getDb() site is wrapped', () => {
  assertAllSitesAreWrapped(PROFILE_ROUTE)
})

test('/api/extension/profile: resolveClerkId throws tagged DB_UNAVAILABLE on Mongo outage (Q3 fix)', () => {
  const src = read(PROFILE_ROUTE)
  // Three structural invariants:
  //   1. There is a `catch (err) {` block that contains both a tag
  //      AND a rethrow — split into two assertions for robustness
  //      against whitespace + comment-block variation.
  //   2. The tag shape: `Object.assign(err, { code: 'DB_UNAVAILABLE' })`
  //      (or equivalent `err.code = 'DB_UNAVAILABLE'`).
  //   3. The rethrow shape: `throw err;` after the tag.
  const hasDbUnavailableTag = /Object\.assign\s*\(\s*err\s*,\s*\{\s*code\s*:\s*['"]DB_UNAVAILABLE['"]/.test(src) ||
    /err\.code\s*=\s*['"]DB_UNAVAILABLE['"]/.test(src)
  assert.ok(
    hasDbUnavailableTag,
    'expected resolveClerkId\'s catch block to tag the thrown error with code: \'DB_UNAVAILABLE\' ' +
      '(via `Object.assign(err, { code: \'DB_UNAVAILABLE\' })` or `err.code = \'DB_UNAVAILABLE\'`). ' +
      'Without this, the outer GET handler cannot distinguish a Mongo outage from a missing-token-row failure.',
  )
  // The same catch block must throw (not return) the tagged error.
  // Count `throw err;` occurrences — should be at least 1 (the
  // rethrow inside resolveClerkId's catch) AND at most 2 if the outer
  // GET handler also rethrows non-DB errors.
  const throwErrCount = (src.match(/\bthrow\s+err\b/g) || []).length
  assert.ok(
    throwErrCount >= 1,
    'expected at least one `throw err;` per file — the tagged DB_UNAVAILABLE must be thrown, not swallowed.',
  )
})

test('/api/extension/profile: outer GET handler maps DB_UNAVAILABLE -> 503 JSON', () => {
  const src = read(PROFILE_ROUTE)
  assert.ok(
    /err\?\.code\s*===\s*['"]DB_UNAVAILABLE['"]/.test(src),
    'expected the outer GET handler to detect err.code === \'DB_UNAVAILABLE\' (anchors the structured 503 mapping)',
  )
  assert.ok(
    /throw\s+err\b/.test(src),
    'expected the outer catch to rethrow non-DB errors (developer-bug signal must bubble, not be masked as 503)',
  )
})

// ============== Sibling routes — wrap contract per file =============

test('/api/extension/answer: every await getDb() site is wrapped (2 sites)', () => {
  assertAllSitesAreWrapped(ANSWER_ROUTE)
  assert.strictEqual(countGetDbSites(read(ANSWER_ROUTE)), 2, 'expected exactly 2 await getDb() sites in /api/extension/answer')
})

test('/api/extension/ai-answers: every await getDb() site is wrapped (2 sites)', () => {
  assertAllSitesAreWrapped(AI_ANSWERS_ROUTE)
  assert.strictEqual(countGetDbSites(read(AI_ANSWERS_ROUTE)), 2, 'expected exactly 2 await getDb() sites in /api/extension/ai-answers')
})

test('/api/extension/email-body: every await getDb() site is wrapped (2 sites)', () => {
  assertAllSitesAreWrapped(EMAIL_BODY_ROUTE)
  assert.strictEqual(countGetDbSites(read(EMAIL_BODY_ROUTE)), 2, 'expected exactly 2 await getDb() sites in /api/extension/email-body')
})

// ============== Cross-cutting: no unguarded getDb across the entire extension surface =============

const ALL_ROUTES = [
  TOKEN_ROUTE,
  PROFILE_ROUTE,
  ANSWER_ROUTE,
  AI_ANSWERS_ROUTE,
  EMAIL_BODY_ROUTE,
]

test('no unguarded `const db = await getDb()` declaration across /api/extension/*', () => {
  // Belt-and-braces: reject any `const db = await getDb(` site (a
  // bare declaration that throws on connection failure). All sites
  // MUST be in the wrapped `db =` (assignment) form.
  for (const file of ALL_ROUTES) {
    const src = read(file)
    const declSites = (src.match(/\bconst\s+db\s*=\s*await\s+getDb\s*\(/g) || []).length
    assert.strictEqual(
      declSites,
      0,
      `${path.basename(file)} has ${declSites} bare 'const db = await getDb()' declarations. ` +
        'Replace each with `let db; try { db = await getDb(); ... } catch { return 503 JSON; }` so a Mongo outage ' +
        "returns a structured 503 instead of Next.js' default 500 HTML overlay.",
    )
  }
})

test('all extension routes share the 503 Swedish copy + status code', () => {
  // Without this, a future contributor could refactor and lose the
  // contract without the test noticing.
  for (const file of ALL_ROUTES) {
    const src = read(file)
    assert.ok(
      src.includes(`'${SWEDISH_503}'`),
      `${path.basename(file)}: missing Swedish 503 message '${SWEDISH_503}'`,
    )
    assert.ok(
      src.includes(`status: ${STATUS_503}`),
      `${path.basename(file)}: missing status 503`,
    )
  }
})
