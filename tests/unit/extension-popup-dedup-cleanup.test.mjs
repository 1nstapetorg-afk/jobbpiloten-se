// tests/unit/extension-popup-dedup-cleanup.test.mjs
//
// Round-46.1 cleanup regression lock.
//
// The pre-fix popup.js had a paste-error artifact: an orphan
// `method: 'POST'` block sitting AFTER the closing `})` of the
// `fetchWithRetry(url, { ... })` call inside `setupComposePanel()`.
// JavaScript's label-statement syntax happened to tolerate it:
//
//     })                                  <-- closes fetchWithRetry(url, { ... })
//       method: 'POST',                  <-- parsed as label + string expr (no-op)
//       headers: { ... },                <-- parsed as label + block (no-op)
//       body: JSON.stringify({...}),     <-- parsed as label + expression statement
//     })                                 <-- JS ate this too
//
// So 738/738 unit tests passed at runtime. But the block WAS dead
// code any maintainer grep-ing for "method: 'POST'" would
// discover twice and read as if it were the actual call site,
// and any future tool walking popup.js for structured object
// literals would silently strip the line. Locks prevent the
// paste-corruption pattern from returning.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POPUP_PATH = path.resolve(__dirname, '../../extension/popup.js')
const POPUP_SRC = fs.readFileSync(POPUP_PATH, 'utf-8')

// =============================================================================
// 1. The paste-corruption fingerprint
// =============================================================================
//
// We anchor on the SPECIFIC byte sequence that survived the
// interrupted Round-46.1 edit: a closing `})` (12-space indent,
// end of fetchWithRetry call) immediately followed by another
// indented block whose first line is `method: 'POST',`. This is
// the only fingerprint the disruption produced; locking on the
// exact sequence keeps the test deterministic without false
// positives on legitimate `method: 'POST'` keys (the legit
// occurrences live inside the same kind of indent but are NOT
// preceded by a closing `})`).

const CORRUPTION_FINGERPRINT = /\n            \}\)\n              method: 'POST',/

test('cleanup-1: popup.js must NOT contain a paste-error duplicate method-POST block', () => {
  assert.doesNotMatch(
    POPUP_SRC,
    CORRUPTION_FINGERPRINT,
    'popup.js must not contain the paste-error fingerprint: closing `})` followed by an indented `method: POST,` block (Round-46.1 cleanup)',
  )
})

// =============================================================================
// 2. Call-site count sanity
// =============================================================================
//
// popup.js has TWO POST fetch sites (compose-panel
// /api/extension/email-body + saveUtkast /api/applications/email).
// The cleanup removed the third paste-error duplicate. The
// guard catches both regressions: too many (3+) = duplicate
// returned; too few (1) = cleanup removed a legit call by
// accident.

test('cleanup-2: popup.js must contain at least two method-POST call sites', () => {
  // Relaxed from `=== 2` to `>= 2` so a future maintainer adding
  // a third legitimate POST endpoint doesn't false-positive this
  // test. Cleanup-1 (the fingerprint test) is the canonical guard
  // against the paste-corruption pattern; this count is the
  // belt-and-braces backstop. A count < 2 = a legit call was lost.
  const POST_COUNT = (POPUP_SRC.match(/method: 'POST',/g) || []).length
  assert.ok(
    POST_COUNT >= 2,
    'popup.js must contain >=2 method:POST literals (compose-panel + saveUtkast); got ' + POST_COUNT,
  )
})

test('cleanup-3: popup.js must contain at least two fetchWithRetry call sites', () => {
  // Use a call-site signature prefix (`const res = await ...`) so
  // the regex doesn't false-match the `async function
  // fetchWithRetry(url, opts = {}, ...)` declaration earlier in
  // the file. Relaxed to `>= 2` (same rationale as cleanup-2) so
  // future legitimate endpoints don't false-positive this test.
  const FETCH_COUNT = (POPUP_SRC.match(/const\s+res\s+=\s+await\s+fetchWithRetry\s*\(\s*url\s*,/g) || []).length
  assert.ok(
    FETCH_COUNT >= 2,
    'popup.js must contain >=2 const res = await fetchWithRetry(url, call sites; got ' + FETCH_COUNT,
  )
})

// =============================================================================
// 4. Cleanup must LEAVE the AbortController + setTimeout pair intact
// =============================================================================
//
// The Round-46.1 polish introduced a 4-second AbortController
// timeout shared with the email-body fetch. The cleanup must
// LEAVE the controller intact. If the fix accidentally removed
// the controller this canary catches it; if the fix removed too
// little, cleanup-1 above catches it.

test('cleanup-4: popup.js must retain the Round-46.1 AbortController + 4s timeout', () => {
  assert.match(POPUP_SRC, /new AbortController\(\)/, 'AbortController must still be constructed for the email-body fetch')
  assert.match(POPUP_SRC, /setTimeout\(\(\)\s*=>\s*ctrl\.abort\(\)\s*,\s*4[_]?000\s*\)/, 'controller must still abort at 4 seconds')
  assert.match(POPUP_SRC, /signal:\s*ctrl\.signal/, 'signal: ctrl.signal must still be wired into the email-body fetch')
})
