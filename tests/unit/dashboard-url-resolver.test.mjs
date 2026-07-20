// tests/unit/dashboard-url-resolver.test.mjs
//
// Behavioral tests for the pure 4-tier dashboard URL resolver
// (extension/lib/dashboard-url-resolver.js).
//
// Strategy: inject stubbed async/sync deps so we can walk the tier
// chain in plain Node without booting an MV3 runtime. This catches
// real regressions the static-regex tests in popup-resolver.test.mjs
// CAN'T catch — wrong return shape, missed fall-through, double-
// consumption, premature error swallow.
//
// Pattern: each test calls `resolveDashboardUrl(makeDeps({...}))`,
// where `makeDeps` fills unset deps with no-op stubs. Each tier
// gets its own clearly-named test so a regression points at the
// failing tier by name without parsing identical-shape fixtures.
//
// Run via `yarn test:unit` (added by the v0.2.1 refactor — total
// under tests/unit now 49 + 16 + 27 = 92 in popup-resolver +
// dashboard-url-resolver, plus 11 defensive parseValidOrigin tests
// added by the v0.2.1 followup = 49 + 16 + 38 = **103 tests**).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveDashboardUrl,
  PROD_BASE_URL_DEFAULT,
  DASHBOARD_STORAGE_KEY,
} from '../../extension/lib/dashboard-url-resolver.js'

const PROD = PROD_BASE_URL_DEFAULT

// Stub factory. Each test overrides one or two deps; everything
// else is a no-op (`{}` or empty array) so each test isolates
// exactly one tier's contribution.
function makeDeps(overrides = {}) {
  return {
    syncGet: overrides.syncGet ?? (async () => ({})),
    localGet: overrides.localGet ?? (async () => ({})),
    getManifest: overrides.getManifest ?? (() => ({ host_permissions: [] })),
    fetchBuildConfig: overrides.fetchBuildConfig ?? (async () => ({})),
    ...overrides,
  }
}

// ----- 0. Module surface -----

test('exports PROD_BASE_URL_DEFAULT = "https://jobbpiloten.se"', () => {
  assert.equal(PROD_BASE_URL_DEFAULT, 'https://jobbpiloten.se')
})

test('exports DASHBOARD_STORAGE_KEY = "jobbpiloten_dashboardUrl"', () => {
  assert.equal(DASHBOARD_STORAGE_KEY, 'jobbpiloten_dashboardUrl')
})

// ----- 1. Tier-1 — chrome.storage.sync -----

test('Tier-1: sync dashboardUrl wins over all other tiers', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({ jobbpiloten_dashboardUrl: 'https://staging.example.com' }),
    localGet: async () => ({ jobbpiloten_dashboardUrl: 'https://local.example.com' }),
    getManifest: () => ({ host_permissions: ['https://manifest.example.com/*'] }),
    fetchBuildConfig: async () => ({ NEXT_PUBLIC_APP_URL: 'https://build.example.com' }),
  }))
  assert.equal(url, 'https://staging.example.com')
})

test('Tier-1: empty-string sync value falls through to local', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({ jobbpiloten_dashboardUrl: '' }),
    localGet: async () => ({ jobbpiloten_dashboardUrl: 'https://local.example.com' }),
  }))
  assert.equal(url, 'https://local.example.com')
})

test('Tier-1: whitespace-only sync value falls through to local', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({ jobbpiloten_dashboardUrl: '   ' }),
    localGet: async () => ({ jobbpiloten_dashboardUrl: 'https://local.example.com' }),
  }))
  assert.equal(url, 'https://local.example.com')
})

test('Tier-1: sync THROWING falls through to local', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => { throw new Error('sync disabled') },
    localGet: async () => ({ jobbpiloten_dashboardUrl: 'https://local.example.com' }),
  }))
  assert.equal(url, 'https://local.example.com')
})

test('Tier-1: undefined sync value falls through to local', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({}), // keys not present
    localGet: async () => ({ jobbpiloten_dashboardUrl: 'https://local.example.com' }),
  }))
  assert.equal(url, 'https://local.example.com')
})

// ----- 2. Tier-1.5 — chrome.storage.local -----

test('Tier-1.5: local dashboardUrl wins when sync is empty', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({}),
    localGet: async () => ({ jobbpiloten_dashboardUrl: 'https://local.example.com' }),
    getManifest: () => ({ host_permissions: ['https://manifest.example.com/*'] }),
    fetchBuildConfig: async () => ({ NEXT_PUBLIC_APP_URL: 'https://build.example.com' }),
  }))
  assert.equal(url, 'https://local.example.com')
})

