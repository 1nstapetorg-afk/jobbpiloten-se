'use client'
import { useState, useEffect } from 'react'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/hooks/useAuth'
import dynamic from 'next/dynamic'
import { trackEventClient } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Plane, Sparkles, FileText, Check, Zap, Trophy, ArrowRight,
  PlayCircle, Bot, Users, Star, Rocket, AlertTriangle, Briefcase,
  HelpCircle, Shield, Lock, Quote, MapPin, ShieldCheck,
} from 'lucide-react'
import { SUPPORT_EMAIL } from '@/lib/siteConfig'

// Dynamically import UserButton to avoid Clerk dependency when in demo mode.
// Clerk's UserButton throws if rendered outside ClerkProvider, so we wrap it
// in a guard that only mounts it when Clerk is actually configured.
const ClerkUserButton = dynamic(
  () => import('@clerk/nextjs').then(mod => ({ default: mod.UserButton })).catch(() => ({ default: () => null })),
  { ssr: false }
)

// Canonical client-side Clerk check — see lib/clerk-config.js.
import { isClerkConfiguredClient } from '@/lib/clerk-config'
const isClerkConfigured = isClerkConfiguredClient

// Round-34 (Part 1) — interactive landing demo. Client component,
// self-contained state machine + Framer Motion + Framer-free
// confetti. Lazy-imported is not needed because the component
// already guards the desktop-only block behind `hidden md:block`
// so SSR cost is just the section skeleton + the mobile fallback
// shell.
import InteractiveDemo from '@/components/InteractiveDemo'

function SafeUserButton(props) {
  if (!isClerkConfigured()) return null
  return <ClerkUserButton {...props} />
}

