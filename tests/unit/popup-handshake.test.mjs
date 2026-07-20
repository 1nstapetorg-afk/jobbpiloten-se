// tests/unit/popup-handshake.test.mjs
//
// Contract locks for the v0.2.2 "Anslut din profil" auth flow in
// extension/popup.js + app/extension-auth/page.js + extension/manifest.json.
//
// Background (Round-7 spec, 2026-07-12): the extension popup used to show
// "Inte ansluten" with a dashboard-redirect CTA that required the user
// to navigate their active job-search tab to /dashboard, click
// "Anslut din profil" there, and copy the resulting token back. That was
// terrible UX — a soft-launch tester reported 4× back-button presses
// in the support inbox on day one.
//
// The v0.2.2 flow reverses the direction:
//   1. User clicks "Anslut din profil" INSIDE the extension popup.
//   2. Popup opens a small chrome.windows.create window to /extension-auth
//      on the dashboard.
//   3. /extension-auth checks the Clerk-or-demo session. If signed in:
//      POST /api/extension/token mints a 90-day bearer + profile snapshot,
//      then postMessages to window.opener with a JOBBPILOTEN_AUTH_HANDSHAKE
//      envelope. If NOT signed in: render Clerk <SignIn /> (Clerk mode)
//      or a "Logga in som demo-användare" button (demo mode).
//   4. Popup receives the handshake, validates (origin allow-list +
//      token-shape + profile-present), then writes to
//      chrome.storage.{local,sync} and re-paints as connected.
//   5. /extension-auth auto-closes the window ~700ms after a
//      successful delivery.
//
// Static-source-grep test, mirroring the project-wide idiom. Behavioural
// coverage of the network round-trip lives in tests/e2e/extension-banner
// / extension-token-ttl. The structural locks here catch regressions
// in the postMessage wiring, origin gate, and manifest CSP.
//
// This file uses .includes(literal) over assert.match(regex, …) where
// possible because the regex-escape escaping for matching source code
// patterns is brittle and has tripped up test files twice.
//
// Run via `yarn test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractStorageOnChangedBodyInWire, findFunctionOffset } from './lib/js-source-helpers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POPUP_JS_PATH = path.resolve(__dirname, '../../extension/popup.js')
const POPUP_HTML_PATH = path.resolve(__dirname, '../../extension/popup.html')
const EXT_AUTH_PATH = path.resolve(__dirname, '../../app/extension-auth/page.js')
const MANIFEST_PATH = path.resolve(__dirname, '../../extension/manifest.json')
const POPUP_JS = fs.readFileSync(POPUP_JS_PATH, 'utf-8')
const POPUP_HTML = fs.readFileSync(POPUP_HTML_PATH, 'utf-8')
const EXT_AUTH = fs.readFileSync(EXT_AUTH_PATH, 'utf-8')
const MANIFEST = fs.readFileSync(MANIFEST_PATH, 'utf-8')

// =============================================================================
// 1. "Anslut din profil" button exists in HTML + is the primary CTA
// =============================================================================

test('popup.html must include #jp-connect-btn with the Anslut din profil copy', () => {
  assert.ok(POPUP_HTML.includes('id="jp-connect-btn"'),
    'popup.html must define #jp-connect-btn (the v0.2.2 primary CTA)')
  assert.ok(POPUP_HTML.includes('Anslut din profil'),
    'popup.html must render the "Anslut din profil" copy so the user has clear Swedish context')
})

test('popup.html must include #jp-fill-btn (the Fill CTA — secondary when connected)', () => {
  assert.ok(POPUP_HTML.includes('id="jp-fill-btn"'),
    'popup.html must define #jp-fill-btn')
  assert.ok(POPUP_HTML.includes('Fyll i nu'),
    'popup.html must render the "Fyll i nu" copy')
})

test('popup.html must include #jp-disconnect-btn (Koppla från — visible when connected)', () => {
  assert.ok(POPUP_HTML.includes('id="jp-disconnect-btn"'),
    'popup.html must define #jp-disconnect-btn')
  assert.ok(POPUP_HTML.includes('Koppla från') || POPUP_HTML.includes('Koppla fr\u00e5n'),
    'popup.html must render the "Koppla från" copy')
})

// =============================================================================
// 2. Popup JS wires up the connect button click handler
// =============================================================================

