// tests/unit/ssrf-guard.test.mjs
//
// Round-46.1 / Bug 1 followup — SSRF guard behavioural contract.
//
// Locks the lib/ssrf-guard.js `assertSafeExternalUrl()` validator
// against the round of attack vectors that /api/extension/email-body
// could be tricked into fetching:
//
//   • HTTP schemes the route must not honour (file://, ftp://, ws://)
//   • Bare IP literals in private/loopback/link-local/multicast/CGN
//     ranges (IPv4 + IPv6, including IPv4-mapped IPv6)
//   • Hostname pre-filters for the localhost family and .local /
//     .internal / .localhost TLDs
//   • IPv6 special cases: ::1 (loopback), fe80::/10 (link-local),
//     fc00::/7 (unique-local), ff00::/8 (multicast), ::ffff:IPv4
//   • http: URL acceptance gated on the explicit `allowHttp: true`
//     caller opt-in (default is https-only)
//
// We intentionally test against IP literals rather than DNS names
// so the test stays deterministic across CI environments without
// mock DNS or network access. The DNS-resolution path is invoked
// through dns.promises.lookup — we DO test a real public hostname
// so the dns.lookup invocation is exercised, but the public-DNS
// branch test is loose (assertion is "ok OR DNS failure reported"),
// not strict (no false-positive blocking of github.com).
//
// Source-grep locks for ROUTE_SRC (route.js) ensure the
// assertSafeExternalUrl() call is wired in — the SST can't be
// bypassed by simply removing the import.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSafeExternalUrl } from '../../lib/ssrf-guard.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROUTE_PATH = path.resolve(__dirname, '../../app/api/extension/email-body/route.js')
const GUARD_PATH = path.resolve(__dirname, '../../lib/ssrf-guard.js')
const ROUTE_SRC = fs.readFileSync(ROUTE_PATH, 'utf-8')
const GUARD_SRC = fs.readFileSync(GUARD_PATH, 'utf-8')

// =============================================================================
// 0. Source-grep locks — the route MUST import + use the guard
// =============================================================================

test('Round-46.1: /api/extension/email-body must import assertSafeExternalUrl()', () => {
  assert.match(
    ROUTE_SRC,
    /import\s*\{[^}]*\bassertSafeExternalUrl\b[^}]*\}\s*from\s*['"]@\/lib\/ssrf-guard['"]/,
    'route must import assertSafeExternalUrl from @/lib/ssrf-guard (parity with other defensive modules)',
  )
})

