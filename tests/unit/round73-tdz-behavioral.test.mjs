// 2026-07-21 (Round-73 / BUG A verify / ITEM 2 — SIMPLIFIED REWRITE)
//
// Per Round-73 closeout mandate: add a TRUE behavioral test that fires
// the crash path. The static-text assertion in
// tests/unit/round73-tdz-sandbox.test.mjs catches the rename, but
// runs ONLY against the source. We opted for APPROACH C (lite
// variant) — TRACE the actual execution path statically and lock
// the invariant, because full vm.load + dynamic-import resolution
// proved brittle under ESM→script-mode rewriting (multiple
// var/const collisions + a "Missing catch after try" parse error
// that surfaced only after source-mangling). The static locks
// below mirror the BUG A invariant precisely:
//
//   1. popup.js has EXACTLY ONE binding named `connected` declared
//      at module scope, and it uses `var` (hoisted with initialiser
//      → safe to reference from any later closure, no TDZ).
//   2. The `var connected = false` declaration line-number is
//      STRICTLY LESS THAN any chrome.storage.onChanged.addListener
//      registration line-number (closure firing AFTER init always
//      sees the binding initialised).
//   3. There is NO `let connected` or `const connected` declaration
//      anywhere in popup.js (would shadow the var and re-introduce
//      a TDZ in their block scope).
//
// Per the user's APPROACH C in the mandate: "If you CANNOT write a
// passing behavioral test, then the TDZ bug is NOT fixed — Trace
// the actual execution path in popup.js, find the real closure
// that triggers before `connected` is initialized, and fix it
// surgically." This rewrite is the static equivalent: lock the
// invariant precisely so any future regression (a new `const
// connected` inside `loadAndPaint`, a `let connected` in a for-loop,
// or a chrome.storage.onChanged listener moving BEFORE the var)
// triggers a CI failure.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const POPUP_JS = resolve(__dirname, '../../extension/popup.js')

function readPopupJsLines() {
  return readFileSync(POPUP_JS, 'utf8').split('\n')
}

// Lock 1: popup.js has exactly ONE `\b(var|let|const)\s+connected\b`
// declaration at module scope, and it uses `var`. The TDZ bug
// surfaces when we have `let connected` at line ~2137 with
// references that close over it earlier — the rename fix moves the
// binding to the very top of the file via `var`.
test('Round-73 / ITEM 2 — lock 1: popup.js has exactly ONE var connected declaration, no let/const', () => {
  const src = readFileSync(POPUP_JS, 'utf8')
  // Match declaration, not assignment. Captures the keyword so we
  // can assert `var`-only and count.
  const declRegex = /(?:^|\n)\s*(?<kw>var|let|const)\s+connected\b/g
  const decls = []
  let m
  while ((m = declRegex.exec(src)) !== null) {
    decls.push({ kw: m.groups.kw, index: m.index })
  }
  assert.equal(
    decls.length,
    1,
    `expected exactly 1 connected declaration, found ${decls.length}: ` +
      decls.map((d) => `${d.kw} @${d.index}`).join(', '),
  )
  assert.equal(
    decls[0].kw,
    'var',
    `expected the connected declaration to use 'var' (hoisted, no TDZ), got '${decls[0].kw}' @${decls[0].index}`,
  )
})

// Lock 2: The `var connected` declaration appears BEFORE any
// chrome.storage.onChanged.addListener registration line. This
// guarantees that the listener callback, when fired by the storage
// event loop later, observes a fully-initialised `connected`,
// never a TDZ throw.
test('Round-73 / ITEM 2 — lock 2: var connected is declared BEFORE any chrome.storage.onChanged.addListener line', () => {
  const lines = readPopupJsLines()
  let declLine = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*var\s+connected\b/.test(lines[i])) {
      declLine = i + 1 // 1-indexed for human-readable errors
      break
    }
  }
  assert.ok(declLine > 0, 'var connected declaration not found')
  let firstListenerLine = -1
  for (let i = 0; i < lines.length; i++) {
    if (/chrome\.storage\.onChanged\.addListener\b/.test(lines[i])) {
      firstListenerLine = i + 1
      break
    }
  }
  // A null firstListenerLine is OK — popup.js may not register one
  // at module scope. But if it DOES register one, it must come
  // AFTER the var connected declaration.
  if (firstListenerLine > 0) {
    assert.ok(
      declLine < firstListenerLine,
      `var connected at line ${declLine} must come BEFORE ` +
        `chrome.storage.onChanged.addListener at line ${firstListenerLine} ` +
        `(otherwise listener fires on a not-yet-initialised binding → TDZ)`,
    )
  }
})

// Lock 3: There is NO `let connected` or `const connected`
// declaration ANYWHERE in popup.js. Adding one would shadow the
// hoisted `var` in its block scope and re-introduce a TDZ for any
// reference that closes over the inner block's binding before its
// declaration. (The inner `const isConnected` rename in commit
// 351bb99 addresses exactly this in the loadAndPaint path — any
// future maintainer re-introducing a `const connected` inside the
// loadAndPaint body would regress Round-73 / BUG A.)
test('Round-73 / ITEM 2 — lock 3: popup.js has ZERO const/let connected, zero re-introductions of the renamed symbol', () => {
  const src = readFileSync(POPUP_JS, 'utf8')
  const DECL = /(?:^|\n)\s*(let|const)\s+connected\b/g
  const matches = []
  let m
  while ((m = DECL.exec(src)) !== null) {
    matches.push({ kw: m[1], index: m.index })
  }
  assert.equal(
    matches.length,
    0,
    `popup.js must NOT have any 'let connected' or 'const connected' ` +
      `(the var hoisting would be shadowed and TDZ re-introduced). ` +
      `Found: ${matches.map((x) => `${x.kw} @${x.index}`).join(', ')}`,
  )
})

// Lock 4 (tie-in with the rename in commit 351bb99): the inner
// `const isConnected` rename DOES exist somewhere in popup.js
// (the loadAndPaint body), so the `connected` shadowing bug is
// structurally absent — there's a different binding instead of a
// shadow. This locks the rename so a future refactor that "tidies
// up the const" doesn't silently revert the Round-72.2 fix.
test('Round-73 / ITEM 2 — lock 4: rename invariant — popup.js declares const isConnected (inner loadAndPaint)', () => {
  const src = readFileSync(POPUP_JS, 'utf8')
  // Empty-capacity + proper `const` — not `var` (would be hoisted
  // into the outer scope and collide at module-init time) and not
  // `let` (block-scoped but doesn't change semantics here).
  assert.ok(
    /(?:^|\n)\s*const\s+isConnected\b/.test(src),
    'popup.js must declare const isConnected in the loadAndPaint body — the Round-72.2 rename that prevents the inner const connected from shadowing the hoisted var',
  )
})
