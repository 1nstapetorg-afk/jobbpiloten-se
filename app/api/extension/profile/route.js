/**
 * GET /api/extension/profile
 *
 * Authenticates the request via a revocable opaque token issued by
 * POST /api/extension/token. The token is stored in the `extension_tokens`
 * MongoDB collection so the user (or admin) can revoke it from
 * /settings instead of having to wait for a JWT expiry.
 *
 * Returns a SAFE subset of the profile — sensitive data (full cvText,
 * profilePicture data URL, clerkId, personal number) is excluded
 * because:
 *   • cvText can be 20 KB+ of free-form text — chrome.storage.local
 *     has a 5 MB cap across all extensions so it pays to keep ours lean.
 *   • profilePicture data URLs can be 2-3 MB each.
 *   • PII (clerkId + personal number) is not needed for form filling
 *     and would only widen the breach surface if the extension
 *     token ever leaked.
 *
 * If the token is invalid/missing/revoked we return 401 so the
 * extension can clear chrome.storage.local and prompt the user to
 * reconnect from /dashboard.
 */

import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { buildExtensionProfile } from '@/lib/extension-profile';
// Round-46 / Followup 3 (2026-07-20 Monday): central profile-
// completeness predicate. See lib/profile-check.js for the canonical
// definition. Used here so the extension-profile endpoint mirrors
// the same "is the profile complete enough to feed into the
// extension?" check the AI email preview and email-draft endpoints
// use -- avoids the user getting a "Profil hittades inte" 404 on
// the extension when their /settings save only filled partial
// fields.
import { isProfileComplete } from '@/lib/profile-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---- Mongo singleton ----
let clientPromise;
if (!global._mongoClientPromise) {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017/jobbpiloten');
  global._mongoClientPromise = client.connect();
}
clientPromise = global._mongoClientPromise;

async function getDb() {
  const client = await clientPromise;
  return client.db(process.env.DB_NAME);
}

/**
 * Resolve `clerkId` from the bearer token. We never accept the raw
 * cookie here — the extension can't see HttpOnly Clerk cookies — so
 * the token IS the credential. The token document is the only thing
 * we trust; manufacturing one requires either running the dashboard
 * while signed in (POST /api/extension/token) or stealing one out of
 * chrome.storage.local.
 */
async function resolveClerkId(request) {
  const auth = request.headers.get('authorization') || '';
  const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(auth);
  if (!match) return null;
  const token = match[1];  let db;
  try {
    db = await getDb();
  } catch (err) {
    // MongoDB outage inside the bearer-token resolver. Tag the
    // thrown error with `code: 'DB_UNAVAILABLE'` and rethrow so
    // the outer GET handler can map it to a structured 503 JSON
    // via its top-level catch (added below). This preserves the
    // helper's `clerkId | null` return shape for legitimate
    // "token row not found" results, while keeping infrastructure
    // outages a recognisably different failure mode from a bad
    // bearer token.
    //
    // Without the tag the user would see the misleading 401
    // "Ogiltig eller saknad token — anslut tillägget från /dashboard",
    // implying their saved Chrome extension token is bad, when
    // the real cause is an externally-visible Atlas outage.
    console.warn('[extension/profile] resolveClerkId: database unavailable:', err?.message || err);
    Object.assign(err, { code: 'DB_UNAVAILABLE' });
    throw err;
  }
  const tokenDoc = await db.collection('extension_tokens').findOne({ token });
  if (!tokenDoc) return null;

  // 2026-07-12 (soft-launch polish #c): refuse expired tokens. A
  // token whose `expiresAt` is in the past is treated identically to
  // a missing token — the listener in extension/content.js sees a
  // 401, clears chrome.storage.local, and prompts the user to
  // reconnect from /dashboard. Without this gate, a stolen / stale
  // token could outlive the soft-launch security window.
  // We check `expiresAt` AFTER the row lookup so a token with a
  // null `expiresAt` (legacy docs minted before 2026-07-12) still
  // authenticates — this protects the migration: the dashboard's
  // first reconnect after deploy re-mints with the new TTL.
  if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt).getTime() <= Date.now()) {
    console.warn('[extension/profile] rejecting expired token', {
      clerkId: tokenDoc.clerkId,
      expiresAt: tokenDoc.expiresAt,
    })
    return null
  }

  // Touch lastUsedAt for debugging ("when did the extension last
  // sync?"); not used for auth so a stale lastUsedAt never invalidates.
  await db.collection('extension_tokens').updateOne(
    { token },
    { $set: { lastUsedAt: new Date() } },
  ).catch((e) => {
    // Non-fatal (token validation already succeeded), but a stale
    // lastUsedAt would hide which device the extension is running
    // on from the /settings audit. Surface once via console.warn so
    // it's visible in dev logs without breaking the request.
    if (process.env.NODE_ENV !== 'production') console.warn('[extension/profile] lastUsedAt update failed:', e?.message)
  });

  return tokenDoc.clerkId;
}

