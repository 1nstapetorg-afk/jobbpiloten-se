/**
 * POST /api/extension/token
 *
 * Mints a revocable opaque token bound to the currently signed-in user
 * (Clerk OR demo mode). The token lives in a new `extension_tokens`
 * MongoDB collection keyed by random 32-byte hex; the
 * GET /api/extension/profile handler verifies that the bearer token
 * matches a live document before returning profile data.
 *
 * Why opaque-vs-HMAC-JWT: HMAC JWTs need an `EXTENSION_AUTH_SECRET`
 * env var on the server and are easy to forget to rotate; opaque
 * tokens are trivial to revoke from /settings (just `deleteOne({token})`)
 * and they survive key rotation since the verification is purely
 * a Mongo lookup. For MVP this is the lighter touch.
 *
 * Returns:
 *   { token, profile }
 * where `profile` is the SAFE subset (same shape as
 * /api/extension/profile's GET response). Bundling the initial profile
 * with the token means the dashboard doesn't need to do a second
 * GET round-trip after issuing.
 */

import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { randomBytes } from 'crypto';
import { resolveClerkId } from '@/lib/auth';
import { buildExtensionProfile } from '@/lib/extension-profile';
import { requireCompleteProfile } from '@/lib/profile-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---- Mongo singleton (mirrors the upload-cv + catch-all route) ----
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

// resolveClerkId lives in @/lib/auth — imported above.
// Returns the Clerk userId OR the demo userId from headers/cookies,
// or null when neither path produces an id (the route handler
// turns the null into a 401 below).

export async function POST(request) {
  const clerkId = await resolveClerkId(request);
  if (!clerkId) {
    return NextResponse.json(
      { error: 'Inte inloggad — logga in på JobbPiloten först' },
      { status: 401 },
    );
  }

  let db;
  try {
    db = await getDb();
  } catch (err) {
    // Server-side resilience: a MongoDB outage (DNS ECONNREFUSED, IP
    // allow-list rejection, TLS handshake, ...) was surfacing as an
    // unhandled throw → Next.js default 500 (HTML overlay in dev) →
    // extension page's `await res.json()` exploded with
    // "Unexpected end of JSON input". Returning a structured JSON
    // 503 lets the page render the friendly Swedish copy and the
    // extension popup's safe-runtime message wrapper doesn't go
    // catastrophic. Covers POST + GET + DELETE in this file via
    // `allowMultiple: true` — every site that touches MongoDB is
    // now wrapped identically so a future `await getDb()` added by
    // a junior dev can't reintroduce the same failure mode.
    console.warn('[extension/token] database unavailable:', err?.message || err);
    return NextResponse.json(
      { error: 'Databasen är tillfälligt otillgänglig. Försök igen om en stund.' },
      { status: 503 },
    );
  }
  // Bug 1 fix (2026-07-20): route the profile lookup through the
  // shared `requireCompleteProfile` helper so the canonical 404
  // message ("Profil hittades inte — slutför /onboarding först.")
  // is shared with /api/email-preview, cv-pdf, extension/email-body,
  // extension/answer, extension/ai-answers, email-draft, ai-usage.
  // Previously this site emitted 'slutför onboarding först' (missing
  // the leading slash) — text-only drift across endpoints.
  const lookup = await requireCompleteProfile(db, clerkId);
  if (!lookup.ok) return lookup.error;
  const profile = lookup.profile;

  // Generate a 32-byte (256-bit) hex token. Same randomness budget
  // as web-push subscription secrets — well above brute-forceable.
  const token = randomBytes(32).toString('hex');

  // User-agent is logged so the user can audit which devices have
  // an active extension session from /settings. It's NOT used for
  // auth (we don't reject non-matching agents) — it's purely
  // forensic.
  const ua = request.headers.get('user-agent') || '';

  // 2026-07-12 (soft-launch polish #c): token TTL. Tokens are now
  // minted with a 90-day expiry; /api/extension/profile refuses to
  // authenticate expired ones and the popup surfaces the
  // "Token har gått ut — anslut tillägget igen från /dashboard"
  // toast via the existing 401 handler in extension/content.js.
  // The expiry lives ON the same `extension_tokens` row so a
  // future TTL + revocation policy can BOTH read the same source
  // document — no separate "expiry" collection to keep in sync.
  //
  // 90 days is intentional — long enough that a soft-launch user
  // who reopens the popup every workday stays connected without a
  // re-click, short enough that an abandoned laptop loses access
  // within a release cycle. Adjust at soft-launch +30 / +60 once
  // we have real churn data.
  const TTL_MS = 90 * 24 * 60 * 60 * 1000
  const expiresAt = new Date(Date.now() + TTL_MS)

  // Round-9 source tracking — soft-launch observability. The
  // bridge page (app/extension-auth/page.js) POSTs
  // `{ source: 'extension-popup-auth' }` so an audit list at
  // /settings can distinguish popup-driven mints from the legacy
  // dashboard-driven ones. We accept ONLY two whitelisted values to
  // prevent a malicious caller from injecting a fake source string
  // into the audit log (the row is part of the user's settings
  // surface, so it shouldn't be writable by anyone except the two
  // known UIs).
  let source = 'dashboard-connect'
  try {
    const body = await request.json().catch(() => ({}))
    if (body && body.source === 'extension-popup-auth') {
      source = 'extension-popup-auth'
    }
  } catch (_) {
    // Empty body / non-JSON / etc. — fall back to the default.
  }

  await db.collection('extension_tokens').insertOne({
    token,
    clerkId,
    createdAt: new Date(),
    lastUsedAt: new Date(),
    expiresAt,
    userAgent: ua.slice(0, 240),
    source,
  });

  // Fetch the latest cover letter so it's bundled in the response
  // (saves the dashboard from a second POST -> GET round-trip).
  const latestApplication = await db.collection('applications')
    .find({ clerkId })
    .sort({ appliedAt: -1 })
    .limit(1)
    .toArray();
  const latest = latestApplication[0] || null;

  return NextResponse.json({
    token,
    expiresAt: expiresAt.toISOString(),
    profile: buildExtensionProfile(profile, latest),
  });
}

