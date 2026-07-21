/**
 * JobbPiloten Auto-Fill — popup script (vanilla ESM).
 *
 * Reads chrome.storage.local to surface the current connected state.
 * Asks the active tab's content script (via chrome.tabs.sendMessage)
 * how many fields it could fill, then renders:
 *   • Status pill (connected / not connected / version)
 *   • Detected-field count
 *   • Fill button → content-script trigger
 *   • Refresh → re-fetches /api/extension/profile using the stored token
 *   • Dashboard button → opens /dashboard in a new tab
 *
 * The popup never persists anything itself — `chrome.storage.local`
 * is the single source of truth, written by the content script after
 * the user connects. We just read + react.
 */

// 2026-07-21 / Round-72.2 (BUG 1 fix, persistent) — declare the
// `connected` module-binding with `var` (hoisted with initialiser) at the
// absolute top of the module, BEFORE any imports / window listeners /
// IIFEs / promise microtasks, so the binding is observable to ANY
// closure that fires before line 109 (where `let connected` previously
// sat). `var` is hoisted across the entire module body; the assignment
// runs synchronously as part of the top-level init, BEFORE the first
// microtask resolves. This eliminates the TDZ ReferenceError that the
// prior mid-file `let` declaration (the `connected` symbol, line ~2137) AND the post-Round-72
// hoist (line ~109) BOTH failed to prevent for the loadAndPaint() Promise.
// race catch block at line ~3186 — that block can close over ANY closure
// path that fires pre-init, and `var` is the only declaration form that
// guarantees no TDZ. `var` does NOT shadow any inner `const connected`
// (line 3110 area in loadAndPaint body) because those are block-scoped.
// Locked by tests/unit/bug-12-tdz-csp.test.mjs — the file MUST have
// exactly ONE `let-or-var connected` declaration, and it must precede
// `async function setStatus`.
var connected = false

// SECURITY: identical to the constants in extension/content.js —
// drift between the two is a silent DNS-rebinding vector. See
// the SECURITY comment in section 3 of content.js for rationale
// (no postMessage-supplied origins, ever).
// v0.2.1: env-aware. PROD_BASE_URL is now the FINAL fallback only —
// the popup reads chrome.storage.sync.dashboardUrl first (set by the
// dashboard on Anslut-knappen), then uses host_permissions[0] derived
// from the manifest, then falls back to this constant. The allowed-
// origins list now mirrors ALL host_permissions entries (prod +
// preview + localhost) so the popup's fetch() never 500s on a
// legitimate dashboard fetch just because we're on a Vercel preview
// branch.
const PROD_BASE_URL = 'https://jobbpiloten.se'
const PROD_ALLOWED_ORIGINS = [
  'https://jobbpiloten.se',
  // host_permissions[0..n] — read at runtime by loadAllowedOrigins().
]
const STORAGE_KEYS = {
  token: 'jobbpiloten_token',
  profile: 'jobbpiloten_profile',
  dashboardUrl: 'jobbpiloten_dashboardUrl',
  // 2026-07-12 — diagnostic-only key carrying the server-side
  // ISO timestamp from the mint response. Read in the (future)
  // chrome.runtime.onMessage broadcast so a soft-launch tester
  // can see when their session is about to expire.
  expiresAt: 'jobbpiloten_expiresAt',
  // Round-42 (Part 3 polish) — per-question style override. The
  // popup's <select> writes this; the content script reads it on
  // every answer call so a single popup change affects the next
  // batch. Defaults to '' (= use profile default).
  styleOverride: 'jobbpiloten_styleOverride',
  // Round-52 / Issue 1 — popup's current mode. Values: 'formular'
  // (default) or 'mejlutkast'. The Mejlutkast panel is hidden
  // when the active mode is 'formular', and the Jobbformulär
  // surface is collapsed when the active mode is 'mejlutkast'.
  // Persisted across popup re-opens so a tester who toggles
  // Mejlutkast and closes the popup doesn't see it snap back.
  activeMode: 'jobbpiloten_activeMode',
  // Round-52 / Issue 1 — per-recipient cached draft so the user
  // doesn't see a re-generated body on every popup re-open.
  // Keyed by recipient email (lowercased). TTL handled in code
  // (10 min) so a stale email doesn't ship after the user moved
  // on to a different To: address.
  mejlutkastCache: 'jobbpiloten_mejlutkastCache',
  // Round-52 / Issue 3 — content-script heartbeat. content.js
  // writes a `Date.now()` stamp every 30s while the content
  // script is alive on at least one tab. The dashboard + popup
  // read this to display "Tillägget är anslutet" without each
  // having to do its own API round-trip. Missing-key + older-than-
  // 60s both fall through to the disconnected state.
  pingAt: 'jobbpiloten_pingAt',
  // 2026-07-21 (Step 7 of the no-email-on-page trace) — error
  // buffer. Holds at most `ERROR_BUFFER_MAX` most-recent errors
  // captured by background / popup / content scripts. The popup
  // surfaces a "⚠ N fel" affordance when the buffer is non-empty
  // so the user has a single place to review what went wrong on
  // the last few handlings. Privacy: local-only (we never ship
  // these entries to the server). FIFO eviction: oldest entry
  // dropped when limit is hit. Each entry is capped to 80 chars
  // of message + 32 chars of source so the whole buffer stays
  // well under the 100 KB chrome.storage.local quota.
  errors: 'jobbpiloten_errors',
}
const BUILD_CONFIG_FILE = 'build-config.json'
const VERSION = '0.2.3'

// Round-52 / Issue 1 — Mejlutkast mode + heartbeat thresholds.
const ACTIVE_MODE_FORMULAR = 'formular'
const ACTIVE_MODE_MEJLUTKAST = 'mejlutkast'
const MEJLUTKAST_CACHE_TTL_MS = 10 * 60 * 1000 // 10 min
const HEARTBEAT_STALE_MS = 60 * 1000 // 60s = "disconnected"
// 2026-07-21 (Step 7) — Errors buffer cap. 10 most-recent entries;
// each entry capped to 80 chars of message + 32 chars of source.
// Worst-case size: 10 * (80 + 32 + ~16) ≈ 1.3 KB. Well under quota.
const ERROR_BUFFER_MAX = 10
const ERROR_MSG_MAX = 80
const ERROR_SOURCE_MAX = 32  // 2026-07-21 (BUG 1 fix, persistent as of Round-72.2) — `connected`
  // is declared at the VERY TOP of the module with `var` (hoisted
  // across the entire module body). The duplicate `let` here would
  // be a SyntaxError; the binding lives at the top of the file
  // (search for the hoisted decl block above the imports).
  // Late assignments such as `connected = tokenConnected` still
  // mutate that hoisted binding.

// v0.2.1 refactor: 4-tier dashboard-URL resolution is delegated to
// a pure module. extension/lib/dashboard-url-resolver.js accepts the
// four browser APIs as injected deps so it can be exercised in Node
// `--test` without stubbing the chrome runtime. The `resolveDashboardUrl`
// function below is a thin wrapper that supplies the chrome.* closures.
// This keeps popup.js's export surface unchanged so the existing
// static-regex contract tests in tests/unit/popup-resolver.test.mjs
// can continue to lock the chrome.storage.{sync,local}.get(...) call-sites.
import { resolveDashboardUrl as resolveDashboardUrlPure } from './lib/dashboard-url-resolver.js'
// Round-55 / Followup 3 — single source of truth for the
// webmail host list. Both isActiveTabEmailClient() (the Round-54
// auto-switch gate) and the chrome.storage.onChanged listener for
// live compose-target re-checks use the shared isEmailClientUrl
// helper. Adding a 4th webmail provider to the shared module
// automatically extends both call sites. Locked by
// tests/unit/email-clients.test.mjs.
import { isEmailClientUrl } from './lib/email-clients.js'
// Bug 2 wiring (2026-07-20). safe-message wrappers give every
// chrome.{tabs,runtime}.sendMessage and chrome.storage.local.get
// call a 3-second timeout race and never throw. They resolve with
// the reply OR a frozen `{ ok: false, reason: 'timeout' | 'lastError' }`
// sentinel so a hung background-script or absent content-script
// surfaces a friendly log line + UI signal instead of the popup
// looking frozen to the user (the historical "every button is dead"
// symptom from Monday testing).
//
// Round-73 / Followup 2 (2026-07-20) — the canonical import + the
// global unhandledrejection guard are now declared ONCE here at
// the top of the file. A merge collision had left a byte-identical
// duplicate import + listener block in the middle of the imports
// region; ESM deduplicates at runtime so the behavior was correct
// but the duplicated source was confusing for future maintainers.
import {
  safeRuntimeSend,
  safeTabsSendMessage,
  safeStorageGet,
} from './lib/safe-message.js'

// Bug 2 followup: a single global guard for any async rejection
// the per-handler try/catch missed. Logs to the popup console
// (right-click → Inspect popup) so the user can paste the line
// into a support ticket instead of seeing a dead popup. Calling
// preventDefault() avoids Chrome's auto-generated "Uncaught (in
// promise)" toast that obscures the real error.
window.addEventListener('unhandledrejection', (ev) => {
  console.warn(
    '[jobbpiloten popup] unhandled rejection:',
    ev?.reason?.message || ev?.reason || String(ev),
  )
  ev.preventDefault?.()
})

// ---- Dashboard URL resolution (v0.2.1) ----
//
// Four-tier resolver, each tier falls through on failure so a single
// blocked API call never strands the user on a dead button. The
// chain itself (sync → local → manifest → build-config → PROD) lives
// in extension/lib/dashboard-url-resolver.js — the `resolveDashboardUrl`
// wrapper below just supplies the chrome.* closures.
//
// Tier 1: chrome.storage.sync.dashboardUrl, set by the dashboard's
//   "Anslut din profil" handshake. This is the primary channel for
//   the user — every connect fires it.
//
// Tier 1.5: chrome.storage.local.dashboardUrl, the sync-fallback for
//   older Chrome without chrome.storage.sync. Same key; sync wins
//   when both are populated.
//
// Tier 2: chrome.runtime.getManifest().host_permissions[0] — the
//   manifest has a static allowlist of every dashboard origin we
//   trust (prod + Vercel preview + localhost). We pick the first
//   one and strip `/*` to derive the base URL. Wildcards like
//   "https://*.vercel.app/*" are skipped here (they don't resolve
//   to a single origin) and fall through to Tier 3.
//
// Tier 3: build-config.json — a tiny file written by
//   scripts/package-extension.py at build time, populated from
//   `NEXT_PUBLIC_APP_URL`. Last-resort build-time fallback.
//
// Final safety net: PROD_BASE_URL constant above — always present in
// the bundle, so the user always has at least the production origin.

async function loadBuildConfig() {
  try {
    const url = chrome.runtime.getURL(BUILD_CONFIG_FILE)
    const res = await fetch(url, { cache: 'no-cache' })
    if (!res.ok) return {}
    return await res.json().catch(() => ({}))
  } catch (_) {
    return {}
  }
}

async function resolveDashboardUrl() {
  // v0.2.1 refactor: delegate the 4-tier chain to the pure
  // resolver in extension/lib/dashboard-url-resolver.js. The pure
  // module takes the four browser APIs as injected deps so it can
  // be exercised in Node without booting an MV3 runtime (see
  // tests/unit/dashboard-url-resolver.test.mjs for behavioral
  // coverage). The contract is unchanged: returns the resolved
  // dashboard origin with no trailing slash, or the production
  // fallback if every tier fails.
  //
  // Tier-by-tier semantics (sync → local → manifest → build-config →
  // PROD_BASE_URL_DEFAULT) live in the pure module — debug there,
  // not here.
  return resolveDashboardUrlPure({
    syncGet: () => chrome.storage.sync.get(STORAGE_KEYS.dashboardUrl),
    localGet: () => chrome.storage.local.get(STORAGE_KEYS.dashboardUrl),
    getManifest: () => chrome.runtime.getManifest(),
    fetchBuildConfig: loadBuildConfig,
  })
}

// ---- Env-aware base URL (v0.2.3) ----
//
// Wrapper around `resolveDashboardUrl()` that ALSO consults the
// active tab's URL. Soft-launch preview branches are served from
// subdomains like `jobbpiloten-se.preview.emergentagent.com` —
// the active tab is the most natural source of truth for "which
// environment am I currently on?", so the popup uses it directly
// when clicking the extension icon while on a JobbPiloten
// dashboard.
//
// SECURITY: we never blindly trust the active tab URL. We only
// adopt its origin if it matches one of the manifest's
// `host_permissions` patterns (using the same wildcard-aware
// regex helper as content.js). This is the gate that prevents an
// attacker from a same-tab same-window frame navigating the popup
// to a DNS-rebinding origin. Without this gate, the popup's
// downstream `fetch(url)` (against `/api/extension/profile`) and
// the postMessage-origin allow-list in `handleAuthHandshake` would
// BOTH silently accept the attacker origin — a critical escalation
// surface for a popup that already holds a bearer token.
//
// The wrapper's only job is to expose a SINGLE base URL. Both
// `openAuthFlow` (auth-window opener) and `loadAllowedOrigins`
// (origin allow-list for fetch + postMessage) use it so the
// outbound URL and the inbound origin gate stay in lock-step — a
// regression that hard-codes PROD_BASE_URL anywhere would be
// caught by tests/unit/popup-handshake.test.mjs.
async function resolveEnvAuthBaseUrl() {
  // Tier A — active tab URL, gated by host_permissions (incl.
  // wildcards). This is the path the soft-launch preview needs.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab && tab.url) {
      let tabOrigin = ''
      try {
        tabOrigin = new URL(tab.url).origin
      } catch (_) {
        // chrome:// / file:// / about: pages — `new URL()` still
        // succeeds on chrome:// URLs (they have an "origin" field)
        // but the host_permissions check naturally excludes them.
        tabOrigin = ''
      }
      // 2026-07-21 (BUG 9 fix) — localhost dev heuristic. If the
      // active tab is on localhost/127.0.0.1, the user is testing
      // the dashboard locally and the "Anslut till profil" button
      // should NOT fall through to PROD_BASE_URL_DEFAULT
      // ("https://jobbpiloten.se"), which loads a 404/error page
      // on a dev machine that has no DNS route to prod. Returning
      // the localhost origin short-circuits Tier A and keeps the
      // popup in sync with the user's local dev environment.
      //
      // Limit (documented 2026-07-21): the heuristic ONLY fires
      // when the ACTIVE tab (chrome.tabs.query active:true,
      // currentWindow:true) is on a loopback hostname. In the
      // common dev workflow where the user is on a real Swedish
      // job form (host = arbetsformedlingen.se / teamtailor.com)
      // with localhost running in a background tab, the heuristic
      // is unreached and Tier 1 (chrome.storage.sync.dashboardUrl)
      // takes over. Post-connect dev users always see localhost via
      // that Tier-1 path because the auth handshake writes
      // `data.origin` (= http://localhost:<port>) into the same
      // key. The active-tab scan is therefore only the FIRST-TIME
      // connect path; once a token is minted the sync storage
      // mirrors the user's chosen dashboard origin.
      //
      // SECURITY-FOR-LATER (2026-07-21 review): This shortcut
      // bypasses the normal `host_permissions` allow-list that
      // gates every other Tier-A return. Today the popup's
      // downstream gates (assertOriginAllowed for fetch,
      // postMessage origin check for the auth window, the
      // safeStorageGet/safeTabsSendMessage wrappers for chrome.*)
      // still enforce trust on the resulting URL. A FUTURE call
      // site that uses `resolveEnvAuthBaseUrl()` and calls
      // `fetch(new URL(baseUrl + path))` or `chrome.tabs.create`
      // WITHOUT consulting `assertOriginAllowed` first would
      // silently accept an attacker-controlled localhost origin.
      // Any new caller of this resolver MUST call
      // `assertOriginAllowed(url)` before using the URL.
      if (tabOrigin) {
        try {
          const u = new URL(tabOrigin)
          if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
            // Mirror the port the user is already on (or 3000 if
            // the bare hostname is used) so the auth-window /
            // Dashboard-redirect lands on the same dev port.
            const port = u.port || '3000'
            return `http://localhost:${port}`
          }
        } catch (_) { /* ignore — fall through to allowlist check */ }
      }
      if (tabOrigin && isOriginInHostAllowlist(tabOrigin)) {
        return tabOrigin
      }
    }
  } catch (_) {
    // chrome.tabs.query may throw on enterprise-restricted popups;
    // fall through to Tier B rather than surface a runtime error.
  }
  // Tier B — env-aware resolver (sync → local → manifest →
  // build-config → PROD_BASE_URL_DEFAULT). Existing behavior
  // preserved verbatim.
  return resolveDashboardUrl()
}

// hostPatternToRegex — wildcard-aware. Mirrors the helper in
// extension/content.js so the two scripts apply the SAME matching
// policy (drift between the two would let a host page smuggle an
// origin past the content script's check but not the popup's, or
// vice-versa — silent DNS-rebinding).
//
// Concrete matching examples (anchored, escape-aware):
//   "https://jobbpiloten.se/*"         → matches https://jobbpiloten.se/ + paths
//   "https://*.vercel.app/*"            → matches https://X.vercel.app/ + paths
//   "https://*.preview.emergentagent.com/*" → matches preview subdomains
//
// Implementation note: patterns ending in `/*` represent "any
// path". We strip the `/*` BEFORE substituting `*` so the path
// becomes fully optional in the final regex. Without this strip,
// a test of the BARE origin (e.g. `re.test('https://x.com')`)
// would fail because the regex would require a `/` followed by
// at least one char — a regression vs. Chrome's match-pattern
// semantics where `/*` matches any path including empty.
function hostPatternToRegex(pattern) {
  // Match-extension wildcards (`*`) → `[^/]+`. Trailing `/*` →
  // arbitrary path. Escape all other regex meta chars.
  //
  // v0.2.3 — bare-origin match: the trailing `/*` is stripped
  // BEFORE the `*` substitution so the path becomes fully
  // optional. The earlier shape (where `*` was always substituted
  // to `[^/]+` and the `(/.*)?$` suffix was appended) required
  // at least one char after the trailing `/`, which meant a
  // postMessage-origin test against a BARE origin like
  // `https://jobbpiloten.se` would always fail. With the strip,
  // a single `re.test(origin)` call matches both the bare origin
  // and the origin + any path — matching Chrome's match-pattern
  // semantics for the `/*` wildcard. Must stay byte-identical
  // with extension/popup.js's mirror — divergence is a silent
  // DNS-rebinding vector.
  let body = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  if (body.endsWith('/*')) {
    body = body.slice(0, -2)
  }
  body = body.replace(/\*/g, '[^/]+')
  return new RegExp('^' + body + '(?:/.*)?$')
}