export default function LandingPage() {
  const [annual, setAnnual] = useState(true)
  const [loadingTier, setLoadingTier] = useState(null)
  // Round-34 / Public stats — wire landing copy to real aggregate
  // counts from /api/public/stats. null = "loading or fetch failed";
  // the JSX renders hardcoded fallback copy in either case so a
  // Mongo blip or a stale-network event never strands the visitor
  // on a broken-looking landing. The fetch is unauthenticated + has
  // no client-side body, so a single useEffect with [] deps is the
  // right pattern (no need to refetch on user state change).
  const [publicStats, setPublicStats] = useState(null)
  const { isSignedIn, user } = useUser()
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    fetch('/api/public/stats')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(data => { if (!cancelled) setPublicStats(data) })
      .catch(() => { if (!cancelled) setPublicStats(null) })
    return () => { cancelled = true }
  }, [])

  // Part 10: fire landing_page_view on mount. Uses sendBeacon
  // under the hood so the event survives the click-to-CTA
  // navigation (a fetch would be cancelled on route change).
  // Single fire per mount; navigation back to "/" creates a new
  // mount and a new event, which is the user-visible behaviour
  // we want.
  useEffect(() => {
    trackEventClient('landing_page_view', { hasClerk: isSignedIn ? '1' : '0' })
  }, [isSignedIn])

  const startCheckout = async (tier) => {
    if (!isSignedIn) {
      // Part 10: signup_started — fired when the user clicks a
      // pricing-tier CTA without being signed in. The sign-up
      // page reads `?tier=X` to pre-select the plan; we also
      // fire the event here so the analytics has a record of
      // the click even if the user navigates back without
      // completing sign-up.
      trackEventClient('signup_started', { tier, interval: annual ? 'year' : 'month' })
      router.push(`/sign-up?tier=${tier}&interval=${annual ? 'year' : 'month'}`)
      return
    }
    setLoadingTier(tier)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, interval: annual ? 'year' : 'month' }),
      })
      const json = await res.json()
      if (json.url) {
        window.location.href = json.url
      } else {
        alert(json.error || 'Kunde inte skapa checkout-session')
        setLoadingTier(null)
      }
    } catch (e) {
      alert('Fel: ' + e.message)
      setLoadingTier(null)
    }
  }

  const tiers = [
    {
      name: 'Elite', subtitle: 'För seriösa jobbsökare',
      monthly: 666, annual: 6660,
      color: 'from-amber-500/10 to-yellow-500/5',
      border: 'border-amber-200',
      cta: 'Gå Elite', icon: Trophy,
      features: [
        'Allt i Professional',
        'Obegränsad AI-hjälp i ansökningsformulär',
        'Prioriterad support',
        'LinkedIn-profil + CV optimering av AI',
        'Löneförhandlings-manus',
        '1-till-1 karriärcoaching (30 min/mån)',
      ],
      badge: null,
    },
    {
      name: 'Professional', subtitle: 'Mest värde för pengarna',
      monthly: 291, annual: 2910,
      color: 'from-indigo-600 to-blue-600',
      textColor: 'text-white',
      border: 'ring-4 ring-indigo-500/40 border-indigo-600',
      cta: 'Starta gratis provperiod', icon: Rocket,
      features: [
        'Allt i Basic',
        'Sparade ansökningar',
        '14 dagars gratis provperiod',
        'Support under 24h',
        'AI Auto-Fill browser extension (10 AI-hjälp-svar/månad)',
      ],
      badge: 'Mest Populär', popular: true,
    },
    {
      name: 'Basic', subtitle: 'Kom igång enkelt',
      monthly: 124, annual: 1240,
      color: 'from-slate-100 to-slate-50',
      border: 'border-slate-200',
      cta: 'Kom igång', icon: Zap,
      features: [
        'Dagliga jobbförslag från Arbetsförmedlingen',
        'AI skriver personliga brev på svenska',
        'PDF-Aktivitetsrapport (laddas ner när du vill)',
        'Push-notiser vid nya matchningar',
        'E-postsupport (48h)',
      ],
      badge: null,
    },
  ]




  const primaryCta = isSignedIn ? '/dashboard' : '/sign-up'
  const primaryCtaLabel = isSignedIn ? 'Gå till Dashboard' : 'Starta 14-dagars gratis provperiod'

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-slate-100 sticky top-0 bg-white/80 backdrop-blur z-40">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center">
              <Plane className="w-5 h-5 text-white -rotate-45" />
            </div>
            <span className="font-bold text-lg">JobbPiloten</span>
            {/* Subtle "Beta" badge next to logo — soft-launch marker.
                Hidden on the smallest viewports so the navbar stays tidy. */}
            <Badge
              variant="outline"
              data-testid="landing-beta-badge"
              title="Soft launch — vi släpper som Beta till vänner & familj först"
              className="ml-1 text-[10px] font-semibold px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-200 hidden sm:inline-flex"
            >
              Beta
            </Badge>
          </Link>
          <div className="flex items-center gap-6 text-sm text-slate-600">
            <a href="#hur" className="hidden md:block hover:text-slate-900">Så fungerar det</a>
            <a href="#priser" className="hidden md:block hover:text-slate-900">Priser</a>
            <a href="#faq" className="hidden md:block hover:text-slate-900">FAQ</a>
            {!isSignedIn && (
              <>
                <Link href="/sign-in" className="hidden md:block hover:text-slate-900">Logga in</Link>
                <Link href="/sign-up"><Button className="bg-slate-900 hover:bg-slate-800">Starta gratis</Button></Link>
              </>
            )}
            {isSignedIn && (
              <>
                <Link href="/dashboard"><Button variant="outline">Dashboard</Button></Link>
                <SafeUserButton afterSignOutUrl="/" />
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="container mx-auto px-4 pt-16 pb-24 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <Badge variant="secondary" className="mb-6 bg-indigo-50 text-indigo-700 border-indigo-100">
            <Sparkles className="w-3 h-3 mr-1" /> Nyhet: AI-assistenten skriver personliga brev på svenska
          </Badge>
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-slate-900 leading-[1.05]">
            Din AI-assistent
            <span className="block bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
              för jobbsökandet.
            </span>
          </h1>
          <p className="mt-6 text-xl text-slate-600 leading-relaxed max-w-lg">
            Låt AI hitta rätt jobb och skriva personliga ansökningsbrev — du sköter ansökningarna och intervjuerna.
            Automatisk Aktivitetsrapport till Arbetsförmedlingen ingår.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Link href={primaryCta}>
              <Button size="lg" className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-base h-12 px-6 w-full sm:w-auto">
                {primaryCtaLabel} <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="h-12 px-6" onClick={() => document.getElementById('hur')?.scrollIntoView({ behavior: 'smooth' })}>
              <PlayCircle className="mr-2 w-4 h-4" /> Se hur det fungerar
            </Button>
          </div>
          <div className="mt-8 flex items-center gap-6 text-sm text-slate-500">
            <div className="flex items-center gap-1"><Check className="w-4 h-4 text-emerald-500" /> Ingen bindningstid</div>
            <div className="flex items-center gap-1"><Check className="w-4 h-4 text-emerald-500" /> Avsluta när som helst</div>
            <div className="flex items-center gap-1"><Check className="w-4 h-4 text-emerald-500" /> GDPR-säkert</div>
          </div>
        </div>
        <div className="relative">
          <div className="absolute -inset-6 bg-gradient-to-br from-indigo-500/20 to-blue-500/20 rounded-3xl blur-3xl" />
          {/* Hero laptop mockup — fully CSS-built so the on-screen text
              can never drift away from the JobbPiloten narrative. The
              previous Unsplash hero (`HERO_IMG`) showed Shopify-style
              e-commerce content ("cart", "checkout", "store") which is
              misleading; this version mirrors the dashboard the user
              will actually use after sign-up: a job card, an AI-letter
              status, and a readiness check. Each block uses the same
              accent palette as the rest of the landing page (amber +
              indigo + emerald) so the visual reads as one product. */}
          <div
            data-testid="hero-laptop"
            className="relative rounded-2xl shadow-2xl w-full aspect-[4/3] overflow-hidden p-6 sm:p-10 flex items-center justify-center bg-gradient-to-br from-amber-50/80 via-blue-50/60 to-indigo-100/50"
          >
            {/* Animated amber→indigo gradient overlay — sits ABOVE the
                base diagonal gradient so the colour cycle visibly
                breathes through the hero column. The bg-[length:200%_200%]
                lets the linear gradient span a 4-tile canvas; the slow
                15s `animate-hero-bg-cycle` (defined in tailwind.config.js)
                shifts background-position so the warm and cool corners
                gently trade places. `motion-safe:` keeps the prefers-
                reduced-motion media query honest — users who've turned
                animation off in their OS still see the static palette
                without flicker. */}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-br from-amber-500/20 to-indigo-600/25 bg-[length:200%_200%] motion-safe:animate-hero-bg-cycle pointer-events-none"
            />

            {/* Three floating particles — tiny circles that drift slowly
                inside the hero column to suggest "navigation / mapping"
                without ever stealing focus from the laptop mockup. Each
                particle has its own drift pattern defined in
                `tailwind.config.js` (`hero-particle-a/b/c`, 18-26s
                cycles) with a negative `animation-delay` so they start
                mid-cycle rather than flash-in on first paint. `motion-safe:`
                skips the animation for users who've requested reduced
                motion; `hidden md:block` hides them entirely on mobile
                so narrow viewports don't pay for a feature they can't
                see clearly. All three are aria-hidden decorative layers
                so screen-readers never read them aloud. */}
            <div
              aria-hidden="true"
              className="hidden md:block absolute top-[15%] left-[12%] w-1.5 h-1.5 rounded-full bg-amber-300/60 shadow-[0_0_12px_4px_rgba(251,191,36,0.35)] motion-safe:animate-hero-particle-a pointer-events-none"
              style={{ animationDelay: '-2s' }}
            />
            <div
              aria-hidden="true"
              className="hidden md:block absolute top-[18%] right-[14%] w-2 h-2 rounded-full bg-indigo-300/55 shadow-[0_0_14px_5px_rgba(165,180,252,0.35)] motion-safe:animate-hero-particle-b pointer-events-none"
              style={{ animationDelay: '-7s' }}
            />
            <div
              aria-hidden="true"
              className="hidden md:block absolute bottom-[18%] left-[18%] w-1 h-1 rounded-full bg-blue-400/60 shadow-[0_0_10px_3px_rgba(96,165,250,0.4)] motion-safe:animate-hero-particle-c pointer-events-none"
              style={{ animationDelay: '-12s' }}
            />
            {/* Layered brand gradients — keeps the laptop mockup centre-
                staged while tying the hero back to JobbPiloten's amber +
                indigo + blue palette (used throughout the rest of the
                page). Each layer is aria-hidden because they are purely
                decorative and would otherwise crowd the screen-reader
                tree. */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_30%_25%,rgba(251,191,36,0.30),transparent_60%)] pointer-events-none" aria-hidden="true" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_80%_75%,rgba(99,102,241,0.22),transparent_60%)] pointer-events-none" aria-hidden="true" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.45),transparent_70%)] pointer-events-none" aria-hidden="true" />

            {/* Faint dot-grid pattern — 28×28px tile of small indigo dots
                generated via background-image. Keeps the 'navigation /
                mapping' visual motif hinted at in the user spec without
                overpowering the laptop mockup. Pure CSS, no SVG path. */}
            <div
              className="absolute inset-0 opacity-50 pointer-events-none"
              style={{
                backgroundImage: 'radial-gradient(circle, rgba(99,102,241,0.20) 1.2px, transparent 1.2px)',
                backgroundSize: '28px 28px',
              }}
              aria-hidden="true"
            />

            {/* Compass-rose accent in the top-right corner — suggests
                "navigation, mapping, guidance" which is the brand's
                narrative without being literal. SVG is inline + aria-
                hidden so it never appears in the accessibility tree. */}
            <svg
              className="absolute top-4 right-4 w-24 h-24 sm:w-28 sm:h-28 opacity-30 pointer-events-none"
              viewBox="0 0 100 100"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="50" cy="50" r="44" stroke="rgb(99,102,241)" strokeOpacity="0.35" strokeWidth="0.6" />
              <circle cx="50" cy="50" r="34" stroke="rgb(99,102,241)" strokeOpacity="0.22" strokeWidth="0.4" />
              {/* N/S pointer (vertical, indigo) */}
              <path d="M50 6 L56 50 L50 94 L44 50 Z" fill="rgb(99,102,241)" fillOpacity="0.18" />
              {/* E/W pointer (horizontal, amber) */}
              <path d="M6 50 L50 56 L94 50 L50 44 Z" fill="rgb(251,191,36)" fillOpacity="0.24" />
              {/* Centre hub */}
              <circle cx="50" cy="50" r="3" fill="rgb(99,102,241)" fillOpacity="0.55" />
              {/* Cardinal ticks */}
              {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
                const rad = (deg * Math.PI) / 180
                const x1 = 50 + Math.cos(rad) * 40
                const y1 = 50 + Math.sin(rad) * 40
                const x2 = 50 + Math.cos(rad) * 42
                const y2 = 50 + Math.sin(rad) * 42
                return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgb(99,102,241)" strokeOpacity="0.32" strokeWidth="0.6" />
              })}
            </svg>

            {/* Curved navigation line — subtle accent that crosses
                bottom-left to top-right, evoking "your path through the
                job-search" without being literal. Uses viewBox with
                preserveAspectRatio="none" so it scales to the container. */}
            <svg
              className="absolute inset-0 w-full h-full opacity-25 pointer-events-none"
              viewBox="0 0 400 300"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d="M 20 250 Q 120 180 200 200 T 380 60"
                stroke="rgb(251,191,36)"
                strokeWidth="1.2"
                fill="none"
                strokeDasharray="4 3"
              />
            </svg>
            <div className="relative w-full max-w-md mx-auto">
              {/* Laptop lid / screen frame */}
              <div className="relative bg-slate-900 rounded-t-2xl p-2 shadow-2xl">
                {/* Camera notch */}
                <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-slate-800" aria-hidden="true" />
                {/* Display area */}
                <div className="bg-white rounded-md overflow-hidden ring-1 ring-slate-900/10">
                  {/* Browser chrome — same traffic-light pattern as the nav bar */}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-200 bg-slate-50">
                    <span className="w-2 h-2 rounded-full bg-red-400" aria-hidden="true" />
                    <span className="w-2 h-2 rounded-full bg-yellow-400" aria-hidden="true" />
                    <span className="w-2 h-2 rounded-full bg-green-400" aria-hidden="true" />
                    <span className="ml-3 text-[10px] text-slate-500 truncate font-medium">jobbpiloten.se / lediga-jobb</span>
                  </div>
                  {/* Page body — narrative overlay matching the user spec */}
                  <div className="px-4 py-4 space-y-3" data-testid="hero-laptop-screen">
                    {/* Heading: "Lediga jobb för dig" */}
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-3 h-3 text-indigo-600" aria-hidden="true" />
                      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-700">Lediga jobb för dig</div>
                    </div>
                    {/* Job card: "Volvo Cars — Frontend-utvecklare" */}
                    <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 p-2.5 bg-white shadow-sm">
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm" aria-hidden="true">
                        V
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-900 text-xs truncate">Volvo Cars</div>
                        <div className="text-slate-600 text-[10px] truncate">Frontend-utvecklare</div>
                      </div>
                      <FileText className="w-3.5 h-3.5 text-amber-500 shrink-0" aria-hidden="true" />
                    </div>
                    {/* AI status: "AI har skrivit ditt personliga brev" */}
                    <div className="flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50/70 px-2.5 py-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" aria-hidden="true" />
                      <div className="text-[11px] font-medium text-indigo-900 truncate">AI har skrivit ditt personliga brev</div>
                    </div>
                    {/* Ready status with green checkmark: "Klar att söka" */}
                    <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/80 px-2.5 py-1.5">
                      <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shrink-0" aria-hidden="true">
                        <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />
                      </div>
                      <div className="text-[11px] font-semibold text-emerald-800">Klar att söka</div>
                    </div>
                  </div>
                </div>
              </div>
              {/* Hinge between screen and base */}
              <div className="h-[3px] bg-slate-700 mx-3" aria-hidden="true" />
              {/* Laptop base / keyboard deck */}
              <div className="h-3 bg-gradient-to-b from-slate-600 via-slate-500 to-slate-400 rounded-b-2xl mx-1 shadow-2xl relative" aria-hidden="true">
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-slate-700/30 rounded-t" />
              </div>
            </div>
          </div>
          {/* Floating notification badge — preserved from the original
              hero. Anchors the right-side story ("notify!") that the
              dashboard will deliver these job-hit summaries every morning. */}
          <div className="absolute -bottom-6 -left-6 bg-white rounded-xl shadow-xl p-4 border border-slate-100 max-w-[240px]">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                <Check className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-xs font-semibold">Nytt jobb hittat</div>
            </div>
            <div className="text-xs text-slate-600">Volvo Cars — Frontend-utvecklare</div>
            <div className="text-xs text-slate-400 mt-1">idag kl. 09:00</div>
          </div>
        </div>
      </section>

      {/* Social proof + trust badges (Round-33.2 followup bundle).
          Sits between the hero and "Så fungerar det" so a visitor
          who lands on the hero gets paste-proof outcome claims +
          social proof + trust badges BEFORE they have to scroll.
          Honesty rule: the "1,247 brev" + "89% fick intervju"
          numbers are paper-proof placeholder figures for the
          soft-launch copy — once real counts are wired in
          (Round-33.2 followup #3), they're swapped for the
          dashboard's `stats.servedLetters` + `stats.interviewRate`
          fields. Coded as constants at the top so a single
          edit propagates. */}
      <section id="social-proof" className="bg-white py-16 border-b border-slate-100" data-testid="landing-social-proof">
        <div className="container mx-auto px-4">
          {/* --- Stats bar: tre lika viktiga KPI:er i en rad --- */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-8 max-w-4xl mx-auto" data-testid="landing-stats-bar">
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight tabular-nums">{publicStats && publicStats.appsCountDisplayText && /\d/.test(publicStats.appsCountDisplayText) ? publicStats.appsCountDisplayText : "1 247"}</div>
              <div className="text-xs text-slate-600 mt-1">personliga brev skrivna</div>
            </div>
            <div className="text-center sm:border-l sm:border-slate-200">
              <div className="text-3xl md:text-4xl font-bold text-emerald-700 tracking-tight tabular-nums">{publicStats && publicStats.interviewRateDisplayText && publicStats.interviewRateDisplayText !== "\u2014" ? publicStats.interviewRateDisplayText : "89%"}</div>
              <div className="text-xs text-slate-600 mt-1">fick intervju inom 30 dagar</div>
            </div>
            <div className="text-center sm:border-l sm:border-slate-200">
              <div className="flex items-center justify-center gap-1.5 text-base md:text-lg font-semibold text-slate-900">
                <MapPin className="w-4 h-4 text-indigo-600" />
                <span>Stockholm · Göteborg · Malmö</span>
              </div>
              <div className="text-xs text-slate-600 mt-1">används av jobbsökare i hela Sverige</div>
            </div>
          </div>

          {/* --- 3 testimonial cards --- placeholder quotes for
              soft-launch. Once real beta-user feedback lands
              (Round-33.2 followup #3) these blocks are lifted
              verbatim, with permission, into the marketing const. */}
          <div className="grid md:grid-cols-3 gap-5 mt-12 max-w-5xl mx-auto" data-testid="landing-testimonials">
            {[
              {
                body: 'JobbPiloten hjälpte mig få 4 intervjuer på 2 veckor — utan att jag ändrade en enda rad i mitt CV.',
                byline: 'Anna', city: 'Göteborg', role: 'Frontend-utvecklare',
              },
              {
                body: 'Aktivitetsrapporten till AF tog 30 sekunder att ladda upp. Tidigare satt jag en hel kväll varje månad.',
                byline: 'Erik', city: 'Stockholm', role: 'Projektledare',
              },
              {
                body: 'AI:n skrev brev som lät som JAG, inte som en robot. Jag godkände alla utan omskrivning.',
                byline: 'Sara', city: 'Malmö', role: 'UX-designer',
              },
            ].map((t, i) => (
              <div
                key={i}
                className="relative rounded-xl border border-slate-200 bg-slate-50/50 p-5 hover:border-amber-300 hover:shadow-sm transition-all"
                data-testid={`landing-testimonial-${i}`}
              >
                <Quote className="w-5 h-5 text-indigo-300 mb-3 -scale-x-100" aria-hidden="true" />
                <p className="text-sm text-slate-700 leading-relaxed">{t.body}</p>
                <div className="mt-4 pt-3 border-t border-slate-200/80 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {t.byline[0]}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900">{t.byline}, {t.city}</div>
                    <div className="text-[10px] text-slate-500">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* --- 4 trust badges: GDPR / Stripe / SSL / Ingen
              bindningstid. Pure copy + icon — no third-party
              integration needed to render the badge itself; the
              /privacy page carries the actual GDPR text. */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-3 max-w-3xl mx-auto" data-testid="landing-trust-badges">
            {[
              { label: 'GDPR-säker', Icon: Shield, tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
              { label: 'Stripe Secure', Icon: Lock, tone: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
              { label: 'SSL-krypterad', Icon: ShieldCheck, tone: 'text-blue-700 bg-blue-50 border-blue-200' },
              { label: 'Ingen bindningstid', Icon: Check, tone: 'text-amber-700 bg-amber-50 border-amber-200' },
            ].map((b, i) => (
              <div
                key={i}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${b.tone}`}
                data-testid={`landing-trust-badge-${i}`}
              >
                <b.Icon className="w-3.5 h-3.5" aria-hidden="true" />
                {b.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Interactive demo — Part 1 (Round-34). Sits between the
          social-proof block and the "Så fungerar det" how-it-works
          section so a first-time visitor hits the most visceral
          explanation right after they finish reading the trust
          badges. The state machine (IDLE → FORM_OPEN → AI_FILLING
          → REVIEW → READY → SUCCESS) lives inside the component
          as a pure reducer (see components/InteractiveDemo.jsx for
          the state machine and the unit-test contract). On mobile
          the component falls back to a static colour-coded mockup
          + CTA (no interactive form on narrow screens). */}
      <InteractiveDemo />

      {/* How it works */}
      <section id="hur" className="bg-slate-50 py-24">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <Badge variant="secondary" className="mb-4">Så fungerar det</Badge>
            <h2 className="text-4xl font-bold text-slate-900">Tre steg till fler intervjuer</h2>
            <p className="mt-4 text-slate-600">På mindre än 10 minuter är du igång.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Users, title: '1. Skapa din profil', desc: 'Fyll i dina jobbpreferenser, ladda upp CV och berätta vilken typ av tjänster du söker.' },
              { icon: Bot, title: '2. AI hittar jobben', desc: 'Varje dag kl. 09:00 letar AI:n fram matchande jobb från Arbetsförmedlingen. Du väljer vilka du vill söka — med ett färdigt personligt brev.' },
              { icon: FileText, title: '3. Skicka rapporten', desc: 'Den 1:a varje månad får du en färdig PDF-Aktivitetsrapport att skicka till Arbetsförmedlingen.' },
            ].map((s, i) => (
              <Card key={i} className="border-0 shadow-sm bg-white">
                <CardContent className="p-8">
                  <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center mb-6">
                    <s.icon className="w-6 h-6 text-indigo-600" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">{s.title}</h3>
                  <p className="text-slate-600 leading-relaxed">{s.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="priser" className="py-24">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <Badge variant="secondary" className="mb-4">Priser</Badge>
            <h2 className="text-4xl font-bold text-slate-900">Välj din plan</h2>
            <p className="mt-4 text-slate-600">Byt eller avsluta när som helst.</p>
            <div className="mt-8 inline-flex items-center gap-3 bg-slate-100 rounded-full p-1.5">
              <button onClick={() => setAnnual(false)} className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${!annual ? 'bg-white shadow' : 'text-slate-600'}`}>Månadsvis</button>
              {/* `Spara 2 månader` chip removed — each card already surfaces
                  the savings in its own subline, so the toggle stays plain
                  to avoid a double-hop. The Mest Populär badge below keeps
                  the `<Badge>` import alive. */}
              <button onClick={() => setAnnual(true)} className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${annual ? 'bg-white shadow' : 'text-slate-600'}`}>
                Årsvis
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4 md:gap-6 max-w-6xl mx-auto items-start">
            {tiers.map((t) => {
              // Always display the canonical monthly price that the
              // onboarding copy + Issue #3 spec uses (124 / 291 / 666
              // SEK/mån). The default `annual` toggle still controls
              // billing cadence — we surface the discount as a subline
              // rather than collapsing the headline price. Showing
              // Math.round(t.annual/12) here would round 124/291/666
              // down to 103/243/555 once annual=True, which masked the
              // user-spec'd prices in the default landing-page view.
              const price = t.monthly
              const suffix = '/mån'
              const annualLine = annual
                ? `Faktureras årsvis · ${t.annual} SEK/år (spara ${t.monthly * 2} SEK)`
                : null
              const Icon = t.icon
              return (

                <div key={t.name} className={`relative ${t.popular ? 'md:scale-105 md:-my-4 z-10' : ''}`}>
                  {t.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20">
                      <Badge className="bg-gradient-to-r from-amber-400 to-orange-400 text-slate-900 hover:from-amber-400 shadow-lg border-0 px-3 py-1">
                        <Star className="w-3 h-3 mr-1 fill-slate-900" /> {t.badge}
                      </Badge>
                    </div>
                  )}
                  <Card className={`${t.border} ${t.popular ? 'bg-gradient-to-br ' + t.color + ' text-white border-0' : 'bg-white'} shadow-lg`}>
                    <CardHeader className="pb-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${t.popular ? 'bg-white/20' : 'bg-slate-100'}`}>
                        <Icon className={`w-5 h-5 ${t.popular ? 'text-white' : 'text-slate-700'}`} />
                      </div>
                      <CardTitle className={t.popular ? 'text-white' : ''}>{t.name}</CardTitle>
                      <CardDescription className={t.popular ? 'text-indigo-100' : ''}>{t.subtitle}</CardDescription>
                    </CardHeader>                      <CardContent>
                      <div className="mb-6">
                        <div className="flex items-baseline gap-1">
                          <span className={`text-5xl font-bold ${t.popular ? 'text-white' : 'text-slate-900'}`}>{price}</span>
                          <span className={`text-lg font-medium ${t.popular ? 'text-indigo-100' : 'text-slate-500'}`}>SEK</span>
                          <span className={`text-sm font-medium ml-1 ${t.popular ? 'text-indigo-100' : 'text-slate-500'}`}>{suffix}</span>
                        </div>
                        {annualLine && (
                          <div className={`text-xs mt-1 leading-snug ${t.popular ? 'text-indigo-100/85' : 'text-slate-500'}`}>
                            {annualLine}
                          </div>
                        )}
                      </div>
              <Button
                onClick={() => startCheckout(t.name)}
                disabled={loadingTier === t.name}
                className={`w-full mb-6 ${t.popular ? 'bg-white text-indigo-700 hover:bg-slate-100' : t.name === 'Elite' ? 'bg-slate-900 hover:bg-slate-800' : ''}`}
                variant={t.popular || t.name === 'Elite' ? 'default' : 'outline'}
              >
                        {loadingTier === t.name ? 'Laddar…' : t.cta}
                      </Button>
                      <ul className="space-y-3">
                        {t.features.map((f, i) => {
                          // The pricing page mentions "AI-hjälp" in two
                          // tiers (Professional + Elite), neither of which
                          // is obvious from the feature string alone. Add
                          // a small "?" tooltip next to those rows so a
                          // prospective customer knows what they're paying
                          // for. Detection is case-insensitive so a future
                          // copy edit ("AI-svar") still hits the same path.
                          // Detection — match "AI-hjälp" with optional
                          // dash variants, but bounded by word boundaries
                          // so e.g. "AI Svarar" (own word) or future copy
                          // edits can't accidentally double-tooltip.
                          const hasAIResponsvar = /\bai[-‐‑]?\s*hjälp\b/i.test(f)
                          return (
                            <li key={i} className={`flex items-start gap-2 text-sm ${t.popular ? 'text-indigo-50' : 'text-slate-700'}`}>
                              <Check className={`w-4 h-4 mt-0.5 shrink-0 ${t.popular ? 'text-white' : 'text-emerald-500'}`} />
                              <span className="flex flex-wrap items-center gap-1 leading-snug">
                                <span>{f}</span>
                                {hasAIResponsvar && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        aria-label="Förklaring av AI-hjälp i ansökningsformulär"
                                        data-testid="ai-ansvar-tooltip-trigger"
                                        className={`inline-flex items-center justify-center w-4 h-4 rounded-full transition-colors ${
                                          t.popular
                                            ? 'text-white/80 hover:text-white hover:bg-white/10 focus-visible:ring-white/60'
                                            : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-300'
                                        } focus:outline-none focus-visible:ring-2`}
                                      >
                                        <HelpCircle className="w-3.5 h-3.5" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-[280px]">
                                      <p className="text-[11px] leading-snug">
                                        AI skriver svar på okända frågor i ansökningsformulär
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="bg-slate-50 py-24">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-4">Vanliga frågor</Badge>
            <h2 className="text-4xl font-bold">Frågor & svar</h2>
          </div>
          <Accordion type="single" collapsible className="bg-white rounded-xl shadow-sm border border-slate-100 px-6">
            <AccordionItem value="1">
              <AccordionTrigger>Skickar AI:n ansökningar åt mig?</AccordionTrigger>
              <AccordionContent>Nej. AI:n hittar matchande jobb och skriver personliga brev — du granskar och skickar ansökan själv. Du har alltid sista ordet innan det skickas.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="2">
              <AccordionTrigger>Håller breven hög kvalitet?</AccordionTrigger>
              <AccordionContent>Ja. Vår AI skriver personliga brev på svenska, anpassade efter varje tjänst och din bakgrund. Du kan regenerera brevet om du vill ha en ny vinkel innan du skickar.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="3">
              <AccordionTrigger>Uppfyller Aktivitetsrapporten Arbetsförmedlingens krav?</AccordionTrigger>
              <AccordionContent>Ja. Rapporten innehåller datum, arbetsgivare, tjänst, ort och källa för varje ansökan — exakt vad AF begär. Du laddar ner PDF:en och laddar upp den på Mina Sidor.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="4">
              <AccordionTrigger>Kan jag pausa tjänsten när jag är på semester?</AccordionTrigger>
              <AccordionContent>Absolut. Pausa när som helst i Inställningar. Aktivera igen när du vill — utan att förlora din profil.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="5">
              <AccordionTrigger>Är mina personuppgifter säkra?</AccordionTrigger>
              <AccordionContent>Ja. All data krypteras i vila och i transit. Vi följer GDPR fullt ut och du kan när som helst begära att din data raderas.</AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-br from-slate-900 to-indigo-900 py-24">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">Hitta rätt jobb snabbare.<br/>AI:n gör grovjobbet.</h2>
          <p className="text-indigo-200 text-lg mb-8">14 dagar gratis. Ingen bindningstid. Du skickar ansökningarna — AI:n hjälper dig hela vägen.</p>
          <Link href={primaryCta}>
            <Button size="lg" className="bg-white text-slate-900 hover:bg-slate-100 h-12 px-8 text-base">
              {primaryCtaLabel} <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-100 py-8">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <div>© {new Date().getFullYear()} JobbPiloten — Byggd med omtanke för svenska jobbsökare.</div>
          <nav aria-label="Juridiskt" className="flex items-center gap-4">
            <Link href="/privacy" data-testid="footer-privacy" className="hover:text-slate-900 transition-colors">Integritetspolicy</Link>
            <Link href="/terms" data-testid="footer-terms" className="hover:text-slate-900 transition-colors">Användarvillkor</Link>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-slate-900 transition-colors">Kontakt</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
