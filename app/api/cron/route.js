/**
 * Push-notify daily cron.
 *
 *  1. Find all profiles with active/trialing subscriptions
 *  2. For each: cheap pre-check whether they have an active push subscription
 *     (skips the heavy AF scrape when they don't).
 *  3. If pre-check passes: scrape up to 10 matching AF jobs, filter out
 *     already-applied ones, send ONE batch web-push notification with the
 *     new-match count and a link to /dashboard.
 *
 * This route never writes to `applications` and never sends applications
 * on behalf of users. Cover-letter generation lives in lib/groq.js (Groq)
 * and is invoked from /api/apply-now when the user is in the dashboard.
 *
 * For local dev: POST to /api/cron with header `x-cron-secret: <CRON_SECRET>`
 * For production: `vercel.json` schedules a POST 09:00 Stockholm time.
 */

import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { multiSourceSearchJobs } from '@/lib/jobScraper';
import { buildBatchMatchPayload, sendPushToUser } from '@/lib/push';

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
  const db = client.db(process.env.DB_NAME);
  // Idempotent compound index for the hot cron path:
  //   push_subscriptions.findOne({ clerkId, active: true })
  // Set the cache flag ONLY on success so a transient drop (network blip,
  // permission error during first call) does NOT become sticky — the next
  // cron run will retry the index creation.
  if (!global._jobbpilotenIndexesEnsured) {
    try {
      await db.collection('push_subscriptions').createIndex(
        { clerkId: 1, active: 1 },
        { name: 'idx_clerkId_active', background: true },
      );
      global._jobbpilotenIndexesEnsured = true;
    } catch (e) {
      // Index creation failures should not crash the cron; log and
      // leave the flag unset so the next run retries.
      console.warn('[cron] could not create push_subscriptions index:', e.message);
    }
  }
  return db;
}

/**
 * Requires CRON_SECRET header to prevent unauthorized access.
 */
function verifyCronSecret(req) {
  const secret = req.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // allow if not configured (dev mode)
  return secret && secret === expected;
}

/**
 * Cheap pre-check: does this subscriber have an active push subscription?
 *
 * The cron fires one batch push per subscriber. If the subscriber hasn't
 * enabled push, we can skip the entire scrape + filter pipeline (which
 * takes 1–3s per user against the AF API) and return early. Saves a lot
 * of work for heavy-list days where most users haven't opted into push.
 */
async function hasActivePushSubscription(db, clerkId) {
  const sub = await db.collection('push_subscriptions')
    .findOne({ clerkId, active: true }, { projection: { _id: 1 } });
  return !!sub;
}

/**
 * Run the daily cron job for one subscriber.
 */
