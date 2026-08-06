'use client'

// components/DashboardCards.jsx
//
// Round-88 — leaf presentational components extracted from
// app/dashboard/page.js (dashboard monolith split). Pure visual atoms:
// no data fetching, no app state — everything is prop-driven. The heavy
// stateful container (DashboardContent) stays in app/dashboard/page.js.
// Shared pure helpers live in lib/dashboard-helpers.js.

import { useEffect, useState, useRef, useMemo, memo } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { Clock, TrendingUp, TrendingDown, Minus, Search, ExternalLink, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { buildBlocketSearchUrl, buildJobSafariSearchUrl } from '@/lib/jobScraper'
import { nextCronAt, fmtTimeUntil, STATUS_MAP, getMonthlyTrend } from '@/lib/dashboard-helpers'

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
export function TrendBadge({ trend, delta }) {
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

/**
 * NextCronBanner — sticky-ish status pill at the top of the dashboard that
 * tells the user when the next daily cron will run. Updates its countdown
 * text every minute via a small `useEffect` interval so it stays accurate
 * even after the user leaves the tab open for hours. Amber accent matches
 * the rest of the brand palette. Renders nothing if `hideUntil` is set.
 */
export function NextCronBanner({ hideUntil = null }) {
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
 * AnimatedCounter — Round-94 (professional polish): every value change
 * (including the first mount) counts up from the previous value to
 * `value` over 800ms with an easeOut curve, driven by framer-motion's
 * `animate(MotionValue, target, opts)` which uses requestAnimationFrame
 * internally (no setInterval). Numbers render in `tabular-nums` so the
 * digit columns don't jitter while counting. Non-numeric values pass
 * through the optional `formatter`.
 */
export function AnimatedCounter({ value = 0, formatter }) {
  const mv = useMotionValue(0)
  const display = useTransform(mv, (v) =>
    formatter ? formatter(Math.round(v)) : Math.round(v)
  )
  useEffect(() => {
    const ctrl = animate(mv, value, { duration: 0.8, ease: 'easeOut' })
    return () => ctrl.stop()
  }, [value, mv])
  return <motion.span className="tabular-nums">{display}</motion.span>
}

/**
 * CompanyLogo — gradient placeholder with the company's first letter.
 * Deterministic amber/indigo gradient seeded by company name so the same
 * company always renders the same gradient. Acts as a visual anchor on
 * each card (no real logo fetching needed).
 */
export function CompanyLogo({ company = '?', size = 'md' }) {
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
export function StatusPill({ status }) {
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
 * HeroStatCard — Round-94 (professional polish): memoized leaf for the
 * dashboard's four hero stat cards. Extracted from the inline map so a
 * stat-card render can never re-run the parent's trend computation or
 * re-render sibling cards (React.memo). Purposeful details:
 *   • `tabular-nums` on the headline so digits don't jitter mid-count.
 *   • layered `shadow-card` resting state → `shadow-card-hover` on hover
 *     (defined in app/globals.css) instead of a flat shadow.
 *   • 200ms transition on the lift so the motion feels weighty, not
 *     rubbery.
 */
export const HeroStatCard = memo(function HeroStatCard({ s, apps, idx }) {
  // Trend computation is scoped INSIDE the memoized leaf so unrelated
  // dashboard re-renders (star toggles, push status, cron logs) neither
  // re-run the O(n) window scan nor re-render the card (props are
  // stable thanks to the module-scope HERO_STATS config in the page).
  const trend = useMemo(
    () => (s.showTrend ? getMonthlyTrend(apps, s.trendMatch, s.timestampKey) : null),
    [apps, s],
  )
  const headlineValue = s.showTrend ? (trend ? trend.current : 0) : (s.value || 0)
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: idx * 0.06, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
      className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-card transition-shadow duration-200 hover:shadow-card-hover"
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${s.gradient} pointer-events-none`} aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
              <AnimatedCounter value={headlineValue} />
            </div>
            {s.showTrend && trend && (
              <TrendBadge trend={trend.trend} delta={trend.delta} />
            )}
          </div>
          <div className="text-xs text-slate-600 mt-1 flex items-center gap-1.5">
            <span className="truncate">{s.label}</span>
            {s.hint && (
              <Tooltip delayDuration={150}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={s.hint}
                    className="inline-flex shrink-0 rounded-full text-slate-400 hover:text-slate-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <Info className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[240px] text-xs">
                  {s.hint}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.iconWrap}`}>
          <s.Icon className="w-4 h-4" aria-hidden="true" />
        </div>
      </div>
    </motion.div>
  )
})

/**
 * DashboardLoadingSkeleton — Round-94 (professional polish): the
 * full-page loading state for the dashboard. Mirrors the real layout
 * (sticky nav, hero banner, 4 stat cards, job rows) so the paint is
 * stable when real content swaps in — no layout jump, no spinner flash.
 */
export function DashboardLoadingSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50" data-testid="dashboard-loading-skeleton">
      <div className="border-b bg-white/90 backdrop-blur-md sticky top-0 z-30">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
      </div>
      <div className="container mx-auto px-4 py-8 space-y-8">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * BroaderSearchCard — second-source search panel that opens Blocket Jobb /
 * Jobbsafari in a new tab with the user's primary title + location pre-filled.
 * Honest deep-links: we do not scrape or store their listings; we just hand
 * off the search query. Returns null when both URLs are empty so the parent
 * Card stack stays clean for users with an empty profile.
 */
export function BroaderSearchCard({ profile }) {
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
