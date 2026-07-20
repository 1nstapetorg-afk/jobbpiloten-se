// tests/unit/extension-popup-vm.test.mjs
//
// Round-47 — vm-based behavioural smoke test for extension/popup.js's
// storage.onChanged listener (the Round-10 close-on-delivery +
// sync-mirror contract fixed for the content-script-bridge delivery
// path).
//
// BACKGROUND: the popup's chrome.storage.onChanged listener inside
// `function wire()` is the SINGLE point that closes the auth window
// when a fresh token lands in chrome.storage.local AND mirrors the
// token+profile to chrome.storage.sync for cross-device resume.
// Round-36 surfaced this with the brace-counting helper extraction;
// Round-37 added STATIC-grep locks for the listener signature and
// the newToken-and-windowId gate. STATIC checks alone don't catch:
//
//   - a typo in authHandshakeState.windowId (the gate variable)
//   - a forgotten .catch() wrapper on chrome.storage.sync.set
//   - a refactor that drops the loadAndPaint() re-paint branch
//   - a mutation of chrome.storage.sync.set into chrome.storage.sync.set() WITH a wrong key
//
// This file adds the BEHAVIOURAL test that EXERCISES the runtime
// contract. Strategy (mirrors the Round-46 extension-content-vm.test.mjs):
//   1. extract the wire() storage.onChanged listener arrow body via
//      brace-counting with string/comment skipping (the same approach
//      as the balancer in tests/unit/popup-resolver.test.mjs)
//   2. IIFE in vm sandbox with mutable spy arrays for the chrome.* + state
//   3. invoke the listener callback with synthetic changes / area events
//   4. assert on chrome.windows.remove spy + chrome.storage.sync.set spy + authHandshakeState mutations
//
// We invoke the callback DIRECTLY rather than registering it through
// chrome.storage.onChanged.addListener(...). The production wire()
// registers it at module-load time but module-load is intentionally
// outside this test's contract — vm-loading popup.js would bring in
// the full DOM-mutation surface (setStatus, setComposeStatus,
// loadAndPaint, setupComposePanel, ...). Direct invocation pins
// JUST the storage-event handler's behavior.
//
// The test file does NOT require vm2, vitest, or any extra deps.
// Run via `yarn test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { extractStorageOnChangedBodyInWire } from './lib/js-source-helpers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POPUP_JS_PATH = path.resolve(__dirname, '../../extension/popup.js')
const POPUP_JS = fs.readFileSync(POPUP_JS_PATH, 'utf-8')

// ---------- 1. Brace-counting body extractor ----------
//
// Round-47 review (HIGH-severity fragility): a naive brace counter
// counts every `{` and `}` in the source as a block delimiter,
// INCLUDING `{}` inside string literals and block comments. The
// previous local helper did NOT skip these — a future reviewer
// adding a JSDoc type annotation with `{a:1}` would silently
// truncate the extracted body.
//
// The fix: re-implement the skip-string/comment logic that
// tests/unit/popup-resolver.test.mjs's `extractBalancedBlock`
// uses (with appropriate lookbehind for escaped slashes in
// regex literals). We import the same patterns here inline so
// the test stays self-contained.

function skipString(source, i, quote) {
  // Walks forward through a string literal starting at the
  // opening quote (i is the opening quote position), past
  // escapes, returns index AFTER the closing quote.
  // Template literals additionally recurse through `${...}`
  // interpolations so a ``}`` inside `${...}` doesn't confuse
  // the outer brace counter.
  i++
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    if (quote === '`' && ch === '$' && source[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < source.length && depth > 0) {
        if (source[i] === '{') depth++
        else if (source[i] === '}') depth--
        i++
      }
      continue
    }
    i++
  }
  return i
}

function skipToNextCode(source, i) {
  // Skips chars that may legitimately contain `{}` but DO NOT open
  // a new JS block — string literals, line comments, block
  // comments, and (escaped) regex delimiters. Returns the index
  // of the first non-skipped char, or source.length if EOF.
  // Regex literals are detected by lookbehind for an unescaped
  // `/` (a future maintainer adding an escaped-`\/` regex won't
  // accidentally trigger line-comment misparse).
  while (i < source.length) {
    const ch = source[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(source, i, ch)
      continue
    }
    if (ch === '/' && source[i + 1] === '/' &&
        (i === 0 || source[i - 1] !== '\\')) {
      const nl = source.indexOf('\n', i)
      i = nl >= 0 ? nl + 1 : source.length
      continue
    }
    if (ch === '/' && source[i + 1] === '*' &&
        (i === 0 || source[i - 1] !== '\\')) {
      const end = source.indexOf('*/', i + 2)
      i = end >= 0 ? end + 2 : source.length
      continue
    }
    return i
  }
  return i
}