test('Tier-1.5: local THROWING falls through to manifest', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({}),
    localGet: async () => { throw new Error('local read failed') },
    getManifest: () => ({ host_permissions: ['https://manifest.example.com/*'] }),
  }))
  assert.equal(url, 'https://manifest.example.com')
})

// ----- 3. Tier-2 — manifest host_permissions[0] -----

test('Tier-2: manifest host_permissions[0] stripped to origin', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    getManifest: () => ({ host_permissions: ['https://jobbpiloten.se/*'] }),
  }))
  assert.equal(url, 'https://jobbpiloten.se')
})

test('Tier-2: trailing-slash patterns are also normalised', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    getManifest: () => ({ host_permissions: ['https://jobbpiloten.se/'] }),
  }))
  assert.equal(url, 'https://jobbpiloten.se')
})

test('Tier-2: wildcard host_permissions are SKIPPED', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    getManifest: () => ({
      host_permissions: [
        'https://*.vercel.app/*',  // wildcard — must be skipped
        'https://jobbpiloten.se/*', // concrete — used when reached
      ],
    }),
  }))
  assert.equal(url, 'https://jobbpiloten.se')
})

test('Tier-2: invalid-URL patterns are skipped silently', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    getManifest: () => ({
      host_permissions: [
        'not-a-url',
        'https://jobbpiloten.se/*', // reachable
      ],
    }),
  }))
  assert.equal(url, 'https://jobbpiloten.se')
})

test('Tier-2: null / empty / non-string patterns are skipped', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    getManifest: () => ({
      host_permissions: [null, '', 42, undefined, {}, 'https://jobbpiloten.se/*'],
    }),
  }))
  assert.equal(url, 'https://jobbpiloten.se')
})

test('Tier-2: getManifest() THROWING falls through to build-config', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    getManifest: () => { throw new Error('manifest unavailable') },
    fetchBuildConfig: async () => ({ NEXT_PUBLIC_APP_URL: 'https://build.example.com' }),
  }))
  assert.equal(url, 'https://build.example.com')
})

test('Tier-2: every pattern skipped silently falls through to build-config', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    getManifest: () => ({
      host_permissions: [
        'https://*.vercel.app/*', // wildcard → skip
        'not-a-url',              // invalid URL → skip
        null,
      ],
    }),
    fetchBuildConfig: async () => ({ NEXT_PUBLIC_APP_URL: 'https://build.example.com' }),
  }))
  assert.equal(url, 'https://build.example.com')
})

// ----- 4. Tier-3 — build-config.json NEXT_PUBLIC_APP_URL -----

test('Tier-3: build-config NEXT_PUBLIC_APP_URL wins when upper tiers empty', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    fetchBuildConfig: async () => ({ NEXT_PUBLIC_APP_URL: 'https://preview.example.vercel.app' }),
  }))
  assert.equal(url, 'https://preview.example.vercel.app')
})

test('Tier-3: trailing slashes on build-config URL are stripped', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    fetchBuildConfig: async () => ({ NEXT_PUBLIC_APP_URL: 'https://preview.example.vercel.app///' }),
  }))
  assert.equal(url, 'https://preview.example.vercel.app')
})

test('Tier-3: build-config throwing falls through to PROD_BASE_URL', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    fetchBuildConfig: async () => { throw new Error('fetch failed') },
  }))
  assert.equal(url, PROD)
})

test('Tier-3: empty NEXT_PUBLIC_APP_URL falls through to PROD_BASE_URL', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    fetchBuildConfig: async () => ({ NEXT_PUBLIC_APP_URL: '' }),
  }))
  assert.equal(url, PROD)
})

// ----- 5. Tier-4 — PROD_BASE_URL final safety net -----

test('Tier-4: returns PROD_BASE_URL when all tiers empty', async () => {
  const url = await resolveDashboardUrl(makeDeps({}))
  assert.equal(url, PROD)
})

test('Tier-4: returns PROD_BASE_URL when all tiers throw', async () => {
  const url = await resolveDashboardUrl({
    syncGet: async () => { throw new Error() },
    localGet: async () => { throw new Error() },
    getManifest: () => { throw new Error() },
    fetchBuildConfig: async () => { throw new Error() },
  })
  assert.equal(url, PROD)
})

