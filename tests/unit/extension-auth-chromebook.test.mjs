// tests/unit/extension-auth-chromebook.test.mjs
//
// Regression locks for the 2026-08-02 Chromebook blank-tab fix in
// extension/popup.js ("Anslut din profil" opened a completely blank
// tab).
//
// ROOT CAUSE: resolveEnvAuthBaseUrl() Tier A adopted the ACTIVE TAB's
// origin whenever it matched the manifest host_permissions list. That
// list legitimately includes webmail + job-board hosts for the
// content-script fetch paths (mail.google.com, outlook.*,
// arbetsformedlingen.se, blocket.se). So clicking "Anslut din profil"
// while browsing a job site opened
//   https://www.arbetsformedlingen.se/extension-auth  → blank page
// On a Chromebook (a device commonly used for job-hunting on those
// hosts) the symptom was a "completely blank new tab".
//
// FIX LOCKED HERE:
//   1. Tier A now gates on isJobbPilotenAppOrigin() — a dedicated
//      allowlist of JobbPiloten DEPLOYMENT origins only.
//   2. openAuthFlow() has a fail-closed origin guard (refuses to open
//      a non-JobbPiloten URL).
//   3. openAuthFlow() prefers chrome.tabs.create on ChromeOS (popup
//      windows can render blank on Chrome OS).
//   4. Step-by-step AUTH-DEBUG logging is present in popup.js +
//      app/extension-auth/page.js.
//
// Strategy: static source locks (matching the repo's popup-resolver
// test culture) PLUS a behavioral vm test that evaluates the actual
// hostPatternToRegex + isJobbPilotenAppOrigin functions extracted
// from popup.js against a fixture origin matrix.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { sliceFunctionBody, nextNonStringOrComment } from './lib/js-source-helpers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POPUP_JS_PATH = path.resolve(__dirname, '../../extension/popup.js')
const POPUP_JS = fs.readFileSync(POPUP_JS_PATH, 'utf-8')
const EXT_AUTH_PATH = path.resolve(__dirname, '../../app/extension-auth/page.js')
const EXT_AUTH_JS = fs.readFileSync(EXT_AUTH_PATH, 'utf-8')

// =============================================================================
// 1. The app-origin allowlist must NOT contain job-board / webmail hosts
// =============================================================================

test('isJobbPilotenAppOrigin is declared and gated on a JobbPiloten-only allowlist', () => {
  assert.ok(
    POPUP_JS.includes('function isJobbPilotenAppOrigin'),
    'popup.js must declare `isJobbPilotenAppOrigin` (the active-tab gate for resolveEnvAuthBaseUrl Tier A)',
  )
  assert.ok(
    POPUP_JS.includes('JOBBPILOTEN_APP_ORIGIN_PATTERNS'),
    'popup.js must declare `JOBBPILOTEN_APP_ORIGIN_PATTERNS` — the explicit JobbPiloten deployment origins',
  )
})

test('JOBBPILOTEN_APP_ORIGIN_PATTERNS must exclude mail/job-board hosts that caused the blank tab', () => {
  // The manifest host_permissions legitimately includes these (for the
  // content-script fetch paths). If any of them leaks into the app
  // allowlist, Tier A can adopt e.g. arbetsformedlingen.se as the base
  // URL and open `<jobsite>/extension-auth` → blank tab.
  //
  // Scoped to the array literal ONLY (not the whole file): the same
  // hosts appear legitimately in host_permissions + CSP-parity
  // comments elsewhere in popup.js.
  const patternsSrc = POPUP_JS.slice(
    POPUP_JS.indexOf('const JOBBPILOTEN_APP_ORIGIN_PATTERNS = ['),
    POPUP_JS.indexOf('function isJobbPilotenAppOrigin'),
  )
  for (const leaked of ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'arbetsformedlingen.se', 'blocket.se']) {
    assert.ok(
      !patternsSrc.includes(leaked),
      `JOBBPILOTEN_APP_ORIGIN_PATTERNS must NOT include ${leaked} — it was added to host_permissions for content-script fetches, not as a JobbPiloten deployment origin`,
    )
  }
})

test('JOBBPILOTEN_APP_ORIGIN_PATTERNS must include the real deployment origins', () => {
  for (const origin of ['https://jobbpiloten.se', 'https://*.vercel.app', 'https://*.preview.emergentagent.com', 'https://*.preview.app.github.dev', 'https://*.app.github.dev', 'http://localhost:*']) {
    assert.ok(
      POPUP_JS.includes(origin),
      `JOBBPILOTEN_APP_ORIGIN_PATTERNS must include ${origin} — the popup must keep working on prod / preview / localhost / Codespaces`,
    )
  }
})

