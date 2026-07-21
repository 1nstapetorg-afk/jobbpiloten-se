// Regression test for Round-72 — Errors channel (Step 7 of the
// no-email-on-page flow trace). The user-visible behavior is:
//
//   1. Service worker or content script fails (e.g. background-script
//      can't write the recent-jobs buffer, or content-email.js can't
//      reach /api/extension/email-body).
//   2. Whoever failed posts a { source, message } record into the
//      buffer at chrome.storage.local.jobbpiloten_errors.
//   3. The popup's chrome.storage.onChanged listener picks the change
//      up and the "⚠ N fel" button surfaces with a collapsible list.
//
// These tests pin down the static wiring so a future refactor can't
// silently regress any of the 5 links in that chain: HTML element
// present, CSS class present, popup listener wired, popup logError
// emit sites wired, background pass-through wired.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ESM has no __dirname — derive it from import.meta.url. This file
// is loaded by `node --test tests/unit/bug-flow-7-errors-channel.test.mjs`
// from the project root, so process.cwd() also works. The fileURLToPath
// approach is more robust to run-from-subdirectory invocations.
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.join(__dirname, '..', '..')
const POPUP_HTML = fs.readFileSync(path.join(repoRoot, 'extension', 'popup.html'), 'utf8')
const POPUP_CSS = fs.readFileSync(path.join(repoRoot, 'extension', 'popup.css'), 'utf8')
const POPUP_JS = fs.readFileSync(path.join(repoRoot, 'extension', 'popup.js'), 'utf8')
const BG_JS = fs.readFileSync(path.join(repoRoot, 'extension', 'background.js'), 'utf8')

// Helper that strips line comments before searching — same trick
// already used in bug-name-boolean.test.mjs to avoid counting
// references that live inside `//` narrative comments.
const codeOnly = (raw) =>
  raw
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')

test('HTML: the popup exposes the Errors button + collapsible list', () => {
  assert.ok(
    /id="jp-errors-btn"[\s\S]{0,400}data-testid="jp-errors-btn"/.test(POPUP_HTML),
    'jp-errors-btn element with data-testid must be present',
  )
  assert.ok(
    /id="jp-errors-count"/.test(POPUP_HTML),
    'jp-errors-count counter span must be present so renderErrors can paint the badge',
  )
  assert.ok(
    /id="jp-errors-list"[\s\S]{0,400}data-testid="jp-errors-list"/.test(POPUP_HTML),
    'jp-errors-list unordered list must be present',
  )
  assert.ok(
    /aria-controls="jp-errors-list"/.test(POPUP_HTML),
    'aria-controls relationship is required for the toggle to be a11y-compliant',
  )
})

test('HTML: the Errors section is hidden by default (badge only surfaces when buffer has entries)', () => {
  // The button lives inside <section id="jp-errors" hidden> so it
  // does not steal a row in the initial empty popup render.
  const sectionMatch = POPUP_HTML.match(
    /<section[\s\S]{0,80}class="jp-errors"[\s\S]{0,200}id="jp-errors"[\s\S]{0,40}hidden/,
  )
  assert.ok(sectionMatch, 'jp-errors section must be hidden by default until buffer is non-empty')
})

test('CSS: jp-errors-btn + jp-errors-list + badge styles are defined', () => {
  assert.match(POPUP_CSS, /\.jp-errors-btn\s*\{[^}]*cursor:\s*pointer/m, 'button needs cursor:pointer')
  assert.match(POPUP_CSS, /\.jp-errors-list\s*\{[^}]*list-style:\s*none/m, 'list needs list-style:none so it does not show bullets')
  assert.match(POPUP_CSS, /\.jp-errors-list\s*\{[^}]*max-height:\s*[\d]+px/m, 'list needs a max-height so the popup does not grow unbounded on a long backlog')
})

test('popup.js: logError() + renderErrors() + getCurrentErrors() are defined', () => {
  const code = codeOnly(POPUP_JS)
  assert.match(code, /async\s+function\s+logError\s*\(\s*source\s*,\s*message\s*\)/, 'logError(source, message) signature is required for emit sites')
  assert.match(code, /function\s+renderErrors\s*\(\s*errors\s*,\s*forceRepaint\s*=\s*false\s*\)/, 'renderErrors(errors, forceRepaint=false) signature is required for the storage listener')
  assert.match(code, /function\s+getCurrentErrors\s*\(\s*\)/, 'getCurrentErrors() is the public read accessor used by the toggle handler')
})

