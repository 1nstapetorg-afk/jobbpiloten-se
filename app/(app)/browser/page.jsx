'use client'

/**
 * app/(app)/browser/page.jsx — the Round-95 in-app browser screen.
 *
 * The native page content is rendered by the @capgo/capacitor-inappbrowser
 * webview (opened with `toBack: true` by lib/browser-store.jsx); this page
 * only draws the CHROME on top of it:
 *
 *   • Top bar   — editable address bar, refresh, close
 *   • Tab bar   — horizontal scroll of session pills ("Jobb 1", …) + a "+"
 *                 for a blank tab; long-press or ✕ closes a tab
 *   • FAB       — "Fyll i automatiskt" (only on known job sites)
 *
 * On WEB (dev / desktop / PWA) the content falls back to an <iframe> for the
 * active session, and autofill injection is attempted same-origin only.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useBrowser } from '@/lib/browser-store'
import { sessionLabel } from '@/lib/browser-sessions'
import { jobSiteLabel, hostnameOf, normalizeUrl } from '@/lib/job-site-patterns'
import { RefreshCw, X, Plus, Wand2, Globe } from 'lucide-react'

export default function BrowserPage() {
  const router = useRouter()
  const {
    sessions,
    activeSession,
    isNative,
    closeBrowser,
    switchTab,
    closeTab,
    newTab,
    refreshActive,
    navigateActive,
    fillActive,
    getActiveAutofillScript,
    refreshNonce,
  } = useBrowser()

  const [addressInput, setAddressInput] = useState('')
  const [focused, setFocused] = useState(false)
  const iframeRef = useRef(null)
  const longPressTimer = useRef(null)

  // Sync the address bar with the active session.
  useEffect(() => {
    if (!focused) setAddressInput(activeSession?.url || '')
  }, [activeSession?.url, focused])

  // When the last tab closes the browser screen exits back to the dashboard.
  useEffect(() => {
    if (sessions.length === 0) {
      router.replace('/dashboard')
    }
  }, [sessions.length, router])

  // WEB fallback: inject the autofill script into a same-origin iframe once
  // its content is ready. Cross-origin frames are left alone (best-effort).
  useEffect(() => {
    if (isNative || !activeSession?.url || !activeSession.canAutofill) return
    const frame = iframeRef.current
    if (!frame || !frame.contentWindow) return
    const script = getActiveAutofillScript()
    if (!script) return
    try {
      // Accessing contentWindow of a cross-origin frame throws on some
      // properties; wrap the whole injection and swallow.
      frame.contentWindow.eval(script)
    } catch (_) { /* cross-origin — no web autofill */ }
  }, [isNative, activeSession?.url, activeSession?.canAutofill, refreshNonce, getActiveAutofillScript])

  const handleAddressSubmit = (e) => {
    e.preventDefault()
    setFocused(false)
    const url = normalizeUrl(addressInput)
    if (url) navigateActive(url)
  }

  const handleCloseTab = (id) => {
    clearLongPress()
    closeTab(id)
  }

  const handleCloseBrowser = () => {
    closeBrowser()
    router.replace('/dashboard')
  }

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const startLongPress = (id) => {
    clearLongPress()
    longPressTimer.current = setTimeout(() => {
      closeTab(id)
      longPressTimer.current = null
    }, 550)
  }

  const handleFAB = () => {
    if (isNative) {
      fillActive()
      return
    }
    // WEB fallback: trigger the already-injected script's fill() on the
    // active iframe when same-origin, else no-op (native is the real path).
    try {
      const w = iframeRef.current && iframeRef.current.contentWindow
      if (w && typeof w.JobbPilotenMobile?.fill === 'function') {
        w.JobbPilotenMobile.fill()
      }
    } catch (_) { /* cross-origin */ }
  }

  const active = activeSession
  const canAutofill = !!active && active.canAutofill
  const hostLabel = active?.url ? (jobSiteLabel(active.url) || hostnameOf(active.url)) : ''

  return (
    <div className="relative flex h-full w-full flex-col bg-transparent text-slate-900">
      {/* Top bar — address + refresh + close */}
      <div className="flex items-center gap-2 px-2 py-2 border-b border-slate-200/70 bg-white/95 backdrop-blur">
        <button
          type="button"
          onClick={handleCloseBrowser}
          aria-label="Stäng webbläsaren"
          data-testid="browser-close"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
        >
          <X className="h-5 w-5" />
        </button>
        <form onSubmit={handleAddressSubmit} className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-slate-100 px-3 h-9">
          {canAutofill ? (
            <Wand2 className="h-4 w-4 shrink-0 text-indigo-500" aria-hidden="true" />
          ) : (
            <Globe className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          )}
          <input
            type="text"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Ange adress"
            aria-label="Adressfält"
            data-testid="browser-address-input"
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          {hostLabel && <span className="hidden shrink-0 text-[10px] uppercase tracking-wide text-slate-400 sm:inline">{hostLabel}</span>}
        </form>
        <button
          type="button"
          onClick={refreshActive}
          aria-label="Uppdatera"
          data-testid="browser-refresh"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Tab bar — horizontal scroll of session pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-2 border-b border-slate-100 bg-white/80 backdrop-blur no-scrollbar">
        {sessions.map((s, idx) => {
          const isActive = active?.id === s.id
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => switchTab(s.id)}
              onContextMenu={(e) => { e.preventDefault(); handleCloseTab(s.id) }}
              onPointerDown={() => startLongPress(s.id)}
              onPointerUp={clearLongPress}
              onPointerLeave={clearLongPress}
              data-testid={`browser-tab-${idx}`}
              data-active={isActive ? 'true' : 'false'}
              className={`group flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="max-w-[120px] truncate">{sessionLabel(s, idx)}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Stäng ${sessionLabel(s, idx)}`}
                data-testid={`browser-tab-close-${idx}`}
                onClick={(e) => { e.stopPropagation(); handleCloseTab(s.id) }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handleCloseTab(s.id) } }}
                className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={newTab}
          aria-label="Ny flik"
          data-testid="browser-new-tab"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 hover:border-indigo-300 hover:text-indigo-500"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Content layer — native (transparent, webview behind) or iframe (web) */}
      <div className="relative flex-1 bg-transparent">
        {!isNative && active?.url ? (
          <iframe
            key={`${active.id}-${refreshNonce}`}
            ref={iframeRef}
            src={active.url}
            title={sessionLabel(active, sessions.findIndex((s) => s.id === active.id))}
            data-testid="browser-iframe"
            className="h-full w-full border-0 bg-white"
          />
        ) : null}
        {!active?.url && (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Skriv en adress ovan för att börja.
          </div>
        )}
      </div>

      {/* Floating action button — autofill, only on known job sites */}
      {canAutofill && (
        <button
          type="button"
          onClick={handleFAB}
          data-testid="browser-autofill-fab"
          className="absolute bottom-6 right-4 z-10 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all hover:bg-indigo-700 active:scale-95"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <Wand2 className="h-4 w-4" />
          Fyll i automatiskt
        </button>
      )}
    </div>
  )
}
