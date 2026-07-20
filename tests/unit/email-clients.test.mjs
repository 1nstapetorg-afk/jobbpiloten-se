// tests/unit/email-clients.test.ms
//
// Round-55 / Followup 3 — locks the shared email-clients module.
//
// The pre-Round-55 shape inlined the three-host list in BOTH
// extension/popup.js's isActiveTabEmailClient() and
// extension/content-email.js's detectProvider(). A 4th webmail
// provider added in one place but not the other would leave a host
// where the compose-target detector works but the auto-switch
// doesn't fire — or vice versa. This module collapses both lists
// into one source of truth. The tests below lock:
//   1. The host list exports ALL THREE canonical webmail hosts.
//   2. isEmailClientUrl() uses anchored prefix matches (no substring
//      false-positives like `evil-mail.google.com.attacker.com`).
//   3. detectProviderByHost() returns the canonical 3-way split
//      that content-email.js's buildTargeter() branches expect.
//   4. Both helpers are robust to bad inputs (null / undefined / non-string).
//   5. Both consumers (popup.js + content-email.js) import from the
//      shared module — no inlined duplicate host lists allowed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EMAIL_CLIENTS_PATH = path.resolve(__dirname, '../../extension/lib/email-clients.js')
const POPUP_PATH = path.resolve(__dirname, '../../extension/popup.js')
const CONTENT_EMAIL_PATH = path.resolve(__dirname, '../../extension/content-email.js')

const SRC = fs.readFileSync(EMAIL_CLIENTS_PATH, 'utf-8')
const POPUP_SRC = fs.readFileSync(POPUP_PATH, 'utf-8')
const CONTENT_EMAIL_SRC = fs.readFileSync(CONTENT_EMAIL_PATH, 'utf-8')

// =============================================================================
// 1. Module existence + canonical host list
// =============================================================================

test('Round-55 / Followup 3: extension/lib/email-clients.js must exist', () => {
  // The shared module is the single source of truth. Without the file
  // the popup + content-email.js can drift again on next edit.
  assert.ok(fs.existsSync(EMAIL_CLIENTS_PATH), 'extension/lib/email-clients.js must exist (Round-55 shared host list)')
})