// buildExtensionProfile is hoisted to lib/extension-profile.js — both
// routes here and in /api/extension/token/route.js import from there so
// the mint-time snapshot and refresh snapshots can't drift apart.

export async function GET(request) {
  // Top-level wrapper: maps the DB_UNAVAILABLE tagged error
  // (thrown by `resolveClerkId` on a MongoDB outage) to a
  // structured 503 JSON, and rethrows any other unhandled
  // exception so genuine developer bugs still surface as
  // Next.js' default 500 (which is the right behaviour — a
  // 503-on-everything wrapper would mask real bugs).
  try {
  const clerkId = await resolveClerkId(request);
  if (!clerkId) {
    return NextResponse.json(
      { error: 'Ogiltig eller saknad token — anslut tillägget från /dashboard.' },
      { status: 401 },
    );
  }

  let db;
  try {
    db = await getDb();
  } catch (err) {
    // MongoDB outage reaching the GET handler's own lookup path.
    // `resolveClerkId` already swallowed a "db unavailable" earlier
    // and returned null (the upstream `if (!clerkId)` would surface
    // it as the existing 401), so this branch only fires when the
    // SECOND db.connect fails (token was valid, profile lookup
    // can't connect) — a separate transient failure mode. Either
    // way, return a structured 503 JSON so the page can render the
    // friendly Swedish copy instead of crashing on `res.json()`.
    console.warn('[extension/profile] GET: database unavailable:', err?.message || err);
    return NextResponse.json(
      { error: 'Databasen är tillfälligt otillgänglig. Försök igen om en stund.' },
      { status: 503 },
    );
  }
  // Round-46 / Followup 3 (2026-07-20 Monday): same
  // isProfileComplete-aware 404 gate as email-draft. A profile
  // document that exists but has only `_id` + `clerkId`
  // (no fullName/email) is treated as not-complete and yields a
  // helpful 404 instead of silently shipping a near-empty profile
  // doc into the extension popup.
  const profile = await db.collection('profiles').findOne({ clerkId });
  if (!isProfileComplete(profile)) {
    return NextResponse.json(
      {
        error:
          'Profil hittades inte — slutför /onboarding först. (Saknade fullständigt namn och e-post.)',
      },
      { status: 404 },
    );
  }

  // Most recent application — handy for the "personligt brev" textarea.
  const latestApplication = await db.collection('applications')
    .find({ clerkId })
    .sort({ appliedAt: -1 })
    .limit(1)
    .toArray();
  const latest = latestApplication[0] || null;

  return NextResponse.json(buildExtensionProfile(profile, latest));
  } catch (err) {
    if (err?.code === 'DB_UNAVAILABLE') {
      console.warn('[extension/profile] GET: database unavailable (tagged):', err?.message || err);
      return NextResponse.json(
        { error: 'Databasen är tillfälligt otillgänglig. Försök igen om en stund.' },
        { status: 503 },
      );
    }
    throw err;
  }
}