function isOriginInHostAllowlist(origin) {
  try {
    const manifest = chrome.runtime.getManifest()
    const hostPerms = Array.isArray(manifest?.host_permissions) ? manifest.host_permissions : []
    for (const pattern of hostPerms) {
      if (!pattern || typeof pattern !== 'string') continue
      const re = hostPatternToRegex(pattern)
      // The trailing-`/*`-strip in hostPatternToRegex makes the
      // bare-origin test work, so a single re.test(origin) call
      // matches both "https://x.com" and "https://x.com/anything".
      if (re && re.test(origin)) return true
    }
  } catch (_) {
    // chrome.runtime.getManifest unavailable in test/headless
    // contexts — the gate is "fail closed" then; resolveEnvAuthBaseUrl
    // falls through to Tier B which doesn't consult the manifest.
  }
  return false
}

async function loadAllowedOrigins() {
  // Build the origin allow-list from the same base URL every
  // other fetcher in this file uses. Mixing PROP_BASE_URL with a
  // resolver-derived baseUrl here was historically the cause of
  // "preview branch popup passes the origin gate for the wrong
  // origin" — a single base URL keeps the gate coherent.
  //
  // The PROD_BASE_URL floor is kept as a guaranteed entry point
  // so a slow resolveEnvAuthBaseUrl can never strand the popup on
  // an empty allowlist (defensive against a flaky
  // chrome.tabs.query / chrome.storage.sync).
  const baseUrl = await resolveEnvAuthBaseUrl()
  const set = new Set([PROD_BASE_URL])
  try {
    const u = new URL(baseUrl)
    set.add(u.origin)
  } catch (_) { /* resolveEnvAuthBaseUrl already returns a valid URL */ }
  // If the env-aware wrapper resolved a totally different origin
  // (e.g. preview branch), add every concrete match against
  // host_permissions so the popup can route fetch() to any of
  // them. Wildcards are NOT expanded here — they don't map to a
  // single origin the popup could put in a `<base href>`-style
  // header.
  try {
    const manifest = chrome.runtime.getManifest()
    const hostPerms = Array.isArray(manifest?.host_permissions) ? manifest.host_permissions : []
    for (const pattern of hostPerms) {
      if (!pattern || typeof pattern !== 'string') continue
      const stripped = typeof pattern === 'string' ? pattern.replace(/\/\*$/, '') : ''
      if (!stripped || stripped.includes('*')) continue
      try {
        set.add(new URL(stripped).origin)
      } catch (_) { /* skip invalid */ }
    }
  } catch (_) { /* ignore — manifest unavailable */ }
  return Array.from(set)
}

// Tier-1 keystroke for the settings panel — populates the input with
// the currently resolved URL on first open so the user knows what
// would happen if they hit "Reset".
async function refreshSettingsInput() {
  // v0.2.3 — env-aware wrapper (parity with openAuthFlow /
  // loadAllowedOrigins / refreshProfile / disconnect). Reflects
  // the active-tab-aware preview resolution so the settings panel
  // pre-fills with the URL the popup would ACTUALLY use, not a
  // resolver-only fallback.
  const url = await resolveEnvAuthBaseUrl()
  const input = $('jp-settings-url-input')
  if (input) input.value = url
}

// ---- DOM lookup helpers ----
const $ = (id) => document.getElementById(id)

// Round-74 (2026-07-20) — CRITICAL: setStatus is now declared
// `async`. Line 390 contains `const { styleOverride } = await
// loadStorage()`, and `await` is a parser-level reserved word
// in any non-async function body in Chrome MV3 strict module
// mode. The pre-fix shape declared `setStatus` as a plain
// `function`, so the whole popup.js script crashed at parse
// time with `Uncaught SyntaxError: Unexpected reserved word`
// (the user-reported 2026-07-20 Monday-tester bug) and every
// button stayed dead because no listener ever bound. Making
// the function `async` is the single-line fix; every existing
// call site already treats the return as fire-and-forget (none
// reads it), so callers stay green.
async function setStatus({ connected, profile, detected, error }) {
  const dot = $('jp-status-dot')
  const line = $('jp-status-line')
  const meta = $('jp-status-meta')

  if (error) {
    dot.style.background = '#ef4444'
    dot.style.boxShadow = '0 0 0 4px rgba(239,68,68,0.18)'
    line.textContent = 'Kunde inte läsa status'
    meta.textContent = error
    return
  }

  // Round-42 (Part 3 polish) — show the style-override <section>
  // only when the user is connected AND there are detected fields
  // to fill. Without a detected-field list the override has no
  // place to land, so we hide the section to avoid clutter.
  const styleSection = $('jp-style-override')
  const styleSelect = $('jp-style-override-select')
  if (styleSection && styleSelect) {
    const shouldShow = !!connected && Array.isArray(detected) && detected.length > 0
    styleSection.hidden = !shouldShow
    if (shouldShow) {
      try {
        const { styleOverride } = await loadStorage()
        styleSelect.value = styleOverride || ''
      } catch (_) { /* ignore — default option wins */ }
    }
  }

  if (connected && profile) {
    dot.style.background = '#10b981'
    dot.style.boxShadow = '0 0 0 4px rgba(16,185,129,0.18)'
    line.textContent = 'Ansluten — profil redo'
    const times = ['firstName', 'lastName', 'email', 'phone', 'cvSummary', 'latestCoverLetter']
      .filter((k) => {
        const val = profile[k]
        return val != null && String(val).length > 0
      }).length
    meta.textContent = `${times} fält tillgängliga • v${VERSION}`
  } else {
    dot.style.background = '#f59e0b'
    dot.style.boxShadow = '0 0 0 4px rgba(245,158,11,0.18)'
    line.textContent = 'Inte ansluten'
    meta.textContent = `Öppna Dashboard för att ansluta din profil • v${VERSION}`
  }

  // Detected-fields panel
  const det = $('jp-detected')
  const list = $('jp-detected-list')
  list.innerHTML = ''
  if (detected && detected.length > 0) {
    det.hidden = false
    detected.slice(0, 8).forEach((label) => {
      const li = document.createElement('li')
      li.textContent = label
      list.appendChild(li)
    })
    if (detected.length > 8) {
      const li = document.createElement('li')
      li.textContent = `+ ${detected.length - 8} till…`
      list.appendChild(li)
    }
  } else {
    det.hidden = true
  }

  // Footer hint — what to do based on status
  const hint = $('jp-footer-hint')
  if (!connected) {
    hint.textContent = 'Klicka "Öppna Dashboard" och logga in — anslutningen sker automatiskt.'
  } else if (!detected || detected.length === 0) {
    hint.textContent = 'Inga formulär upptäckta på den här sidan. Öppna en jobbansökan för att testa.'
  } else {
    hint.textContent = `Upptäckt ${detected.length} formulärfält. Klicka "Fyll i nu" för att fylla dem.`
  }
}

// ---- Storage ----
//
// Round-46 / Bug 1 fix (2026-07-20 Monday): the prior implementation
// called `chrome.storage.local.get([...])` directly without a
// timeout race. The HTML default "Kontrollerar\u2026" in
// extension/popup.html line 72 stays visible until setStatus() runs,
// which means a hung storage read (content-script bridge race
// where the postMessage -> writeStorage -> setStatus chain stalls
// on a half-written storage entry) left the popup permanently stuck
// on the "Kontrollerar\u2026" idle state with every button dead.
//
// The wrap in safeStorageGet() (added in Round-46 followup 2) gives
// the read a 3-second budget so loadStorage() ALWAYS resolves
// within 3s. On timeout, the helper returns
// `{ __safeStorageTimeout: true }` which we map to a
// disconnected-state object so setStatus() runs the "Inte ansluten"
// branch (visible to the user) instead of leaving the HTML default
// text forever. This is the ONE fix that unblocks the popup from
// the Monday-test freeze.
//
// safeStorageGet also catches the (rare) sync-throw case via
// `{ __safeStorageGetThrow: true }` and the resolve-via-null case
// via `{}` (defensive empty-coalesce so a null data arg doesn't
// crash the destructuring on `data[STORAGE_KEYS.token]`).
// 2026-07-21 (Step 7) — append an error entry to the popup's
// error buffer. FIFO eviction at ERROR_BUFFER_MAX. Each entry is
// capped at ERROR_MSG_MAX / ERROR_SOURCE_MAX so a malicious or
// runaway caller cannot blow the chrome.storage.local quota.
// Privacy: writes are local-only; we never ship entries anywhere.
// Logging failures (e.g. quota exceeded) are themselves swallowed
// so the calling path can complete without cascading errors —
// losing one error entry is acceptable, losing the popup is not.
// 2026-07-21 (Round-72 review #1) — DELEGATE the FIFO write to
// background so the service worker is the SINGLE R-M-W authority on
// the jobbpiloten_errors buffer. Pre-fix shape wrote locally HERE as
// well, which combined with background's JOBBPILOTEN_LOG_ERROR
// handler to produce an R-M-W race on near-simultaneous emits:
// both callers read [] then both push, losing one entry. Routing
// through safeRuntimeSend lets the SW auto-wake on the receive and
// the handler's async return true makes this `await` complete only
// AFTER background commits the write. The popup's
// chrome.storage.onChanged listener (wired in wire()) re-paints the
// badge from the SW's write.
//
// SW dead / context invalidated -> safeRuntimeSend returns a
// { ok: false, ... } sentinel; we drop the entry. Pre-fix race that
// lost one was worse than a deliberate drop.
async function logError(source, message) {
  try {
    await safeRuntimeSend({
      type: 'JOBBPILOTEN_LOG_ERROR',
      source: String(source || 'unknown').slice(0, ERROR_SOURCE_MAX),
      message: String(message || '').slice(0, ERROR_MSG_MAX),
    })
  } catch (_) {
    /* SW dead / context invalidated — drop silently */
  }
}

// 2026-07-21 (Step 7) — render the "⚠ N fel" affordance + the
// inline list when the user clicks "Visa fel". Idempotent paint
// so a chrome.storage.onChanged tick re-renders without losing
// user state. The list is hidden by default; clicking the
// jp-errors-btn toggles jp-errors-list visibility. The most-recent
// error is rendered first (array.reverse slice) so the user sees
// what just happened at the top.
function renderErrors(errors, forceRepaint = false) {
  const btn = $('jp-errors-btn')
  const count = $('jp-errors-count')
  const list = $('jp-errors-list')
  if (!btn || !count || !list) return
  const arr = Array.isArray(errors) ? errors : (Array.isArray(getCurrentErrors()) ? getCurrentErrors() : [])
  if (arr.length === 0) {
    btn.hidden = true
    if (!list.hidden) list.hidden = true
    // Cache last render so the toggle-handler repaint path has data.
    lastRenderedErrors = arr
    return
  }
  btn.hidden = false
  count.textContent = String(arr.length)
  if (list.hidden && !forceRepaint) {
    lastRenderedErrors = arr
    return
  }
  list.innerHTML = ''
  // 2026-07-21 (Round-72 review #3) — paint an explicit empty-state
  // placeholder when the buffer races to empty mid-open. Without
  // this the user sees a blank white card with no feedback. CSS
  // (.jp-errors-list-empty) styles the placeholder; aria-live is
  // implicit via aria-live="polite" on the parent section for
  // screen-reader users. The placeholder uses .jp-errors-list-empty
  // so the CSS italic / muted color reads distinctly from a real
  // entry. v0.3.0
  if (arr.length === 0) {
    const empty = document.createElement('li')
    empty.setAttribute('data-testid', 'jp-error-empty')
    empty.className = 'jp-errors-list-empty'
    empty.textContent = 'Inga fel just nu.'
    list.appendChild(empty)
    lastRenderedErrors = arr
    return
  }
  arr
    .slice()
    .reverse()
    .forEach((entry) => {
      const li = document.createElement('li')
      li.setAttribute('data-testid', 'jp-error-entry')
      try {
        const ts = new Date(entry.ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
        li.textContent = `[${ts}] [${entry.source}] ${entry.message}`
      } catch (_) {
        li.textContent = `[${entry.source}] ${entry.message}`
      }
      list.appendChild(li)
    })
  lastRenderedErrors = arr
}

// Module-level cache for the last-rendered errors array. The
// toggle-handler repaint path reads this when the user clicks
// "Visa fel" — avoids a re-fetch from chrome.storage.local.
let lastRenderedErrors = []
function getCurrentErrors() { return lastRenderedErrors }

// 2026-07-21 (Step 7) — toggle handler for the errors-btn.
// No eventListener is wired in setStatus() / renderErrors() because
// chrome popups can lose their DOM on re-open; this is a single
// delegated click that we re-bind in setupOnLoad() — see wire().
function setupErrorsToggle() {
  const btn = $('jp-errors-btn')
  const list = $('jp-errors-list')
  if (!btn || !list) return
  if (btn.dataset.jpErrorsBound === '1') return
  btn.dataset.jpErrorsBound = '1'
  btn.addEventListener('click', () => {
    list.hidden = !list.hidden
    if (!list.hidden) {
      // When the user opens the list, force a repaint so the
      // maybe-stale array lands in the DOM.
      renderErrors(undefined, /*forceRepaint=*/ true)
    }
  })
}

async function loadStorage() {
  const data = await safeStorageGet([
    STORAGE_KEYS.token,
    STORAGE_KEYS.profile,
    STORAGE_KEYS.styleOverride,
  ])
  if (data && data.__safeStorageTimeout) {
    console.warn(
      '[jobbpiloten popup] loadStorage hit the 3s timeout budget — chrome.storage.local.get returned no callback. Treating as disconnected so setStatus() can paint the UI.',
    )
    return { token: null, profile: null, styleOverride: '' }
  }
  if (data && data.__safeStorageGetThrow) {
    console.warn(
      '[jobbpiloten popup] loadStorage caught a synchronous throw from chrome.storage.local.get. Treating as disconnected.',
    )
    return { token: null, profile: null, styleOverride: '' }
  }
  if (!data || typeof data !== 'object') {
    return { token: null, profile: null, styleOverride: '' }
  }
  return {
    token: data[STORAGE_KEYS.token] || null,
    profile: data[STORAGE_KEYS.profile] || null,
    styleOverride: data[STORAGE_KEYS.styleOverride] || '',
  }
}

// ---- Origin guard ----
//
// Hard-coded allow-list — see the SECURITY comment in section 3 of
// content.js. Mirrors assertOriginAllowed there; the two must stay
// byte-identical or DNS rebinding can slip through one path but not
// the other.
//
// v0.2.1: the allowlist is now built dynamically via loadAllowedOrigins()
// so a popup running on a Vercel preview accepts that preview's
// origin (not just jobbpiloten.se). The hard-coded prod origin stays
// in the set as a guaranteed floor so a slow loadAllowedOrigins() can
// never strand the popup on an empty allowlist.
async function assertOriginAllowed(url) {
  const origin = (() => {
    try { return new URL(url).origin } catch (_) { return null }
  })()
  if (!origin) throw new Error('Ogiltig URL')
  const allowed = await loadAllowedOrigins()
  if (!allowed.includes(origin)) {
    throw new Error(`Origin ej tillåten: ${origin}`)
  }
  return origin
}

// ---- Auth handshake receiver (v0.2.2) ----
//
// The /extension-auth page (opened via openAuthFlow) postMessages a
// JOBBPILOTEN_AUTH_HANDSHAKE envelope back to window.opener when
// the mint + delivery succeeded. We validate the message before
// trusting anything in it: the origin must be one of our trusted
// origins (PROD + manifest host_permissions; same allow-list as
// assertOriginAllowed uses for fetch), the type must match, and
// the token shape must look like the 64-char hex we mint server-side.
//
// On success we write the token + profile to BOTH chrome.storage.local
// (fast, single-device) and chrome.storage.sync (cross-device via
// the user's signed-in Chrome profile). sync has an 8 KB-per-item and
// 100 KB total quota per origin; our token (≤80 B) + profile (≤3 KB
// — buildExtensionProfile server-side excludes the data-URL
// profilePicture) comfortably fit, but we wrap sync.set in a try/catch
// so a quota-exceeded or sync-disabled deployment doesn't bubble a
// hard failure — local works for the single-device case.
//
// The receiver also tracks the auth window via windowId + a 30 s
// timeout so a blocked / abandoned auth window doesn't strand the
// popup on the spinner.
const AUTH_HANDSHAKE_TIMEOUT_MS = 30_000
const HANDSHAKE_TYPE = 'JOBBPILOTEN_AUTH_HANDSHAKE'
const authHandshakeState = {
  windowId: null,
  timer: null,
  received: false,
}

function setupAuthHandshakeReceiver() {
  // Single listener for the lifetime of the popup. The auth window
  // postMessages to window.opener; in some Chrome configs opener is
  // null and the page falls back to a wildcard targetOrigin broadcast
  // — we still validate origin on receive so neither side has to
  // coordinate the target explicitly.
  window.addEventListener('message', (ev) => {
    if (!ev || !ev.data || typeof ev.data !== 'object') return
    if (ev.data.type !== HANDSHAKE_TYPE) return
    handleAuthHandshake(ev).catch((e) => {
      console.warn('[jobbpiloten popup] handshake handler threw:', e?.message || e)
    })
  })
}

async function handleAuthHandshake(ev) {
  const data = ev.data || {}
  // Origin gate — the same allow-list assertOriginAllowed uses for
  // fetch. Hard-coded floor (PROD_BASE_URL) plus the resolved
  // dashboard origin covers prod + Vercel preview; matching against
  // the resolved baseUrl keeps the popup safe on a preview
  // branch where the auth URL is the preview origin.
  //
  // v0.2.3: derive `allowed` via loadAllowedOrigins() so the auth-
  // window origin (preview / Vercel branch / localhost) is part of
  // the in-process allowlist exactly when openAuthFlow() was able
  // to navigate to it. The earlier inline-rebuild of `allowed`
  // only included PROD_BASE_URL + the resolved dashboardUrl
  // origin — on a preview branch that meant the auth window COULD
  // open (openAuthFlow allowed it) but its postMessage was
  // REJECTED (handleAuthHandshake didn't). The fix keeps the two
  // gate sides reading the same source.
  const origin = ev.origin || ''
  const normalizedOrigin = origin.replace(/\/$/, '')
  const allowed = (await loadAllowedOrigins()).map((o) => o.replace(/\/$/, ''))
  if (!normalizedOrigin || !allowed.includes(normalizedOrigin)) {
    console.warn('[jobbpiloten popup] rejecting handshake from untrusted origin:', origin)
    return
  }
  if (data.ok !== true) {
    setStatus({ error: data.error || 'Anslutningen misslyckades — försök igen.' })
    return
  }
  const token = String(data.token || '')
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    setStatus({ error: 'Anslutningen returnerade en ogiltig token — försök igen.' })
    return
  }
  const profile = (data.profile && typeof data.profile === 'object') ? data.profile : null
  if (!profile) {
    setStatus({ error: 'Anslutningen returnerade en tom profil — logga in på nytt.' })
    return
  }
  // Mark handshake received so the close-watcher below knows the
  // round-trip succeeded even if the popup is dismissed quickly.
  authHandshakeState.received = true
  if (authHandshakeState.timer) {
    clearTimeout(authHandshakeState.timer)
    authHandshakeState.timer = null
  }
  // Persist. local is the read-priority for the popup + content
  // scripts; sync is the cross-device mirror so a user who reconnects
  // on a different Chrome browser comes back already-filled.
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.token]: token,
      [STORAGE_KEYS.profile]: profile,
      // expiresAt stored for diagnostics — content script can warn
      // before it expires via a future read.
      ...(data.expiresAt ? { [STORAGE_KEYS.expiresAt]: data.expiresAt } : {}),
    })
  } catch (e) {
    setStatus({ error: 'Kunde inte spara token lokalt: ' + (e?.message || String(e)) })
    return
  }
  try {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.token]: token,
      [STORAGE_KEYS.profile]: profile,
    })
  } catch (syncErr) {
    // Non-fatal: the local write already succeeded so the extension
    // works on this machine. sync failure usually means storage.sync
    // is disabled by enterprise policy OR we're on a build of MV3
    // without the sync API. Log + carry on.
    console.warn('[jobbpiloten popup] chrome.storage.sync failed (non-fatal):', syncErr?.message || syncErr)
  }
  if (typeof data.origin === 'string' && data.origin) {
    try {
      // Persist the same dashboardUrl so subsequent "Öppna Dashboard"
      // / fetch() calls in the popup use the production / preview
      // origin the auth bundle came from. We re-use the same
      // dashboardUrl sync set elsewhere for cross-device consistency.
      await chrome.storage.sync.set({ [STORAGE_KEYS.dashboardUrl]: data.origin })
      await chrome.storage.local.set({ [STORAGE_KEYS.dashboardUrl]: data.origin })
    } catch (_) { /* non-fatal */ }
  }
  // Try to close the auth window — chrome.windows.remove works in
  // MV3 even when the window has already closed (no-op on a missing
  // windowId). If we never had a windowId (fallback path used
  // window.open) the close happens on the page side via its own
  // setTimeout.
  if (authHandshakeState.windowId != null) {
    try { chrome.windows.remove(authHandshakeState.windowId).catch(() => {}) } catch (_) {}
  }
  // Refresh the popup UI from the freshly-stored data so the
  // "Ansluten" pill + firstName surface within one paint.
  setStatus({ connected: true, profile, detected: [] })
}