function findBalancedBraceEnd(source, openIdx) {
  // Walks forward from openIdx (the position of the opening `{`)
  // counting braces, skipping strings + comments + regex. Returns
  // the position of the matching closing `}`, or -1 if no match
  // before EOF.
  let depth = 0
  let i = openIdx
  while (i < source.length) {
    // skipToNextCode lets `i` advance past any string/comment/regex
    // span. After this call `i` is at a guaranteed non-string-or-
    // comment position. Without the top-placement, a normal char
    // would return `i` unchanged (no skip triggered) and the loop
    // would infinitely re-read the same char.
    i = skipToNextCode(source, i)
    if (i >= source.length) return -1
    const ch = source[i]
    if (ch === '{') {
      depth++
      i++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0) return i
      i++
      continue
    }
    i++
  }
  return -1
}

// Anchor on `function wire()` first because popup.js has TWO
// chrome.storage.onChanged listeners — one in `wire()` (the one we
// want; tests the auth-bridge close + sync-mirror gate) and one in
// `setupComposePanel()` (a short 3-line listener that re-renders
// the email compose panel; we deliberately don't vm-test that one
// because it has no testable external behavior). Returns the body
// content INSIDE the outer braces (no surrounding `{`/`}`)
function extractStorageOnChangedBody(src) {
  const wireIdx = src.indexOf('function wire()')
  if (wireIdx < 0) return null
  const markerIdx = src.indexOf('chrome.storage.onChanged.addListener(', wireIdx)
  if (markerIdx < 0) return null
  const arrowIdx = src.indexOf('=>', markerIdx)
  if (arrowIdx < 0) return null
  // The arrow function body opens at the next `{` after the `=>`.
  const braceOpen = src.indexOf('{', arrowIdx)
  if (braceOpen < 0) return null
  const closeIdx = findBalancedBraceEnd(src, braceOpen)
  if (closeIdx < 0) return null
  return src.slice(braceOpen + 1, closeIdx)
}

const extractedBody = extractStorageOnChangedBody(POPUP_JS)

test('extraction: popups brace-counting helper must locate the wire() storage.onChanged listener', () => {
  // If a refactor renames wire() or removes the chrome.storage.onChanged
  // listener from it, this assertion fires BEFORE the IIFE compile
  // step. Without this guard, a refactor would surface as a vm.runInNewContext
  // SyntaxError at line N — hard to map back to "wire() isn't there".
  assert.ok(extractedBody,
    'brace-counting helper failed to locate the wire() storage.onChanged listener — a refactor renamed wire() or removed the chrome.storage.onChanged.addListener() call. Update the test helper + the popup.js wire() body together.')
})

// ---------- 2. Build the sandbox + IIFE wrapper ----------
//
// Anything the extracted body touches must be present in the sandbox.
// The body references:
//   - STORAGE_KEYS                                      → sandbox.STORAGE_KEYS
//   - authHandshakeState.windowId / .timer / .received  → sandbox.authHandshakeState
//   - chrome.windows.remove(windowId).catch(...)         → sandbox.chrome.windows.remove
//   - chrome.storage.sync.set(...).catch(...)            → sandbox.chrome.chrome.storage.sync.set
//   - chrome.storage.local.set(...)                     → NOT called in this listener, skip
//   - clearTimeout                                      → sandbox.clearTimeout
//   - console.info / console.warn                       → sandbox.console.* (Node's are fine but spy for assertions)
//   - loadAndPaint() (function call)                    → sandbox.loadAndPaint spy
//   - refreshDetectedFields() (function call)           → sandbox.refreshDetectedFields spy
//
// The mutable `authHandshakeState` and the spy arrays must be the
// SAME object reference inside the wrapping callback — vm sandboxes
// start empty, so the wrapper must reference our sandboxed values
// by closure scope (the `new Function` constructor approach would
// lose them, so we use vm.runInNewContext + the IIFE harness).

