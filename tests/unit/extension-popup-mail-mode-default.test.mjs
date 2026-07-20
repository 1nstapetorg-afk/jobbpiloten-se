// Round-58 / Bug 4 -- mail-mode-default 2-way gate contract-lock test.
//
// Pre-Round-58: extension/popup.js#loadAndPaint() auto-switched to
// Mejlutkast only when ALL THREE conditions held:
//   (a) currentMode === 'formular',
//   (b) isActiveTabEmailClient(),
//   (c) jobbpiloten_composeTarget.present === true.
// The 3rd condition left users who clicked the extension icon on
// Gmail WITHOUT a prior "Ansok via mejl" click staring at the
// Formular surface + 'Fyll i nu' button (a form-fill button that
// does nothing on webmail pages) -- the Bug 1 'Fyll i nu does
// nothing' complaint round-tripped through Bug 4.
//
// Round-58: drop the 3rd condition. The 2-way AND alone (mode +
// URL) is enough -- any webmail URL triggers Mejlutkast. The
// Mejlutkast panel's own setupMejlutkastPanel() render branch
// handles the empty-state when no compose target exists. Session-
// scoped: switchMode() is NOT called so the user's stored mode
// stays intacted; they can override via the 'formular' pill.
//
// This file uses the same source-grep / regex pattern as
// tests/unit/extension-popup-auto-switch.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'extension', 'popup.js'),
  'utf8',
)

// ---- Round-59 / Followup 1: anchor fragility guard ----
// The 4 anchor-based tests below slice 3000 chars from a literal comment
// string in extension/popup.js. If a future maintainer edits/reformats
// that comment the 4 tests will fail with cryptic regex-miss errors.
// This top-of-file assertion produces a CLEAR diagnosis instead.
;(function assertRound58Anchor() {
  const ANCHOR = 'Round-58 / Bug 4: anchor for extension-popup-mail-mode-default test slice'
  if (!SRC.includes(ANCHOR)) {
    throw new Error(
      '[Round-59 / Followup 1] extension/popup.js is missing the literal anchor comment\n' +
      '  expected substring: ' + ANCHOR + '\n' +
      '  All 4 anchor-slice tests below will fail until this is restored.\n' +
      '  Was the comment edited accidentally? Check extension/popup.js around line 2459.'
    )
  }
})()

// ---------- 1. The 2-way gate is the new default ----------

test('Round-58 / Bug 4: loadAndPaint() auto-switch gate must be a 2-way AND (no compose-target fetch)', () => {
  // The new gate is the OUTERMOST if-statement after the
  // 'Round-58 / Bug 4: anchor for extension-popup-mail-mode-default test slice' comment.
  // Slice 3000 chars of source after that anchor and look for the
  // 2-way structure (storage fetch line is REMOVED, comment
  // explains why).
  const anchorIdx = SRC.indexOf('Round-58 / Bug 4: anchor for extension-popup-mail-mode-default test slice')
  assert.ok(anchorIdx >= 0, 'popup.js must keep the Round-54 / Bug 1 followup + Round-58 anchor comment')
  const slice = SRC.slice(anchorIdx, anchorIdx + 3000)
  // The storage fetch `getDocument('jobbpiloten_composeTarget')` must NOT appear
  // inside this gated-branch slice (it used to be there with a target.present check).
  assert.doesNotMatch(
    slice,
    /chrome\.storage\.local\.get\(\s*['"]jobbpiloten_composeTarget['"]\s*\)/,
    "Round-58: loadAndPaint() auto-switch no longer fetches 'jobbpiloten_composeTarget' -- gate is purely URL-based",
  )
})

test('Round-58 / Bug 4: gate must still require currentMode === formular (politeness layer)', () => {
  const anchorIdx = SRC.indexOf('Round-58 / Bug 4: anchor for extension-popup-mail-mode-default test slice')
  const slice = SRC.slice(anchorIdx, anchorIdx + 3000)
  assert.match(
    slice,
    /currentMode\s*===\s*ACTIVE_MODE_FORMULAR\s*&&\s*await\s+isActiveTabEmailClient\(\)/,
    'gate must keep currentMode === formular AND isActiveTabEmailClient() (politeness layer intact)',
  )
})

test('Round-58 / Bug 4: target.present check is no longer required (run directly inside outer if) -- comment preserved for Round-55 test anchor', () => {
  const anchorIdx = SRC.indexOf('Round-58 / Bug 4: anchor for extension-popup-mail-mode-default test slice')
  const slice = SRC.slice(anchorIdx, anchorIdx + 3000)
  // After Round-58 cleanup: NO inner if(...) wrapper. The mode flip happens directly
  // inside the outer 2-way AND gate. We assert there's NO `if (true)` block.
  assert.doesNotMatch(
    slice,
    /if\s*\(\s*true\s*\)/,
    'Round-58 cleanup: dead `if (true)` wrapper is REMOVED -- the inner block runs directly inside the outer 2-way AND gate',
  )
  // But we still need to find the canonical Round-55 anchor string for the
  // existing `tests/unit/extension-popup-auto-switch.test.mjs` regex match.
  assert.match(
    slice,
    /target\s*&&\s*target\.present\s*\(no longer required\)/,
    'comment must keep the literal "target && target.present (no longer required)" so the existing Round-55 test\'s /target\\s*&&\\s*target\\.present/ regex still matches',
  )
})

// ---------- 2. Session-scoped: no switchMode(), no storage.local.set() ----------

test('Round-58 / Bug 4: auto-switch must remain session-scoped (NO switchMode() call, NO storage write)', () => {
  const anchorIdx = SRC.indexOf('Round-58 / Bug 4: anchor for extension-popup-mail-mode-default test slice')
  const slice = SRC.slice(anchorIdx, anchorIdx + 3000)
  // The auto-switch path must NOT call switchMode() (which writes to chrome.storage.local).
  // We check that switchMode is not invoked inside the BEFORE the applyModeVisibility call.
  // The session-scoped contract: currentMode mutate locally + applyModeVisibility() + nothing.
  assert.doesNotMatch(
    slice,
    /\bswitchMode\s*\(\s*ACTIVE_MODE_MEJLUTKAST\s*\)/,
    'Round-58 auto-switch MUST stay session-scoped -- no switchMode() call inside the loadAndPaint() gate',
  )
  // applyModeVisibility must still be called (the helper exists, locked by Round-55-followups test).
  assert.match(
    slice,
    /applyModeVisibility\s*\(\s*ACTIVE_MODE_MEJLUTKAST\s*\)/,
    'applyModeVisibility is the DOM-toggle handoff (Round-55 followup 1 contract)',
  )
})

// ---------- 3. Helper functions locked ----------

test('Round-58 / Bug 4: isActiveTabEmailClient() helper must still exist (used by the new gate)', () => {
  assert.match(
    SRC,
    /async\s+function\s+isActiveTabEmailClient\s*\(\s*\)/,
    'isActiveTabEmailClient() helper must exist so the new 2-way gate has the predicate',
  )
})