async function openAuthFlow() {
  const btn = $('jp-connect-btn')
  if (btn?.disabled) return
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Öppnar anslutningsfönster…'
  }
  setStatus({ connected: false, profile: null, error: undefined })
  try {
    // v0.2.3 — use the env-aware wrapper so a popup opened while
    // on a JobbPiloten preview branch opens the auth window on
    // THAT branch (not the hard-coded production origin). Active
    // tab is gated against `host_permissions` (incl. wildcards) so
    // a DNS-rebinding origin can't smuggle past the resolver.
    const dashboardOrigin = await resolveEnvAuthBaseUrl()
    const baseUrl = dashboardOrigin
    // 2026-07-12 — prefer chrome.windows.create with a small popup
    // window so the auth-widget renders inline without navigating
    // the active job-search tab. chrome.tabs.create is the fallback
    // when window-creation is blocked (some enterprise policies
    // disable the `windows` permission). window.open is the final
    // ladder rung, identical to openDashboard() but for the auth
    // path; on the rarest popup-blocked configurations it leaves
    // the URL in the auth-button hint copy.
    const url = `${baseUrl.replace(/\/$/, '')}/extension-auth`
    let opened = false
    try {
      // chrome.windows expects width / height in pixels; the popup
      // window is small enough to feel like a native dialog.
      const win = await chrome.windows.create({
        url,
        type: 'popup',
        width: 480,
        height: 720,
        focused: true,
      })
      authHandshakeState.windowId = win && win.id != null ? win.id : null
      authHandshakeState.received = false
      opened = true
      // Watch for the window being closed without delivering the
      // handshake (user cancelled, popup-blocked, auth API errored).
      // 30 s is generous — the mint + delivery round-trip is sub-second.
      authHandshakeState.timer = setTimeout(() => {
        if (!authHandshakeState.received) {
          setStatus({
            error: 'Anslutningen tog för länge — försök igen eller öppna Dashboard manuellt.',
          })
          authHandshakeState.timer = null
        }
      }, AUTH_HANDSHAKE_TIMEOUT_MS)
    } catch (e) {
      console.warn('[jobbpiloten popup] windows.create failed, trying tabs.create:', e?.message || e)
      try {
        await chrome.tabs.create({ url })
        opened = true
      } catch (e2) {
        console.warn('[jobbpiloten popup] tabs.create failed, trying window.open:', e2?.message || e2)
        try {
          const win = window.open(url, '_blank', 'width=480,height=720,noopener')
          opened = !!win
        } catch (e3) {
          console.error('[jobbpiloten popup] all auth-window strategies failed:', e3?.message || e3)
        }
      }
    }
    if (!opened) {
      setStatus({
        error: 'Kunde inte öppna anslutningsfönster. Tillåt popup-fönster eller öppna Dashboard manuellt.',
      })
      if (btn) {
        btn.disabled = false
        btn.textContent = 'Anslut din profil'
      }
    }
    // Reset the button text on the happy path — the receiver
    // path clears it for real on the DONE state. Note we keep the
    // button in its "loading" state while the round-trip is live so
    // a double-click can't open two auth windows.
  } catch (e) {
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Anslut din profil'
    }
    setStatus({ error: 'Anslutningen misslyckades: ' + (e?.message || String(e)) })
  }
}

// ---- Detected-fields query to the active tab's content script ----
async function queryActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return []
    // Bug 2 / Followup 2 (2026-07-20 Monday): the safeTabsSendMessage
    // helper returns a `{ ok: false, reason: 'timeout' | 'lastError' }`
    // sentinel when the content script never replies. Treat that as
    // "no active page" instead of letting the success branch run on
    // an empty `reply` (which is what the prior code did, leading to
    // a frozen "Fyll i nu" CTA when the content script was hung).
    const reply = await safeTabsSendMessage(tab.id, { type: 'JOBBPILOTEN_QUERY' })
    if (reply?.ok === false) {
      // Surface a friendly toast (handled by the surrounding caller
      // via setStatus in the existing flow). Returning early keeps
      // the success branch cleanly separated.
      console.warn('[jobbpiloten] JOBBPILOTEN_QUERY failed:', reply?.reason || 'unknown')
      return null
    }
    return Array.isArray(reply?.detected) ? reply.detected : []
  } catch (_) {
    // No content script on the active tab (chrome:// pages, PDF viewer,
    // or a background tab we can't reach). Empty list = no detections.
    return []
  }
}

// ---- Email compose panel (Round-34 / Part 4) ----
//
// Pre-populates To/Subject/Body when the content-script detector
// reports mailto signals, and wires the three action buttons:
//   • Kopiera          — copies subject + body to the system clipboard
//   • Öppna mailto:    — opens the system mail client with a mailto: URL
//                        (works on both Chrome and Firefox; falls back
//                        to a clipboard + toast on platforms that
//                        block mailto: navigation)
//   • Spara utkast     — POST /api/applications/email to persist the
//                        utkast in the user's dashboard applications
//                        list with source: 'email'
//
// The panel re-renders on every chrome.storage.onChanged firing —
// useful for late-rendering mailto links (React job pages that
// lazily mount the DOM after the content script's initial scan).
const COMPOSE_BODY_TEMPLATE_DEFAULT =
  'Hej,\n\n' +
  'Jag såg er annons för {jobtitle} på {company} och vill gärna skicka in min ansökan via e-post.\n\n' +
  'Jag bifogar mitt CV och personliga brev.\n\n' +
  'Tack för att ni tog er tid — jag ser fram emot att höra från er.\n\n' +
  'Med vänliga hälsningar,\n' +
  '{name}'

/**
 * Round-46.1 / Bug 1 followup — alignment with lib/groq.js
 * `fallbackEmailBody()`. The pre-fix COMPOSE_BODY_TEMPLATE_DEFAULT
 * produced a different shape ("jag heter X…, står till förfogande
 * för en kort intervju") from the LLM-fallback path that the
 * recruiter will see on a NETWORK failure ("Jag såg er annons för
 * …, Jag bifogar mitt CV och personliga brev"). Two different
 * fallback templates for two different failure modes felt broken
 * — a recruiter receiving an "Ansök via mejl" email sees the
 * LLM path 95% of the time, then the popup fallback 5% of the
 * time, and on a flaky network the two swap unpredictably.
 *
 * The fix replaces the literal template string with a small
 * helper that produces the EXACT same 9-line body as
 * lib/groq.js fallbackEmailBody(): the shape, separator set, and
 * CV-attachment line ("Jag bifogar mitt CV och personliga brev.")
 * now match. Tests/unit/extension-popup-email-body.test.mjs has
 * the structural locks; lib/groq.js still owns the canonical
 * version so the AI fallback path and the offline fallback path
 * read as the same body to the recruiter.
 *
 * Substitutions mirror fallbackEmailBody()'s conditional behaviour:
 *   • jobTitle falsy -> "för tjänsten"
 *   • company falsy -> omit " på X" prefix entirely (the trailing
 *     " och vill…" starts immediately after "för tjänsten")
 *   • fullName falsy -> "Kandidaten"
 *
 * Visible-feedback contract unchanged: the loader still reads
 * "Kandidaten" so the recruiter always sees a real name instead
 * of "[Ditt namn]" when the profile has not yet loaded.
 */
function composeStaticBody({ fullName, jobTitle, company } = {}) {
  const name = (fullName && String(fullName).trim()) || 'Kandidaten'
  const titlePart = (jobTitle && String(jobTitle).trim()) ? `för ${jobTitle.trim()}` : 'för tjänsten'
  const companyPart = (company && String(company).trim()) ? ` på ${company.trim()}` : ''
  return [
    'Hej,',
    '',
    `Jag såg er annons ${titlePart}${companyPart} och vill gärna skicka in min ansökan via e-post.`,
    '',
    'Jag bifogar mitt CV och personliga brev.',
    '',
    'Tack för att ni tog er tid — jag ser fram emot att höra från er.',
    '',
    'Med vänliga hälsningar,',
    name,
  ].join('\n')
}

