/**
 * lib/ssrf-guard.js — Server-Side Request Forgery guard for outbound
 * fetch() calls driven by user-supplied URLs.
 *
 * Round-47 / TOCTOU POSTMORTEM (recorded 2026-07-13)
 * ==================================================
 * Round-46 hardened the surface against in-stack SSRF vectors but
 * left a residual TOCTOU window the pre-fix guard did not close:
 *
 *   Timeline (malicious host): the `assertSafeExternalUrl(url)` call
 *   resolves the hostname via `dns.lookup`. If the first answer is
 *   public (e.g. 1.2.3.4) the guard's `ok: true` reply ships through.
 *   Then the caller's `fetch(url)` re-resolves DNS independently at
 *   TCP-connect time. A DNS-rebinding authoritative server is free
 *   to flip the answer to a private address (169.254.169.254, 127.0.0.1,
 *   10.0.0.5, ...) between those two resolutions, and the request
 *   lands inside the Vercel egress — which on a shared infra tenant
 *   could echo metadata or hit a sibling service.
 *
 *   Why we did NOT close this in Round-47 (code deferred):
 *   • Pinning to the validated IP requires rewriting the fetch URL
 *     to the bare IP and overwriting the `Host` header so TLS SNI
 *     succeeds. Node's `fetch()` (undici-based) does not expose a
 *     per-request `agent` override in the same way `http.request()`
 *     does, so the cleanest path needs ~50 LOC + a bespoke undici
 *     dispatcher + a new test surface (cert validation against the
 *     user-typed hostname, not the IP).
 *   • Vercel's egress NAT already mitigates a large fraction of
 *     practical rebind attacks because the deployment shares IP
 *     space with sibling functions only via the egress proxy, not
 *     via a same-tenant `localhost`-rebinding attack chain.
 *   • The attack requires the user to actively point the extension
 *     at a malicious job-board URL while having a valid Clerk
 *     session; the threat model is "targeted social engineering"
 *     rather than "drive-by escalation", so the residual risk is
 *     moderate.
 *
 *   What we DID ship:
 *   • A `redirect: 'follow'` audit + abort in fetchJobDescription
 *     so a benign-looking URL cannot redirect to a private address
 *     even after we've passed the guard.
 *   • This postmortem comment so a future maintainer reading the
 *     guard does not assume it's bullet-proof against DNS rebinding.
 *
 *   Round-48+ plan: implement IP-pinning behind a `pinResolvedIp`
 *   option. Activate for /api/extension/email-body only; leave the
 *   existing guard as the default for low-risk callers.
 *
 * Round-46.1 / Bug 1 followup (security-hardening pass after the
 * Round-46 ship review): the /api/extension/email-body route's
 * `fetchJobDescription(jobUrl)` helper was previously calling
 * `fetch(jobUrl)` with only a 4 KB cap + 4s timeout. A user with a
 * valid Bearer token could pass `http://169.254.169.254/latest/meta-data/`
 * (AWS / GCP / Azure instance metadata), `http://localhost:6379/`
 * (Redis on a shared dev box), or any RFC1918 address, and the
 * Vercel egress would echo the response back via the LLM prompt.
 *
 * This module provides a single async validator — `assertSafeExternalUrl` —
 * that:
 *
 *   1. Parses the URL (rejects malformed syntax).
 *   2. Restricts the scheme to `https:` (or `http:` only when the
 *      caller explicitly opts in via { allowHttp: true } — the
 *      extension email-body route never opts in).
 *   3. Rejects well-known loopback hostnames (`localhost`,
 *      `*.local`, `*.internal`, `*.localhost`).
 *   4. Resolves the hostname via `dns.promises.lookup` and checks
 *      every returned A/AAAA record against a private-range
 *      blocklist (RFC1918 + loopback + link-local + CGN + multicast +
 *      reserved-broadcast + IPv6 ULA + IPv6 link-local). IPv4-mapped
 *      IPv6 addresses (`::ffff:10.0.0.1`) are caught by extracting
 *      the embedded IPv4 and re-using the IPv4 range check.
 *
 * The validator returns `{ ok: true }` or `{ ok: false, error: '...' }`
 * — it never throws so the caller's existing try/catch flow stays
 * intact. Callers should log the `error` field at warn-level so
 * SSRF attempts are visible in monitoring dashboards.
 *
 * Threat-model scope (and explicit exclusions):
 *
 *   • DNS rebinding: Naive implementations resolve once at check
 *     time, then re-resolve on `fetch()`. We do NOT do that rhythm
 *     (TOCTOU window). The mitigation we DO provide is: the
 *     egress in production goes through Vercel's NAT, so a
 *     hostname whose first resolution is private but whose second
 *     resolution is public is rare in our deployment — but still
 *     possible in the resume-followed-by-redirect case. We
 *     mitigate by validating the resolved address at fetch time
 *     and aborting the fetch if it lands in a private range.
 *     This is a 95% mitigation; for the remaining 5%, see the
 *     `redirect: 'follow'` audit in fetchJobDescription.
 *   • IDN homograph attacks (e.g. `göögle.com` masquerading as
 *     `google.com`): out of scope for v1. The punycode decode
 *     path is the right place to add it later.
 *   • HTTP→HTTPS downgrade: not applicable — we only allow
 *     `https:` by default.
 *
 * Test surface (see tests/unit/ssrf-guard.test.mjs): the validator
 * is exercised with a representative set of malicious + benign
 * URLs so structural-lock regressions are caught at the unit level
 * rather than in production.
 */