/**
 * GET /api/extension/token — admin-equivalent view for the user themselves.
 *
 * Returns a SAFE audit list of every active extension session bound to
 * the calling Clerk/demo user. Each row carries just enough metadata
 * to render the /settings "Webbläsartillägg" section (createdAt,
 * lastUsedAt, truncated userAgent, source) — we project the `token`
 * field out so the secret never echoes back to the client dashboard
 * even by accident.
 *
 * Soft-capped at 20 rows so a heavy user (multiple devices + frequent
 * reconnects) doesn't ship a multi-MB response; the dashboard wouldn't
 * render that many anyway.
 */
export async function GET(request) {
  const clerkId = await resolveClerkId(request);
  if (!clerkId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let db;
  try {
    db = await getDb();
  } catch (err) {
    // Server-side resilience: a MongoDB outage (DNS ECONNREFUSED, IP
    // allow-list rejection, TLS handshake, ...) was surfacing as an
    // unhandled throw → Next.js default 500 (HTML overlay in dev) →
    // extension page's `await res.json()` exploded with
    // "Unexpected end of JSON input". Returning a structured JSON
    // 503 lets the page render the friendly Swedish copy and the
    // extension popup's safe-runtime message wrapper doesn't go
    // catastrophic. Covers POST + GET + DELETE in this file via
    // `allowMultiple: true` — every site that touches MongoDB is
    // now wrapped identically so a future `await getDb()` added by
    // a junior dev can't reintroduce the same failure mode.
    console.warn('[extension/token] database unavailable:', err?.message || err);
    return NextResponse.json(
      { error: 'Databasen är tillfälligt otillgänglig. Försök igen om en stund.' },
      { status: 503 },
    );
  }
  const tokens = await db.collection('extension_tokens')
    .find({ clerkId })
    .project({ token: 0 })
    .sort({ lastUsedAt: -1 })
    .limit(20)
    .toArray();
  // Truncate userAgent to 80 chars so a verbose Chrome / Edge version
  // string doesn't fill the row. The full UA is still in Mongo for
  // forensic debugging.
  return NextResponse.json({
    tokens: tokens.map((t) => ({
      ...t,
      userAgent: String(t.userAgent || '').slice(0, 80),
    })),
  });
}

/**
 * DELETE /api/extension/token — user-revocable session for an active
 * extension.
 *
 * Behaviour:
 *   • `?token=<hex>` query param → delete exactly that one row (used
 *     by the per-row disconnect button in /settings).
 *   • no query param → delete ALL rows for the user (bulk "Logga ut
 *     från alla enheter" guarded by the same phrase-gate dialog as
 *     Radera konto).
 *
 * Both paths soft-200. The dashboard doesn't need to differentiate
 * "no rows to delete" from "token missing" since either path is a
 * no-op from the user's perspective.
 */
export async function DELETE(request) {
  const clerkId = await resolveClerkId(request);
  if (!clerkId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const url = new URL(request.url);
  const single = (url.searchParams.get('token') || '').trim();
  let db;
  try {
    db = await getDb();
  } catch (err) {
    // Server-side resilience: a MongoDB outage (DNS ECONNREFUSED, IP
    // allow-list rejection, TLS handshake, ...) was surfacing as an
    // unhandled throw → Next.js default 500 (HTML overlay in dev) →
    // extension page's `await res.json()` exploded with
    // "Unexpected end of JSON input". Returning a structured JSON
    // 503 lets the page render the friendly Swedish copy and the
    // extension popup's safe-runtime message wrapper doesn't go
    // catastrophic. Covers POST + GET + DELETE in this file via
    // `allowMultiple: true` — every site that touches MongoDB is
    // now wrapped identically so a future `await getDb()` added by
    // a junior dev can't reintroduce the same failure mode.
    console.warn('[extension/token] database unavailable:', err?.message || err);
    return NextResponse.json(
      { error: 'Databasen är tillfälligt otillgänglig. Försök igen om en stund.' },
      { status: 503 },
    );
  }
  const query = single
    ? { clerkId, token: single }
    : { clerkId };
  await db.collection('extension_tokens').deleteMany(query);
  return NextResponse.json({ ok: true });
}
