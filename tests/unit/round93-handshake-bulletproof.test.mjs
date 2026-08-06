// tests/unit/round93-handshake-bulletproof.test.mjs
//
// Round-93 — extension handshake bulletproofing. The connect flow was
// failing client-side even though POST /api/extension/token returned
// 200 (the token was minted but never reached chrome.storage.local —
// the postMessage delivery raced the content-script injection).
//
// This suite locks the four bulletproofing pillars:
//   1. VERSION DETECTION — manifest `x_jp_version` + /api/extension/version
//      endpoint + popup footer stamp + the yellow "Uppdatering
//      tillgänglig" banner (stale-install detection).
//   2. MULTI-PATH DELIVERY — Path B (jp_ext_token cookie fallback),
//      Path C (2 s storage poll with 30 s timeout), Path D (manual
//      token paste under Avancerat).
//   3. DIAGNOSTICS — the 🔬 Diagnostik panel aggregates version /
//      dashboard URL / origin patterns / storage / last error and
//      has a Kopiera button.
//   4. INJECTION RACE + HEARTBEAT — content.js consumes
//      window.__JPPENDING_TOKEN + the cookie immediately on
//      injection, and pings JOBBPILOTEN_CONTENT_ALIVE every 5 s.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'extension/popup.js'), 'utf-8')
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'extension/popup.html'), 'utf-8')
const CONTENT_JS = fs.readFileSync(path.join(ROOT, 'extension/content.js'), 'utf-8')
const DASHBOARD_JS = fs.readFileSync(path.join(ROOT, 'app/dashboard/page.js'), 'utf-8')
const VERSION_ROUTE = fs.readFileSync(path.join(ROOT, 'app/api/extension/version/route.js'), 'utf-8')
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf-8'))

const XP_VERSION = '1.0.0-93'

// =============================================================================
// 1. Version detection
// =============================================================================

test('Round-93: manifest.json declares x_jp_version build tag', () => {
  assert.equal(MANIFEST.x_jp_version, XP_VERSION,
    'manifest.json must declare "x_jp_version" matching the popup BUILD_VERSION — the popup update-check reads this')
})

test('Round-93: popup.js BUILD_VERSION matches the manifest x_jp_version', () => {
  const m = POPUP_JS.match(/const BUILD_VERSION\s*=\s*'([^']+)'/)
  assert.ok(m, 'popup.js must declare `const BUILD_VERSION`')
  assert.equal(m[1], XP_VERSION,
    'BUILD_VERSION must equal manifest x_jp_version — drift makes the stale-install check always fire')
})

test('Round-93: /api/extension/version reads x_jp_version from manifest.json', () => {
  assert.ok(VERSION_ROUTE.includes('extension/manifest.json'),
    'the version route must read extension/manifest.json at runtime (no hard-coded drift source)')
  assert.ok(VERSION_ROUTE.includes('x_jp_version'),
    'the route must read the manifest x_jp_version field')
  assert.ok(VERSION_ROUTE.includes('no-store'),
    'the route must set Cache-Control: no-store so a re-installed extension sees the fresh version')
})

test('Round-93: popup renders the version stamp in the footer', () => {
  assert.ok(POPUP_HTML.includes('id="jp-footer-version"'),
    'popup.html must define #jp-footer-version (small gray footer stamp)')
  assert.ok(POPUP_JS.includes('renderFooterVersion()'),
    'popup.js must call renderFooterVersion() at boot')
  assert.ok(/v\$\{BUILD_VERSION\}/.test(POPUP_JS),
    'renderFooterVersion must stamp `v${BUILD_VERSION}` into the footer')
})

test('Round-93: popup has the stale-install update banner + checks /api/extension/version', () => {
  assert.ok(POPUP_HTML.includes('id="jp-update-banner"'),
    'popup.html must define #jp-update-banner (the yellow reload warning)')
  assert.ok(POPUP_HTML.includes('Uppdatering tillgänglig. Gå till chrome://extensions och klicka Uppdatera.'),
    'the banner copy must steer the user to chrome://extensions → Reload (unpacked extensions never auto-update)')
  assert.ok(POPUP_JS.includes('/api/extension/version'),
    'popup.js must fetch ${DASHBOARD_URL}/api/extension/version for the stale-install check')
  assert.ok(POPUP_JS.includes('checkForUpdate()'),
    'popup.js must call checkForUpdate() at boot')
  assert.ok(POPUP_JS.includes('banner.hidden = false'),
    'the update check must reveal the banner on version mismatch')
})

