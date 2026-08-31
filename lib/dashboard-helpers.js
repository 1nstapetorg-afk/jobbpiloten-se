// lib/dashboard-helpers.js
//
// Round-88 — pure, React-free helpers extracted from app/dashboard/page.js
// (dashboard monolith split). Follows the precedent of lib/af-compliance.js
// (also extracted from the dashboard): keeping these as plain ESM lets the
// node --test runner import them directly without pulling in the Next.js /
// React client runtime. Nothing in this file touches React or the DOM.

/**
 * Round-80 / Bug 2 fix — JSON parse guard. The dashboard fetches a
 * handful of API endpoints on mount; if ANY of them returns a
 * non-JSON body (an HTML /sign-in redirect page from Clerk middleware,
 * a proxy error page, an empty 500 body), the raw `r.json()` throws
 * "Failed to execute 'json' on 'Response': Unexpected end of JSON
 * input" and the whole Promise.all rejects — blanking every tile.
 * This helper reads the body defensively and returns `{}` on any
 * parse failure so callers never crash on a misbehaving route.
 */
export async function readJsonSafely(res) {
  try {
    if (!res) return {}
    // Only attempt JSON when the response actually claims JSON — an
    // HTML error page / redirect target would fail the parse anyway.
    const contentType = String(res.headers?.get?.('content-type') || '')
    if (contentType && !/application\/json|text\/json/i.test(contentType)) {
      return {}
    }
    return await res.json()
  } catch {
    return {}
  }
}

/**
 * Read the best e-postadress from a Clerk-or-demo `user` object.
 * Mirrors the helper in app/onboarding/page.js so the two paths stay
 * aligned if either changes.
 */
export function readClerkEmail(user) {
  if (!user) return ''
  return (
    user.primaryEmailAddress?.emailAddress ||
    user.emailAddresses?.[0]?.emailAddress ||
    user.email ||
    ''
  )
}

/** Compose a display name from a Clerk-or-demo `user`. */
export function readClerkFullName(user) {
  if (!user) return ''
  if (user.fullName) return user.fullName
  const fn = (user.firstName || '').trim()
  const ln = (user.lastName || '').trim()
  const joined = [fn, ln].filter(Boolean).join(' ').trim()
  return joined || ''
}

/** Read the phone number from a Clerk-or-demo `user`. */
export function readClerkPhone(user) {
  if (!user) return ''
  return (
    (Array.isArray(user.phoneNumbers) && user.phoneNumbers[0]?.phoneNumber) ||
    user.phone ||
    user.primaryPhoneNumber?.phoneNumber ||
    ''
  )
}

/**
 * Merge a stored profile with a Clerk-or-demo user so the “Dina uppgifter”
 * section in the AI cover-letter modal is never blank for fields that
 * Clerk already knows (email, full name, phone). Profile values WIN when
 * set, so the user's explicit edits in /settings are never overwritten.
 *
 * Bug #4 — without this merge, an account created before the email-field
 * fix shows an empty “E-post:” row in the modal because the MongoDB
 * profile document has `email: ''`. Pulled in client-side because we
 * don't want to expose a third-party OAuth fetch server-side just for
 * two simple string reads.
 */
export function mergeProfileWithUser(profile, user) {
  return {
    ...(profile || {}),
    fullName: profile?.fullName || readClerkFullName(user) || '',
    email: profile?.email || readClerkEmail(user) || '',
    phone: profile?.phone || readClerkPhone(user) || '',
  }
}

export const fmtDate = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
export const monthNames = ['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december']

// Status display config (shared by the dashboard's StatusPill +
// StatusBadge chips).
export const STATUS_MAP = {
  'prepared': { label: 'Förberedd', bg: 'bg-blue-100', text: 'text-blue-800' },
  'applied': { label: 'Ansökt', bg: 'bg-amber-100', text: 'text-amber-800' },
  // 'user-sent' is the legacy name; collapsed into the same label as 'applied'
  // so existing rows render the same badge as new ones.
  'user-sent': { label: 'Ansökt', bg: 'bg-amber-100', text: 'text-amber-800' },
  'confirmed': { label: 'Bekräftad', bg: 'bg-emerald-100', text: 'text-emerald-800' },
}

