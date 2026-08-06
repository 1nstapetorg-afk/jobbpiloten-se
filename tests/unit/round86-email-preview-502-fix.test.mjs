// tests/unit/round86-email-preview-502-fix.test.mjs
//
// 2026-08-04 (Round-86) — structural lock for the onboarding Step-4
// bug pair reported by the manual tester:
//   • "Förhandsvisa AI-mejl" → "Servern returnerade 502"
//   • "Slutför" → "Kunde inte spara profilen: Failed to execute 'json'
//     on 'Response': Unexpected end of JSON input"
//
// ROOT CAUSES (from the dev-server log):
//   1. Groq's daily token quota was exhausted ("429 Rate limit reached
//      ... TPD: Limit 200000, Used 199741") — every LLM call failed.
//      That alone is survivable (lib/groq.js soft-fails to the
//      rule-based template), but...
//   2. .../api/email-preview chained `trackEvent(...).catch(...)` and
//      `trackEvent` (lib/analytics.js) is a SYNCHRONOUS fire-and-forget
//      that returned `undefined` — `.catch` on undefined threw
//      "TypeError: Cannot read properties of undefined (reading
//      'catch')" INSIDE the AI-generation path.
//   3. `getDb()` + `requireCompleteProfile()` in /api/email-preview sat
//      OUTSIDE any try/catch — a Mongo outage escaped as an unhandled
//      throw → 502 (dev-server restart / proxy) instead of JSON.
//   4. The onboarding client's handleSubmit called bare `res.json()`,
//      so ANY empty/HTML body surfaced as the raw English JSON parse
//      error instead of a Swedish fallback toast.
//
// FIXES (all verified live):
//   • lib/analytics.js — trackEvent always returns Promise.resolve()
//     (never undefined), so `.catch` chaining is safe at every call
//     site (email-preview + extension/email-body).
//   • app/api/email-preview/route.js — getDb() + requireCompleteProfile
//     wrapped in try/catch; any failure degrades to the rule-based
//     fallback body with source:'fallback' and HTTP 200 (never 502).
//   • app/onboarding/page.js — handleSubmit parses defensively via
//     `res.json().catch(() => ({}))` so an empty body shows the Swedish
//     fallback message instead of the raw JSON parse error.
//   • app/api/[[...path]]/route.js — the POST catch-all translates
//     Mongo connection errors into a friendly 503 `DB_UNAVAILABLE`
//     JSON body (mirrors the upload-cv contract) — always valid JSON.
//
// WHAT THIS FILE LOCKS (source-pattern, mirrors the structural-lock
// culture — see round85-auth-demo-fallback.test.mjs,
// round74-upload-cv-runtime-shape.test.mjs):
//   • trackEvent's Promise return contract (every exit path).
//   • The email-preview DB/profile lookup is inside a try/catch that
//     returns a fallback NextResponse.json on failure.
//   • The onboarding handleSubmit JSON parse is defensive.
//   • The profile-save catch-all returns DB_UNAVAILABLE 503 JSON.
//
// We deliberately do NOT execute the route handlers here — they pull
// Next.js + Mongo + Clerk into a plain node --test run. Source-pattern
// locking is the established contract for this module class.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ANALYTICS_SRC = fs.readFileSync(path.join(__dirname, '../..', 'lib', 'analytics.js'), 'utf8')
const PREVIEW_SRC = fs.readFileSync(path.join(__dirname, '../..', 'app', 'api', 'email-preview', 'route.js'), 'utf8')
const ONBOARDING_SRC = fs.readFileSync(path.join(__dirname, '../..', 'app', 'onboarding', 'page.js'), 'utf8')
const CATCHALL_SRC = fs.readFileSync(path.join(__dirname, '../..', 'app', 'api', '[[...path]]', 'route.js'), 'utf8')

// =====================================================================
// Lock 1 — trackEvent must ALWAYS return a Promise (never undefined),
// so the `.catch(...)` chains in the email routes can't throw
// "Cannot read properties of undefined (reading 'catch')".
// =====================================================================

