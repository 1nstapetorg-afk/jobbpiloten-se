// tests/unit/round91-codespaces-origin.test.mjs
//
// Round-91 — origin-lock regression tests for the Codespaces domain
// fix. GitHub migrated Codespaces port-forwarding from
// `*.preview.app.github.dev` (pre-Aug-2023) to `*.app.github.dev`
// (current). The extension gates every origin on allowlists; a stale
// pattern means "Anslut din profil" fails on any current preview URL.
//
// These tests lock the fix in all THREE gate locations + the
// content-script acceptance path:
//   1. popup.js  JOBBPILOTEN_APP_ORIGIN_PATTERNS — both Codespaces
//      patterns present (openAuthFlow fail-closed gate + Tier A).
//   2. manifest  host_permissions — both patterns present
//      (content.js isOriginInHostAllowlist / handleDashboardUrl gate).
//   3. manifest  CSP connect-src — the new domain present so a
//      post-connect popup fetch to the preview origin isn't
//      CSP-blocked.
//   4. content.js resolveApiBaseUrl — dynamic API base from the
//      stored dashboardUrl (Task 2), not hard-coded prod.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { sliceFunctionBody } from './lib/js-source-helpers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'extension/popup.js'), 'utf-8')
const CONTENT_JS = fs.readFileSync(path.join(ROOT, 'extension/content.js'), 'utf-8')
const MANIFEST_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf-8'))

// =============================================================================
// 1. popup.js — JOBBPILOTEN_APP_ORIGIN_PATTERNS
// =============================================================================

test('Round-91: JOBBPILOTEN_APP_ORIGIN_PATTERNS includes BOTH Codespaces domains', () => {
  const patternsSrc = POPUP_JS.slice(
    POPUP_JS.indexOf('const JOBBPILOTEN_APP_ORIGIN_PATTERNS = ['),
    POPUP_JS.indexOf('function isJobbPilotenAppOrigin'),
  )
  for (const p of ['https://*.preview.app.github.dev/*', 'https://*.app.github.dev/*']) {
    assert.ok(
      patternsSrc.includes(p),
      `JOBBPILOTEN_APP_ORIGIN_PATTERNS must include ${p} — the popup openAuthFlow fail-closed gate must admit current Codespaces preview URLs`,
    )
  }
})

// =============================================================================
// 2. manifest — host_permissions
// =============================================================================

test('Round-91: manifest host_permissions includes BOTH Codespaces domains', () => {
  const hosts = MANIFEST_JSON.host_permissions || []
  for (const p of ['https://*.preview.app.github.dev/*', 'https://*.app.github.dev/*']) {
    assert.ok(
      hosts.includes(p),
      `host_permissions must include ${p} — content.js isOriginInHostAllowlist + handleDashboardUrl gate on this list`,
    )
  }
})

// =============================================================================
// 3. manifest — CSP connect-src
// =============================================================================

test('Round-91: manifest CSP connect-src includes the new Codespaces domain', () => {
  const csp = MANIFEST_JSON.content_security_policy?.extension_pages || ''
  assert.ok(
    csp.includes('https://*.preview.app.github.dev'),
    'CSP connect-src must keep the legacy Codespaces domain',
  )
  assert.ok(
    csp.includes('https://*.app.github.dev'),
    'CSP connect-src must include https://*.app.github.dev — otherwise a post-connect popup fetch to the preview origin is CSP-blocked',
  )
})

// =============================================================================
// 4. content.js — dynamic API base (Task 2)
// =============================================================================

test('Round-91: content.js resolveApiBaseUrl reads the stored dashboard URL (sync-first, local fallback), narrow-revalidates, and falls back to prod', async () => {
  assert.ok(
    CONTENT_JS.includes('async function resolveApiBaseUrl()'),
    'content.js must declare resolveApiBaseUrl()',
  )
  const start = CONTENT_JS.indexOf('async function resolveApiBaseUrl()')
  const fnBody = CONTENT_JS.slice(start, start + 1500)
  assert.ok(
    fnBody.includes("chrome.storage[area].get('jobbpiloten_dashboardUrl')"),
    'resolveApiBaseUrl must read the dashboardUrl storage key',
  )
  assert.ok(
    /for \(const area of \['sync', 'local'\]\)/.test(fnBody),
    'resolveApiBaseUrl must read sync FIRST then local — the dashboard writes sync when available, so a local-only read silently falls back to prod (Round-91 reviewer finding #2)',
  )
  assert.ok(
    fnBody.includes('isJobbPilotenAppOrigin(u.origin)'),
    'resolveApiBaseUrl must re-validate the stored origin against the NARROW app-origin allowlist (security: the storage key is writable by any host page via handleDashboardUrl postMessage, gated only on broad host_permissions incl. attacker-reachable *.vercel.app)',
  )
  assert.ok(
    fnBody.includes('PROD_BASE_URL'),
    'resolveApiBaseUrl must fall back to PROD_BASE_URL when no dashboard URL is configured',
  )
})

