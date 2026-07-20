/**
 * Shared web-push helper.
 *
 * Used by:
 *   - /api/notify  (broadcast — sends to every active push subscription)
 *   - /api/cron    (single-user — sends to the matched subscriber only)
 *
 * Centralises VAPID setup and stale-subscription cleanup (410 Gone).
 */

import webpush from 'web-push';
import { PUSH_VAPID_FALLBACK_SUBJECT } from './siteConfig';

let vapidConfigured = false;

/**
 * Lazily configure web-push from environment. Safe to call multiple times.
 */
function ensureVapidConfigured() {
  if (vapidConfigured) return true;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || PUSH_VAPID_FALLBACK_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  vapidConfigured = true;
  return true;
}

/**
 * Build a standard "new job match" push payload.
 * The service worker reads `data.jobId` to deep-link back to the dashboard.
 */
export function buildJobMatchPayload({ jobId, company, title }) {
  return {
    title: `Nytt jobb: ${title} på ${company}`,
    body: `AI har hittat ett matchande jobb: ${title} hos ${company}`,
    jobId,
    company,
    title,
  };
}

/**
 * Build a "batch match" push payload — used by the daily cron when it finds
 * MULTIPLE new matching jobs for a subscriber. Instead of spamming N push
 * notifications, the cron sends ONE notification summarising the count and
 * deep-links to the dashboard.
 *
 * The service worker reads `data.url` to navigate when the user clicks the
 * notification; if absent, it falls back to `/dashboard`.
 */
export function buildBatchMatchPayload({ count, jobId }) {
  const safeCount = Math.max(1, Number(count) || 0);
  const noun = safeCount === 1 ? 'nytt jobb' : 'nya jobb';
  // Round-23 cron deep-link: when the cron surfaces a single top match the
  // user lands directly on that job's prep modal via /dashboard?jobId=X.
  // Multiple matches fall back to the general dashboard view (the existing
  // service worker behavior at public/service-worker.js line ~62 reads
  // notification.data.url verbatim). jobId is also exposed in `data` so the
  // SW can read it independently if the URL ever needs to be reshaped.
  return {
    title: safeCount === 1
      ? 'Vi hittade 1 nytt jobb som matchar dig!'
      : `Vi hittade ${safeCount} nya jobb som matchar dig!`,
    body: 'Klicka här för att se dem i din dashboard.',
    url: jobId ? `/dashboard?jobId=${encodeURIComponent(jobId)}` : '/dashboard',
    kind: 'batch_match',
    count: safeCount,
    jobId: jobId || null,
  };
}

/**
 * Send a single push notification to one user's active subscription.
 * Returns { sent, total, error? }.
 */
export async function sendPushToUser(db, clerkId, payload) {
  if (!ensureVapidConfigured()) {
    return { sent: 0, total: 0, skipped: 'vapid_not_configured' };
  }
  const sub = await db.collection('push_subscriptions').findOne({ clerkId, active: true });
  if (!sub) return { sent: 0, total: 0, skipped: 'no_active_subscription' };
  return sendToSubscription(db, sub, payload);
}

/**
 * Broadcast a push to every active push subscription in the system.
 * Returns { sent, total, deactivated, error? }.
 */
export async function broadcastPush(db, payload) {
  if (!ensureVapidConfigured()) {
    return { sent: 0, total: 0, skipped: 'vapid_not_configured' };
  }
  const subs = await db.collection('push_subscriptions').find({ active: true }).toArray();
  let sent = 0;
  let deactivated = 0;
  let lastError = null;
  for (const sub of subs) {
    const r = await sendToSubscription(db, sub, payload);
    sent += r.sent;
    if (r.deactivated) deactivated += 1;
    if (r.error) lastError = r.error;
  }
  return { sent, total: subs.length, deactivated, error: lastError };
}

/**
 * Low-level: send to one subscription document. Deactivates on 410 Gone.
 */
async function sendToSubscription(db, sub, payload) {
  try {
    await webpush.sendNotification(sub.subscription, JSON.stringify(payload));
    return { sent: 1 };
  } catch (err) {
    if (err.statusCode === 410) {
      await db.collection('push_subscriptions').updateOne(
        { _id: sub._id },
        { $set: { active: false, updatedAt: new Date() } },
      );
      return { sent: 0, deactivated: true };
    }
    return { sent: 0, error: err.message };
  }
}
