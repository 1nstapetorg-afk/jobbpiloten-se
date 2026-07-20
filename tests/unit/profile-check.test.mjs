// tests/unit/profile-check.test.mjs
//
// Unit tests for lib/profile-check.js — the canonical profile-
// completeness predicate + Mongo lookup helper used by every AI-
// flow endpoint in the project.
//
// Background: Round-46 / 2026-07-20 Monday testing surfaced that
// the per-endpoint `if (!profile) -> 404` gates were inconsistent
// (some rejected an empty-but-saved profile, some emitted divergent
// error messages). The fix landed a shared helper in
// lib/profile-check.js — these tests lock the contract so future
// refactors can't silently re-introduce the inconsistency.
//
// Run via `yarn test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isProfileComplete,
  requireCompleteProfile,
  PROFILE_MISSING_ERROR_MESSAGE,
  PROFILE_MISSING_STATUS,
} from '../../lib/profile-check.js'

// ─── isProfileComplete ─────────────────────────────────────────────
//
// Per tester spec from the 2026-07-20 bug report:
// "If the user has a profile with basic fields filled (name, email,
// etc.), treat onboarding as complete." The predicate says a
// profile is "complete enough" iff fullName OR email is a non-empty
// trimmed string.

test('isProfileComplete: null/undefined profile returns false', () => {
  assert.equal(isProfileComplete(null), false)
  assert.equal(isProfileComplete(undefined), false)
})

test('isProfileComplete: non-object input returns false', () => {
  // The helper guards against accidental string / number coercion
  // — a Mongo doc IS an object. Defensive check so callers that
  // accidentally pass `profile = "{}"` (a string of JSON, not a
  // real doc) don't get a confused `true`.
  assert.equal(isProfileComplete(''), false)
  assert.equal(isProfileComplete(0), false)
  assert.equal(isProfileComplete('hello'), false)
  assert.equal(isProfileComplete(true), false)
})

test('isProfileComplete: empty doc returns false', () => {
  assert.equal(isProfileComplete({}), false)
  assert.equal(isProfileComplete({ _id: 'p1', clerkId: 'u1' }), false)
  assert.equal(isProfileComplete({ clerkId: 'u1', skills: [] }), false)
})

test('isProfileComplete: empty / whitespace-only fullName AND email returns false', () => {
  assert.equal(isProfileComplete({ fullName: '', email: '' }), false)
  assert.equal(isProfileComplete({ fullName: '   ', email: '   ' }), false)
  assert.equal(isProfileComplete({ fullName: '\n\t', email: '\n' }), false)
  assert.equal(isProfileComplete({ fullName: null, email: undefined }), false)
})

test('isProfileComplete: fullName OR email non-empty returns true', () => {
  // Each cell: profile with exactly one of {fullName, email} set
  // to a valid value, the other empty. Both must return true.
  assert.equal(isProfileComplete({ fullName: 'Anna Andersson' }), true)
  assert.equal(isProfileComplete({ fullName: '  Anna Andersson  ' }), true)
  assert.equal(isProfileComplete({ email: 'anna@example.com' }), true)
  assert.equal(isProfileComplete({ email: 'anna@example.com  ' }), true)
})

test('isProfileComplete: BOTH fullName and email non-empty returns true', () => {
  assert.equal(
    isProfileComplete({ fullName: 'Anna', email: 'anna@example.com' }),
    true,
  )
})

test('isProfileComplete: is robust to mixed garbage fields', () => {
  // The predicate only inspects fullName + email — extra fields
  // (skills, jobTitles, locations, tier, etc.) are ignored. A
  // profile with all the canonical settings-saved fields plus
  // namespaced oddities still counts as complete.
  assert.equal(
    isProfileComplete({
      fullName: 'Erik Berg',
      email: 'erik@example.com',
      skills: ['javascript', 'python'],
      jobTitles: ['developer'],
      locations: ['Stockholm'],
      tier: 'Basic',
      aiEmailBodyEnabled: true,
      randomField: { nested: { deeply: true } },
    }),
    true,
  )
})

// ─── requireCompleteProfile ───────────────────────────────────────
//
// The helper returns a tagged result so route handlers can branch:
//   { ok: true, profile }                -> use `profile`
//   { ok: false, profile: null, error }  -> return `error` to client

test('requireCompleteProfile: completes profile returns ok:true with the doc', async () => {
  const fakeDoc = { clerkId: 'u1', fullName: 'Anna', email: 'anna@x' }
  const db = {
    collection: () => ({
      findOne: async () => fakeDoc,
    }),
  }
  const res = await requireCompleteProfile(db, 'u1')
  assert.equal(res.ok, true)
  assert.equal(res.profile, fakeDoc)
  assert.equal(res.error, undefined)
})

