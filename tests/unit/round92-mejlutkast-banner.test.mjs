// tests/unit/round92-mejlutkast-banner.test.mjs
//
// Round-92 — regression locks for two manual-testing bugs:
//
//   BUG 1 — Mejlkast job dropdown empty on Gmail.
//     • Root cause A: `populatePicker`'s empty-state path called
//       `select.appendChild(retryOption)` with a `select` binding
//       that does NOT exist in that scope (the only `select`s live
//       in the industry/style functions). The ReferenceError threw
//       AFTER `pickEl.innerHTML = ''`, leaving a completely blank
//       dropdown.
//     • Root cause B: `refreshRecentJobs()` was only reachable via
//       the compose-target path (applyTarget); a popup opened in
//       Mejlkast mode without a detected compose window never
//       fetched, and a missing token silently returned with the bare
//       HTML placeholder.
//     Fixes locked here: the retry option appends to `pickEl`, the
//     module-scoped `refreshMejlutkastJobs` hook is registered +
//     invoked from switchMode (fetch-on-open), the `!token` path
//     renders the actionable empty state, and the picker's change
//     handler dispatches `__retry__` to refreshRecentJobs.
//
//   BUG 2 — dark "ingen profil ansluten" toast false-positive on the
//     dashboard. The content script is injected on the app origin
//     too, so the pre-fix scheduleScan showed a black toast telling
//     the user to open jobbpiloten.se/dashboard WHILE they were
//     already there, with a hard-coded production URL.
//     Fixes locked here: the toast is skipped on JobbPiloten app
//     origins, the URL comes from resolveApiBaseUrl() (dynamic), and
//     the toast carries a dismiss × button.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'extension/popup.js'), 'utf-8')
const CONTENT_JS = fs.readFileSync(path.join(ROOT, 'extension/content.js'), 'utf-8')

// =============================================================================
// BUG 1 — Mejlkast job dropdown
// =============================================================================

test('Round-92 BUG 1: empty-state retry option must append to pickEl, not the undefined `select`', () => {
  const start = POPUP_JS.indexOf('function populatePicker(jobs) {')
  assert.ok(start > -1, 'populatePicker must exist')
  const end = POPUP_JS.indexOf('// If the server\'s matched job is in the list', start)
  const body = POPUP_JS.slice(start, end > start ? end : start + 3200)
  assert.ok(
    /pickEl\.appendChild\(retryOption\)/.test(body),
    'the empty-state retry option must be appended to pickEl — the pre-fix `select.appendChild(retryOption)` referenced an UNDEFINED binding and threw a ReferenceError that wiped the dropdown blank',
  )
  assert.ok(
    !/select\.appendChild\(retryOption\)/.test(body),
    'populatePicker must NOT reference a bare `select` (undefined in that scope — the only `select` bindings live in unrelated functions)',
  )
})

test('Round-92 BUG 1: refreshRecentJobs renders the actionable empty state when no token exists', () => {
  const start = POPUP_JS.indexOf('async function refreshRecentJobs() {')
  assert.ok(start > -1, 'refreshRecentJobs must exist')
  const body = POPUP_JS.slice(start, start + 900)
  assert.ok(
    /if\s*\(!token\)/.test(body),
    'refreshRecentJobs must still guard on the token',
  )
  assert.ok(
    body.includes('populatePicker([])'),
    'the no-token branch must call populatePicker([]) so the dropdown shows the "Inga sparade jobb…" message + Ladda om affordance instead of a silent blank',
  )
})

test('Round-92 BUG 1: module-scoped refreshMejlutkastJobs hook is registered by the panel and invoked by switchMode (fetch-on-open)', () => {
  assert.ok(
    /let refreshMejlutkastJobs = null/.test(POPUP_JS),
    'popup.js must declare the module-scoped refreshMejlutkastJobs hook',
  )
  assert.ok(
    /refreshMejlutkastJobs = refreshRecentJobs/.test(POPUP_JS),
    'setupMejlutkastPanel must register refreshRecentJobs on the hook',
  )
  const swStart = POPUP_JS.indexOf('function switchMode(mode) {')
  assert.ok(swStart > -1, 'switchMode must exist')
  const swBody = POPUP_JS.slice(swStart, swStart + 1600)
  assert.ok(
    /mode === ACTIVE_MODE_MEJLUTKAST && refreshMejlutkastJobs/.test(swBody),
    'switchMode must invoke the refresh hook when the Mejlkast tab is selected (fetch-on-open without a compose target)',
  )
  // Auto-switch sites (Round-54) set currentMode directly without
  // switchMode — they must ALSO invoke the hook so a popup that
  // auto-switches to Mejlkast populates the picker.
  const autoSwitchRefs = POPUP_JS.match(/if \(refreshMejlutkastJobs\) refreshMejlutkastJobs\(\)\.catch\(\(\) => \{\}\)/g)
  assert.ok(
    autoSwitchRefs && autoSwitchRefs.length >= 2,
    'both auto-switch sites must invoke the refresh hook (same picker-populate-on-entry as the pill tab)',
  )
  // Popup-open path: the panel's initial render must also fetch when
  // the popup opens directly in Mejlkast mode — but NOT double-fetch
  // when the compose-target path already ran.
  const initIdx = POPUP_JS.indexOf("chrome.storage.local.get('jobbpiloten_composeTarget')")
  const initBlock = POPUP_JS.slice(initIdx, initIdx + 1000)
  assert.ok(
    /currentMode === ACTIVE_MODE_MEJLUTKAST/.test(initBlock),
    'the panel initial render must fetch recent jobs when the popup opens in Mejlkast mode',
  )
  assert.ok(
    /!composeTargetApplied/.test(initBlock),
    'the initial-render fetch must be skipped when applyTarget already fetched via the compose-target path (no duplicate GET on open)',
  )
})