test('Round-93: version constants stay in sync across content.js + background.js', () => {
  assert.ok(CONTENT_JS.includes("return '1.0.0-93'"),
    'content.js getExtensionVersion() must return the same build tag (dashboard feature-gating reads it)')
  assert.ok(fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf-8').includes("'1.0.0-93'"),
    'background.js JOBBPILOTEN_EXTENSION_VERSION must match the build tag (install-time stamp)')
})

// =============================================================================
// 2. Multi-path token delivery
// =============================================================================

test('Round-93 Path B: dashboard sets the jp_ext_token cookie after minting', () => {
  assert.ok(DASHBOARD_JS.includes('jp_ext_token='),
    'the dashboard connectExtension must set a `jp_ext_token=` cookie as the postMessage fallback')
  assert.ok(DASHBOARD_JS.includes('max-age=60'),
    'the cookie must be short-lived (60 s) to bound the exposure window')
  assert.ok(DASHBOARD_JS.includes('SameSite=Strict'),
    'the cookie must be SameSite=Strict (same-origin delivery only)')
})

test('Round-93 Path B: content.js consumes the cookie on injection', () => {
  assert.ok(CONTENT_JS.includes('jp_ext_token'),
    'content.js must read the jp_ext_token cookie')
  assert.ok(CONTENT_JS.includes('watchForPendingToken()'),
    'content.js must start watchForPendingToken() on bootstrap')
  assert.ok(CONTENT_JS.includes('consumePendingToken()'),
    'content.js must define consumePendingToken()')
  assert.ok(CONTENT_JS.includes('/api/extension/profile'),
    'consumePendingToken must recover the full profile via the token so storage ends up complete')
  assert.ok(CONTENT_JS.includes('max-age=0'),
    'consumePendingToken must clear the cookie after consuming it (one-shot semantics)')
})

test('Round-93 Task 4: content.js consumes the pending-token DOM attribute (injection race)', () => {
  // MV3 content scripts run in an ISOLATED world — page-world JS
  // globals like window.__JPPENDING_TOKEN are invisible to them,
  // but DOM attributes are shared across worlds. The dashboard
  // writes BOTH mirrors; content.js reads the DOM attribute (the
  // one that actually reaches it) and keeps the window mirror for
  // spec parity.
  assert.ok(CONTENT_JS.includes('__JPPENDING_TOKEN'),
    'content.js must reference window.__JPPENDING_TOKEN (spec parity — the dashboard writes it)')
  assert.ok(CONTENT_JS.includes("getAttribute('data-jp-pending-token')"),
    'content.js must read the data-jp-pending-token DOM attribute — the ONLY cross-world-visible mirror (page JS globals are invisible in the isolated content-script world)')
  assert.ok(CONTENT_JS.includes("removeAttribute('data-jp-pending-token')"),
    'consumePendingToken must clear the DOM attribute after consuming it (one-shot semantics)')
  assert.ok(DASHBOARD_JS.includes('__JPPENDING_TOKEN'),
    'the dashboard must set window.__JPPENDING_TOKEN after minting (mirror for late-injected content scripts)')
  assert.ok(DASHBOARD_JS.includes("setAttribute('data-jp-pending-token'"),
    'the dashboard must ALSO write the data-jp-pending-token DOM attribute so the isolated-world content script can read it')
  assert.ok(CONTENT_JS.includes('delays'),
    'watchForPendingToken must retry across the cookie lifetime (document_start injection is too early for a React-set cookie)')
})