test('resolveEnvAuthBaseUrl Tier A must gate the active tab on isJobbPilotenAppOrigin', () => {
  const marker = 'async function resolveEnvAuthBaseUrl() {'
  const idx = POPUP_JS.indexOf(marker)
  assert.ok(idx > -1, 'resolveEnvAuthBaseUrl must exist')
  const body = POPUP_JS.slice(idx, idx + 8000)
  assert.ok(
    body.includes('isJobbPilotenAppOrigin(tabOrigin)'),
    'Tier A must call isJobbPilotenAppOrigin(tabOrigin) — the Chromebook blank-tab root-cause fix',
  )
  assert.ok(
    !body.includes('isOriginInHostAllowlist'),
    'Tier A must NOT use the old host_permissions-wide allowlist gate',
  )
})

// =============================================================================
// 2. openAuthFlow fail-closed guard + ChromeOS tab-first strategy
// =============================================================================

test('openAuthFlow must fail closed on a non-JobbPiloten origin (never open a blank tab)', () => {
  const marker = 'async function openAuthFlow() {'
  const idx = POPUP_JS.indexOf(marker)
  assert.ok(idx > -1)
  const body = POPUP_JS.slice(idx, idx + 9000)
  assert.ok(
    body.includes('isJobbPilotenAppOrigin(authOrigin)'),
    'openAuthFlow must validate the resolved URL origin via isJobbPilotenAppOrigin before opening anything',
  )
  assert.ok(
    body.includes('ogiltig adress'),
    'openAuthFlow must surface a Swedish "ogiltig adress" error when the origin guard trips',
  )
})

test('openAuthFlow must prefer chrome.tabs.create on ChromeOS (popup windows can render blank)', () => {
  const marker = 'async function openAuthFlow() {'
  const idx = POPUP_JS.indexOf(marker)
  assert.ok(idx > -1)
  const body = POPUP_JS.slice(idx, idx + 9000)
  assert.ok(
    body.includes('detectChromeOS()'),
    'openAuthFlow must call detectChromeOS() to branch the window-opening strategy',
  )
  // ChromeOS branch: skip windows.create, fall through to tabs.create.
  assert.ok(
    body.includes("if (!isChromeOS)") || body.includes('if (!isChromeOS)'),
    'openAuthFlow must skip the windows.create rung on ChromeOS',
  )
  // The ladder must still exist for non-ChromeOS platforms.
  assert.ok(body.includes('chrome.windows.create('), 'windows.create rung must remain for desktop')
  assert.ok(body.includes('chrome.tabs.create('), 'tabs.create rung must remain as the ChromeOS / fallback path')
  assert.ok(body.includes('window.open('), 'window.open rung must remain as the final fallback')
})

test('openAuthFlow must write step-2 (URL) and step-3 (opened) debug records', () => {
  const marker = 'async function openAuthFlow() {'
  const idx = POPUP_JS.indexOf(marker)
  assert.ok(idx > -1)
  const body = POPUP_JS.slice(idx, idx + 9000)
  assert.ok(body.includes("pushAuthDebug('step1-clicked'"), 'step 1 (clicked) debug record required')
  assert.ok(body.includes("pushAuthDebug('step2-url'"), 'step 2 (resolved URL) debug record required')
  assert.ok(
    body.includes('step3-opened') || body.includes('step3-opened-window') || body.includes('step3-opened-tab'),
    'step 3 (window/tab opened) debug record required',
  )
})

// =============================================================================
// 3. Handshake + storage debug trail (steps 4–5)
// =============================================================================

test('handleAuthHandshake must record step 4 (handshake) and step 5 (stored)', () => {
  assert.ok(
    POPUP_JS.includes("pushAuthDebug('step4-handshake'"),
    'handleAuthHandshake must log the handshake arrival (step 4)',
  )
  assert.ok(
    POPUP_JS.includes("pushAuthDebug('step5-stored'"),
    'handleAuthHandshake must log the storage write (step 5)',
  )
  assert.ok(
    POPUP_JS.includes("AUTH_DEBUG_KEY = 'jobbpiloten_auth_debug'"),
    'the debug trail must be persisted under jobbpiloten_auth_debug in chrome.storage.local',
  )
})

// =============================================================================
// 4. Callback page (extension-auth) must log its own lifecycle steps
// =============================================================================