test('popup.js wire() must attach a click handler on the connect button', () => {
  // The handler triggers openAuthFlow (the window-create ladder).
  // Without this listener the button does nothing — silent UX break.
  assert.ok(
    POPUP_JS.includes("addEventListener('click'"),
    'popup.js wire() must use addEventListener("click"…) somewhere — handlers exist for fill/refresh/dashboard/connect/disconnect')
  // Search via plain substring indexing rather than regex literals to avoid the
  // double-escape trap. The connect button handler looks like:
  //   connectBtn.addEventListener('click', openAuthFlow)
  // — verifying that "connectBtn" AND "openAuthFlow" both appear in the
  // wire() block is sufficient.
  // Round-74.2 (2026-07-20) — wire() was promoted to `async`
  // because its body contains `const { styleOverride } = await
  // loadStorage()` at the `if (styleSelect) { ... }` block.
  // Without `async`, Chrome MV3's module parser throws
  // `Uncaught SyntaxError: Unexpected reserved word` at
  // popup.js:2298 and the entire popup.js script crashes at
  // load time (`await` is a parser-level reserved word inside
  // a non-async function body). The shared
  // `findFunctionOffset` helper in js-source-helpers.mjs
  // centralizes the dual-shape sentinel (Math.max of the two
  // indexOf calls) so future Round-N function-shape changes
  // don't duplicate the inline pattern here. Returns the
  // offset of either `function wire()` OR `async function wire()`
  // so the wireSlice below stays anchored at the SAME line
  // regardless of which shape the source uses.
  const wireIdx = findFunctionOffset(POPUP_JS, 'wire')
  assert.ok(wireIdx > -1, 'wire() must exist (as `function wire()` or `async function wire()`)')
  const wireSlice = POPUP_JS.slice(wireIdx, wireIdx + 3000)
  assert.ok(wireSlice.includes('connectBtn'),
    'wire() must reference the connect button DOM ref')
  assert.ok(wireSlice.includes('openAuthFlow'),
    'wire() must invoke openAuthFlow on connect-button click')
})

test('popup.js openAuthFlow resolves dashboard URL via resolveEnvAuthBaseUrl() then routes to /extension-auth', () => {
  // The destination URL is environment-aware: prod, Vercel preview, or
  // localhost. Hard-coding `${PROD_BASE_URL}/extension-auth` would
  // silently strand preview-build testers.
  //
  // v0.2.3: the openAuthFlow body now calls `resolveEnvAuthBaseUrl()`
  // (the active-tab-aware wrapper) rather than `resolveDashboardUrl()`
  // directly. The wrapper internally delegates to the resolver on
  // cache-miss / no-active-tab, so the existing resolver contract
  // is preserved.
  // Slice the openAuthFlow function body via a sentinel-pair so we
  // don't depend on a regex's escape correctness.
  const marker = 'async function openAuthFlow() {'
  const openIdx = POPUP_JS.indexOf(marker)
  assert.ok(openIdx > -1, 'openAuthFlow must exist in popup.js as an async function')
  // 4000 chars comfortably covers the function body (the function is
  // small, ~80 lines incl. comments — well under 4000 chars).
  const body = POPUP_JS.slice(openIdx, openIdx + 4000)
  // Trim at the function's first standalone `}` at column 0; the
  // function ends before long-since earlier nested functions.
  const endIdx = body.indexOf('\n}\n')
  const trimmedBody = endIdx > -1 ? body.slice(0, endIdx + 2) : body
  assert.ok(trimmedBody.includes('resolveEnvAuthBaseUrl()'),
    'openAuthFlow must call resolveEnvAuthBaseUrl() (the v0.2.3 env-aware wrapper) to derive its destination URL — replaces direct resolveDashboardUrl() call')
  assert.ok(trimmedBody.includes('/extension-auth'),
    'openAuthFlow must route to /extension-auth (the bridge page that mints the bearer token)')
  assert.ok(
    !trimmedBody.includes('${PROD_BASE_URL}/extension-auth'),
    'openAuthFlow must NOT hard-code ${PROD_BASE_URL}/extension-auth — env-aware resolver required',
  )
})

test('popup.js openAuthFlow must attempt chrome.windows.create first, then chrome.tabs.create, then window.open', () => {
  // The ladder is: chrome.windows.create → chrome.tabs.create → window.open.
  // Each rung has a different permission requirement; the ladder
  // ensures ONE works for every deployment shape.
  const marker = 'async function openAuthFlow() {'
  const openIdx = POPUP_JS.indexOf(marker)
  assert.ok(openIdx > -1)
  const body = POPUP_JS.slice(openIdx, openIdx + 6000)
  const windowsIdx = body.indexOf('chrome.windows.create(')
  const tabsIdx = body.indexOf('chrome.tabs.create(')
  const openIdx2 = body.indexOf('window.open(')
  assert.ok(windowsIdx >= 0, 'openAuthFlow must try chrome.windows.create first (preferred auth-window code path)')
  assert.ok(tabsIdx >= 0, 'openAuthFlow must fall through to chrome.tabs.create if chrome.windows.create is blocked')
  assert.ok(openIdx2 >= 0, 'openAuthFlow must fall through to window.open as the final ladder rung')
  // Order — windows.create < tabs.create < window.open.
  assert.ok(windowsIdx < tabsIdx,
    'chrome.windows.create must come BEFORE chrome.tabs.create (preferred auth-window code path runs first)')
  assert.ok(tabsIdx < openIdx2,
    'chrome.tabs.create must come BEFORE window.open (chrome.tabs < window.open permission cost)')
})