test('popup.js: chrome.storage.onChanged listener repaints on jobbpiloten_errors writes', () => {
  const code = codeOnly(POPUP_JS)
  // The listener block must (a) check area === 'local' (b) key
  // changes.jobbpiloten_errors and (c) call renderErrors on the
  // .newValue. The forceRepaint=true flag bypasses the
  // lastRenderedErrors dedupe so writes from background-script
  // always re-paint, even when the buffer is unchanged.
  assert.match(
    code,
    /chrome\.storage\.onChanged\.addListener\([\s\S]{0,400}changes\.jobbpiloten_errors[\s\S]{0,400}renderErrors/,
    'storage.onChanged listener must branch on changes.jobbpiloten_errors and call renderErrors',
  )
})

test('popup.js: refreshRecentJobs() wires logError on every failure path', () => {
  const code = codeOnly(POPUP_JS)
  // Anchor on the function body so we don't pick up unrelated logError
  // calls. The three expected emits are: !res.ok → logError HTTP…
  // !Array.isArray(json.applications) → logError "Ogiltigt svar"
  // catch (err) → logError((err && err.message) || err).
  const bodyMatch = code.match(
    /async\s+function\s+refreshRecentJobs\s*\(\s*\)\s*\{[\s\S]*?^\s\s\}/m,
  )
  assert.ok(bodyMatch, 'refreshRecentJobs() should be present')
  const body = bodyMatch[0]
  assert.match(body, /logError\(['"]recent-jobs['"]\s*,\s*`HTTP\s*\$\{res\.status\}/, '!res.ok branch must log HTTP status')
  assert.match(body, /logError\(['"]recent-jobs['"]\s*,\s*['"]Ogiltigt svar/, 'shape-mismatch branch must log "Ogiltigt svar"')
  assert.match(body, /logError\(['"]recent-jobs['"]\s*,\s*String\(\(err\s*&&\s*err\.message\)\s*\|\|\s*err\)\)/, 'catch branch must log err.message')
})

test('popup.js: wire() paints the badge on initial popup open', () => {
  const code = codeOnly(POPUP_JS)
  // The boot hook lives at the top of wire() so the badge is
  // visible the moment the popup opens (no flicker). Match the
  // get+render pair so a future refactor can't drop the render.
  const wireMatch = code.match(/async\s+function\s+wire\s*\(\s*\)\s*\{[\s\S]*?^\s\s\}/m)
  assert.ok(wireMatch, 'wire() must be defined')
  const wire = wireMatch[0]
  assert.match(wire, /chrome\.storage\.local\.get\(\[?\s*['"]jobbpiloten_errors['"]\s*\]?\)/, 'wire() must read jobbpiloten_errors on boot')
  assert.match(wire, /renderErrors\(initial\)/, 'wire() must paint with the initial buffer')
})

test('background.js: JOBBPILOTEN_LOG_ERROR message handler persists a FIFO buffer', () => {
  const code = codeOnly(BG_JS)
  assert.match(
    code,
    /message\.type\s*===\s*['"]JOBBPILOTEN_LOG_ERROR['"]/,
    'background must dispatch JOBBPILOTEN_LOG_ERROR messages',
  )
  assert.match(code, /chrome\.storage\.local\.get\(\[?\s*['"]jobbpiloten_errors['"]\s*\]?\)/, 'handler must read existing buffer')
  assert.match(code, /chrome\.storage\.local\.set\(\{\s*jobbpiloten_errors:\s*buf\s*\}\)/, 'handler must write back the buffer')
  // FIFO cap at 20 entries (matches the popup's ERROR_BUFFER_MAX).
  assert.match(code, /while\s*\(\s*buf\.length\s*>\s*20\s*\)\s*buf\.shift\(\)/, 'handler must FIFO-cap at 20 entries')
  // Truncate the source + message strings defensively so a hostile
  // caller can't fill the quota with a 64 KB string.
  assert.match(code, /slice\(\s*0\s*,\s*64\s*\)/, 'source string must be truncated to 64 chars')
  assert.match(code, /slice\(\s*0\s*,\s*240\s*\)/, 'message string must be truncated to 240 chars')
})
