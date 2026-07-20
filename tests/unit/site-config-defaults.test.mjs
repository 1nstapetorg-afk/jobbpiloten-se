// tests/unit/site-config-defaults.test.mjs
//
// Round-72 structural-lock test for lib/siteConfig.js.
//
// SiteConfig is the single source of truth for brand defaults +
// extension publication state. It declares LAUNCH-GATE PLACEHOLDER
// defaults that an operator is expected to override via env at deploy
// time. Drift here would be silent (a flaky dev-session or wrong
// footer copy on /privacy), so we lock the most fragile surfaces:
//   1. LAUNCH-GATE PLACEHOLDER comment grep (Round-72 originator note).
//   2. Default LEGAL_COMPANY_NAME / SUPPORT_EMAIL / PRIVACY_EMAIL.
//   3. Default SITE_URL + PUSH_VAPID_FALLBACK_SUBJECT (mailto: format).
//   4. Default VAPID_PUBLIC_KEY shape (87-char base64 of a P-256
//      ECDSA point — longer than that would be a malformed keypair
//      that fails web-push subscription on the dashboard).
//   5. EXTENSION_PUBLISHED exact-equals-'1' gate (NOT truthy —
//      `EXTENSION_PUBLISHED = 'true'` was a real bug once and the
//      contract is bytewise literal).
//   6. EXTENSION_STORE_URL / EXTENSION_INSTALL_GUIDE_PATH defaults.
//   7. `process.env.NEXT_PUBLIC_*` is the read surface for every public
//      override (mirrors HANDOFF.md §3 public-vs-private layout).
//
// Mirrors the per-file / per-page contract from tests/unit/groq-*
// tests — ONE assertion per claim, bytewise literals where possible
// so a future template-literal swap doesn't silently break.
//
// Not covered (kept out of lock so future refactors don't trip):
// • Behavioural evaluation of the env-override chains. The dashboard
//   exercises the real `process.env` reads; structural contracts are
//   surfaced via these tests.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const SRC_PATH = 'lib/siteConfig.js'
const SRC = readFileSync(SRC_PATH, 'utf8')

// Pre-flight: the contract file exists. Clearer than a vague
// "readFileSync failed" message from the underlying system error.
test('Round-72: lib/siteConfig.js exists at the canonical path', () => {
  assert.ok(existsSync(SRC_PATH), `${SRC_PATH} must exist for these locks to be meaningful`)
})

test('Round-72: LAUNCH-GATE PLACEHOLDER marker is present (originator-note preserved)', () => {
  // The marker comment is what an operator greps for before launch.
  // It must remain in lib/siteConfig.js so a future maintainer
  // adding a new env-driven default remembers to mark it.
  assert.ok(
    SRC.includes('LAUNCH-GATE PLACEHOLDER'),
    'lib/siteConfig.js must keep the LAUNCH-GATE PLACEHOLDER marker comment so a launch-day grep still surfaces it',
  )
})

test('Round-72: LEGAL_COMPANY_NAME default is the Swedish "JobbPiloten Sweden AB"', () => {
  assert.ok(
    SRC.includes("'JobbPiloten Sweden AB'"),
    'Legal entity default must stay the Swedish "JobbPiloten Sweden AB" (no TechSweden AB regression)',
  )
  assert.ok(
    SRC.includes("process.env.NEXT_PUBLIC_LEGAL_COMPANY_NAME || 'JobbPiloten Sweden AB'"),
    'LEGAL_COMPANY_NAME must read NEXT_PUBLIC_LEGAL_COMPANY_NAME first, fallback to "JobbPiloten Sweden AB"',
  )
})

test('Round-72: SUPPORT_EMAIL default is "hej@jobbpiloten.se"', () => {
  assert.ok(
    SRC.includes("process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'hej@jobbpiloten.se'"),
    'SUPPORT_EMAIL must read NEXT_PUBLIC_SUPPORT_EMAIL first, fallback to hej@jobbpiloten.se',
  )
})

test('Round-72: PRIVACY_EMAIL default is "privacy@jobbpiloten.se"', () => {
  assert.ok(
    SRC.includes("process.env.NEXT_PUBLIC_PRIVACY_EMAIL || 'privacy@jobbpiloten.se'"),
    'PRIVACY_EMAIL must read NEXT_PUBLIC_PRIVACY_EMAIL first, fallback to privacy@jobbpiloten.se',
  )
})