test('openAuthFlow must track the auth window via authHandshakeState.windowId for close-on-delivery', () => {
  // Once the auth window posts the handshake back, the popup calls
  // chrome.windows.remove(authHandshakeState.windowId) to dismiss the
  // window promptly. Without this tracking assignment, the
  // close-on-delivery path is dead — the user sees the auth window
  // stick around.
  // The actual code reads `authHandshakeState.windowId = win && win.id != null ? win.id : null`
  // so a substring search has to be loose enough to accept the ternary.
  assert.ok(
    POPUP_JS.includes('authHandshakeState.windowId') && POPUP_JS.includes('win.id'),
    'openAuthFlow must capture win.id (guarded by a null check) into authHandshakeState.windowId so the close-on-delivery path can dismiss the auth window',
  )
})

// =============================================================================
// 3. Popup JS listens for the JOBBPILOTEN_AUTH_HANDSHAKE postMessage
// =============================================================================

test('popup.js must declare HANDSHAKE_TYPE = "JOBBPILOTEN_AUTH_HANDSHAKE" as a literal constant', () => {
  // The listener's first filter is the type. A regression that drops
  // the type check would mean ANY postMessage to the popup (including
  // from a malicious extension page nearby) would be parsed as a
  // potential handshake. Lock the symbolic constant.
  assert.ok(
    POPUP_JS.includes("HANDSHAKE_TYPE = 'JOBBPILOTEN_AUTH_HANDSHAKE'"),
    'popup.js must declare `HANDSHAKE_TYPE = "JOBBPILOTEN_AUTH_HANDSHAKE"` as a literal constant',
  )
})

test('popup.js registers a window.message listener that filters on HANDSHAKE_TYPE', () => {
  assert.ok(POPUP_JS.includes("addEventListener('message'"),
    'popup.js must register a window.message listener (the postMessage transport for the auth handshake)')
  // Filter: `if (ev.data.type !== HANDSHAKE_TYPE) return`. We use
  // substring search instead of `.match(/regex/)` to avoid the
  // escape-tar pit that bit earlier versions of this file.
  assert.ok(
    POPUP_JS.includes('ev.data.type') && POPUP_JS.includes('HANDSHAKE_TYPE'),
    'listener must check ev.data.type against HANDSHAKE_TYPE — short-circuit anything that is not our handshake',
  )
})

test('popup.js handleAuthHandshake must validate that the token is exactly 64 lowercase hex characters', () => {
  // The mint endpoint produces 64-char hex tokens (verified by
  // tests/unit/extension-token-ttl.test.mjs). The popup re-validates
  // shape on the receive side so a malformed payload is caught
  // BEFORE chrome.storage write. We pin the regex literal exactly:
  //   /^[a-f0-9]{64}$/i
  // — present in popup.js source.
  assert.ok(
    POPUP_JS.includes('a-f0-9') && POPUP_JS.includes('{64}'),
    'handleAuthHandshake must match the token against /^\\[a-f0-9\\]{64}$/i — exact-length hex shape',
  )
  // The user-facing guard: a regression that drops the validation
  // would silently ignore malformed payloads — the popup would
  // appear connected with a junk token. Lock the error message.
  assert.ok(
    POPUP_JS.includes('ogiltig token') || POPUP_JS.includes('Ogiltig token'),
    'must surface a Swedish error ("ogiltig token") when the token shape fails the regex',
  )
})

test('popup.js handleAuthHandshake must validate the origin against an allow-list before trusting the payload', () => {
  // SECURITY: the handshake is the SINGLE POSTMESSAGE trust boundary
  // in the extension. A bad origin MUST be rejected before the payload
  // is parsed. Without this gate an attacker can iframe the popup
  // on a same-origin-via-frame page and pre-complete cross-origin
  // impersonation.
  assert.ok(
    POPUP_JS.includes('allowed.includes(normalizedOrigin)'),
    'handleAuthHandshake must consult `allowed.includes(normalizedOrigin)` — origin allow-list gate',
  )
  assert.ok(
    POPUP_JS.includes('rejecting handshake from untrusted origin'),
    'handleAuthHandshake must log a security warning on origin rejection so ops can spot DNS-rebinding attempts',
  )
})

test('popup.js handleAuthHandshake must write to chrome.storage.local AND chrome.storage.sync', () => {
  // local is the read-priority for popup + content scripts. sync is
  // the cross-device mirror so the user comes back already-filled
  // when they reopen Chrome on another machine. Both writes are
  // required — without sync, a tenant who re-installs / switches
  // machines loses the connection.
  assert.ok(POPUP_JS.includes('chrome.storage.local.set('),
    'handleAuthHandshake must call chrome.storage.local.set with the token + profile (read-priority for popup + content)')
  assert.ok(POPUP_JS.includes('chrome.storage.sync.set('),
    'handleAuthHandshake must call chrome.storage.sync.set (cross-device mirror)')
})

// =============================================================================
// 4. /extension-auth page broadcasts the right envelope
// =============================================================================

