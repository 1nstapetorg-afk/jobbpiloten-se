'use client'

import { useEffect, useState, useRef, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useUser } from '@/hooks/useAuth'
import dynamic from 'next/dynamic'
import Link from 'next/link'

const ClerkUserButton = dynamic(
  () => import('@clerk/nextjs').then(mod => ({ default: mod.UserButton })).catch(() => ({ default: () => null })),
  { ssr: false }
)

// Canonical client-side Clerk check — see lib/clerk-config.js.
import { isClerkConfiguredClient } from '@/lib/clerk-config'
const isClerkConfigured = isClerkConfiguredClient

function SafeUserButton(props) {
  if (!isClerkConfigured()) return null
  return <ClerkUserButton {...props} />
}
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Plane, Sparkles, FileText, Check, Zap, Loader2,
  Building2, MapPin, Download, Rocket, ExternalLink, Briefcase, Bell, BellOff,
  Copy, Send, Star, Search, Clock, BookOpen, Sparkle, ArrowUpRight, Settings as SettingsIcon2,
  TrendingUp, TrendingDown, Minus, Mail,
} from 'lucide-react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import ErrorBoundary from '@/components/ErrorBoundary'
import { toast } from 'sonner'
import { SUPPORT_EMAIL, VAPID_PUBLIC_KEY, EXTENSION_PUBLISHED, EXTENSION_STORE_URL } from '@/lib/siteConfig'
import { buildBlocketSearchUrl, buildJobSafariSearchUrl, buildLedigaJobbSearchUrl } from '@/lib/jobScraper'
import { locationsToLänCodes, doesJobMatchUserLocation } from '@/lib/swedishLocations'
import ProfileAvatar from '@/components/ProfileAvatar'

/**
 * Read the best e-postadress from a Clerk-or-demo `user` object.
 * Mirrors the helper in app/onboarding/page.js so the two paths stay
 * aligned if either changes.
 */
function readClerkEmail(user) {
  if (!user) return ''
  return (
    user.primaryEmailAddress?.emailAddress ||
    user.emailAddresses?.[0]?.emailAddress ||
    user.email ||
    ''
  )
}

/** Compose a display name from a Clerk-or-demo `user`. */
function readClerkFullName(user) {
  if (!user) return ''
  if (user.fullName) return user.fullName
  const fn = (user.firstName || '').trim()
  const ln = (user.lastName || '').trim()
  const joined = [fn, ln].filter(Boolean).join(' ').trim()
  return joined || ''
}

