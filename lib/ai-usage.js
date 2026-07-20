/**
 * lib/ai-usage.js
 *
 * Single source of truth for the AI-answer monthly cap + counter. Used
 * by:
 *   • POST /api/extension/ai-answers — increments `count` after each
 *     Groq call so a runaway form page can't burn the user's monthly
 *     budget.
 *   • GET /api/profile  — surfaces the same counter so /settings can
 *     render "AI har skrivit X svar åt dig denna månad" without an
 *     extra round-trip.
 *   • app/settings/page.js — reads the limit for the user's current
 *     tier to render "Basic 10/mo · Pro 50/mo · Elite obegränsat".
 *
 * Storage shape: a single document per (clerkId, monthKey) so the
 * counter is cheap to read+update. Reads are .findOne, writes use
 * `$inc` with upsert so concurrent writes are atomic on the same doc.
 *
 * Why a dedicated collection instead of piggy-backing on `profile`:
 *   • Avoids bloating the profile document with usage state the
 *     extension should never see (and `buildExtensionProfile()` would
 *     have to filter out per the safe-payload rules in
 *     lib/extension-profile.js).
 *   • Lets us cap the projection cleanly when the counter grows.
 *   • Lets a future "rotate / archive" cron clean out old months
 *     without touching the user's profile.
 */

/**
 * Soft-launch tier limits per user. The numbers are mirrored on
 * /settings and on /#priser so any change here has to be reflected in
 * those places too — the soft-launch checklist in PROJECT_STATUS.md
 * flags the Stripe price for each tier so a higher cap can be wired up
 * later via env vars (AI_LIMIT_BASIC / AI_LIMIT_PRO / AI_LIMIT_ELITE)
 * without source changes.
 */
export const AI_TIER_LIMITS = Object.freeze({
  Basic: 10,
  Professional: 50,
  Elite: Infinity,
})

/**
 * Returns the `YYYY-MM` bucket key for a given Date. Stable across
 * timezones — we always use the UTC year+month because the cron runs
 * on UTC and the dashboard shows "denna månad" relative to the same
 * boundary.
 */
export function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Maps the user's tier to the monthly AI-answer cap. Unknown / unset
 * tiers default to `Basic` so a brand-new demo user (default tier
 * 'Basic') still gets a sensible number read from the SAME source
 * the rest of the app uses. This is the canonical lookup — every
 * caller should use this instead of `AI_TIER_LIMITS[tier]` directly
 * so a future env override (`process.env.AI_LIMIT_BASIC`) can be
 * added in one spot.
 */
export function getMonthlyLimitFor(tier) {
  if (typeof tier === 'string' && tier in AI_TIER_LIMITS) return AI_TIER_LIMITS[tier]
  return AI_TIER_LIMITS.Basic
}

/**
 * Cheap pre-flight check: would adding `delta` to the current
 * counter push the user over their monthly cap? Pure function for the
 * hot path so the route handler can short-circuit BEFORE making 12
 * LLM calls only to discard 11. Treats `Infinity` (Elite tier) as
 * never-exceeded.
 */
export function isWithinLimit(currentCount, delta, limit) {
  if (limit === Infinity) return true
  if (typeof currentCount !== 'number' || currentCount < 0) return true
  if (typeof delta !== 'number' || delta <= 0) return true
  return currentCount + delta <= limit
}

/**
 * Read the current month's usage for a user. Falls back to 0 if no
 * doc exists yet (the upsert on first write will create the row).
 */
export async function getCurrentCount(db, clerkId, month = monthKey()) {
  if (!db || !clerkId) return 0
  const doc = await db
    .collection('ai_usage')
    .findOne({ clerkId, month }, { projection: { count: 1 } })
  return typeof doc?.count === 'number' ? doc.count : 0
}

/**
 * Atomically increment the user's monthly counter by `delta`. Uses
 * `$inc` + `upsert` so concurrent calls can't double-count or skip a
 * month boundary. Negative deltas are silently ignored to prevent
 * accidental corruption from a buggy caller.
 */
export async function incrementUsage(db, clerkId, delta = 1, month = monthKey()) {
  if (!db || !clerkId) return
  if (typeof delta !== 'number' || delta <= 0) return
  await db.collection('ai_usage').updateOne(
    { clerkId, month },
    {
      $inc: { count: delta },
      $setOnInsert: { clerkId, month, createdAt: new Date() },
      $set: { updatedAt: new Date() },
    },
    { upsert: true },
  )
}

/**
 * Convenience: read the current count for a user + the cap for their
 * tier in one trip. Returns `{ count, limit, tier, month }` so the
 * caller doesn't have to re-resolve the tier every time. Used by
 * /settings UI on mount.
 */
export async function getUsageSnapshot(db, profile) {
  const tier = profile?.tier || 'Basic'
  const month = monthKey()
  const count = await getCurrentCount(db, profile?.clerkId, month)
  const limit = getMonthlyLimitFor(tier)
  return {
    count,
    limit,
    tier,
    month,
    /** `remaining` is `Infinity` for Elite so the UI can render
     *  "obegränsat" instead of a misleading numeric value. */
    remaining: limit === Infinity ? Infinity : Math.max(0, limit - count),
  }
}