test('Lock 1: trackEvent returns Promise.resolve() on every exit path', () => {
  // The three early-return guards (analytics disabled / bad name /
  // invalid shape) must each return Promise.resolve().
  const earlyReturns = ANALYTICS_SRC.match(/return Promise\.resolve\(\)/g) || []
  assert.ok(
    earlyReturns.length >= 3,
    `trackEvent must return Promise.resolve() on the 3 early-exit guards (analytics-disabled, non-string name, invalid shape) — found ${earlyReturns.length}.`,
  )
  // The happy path (after console.log) must also return a resolved
  // Promise — this was the pre-fix gap: the sync function ended with
  // an implicit `undefined` return.
  assert.match(
    ANALYTICS_SRC,
    /console\.log\(JSON\.stringify\(line\)\)[\s\S]{0,600}?return Promise\.resolve\(\)/,
    'trackEvent happy path must end with an explicit `return Promise.resolve()` so the .catch chains never see undefined.',
  )
})

// =====================================================================
// Lock 2 — email-preview wraps getDb() + requireCompleteProfile() in a
// try/catch that soft-fails to the fallback body (never an unhandled
// throw → 502).
// =====================================================================

test('Lock 2: email-preview DB/profile lookup is inside a try/catch that returns the fallback JSON', () => {
  // getDb() must be INSIDE a try (pre-fix it sat at handler top level,
  // outside any try — a Mongo outage escaped as an unhandled 502).
  assert.match(
    PREVIEW_SRC,
    /try\s*\{[\s\S]{0,120}?await getDb\(\)/,
    'email-preview must call getDb() inside a try block so a Mongo outage is catchable.',
  )
  // The catch must degrade to the rule-based fallback with HTTP 200
  // JSON — the user-visible contract "never 502".
  assert.match(
    PREVIEW_SRC,
    /catch\s*\(dbErr\)[\s\S]{0,400}?fallbackEmailBody/,
    'the DB/profile-lookup catch must soft-fail to fallbackEmailBody (rule-based template, HTTP 200).',
  )
  assert.match(
    PREVIEW_SRC,
    /source:\s*'fallback'/,
    'the fallback response must carry source:\'fallback\' so the UI can tell the body was not AI-generated.',
  )
})

// =====================================================================
// Lock 3 — the onboarding handleSubmit parses the profile-save
// response defensively (no raw "Unexpected end of JSON input" leak).
// =====================================================================

test('Lock 3: onboarding handleSubmit uses res.json().catch(() => ({}))', () => {
  assert.match(
    ONBOARDING_SRC,
    /await\s+res\.json\(\)\.catch\(\(\)\s*=>\s*\(\{\}\)\)/,
    'handleSubmit must parse the profile-save response via res.json().catch(() => ({})) so an empty/HTML body degrades to {} instead of throwing the raw JSON parse error.',
  )
})

// =====================================================================
// Lock 4 — the profile-save catch-all route returns a friendly
// DB_UNAVAILABLE 503 JSON for Mongo connection errors (never an empty
// body / raw ECONNREFUSED leaking to the onboarding toast).
// =====================================================================

test('Lock 4: profile-save POST catch-all returns DB_UNAVAILABLE 503 JSON on Mongo connection errors', () => {
  assert.match(
    CATCHALL_SRC,
    /Vi kunde inte nå databasen just nu\. Försök igen om en stund\./,
    'the POST catch-all must surface the friendly Swedish DB-unavailable message (mirrors upload-cv).',
  )
  assert.match(
    CATCHALL_SRC,
    /code:\s*'DB_UNAVAILABLE'/,
    'the friendly DB error must carry code:\'DB_UNAVAILABLE\' for machine-readable handling.',
  )
  assert.match(
    CATCHALL_SRC,
    /status:\s*503/,
    'the DB-unavailable response must be HTTP 503 (service unavailable), distinguishing it from a generic 500.',
  )
  // The Mongo-connection error detectors must be present so the
  // translation actually fires on the reported failure class.
  assert.match(
    CATCHALL_SRC,
    /MongoServerSelectionError|MongoNetworkError|MongoTimeoutError/,
    'the catch-all must detect Mongo connection error names (MongoServerSelectionError / MongoNetworkError / MongoTimeoutError).',
  )
  assert.match(
    CATCHALL_SRC,
    /ECONNREFUSED|ECONNRESET|ETIMEDOUT/,
    'the catch-all must also detect raw connection-error strings (ECONNREFUSED / ECONNRESET / ETIMEDOUT) for non-Mongo-driver throws.',
  )
})