async function runCronForSubscriber(db, profile) {
  const clerkId = profile.clerkId;
  const userId = profile.userId;

  // Push pre-check — bail out before the AF scrape if the user has
  // no active push subscription. The pipeline below only feeds the
  // push notification, so we don't need to do work for users we
  // can't deliver to. We deliberately do NOT write a cron_logs row
  // for this skip — it would bloat the collection with one row per
  // non-subscribed user per cron run. The aggregate `cron_batch_summary`
  // row already captures skipped counts.
  //
  // Wrapped in its own narrow try/catch so a Mongo blip on this cheap
  // pre-check is logged + counted as a skip, instead of propagating up
  // to the POST handler and failing the whole cron run.
  let hasPush = false;
  try {
    hasPush = await hasActivePushSubscription(db, clerkId);
  } catch (preErr) {
    console.warn('[cron] push pre-check failed for', clerkId, preErr.message);
    return { status: 'skipped', reason: 'pre_check_failed' };
  }
  if (!hasPush) {
    return { status: 'skipped', reason: 'push_not_subscribed' };
  }

  try {
    // Log entry allocated only when we'll actually persist it.
    const logEntry = {
      clerkId,
      userId,
      action: 'cron_run',
      status: 'started',
      startedAt: new Date(),
    };

    // 1. Fetch matching jobs (up to 10) for the subscriber's preferences.
    //    The cron no longer auto-saves applications — it just notifies the
    //    user about how many NEW matches exist so they can review them in
    //    the dashboard and apply manually.
    //
    //    Issue 4 (2026-07-10): switched to `multiSourceSearchJobs` so the
    //    cron now surfaces AdF + Blocket Jobb (JSON-LD) results. The
    //    higher volume means more potentially-matching ads per push tick.
    //    Issue 3 (2026-07-10): `multiSourceSearchJobs` now returns
    //    `{ jobs, hasMore }` instead of a bare array. The cron path
    //    doesn't paginate, so we destructure `jobs` and ignore
    //    `hasMore` (the cron fires once per delivery window with a
    //    fixed top-N).
    const query = (profile.jobTitles || []).slice(0, 2).join(' ');
    const location = (profile.locations || []).slice(0, 1).join(', ');
    const { jobs } = await multiSourceSearchJobs({ query, location, limit: 10 });

    if (jobs.length === 0) {
      logEntry.status = 'skipped';
      logEntry.reason = 'no_jobs_found';
      logEntry.finishedAt = new Date();
      await db.collection('cron_logs').insertOne(logEntry);
      return { status: 'skipped', reason: 'no_jobs_found' };
    }

    // 2. Filter out jobs the user has already applied to (or saved).
    const existingApps = await db.collection('applications')
      .find({ clerkId })
      .project({ company: 1, title: 1 })
      .toArray();
    const usedKeys = new Set(existingApps.map(a => `${a.company}|${a.title}`));

    const newJobs = jobs.filter(j => !usedKeys.has(`${j.company}|${j.title}`));

    // 3. Log the match run (always, even when no new jobs).
    logEntry.status = newJobs.length > 0 ? 'success' : 'skipped';
    logEntry.reason = newJobs.length > 0 ? null : 'no_new_matches';
    logEntry.matchedCount = jobs.length;
    logEntry.newCount = newJobs.length;
    logEntry.finishedAt = new Date();
    await db.collection('cron_logs').insertOne(logEntry);

    if (newJobs.length === 0) {
      console.log(`[cron] no new matches for ${clerkId} (${jobs.length} scraped, all already applied)`);
      return { status: 'skipped', reason: 'no_new_matches' };
    }

    // 4. Web-push notification — ONE batch push with the new-match count
    //    and a link to the dashboard. Best-effort: a push failure must not
    //    fail the whole cron run.
    try {
      const pushPayload = buildBatchMatchPayload({ count: newJobs.length, jobId: newJobs[0]?.id });
      const pushResult = await sendPushToUser(db, clerkId, pushPayload);
      logEntry.pushNotification = {
        sent: pushResult.sent,
        total: pushResult.total,
        skipped: pushResult.skipped || null,
        error: pushResult.error || null,
        kind: 'batch_match',
        count: newJobs.length,
      };
      await db.collection('cron_logs').updateOne(
        { _id: logEntry._id },
        { $set: { pushNotification: logEntry.pushNotification } },
      );
      if (pushResult.sent > 0) {
        console.log(`[cron] batch push sent to ${clerkId}: ${newJobs.length} nya jobb`);
      } else if (pushResult.skipped) {
        console.log(`[cron] push skipped for ${clerkId}: ${pushResult.skipped}`);
      }
    } catch (pushErr) {
      console.error('[cron] push error for', clerkId, pushErr.message);
      logEntry.pushNotification = { sent: 0, total: 0, error: pushErr.message, kind: 'batch_match' };
      await db.collection('cron_logs').updateOne(
        { _id: logEntry._id },
        { $set: { pushNotification: logEntry.pushNotification } },
      );
    }

    return {
      status: 'success',
      newCount: newJobs.length,
      topMatches: newJobs.slice(0, 3).map(j => ({ company: j.company, title: j.title })),
    };
  } catch (err) {
    console.error('[cron] error for', clerkId, err.message);
    logEntry.status = 'error';
    logEntry.error = err.message;
    logEntry.finishedAt = new Date();
    await db.collection('cron_logs').insertOne(logEntry);
    return { status: 'error', error: err.message };
  }
}

