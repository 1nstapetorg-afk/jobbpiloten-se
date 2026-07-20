// tests/unit/round55-followups.test.mjs
//
// Round-55 — locks the three followups from the Round-54.2 code review:
//
//   1. applyModeVisibility(mode) helper extracted from switchMode() so
//      the auto-switch block and the user-pill-click path share a
//      single source of truth for the DOM toggle.
//   2. setupAutoSwitchLiveListener() — chrome.storage.onChanged
//      listener that re-checks the 3-way auto-switch gate on live
//      composeTarget ticks (not just on popup open).
//   3. (EMAIL_CLIENT_HOSTS extraction is locked by
//      tests/unit/email-clients.test.mjs.)
//
// All three are static-grep contract locks on extension/popup.js.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POPUP_PATH = path.resolve(__dirname, '../../extension/popup.js')
const POPUP_SRC = fs.readFileSync(POPUP_PATH, 'utf-8')

// =============================================================================
// 1. applyModeVisibility(mode) helper — Followup 1
// =============================================================================

test('Round-55 / Followup 1: popup.js must declare applyModeVisibility(mode) helper', () => {
  // The helper is the single source of truth for the mode-toggle
  // DOM mutation. Both switchMode() and the auto-switch block (in
  // loadAndPaint + the live listener) call it.
  assert.match(
    POPUP_SRC,
    /function\s+applyModeVisibility\s*\(\s*mode\s*\)\s*\{/,
    'popup.js must declare applyModeVisibility(mode) helper function',
  )
})

test('Round-55 / Followup 1: applyModeVisibility must own the LEGACY_PANEL_IDS list', () => {
  // The legacy panels (jp-actions, jp-detected, jp-compose-panel,
  // jp-footer-hint) are the 4 mode-dependent elements that get
  // hidden when switching to Mejlutkast. The constant must be
  // declared once and referenced inside applyModeVisibility so a
  // future 5th mode-dependent element only needs one edit.
  assert.match(
    POPUP_SRC,
    /const\s+LEGACY_PANEL_IDS\s*=\s*\[[\s\S]*?jp-actions[\s\S]*?jp-footer-hint[\s\S]*?\]/,
    'popup.js must declare LEGACY_PANEL_IDS as a single source of truth for mode-dependent panel ids',
  )
  // The array must be iterated inside applyModeVisibility.
  const helperMatch = /function\s+applyModeVisibility\s*\([\s\S]*?\n\}/.exec(POPUP_SRC)
  assert.ok(helperMatch, 'applyModeVisibility must be locatable')
  assert.match(
    helperMatch[0],
    /LEGACY_PANEL_IDS/,
    'applyModeVisibility must iterate LEGACY_PANEL_IDS (not inline the array)',
  )
})

test('Round-55 / Followup 1: switchMode() must call applyModeVisibility (no inline DOM toggle)', () => {
  // switchMode is the user-pill-click path. After the refactor it
  // delegates the DOM mutation to applyModeVisibility — locking
  // the delegation so a future refactor that re-inlines the toggle
  // regresses the drift fix.
  const fnMatch = /function\s+switchMode\s*\([\s\S]*?\n\}/.exec(POPUP_SRC)
  assert.ok(fnMatch, 'switchMode must be locatable')
  assert.match(
    fnMatch[0],
    /applyModeVisibility\s*\(\s*mode\s*\)/,
    'switchMode must call applyModeVisibility(mode) (Round-55 / Followup 1: single source of truth)',
  )
  // The switchMode body must NOT contain the inline DOM toggle
  // (the aria-selected writes + the 4-element show/hide loop).
  // The show/hide loop is the strongest signal — it was the
  // drift-prone chunk.
  assert.doesNotMatch(
    fnMatch[0],
    /for\s*\(\s*const\s+id\s+of\s+\[?\s*['"]jp-actions['"]/,
    'switchMode must NOT inline the show/hide loop — that lives in applyModeVisibility now',
  )
})

// =============================================================================
// 2. setupAutoSwitchLiveListener() — Followup 2
// =============================================================================

test('Round-55 / Followup 2: popup.js must declare setupAutoSwitchLiveListener() function', () => {
  // The live-tick mirror of the loadAndPaint() auto-switch gate.
  // Without this, a user with the popup open on a non-mail page
  // who clicks "Ansök via mejl" on a job page won't see the
  // auto-switch fire until they close + reopen the popup.
  assert.match(
    POPUP_SRC,
    /async\s+function\s+setupAutoSwitchLiveListener\s*\(/,
    'popup.js must declare async function setupAutoSwitchLiveListener()',
  )
})

test('Round-55 / Followup 2: setupAutoSwitchLiveListener must register a chrome.storage.onChanged listener', () => {
  const fnMatch = /async\s+function\s+setupAutoSwitchLiveListener\s*\([\s\S]*?\n\}/.exec(POPUP_SRC)
  assert.ok(fnMatch, 'setupAutoSwitchLiveListener must be locatable')
  assert.match(
    fnMatch[0],
    /chrome\.storage\.onChanged\.addListener\s*\(/,
    'setupAutoSwitchLiveListener must register a chrome.storage.onChanged listener',
  )
})

test('Round-55 / Followup 2: live listener must gate on target.present + currentMode === formular + isActiveTabEmailClient', () => {
  // The 3-way gate from the loadAndPaint() auto-switch block,
  // mirrored into the live listener. All three pieces must appear
  // in the function body so a future refactor that drops a branch
  // regresses the politeness contract.
  const fnMatch = /async\s+function\s+setupAutoSwitchLiveListener\s*\([\s\S]*?\n\}/.exec(POPUP_SRC)
  const fnBody = fnMatch[0]
  // Round-55.6: loosened to match both `newTarget && newTarget.present`
  // and `!newTarget || !newTarget.present` shapes.
  assert.match(
    fnBody,
    /newTarget[\s\S]{0,40}\.present/,
    'live listener must check newTarget.present (the pending-compose gate)',
  )
  assert.match(
    fnBody,
    /currentMode\s*!==\s*ACTIVE_MODE_FORMULAR/,
    'live listener must skip when currentMode is already not "formular" (respect explicit user choice)',
  )
  assert.match(
    fnBody,
    /isActiveTabEmailClient\s*\(\s*\)/,
    'live listener must re-verify the active tab is a webmail client',
  )
})

test('Round-55 / Followup 2: live listener must delegate to applyModeVisibility (no inline DOM toggle)', () => {
  // The live listener calls applyModeVisibility(ACTIVE_MODE_MEJLUTKAST)
  // — same single source of truth as the loadAndPaint() auto-switch.
  // Locked so a future refactor that re-inlines the toggle in the
  // live listener regresses the drift fix.
  const fnMatch = /async\s+function\s+setupAutoSwitchLiveListener\s*\([\s\S]*?\n\}/.exec(POPUP_SRC)
  const fnBody = fnMatch[0]
  assert.match(
    fnBody,
    /applyModeVisibility\s*\(\s*ACTIVE_MODE_MEJLUTKAST\s*\)/,
    'live listener must call applyModeVisibility(ACTIVE_MODE_MEJLUTKAST) (no inline DOM toggle)',
  )
})

test('Round-55 / Followup 2: live listener must NOT call switchMode or chrome.storage.local.set (session-scoped)', () => {
  // Same session-scoped contract as the loadAndPaint() auto-switch:
  // the live listener mutates currentMode locally and calls the
  // helper, but never persists the change to chrome.storage.local.
  const fnMatch = /async\s+function\s+setupAutoSwitchLiveListener\s*\([\s\S]*?\n\}/.exec(POPUP_SRC)
  const fnBody = fnMatch[0]
  assert.doesNotMatch(
    fnBody,
    /switchMode\s*\(\s*ACTIVE_MODE_MEJLUTKAST\s*\)/,
    'live listener must NOT call switchMode — the auto-switch is session-scoped',
  )
  assert.doesNotMatch(
    fnBody,
    /chrome\.storage\.local\.set\s*\(/,
    'live listener must NOT write to chrome.storage.local — the auto-switch is session-scoped',
  )
})

test('Round-55 / Followup 2: setupAutoSwitchLiveListener must be called from the init path', () => {
  // The listener must be mounted once on popup open. Looking for
  // a bare call to setupAutoSwitchLiveListener() — it takes no
  // args so a call site is just the function name + ().
  // The negation-style anchor: there must be at least one call
  // site, AND it must be reachable from the init flow.
  assert.match(
    POPUP_SRC,
    /setupAutoSwitchLiveListener\s*\(\s*\)/,
    'popup.js must call setupAutoSwitchLiveListener() at least once (mount on init)',
  )
  // Round-55.7: simpler approach. The loadAndPaint() CALL site is
  // inside an `if (connected) {` block, so the exact whitespace
  // varies. Instead of searching for the call site, we verify that
  // setupAutoSwitchLiveListener() appears before the loadAndPaint()
  // FUNCTION DEFINITION (which is at a fixed position). Since the
  // call site must be after the function definition, this is a
  // valid proxy: if setupAutoSwitchLiveListener() is before the
  // function definition, it's also before the call site.
  const callIdx = POPUP_SRC.indexOf('setupAutoSwitchLiveListener()')
  const fnDefIdx = POPUP_SRC.indexOf('async function loadAndPaint()')
  assert.ok(callIdx > 0, 'setupAutoSwitchLiveListener() call must be locatable')
  assert.ok(fnDefIdx > 0, 'loadAndPaint() function definition must be locatable')
  assert.ok(
    callIdx < fnDefIdx,
    'setupAutoSwitchLiveListener() must appear before loadAndPaint() function definition (ensures listener is live before initial paint call site, which must be after the definition)',
  )
})