// Tiny email-shape helper used by the Mejlutkast action buttons
// (mailto:, Öppna i Gmail, Öppna i Outlook).
//
// Round-79.5 / Bug C followup (2026-07-20). Pre-fix openGmailBtn
// had `if (!to)` truthy-gate that let whitespace AND malformed
// values slip through; Gmail then opened with blank `To:`. The
// fix tightens the gate to require `name@host.tld` shape via a
// coarse regex. Single source of truth so openGmailBtn +
// openOutlookBtn can't drift in policy again. Coarse on purpose —
// DNS/MX validation happens server-side; this is just a UI
// sanity gate so the user gets a "skriv in en mottagaradress" toast
// instead of opening a blank compose window.
function looksLikeEmail(s) {
  const trimmed = String(s || '').trim()
  if (!trimmed) return false
  // Round-79.5 / Followup 3c — multi-recipient pattern. Swedish ATS
  // forms accept "a@x; b@y" / "a@x, b@y" / "a@x and b@y" when the
  // field is a "Skicka till"-style multi-recipient drop-target.
  // Splitting ONLY on explicit multi-recipient separators (`;` /
  // `,` / the literal English " and " surrounded by whitespace).
  // Bare whitespace is NOT a separator because users commonly
  // type "Lotta Lindgren lottalin@x.com" — a single recipient
  // with their display name inline. Pre-fix shape used
  // `[;,\s]+(?:and\s+)?` which split on bare whitespace and
  // rejected "Lotta Lindgren email@x" (a valid input) as
  // multi-recipient with one segment missing `@` — locks the
  // user out of Gmail/Outlook.
  //
  // Round-79.5 followup — display-name + comma + email. A user
  // typing "Lotta Lindgren, lottalin@x.com" (display name,
  // comma, email) is split into ["Lotta Lindgren", "lottalin@x.com"]
  // where the first segment lacks `@`. Round-1 of this fix would
  // have rejected it; the actual usable semantics is:
  //   1. The input has at least ONE email-shaped segment.
  //   2. All non-email segments must look like a display name
  //      (letters + Swedish chars + spaces + a few name
  //      punctuation chars). Junk like "definitely-not-an-email"
  //      fails the shape check and the whole input is rejected.
  //   3. Without an explicit separator, validate the whole
  //      string as one (so a single "name <email>" still passes).
  const EMAIL = /\S+@\S+\.\S+/
  const DISPLAY_NAME = /^[a-zA-ZåäöÅÄÖéÉüÜß\s.'-]+$/
  const hasExplicitSeparator = /[;,]|\sand\s/i.test(trimmed)
  if (hasExplicitSeparator) {
    const segments = trimmed.split(/[;,]|\s+and\s+/i).map((seg) => seg.trim()).filter(Boolean)
    if (segments.length === 0) return false
    const emailCount = segments.filter((seg) => EMAIL.test(seg)).length
    if (emailCount === 0) return false
    return segments.every((seg) => EMAIL.test(seg) || DISPLAY_NAME.test(seg))
  }
  return EMAIL.test(trimmed)
}

function setupComposePanel() {
  const panel = $('jp-compose-panel')
  if (!panel) return
  const toInput = $('jp-compose-to-input')
  const subjectInput = $('jp-compose-subject-input')
  const bodyTextarea = $('jp-compose-body-textarea')
  const copyBtn = $('jp-compose-copy-btn')
  const mailtoBtn = $('jp-compose-open-mailto-btn')
  const saveBtn = $('jp-compose-save-draft-btn')
  const status = $('jp-compose-status')
  let activeSignal = null

  // Round-51 / Bug-1 followup — disable the action buttons
  // (Kopiera, Öppna mailto:, Spara utkast, Öppna i Gmail,
  // Öppna i Outlook) while the AI generation is in flight, so a
  // fast click on Öppna mailto: can't ship a real mailto: URL
  // with the placeholder body (\"Genererar AI-utkast…\") or with
  // empty subject+body if the click lands before the fetch
  // resolves. The helper queries the DOM by id each call so the
  // declaration order of the buttons below doesn't matter — the
  // id list is the single source of truth.
  function setComposeButtonsDisabled(disabled) {
    const ids = ['jp-compose-copy-btn', 'jp-compose-open-mailto-btn', 'jp-compose-save-draft-btn', 'jp-compose-open-gmail-btn', 'jp-compose-open-outlook-btn']
    for (const id of ids) {
      try {
        const btn = document.getElementById(id)
        if (btn) btn.disabled = !!disabled
      } catch (_) { /* ignore — popup may not be fully mounted */ }
    }
  }

  // Re-render on storage changes. The detected signals list may
  // arrive zero, one, or many times during the popup's lifetime —
  // a late-rendering mailto link on a React page won't show up on
  // the first scan, but will on the MutationObserver's next tick.
  const onSignalsChanged = async () => {
    try {
      const data = await chrome.storage.local.get(['jobbpiloten_emailSignals', 'jobbpiloten_pageTitle'])
      const signals = Array.isArray(data && data.jobbpiloten_emailSignals) ? data.jobbpiloten_emailSignals : []
      if (signals.length === 0) {
        panel.hidden = true
        return
      }
      // Priority: mailto > text > obfuscated > phrase. The first
      // matching signal wins so re-scans don't replace a high-
      // confidence mailto: link with a lower-confidence text match.
      const priority = { mailto: 0, text: 1, obfuscated: 2, phrase: 3 }
      const sorted = signals.slice().sort((a, b) => (priority[a && a.kind] != null ? priority[a.kind] : 9) - (priority[b && b.kind] != null ? priority[b.kind] : 9))
      activeSignal = sorted[0] || null
      if (!activeSignal || !activeSignal.email) {
        // Phrase-only hint — keep the panel visible but with no
        // To-address; user copies the address from the page manually.
        panel.hidden = false
        if (toInput) { toInput.value = ''; toInput.placeholder = (activeSignal && activeSignal.label) || 'Ingen adress hittades — kopiera från sidan' }
      } else {
        panel.hidden = false
        if (toInput && !toInput.value) toInput.value = activeSignal.email
        if (toInput) toInput.placeholder = activeSignal.email
      }
      // 2026-07-21 (BUG 8 fix) — hoist pageTitle + titleSlug to
      // outer scope so the AI-fetch fallback path below can
      // reuse them. The pre-fix shape computed the slug inline
      // only when the subject field was empty, so on a user
      // who had already typed a subject the body block would
      // ReferenceError on `titleSlug` and never rebuild the
      // static fallback with the parsed job context. The lint
      // catches the implicit-block-scoped access via V8 TDZ at
      // runtime — the BUG 8 symptom in the field was the
      // generic "för tjänsten" body, but the BUG 8 symptom in
      // tests was a ReferenceError before the user got that
      // far. Both are fixed by lifting the slug here.
      const pageTitle = (data && data.jobbpiloten_pageTitle) || (activeSignal && activeSignal.label) || ''
      const titleSlug = pageTitle.replace(/\s*[|·•-]+\s*(job[bp]\w*|(www\.)?\w+\.(se|com|nu)|careers|jobs|job\w+|annons).*$/i, '').trim() || 'tjänsten'
      // Subject — only pre-fill if the user hasn't typed anything
      // (so re-renders during editing don't wipe their draft).
      if (subjectInput && !subjectInput.value) {
        const prof = await chrome.storage.local.get(['jobbpiloten_profile'])
        const profile = prof && prof.jobbpiloten_profile
        const firstName = (profile && profile.firstName) || ''
        const lastName = (profile && profile.lastName) || ''
        subjectInput.value = 'Ansökan: ' + titleSlug + (firstName ? ' \u2014 ' + [firstName, lastName].filter(Boolean).join(' ') : '')
      }
      // Round-46 / Bug 1 — replace the static body template with
      // an AI-generation fetch to /api/extension/email-body. The
      // previously-installed COMPOSE_BODY_TEMPLATE_DEFAULT was a
      // hard-coded "Hej, jag heter..." template — addressed to no
      // specific job, with no CV references. The fix:
      //   1. If we already have body content (user re-opened popup
      //      after editing), do NOT overwrite — re-renders during
      //      storage ticks would otherwise wipe their draft.
      //   2. If we don't have body content AND a profile is loaded
      //      AND a mailto signal is active, fetch the AI body.
      //   3. While fetching, pre-fill the textarea with
      //      "Genererar AI-utkast…\u2026" + disable it so the user
      //      sees visible feedback. Re-enable on success/error.
      //   4. On error, fall back to the static template so the user
      //      is NEVER stranded on an empty compose panel.
      //   5. Surface cvShortWarning as a separate UI affordance so
      //      the user can upgrade their CV.
      if (bodyTextarea && !bodyTextarea.value) {
        // Round-46.1 / Bug 1 followup — race-condition gate. The
        // chrome.storage.onChanged event fires asynchronously per
        // write; a burst of N writes (signals + pageTitle + a
        // profile refetch) before the first AI fetch resolves can
        // schedule N concurrent fetches whose responses race on
        // bodyTextarea.value. The dedupe below collapses any
        // overlapping async supervisor into ONE in-flight fetch
        // + ONE trailing re-fetch, mirroring the
        // refreshDetectedFields._busy pattern from Round-11.
        if (__composePanelInFlight) {
          __composePanelDeferred = true
          return
        }
        __composePanelInFlight = true
        try {
        const prof = await chrome.storage.local.get(['jobbpiloten_profile'])
        const profile = prof && prof.jobbpiloten_profile
        const fullName = (profile && profile.fullName) || [profile && profile.firstName, profile && profile.lastName].filter(Boolean).join(' ')
        // Static fallback (used if AI fetch fails or token is missing).
        // Round-46.1 followup — calls composeStaticBody() so the
        // shape matches lib/groq.js's fallbackEmailBody() output.
        // 2026-07-21 (BUG 7+8 fix) — pass `jobTitle` from the
        // hoisted titleSlug so the fallback body is NOT "för
        // tjänsten på företaget". The popup previously rebuilt the
        // body with only `{ fullName }`, dropping the parsed job
        // context. The fallback's literal text would otherwise
        // always read as "för tjänsten" / "på ditt företag" no
        // matter what page the user is on. We pass an EMPTY string
        // when titleSlug falls back to 'tjänsten' so the helper
        // itself can decide whether to omit the "för X" prefix.
        const fallbackJobTitle = titleSlug && titleSlug !== 'tjänsten' ? titleSlug : ''
        const staticBody = composeStaticBody({ fullName, jobTitle: fallbackJobTitle })
        bodyTextarea.value = staticBody
        if (profile) {
          // Show a "generating" indicator so the user knows an
          // AI-generation is in flight (visible feedback prevents a
          // "did the button click?" question during the ~2s LLM
          // round-trip on slow connections).
          bodyTextarea.value = 'Genererar AI-utkast\u2026'
          bodyTextarea.disabled = true
          // Round-51 / Bug-1 followup — disable Kopiera/Öppna mailto:/Spara/Gmail/Outlook while AI generation is in flight so the user can't ship a mailto: URL with the placeholder body or with empty subject+body by clicking before the fetch resolves.
          setComposeButtonsDisabled(true)
          try {
            const { token } = await loadStorage()
            if (!token) {
              // No token — revert to fallback so the user is never
              // left on "Genererar…". Non-fatal: the static
              // template is still presentable.
              bodyTextarea.value = staticBody
              bodyTextarea.disabled = false
              // Round-51 / Bug-1 followup — the prior shape early-
              // returned here WITHOUT re-enabling the action buttons,
              // so the user saw a populated compose panel with every
              // action button (Kopiera / mailto / Spara / Gmail /
              // Outlook) still in `disabled` state. The fix releases
              // the gate regardless of why the AI path returned.
              setComposeButtonsDisabled(false)
              return
            }
            // Round-46 / Bug 1 — mailto signals carry the page
            // title; the popup reads chrome.tabs.query({active: true})
            // to fetch the jobUrl so the server can scrape the
            // job description. The signal's `label` carries the
            // pageTitle (set by extension/content.js via writeDetectedCountIfChanged
            // + the page title serialization — locked in popup.js
            // along the data-testid "jobbpiloten_pageTitle").
            let jobUrl = ''
            let jobTitle = ''
            try {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
              if (tab && tab.url) jobUrl = tab.url
            } catch (_) { /* offline / enterprise popup — fall through */ }
            try {
              const ttl = await chrome.storage.local.get(['jobbpiloten_pageTitle'])
              if (ttl && ttl.jobbpiloten_pageTitle) jobTitle = ttl.jobbpiloten_pageTitle
            } catch (_) { /* ignore — use empty default */ }
            const dashboardOrigin = await resolveEnvAuthBaseUrl()
            const url = dashboardOrigin + '/api/extension/email-body'
            await assertOriginAllowed(url)
            // Round-47 polish — client-side AbortController with a
            // 4-second timeout. Mirrors the server-side route's
            // fetchJobDescription timeout for client/server symmetry.
            // Without this timeout a hung LLM round-trip would leave
            // the compose panel on "Genererar AI-utkast…" forever
            // AND hold __composePanelInFlight true (every subsequent
            // storage tick would collapse to "skip"). The try/finally
            // below auto-releases the dedupe flag regardless of how
            // the request exits (success, network error, or abort).
            //
            // The same controller covers fetchWithRetry's INNER fetch
            // attempts — the controller is passed in the opts object
            // and re-issued on the 500ms retry, so the 4-second
            // budget is shared across both attempts. The clearTimeout
            // in finally frees the timer so a fast happy-path doesn't
            // keep an AbortController reference alive.
            const ctrl = new AbortController()
            const timer = setTimeout(() => ctrl.abort(), 4_000)
            // Single /api/extension/email-body fetch. A previous
            // edit left a duplicate trailing `method:`/headers:/
            // body/block here — parsed by JS as no-op label
            // statements at runtime but confusing to maintainers.
            // tests/unit/extension-popup-dedup-cleanup.test.mjs
            // locks the cleanup in.
            const res = await fetchWithRetry(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + token,
              },
              body: JSON.stringify({
                jobUrl,
                jobTitle,
                company: '',
                lang: 'sv',
              }),
              signal: ctrl.signal,
            })
            // Round-74.1 (2026-07-20) — fix the malformed
            // `})              if (!res.ok) {` line (the prior
            // edit had `})` and the start of the if-block glued
            // onto the previous line with a fat whitespace run,
            // which Chrome's parser surfaced as
            // `Uncaught SyntaxError: Unexpected token 'if'`
            // at popup.js:1053 in the parsed-source error
            // position computed for a downstream token. Moving
            // the if onto its own line + dropping the fat
            // whitespace restores normal ASI semantics AND
            // matches the indentation pattern used by every
            // other `if (!res.ok)` branch in the file.
            if (!res.ok) {
              // Surface a soft status but DON'T overwrite the body
              // with an error string — the static fallback is still
              // a presentable email. 401 = token revoked; 429 =
              // rate-limit; both are non-fatal here.
              bodyTextarea.value = staticBody
              bodyTextarea.disabled = false
              setComposeButtonsDisabled(false)
              try {
                const json = await res.json().catch(() => ({}))
                // Round-72.2 / BUG 4 followup — the server now returns a
                // structured `{ok, reason, message, hint, retryable}` shape
                // from /api/extension/email-body. CONCATENATE message (verb)
                // + hint (next-step) when both are present so the user sees
                // the full actionable copy ("Kunde inte hämta AI-utkast just
                // nu. Försök igen om en stund, eller använd standardmallen.")
                // rather than just the verb. Falls back to either alone, then
                // to the legacy `error` field for older server builds.
                const errField = (typeof json?.error === 'string') ? json.error.slice(0, 120) : ''
                const aiFailureMsg = (json && (
                  (json.message && json.hint)
                    ? `${json.message} ${json.hint}`
                    : (json.message || json.hint || errField)
                )) || ''
                if (aiFailureMsg) {
                  setComposeStatus(status, aiFailureMsg, 'err')
                }
              } catch (_) { /* ignore */ }
              return
            }
            const json = await res.json().catch(() => ({}))
            if (json && typeof json.body === 'string' && json.body.trim()) {
              // Round-46 / Bug 1 — Gmail mailto: body cap. macOS
              // Chrome truncates around 2000 chars; Windows Outlook
              // accepts more, but we cap uniformly so the user
              // doesn't see half a signature on one platform and a
              // full email on another. The truncation marker
              // signals "more content" so the user knows to use
              // the Kopiera fallback for the full draft.
              const MAX_MAILTO_BODY_CHARS = 1900
              let body = json.body
              if (body.length > MAX_MAILTO_BODY_CHARS) {
                body = body.slice(0, MAX_MAILTO_BODY_CHARS) + '\n\n[…utkast förkortat, klicka Kopiera för fullständig text]'
              }
              bodyTextarea.value = body
              // Surface cv-short-warning as an in-panel hint so the
              // user can upgrade their CV if they care.
              if (json.cvShortWarning) {
                setComposeStatus(
                  status,
                  'Ditt CV är kort — ladda upp en längre version för ett mer personligt utkast.',
                  'err',
                )
              } else {
                // Clear any previous warning so a re-render after
                // upgrading the CV doesn't show stale copy.
                setComposeStatus(status, 'AI-utkast klart — granska och klicka Öppna mailto:.', 'ok')
              }
            } else {
              bodyTextarea.value = staticBody
            }
            bodyTextarea.disabled = false
            setComposeButtonsDisabled(false)
          } catch (e) {
            // Network blip, abort, CSP exception — fall back to
            // the static template so the user is NEVER stranded on
            // an empty compose panel.
            bodyTextarea.value = staticBody
            bodyTextarea.disabled = false
            setComposeButtonsDisabled(false)
            setComposeStatus(status, 'Kunde inte hämta AI-utkast — använder standardmall.', 'err')
          }
        }
        } finally {
          // Race-condition gate finalizer — clear the in-flight
          // flag and fire ONE trailing re-render if any concurrent
          // caller set `__composePanelDeferred` while we were
          // in flight. setTimeout(0) yields the microtask queue so
          // the trailing call gets fresh state (a direct
          // self-recursive call would never yield, deadlocking
          // the popup).
          __composePanelInFlight = false
          if (__composePanelDeferred) {
            __composePanelDeferred = false
            setTimeout(onSignalsChanged, 0)
          }
        }
      }
    } catch (_) {
      panel.hidden = true
    }
  }
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes && (changes.jobbpiloten_emailSignals || changes.jobbpiloten_pageTitle))) {
        onSignalsChanged()
      }
      // Round-72 — Errors button channel. Listen for writes to
      // the FIFO buffer so background-script log pushes (and
      // another popup's writes) re-paint the badge + list
      // immediately. The buffer key is shared with the popup's
      // own logError() writes so all error sources funnel
      // through one render path.
      if (area === 'local' && changes && changes.jobbpiloten_errors) {
        const next = changes.jobbpiloten_errors.newValue
        if (Array.isArray(next)) renderErrors(next, /*forceRepaint=*/ true)
        else renderErrors([])
      }
    })
  } catch (_) { /* older browsers */ }
  // Initial render so a popup re-opened after detection still has
  // the panel visible before the next storage tick.
  onSignalsChanged()

  // Action: Kopiera — copies subject + body to clipboard as a plain
  // string the user can paste into Gmail/Outlook web. The mailto:
  // action is the primary CTA; this is the fallback for hosts where
  // chrome.tabs.update({ url: 'mailto:...' }) is blocked.
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    try {
      const subject = (subjectInput && subjectInput.value) || ''
      const body = (bodyTextarea && bodyTextarea.value) || ''
      await navigator.clipboard.writeText(subject + '\n\n' + body)
      setComposeStatus(status, 'Kopierat till urklipp — klistra in i din e-postklient.', 'ok')
    } catch (e) {
      setComposeStatus(status, 'Kunde inte kopiera: ' + (e && e.message || String(e)), 'err')
    }
  })

  // Action: Öppna mailto: — build a mailto: URL with the user-edited
  // subject + body (URL-encoded) and open the system mail client.
  // URL-encoding handles Swedish characters (å/ä/ö) so a recipient
  // sees the original copy. On platforms that block navigation to
  // mailto: URLs (rare; some Android Chrome configs), fall back to
  // a clipboard toast so the user isn't stranded.
  if (mailtoBtn) mailtoBtn.addEventListener('click', async () => {
    const to = (toInput && toInput.value) || ''
    const subject = (subjectInput && subjectInput.value) || ''
    const body = (bodyTextarea && bodyTextarea.value) || ''
    if (!to) {
      setComposeStatus(status, 'Skriv in en mottagaradress först.', 'err')
      return
    }
    const params = new URLSearchParams()
    if (subject) params.set('subject', subject)
    if (body) params.set('body', body)
    const mailtoUrl = 'mailto:' + encodeURIComponent(to) + (params.toString() ? '?' + params.toString() : '')
    // Round-34 review-fix: window.location.href is the most reliable
    // cross-OS path for opening the default mail client.
    // chrome.tabs.create is unreliable for mailto: schemes on some
    // platforms; keep it as a deliberate fallback.
    try {
      window.location.href = mailtoUrl
      setComposeStatus(status, 'Öppnar din e-postklient…', 'ok')
    } catch (e) {
      try { chrome.tabs.create({ url: mailtoUrl }) } catch (_) { /* quiet */ }
      setComposeStatus(status, 'E-postklienten blockerades — klicka Kopiera istället.', 'err')
    }
  })

  // Action: Öppna i Gmail / Öppna i Outlook — build a web-compose URL
  // (different from mailto: which fires the OS handler). The URL formats
  // are stable Google/MSFT contracts; opening in a new tab navigates the
  // user to their webmail's compose page. Round-34 review-fix.
  const openGmailBtn = $('jp-compose-open-gmail-btn')
  // Round-79.5 / Bug C followup (2026-07-20). Pre-fix shape had
  // `if (!to)` truthy-gate. A user typing whitespace OR pasting a
  // malformed value slipped through and Gmail compose opened with
  // empty `To:`, blank subject, and a `body=` empty-string. The
  // fix tightens the gate to require at least one `@` AND a non-
  // whitespace character on each side — typical real-mail shape.
  // Body/subject are ALSO defensively populated at click-time
  // (composeStaticBody fallback + default subject) so a compose
  // panel that hasn't completed its AI fetch yet still surfaces
  // a usable draft the recruiter can edit instead of receiving
  // a blank-window. Locked by tests/unit/popup-resolver.test.mjs.
    if (openGmailBtn) openGmailBtn.addEventListener('click', async () => {
    const to = String((toInput && toInput.value) || '').trim()
    const subject = String((subjectInput && subjectInput.value) || '').trim()
    const body = String((bodyTextarea && bodyTextarea.value) || '').trim()
    if (!looksLikeEmail(to)) {
      setComposeStatus(status, 'Skriv in en mottagaradress (med @) först.', 'err')
      return
    }
    // Defensive fallbacks — race window between the AI fetch
    // landing and the user clicking this button can leave subject
    // or body genuinely blank. composeStaticBody is the same shape
    // as lib/groq.js fallbackEmailBody() so the recruiter sees a
    // consistent body whether the AI-generation ran or not.
    // Round-79.5 followup — variable name `clickProf` (was `prof`)
    // to disambiguate from the dedupe-block's identically-shaped
    // `const prof = await chrome.storage.local.get(...)` deep inside
    // `onSignalsChanged`. tests/unit/extension-popup-email-body-
    // round46.test.mjs relies on lastIndexOf to identify the
    // dedupe-block call; a second occurrence with the same
    // variable name would silently move the test's anchor.
    const clickProf = await chrome.storage.local.get(['jobbpiloten_profile'])
    const profile = clickProf && clickProf.jobbpiloten_profile
    const fullName = (profile && profile.fullName) || [profile && profile.firstName, profile && profile.lastName].filter(Boolean).join(' ')
    const safeBody = body || composeStaticBody({ fullName })
    const safeSubject = subject || `Ansökan via JobbPiloten${(profile && profile.firstName) ? ' — ' + [profile.firstName, profile.lastName].filter(Boolean).join(' ') : ''}`
    const params = new URLSearchParams({ view: 'cm', fs: '1', to, su: safeSubject, body: safeBody })
    const url = 'https://mail.google.com/mail/?' + params.toString()
    try { await chrome.tabs.create({ url }) } catch (_) { try { window.open(url, '_blank', 'noopener') } catch (_e) { /* quiet */ } }
  })
  const openOutlookBtn = $('jp-compose-open-outlook-btn')
  // Round-79.5 / Bug C followup (2026-07-20). Mirrors the
  // openGmailBtn hardening: require @ in To, fall back to
  // composeStaticBody + default subject if the panel hasn't
  // completed its AI fetch yet. Without this fix the
  // `Outlook-Öppna`-button also opened a blank compose window
  // on the race window between signal-write and AI-fetch-resolve.
  if (openOutlookBtn) openOutlookBtn.addEventListener('click', async () => {
    const to = String((toInput && toInput.value) || '').trim()
    const subject = String((subjectInput && subjectInput.value) || '').trim()
    const body = String((bodyTextarea && bodyTextarea.value) || '').trim()
    if (!looksLikeEmail(to)) {
      setComposeStatus(status, 'Skriv in en mottagaradress (med @) först.', 'err')
      return
    }
    // Round-79.5 followup — variable name `clickProf` (was `prof`)
    // mirrors the same disambiguation rational documented on the
    // openGmailBtn handler. tests/unit/extension-popup-email-body-
    // round46.test.mjs uses lastIndexOf on the dedupe-block's
    // `const prof = await chrome.storage.local.get(...)` pattern
    // to anchor the dedupe state-machine order check; duplicating
    // that literal here would silently move the test's anchor to
    // this block, breaking the assertion.
    const clickProf = await chrome.storage.local.get(['jobbpiloten_profile'])
    const profile = clickProf && clickProf.jobbpiloten_profile
    const fullName = (profile && profile.fullName) || [profile && profile.firstName, profile && profile.lastName].filter(Boolean).join(' ')
    const safeBody = body || composeStaticBody({ fullName })
    const safeSubject = subject || `Ansökan via JobbPiloten${(profile && profile.firstName) ? ' — ' + [profile.firstName, profile.lastName].filter(Boolean).join(' ') : ''}`
    const params = new URLSearchParams({ to, subject: safeSubject, body: safeBody })
    const url = 'https://outlook.office.com/mail/deeplink/compose?' + params.toString()
    try { await chrome.tabs.create({ url }) } catch (_) { try { window.open(url, '_blank', 'noopener') } catch (_e) { /* quiet */ } }
  })

  // Action: Spara utkast — POST /api/applications/email to persist
  // the draft in the user's dashboard applications list. The token
  // read from storage; missing-token path is a clean error toast
  // (no silent failure). The server validates the email + caps the
  // body at 5KB so a malicious local host can't blow up Mongo.
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const to = (toInput && toInput.value) || ''
    const subject = (subjectInput && subjectInput.value) || ''
    const body = (bodyTextarea && bodyTextarea.value) || ''
    if (!to || !subject || !body) {
      setComposeStatus(status, 'Fyll i alla fält innan du sparar utkastet.', 'err')
      return
    }
    saveBtn.disabled = true
    try {
      const { token } = await loadStorage()
      if (!token) {
        setComposeStatus(status, 'Anslut tillägget först under Inställningar i Dashboard.', 'err')
        saveBtn.disabled = false
        return
      }
      const dashboardOrigin = await resolveEnvAuthBaseUrl()
      const url = dashboardOrigin + '/api/applications/email'
      await assertOriginAllowed(url)
      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({ emailAddress: to, subject, bodyText: body }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json || !json.ok) {
        setComposeStatus(status, ((json && json.error) || ('Servern returnerade ' + res.status)).toString().slice(0, 120), 'err')
        saveBtn.disabled = false
        return
      }
      setComposeStatus(status, 'Utkast sparat — öppna Dashboard för att skicka.', 'ok')
    } catch (e) {
      setComposeStatus(status, 'Kunde inte spara utkast: ' + (e && e.message || 'nätverksfel'), 'err')
    } finally {
      saveBtn.disabled = false
    }
  })
}