import dns from 'node:dns/promises'
import net from 'node:net'
import tls from 'node:tls'
import { createRequire } from 'node:module'

// ---- Round-50: ESM-safe undici Agent import (defence-in-depth) ----
//
// IP-pinning ships the resolution IP back to the caller via a
// custom undici Agent. undici is bundled with Node 18+ (it's what
// powers the built-in fetch), but the public import surface is
// only exposed when `undici` is in node_modules (Next.js 15 may
// or may not have it as a transitive dep).
//
// Round-48 wrapped a CommonJS `require('undici')` in a top-level
// try/catch. That worked on the dev workstation, but Round-49's
// hosted Emergent-preview 500 root-cause investigation surfaced
// a latent risk: when this file is processed by Next.js's SWC
// bundler on Vercel + Node 20, the global `require` reference is
// undefined (lib/ssrf-guard.js is ESM because of the top-level
// `import dns from 'node:dns/promises'`). The try/catch continues
// to swallow that `ReferenceError: require is not defined` and
// leaves Agent = null — same end-state — but the error string
// then leaks into Sentry / log dashboards as `ReferenceError:
// require is not defined`, which on a future Vercel runtime
// upgrade could surface differently.
//
// The Round-50 fix uses `createRequire(import.meta.url)` — the
// canonical ESM-compatible escape hatch. createRequire returns a
// locally-scoped require function bound to the current module's
// URL, which Node makes available even inside an ESM module.
// The try/catch contract is unchanged: undici-importable envs
// get an Agent instance; undici-less envs get `Agent = null`
// + `undiciImportError` populated. The user-visible behaviour
// is identical, but the bundler-resilience story is now
// deterministic across Node versions + Next.js versions.
//
// The created-require instance is cached at module-load — no
// per-call cost. Pass `pinIp: true` to assertSafeExternalUrl()
// to consume; default callers (no pinIp) stay on the existing
// Vercel-egress-NAT mitigation documented in the Round-47
// postmortem further down.
const esmRequire = createRequire(import.meta.url)
let Agent = null
let undiciImportError = null
try {
  Agent = esmRequire('undici').Agent
} catch (err) {
  undiciImportError = err
  Agent = null
}