test('/extension-auth page must POST /api/extension/token and postMessage a JOBBPILOTEN_AUTH_HANDSHAKE envelope', () => {
  // The bridge page is what mints the token + sends it back. Without
  // these two calls (mint + postMessage), the popup can never receive
  // a handshake and stays "Inte ansluten" forever.
  assert.ok(EXT_AUTH.includes('/api/extension/token'),
    'must POST to /api/extension/token (the mint endpoint with the 90-day TTL)')
  assert.ok(EXT_AUTH.includes("type: 'JOBBPILOTEN_AUTH_HANDSHAKE'"),
    'must emit a postMessage envelope with `type: "JOBBPILOTEN_AUTH_HANDSHAKE"` matching what the popup listens for (drift = silent UX break)')
  // Fall-through chain: window.opener → window.parent → window so a
  // hardened popup blocker that strips opener still reaches the popup.
  assert.ok(EXT_AUTH.includes('window.opener || window.parent || window'),
    'must fall through window.opener → window.parent → window so a hardened popup blocker that strips opener still reaches the popup')
})

test('/extension-auth page must auto-close the window ~700ms after successful delivery', () => {
  // Brief wait so the user sees "Ansluten" before the window
  // disappears. 700ms is enough for one paint without feeling laggy.
  assert.ok(EXT_AUTH.includes('window.close'),
    '/extension-auth must call window.close() during delivery completion')
  assert.ok(EXT_AUTH.includes('setTimeout'),
    '/extension-auth must schedule the close via setTimeout (NOT immediate — user needs ~700ms to see confirmation)')
})

test('/extension-auth page must render a Clerk sign-in widget with redirect back to /extension-auth', () => {
  // The user might open the auth window BEFORE signing in. The page
  // renders Clerk <SignIn /> with a forceRedirectUrl pointing back to
  // /extension-auth so the same page can re-run the mint flow on the
  // next render. Without the redirect URL the user lands on Clerk's
  // session page and never completes the connect handshake.
  assert.ok(
    EXT_AUTH.includes("signUpForceRedirectUrl=\"/extension-auth\""),
    'must declare `signUpForceRedirectUrl="/extension-auth"` so a Clerk sign-up completes in-window and re-triggers mint',
  )
  assert.ok(
    EXT_AUTH.includes("signInForceRedirectUrl=\"/extension-auth\""),
    'must declare `signInForceRedirectUrl="/extension-auth"` (parallel for sign-in)',
  )
})

test('/extension-auth page must offer a demo-mode "Logga in som demo-användare" fallback', () => {
  // Soft-launch deploys without Clerk keys must NOT show a broken Clerk
  // widget. The demo button sets `localStorage.demoUser`, reloads,
  // and re-runs the mint flow. Without this branch the demo-mode
  // tester sees a perpetual "Du är inte inloggad ännu" alert.
  assert.ok(EXT_AUTH.includes('Logga in som demo-anv\u00e4ndare'),
    'must render the Swedish demo-mode sign-in button copy')
})

// =============================================================================
// 5. Manifest CSP allows the build-config Tier-3 fetch + connect origins
// =============================================================================

test('manifest.json csp must include \'self\' in connect-src (Round-7 CSP fix)', () => {
  // SYMPTOM: popup.js loadBuildConfig() calls
  //   fetch(chrome.runtime.getURL(BUILD_CONFIG_FILE))
  // to read NEXT_PUBLIC_APP_URL from build-config.json. With a strict
  // connect-src list that omits 'self', this fetch is BLOCKED at the
  // CSP layer — the resolver silently falls through to Tier-4
  // (PROD_BASE_URL) on every preview branch.
  assert.ok(
    MANIFEST.includes("'self'") && /connect-src[^;]*'self'/.test(MANIFEST),
    'manifest.json connect-src must include \'self\' so the popup\'s loadBuildConfig fetch works in MV3',
  )
})

test('manifest.json connect-src must wildcard match host_permissions (Vercel preview + localhost dev)', () => {
  // Drift between the manifest allow-list and the CSP would silently
  // strand preview-build testers (browser blocks all fetch + WS calls).
  assert.ok(
    MANIFEST.includes('*.vercel.app'),
    'connect-src must include https://*.vercel.app (Vercel preview-branch allow-list parity with host_permissions)',
  )
  assert.ok(
    MANIFEST.includes('localhost'),
    'connect-src must include http://localhost:* so dev-mode extension testing works',
  )
})

test('manifest.json permissions must include "windows" for chrome.windows.create popup-window code path', () => {
  // Round-8 polish: even though openAuthFlow() has a 3-tier ladder
  // (chrome.windows.create → chrome.tabs.create → window.open), the
  // "windows" permission is the cleanest way to make the first rung
  // reliable on enterprise-managed Chrome (where the popup-blocker
  // policy is most restrictive). Without the permission declaration
  // the call returns `Promise.reject("Permission 'windows' is not
  // allowed")` — the try/catch still falls through, but every
  // soft-launch tester on a managed Chromebook skips the
  // preferred auth-window path.
  assert.ok(
    /"windows"/.test(MANIFEST),
    'extension/manifest.json permissions array must include "windows" so chrome.windows.create({type:"popup"}) works on enterprise Chrome',
  )
})