// --------------------------------------
// Visual helpers (Task 2 redesign)
// --------------------------------------

/**
 * Compute the next 09:00 Stockholm time from `from` (defaults to now).
 * Stockholms-tid (Europe/Stockholm) is CET (UTC+1) vintertid och CEST (UTC+2)
 * sommartid. Vi använder en enkel minuts-baserad differens: om klockan är
 * före 09:00 lokalt idag → idag 09:00; annars → imorgon 09:00.
 *
 * Vi håller det enkelt och returnerar en Date i *lokal* tid — UI:t visar
 * diffen i timmar/minuter från `now`. Vi undviker tz-bibliotek för att inte
 * lägga till ett beroende bara för en banner.
 */
export function nextCronAt(from = new Date()) {
  const next = new Date(from)
  next.setHours(9, 0, 0, 0)
  if (next <= from) next.setDate(next.getDate() + 1)
  return next
}

/**
 * Format the time until next 09:00 as a short Swedish string.
 *   > 24 h  → "imorgon 09:00"
 *   > 1 h   → "om Xh Ym"
 *   > 0 min → "om Xm"
 *   <= 0    → "Nu!"
 */
export function fmtTimeUntil(target, now = new Date()) {
  const diffMs = target.getTime() - now.getTime()
  if (diffMs <= 0) return 'Nu'
  const totalMin = Math.floor(diffMs / 60000)
  if (totalMin >= 60 * 24) {
    return 'imorgon 09:00'
  }
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `om ${m} min`
  if (m === 0) return `om ${h} h`
  return `om ${h} h ${m} min`
}

/**
 * getMonthlyTrend — counts apps matching `matchFn(a)` in the current
 * 30-day window vs the PREVIOUS 30-day window, then maps to a small
 * 'up' / 'down' / 'flat' signal + delta. Round-33.2 hero-stats polish
 * (Round-33.3 review-fix pass: per-card timestamp selection —
 * `appliedAt` for status-based cards, `savedAt` for the saved-only
 * card, `createdAt` for the catch-all total card).
 *
 * Why per-card timestamp selection: the `saved`-matcher counts jobs
 * the user starred but never applied to. Those rows carry `savedAt`
 * but typically NO `appliedAt`. Falling back through a single
 * `appliedAt || savedAt || createdAt` chain silently mis-bucketed
 * them (Round-33.3 review flag #2). Per-card intent is now
 * explicit so a future maintainer can't re-introduce the bug by
 * trimming the function for "DRY".
 *
 * Pure client computation: the dashboard's `apps` array already
 * carries all the data we need (no /api/stats round-trip), so the
 * hero cards can show period deltas without a server change. The
 * headline values for the period-eligible cards (saved / this-
 * month / confirmed) are now pulled from `trend.current` so the
 * headline number IS the period count — not a mismatched lifetime
 * total (Round-33.3 review flag #1, the headline-vs-trend
 * contract liar). The "Totalt antal" cumulative card has no trend
 * by design — a 30-day delta on a cumulative count is a category
 * error.
 */
export function getMonthlyTrend(apps, matchFn, timestampKey) {
  const now = Date.now()
  const monthAgo = now - 30 * 86400000
  const twoMonthsAgo = now - 60 * 86400000
  let current = 0
  let previous = 0
  for (const a of apps || []) {
    if (!matchFn(a)) continue
    const tRaw = a && a[timestampKey]
    const t = tRaw ? new Date(tRaw).getTime() : NaN
    if (Number.isFinite(t) && t >= monthAgo) current++
    else if (Number.isFinite(t) && t >= twoMonthsAgo) previous++
  }
  if (current > previous) return { current, previous, trend: 'up', delta: current - previous }
  if (current < previous) return { current, previous, trend: 'down', delta: previous - current }
  return { current, previous, trend: 'flat', delta: 0 }
}