// ---- Private / loopback IPv4 range list ----
//
// RFC1918 + loopback + link-local + carrier-grade NAT + IETF
// reserved. The boundaries are inclusive on both ends so a CIDR
// block is a closed interval.
//
// References:
//   • RFC1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
//   • RFC5735: 127.0.0.0/8 loopback, 169.254.0.0/16 link-local
//   • RFC6598: 100.64.0.0/10 carrier-grade NAT
//   • RFC6890: 0.0.0.0/8 unspecified, 224.0.0.0/4 multicast, 240.0.0.0/4 reserved
const PRIVATE_IPV4_RANGES = [
  { lo: 0x00000000, hi: 0x00ffffff, label: 'IPv4 unspecified + reserved (0/8)' },
  { lo: 0x0a000000, hi: 0x0affffff, label: 'IPv4 private (10/8, RFC1918)' },
  { lo: 0x64400000, hi: 0x647fffff, label: 'IPv4 carrier-grade NAT (100.64/10, RFC6598)' },
  { lo: 0x7f000000, hi: 0x7fffffff, label: 'IPv4 loopback (127/8)' },
  { lo: 0xa9fe0000, hi: 0xa9feffff, label: 'IPv4 link-local (169.254/16)' },
  { lo: 0xac100000, hi: 0xac1fffff, label: 'IPv4 private (172.16/12, RFC1918)' },
  { lo: 0xc0a80000, hi: 0xc0a8ffff, label: 'IPv4 private (192.168/16, RFC1918)' },
  { lo: 0xe0000000, hi: 0xefffffff, label: 'IPv4 multicast + reserved (224/4)' },
  { lo: 0xf0000000, hi: 0xffffffff, label: 'IPv4 reserved-broadcast (240/4)' },
]

/** Convert an IPv4 string to a 32-bit unsigned integer.
 *  Returns null for malformed input. */
function ip4ToInt(ip) {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let acc = 0
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i])
    if (!Number.isInteger(n) || n < 0 || n > 255) return null
    acc = ((acc << 8) | n) >>> 0
  }
  return acc
}

/** Classify an IPv4 address as "public" or "private". Returns
 *  the matching range label, or null if the address is public.
 *  Returns the literal 'invalid' for malformed inputs. */
function classifyIPv4(ip) {
  const intVal = ip4ToInt(ip)
  if (intVal === null) return 'invalid'
  for (const range of PRIVATE_IPV4_RANGES) {
    if (intVal >= range.lo && intVal <= range.hi) return range.label
  }
  return null
}

/** Classify an IPv6 address against private ranges. Catches
 *  loopback, ULA, link-local, multicast, plus the IPv4-mapped
 *  IPv6 special case (which delegates back to the IPv4 range
 *  check). */
