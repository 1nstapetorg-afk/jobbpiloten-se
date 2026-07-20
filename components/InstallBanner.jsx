'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

/**
 * InstallBanner — shows a dismissable install prompt when the browser fires
 * the `beforeinstallprompt` event (PWA installable).
 *
 * Browser support: Chromium / Edge / Android WebView fire `beforeinstallprompt`
 * when the manifest, service worker and HTTPS pre-conditions are met.
 * Safari/iOS doesn't fire it; instead iOS users must use the share sheet
 * "Add to Home Screen" — we can't programmatically prompt on iOS, so the
 * banner won't appear there (and that's fine).
 *
 * Accessibility:
 *  - role="region" + aria-label so SR users hear a labelled announcement;
 *    we use `region` (not `dialog`) because the prompt is non-modal — the
 *    rest of the page stays interactive. `role="dialog"` would imply
 *    modality per WAI-ARIA and be inconsistent with that.
 *  - Escape key dismisses (matches native dialog convention)
 *  - Visible focus rings on every action button
 *
 * The banner lives at the bottom of the viewport on mobile so it doesn't
 * compete with primary CTAs. Dismissed events store the decision in
 * localStorage so the banner doesn't nag after a "Sen"-click.
 */
const DISMISS_KEY = 'jp-install-banner-dismissed'

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [visible, setVisible] = useState(false)
  const [installed, setInstalled] = useState(false)

  const handleDismiss = useCallback(() => {
    setVisible(false)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DISMISS_KEY, '1')
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(DISMISS_KEY) === '1') return
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true)
      return
    }

    const onBeforeInstall = (e) => {
      // Prevent the browser's default mini-bar; we render our own.
      e.preventDefault()
      setDeferredPrompt(e)
      setVisible(true)
    }

    const onAppInstalled = () => {
      setInstalled(true)
      setVisible(false)
      setDeferredPrompt(null)
    }

    const onKey = (e) => {
      // Escape key dismisses when banner is visible — a11y for keyboard users
      // since the role="dialog" without focus-trap needs an obvious close path.
      if (e.key === 'Escape' && visible) handleDismiss()
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onAppInstalled)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onAppInstalled)
      window.removeEventListener('keydown', onKey)
    }
  }, [visible, handleDismiss])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    try {
      deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice?.outcome === 'accepted') {
        setInstalled(true)
      }
      // Hide either way; the browser remembers once the prompt resolves.
      setVisible(false)
      setDeferredPrompt(null)
    } catch {
      setVisible(false)
      setDeferredPrompt(null)
    }
  }

  if (!visible || installed) return null

  return (
    <div
      data-testid="install-banner"
      role="region"
      aria-label="Installera JobbPiloten som app"
      className="fixed inset-x-3 bottom-3 z-50 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300"
    >
      <div className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 shadow-xl shadow-amber-500/10 backdrop-blur-md p-4">
        <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-amber-200/60 blur-2xl" aria-hidden="true" />
        <button
          type="button"
          aria-label="Stäng"
          onClick={handleDismiss}
          className="absolute right-2 top-2 inline-flex items-center justify-center w-7 h-7 rounded-md text-amber-700/70 hover:text-amber-900 hover:bg-amber-100/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-start gap-3 relative">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center shrink-0 shadow-sm">
            <Download className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 pr-6">
            <div className="text-sm font-semibold text-amber-900">Installera JobbPiloten</div>
            <p className="text-xs text-amber-800/90 mt-0.5 leading-relaxed">
              Lägg till på startskärmen för snabb åtkomst — fungerar offline och skickar push-notiser när nya jobb hittas.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleInstall}
                className="inline-flex items-center justify-center h-8 px-3 rounded-md bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-xs font-semibold shadow-sm shadow-amber-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Installera
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="inline-flex items-center justify-center h-8 px-2 rounded-md text-xs font-medium text-amber-700 hover:text-amber-900 hover:bg-amber-100/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 transition-colors"
              >
                Sen
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
