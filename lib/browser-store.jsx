'use client'

/**
 * lib/browser-store.jsx — React context for the Round-95 in-app browser
 * (mobile Chrome-extension replacement).
 *
 * Wraps the pure reducer in lib/browser-sessions.js and drives the
 * @capgo/capacitor-inappbrowser native plugin through the lazy bridge in
 * lib/mobile-browser-bridge.js. The context is mounted ONCE at the app
 * root (app/providers.js) so session state survives the dashboard →
 * /browser navigation when the user taps "Ansök i appen".
 *
 * Rendering model:
 *   • NATIVE (iOS/Android) — the active session's page is rendered by the
 *     native webview (openWebView with `toBack: true`, no native toolbar);
 *     the /browser screen draws the chrome (address bar / tab bar / FAB)
 *     on top of it with a transparent background.
 *   • WEB (dev / desktop / PWA) — the /browser screen renders an <iframe>
 *     for the active session. Autofill injection is best-effort here
 *     (same-origin only); real autofill is the native path.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { browserReducer, initialBrowserState, createSession, getActiveSession } from '@/lib/browser-sessions'
import { generateAutofillScript } from '@/lib/mobile-autofill'
import { isKnownJobSite } from '@/lib/job-site-patterns'
import { trackPlausible } from '@/lib/analytics'
import {
  isNativePlatform,
  openWebView,
  closeWebView,
  setWebViewUrl,
  executeScript,
  postMessageToWebView,
  reloadWebView,
  addUrlChangeListener,
  addMessageFromWebViewListener,
} from '@/lib/mobile-browser-bridge'

const BrowserContext = createContext(null)

export function useBrowser() {
  const ctx = useContext(BrowserContext)
  if (!ctx) {
    // Fallback so a component rendered outside <BrowserProvider> (tests,
    // storybook) degrades instead of throwing on `ctx.openJobUrl`.
    return {
      state: initialBrowserState,
      sessions: [],
      activeSession: null,
      isNative: false,
      lastAutofill: null,
      openJobUrl: () => null,
      closeBrowser: () => {},
      switchTab: () => {},
      closeTab: () => {},
      addTab: () => null,
      newTab: () => null,
      refreshActive: () => {},
      navigateActive: () => {},
      fillActive: () => {},
      getActiveAutofillScript: () => null,
      refreshNonce: 0,
    }
  }
  return ctx
}

// buildExtensionProfile is a pure function (lib/extension-profile.js) and is
// safe to import statically in a client component. It produces the SAME safe
// profile shape the Chrome extension consumed, so first/last name, split
// street/zip/city and latestCoverLetter all resolve correctly even though
// /api/profile stores only `fullName` + a raw `address`.
import { buildExtensionProfile } from '@/lib/extension-profile'

export function BrowserProvider({ children }) {
  const [state, dispatch] = useReducer(browserReducer, initialBrowserState)
  const [isNative, setIsNative] = useState(false)
  const [lastAutofill, setLastAutofill] = useState(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

  // sessionId → { profile, job, safeProfile } so autofill can re-inject on
  // every navigation without re-fetching the profile.
  const payloadRef = useRef(new Map())
  // The single native webview id currently on screen (active session).
  const webviewIdRef = useRef(null)
  // Latest reducer state, kept in a ref so the once-registered native
  // listeners (below) never read a stale `state` closure.
  const stateRef = useRef(state)
  stateRef.current = state

  // Detect the runtime once. Always false on the server.
  useEffect(() => {
    let cancelled = false
    isNativePlatform().then((n) => { if (!cancelled) setIsNative(n) })
    return () => { cancelled = true }
  }, [])

  // Inject the autofill script into the active native webview. Idempotent:
  // the generated IIFE self-guards with window.__jobbpilotenMobileLoaded,
  // so re-injecting after every navigation/page-load is safe.
  const injectForSession = useCallback(async (session) => {
    if (!session || !session.nativeId) return
    const payload = payloadRef.current.get(session.id)
    const safeProfile = payload?.safeProfile || payload?.profile || {}
    const job = payload?.job || {}
    const code = generateAutofillScript(safeProfile, job)
    await executeScript(session.nativeId, code)
  }, [])

  // Attach native listeners once. `urlChangeEvent` keeps the address bar
  // + autofill flag in sync with in-webview navigation; `messageFromWebview`
  // surfaces the injected script's "autofilled" report.
  useEffect(() => {
    let offUrl = () => {}
    let offMsg = () => {}
    ;(async () => {
      if (!(await isNativePlatform())) return
      offUrl = await addUrlChangeListener((ev) => {
        const url = ev && ev.url
        if (!url) return
        const nativeId = ev && ev.id
        dispatch({
          type: 'UPDATE_SESSION',
          id: (nativeId && getSessionIdByNativeId(stateRef.current, nativeId)) || stateRef.current.activeSessionId,
          patch: { url },
        })
        // Re-check autofill on the new host.
        const active = getActiveSession(stateRef.current)
        if (active && active.nativeId === nativeId) {
          dispatch({ type: 'SET_CAN_AUTOFILL', id: active.id, canAutofill: isKnownJobSite(url) })
        }
      })
      offMsg = await addMessageFromWebViewListener((ev) => {
        const detail = (ev && (ev.detail || ev.rawMessage)) || {}
        let parsed = detail
        if (typeof detail === 'string') { try { parsed = JSON.parse(detail) } catch (_) { parsed = {} } }
        if (parsed && parsed.action === 'autofilled') {
          setLastAutofill({ count: parsed.count || 0, at: Date.now() })
        }
      })
    })()
    return () => {
      offUrl()
      offMsg()
    }
  }, [])

  const openJobUrl = useCallback(async ({ url, title, company, profile, job }) => {
    if (!url) return null
    const session = createSession(url, title)
    session.canAutofill = isKnownJobSite(url)

    let safeProfile = profile || {}
    try {
      safeProfile = buildExtensionProfile(profile || {}, { coverLetter: job?.coverLetter || null })
    } catch (_) {
      safeProfile = profile || {}
    }
    payloadRef.current.set(session.id, { profile: profile || {}, job: job || {}, safeProfile })

    dispatch({ type: 'ADD_SESSION', session })

    // Plausible funnel event — "Ansök i appen" is the app-application signal.
    trackPlausible('job_applied_via_app', { title, company })

    // Open + inject on native (fire-and-forget; never blocks the UI).
    if (await isNativePlatform()) {
      const nativeId = await openWebView(url)
      if (nativeId) {
        webviewIdRef.current = nativeId
        dispatch({ type: 'UPDATE_SESSION', id: session.id, patch: { nativeId } })
        await injectForSession({ ...session, nativeId })
      }
    }
    return session.id
  }, [injectForSession])

  const closeBrowser = useCallback(async () => {
    const id = webviewIdRef.current
    webviewIdRef.current = null
    if (id) await closeWebView(id)
    dispatch({ type: 'CLOSE_BROWSER' })
  }, [])

  const closeTab = useCallback(async (id) => {
    const active = getActiveSession(stateRef.current)
    const isActive = active && active.id === id
    if (isActive && webviewIdRef.current) {
      await closeWebView(webviewIdRef.current)
      webviewIdRef.current = null
    }
    payloadRef.current.delete(id)
    dispatch({ type: 'REMOVE_SESSION', id })

    // Re-open the newly-selected neighbour on native.
    const nextState = browserReducer(stateRef.current, { type: 'REMOVE_SESSION', id })
    const nextActive = getActiveSession(nextState)
    if (nextActive && isActive) {
      const nativeId = await openWebView(nextActive.url)
      if (nativeId) {
        webviewIdRef.current = nativeId
        dispatch({ type: 'UPDATE_SESSION', id: nextActive.id, patch: { nativeId } })
        await injectForSession({ ...nextActive, nativeId })
      }
    }
  }, [injectForSession])

  const switchTab = useCallback(async (id) => {
    const target = stateRef.current.sessions.find((s) => s.id === id)
    if (!target) return
    dispatch({ type: 'SWITCH_SESSION', id })
    if (webviewIdRef.current) {
      await setWebViewUrl(webviewIdRef.current, target.url)
      await injectForSession({ ...target, nativeId: webviewIdRef.current })
    }
  }, [injectForSession])

  const addTab = useCallback(async (url, title) => {
    return openJobUrl({ url, title })
  }, [openJobUrl])

  // "+" in the tab bar — a blank tab the user can type a URL into. No
  // native webview is opened until they navigate; the address bar is
  // focused by the page.
  const newTab = useCallback(() => {
    const session = createSession('', '')
    session.canAutofill = false
    dispatch({ type: 'ADD_SESSION', session })
    return session.id
  }, [])

  const refreshActive = useCallback(async () => {
    if (webviewIdRef.current) {
      await reloadWebView(webviewIdRef.current)
    } else {
      // Web/iframe path: bump the nonce so the page remounts the iframe.
      setRefreshNonce((n) => n + 1)
    }
  }, [])

  const navigateActive = useCallback(async (url) => {
    if (!url) return
    const active = getActiveSession(stateRef.current)
    if (!active) return
    dispatch({ type: 'UPDATE_SESSION', id: active.id, patch: { url } })
    dispatch({ type: 'SET_CAN_AUTOFILL', id: active.id, canAutofill: isKnownJobSite(url) })
    if (webviewIdRef.current) {
      await setWebViewUrl(webviewIdRef.current, url)
      await injectForSession({ ...active, nativeId: webviewIdRef.current })
    }
  }, [injectForSession])

  const fillActive = useCallback(async () => {
    const active = getActiveSession(stateRef.current)
    if (!active || !active.canAutofill) return
    if (webviewIdRef.current) {
      await postMessageToWebView(webviewIdRef.current, { action: 'fill' })
    }
  }, [])

  // Returns the generated autofill script for the active session (or null).
  // Used by the WEB/iframe fallback to inject same-origin content; native
  // injection is handled by injectForSession on open/navigation.
  const getActiveAutofillScript = useCallback(() => {
    const active = getActiveSession(stateRef.current)
    if (!active || !active.canAutofill) return null
    const payload = payloadRef.current.get(active.id)
    const safeProfile = payload?.safeProfile || payload?.profile || {}
    const job = payload?.job || {}
    return generateAutofillScript(safeProfile, job)
  }, [])

  const activeSession = getActiveSession(state)
  const sessions = state.sessions

  const value = useMemo(() => ({
    state,
    sessions,
    activeSession,
    isNative,
    lastAutofill,
    refreshNonce,
    openJobUrl,
    closeBrowser,
    switchTab,
    closeTab,
    addTab,
    newTab,
    refreshActive,
    navigateActive,
    fillActive,
    getActiveAutofillScript,
  }), [
    state, sessions, activeSession, isNative, lastAutofill, refreshNonce,
    openJobUrl, closeBrowser, switchTab, closeTab, addTab, newTab,
    refreshActive, navigateActive, fillActive, getActiveAutofillScript,
  ])

  return <BrowserContext.Provider value={value}>{children}</BrowserContext.Provider>
}

function getSessionIdByNativeId(state, nativeId) {
  const s = state.sessions.find((x) => x.nativeId === nativeId)
  return s ? s.id : state.activeSessionId
}
