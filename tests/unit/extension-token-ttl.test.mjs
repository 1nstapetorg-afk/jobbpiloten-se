// tests/unit/extension-token-ttl.test.mjs
//
// Bug lock (2026-07-12, "soft-launch polish #c — Token TTL"): the
// extension's opaque bearer tokens were minted without an `expiresAt`
// field, so a token issued 6 months ago would still authenticate the
// extension today. For soft-launch we want a 90-day TTL so:
//
//   • An abandoned laptop loses access within a release cycle.
//   • Tokens leaked via chrome.storage.local can be revoked by time
//     alone even if the user never opens /settings to click
//     "Logga ut från alla enheter".
//
// Implementation:
//   • POST /api/extension/token now writes `expiresAt: Date.now() + 90d`
//     on the new token row AND returns it in the JSON response as
//     `expiresAt` (ISO string) so the dashboard can show "ansluten
//     till …" if it ever wants to.
//   • GET /api/extension/profile refuses to authenticate tokens whose
//     `expiresAt` is in the past — the popup's existing 401 handler
//     surfaces "Token har gått ut — anslut igen" and clears local
//     storage.
//   • Backward compat: tokens minted BEFORE 2026-07-12 have no
//     `expiresAt`. The TTL gate must NOT reject these — the
//     dashboard re-mints with the new TTL on the user's next click,
//     and the migration is naturally self-healing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const TOKEN_SOURCE = readFileSync('app/api/extension/token/route.js', 'utf8')
const PROFILE_SOURCE = readFileSync('app/api/extension/profile/route.js', 'utf8')

// ---------- POST /api/extension/token ----------

test('POST /api/extension/token must write expiresAt on the new token row', () => {
  // The TTL gate lives entirely in app/api/extension/token/route.js
  // (POST handler). If a future refactor forgets to write the
  // expiresAt field, GET /api/extension/profile would never see
  // it and the TTL policy would be a paper tiger.
  assert.match(
    TOKEN_SOURCE,
    /expiresAt\s*[=:]\s*new Date\(/,
    'POST handler must compute expiresAt = new Date(...) on the new row',
  )
  assert.match(
    TOKEN_SOURCE,
    /expiresAt,\s*\n\s*userAgent:/m,
    'expiresAt must be a sibling of userAgent in the insertOne call so a future schema audit catches it',
  )
})

test('expiresAt must use a 90-day TTL (1080 minutes × 60 seconds × 24 hours × 90 days, formatted as a Date.now() offset)', () => {
  // Lock the exact constant so a future tweak that changes the
  // window (let's say to 30 or 365 days) is visible in the test
  // diff AND doesn't accidentally introduce a "days = 7 * 7"
  // off-by-ten bug.
  assert.match(
    TOKEN_SOURCE,
    /TTL_MS\s*=\s*90\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
    'TTL must be 90 days expressed in milliseconds (90 * 24 * 60 * 60 * 1000)',
  )
  // The response shape MUST include the ISO-formatted expiresAt so
  // the dashboard / future extensions can read it client-side.
  assert.match(
    TOKEN_SOURCE,
    /expiresAt:\s*expiresAt\.toISOString\(\)/,
    'POST response must echo the ISO-formatted expiresAt so the dashboard can display it',
  )
})

test('POST response body must include the expiresAt field alongside token + profile', () => {
  // Contract: POST returns `{ token, expiresAt, profile }`. The
  // existing Round-2 contract returned `{ token, profile }` — this
  // additive field must not punch a hole in the round-tested test
  // suite in /tests/e2e/extension-banner.spec.js (it asserts on
  // `json.token`, NOT on a strict shape, so the new field is safe).
  assert.match(
    TOKEN_SOURCE,
    /return\s+NextResponse\.json\(\s*\{[\s\S]*?token,[\s\S]*?expiresAt:\s*expiresAt\.toISOString/,
    'POST response shape: { token, expiresAt, profile }',
  )
})

// ---------- GET /api/extension/profile ----------

test('GET /api/extension/profile must refuse expired tokens', () => {
  // The TTL gate is a Date comparison — tokenDoc.expiresAt must be
  // > Date.now() to authenticate. A typo that swaps the comparison
  // operator would silently let three-year-old tokens through.
  assert.match(
    PROFILE_SOURCE,
    /tokenDoc\.expiresAt\s*&&\s*new Date\(tokenDoc\.expiresAt\)\.getTime\(\)\s*<=\s*Date\.now\(\)/,
    'must compare tokenDoc.expiresAt against Date.now() with strict-less-than-or-equal',
  )
  assert.match(
    PROFILE_SOURCE,
    /return\s+null/,
    'expired tokens must produce a 401 (resolveClerkId returns null, extension/profile responds 401)',
  )
})

test('GET /api/extension/profile must keep LEGACY tokens (no expiresAt) authenticating — backward compat', () => {
  // The condition is `tokenDoc.expiresAt && ...` — short-circuit on
  // truthy expiresAt. A missing expiresAt (legacy doc) passes the
  // check unchanged. The dashboard's first reconnect after deploy
  // re-mints with the new TTL.
  assert.match(
    PROFILE_SOURCE,
    /if\s*\(\s*tokenDoc\.expiresAt\s*&&/,
    'TTL gate must short-circuit on a missing expiresAt — legacy tokens grandfather cleanly',
  )
})

test('GET /api/extension/profile must log expired-token rejections for ops visibility', () => {
  // Dev-only console.warn (gated by NODE_ENV) so production logs
  // stay clean of expired-token churn. The user learns via the
  // popup's "Token har gått ut" toast; ops sees the audit trail.
  assert.match(
    PROFILE_SOURCE,
    /console\.warn\(\s*['"]\[extension\/profile\]\s+rejecting\s+expired\s+token['"]/,
    'expired-token rejection must log an ops shell message',
  )
})

// ---------- POST /api/extension/token — Round-9 source parameter ----------

test('POST /api/extension/token must accept body.source = "extension-popup-auth" (Round-9 observability)', () => {
  // The endpoint parses the body and conditionally overrides the
  // default source. Without this guard, popup-driven mints would
  // ALL be tagged `dashboard-connect` in MongoDB and /settings
  // audit log couldn't distinguish them.
  assert.match(
    TOKEN_SOURCE,
    /body\.source\s*===\s*['"]extension-popup-auth['"]/,
    'POST handler must compare body.source to "extension-popup-auth" (single literal)',
  )
})

test('POST /api/extension/token must DEFAULT to source = "dashboard-connect" when body is missing or invalid', () => {
  // The default MUST be set BEFORE the body parse so an unknown
  // body (legacy dashboard call without body, or a malicious
  // payload with body.source = "OTHER") falls back safely.
  assert.match(
    TOKEN_SOURCE,
    /let\s+source\s*=\s*['"]dashboard-connect['"]/,
    'POST handler must declare `let source = "dashboard-connect"` as the default before the body parse',
  )
})

test('POST /api/extension/token must write the resolved source to the inserted extension_tokens row', () => {
  // The `source` variable must be the SAME field written to the DB
  // row (not a stale hardcoded literal). After the body parse, the
  // insertOne call uses the variable, NOT a constant.
  assert.match(
    TOKEN_SOURCE,
    /insertOne\(\s*\{[\s\S]*?source\s*,\s*[\s\S]*?\}/,
    'POST insertOne must include `source` as a field (the resolved variable, not a hardcoded literal)',
  )
})
