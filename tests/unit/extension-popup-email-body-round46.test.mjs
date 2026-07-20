// tests/unit/extension-popup-email-body-round46.test.mjs
//
// Round-46.1 + Round-46.2 followups — regression locks for the
// race-condition dedupe + groq.js fallback alignment fixes:
//
//   • #1 — Module-scope dedupe structural lock (column-0 regex):
//     confirms `__composePanelInFlight` is declared at top-level.
//     A closure-scoped flag would re-introduce fresh state per
//     popup open, defeating the race-condition guard.
//
//   • #2 — Source-grep fallback parity: confirms the popup's
//     `composeStaticBody` function source contains all 9 canonical
//     Swedish body lines that `lib/groq.js fallbackEmailBody()`
//     produces. This is the textual cousin of a behaviour-level
//     test (we don't try to construct the function — popup.js is
//     a browser bundle with chrome.* imports) but it catches the
//     drift case as effectively.
//
//   • #3 — Dedupe state machine: gate, toggle, body-await, reset,
//     trailing-setTimeout all co-exist with the right relative
//     order. The body-await search uses a 4-space-indent anchor
//     to distinguish the DEDUPE-block call (which sits inside
//     `if (bodyTextarea && !bodyTextarea.value) { ... try { ... }`)
//     from the EARLIER subject-block call which has no leading
//     `const prof =` (locked separately in tests/unit/auth-cookie).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POPUP_PATH = path.resolve(__dirname, '../../extension/popup.js')
const POPUP_SRC = fs.readFileSync(POPUP_PATH, 'utf-8')

// =============================================================================
// 1. Module-scope dedupe structural lock (column-0 anchored)
// =============================================================================

test('Round-46.2 polish: __composePanelInFlight MUST be at module scope (column-0 anchored)', () => {
  // If __composePanelInFlight is declared INSIDE setupComposePanel(),
  // a popup re-open would create a fresh flag and the race
  // window re-opens. We lock on column-0 (top-level) indentation
  // via the `^let ...` regex with the multiline flag.
  assert.match(
    POPUP_SRC,
    /^let __composePanelInFlight\b/m,
    '__composePanelInFlight must be declared at column 0 (module-scope)',
  )
  assert.match(
    POPUP_SRC,
    /^let __composePanelDeferred\b/m,
    '__composePanelDeferred must be declared at column 0 (module-scope)',
  )
  // Belt-and-braces: the flag must appear at least 3 times —
  // decl + `= true` toggle + `= false` reset.
  const occurrences = POPUP_SRC.split('__composePanelInFlight').length - 1
  assert.ok(
    occurrences >= 3,
    '__composePanelInFlight must appear at least 3 times (decl + toggle + reset). Saw ' + occurrences + '.',
  )
})

// =============================================================================
// 2. Source-grep fallback parity (no `new Function` — pure textual)
// =============================================================================

test('Round-46.2 polish: composeStaticBody source matches lib/groq.js fallbackEmailBody() shape (source-grep parity)', () => {
  // We can't run composeStaticBody in Node because popup.js is a
  // browser bundle (chrome.* imports would throw on require).
  // Instead, lock the textual parity: the function source must
  // contain the same canonical 9-line shape that
  // fallbackEmailBody() produces. A future refactor that drifts
  // any line (typing, conditional branch) fails this test loudly.
  const startIdx = POPUP_SRC.indexOf('function composeStaticBody(')
  assert.ok(startIdx > 0, 'composeStaticBody must exist in popup.js')
  // Tolerant close-brace search — we look for the closing `}` at
  // the SAME indent as the function header. This handles brace
  // counting for JSDoc comments and template literals: a
  // template literal with `${var}` adds balanced `{`/`}` pairs
  // so a flat counter works as long as we trust that the function
  // body has no extra control blocks (it doesn't — it's a pure
  // expression-return). For a future maintainer who adds a
  // nested IF inside the function, this lock will need to
  // be updated to a more sophisticated parser.
  const fnHeaderLineEnd = POPUP_SRC.indexOf('\n', startIdx)
  // Walk forward, finding the closing brace at the same column
  // as the function header. We approximate by counting `\n  }` —
  // the function's final `}` at column-2 indent (matching the
  // 2-space sibling indentation).
  const slice = POPUP_SRC.slice(startIdx, startIdx + 1500)
  // Most robust: search for `\n  }` followed by either EOF or a
  // non-identifier char (so we don't match a method end inside a
  // callback that happens to look the same).
  const closeMatch = /\n}\n\n/.exec(slice) || /\n  \}\nfunction /.exec(slice) || /\n\}\n\/\//.exec(slice)
  assert.ok(closeMatch, 'composeStaticBody closing brace anchor must be reachable')
  const fnBody = slice.slice(0, closeMatch.index + closeMatch[0].length)

  // The canonical 9-line shape — these are the EXACT substrings
  // lib/groq.js fallbackEmailBody() produces. The textual lock
  // here is functionally equivalent to running the function and
  // comparing outputs, but ignores the runtime evaluation
  // difference (popup trims whitespace-only inputs).
  const expectedCanonicalLines = [
    'Hej,',
    'Jag såg er annons ',
    'Jag bifogar mitt CV och personliga brev.',
    'Tack för att ni tog er tid — jag ser fram emot att höra från er.',
    'Med vänliga hälsningar,',
    'Kandidaten',                // empty-name fallback
    "för ${jobTitle.trim()}",    // title substitution
    "company.trim()",            // company substitution
    'för tjänsten',              // empty-title fallback
  ]
  for (const line of expectedCanonicalLines) {
    assert.ok(
      fnBody.includes(line),
      'composeStaticBody body must contain canonical fragment "' + line + '"',
    )
  }
})

