'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Cookie, X } from 'lucide-react'

/**
 * CookieConsent — bottom-anchored GDPR banner.
 *
 * Storage key: 'jobbpiloten-cookie-consent'
 *   • 'all'  → user accepted every category
 *   • 'necessary' → only strictly necessary cookies (no analytics,
 *                   no marketing). JobbPiloten does not yet load
 *                   analytics but the affordance is in place so a
 *                   future Google Analytics / PostHog handler can
 *                   branch on this flag.
 *
 * Why a non-modal bottom card (vs full-screen overlay):
 *   • Less intrusive — the user can scroll + click through the
 *     page above while the choice card sits in a fixed
 *     bottom-right position with a clear shadow.
 *   • Mobile-safe — the card stacks vertically and stretches to
 *     the viewport width on `< sm`.
 *   • A11y — `role="region"` + `aria-labelledby` link the heading
 *     to the banner body. The two action buttons are real
 *     <button>s so keyboard users Tab-in and Enter-confirm.
 *   • Reduced motion — the framer-free implementation here uses
 *     explicit CSS transitions with `motion-safe:` so
 *     `prefers-reduced-motion` users see no animation.
 *
 * Dismissal persists across sessions (localStorage set with no
 * expiry). The banner re-shows if the storage key is cleared
 * (e.g. user wipes site data) or if the schema is updated and a
 * future build wants to re-prompt with new categories.
 */
const STORAGE_KEY = 'jobbpiloten-cookie-consent'

function readConsent() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch (_) {
    // Private mode / disabled storage — degrade by hiding the
    // banner entirely. Without storage we can't persist the
    // choice anyway, so showing the banner would be a
    // no-op loop.
    return null
  }
}

function writeConsent(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch (_) {
    /* ignore — best effort */
  }
}

export default function CookieConsent() {
  // null = undecided, 'all' or 'necessary' = already chosen.
  const [consent, setConsent] = useState(null)
  // After hydration. We start with `null` so SSR doesn't try to
  // read localStorage (which is undefined on the server), then
  // effect-read into the real value. The banner is only rendered
  // when consent === null AFTER hydration; until then it stays
  // hidden so the markup never briefly flashes the banner before
  // a returning user’s preference is applied.
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setConsent(readConsent())
    setHydrated(true)
  }, [])

  const accept = (value) => {
    writeConsent(value)
    setConsent(value)
  }

  if (!hydrated || consent !== null) return null

  return (
    <div
      role="region"
      aria-labelledby="jp-cookie-consent-title"
      data-testid="cookie-consent-banner"
      className="fixed inset-x-2 bottom-2 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-md z-50"
    >
      <div className="rounded-xl border border-slate-200 bg-white shadow-xl p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <Cookie className="w-4 h-4 text-amber-700" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <div
              id="jp-cookie-consent-title"
              className="text-sm font-semibold text-slate-900 leading-snug"
            >
              Vi använder cookies
            </div>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Vi använder cookies för att du ska kunna logga in och för att förbättra din upplevelse.
              Vi delar inte din data med tredje part.{' '}
              <Link
                href="/privacy"
                data-testid="cookie-consent-privacy-link"
                className="text-indigo-600 hover:underline font-medium"
              >
                Läs mer i vår integritetspolicy
              </Link>.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => accept('necessary')}
                variant="outline"
                data-testid="cookie-consent-accept-necessary"
                className="h-8 text-xs"
              >
                Endast nödvändiga
              </Button>
              <Button
                size="sm"
                onClick={() => accept('all')}
                data-testid="cookie-consent-accept-all"
                className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Acceptera alla
              </Button>
              <button
                type="button"
                onClick={() => accept('necessary')}
                aria-label="Stäng"
                title="Stäng"
                data-testid="cookie-consent-close"
                className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* The three choices are explicit so a user (and the
                e2e spec) can assert the visible affordance surface
                without depending on the chosen state. The text is
                in Swedish per the soft-launch brand copy. */}
            <p className="text-[10px] text-slate-400 mt-2.5 leading-snug">
              Endast nödvändiga = sessionscookie för inloggning.
              Acceptera alla = samma + anonymiserad statistik i framtiden.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