// =============================================================================
// 6. v0.2.3 — env-aware dashboard URL (preview branch support)
// =============================================================================
//
// The user reports ERR_SSL_PROTOCOL_ERROR on preview deploys because
// the auth popup opens to the hard-coded production origin
// `https://jobbpiloten.se` even when the user is on a JobbPiloten
// preview branch like `jobbpiloten-se.preview.emergentagent.com`.
// The fix threads an active-tab-aware base-URL resolver through
// every popup-initiated outbound call (openAuthFlow, loadAllowedOrigins,
// handleAuthHandshake, refreshProfile, disconnect) AND adds the
// preview domain to host_permissions + CSP connect-src. These
// tests lock the structural contracts so the next refactor can't
// silently regress to a hard-coded PROD_BASE_URL.

test('popup.js must declare resolveEnvAuthBaseUrl function (v0.2.3 env-aware wrapper)', () => {
  // Without this wrapper, the popup can't derive the preview
  // branch's origin from the active tab — it'd fall through to
  // PROD_BASE_URL_DEFAULT and the auth window opens at
  // jobbpiloten.se on a preview branch (ERR_SSL_PROTOCOL_ERROR).
  assert.ok(
    POPUP_JS.includes('async function resolveEnvAuthBaseUrl'),
    'popup.js must declare `async function resolveEnvAuthBaseUrl` as the env-aware base-URL resolver',
  )
})

test('popup.js must declare hostPatternToRegex helper for wildcard manifest matching', () => {
  // The active-tab origin must match one of the manifest's
  // host_permissions patterns (including wildcards) before being
  // adopted as the popup's base URL. Without this gate a DNS-
  // rebinding origin would silently smuggle past the resolver.
  assert.ok(
    POPUP_JS.includes('function hostPatternToRegex'),
    'popup.js must declare `hostPatternToRegex` so the active-tab origin gate can match wildcard manifest patterns',
  )
})

test('popup.js must declare isOriginInHostAllowlist helper for active-tab gate', () => {
  // Companion to hostPatternToRegex — the actual allow-list check
  // for the active-tab origin. If the function name or the
  // contract drifts (e.g. someone renames it to `isOriginAllowed`),
  // resolveEnvAuthBaseUrl() would silently never gate the active
  // tab — silent DNS-rebinding surface.
  assert.ok(
    POPUP_JS.includes('function isOriginInHostAllowlist'),
    'popup.js must declare `isOriginInHostAllowlist` so resolveEnvAuthBaseUrl can gate the active-tab origin against manifest host_permissions',
  )
})

test('resolveEnvAuthBaseUrl must consult chrome.tabs.query FIRST, then fall through to resolveDashboardUrl', () => {
  // Order matters: the active-tab path is the soft-launch preview
  // fix. If the order is reversed the resolver would always return
  // PROD_BASE_URL on a fresh popup (where storage is empty) and
  // the preview fix would be a no-op.
  const marker = 'async function resolveEnvAuthBaseUrl() {'
  const idx = POPUP_JS.indexOf(marker)
  assert.ok(idx > -1, 'resolveEnvAuthBaseUrl must exist in popup.js')
  const body = POPUP_JS.slice(idx, idx + 3000)
  const tabsIdx = body.indexOf('chrome.tabs.query(')
  const resolveIdx = body.indexOf('resolveDashboardUrl(')
  assert.ok(tabsIdx > 0, 'resolveEnvAuthBaseUrl must call chrome.tabs.query to read the active tab URL')
  assert.ok(resolveIdx > 0, 'resolveEnvAuthBaseUrl must fall through to resolveDashboardUrl when the active tab is not on a recognized origin')
  assert.ok(tabsIdx < resolveIdx,
    'chrome.tabs.query must come BEFORE resolveDashboardUrl so the active-tab path runs first (Tier A before Tier B)')
})

test('openAuthFlow must NOT call resolveDashboardUrl directly — must go through resolveEnvAuthBaseUrl', () => {
  // Direct calls to resolveDashboardUrl() in openAuthFlow would
  // bypass the active-tab gate. Lock the contract: openAuthFlow
  // goes through the wrapper, not the raw resolver.
  const marker = 'async function openAuthFlow() {'
  const idx = POPUP_JS.indexOf(marker)
  const body = POPUP_JS.slice(idx, idx + 4000)
  const endIdx = body.indexOf('\n}\n')
  const trimmed = endIdx > -1 ? body.slice(0, endIdx + 2) : body
  assert.ok(
    !trimmed.includes('resolveDashboardUrl()'),
    'openAuthFlow must NOT call resolveDashboardUrl() directly — must go through resolveEnvAuthBaseUrl (v0.2.3 contract)',
  )
})

