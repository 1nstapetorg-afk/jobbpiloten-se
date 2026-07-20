// lib/af-compliance.js
//
// Round-41 / Part 7 (Sub-feature 3 — AF compliance check):
// Pure helper for the Arbetsförmedlingen compliance pace check.
// Extracted from app/dashboard/page.js so it can be unit-tested
// in node --test without pulling in the React/Next.js client
// runtime (the dashboard page is 'use client' and imports
// dynamic React components that don't resolve in node).
//
// `getAfCompliancePace(apps, now)` returns:
//   - `applied`: count of apps this month with status 'applied',
//     'user-sent', or 'confirmed' (the user actually sent —
//     'prepared' alone doesn't count because the user might never
//     have clicked "Skicka").
//   - `target`: the standardmål (14/month — AF's typical "1/week"
//     guidance, which the user can override via their individual
//     handlingsplan).
//   - `paceRequired`: minimum count for "on pace" at `now` =
//     floor(elapsed_days / total_days * target). A linear
//     interpolation so day 1 of 30 expects ~0 apps, day 15
//     expects ~7, day 30 expects 14. Catches "Du har 2
//     ansökningar den 25:e" early.
//   - `status`: 'behind' (applied < paceRequired AND applied < target),
//     'on-track' (applied >= paceRequired, not yet at target), or
//     'complete' (applied >= target).
//   - `elapsedDays` / `totalDays`: the window that the pace
//     interpolation is anchored on, surfaced for the dashboard
//     sub-line so the user sees "pace kräver X vid dag Y" copy.

export const AF_MONTHLY_TARGET = 14

export function getAfCompliancePace(apps, now = new Date()) {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const totalDays = Math.max(1, Math.round((endOfMonth - startOfMonth) / 86400000))
  const elapsedDays = Math.max(1, Math.min(totalDays, Math.ceil((now - startOfMonth) / 86400000)))
  let applied = 0
  for (const a of apps || []) {
    if (!a) continue
    if (a.status !== 'applied' && a.status !== 'user-sent' && a.status !== 'confirmed') continue
    // The 'applied' / 'confirmed' status already implies appliedAt
    // is set, but legacy rows from the pre-status-rework window
    // may carry userSentAt instead. Accept either.
    const tRaw = a.appliedAt || a.userSentAt
    const t = tRaw ? new Date(tRaw).getTime() : NaN
    if (Number.isFinite(t) && t >= startOfMonth.getTime() && t < endOfMonth.getTime()) applied++
  }
  // Linear-pace interpolation: how many apps the user SHOULD
  // have sent by `now` to be on a 14/month trajectory. Floor so
  // a brand-new user on day 1 sees "0" not "0.46".
  const paceRequired = Math.floor((elapsedDays / totalDays) * AF_MONTHLY_TARGET)
  // Round-41.1 (Code-reviewer catch): the behind-check uses
  // `Math.max(1, paceRequired)` instead of `paceRequired`
  // directly. On day 1 of a 31-day month the linear
  // interpolation yields paceRequired=0, and the naive check
  // `applied < 0` is always false — so a brand-new user with
  // 0 apps on day 1 was silently being marked 'on-track' even
  // though the user contract is "you should have at least 1
  // app by now". The `Math.max(1, ...)` guard makes the
  // behind-check fire on day 1 (0 < 1) without disturbing the
  // standardmål arithmetic (paceRequired itself stays at 0
  // so the UI's pace-marker overlay can hide the marker on
  // day 1 via its own `paceRequired > 0` guard).
  let status = 'on-track'
  if (applied >= AF_MONTHLY_TARGET) status = 'complete'
  else if (applied < Math.max(1, paceRequired)) status = 'behind'
  return { applied, target: AF_MONTHLY_TARGET, paceRequired, status, elapsedDays, totalDays }
}