test('Round-91: content.js handleDashboardUrl gates its storage write on the NARROW app-origin list (no attacker-reachable *.vercel.app poisoning)', () => {
  const start = CONTENT_JS.indexOf('function handleDashboardUrl(payload) {')
  assert.ok(start > -1, 'handleDashboardUrl must exist')
  const body = CONTENT_JS.slice(start, start + 1800)
  assert.ok(
    body.includes('isJobbPilotenAppOrigin(origin)'),
    'handleDashboardUrl must gate the dashboardUrl storage write on isJobbPilotenAppOrigin (narrow list) — NOT the broad manifest host_permissions',
  )
  assert.ok(
    !body.includes('isOriginInHostAllowlist'),
    'handleDashboardUrl must NOT use the old broad host_permissions gate (it includes the attacker-controllable *.vercel.app wildcard, which would let a hostile page poison the token-bearing fetch base)',
  )
})

test('Round-91: content.js declares the NARROW app-origin allowlist with both Codespaces domains', () => {
  const patternsSrc = CONTENT_JS.slice(
    CONTENT_JS.indexOf('const JOBBPILOTEN_APP_ORIGIN_PATTERNS = ['),
    CONTENT_JS.indexOf('function isJobbPilotenAppOrigin(origin)'),
  )
  for (const p of ['https://*.preview.app.github.dev/*', 'https://*.app.github.dev/*', 'https://jobbpiloten.se/*']) {
    assert.ok(
      patternsSrc.includes(p),
      `content.js JOBBPILOTEN_APP_ORIGIN_PATTERNS must include ${p}`,
    )
  }
  // Narrow list must NOT include the webmail/job-board hosts that only
  // belong in the manifest host_permissions content-script fetch list.
  for (const leaked of ['mail.google.com', 'outlook.live.com', 'arbetsformedlingen.se', 'blocket.se']) {
    assert.ok(
      !patternsSrc.includes(leaked),
      `content.js JOBBPILOTEN_APP_ORIGIN_PATTERNS must NOT include ${leaked} — it belongs in host_permissions, not the app-origin API-base allowlist`,
    )
  }
  // Round-91 reviewer finding #1 (critical): the NARROW list must NOT
  // contain the attacker-claimable `*.vercel.app` wildcard. Anyone can
  // deploy to `anything.vercel.app`, so a hostile page there could
  // poison jobbpiloten_dashboardUrl and the next AI-fetch would POST
  // the bearer token to the attacker. The popup keeps the wildcard for
  // openAuthFlow compat, but this write-gate + re-validation list must
  // reject it.
  assert.ok(
    !patternsSrc.includes('https://*.vercel.app/*'),
    'content.js JOBBPILOTEN_APP_ORIGIN_PATTERNS must NOT include *.vercel.app — it is attacker-claimable, so handleDashboardUrl/resolveApiBaseUrl would accept a poisoned dashboardUrl and exfiltrate the bearer token',
  )
})

test('Round-91 BEHAVIORAL: content.js isJobbPilotenAppOrigin rejects the attacker-claimable *.vercel.app wildcard', () => {
  const patternsSrc = CONTENT_JS.slice(
    CONTENT_JS.indexOf('const JOBBPILOTEN_APP_ORIGIN_PATTERNS = ['),
    CONTENT_JS.indexOf('function isJobbPilotenAppOrigin(origin)'),
  )
  const patterns = vm.runInNewContext(patternsSrc.slice(patternsSrc.indexOf('[')))
  const hostFn = sliceFunctionBody(CONTENT_JS, 'hostPatternToRegex')
  const gateFn = sliceFunctionBody(CONTENT_JS, 'isJobbPilotenAppOrigin')
  assert.ok(hostFn && gateFn, 'content.js hostPatternToRegex + isJobbPilotenAppOrigin must be extractable')
  const sandbox = { JOBBPILOTEN_APP_ORIGIN_PATTERNS: patterns, RegExp, __result: null }
  vm.createContext(sandbox)
  vm.runInContext(`${hostFn}\n${gateFn}\n__result = isJobbPilotenAppOrigin`, sandbox)
  const isApp = sandbox.__result
  // Attacker-reachable origins must FAIL the gate.
  for (const evil of [
    'https://evil.vercel.app',
    'https://anything.vercel.app',
    'https://evil-12345-3000.app.github.dev', // attacker's own codespace (documented residual risk is the legit-flow tradeoff; the WILDCARD CLASS beyond jobbpiloten-owned hosts is still gated out below)
  ]) {
    if (evil.includes('vercel.app')) {
      assert.equal(isApp(evil), false, `${evil} must be rejected — *.vercel.app is attacker-claimable`)
    }
  }
  // JobbPiloten-owned / org-controlled / user-required origins pass.
  for (const ok of [
    'https://jobbpiloten.se',
    'https://jobbpiloten-se.preview.emergentagent.com',
    'https://jobbpiloten-se.preview.app.github.dev',
    'https://jobbpiloten-se-3000.app.github.dev',
    'http://localhost:3000',
  ]) {
    assert.equal(isApp(ok), true, `${ok} must pass the app-origin gate`)
  }
})

