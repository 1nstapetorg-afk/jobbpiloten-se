// tests/unit/lib/js-source-helpers.mjs
//
// Round-48 — SHARED JS-SOURCE-AWARE BRACE-STRING-COMMENT HELPERS.
//
// Before this module existed, three test files independently
// re-implemented the SAME brace-counting-with-string-skip logic:
//
//   1. tests/unit/popup-handshake.test.mjs   (Naive counter — no string/comment skip)
//   2. tests/unit/popup-resolver.test.mjs   (Full feature set w/ template `${...}` interpolation recursion)
//   3. tests/unit/extension-popup-vm.test.mjs (Full feature set w/ regex-literal lookbehind skip)
//
// Three divergent copies invited drift (different naming, different
// return semantics). Round-48 consolidates them into one shared module
// so a fix to the skip-loop (e.g. handle a JSX-like syntax or new
// escape sequence) automatically applies to all three sites.
//
// PUBLIC API:
//   - findBalancedBraceEnd(source, openIdx)
//       Walks forward from `openIdx` (the position of the opening `{`)
//       counting braces, skipping strings + comments + regex literals.
//       Returns the index of the matching closing `}`, or -1 if no
//       match before EOF.
//
//   - nextNonStringOrComment(source, i)
//       Advances `i` past any string literal (single, double, template),
//       line comment, block comment, or (escaped) regex-delimiter.
//       Returns the index of the first non-skipped char, or
//       source.length on EOF.
//
//   - skipString(source, i, quote)
//       Walks forward from the opening quote at `i`, past escapes,
//       and returns the index AFTER the closing quote. Template
//       literals additionally recurse through `${...}` interpolations
//       so a `}` inside `${ {a:1} }` doesn't confuse the outer
//       brace counter.
//
//   - sliceFunctionBody(source, name)
//       Returns the substring from the `function NAME` (or `async
//       function NAME`) signature UP TO AND INCLUDING the matching
//       closing `}`. Useful for source-grep tests that need the
//       full function declaration as a single slice.
//
//   - extractArrowBodyContent(src, anchorIdx)
//       Walks forward from `anchorIdx` looking for `=>` then the
//       arrow body's opening `{`. Returns the CONTENT between that
//       brace and the matching closing `}` (NOT including the
//       outer braces). Useful for vm-test IIFE embedding where the
//       body is interpolated into a `function NAME() { ${body} }`
//       template literal.
//
//   - extractStorageOnChangedBodyInWire(src)
//       Convenience for the wire() chrome.storage.onChanged.addListener
//       callback body. Anchors on `function wire()` first to
//       disambiguate from the unrelated listener in setupComposePanel().
//       Returns content only (same shape as extractArrowBodyContent).
//
// Run via `yarn test:unit` (imported by the 3 dependent test files).
// No tests in THIS file (it is pure infrastructure; the dependents
// are the contract locks).