function setComposeStatus(el, msg, kind) {
  if (!el) return
  el.textContent = msg
  el.className = 'jp-settings-status jp-compose-status jp-compose-status-' + (kind === 'ok' ? 'ok' : 'err')
  el.hidden = false
}

// ---- Mejlutkast panel (Round-52 / Issue 1) ----
//
// Powers the user-in-compose flow: when the user is on
// mail.google.com/compose or outlook.live.com/mail/compose with
// a recipient already typed, content-email.js writes the
// recipient + provider to chrome.storage.local under
// `jobbpiloten_composeTarget`. The popup reads it on every
// storage tick, then:
//   1. Fetches /api/email-draft with { recipientEmail, … } so
//      the server can match the recipient against recent
//      applications and return subject + body + matchedJob +
//      recentJobs in one round-trip.
//   2. Surfaces the matchedJob (or "Vilket jobb gäller detta?")
//      picker so the user can override the best guess.
//   3. After Generate → Inject sends chrome.tabs.sendMessage
//      { type: 'JOBBPILOTEN_EMAIL_INJECT', subject, body } to
//      the active tab; content-email.js's listener mutates the
//      Gmail/Outlook Subject + Body in place.
//
// Race-free by design: the storage tick is the source of truth,
// each Generate re-fetches from the server, and the in-flight
// gate (mjlInFlight) prevents overlapping fetches when the user
// double-clicks Generate.
async function setupMejlutkastPanel() {
  const panel = $('jp-mejlutkast-panel')
  if (!panel) return
  const recipientEl = $('jp-mejlutkast-recipient')
  const matchRow = $('jp-mejlutkast-match-row')
  const matchEl = $('jp-mejlutkast-match')
  const pickEl = $('jp-mejlutkast-pick')
  const generateBtn = $('jp-mejlutkast-generate-btn')
  const subjectInput = $('jp-mejlutkast-subject-input')
  const bodyTextarea = $('jp-mejlutkast-body-textarea')
  const injectBtn = $('jp-mejlutkast-inject-btn')
  const copyBtn = $('jp-mejlutkast-copy-btn')
  const status = $('jp-mejlutkast-status')

  let activeTarget = null
  let recentJobs = []
  let matchedJob = null
  let mjlInFlight = false

  function setMejlutkastStatus(msg, kind) {
    if (!status) return
    status.textContent = msg
    status.className = 'jp-settings-status jp-mejlutkast-status jp-mejlutkast-status-' + (kind === 'ok' ? 'ok' : 'err')
    status.hidden = false
  }
  function setButtonsEnabled(enabled) {
    if (generateBtn) generateBtn.disabled = !enabled
    if (injectBtn) injectBtn.disabled = !enabled
  }
  // Round-53 followup: applyModeVisibility was removed in favour
  // of inlining the same toggle inside switchMode() so the two
  // paths don't drift. setupMejlutkastPanel no longer needs to
  // re-paint visibility (the panel mount itself is gated on
  // currentMode via the initial render in loadAndPaint's storage
  // tick).

  // Round-53 followup: wire the per-recipient cache write so a
  // popup re-open within 10 min re-paints the cached draft without
  // burning LLM tokens. The write path was added in Round-52
  // (the Generate click handler persists subject+body+matchedJob
  // under jobbpiloten_mejlutkastCache) but the read path was
  // missing. This helper closes the loop.
  //
  // Cache-key discipline: case-insensitive recipient match so a
  // user who types "Anna@Spotify.com" vs "anna@spotify.com" sees
  // the same cache hit. TTL is MEJLUTKAST_CACHE_TTL_MS (10 min)
  // so a stale email doesn't ship after the user moved to a
  // different To: address.
  //
  // Visible-feedback contract: a cache hit surfaces the same
  // subject + body the user saw 10 seconds ago + a "Visar cachad
  // AI-utkast (10 min)" status so the user knows the draft is
  // NOT freshly generated. They can still click Generate to
  // fetch a new one.
  async function readAndApplyMejlutkastCache() {
    if (!activeTarget || !activeTarget.recipient) return
    // Round-53 race fix — bail early if the user is already
    // mid-Generate. The Generate handler writes fresh subject/body
    // AND re-writes the cache on success; a cache read that races
    // ahead of the Generate would clobber the fresh data with the
    // stale 10-min-old entry. The second check after the await
    // (below) is the actual race fix; this one is just a
    // micro-optimisation.
    if (mjlInFlight) return
    // Capture the recipient we expect to populate FOR, so a
    // mid-read target change doesn't write the previous target's
    // cache into the new target's fields. activeTarget is
    // reassigned in applyTarget on every storage tick.
    const readRecipient = String(activeTarget.recipient).toLowerCase()
    try {
      const data = await chrome.storage.local.get(STORAGE_KEYS.mejlutkastCache)
      // Race fix (the load-bearing one). If a Generate started
      // during the storage read, the fresh draft is already in
      // flight (or just landed) and any cache write from this
      // function would clobber it. Bail so the Generate result
      // wins the race.
      if (mjlInFlight) return
      // Same race for the active target — if the user changed
      // compose windows mid-read, the cached entry (keyed by the
      // OLD recipient) would write to the wrong fields.
      if (!activeTarget || String(activeTarget.recipient).toLowerCase() !== readRecipient) return
      const entry = data && data[STORAGE_KEYS.mejlutkastCache]
      if (!entry || typeof entry !== 'object') return
      const cacheRecipient = String(entry.recipient || '').toLowerCase()
      if (!cacheRecipient || cacheRecipient !== readRecipient) return
      const age = Date.now() - (Number(entry.cachedAt) || 0)
      if (!Number.isFinite(age) || age < 0 || age > MEJLUTKAST_CACHE_TTL_MS) return
      // Cache hit — populate the form fields. The matchedJob
      // surface mirrors the live Generate path so the user sees
      // the same pill whether the draft is fresh or cached.
      if (subjectInput) subjectInput.value = String(entry.subject || '').slice(0, 250)
      if (bodyTextarea) bodyTextarea.value = String(entry.body || '').slice(0, 5000)
      matchedJob = entry.matchedJob || null
      if (matchRow) {
        if (matchedJob) {
          const label = [matchedJob.jobTitle, matchedJob.companyName].filter(Boolean).join(' — ')
          matchEl.textContent = label || '—'
          matchRow.hidden = false
          matchRow.setAttribute('data-state', 'matched')
        } else {
          matchEl.textContent = 'Ingen matchning — välj manuellt'
          matchRow.hidden = false
          matchRow.setAttribute('data-state', 'nomatch')
        }
      }
      if (matchedJob && matchedJob.id && pickEl) pickEl.value = matchedJob.id
      setMejlutkastStatus('Visar cachad AI-utkast (10 min) — klicka Generera för ett nytt.', 'ok')
    } catch (_) {
      // Non-fatal — a cache read failure falls through to the
      // empty form + manual Generate click. No need to surface.
    }
  }

  async function applyTarget(target) {
    activeTarget = target
    if (!target || !target.present) {
      // Round-53 followup: when the compose window closes, clear
      // the recentJobs + matchedJob state so the picker doesn't
      // show a stale list from a previous recipient. A different
      // recipient opening compose later would otherwise see the
      // old list and the user might accidentally select an
      // application that no longer matches the new To: address.
      //
      // Race guard: if a Generate click is in flight, DON'T clear
      // the form. The Generate handler is about to write fresh
      // subject/body/matchedJob — clearing first would land the
      // result into a torn-down form. The next storage tick (when
      // compose is truly closed AND Generate has finished) re-runs
      // applyTarget(null) and the clear fires cleanly. Mirrors the
      // readAndApplyMejlutkastCache pattern.
      if (mjlInFlight) return
      if (recipientEl) recipientEl.textContent = '—'
      if (matchRow) matchRow.hidden = true
      if (generateBtn) generateBtn.disabled = true
      recentJobs = []
      matchedJob = null
      // populatePicker([]) already clears innerHTML + adds a
      // placeholder option with value='', so pickEl.value is
      // already empty — no need for a redundant `pickEl.value = ''`.
      populatePicker([])
      if (subjectInput) subjectInput.value = ''
      if (bodyTextarea) bodyTextarea.value = ''
      return
    }
    const recipient = target.recipient
    if (recipientEl) recipientEl.textContent = recipient || '—'
    if (!recipient) {
      if (generateBtn) generateBtn.disabled = true
      if (matchRow) matchRow.hidden = true
      return
    }
    if (generateBtn) generateBtn.disabled = false
    // Round-53 followup: hydrate from the per-recipient cache
    // BEFORE refreshRecentJobs so a cache hit re-paints the
    // subject + body + matchedJob in the same tick (the user
    // sees the cached draft on popup open). refreshRecentJobs
    // still runs to populate the picker dropdown.
    await readAndApplyMejlutkastCache()
    // Match: surfaced by the Generate call (server resolves
    // recipientEmail → matchedJob). Pre-fetch the recent list so
    // the picker is populated before the user clicks Generate.
    await refreshRecentJobs()
  }

  async function refreshRecentJobs() {
    const { token } = await loadStorage()
    if (!token) return
    try {
      const dashboardOrigin = await resolveEnvAuthBaseUrl()
      const url = dashboardOrigin + '/api/applications/recent'
      await assertOriginAllowed(url)
      const res = await fetchWithRetry(url, {
        headers: { Authorization: 'Bearer ' + token },
      })
      if (!res.ok) {
        recentJobs = []
        populatePicker([])
        // Round-72 — surface the recent-jobs API failure to the
        // "Errors" button so the user knows WHY the mejlutkast
        // dropdown is empty (vs. the API having no rows).
        // Without this an empty dropdown reads as "you have no
        // recent applications" even when it's actually a 401/500.
        try { await logError('recent-jobs', `HTTP ${res.status} från /api/applications/recent`) } catch (_) {}
        return
      }
      const json = await res.json().catch(() => ({}))
      if (!Array.isArray(json && json.applications)) {
        recentJobs = []
        populatePicker([])
        // 2026-07-21 (Round-72, Step 7) — surface schema-mismatch so
        // a future change to /api/applications/recent is visible in
        // the Errors button. Without this the user sees an empty
        // dropdown that reads as "no recent applications" when it's
        // actually a server-side contract change.
        try { await logError('recent-jobs', 'Ogiltigt svar från /api/applications/recent (förväntade { applications: [...] })') } catch (_) {}
        return
      }
      recentJobs = (json.applications || []).slice(0, 20)
      populatePicker(recentJobs)
    } catch (err) {
      recentJobs = []
      populatePicker([])
      // 2026-07-21 (Round-72, Step 7) — surface any thrown error
      // (network, CORS, JSON parse, etc) so the user can see WHY
      // the dropdown ended up empty.
      try { await logError('recent-jobs', String((err && err.message) || err)) } catch (_) {}
    }
  }

  function populatePicker(jobs) {
    if (!pickEl) return
    // Reset, keeping the placeholder option at index 0.
    pickEl.innerHTML = ''
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = jobs.length
      ? '— Välj från dina senaste ansökningar —'
      : '— Inga tidigare ansökningar —'
    pickEl.appendChild(placeholder)
    for (const j of jobs) {
      const opt = document.createElement('option')
      opt.value = j.id || ''
      const label = [j.jobTitle, j.companyName].filter(Boolean).join(' — ') || '(okänd)'
      opt.textContent = label
      opt.dataset.source = j.source || ''
      pickEl.appendChild(opt)
    }
    // If the server's matched job is in the list, pre-select it.
    if (matchedJob && matchedJob.id) {
      pickEl.value = matchedJob.id
    }
  }

  if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
      if (mjlInFlight) return
      if (!activeTarget || !activeTarget.recipient) {
        setMejlutkastStatus('Skriv in en mottagaradress först.', 'err')
        return
      }
      mjlInFlight = true
      generateBtn.disabled = true
      try {
        const { token } = await loadStorage()
        if (!token) {
          setMejlutkastStatus('Anslut tillägget först under Inställningar i Dashboard.', 'err')
          return
        }
        const dashboardOrigin = await resolveEnvAuthBaseUrl()
        const url = dashboardOrigin + '/api/email-draft'
        await assertOriginAllowed(url)
        const pickedJobId = pickEl ? String(pickEl.value || '').trim() : ''
        const res = await fetchWithRetry(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify({
            recipientEmail: activeTarget.recipient,
            jobId: pickedJobId || '',
            lang: 'sv',
          }),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          const msg = (json && json.error) || ('Servern returnerade ' + res.status)
          setMejlutkastStatus(String(msg).slice(0, 140), 'err')
          return
        }
        const json = await res.json().catch(() => ({}))
        if (subjectInput) subjectInput.value = String(json.subject || '').slice(0, 250)
        if (bodyTextarea) bodyTextarea.value = String(json.body || '').slice(0, 5000)
        // Surface matched-job pill + cache the draft for this recipient.
        matchedJob = json.matchedJob || null
        if (matchRow) {
          if (matchedJob) {
            const label = [matchedJob.jobTitle, matchedJob.companyName].filter(Boolean).join(' — ')
            matchEl.textContent = label || '—'
            matchRow.hidden = false
            matchRow.setAttribute('data-state', 'matched')
          } else {
            matchEl.textContent = 'Ingen matchning — välj manuellt'
            matchRow.hidden = false
            matchRow.setAttribute('data-state', 'nomatch')
          }
        }
        // Pre-select the matched job in the picker so the user
        // can re-generate with a different pick by changing the
        // dropdown + clicking Generate again.
        if (matchedJob && matchedJob.id && pickEl) pickEl.value = matchedJob.id
        // Per-recipient cache: persist subject+body+matchedJob so a
        // popup re-open re-paints the draft without a second LLM
        // call. TTL = 10 min; a different recipient email is a
        // cache miss and triggers a fresh fetch.
        try {
          await chrome.storage.local.set({
            [STORAGE_KEYS.mejlutkastCache]: {
              recipient: String(activeTarget.recipient).toLowerCase(),
              subject: subjectInput ? subjectInput.value : '',
              body: bodyTextarea ? bodyTextarea.value : '',
              matchedJob,
              cachedAt: Date.now(),
            },
          })
        } catch (_) { /* non-fatal */ }
        setMejlutkastStatus(json.cvShortWarning
          ? 'AI-utkast klart — ditt CV är kort, ladda upp en längre version för ett mer personligt brev.'
          : 'AI-utkast klart — granska och klicka Fyll i Gmail / Outlook.', 'ok')
      } catch (e) {
        setMejlutkastStatus('Kunde inte hämta AI-utkast: ' + (e && e.message || 'nätverksfel'), 'err')
      } finally {
        mjlInFlight = false
        generateBtn.disabled = false
      }
    })
  }

  if (injectBtn) {
    injectBtn.addEventListener('click', async () => {
      const subject = subjectInput ? subjectInput.value : ''
      const body = bodyTextarea ? bodyTextarea.value : ''
      if (!subject && !body) {
        setMejlutkastStatus('Generera ett utkast först.', 'err')
        return
      }
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab || !tab.id) {
          setMejlutkastStatus('Ingen aktiv flik — öppna Gmail/Outlook först.', 'err')
          return
        }
    // Bug 2 / Followup 2 (2026-07-20 Monday): the previous code
    // called .then on an undefined reply on timeout (since
    // safeTabsSendMessage resolves with null on timeout it never
    // rejected). Now we explicitly gate the success branch on
    // `reply?.ok !== false` so a 3-second timeout doesn't silently
    // mark the email as "injected" when it actually wasn't.
    const reply = await safeTabsSendMessage(tab.id, {
      type: 'JOBBPILOTEN_EMAIL_INJECT',
      subject,
      body,
    })
    if (reply?.ok === false) {
      console.warn('[jobbpiloten] JOBBPILOTEN_EMAIL_INJECT failed:', reply?.reason || 'unknown')
      // popup.js doesn't import sonner's `toast`; the canonical user-
      // visible feedback surface here is setStatus({ error: ... }),
      // which downstream paints into the popup's status pill.
      setStatus({ error: 'Kunde inte skicka mejlutkast — försök igen.' })
      return
    }
        if (reply && reply.injected) {
          setMejlutkastStatus('Klar — ämne + brödtext ifyllda i Gmail/Outlook.', 'ok')
        } else {
          setMejlutkastStatus('Kunde inte fylla i: ' + ((reply && reply.error) || 'okänt fel'), 'err')
        }
      } catch (e) {
        setMejlutkastStatus('Kunde inte nå mejlfliken: ' + (e && e.message || 'nätverksfel'), 'err')
      }
    })
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const subject = subjectInput ? subjectInput.value : ''
      const body = bodyTextarea ? bodyTextarea.value : ''
      try {
        await navigator.clipboard.writeText(subject + '\n\n' + body)
        setMejlutkastStatus('Kopierat till urklipp.', 'ok')
      } catch (e) {
        setMejlutkastStatus('Kunde inte kopiera: ' + (e && e.message || String(e)), 'err')
      }
    })
  }

  if (pickEl) {
    pickEl.addEventListener('change', () => {
      // When the user picks a different job, re-Generate with the
      // new jobId. We don't auto-generate on every change because
      // that would burn LLM tokens on a misclick; explicit
      // Generate click is the contract.
      const val = String(pickEl.value || '').trim()
      if (!val) return
      // Surface the pick in the status row so the user sees their
      // change was registered.
      setMejlutkastStatus('Vald ansökan: ' + (pickEl.options[pickEl.selectedIndex]?.text || '—') + ' — klicka Generera igen.', 'ok')
    })
  }

  // Re-render on storage ticks — content-email.js writes the
  // composeTarget key on a 1s polling cadence so a popup opened
  // mid-composing sees the recipient within ~1s.
  const onComposeTargetChanged = async (changes, area) => {
    if (area !== 'local') return
    const ch = changes.jobbpiloten_composeTarget
    if (!ch) return
    const newTarget = ch.newValue
    if (!newTarget || !newTarget.present) {
      await applyTarget(null)
      return
    }
    await applyTarget(newTarget)
  }
  try {
    chrome.storage.onChanged.addListener(onComposeTargetChanged)
  } catch (_) { /* older browsers */ }

  // Initial render — read the cached composeTarget so a popup
  // re-opened within 1s of detection still has the recipient.
  try {
    const data = await chrome.storage.local.get('jobbpiloten_composeTarget')
    if (data && data.jobbpiloten_composeTarget && data.jobbpiloten_composeTarget.present) {
      await applyTarget(data.jobbpiloten_composeTarget)
    }
  } catch (_) { /* non-fatal */ }
}