test('Round-93 Path C: popup polls chrome.storage.local for the token every 2 s', () => {
  assert.ok(POPUP_JS.includes('authHandshakeState.poll'),
    'popup.js must track the polling handle on authHandshakeState')
  assert.ok(/setInterval\(async \(\) => \{[\s\S]*?2000\)/.test(POPUP_JS),
    'the poll must run on a 2000 ms interval')
  assert.ok(POPUP_JS.includes('chrome.storage.local.get(STORAGE_KEYS.token)'),
    'the poll must watch chrome.storage.local for the token key')
  assert.ok(POPUP_JS.includes('chrome.windows.remove(authHandshakeState.windowId)'),
    'the poll must auto-close the auth window the moment the token lands')
  assert.ok(POPUP_JS.includes('step6-poll-detected'),
    'the poll must record its success in the auth-debug trail')
})

test('Round-93 Path C: poll is bounded by the existing 30 s timeout', () => {
  assert.ok(POPUP_JS.includes('AUTH_HANDSHAKE_TIMEOUT_MS'),
    'the poll shares the existing AUTH_HANDSHAKE_TIMEOUT_MS (30 s) lifecycle')
  assert.ok(POPUP_JS.includes('Anslutningen tog för länge — försök igen eller öppna Dashboard manuellt.'),
    'the 30 s timeout must surface the user-facing Swedish timeout error')
})

test('Round-93 Path D: Avancerat manual token paste section exists + validates format', () => {
  assert.ok(POPUP_HTML.includes('id="jp-advanced"'),
    'popup.html must define the hidden Avancerat section')
  assert.ok(POPUP_HTML.includes('id="jp-advanced-token-input"'),
    'the section must contain the token textarea')
  assert.ok(POPUP_JS.includes("const TOKEN_HEX_RE = /^[a-f0-9]{64}$/i"),
    'popup.js must validate the pasted token as 64-hex before storing')
  assert.ok(POPUP_JS.includes('saveManualToken'),
    'popup.js must define + wire saveManualToken')
})

test('Round-93 Path D: manual paste completes the connection (profile fetch + verified status)', () => {
  // The connected gate is `token && profile` — storing the token
  // alone leaves the pill on "Inte ansluten". saveManualToken must
  // call refreshProfile() so the profile lands and the status flips.
  assert.ok(POPUP_JS.includes('await refreshProfile()'),
    'saveManualToken must call refreshProfile() after storing the token (fetches the profile with the bearer → flips to Ansluten)')
  assert.ok(POPUP_JS.includes('Token sparad och verifierad — ansluten.'),
    'a surviving token after refreshProfile must surface the verified-connected status')
  assert.ok(POPUP_JS.includes('Token ogiltig eller profil saknas — anslut via Dashboard istället.'),
    'a cleared token (server rejected it) must surface the invalid-token error copy')
})

test('Round-93 Path C: the 30 s timeout must stop the 2 s poll (no interval leak)', () => {
  // The poll clears on: direct handshake, storage.onChanged, poll
  // self-success. The timeout path was the missing one — an orphan
  // interval polled storage forever.
  assert.ok(POPUP_JS.includes('clearInterval(authHandshakeState.poll)'),
    'the timeout callback must clearInterval(authHandshakeState.poll) so a timed-out wait stops polling')
})

// =============================================================================
// 3. Diagnostics panel
// =============================================================================

test('Round-93: Diagnostik panel aggregates the connect-flow state', () => {
  assert.ok(POPUP_HTML.includes('id="jp-diagnostics"'),
    'popup.html must define the diagnostics panel')
  assert.ok(POPUP_HTML.includes('id="jp-diagnostics-pre"'),
    'the panel must contain the <pre> summary block')
  assert.ok(POPUP_HTML.includes('id="jp-diagnostics-copy-btn"'),
    'the panel must have a Kopiera diagnostik button')
  assert.ok(POPUP_JS.includes('populateDiagnostics()'),
    'popup.js must define populateDiagnostics()')
  assert.ok(POPUP_JS.includes('Dashboard-URL'),
    'the panel must show the resolved dashboard URL')
  assert.ok(POPUP_JS.includes('Origin-mönster'),
    'the panel must list the manifest origin patterns')
  assert.ok(POPUP_JS.includes('Senaste auth-steg'),
    'the panel must show the last auth-debug step (last error context)')
  assert.ok(POPUP_JS.includes('navigator.clipboard.writeText'),
    'Kopiera diagnostik must serialize the panel to the clipboard')
  assert.ok(POPUP_JS.includes('setupBridgeAliveListener()'),
    'popup.js must mount the bridge-liveness listener at boot')
})

// =============================================================================
// 4. Bridge heartbeat
// =============================================================================

test('Round-93: content.js pings JOBBPILOTEN_CONTENT_ALIVE every 5 s', () => {
  assert.ok(CONTENT_JS.includes("type: 'JOBBPILOTEN_CONTENT_ALIVE'"),
    'content.js must send the content_script_alive runtime message')
  assert.ok(/setInterval\(ping, 5000\)/.test(CONTENT_JS),
    'the bridge ping must run on a 5000 ms interval')
  assert.ok(CONTENT_JS.includes('startBridgePing()'),
    'content.js must start the bridge ping on bootstrap')
})

test('Round-93: popup records the bridge ping for the diagnostics panel', () => {
  assert.ok(POPUP_JS.includes("type === 'JOBBPILOTEN_CONTENT_ALIVE'"),
    'popup.js must listen for the content-alive message')
  assert.ok(POPUP_JS.includes('lastBridgePingAt'),
    'popup.js must track the last bridge ping timestamp')
  assert.ok(POPUP_JS.includes('Bridge:'),
    'the diagnostics panel must report bridge liveness')
})
