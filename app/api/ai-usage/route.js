/**
 * GET /api/ai-usage
 *
 * Returns the user's AI-usage snapshot for the current calendar month
 * so /settings can render the usage card without loading any
 * Groq-dependent data. Auth uses the same pattern as the catch-all
 * /api/profile POST (Clerk first, demo-mode cookie fallback) because
 * the settings page is signed-in-user only.
 *
 * Response shape mirrors lib/ai-usage.js's getUsageSnapshot() so the
 * client and server can't drift — the request parses the same fields
 * the route handler returns. Adding a field server-side means a
 * single line in app/settings/page.js; missing the inverse field
 * surfaces as `undefined` in React, never a 500.
 *
 * Rate-limiting: omitted by design. A read-only snapshot is cheap
 * (one Mongo round-trip) and the user's /settings page only mounts
 * it on a single page navigation. If we ever wire this to a polling
 * dashboard, add a 60-s in-memory ETAG cache here first.
 */

import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { requireAuth } from '@/lib/auth';
import { getUsageSnapshot } from '@/lib/ai-usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---- Mongo singleton (mirror lib/groq.js & extension routes so we
// don't open new pools per request in serverless deployment) ----
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

// Auth gate uses the canonical helper from `@/lib/auth` so the
// 401 message contract (`'Unauthorized' / 'Unauthorized — logga
// in i demoläge'`) is identical to every other protected route.

export async function GET(request) {
  const authRes = await requireAuth(request);
  if (authRes.error) return authRes.error;
  const clerkId = authRes.userId;
  try {
    const db = await getDb();
    const profile = await db.collection('profiles').findOne(
      { clerkId },
      { projection: { tier: 1, aiFallbackEnabled: 1 } },
    );
    // Fall back to an empty profile so the settings page can still
    // render the card for a brand-new demo user with no profile doc.
    const snapshot = await getUsageSnapshot(db, profile || { clerkId, tier: 'Basic' });
    return NextResponse.json({
      ...snapshot,
      // Always serialize booleans — Mongo sometimes returns `undefined`
      // for missing fields, and React prefers a strictly-typed value
      // for the Switch's checked binding. Default to `true` so a new
      // demo user doesn't have to flip the toggle to "use" AI.
      aiFallbackEnabled: profile?.aiFallbackEnabled !== false,
    });
  } catch (err) {
    console.error('[ai-usage] GET failed:', err?.message);
    // Don't leak internals — surface a friendly Swedish message and
    // a safe default payload so the UI doesn't go blank.
    return NextResponse.json({
      error: 'Kunde inte läsa AI-användning just nu.',
      count: 0,
      limit: 10,
      remaining: 10,
      tier: 'Basic',
      month: new Date().toISOString().slice(0, 7),
      aiFallbackEnabled: true,
    }, { status: 500 });
  }
}