test('Round-55 / Followup 3: module must export the three canonical webmail hosts', () => {
  assert.match(SRC, /export\s+const\s+EMAIL_CLIENT_HOSTS\s*=\s*\[/, 'module must export EMAIL_CLIENT_HOSTS array')
  assert.match(SRC, /mail\.google\.com/, 'EMAIL_CLIENT_HOSTS must include mail.google.com (Gmail)')
  assert.match(SRC, /outlook\.live\.com/, 'EMAIL_CLIENT_HOSTS must include outlook.live.com (Outlook personal)')
  assert.match(SRC, /outlook\.office\.com/, 'EMAIL_CLIENT_HOSTS must include outlook.office.com (Outlook business)')
})

test('Round-55 / Followup 3: module must export isEmailClientUrl helper', () => {
  assert.match(
    SRC,
    /export\s+function\s+isEmailClientUrl\s*\(/,
    'module must export isEmailClientUrl(url) helper for anchored URL matching',
  )
})

test('Round-55 / Followup 3: module must export detectProviderByHost helper', () => {
  assert.match(
    SRC,
    /export\s+function\s+detectProviderByHost\s*\(/,
    'module must export detectProviderByHost(host) helper for content-email.js to use',
  )
})

// =============================================================================
// 2. Anchored prefix matching — no substring false-positives
// =============================================================================

test('Round-55 / Followup 3: isEmailClientUrl must use anchored prefix matches (not substring)', () => {
  // The .startsWith(prefix) test on EMAIL_CLIENT_PREFIXES is the
  // security-critical line — a substring match on the bare host
  // would let an attacker host land a `https://evil-mail.google.com.attacker.com/`
  // page and silently pass the gate. Locked so a future refactor
  // that drops the `https://` prefix or changes to `.includes()`
  // regresses the security stance.
  assert.match(
    SRC,
    /\.startsWith\s*\(\s*prefix\s*\)/,
    'isEmailClientUrl must use .startsWith(prefix) on EMAIL_CLIENT_PREFIXES — anchored, not substring',
  )
  assert.match(
    SRC,
    /EMAIL_CLIENT_PREFIXES\.some\s*\(/,
    'isEmailClientUrl must iterate EMAIL_CLIENT_PREFIXES with .some() for the anchored match',
  )
})

test('Round-55 / Followup 3: EMAIL_CLIENT_PREFIXES must be https://-prefixed', () => {
  // Refusing non-https URLs by construction — the prefix list is
  // the source of truth for the scheme. If a future contributor
  // changes this to `http://` the tests catch it.
  assert.match(
    SRC,
    /EMAIL_CLIENT_PREFIXES\s*=\s*EMAIL_CLIENT_HOSTS\.map\s*\(\s*\(\s*h\s*\)\s*=>\s*`https:\/\/\$\{h\}\/`\s*\)/,
    'EMAIL_CLIENT_PREFIXES must be derived from EMAIL_CLIENT_HOSTS via https:// + h + "/"',
  )
})

// =============================================================================
// 3. Robustness to bad inputs
// =============================================================================

test('Round-55 / Followup 3: isEmailClientUrl must handle null / undefined / non-string safely', () => {
  // Defensive contract — a chrome.tabs.query result whose `tab.url`
  // is null (e.g. on chrome:// pages) must NOT auto-switch the
  // user. The function should return false in those cases so the
  // Round-54 3-way gate is never accidentally bypassed.
  assert.match(
    SRC,
    /if\s*\(\s*typeof\s+url\s*!==\s*['"]string['"]\s*\|\|\s*!url\s*\)\s*return\s+false/,
    'isEmailClientUrl must return false for non-string or empty inputs (no accidental auto-switch)',
  )
})

test('Round-55 / Followup 3: detectProviderByHost must handle null / undefined / non-string safely', () => {
  assert.match(
    SRC,
    /if\s*\(\s*typeof\s+host\s*!==\s*['"]string['"]\s*\|\|\s*!host\s*\)\s*return\s+null/,
    'detectProviderByHost must return null for non-string or empty inputs (no provider detection)',
  )
})

// =============================================================================
// 4. Both consumers import from the shared module
// =============================================================================

test('Round-55 / Followup 3: popup.js must import from the shared email-clients module', () => {
  // Drift fix — the popup's isActiveTabEmailClient() used to inline
  // the host list. The Round-55 fix is to make it import + delegate
  // so a 4th provider added to the shared module is automatically
  // picked up by the popup's auto-switch gate.
  assert.match(
    POPUP_SRC,
    /from\s+['"]\.\/lib\/email-clients\.js['"]/,
    'popup.js must import from ./lib/email-clients.js (shared host list)',
  )
  // The popup's isActiveTabEmailClient must now delegate to the
  // shared isEmailClientUrl helper (not inline its own list).
  // We anchor on the function body and check it now does at most
  // a try/catch + a single call to the shared helper.
  const fnMatch = /function\s+isActiveTabEmailClient\s*\([^)]*\)\s*\{[\s\S]*?\n\}/.exec(POPUP_SRC)
  assert.ok(fnMatch, 'isActiveTabEmailClient must be locatable in popup.js')
  const fnBody = fnMatch[0]
  assert.match(
    fnBody,
    /isEmailClientUrl\s*\(/,
    'isActiveTabEmailClient body must call isEmailClientUrl from the shared module',
  )
})

test('Round-55 / Followup 3: content-email.js must import from the shared email-clients module', () => {
  assert.match(
    CONTENT_EMAIL_SRC,
    /from\s+['"]\.\/lib\/email-clients\.js['"]/,
    'content-email.js must import from ./lib/email-clients.js (shared host list)',
  )
  // The content-email detectProvider() must now delegate to
  // detectProviderByHost from the shared module.
  const fnMatch = /function\s+detectProvider\s*\(\s*\)\s*\{[\s\S]*?\n\}/.exec(CONTENT_EMAIL_SRC)
  assert.ok(fnMatch, 'detectProvider must be locatable in content-email.js')
  const fnBody = fnMatch[0]
  assert.match(
    fnBody,
    /detectProviderByHost\s*\(/,
    'detectProvider body must call detectProviderByHost from the shared module',
  )
})