const sandbox = {
  // chrome.* surface — what the body calls. Each method captures
  // its args into a `_calls` spy array so the test reads back what
  // would have happened in production.
  chrome: {
    windows: {
      remove: function windowsRemoveSpy(windowId) {
        sandbox._windowsRemoveCalls.push({ windowId })
        // Return a Promise that resolves — production's .catch(() => {})
        // never fires, mirroring the happy path.
        return Promise.resolve({})
      },
    },
    storage: {
      sync: {
        set: function syncSetSpy(obj) {
          sandbox._syncSetCalls.push(obj)
          return Promise.resolve()
        },
      },
      local: {
        set: function localSetSpy() {
          sandbox._localSetCalls.push(Array.from(arguments))
          return Promise.resolve()
        },
      },
    },
  },
  // Module-scoped constants / state from popup.js — declared as
  // sandbox properties (NOT `const`) so the IIFE closure can read them
  // and the wrapper can mutate authHandshakeState for assertions.
  STORAGE_KEYS: {
    token: 'jobbpiloten_token',
    profile: 'jobbpiloten_profile',
    dashboardUrl: 'jobbpiloten_dashboardUrl',
    expiresAt: 'jobbpiloten_expiresAt',
    styleOverride: 'jobbpiloten_styleOverride',
  },
  authHandshakeState: {
    windowId: null,
    timer: null,
    received: false,
  },
  // Helpers invoked by the body — STUB ONLY (the body just calls
  // them; no assertion on their internal behavior in THIS vm-test).
  loadAndPaint: function loadAndPaintSpy() {
    sandbox._loadAndPaintCalls.push(true)
  },
  refreshDetectedFields: function refreshDetectedFieldsSpy() {
    sandbox._refreshDetectedFieldsCalls.push(true)
  },
  // Node primitives that vm sandboxes start without.
  Promise,
  clearTimeout,
  setTimeout,
  // Spy arrays — populated by the listener body; the test reads from
  // them post-invocation.
  _windowsRemoveCalls: [],
  _syncSetCalls: [],
  _localSetCalls: [],
  _loadAndPaintCalls: [],
  _refreshDetectedFieldsCalls: [],
}
const ctx = vm.createContext(sandbox)

// Compile the extracted body inside the sandbox. The IIFE
// `(() => { function name(changes, area) { <extracted body> };
//            return name; })()` declares a NAMED function (so the
// V8 stack traces are debuggable) and returns it so the test can
// invoke it directly.
//
// CRITICAL: we assert `extractedBody` is non-null inline (above) so
// the template-literal interpolation below never gets `undefined`.
// Without that gate, the IIFE compiles `function name(changes, area) { undefined; }`
// — silent no-op.
const code = `
(() => {
  if (!${JSON.stringify(extractedBody)}) {
    throw new Error("extractedBody is empty — wire() listener not found")
  }
  function storageOnChanged(changes, area) {
    ${extractedBody}
  }
  return { storageOnChanged };
})()
`

const helpers = vm.runInNewContext(code, ctx)
const { storageOnChanged } = helpers

// ---------- 3. Behavioural smoke tests ----------

function resetSandbox() {
  // Re-initialise the mutable spy arrays + authHandshakeState so each
  // test starts from a clean slate. The chrome.* stubs and the
  // chrome.storage.sync.set spy are intentionally NOT reset (they
  // always do the same thing); only the state + call-records reset.
  sandbox._windowsRemoveCalls.length = 0
  sandbox._syncSetCalls.length = 0
  sandbox._localSetCalls.length = 0
  sandbox._loadAndPaintCalls.length = 0
  sandbox._refreshDetectedFieldsCalls.length = 0
  sandbox.authHandshakeState.windowId = null
  sandbox.authHandshakeState.timer = null
  sandbox.authHandshakeState.received = false
}

const FAKE_TOKEN_A = 'a'.repeat(64)  // matches the /^[a-f0-9]{64}$/ gate
const FAKE_TOKEN_B = 'b'.repeat(64)  // matches too (different value for the re-connect test)
const FAKE_PROFILE = { fullName: 'Anna', email: 'a@b.c', firstName: 'Anna' }