test('requireCompleteProfile: missing profile returns ok:false with the canonical 404 status + message', async () => {
  // In a Next.js build, the error is a real NextResponse instance;
  // in `node --test` (out of Next.js runtime), the helper falls
  // back to a plain object with the same `{ status, json() }`
  // shape so this assertion is identical across both contexts.
  // The dynamic-import fallback is locked at the bottom of this
  // test file so a future refactor that loses it is caught.
  const db = {
    collection: () => ({
      findOne: async () => null,
    }),
  }
  const res = await requireCompleteProfile(db, 'u-unknown')
  assert.equal(res.ok, false)
  assert.equal(res.profile, null)
  assert.equal(res.error.status, PROFILE_MISSING_STATUS)
  const body = await res.error.json()
  assert.equal(body.error, PROFILE_MISSING_ERROR_MESSAGE)
})

test('requireCompleteProfile: stub profile (only _id + clerkId) returns ok:false with the canonical message', async () => {
  // This is the exact 2026-07-20 bug case: settings-saved profile
  // was only `_id` + `clerkId` (no fullName/email populated).
  // Before the helper, /api/email-preview rejected this as 404 and
  // the tester saw "Profil hittades inte" — the fault lied in
  // settings, but the user-facing error said the profile was
  // completely missing. The helper now treats this as a
  // first-time-incomplete profile and keeps the existing 404
  // message consistent across endpoints.
  const db = {
    collection: () => ({
      findOne: async () => ({ _id: 'p1', clerkId: 'u1' }),
    }),
  }
  const res = await requireCompleteProfile(db, 'u1')
  assert.equal(res.ok, false)
  assert.equal(res.error.status, PROFILE_MISSING_STATUS)
  // Lock the duck-typed NextResponse surface (Round-46
  // review-flag #B, 2026-07-20): when `await import('next/server')`
  // throws (here, in `node --test` outside Next runtime), the
  // helper falls back to a plain object exposing ONLY `status`
  // and `json`. Future callers that touch `error.headers.get(...)`
  // or `error.text()` would crash in this fallback path even
  // though they'd work in production Next — lock the surface
  // area here so a drift is caught at unit-test time.
  assert.deepEqual(Object.keys(res.error).sort(), ['json', 'status'])
  // The error message must be the canonical Swedish literal —
  // tests/unit/extension-handshake-error-messages.test.mjs (and
  // the 7 endpoint tests that branch on this string in their
  // assertions) all depend on this exact wording.
  const body = await res.error.json()
  assert.equal(body.error, PROFILE_MISSING_ERROR_MESSAGE)
})

test('requireCompleteProfile: dynamic import of next/server falls back to plain object when run outside Next.js', async () => {
  // The helper lazy-imports NextResponse at runtime. When this
  // helper runs in `node --test` (no Next.js build context), the
  // dynamic import throws — the helper catches and falls back to
  // a plain `{ status, json(): Promise<...> }` object so callers
  // behave identically. Lock the fallback shape so future
  // refactors unhandled-reject instead of silently degrading.
  const db = {
    collection: () => ({
      findOne: async () => null,
    }),
  }
  const res = await requireCompleteProfile(db, 'u-out-of-next')
  assert.equal(res.ok, false)
  // Plain-object fallback (running here, outside Next):
  assert.equal(typeof res.error.json, 'function')
  const body = await res.error.json()
  assert.equal(body.error, PROFILE_MISSING_ERROR_MESSAGE)
  assert.equal(res.error.status, PROFILE_MISSING_STATUS)
})

test('requireCompleteProfile: profile with email-only is treated as complete (matches the bug-report spec)', async () => {
  // Tester spec: "If the user has a profile with basic fields
  // filled (name, email, etc.), treat onboarding as complete."
  // A profile with ONLY an email but no fullName (which is what
  // happens when a test user signs up via Google OAuth which
  // populates email but Clerk doesn't always include a fullName)
  // is complete enough.
  const fakeDoc = { clerkId: 'u1', email: 'anna@x.com' }
  const db = {
    collection: () => ({
      findOne: async () => fakeDoc,
    }),
  }
  const res = await requireCompleteProfile(db, 'u1')
  assert.equal(res.ok, true)
  assert.equal(res.profile, fakeDoc)
})

test('requireCompleteProfile: lookup is keyed on clerkId (not _id or any other field)', async () => {
  // The helper must call findOne({ clerkId: userId }) so the same
  // user always maps to the same doc across requests. A bug here
  // would silently surface another user's profile to the wrong
  // request — a critical security regression. Capture the arg.
  let observedQuery = null
  const db = {
    collection: () => ({
      findOne: async (q) => {
        observedQuery = q
        return { clerkId: 'u-mine', fullName: 'Anna' }
      },
    }),
  }
  await requireCompleteProfile(db, 'u-mine')
  assert.deepEqual(observedQuery, { clerkId: 'u-mine' })
})