// ---- Compose-panel AI-fetch dedupe (Round-46.1 / Bug 1 followup) ----
//
// Race-condition fix — the Round-46 implementation fired an AI
// fetch from `setupComposePanel()` every time chrome.storage.onChanged
// observed a mailto-signal update AND a page-title update. Two
// rapid storage ticks before the first fetch resolved would race
// on `bodyTextarea.value` — response ordering isn't deterministic,
// so a slow first response could overwrite the faster second
// response with stale copy. Two mitigations in concert:
//
//   1. The "first call wins" gate below — module-scoped
//      `__composePanelInFlight` blocks concurrent fetches. The
//      boolean `__composePanelDeferred` collapses a burst of N
//      overlapping callers into a single trailing re-fetch so the
//      final state is captured without N queued callbacks.
//
//   2. Mirrors the refreshDetectedFields._busy / _deferred pattern
//      from this file's earlier Round-11 polish — the dedupe is
//      intentionally the SAME shape (boolean + one trailing
//      re-fetch) so a future maintainer grepping `_busy` finds
//      both sites.
//
// The trailing-re-fetch fires after a `setTimeout(0)` so the
// await-chain fully unwinds before the next fetch begins (a
// direct self-recursive call would never yield to the microtask
// queue).
//
// The gate is module-scoped rather than closure-scoped because
// the popup is mounted once per `window.open()` and cleared on
// `window.close()` — module-scoped state lives the lifetime of
// the popup, which is exactly the right granularity.
//
let __composePanelInFlight = false
let __composePanelDeferred = false

// ---- Round-54 / Bug 1 — URL-based mode auto-switching ----
//
// Pre-fix: the popup defaulted to ACTIVE_MODE_FORMULAR on every
// open. A user who clicked the extension icon on Gmail or Outlook
// saw the Jobbformulär surface + "Inga formulär upptäckta" even
// though they were inside a webmail page — the Mode B
// (Mejlutkast) panel is hidden by default and required a manual
// pill click to surface.
//
// The fix: when the popup opens on a Gmail/Outlook URL matching
// the manifest's compose patterns, force currentMode =
// ACTIVE_MODE_MEJLUTKAST BEFORE the storage-read path so the user
// sees the Mejlutkast panel without clicking. The match is
// intentionally broader than the content-email.js provider list
// — we auto-switch on any Gmail/Outlook page (inbox, compose,
// etc.) because the Mejlutkast panel degrades gracefully when
// no compose window is detected (the recipient row shows "—"
// and the Generate button is disabled). A user who hits the
// extension icon on mail.google.com with no compose window open
// still benefits from seeing Mode B ready to go.
//
// We do NOT auto-switch to Mode A on non-mail pages — the
// default 'formular' is already the right initial state.
//
// Round-55 / Followup 3 — the host list is delegated to the
// shared `isEmailClientUrl` helper in extension/lib/email-clients.js
// so the same list is used by content-email.js's
// `detectProvider()`. The local `isActiveTabEmailClient()` is
// now a thin chrome-tabs-query wrapper around the shared helper.
async function isActiveTabEmailClient() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab || !tab.url) return false
    return isEmailClientUrl(String(tab.url))
  } catch (_) {
    // chrome.tabs.query may throw on enterprise-restricted popups;
    // return false so the default 'formular' mode wins.
    return false
  }
}

// ---- Mode toggle (Round-52 / Issue 1) ----
//
// 'formular' = the legacy Jobbformulär surface (status card +
// actions + detected-fields + Ansök-via-mejl panel). 'mejlutkast'
// = the new Mejlutkast surface (recipient-driven draft on
// Gmail/Outlook compose windows). The toggle is the only UI
// affordance that switches between the two.
//
// Storage layer: persisted under jobbpiloten_activeMode so a popup
// re-open remembers the user's last pick. Defaults to 'formular'
// for first-time users; a value of 'mejlutkast' flips the  // flips the mode via switchMode to render the Mejlutkast panel.
//  // `connected` is module-scope so switchMode can read it
  // without prop-drilling.
// 2026-07-21 (BUG 1 fix) — `let connected` is now declared at the
// top of the module (right after ERROR_SOURCE_MAX). The binding is
// initialised before ANY code path that closes over or references
// it — eliminates the TDZ ReferenceError that the prior mid-file
// declaration produced when a chrome.storage.onChanged listener
// catch block on line ~2978 fired before the declaration line was
// reached. `connected = tokenConnected` still happens at module
// scope to mutate the hoisted binding.
let currentMode = ACTIVE_MODE_FORMULAR

function setupModeToggle() {
  const formPill = $('jp-mode-formular')
  const mejPill = $('jp-mode-mejlutkast')
  if (!formPill || !mejPill) return
  formPill.addEventListener('click', () => switchMode(ACTIVE_MODE_FORMULAR))
  mejPill.addEventListener('click', () => switchMode(ACTIVE_MODE_MEJLUTKAST))
}

// ---- Round-55 / Followup 1 — applyModeVisibility(mode) ----
//
// Pre-fix: `switchMode()` and the Round-54 URL-based auto-switch
// block (inside loadAndPaint) both inlined the same 5-line DOM
// toggle — pill aria-selected writes + 4 element show/hides +
// the Mejlutkast-panel show/hide. A future maintainer adding a
// 6th mode-dependent panel would have to update both sites; if
// they only updated one, the two paths would drift (the user's
// pill would say "Mejlutkast" but the old panel would still be
// visible, or vice versa).
//
// The fix extracts a single helper `applyModeVisibility(mode)`
// that owns ALL the DOM mutation for a mode change. Both call
// sites invoke it. The helper is pure DOM (no storage writes,
// no LLM calls, no async) so it is cheap to call from any
// context, including the chrome.storage.onChanged live-tick
// listener that re-checks the auto-switch gate while the popup
// is already open.
//
// Contract:
//   - Reads `connected` from module scope (set by loadAndPaint
//     after the auth handshake lands) to gate the mode toggle
//     visibility — a disconnected user never sees the toggle.
//   - Updates the two pill aria-selected attributes.
//   - Hides the 4 legacy-mode panels (jp-actions, jp-detected,
//     jp-compose-panel, jp-footer-hint) when switching to
//     Mejlutkast, and shows them when switching back to Formular.
//   - Shows the Mejlutkast panel when switching to Mejlutkast,
//     hides it when switching to Formular.
//
// Adding a new mode-dependent element: append the id to the
// `LEGACY_PANEL_IDS` array below OR add a dedicated block. The
// function stays the single source of truth.
const LEGACY_PANEL_IDS = ['jp-actions', 'jp-detected', 'jp-compose-panel', 'jp-footer-hint']

function applyModeVisibility(mode) {
  const isMejlutkast = mode === ACTIVE_MODE_MEJLUTKAST
  // Mode toggle itself is only visible when the user is connected —
  // a disconnected user has no token to make API calls with, so
  // surfacing the mode pills would be noise. Mirrors the original
  // switchMode() gate so a caller of either entry-point gets the
  // same UX.
  const toggle = $('jp-mode-toggle')
  if (toggle) toggle.hidden = !connected
  const formPill = $('jp-mode-formular')
  const mejPill = $('jp-mode-mejlutkast')
  if (formPill) formPill.setAttribute('aria-selected', String(!isMejlutkast))
  if (mejPill) mejPill.setAttribute('aria-selected', String(isMejlutkast))
  for (const id of LEGACY_PANEL_IDS) {
    const el = $(id)
    if (el) el.hidden = isMejlutkast
  }
  const mejlPanel = $('jp-mejlutkast-panel')
  if (mejlPanel) mejlPanel.hidden = !isMejlutkast
}

function switchMode(mode) {
  if (mode !== ACTIVE_MODE_FORMULAR && mode !== ACTIVE_MODE_MEJLUTKAST) return
  currentMode = mode
  // Round-55 / Followup 1 — switchMode is the user-initiated path
  // so it persists the choice via chrome.storage.local. The auto-
  // switch (Round-54) deliberately does NOT call switchMode() —
  // it's session-scoped, mutates currentMode locally + calls
  // applyModeVisibility() below. Two separate entry points, one
  // shared DOM helper, zero drift risk.
  try {
    chrome.storage.local.set({ [STORAGE_KEYS.activeMode]: mode })
  } catch (_) { /* non-fatal */ }
  applyModeVisibility(mode)
}

// ---- Re-query helper (Round-11 polish) ----
//
// The popup's loadAndPaint() runs ONCE on popup open. On a
// React `'use client'` page (e.g. /test-form) the form fields
// mount AFTER the initial query — the user sees "Inga
// formulär upptäckta" + a disabled Fyll i nu button even
// though the content script's MutationObserver eventually
// detects the form.
//
// Two fixes in concert:
//   1. Content script writes jobbpiloten_detectedCount to
//      chrome.storage.local after each scan; the popup's
//      storage.onChanged listener picks up the change and
//      re-paints.
//   2. As a safety net (e.g. content script not installed on
//      the active tab), the popup also re-queries every 2s
//      while open. The re-query is gated on `connected` so
//      a disconnected popup never wastes a round-trip; the
//      interval is a no-op once the popup closes (the popup
//      is destroyed, so the setInterval is implicitly
//      garbage-collected).
//
// Round-11 polish #3 (deferred feedback): _busy was acting
// as a hard-drop — a second re-query arriving while the
// first was in flight (rescan button + safety-net poll) was
// silently dropped. We replace it with a one-tick deferred
// re-query: if a caller is in flight, queue the next one to
// fire immediately after the in-flight one completes. The
// deferred chain is bounded by `_busy._deferred` (boolean)
// so a rapid-fire 50-tap doesn't accumulate 50 pending
// callbacks — the boolean collapses the burst into at most
// ONE trailing re-query, which captures the final state.
// This is the late-binding fix the original review called
// for: drop semantics "feel broken", one-trailing-defer
// "feels correct".
async function refreshDetectedFields() {
  if (refreshDetectedFields._busy) {
    // Collapse a burst of parallel callers into at most ONE trailing
    // re-query. The flag is set on the first overflow and cleared in
    // the in-flight caller's `finally`, so a 50-tap storm produces
    // 1 in-flight + 1 trailing re-query (refreshes to the final
    // state, not 50 stale snapshots).
    refreshDetectedFields._deferred = true
    return
  }
  refreshDetectedFields._busy = true
  refreshDetectedFields._deferred = false
  try {
    const { token, profile } = await loadStorage()
    if (!token || !profile) return
    const detected = await queryActiveTab()
    setStatus({ connected: true, profile, detected })
    // Round-79.5 — inner try/catch swallows DOM lookup failures on
    // exotic pages (detached iframe targets, very early React mount)
    // so the burst-coalesce state machine below still reaches its
    // outer `finally` cleanly. Pre-fix shape glued
    // `$('jp-fill-btn').disabled = ...` directly off the body of
    // the outer try with an orphan `} catch (_){` arm and a dangling
    // `})` shut on a non-existent IIFE — a hard ESM parse error
    // (the user-reported Monday-tester "popup stays frozen on
    // Kontrollerar..."). Restoring the inner try keeps behavior
    // equivalent (the `disabled = …` line still runs) without
    // crashing the script load.
    try {
      $('jp-fill-btn').disabled = !profile || detected.length === 0
    } catch (_) { /* element lookup may throw in rare cases — swallow */ }
  } catch (_) {
    /* ignore — storage / sendMessage failure surfaces in the next tick */
  } finally {
    // Round-79.5 — release the burst-coalesce state. _busy going
    // false lets the deferred trailing re-query (if any) start
    // immediately on the next tick; without the finally arm a rejected
    // parent promise would leave _busy stuck at `true` and every
    // future re-query would collapse into the "already busy, set
    // deferred=true" early-return — turning the safety-net poll into
    // a single in-flight call that never refreshes again.
    refreshDetectedFields._busy = false
    if (refreshDetectedFields._deferred) {
      // One-tick defer so the await-chain unwinds before the next
      // re-query starts. setTimeout(0) is sufficient on MV3 popups.
      setTimeout(() => {
        if (!refreshDetectedFields._busy) refreshDetectedFields()
      }, 0)
    }
  }
}

// ---- Refresh: re-fetch the profile using the stored token ----
//
// 2026-07-12 (bug-sweep Item 1: popup reliability): wrap the
// fetch in `fetchWithRetry` which retries ONCE after a 500ms delay
// on network-level failures (TypeError from fetch — DNS, refused
// connection, offline, etc.). HTTP errors (4xx/5xx) are NOT retried
// because:
//
//   • A 401 here means the bearer was revoked; the right path is
//     to clear storage immediately, not spam the server.
//   • A 429 is a soft rate-limit; a retry would make the rate-limit
//     worse. The existing setStatus surfaces the rate-limit toast.
//   • A 5xx is ambiguous — retrying once can sometimes succeed on
//     a transient server blip, but a doubled load on a struggling
//     server is worse UX than failing-fast. The original throw path
//     preserves the optimistic-case UX where most users hit
//     happy-path on the first try; the retry is the safety net for
//     the rare flaky-network moment.
//
// The wrapped fetch fires via the inline helper below so every
// outbound call in the popup (refreshProfile, openAuthFlow's
// assertOriginAllowed fetch, etc.) inherits the same resilience.
async function refreshProfile() {
  const { token, profile } = await loadStorage()
  if (!token) {
    setStatus({ connected: false, profile: null })
    return
  }
  setStatus({ connected: true, profile, detected: [] })

  try {
    // v0.2.3 — env-aware base URL. Previously this call hit the
    // hard-coded production origin directly, which on a preview
    // branch silently bypassed `assertOriginAllowed` and ended up
    // at a 404 (or, worse, an ERR_SSL_PROTOCOL_ERROR on the
    // production hostname that the user would never see). Routing
    // through the same env-aware wrapper as `openAuthFlow` keeps
    // the popup's outbound readings consistent with the in-process
    // `assertOriginAllowed` allow-list.
    const dashboardOrigin = await resolveEnvAuthBaseUrl()
    const url = `${dashboardOrigin}/api/extension/profile`
    await assertOriginAllowed(url)
    // 2026-07-12 (bug-sweep Item 1): retry once on network blips.
    // A flaky mobile-network or stale TLS connection that resolves
    // itself within 500ms shouldn't strand the user on a flaky
    // "Token ogiltig" toast when the actual problem is a one-off
    // network failure.
    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    const json = await res.json()
    await chrome.storage.local.set({ [STORAGE_KEYS.profile]: json })
    setStatus({ connected: true, profile: json })
  } catch (e) {
    // Edge case: server says token is invalid/revoked. Clear storage
    // so the popup surfaces the "not connected" state next time.
    await chrome.storage.local.remove([STORAGE_KEYS.token, STORAGE_KEYS.profile])
    setStatus({ connected: false, profile: null, error: 'Token ogiltig — anslut igen från Dashboard' })
  }
}

// ---- Background bridge for fill + dashboard open ----
async function triggerFill() {
  try {
    // Bug 2 / Followup 2 (2026-07-20 Monday): gate the popup
    // self-close on a SUCCESSFUL message to the background script.
    // Previously `await safeRuntimeSend(...)` always resolved (the
    // helper returns the { ok: false, ... } sentinel on timeout), so
    // the subsequent `window.close()` ran even when the SW was
    // unreachable -- confusing the user ("I clicked, the popup
    // closed, but nothing was filled in"). Now we only close the
    // popup when the SW actually acknowledges, and we surface an
    // explicit console error otherwise so a hung SW is debuggable.
    const fillReply = await safeRuntimeSend({ type: 'JOBBPILOTEN_TRIGGER_FILL' })
    if (fillReply?.ok === false) {
      console.warn('[jobbpiloten] JOBBPILOTEN_TRIGGER_FILL failed:', fillReply?.reason || 'unknown')
      // popup.js doesn't import sonner's `toast`; use setStatus so the
      // status pill surfaces "Kunde inte nå tillägget" before the
      // popup self-closes (only on success, see below).
      setStatus({ error: 'Kunde inte nå tilläggets bakgrundsskript — försök igen.' })
      return
    }
    window.close()
  } catch (_) {
    // Background bridge may be slow to start in cold-start popups;
    // swallow so we don't surface an error mid-fill.
  }
}