// ---------- 1. String literal skip ----------
//
// Walks forward through a string literal starting at the opening
// quote (i is the position OF the opening quote), past `\`-escapes,
// returns index AFTER the closing quote. Template literals
// (`...`) additionally recurse through `${...}` interpolations so
// a `}` inside `${ {a:1} }` doesn't confuse the outer brace
// counter (without recursion, `${ {a:1} }` would wrongly count the
// `}` at the end of the inner block as the function's closing
// brace — a silent off-by-one for every template literal with an
// expression).
function skipString(source, i, quote) {
  i++ // skip opening quote
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') {
      // Skip escape pair (\n, \", \\, etc.). Index-out-of-bounds
      // gracefully degrades to source.length on a trailing `\`.
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

// ---------- 2. String/comment/regex skip-from-position ----------
//
// Advances `i` past any string literal, line comment, block
// comment, or (escaped) regex-delimiter that starts at `i`.
// Returns the index of the first non-skipped char, or source.length
// on EOF. This is the LOWEST-LEVEL skip and is what the brace
// counter calls at each loop iteration.
//
// The regex-literal lookbehind (source[i-1] !== '\\') is critical:
// popup.js's saveDashboardUrl scheme validator contains the regex
// `/^https?:\/\//` which ends with a literal `\/` escape followed
// by the regex-terminating `/`. Without the lookbehind, the trailing
// `//` would be misread as line-comment start, the next EOL skipto
// would silently consume the opening `{` of the surrounding `if`
// block, and the brace counter depth would never increment — so
// the body slice would truncate midway.
function nextNonStringOrComment(source, i) {
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

// ---------- 3. Balanced-brace finder ----------
//
// Walks forward from `openIdx` (the position OF the opening `{`)
// counting braces with `0`-init depth. After each character read,
// calls nextNonStringOrComment() to skip past any string/comment/
// regex spans. Returns the position of the matching closing `}`,
// or -1 if no match before EOF.
//
// The TOP-PLACEMENT of the skip-call inside the loop is critical:
// placing it at the loop BOTTOM with a normal char would return
// the SAME `i` (because normal chars don't trigger any skip), and
// the loop top would re-read the same char — INFINITE LOOP.
// Top-placement keeps the trace correct AND ensures i always
// advances.
function findBalancedBraceEnd(source, openIdx) {
  let depth = 0
  let i = openIdx
  while (i < source.length) {
    i = nextNonStringOrComment(source, i)
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

// ---------- 4. Function-body slicer (full block, name-anchored) ----------
//
// Returns the substring from the `function NAME` (or `async function
// NAME`) signature UP TO AND INCLUDING the matching closing `}`.
// Useful for source-grep tests that need the whole function as a
// single slice (e.g. body.search(...) for ordering assertions).
//
// Two signatures (sync `function NAME(` AND `async function NAME`)
// are looked up; the smaller offset wins so an `async` declaration
// isn't accidentally matched as a plain `function` inside a
// containing string.
function sliceFunctionBody(source, name) {
  const sigAsync = `async function ${name}`
  const sigPlain = `function ${name}(`
  const idxAsync = source.indexOf(sigAsync)
  const idxPlain = source.indexOf(sigPlain)
  const candidates = [idxAsync, idxPlain].filter((n) => n >= 0)
  if (candidates.length === 0) return null
  const start = Math.min(...candidates)
  // Phase 1 — find the opening `{` (skipping strings/comments in
  // case the signature is inside a JSDoc type `{a:1}`).
  let i = start
  while (i < source.length) {
    const ch = source[i]
    if (ch === '{') break
    i = nextNonStringOrComment(source, i + 1)
    if (i >= source.length) return null
  }
  if (i >= source.length || source[i] !== '{') return null
  // Phase 2 — balance-count to the matching closing `}`.
  const closeIdx = findBalancedBraceEnd(source, i)
  if (closeIdx < 0) return null
  return source.slice(start, closeIdx + 1)
}

// ---------- 5. Arrow-body content extractor ----------
//
// Given `anchorIdx` (the position of a `addEventListener(` call or
// other anchor BEFORE the `=>` of an arrow callback), walks forward
// to the first `=>` after the anchor, then the first `{` after the
// `=>`, then returns the CONTENT between that brace and its matching
// closing `}`. The returned content does NOT include the outer
// braces — this is the form the vm-test IIFE template wants, where
// `${body}` is substituted into `function NAME(args) { ${body} }`.
//
// If a `(`/`)` is between `=>` and `{` (e.g. `{ arrow => ({...}) }`),
// the helper falls through to the `{` AFTER the parent's depth
// decrements — useful for trivial arrow identities.
// Returns null on no match before EOF.
function extractArrowBodyContent(src, anchorIdx) {
  const arrowIdx = src.indexOf('=>', anchorIdx)
  if (arrowIdx < 0) return null
  const braceOpen = src.indexOf('{', arrowIdx)
  if (braceOpen < 0) return null
  const braceClose = findBalancedBraceEnd(src, braceOpen)
  if (braceClose < 0) return null
  return src.slice(braceOpen + 1, braceClose)
}

// ---------- 6. Wire()-anchored storage.onChanged callback extractor ----------
//
// Convenience for the popup.js wire() `chrome.storage.onChanged
// .addListener(callback)` callback body. Anchors on `function wire()`
// first because popup.js has TWO chrome.storage.onChanged listeners
// — one in `wire()` (the auth-bridge close + sync-mirror logic) and
// one in `setupComposePanel()` (a 3-line email-compose re-render
// listener). Without the wire() anchor, the helper would return
// the compose panel's body, which doesn't reference the auth
// machinery at all.
//
// Returns content only (same shape as extractArrowBodyContent).
function extractStorageOnChangedBodyInWire(src) {
  const wireIdx = findFunctionOffset(src, 'wire')
  if (wireIdx < 0) return null
  const markerIdx = src.indexOf('chrome.storage.onChanged.addListener(', wireIdx)
  if (markerIdx < 0) return null
  return extractArrowBodyContent(src, markerIdx)
}

// ---------- 7. Dual-shape function locator (findFunctionOffset) ----------
//
// Round-75 (2026-07-20) — rename from
// `findAsyncOrSyncFunction` per reviewer feedback: the previous
// name suggested it returned the function itself, but the
// actual return is a byte offset (or -1 if neither shape is
// present). The renamed surface makes the byte-offset return
// explicit so callers don't accidentally treat -1 as a valid
// empty result.
//
// Round-74.2 (2026-07-20) — generalize the
// `Math.max(indexOf('function NAME()'), indexOf('async function NAME()'))`
// sentinel pattern that lived inline at popup-handshake.test.mjs:100
// into a shared helper. Test fixtures that lock against a function
// declaration by literal sentinel now use `findFunctionOffset`
// and stay agnostic to whether the source declares the function as
// `function NAME()` (sync) or `async function NAME()` (Round-74
// promoted `setStatus` + `wire` to async because their bodies
// contained `await` calls that needed an async scope).
//
// Returns the byte offset of the EARLIER-OF-THE-TWO matches (or
// -1 if neither match is present). The Math.max form was chosen
// over Math.min because the offset is later used as the START
// point of a balanced-brace slice — both shapes need the same
// starting position to anchor `sliceFunctionBody` or
// `extractStorageOnChangedBodyInWire` consistently.
//
// Match logic:
//   • `function NAME()`   — sync declaration (no async prefix)
//   • `async function NAME()` — async declaration
//   • `Math.max(-1, n) === n` — when only one shape is present,
//     the result collapses to that shape's offset. When neither
//     is present, Math.max(-1, -1) === -1 is our explicit
//     not-found sentinel so callers can short-circuit on the
//     same exact value (vs. an empty slice).
function findFunctionOffset(source, name) {
  return Math.max(
    source.indexOf(`function ${name}()`),
    source.indexOf(`async function ${name}()`),
  )
}

export {
  findBalancedBraceEnd,
  findFunctionOffset,
  nextNonStringOrComment,
  skipString,
  sliceFunctionBody,
  extractArrowBodyContent,
  extractStorageOnChangedBodyInWire,
}