/** Read the phone number from a Clerk-or-demo `user`. */
function readClerkPhone(user) {
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
function mergeProfileWithUser(profile, user) {
  return {
    ...(profile || {}),
    fullName: profile?.fullName || readClerkFullName(user) || '',
    email: profile?.email || readClerkEmail(user) || '',
    phone: profile?.phone || readClerkPhone(user) || '',
  }
}

const fmtDate = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
const monthNames = ['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december']

// Round-41 / Part 7 (Sub-feature 3 — AF compliance check):
// AF's standardmål is ~14 ansökningar/månad (≈1 per vecka). The
// pure helper lives in lib/af-compliance.js (extracted so the
// node --test runner can import it without pulling in the React/
// Next.js client runtime). The /api/report PDF (lib/pdf-report.js)
// carries the same disclaimer — both surfaces share the contract:
// "Standardmål 14/mån — du ansvarar för att din individuella
// handlingsplan uppfylls."
import { getAfCompliancePace } from '@/lib/af-compliance'
import { computeMatchScore, isPreparedForAF } from '@/lib/match-score'
import { atsMatch } from '@/lib/ats-keywords'

// Status display config
const STATUS_MAP = {
  'prepared': { label: 'Förberedd', bg: 'bg-blue-100', text: 'text-blue-800' },
  'applied': { label: 'Ansökt', bg: 'bg-amber-100', text: 'text-amber-800' },
  // 'user-sent' is the legacy name; collapsed into the same label as 'applied'
  // so existing rows render the same badge as new ones.
  'user-sent': { label: 'Ansökt', bg: 'bg-amber-100', text: 'text-amber-800' },
  'confirmed': { label: 'Bekräftad', bg: 'bg-emerald-100', text: 'text-emerald-800' },
}

// Application-status filters for the Ansökningar table.
// "not_applied" = AI förberedd, användaren har inte skickat än.
// "applied"     = användaren har skickat (status: applied) eller fått svar (confirmed).
// "saved"       = användaren har stjärnmärkt ansökan (saved === true).
// 'user-sent' is also matched for back-compat with older rows.
const FILTERS = [
  { key: 'all', label: 'Alla', match: () => true },
  { key: 'not_applied', label: 'Ej ansökta', match: (a) => a.status === 'prepared' },
  { key: 'applied', label: 'Ansökta', match: (a) => a.status === 'applied' || a.status === 'user-sent' || a.status === 'confirmed' },
  { key: 'saved', label: 'Sparade', match: (a) => a.saved === true },
  // Round-38 / Part 4 polish: e-post filter chip. Matches
  // applications where the source discriminator is 'email' (set
  // server-side by /api/applications/email). The order in this
  // array matches the visual order in the dashboard tab strip.
  { key: 'email', label: 'E-post', match: (a) => a.source === 'email' },
]

/**
 * Resolve the best job-application URL for an application, with a three-tier
 * fallback chain:
 *
 *   1. `direct`      — the application has a real `jobUrl` from the scraper
 *                      (e.g. AF's `webpage_url`, `application_details.url`,
 *                      or an external application link). Preferred.
 *   2. `platsbanken` — construct `https://arbetsformedlingen.se/platsbanken/annonser/<id>`
 *                      from `externalId` (the raw AF job id). Always works
 *                      for AF-sourced jobs even when the scraper couldn't
 *                      resolve a direct application link.
 *   3. `search`      — last-resort Google search for "{title} {company}
 *                      jobb Sverige". Only used when no AF job id is known
 *                      (e.g. the seeded SAMPLE_JOBS pool used by the
 *                      "Kör AI-assistenten nu" button).
 *
 * Returns `{ url, source }` or `null` if there is nothing to open.
 */
function resolveApplicationUrl(app) {
  if (!app) return null
  if (app.jobUrl) {
    return { url: app.jobUrl, source: 'direct' }
  }
  if (app.externalId) {
    return {
      url: `https://arbetsformedlingen.se/platsbanken/annonser/${app.externalId}`,
      source: 'platsbanken',
    }
  }
  const q = `${app.title || ''} ${app.company || ''}`.trim()
  if (!q) return null
  return {
    url: `https://www.google.com/search?q=${encodeURIComponent(q + ' jobb Sverige')}`,
    source: 'search',
  }
}

// Visual treatment for the job-link button in the prep modal, keyed by URL
// source as resolved by `resolveApplicationUrl` above. Mirrors the
// `STATUS_MAP` / `FILTERS` pattern already used in this file: each entry
// bundles the visible label, icon, outline color and helper-title.
//
// Label rule (binary, mirrors how the user reads the button):
//   - real URL exists (direct OR platsbanken) → "Gå till ansökningssida"
//     (with visual differentiation so users can tell whether they're going
//     to the employer's own page or to Platsbanken's ad page).
//   - Google-search fallback only            → "Sök jobbet".
const HAS_URL_VIEW = {
  label: 'Gå till ansökningssida',
  Icon: ExternalLink,
}

const SOURCE_STYLE = {
  // Real `jobUrl` from the scraper (AF webpage_url / application_details.url
  // or an external application link). Tinted indigo to match the brand.
  direct: {
    className: 'border-indigo-300 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800',
    title: 'Öppnar arbetsgivarens egen ansökningssida',
  },
  // Constructed from `externalId` -- always Platsbanken. Tinted blue so
  // the user can tell at a glance they're going to a listing page
  // rather than the employer directly.
  platsbanken: {
    className: 'border-blue-300 text-blue-700 hover:bg-blue-50 hover:text-blue-800',
    title: 'Öppnar annonsen på Platsbanken (arbetsformedlingen.se)',
  },
}

/**
 * Per-source Tier-3 fallback lookup for `resolveApplicationUrl()`.
 * Replaces the Round-54 monolithic `SEARCH_VIEW` ("Sok pa Google").
 * The user's spec is: NEVER show generic "Sok pa Google"; instead use
 * the source's own job-board search so the destination is unambiguous.
 *
 * Lookup order (first matching wins, fallback at the end):
 *   1. 'blocket'   -> `Sok pa Blocket` + buildBlocketSearchUrl()
 *   2. 'ledigajobb'-> `Sok pa Ledigajobb` + buildLedigaJobbSearchUrl()
 *   3. catch-all   -> `Sok jobbet` + Google search (last resort)
 *
 * The `buildUrl({ app, profile })` signature lets each entry fall back
 * to the job's own title/company when the user has no profile
 * preferences set, so the constructed URL is always actionable.
 */
const matchesJobSource = (app, needle) =>
  String(app && app.source || '').toLowerCase().includes(needle)

const buildGoogleSearchUrl = (app) => {
  const q = `${app && app.title || ''} ${app && app.company || ''}`.trim()
  if (!q) return null
  return `https://www.google.com/search?q=${encodeURIComponent(q + ' jobb Sverige')}`
}

const SOURCE_FALLBACKS = [
  {
    key: 'blocket',
    match: (app) => matchesJobSource(app, 'blocket'),
    label: 'Sok pa Blocket',
    Icon: Search,
    className: 'border-blue-300 text-blue-700 hover:bg-blue-50 hover:text-blue-800',
    title: 'Ingen direktlank hittades -- oppnar Blocket Jobb med jobbets titel + foretag',
    buildUrl: ({ app, profile }) => buildBlocketSearchUrl({
      query: (profile && Array.isArray(profile.jobTitles) && profile.jobTitles[0]) || (app && app.title) || '',
      location: (profile && Array.isArray(profile.locations) && profile.locations[0]) || '',
    }),
  },
  {
    key: 'ledigajobb',
    match: (app) => matchesJobSource(app, 'ledigajobb'),
    label: 'Sok pa Ledigajobb',
    Icon: Search,
    className: 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800',
    title: 'Ingen direktlank hittades -- oppnar Ledigajobb.se med jobbets titel + foretag',
    buildUrl: ({ app, profile }) => buildLedigaJobbSearchUrl({
      query: (profile && Array.isArray(profile.jobTitles) && profile.jobTitles[0]) || (app && app.title) || '',
      location: (profile && Array.isArray(profile.locations) && profile.locations[0]) || '',
    }),
  },
  {
    // Catch-all Tier-3 fallback -- Google search. Used when the job has
    // NO `jobUrl`, NO `externalId`, AND no recognisable source name.
    // Per the user's spec, this is the LAST resort -- prefer per-source.
    key: 'generic',
    match: () => true,
    label: 'Sok jobbet',
    Icon: Search,
    className: 'border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800',
    title: 'Ingen direktlank hittades -- oppnar en Google-sokning pa jobbets titel + foretag',
    buildUrl: ({ app, profile }) => {
      const profileTitle = (profile && Array.isArray(profile.jobTitles) && profile.jobTitles[0]) || ''
      const profileLocation = (profile && Array.isArray(profile.locations) && profile.locations[0]) || ''
      // Spread profile + app so profile.jobTitles[0] wins over app.title (so a user whose
      // profile preferences are set gets a clean Google search even when the application
      // row has only a stub title).
      return buildGoogleSearchUrl({
        ...app,
        title: profileTitle || (app && app.title) || '',
        company: (app && app.company) || '',
        location: profileLocation || (app && app.location) || '',
      })
    },
  },
]

function resolveSearchFallback(app, profile) {
  if (!app) return SOURCE_FALLBACKS[SOURCE_FALLBACKS.length - 1]
  const entry = SOURCE_FALLBACKS.find((f) => f.match(app))
  return entry || SOURCE_FALLBACKS[SOURCE_FALLBACKS.length - 1]
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
function nextCronAt(from = new Date()) {
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
function fmtTimeUntil(target, now = new Date()) {
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
 * NextCronBanner — sticky-ish status pill at the top of the dashboard that
 * tells the user when the next daily cron will run. Updates its countdown
 * text every minute via a small `useEffect` interval so it stays accurate
 * even after the user leaves the tab open for hours. Amber accent matches
 * the rest of the brand palette. Renders nothing if `hideUntil` is set.
 */
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
function getMonthlyTrend(apps, matchFn, timestampKey) {
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

/**
 * TrendBadge — tiny pill rendered next to the AnimatedCounter inside
 * each hero-stat card. Three visual modes mirror the underlying
 * signal:
 *   up   → emerald, TrendingUp icon, "+N denna period"
 *   down → slate-700 (NOT red — too alarming for a stat counter),
 *          TrendingDown icon, "−N från förra perioden"
 *   flat → slate-500, Minus icon, "oförändrat"
 * The "down" tone intentionally uses slate-700 (not red-700) so the
 * card still reads as a softly-tracked metric rather than an
 * alert — the dashboard is informational, not a transactional
 * order book. Title attribute carries the full sentence for
 * hover/assistive-tech.
 */
function TrendBadge({ trend, delta }) {
  if (!trend) return null
  const cfg = {
    up:   { Icon: TrendingUp,   cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: `+${delta} denna period` },
    down: { Icon: TrendingDown, cls: 'text-slate-700 bg-slate-100 border-slate-200',     label: `−${delta} från förra perioden` },
    flat: { Icon: Minus,        cls: 'text-slate-500 bg-slate-50 border-slate-200',       label: 'oförändrat' },
  }[trend]
  if (!cfg) return null
  const { Icon, cls, label } = cfg
  return (
    <span
      data-testid={`stat-trend-${trend}`}
      title={label}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold leading-tight ${cls}`}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {label}
    </span>
  )
}

function NextCronBanner({ hideUntil = null }) {
  const [now, setNow] = useState(() => new Date())

  // Visibility-aware ticker. We pause the interval when the tab is hidden
  // to avoid wasted wakes and Force a fresh tick on resume so the countdown
  // text reflects the actual current time, not whatever `now` was when the
  // tab was last in the foreground.
  useEffect(() => {
    if (typeof document === 'undefined') return

    const tick = () => setNow(new Date())
    let intervalId = null
    const startInterval = () => {
      if (intervalId) return
      intervalId = setInterval(tick, 60_000)
    }
    const stopInterval = () => {
      if (!intervalId) return
      clearInterval(intervalId)
      intervalId = null
    }
    const applyVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick()
        startInterval()
      } else {
        stopInterval()
      }
    }
    applyVisibility()
    document.addEventListener('visibilitychange', applyVisibility)
    return () => {
      stopInterval()
      document.removeEventListener('visibilitychange', applyVisibility)
    }
  }, [])
  const target = useMemo(() => nextCronAt(now), [now])
  const text = fmtTimeUntil(target, now)
  return (
    <div
      data-testid="next-cron-banner"
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 text-amber-800 text-xs sm:text-sm shadow-sm"
    >
      <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="font-medium">Nästa uppdatering:</span>
      <span>{text}</span>
      {!hideUntil && (
        <span className="ml-auto text-amber-700/70 hidden sm:inline">AI letar nya matchande jobb varje morgon.</span>
      )}
    </div>
  )
}

/**
 * AnimatedCounter — value animates from 0 (or last value) to `value` when it
 * mounts/changes. Uses framer-motion's `animate(MotionValue, target, opts)`,
 * which gives us a smooth easeOutQuart curve without us having to write our
 * own rAF loop. We still display formatted text for non-numeric values.
 *
 * Seed behavior: on first mount the motion value is set to `value` so users
 * never see a "0 → 5" flash for already-known counts. Only subsequent value
 * changes (e.g. after a refetch) get the animation. `seededRef` guards across
 * StrictMode double-invocation without flicker.
 */
function AnimatedCounter({ value = 0, formatter }) {
  const mv = useMotionValue(value)
  const seededRef = useRef(false)
  const display = useTransform(mv, (v) =>
    formatter ? formatter(Math.round(v)) : Math.round(v)
  )
  useEffect(() => {
    if (!seededRef.current) {
      // First mount — no animation, jump straight to the target.
      seededRef.current = true
      mv.set(value)
      return
    }
    const ctrl = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] })
    return () => ctrl.stop()
  }, [value, mv])
  return <motion.span>{display}</motion.span>
}

/**
 * CompanyLogo — gradient placeholder with the company's first letter.
 * Deterministic amber/indigo gradient seeded by company name so the same
 * company always renders the same gradient. Acts as a visual anchor on
 * each card (no real logo fetching needed).
 */
function CompanyLogo({ company = '?', size = 'md' }) {
  const c = (company || '?').trim()
  const letter = (c[0] || '?').toUpperCase()
  // Deterministic seed: sum of char codes mod 5
  const seed = c.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) % 5
  const gradients = [
    'from-amber-400 to-orange-500',
    'from-indigo-400 to-violet-500',
    'from-blue-400 to-cyan-500',
    'from-emerald-400 to-teal-500',
    'from-rose-400 to-pink-500',
  ]
  const dim = size === 'sm' ? 'w-9 h-9 text-sm' : size === 'lg' ? 'w-14 h-14 text-xl' : 'w-12 h-12 text-base'
  return (
    <div
      className={`${dim} rounded-xl bg-gradient-to-br ${gradients[seed]} flex items-center justify-center font-semibold text-white shadow-sm shrink-0`}
      aria-hidden="true"
    >
      {letter}
    </div>
  )
}

/**
 * StatusPill — re-styled status indicator for the redesigned card grid.
 * Larger and more legible than the old `<span>` badge; uses ring + dot
 * pattern with the configured palette per status key.
 */
function StatusPill({ status }) {
  const cfg = STATUS_MAP[status] || { label: status, bg: 'bg-slate-100', text: 'text-slate-700' }
  // Map each status palette to a recognizable dot color.
  const dotColor =
    status === 'applied' || status === 'user-sent' ? 'bg-amber-500' :
    status === 'confirmed' ? 'bg-emerald-500' :
    status === 'prepared' ? 'bg-blue-500' :
    'bg-slate-400'
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
      {cfg.label}
    </span>
  )
}

/**
 * Tag — small chip for job-type / location. Reused in cards to keep
 * metadata scannable. `tone` controls the palette (slate by default).
 */
function Tag({ children, Icon, tone = 'slate', dataTestid }) {
  const toneCls = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    indigo: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  }[tone] || 'bg-slate-100 text-slate-700 border-slate-200'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md border ${toneCls}`}
      data-testid={dataTestid}
    >
      {Icon ? <Icon className="w-3 h-3" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

/**
 * BroaderSearchCard — second-source search panel that opens Blocket Jobb /
 * Jobbsafari in a new tab with the user's primary title + location pre-filled.
 * Honest deep-links: we do not scrape or store their listings; we just hand
 * off the search query. Returns null when both URLs are empty so the parent
 * Card stack stays clean for users with an empty profile.
 */
function BroaderSearchCard({ profile }) {
  const primaryTitle = (profile?.jobTitles || [])[0] || ''
  const primaryLocation = (profile?.locations || [])[0] || ''
  const blocketUrl = buildBlocketSearchUrl({ query: primaryTitle, location: primaryLocation })
  const safariUrl = buildJobSafariSearchUrl({ query: primaryTitle, location: primaryLocation })
  if (!blocketUrl && !safariUrl) return null
  return (
    <Card className="border-0 shadow-sm" data-testid="broader-search-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="w-5 h-5 text-indigo-600" /> Letar du bredare?
        </CardTitle>
        <CardDescription>
          Vi matchar mot Arbetsförmedlingen ovan. För fler jobb, sök även på andra plattformar:
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          {blocketUrl && (
            <a
              href={blocketUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="broader-search-blocket"
              className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 hover:border-blue-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 text-sm font-medium"
            >
              <ExternalLink className="w-4 h-4" />
              Sök på Blocket
              <span className="text-xs text-blue-500/80 ml-1">jobb.blocket.se</span>
            </a>
          )}
          {safariUrl && (
            <a
              href={safariUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="broader-search-jobsafari"
              className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 hover:border-emerald-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 text-sm font-medium"
            >
              <ExternalLink className="w-4 h-4" />
              Sök på Jobbsafari
              <span className="text-xs text-emerald-500/80 ml-1">jobbsafari.se</span>
            </a>
          )}
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Båda sidor öppnas i din webbläsare. JobbPiloten skrapar eller lagrar inte Blocket / Jobbsafari-listan — vi använder bara AF:s öppna API.
        </p>
      </CardContent>
    </Card>
  )
}

// Round-22 regression net (caught by tests/e2e/dashboard-jobid-deeplink.spec.js):
// In Next.js 15 the `searchParams` prop is NO LONGER passed to client-component
// pages — call `useSearchParams()` and rename the export to a helper so we can
// wrap it in `<Suspense>` (Next.js 15.5 hard-bails otherwise). Inline addition
// keeps the diff small; only `searchParams` and the export shape touched.
function DashboardContent() {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [stats, setStats] = useState(null)
  const [apps, setApps] = useState([])
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [prepJob, setPrepJob] = useState(null) // job being prepared
  const [prepApplication, setPrepApplication] = useState(null) // application after apply-now
  const [prepProfile, setPrepProfile] = useState(null) // profile info for modal
  const [showPrep, setShowPrep] = useState(false)
  const [showLetter, setShowLetter] = useState(null)
  const [subscription, setSubscription] = useState(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [availableJobs, setAvailableJobs] = useState([])
  const [jobsLoading, setJobsLoading] = useState(true)
  // Issue 3 (2026-07-10): pagination state for the "Visa fler jobb"
  // button. `currentPage` mirrors the request cursor, `serverHasMore`
  // is the raw signal from the API's `hasMore` field, and
  // `loadingMore` gates the button's disabled state so a double-
  // click can't fire two concurrent fetches. Reset back to 0 in
  // `loadJobs` whenever the user toggles `forceAllSweden` or
  // changes their profile — the existing effect already re-runs
  // loadJobs in those cases, so we treat the page cursor as
  // intentionally ephemeral.
  const [currentPage, setCurrentPage] = useState(0)
  const [serverHasMore, setServerHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchMode, setSearchMode] = useState('strict') // 'strict' | 'loose'
  const [applyingJobId, setApplyingJobId] = useState(null)
  const [cronLogs, setCronLogs] = useState([])
  const [cronRunning, setCronRunning] = useState(false)
  const [pushActive, setPushActive] = useState(false)
  // Extension detection state. Content script sets
  // document.documentElement.getAttribute("data-jobbpiloten-ext")="1"
  // at document_start via the MV3 manifest match <all_urls>; the
  // dashboard reads that attribute on mount to decide whether to
  // render the install-prompt banner. `connectStatus` tracks
  // the in-page state of the connect-flow's success/error toast
  // (the dashboard pushes a {token, profile} bundle into the
  // content script via window.postMessage; the content script
  // then persists the bundle to chrome.storage.local.)
  // Round-52 / Issue 3 (P3) — extensionAlive tracks whether the
  // content-script heartbeat is fresh. The data-jobbpiloten-ext
  // attribute flips to '1' as soon as the content script loads
  // (instant feedback) but doesn't tell the user whether the
  // SW is still alive on a long-lived session. The pingAt
  // attribute (set by startHeartbeatAttributeMirror in
  // extension/content.js on a 30s cadence) is the source of
  // truth for "is the extension still responding?". A
  // user-friendly distinction:
  //   - installed + alive    → "Ansluten"
  //   - installed + stale    → "Koppla från (Pausad)"
  //   - not installed        → install banner
  const [extensionAlive, setExtensionAlive] = useState(false)
  const [extensionInstalled, setExtensionInstalled] = useState(false)
  const [connectingExtension, setConnectingExtension] = useState(false)
  const [connectStatus, setConnectStatus] = useState(null)
  const [extensionChecked, setExtensionChecked] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [markingSent, setMarkingSent] = useState(null)
  const [appliedSuccess, setAppliedSuccess] = useState(false)
  const [copied, setCopied] = useState(false)
  const [appFilter, setAppFilter] = useState('all')
  const [regenerating, setRegenerating] = useState(false)
  // Per-row in-flight set: ids currently being toggled on /api/toggle-saved.
  // A Set (rather than a single id) keeps the rest of the table interactive
  // while the user might rapidly star/unstar multiple rows.
  const [togglingSaved, setTogglingSaved] = useState(() => new Set())
  // Tracks whether we've already applied the auto-default for the saved
  // filter on this mount. useRef (not useState) — we don't need a re-render
  // when this flips, only when `appFilter` itself changes.
  const autoDefaultApplied = useRef(false)

  const filteredApps = useMemo(() => {
    const f = FILTERS.find(x => x.key === appFilter)
    return f ? apps.filter(f.match) : apps
  }, [apps, appFilter])

  // Round-33.3 review-fix: removed the derived `savedCount` and
  // `confirmedCount` useMemos. After the headline-vs-trend metric fix
  // these values are no longer consumed (the headline for both
  // "Sparade jobb denna period" and "Bekräftade av AF denna period"
  // derives from `getMonthlyTrend(...).current`, not the lifetime
  // filter counts). The FILTERS array recomputes its own per-tab
  // counts via `apps.filter(f.match)`, so this memoised pair was the
  // last place that depended on a lifetime aggregate — now dead.
  // Removed to avoid lying about a value nobody reads.

  // Auto-default to the 'saved' filter on first load if the user has any
  // saved applications. Runs exactly once per mount (the useRef guard
  // flips to `true` after the first apps load). After this initial nudge,
  // the user's own filter picks are not overridden — they call
  // `pickFilter` below instead of `setAppFilter` directly.
  useEffect(() => {
    if (autoDefaultApplied.current) return
    if (apps.length === 0) return
    autoDefaultApplied.current = true
    if (apps.some(a => a.saved)) {
      setAppFilter('saved')
    }
  }, [apps])

  // User-initiated filter change: marks the choice so that subsequent
  // updates to `apps` (refresh, new save, etc.) won't override the
  // user's selection via the auto-default effect above. Also syncs
  // the URL so reloads + deep-links preserve the choice, and preserves
  // any other URL params so a Round-18 ?jobId=X deep-link isn't
  // dropped when the user toggles a filter chip.
  const pickFilter = (key) => {
    autoDefaultApplied.current = true
    setAppFilter(key)
    if (!searchParams) return
    const params = new URLSearchParams(searchParams.toString())
    if (key === 'all') params.delete('filter')
    else params.set('filter', key)
    const qs = params.toString()
    router.replace(qs ? `/dashboard?${qs}` : '/dashboard', { scroll: false })
  }

  // Hydrate the filter from ?filter=X on first mount so the URL is
  // the source of truth on initial render (choice survives reload +
  // is shareable). We route through pickFilter (not setAppFilter)
  // so the autoDefaultApplied ref flips to true and the auto-default-
  // to-saved effect above skips when apps load — without that gate
  // the URL choice would be silently overridden for users with saved
  // apps. Mount-only via [] deps so re-hydration never runs; user-
  // initiated changes flow through pickFilter which itself does the
  // URL write side-effect.
  useEffect(() => {
    const fromUrl = searchParams.get('filter')
    if (!fromUrl) return
    if (!FILTERS.some((f) => f.key === fromUrl)) return
    if (appFilter !== fromUrl) pickFilter(fromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resolved application URL for the prep modal. Recomputed only when the
  // prep application changes, so the visual indicator (label + color)
  // reflects the current source: direct / platsbanken / search.
  const prepAppUrl = useMemo(() => resolveApplicationUrl(prepApplication), [prepApplication])
  // Round-58 / Bug 2: per-source search-fallback lookup. When the Tier-3
  // fallback (no direct URL, no externalId) is taken, look up the right
  // entry by app.source so the button label + destination is unambiguous:
  // 'blocket' -> Blocket Jobb search, 'ledigajobb' -> Ledigajobb.se, generic
  // -> Google as a true last resort. Pre-Round-58 there was one SEARCH_VIEW
  // constant -- 'Sok pa Google' -- regardless of source. Now each source
  // has its own label/className/buildUrl.
  const isSearch = prepAppUrl && prepAppUrl.source === 'search'
  const searchFallback = useMemo(
    () => isSearch ? resolveSearchFallback(prepApplication, profile) : null,
    [isSearch, prepApplication, profile],
  )
  // Per-source URL builder. Called only on the isSearch branch so non-search
  // paths continue to use prepAppUrl.url unchanged (contract-locked by
  // tests/unit/af-job-url-resolver.test.mjs).
  const fallbackUrl = useMemo(
    () => searchFallback ? searchFallback.buildUrl({ app: prepApplication, profile }) : null,
    [searchFallback, prepApplication, profile],
  )
  const finalHref = fallbackUrl || (prepAppUrl ? prepAppUrl.url : null)

  const load = async () => {
    try {
      const [s, a, p, sub, push] = await Promise.all([
        fetch('/api/stats').then(r => r.json()),
        fetch('/api/applications').then(r => r.json()),
        fetch('/api/profile').then(r => r.json()),
        fetch('/api/subscription').then(r => r.json()),
        fetch('/api/push-status').then(r => r.json()),
      ])
      // 401 on /api/profile means the demo cookie is missing or has
      // expired (the cookie carries a 30-day TTL; if the user wipes
      // cookies / switches browser / sits idle for >30d, the server
      // can't identify them and returns 401). Before this guard, the
      // blanket `!p?.profile` below would have redirected them to
      // /onboarding — a profile-fill wizard — which is wrong: their
      // profile exists in MongoDB, they just need to re-establish
      // the cookie via /sign-in. LocalStorage is the source of
      // truth for the client-side user object; the cookie is the
      // bridge to the server. `DemoAuthProvider` re-bootstraps the
      // cookie from localStorage on app boot, so a missing cookie is
      // usually transient — bouncing to /sign-in lets the user
      // re-emit it with one click.
      if (p && typeof p.error === 'string' && p.error.includes('Unauthorized')) {
        router.replace('/sign-in')
        return
      }
      if (!p?.profile) {
        router.replace('/onboarding')
        return
      }
      setStats(s)
      setApps(a.applications || [])
      setProfile(p.profile)
      setSubscription(sub.subscription)
      setPushActive(push?.active || false)
    } catch (e) {
      console.error('load err', e)
    }
    setLoading(false)
  }

  const [locationFilterMode, setLocationFilterMode] = useState('strict') // 'strict' | 'loose' | 'fallback-nationwide'
  const [forceAllSweden, setForceAllSweden] = useState(false) // user override toggle
  const [userLocationList, setUserLocationList] = useState([]) // sidebar info for the banner

  const loadJobs = async ({ forceAllSweden: override = false, append = false, page = 0 } = {}) => {
    // Only flip the full-page skeleton on the initial load — append
    // loads use the inline "Laddar..." indicator on the button
    // instead so the existing cards stay visible while the next
    // page streams in.
    if (!append) setJobsLoading(true)
    try {
      const titles = profile?.jobTitles || []
      const locations = profile?.locations || []
      const query = titles.slice(0, 2).join(' ')
      const location = locations.slice(0, 1).join(', ')
      // Push the override via a query param so the API endpoint knows
      // whether to apply the strict Län-filter or skip straight to a
      // nationwide pass. Keep the param name short to preserve log space.
      const flag = override ? '&allSweden=1' : ''
      const pageParam = page > 0 ? `&page=${page}` : ''
      const res = await fetch(`/api/jobs-available?query=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}${flag}${pageParam}`)
      const json = await res.json()
      const newJobs = json.jobs || []
      setAvailableJobs(append ? [...availableJobs, ...newJobs] : newJobs)
      setSearchMode(json.searchMode || 'strict')
      setLocationFilterMode(json.locationFilterMode || 'strict')
      setUserLocationList(Array.isArray(json.userLocations) ? json.userLocations : [])
      setCurrentPage(page)
      setServerHasMore(!!json.hasMore)
    } catch (e) {
      console.error('loadJobs err', e)
    }
    setJobsLoading(false)
  }

  // Issue 3 (2026-07-10): "Visa fler jobb" handler. Concurrency is
  // gated by `loadingMore` so a fast double-click can't fire two
  // appends in parallel (the second would race the first's
  // `setAvailableJobs` callback, dropping the first page silently).
  // The server enforces `PAGE_SIZE` server-side, so the client just
  // trusts the response shape and passes `currentPage + 1` straight
  // back as the next request's page index.
  //
  // 2026-07-11 (Issue 2 polish): explicit error toast so a failed
  // fetch never reads as "click did nothing". A 4xx/5xx response is
  // treated identically to a network error — the user sees a
  // Swedish toast with the server's error message (clipped to
  // 120 chars so the toast stays single-line on mobile) and can
  // retry without losing their current page. The `profile` null
  // guard keeps the click a clean no-op during the dashboard's
  // first ~50ms (before the profile fetch completes) — without it
  // we'd encode `query=undefined` into the URL and the API would
  // 500.
  const loadMoreJobs = async () => {
    if (loadingMore || !serverHasMore) return
    if (!profile) {
      // Profile hasn't loaded yet; the user can retry after the
      // dashboard paints the "Lediga jobb" header (~ms later).
      toast.error('Profilen laddar fortfarande — försök igen om en sekund.')
      return
    }
    setLoadingMore(true)
    try {
      const nextPage = currentPage + 1
      const titles = profile?.jobTitles || []
      const locations = profile?.locations || []
      const query = titles.slice(0, 2).join(' ')
      const location = locations.slice(0, 1).join(', ')
      const flag = forceAllSweden ? '&allSweden=1' : ''
      const res = await fetch(`/api/jobs-available?query=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}${flag}&page=${nextPage}`)
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        const msg = (errJson?.error || `Servern returnerade ${res.status}`).toString().slice(0, 120)
        toast.error('Kunde inte hämta fler jobb: ' + msg)
        return
      }
      const json = await res.json()
      const newJobs = Array.isArray(json?.jobs) ? json.jobs : []
      if (newJobs.length === 0 && !json?.hasMore) {
        // Server signalled end-of-stream with an empty page — make
        // sure the UI agrees even if the previous hasMore was stale.
        setServerHasMore(false)
        return
      }
      setAvailableJobs(prev => [...prev, ...newJobs])
      setCurrentPage(nextPage)
      setServerHasMore(!!json?.hasMore)
    } catch (e) {
      console.error('loadMoreJobs err', e)
      toast.error('Kunde inte hämta fler jobb: ' + (e?.message || 'nätverksfel'))
    } finally {
      // `finally` so a 4xx early-return doesn't strand the button
      // in the disabled "Laddar..." state — the user can retry
      // straight away after seeing the error toast.
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (profile) loadJobs()
    // Re-run whenever the user toggles the override — loadJobs reads
    // `forceAllSweden` from the inner closure but the override path
    // is a new fetch, so we model it as an explicit re-fetch to keep
    // the effect declarative.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, forceAllSweden])

  // Open prep modal: generates AI cover letter and shows prep info.
  //
  // Round-58 / Bug 2 followup — payload hardening. The previous body
  // sent only `jobId` + `url`. For Blocket / Ledigajobb jobs whose
  // `jobId` starts with `blocket-…` / `ledigajobb-…` (NOT `af-…`), the
  // server-side `/api/apply-now` route fell into the else branch that
  // RE-RAN `searchJobs(profile.jobTitles, profile.locations)` and
  // picked the first matching AF job — a DIFFERENT job than the one
  // the user actually clicked. When that re-search returned no hits,
  // the route fell back to SAMPLE_JOBS, which has neither
  // `externalId` nor `jobUrl`, so the modal's resolveApplicationUrl
  // chain landed on Tier-3 (Google search) and the user saw "Sök
  // jobbet" instead of a real Blocket/Ledigajobb link.
  //
  // The fix: send EVERYTHING the route needs to write the
  // 1:1-as-clicked application directly — `jobUrl`, `externalId`,
  // `source`, `title`, `company`, `location`, `description`. The
  // route keeps its existing `url` and 'af-' branch for backwards
  // compat (third-party clients / older submissions) but now also
  // reads `jobUrl` so the field name on the client side matches the
  // schema on the application document.
  const openPrepModal = async (job) => {
    setApplyingJobId(job.id)
    setPrepJob(job)
    try {
      const res = await fetch('/api/apply-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          company: job.company,
          title: job.title,
          location: job.location,
          description: job.description,
          source: job.source,
          // Send BOTH `url` (legacy) and `jobUrl` (canonical) so the
          // route can pick one without an extra round-trip. The route
          // is now defensive — it prefers `jobUrl` and falls back to
          // `url` for any client still on the older contract.
          url: job.url,
          jobUrl: job.url,
          // Always include externalId when the scraper populated it
          // (AF-prefix jobs have `externalId` set on the search
          // response; Blocket / Ledigajobb entries have it from
          // JSON-LD `identifier` / ledigajobb listing id hashes).
          // Schema-org "identifier" is typically a string; coerce
          // with String() so a number doesn't slip through.
          externalId: job.externalId != null ? String(job.externalId) : null,
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setPrepApplication(json.application)
        // Bug #4 — merge Clerk user data into the profile shown in the
        // modal's “Dina uppgifter” section so e-post, fullständigt namn
        // and telefonnummer populate even when the stored profile document
        // has them empty (e.g. an account created before this fix).
        setPrepProfile(mergeProfileWithUser(profile, user))
        setShowPrep(true)
        setAvailableJobs(prev => prev.filter(j => j.id !== job.id))
      } else {
        toast.error(json.error || 'Oj, något gick fel')
      }
    } catch (e) {
      toast.error('Oj, något gick fel: ' + e.message)
    }
    setApplyingJobId(null)
  }

  // Round-18: push-notification deep-link handler. When the user
  // clicks a push whose notificationclick listener navigated to
  // /dashboard?jobId=X (see public/service-worker.js), open the prep
  // modal directly for that job instead of just landing on the
  // dashboard. The flow:
  //   1. fetch /api/jobs-available?jobId=X to look up the AF ad
  //   2. openPrepModal creates the application + opens the modal
  //   3. strip ?jobId from the URL so reload + back-button don't
  //      re-trigger (one-shot deep-link).
  // Idempotency: `jobIdFromUrlRef` tracks which jobId we've already
  // processed so a single mount fires the modal exactly once, even
  // if the URL is later navigated to the same jobId again. Dep on
  // `searchParams` so a fresh push-notif click that adds a DIFFERENT
  // jobId re-triggers.
  const jobIdFromUrlRef = useRef(null)
  useEffect(() => {
    const fromUrl = searchParams.get('jobId') || null
    if (!fromUrl) return
    if (jobIdFromUrlRef.current === fromUrl) return
    jobIdFromUrlRef.current = fromUrl
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/jobs-available?jobId=${encodeURIComponent(fromUrl)}`,
        )
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        // Route returns 404 + { error: 'not_found' } when the AF ad
        // id is stale or invalid (see Round-18 short-circuit in
        // app/api/[[...path]]/route.js). Read the error sentinel so
        // the user gets the specific Swedish copy matching the
        // actual cause — not a generic retry message for a job
        // announcement that's been withdrawn.
        if (!res.ok) {
          const err = json?.error
          if (err === 'not_found') {
            toast.error('Jobbet finns inte längre — kanske har annonsen dragits tillbaka.')
          } else {
            toast.error('Kunde inte öppna ansökan — försök igen senare.')
          }
          return
        }
        const jobs = Array.isArray(json?.jobs) ? json.jobs : []
        if (jobs.length === 0) {
          // Defensive: if the route ever returns 200 with empty
          // jobs + an error sentinel, surface the same copy.
          toast.error('Jobbet finns inte längre — kanske har annonsen dragits tillbaka.')
          return
        }
        await openPrepModal(jobs[0])
        if (cancelled) return
        // Strip jobId from URL so reload/back-button don't re-open.
        const params = new URLSearchParams(searchParams.toString())
        params.delete('jobId')
        const qs = params.toString()
        router.replace(qs ? `/dashboard?${qs}` : '/dashboard', { scroll: false })
      } catch (e) {
        if (!cancelled) {
          toast.error('Kunde inte öppna ansökan: ' + (e?.message || 'nätverksfel'))
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Mark as applied (i.e. user actually submitted the application)
  const markAsApplied = async (applicationId) => {
    setMarkingSent(applicationId)
    try {
      const res = await fetch('/api/mark-applied', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId }),
      })
      const json = await res.json()
      if (json.ok) {
        // Show success state in the modal instead of auto-closing it.
        // The "Mark as applied" button transforms to a disabled ✓ state.
        setAppliedSuccess(true)
        toast.success('Ansökan markerad som skickad!')
        await load()
      } else {
        toast.error(json.error || 'Oj, något gick fel')
      }
    } catch (e) {
      toast.error('Oj, något gick fel: ' + e.message)
    }
    setMarkingSent(null)
  }

  // Mark as confirmed
  const markAsConfirmed = async (applicationId) => {
    const employerResponse = prompt('Klistra in eventuellt svar från arbetsgivaren (valfritt):')
    try {
      const res = await fetch('/api/mark-confirmed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, employerResponse }),
      })
      const json = await res.json()
      if (json.ok) {
        await load()
        toast.success('Markerad som bekräftad!')
      } else {
        toast.error(json.error || 'Oj, något gick fel')
      }
    } catch (e) {
      toast.error('Oj, något gick fel: ' + e.message)
    }
  }

  // Copy application to clipboard
  const copyApplication = () => {
    if (!prepApplication || !prepProfile) return
    const text = `Personligt brev för ${prepApplication.company} - ${prepApplication.title}\n\n` +
      `${prepApplication.coverLetter}\n\n---\nKontaktuppgifter:\nNamn: ${prepProfile.fullName || ''}\nE-post: ${prepProfile.email || ''}\nTelefon: ${prepProfile.phone || ''}\nLinkedIn: ${prepProfile.linkedin || ''}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Round-38 / Part 2: save the just-generated cover letter to
  // the user's answer-memory corpus. The button sits next to
  // "Kopiera" in the prep modal so the user can promote a
  // good AI letter into a reusable memory entry. We tag the
  // field as 'coverLetter' (NOT a motivation-class field) so
  // the extension's field-constrained search never surfaces a
  // cover letter when it asks for whyThisRole. The id is a
  // stable UUID so re-clicking updates the same row (no
  // duplicates if the user saves twice in a row).
  const [savingMemory, setSavingMemory] = useState(false)
  const [savedMemoryId, setSavedMemoryId] = useState(null)
  const saveToMemory = async () => {
    if (!prepApplication || !prepApplication.coverLetter || savingMemory) return
    setSavingMemory(true)
    try {
      // Stable id derived from company+title so the SAME job
      // produces the SAME row (re-saving = updating, not
      // duplicating). Falls back to a fresh UUID when the
      // company/title are missing.
      const seedId = (prepApplication.company || '') + '::' + (prepApplication.title || '')
      const id = seedId.trim()
        ? 'cl-' + seedId.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60)
        : (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? 'cl-' + crypto.randomUUID()
          : 'cl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
      const res = await fetch('/api/saved-answers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          field: 'coverLetter',
          question: `Personligt brev: ${prepApplication.title || 'okänd titel'} (${prepApplication.company || 'okänt företag'})`,
          answer: String(prepApplication.coverLetter || ''),
          quality: 4,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Kunde inte spara.')
      setSavedMemoryId(id)
      toast.success('Brev sparat i ditt minne — återanvänd vid nästa liknande ansökan.')
    } catch (err) {
      toast.error('Oj, något gick fel: ' + err.message)
    } finally {
      setSavingMemory(false)
    }
  }

  // Toggle the `saved` flag on an application row. Optimistic: flip locally
  // first, then POST to /api/toggle-saved, then either keep or revert the
  // local state based on the server response. Per-row loading state lives
  // in `togglingSaved` (a Set of in-flight ids) so other rows stay live.
  const toggleSaved = async (applicationId, currentSaved) => {
    if (togglingSaved.has(applicationId)) return
    const nextSaved = !currentSaved
    setTogglingSaved(prev => {
      const s = new Set(prev)
      s.add(applicationId)
      return s
    })
    setApps(prev => prev.map(a => a.id === applicationId
      ? { ...a, saved: nextSaved, savedAt: nextSaved ? new Date() : null }
      : a
    ))
    try {
      const res = await fetch('/api/toggle-saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, saved: nextSaved }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        // revert on failure
        setApps(prev => prev.map(a => a.id === applicationId
          ? { ...a, saved: currentSaved, savedAt: currentSaved ? a.savedAt : null }
          : a
        ))
        toast.error(json.error || 'Oj, något gick fel')
      } else {
        toast.success(nextSaved ? 'Jobb sparat!' : 'Borttaget från sparade')
      }
    } catch (e) {
      setApps(prev => prev.map(a => a.id === applicationId
        ? { ...a, saved: currentSaved, savedAt: currentSaved ? a.savedAt : null }
        : a
      ))
      toast.error('Oj, något gick fel: ' + e.message)
    } finally {
      // Always clear the in-flight flag — even if `alert()` were to throw,
      // so the row's button does not stay permanently disabled.
      setTogglingSaved(prev => {
        const s = new Set(prev)
        s.delete(applicationId)
        return s
      })
    }
  }

  // Re-run the Groq cover-letter generator for the current prep application.
  // Updates the visible letter in-place; persists the new letter to MongoDB.
  const regenerateCoverLetter = async () => {
    if (!prepApplication || regenerating) return
    setRegenerating(true)
    try {
      const res = await fetch('/api/regenerate-cover-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId: prepApplication.id }),
      })
      const json = await res.json()
      if (res.ok && json.ok && json.coverLetter) {
        setPrepApplication(prev => prev ? { ...prev, coverLetter: json.coverLetter } : prev)
        toast.success('Nytt brev skrivet!')
      } else {
        toast.error(json.error || 'Oj, något gick fel')
      }
    } catch (e) {
      toast.error('Oj, något gick fel: ' + e.message)
    }
    setRegenerating(false)
  }

  const runAssistant = async () => {
    setApplying(true)
    try {
      const res = await fetch('/api/apply-now', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const json = await res.json()
      if (json.ok) {
        setPrepApplication(json.application)
        // Bug #4 — same merge as in openPrepModal: pulls Clerk email/name
        // into the modal's “Dina uppgifter” section even if the profile
        // document had them blank at onboarding time.
        setPrepProfile(mergeProfileWithUser(profile, user))
        setShowPrep(true)
        await load()
      } else {
        toast.error(json.error || 'Oj, något gick fel')
      }
    } catch (e) {
      toast.error('Oj, något gick fel: ' + e.message)
    }
    setApplying(false)
  }

  const downloadReport = () => {
    window.open('/api/report', '_blank')
  }

  const loadCronLogs = async () => {
    try {
      const res = await fetch('/api/cron')
      const json = await res.json()
      setCronLogs(json.logs || [])
    } catch (e) {
      console.error('loadCronLogs err', e)
    }
  }

  // ---- Extension connect flow ----
  // Posts the signed-in user's profile (+ a fresh token) into
  // the extension's chrome.storage.local on this tab. The
  // content script picks the bundle up via the JOBBPILOTEN_AUTH_SYNC
  // postMessage channel; future form-fill calls in any tab use
  // the storage payload. Idempotent — re-clicking issues a new
  // token (the old one stays valid until the user clicks Logout
  // in /settings, available in Round 2).
  const connectExtension = async () => {
    if (connectingExtension) return
    setConnectingExtension(true)
    setConnectStatus(null)
    try {
      const res = await fetch('/api/extension/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.token) {
        setConnectStatus({ ok: false, message: json.error || 'Kunde inte ansluta tillägget.' })
        return
      }
      // Bridge into the content script running on this same tab.
      // The content script listens for window.postMessage events
      // where ev.source === window (i.e. a same-window send) —
      // window.postMessage from THIS context qualifies, so the
      // chmod picks it up and saves to chrome.storage.local.
      try {
        // Include baseUrl + allowedOrigins so the content script can
        // build URLs against the SAME origin we just signed in on and
        // gate fetches against the same allow-list its assertOriginAllowed
        // (mirrored in extension/popup.js) consults. Without baseUrl the
        // popup would silently fall back to DEFAULT_BASE_URL forever.
        window.postMessage({
          type: 'JOBBPILOTEN_AUTH_SYNC',
          payload: {
            token: json.token,
            profile: json.profile,
            baseUrl: window.location.origin,
            allowedOrigins: [window.location.origin],
          },
        }, window.location.origin)
      } catch (_) { /* postMessage failure is non-fatal */ }
      // v0.2.1: also notify the content script of the dashboard URL
      // via a separate message type so the extension's
      // chrome.storage.sync.dashboardUrl gets the current origin.
      // The content script validates against host_permissions[] so a
      // compromised host page can't smuggle an attacker origin here
      // (see SECURITY comment in extension/content.js).
      try {
        window.postMessage({
          type: 'JOBBPILOTEN_SET_DASHBOARD_URL',
          payload: { url: window.location.origin },
        }, window.location.origin)
      } catch (_) { /* non-fatal */ }
      setConnectStatus({ ok: true, message: 'Tillägget är anslutet — profil synkad.' })
      toast.success('JobbPiloten Auto-Fill anslutet!'
        + ' Fyll i formulär direkt från valfri jobbsida.')
    } catch (e) {
      setConnectStatus({ ok: false, message: 'Nätverksfel: ' + e.message })
    } finally {
      setConnectingExtension(false)
    }
  }

  const runCronNow = async () => {
    setCronRunning(true)
    try {
      // Auth header is intentionally NOT sent from the client. The server's
      // verifyCronSecret() returns true when CRON_SECRET is unset (dev mode),
      // and returns 401 when CRON_SECRET is set — exactly the right behaviour
      // for a dev-only button. The previous version of this call sent the
      // literal "dev-secret" header, which both (a) leaked a placeholder
      // secret into the client bundle and (b) created a footgun: if the
      // dashboard-shipping app ever set CRON_SECRET in the env, the hard-
      // coded "dev-secret" would surface as a real but always-wrong token.
      const res = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json()
      if (json.ok) {
        toast.success(`Cron kördes! ${json.results?.length || 0} prenumeranter behandlades.`)
        await loadCronLogs()
      } else {
        toast.error(json.error || 'Cron misslyckades')
      }
    } catch (e) {
      toast.error('Oj, något gick fel: ' + e.message)
    }
    setCronRunning(false)
  }

  // Push notification handler
  const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
    return outputArray
  }

  const togglePush = async () => {
    setPushLoading(true)
    try {
      if (pushActive) {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        if (subscription) await subscription.unsubscribe()
        await fetch('/api/push-unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        setPushActive(false)
        toast.success('Push-notiser avaktiverade')
      } else {
        if (!('Notification' in window)) {
          toast.error('Push-notiser stöds inte i din webbläsare.')
          return
        }
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          toast.error('Du måste tillåta push-notiser i webbläsaren.')
          return
        }
        const registration = await navigator.serviceWorker.register('/service-worker.js')
        await navigator.serviceWorker.ready
        const convertedKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedKey,
        })
        const subRes = await fetch('/api/push-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription }),
        })
        const json = await subRes.json()
        setPushActive(json.active || false)
        toast.success('Push-notiser aktiverade!')
      }
    } catch (e) {
      console.error('push error', e)
      toast.error('Kunde inte aktivera push-notiser: ' + e.message)
    }
    setPushLoading(false)
  }

  useEffect(() => {
    load()
    loadCronLogs()
  }, [])

  // Extension presence detector — re-checks the DOM on focus
  // + every second so the install banner disappears the moment
  // the user installs the extension. Cheap (boolean attribute
  // read), so we don't bother memoising it.
  useEffect(() => {
    const check = () => {
      try {
        const v = document.documentElement.getAttribute('data-jobbpiloten-ext')
        setExtensionInstalled(v === '1')
        setExtensionChecked(true)
        // Round-52 / Issue 3 (P3) — heartbeat read. The content
        // script mirrors jobbpiloten_pingAt onto the
        // data-jobbpiloten-ext-ping-at attribute on a 1s poll
        // cadence (paired with the existing 1s poll above).
        // Staleness threshold = 65s: 2x the 30s heartbeat interval
        // so a single missed tick (SW hibernation, browser
        // throttling on a backgrounded tab) doesn't immediately
        // flip the user to "disconnected". The pre-fix behaviour
        // was extensionInstalled=true but no liveness signal —
        // the dashboard happily showed "Tilägget är installerat"
        // for an unloaded extension. The new state is tracked
        // separately so the Auto-Fill card can show "Ansluten"
        // vs "Koppla från (Pausad)" without dropping the
        // installed flag (a paused extension is still installed).
        const pingAt = document.documentElement.getAttribute('data-jobbpiloten-ext-ping-at')
        const ts = pingAt ? parseInt(pingAt, 10) : 0
        const fresh = !!(ts && Number.isFinite(ts) && (Date.now() - ts) < 60_000)
        setExtensionAlive(fresh)
      } catch (_) {
        setExtensionInstalled(false)
        setExtensionChecked(true)
        setExtensionAlive(false)
      }
    }
    check()
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    const interval = setInterval(check, 1000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [])

  // Bug A fix (2026-07-20 Monday): AUTO-FIRE connectExtension when
  // the dashboard mounts with all three prerequisites met:
  //   - User is loaded (Clerk or demo cookie)
  //   - A complete profile is fetched (not redirected to /onboarding)
  //   - The extension is detected as installed (`data-jobbpiloten-ext="1"`)
  // Without this auto-fire the user had to manually click "Anslut din
  // profil" on EVERY device after every browser restart — which
  // silently broke the "Fyll i nu" CTA in the popup because
  // chrome.storage.local was empty and the popup had nothing to fill
  // with, leading to the "Anslut din profil" button being stuck.
  // A useRef guard prevents double-firing under React StrictMode
  // (the dev-only double-mount) and prevents redundant re-fires when
  // the extension-detect poller flips `extensionInstalled` true after
  // 1-2s while nothing else has changed. `connectExtension` is
  // idempotent on the background side; the useRef just saves a
  // /api/extension/token round-trip.
  const autoSyncAttemptedRef = useRef(false)
  useEffect(() => {
    if (autoSyncAttemptedRef.current) return
    // Round-79 (2026-07-20) — BUG A followup: wait for the FIRST
    // polling cycle to complete (extensionChecked === true) before
    // deciding to auto-fire. Without this guard, a React 18
    // StrictMode-style dev double-mount in the FIRST second can
    // race the polling interval: by the time `extensionInstalled`
    // flips true via the second poll tick, `autoSyncAttemptedRef`
    // is already set on the first mount's effect run (when
    // `extensionInstalled` was still false). The auto-sync then
    // never re-fires on the second render because the ref gate
    // short-circuits it. The user-visible symptom is that the
    // dashboard appears to "remember" the connection but the
    // extension popup is stuck in `Kontrollerar…` because the
    // chrome.storage.local write never happens. Adding
    // `extensionChecked` to the dep array + the early-return guard
    // forces the auto-sync to wait for the polling effect's
    // AT LEAST ONE successful cycle before deciding, which races
    // proof of the fix under tests/e2e/dashboard-auto-sync.spec.js.
    if (!extensionChecked) return
    if (!user || !profile || !extensionInstalled) return
    autoSyncAttemptedRef.current = true
    connectExtension()
  }, [user, profile, extensionInstalled, extensionChecked])

  // Round-41.3 (e2e-smoke Rules-of-Hooks fix): the `now` /
  // `monthLabel` / `pace` useMemo block MUST live ABOVE the
  // `if (!isLoaded || loading) { return ... }` early return below.
  // The pre-fix code placed it after the early return, which is a
  // Rules of Hooks violation: on the first render (loading=true) the
  // component returned the spinner and called 0 hooks for `pace`;
  // on the second render (loading=false) it called the useMemo —
  // React threw "Rendered more hooks than during the previous render"
  // and Next.js's error boundary rendered the
  // "Application error: a client-side exception" overlay (the e2e
  // failure mode). Moving the block above the early return keeps
  // the hook call order stable across renders. `pct` / `pacePct` /
  // `cfg` stay below the early return — they're plain arithmetic +
  // a config object, not hooks, so the move isn't required for them.
  const now = new Date()
  const monthLabel = `${monthNames[now.getMonth()]} ${now.getFullYear()}`

  // Round-41 / Part 7 (Sub-feature 3 — AF compliance check):
  // Hoisted out of the JSX IIFE so the React hook (useMemo) lives at
  // the component's top level — the standard React-hooks pattern.
  // (Round-41.1 review catch: the pre-fix code called useMemo inside
  // an IIFE-for-one-time-compute, which is unusual and trips some
  // exhaustive-deps lint configs. The hoist keeps the hook pattern
  // idiomatic.) Deps `[apps, monthLabel]` — `monthLabel` is derived
  // from `now` (e.g. "juli 2026") and only changes when the month
  // rolls over, so it acts as a coarse-grained `now` proxy. This
  // keeps the memo from recomputing on every render (which it would
  // do if `now` were a dep — `const now = new Date()` is a fresh
  // Date each render). The pace still tracks the day-level `now`
  // via `monthLabel` because `monthLabel` is only stable for ~30
  // days, and the `apps` dep ensures the memo recomputes on data
  // refetch — at which point `now` is fresh anyway. Stale-`now`
  // window: at most one render between data refetches (the
  // dashboard's `load()` is the only source of `apps` updates), so
  // the displayed `elapsedDays` is at most 1 day behind the true
  // wall clock. Acceptable for a pace indicator.
  const pace = useMemo(() => getAfCompliancePace(apps, now), [apps, monthLabel])
  const pct = Math.min(100, Math.round((pace.applied / pace.target) * 100))
  const pacePct = Math.min(100, Math.round((pace.paceRequired / pace.target) * 100))
  const cfg = {
    complete: {
      barCls: 'bg-emerald-500',
      chipCls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      label: 'Standardmål uppnått',
      sub: `Du har skickat ${pace.applied} av ${pace.target} ansökningar ${monthLabel.toLowerCase()}.`,
    },
    'on-track': {
      barCls: 'bg-indigo-500',
      chipCls: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      label: 'I linje med takten',
      sub: `${pace.applied} av ${pace.target} ansökningar — pace kräver ${pace.paceRequired} vid dag ${pace.elapsedDays}.`,
    },
    behind: {
      barCls: 'bg-amber-500',
      chipCls: 'bg-amber-50 text-amber-800 border-amber-200',
      label: 'Du ligger efter takten',
      sub: `${pace.applied} av ${pace.target} ansökningar — pace kräver ${pace.paceRequired} vid dag ${pace.elapsedDays}. Skicka fler för att hinna ikapp.`,
    },
  }[pace.status]

  // Round-41.3 (e2e-smoke Rules-of-Hooks fix): the early return
  // for `!isLoaded || loading` lives AFTER the useMemo block above
  // (which it used to precede pre-Round-41.3). Moving the hook
  // call before the early return keeps the hook order stable
  // across renders — on the first render (loading=true) the
  // component now returns the spinner AFTER calling the useMemo,
  // not before. React requires hooks to be called in the same
  // order on every render; the pre-fix placement (hook after
  // early return) violated this and caused Next.js to render
  // the "Application error" overlay.
  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    )
  }

  // Status badge component
  const StatusBadge = ({ status }) => {
    const cfg = STATUS_MAP[status] || { label: status, bg: 'bg-slate-100', text: 'text-slate-700' }
    return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
  }

  // Saved star button — renders inline as the rightmost column of each row.
  // Filled amber-500 when saved, outline slate-400 otherwise. Uses
  // lucide-react's `Star` (outline) and `fill` SVG for the "saved" state.
  // aria-pressed reflects the toggle state for assistive tech; aria-label
  // is localized. data-testid + data-saved let external tests assert state
  // without depending on icon lucide internals.
  //
  // Intentionally NOT wrapped in React.memo: `isSaving` reads
  // `togglingSaved.has(app.id)` from the parent closure, so the prop
  // surface alone (`app`) wouldn't capture the loading state of sibling
  // rows — memo would skip re-renders and stale the indicator. The
  // apps array is already immutably rebuilt on toggle, so non-toggled
  // rows are cheap to reconcile.
  function SavedToggleButton({ app }) {
    const isSaving = togglingSaved.has(app.id)
    const saved = !!app.saved
    return (
      <button
        type="button"
        onClick={() => toggleSaved(app.id, saved)}
        disabled={isSaving}
        aria-pressed={saved}
        aria-label={saved ? 'Ta bort från sparade' : 'Spara ansökan'}
        title={saved ? 'Sparad — klicka för att ta bort' : 'Klicka för att spara'}
        data-testid="toggle-saved"
        data-saved={saved ? 'true' : 'false'}
        className={
          'inline-flex items-center justify-center w-8 h-8 rounded-md transition ' +
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ' +
          (isSaving ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:scale-110 active:scale-95') +
          ' ' +
          (saved ? 'text-amber-500 hover:text-amber-600' : 'text-slate-300 hover:text-amber-400')
        }
      >
        {isSaving ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : saved ? (
          <Star className="w-4 h-4 fill-amber-500 stroke-amber-600" />
        ) : (
          <Star className="w-4 h-4" />
        )}
      </button>
    )
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50">
        <nav className="border-b bg-white sticky top-0 z-30">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center">
                <Plane className="w-4 h-4 text-white -rotate-45" />
              </div>
              <span className="font-semibold">JobbPiloten</span>
              <Badge variant="secondary" className="ml-2 text-xs">{profile?.tier || 'Professional'}</Badge>
            </Link>
            <div className="flex items-center gap-3">
              <Link
                href="/settings"
                data-testid="dashboard-open-settings"
                aria-label="Öppna inställningar"
                className="inline-flex items-center justify-center w-9 h-9 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 transition-colors"
                title="Inställningar"
              >
                <SettingsIcon2 className="w-4 h-4" />
              </Link>
              {/* Profile picture + greeting — 32x32 avatar renders the user's
                  chosen upload / avatar, falling back to the default
                  JobbPiloten-plane circle. avatarSource/avatarId data attrs
                  let e2e specs probe which mode is active without parsing
                  the SVG path. */}
              <div className="hidden md:flex items-center gap-2" data-testid="dashboard-header-greeting">
                <ProfileAvatar profile={profile} size={32} dataTestid="profile-avatar-nav" />
                <span className="text-sm text-slate-600">Hej {profile?.fullName?.split(' ')[0] || user?.firstName || 'du'}!</span>
              </div>
              <SafeUserButton afterSignOutUrl="/" />
            </div>
          </div>
        </nav>

        <div className="container mx-auto px-4 py-8 space-y-8">
          {/* Top banner — next cron time. Re-computed each minute so the
              countdown ticks. Replaced via state tick below. */}
          <NextCronBanner />

          {/* Extension install banner — gates on extension detection so
              we only render the prompt for users who haven't already
              installed the addon. The link target branches on
              `EXTENSION_PUBLISHED`:
                • Published: link to the real Chrome Web Store slug
                  (NEXT_PUBLIC_EXTENSION_STORE_URL) for a 1-click install.
                • Soft-launch: link to our own `/extension-install`
                  page (default) which carries sideloading instructions
                  for the unpacked-extension flow.
              The connect-card path immediately below is unaffected —
              it depends purely on the content-script attribute +
              window.postMessage, so sideloaded / unpacked installs
              keep working without ever needing a CWS slug. */}
          {extensionChecked && !extensionInstalled && (
            <div
              role="status"
              aria-live="polite"
              data-testid="extension-install-banner"
              className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-amber-50 to-orange-50 px-4 py-3 flex items-start gap-3 shadow-sm"
            >
              <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                <span aria-hidden="true" className="text-base">✈</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  Installera JobbPiloten Auto-Fill
                </div>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                  Fyll i jobbansökningar med ett klick — förnamn, e-post, personligt brev,
                  LinkedIn och mer direkt från din JobbPiloten-profil. Ingen inmatning,
                  inga misstag, och inget lämnar din webbläsare utan din knapp.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {EXTENSION_PUBLISHED ? (
                    <a
                      href={EXTENSION_STORE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="extension-install-link"
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
                    >
                      Installera från Chrome Web Store
                    </a>
                  ) : (
                    <Link
                      href={EXTENSION_STORE_URL}
                      data-testid="extension-install-link"
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
                    >
                      Installera (steg-för-steg)
                    </Link>
                  )}
                  <span className="text-[11px] text-slate-500">
                    v0.2 • &lt; 25 KB • varken spårar eller sparar formulärdata
                    {/* Display first two segments (M.N) of semver in
                        extension/manifest.json#version; drop the patch digit so the
                        copy fits on one line at the 11px typography. Bump M.N when
                        manifest.json's version rolls forward; leave banner unchanged
                        for patch-only bumps. */}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-blue-700 p-8 text-white relative overflow-hidden shadow-sm">
            <div className="absolute -right-8 -top-8 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
            <div className="absolute -left-12 -bottom-12 w-48 h-48 bg-amber-400/10 rounded-full blur-3xl" />
            <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div className="text-sm text-indigo-200 mb-1">Din AI-assistent</div>
                <h1 className="text-3xl font-bold">Redo för nästa ansökan</h1>
                <p className="text-indigo-100 mt-1">Klicka nedan för att låta AI:n förbereda ett personligt brev — klart att skicka på 10 sekunder.</p>
              {/* Part 7: "Förberedd för Arbetsförmedlingen" pill.
                  Pure-client check via isPreparedForAF. When the
                  profile has every AF-required field set, render a
                  green pill ("Redo för AF"); otherwise render an
                  amber pill with the missing-field count so the
                  user knows what to fill in /settings. */}
              {profile && (() => {
                try {
                  const af = isPreparedForAF(profile)
                  if (af.ready) {
                    return (
                      <span
                        data-testid="af-ready-pill"
                        className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-300 bg-emerald-50/95 text-emerald-800 text-[10px] font-semibold"
                        title="Profilen är komplett — redo för Arbetsförmedlingen."
                      >
                        ✓ Redo för AF
                      </span>
                    )
                  }
                  return (
                    <span
                      data-testid="af-ready-pill"
                      className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50/95 text-amber-900 text-[10px] font-semibold"
                      title={`Saknar ${af.missing.length} fält för AF — fyll i dem i /settings.`}
                    >
                      {af.missing.length} fält kvar för AF
                    </span>
                  )
                } catch (_) { return null }
              })()}
              </div>
              <Button
                size="lg"
                disabled={applying}
                onClick={runAssistant}
                className="bg-white text-indigo-700 hover:bg-indigo-50 h-12 px-6 shrink-0 shadow-lg shadow-indigo-900/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                {applying ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> AI-assistenten arbetar...</> : <><Rocket className="w-4 h-4 mr-2" /> Kör AI-assistenten nu</>}
              </Button>
            </div>
          </div>

          <Card className="border-0 shadow-sm mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-600" />
                Automatisk AI-assistent (Cron)
              </CardTitle>
              <CardDescription>Körs varje dag kl. 09:00 CET — letar fram matchande jobb och förbereder ansökningar för aktiva prenumeranter</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 mb-4">
                <Button onClick={runCronNow} disabled={cronRunning} variant="outline" size="sm">
                  {cronRunning ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Kör cron...</> : <><Zap className="w-3 h-3 mr-1" /> Kör Cron Nu (test)</>}
                </Button>
                <span className="text-xs text-slate-500">Manuell trigger</span>
              </div>
              {cronLogs.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Senaste cron-loggar</div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {cronLogs.slice(0, 10).map((log, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 rounded bg-slate-50 border border-slate-100 text-xs">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`font-medium ${log.status === 'success' ? 'text-emerald-700' : log.status === 'skipped' ? 'text-amber-700' : 'text-red-700'}`}>{log.status}</span>
                            {log.job && <span className="text-slate-600">{log.job.company} — {log.job.title}</span>}
                          </div>
                          {log.reason && <div className="text-slate-500">Anledning: {log.reason}</div>}
                          {log.error && <div className="text-red-600">Fel: {log.error}</div>}
                          <div className="text-slate-400 mt-0.5">{log.startedAt ? fmtDate(log.startedAt) : log.ranAt ? fmtDate(log.ranAt) : '—'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Animated hero stats. Each card uses a different gradient so the
              palette reads as "amber + indigo + emerald + blue" (the brand
              palette used elsewhere in the app). micro-interaction:
              hover-lift (translateY -2 + stronger shadow). */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="hero-stats">
            {[
              {
                key: 'saved',
                // Round-33.3 review-fix: label now explicitly period-
                // anchored so the trend pill matches. Previously the
                // headline was a lifetime total and the trend reported a
                // 30-day delta — same number, two meanings. Surfacing
                // "denna period" in the label closes the contract.
                label: 'Sparade jobb denna period',
                trendMatch: (a) => a.saved === true,
                timestampKey: 'savedAt',
                showTrend: true,
                Icon: Star,
                gradient: 'from-amber-500/10 via-amber-500/5 to-orange-500/10',
                iconWrap: 'bg-amber-100 text-amber-700',
              },
              {
                key: 'this-month',
                label: `Ansökningar ${monthLabel.split(' ')[0]}`,
                trendMatch: (a) => a.status === 'applied' || a.status === 'user-sent',
                timestampKey: 'appliedAt',
                showTrend: true,
                Icon: Send,
                gradient: 'from-indigo-500/10 via-indigo-500/5 to-blue-500/10',
                iconWrap: 'bg-indigo-100 text-indigo-700',
              },
              {
                key: 'total',
                // Cumulative stat — pairwise period-vs-period is a
                // category error here, so no trend. Draws value from
                // the `apps` array length so it stays consistent with
                // the other three period-eligible heroes (which all
                // use the same client-side source).
                label: 'Totalt antal',
                value: (apps || []).length,
                showTrend: false,
                Icon: Briefcase,
                gradient: 'from-blue-500/10 via-blue-500/5 to-cyan-500/10',
                iconWrap: 'bg-blue-100 text-blue-700',
              },
              {
                key: 'confirmed',
                label: 'Bekräftade av AF denna period',
                trendMatch: (a) => a.status === 'confirmed',
                timestampKey: 'appliedAt',
                showTrend: true,
                Icon: Check,
                gradient: 'from-emerald-500/10 via-emerald-500/5 to-teal-500/10',
                iconWrap: 'bg-emerald-100 text-emerald-700',
              },
            ].map((s, idx) => {
              // Round-33.3 review-fix: trend-derived headlines. The
              // headline for the three period-eligible cards is
              // `trend.current` (the 30-day-window match count), NOT a
              // lifetime count. This means headline and trend badge
              // refer to the same window — the "+N denna period" pill
              // now genuinely says "of this N, N−previous came in this
              // window" rather than two unrelated numbers.
              const trend = s.showTrend
                ? getMonthlyTrend(apps, s.trendMatch, s.timestampKey)
                : null
              const headlineValue = s.showTrend ? trend.current : s.value
              return (
                <motion.div
                  key={s.key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: idx * 0.06, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ y: -2 }}
                  className={`relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${s.gradient} pointer-events-none`} aria-hidden="true" />
                  <div className="relative flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <div className="text-3xl font-bold tracking-tight text-slate-900">
                          <AnimatedCounter value={headlineValue} />
                        </div>
                        {s.showTrend && (
                          <TrendBadge trend={trend.trend} delta={trend.delta} />
                        )}
                      </div>
                      <div className="text-xs text-slate-600 mt-1">{s.label}</div>
                    </div>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.iconWrap}`}>
                      <s.Icon className="w-4 h-4" aria-hidden="true" />
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>

          {/* Push notifications card */}
          <Card className="border-0 shadow-sm mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className={`w-5 h-5 ${pushActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                Push-notiser
              </CardTitle>
              <CardDescription>Få notiser när AI hittar ett matchande jobb</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${pushActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span className="text-sm">{pushActive ? 'Aktiva' : 'Inaktiva'}</span>
                </div>
                <Button
                  onClick={togglePush}
                  disabled={pushLoading}
                  variant={pushActive ? 'outline' : 'default'}
                  size="sm"
                  className={pushActive ? '' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}
                >
                  {pushLoading ? (
                    <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Laddar...</>
                  ) : pushActive ? (
                    <><BellOff className="w-3 h-3 mr-1" /> Avaktivera</>
                  ) : (
                    <><Bell className="w-3 h-3 mr-1" /> Aktivera push-notiser</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm mb-8" data-testid="aktivitetsrapport-card">
            <CardHeader>
              <CardTitle className="text-lg">Aktivitetsrapport — {monthLabel}</CardTitle>
              <CardDescription>Färdig att skicka till Arbetsförmedlingen</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Round-41 / Part 7 (Sub-feature 3 — AF compliance check).
                  The pace progress bar answers "ligger jag efter mot
                  AF:s standardmål?" without forcing the user to open
                  the PDF. Pure client-side computation via
                  getAfCompliancePace() — no server round-trip. The
                  same disclaimer is appended to the PDF report
                  (lib/pdf-report.js) so the two surfaces share the
                  "Standardmål 14/mån — du ansvarar själv" contract.
                  Round-41.1 (Code-reviewer catch): the `pace` / `pct` /
                  `pacePct` / `cfg` values are hoisted to the component
                  top-level (above the return) so useMemo lives at the
                  top of the render — the idiomatic React-hooks pattern. */}
              <div className="space-y-2" data-testid="af-compliance">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-5 h-5 text-slate-400 shrink-0" />
                        <span
                          data-testid="af-compliance-summary"
                          className="text-sm text-slate-700"
                        >
                          {pace.applied} ansökningar denna period
                        </span>
                        <span
                          data-testid="af-compliance-chip"
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${cfg.chipCls}`}
                        >
                          {cfg.label}
                        </span>
                      </div>
                      <Button
                        onClick={downloadReport}
                        className="bg-slate-900 hover:bg-slate-800"
                        data-testid="af-compliance-download"
                      >
                        <Download className="w-4 h-4 mr-2" /> Ladda ner PDF
                      </Button>
                    </div>
                    {/* Progress bar with pace-marker overlay. The
                        vertical line at `pacePct%` shows where the
                        user SHOULD be at `now` for an even 14/month
                        trajectory. Filled portion = actual
                        progress. The overlay is purely a visual
                        affordance; the semantic status lives in
                        the chip + sub-line above so screen-readers
                        and tests can rely on text, not pixel-perfect
                        bar widths. */}
                    <div
                      className="relative h-2 rounded-full bg-slate-100 overflow-hidden"
                      role="progressbar"
                      aria-valuenow={pace.applied}
                      aria-valuemin={0}
                      aria-valuemax={pace.target}
                      aria-label={`AF compliance: ${pace.applied} av ${pace.target} ansökningar`}
                      data-testid="af-compliance-bar"
                    >
                      <div
                        className={`h-full transition-all ${cfg.barCls}`}
                        style={{ width: `${pct}%` }}
                        data-testid="af-compliance-bar-fill"
                      />
                      {pace.paceRequired > 0 && pace.paceRequired < pace.target && (
                        <div
                          className="absolute top-0 bottom-0 w-px bg-slate-700/60"
                          style={{ left: `${pacePct}%` }}
                          aria-hidden="true"
                          data-testid="af-compliance-pace-marker"
                        />
                      )}
                    </div>
                    <p
                      data-testid="af-compliance-disclaimer"
                      className="text-[11px] text-slate-500 leading-relaxed"
                    >
                      {cfg.sub} Detta är AF:s <strong>standardmål på 14 ansökningar/månad</strong> — du ansvarar själv för att din individuella handlingsplan uppfylls. Kontrollera alltid mot AF:s aktuella krav.
                    </p>
              </div>
            </CardContent>
          </Card>

          {extensionChecked && extensionInstalled && (
            <Card className="border-0 shadow-sm mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span aria-hidden="true" className="text-indigo-600">✈</span>
                  JobbPiloten Auto-Fill
                </CardTitle>
                <CardDescription>
                  Tilägget är installerat — anslut din JobbPiloten-profil en gång så fyller den i formulär automatiskt.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <Button
                    size="sm"
                    onClick={connectExtension}
                    disabled={connectingExtension}
                    data-testid="extension-connect-button"
                    data-extension-alive={extensionAlive ? 'true' : 'false'}
                    className="bg-amber-500 hover:bg-amber-600 text-white"
                  >
                    {connectingExtension ? (
                      <>Ansluter…</>
                    ) : !extensionAlive ? (
                      <>⚠ Koppla från (Pausad)</>
                    ) : connectStatus?.ok ? (
                      <>✓ Ansluten — uppdatera igen</>
                    ) : (
                      <>Anslut din profil</>
                    )}
                  </Button>
                  <span className="text-xs text-slate-600">
                    En bekräftelse på Chrome Web Store-ikonen följer snart.
                  </span>
                </div>
                {connectStatus && (
                  <div
                    role="status"
                    aria-live="polite"
                    className={
                      'rounded-md px-3 py-2 text-xs ' +
                      (connectStatus.ok
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-red-50 text-red-700 border border-red-200')
                    }
                  >
                    {connectStatus.message}
                  </div>
                )}
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Anslutningen är lokal — token sparas krypterad i Chrome:s lagring,
                  data lämnar aldrig din webbläsare utan din knapp.
                </p>
              </CardContent>
            </Card>
          )}

          <Card className="border-0 shadow-sm mb-8 overflow-hidden relative">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Briefcase className="w-5 h-5 text-indigo-600" /> Lediga jobb för dig</CardTitle>
              <CardDescription>Matchade mot din profil från Arbetsförmedlingen — AI förbereder ansökan, du skickar</CardDescription>
            </CardHeader>
            <CardContent>
              {jobsLoading ? (
                <div className="space-y-3">
                  {[0,1,2].map(i => (
                    <div key={i} className="p-3 rounded-lg border border-slate-100">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                        <Skeleton className="h-8 w-28" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : availableJobs.length === 0 ? (
                <div className="text-center py-8 text-slate-500"><Briefcase className="w-8 h-8 mx-auto mb-2 text-slate-300" /><p className="text-sm">Inga lediga jobb hittades just nu</p></div>
              ) : (
                <div className="space-y-5">
                  {/* Bug #2: loose-query banner. Renders only when the
                      profile-scoped AF scrape returned zero and we surfaced
                      a fallback list of recent AF jobs. Tells the user the
                      picks below aren't personalised matches yet and offers
                      a one-click link to /settings where they can refine
                      their preferenser to fix the underlying issue. Uses
                      aria-live so screen-readers announce the context change. */}
                  {searchMode === 'loose' && (
                    <div
                      role="status"
                      aria-live="polite"
                      data-testid="jobs-loose-banner"
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2"
                    >
                      <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mt-1 shrink-0" aria-hidden="true" />
                      <span>
                        <strong>Visar alla jobb</strong> &mdash; justera dina preferenser för bättre matchning.{' '}
                        <Link
                          href="/settings"
                          className="underline underline-offset-2 hover:text-amber-900"
                        >
                          &Auml;ndra preferenser
                        </Link>
                      </span>
                    </div>
                  )}
                  {/* Issue 1 fix: location-filter banner. Renders when
                      the strict Län-filter returned zero hits and we fell
                      back to a nationwide pass. Tells the user exactly
                      what went wrong (no jobs in their preferred cities)
                      and surfaces a one-click toggle to either keep the
                      nationwide fallback OR return to the strict Län-filter
                      when more jobs arrive. Renders for both the dashed
                      'fallback-nationwide' (API + dashboard both flag it)
                      and when the user has explicitly toggled the override
                      on. */}
                  {(locationFilterMode === 'fallback-nationwide' || forceAllSweden) && userLocationList.length > 0 && (
                    <div
                      role="status"
                      aria-live="polite"
                      data-testid="jobs-location-fallback-banner"
                      className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 flex items-start gap-2"
                    >
                      <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mt-1 shrink-0" aria-hidden="true" />
                      <span className="flex-1">
                        <strong>Inga jobb hittades i {userLocationList.slice(0, 2).join(' / ')}{userLocationList.length > 2 ? ` m.fl.` : ''}.</strong>{' '}
                        Visar jobb i hela Sverige istället.{' '}
                        <button
                          type="button"
                          className="underline underline-offset-2 hover:text-blue-700 font-medium"
                          onClick={() => setForceAllSweden(v => !v)}
                          data-testid="jobs-location-toggle"
                        >
                          {forceAllSweden ? 'Tillbaka till dina orter' : 'Behåll alla jobb'}
                        </button>
                      </span>
                    </div>
                  )}
                  {/* When the user has locations but the strict match returned
                      a healthy set, the banner above is hidden. Show a
                      subtle green hint instead so the user knows the filter
                      is active and working as intended. */}
                  {locationFilterMode === 'strict' && userLocationList.length > 0 && availableJobs.length > 0 && !forceAllSweden && (
                    <div
                      role="status"
                      aria-live="polite"
                      data-testid="jobs-location-active-hint"
                      className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-800 inline-flex items-center gap-2 self-start"
                    >
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                      Filtrerar p&aring; {userLocationList.slice(0, 2).join(' / ')}{userLocationList.length > 2 ? ` m.fl.` : ''}
                    </div>
                  )}
                  {/* Dagens jobb \u2014 3 highlight cards with stagger fade-in + hover lift.
                      Designed to feel like the most actionable surface in the app.
                      Wrapped in motion.div with stagger via parent/child variants. */}
                  {availableJobs.length > 0 && (
                    <motion.div
                      initial="hidden"
                      animate="show"
                      variants={{
                        hidden: {},
                        show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
                      }}
                      className="space-y-2"
                    >
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
                        <Sparkle className="w-3.5 h-3.5" aria-hidden="true" />
                        Dagens jobb
                      </div>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {availableJobs.slice(0, 3).map((job, idx) => (
                          // The outer card is a presentation surface (no role),
                          // hover-only. The inner <Button> is the single
                          // interactive element that prepares the application.
                          // This avoids the WAI-ARIA anti-pattern of nesting a
                          // real button inside a `role="button"` div.
                          <motion.div
                            key={`${job.source || "af"}-${job.id}-${idx}`}
                            variants={{
                              hidden: { opacity: 0, y: 8 },
                              show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
                            }}
                            whileHover={{ y: -3 }}
                            className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 hover:border-amber-300 hover:shadow-lg hover:shadow-amber-500/10 transition-all"
                            data-testid="dagens-jobb-card"
                          >
                            {/* Part 7: per-card match score badge. Pure
                                client-side computation from the user's
                                profile + this job. data-testid pinned so
                                the audit e2e can lock the contract. */}
                            {(() => {
                              try {
                                const m = computeMatchScore(job, profile)
                                const tone = m.score >= 75 ? 'emerald' : m.score >= 50 ? 'amber' : 'slate'
                                const toneCls = {
                                  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                                  amber: 'bg-amber-50 text-amber-800 border-amber-200',
                                  slate: 'bg-slate-50 text-slate-600 border-slate-200',
                                }[tone]
                                // Code-reviewer fix Round-43: offset
                                // the match-score badge to `right-3` only
                                // when the "Topp" badge is NOT also
                                // rendering (idx > 0). On idx === 0
                                // both badges share the corner — pushing
                                // the match score to `right-14` keeps
                                // them visually separated.
                                const rightCls = idx === 0 ? 'right-14' : 'right-3'
                                return (
                                  <span
                                    data-testid="job-match-score"
                                    title={`Matchning: roll ${Math.round((m.explanation.roll / 40) * 100)}%, ort ${Math.round((m.explanation.ort / 25) * 100)}%, erfarenhet ${Math.round((m.explanation.erfarenhet / 15) * 100)}%, anställningstyp ${Math.round((m.explanation.anställning / 10) * 100)}%`}
                                    className={`absolute top-3 ${rightCls} inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold tabular-nums ${toneCls}`}
                                  >
                                    {m.score}% match
                                  </span>
                                )
                              } catch (_) { return null }
                            })()}
                            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 opacity-80" aria-hidden="true" />
                            <div className="flex items-start gap-3">
                              <CompanyLogo company={job.company} size="lg" />
                              <div className="min-w-0 flex-1">
                                <div className="font-semibold text-sm text-slate-900 leading-snug line-clamp-2">{job.title}</div>
                                <div className="text-xs text-slate-600 mt-0.5">{job.company}</div>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-3">
                              {job.location && <Tag Icon={MapPin} tone="slate">{job.location}</Tag>}
                              {/* Per-card "matchar din ort" badge — surfaces
                                  when the strict Län-filter pass surfaced
                                  this ad AND the workplace region matches
                                  one of the user's preferred locations.
                                  Tinted emerald so it's visually distinct
                                  from the slate location tag and the indigo
                                  source tag (next to it). */}                                {job.matchesUserLocation && (
                                <span
                                  data-testid="job-matches-user-location"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md border bg-emerald-50 text-emerald-700 border-emerald-200"
                                  title="Matchning baserad på din ort-preferens"
                                >
                                  <span aria-hidden="true">✓</span> Matchar din ort
                                </span>
                              )}
                              {job.source && <Tag Icon={Building2} tone="indigo">{job.source}</Tag>}
                            </div>
                            <div className="mt-4 flex items-center justify-between gap-3">
                              <Button
                                size="sm"
                                disabled={applyingJobId === job.id}
                                onClick={() => openPrepModal(job)}
                                className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-sm shadow-amber-500/30 transition-all hover:scale-[1.03] active:scale-[0.97]"
                              >
                                {applyingJobId === job.id
                                  ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Förbereder...</>
                                  : <><Rocket className="w-3 h-3 mr-1" /> Förbered</>}
                              </Button>
                              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-amber-600 transition-colors" aria-hidden="true" />
                            </div>
                            {idx === 0 && (
                              <Badge className="absolute top-3 right-3 bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px] uppercase">Topp</Badge>
                            )}
                            {/* Part 8: mobile-style "Spara till JobbPiloten"
                                button. Posts to /api/saved-jobs so the
                                desktop dashboard can render the job as
                                "Sparad — förbered på dator" next time
                                the user opens the page. Compact
                                (text-only) so it doesn't crowd the
                                existing Förbered button. */}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async (e) => {
                                e.stopPropagation()
                                try {
                                  const res = await fetch('/api/saved-jobs', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      jobId: job.id,
                                      title: job.title,
                                      company: job.company,
                                      location: job.location || '',
                                      url: job.url || '',
                                      source: job.source || 'Arbetsförmedlingen',
                                    }),
                                  })
                                  const json = await res.json().catch(() => ({}))
                                  if (res.ok && json.ok) {
                                    toast.success('Sparad till JobbPiloten — syns på dashboard.')
                                  } else {
                                    toast.error(json.error || 'Kunde inte spara.')
                                  }
                                } catch (err) {
                                  toast.error('Kunde inte spara: ' + err.message)
                                }
                              }}
                              data-testid="save-job-mobile"
                              className="mt-2 w-full h-7 text-[11px] text-slate-500 hover:text-amber-700 hover:bg-amber-50"
                            >
                              <Star className="w-3 h-3 mr-1" /> Spara till JobbPiloten
                            </Button>
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Long list below the hero cards. Compact rows with company
                      logo + meta + CTA. Header row signals that these are the
                      additional matches beyond the three highlights above. */}
                  {availableJobs.length > 3 && (
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 pt-3">Fler matchningar</div>
                      <div className="space-y-2">
                        {availableJobs.slice(3).map((job, idx) => (
                          <motion.div
                            key={`${job.source || "af"}-${job.id}-${idx}`}
                            whileHover={{ x: 2 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                            className="flex items-center justify-between gap-4 p-3 rounded-lg border border-slate-100 hover:bg-slate-50 hover:border-slate-200 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <CompanyLogo company={job.company} size="sm" />
                              <div className="min-w-0">
                                <div className="font-medium text-sm text-slate-900 truncate">{job.title}</div>
                                <div className="flex items-center gap-2 text-xs text-slate-600 mt-0.5">
                                  <span className="truncate">{job.company}</span>
                                  <span>·</span>
                                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
                                  {job.matchesUserLocation && (
                                    <span data-testid="job-matches-user-location-compact" className="text-emerald-700 font-medium">· ✓ matchar din ort</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              disabled={applyingJobId === job.id}
                              onClick={() => openPrepModal(job)}
                              className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white transition-all hover:scale-[1.03] active:scale-[0.97]"
                            >
                              {applyingJobId === job.id ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Förbereder...</> : <><ExternalLink className="w-3 h-3 mr-1" /> Gå till ansökan</>}
                            </Button>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Issue 3 (2026-07-10): "Visa fler jobb" button.
                      Hides itself when the server signals `!hasMore`
                      (end of the result set). Renders a small
                      "Laddar..." indicator while `loadingMore` is
                      true so the user knows the click registered
                      even before the next page renders. The button
                      is full-width on mobile so the touch target
                      stays comfortable.
                      Bug fix: the count hint used to be nested inside
                      the `serverHasMore &&` block, which meant the
                      moment the server signalled end-of-stream the
                      hint vanished too — a confusing UX (and a flaky
                      test contract) for the user who just loaded 20
                      jobs and now sees the count disappear. The hint
                      now lives one level up so it survives the
                      end-of-stream transition. */}
                  {availableJobs.length > 0 && (
                    <div className="flex flex-col items-center gap-2 pt-3" data-testid="jobs-load-more-wrapper">
                      {serverHasMore && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={loadMoreJobs}
                          disabled={loadingMore}
                          data-testid="jobs-load-more"
                          className="min-w-[180px]"
                        >
                          {loadingMore
                            ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Laddar...</>
                            : <>Visa fler jobb</>}
                        </Button>
                      )}
                      <p className="text-[11px] text-slate-400" data-testid="jobs-load-more-hint">
                        Visar {availableJobs.length} jobb just nu{serverHasMore ? '' : ' — alla hämtade'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 2nd source card — parallel search redirects to Blocket Jobb /
              Jobbsafari. These are honest deep-links (we don't scrape or
              store their listings); the constructed URL carries the user's
              profile.jobTitles[0] + profile.locations[0] forward so they
              land on a pre-filled search results page. Implemented as a
              named inner component (see BroaderSearchCard above) so it can
              be reused / tested in isolation. */}
          <BroaderSearchCard profile={profile} />

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle>Ansökningar</CardTitle>
                  <CardDescription>Ansökningshistorik</CardDescription>
                </div>
                <div
                  role="tablist"
                  aria-label="Filtrera ansökningar"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 self-start sm:self-auto"
                >
                  {FILTERS.map(f => {
                    const count = apps.filter(f.match).length
                    const active = appFilter === f.key
                    return (
                      <button
                        key={f.key}
                        role="tab"
                        aria-selected={active}
                        data-testid={`filter-${f.key}`}
                        onClick={() => pickFilter(f.key)}
                        className={
                          active
                            ? 'px-3 py-1 rounded-md text-xs font-medium bg-white shadow-sm text-slate-900 transition-colors'
                            : 'px-3 py-1 rounded-md text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors'
                        }
                      >
                        {f.label}
                        <span className={`ml-1.5 ${active ? 'text-slate-500' : 'text-slate-400'}`}>· {count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Empty state — renders before both the responsive grid and the
                  mobile list. Same per-filter copy as before, just hoisted out. */}
              {filteredApps.length === 0 && (() => {
                const EMPTY = {
                  all:         { Icon: Briefcase, title: 'Inga jobb hittades just nu.',                sub: 'Kom tillbaka imorgon kl 09:00!' },
                  not_applied: { Icon: Rocket,   title: 'Du har sökt alla jobb! 🎉',                 sub: 'AI-assistenten har inget kvar att förbereda för dig just nu.' },
                  applied:     { Icon: Send,     title: 'Inga sökta jobb än',                       sub: 'Börja söka — använd “Kör AI-assistenten nu” eller välj ett jobb i “Lediga jobb för dig”.' },
                  saved:       { Icon: Star,     title: 'Inga sparade ansökningar.',                sub: 'Klicka på stjärnan i en rad för att spara den här.' },
                }
                const cfg = EMPTY[appFilter] || EMPTY.all
                const Icon = cfg.Icon
                return (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex flex-col items-center text-center max-w-sm mx-auto py-12"
                    data-testid={`empty-${appFilter}`}
                  >
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                      <Icon className="w-6 h-6 text-slate-400" aria-hidden="true" />
                    </div>
                    <h4 className="text-sm font-semibold text-slate-900">{cfg.title}</h4>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{cfg.sub}</p>
                  </div>
                )
              })()}

              {/* Responsive card grid: visible on md+ screens (desktop/tablet).
                  Each card is a self-contained, glanceable summary with company
                  logo, title, tags, status badge, action chips and the saved
                  star. Stagger fade-in matches the Dagens jobb section above
                  so the whole dashboard feels coherent. */}
              {filteredApps.length > 0 && (
                <motion.div
                  initial="hidden"
                  animate="show"
                  variants={{
                    hidden: {},
                    show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
                  }}
                  className="hidden md:grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3"
                  data-testid="applications-grid"
                >
                  {filteredApps.map(app => (
                    <motion.div
                      key={app.id}
                      variants={{
                        hidden: { opacity: 0, y: 8 },
                        show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
                      }}
                      whileHover={{ y: -2 }}
                      className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 hover:border-amber-300 hover:shadow-md transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <CompanyLogo company={app.company} />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm text-slate-900 leading-snug line-clamp-2">{app.title}</div>
                          <div className="text-xs text-slate-600 mt-0.5 truncate">{app.company}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{fmtDate(app.appliedAt)}</div>
                        </div>
                        <SavedToggleButton app={app} />
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {app.location && <Tag Icon={MapPin} tone="slate">{app.location}</Tag>}
                        {/* Round-34: email-prepared rows (Round-34 / Part 4)
                            carry `source: 'email'`. Render a dedicated Mail
                            tag with the amber BRAND palette so the user can
                            tell at a glance that this row is not from the AF
                            scraper — actionable the same way, just composed
                            manually by the user before submission. data-testid
                            is locked by tests/unit/dashboard-email-source.test.mjs. */}
                        {app.source === 'email' && (
                          <Tag Icon={Mail} tone="amber" dataTestid="application-source-email">Mejl</Tag>
                        )}
                        {app.source && app.source !== 'email' && <Tag Icon={Building2} tone="indigo">{app.source}</Tag>}
                        <StatusPill status={app.status} />
                      </div>
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        {app.status === 'prepared' && (
                          <Button size="sm" variant="outline" onClick={() => markAsApplied(app.id)} className="text-xs h-7 px-2 border-amber-200 text-amber-700 hover:bg-amber-50 hover:border-amber-300 transition-all hover:scale-[1.03] active:scale-[0.97]">
                            <Send className="w-3 h-3 mr-1" /> Markera som ansökt
                          </Button>
                        )}
                        {(app.status === 'applied' || app.status === 'user-sent') && (
                          <Button size="sm" variant="outline" onClick={() => markAsConfirmed(app.id)} className="text-xs h-7 px-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 transition-all hover:scale-[1.03] active:scale-[0.97]">
                            <Check className="w-3 h-3 mr-1" /> Jag fick svar
                          </Button>
                        )}
                        {app.coverLetter && app.coverLetter.length > 50 && (
                          <button onClick={() => setShowLetter(app)} className="text-xs text-indigo-600 hover:text-indigo-700 hover:underline inline-flex items-center gap-1 transition-colors">
                            <BookOpen className="w-3 h-3" /> Visa brev
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}

              {/* Mobile-only compact list. Same data, narrower columns.
                  Click anywhere on the row to view the cover letter so the
                  mobile path isn't blocked by tiny button targets. */}
              {filteredApps.length > 0 && (
                <div className="md:hidden space-y-2" data-testid="applications-list-mobile">
                  {filteredApps.map(app => (
                    <div
                      key={app.id}
                      className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 bg-white hover:bg-slate-50 transition-colors"
                    >
                      <CompanyLogo company={app.company} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm text-slate-900 truncate">{app.title}</div>
                        <div className="text-xs text-slate-600 truncate">{app.company} · {app.location}</div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <StatusPill status={app.status} />
                          <span className="text-xs text-slate-400">{fmtDate(app.appliedAt)}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          {app.coverLetter && app.coverLetter.length > 50 && (
                            <button onClick={() => setShowLetter(app)} className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1">
                              <BookOpen className="w-3 h-3" /> Visa brev
                            </button>
                          )}
                          {app.status === 'prepared' && (
                            <Button size="sm" variant="ghost" onClick={() => markAsApplied(app.id)} className="text-xs text-amber-700 hover:bg-amber-50 h-7 px-2">
                              Markera som ansökt
                            </Button>
                          )}
                          {(app.status === 'applied' || app.status === 'user-sent') && (
                            <Button size="sm" variant="ghost" onClick={() => markAsConfirmed(app.id)} className="text-xs text-emerald-700 hover:bg-emerald-50 h-7 px-2">
                              Jag fick svar
                            </Button>
                          )}
                        </div>
                      </div>
                      <SavedToggleButton app={app} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <footer className="border-t border-slate-100 bg-white mt-8">
          <div className="container mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div>© {new Date().getFullYear()} JobbPiloten</div>
            <nav aria-label="Juridiskt" className="flex items-center gap-4">
              <Link href="/privacy" data-testid="footer-privacy" className="hover:text-slate-900 transition-colors">Integritetspolicy</Link>
              <Link href="/terms" data-testid="footer-terms" className="hover:text-slate-900 transition-colors">Användarvillkor</Link>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-slate-900 transition-colors">Kontakt</a>
            </nav>
          </div>
        </footer>

        {/* Prep Modal — shown when user clicks "Gå till ansökan" */}
        <Dialog open={showPrep} onOpenChange={(o) => {
          if (!o) {
            setShowPrep(false)
            setPrepApplication(null)
            setAppliedSuccess(false)
            setRegenerating(false)
          }
        }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-indigo-600" />
                Ansökan förberedd
              </DialogTitle>
              <DialogDescription>
                {prepApplication?.company}{prepApplication?.company && ' — '}{prepApplication?.title}
              </DialogDescription>
            </DialogHeader>
            {prepApplication && prepProfile && (
              <div className="space-y-5">
                {/* Job info */}
                <div className="rounded-lg border border-slate-200 p-4 bg-slate-50">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="font-medium">Företag:</span> {prepApplication.company}</div>
                    <div><span className="font-medium">Titel:</span> {prepApplication.title}</div>
                    <div><span className="font-medium">Ort:</span> {prepApplication.location}</div>
                    <div><span className="font-medium">Källa:</span> {prepApplication.source}</div>
                  </div>
                </div>

                {/* AI Cover Letter */}
                <div>
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <h4 className="text-sm font-semibold text-slate-700">Personligt brev (AI-genererat)</h4>
                      {/* CV badge — surfaces that the LLM is using the
                          user's uploaded CV (rich, full-CV body) instead
                          of the manual summary. Hidden when no CV is on
                          file. `prepProfile.cvFileName` is preserved
                          verbatim thanks to mergeProfileWithUser spread
                          of the whole profile object. */}
                      {prepProfile?.cvFileName && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 max-w-[200px]"
                          data-testid="modal-cv-badge"
                          title={prepProfile.cvFileName}
                        >
                          <FileText className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">
                            CV: {prepProfile.cvFileName.length > 22
                              ? prepProfile.cvFileName.slice(0, 20) + '…'
                              : prepProfile.cvFileName}
                          </span>
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={regenerateCoverLetter}
                      disabled={regenerating}
                      data-testid="regenerate-cover-letter"
                      className="text-indigo-600 hover:bg-indigo-50 text-xs h-7 px-2"
                    >
                      {regenerating
                        ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Skriver...</>
                        : <><Sparkles className="w-3 h-3 mr-1" /> Skriv nytt brev</>}
                    </Button>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 font-serif bg-white border rounded-lg p-4">
                    {prepApplication.coverLetter}
                  </div>
                </div>

                {/* User Info */}
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-2">Dina uppgifter</h4>
                  {/* Profile picture (64x64) sits to the left of the contact
                      details on horizontal layouts; the row collapses to a
                      stacked column on small screens because the parent grid
                      already handles overflow. `prepProfile` is the merged
                      Clerk-or-demo + stored-profile object passed in via
                      `mergeProfileWithUser`, so profilePicture is preserved
                      straight through. */}
                  <div className="rounded-lg border border-slate-200 p-4 bg-slate-50">
                    <div className="flex items-start gap-4">
                      <ProfileAvatar
                        profile={prepProfile}
                        size={64}
                        dataTestid="profile-avatar-modal"
                        ring="ring-2 ring-slate-200"
                        className="bg-white"
                      />
                      <div className="flex-1 min-w-0 text-sm space-y-1">
                        <div><span className="font-medium">Namn:</span> {prepProfile.fullName || '—'}</div>
                        <div><span className="font-medium">E-post:</span> {prepProfile.email || '—'}</div>
                        <div><span className="font-medium">Telefon:</span> {prepProfile.phone || '—'}</div>
                        <div><span className="font-medium">LinkedIn:</span> {prepProfile.linkedin || '—'}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Success banner — shown after the user has marked the application as applied */}
                {appliedSuccess && (
                  <div
                    role="status"
                    aria-live="polite"
                    data-testid="mark-applied-success"
                    className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700 flex items-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    Ansökan markerad som skickad — bra jobbat!
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <Button onClick={copyApplication} variant="outline" className="flex-1">
                    {copied ? <><Check className="w-4 h-4 mr-2 text-emerald-600" /> Kopierad!</> : <><Copy className="w-4 h-4 mr-2" /> Kopiera ansökan</>}
                  </Button>
                  {/* Round-38 / Part 2: "Spara i minnet" button. Promotes
                      the just-generated cover letter into the user's
                      answer-memory corpus (field: 'coverLetter') so
                      the extension's field-constrained memory search
                      can reuse it for a similar role later. Disabled
                      while in flight + after success (same id wins). */}
                  <Button
                    onClick={saveToMemory}
                    disabled={savingMemory || !!savedMemoryId}
                    data-testid="save-to-memory"
                    className="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200"
                  >
                    {savingMemory
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sparar...</>
                      : savedMemoryId
                        ? <><Check className="w-4 h-4 mr-2 text-emerald-600" /> Sparat!</>
                        : <><Sparkle className="w-4 h-4 mr-2" /> Spara i minnet</>}
                  </Button>
                  {prepAppUrl && (() => {
                    // Two-tier model: real URL -> "Ga till ansoekningssida"
                    // (with source-driven visual differentiation); search
                    // fallback -> "Soek jobbet". The lookup falls through
                    // to `direct` styling if `source` is unknown so the
                    // button keeps opening with safe rel attributes.
                    const isSearch = prepAppUrl.source === 'search'
                    const view = isSearch ? searchFallback : HAS_URL_VIEW
                    const style = !isSearch
                      ? (SOURCE_STYLE[prepAppUrl.source] || SOURCE_STYLE.direct)
                      : searchFallback
                    const className = style.className
                    const title = style.title
                    const { label, Icon } = view
                    // Bug #1 hot-fix debug log removed 2026-07-10 —
                    // the open JobOrSearch chain is verified stable
                    // end-to-end and the previous followup asked for
                    // this console.log to go to production-clean.
                    // Re-add locally with `console.log(prepAppUrl)` for
                    // one-off debugging if a regression resurfaces.
                    return (
                      <a
                        href={finalHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={
                          'inline-flex items-center justify-center h-10 px-4 rounded-md border border-slate-200 bg-white text-sm font-medium ' +
                          'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 flex-1 ' +
                          className
                        }
                        data-testid="open-application-page"
                        data-url-source={prepAppUrl.source}
                        title={title}
                      >
                        <Icon className="w-4 h-4 mr-2" />
                        {label}
                      </a>
                    )
                  })()}

                  {/* Last-resort "Sök jobbet" link ONLY when even
                      `resolveApplicationUrl` couldn't build a search query
                      (i.e. no title AND no company). We guard against both
                      fields being empty so the fallback href becomes a
                      meaningful search instead of a degenerative "jobb" query.
                      In practice this branch is dead because apply-now always
                      supplies both fields, but if it ever fires we keep it
                      scoped to the actual job. */}
                  {!prepAppUrl && prepApplication && (() => {
                    const q = `${prepApplication.title || ''} ${prepApplication.company || ''}`.trim()
                    if (!q) return null
                    const href = `https://www.google.com/search?q=${encodeURIComponent(q + ' jobb Sverige')}`
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="open-application-page-fallback"
                        className="inline-flex items-center justify-center h-10 px-4 rounded-md border border-amber-300 bg-white text-sm font-medium text-amber-700 hover:bg-amber-50 hover:text-amber-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 flex-1"
                      >
                        <Search className="w-4 h-4 mr-2" />
                        Sök jobbet
                      </a>
                    )
                  })()}
                  {appliedSuccess ? (
                    <Button
                      disabled
                      data-testid="mark-applied-done"
                      className="flex-1 bg-emerald-600 text-white cursor-default hover:bg-emerald-600"
                    >
                      <Check className="w-4 h-4 mr-2" /> Markerad som ansökt
                    </Button>
                  ) : (
                    <Button
                      onClick={() => markAsApplied(prepApplication.id)}
                      disabled={markingSent === prepApplication.id}
                      data-testid="mark-applied"
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                      {markingSent === prepApplication.id
                        ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sparar...</>
                        : <><Send className="w-4 h-4 mr-2" /> Markera som ansökt</>}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* View Cover Letter Dialog */}
        <Dialog open={!!showLetter} onOpenChange={(o) => !o && setShowLetter(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{showLetter?.company} — {showLetter?.title}</DialogTitle><DialogDescription>Förberedd {showLetter && fmtDate(showLetter.appliedAt)}</DialogDescription></DialogHeader>
            <div className="rounded-lg bg-slate-50 border p-4 whitespace-pre-wrap text-sm leading-relaxed font-serif">{showLetter?.coverLetter}</div>
          </DialogContent>
        </Dialog>
      </div>
    </ErrorBoundary>
  )
}

// Round-22: Next.js 15.5 requires any client component calling
// useSearchParams() to be wrapped in <Suspense> to opt in to dynamic
// rendering (the SDK will surface a build-time warning otherwise).
// Loader2 is already imported at the top of this file (lucide-react).
// The min-h-screen fallback matches the rest of the dashboard's
// own loading state so the Suspense boundary never flashes a blank
// frame at the deep-link entry point.
export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  )
}