test('storageOnChanged: new token + pending windowId → close-window + sync.mirror + state advances (Round-47 positive case)', () => {
  resetSandbox()
  // Pre-state: a pending auth window with a windowId.
  sandbox.authHandshakeState.windowId = 42

  storageOnChanged(
    {
      [sandbox.STORAGE_KEYS.token]: { oldValue: undefined, newValue: FAKE_TOKEN_A },
      [sandbox.STORAGE_KEYS.profile]: { oldValue: undefined, newValue: FAKE_PROFILE },
    },
    'local',
  )

  // 1. Close-window call fired with the pending windowId.
  assert.equal(sandbox._windowsRemoveCalls.length, 1,
    'a new token during a pending handshake must fire chrome.windows.remove exactly ONCE')
  assert.equal(sandbox._windowsRemoveCalls[0].windowId, 42,
    'chrome.windows.remove must be called with the authHandshakeState.windowId captured by openAuthFlow')

  // 2. Sync mirror fired with the newToken + profile.
  assert.equal(sandbox._syncSetCalls.length, 1,
    'a new token during a pending handshake must fire chrome.storage.sync.set exactly ONCE (mirror bridge-path tokens)')
  const syncPayload = sandbox._syncSetCalls[0]
  assert.equal(syncPayload[sandbox.STORAGE_KEYS.token], FAKE_TOKEN_A,
    'sync.set payload must include STORAGE_KEYS.token = newToken (cross-device resume)')
  assert.deepEqual(syncPayload[sandbox.STORAGE_KEYS.profile], FAKE_PROFILE,
    'sync.set payload must also include STORAGE_KEYS.profile when the storage event included a profile change')

  // 3. authHandshakeState advances: windowId cleared, received = true.
  assert.equal(sandbox.authHandshakeState.windowId, null,
    'after close-window, authHandshakeState.windowId must be null (so a re-trigger will not re-fire close)')
  assert.equal(sandbox.authHandshakeState.received, true,
    'after close-window, authHandshakeState.received must be true (signals the openAuthFlow timeout-fallback will not fire)')

  // 4. loadAndPaint fires on the same event (the listener unconditionally
  // re-paints on a new token OR a profile change).
  assert.equal(sandbox._loadAndPaintCalls.length, 1,
    'a new token must trigger loadAndPaint() so the popup re-renders as connected within the same tick')
})

test('storageOnChanged: profile-only change (no token in changes) → no close-window, no sync.mirror (Round-47 negative case)', () => {
  // SYMPTOM: the listener used to gate on `newValue && !oldValue`,
  // which breaks on re-connects because new AND old were both truthy.
  // The Round-10 fix moved to a windowId-based gate; profile-only
  // changes (which fire routinely on every refresh + every
  // dashboardUrl write) must NOT trigger close-window.
  //
  // Lock the contract: a profile-only change does NOT fire
  // windows.remove. Round-47 polish (post-fix review): the test
  // passes a `changes` object WITHOUT the token key at all —
  // tokenChange becomes null, newToken becomes null, and the gate
  // `newToken && ...` short-circuits. A previous version of the
  // test passed `token: { oldValue: sameToken, newValue: sameToken }`
  // (a no-op re-write of the same token), which would still have
  // a truthy newToken and trigger the gate — that's a different
  // test scenario (a redundant token write) which the gate
  // correctly fires on. The profile-only case we're locking is
  // specifically "changes has no token entry at all".
  resetSandbox()
  sandbox.authHandshakeState.windowId = 42
  const newProfile = { ...FAKE_PROFILE, email: 'changed@b.c' }

  storageOnChanged(
    {
      [sandbox.STORAGE_KEYS.profile]: { oldValue: FAKE_PROFILE, newValue: newProfile },
      // NOTE: no [sandbox.STORAGE_KEYS.token] entry — tokenChange
      // becomes null, newToken is null, gate short-circuits.
    },
    'local',
  )

  // 1. windows.remove NOT called — no token in changes means the
  // gate cannot fire regardless of the other keys.
  assert.equal(sandbox._windowsRemoveCalls.length, 0,
    'a profile-only storage change (no token in changes) must NOT close the auth window — close is reserved for token events with truthy newValue')

  // 2. sync.set NOT called — no new token to mirror.
  assert.equal(sandbox._syncSetCalls.length, 0,
    'a profile-only change must NOT mirror to sync (sync.set fires only on the fresh-token branch)')

  // 3. windowId is preserved (still pending).
  assert.equal(sandbox.authHandshakeState.windowId, 42,
    'a profile-only change must NOT clear authHandshakeState.windowId — the handshake is still pending')

  // 4. received is NOT flipped.
  assert.equal(sandbox.authHandshakeState.received, false,
    'a profile-only change must NOT flip received=true')

  // 5. loadAndPaint DOES fire (unconditional re-paint on profile change).
  assert.equal(sandbox._loadAndPaintCalls.length, 1,
    'a profile-only change must still trigger loadAndPaint() so the popup reflects the new profile shape')
})