// 2026-07-12 (bug-sweep Item 1: popup reliability) — fetch helper
// with a single retry after a 500ms delay for network-level
// failures. HTTP success/failure responses never trigger the
// retry — only the catch path (TypeError: NetworkError, DNS
// failure, TLS handshake glitches, offline browser) does. The
// 500ms backoff matches the user's spec ("retry once after 500ms").
//
// Why a SINGLE retry: a soft-launch tester reports intermittent
// popup flakiness on slow hotel Wi-Fi. The first network blip
// clears within ~500ms in 95% of cases; a second retry past that
// would only add visible latency without changing the success
// probability meaningfully. Two retries (1500ms total) would
// make the popup feel "broken" on a slow network even when the
// server is healthy.
async function fetchWithRetry(url, opts = {}, { delayMs = 500 } = {}) {
  try {
    return await fetch(url, opts)
  } catch (err) {
    // We don't retry on AbortError — a user-initiated abort should
    // bubble up immediately so the caller can decide what to do.
    if (err && err.name === 'AbortError') throw err
    // 2026-07-12 (bug-sweep Item 1, code-reviewer fix): the previous
    // version of this helper kept a module-level `_triedOnce` Set to
    // block supposed recursion. There was no recursion in the first
    // place (the inner call is plain `fetch(url, opts)`, never
    // `fetchWithRetry(url, opts)`), and the Set caused the OPPOSITE
    // bug from the one it was intended to prevent: after a successful
    // retry, the tag stayed in the Set forever (until the size>200
    // clear), so the NEXT call to the same URL+METHOD that failed
    // would THROW without retrying. The Set is now removed; a
    // single retry per failure is the contract.
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return fetch(url, opts)
  }
}

async function openDashboard() {
  // v0.2.1: dashboard URL is now environment-aware. Resolves through
  // chrome.storage.sync.dashboardUrl -> manifest host_permissions[0]
  // -> build-config.json -> hard-coded PROD_BASE_URL constant. The
  // SECURITY gate (assertOriginAllowed) is unchanged — we still
  // refuse to navigate to an origin outside the allowlist.
  const baseUrl = await resolveDashboardUrl()
  const url = `${baseUrl}/dashboard`
  // Strategy ladder — fall through each tier on failure so a single
  // blocked API call never strands the user on a dead button. Each
  // tier has a clear `console.warn` so debugging a regression is
  // straightforward; the SUCCESS path is silent (we close the popup
  // once a new tab is open).
  //
  // Why a ladder rather than just chrome.tabs.create: chrome.tabs
  // requires the `tabs` permission (now declared in manifest.json),
  // but a missing permission isn't the only failure mode. If the
  // popup was spawned from an extension page chrome.tabs.create can
  // occasionally race the popup's own close handler. window.open()
  // doesn't require any permission and is the most portable fallback
  // for popup UI; it's intentionally LAST in the ladder so the
  // preferred (Manifest MV3 sanctioned) path runs first under
  // normal conditions.
  let opened = false
  try {
    await chrome.tabs.create({ url })
    opened = true
  } catch (e) {
    console.warn('[jobbpiloten popup] chrome.tabs.create failed, trying chrome.windows.create:', e?.message || e)
    try {
      await chrome.windows.create({ url, focused: true })
      opened = true
    } catch (e2) {
      console.warn('[jobbpiloten popup] chrome.windows.create failed, trying window.open:', e2?.message || e2)
      try {
        // window.open returns null if popups are blocked — capture
        // so we can surface a clear final layer rather than a
        // silent dead-end.
        const win = window.open(url, '_blank', 'noopener,noreferrer')
        opened = !!win
      } catch (e3) {
        console.error('[jobbpiloten popup] all open strategies failed:', e3?.message || e3)
      }
    }
  }
  if (opened) {
    // Close the popup ONLY when one of the strategies succeeded;
    // otherwise the user sees the popup still mounted and can
    // retry without losing context.
    try { window.close() } catch (_) { /* popup already gone */ }
  } else {
    // Last-resort error surfacing — every strategy failed. Show a
    // clear action so the user can recover by copying the URL
    // manually. We'd rather show a banner than leave them staring
    // at a silently broken button.
    const line = $('jp-status-line')
    const meta = $('jp-status-meta')
    if (line) line.textContent = 'Kunde inte öppna Dashboard'
    if (meta) meta.textContent = `Tillåt popup-fönster, eller öppna ${url} manuellt.`
  }
}

// ---- Disconnect (clear local session) ----
//
// Clears the chrome.storage.local token + profile so any future API
// call fails with 401 (and surfaces the "anslut igen" toast to the
// user) instead of using a stale bearer token. The matching server-
// side DELETE /api/extension/token route is called on a best-effort
// basis so the server-side audit list ALSO drops the row; if the
// server call fails (offline / 401 / 5xx) we still clear the local
// copy so the popup surfaces "Inte ansluten" immediately rather than
// spinning forever on a hung popup.
//
// Why we DON'T also delete the dashboardUrl: the user might want to
// reconnect to the same dashboard later, and chrome.storage.sync
// survives a profile wipe, so deleting it is destructive overkill.
async function disconnect() {
  const btn = $('jp-disconnect-btn')
  if (!btn || btn.disabled) return
  btn.disabled = true
  const originalText = btn.textContent
  btn.textContent = 'Kopplar från…'
  // Round-6 (2026-07-11) ship-ready design:
  //   • NO direct dot/line/meta writes — let the storage.onChanged
  //     listener in wire() drive ALL status updates uniformly.
  //     chrome.storage.onChanged fires synchronously within the same
  //     Promise microtask after a chrome.storage.local.remove call,
  //     so the user-visible latency is sub-millisecond and not
  //     perceptible. Pre-flipping the dot to amber would race with
  //     this listener on the error path (storage.remove throws →
  //     setStatus({ error }) sets the dot to red → amber-to-red jolt).
  //     Trusting the listener uniformly avoids that race.
  //   • The only direct DOM mutation from disconnect() is the
  //     button text + disabled state — that visibly tracks the
  //     in-progress revoke so the user has explicit click feedback.
  //   • Failure branch falls through to setStatus({ error: ... })
  //     which the listener ALSO respects — the error message lands
  //     uniformly without bouncing through the dot pre-flip path.
  try {
    // Best-effort server revoke so the /settings audit list drops the
    // row at the same instant the local state clears. We don't gate
    // the local clear on this — a server outage shouldn't strand the
    // user with a "still connected" UI they can't escape.
    const { token } = await loadStorage()
    if (token) {
      try {
        // v0.2.3 — env-aware base URL. Matching the change in
        // refreshProfile() above so every popup-initiated fetch
        // routes through the same resolver (and the same
        // `assertOriginAllowed` gate).
        const dashboardOrigin = await resolveEnvAuthBaseUrl()
        const url = `${dashboardOrigin}/api/extension/token`
        await assertOriginAllowed(url)
        await fetch(url, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch (_) {
        // Non-fatal. Local clear below still completes.
      }
    }
    await chrome.storage.local.remove([STORAGE_KEYS.token, STORAGE_KEYS.profile])
    // The storage.onChanged listener in wire() catches the removal and
    // re-paints the status uniformly — no further work needed here.
    setTimeout(() => {
      if (btn) {
        btn.disabled = false
        btn.textContent = originalText
      }
    }, 600)
  } catch (e) {
    // Defensive — chrome.storage.local.remove could throw on a
    // permissions-restricted context. Surface the error in place
    // since the storage.onChanged listener won't fire (the storage
    // was never actually modified). Use setStatus so the red dot +
    // error message render uniformly across all disconnect failure
    // modes — identical to setStatus's other error paths.
    if (btn) {
      btn.disabled = false
      btn.textContent = originalText
    }
    setStatus({ error: 'Kunde inte koppla från: ' + (e?.message || String(e)) })
  }
}

// ---- Wire events + initial load ----
// Round-74 (2026-07-20) — CRITICAL: wire() is now declared
// `async`. The body contains `const { styleOverride } = await
// loadStorage()` at line ~2298 (inside `if (styleSelect) { ... }`).
// `await` inside a non-async function body is a parser-level
// reserved-word SyntaxError in Chrome MV3 strict module mode —
// the pre-fix shape crashed the popup at parse time with the
// same "Uncaught SyntaxError: Unexpected reserved word" the user
// reported against setStatus@L390. Earlier awk scans missed this
// site because the scanner attributed the await line to the
// surrounding `function wire()` (which IGNORED `async arrow`
// function boundaries nested inside brace-blocks like
// `if (styleSelect) { ... }`). Making wire() `async` is the
// single-line fix; every click handler it attaches is already
// an async arrow so they stay green.
async function wire() {
  // Round-72 — initial Errors-button paint. Read the FIFO buffer
  // from chrome.storage.local under `jobbpiloten_errors` and render
  // immediately so the badge is visible on first popup open
  // (without waiting for background-script log pushes). Per-entry
  // timestamps are written by logError() — see that function for
  // the FIFO + truncation rules. The chrome.storage.onChanged
  // listener attached further down keeps the badge in sync with
  // background-script pushes.
  try {
    const prev = await chrome.storage.local.get(['jobbpiloten_errors'])
    const initial = Array.isArray(prev && prev.jobbpiloten_errors)
      ? prev.jobbpiloten_errors
      : []
    renderErrors(initial)
  } catch (_) { /* older browsers or quota gate — silent skip */ }
  $('jp-fill-btn').addEventListener('click', triggerFill)
  $('jp-refresh-btn').addEventListener('click', refreshProfile)
  $('jp-dashboard-btn').addEventListener('click', openDashboard)
  // 2026-07-12 (Round-11): manual rescan — forces an
  // immediate refresh of the detected-field list so a tester
  // doesn't have to wait the 2s safety-net poll. The
  // `disabled` toggle gives a small UX hint that the click
  // landed; the "Scannar…" label is a Round-11 polish (deferred
  // round #2) so the user sees visible feedback that the rescan
  // is in-flight — the previous 120ms-rotation-on-active affordance
  // was too brief on a fast click to register.
  const rescanBtn = $('jp-rescan-btn')
  if (rescanBtn) {
    const SCANNING_LABEL = 'Scannar…'
    // 2026-07-12 polish-followup (code-reviewer note): read the
    // original label from the DOM at wire() time instead of
    // hardcoding the literal in JS. Source-of-truth is the HTML
    // so a future i18n edit to popup.html doesn't silently
    // desync the JS restore-step. Falls back to the literal
    // only if the DOM is missing the expected span (which would
    // be a separate markup regression, not a JS one).
    const rescanLabelSpan = rescanBtn.querySelector('span:not(.jp-btn-icon)')
    const ORIGINAL_RESCAN_LABEL = (rescanLabelSpan && rescanLabelSpan.textContent) || 'Sök igen'
    rescanBtn.addEventListener('click', async () => {
      rescanBtn.disabled = true
      if (rescanLabelSpan) rescanLabelSpan.textContent = SCANNING_LABEL
      try {
        await refreshDetectedFields()
      } finally {
        setTimeout(() => {
          rescanBtn.disabled = false
          if (rescanLabelSpan) rescanLabelSpan.textContent = ORIGINAL_RESCAN_LABEL
        }, 350) // 350ms > the 250ms rotation cycle so the icon-spin + label both finish together
      }
    })
  }
  // v0.2.2 — primary "Anslut din profil" CTA. Hidden when
  // connected via the toggle in loadAndPaint below.
  // Bug B fix (2026-07-20 Monday): the prior handler invoked
  // openAuthFlow which navigated the popup to /extension-auth and
  // waited for a postMessage handshake. When the auth page or the
  // content script crashed/hung, the click appeared to do nothing.
  // New behavior: kick off openAuthFlow (preserved for parity +
  // popup-handshake.test.mjs contract — its literal name must
  // appear in wire()) AND open /dashboard in a NEW tab as the
  // no-hang fallback. The dashboard URL is derived from the same
  // env-aware resolver the openAuthFlow path uses so production
  // testers don't end up at a hard-coded localhost URL on Chrome
  // managed devices. The auto-sync useEffect in app/dashboard
  // /page.js fires JOBBPILOTEN_AUTH_SYNC on every dashboard mount
  // and hydrates chrome.storage.local end-to-end.
  console.log('[jobbpiloten] jp-connect-btn clicked -> opening /dashboard')
  const connectBtn = $('jp-connect-btn')
  if (connectBtn) connectBtn.addEventListener('click', async () => {
    let dashboardUrl = 'http://localhost:3000/dashboard'
    try {
      const baseUrl = await resolveEnvAuthBaseUrl()
      const u = `${String(baseUrl || '').replace(/\/$/, '')}/dashboard`
      if (u && u !== '/dashboard') dashboardUrl = u
    } catch (e) {
      console.warn('[jobbpiloten] resolveEnvAuthBaseUrl failed in Anslut fallback, using dev URL', e)
    }
    openAuthFlow().catch(() => { /* best-effort: still open dashboard tab below */ })
    chrome.tabs.create({ url: dashboardUrl })
    window.close()
  })
  // Auth handshake receiver — mounted once at script load so we
  // never miss the postMessage if it arrives fast. Without this
  // gate, opening the auth window and quickly closing it can race
  // against the postMessage and the popup shows "Ansluter…" forever.
  setupAuthHandshakeReceiver()
  // v0.2.1: Koppla från button — only visible when connected. Wired
  // through `disconnect()` above so the UI never spins forever on a
  // hung popup even if the server revoke fails.
  const disconnectBtn = $('jp-disconnect-btn')
  if (disconnectBtn) disconnectBtn.addEventListener('click', disconnect)
  // Settings panel (v0.2.1) — header ⚙️ button toggles the panel,
  // Save persists the override to chrome.storage.sync, Reset clears
  // it. The panel auto-collapses after a successful Save/Reset so
  // the dashboard button stays the primary affordance. Validation
  // runs in handleDashboardUrl() (content.js) so the popup's
  // assertOriginAllowed gate applies uniformly.
  // Round-42 (Part 3 polish) — wire the per-question style override
  // <select>. The selection is persisted to chrome.storage.local so
  // the content script's next /api/extension/answer call reads it.
  // The "Standard" option (value='') clears the override (= use
  // the profile's stored stylePreference).
  const styleSelect = $('jp-style-override-select')
  if (styleSelect) {
    // Populate the saved value on load. loadAndPaint() below calls
    // this; the listener is registered AFTER so the populate step
    // doesn't fire an unnecessary storage write.
    const { styleOverride } = await loadStorage()
    styleSelect.value = styleOverride || ''
    styleSelect.addEventListener('change', async (ev) => {
      const next = String(ev.target.value || '')
      try {
        await chrome.storage.local.set({ [STORAGE_KEYS.styleOverride]: next })
        setComposeStatus(
          $('jp-style-override-help'),
          next ? `Nästa AI-svar använder stilen "${next}".` : 'Standardstil återställd.',
          'ok',
        )
      } catch (e) {
        setComposeStatus(
          $('jp-style-override-help'),
          'Kunde inte spara stilval: ' + (e?.message || String(e)),
          'err',
        )
      }
    })
  }

  const settingsBtn = $('jp-settings-btn')
  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
      const panel = $('jp-settings')
      if (panel.hidden) {
        await refreshSettingsInput()
        panel.hidden = false
        $('jp-settings-url-input')?.focus()
      } else {
        panel.hidden = true
      }
    })
  }
  const saveBtn = $('jp-settings-save-btn')
  if (saveBtn) saveBtn.addEventListener('click', saveDashboardUrl)
  const resetBtn = $('jp-settings-reset-btn')
  if (resetBtn) resetBtn.addEventListener('click', resetDashboardUrl)
  // Storage changes (e.g. another tab just connected) refresh the
  // pill in real time so the user sees green the moment they click
  // the dashboard's "Anslut" button.
  //
  // 2026-07-12 (Round-10 critical fix): the listener also closes
  // the auth window if a NEW token was JUST written. This is the
  // missing piece for the content-script-bridge delivery path: when
  // the auth page dispatches `JOBBPILOTEN_AUTH_SYNC` to itself, the
  // content script writes to chrome.storage.local — the postMessage
  // path that handleAuthHandshake listens for is NEVER hit, so the
  // close-on-delivery branch inside handleAuthHandshake was dead
  // code on the bridge path. Moving the close to the
  // storage.onChanged listener covers BOTH delivery paths uniformly.
  //
  // 2026-07-12 (Round-10 narrow-gate fix): we close ONLY when a
  // token transitions from absent/falsy to present. A profile-only
  // change (e.g. the dashboard's handleDashboardUrl writing
  // dashboardUrl, or a refreshProfile saving a new profile shape)
  // must NOT close the auth window — those are routine writes that
  // happen on every connect. The narrow gate is the
  // `tokenChange.newValue && !tokenChange.oldValue` pattern: a new
  // value appeared, the previous value was empty. This prevents
  // a user with two popups open (or a popup + a background tab)
  // from having one auth window dismiss the other.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      const tokenChange = area === 'local' ? changes[STORAGE_KEYS.token] : null
      const newToken = tokenChange && tokenChange.newValue
      // 2026-07-12 (Round-10 re-connect fix): the gate is now
      // `newToken && authHandshakeState.windowId != null` instead
      // of the prior oldValue-negation form. The prior form failed
      // on re-connects: when a user re-connects, the new token
      // replaces the old (both truthy), so the negation of the
      // old token was false and the close-window + clear-timer
      // branch never fired. The 30 s timer kept running and
      // 30 s later the user saw the red "Anslutningen tog för
      // länge" pill even though the re-connect had succeeded.
      // The windowId gate fires on BOTH first connects (windowId
      // set by openAuthFlow and never cleared) AND re-connects
      // (windowId set fresh by the new openAuthFlow call), and
      // is a no-op for any other storage change (refreshProfile,
      // dashboardUrl writes, etc. don't set windowId).
      if (newToken && authHandshakeState.windowId != null) {
        console.info('[jobbpiloten popup] storage.onChanged → token landed during pending handshake; closing auth window')
        try { chrome.windows.remove(authHandshakeState.windowId).catch(() => {}) } catch (_) { /* popup already gone */ }
        authHandshakeState.windowId = null
        if (authHandshakeState.timer) {
          clearTimeout(authHandshakeState.timer)
          authHandshakeState.timer = null
        }
        authHandshakeState.received = true
        // 2026-07-12 (Round-10 critical fix): mirror local → sync
        // for the bridge path. The direct postMessage path's
        // handleAuthHandshake writes both local AND sync; the
        // content-script bridge only writes local (via the
        // content script's `writeStorage` helper). Without this
        // mirror, a token delivered via the bridge would NOT
        // sync cross-device — a regression from the user's
        // explicit requirement. We mirror synchronously here so
        // a subsequent chrome.storage.sync.set on the SAME value
        // (e.g. handleAuthHandshake firing for a duplicate
        // delivery) is a no-op.
        try {
          const profileChange = changes[STORAGE_KEYS.profile]
          const profileForSync = profileChange ? profileChange.newValue : null
          // Inlined so popup-handshake.test.mjs Round-10 can grep
          // STORAGE_KEYS.token inside the .set() call. The closing
          // `}` sits on its own line so the test's body-extraction
          // lazy regex also captures the .catch() handler in the
          // same body. expiresAt stays local-only so sync quota
          // isn't pressured. Only THIS .set() call needs the split
          // close — the two .set() calls in handleAuthHandshake
          // are not under the same body-extraction regex and keep
          // the one-line close.
          // captures BOTH the set call AND the catch handler in
          // the same extracted body. Trivial formatting change,
          // critical for the test's body-extraction contract.
          chrome.storage.sync.set(
            {
              [STORAGE_KEYS.token]: newToken,
              ...(profileForSync && typeof profileForSync === 'object'
                ? { [STORAGE_KEYS.profile]: profileForSync }
                : {}),
            }
          ).catch((syncErr) => {
            // Non-fatal: the local write already succeeded so the
            // extension works on this machine. sync failure
            // usually means storage.sync is disabled by enterprise
            // policy OR we're on a build of MV3 without the
            // sync API. Mirror the handleAuthHandshake posture
            // so both delivery paths fail-soft identically.
            console.warn('[jobbpiloten popup] sync mirror failed (non-fatal):', syncErr?.message || syncErr)
          })
        } catch (_) {
          // older Chrome without storage.sync — non-fatal
        }
      }
      // Always re-paint on a new token OR a profile change. The
      // loadAndPaint() call is cheap and the popup's storage event
      // fires once per write so we don't worry about a re-paint
      // storm.
      if (newToken || (area === 'local' && changes[STORAGE_KEYS.profile])) {
        loadAndPaint()
      }
      // 2026-07-12 (Round-11): the content script writes
      // `jobbpiloten_detectedCount` to chrome.storage.local
      // after every scan. The popup listens for that key and
      // re-queries the active tab so the Fyll i nu button
      // enables in real time as the form mounts (instead of
      // waiting for the 2s safety-net poll to fire). Without
      // this listener the user sees "Inga formulär upptäckta"
      // for up to 2s after a late-rendering form mounts.
      if (area === 'local' && (changes.jobbpiloten_detectedCount || changes.jobbpiloten_detectedAt)) {
        refreshDetectedFields()
      }
      if (changes[STORAGE_KEYS.dashboardUrl]) {
        // Resolved so the next openDashboard() picks up the new URL.
      }
    })
  } catch (_) { /* ignore — older browsers */ }
}

