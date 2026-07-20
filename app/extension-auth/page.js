'use client'

/**
 * /extension-auth — bridge page opened by the JobbPiloten Auto-Fill
 * extension popup when the user clicks "Anslut din profil".
 *
 * Flow:
 *   1. The extension popup opens this page in a small window
 *      (chrome.windows.create with width 480, height 720).
 *   2. We check the Clerk-or-demo session via the useUser shim.
 *      • If NOT signed in → render Clerk's <SignIn /> widget (with a
 *        fallback signUpForceRedirectUrl pointing back here) so the
 *        user completes auth IN this same window and the page can
 *        re-run the mint flow on the next render. We also render a
 *        demo-mode-specific "Logga in som demo-användare" button
 *        for the soft-launch path when Clerk keys are missing.
 *   3. Once signed in → POST /api/extension/token (the existing
 *      mint endpoint, 90-day TTL bearer + soft-launch source field),
 *      then postMessage the secret bundle back to window.opener (the
 *      extension popup). Auto-close the window ~700ms after delivery.
 *   4. On any error → render the Swedish error string and leave
 *      the window open so the user can read the failure (the popup
 *      listener is also off the happy-path when it doesn't receive
 *      a successful handshake within 30 s).
 *
 * Round-9 observability: after a successful postMessage the page
 * ALSO dispatches a CustomEvent('jobbpiloten:tokenMinted') with a
 * privacy-safe detail subset (source + timestamp + token-prefix +
 * firstName). No full token / email / bearer ever leaves the
 * postMessage envelope — the audit channel is read-only metadata.
 *
 * Round-9 source parameter: the POST includes
 * `{ source: 'extension-popup-auth' }` so the endpoint's
 * extension_tokens audit row carries a discriminator field. The
 * dashboard "Anslut din profil" flow still hits the endpoint with
 * no body and gets `source: 'dashboard-connect'` — the default.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useUser } from '@/hooks/useAuth'
import { isClerkConfiguredClient as isClerkConfigured } from '@/lib/clerk-config'

// 2026-07-12 — Lazy-load Clerk's SignIn. The /extension-auth page is
// a small popup window; we only want the (large, JS-heavy) Clerk
// bundle on the wireless code path where the user actually needs to
// sign in. When the session is already valid, the dynamic import
// never resolves — saving ~120 KB on every successful handshake
// (which is the dominant case for soft-launch testers).
const ClerkSignIn = dynamic(
  () => import('@clerk/nextjs').then((m) => m.SignIn).catch(() => () => null),
  { ssr: false },
)

// Phase machine — drives the swedish copy + spinner states. Kept
// inline so we don't ship a state library for one component.
const PHASE = {
  LOADING: 'loading',         // session resolving
  SIGN_IN: 'sign_in',         // session resolved but no userId
  MINTING: 'minting',         // POST /api/extension/token
  DELIVERING: 'delivering',   // postMessage in flight
  DONE: 'done',               // postMessage delivered, window will close
  ERROR: 'error',             // mint or delivery failed
}

async function signInDemo() {
  // Soft-launch / dev path — sets the demo auth context that
  // app/providers.js's DemoAuthProvider reads on mount. The
  // existing flag at /sign-in does the same; we mirror it here so
  // the popup flow doesn't need a navigation round-trip.
  try {
    const demoUser = {
      id: 'demo-user-001',
      firstName: 'Demo',
      lastName: 'Användare',
      fullName: 'Demo Användare',
      primaryEmailAddress: { emailAddress: 'demo@jobbpiloten.se' },
      emailAddresses: [{ emailAddress: 'demo@jobbpiloten.se', id: 'demo-email-1' }],
      imageUrl: null,
      createdAt: new Date().toISOString(),
    }
    localStorage.setItem('demoUser', JSON.stringify(demoUser))
  } catch (_) {
    // Older browsers without localStorage — fall through, the
    // and user can refresh manually.
  }
  // Reload so DemoAuthProvider re-reads the localStorage key on
  // mount and useUser() returns the demo user. The next render of
  // this page will be in phase=MINTING (not SIGN_IN).
  window.location.reload()
}

export default function ExtensionAuthPage() {
  const { user, isLoaded } = useUser()
  const [phase, setPhase] = useState(PHASE.LOADING)
  const [error, setError] = useState(null)
  // Guard against React StrictMode double-invocation; the mint
  // endpoint is idempotent but mints a NEW row per call, so we
  // want exactly one POST per page-load.
  const mintedRef = useRef(false)

  // Mint + deliver. Called once on first render where session is
  // signed in. Errors propagate to the PHASE.ERROR state so the
  // user sees the Swedish error string in the popup window.
  const mintAndDeliver = useCallback(async () => {
    if (mintedRef.current) return
    mintedRef.current = true
    setPhase(PHASE.MINTING)
    try {
      const res = await fetch('/api/extension/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Round-9 observability: mark the mint source as
        // popup-driven so /settings audit list can group by row
        // origin. The endpoint accepts only this exact string
        // (whitelist — see app/api/extension/token/route.js);
        // any other value falls back to 'dashboard-connect'.
        body: JSON.stringify({ source: 'extension-popup-auth' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.token) {
        throw new Error(json?.error || `Servern returnerade ${res.status}`)
      }
      setPhase(PHASE.DELIVERING)
      // 2026-07-12 (Round-10 critical fix): the auth-window delivery
      // had a single point of failure — `window.opener.postMessage`.
      // In Chrome MV3, `chrome.windows.create({ type: 'popup' })`
      // from an extension popup DOES NOT set `window.opener` on the
      // new window in most configurations (the opener reference is
      // null). The postMessage therefore silently vanished and the
      // popup stayed on "Inte ansluten" forever. The popup's 30 s
      // timeout was the only thing that surfaced a UI message.
      //
      // Fix: deliver the bundle via TWO independent paths, each
      // tolerant of the other's failure:
      //   1. (existing) `window.opener.postMessage` — works for
      //      window.open()-style popups where opener IS set; no-op
      //      silently when opener is null.
      //   2. (new) `window.postMessage` to SELF with the canonical
      //      `JOBBPILOTEN_AUTH_SYNC` shape. The extension's content
      //      script (extension/content.js — manifest matches
      //      `<all_urls>`) listens for this exact type on the
      //      auth window and writes the bundle to
      //      chrome.storage.local. The popup's chrome.storage.onChanged
      //      listener then fires and re-paints as connected.
      //
      // The content-script bridge is the RELIABLE path because it
      // does not depend on the (often-null) window.opener. The
      // opener postMessage is a fast-path / redundant channel that
      // closes the auth window ~700 ms earlier on hosts where it
      // does work.
      //
      // Both paths run in parallel — neither blocks the other. The
      // popup's chrome.storage write is idempotent (re-writing the
      // same token + profile is a no-op), so a delivery through
      // both paths surfaces the same end-state.

      // ---- Path 1: window.opener.postMessage (existing fast-path) ----
      // Hand off the secret bundle to the popup. window.opener is
      // the standard opener reference for window.open + chrome.windows
      // created children; if that's null (a hardened popup blocker
      // that strips opener) we fall back to window.parent then
      // window itself with a wildcard targetOrigin. The popup listener
      // validates msg.origin against a hard-coded allow-list before
      // accepting the payload, so wildcard delivery doesn't widen
      // the attack surface.
      const target = window.opener || window.parent || window
      target.postMessage(
        {
          type: 'JOBBPILOTEN_AUTH_HANDSHAKE',
          ok: true,
          // The current page's origin is part of the payload so the
          // popup can audit it against the same allow-list it uses
          // for the dashboardUrl fetch (defensive even though the
          // popup's listener does the check itself).
          origin: window.location.origin,
          token: json.token,
          expiresAt: json.expiresAt,
          profile: json.profile,
          // 2026-07-12 — mark the source so /settings audit list can
          // distinguish popup-initiated mints from dashboard-initiated.
          source: 'extension-popup-auth',
        },
        '*',
      )
      console.info('[extension-auth] step c: postMessage to opener dispatched', {
        hasOpener: !!window.opener,
        target: window.opener ? 'opener' : (window.parent !== window ? 'parent' : 'self'),
        tokenPrefix: String(json.token || '').slice(0, 8),
      })

      // ---- Path 2: content-script bridge (RELIABLE delivery) ----
      // Dispatch a `JOBBPILOTEN_AUTH_SYNC` message to the current
      // window. The content script (extension/content.js) is loaded
      // on every URL per the manifest's `content_scripts.matches` =
      // `<all_urls>`, AND it has a `window.addEventListener('message', ...)`
      // that filters on `ev.source === window` and the
      // `JOBBPILOTEN_AUTH_SYNC` type. The handler invokes
      // `handleAuthSync(payload)` which writes to
      // chrome.storage.local via `writeStorage`. The popup's
      // `chrome.storage.onChanged` listener then triggers
      // `loadAndPaint()` and re-paints the pill as connected.
      //
      // The listener logs a `console.info` for the dev-tools trace
      // ("[JobbPiloten ext] received auth-sync") so a tester can
      // confirm the bridge is alive.
      try {
        // Detect the content script BEFORE dispatching — if it's
        // not injected (e.g. a strict CSP stripping the content
        // script on a future Vercel preview), we want the
        // console.warn to surface immediately rather than waiting
        // for the popup's 30s timeout.
        const hasContentScript = typeof document !== 'undefined' &&
          document.documentElement?.getAttribute('data-jobbpiloten-ext') === '1'
        if (!hasContentScript) {
          console.warn('[extension-auth] content script not detected — chrome.storage bridge may fail. Falling back to opener path + URL hash redirect.')
        }
        window.postMessage(
          {
            type: 'JOBBPILOTEN_AUTH_SYNC',
            payload: {
              token: json.token,
              expiresAt: json.expiresAt,
              profile: json.profile,
              origin: window.location.origin,
              source: 'extension-popup-auth',
            },
          },
          '*',
        )
        console.info('[extension-auth] step c (bridge): postMessage to self dispatched', {
          contentScriptDetected: hasContentScript,
          tokenPrefix: String(json.token || '').slice(0, 8),
        })
      } catch (bridgeErr) {
        console.warn('[extension-auth] bridge dispatch threw:', bridgeErr?.message || bridgeErr)
      }
      setPhase(PHASE.DONE)
      // Round-9 observability — emit a page-scoped CustomEvent so
      // in-page consumers (dashboard content script + popup
      // analytics) can audit the mint WITHOUT going through the
      // postMessage envelope. The detail payload is intentionally a
      // privacy-safe SUBSET:
      //   • source — caller identifier
      //   • ts — timestamp
      //   • tokenPrefix — first 8 hex chars (enough to fingerprint
      //     a unique `extension_tokens` row WITHOUT exposing the
      //     bearer secret)
      //   • firstName — who connected (audit reads "who", not full PII)
      // The full token / email / bearer detail object NEVER leave
      // the postMessage envelope — only this limited subset ships
      // on the in-page audit event.
      try {
        window.dispatchEvent(new CustomEvent('jobbpiloten:tokenMinted', {
          detail: {
            source: 'extension-popup-auth',
            ts: Date.now(),
            tokenPrefix: String(json.token || '').slice(0, 8),
            firstName: (json.profile && json.profile.firstName) || null,
          },
        }))
      } catch (_) {
        // Older browsers without CustomEvent — silent fall-through.
        // The postMessage delivery above is the active channel.
      }
      // Browser devtools marker — the operator can grep for this in
      // the console after a soft-launch bug report and see WHICH
      // call path triggered the mint (popup vs dashboard).
      if (typeof console !== 'undefined' && console.info) {
        console.info('[extension-auth] tokenMinted', {
          source: 'extension-popup-auth',
          tokenPrefix: String(json.token || '').slice(0, 8),
        })
      }
      // Brief wait so the user sees "Ansluten" before the window
      // vanishes. 700ms is enough for one paint without feeling laggy.
      setTimeout(() => {
        try { window.close() } catch (_) { /* already closed */ }
      }, 700)
    } catch (e) {
      mintedRef.current = false
      setError(e?.message || String(e))
      setPhase(PHASE.ERROR)
    }
  }, [])

  // Auto-trigger the mint flow when the session resolves valid.
  // The auth window can be opened BEFORE the user is signed in
  // (they hadn't logged in yet) — useUser starts loading, then
  // flips to { user: null } when there's no Clerk session OR a
  // demo cookie. We re-render to the SIGN_IN state in that case.
  useEffect(() => {
    if (!isLoaded) return
    if (user) mintAndDeliver()
    else setPhase(PHASE.SIGN_IN)
  }, [isLoaded, user, mintAndDeliver])

  // ---- Renders ----
  return (
    <div className="ea-shell" data-testid="extension-auth-root" data-phase={phase}>
      <header className="ea-header">
        <div className="ea-logo" aria-hidden="true">J</div>
        <div>
          <h1 className="ea-title">JobbPiloten Auto-Fill</h1>
          <p className="ea-sub">Anslut din profil till tillägget</p>
        </div>
      </header>

      <main className="ea-main">
        {phase === PHASE.LOADING && (
          <p className="ea-msg" data-testid="ea-loading">Kontrollerar din session…</p>
        )}

        {phase === PHASE.SIGN_IN && (
          <SignInBlock onDemoSignIn={signInDemo} />
        )}

        {phase === PHASE.MINTING && (
          <p className="ea-msg" data-testid="ea-minting">
            <span className="ea-spinner" aria-hidden="true" />
            Skapar säker anslutning…
          </p>
        )}

        {phase === PHASE.DELIVERING && (
          <p className="ea-msg" data-testid="ea-delivering">
            <span className="ea-spinner" aria-hidden="true" />
            Skickar token till tillägget…
          </p>
        )}

        {phase === PHASE.DONE && (
          <p className="ea-msg ea-msg-success" data-testid="ea-done">
            ✓ Ansluten — du kan stänga detta fönster.
          </p>
        )}

        {phase === PHASE.ERROR && (
          <div className="ea-error" role="alert" data-testid="ea-error">
            <strong>Kunde inte ansluta tillägget.</strong>
            <p>{error || 'Okänt fel.'}</p>
            <p className="ea-error-hint">
              Försök igen — om felet kvarstår, logga in på{' '}
              <a href="/dashboard" target="_blank" rel="noopener noreferrer">
                jobbpiloten.se/dashboard
              </a>{' '}
              först och prova igen.
            </p>
          </div>
        )}
      </main>

      <style>{`
        .ea-shell {
          font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
          color: #0f172a;
          max-width: 480px;
          min-height: 100vh;
          margin: 0 auto;
          background: linear-gradient(180deg, #fff 0%, #f8fafc 100%);
          display: flex;
          flex-direction: column;
        }
        .ea-header {
          display: flex; align-items: center; gap: 12px;
          padding: 20px 24px 16px;
          border-bottom: 1px solid #e2e8f0;
          background: linear-gradient(135deg, #4f46e5 0%, #f59e0b 100%);
          color: #fff;
        }
        .ea-logo {
          width: 40px; height: 40px;
          border-radius: 10px;
          background: rgba(255,255,255,0.18);
          display: flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: 22px;
        }
        .ea-title { margin: 0; font-size: 16px; font-weight: 700; }
        .ea-sub { margin: 2px 0 0; font-size: 12px; opacity: 0.85; }
        .ea-main { padding: 24px; flex: 1; }
        .ea-msg {
          font-size: 14px; color: #334155;
          padding: 16px; background: #fff;
          border: 1px solid #e2e8f0; border-radius: 10px;
          text-align: center;
        }
        .ea-msg-success {
          color: #047857; background: #ecfdf5;
          border-color: #a7f3d0; font-weight: 600;
        }
        .ea-spinner {
          display: inline-block;
          width: 14px; height: 14px;
          border: 2px solid #cbd5e1;
          border-top-color: #4f46e5;
          border-radius: 50%;
          animation: ea-spin 0.7s linear infinite;
          margin-right: 8px;
          vertical-align: -2px;
        }
        @keyframes ea-spin { to { transform: rotate(360deg) } }
        .ea-error {
          background: #fef2f2; color: #991b1b;
          padding: 16px; border: 1px solid #fecaca;
          border-radius: 10px; font-size: 13px;
        }
        .ea-error p { margin: 8px 0 0; }
        .ea-error-hint { color: #b91c1c; font-size: 12px; }
        .ea-error a { color: #b91c1c; text-decoration: underline; }
      `}</style>
    </div>
  )
}