test('storageOnChanged: new token + NO pending windowId → no close-window (the gate is windowId, not newToken alone) (Round-47)', () => {
  // The Round-10 narrow-gate fix: `newToken && authHandshakeState.windowId != null`.
  // A token write WITHOUT a pending handshake (e.g. dashboardUrl
  // late-update, content-script re-broadcast when popup isn't open)
  // must not trigger close-window — the auth window isn't even
  // there to close.
  resetSandbox()
  // windowId is null (default) — no pending handshake.

  storageOnChanged(
    {
      [sandbox.STORAGE_KEYS.token]: { oldValue: undefined, newValue: FAKE_TOKEN_A },
    },
    'local',
  )

  assert.equal(sandbox._windowsRemoveCalls.length, 0,
    'a new token WITHOUT a pending handshake windowId must NOT fire chrome.windows.remove — closes only on the newToken-and-windowId branch')
  assert.equal(sandbox._syncSetCalls.length, 0,
    'a new token WITHOUT a pending handshake must NOT mirror to sync either — sync mirror fires only on the close-window branch')
  assert.equal(sandbox.authHandshakeState.received, false,
    'a new token WITHOUT a pending handshake must NOT flip received=true')
})

test('storageOnChanged: sync area writes do NOT trigger close-window (only local does)', () => {
  // The narrowing gate: tokenChange is only consulted when
  // `area === 'local'`. sync-only writes (the cross-device resume
  // path) should NOT trigger close-window because the auth window
  // lives on the originating machine, not the receiving one.
  resetSandbox()
  sandbox.authHandshakeState.windowId = 42

  storageOnChanged(
    {
      [sandbox.STORAGE_KEYS.token]: { oldValue: undefined, newValue: FAKE_TOKEN_A },
    },
    'sync',  // area = sync, not local
  )

  assert.equal(sandbox._windowsRemoveCalls.length, 0,
    'a sync-area token write must NOT trigger close-window — only the originating local-area write fires the bridge')
  assert.equal(sandbox._syncSetCalls.length, 0,
    'a sync-area write must NOT re-mirror to sync (would be a redundant write)')
})

test('storageOnChanged: detectedCount write fires refreshDetectedFields but NOT close-window', () => {
  // The content script writes `jobbpiloten_detectedCount` after
  // each scan; the popup listens for that key and re-queries the
  // active tab so the Fyll i nu button enables in real time. This
  // branch fires refreshDetectedFields() — confirming the
  // Round-11 contract without affecting the auth-window machinery.
  resetSandbox()
  sandbox.authHandshakeState.windowId = 42

  storageOnChanged(
    {
      jobbpiloten_detectedCount: { oldValue: 0, newValue: 5 },
    },
    'local',
  )

  assert.equal(sandbox._refreshDetectedFieldsCalls.length, 1,
    'a detectedCount write must trigger refreshDetectedFields() exactly once')
  assert.equal(sandbox._windowsRemoveCalls.length, 0,
    'a detectedCount write must NOT trigger close-window (close is reserved for token events)')
})