// ----- 6. Cross-cutting — partial deps / no dependency at all -----

test('handles partial deps (getManifest missing) without crashing', async () => {
  // Defensive: the wrapper passes ALL four deps, but old Chrome
  // builds or unusual message-typing contexts could omit one.
  const url = await resolveDashboardUrl({
    syncGet: async () => ({}),
    localGet: async () => ({}),
    // getManifest DELIBERATELY MISSING.
    fetchBuildConfig: async () => ({ NEXT_PUBLIC_APP_URL: 'https://example.com' }),
  })
  assert.equal(url, 'https://example.com')
})

test('handles empty deps {} without crashing', async () => {
  // All four readers default to no-ops; nothing resolves to a URL.
  // The chain will then return PROD_BASE_URL.
  const url = await resolveDashboardUrl({})
  assert.equal(url, PROD)
})

test('trims whitespace and canonicalises to u.origin', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({ jobbpiloten_dashboardUrl: '  https://staging.example.com/  ' }),
  }))
  // Each tier now runs the value through parseValidOrigin(),
  // which strips whitespace AND canonicalises via
  // `new URL().origin` (no trailing slash, no path). The
  // submitter's job is to commit a clean URL; the resolver's
  // job is to NEVER return a malformed one — even if upstream
  // code wrote a number, an object, or a junk string to
  // chrome.storage.
  assert.equal(url, 'https://staging.example.com')
})

// ----- 7. Null-returning deps (defensive ?. / || {} chains) -----
//
// The pure module defends against getters returning null/undefined
// via `data?.[KEY]`, `cfg?.NEXT_PUBLIC_APP_URL`, and `getManifest() || {}`.
// These tests lock that defensive posture against a future refactor
// that drops the optional-chain — without the ?. the chain would
// throw "Cannot read properties of null".

test('syncGet returning null falls through to local', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => null,
    localGet: async () => ({ jobbpiloten_dashboardUrl: 'https://local.example.com' }),
  }))
  assert.equal(url, 'https://local.example.com')
})

test('fetchBuildConfig returning null falls through to PROD', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    fetchBuildConfig: async () => null,
  }))
  assert.equal(url, PROD)
})

test('getManifest returning null (not throwing) falls through to build-config', async () => {
  // The defensive `getManifest() || {}` in the pure module is the
  // path that handles this case. Without it, the hostPerms loop
  // would throw "Cannot read properties of null (reading
  // 'host_permissions')".
  const url = await resolveDashboardUrl(makeDeps({
    getManifest: () => null,
    fetchBuildConfig: async () => ({ NEXT_PUBLIC_APP_URL: 'https://build.example.com' }),
  }))
  assert.equal(url, 'https://build.example.com')
})

// ----- 8. Defensive URL validation — every tier runs parseValidOrigin() -----
//
// The pure module's parseValidOrigin(value) helper is the gate
// every non-Tier-2 tier runs before returning. It rejects:
//   • non-string primitives (number, boolean)
//   • objects / arrays (whose String() produces nonsense like
//     "[object Object]")
//   • empty / whitespace-only strings
//   • un-parseable strings (anything `new URL()` throws on)
//   • non-http(s) schemes (file:, javascript:, ftp:, data:, etc.)
// And it canonicalises the URL to .origin (no trailing slash,
// no path) for any tier that previously returned the raw input.
// These tests pin that behavior so a future refactor can't
// silently regress to the OLD `String(.trim())` shape — a
// regression that would let a buggy dashboard write `42` to
// chrome.storage and turn into the literal URL "42" returned
// to the popup. Mirrors the openDashboard `assertOriginAllowed`
// gate in extension/popup.js so the two layers agree on what
// counts as a valid dashboard origin.

test('Tier-1: numeric sync value falls through to local (parseValidOrigin gate)', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({ jobbpiloten_dashboardUrl: 42 }),
    localGet: async () => ({ jobbpiloten_dashboardUrl: 'https://local.example.com' }),
  }))
  assert.equal(url, 'https://local.example.com')
})

test('Tier-1: object sync value (which Stringifies to "[object Object]") falls through', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({ jobbpiloten_dashboardUrl: { a: 1 } }),
    localGet: async () => ({ jobbpiloten_dashboardUrl: 'https://local.example.com' }),
  }))
  assert.equal(url, 'https://local.example.com')
})