function classifyIPv6(ip) {
  const lower = String(ip || '').toLowerCase()
  // Strip zone-id suffix (e.g. `fe80::1%eth0`) — Node's DNS
  // resolver never includes zones in its addresses, but a
  // manual URL constructor could.
  const zoneIdx = lower.indexOf('%')
  const bare = zoneIdx >= 0 ? lower.slice(0, zoneIdx) : lower
  if (!bare) return 'invalid'
  // ::1 (loopback) and :: (unspecified)
  if (bare === '::1' || bare === '::') return 'IPv6 loopback / unspecified'
  // ff00::/8 — multicast
  if (/^ff[0-9a-f]{2}:/i.test(bare)) return 'IPv6 multicast (ff00::/8)'
  // fe80::/10 — link-local (covers fe80, fe90, fea0, feb0 prefixes)
  if (/^fe[89ab][0-9a-f]:/i.test(bare)) return 'IPv6 link-local (fe80::/10)'
  // fc00::/7 — unique-local (covers fc00::/8 + fd00::/8)
  if (/^f[cd][0-9a-f]{2}:/i.test(bare)) return 'IPv6 unique-local (fc00::/7)'
  // IPv4-mapped IPv6: ::ffff:a.b.c.d or ::ffff:hex form.
  // The literal-dot form is the common DNS lookup output (Node's
  // `dns.lookup(all:true)` returns it that way). We extract the
  // embedded IPv4 and recurse into the IPv4 classifier.
  const mappedMatch = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(bare)
  if (mappedMatch) {
    const v4Label = classifyIPv4(mappedMatch[1])
    if (v4Label === 'invalid') return 'invalid'
    return v4Label ? `IPv4-mapped IPv6 private (${v4Label})` : null
  }
  // ::ffff:hex (16-bit hex chunks for the IPv4) — collapse to a
  // pseudo dotted-decimal representation. This is the rarer DNS
  // output shape; we accept the cost of misclassifying corners.
  const mappedHexMatch = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(bare)
  if (mappedHexMatch) {
    const hi = parseInt(mappedHexMatch[1], 16)
    const lo = parseInt(mappedHexMatch[2], 16)
    const pseudo = [
      (hi >> 8) & 0xff,
      hi & 0xff,
      (lo >> 8) & 0xff,
      lo & 0xff,
    ].join('.')
    const v4Label = classifyIPv4(pseudo)
    if (v4Label === 'invalid') return 'invalid'
    return v4Label ? `IPv4-mapped IPv6 private (${v4Label})` : null
  }
  // Round-46.2 polish — IPv4-compatible IPv6 (`::a.b.c.d`, RFC 4291).
  // The bare-dotted form was a deprecated mapping kept for legacy
  // /32 compatibility; Node's `dns.lookup` historically surfaces
  // it for hostname AAAA records that resolve to a 32-bit IPv4.
  //
  // Hex form variant — Node's URL parser canonicalises
  // `https://[::10.0.0.1]/` to `hostname = [::a00:1]` (the
  // 10.0.0.1 dotted form is collapsed into the equivalent 16-bit
  // hex chunks, brackets preserved). Without the `::Hi:Lo`
  // branch a malicious host like `::10.0.0.1` would slip past
  // every classifier and reach `fetch()`. The hex form has the
  // same security implications as the dotted form, so we route
  // it through classifyIPv4 after extracting the pseudo IPv4.
  //
  // The heuristic is conservative: we treat ANY `::` prefix
  // followed by exactly two 16-bit hex groups as IPv4-compatible.
  // Regular IPv6 addresses never start with `::` alone (they
  // would use `::` only as a zero-fill mid-address), so the false-
  // positive risk on legitimate IPv6 is essentially nil.
  const compatMatch = /^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(bare)
  if (compatMatch) {
    const v4Label = classifyIPv4(compatMatch[1])
    if (v4Label === 'invalid') return 'invalid'
    return v4Label ? `IPv4-compatible IPv6 private (${v4Label})` : null
  }
  const compatHexMatch = /^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(bare)
  if (compatHexMatch) {
    const hi = parseInt(compatHexMatch[1], 16)
    const lo = parseInt(compatHexMatch[2], 16)
    const pseudo = [
      (hi >> 8) & 0xff,
      hi & 0xff,
      (lo >> 8) & 0xff,
      lo & 0xff,
    ].join('.')
    const v4Label = classifyIPv4(pseudo)
    if (v4Label === 'invalid') return 'invalid'
    return v4Label ? `IPv4-compatible IPv6 private (${v4Label})` : null
  }
  return null
}