test('Round-92 BUG 1: picker change handler dispatches __retry__ to refreshRecentJobs', () => {
  const start = POPUP_JS.indexOf("pickEl.addEventListener('change'")
  assert.ok(start > -1, 'the picker change handler must exist')
  const body = POPUP_JS.slice(start, start + 1400)
  assert.ok(
    /pickEl\.value === '__retry__'/.test(body),
    'the change handler must recognise the __retry__ empty-state option',
  )
  assert.ok(
    /refreshRecentJobs\(\)\.catch/.test(body),
    'the __retry__ branch must call refreshRecentJobs() (was a dead affordance — the option rendered but did nothing)',
  )
})

// =============================================================================
// BUG 2 — dashboard "ingen profil ansluten" false positive
// =============================================================================

test('Round-92 BUG 2: scheduleScan must NOT toast the no-profile CTA on JobbPiloten app origins', () => {
  const start = CONTENT_JS.indexOf('if (!r.hasProfile) {')
  assert.ok(start > -1, 'the no-profile branch in scheduleScan must exist')
  const body = CONTENT_JS.slice(start, start + 2200)
  assert.ok(
    /!isJobbPilotenAppOrigin\(window\.location\.origin\)/.test(body),
    'the toast must be skipped when the current page IS the JobbPiloten app (dashboard/settings) — the pre-fix code showed the dark toast on the dashboard itself (the false positive)',
  )
  assert.ok(
    /resolveApiBaseUrl\(\)/.test(body),
    'the toast must resolve the dashboard URL dynamically (resolveApiBaseUrl) instead of the hard-coded production origin',
  )
  // Scope the no-hard-code check to the showToast template literal (a
  // comment in the branch may legitimately quote the old URL).
  const toastIdx = body.indexOf('showToast(')
  const toastLiteral = toastIdx > -1 ? body.slice(toastIdx, toastIdx + 200) : ''
  assert.ok(
    toastLiteral.includes('${base}/dashboard'),
    'the showToast call must interpolate the dynamic ${base} origin',
  )
  assert.ok(
    !toastLiteral.includes('jobbpiloten.se/dashboard'),
    'the toast string must not hard-code jobbpiloten.se — wrong on preview/Codespaces environments',
  )
})

test('Round-92 BUG 2: badge-activation toast also uses the dynamic dashboard origin', () => {
  const start = CONTENT_JS.indexOf('if (r.filled === 0 && r.missing === 0) {')
  assert.ok(start > -1, 'the fill-result==0 branch must exist')
  const body = CONTENT_JS.slice(start, start + 700)
  assert.ok(
    /resolveApiBaseUrl\(\)/.test(body),
    'the "Ingen profil ansluten" toast must use the dynamic dashboard origin',
  )
  assert.ok(
    !body.includes('jobbpiloten.se/dashboard'),
    'the badge toast must not hard-code the production URL',
  )
})

test('Round-92 BUG 2: showToast renders a dismiss × button', () => {
  const start = CONTENT_JS.indexOf('function showToast(text) {')
  assert.ok(start > -1, 'showToast must exist')
  const body = CONTENT_JS.slice(start, start + 2600)
  assert.ok(
    body.includes("closeBtn.setAttribute('aria-label', 'Stäng')"),
    'showToast must render an accessible dismiss button',
  )
  assert.ok(
    body.includes("closeBtn.addEventListener('click'"),
    'the dismiss button must have a click handler that closes the toast early',
  )
  assert.ok(
    body.includes('t.appendChild(textEl)'),
    'the toast must use a text span + dismiss button layout',
  )
})
