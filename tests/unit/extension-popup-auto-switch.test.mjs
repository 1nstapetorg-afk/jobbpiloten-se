// tests/unit/extension-popup-auto-switch.test.mjs
//
// Round-56 / Followup A — split the 6 Round-54 auto-switch
// contract-lock tests out of tests/unit/extension-popup-email-body.test.mjs
// into this dedicated file. The pre-Round-56 layout mixed
// Round-46 / Round-46.1 / Round-46.2 (compose panel + race
// dedupe) tests with Round-54 (auto-switch) tests in the same
// file. The split makes the test layout mirror the code
// structure: the auto-switch gate has its own dedicated test
// file, the compose panel keeps its own.
//
// The 6 tests below are the EXACT tests previously in
// extension-popup-email-body.test.mjs section 8, just relocated
// here. Their test IDs and assertions are unchanged so the
// contract lock is preserved byte-for-byte.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POPUP_PATH = path.resolve(__dirname, '../../extension/popup.js')
const POPUP_SRC = fs.readFileSync(POPUP_PATH, 'utf-8')

// =============================================================================
// 1. isActiveTabEmailClient() helper — Round-54 / Bug 1
// =============================================================================

test('Round-54 / Bug 1: popup.js must declare an isActiveTabEmailClient() helper', () => {
  assert.ok(
    /function\s+isActiveTabEmailClient\s*\(/.test(POPUP_SRC),
    'popup.js must declare an isActiveTabEmailClient() helper function (Round-54 / Bug 1 contract)',
  )
})

test('Round-54 / Bug 1: isActiveTabEmailClient must match the three webmail hosts (Gmail + Outlook personal + business)', () => {
  // The helper covers all three webmail hosts the extension supports.
  // Drift between this list and the manifest's content_scripts.matches
  // would leave a user on a host where compose-target detection works
  // but the auto-switch doesn't fire — locked here.
  assert.ok(/mail\.google\.com/.test(POPUP_SRC), 'isActiveTabEmailClient must match mail.google.com (Gmail)')
  assert.ok(/outlook\.live\.com/.test(POPUP_SRC), 'isActiveTabEmailClient must match outlook.live.com (Outlook personal)')
  assert.ok(/outlook\.office\.com/.test(POPUP_SRC), 'isActiveTabEmailClient must match outlook.office.com (Outlook business)')
})

// =============================================================================
// 2. The 3-way AND gate — present=true + currentMode === formular + isActiveTabEmailClient
// =============================================================================

test('Round-54 / Bug 1: auto-switch must be GATED on a pending compose target (present=true)', () => {
  // The 3-way gate. A user who just happens to have Gmail open
  // (no compose target) must NOT be force-switched away from
  // their stored mode. Only when content-email.js has written
  // jobbpiloten_composeTarget.present=true does the auto-switch
  // fire. Locked so a future refactor that drops the gate
  // regresses the override behavior.
  assert.match(
    POPUP_SRC,
    /target\s*&&\s*target\.present/,
    'popup.js must gate the auto-switch on target.present (the compose-target key from content-email.js)',
  )
  assert.match(
    POPUP_SRC,
    /jobbpiloten_composeTarget/,
    'popup.js must read the jobbpiloten_composeTarget key from chrome.storage.local for the auto-switch gate',
  )
})

test('Round-54 / Bug 1: auto-switch must respect a user-stored mejlutkast mode (the third politeness gate)', () => {
  // The third gate: if the user already chose 'mejlutkast' last
  // time, currentMode is already 'mejlutkast' and the auto-switch
  // is a no-op (it only fires when currentMode === 'formular').
  // This is the politeness layer that prevents a user with an
  // explicit choice from being force-toggled when they open
  // Gmail/Outlook with a pending target.
  assert.match(
    POPUP_SRC,
    /currentMode\s*===\s*ACTIVE_MODE_FORMULAR/,
    'popup.js auto-switch must only fire when currentMode is still the default ACTIVE_MODE_FORMULAR (respect explicit mejlutkast choice)',
  )
})

// =============================================================================
// 3. SESSION-SCOPED contract — Round-54.2 fix
// =============================================================================

test('Round-54.2 / Bug 1 followup: auto-switch must be SESSION-SCOPED (no switchMode call, no storage write)', () => {
  // The Round-54.1 implementation called switchMode(ACTIVE_MODE_MEJLUTKAST)
  // which writes to chrome.storage.local. Two bad consequences:
  //   1. The user's stored mode flipped to 'mejlutkast' on first
  //      auto-switch and stayed that way forever, so every
  //      subsequent popup open started in Mejlutkast.
  //   2. The user could never escape the auto-switch by clicking
  //      the 'formular' pill while a target was pending.
  // The Round-54.2 fix: auto-switch is a session-scoped override.
  // It mutates currentMode locally and applies the same DOM toggle
  // that switchMode() does, but deliberately SKIPS the
  // chrome.storage.local.set. Locked here so a future refactor
  // that re-introduces switchMode() in the auto-switch block
  // regresses the session-scoped behavior.
  const sessionScopedAnchor = POPUP_SRC.indexOf('Round-55 / Followup 1')
  assert.ok(
    sessionScopedAnchor > 0,
    'popup.js must contain the Round-54.2 fix comment that introduces the session-scoped behavior',
  )
  const tail = POPUP_SRC.slice(sessionScopedAnchor, sessionScopedAnchor + 2000)
  // The session-scoped fix: NO switchMode call in the auto-switch block.
  assert.doesNotMatch(
    tail,
    /switchMode\s*\(\s*ACTIVE_MODE_MEJLUTKAST\s*\)/,
    'auto-switch must NOT call switchMode() that would persist the mode change. The auto-switch is a session-scoped override.',
  )
  // The session-scoped fix: NO chrome.storage.local.set(...) call in the auto-switch.
  // The regex requires the open-paren so comments explaining WHY set is
  // omitted don't trigger a false-positive.
  assert.doesNotMatch(
    tail,
    /chrome\.storage\.local\.set\s*\(/,
    'auto-switch must NOT call chrome.storage.local.set() that would persist the mode change. The auto-switch is a session-scoped override.',
  )
  // The local mutation must be present in the auto-switch code path.
  // (Searched directly in POPUP_SRC rather than the 2000-char tail
  // because the mutation is several hundred characters past the
  // Round-54 followup comment anchor.)
  assert.match(
    POPUP_SRC,
    /currentMode\s*=\s*ACTIVE_MODE_MEJLUTKAST/,
    'auto-switch must locally mutate currentMode = ACTIVE_MODE_MEJLUTKAST',
  )
  assert.match(
    POPUP_SRC,
    /applyModeVisibility\s*\(\s*ACTIVE_MODE_MEJLUTKAST\s*\)/,
    'auto-switch must delegate to applyModeVisibility(ACTIVE_MODE_MEJLUTKAST) (Round-55 / Followup 1: single source of truth for DOM toggle)',
  )
})

// =============================================================================
// 4. Full 3-way AND gate — single expression shape
// =============================================================================

test('Round-58 / Bug 4 followup: auto-switch full 2-way AND gate must appear as a single expression', () => {
  // Round-58 intentionally relaxed the gate from 3-way AND to 2-way AND
  // (Round-54.2 / Round-54.3 contracts preserved per the user's bug report:
  // "On Gmail: immediately detect Mode B / Skip 'Kontrollerar...' for Mode B
  // pages / Immediately render Mode B UI"). The compose-target-present
  // third gate was the developer's defensive interpretation in Round-54.
  // The user-requested contract is URL-only: any webmail URL flips Mode.
  // Lock the FULL 2-way expression shape so a future refactor that
  // re-adds the third gate 'target && target.present' OR drops one of
  // the 2 gates is caught loudly.
  const anchor = POPUP_SRC.indexOf('Round-58 / Bug 4: anchor for extension-popup-mail-mode-default test slice')
  assert.ok(anchor > 0, 'auto-switch block must be locatable by the Round-58 anchor comment')
  const tail = POPUP_SRC.slice(anchor, anchor + 3000)
  // Both gates in the same block.
  assert.match(tail, /currentMode\s*===\s*ACTIVE_MODE_FORMULAR/, 'gate 1: currentMode === ACTIVE_MODE_FORMULAR')
  assert.match(tail, /await\s+isActiveTabEmailClient\s*\(\s*\)/, 'gate 2: await isActiveTabEmailClient()')
  // Round-58: explicitly assert the 3rd gate is NOT present. The substring
  // 'target && target.present' may still exist as a historical comment
  // marker; we anchor on the live gate -- so check the actual `if (...)`
  // expression, not the substring.
  assert.doesNotMatch(
    tail,
    /if\s*\(\s*target\s*&&\s*target\.present/,
    'gate 3 (target && target.present) must NOT be active in the Round-58 auto-switch -- the 3rd gate was dropped per user request'
  )
})