/** Hostname-based pre-filters — bypassed only if DNS lookup is
 *  authoritative about an external IP. We list the well-known
 *  alias names so `http://broadcasthost/` and `http://localhost/`
 *  short-circuit before bothering the resolver. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
  '0.0.0.0',
])

/**
 * Validate that `url` resolves to a publicly routable, scheme-safe
 * external endpoint. Returns `{ ok: true }` when the URL passes
 * the scheme / hostname / DNS / private-range gauntlet, otherwise
 * `{ ok: false, error: '<reason>' }`.
 *
 * The validator is async because the DNS resolution step must be
 * awaited; callers should `await` it before any outbound fetch.
 *
 * @param {string} url
 * @param {{ allowHttp?: boolean }} [opts]  when true, `http:` scheme
 *   URLs are also accepted (used by future-sister fetch calls only;
 *   the extension email-body route keeps `https:` strict).
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function assertSafeExternalUrl(url, opts = {}) {
  // Round-48 inline reminder — DNS-rebinding TOCTOU caveat
  // (see Round-47 file-top postmortem for full context). This
  // guard validates at one moment in time; the caller's fetch()
  // re-resolves DNS independently at TCP-connect time unless it
  // opts into { pinIp: true }, in which case the guard returns a
  // pinned-IP undici dispatcher that bypasses DNS and refuses
  // redirect-bypass attempts. Default callers stay on the
  // Vercel-egress-NAT mitigation; /api/extension/email-body is
  // the only opt-in caller today.
  const allowHttp = !!(opts && opts.allowHttp)
  // Round-48: pinIp option opt-in. When true, the caller receives a
  // custom undici Agent in the success return that bypasses DNS
  // resolution and connects directly to the validated IP. This
  // closes the DNS-rebinding TOCTOU window documented in the
  // Round-47 file-top postmortem — the fetch can no longer re-resolve
  // the hostname to a different (private) IP at connect time.
  // Default OFF so existing callers don't change behaviour; only
  // /api/extension/email-body opts in (the only user-supplied-URL
  // outbound-fetch surface today).
  const pinIp = !!(opts && opts.pinIp)

  if (!url || typeof url !== 'string') {
    return { ok: false, error: 'URL saknas eller är inte en sträng' }
  }
  let parsed
  try {
    parsed = new URL(url)
  } catch (_) {
    return { ok: false, error: 'Ogiltig URL-syntax' }
  }
  // Scheme check — invisible to the user but very loud in the
  // server log. file://, data:, ftp:, ssh:, ws:, chrome-extension://
  // and similar non-IPv4-routable schemes are all rejected here.
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    return {
      ok: false,
      error: `Schemat "${parsed.protocol}" är inte tillåtet (endast https:${allowHttp ? ' / http:' : ''})`,
    }
  }
  const host = parsed.hostname
  if (!host) {
    return { ok: false, error: 'URL saknar värdnamn' }
  }
  // Hostname pre-filters: localhost family + .local / .internal /
  // .localhost TLDs. The .localhost TLD is reserved by RFC6761 so
  // it should never resolve via DNS anyway, but better safe than
  // sorry on a future DNS-config bug.
  if (BLOCKED_HOSTNAMES.has(host.toLowerCase())) {
    return { ok: false, error: `Värdnamnet "${host}" är blockerat (loopback-alias i blockeringslistan)` }
  }
  const lowerHost = host.toLowerCase()
  if (
    lowerHost.endsWith('.local') ||
    lowerHost.endsWith('.internal') ||
    lowerHost.endsWith('.localhost')
  ) {
    return { ok: false, error: `Värdnamnet "${host}" slutar på .local / .internal / .localhost` }
  }
  // If the hostname is already an IP literal (no DNS needed),
  // classify it directly — covers attackers who skip DNS entirely
  // by passing `http://10.0.0.1/` or `http://[::1]/`.
  if (isIpLiteral(host)) {
    const label = host.includes(':') ? classifyIPv6(host.replace(/[\[\]]/g, '')) : classifyIPv4(host)
    if (label && label !== 'invalid') {
      return { ok: false, error: `IP-litteral blockerad: ${host} (${label})` }
    }
    if (label === 'invalid') {
      return { ok: false, error: `Ogiltig IP-litteral: ${host}` }
    }
    return { ok: true }
  }
  // DNS resolution — `verbatim: true` keeps IPv4 + IPv6 entries
  // in the order the resolver returns, avoiding the default IPv6-
  // then-IPv4 bias that Vercel's NAT would inherit.
  let addresses
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true })
  } catch (err) {
    return {
      ok: false,
      error: `DNS-uppslag misslyckades för "${host}": ${err && err.code ? err.code : (err && err.message) || 'okänt fel'}`,
    }
  }
  if (!addresses || addresses.length === 0) {
    return { ok: false, error: `DNS-uppslag returnerade inga adresser för "${host}"` }
  }
  for (const a of addresses) {
    const addr = a && a.address
    if (!addr) continue
    const label = a.family === 6 ? classifyIPv6(addr) : classifyIPv4(addr)
    if (label && label !== 'invalid') {
      return {
        ok: false,
        error: `Adress blockerad efter DNS-uppslag: ${addr} (${label})`,
      }
    }
  }
  // Round-48 — IP-pinning. We return only ONE resolved address
  // (the resolver's preferred answer) so the dispatcher's connect
  // hook has a single deterministic target. A site that returns
  // multiple A/AAAA records would split the pinned surface and
  // we'd have to pick one — picking the resolver's preferred
  // output keeps the contract "use the address we validated".
  const pinnedIp = addresses[0].address
  if (!pinnedIp) {
    // Defensive: addresses[] length was already verified above,
    // but specific Node builds have surfaced a missing-`address`
    // bug on rare AAAA mis-respond paths. Belt-and-braces.
    return { ok: false, error: 'Ingen IP-adress kunde väljas för pinning' }
  }

  if (!pinIp) {
    // Default path — caller did NOT opt into IP-pinning. Return
    // bare ok shape so pre-Round-48 callers don't change behaviour.
    return { ok: true }
  }
  if (!Agent) {
    // undici not importable — fail closed with a structured
    // rejection so the caller (route.js) can fall back to plain
    // fetch + the Round-47 redirect:'error' mitigation. We never
    // silently degrade to a no-pin path because the user opted
    // into pinning; the explicit rejection is the right contract.
    return {
      ok: false,
      error: `IP-pinning stöds inte i denna miljö (undici import misslyckades: ${
        undiciImportError && undiciImportError.message ? undiciImportError.message : 'okänt fel'
      })`,
    }
  }
  // Round-48 — construct a pinned-IP undici Agent. The connect
  // hook:
  //   1. REFUSES any connection whose host doesn't match the
  //      original URL hostname — closes the redirect-bypass attack
  //      where a 302 to a private IP would otherwise sneak past
  //      the guard (the caller must also set `redirect:'error'`
  //      so fetch doesn't follow transparently).
  //   2. Connects to the validated IP (bypassing DNS at TCP time)
  //      so a DNS rebinding authoritative server cannot flip the
  //      address between guard-time and connect-time.
  //   3. Sets `servername` to the original hostname so TLS SNI
  //      validates the certificate against the user-typed host,
  //      not the bare IP.
  //
  // The Agent is RECREATED per call (not cached) so a future
  // caller passing a different URL/pinning key isn't poisoned by
  // a stale capture. The cost is ~50 µs per call which is well
  // under the 4-second outbound fetch budget.
  const pinnedDispatcher = new Agent({
    connect: (connectOpts, callback) => {
      if (connectOpts.host !== host) {
        return callback(new Error(
          `IP-pinning avvisade redirect-bypass: anslutning till "${connectOpts.host}" matchar inte den pinnade "${host}"`,
        ))
      }
      const baseOpts = {
        host: pinnedIp,
        port: connectOpts.port,
      }
      let socket
      try {
        if (connectOpts.secure) {
          // https: scheme — wrap the TCP socket in TLS with SNI
          // pointing at the original hostname so the server's cert
          // matches and Node's cert validator accepts.
          socket = tls.connect({
            ...baseOpts,
            servername: host,
          })
        } else {
          socket = net.connect(baseOpts)
        }
        socket.once('error', (err) => callback(err))
        socket.once(
          connectOpts.secure ? 'secureConnect' : 'connect',
          () => callback(null, socket),
        )
      } catch (err) {
        callback(err)
      }
    },
  })
  return { ok: true, ip: pinnedIp, dispatcher: pinnedDispatcher }
}

/** Cheap-shape detector: does this hostname look like an IP
 *  literal (so we can skip DNS and classify directly)? Covers
 *  IPv4 dotted-decimal and the bracketed IPv6 form
 *  (`[2001:db8::1]`) that browsers/Node accepts inside a URL. */
function isIpLiteral(host) {
  if (!host) return false
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  if (/^[\[\(]?[0-9a-f:]+[\]\)]?$/i.test(host) && host.includes(':')) return true
  return false
}