test('popup.js refreshProfile must NOT hard-code PROD_BASE_URL/api/extension/profile', () => {
  // refreshProfile was previously `${PROD_BASE_URL}/api/extension/profile`.
  // On a preview branch the assertOriginAllowed gate accepted the
  // URL (PROD is in the allow-list as a floor) but the fetch went
  // to prod — silent 404 / DNS error. Thread through the env-aware
  // wrapper to keep the URL in lock-step with the gate.
  const marker = 'async function refreshProfile() {'
  const idx = POPUP_JS.indexOf(marker)
  assert.ok(idx > -1, 'refreshProfile must exist in popup.js')
  const body = POPUP_JS.slice(idx, idx + 3000)
  assert.ok(
    !body.includes('${PROD_BASE_URL}/api/extension/profile'),
    'refreshProfile must NOT hard-code ${PROD_BASE_URL}/api/extension/profile — must use resolveEnvAuthBaseUrl',
  )
  assert.ok(
    body.includes('resolveEnvAuthBaseUrl()'),
    'refreshProfile must call resolveEnvAuthBaseUrl() to derive the env-aware base URL',
  )
})

test('popup.js disconnect must NOT hard-code PROD_BASE_URL/api/extension/token', () => {
  // Same fix as refreshProfile: the disconnect() server revoke
  // used `${PROD_BASE_URL}/api/extension/token` directly, which
  // on a preview branch failed silently (best-effort path so
  // the local clear still ran, but the server-side audit row
  // never dropped). Threading through resolveEnvAuthBaseUrl
  // keeps the URL aligned with the gate.
  const marker = 'async function disconnect() {'
  const idx = POPUP_JS.indexOf(marker)
  assert.ok(idx > -1, 'disconnect must exist in popup.js')
  const body = POPUP_JS.slice(idx, idx + 3000)
  assert.ok(
    !body.includes('${PROD_BASE_URL}/api/extension/token'),
    'disconnect must NOT hard-code ${PROD_BASE_URL}/api/extension/token — must use resolveEnvAuthBaseUrl',
  )
  assert.ok(
    body.includes('resolveEnvAuthBaseUrl()'),
    'disconnect must call resolveEnvAuthBaseUrl() to derive the env-aware base URL',
  )
})

test('loadAllowedOrigins must consult manifest.host_permissions to expand the gate', () => {
  // The v0.2.3 contract expands loadAllowedOrigins() to include
  // EVERY concrete (non-wildcard) host_permissions pattern, not
  // just the resolved baseUrl origin. Without this expansion a
  // preview branch popup would accept handshakes from the
  // preview origin (good) but reject handshakes from a sibling
  // preview deploy on a different subdomain. Lock the manifest-
  // expansion behavior.
  const marker = 'async function loadAllowedOrigins() {'
  const idx = POPUP_JS.indexOf(marker)
  assert.ok(idx > -1, 'loadAllowedOrigins must exist in popup.js')
  const body = POPUP_JS.slice(idx, idx + 3000)
  assert.match(
    body,
    /manifest\??\.host_permissions/,
    'loadAllowedOrigins must consult chrome.runtime.getManifest().host_permissions to expand the gate beyond the resolved baseUrl',
  )
})

test('handleAuthHandshake must use loadAllowedOrigins() for its allow-list (not inline-rebuild)', () => {
  // The previous shape inlined `[PROD_BASE_URL, baseUrl.origin]`
  // — on a preview branch the auth window COULD open
  // (openAuthFlow allowed it via resolveEnvAuthBaseUrl) but its
  // postMessage would be REJECTED (handleAuthHandshake didn't
  // include the preview origin). The fix reads from
  // loadAllowedOrigins() so both sides of the gate agree.
  const marker = 'async function handleAuthHandshake'
  const idx = POPUP_JS.indexOf(marker)
  assert.ok(idx > -1, 'handleAuthHandshake must exist in popup.js')
  const body = POPUP_JS.slice(idx, idx + 3000)
  assert.ok(
    body.includes('loadAllowedOrigins()'),
    'handleAuthHandshake must consult loadAllowedOrigins() so the in-process origin allow-list matches the gate used by openAuthFlow / fetch',
  )
})

test('manifest.json host_permissions must include *.preview.emergentagent.com (v0.2.3 preview branch)', () => {
  // The popup's active-tab gate consults manifest.host_permissions;
  // the preview branch origin must be in there for the auth
  // popup to open on the preview domain. Without this entry the
  // active-tab path is silently dropped to the resolver fallback
  // (PROD_BASE_URL_DEFAULT) on every preview branch.
  const manifest = JSON.parse(MANIFEST)
  const hostPerms = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []
  assert.ok(
    hostPerms.includes('https://*.preview.emergentagent.com/*'),
    'manifest.json host_permissions must include "https://*.preview.emergentagent.com/*" so the popup can adopt the active-tab origin on a preview branch',
  )
})

test('manifest.json CSP connect-src must include *.preview.emergentagent.com (v0.2.3 preview branch)', () => {
  // Drift between host_permissions and the CSP would silently
  // block all fetch + WS calls to the preview origin even when
  // the popup is otherwise allowed to navigate to it. Lock
  // parity between the two arrays.
  const manifest = JSON.parse(MANIFEST)
  const csp = manifest.content_security_policy?.extension_pages || ''
  assert.ok(
    csp.includes('*.preview.emergentagent.com'),
    'manifest.json CSP connect-src must include "*.preview.emergentagent.com" — drift with host_permissions would silently block fetch calls',
  )
})