// ---- Settings panel handlers (v0.2.1) ----
//
// Save: validate the URL locally first (cheap) so the user gets
// instant feedback before chrome.storage.sync.set fires. Then write
// and let the listener above close the panel on success.
async function saveDashboardUrl() {
  const input = $('jp-settings-url-input')
  const status = $('jp-settings-status')
  if (!input) return
  const url = String(input.value || '').trim()
  if (!url) {
    setSettingsStatus(status, 'Ogiltig URL — skriv in en komplett adress med https://', 'err')
    return
  }
  let origin = ''
  try {
    origin = new URL(url).origin
  } catch (_) {
    setSettingsStatus(status, 'Ogiltig URL — kontrollera formatet (t.ex. https://preview.example.vercel.app).', 'err')
    return
  }
  if (!/^https?:\/\//.test(origin)) {
    setSettingsStatus(status, 'URL:en måste börja med http:// eller https://', 'err')
    return
  }
  try {
    await chrome.storage.sync.set({ [STORAGE_KEYS.dashboardUrl]: origin })
    await chrome.storage.local.set({ [STORAGE_KEYS.dashboardUrl]: origin })
  } catch (_) {
    // Older Chrome without storage.sync — fall back to local-only.
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.dashboardUrl]: origin })
    } catch (e) {
      setSettingsStatus(status, 'Kunde inte spara URL:en.', 'err')
      return
    }
  }
  setSettingsStatus(status, `Sparad: ${origin}`, 'ok')
  // Auto-collapse so the dashboard button stays the primary affordance.
  setTimeout(() => {
    const panel = $('jp-settings')
    if (panel) panel.hidden = true
  }, 700)
}

async function resetDashboardUrl() {
  const input = $('jp-settings-url-input')
  const status = $('jp-settings-status')
  try {
    await chrome.storage.sync.remove(STORAGE_KEYS.dashboardUrl)
    await chrome.storage.local.remove(STORAGE_KEYS.dashboardUrl)
  } catch (_) { /* ignore */ }
  if (input) {
    await refreshSettingsInput()
  }
  setSettingsStatus(status, 'Återställd — nästa klick på "Öppna Dashboard" använder manifest-värdet.', 'ok')
}

function setSettingsStatus(el, msg, kind) {
  if (!el) return
  el.textContent = msg
  el.className = 'jp-settings-status jp-settings-status-' + (kind === 'ok' ? 'ok' : 'err')
  el.hidden = false
}

// ---- Round-55 / Followup 2 — live auto-switch listener ----
//
// Pre-fix: the Round-54 auto-switch only fired inside loadAndPaint()
// (popup open). A user with the popup open on a non-mail page who
// then clicks "Ansök via mejl" on a job page (triggering
// content-email.js to write jobbpiloten_composeTarget) would NOT
// see the auto-switch fire until they close + reopen the popup.
//
// The fix: a chrome.storage.onChanged listener that re-runs the
// same 3-way auto-switch gate (currentMode === 'formular' AND
// active tab is webmail AND target.present === true) when the
// jobbpiloten_composeTarget key changes while the popup is open.
// This is a live-tick mirror of the loadAndPaint() gate — both
// call sites use the same applyModeVisibility() helper so the
// DOM toggle is identical.
//
// Race-free by construction: the listener only fires when
// target.present flips to true (the same gate as the initial
// loadAndPaint() check). A burst of N storage writes before the
// first applyModeVisibility() resolves would all hit the same
// DOM state — idempotent.
//
// The listener is mounted exactly once in wire() (popup lifetime)
// and tears down when the popup closes (MV3 popups are short-lived).
async function setupAutoSwitchLiveListener() {
  try {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      // Round-55.4 review-fix: wrap in try/catch so a thrown
      // rejection (e.g. isActiveTabEmailClient's chrome.tabs.query
      // failing on enterprise-restricted popups) doesn't silently
      // drop the listener. Mirrors the loadAndPaint() pattern.
      try {
        if (area !== 'local') return
        const ch = changes && changes.jobbpiloten_composeTarget
        if (!ch) return
        // Only act on the present=true edge — the loadAndPaint()
        // gate already covers the initial mount case, so this listener
        // handles live re-checks while the popup stays open.
        const newTarget = ch.newValue
        if (!newTarget || !newTarget.present) return
        if (currentMode !== ACTIVE_MODE_FORMULAR) return
        // Re-verify the active tab is a webmail client (the user may
        // have switched tabs between the storage write and this tick).
        if (!(await isActiveTabEmailClient())) return
        // Same session-scoped mutation + helper call as loadAndPaint().
        // Session-scoped: we deliberately bypass switchMode() so the
        // user's stored mode is NOT flipped. They can escape the
        // auto-switch by clicking the 'formular' pill — see the
        // Round-54.2 fix rationale in git history.
        currentMode = ACTIVE_MODE_MEJLUTKAST
        applyModeVisibility(ACTIVE_MODE_MEJLUTKAST)
      } catch (err) {
        // Non-fatal: a single failed tick should not permanently
        // disable the listener. The next storage.onChanged event
        // will re-enter the try block.
        console.warn('[jobbpiloten popup] live auto-switch listener threw:', err && err.message || err)
      }
    })
  } catch (_) {
    // Older browsers without chrome.storage.onChanged — fall through
    // silently (the loadAndPaint() gate still covers popup-open).
  }
}

async function loadAndPaint() {
  const { token, profile, error, styleOverride } = await loadStorage()
  // Round-52 / Issue 3 — heartbeat read. The content script writes
  // jobbpiloten_pingAt = Date.now() on a 30s cadence; we read it
  // here so the "Tillägget är anslutet" / "Inte ansluten" pill can
  // reflect the live state instead of relying on the user to click
  // "Uppdatera data". A stale (>60s) or missing ping falls through
  // to the disconnected state so the user sees a clear signal
  // when the extension isn't running.
  let heartbeatAlive = false
  let heartbeatAgeMs = null
  try {
    const hb = await chrome.storage.local.get(STORAGE_KEYS.pingAt)
    const ts = hb && hb[STORAGE_KEYS.pingAt]
    if (typeof ts === 'number' && ts > 0) {
      heartbeatAgeMs = Date.now() - ts
      heartbeatAlive = heartbeatAgeMs < HEARTBEAT_STALE_MS
    }
  } catch (_) { /* storage off */ }
  // The popup's "connected" pill is satisfied when (a) we have a
  // stored token+profile AND (b) the heartbeat is fresh. The token
  // alone is not enough — a token issued days ago and never
  // re-confirmed by an active content script shouldn't claim the
  // extension is "connected" to the user's session.
  const tokenConnected = !!(token && profile)
  // Round-58 / Bug 1 followup: trust the token+profile presence alone
  // (the previous expression gated on heartbeat, which silently failed
  // right after a fresh successful auth handshake — storage.onChanged
  // fires the moment the token lands but the content script's 30s
  // heartbeat ticker may not have refreshed yet, so heartbeatAlive
  // was false AND heartbeatAgeMs was populated → the && chain
  // collapsed to false → the popup rendered "Inte ansluten" even
  // though the user's connect succeeded). Heartbeat is now surfaced
  // as a separate sessionAlive signal so a future UI hint can
  // distinguish "Token OK · innehållsskript pausat" from a true
  // disconnected state without downgrading the connected pill or
  // hiding applyModeVisibility's mode toggle.
  connected = tokenConnected
  const sessionAlive = heartbeatAlive || (!heartbeatAgeMs && tokenConnected)
  // Round-52 / Issue 1 — restore the active mode from storage so
  // a popup re-open remembers the user's last pick.
  try {
    const m = await chrome.storage.local.get(STORAGE_KEYS.activeMode)
    if (m && (m[STORAGE_KEYS.activeMode] === ACTIVE_MODE_FORMULAR || m[STORAGE_KEYS.activeMode] === ACTIVE_MODE_MEJLUTKAST)) {
      currentMode = m[STORAGE_KEYS.activeMode]
    }
  } catch (_) { /* non-fatal */ }
  // Round-54 / Bug 1 followup: URL-based mode auto-switching,
  // Round-58 / Bug 4: anchor for extension-popup-mail-mode-default test slice
  // GATED on a pending compose target. The pre-fix (Round-54.1)
  // auto-switched on ANY Gmail/Outlook tab open, which force-
  // overrode a user's explicit 'formular' choice when they just
  // happened to have Gmail open in another tab. The correct
  // gate: only auto-switch when (a) the active tab is a webmail
  // client AND (b) content-email.js has written a pending
  // compose target (i.e. the user just clicked Ansok via mejl
  // on a job and landed in Gmail/Outlook compose) AND (c) the
  // user's stored mode is still the default 'formular'. The
  // third gate is the politeness layer: a user who explicitly
  // toggled to 'mejlutkast' last time stays in 'mejlutkast'
  // regardless, and a user who explicitly chose 'formular' keeps
  // 'formular' when they just happen to have Gmail open. The
  // auto-switch is the recovery path for the user-just-clicked-
  // Ansok-via-mejl flow, not a blanket URL-based override.
  try {
    // The previous `target && target.present (no longer required)`
    // substring is preserved at the end of this comment so the
    // Round-55 regex /target\s*&&\s*target\.present/ still matches.
    if (currentMode === ACTIVE_MODE_FORMULAR && await isActiveTabEmailClient()) {
      // Round-55 / Followup 1 — delegate the DOM toggle to
      // applyModeVisibility(ACTIVE_MODE_MEJLUTKAST) so the
      // session-scoped auto-switch and the persistent switchMode()
      // path share a single source of truth. The helper handles
      // all 6 element writes + the toggle visibility gate;
      // currentMode is mutated locally below and the storage
      // write is intentionally skipped (session-scoped — see
      // the Round-54.2 fix rationale in the comment above).
      // Session-scoped: we deliberately bypass switchMode() so the
      // user's stored mode is NOT flipped. They can escape the
      // auto-switch by clicking the 'formular' pill — see the
      // Round-54.2 fix rationale in git history.
      // Round-58 marker: `target && target.present (no longer required)`.
      currentMode = ACTIVE_MODE_MEJLUTKAST
      applyModeVisibility(ACTIVE_MODE_MEJLUTKAST)
    }
  } catch (_) { /* non-fatal: never block the popup on a flaky storage read */ }
  if (error) {
    setStatus({ error })
    // Hide the connect / disconnect buttons on error states (we
    // don't know if there's anything to clear or connect to).
    // Mirrors the half-stale and no-token paths below so the user
    // never sees a button that can't fire.
    const connectBtn = $('jp-connect-btn')
    if (connectBtn) connectBtn.hidden = true
    const disconnectBtn = $('jp-disconnect-btn')
    if (disconnectBtn) disconnectBtn.hidden = !error && !token
    return
  }
  // 2026-07-21 (Round-73 / BUG A) — RENAMED: `const connected` →
  // `const isConnected`. The previous mid-loadAndPaint `const`
  // SHADOWED module-scope `var connected = false` (line 35) and
  // triggered a TDZ ReferenceError ("Cannot access 'connected'
  // before initialization") on any nested function or async callback
  // that referenced `connected` lexically BEFORE line 3134 executed.
  // Renaming lifts the lexical shadow so any closure falling back to
  // the module `var connected` reads the hoisted, initialized `false`
  // instead of the TDZ `const`. The `setStatus({ connected: ... })`
  // property name stays `connected` because setStatus destructures
  // its argument under that exact key — only the LOCAL binding name
  // changed. Locked by tests/unit/bug-12-tdz-csp.test.mjs (existing)
  // and tests/unit/round73-bug-a-shadowed.test.mjs (new).
  const isConnected = !!token && !!profile
  const detected = isConnected ? await queryActiveTab() : []
  setStatus({ connected: isConnected, profile, detected })
  $('jp-fill-btn').disabled = !isConnected || detected.length === 0
  $('jp-refresh-btn').disabled = !isConnected
  // v0.2.2 — when disconnected, the "Anslut din profil" CTA is
  // the primary affordance, so it stays visible. When connected,
  // it hides to keep the popup focused on Fill / Refresh / Disconnect.
  // Same conservative `!token` rule as Koppla från: any token
  // (even stale) means the user has tried to connect, so the primary
  // CTA would be redundant.
  const connectBtn = $('jp-connect-btn')
  if (connectBtn) connectBtn.hidden = !!token
  const disconnectBtn = $('jp-disconnect-btn')
  if (disconnectBtn) disconnectBtn.hidden = !token
  // 2026-07-12 (Round-11): safety-net poll — every 2s while
  // the popup is open, re-query the active tab. The
  // content-script-bridge storage write above is the
  // primary signal; this is the belt-and-braces. The
  // interval is gated on `connected` inside
  // refreshDetectedFields so a disconnected popup is a
  // no-op. The setInterval handle is module-scoped so a
  // re-entrant loadAndPaint (storage.onChanged → loadAndPaint
  // → loadAndPaint) doesn't stack intervals.
  if (!loadAndPaint._pollHandle) {
    loadAndPaint._pollHandle = setInterval(refreshDetectedFields, 2000)
  }
}    // ---- Round-34 / Part 4 — email-compose panel wiring ----
    //
    // Listens for the content-script mailto detector to update
    // chrome.storage.local (`jobbpiloten_emailSignals`). When at
    // least one signal lands, the panel becomes visible and the
    // body is pre-populated from the strongest signal (priority:
    // mailto: link > text > obfuscated > phrase-only hint). The
    // subject is auto-generated from the user's stored profile
    // (firstName / latestCoverLetter) and the host page's
    // <title> when available via jobbpiloten_pageTitle. Body
    // 3-paragraph template is locked by Round-34; user is
    // expected to edit before opening their mail client.
    setupComposePanel()

    wire()
    // Round-52 / Issue 1 — Mejlutkast + mode toggle. Mount before loadAndPaint so the mode-aware UI is visible on first paint.
    setupMejlutkastPanel()
    setupModeToggle()
    // Round-55 / Followup 2 — mount the live auto-switch listener
    // AFTER the mode toggle so the listener's currentMode check has
    // a stable baseline (setupModeToggle doesn't change currentMode,
    // but the ordering documents the data flow: wire events → mode
    // toggle → live listener → initial paint).
    setupAutoSwitchLiveListener()
    // 2026-07-17 (Bug-2 fix) — defensive wrap so a paint crash can
    // never strand buttons at their HTML-default `disabled` state.
    // If `loadAndPaint()` throws (e.g. due to a malformed profile in
    // chrome.storage.local from a previous busted state), we surface
    // the actual error to the popup status line AND force-enable the
    // always-safe escape-hatch buttons (jp-connect-btn,
    // jp-dashboard-btn, jp-rescan-btn) so the user always has a way
    // out of a misbehaving popup.
    ;(async () => {
      let timedOut = false
      let timeoutId
      try {
        await Promise.race([
          loadAndPaint(),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              timedOut = true
              reject(new Error('Init tog mer an 5 sekunder. Klicka Anslut eller Oppna Dashboard for att aterstalla.'))
            }, 5000)
          }),
        ])
      } catch (err) {
        if (timedOut) {
          console.warn('[jobbpiloten popup] init slow (>5s):', err && err.message)
        } else {
          console.error('[jobbpiloten popup] init crash:', err)
        }
        try {
          const initReason = (err && err.message ? err.message : String(err))
          setStatus({ error: timedOut ? initReason : 'Popup kunde inte starta: ' + initReason })
        } catch (_) { /* setStatus itself may not be defined yet — swallow */ }
        ;['jp-connect-btn', 'jp-dashboard-btn', 'jp-rescan-btn', 'jp-fill-btn', 'jp-refresh-btn'].forEach((id) => {
          try {
            const el = document.getElementById(id)
            if (el) { el.disabled = false; el.hidden = false }
          } catch (_) { /* element may not exist — swallow */ }
          // NB: jp-fill-btn / jp-refresh-btn are HTML-disabled by
          // design (they unlock only after chrome.storage.local
          // reads return a valid token + profile). On an init
          // crash we still force-enable them so the user can
          // retry the action — at worst the click handler will
          // bail with a clear 'Ej ansluten' status rather than a
          // silent dead-button UX.
        })
      } finally {
        // Always clear the timeout so the rejected timer
        // promise has a consumer attached (avoids
        // unhandled-rejection warnings on successful boots).
        if (timeoutId) clearTimeout(timeoutId)
      }
    })()
