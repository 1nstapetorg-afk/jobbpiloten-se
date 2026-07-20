// tests/unit/popup-resolver.test.mjs
//
// Contract locks for extension/popup.js AND the v0.2.1 pure-module
// extraction extension/lib/dashboard-url-resolver.js.
//
// Strategy mirrors tests/unit/extension-content.test.mjs: static
// regex over the file source. The earlier draft tried vm.SourceTextModule
// + stubbed chrome.* globals, but Node's vm + ES2020+ chrome.* mocks
// became brittle across versions (the project abandoned that path in
// favour of static checks; see extension-content.test.mjs preamble).
// The static checks catch the regressions that matter — wrong tier
// order, missing sync.set, dropped wildcard skip — without paying
// the maintenance cost of a vm sandbox.
//
// BEHAVIORAL coverage of the tier chain lives in the companion
// tests/unit/dashboard-url-resolver.test.mjs (real dep-injected
// execution). These static locks stay as the structural regression
// barrier behind the behavioral tests.
//
// Run via `yarn test:unit`.
//
// 2026-07-11: added as part of the env-aware-resolver followup bundle.
// Final tally: 16 contract locks (10 on popup.js SOURCE, 6 on the
// pure-module RESOLVER_SOURCE). Combined with the 38 behavioral
// tests in dashboard-url-resolver.test.mjs (27 tier-coverage +
// 11 defensive parseValidOrigin cases), total under tests/unit
// is now 49 + 16 + 38 = **103 tests**.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sliceFunctionBody } from './lib/js-source-helpers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.resolve(__dirname, '../../extension/popup.js')
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf-8')
// v0.2.1 refactor: the 4-tier resolver chain itself lives in the
// pure module extension/lib/dashboard-url-resolver.js so it can
// be exercised in Node --test without stubbing the chrome runtime.
// popup.js still owns STORAGE_KEYS, PROD_BASE_URL, the wrapper,
// and the settings-panel wiring — those locks stay on SOURCE.
// Tests that pin the resolver's TIER chain, build-config reading,
// and wildcard-skip logic read from RESOLVER_SOURCE. The slice /
// brace helpers (sliceFunctionBody, etc) operate on either source.
const RESOLVER_SOURCE_PATH = path.resolve(__dirname, '../../extension/lib/dashboard-url-resolver.js')
const RESOLVER_SOURCE = fs.readFileSync(RESOLVER_SOURCE_PATH, 'utf-8')

// ---------- helpers (Round-48: imported from shared module) ----------
//
// sliceFunctionBody now lives in tests/unit/lib/js-source-helpers.mjs.
// The full implementation (brace balancer + string/comment/regex
// skip with template-literal `${...}` interpolation recursion)
// moved there in the Round-48 refactor so popup-handshake.test.mjs
// + popup-resolver.test.mjs + extension-popup-vm.test.mjs all
// exercise the SAME logic. Cross-file fixes now apply to all three
// at once, ending the triplicate-drift.
// See js-source-helpers.mjs preamble for the full skip-set.

// ---------- 1. Pinned constants (popup.js SOURCE) ----------

