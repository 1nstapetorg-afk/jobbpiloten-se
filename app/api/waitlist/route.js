/**
 * /api/waitlist
 *
 * Round-89 — waitlist for the soft-launch landing page.
 *
 * POST (public — no auth): validate the email (zod), normalise to
 * lowercase/trim, and upsert into the `waitlist` collection as
 *   { email, createdAt: Date, source: 'landing' }
 * Duplicate emails are rejected with 409 (no second row). Success is
 * 201. The `source` field is a whitelisted literal so a future
 * waitlist UI (footer, blog, etc.) can distinguish entry points.
 *
 * GET (admin only): list waitlist entries, newest first, capped at
 * 500 rows. Admin = same `ADMIN_USER_IDS` allow-list as
 * /api/admin/ai-status (env-driven, default `demo-user-001`).
 *
 * Security notes:
 *   • The route validates BEFORE touching Mongo (a malformed body is
 *     a cheap 400, never a DB round-trip).
 *   • No PII beyond the email itself is stored; the response never
 *     includes `_id`.
 *   • POST is public by design (the landing form is unauthenticated)
 *     and is NOT in middleware's isProtectedRoute list, so Clerk's
 *     gate never 401s it.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/mongo';
import { resolveClerkId } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin allow-list — env-driven so a real production admin can be
// added without a code deploy (same contract as /api/admin/ai-status).
const ADMIN_ALLOWLIST = String(process.env.ADMIN_USER_IDS || 'demo-user-001')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const EMAIL_MAX = 200;

// Zod schema — `.trim()` + `.email()` give us the format check; the
// lowercasing happens after parse so the schema stays a pure validator.
const WaitlistSchema = z.object({
  email: z.string().trim().min(1).max(EMAIL_MAX).email('Ogiltig e-postadress'),
});

// ---- Round-91 (P1 #2) — POST rate limit ----
// /api/waitlist is a PUBLIC write endpoint (the landing form is
// unauthenticated), which made it the one public write route without
// abuse protection — every sibling public route (/api/track, the
// extension/* bearer endpoints) carries a rate limit. A spammer
// could otherwise fill the `waitlist` collection freely.
//
// Mirrors the in-memory IP-bucket pattern from app/api/track/route.js
// (checkRateLimit + module-scoped Map). ~10 submissions/hour/IP is
// generous for a landing-page form (a real user submits once) while
// making bulk signup scripts impractical. The bucket is process-local:
// acceptable for a soft-launch write endpoint — a future hard launch
// can swap this for a shared Redis/Upstash limiter behind the same
// checkRateLimit() call site.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 10; // ~10 submissions / hour / IP
const buckets = new Map(); // ip -> [ts]

function checkRateLimit(ip) {
  const now = Date.now();
  const arr = buckets.get(ip) || [];
  const fresh = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_MAX) return false;
  fresh.push(now);
  buckets.set(ip, fresh);
  return true;
}

function getIp(request) {
  // x-forwarded-for is the canonical Vercel / proxy header. The
  // first IP in the chain is the client (left-most). Falls back to a
  // single 'unknown' bucket so the limit stays per-route rather than
  // per-IP for clients behind stripped proxies.
  const xff = request.headers.get('x-forwarded-for') || '';
  return xff.split(',')[0]?.trim() || 'unknown';
}

export async function POST(request) {
  // Round-91 (P1 #2) — rate-limit FIRST, before body parsing or any
  // DB access (cheapest possible rejection for a spammer; mirrors
  // /api/track's checkRateLimit placement at the top of the handler).
  const ip = getIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { ok: false, error: 'För många försök. Försök igen om en stund.' },
      { status: 429 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return NextResponse.json({ ok: false, error: 'Ogiltig JSON.' }, { status: 400 });
  }

  const parsed = WaitlistSchema.safeParse({ email: body?.email });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Ange en giltig e-postadress.', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Normalise: lowercase so "Foo@Bar.se" and "foo@bar.se" collide on
  // the unique-ish upsert key (dup detection is case-insensitive).
  const email = parsed.data.email.toLowerCase();

  let db;
  try {
    db = await getDb();
  } catch (err) {
    // Structured 503 (JSON, not the Next.js HTML overlay) so the
    // landing form can surface the friendly Swedish copy — mirrors
    // the other routes' Mongo-down resilience (lib/mongo.js
    // self-healing connectPromise makes this transient).
    console.warn('[waitlist] database unavailable:', err?.message || err);
    return NextResponse.json(
      { ok: false, error: 'Databasen är tillfälligt otillgänglig. Försök igen om en stund.' },
      { status: 503 },
    );
  }

  const now = new Date();
  let result;
  try {
    result = await db.collection('waitlist').updateOne(
      { email },
      { $setOnInsert: { email, createdAt: now, source: 'landing' } },
      { upsert: true },
    );
  } catch (err) {
    // Review-fix: the WRITE itself can throw even when getDb() succeeded
    // (transient network blip mid-query). An unhandled throw would bubble
    // to Next.js's default HTML 500 and the landing form's `res.json()`
    // would explode with "Unexpected end of JSON input" — the exact
    // Round-86 / Bug 1 pattern every other route guards against.
    console.warn('[waitlist] write failed:', err?.message || err);
    return NextResponse.json(
      { ok: false, error: 'Databasen är tillfälligt otillgänglig. Försök igen om en stund.' },
      { status: 503 },
    );
  }

  if (result.upsertedCount === 1) {
    return NextResponse.json({ ok: true, email, status: 'waitlisted' }, { status: 201 });
  }
  return NextResponse.json(
    { ok: false, error: 'E-postadressen finns redan i kön.' },
    { status: 409 },
  );
}

export async function GET(request) {
  const clerkId = await resolveClerkId(request);
  if (!clerkId) {
    return NextResponse.json({ error: 'Inte inloggad — logga in först' }, { status: 401 });
  }
  if (!ADMIN_ALLOWLIST.includes(clerkId)) {
    return NextResponse.json({ error: 'Endast för administratörer' }, { status: 403 });
  }

  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.warn('[waitlist] database unavailable:', err?.message || err);
    return NextResponse.json(
      { error: 'Databasen är tillfälligt otillgänglig. Försök igen om en stund.' },
      { status: 503 },
    );
  }

  let entries;
  try {
    entries = await db
      .collection('waitlist')
      .find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
  } catch (err) {
    console.warn('[waitlist] read failed:', err?.message || err);
    return NextResponse.json(
      { error: 'Databasen är tillfälligt otillgänglig. Försök igen om en stund.' },
      { status: 503 },
    );
  }

  return NextResponse.json({
    entries: entries.map(({ _id, ...rest }) => rest),
  });
}