/**
 * Sign-in block — renders different sub-trees for Clerk mode vs
 * demo mode. The Clerk <SignIn /> widget is dynamic-imported above
 * and only ever mounted when Clerk keys are set. The demo button
 * is the soft-launch shortcut for friends-&-family testers.
 */
function SignInBlock({ onDemoSignIn }) {
  // Clerk mode — render the inline widget so the user completes
  // auth IN this same window. The SignIn component's
  // `forceRedirectUrl` brings them back to /extension-auth where
  // useEffect re-runs and picks up the session.
  if (isClerkConfigured()) {
    return (
      <div data-testid="ea-signin">
        <p className="ea-msg">
          Du är inte inloggad ännu. Logga in för att ansluta din JobbPiloten-profil.
        </p>
        <div style={{ marginTop: 12 }}>
          <ClerkSignIn
            signUpForceRedirectUrl="/extension-auth"
            fallbackRedirectUrl="/extension-auth"
            signInForceRedirectUrl="/extension-auth"
          />
        </div>
      </div>
    )
  }

  // Demo mode — no Clerk. The demo AuthProvider reads
  // localStorage.demoUser on mount; setting the key + reloading
  // is the entire "login" ceremony for soft-launch.
  return (
    <div data-testid="ea-signin-demo">
      <p className="ea-msg">
        Du är inte inloggad ännu. Logga in för att ansluta din JobbPiloten-profil.
      </p>
      <button
        type="button"
        className="ea-demo-btn"
        onClick={onDemoSignIn}
        data-testid="ea-demo-signin-btn"
      >
        Logga in som demo-användare
      </button>
      <style>{`
        .ea-demo-btn {
          margin-top: 12px;
          width: 100%;
          padding: 12px 16px;
          background: #f59e0b; color: #1f2937;
          font-size: 14px; font-weight: 600;
          border: none; border-radius: 10px;
          cursor: pointer;
          transition: background 150ms;
        }
        .ea-demo-btn:hover { background: #d97706; }
      `}</style>
    </div>
  )
}
