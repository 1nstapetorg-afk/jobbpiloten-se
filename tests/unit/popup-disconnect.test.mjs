// tests/unit/popup-disconnect.test.mjs
//
// Bug lock (2026-07-11, "Extension profile connection"): the popup had
// no way to disconnect from the user's profile without uninstalling.
// Added a Koppla från button that:
//   1. Best-effort DELETE /api/extension/token (with assertOriginAllowed)
//   2. Always clears chrome.storage.local [token, profile]
//   3. Shows the button conditionally on `!token` (broad reach — clears
//      half-stale state too, not just fully connected)
//
// Static-source-grep test matching tests/unit/popup-resolver.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const HTML = readFileSync('extension/popup.html', 'utf8')
const JS = readFileSync('extension/popup.js', 'utf8')

test('popup.html must include a #jp-disconnect-btn positioned AFTER jp-dashboard-btn, hidden by default', () => {
  // The button ships hidden so a fresh popup with no chrome.storage
  // doesn't tease the user into a no-op click. Reveal happens in
  // loadAndPaint() once we've read storage. Position matters:
  // jp-disconnect-btn MUST come AFTER jp-dashboard-btn so the
  // "Öppna Dashboard" affordance stays the primary CTA — the
  // destructive Koppla från is intentionally the second-most-
  // prominent action.
  const dashboardIdx = HTML.search(/id\s*=\s*["']jp-dashboard-btn["']/)
  const disconnectIdx = HTML.search(/id\s*=\s*["']jp-disconnect-btn["']/)
  assert.ok(dashboardIdx > -1, 'jp-dashboard-btn element must exist')
  assert.ok(disconnectIdx > -1, 'jp-disconnect-btn element must exist')
  assert.ok(disconnectIdx > dashboardIdx, 'jp-disconnect-btn must come AFTER jp-dashboard-btn in the actions section')
  assert.match(HTML, /jp-disconnect-btn[^>]*\bhidden\b/, 'jp-disconnect-btn must default to hidden')
})

test('popup.js disconnect() must clear BOTH token and profile from chrome.storage.local', () => {
  // The local clear MUST happen regardless of server outcome. A
  // server-side failure shouldn't strand the user on a "still
  // connected" UI that they can't escape.
  assert.match(JS, /chrome\.storage\.local\.remove\(\s*\[\s*STORAGE_KEYS\.token\s*,\s*STORAGE_KEYS\.profile\s*\]\s*\)/, 'must remove [token, profile] from chrome.storage.local')
})

test('popup.js disconnect() must best-effort DELETE /api/extension/token with Bearer header', () => {
  // The server revoke needs the bearer token AND must pass through the
  // assertOriginAllowed gate. Without these the popup would either
  // 401 the server call (no bearer) or DNSS-poison (skip origin gate).
  assert.match(JS, /await\s+fetch\(\s*url\s*,\s*\{\s*method\s*:\s*['"]DELETE['"]/, 'disconnect() must DELETE against /api/extension/token')
  assert.match(JS, /Authorization\s*:\s*`Bearer\s+\$\{token\}`/, 'DELETE call must send Bearer token in Authorization header')
  assert.match(JS, /assertOriginAllowed\(\s*url\s*\)/, 'DELETE URL must pass through assertOriginAllowed gate')
})

test('popup.js loadAndPaint() must show the disconnect button when ANY token is present', () => {
  // Visibility = `!token` (broad read): catches the half-stale state
  // where a token survives without a profile. The strict
  // `!connected` would lock the user out of cleanup. Reversed
  // condition is the bug.
  assert.match(JS, /disconnectBtn\.hidden\s*=\s*!token/, 'disconnect button visibility must be !token (broad reach)')
})

test('popup.css must include a .jp-btn.jp-btn-danger variant for the disconnect button', () => {
  // The danger variant ships BEFORE the disconnect() handler is wired,
  // so a regression-removal would silently downgrade the button to the
  // generic .jp-btn-link styling. Lock both the class definition and
  // the hover state.
  const CSS = readFileSync('extension/popup.css', 'utf8')
  assert.match(CSS, /\.jp-btn\.jp-btn-danger/, 'css must define .jp-btn.jp-btn-danger')
  assert.match(CSS, /\.jp-btn\.jp-btn-danger\s*:hover/, 'danger variant must include a hover state')
})

test('disconnect() must NOT pre-flip the status dot directly (round-6 invariant)', () => {
  // Ship-ready round-6 design: disconnect() trusts the
  // storage.onChanged listener to paint ALL status updates uniformly
  // (dot, line, meta) after chrome.storage.local.remove completes.
  // The listener fires synchronously within the same Promise
  // microtask, so the user-visible latency is sub-millisecond and
  // imperceptible. A direct dot.style.background write inside
  // disconnect() races with the listener on the error path:
  //   • storage.remove throws → setStatus({ error }) sets dot to red
  //   • Pre-flip set dot to amber earlier
  //   • Net: amber→red jolt visible to the user
  // Removing the pre-flip eliminates both flicker directions:
  //   • Success: brief green → amber (sub-ms) via listener
  //   • Failure: green → red (immediate) via setStatus({ error })
  // The only direct DOM mutation from disconnect() is the button
  // text + disabled state — those don't race the listener.
  //
  // Extracting the function body via a delimiter rather than a fixed
  // char window — the function may legitimately grow above the 1500
  // window in future refactors, and a brittle regex would silently
  // lock to the current size. The `\n}\n` anchor (no `\s*`) forces
  // the column-0 `}` to be the LAST char of one line — internal
  // `}` sit at column 2/4 so they can't satisfy this pattern. This
  // unique-match guarantee means the regex captures exactly the
  // disconnect() body even if other functions are added/removed
  // elsewhere in the file.
  const bodyMatch = JS.match(/async\s+function\s+disconnect\s*\(\s*\)\s*\{[\s\S]*?\n\}\n/)
  // If the body-extraction regex over-matched (no next function,
  // file ended mid-function), ensure we at least catch some body.
  const body = bodyMatch ? bodyMatch[0] : ''

  // Sanity: the body MUST contain the body-error branch sentinel
  // "Kunde inte koppla från" — if the regex matched a different
  // function block (e.g., a future refactor that renames
  // disconnect), the test would catch it before the dot/line/meta
  // assertions fire.
  assert.match(body, /Kunde inte koppla från/, 'function body extracted must contain the disconnect error sentinel — regex matched the wrong block?')
  // Lock both invariants: no direct dot writes inside disconnect().
  assert.equal(
    /dot\.style\.background\s*=/.test(body),
    false,
    'disconnect() must NOT write jp-status-dot.style.background directly — setStatus owns it',
  )
  assert.equal(
    /dot\.style\.boxShadow\s*=/.test(body),
    false,
    'disconnect() must NOT write jp-status-dot.style.boxShadow directly — setStatus owns it',
  )
})

test('disconnect() must NOT write line.textContent or meta.textContent directly (round-3 invariant)', () => {
  // The flicker fix relies on storage.onChanged owning the line/meta
  // updates uniformly. A direct write inside disconnect() would
  // race the listener and produce a visible flicker.
  // Same delimiter-based body extraction as the dot test above.
  const bodyMatch = JS.match(/async\s+function\s+disconnect\s*\(\s*\)\s*\{[\s\S]*?\n\}\n/)
  const body = bodyMatch ? bodyMatch[0] : ''
  // Sanity: the body must contain the disconnect error sentinel.
  assert.match(body, /Kunde inte koppla från/, 'function body extracted must contain the disconnect error sentinel — regex matched the wrong block?')
  assert.equal(
    /line\.textContent\s*=/.test(body),
    false,
    'disconnect() must NOT write line.textContent directly — setStatus owns it',
  )
  assert.equal(
    /meta\.textContent\s*=/.test(body),
    false,
    'disconnect() must NOT write meta.textContent directly — setStatus owns it',
  )
})
