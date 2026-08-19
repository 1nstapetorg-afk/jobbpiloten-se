/**
 * lib/browser-sessions.js — pure session-state management for the
 * Round-95 in-app browser (mobile extension replacement).
 *
 * No React, no Capacitor, no side effects. The reducer + helpers are
 * imported by lib/browser-store.jsx (the React context) and unit-tested
 * under node --test (tests/unit/browser-sessions.test.mjs). Keeping this
 * module pure means the tab add/remove/switch/dedupe behaviour is locked
 * by tests without needing to spin up a DOM or mock the native plugin.
 *
 * One session = one job-application "tab". The native webview id is
 * stored on the session as `nativeId` (null on the web/iframe fallback)
 * so the store can target the right webview for executeScript / setUrl.
 */

/**
 * A monotonic, collision-resistant id. The counter suffix keeps ids
 * unique within a session even when two sessions are created in the same
 * millisecond; the timestamp keeps them sortable and avoids collisions
 * across reloads.
 */
let sessionCounter = 0

export function createSessionId() {
  sessionCounter += 1
  return `session-${Date.now().toString(36)}-${sessionCounter}`
}

/**
 * Build a session object from a URL + title. `canAutofill` is set by the
 * caller (via `isKnownJobSite`) or the reducer's SET_CAN_AUTOFILL action
 * once a page load confirms the host — it is NOT derived here so this
 * module stays free of the pattern-matching dependency.
 */
export function createSession(url, title) {
  return {
    id: createSessionId(),
    nativeId: null,
    url: url || '',
    title: title || '',
    favicon: null,
    scrollPosition: 0,
    createdAt: new Date().toISOString(),
    canAutofill: false,
  }
}

export const initialBrowserState = Object.freeze({
  sessions: [],
  activeSessionId: null,
  isBrowserOpen: false,
})

/**
 * Reducer for the browser session state. Actions:
 *
 *   OPEN_BROWSER                     — flip the open flag (no session change)
 *   CLOSE_BROWSER                    — tear everything down
 *   ADD_SESSION   { session }        — append (or switch if the URL is
 *                                      already open — dedupe)
 *   REMOVE_SESSION { id }            — drop a tab, re-select a neighbour,
 *                                      close the browser when it was the last
 *   SWITCH_SESSION { id }            — make a tab active
 *   UPDATE_SESSION { id, patch }     — merge a patch (nativeId, url, …)
 *   SET_CAN_AUTOFILL { id, canAutofill } — autofill availability flag
 */
export function browserReducer(state, action) {
  if (!action || typeof action.type !== 'string') return state
  switch (action.type) {
    case 'OPEN_BROWSER':
      return { ...state, isBrowserOpen: true }

    case 'CLOSE_BROWSER':
      return { ...state, isBrowserOpen: false, sessions: [], activeSessionId: null }

    case 'ADD_SESSION': {
      const session = action.session
      if (!session || !session.id) return state
      // De-dupe ONLY real URLs (opening the same application URL again
      // switches to the existing tab). Blank tabs (url === '') may coexist.
      if (session.url) {
        const existing = state.sessions.find((s) => s.url && s.url === session.url)
        if (existing) {
          return { ...state, isBrowserOpen: true, activeSessionId: existing.id }
        }
      }
      return {
        ...state,
        isBrowserOpen: true,
        sessions: [...state.sessions, session],
        activeSessionId: session.id,
      }
    }

    case 'REMOVE_SESSION': {
      const id = action.id
      const idx = state.sessions.findIndex((s) => s.id === id)
      if (idx === -1) return state
      const sessions = state.sessions.filter((s) => s.id !== id)
      if (sessions.length === 0) {
        return { ...state, sessions, activeSessionId: null, isBrowserOpen: false }
      }
      let activeSessionId = state.activeSessionId
      if (activeSessionId === id) {
        // Pick the next-in-line tab, else the previous one.
        const next = sessions[idx] || sessions[idx - 1] || sessions[0]
        activeSessionId = next.id
      }
      return { ...state, sessions, activeSessionId }
    }

    case 'SWITCH_SESSION': {
      const id = action.id
      if (!id || !state.sessions.some((s) => s.id === id)) return state
      return { ...state, activeSessionId: id }
    }

    case 'UPDATE_SESSION': {
      const { id, patch } = action
      if (!id || !patch) return state
      return {
        ...state,
        sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      }
    }

    case 'SET_CAN_AUTOFILL': {
      const { id, canAutofill } = action
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === id ? { ...s, canAutofill: !!canAutofill } : s,
        ),
      }
    }

    default:
      return state
  }
}

/** The currently-active session (or null when the browser is empty). */
export function getActiveSession(state) {
  if (!state || !state.activeSessionId) return null
  return state.sessions.find((s) => s.id === state.activeSessionId) || null
}

/**
 * Short, human-readable label for a tab pill. Prefers the job title
 * (truncated), falls back to "Jobb N" (1-based) so an untitled session
 * still gets a stable, scannable name in the horizontal tab bar.
 */
export function sessionLabel(session, index) {
  if (!session) return ''
  const title = String(session.title || '').trim()
  if (title) return title.length > 22 ? title.slice(0, 21) + '…' : title
  return `Jobb ${(Number.isInteger(index) ? index : 0) + 1}`
}