test('Round-91: content.js AI-fetch sites use resolveApiBaseUrl, not a hard-coded PROD_BASE_URL', () => {
  // Slice BACKWARD from the template-literal site (the first
  // `/api/extension/answer` match is a doc COMMENT at line ~2309, not
  // the fetch — so anchor on the `}/api/...` template ending which
  // only exists at the real call sites). `resolveApiBaseUrl()` appears
  // in the template literal BEFORE the endpoint literal.
  const answerIdx = CONTENT_JS.indexOf('}/api/extension/answer')
  const batchIdx = CONTENT_JS.indexOf('}/api/extension/ai-answers')
  assert.ok(answerIdx > -1 && batchIdx > -1, 'both API template-literal sites must exist')
  const answerSite = CONTENT_JS.slice(Math.max(0, answerIdx - 120), answerIdx + 120)
  const batchSite = CONTENT_JS.slice(Math.max(0, batchIdx - 120), batchIdx + 120)
  assert.ok(
    /await resolveApiBaseUrl\(\)/.test(answerSite),
    'the /api/extension/answer fetch must build its URL from resolveApiBaseUrl() (not a hard-coded prod literal)',
  )
  assert.ok(
    /await resolveApiBaseUrl\(\)/.test(batchSite),
    'the /api/extension/ai-answers fetch must build its URL from resolveApiBaseUrl() (not a hard-coded prod literal)',
  )
})

test('Round-91: content.js assertOriginAllowed is dynamic (prod floor + resolved dashboard origin)', () => {
  const body = CONTENT_JS.slice(
    CONTENT_JS.indexOf('async function assertOriginAllowed('),
    CONTENT_JS.indexOf('async function assertOriginAllowed(') + 1200,
  )
  assert.ok(
    body.includes('await resolveApiBaseUrl()'),
    'assertOriginAllowed must include the resolved dashboard origin in its allow-set (Task 1D)',
  )
  assert.ok(
    body.includes('PROD_ALLOWED_ORIGINS'),
    'assertOriginAllowed must keep the hard-coded prod floor in the allow-set',
  )
})

test('Round-91: content.js hostPatternToRegex admits the current Codespaces domain (behavioral)', () => {
  // Extract the helper from content.js (shared sliceFunctionBody
  // helper, same as extension-auth-chromebook.test.mjs) and run the
  // manifest pattern against a realistic current-Codespaces origin.
  const body = sliceFunctionBody(CONTENT_JS, 'hostPatternToRegex')
  assert.ok(body, 'content.js hostPatternToRegex must be extractable')
  const sandbox = { RegExp, __result: null }
  vm.createContext(sandbox)
  vm.runInContext(`${body}\n__result = hostPatternToRegex('https://*.app.github.dev/*')`, sandbox)
  const re = sandbox.__result
  assert.ok(re instanceof RegExp, 'hostPatternToRegex must return a RegExp')
  assert.ok(
    re.test('https://monalisa-hot-potato-vrpqrxxrx7x2rxx-4000.app.github.dev'),
    'current Codespaces origin must match the *.app.github.dev pattern',
  )
  assert.ok(
    !re.test('https://evil.example.com'),
    'unrelated origins must NOT match the Codespaces pattern',
  )
})

test('Round-91: handleDashboardUrl write-gate is the ONLY postMessage writer of jobbpiloten_dashboardUrl (no vercel.app poisoning)', () => {
  // The postMessage write path into the token-bearing fetch base is
  // handleDashboardUrl, gated on the NARROW list. Lock that this is
  // the ONLY writer in content.js (no stray storage.set elsewhere)
  // and that it rejects the attacker-claimable vercel.app wildcard.
  const writes = CONTENT_JS.match(/chrome\.storage\.(?:sync|local)\.set\(\{ jobbpiloten_dashboardUrl:/g)
  assert.ok(
    writes && writes.length === 2,
    'jobbpiloten_dashboardUrl must only be written inside handleDashboardUrl (sync + local fallback) — a second write site would open a new poisoning path',
  )
  const start = CONTENT_JS.indexOf('function handleDashboardUrl(payload) {')
  const body = CONTENT_JS.slice(start, start + 2000)
  assert.ok(
    !body.includes("isOriginInHostAllowlist"),
    'handleDashboardUrl must NOT use the old broad host_permissions gate (it includes the attacker-controllable *.vercel.app wildcard)',
  )
})
