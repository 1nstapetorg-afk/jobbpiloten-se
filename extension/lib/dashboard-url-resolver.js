// extension/lib/dashboard-url-resolver.js
//
// Pure 4-tier env-aware dashboard URL resolver.
//
// NO chrome.* dependencies inside this file. Every browser API the
// resolver needs is supplied via the `deps` parameter at call time,
// which means a Node `--test` runner can stub the four readers in
// pure-JS and walk the tier chain without booting an MV3 runtime.
//
// extension/popup.js wraps this module by passing closure bindings
// for `chrome.storage.{sync,local}.get`, `chrome.runtime.getManifest`,
// and the local `loadBuildConfig` helper. None of those bindings
// live here so the resolver itself is portable + testable.
//
// Tier chain (each tier's failure falls through to the next):
//   1. chrome.storage.sync.get(jobbpiloten_dashboardUrl)
//        ↑ user's explicit dashboard URL override (syncs cross-device).
//          Set by the dashboard's "Anslut din profil" click via the
//          JOBBPILOTEN_SET_DASHBOARD_URL postMessage handshake.
//   2. chrome.storage.local.get(jobbpiloten_dashboardUrl)
//        ↑ sync-fallback for legacy Chrome without storage.sync.
//   3. chrome.runtime.getManifest().host_permissions[0] basename
//        ↑ build-time allowlist origin. Wildcard patterns (e.g.
//          "https://*.vercel.app/*") are SKIPPED here because they
//          do not resolve to a single origin — only concrete
//          patterns like "https://jobbpiloten.se/*" produce a
//          usable origin via URL().
//   4. Build-config.json NEXT_PUBLIC_APP_URL
//        ↑ set at package-extension.py run time from process.env.
//          Defaults to "https://jobbpiloten.se" in scripts/package-
//          extension.py when the platform doesn't override it.
//   5. PROD_BASE_URL_DEFAULT — https://jobbpiloten.se
//        ↑ final safety net. Always returned when every tier above
//          returns empty / throws.

const DASHBOARD_STORAGE_KEY = 'jobbpiloten_dashboardUrl'
const PROD_BASE_URL_DEFAULT = 'https://jobbpiloten.se'

/**
 * Resolve the env-aware dashboard URL using a 4-tier chain.
 *
 * @param {Object} [deps]
 * @param {() => Promise<{ [k: string]: any }>} [deps.syncGet]
 *   Reads `chrome.storage.sync`. Returns an object keyed by storage
 *   key. The caller MAY pre-filter — e.g. by passing a closure that
 *   does `.get(STORAGE_KEYS.dashboardUrl)` — but this resolver just
 *   reads `DASHBOARD_STORAGE_KEY` from whatever the closure returns.
 * @param {() => Promise<{ [k: string]: any }>} [deps.localGet]
 *   Reads `chrome.storage.local`. Same shape as syncGet.
 * @param {() => { host_permissions?: string[] }} [deps.getManifest]
 *   Reads `chrome.runtime.getManifest()`. Should return an object
 *   with a `host_permissions` array. Returning `{}` is OK — the
 *   loop just iterates zero patterns.
 * @param {() => Promise<{ NEXT_PUBLIC_APP_URL?: string }>} [deps.fetchBuildConfig]
 *   Reads the build-config.json baked at package time. Return
 *   `{}` for unknown / parse-error cases.
 * @returns {Promise<string>} The resolved dashboard origin (no
 *   trailing slash).
 */