test('STORAGE_KEYS.dashboardUrl must be "jobbpiloten_dashboardUrl"', () => {
  // Drift between popup, content script, and dashboard silently
  // breaks the connect handshake — the popup would still poll the
  // legacy key forever, never see the dashboard's writes.
  assert.match(
    SOURCE,
    /dashboardUrl:\s*['"]jobbpiloten_dashboardUrl['"]/,
    'STORAGE_KEYS.dashboardUrl must be defined as "jobbpiloten_dashboardUrl"',
  )
})

test('PROD_BASE_URL fallback must equal "https://jobbpiloten.se"', () => {
  // The hard-coded final safety net — must match the production
  // domain exactly (no trailing slash, no path). Used by
  // assertOriginAllowed in BOTH extension/popup.js and
  // extension/content.js so a drift here is a SECURITY issue.
  assert.match(
    SOURCE,
    /const PROD_BASE_URL\s*=\s*['"]https:\/\/jobbpiloten\.se['"]/,
    'PROD_BASE_URL constant must equal the production origin (no trailing slash, no path)',
  )
})

test('BUILD_CONFIG_FILE must be "build-config.json"', () => {
  // Tier-3 reads this file via chrome.runtime.getURL(). A rename
  // here would silently drop to PROD_BASE_URL on every preview
  // build because scripts/package-extension.py writes the file
  // under exactly that name.
  assert.match(
    SOURCE,
    /const BUILD_CONFIG_FILE\s*=\s*['"]build-config\.json['"]/,
    'BUILD_CONFIG_FILE must point at "build-config.json" so the Tier-3 env-fallback finds NEXT_PUBLIC_APP_URL',
  )
})

test('popup.js must declare a semver VERSION constant for the status pill', () => {
  // The status meta line ends in "vX.Y.Z" — must be semver so a
  // future "1.0" or "beta" tag wouldn't render.
  assert.match(
    SOURCE,
    /const VERSION\s*=\s*['"]\d+\.\d+\.\d+['"]/,
    'popup.js must declare a VERSION constant of the form "X.Y.Z" so the status meta shows "vX.Y.Z"',
  )
})

// ---------- 2. resolveDashboardUrl tier order (RESOLVER_SOURCE) ----------

test('resolveDashboardUrl pure module must check tiers in the locked order: sync → local → manifest → build-config → PROD_BASE_URL_DEFAULT', () => {
  // v0.2.1 refactor: the 4-tier chain lives in the pure module.
  // popup.js is now a thin wrapper that supplies chrome.*
  // closures to the deps object. The chain order is preserved
  // 1:1 between the two files; a re-order would silently shadow
  // a chrome.storage.sync override the user just saved on their
  // other devices (because sync and local reads would swap in
  // the resolver).
  const body = sliceFunctionBody(RESOLVER_SOURCE, 'resolveDashboardUrl')
  assert.ok(body, 'resolveDashboardUrl must exist in extension/lib/dashboard-url-resolver.js as an async function')

  const syncGet    = body.search(/await\s+syncGet\(/)
  const localGet   = body.search(/await\s+localGet\(/)
  const manifest   = body.search(/getManifest\(\s*\)/)
  const buildCfg   = body.search(/await\s+fetchBuildConfig\(/)
  const prodReturn = body.search(/return\s+PROD_BASE_URL_DEFAULT/)

  // Each tier must exist at least once.
  assert.ok(syncGet    > 0, 'resolveDashboardUrl must await syncGet (Tier-1)')
  assert.ok(localGet   > 0, 'resolveDashboardUrl must await localGet (sync-fallback)')
  assert.ok(manifest   > 0, 'resolveDashboardUrl must call getManifest() (Tier-2)')
  assert.ok(buildCfg   > 0, 'resolveDashboardUrl must await fetchBuildConfig (Tier-3)')
  assert.ok(prodReturn > 0, 'resolveDashboardUrl must return PROD_BASE_URL_DEFAULT (Tier-4 + final safety net)')

  // Ordering — exact position of each call site, in source order:
  // syncGet < localGet < getManifest() < fetchBuildConfig < return PROD_BASE_URL_DEFAULT
  assert.ok(syncGet  < localGet, 'syncGet must come before localGet (sync is Tier-1, local is sync-fallback)')
  assert.ok(localGet < manifest, 'localGet must come before getManifest()')
  assert.ok(manifest < buildCfg, 'getManifest() must come before fetchBuildConfig')
  assert.ok(buildCfg < prodReturn, 'fetchBuildConfig must come before return PROD_BASE_URL_DEFAULT')
})

// ---------- 3. chrome.storage.{sync,local}.get call-site key (popup.js SOURCE) ----------

test('resolveDashboardUrl wrapper must read chrome.storage.sync.get + chrome.storage.local.get with the STORAGE_KEYS.dashboardUrl key', () => {
  // The tier-order assertion above proves the call is in the
  // right position in the pure module; this assertion proves
  // POPUP.JS's wrapper supplies the right KEY to chrome. A
  // regression that swapped the call to e.g.
  // `chrome.storage.sync.get(['jobbpiloten_token'])` here would
  // slip through the keyword match in the tier-order test (both
  // regexes would still match — the call-site doesn't say
  // which key).
  const body = sliceFunctionBody(SOURCE, 'resolveDashboardUrl')
  assert.ok(body)
  assert.match(
    body,
    /chrome\.storage\.sync\.get\(\s*STORAGE_KEYS\.dashboardUrl\s*\)/,
    'popup.js wrapper must call chrome.storage.sync.get(STORAGE_KEYS.dashboardUrl) — NOT some other key',
  )
  assert.match(
    body,
    /chrome\.storage\.local\.get\(\s*STORAGE_KEYS\.dashboardUrl\s*\)/,
    'popup.js wrapper must call chrome.storage.local.get(STORAGE_KEYS.dashboardUrl) as the sync-fallback',
  )
})

// ---------- 4. Build-config Tier-3 key (RESOLVER_SOURCE) ----------

test('resolveDashboardUrl pure module must read NEXT_PUBLIC_APP_URL as the Tier-3 key', () => {
  // Packager (scripts/package-extension.py) writes this exact
  // env-var name into build-config.json. A drift would silently
  // drop to PROD_BASE_URL_DEFAULT on every preview build.
  // v0.2.1 refactor: the read moved from popup.js's loadBuildConfig()
  // body into the pure module's Tier-3 block.
  // The Tier-3 read is `const url = parseValidOrigin(cfg?.NEXT_PUBLIC_APP_URL)`;
  // parseValidOrigin() does the empty-string fallback internally (it returns
  // null for any falsy / non-stringy input). Pin just the property access —
  // a regression that swaps the key name will fail this lock without
  // over-coupling to the internal fallback mechanism.
  assert.match(
    RESOLVER_SOURCE,
    /cfg\?\.NEXT_PUBLIC_APP_URL/,
    'pure module must read cfg?.NEXT_PUBLIC_APP_URL (fallback happens inside parseValidOrigin)',
  )
})

// ---------- 5. Manifest wildcard skip (RESOLVER_SOURCE) ----------

test('pure module must skip wildcard host_permissions patterns', () => {
  // v0.2.1 refactor: the wildcard-skip check moved out of
  // deriveBaseFromHostPermissions() and into the pure module's
  // inline Tier-2 loop, where `pattern.includes('*')` is the
  // sole branch that drops a pattern. Wildcards like
  // "https://*.vercel.app/*" must NOT be used to derive a popup
  // base URL — they don't resolve to a single origin, and
  // feeding one to URL() would throw.
  // v0.2.1 refactor: the wildcard-skip check moved out of
  // deriveBaseFromHostPermissions() into the pure module's inline
  // Tier-2 loop. The variable was renamed `pattern` -> `stripped`
  // because the regex `/\\/*$/` is stripped BEFORE the wildcard
  // check is run (so `stripped` is the correct post-strip value to
  // test for `*`). Accept either name so a future rename doesn't
  // false-positive this lock.
  assert.match(
    RESOLVER_SOURCE,
    /(?:stripped|pattern)\.includes\((['"])\*\1\)/,
    'pure module must skip (post-strip) manifest patterns that contain "*"',
  )
})

// ---------- 6. saveDashboardUrl validation + persistence (popup.js SOURCE) ----------

test('saveDashboardUrl must write chrome.storage.sync.set FIRST and chrome.storage.local.set as fallback', () => {
  // Mirrors the resolve side: sync is the primary, local is the
  // fallback for older Chrome without chrome.storage.sync. A
  // regression that drops the local.set branch would silently
  // lose the user's override on legacy Chrome.
  const body = sliceFunctionBody(SOURCE, 'saveDashboardUrl')
  assert.ok(body, 'saveDashboardUrl must exist in extension/popup.js')
  const syncSet  = body.search(/chrome\.storage\.sync\.set\(/)
  const localSet = body.search(/chrome\.storage\.local\.set\(/)
  assert.ok(syncSet  > 0, 'saveDashboardUrl must call chrome.storage.sync.set as primary write path')
  assert.ok(localSet > 0, 'saveDashboardUrl must call chrome.storage.local.set as legacy fallback')
  assert.ok(syncSet < localSet, 'sync.set must come before local.set in saveDashboardUrl (sync is primary)')
})

test('saveDashboardUrl must validate URL shape before persisting', () => {
  // User-facing validation: the input must be parseable as a URL
  // AND must start with http:// or https://. Without the scheme
  // check a user could paste "ftp://" and slip past the pop-up's
  // allowlist gate downstream.
  const body = sliceFunctionBody(SOURCE, 'saveDashboardUrl')
  assert.ok(body, 'saveDashboardUrl must exist')
  assert.match(body, /new URL\(\s*url\s*\)/, 'saveDashboardUrl must call `new URL(url)` to validate the input')
  assert.ok(
    body.includes('/^https?:\\/\\/'),
    'saveDashboardUrl must require the URL to start with http:// or https:// (regex literal: /^https?:\\/\\/)',
  )
})

// ---------- 7. Settings panel wiring (popup.js SOURCE) ----------

test('wire() must attach click handlers to all three settings-panel buttons', () => {
  // The ⚙️ button toggles the panel, Save persists the override,
  // Reset clears it. A regression that drops any listener would
  // leave the panel visible-but-non-functional — silent UX break
  // with no error message, hard to diagnose without this lock.
  assert.match(
    SOURCE,
    /(?:settingsBtn|\$\(['"]jp-settings-btn['"]\))\.addEventListener\(\s*['"]click['"]/,
    'wire() must add click listener to #jp-settings-btn (the ⚙️ toggle)',
  )
  assert.match(
    SOURCE,
    /(?:saveBtn|\$\(['"]jp-settings-save-btn['"]\))\.addEventListener\(\s*['"]click['"]/,
    'wire() must add click listener to #jp-settings-save-btn',
  )
  assert.match(
    SOURCE,
    /(?:resetBtn|\$\(['"]jp-settings-reset-btn['"]\))\.addEventListener\(\s*['"]click['"]/,
    'wire() must add click listener to #jp-settings-reset-btn',
  )
})

// ---------- 8. Cross-tab reactivity (popup.js SOURCE) ----------

test('popup.js must subscribe to chrome.storage.onChanged', () => {
  // The dashboard fires chrome.storage.sync.set from a different
  // tab during connect; an already-open popup must pick up the
  // new URL via chrome.storage.onChanged without needing a
  // reopen. Drift from this listener means the second tab
  // resolves with a stale URL until manually re-opened.
  assert.match(
    SOURCE,
    /chrome\.storage\.onChanged\.addListener\(/,
    'popup.js must register chrome.storage.onChanged listener to react to cross-tab dashboardUrl updates',
  )
})

// ---------- 9. openDashboard actually uses the resolver (popup.js SOURCE) ----------

test('openDashboard must obtain its URL from resolveDashboardUrl, not from a hard-coded origin', () => {
  // A regression that hard-codes `${PROD_BASE_URL}/dashboard` in
  // openDashboard would silently defeat the whole env-aware
  // resolver (the popup would always point at prod). The test
  // asserts both:
  //   - the function calls resolveDashboardUrl() to derive baseUrl
  //   - the URL step constructs `${baseUrl}/dashboard` (not raw
  //     `PROD_BASE_URL/dashboard`)
  const body = sliceFunctionBody(SOURCE, 'openDashboard')
  assert.ok(body, 'openDashboard must exist in extension/popup.js')
  assert.match(
    body,
    /resolveDashboardUrl\(\)/,
    'openDashboard must call resolveDashboardUrl() to derive its destination URL',
  )
  assert.match(
    body,
    /\$\{[^}]*\}\/dashboard/,
    'openDashboard must construct `${baseUrl}/dashboard` from the resolved URL',
  )
})

// ---------- 10. Pure module surface (RESOLVER_SOURCE) ----------

test('pure module PROD_BASE_URL_DEFAULT must equal "https://jobbpiloten.se"', () => {
  // Drift between popup.js PROD_BASE_URL and the pure module's
  // PROD_BASE_URL_DEFAULT would silently diverge the production
  // origin and defeat the resolver's "final safety net" guarantee.
  // The two constants MUST agree so that loadAllowedOrigins() in
  // popup.js (which uses the local PROD_BASE_URL as a guaranteed
  // floor origin) and the pure resolver's fallback chain return
  // the same value when every other tier fails.
  assert.match(
    RESOLVER_SOURCE,
    /const PROD_BASE_URL_DEFAULT\s*=\s*['"]https:\/\/jobbpiloten\.se['"]/,
    'pure module must export PROD_BASE_URL_DEFAULT = "https://jobbpiloten.se"',
  )
})

test('pure module must declare resolveDashboardUrl as the export', () => {
  // popup.js's wrapper imports this exact symbol:
  //   import { resolveDashboardUrl as resolveDashboardUrlPure }
  //     from './lib/dashboard-url-resolver.js'
  // A silent failure mode here is "resolveDashboardUrlPure is
  // undefined" on first MV3 popup load — the user would see
  // "kunde inte öppna dashboard" without an obvious cause.
  assert.match(
    RESOLVER_SOURCE,
    /export\s+async\s+function\s+resolveDashboardUrl\s*\(/,
    'pure module must export async function resolveDashboardUrl as its main entry',
  )
})

test('pure module must export DASHBOARD_STORAGE_KEY constant', () => {
  // The key name must be byte-identical with the popup.js
  // STORAGE_KEYS.dashboardUrl constant (test #1) AND with the
  // content-script handleDashboardUrl constant. Drift between
  // any two of these three would silently break the connect
  // handshake (popup polls key-A, content-script writes key-B).
  assert.match(
    RESOLVER_SOURCE,
    /const DASHBOARD_STORAGE_KEY\s*=\s*['"]jobbpiloten_dashboardUrl['"]/,
    'pure module must export DASHBOARD_STORAGE_KEY = "jobbpiloten_dashboardUrl"',
  )
})