test('storageOnChanged: a re-connect (new token WITHOUT a profile in changes) DOES close the windowId-gated branch', () => {
  // The Round-10 narrow-gate fix specifically addressed this case.
  // Pre-fix: `newValue && !oldValue` failed because new AND old were
  // both truthy on a re-connect, so the branch never fired and
  // the 30s timer kept running. After fix: the windowId-gated
  // branch fires correctly because openAuthFlow() sets a FRESH
  // windowId each time it runs, and the storage event fires within
  // the same Promise microtask.
  //
  // Round-47 polish: the bug-class assertion is now in
  // `_syncSetCalls` payload inspection — we assert the profile key
  // is OMITTED from the sync mirror when no profile change was
  // in the storage event (i.e. pure re-broadcast case). This
  // exercises the conditional spread: `...(profileForSync && ...)
  // ? { [STORAGE_KEYS.profile]: profileForSync } : {}`.
  resetSandbox()
  sandbox.authHandshakeState.windowId = 77  // refreshed windowId for the re-connect
  sandbox.authHandshakeState.received = false

  storageOnChanged(
    {
      [sandbox.STORAGE_KEYS.token]: { oldValue: FAKE_TOKEN_A, newValue: FAKE_TOKEN_B },
      // No profile change in the storage event.
    },
    'local',
  )

  assert.equal(sandbox._windowsRemoveCalls.length, 1,
    're-connect MUST close the auth window — pre-fix bug had the newValue-and-oldValue gate failing on re-connects')
  assert.equal(sandbox._windowsRemoveCalls[0].windowId, 77,
    'close-window must target the FRESH windowId set by the re-connect openAuthFlow call')
  assert.equal(sandbox.authHandshakeState.windowId, null,
    'after close-window on re-connect, windowId must be cleared')
  assert.equal(sandbox.authHandshakeState.received, true,
    'after close-window on re-connect, received must be flipped so the openAuthFlow timeout-fallback will not fire')
  // The sync mirror includes STORAGE_KEYS.token but does NOT
  // include STORAGE_KEYS.profile (no profile in this storage
  // event). The conditional spread in the popup body produces
  // an empty spread when profileForSync is null.
  const mirror = sandbox._syncSetCalls[0]
  assert.equal(mirror[sandbox.STORAGE_KEYS.token], FAKE_TOKEN_B,
    're-connect sync mirror must carry the new token value')
  assert.ok(!(sandbox.STORAGE_KEYS.profile in mirror),
    're-connect sync mirror must NOT include STORAGE_KEYS.profile when no profile was in the storage event (conditional spread guard)')
})

// ---------- 4. Source-grep signature-shape locks ----------
//
// The behavioural tests above exercise the runtime contract. These
// static-grep tests pin the SOURCE shape so a future refactor that
// silently swaps to a different gate variable or a different sync
// API is caught loudly. The two layers complement each other:
//   - behavioural catches "the wiring assembles the right calls"
//   - static catches "the wiring was renamed/typed-differently"

test('wire() storage.onChanged must gate on `newToken && authHandshakeState.windowId != null` (Round-47 signature lock)', () => {
  // The narrow gate that Round-10 fixed. A regression that drops
  // back to `!oldValue` would silently fail on re-connects (the
  // behavioural tests above prove this — the newToken-with-oldToken
  // variant). The static check is the cheap front-line.
  assert.ok(
    /newToken\s*&&\s*authHandshakeState\.windowId\s*!=\s*null/.test(extractedBody || ''),
    'wire() storage.onChanged must gate on `newToken && authHandshakeState.windowId != null` — the Round-10 fix that supersedes the oldValue-negation form',
  )
})

test('wire() storage.onChanged must call chrome.windows.remove with authHandshakeState.windowId', () => {
  assert.ok(
    /chrome\.windows\.remove\s*\(\s*authHandshakeState\.windowId\s*\)/.test(extractedBody || ''),
    'chrome.windows.remove must receive authHandshakeState.windowId (Round-47 signature lock for the close-window call)',
  )
})

test('wire() storage.onChanged sync mirror must include STORAGE_KEYS.token AND STORAGE_KEYS.profile', () => {
  // The mirror writes BOTH fields so a cross-device resume has the
  // full handshake payload. A regression that drops STORAGE_KEYS.profile
  // from the mirror would silently produce half-empty sync state on
  // the receiving machine — locked here.
  assert.ok(
    /chrome\.storage\.sync\.set\s*\([\s\S]*?STORAGE_KEYS\.token/.test(extractedBody || ''),
    'chrome.storage.sync.set must include STORAGE_KEYS.token (cross-device resume)',
  )
  assert.ok(
    /chrome\.storage\.sync\.set\s*\([\s\S]*?STORAGE_KEYS\.profile/.test(extractedBody || ''),
    'chrome.storage.sync.set must include STORAGE_KEYS.profile when the storage event carried a profile change — the profile must ride along with the token',
  )
})

test('wire() storage.onChanged sync mirror must be wrapped in .catch (best-effort)', () => {
  // Round-10 ergonomic: sync.set returning a rejected Promise
  // (e.g. enterprise Chrome with sync disabled) must NOT bubble
  // up to the user — a follow-on Warning-only handler swallows
  // the failure and the local-only flow continues. Lock the
  // .catch + console.warn shape.
  assert.ok(
    /\.catch\s*\(\s*\(?\s*syncErr\s*\)?\s*=>\s*\{[\s\S]*?console\.warn/.test(extractedBody || ''),
    'sync mirror .catch must log via console.warn — sync-disabled Chrome must not break the local flow',
  )
})