test('extension-auth page must log step a (loaded) and step b (session state)', () => {
  assert.ok(
    EXT_AUTH_JS.includes("[extension-auth] step a: page loaded"),
    'the /extension-auth callback page must log its own page-load (step a)',
  )
  assert.ok(
    EXT_AUTH_JS.includes('[extension-auth] step b:'),
    'the /extension-auth callback page must log the session-check result (step b)',
  )
})

// =============================================================================
// 5. BEHAVIORAL — extract the real functions from popup.js and run the
//    origin matrix through them (no mocks of the gate itself).
// =============================================================================

function extractAppOriginPatterns(source) {
  // findBalancedBraceEnd balances {} only, so we balance [] locally
  // (skipping strings/comments via the shared nextNonStringOrComment).
  const marker = 'const JOBBPILOTEN_APP_ORIGIN_PATTERNS = ['
  const start = source.indexOf(marker)
  assert.ok(start > -1, 'JOBBPILOTEN_APP_ORIGIN_PATTERNS literal must exist')
  // The marker itself ends with the array's opening `[` — use it
  // directly (a fresh indexOf for `[` would find a LATER bracket).
  const braceIdx = start + marker.length - 1
  assert.equal(source[braceIdx], '[', 'marker must end at the opening bracket')
  let depth = 0
  let i = braceIdx
  while (i < source.length) {
    i = nextNonStringOrComment(source, i)
    if (i >= source.length) break
    const ch = source[i]
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) {
        return vm.runInNewContext(source.slice(braceIdx, i + 1))
      }
    }
    i++
  }
  throw new Error('closing bracket of JOBBPILOTEN_APP_ORIGIN_PATTERNS not found')
}

test('behavioral: isJobbPilotenAppOrigin admits only JobbPiloten deployment origins', () => {
  const patterns = extractAppOriginPatterns(POPUP_JS)
  const hostFn = sliceFunctionBody(POPUP_JS, 'hostPatternToRegex')
  const gateFn = sliceFunctionBody(POPUP_JS, 'isJobbPilotenAppOrigin')
  assert.ok(hostFn && gateFn, 'both helper functions must be extractable')

  const sandbox = {
    JOBBPILOTEN_APP_ORIGIN_PATTERNS: patterns,
    RegExp,
    __result: null,
  }
  vm.createContext(sandbox)
  vm.runInContext(`${hostFn}\n${gateFn}\n__result = isJobbPilotenAppOrigin`, sandbox)
  const isApp = sandbox.__result

  // Allowed — real deployment origins.
  for (const ok of [
    'https://jobbpiloten.se',
    'https://jobbpiloten.se/extension-auth',
    'https://x.vercel.app',
    'https://jobbpiloten-se.preview.emergentagent.com',
    // Round-91 — BOTH Codespaces domains must pass the gate: the
    // pre-2023 `*.preview.app.github.dev` AND the current
    // `*.app.github.dev` (GitHub migrated in Aug 2023).
    'https://jobbpiloten-se.preview.app.github.dev',
    'https://jobbpiloten-se-3000.app.github.dev',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]) {
    assert.equal(isApp(ok), true, `${ok} must be a JobbPiloten app origin`)
  }

  // Rejected — the hosts that caused the blank tab + random origins.
  for (const bad of [
    'https://www.arbetsformedlingen.se',
    'https://mail.google.com',
    'https://outlook.live.com',
    'https://outlook.office.com',
    'https://www.blocket.se',
    'https://evil.example.com',
    'https://jobbpiloten.se.evil.com',
  ]) {
    assert.equal(isApp(bad), false, `${bad} must NOT be treated as a JobbPiloten app origin`)
  }
})

test('behavioral: hostPatternToRegex still matches the manifest wildcard semantics', () => {
  const hostFn = sliceFunctionBody(POPUP_JS, 'hostPatternToRegex')
  const sandbox = { RegExp, __result: null }
  vm.createContext(sandbox)
  vm.runInContext(`${hostFn}\n__result = hostPatternToRegex`, sandbox)
  const toRe = sandbox.__result

  assert.ok(toRe('https://jobbpiloten.se/*').test('https://jobbpiloten.se'))
  assert.ok(toRe('https://jobbpiloten.se/*').test('https://jobbpiloten.se/extension-auth'))
  assert.ok(toRe('https://*.vercel.app/*').test('https://my-preview.vercel.app'))
  assert.ok(!toRe('https://jobbpiloten.se/*').test('https://evil.example.com'))
})