// ================================================================
// Extension-token age-out sweep
// ================================================================
//
// Runs once per cron tick to keep the `extension_tokens` collection
// from growing unbounded for users who stopped using the extension.
// A token is "stale" when:
//   • lastUsedAt < now-90d              (used at least once, but not in 3 months)
//   OR
//   • lastUsedAt is null/missing AND createdAt < now-30d
//                                       (never used within the 30-day grace window)
//
// We deliberately do NOT budget on token count per user — the
// per-user multi-device case (laptop + phone + work desktop) is
// supported. The 90-day window keeps the audit list in
// /settings/page.js readable even for users who reconnect a
// device every few months.
//
// Single deleteMany at the top of runCron() (not per-user) so the
// query can use the existing token index. The cost is bounded by
// the concurrency of the cron run — only one fires per day from
// Vercel Cron per vercel.json.
const EXTENSION_TOKEN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;     // 90 days (used long ago)
const EXTENSION_TOKEN_GRACE_MS = 30 * 24 * 60 * 60 * 1000;       // 30 days (never-used grace)

async function pruneStaleExtensionTokens(db) {
  try {
    const cutoffAge = new Date(Date.now() - EXTENSION_TOKEN_MAX_AGE_MS);
    const cutoffGrace = new Date(Date.now() - EXTENSION_TOKEN_GRACE_MS);
    const res = await db.collection('extension_tokens').deleteMany({
      $or: [
        // Token HAS been used (lastUsedAt is a real Date) but not
        // within the last 90d. The `$type: 'date'` predicate is
        // critical: without it, MongoDB's BSON comparison order
        // ranks null < Date, so `{ lastUsedAt: { $lt: cutoffAge } }`
        // would also match every doc whose lastUsedAt is null or
        // missing — i.e. every freshly-minted never-used token
        // would be deleted by the very next cron run.
        { lastUsedAt: { $type: 'date', $lt: cutoffAge } },
        // Token was never used. Keep it for the 30-day grace
        // window so a user who mints from /dashboard then opens
        // Chrome on day 2 isn't locked out by their own tidiness.
        { lastUsedAt: null, createdAt: { $lt: cutoffGrace } },
        // Same as above with the missing-field variant — defensive
        // for any docs that pre-date the lastUsedAt update path.
        { lastUsedAt: { $exists: false }, createdAt: { $lt: cutoffGrace } },
      ],
    });
    if (res.deletedCount > 0) {
      console.log(`[cron] pruned ${res.deletedCount} stale extension_tokens`);
    }
    return res.deletedCount;
  } catch (e) {
    // Non-fatal — keep the cron run going even if the prune query
    // hits a transient Mongo blip. The next daily cron will retry.
    console.warn('[cron] extension_tokens prune failed:', e?.message);
    return 0;
  }
}

/**
 * Main cron handler — runs push-notify pass for all active subscribers.
 */
async function runCron() {
  const db = await getDb();

  // Sweep extension_tokens first so the audit list in
  // /settings stays bounded. Runs once per cron tick; no-op
  // when no stale tokens exist.
  await pruneStaleExtensionTokens(db);

  // Find all active subscribers
  const activeSubs = await db.collection('profiles')
    .find({ $or: [ { subscriptionStatus: { $in: ['active', 'trialing'] } }, { tier: { $in: ['Professional', 'Elite'] } } ] })
    .sort({ updatedAt: -1 })
    .limit(50) // safety limit
    .toArray();

  console.log(`[cron] running for ${activeSubs.length} active subscribers`);

  const results = [];
  for (const profile of activeSubs) {
    const result = await runCronForSubscriber(db, profile);
    results.push({ clerkId: profile.clerkId, ...result });
  }

  // Summary log
  await db.collection('cron_logs').insertOne({
    action: 'cron_batch_summary',
    subscribersProcessed: activeSubs.length,
    successCount: results.filter(r => r.status === 'success').length,
    skippedCount: results.filter(r => r.status === 'skipped').length,
    errorCount: results.filter(r => r.status === 'error').length,
    details: results,
    ranAt: new Date(),
  });

  return results;
}

// ================================================================
// Route handlers
// ================================================================

export async function GET(req) {
  // Manual trigger for testing
  if (req.headers.get('x-trigger') === 'run-now') {
    const results = await runCron();
    return NextResponse.json({ ok: true, cron: 'ran', results });
  }

  // Get recent cron logs
  const db = await getDb();
  const logs = await db.collection('cron_logs')
    .find({})
    .sort({ startedAt: -1 })
    .limit(20)
    .toArray();
  const clean = logs.map(({ _id, ...rest }) => rest);
  return NextResponse.json({ logs: clean });
}

export async function POST(req) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized — invalid cron secret' }, { status: 401 });
  }

  const results = await runCron();
  return NextResponse.json({ ok: true, cron: 'ran', results });
}
