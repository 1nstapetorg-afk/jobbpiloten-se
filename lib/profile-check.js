/**
 * lib/profile-check.js
 *
 * Single source of truth for the "is this profile complete enough to use
 * AI features" check. Per tester spec from 2026-07-20 (Monday bugs):
 *
 *   "If the user has a profile with basic fields filled (name, email,
 *   etc.), treat onboarding as complete."
 *
 * Previously every endpoint (`/api/email-preview`,
 * `/api/extension/token`, the catch-all `[[...path]]`, etc.) made its
 * own decision about whether a missing profile was a 404-worthy
 * error or a graceful fallback. Round-46 introduced the literal
 * "Profil hittades inte — slutför /onboarding först." string in
 * `/api/email-preview` and a sibling in `/api/extension/token`
 * (missing trailing slash). The inconsistency between the two error
 * strings was already confusing, but more importantly the check
 * itself was over-strict — it treated a profile document with only
 * `_id` and `clerkId` as "missing" even though the user had
 * successfully saved their name + email through /settings (settings
 * just routes through a different endpoint that doesn't write the
 * full doc yet on first save).
 *
 * `isProfileComplete(profile)` is the canonical predicate: a profile
 * is "good enough" for AI flows iff `fullName` OR `email` is a
 * non-empty trimmed string. Empty strings, null, undefined, and the
 * absent profile doc itself all return false. The pure helper is
 * cheap to call from any endpoint and trivially mockable for tests.
 *
 * Use `requireCompleteProfile(db, userId)` inside an endpoint to
 * wrap the Mongo lookup + the completeness check, returning a tagged
 * result the route handler can map to either a 404 or a downstream
 * AI flow. Both surfaces (extension + dashboard) get the same
 * predicate, so a profile saved via /settings is treated
 * consistently by both the AI email preview (onboarding) and the
 * extension token (popup).
 */

/**
 * Canonical Swedish 404 message used by every endpoint that wires
 * `requireCompleteProfile()` through. Exported as a constant so
 * unit tests can assert against the exact wording without having
 * to lazily import `next/server` (Round-46 / 2026-07-20 Monday
 * followup 2: locking the contract via tests/unit/profile-check
 * .test.mjs is cleaner than asserting on the serialized
 * NextResponse body).
 */
export const PROFILE_MISSING_STATUS = 404
export const PROFILE_MISSING_ERROR_MESSAGE =
  'Profil hittades inte — slutför /onboarding först. (Saknade fullständigt namn och e-post.)'

/**
 * Predicate — profile document is "complete enough" for AI flows iff
 * `fullName` OR `email` is a non-empty trimmed string.
 *
 * @param {object|null|undefined} profile  Mongo profile doc or null
 * @returns {boolean}
 */
export function isProfileComplete(profile) {
  if (!profile || typeof profile !== 'object') return false
  const fullName = String(profile.fullName || '').trim()
  const email = String(profile.email || '').trim()
  return Boolean(fullName) || Boolean(email)
}

/**
 * Endpoint-side helper — looks up the profile by `clerkId` and tags
 * the result so the route handler can branch:
 *
 *   const { ok, profile, error } = await requireCompleteProfile(db, userId)
 *   if (error) return error
 *   // ... continue with profile ...
 *
 * The 404 message is the canonical Round-46 literal so the front-end
 * surfaces the same Swedish error string across endpoints (was
 * previously inconsistent — /api/email-preview had a trailing "."
 * and /api/extension/token was missing the "/").
 *
 * @param {import('mongodb').Db} db   open Mongo db handle
 * @param {string} userId             Clerk userId OR demo cookie userId
 * @returns {Promise<
 *   | { ok: true, profile: object }
 *   | { ok: false, profile: null, error: import('next/server').NextResponse }
 * >}
 */
export async function requireCompleteProfile(db, userId) {
  const profile = await db.collection('profiles').findOne({ clerkId: userId })
  if (isProfileComplete(profile)) {
    return { ok: true, profile }
  }
  // Lazy-import NextResponse so this helper stays usable from
  // non-Next contexts (e.g. the catch-all background job runner).
  // In practice every caller IS a Next route handler, but the local
  // dynamic import keeps the helper above the framework boundary.
  // If `next/server` can't be resolved (e.g. when this helper is
  // loaded by `node --test` outside a Next.js build — see
  // tests/unit/profile-check.test.mjs), fall back to a plain object
  // with the same shape so callers can branch on `error.status`
  // AND tests can assert on the canonical constants without
  // needing a full Next.js runtime.
  let NextResponse
  try {
    ({ NextResponse } = await import('next/server'))
  } catch (_e) {
    NextResponse = null
  }
  if (NextResponse) {
    return {
      ok: false,
      profile: null,
      error: NextResponse.json(
        { error: PROFILE_MISSING_ERROR_MESSAGE },
        { status: PROFILE_MISSING_STATUS },
      ),
    }
  }
  return {
    ok: false,
    profile: null,
    error: {
      status: PROFILE_MISSING_STATUS,
      json: async () => ({ error: PROFILE_MISSING_ERROR_MESSAGE }),
    },
  }
}