test('manifest.json CSP connect-src must mirror ALL host_permissions entries (no drift)', () => {
  // v0.2.3 contract: every host_permissions entry must be
  // represented in the CSP connect-src. A future refactor that
  // adds a new host_permission (e.g. a new Vercel preview
  // pattern) without updating connect-src would block all fetch
  // calls from the popup on that origin.
  const manifest = JSON.parse(MANIFEST)
  const hostPerms = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []
  const csp = manifest.content_security_policy?.extension_pages || ''
  for (const pattern of hostPerms) {
    if (!pattern || typeof pattern !== 'string') continue
    // Strip the trailing `/*` so the CSP-host check looks at the
    // bare origin, not the path. Patterns with wildcards
    // (e.g. "https://*.vercel.app/*") can be matched by the
    // host portion (e.g. ".vercel.app") in CSP form, so the
    // substring check below uses the post-strip host.
    const stripped = pattern.replace(/\/\*$/, '')
    // We accept either the full pattern OR the wildcard host
    // substring in the CSP (CSP connect-src supports wildcards
    // like *.vercel.app). Take the most-specific portion that
    // would appear in the CSP string.
    const expectedSubstr = stripped.includes('*') ? stripped.replace(/^\w+:\/\/\*/, '*') : stripped
    assert.ok(
      csp.includes(expectedSubstr),
      `manifest.json CSP connect-src must include "${expectedSubstr}" (from host_permissions entry "${pattern}") — drift blocks fetch calls`,
    )
  }
})

// =============================================================================
// 7. Round-10 — content-script-bridge delivery path
// =============================================================================
//
// 2026-07-12: window.opener is consistently null in
// chrome.windows.create({ type: 'popup' }) from an MV3 extension
// popup, so the original single-path delivery (window.opener.postMessage)
// silently failed. The fix added a second path that dispatches
// JOBBPILOTEN_AUTH_SYNC to SELF — the content script (loaded on every
// URL per the manifest's `<all_urls>` match) catches the message via
// its existing `window.message` listener and writes the token + profile
// to chrome.storage.local. The popup's chrome.storage.onChanged
// listener fires next, closing the auth window + mirroring to sync.
// These tests lock every new contract in that path.

// Round-36: brace-counting body-extraction helper for the
// `chrome.storage.onChanged.addListener(...)` callback inside the
// `wire()` function. The previous `[\s\S]*?\n\s*\}\)` regex was
// non-greedy and matched the FIRST `\n\s*})` it found — but the
// listener body has a nested `.catch((syncErr) => { ... })` whose
// closing `})` is at a different indent and matched FIRST,
// truncating the captured body before `authHandshakeState.windowId`
// was reached. The brace-counting version walks from the opening
// `{` to its matching `}` so nested blocks don't fool it.
//
// Anchor on `function wire()` FIRST because popup.js has TWO
// `chrome.storage.onChanged.addListener` calls: one in `wire()`
// (the auth-bridge close-window + sync-mirror logic we want) and
// one in `setupComposePanel()` (a short 3-line listener that
// re-renders the email compose panel on signal changes). Without
// the wire() anchor, the helper returns the compose panel's body
// (a 156-char slice that doesn't reference authHandshakeState at
// all) and both tests fail with "must reference authHandshakeState
// .windowId". Returns the full body string (including the outer
// braces) or null if no listener is found.
// Round-48: dead helper removed — extracted to shared module
// `tests/unit/lib/js-source-helpers.mjs`. All callers in this file now
// use `extractStorageOnChangedBodyInWire` (imported above).