test('Round-46.1: route must invoke assertSafeExternalUrl() inside fetchJobDescription()', () => {
  assert.match(
    ROUTE_SRC,
    /assertSafeExternalUrl\s*\(/,
    'route must call assertSafeExternalUrl(...) — the import alone does not gate the fetch()',
  )
})

test('Round-46.1: route order must be guard-first-then-fetch (no fetch() before guard ok)', () => {
  // Anchor — assertSafeExternalUrl must appear BEFORE fetch() within
  // fetchJobDescription's body. The lint-friendly check is that
  // assertSafeExternalUrl's offset in the source is less than the
  // first `await fetch(` offset within the same function.
  const guardOffset = ROUTE_SRC.indexOf('assertSafeExternalUrl')
  assert.ok(guardOffset > 0, 'guard call must be present')
  // Within the function body (between `function fetchJobDescription`
  // and the next top-level helper), the FIRST fetch is the actual
  // outbound call. The regex-locator is good enough for a regression
  // lock — a future edit that moves fetch() before the guard fails
  // this test, signalling the regression loudly.
  const fetchJobDescriptionStart = ROUTE_SRC.indexOf('async function fetchJobDescription')
  assert.ok(fetchJobDescriptionStart > 0, 'fetchJobDescription declaration must exist')
  const slice = ROUTE_SRC.slice(fetchJobDescriptionStart, fetchJobDescriptionStart + 4_000)
  const localGuardOffset = slice.indexOf('assertSafeExternalUrl')
  const localFetchOffset = slice.indexOf('await fetch(')
  assert.ok(
    localGuardOffset >= 0 && localFetchOffset > localGuardOffset,
    'within fetchJobDescription, the SSRF guard must appear BEFORE the fetch() call (regression lock)',
  )
})

// =============================================================================
// 1. Scheme allowlist — only https by default; http opt-in
// =============================================================================

test('SSRF guard rejects file:// scheme', async () => {
  const r = await assertSafeExternalUrl('file:///etc/passwd')
  assert.equal(r.ok, false)
  assert.match(r.error, /Schemat/)
})

test('SSRF guard rejects ftp:// scheme', async () => {
  const r = await assertSafeExternalUrl('ftp://example.com/file.txt')
  assert.equal(r.ok, false)
  assert.match(r.error, /Schemat/)
})

test('SSRF guard rejects ws:// scheme', async () => {
  const r = await assertSafeExternalUrl('ws://example.com/socket')
  assert.equal(r.ok, false)
  assert.match(r.error, /Schemat/)
})

test('SSRF guard rejects data: scheme', async () => {
  const r = await assertSafeExternalUrl('data:text/plain,hello')
  assert.equal(r.ok, false)
  assert.match(r.error, /Schemat/)
})

test('SSRF guard rejects malformed URL syntax', async () => {
  const r = await assertSafeExternalUrl('not a url')
  assert.equal(r.ok, false)
  assert.match(r.error, /Ogiltig URL-syntax/)
})

test('SSRF guard rejects empty/falsy input', async () => {
  assert.equal((await assertSafeExternalUrl('')).ok, false)
  assert.equal((await assertSafeExternalUrl(null)).ok, false)
  assert.equal((await assertSafeExternalUrl(undefined)).ok, false)
})

test('SSRF guard rejects http: unless allowHttp: true is passed', async () => {
  // https: is the default — we have to allow http: with explicit
  // opt-in, otherwise the route's HTTPS-egress firehose would
  // 400 on legitimate http:// job-board URLs that the Vercel
  // gateway forwards as-is.
  //
  // The extension email-body route is HTTPS-only, so we lock the
  // default-rejection in.
  assert.equal(
    (await assertSafeExternalUrl('http://example.com/job')).ok,
    false,
    'http: must be rejected by default (allowHttp opts-in)',
  )
  // With opt-in, a known-public IPv4 should pass the literal
  // classifier (we use example.com's public DNS-OR-literal path;
  // for the IP literal it must allow http).
  const ipHttp = await assertSafeExternalUrl('http://93.184.216.34/', { allowHttp: true })
  assert.equal(ipHttp.ok, true, 'http: with allowHttp:true must accept a public IP literal')
})

// =============================================================================
// 2. IPv4 private-range blocking (literal IP inputs)
// =============================================================================

test('SSRF guard blocks 10.0.0.0/8 (RFC1918 private)', async () => {
  const r = await assertSafeExternalUrl('https://10.0.0.1/')
  assert.equal(r.ok, false)
  assert.match(r.error, /private \(10\/8/)
})

test('SSRF guard blocks 172.16.0.0/12 (RFC1918 private)', async () => {
  const r = await assertSafeExternalUrl('https://172.16.0.1/')
  assert.equal(r.ok, false)
  assert.match(r.error, /private \(172\.16\/12/)
})

test('SSRF guard blocks 192.168.0.0/16 (RFC1918 private)', async () => {
  const r = await assertSafeExternalUrl('https://192.168.1.1/')
  assert.equal(r.ok, false)
  assert.match(r.error, /private \(192\.168\/16/)
})

test('SSRF guard blocks 127.0.0.0/8 (loopback)', async () => {
  // https:// required so the test reaches the IP-range classifier.
  // A http:// URL fails earlier at the scheme gate (its own test
  // in section 1); both gate positions are correct, we lock both.
  const r = await assertSafeExternalUrl('https://127.0.0.1:8080/')
  assert.equal(r.ok, false)
  assert.match(r.error, /loopback/)
})

test('SSRF guard blocks 169.254.169.254 (cloud instance metadata)', async () => {
  // The AWS / GCP / Azure instance metadata endpoint — the
  // classic SSRF "loot the credentials" target. This MUST be
  // blocked at the application layer (a permissive egress
  // proxy would let the request through).
  const r = await assertSafeExternalUrl('https://169.254.169.254/latest/meta-data/')
  assert.equal(r.ok, false)
  assert.match(r.error, /link-local/)
})

test('SSRF guard blocks 100.64.0.0/10 (RFC6598 carrier-grade NAT)', async () => {
  const r = await assertSafeExternalUrl('https://100.64.0.1/')
  assert.equal(r.ok, false)
  assert.match(r.error, /carrier-grade/)
})

test('SSRF guard blocks 0.0.0.0 via the hostname pre-filter (loopback-alias wins over range check)', async () => {
  // 0.0.0.0 is BOTH a hostname alias AND an IPv4 literal — the
  // BLOCKED_HOSTNAMES pre-filter is consulted first (cheaper than
  // range lookup) so the rejection reason is the alias-keyword.
  // We lock on the actual message so a future refactor that
  // reorders the gate is caught loudly.
  const r = await assertSafeExternalUrl('https://0.0.0.0/')
  assert.equal(r.ok, false)
  assert.match(r.error, /loopback-alias/)
})

test('SSRF guard blocks 224.0.0.0/4 (multicast)', async () => {
  const r = await assertSafeExternalUrl('https://224.0.0.1/')
  assert.equal(r.ok, false)
  assert.match(r.error, /multicast/)
})

test('SSRF guard blocks 255.255.255.255 (broadcast)', async () => {
  const r = await assertSafeExternalUrl('https://255.255.255.255/')
  assert.equal(r.ok, false)
  assert.match(r.error, /reserved-broadcast/)
})

// =============================================================================
// 3. IPv6 private-range blocking (literal IP inputs)
// =============================================================================

test('SSRF guard blocks ::1 (IPv6 loopback) bracketed-form', async () => {
  const r = await assertSafeExternalUrl('https://[::1]/')
  assert.equal(r.ok, false)
  assert.match(r.error, /IPv6 loopback/)
})

test('SSRF guard blocks fc00::/7 (IPv6 unique-local)', async () => {
  const r = await assertSafeExternalUrl('https://[fc00::1]/')
  assert.equal(r.ok, false)
  assert.match(r.error, /unique-local/)
})

test('SSRF guard blocks fe80::/10 (IPv6 link-local)', async () => {
  const r = await assertSafeExternalUrl('https://[fe80::1]/')
  assert.equal(r.ok, false)
  assert.match(r.error, /link-local/)
})

test('SSRF guard blocks ff00::/8 (IPv6 multicast)', async () => {
  const r = await assertSafeExternalUrl('https://[ff02::1]/')
  assert.equal(r.ok, false)
  assert.match(r.error, /multicast/)
})

test('SSRF guard blocks IPv4-mapped IPv6 ::ffff:10.0.0.1', async () => {
  const r = await assertSafeExternalUrl('https://[::ffff:10.0.0.1]/')
  assert.equal(r.ok, false)
  assert.match(r.error, /mapped/)
})

test('SSRF guard blocks IPv4-mapped IPv6 hex form ::ffff:0a00:1', async () => {
  // 0a00:0001 = 10.0.0.1
  const r = await assertSafeExternalUrl('https://[::ffff:0a00:0001]/')
  assert.equal(r.ok, false)
  assert.match(r.error, /mapped/)
})

test('SSRF guard blocks IPv4-compatible IPv6 ::10.0.0.1 (Round-46.2 polish)', async () => {
  // Round-46.2 polish — the bare-dotted IPv6 form
  // (`::a.b.c.d`) was RFC 4291 deprecated but Node's url parser
  // + hostnamelookups history still accept it. Without an
  // explicit IPv4-compatible branch the guard would let
  // `https://[::10.0.0.1]/` slip through to fetch(). Locked
  // so the IPv4-compatible branch cannot regress silently.
  const r = await assertSafeExternalUrl('https://[::10.0.0.1]/')
  assert.equal(r.ok, false)
  assert.match(r.error, /IPv4-compatible/)
})

// =============================================================================
// 4. Hostname pre-filters (lookups avoided entirely)
// =============================================================================

test('SSRF guard blocks "localhost" hostname alias', async () => {
  const r = await assertSafeExternalUrl('https://localhost/')
  assert.equal(r.ok, false)
  assert.match(r.error, /loopback-alias/)
})

test('SSRF guard blocks "broadcasthost" hostname alias', async () => {
  const r = await assertSafeExternalUrl('https://broadcasthost/')
  assert.equal(r.ok, false)
  assert.match(r.error, /loopback-alias/)
})

test('SSRF guard blocks .local TLD', async () => {
  const r = await assertSafeExternalUrl('https://printer.local/queue')
  assert.equal(r.ok, false)
  assert.match(r.error, /\.local/)
})

test('SSRF guard blocks .internal TLD', async () => {
  const r = await assertSafeExternalUrl('https://api.internal/v1')
  assert.equal(r.ok, false)
  assert.match(r.error, /\.internal/)
})

test('SSRF guard blocks .localhost TLD', async () => {
  const r = await assertSafeExternalUrl('https://webapp.localhost/')
  assert.equal(r.ok, false)
  assert.match(r.error, /\.localhost/)
})

// =============================================================================
// 5. Positive paths — DNS-resolved public hostnames
// =============================================================================

test('SSRF guard accepts public IPv4 literal', async () => {
  // example.com's reserved-by-IANA IPv4 (93.184.216.34) is the
  // canonical public-literal test target — it's stable across
  // CI environments and is not in any private range.
  const r = await assertSafeExternalUrl('https://93.184.216.34/')
  assert.equal(r.ok, true)
})

test('SSRF guard accepts public IPv6 literal (Google DNS)', async () => {
  // 2001:4860:4860::8888 is Google's public DNS AAAA — a stable
  // public IPv6 literal that's not in any private range.
  const r = await assertSafeExternalUrl('https://[2001:4860:4860::8888]/')
  assert.equal(r.ok, true)
})

test('SSRF guard accepts public hostname after DNS resolution', async () => {
  // Loose check: we either resolve to a public IP (ok:true) OR
  // the DNS lookup fails in the test sandbox and we surface a
  // structured rejection with "DNS-uppslag misslyckades" — either
  // way, the function never throws and never returns ok:true for
  // a private IP. Locking on exact DNS outcomes would couple
  // tests to network sandboxes which is the opposite of what we
  // want — the SOURCE-GREP / IP-literal coverage above is the
  // real regression net.
  const r = await assertSafeExternalUrl('https://example.com/')
  if (r.ok) {
    // DNS resolved to a public IP — perfect, the allow-list works.
    assert.equal(r.ok, true)
  } else {
    // DNS didn't resolve — assert the failure reason is
    // structured, not a crash. The guard must NEVER silently
    // approve a hostname whose DNS lookup failed.
    assert.match(r.error, /DNS-uppslag/)
  }
})

// =============================================================================
// 6. Source-grep belt-and-braces — the guard module exports the helper
// =============================================================================

test('lib/ssrf-guard.js must export assertSafeExternalUrl as a named function', () => {
  assert.match(
    GUARD_SRC,
    /export\s+async\s+function\s+assertSafeExternalUrl\s*\(/,
    'lib/ssrf-guard.js must export assertSafeExternalUrl as a named async function',
  )
})

test('lib/ssrf-guard.js must NOT use @/ alias syntax (so direct import works)', () => {
  assert.doesNotMatch(
    GUARD_SRC,
    /from\s+['"]@\//,
    'lib/ssrf-guard.js must use relative imports so direct node imports succeed without the @/ alias',
  )
})

test('lib/ssrf-guard.js must import dns.promises via node:dns/promises (NOT plain `dns`)', () => {
  // `import dns from 'node:dns/promises'` is the canonical Node 18+
  // promise-resolver import. A plain `from 'dns'` import pulls the
  // synchronous resolver which derails the await chain.
  assert.match(
    GUARD_SRC,
    /from\s+['"]node:dns\/promises['"]/,
    'lib/ssrf-guard.js must import dns from node:dns/promises (the promise-built namespace)',
  )
})

// =============================================================================
// Round-48 — IP-pinning (TOCTOU mitigation)
// =============================================================================
//
// Three new behavioural + source-grep tests lock the contract
// documented in the Round-47 file-top postmortem of lib/ssrf-guard.js:
//
//   1. pinIp:true on a public hostname returns { ok, ip, dispatcher }
//      where dispatcher is an undici Agent instance and `ip` is the
//      resolver's preferred A-record (avoids splitting pinned surface
//      across multiple records).
//   2. dispatcher must expose the standard undici Agent surface
//      (.dispatch, .close) so the consumer's fetch(url, { dispatcher })
//      binds. The connect hook itself is verified in test #3 via
//      source-grep because undici's connect hook is invoked async
//      inside fetch() — a clean synchronous test would require
//      mocking undici's dispatcher pipeline.
//   3. pinIp:false (default) returns bare { ok:true } without ip or
//      dispatcher — regression lock for pre-Round-48 callers.
//   4. Source-grep lock on the connect hook signature, host-mismatch
//      rejection, servername SNI binding, and consumer-side
//      redirect:'error'.

test('Round-48: pinIp:true returns { ok, ip, dispatcher } when undici is importable', async () => {
  // Try to import undici — if it's not in node_modules the guard
  // fails closed with a structured error and we soft-skip the
  // behavioural test (Round-48.3 still covers the source-grep
  // contract below so the regression net is intact).
  let Agent = null
  try {
    const mod = await import('undici')
    Agent = mod.Agent || null
  } catch (_) { Agent = null }
  if (!Agent) {
    // Soft-skip: undici not importable. The source-grep tests below
    // + the legacy-fallback test cover the regression net even
    // when this test runs in an undici-less sandbox.
    return
  }
  const r = await assertSafeExternalUrl('https://example.com/', { pinIp: true })
  assert.equal(r.ok, true, 'pinIp:true on a public host must return ok:true')
  assert.ok(typeof r.ip === 'string' && r.ip.length > 0, 'must include the resolved IP string')
  assert.ok(
    r.ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(r.ip),
    `ip must be IPv4 dotted-decimal, got ${r.ip}`,
  )
  assert.ok(
    r.dispatcher instanceof Agent,
    `dispatcher must be an undici Agent, got ${typeof r.dispatcher}`,
  )
})

test('Round-48: pinIp:true dispatcher exposes the standard undici Agent surface', async () => {
  let Agent = null
  try {
    const mod = await import('undici')
    Agent = mod.Agent || null
  } catch (_) { Agent = null }
  if (!Agent) return // soft-skip
  const r = await assertSafeExternalUrl('https://example.com/', { pinIp: true })
  if (!r.ok || !r.dispatcher) return // belt-and-braces
  // Dispatcher must expose .dispatch + .close so Node fetch can
  // bind the dispatcher when the consumer passes
  //   fetch(url, { dispatcher: r.dispatcher }).
  assert.equal(typeof r.dispatcher.dispatch, 'function', 'dispatcher must expose .dispatch()')
  assert.equal(typeof r.dispatcher.close, 'function', 'dispatcher must expose .close() for fetch cleanup')
  await r.dispatcher.close().catch(() => {})
})

test('Round-48: pinIp:false (default) returns bare { ok: true } without dispatcher — no regression', async () => {
  // The most important regression lock — pre-Round-48 callers
  // use the bare `await assertSafeExternalUrl(url)` shape. A
  // change that always returned { ip, dispatcher } would break
  // every existing caller. We verify the bare ok shape by
  // destructuring.
  const r1 = await assertSafeExternalUrl('https://example.com/')
  assert.equal(r1.ok, true, 'pinIp:false (default) must return ok:true')
  assert.equal(r1.ip, undefined, 'must NOT include ip when pinIp is not opted in')
  assert.equal(r1.dispatcher, undefined, 'must NOT include dispatcher when pinIp is not opted in')
  const r2 = await assertSafeExternalUrl('https://example.com/', { pinIp: false })
  assert.equal(r2.ok, true, 'pinIp:false (explicit) must return ok:true')
  assert.equal(r2.ip, undefined, 'pinIp:true must NOT leak ip when explicit false')
  assert.equal(r2.dispatcher, undefined, 'pinIp:true must NOT leak dispatcher when explicit false')
})

test('Round-48: source-grep — connect hook signature + host-mismatch + SNI binding', () => {
  // Structural lock — a regression that changes the connect hook
  // shape (e.g. drops the secureConnect path or the host-mismatch
  // check) fails loudly here. We assert four substrings:
  //   1. Standard undici (opts, callback) signature
  //   2. `connectOpts.host !== host` rejection (redirect-bypass)
  //   3. servername: host (SNI binding to original hostname)
  //   4. consumer-side `redirect: 'error'` (mandatory under pinning)
  assert.match(
    GUARD_SRC,
    /connect:\s*\(\s*connectOpts\s*,\s*callback\s*\)\s*=>/,
    'dispatcher connect hook must use the standard undici (opts, callback) signature',
  )
  assert.match(
    GUARD_SRC,
    /connectOpts\.host\s*!==\s*host/,
    'dispatcher connect hook MUST refuse connections whose host does not match the pinned hostname (redirect-bypass defence)',
  )
  assert.match(
    GUARD_SRC,
    /servername:\s*host/,
    'TLS connect option must include servername pointing at the ORIGINAL hostname so cert validation works',
  )
  assert.match(
    ROUTE_SRC,
    /redirect:\s*['"]error['"]/,
    'consumer-side (route.js) MUST set redirect:"error" so the connect hook can reject redirects',
  )
})

test('Round-48: source-grep — inline DNS-rebinding caveat inside assertSafeExternalUrl body', () => {
  // The Round-48.3 polish — a one-line inline reminder INSIDE the
  // function body so a maintainer reading the function without
  // scrolling to the file-top postmortem still sees the
  // DNS-rebinding caveat. Locked by source-grep so a future refactor
  // that moves the caveat OUT of the function body breaks loudly.
  const fnStart = GUARD_SRC.indexOf('export async function assertSafeExternalUrl')
  assert.ok(fnStart > 0, 'function declaration must exist')
  const slice = GUARD_SRC.slice(fnStart, fnStart + 1500)
  assert.match(
    slice,
    /DNS-rebinding|TOCTOU|pinIp|re-resolve/i,
    'inline reminder inside the assertSafeExternalUrl body must reference DNS-rebinding / TOCTOU / pinIp so a maintainer reading the function sees the caveat',
  )
})

test('Round-48: source-grep — undici Agent import is soft-failure (Try/Catch)', () => {
  // The guard module's undici import is wrapped in try/catch so the
  // route doesn't crash if undici isn't in node_modules. Locked via
  // regex on the source — a regression that hard-fails the import
  // would take the whole email-body route offline in undici-less
  // sandboxes.
  assert.match(
    GUARD_SRC,
    /try\s*\{[^}]*(?:require|esmRequire)\s*\(\s*['"]undici['"]\s*\)[^}]*\}\s*catch/,
    'undici import must be wrapped in try/catch (soft-fail for undici-less envs — accepts Round-48 bare require OR Round-50 esmRequire shape)',
  )
})

// =============================================================================
// Round-50 — ESM-safe createRequire polish (defence-in-depth)
// =============================================================================
//
// Round-49 surfaced the bug that ESM-mode lib/ssrf-guard.js was calling
// `require('undici')` (CommonJS-only API). The pre-fix try/catch did
// catch the ReferenceError on ESM Bundlers, but the error string then
// leaked into Sentry/log dashboards as "ReferenceError: require is
// not defined" — fixable cleanly with `createRequire(import.meta.url)`
// from `node:module`. Round-50 locks the new contract: lib/ssrf-guard.js
// must use `createRequire(import.meta.url)` with NO bare `require('undici')`
// call outside the createRequire alias.

test('Round-50: lib/ssrf-guard.js must import createRequire from node:module', () => {
  assert.match(
    GUARD_SRC,
    /import\s*\{\s*createRequire\s*\}\s*from\s*['"]node:module['"]/,
    'lib/ssrf-guard.js must import { createRequire } from "node:module" (ESM-safe CommonJS escape hatch)',
  )
})

test('Round-50: lib/ssrf-guard.js must call createRequire(import.meta.url)', () => {
  assert.match(
    GUARD_SRC,
    /createRequire\s*\(\s*import\.meta\.url\s*\)/,
    'lib/ssrf-guard.js must call createRequire(import.meta.url) — the canonical ESM-safe require factory',
  )
})

test('Round-50: lib/ssrf-guard.js must NOT have a bare top-level require() (only via createRequire alias)', () => {
  // Strip strings + comments before searching for bare `require(` —
  // a `require(...)` mention in a JSDoc comment must not trigger a
  // false positive. We do a minimal string/comment skip: any char
  // inside a single-quote, double-quote, or template literal is
  // ignored, as is everything from "//" to end-of-line and from
  // "/*" to the matching "*/".
  const stripped = stripStringsAndComments(GUARD_SRC)
  // Bare `require(` outside a string/comment — must not appear.
  // Greedy regex handles the most likely regression (someone
  // editing the file to add a Bash-script-style require at module
  // scope) without needing full AST parsing.
  const bareRequire = /\brequire\s*\(/.exec(stripped)
  assert.equal(
    bareRequire,
    null,
    'lib/ssrf-guard.js must not contain a bare top-level require() call after Round-50 — use the createRequire alias instead',
  )
})

test('Round-50: lib/ssrf-guard.js must alias the created require as esmRequire (named so esmRequire("undici") is the contract)', () => {
  // Belt-and-braces — the resolve-time error message returned to
  // /api/extension/email-body references 'esmRequire' in the
  // implementation comment. A regression that switches the local
  // variable name (e.g. `const req = createRequire(...)`, with no
  // `esmRequire`) would still be ESLint-correct but the diff loses
  // the structural intent. We lock on the literal identifier so
  // the alias name is part of the contract.
  assert.match(
    GUARD_SRC,
    /const\s+esmRequire\s*=\s*createRequire\s*\(\s*import\.meta\.url\s*\)/,
    'lib/ssrf-guard.js must declare `const esmRequire = createRequire(import.meta.url)` — lock the alias name',
  )
  assert.match(
    GUARD_SRC,
    /\besmRequire\s*\(\s*['"]undici['"]\s*\)/,
    'lib/ssrf-guard.js must call esmRequire("undici") (NOT bare require("undici"))',
  )
})

// Belt-and-braces helper — strips strings + comments from JS source
// so the bare-require search doesn't false-positive on a JSDoc
// mention. Not as robust as tests/unit/lib/js-source-helpers.mjs
// (template `${...}` interpolation recursion is a round-50 pollish
// gap) but matches the contract: refuse bare `require(` outside
// comments+strings.
function stripStringsAndComments(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      out += ch
      const quote = ch
      i++
      while (i < src.length) {
        const c = src[i]
        if (c === '\\') { out += '\\\\'; i += 2; continue }
        if (c === quote) { out += c; i++; break }
        out += c
        i++
      }
      continue
    }
    if (ch === '/' && src[i + 1] === '/' && (i === 0 || src[i - 1] !== '\\')) {
      const nl = src.indexOf('\n', i)
      i = nl >= 0 ? nl : src.length
      continue
    }
    if (ch === '/' && src[i + 1] === '*' && (i === 0 || src[i - 1] !== '\\')) {
      const end = src.indexOf('*/', i + 2)
      i = end >= 0 ? end + 2 : src.length
      continue
    }
    out += ch
    i++
  }
  return out
}

test('Round-48: source-grep — fail-closed when undici unavailable + pinIp requested', () => {
  // Round-48 contract — when pinIp:true AND undici is unavailable,
  // the guard must return `{ ok: false, error: 'IP-pinning stöds
  // inte i denna miljö...' }` rather than silently downgrading to a
  // no-pin path. Locked via Swedish error string literal so a
  // future localiser sees the contract.
  assert.match(
    GUARD_SRC,
    /IP-pinning stöds inte/,
    'fail-closed Swedish error string must be present when pinIp is requested but undici is unavailable',
  )
})