test('Round-72: SITE_URL default is the production canonical https://jobbpiloten.se', () => {
  assert.ok(
    SRC.includes("process.env.NEXT_PUBLIC_BASE_URL || 'https://jobbpiloten.se'"),
    'SITE_URL must read NEXT_PUBLIC_BASE_URL first, fallback to https://jobbpiloten.se',
  )
})

test('Round-72: PUSH_VAPID_FALLBACK_SUBJECT uses a mailto: URL', () => {
  // Web-push spec requires `mailto:` here. Drift to a plain URL would
  // silently fail every push-subscription attempt at runtime.
  assert.ok(
    SRC.includes('export const PUSH_VAPID_FALLBACK_SUBJECT = `mailto:${SUPPORT_EMAIL}`'),
    'PUSH_VAPID_FALLBACK_SUBJECT must be a mailto: URL derived from SUPPORT_EMAIL (web-push spec requirement)',
  )
})

test('Round-72: VAPID_PUBLIC_KEY default is a 87-char base64 P-256 ECDSA public key', () => {
  // The fallback public key is hardcoded for the soft-launch window
  // so the dashboard's subscribe button works without a .env file.
  // The 87-char length is the wire shape for `Crypto-Key` /
  // `applicationServerKey` (raw 65-byte uncompressed point → base64
  // header + payload). A shorter or longer fallback is a malformed
  // keypair that fails web-push subscription at the dashboard.
  //
  // Char class covers STANDARD base64 (`A-Z a-z 0-9 + / =`) AND
  // URL-safe base64 (`A-Z a-z 0-9 - _`) because `npx web-push
  // generate-vapid-keys` emits URL-safe base64 (RFC 8292), which
  // includes `-` and `_` in addition to the standard alphabet.
  // Excluding either alphabet would false-fail on the format
  // the operator actually uses.
  const m = SRC.match(/VAPID_PUBLIC_KEY[\s\S]{0,400}/)
  assert.ok(m, 'VAPID_PUBLIC_KEY declaration block must be discoverable')
  // Pull the first string-literal default (between the `||` and the closing quote).
  const fallbackMatch = m[0].match(/\|\|\s*\n\s*'([A-Za-z0-9+/=\-_]+)'/)
  assert.ok(fallbackMatch, 'VAPID_PUBLIC_KEY must have a single-quoted string fallback after `||`')
  const fallback = fallbackMatch[1]
  assert.equal(
    fallback.length, 87,
    `VAPID_PUBLIC_KEY fallback must be a 87-char base64 P-256 ECDSA public key — found ${fallback.length} chars`,
  )
  // Also lock that the chars are ALL base64 alphabet (no spaces,
  // no punctuation outside `+/=\-_`). Drift here would let a
  // malformed key slip past the length check and fail at the
  // browser's `PushManager.subscribe()` call.
  assert.ok(
    /^[A-Za-z0-9+/=\-_]+$/.test(fallback),
    'VAPID_PUBLIC_KEY fallback must be pure base64 alphabet (standard + URL-safe)',
  )
})

test('Round-72: EXTENSION_PUBLISHED gate uses exact-equals-\'1\' (NOT truthy)', () => {
  // Round-67: setting the env var to `true` (a JS boolean string)
  // silently kept the gate false because `'true' !== '1'`. Lock
  // the bytewise literal `=== '1'` so the next refactor doesn't
  // re-introduce the bug by switching to truthy check.
  assert.ok(
    SRC.includes("process.env.NEXT_PUBLIC_EXTENSION_PUBLISHED === '1'"),
    'EXTENSION_PUBLISHED must use exact-equals-`1` (literal string compare, NOT truthy check)',
  )
})

test('Round-72: EXTENSION_STORE_URL default is the local /extension-install path', () => {
  // The local install guide is the soft-launch default so the
  // banner link is never a broken /details/PLACEHOLDER stub.
  assert.ok(
    SRC.includes("process.env.NEXT_PUBLIC_EXTENSION_STORE_URL || '/extension-install'"),
    'EXTENSION_STORE_URL must default to /extension-install, NOT a placeholder URL',
  )
})

test('Round-72: EXTENSION_INSTALL_GUIDE_PATH is the canonical /extension-install path', () => {
  assert.ok(
    SRC.includes("export const EXTENSION_INSTALL_GUIDE_PATH = '/extension-install'"),
    'EXTENSION_INSTALL_GUIDE_PATH must be the literal `/extension-install` so dashboard + settings + any share link converge',
  )
})