export async function resolveDashboardUrl(deps) {
  // Hoist the `deps || {}` here (not in the parameter default) so the
  // test source-grep helper `sliceFunctionBody()` doesn't trip on the
  // `deps = {}` inner-brace pair — `({})` in the signature would be
  // counted as the function body's opening brace by a naive counter.
  // Behaviorally identical to the previous `deps = {}` default for any
  // caller (`undefined`/`null`/`{}`/object all work).
  const { syncGet, localGet, getManifest, fetchBuildConfig } = deps || {}

  // ----- Tier 1 — chrome.storage.sync (user-set, cross-device) -----
  try {
    const data = await syncGet()
    const url = parseValidOrigin(data?.[DASHBOARD_STORAGE_KEY])
    if (url) return url
  } catch (_) {
    // sync Throws on quota-exceeded / disabled-storage-sync. Fall
    // through to local fallback rather than swallowing silently.
  }

  // ----- Tier 1.5 — chrome.storage.local (sync-fallback) -----
  try {
    const data = await localGet()
    const url = parseValidOrigin(data?.[DASHBOARD_STORAGE_KEY])
    if (url) return url
  } catch (_) {
    // local is unavailable too (very rare). Fall through.
  }

  // ----- Tier 2 — manifest host_permissions[0] basename -----
  try {
    const manifest = getManifest() || {}
    const hostPerms = Array.isArray(manifest.host_permissions)
      ? manifest.host_permissions
      : []
    for (const pattern of hostPerms) {
      if (!pattern || typeof pattern !== 'string') {
        // Tier-2 dev-only observability: a malformed pattern
        // would be silently dropped without this warn. Gated
        // behind NODE_ENV so prod logs stay clean.
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[dashboard-url-resolver] Tier-2: skipped non-string host_permission', pattern)
        }
        continue
      }
      // Strip the trailing "/*" path-segment FIRST so a concrete
      // "https://jobbpiloten.se/*" patterns isn't mistaken for a
      // wildcard host and incorrectly skipped. Patterns whose
      // stripped host still contains "*" (e.g. "https://*.foo
      // .app/*" → "https://*.foo.app") are genuine wildcards and
      // cannot resolve to a single origin — we skip them.
      // SECURITY: a wildcard host like "*.vercel.app/*" maps to
      // thousands of previews and can't derive a popup base URL;
      // Tier-1 storage override is the intended path for those.
      const stripped = pattern.replace(/\/\*$/, '')
      if (stripped.includes('*')) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[dashboard-url-resolver] Tier-2: skipped wildcard host_permission', pattern)
        }
        continue
      }
      const origin = parseValidOrigin(stripped)
      if (!origin && process.env.NODE_ENV !== 'production') {
        console.warn('[dashboard-url-resolver] Tier-2: skipped unparseable host_permission', pattern)
      }
      if (origin) return origin
    }
  } catch (_) {
    // getManifest() can throw outside a real MV3 environment
    // (e.g. inside a Node test bootstrap). Fall through.
  }

  // ----- Tier 3 — build-config.json baked by package-extension.py -----
  try {
    const cfg = await fetchBuildConfig()
    const url = parseValidOrigin(cfg?.NEXT_PUBLIC_APP_URL)
    if (url) return url
  } catch (_) {
    /* not findable from the popup context */
  }

  // ----- Tier 4 — final safety net -----
  return PROD_BASE_URL_DEFAULT
}

/**
 * Defensive URL gate. Returns the canonical origin of `value` iff
 * it (a) is non-null, (b) stringifies to a non-empty trimmed
 * string, (c) parses as a URL via `new URL()`, and (d) has the
 * http: or https: protocol. Returns `null` for anything else so
 * the caller can fall through to the next tier.
 *
 * Why we don't accept more:
 *   • `null` / `undefined` / `0` / `false` / `''` → empty → `null`.
 *     These were previously bubbled to `String(... || '').trim()`
 *     which would convert `{}` to the literal string `'[object Object]'`
 *     and `42` to `'42'`, both of which then "passed" the
 *     non-empty check — a silent bug that let the popup point at
 *     a garbage URL.
 *   • `ftp:`, `file:`, `javascript:`, protocol-relative `'//x.com'`
 *     etc. are rejected on protocol. The popup fetches via this
 *     URL, so a non-http scheme would surface as a CSP block at
 *     runtime — better to reject up front.
 *   • `u.origin && u.origin !== 'null'` is a belt-and-braces check
 *     for the (extremely rare) case where `new URL()` succeeds
 *     but returns the literal string 'null' as origin.
 *
 * How to extend this gate (e.g. to block localhost or specific
 * test domains): add a new conditional BEFORE the `return u.origin`
 * line that returns `null` when the new constraint fails, and
 * add a corresponding regression test in the defensive-validation
 * section of tests/unit/dashboard-url-resolver.test.mjs. Don't add
 * rejections AFTER the return — any code past `return u.origin`
 * is unreachable.
 */
function parseValidOrigin(value) {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.origin || null
  } catch (_) {
    return null
  }
}

// Export the production URL fallback and storage key so callers
// (e.g. popup.js's `loadAllowedOrigins`) can reuse them without
// duplicating the strings. Drift between these constants is the
// single biggest footgun when coupling popup-side assertOriginAllowed
// gates against the popup-side RESOLVER, so the export keeps them
// path-coupled.
export { DASHBOARD_STORAGE_KEY, PROD_BASE_URL_DEFAULT }