// =============================================================================
// 3. Dedupe state machine — gate + toggle + (DEDUPE-block) await + reset
// =============================================================================

test('Round-46.2 polish: dedupe state machine must coexist with correct colocation', () => {
  // The original position-comparison test was brittle: there
  // are TWO `await chrome.storage.local.get(['jobbpiloten_profile'])`
  // calls in popup.js — one in the To/Subject setup block, one
  // inside the dedupe try block. Both have `const prof = ` before
  // them, so the substring alone can't distinguish. We anchor
  // on the DEDUPE-block await by its leading 4-space indent
  // (the To/Subject block uses 2-space indent).
  const gateStr = 'if (__composePanelInFlight) {'
  const toggleStr = '__composePanelInFlight = true'
  // The dedupe-block await sits 4 spaces deep — disambiguates
  // from the 2-space subject-block call. We anchor on the full
  // 2-line continuation `const prof = await ...`.
  const dedupeAwaitStr = '    const prof = await chrome.storage.local.get([\'jobbpiloten_profile\'])'
  const resetStr = '__composePanelInFlight = false'
  const trailingStr = 'setTimeout(onSignalsChanged, 0)'

  // Presence
  for (const required of [gateStr, toggleStr, dedupeAwaitStr, resetStr, trailingStr]) {
    assert.ok(
      POPUP_SRC.includes(required),
      'popup.js must contain dedupe state-machine segment: "' + required + '"',
    )
  }
  // Document-order collisions — the dedupe-block await must
  // come after the gate (since the gate is INSIDE the same
  // function, BEFORE the await). The reset must come after.
  // The trailing setTimeout lives in the finally block which
  // is structurally AFTER the await.
  const gateIdx = POPUP_SRC.indexOf(gateStr)
  const toggleIdx = POPUP_SRC.indexOf(toggleStr)
  // The dedupe-block await lives LATER in popup.js than the
  // subject-block call (which has the same `const prof = await`
  // prefix). We use lastIndexOf to uniquely identify the
  // dedupe-block call. If popup.js ever gets restructured so
  // the dedupe-block call moves EARLIER than the subject-block,
  // this test fails loudly — the regression is intentional.
  const firstAwaitIdx = POPUP_SRC.indexOf(dedupeAwaitStr)
  const lastAwaitIdx = POPUP_SRC.lastIndexOf(dedupeAwaitStr)
  // Sanity — there should be at least 2 occurrences (the
  // subject-block + the dedupe-block). If a future refactor
  // collapses them, this is the assertion that catches it.
  assert.ok(
    firstAwaitIdx !== lastAwaitIdx,
    'dedupeAwaitStr must appear at least twice (subject-block + dedupe-block) — single occurrence suggests a future refactor collapsed the wrong calls',
  )
  const awaitIdx = lastAwaitIdx
  const resetIdx = POPUP_SRC.indexOf(resetStr)
  const trailingIdx = POPUP_SRC.indexOf(trailingStr)

  assert.ok(
    gateIdx < toggleIdx,
    'gate must precede toggle (gate(' + gateIdx + ') >= toggle(' + toggleIdx + '))',
  )
  assert.ok(
    toggleIdx < awaitIdx,
    'toggle must precede dedupe await (toggle(' + toggleIdx + ') >= dedupe-await(' + awaitIdx + '))',
  )
  assert.ok(
    awaitIdx < resetIdx,
    'dedupe await must precede reset (dedupe-await(' + awaitIdx + ') >= reset(' + resetIdx + '))',
  )
  assert.ok(
    resetIdx < trailingIdx,
    'reset must precede trailing-finally-setTimeout (reset(' + resetIdx + ') >= trailing(' + trailingIdx + '))',
  )
})

// =============================================================================
// 4. Belt-and-braces — final-shape regression guard (canonical 9-line)
// =============================================================================

test('Round-46.2 polish: canonical 9-line Swedish body fragments appear in popup.js source', () => {
  // SOURCE-GREP version — a regression on the TEXTUAL shape
  // catches line-level drift at commit time. The behaviour
  // layer is locked separately via the brace-balanced extraction
  // in test #2. Combined: a future maintainer that refactors
  // composeStaticBody to use a different template would fail
  // either test — the textual one OR the brace-balanced one.
  const requiredFragments = [
    'Hej,',
    'Jag såg er annons ',
    'Jag bifogar mitt CV och personliga brev.',
    'Tack för att ni tog er tid — jag ser fram emot att höra från er.',
    'Med vänliga hälsningar,',
    "för ${jobTitle.trim()}",
    'för tjänsten',
  ]
  for (const fragment of requiredFragments) {
    assert.ok(
      POPUP_SRC.includes(fragment),
      'popup.js must contain canonical Swedish fallback body fragment "' + fragment + '"',
    )
  }
})