test('/extension-auth page must dispatch BOTH JOBBPILOTEN_AUTH_HANDSHAKE AND JOBBPILOTEN_AUTH_SYNC (content-script-bridge round-trip)', () => {
  // The Round-10 fix added a second `window.postMessage` dispatch
  // with type `JOBBPILOTEN_AUTH_SYNC` and a `payload: { token,
  // profile, expiresAt }` shape. The content script's
  // `handleAuthSync` listener (which already exists at the top
  // of extension/content.js) is the bridge that writes to
  // chrome.storage.local — the popup's storage.onChanged listener
  // then closes the auth window. The opener path stays as a
  // redundant fast-path so a future Chrome build that DOES
  // set window.opener on MV3 popups can use it without a code
  // change. A regression that drops the bridge dispatch leaves
  // the popup stuck on "Inte ansluten" forever.
  assert.ok(
    EXT_AUTH.includes("type: 'JOBBPILOTEN_AUTH_HANDSHAKE'"),
    'must dispatch the existing JOBBPILOTEN_AUTH_HANDSHAKE envelope (opener fast-path)',
  )
  assert.ok(
    EXT_AUTH.includes("type: 'JOBBPILOTEN_AUTH_SYNC'"),
    'must dispatch a new JOBBPILOTEN_AUTH_SYNC envelope (content-script bridge path)',
  )
  // The bridge envelope MUST carry `payload: { token, profile, ... }`
  // — the content script's `handleAuthSync` reads `payload.token` +
  // `payload.profile` and writes them straight to chrome.storage.local.
  // A regression that flattens the shape (e.g. `token: json.token`
  // at the top level instead of under `payload`) silently breaks
  // the bridge and reverts the bug.
  assert.ok(
    /payload\s*:\s*\{[\s\S]*?token\s*:\s*json\.token[\s\S]*?profile\s*:\s*json\.profile/.test(EXT_AUTH),
    'the JOBBPILOTEN_AUTH_SYNC envelope must wrap token + profile in a `payload: {...}` object so the content script\'s handleAuthSync(payload) signature matches',
  )
})

test('popup.js storage.onChanged must close auth window when a new token lands during a pending handshake', () => {
  // The Round-10 fix moved the close-auth-window logic from
  // handleAuthHandshake (which only fires on the direct
  // postMessage path) into the storage.onChanged listener
  // (which fires on BOTH delivery paths: direct + bridge).
  // The gate is `newToken && authHandshakeState.windowId != null`
  // — NOT `newValue && !oldValue`, which fails on re-connects
  // (the new token replaces the old, both truthy, the !oldValue
  // clause becomes false, and the 30s timer keeps running).
  // Lock both the listener existence AND the windowId-based gate
  // so a future refactor that reverts to the narrow !oldValue
  // gate is caught.
  //
  // Round-36 fix: use the brace-counting helper (above) instead
  // of the previous non-greedy regex. The non-greedy match cut
  // off at the first inner `})` (the .catch() close) and never
  // saw the authHandshakeState.windowId reference that lives in
  // the outer listener body.
  const body = extractStorageOnChangedBodyInWire(POPUP_JS)
  assert.ok(body != null, 'popup.js must register a chrome.storage.onChanged listener')
  assert.ok(
    body.includes('authHandshakeState.windowId'),
    'storage.onChanged must reference authHandshakeState.windowId (the close-window + clear-timer gate)',
  )
  // The windowId-based gate: windowId != null + newToken present.
  // We substring-search for the gate shape so a future refactor
  // that drops back to `!oldValue` is caught.
  assert.ok(
    /newToken\s*&&\s*authHandshakeState\.windowId\s*!=\s*null/.test(body),
    'storage.onChanged must gate on `newToken && authHandshakeState.windowId != null` (NOT `!oldValue` which fails on re-connects)',
  )
  // The narrow-gate regression: explicitly forbid the old
  // `!oldValue` check that the bug was. A future refactor that
  // re-introduces this would silently fail on re-connects.
  assert.doesNotMatch(
    body,
    /newToken\s*&&\s*!?\s*oldValue|newToken\s*&&\s*!?\s*oldToken/,
    'storage.onChanged must NOT gate on `!oldValue` / `!oldToken` — re-connects have both truthy and would never close',
  )
})

test('popup.js storage.onChanged must mirror local → sync for bridge-delivered tokens', () => {
  // The Round-10 fix added a `chrome.storage.sync.set` call in
  // the storage.onChanged listener — the direct postMessage
  // path's handleAuthHandshake already writes to sync, but
  // the bridge path's content-script `writeStorage` only
  // writes to local. Without this mirror, a token delivered
  // via the bridge would NOT sync cross-device — a regression
  // from the user's explicit requirement.
  //
  // Round-36 fix: use the brace-counting helper. The body it
  // returns now covers the ENTIRE storage.onChanged callback,
  // not just the first inner block.
  const body = extractStorageOnChangedBodyInWire(POPUP_JS)
  assert.ok(body != null, 'popup.js must register a chrome.storage.onChanged listener')
  // The sync mirror must fire INSIDE the same gated block (so
  // it only runs on a fresh-token-during-handshake event, not
  // on profile refreshes or dashboardUrl writes).
  assert.ok(
    /chrome\.storage\.sync\.set\([\s\S]*?STORAGE_KEYS\.token/.test(body),
    'storage.onChanged must call chrome.storage.sync.set with STORAGE_KEYS.token (mirror bridge-path tokens for cross-device resume)',
  )
  assert.ok(
    /chrome\.storage\.sync\.set\([\s\S]*?STORAGE_KEYS\.profile/.test(body),
    'storage.onChanged must also mirror the profile in the sync.set payload (cross-device resume needs both fields)',
  )
  // The sync mirror must be wrapped in .catch (best-effort)
  // so a sync-disabled enterprise Chrome policy doesn't break
  // the local-only flow.
  assert.ok(
    /\.catch\(\(syncErr\)\s*=>\s*\{[\s\S]*?non-fatal/.test(body) || /\.catch\(\(syncErr\)\s*=>\s*\{[\s\S]*?console\.warn/.test(body),
    'storage.onChanged sync mirror must be best-effort (catch + console.warn) so a sync-disabled Chrome does not break the local flow',
  )
})