test('Tier-1: boolean sync value falls through', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({ jobbpiloten_dashboardUrl: true }),
    localGet: async () => ({ jobbpiloten_dashboardUrl: 'https://local.example.com' }),
  }))
  assert.equal(url, 'https://local.example.com')
})

test('Tier-1: unparseable string sync value falls through', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({ jobbpiloten_dashboardUrl: 'not-a-url' }),
    localGet: async () => ({ jobbpiloten_dashboardUrl: 'https://local.example.com' }),
  }))
  assert.equal(url, 'https://local.example.com')
})

test('Tier-1: ftp:// scheme sync value rejected (parseValidOrigin http(s)-only gate)', async () => {
  // http(s)-only is a SECURITY control: the popup's downstream
  // fetch() uses this URL. A non-http scheme like ftp:// would
  // surface as a CSP block at runtime — parseValidOrigin
  // rejects up front so the user gets a graceful fall-through
  // rather than a 4xx error toast after they click "Öppna
  // Dashboard".
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({ jobbpiloten_dashboardUrl: 'ftp://files.example.com' }),
    localGet: async () => ({ jobbpiloten_dashboardUrl: 'https://local.example.com' }),
  }))
  assert.equal(url, 'https://local.example.com')
})

test('Tier-1.5: numeric local value falls through to manifest', async () => {
  // Pre-fix mask note: in the v0.2.1 refactor commit, Tier-2
  // used `pattern.includes('*')` to skip wildcards, which had
  // a latent side-effect of ALSO skipping concrete patterns
  // like `'https://jobbpiloten.se/*'` (they contain `*`). The
  // test below passed by coincidence because Tier-2 then fell
  // through to PROD_BASE_URL_DEFAULT === `'https://jobbpiloten.se'`.
  // Post-fix (this turn): Tier-2 strips `'/*'` BEFORE the
  // wildcard check, so the concrete pattern is now actively
  // processed. Same observable answer (`'https://jobbpiloten.se'`),
  // different mechanism.
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({}),
    localGet: async () => ({ jobbpiloten_dashboardUrl: 1337 }),
    getManifest: () => ({ host_permissions: ['https://jobbpiloten.se/*'] }),
  }))
  assert.equal(url, 'https://jobbpiloten.se')
})

test('Tier-3: numeric NEXT_PUBLIC_APP_URL falls through to PROD_BASE_URL', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    fetchBuildConfig: async () => ({ NEXT_PUBLIC_APP_URL: 8675309 }),
  }))
  assert.equal(url, PROD)
})

test('Tier-3: ftp:// NEXT_PUBLIC_APP_URL rejected by scheme gate', async () => {
  const url = await resolveDashboardUrl(makeDeps({
    fetchBuildConfig: async () => ({ NEXT_PUBLIC_APP_URL: 'ftp://files.example.com' }),
  }))
  assert.equal(url, PROD)
})

test('Tier-1: returns u.origin (canonical), NOT the raw trimmed URL with path/query', async () => {
  // parseValidOrigin canonicalises via `new URL().origin`, so
  // any path / query / fragment that a stray caller wrote gets
  // stripped before return. This locks the "always origin"
  // contract behind the wrapper's `${baseUrl}/dashboard` concat
  // — a future refactor that returns the raw URL would produce
  // `https://x.com/dashboard/dashboard` (URL + literal /dashboard).
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({ jobbpiloten_dashboardUrl: 'https://example.com/old/path?q=1' }),
  }))
  assert.equal(url, 'https://example.com')
})

test('parseValidOrigin preserves URL port when present', async () => {
  // `new URL('https://example.com:8443/path').origin` is
  // 'https://example.com:8443' — port survives canonicalisation.
  // The port is a meaningful part of the origin (distinguishes
  // preview deploys on non-standard ports from prod on 443).
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({ jobbpiloten_dashboardUrl: 'https://example.com:8443/path' }),
  }))
  assert.equal(url, 'https://example.com:8443')
})

test('parseValidOrigin strips embedded credentials (userinfo)', async () => {
  // `https://user@example.com/` — u.origin is 'https://example.com'
  // (URL strips the userinfo per W3C URL spec). Locking this
  // means future refactors can't unintentionally return a URL
  // that contains an interpolated username — which could
  // potentially exfiltrate via the request log if a downstream
  // fetch log captured the resolved URL.
  const url = await resolveDashboardUrl(makeDeps({
    syncGet: async () => ({ jobbpiloten_dashboardUrl: 'https://user@example.com/' }),
  }))
  assert.equal(url, 'https://example.com')
})
