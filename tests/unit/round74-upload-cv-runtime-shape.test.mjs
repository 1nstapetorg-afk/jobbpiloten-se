// tests/unit/round74-upload-cv-runtime-shape.test.mjs
//
// 2026-07-21 (Round-74 followup #3) — runtime-shape regression lock
// for /api/upload-cv. The user explicitly asked for "a runtime
// round-trip would catch any serialization drift" after my
// static parser lock (tests/unit/round74-urgent-issues.test.mjs)
// ran clean. Booting a full Next.js server + mocking MongoDB
// for a true integration test is significant infrastructure
// (out of scope for one round), but we can clone the strong
// guarantee by parsing each branch's `NextResponse.json(...)`
// argument via V8's parser AND scanning each body for the
// canonical key names.
//
// WHAT THIS FILE LOCKS:
//   \u2022 Success (happy path) \u2014 the NextResponse.json call returns
//     every canonical key (ok, cvText, cvFileName, cvFileSize,
//     cvTextChars, aiKeyConfigured, needsManualFallback,
//     cvTextPreserved). The softFailureResponse spread MUST NOT
//     add any keys in this branch (extractionSoftFailure=false).
//   \u2022 Soft-failure (extractionSoftFailure=true) \u2014 the response
//     STILL has every success key, plus the 4 softFailureResponse
//     keys (warning, fileType, fileSize, pdfUnparseable).
//   \u2022 AI-key warning (HAS_ANY_LLM_KEY=false) \u2014 the response
//     includes the `aiWarning` key (and NOT when HAS_ANY_LLM_KEY
//     is true).
//   \u2022 IMAGE_ONLY_PDF (Round-58) \u2014 returns 400 with code: 'IMAGE_ONLY_PDF'.
//   \u2022 TINY_PDF (Round-58/59) \u2014 returns 400 with code: 'TINY_PDF'.
//   \u2022 Fatal error (PASSWORD_PROTECTED / CORRUPT_DOCX) (NEW Lock 8)
//     \u2014 returns 400 with code discriminator + needsManualFallback: false.
//   \u2022 Outer catch fallthrough (NEW Lock 9) \u2014 returns 400 with
//     a top-level `error:` key.
//
// WHY `new Function` (not regex):
//   The pre-round-74 orphan-string bug was exactly the kind of
//   regression a regex would silently accept (a bare quoted
//   string in an object literal doesn't trip a single-pass regex
//   when the next line is unrelated). V8's parser is strict \u2014
//   any malformed shape throws SyntaxError. We invoke the
//   parser on each branch's isolated return body so future
//   refactors that break a single branch's syntax surface AS a
//   parse error. We do NOT call the factory \u2014 module-scope
//   identifiers (HAS_ANY_LLM_KEY, MAX_FILE_BYTES, etc.) would
//   throw ReferenceError at call time, and we never need the
//   live object for key-presence checks.
//
// WHY position-aware regex for key detection (NOT substrings):
//   `body.includes('key:')` false-positives on string-literal
//   values that contain a colon (e.g. `'warning: '` as a value
//   text). Position-aware regex `/(^|[,{:])\s*key\s*:/m` matches
//   only at structural boundaries (start-of-string, after `,`,
//   after `{` for nested objects, after `:` for ternary result),
//   which is correct for object-literal KEY position. This is
//   the strongest static key-detection without executing the
//   body.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(
  path.join(__dirname, '../..', 'app', 'api', 'upload-cv', 'route.js'),
  'utf8',
)

/**
 * Extract every `NextResponse.json({ ... }, { status: ... })`
 * call site's first argument (the body object literal) so each
 * branch can be parsed in isolation. Brace-counter correctly
 * handles nested object literals like the success-path's
 * `aiKeyConfigured: HAS_ANY_LLM_KEY ? {} : { aiWarning: '...' }`
 * ternary expression.
 *
 * ASSUMPTION: no template literals with `${...}` braces inside
 * the body \u2014 the brace counter would otherwise over-count.
 */
function extractAllNextResponseBodies(source) {
  const out = []
  const matches = [...source.matchAll(/return\s+NextResponse\.json\s*\(/g)]
  for (const m of matches) {
    const start = m.index + m[0].length
    let braceStart = -1
    for (let i = start; i < source.length; i++) {
      if (source[i] === '{') { braceStart = i; break }
      if (!/\s/.test(source[i])) break
    }
    if (braceStart < 0) continue
    let depth = 1
    let braceEnd = -1
    for (let i = braceStart + 1; i < source.length; i++) {
      const ch = source[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) { braceEnd = i; break }
      }
    }
    if (braceEnd < 0) continue
    out.push({
      body: source.slice(braceStart + 1, braceEnd),
      statusChunk: source.slice(braceEnd + 1, braceEnd + 121),
    })
  }
  return out
}

/**
 * parseOnly(body) \u2014 construct a Function object WITHOUT calling
 * it. We only need V8 to validate the AST; calling would throw
 * ReferenceError on module-scope identifiers (HAS_ANY_LLM_KEY,
 * MAX_FILE_BYTES, etc.).
 */
function parseOnly(body) {
  new Function(`return {${body}}`)
  return true
}

/**
 * hasKeyAtKeyPosition(body, key) \u2014 position-aware regex search
 * that returns true ONLY when `key:` appears at a structural
 * KEY-position boundary (start of body, after `,` or `{`).
 * Does NOT false-positive on string-literal values that
 * contain `<key>:`.
 *
 * The pattern `/(^|[,{])\s*<KEY>\s*:/m` matches KEY-position
 * because:
 *   - `^` is the start of the body string (top-level key).
 *   - `,` separates one key from the next at the same depth.
 *   - `{` precedes a key inside a nested object literal.
 * It deliberately rejects `'warning: '` as a string value
 * because the closing `'`, `"`, or backtick surrounding a
 * string key/value would not match `[,{]`.
 */
function hasKeyAtKeyPosition(body, key) {
  // Leading anchor `(^|[,:])` matches KEY-position boundaries:
  //   - `^` is start-of-line (top-level key at start of body)
  //   - `,` separates sibling keys at the same depth
  //   - `{` precedes a key inside a nested object literal
  //   - `:` precedes a key immediately after a ternary result like
  //     `condition ? {} : { key: value }`
  // Trailing anchor `(:|[,}]|$)` accepts BOTH classic key-value
  // pairs (`key: value`) AND ES6 property shorthand (`code,` /
  // `code}` / `code` at end-of-string). The fatal-error branch in
  // route.js uses `code,` shorthand — a strict `: ` tail would
  // miss it AND incorrectly suggest the body has no `code` key.
  // Optional `['"]?` quotes accept quoted-key shapes (rare in
  // JSON-route bodies but harmless).
  const re = new RegExp(
    `(^|[,:])\\s*(?:['"]?)${key}(?:['"]?)\\s*(:|[,}]|$)`,
    'm',
  )
  return re.test(body)
}

// =====================================================================
// Lock 1 \u2014 every NextResponse.json return-statement parses cleanly
// via V8 (catches orphan bare strings + malformed anchors).
// =====================================================================

test('Lock 1: every NextResponse.json body in route.js parses cleanly via V8', () => {
  const bodies = extractAllNextResponseBodies(SRC)
  assert.ok(bodies.length >= 4, `expected at least 4 NextResponse.json return sites, found ${bodies.length}`)
  for (const { body } of bodies) {
    let parseErr = null
    try {
      parseOnly(body)
    } catch (e) {
      parseErr = e
    }
    assert.equal(
      parseErr, null,
      `NextResponse.json body must parse cleanly \u2014 orphan bare strings or malformed anchors throw V8 SyntaxError.\n\nParse error: ${parseErr && parseErr.message}\n\nBody:\n${body}`,
    )
  }
})

// =====================================================================
// Lock 2 \u2014 success-path returns the canonical key set WITHOUT the
// softFailureResponse spread (extractionSoftFailure=false).
//
// Anchor: signature match \u2014 the success-path body has BOTH
// `ok:` AND `aiKeyConfigured:` substrings. The LAST
// NextResponse.json call is the OUTER catch fallthrough
// `{ error: ... }, { status: 400 }` \u2014 NOT success.
// =====================================================================

test('Lock 2: success-path response has canonical 8 keys (no softFailureResponse spread)', () => {
  const bodies = extractAllNextResponseBodies(SRC)
  assert.ok(bodies.length >= 4, `expected at least 4 NextResponse.json return sites, found ${bodies.length}`)
  const successBody = bodies.find(({ body }) =>
    /\bok:\s*true\b/.test(body) && /\baiKeyConfigured\b/.test(body),
  )
  assert.ok(
    successBody,
    'a NextResponse.json body with `ok: true` + `aiKeyConfigured` substring co-occurrence is the Round-74 success-path anchor',
  )
  parseOnly(successBody.body)
  for (const canonical of ['ok', 'cvText', 'cvFileName', 'cvFileSize', 'cvTextChars', 'aiKeyConfigured', 'needsManualFallback', 'cvTextPreserved']) {
    assert.ok(
      hasKeyAtKeyPosition(successBody.body, canonical),
      `success-path response must include key "${canonical}" at a KEY position. Got body:\n${successBody.body}`,
    )
  }
  // Round-74: when extractionSoftFailure=false, the spread
  // ...softFailureResponse resolves to {} so no soft-failure
  // keys leak into the success response. Conditional-spread
  // branches (`...(HAS_ANY_LLM_KEY ? {} : { aiWarning: ... })`,\n  // `...(extractionSoftFailure ? {...} : {})`) don't introduce
  // unconditional keys in the false-branch, so the success path's
  // static key set is exactly the canonical 8 + aiWarning (in the\n  // HAS_ANY_LLM_KEY=false case).
  for (const softKey of ['warning', 'fileType', 'fileSize', 'pdfUnparseable']) {
    assert.ok(
      !hasKeyAtKeyPosition(successBody.body, softKey),
      `success-path response must NOT include soft-failure key "${softKey}" when extractionSoftFailure=false.`,
    )
  }
})

// =====================================================================
// Lock 3 \u2014 softFailureResponse has its 4 named keys (warning,
// fileType, fileSize, pdfUnparseable).
// =====================================================================

test('Lock 3: softFailureResponse object literal body parses + has 4 key names', () => {
  const match = SRC.match(
    /const\s+softFailureResponse\s*=\s*extractionSoftFailure\s*\n\s*\?\s*\{([\s\S]*?)\}\s*\n\s*:\s*\{\}/m,
  )
  assert.ok(match, 'softFailureResponse must exist in the source')
  const body = match[1]
  parseOnly(body)
  for (const k of ['warning', 'fileType', 'fileSize', 'pdfUnparseable']) {
    assert.ok(
      hasKeyAtKeyPosition(body, k),
      `softFailureResponse must include key "${k}" at a KEY position.\n\nBody:\n${body}`,
    )
  }
})

// =====================================================================
// Lock 4 \u2014 Round-58 IMAGE_ONLY_PDF branch.
// =====================================================================

test('Lock 4: IMAGE_ONLY_PDF branch parses + has status 400 + contract keys', () => {
  // Anchor on the unique Swedish marker: 'PDF:en verkar vara inskannad'.
  // This substring appears exactly once in the file (in the
  // IMAGE_ONLY_PDF error message) so we have a precise anchor.
  // IMPORTANT: slice from `return NextResponse.json(` (not from
  // the substring 'NextResponse.json' which sits MID-LINE) so the
  // FIRST body extractAllNextResponseBodies finds is the branch's
  // own return, not the next one down.
  const marker = 'PDF:en verkar vara inskannad'
  const markerIdx = SRC.indexOf(marker)
  assert.ok(markerIdx >= 0, 'IMAGE_ONLY_PDF marker must be present in route.js')
  const returnMatches = [...SRC.matchAll(/return\s+NextResponse\.json\s*\(/g)]
  // The marker `'PDF:en verkar vara inskannad'` is the error-MESSAGE
  // STRING inside the IMAGE_ONLY_PDF body's `error:` value — i.e.
  // it's INSIDE the body of the branch's own return statement, not
  // BEFORE it. The FIRST return AFTER the marker is the SUCCESS path
  // (further down in route.js), not the IMAGE_ONLY_PDF branch. Find
  // the LAST return whose position is BEFORE the marker — that's
  // the return whose body LITERALLY contains the marker text.
  const returnBeforeMarker = [...returnMatches].reverse().find((m) => m.index < markerIdx)
  assert.ok(
    returnBeforeMarker,
    'IMAGE_ONLY_PDF marker must be inside the body of some `return NextResponse.json(...)` upstream — search BACKWARDS from the marker.',
  )
  const bodies = extractAllNextResponseBodies(SRC.slice(returnBeforeMarker.index))
  const imageOnlyBody = bodies[0]
  assert.ok(imageOnlyBody, 'IMAGE_ONLY_PDF body must be parseable')
  parseOnly(imageOnlyBody.body)
  for (const canonical of ['error', 'needsManualFallback', 'code', 'reason']) {
    assert.ok(
      hasKeyAtKeyPosition(imageOnlyBody.body, canonical),
      `IMAGE_ONLY_PDF body must include key "${canonical}" at a KEY position.\n\nBody:\n${imageOnlyBody.body}`,
    )
  }
  assert.ok(
    /['"]IMAGE_ONLY_PDF['"]/.test(imageOnlyBody.body),
    "IMAGE_ONLY_PDF body's `code` key must be the literal string 'IMAGE_ONLY_PDF'.",
  )
  assert.match(imageOnlyBody.statusChunk, /status:\s*400/, 'IMAGE_ONLY_PDF must return status 400')
})

// =====================================================================
// Lock 5 \u2014 Round-58/59 TINY_PDF branch.
// =====================================================================

test('Lock 5: TINY_PDF branch parses + has status 400 + contract keys', () => {
  const marker = 'f\u00f6r liten eller tom'
  const markerIdx = SRC.indexOf(marker)
  assert.ok(markerIdx >= 0, 'TINY_PDF marker must be present in route.js')
  const nextResponseIdx = SRC.indexOf('NextResponse.json', markerIdx)
  assert.ok(nextResponseIdx > markerIdx, 'TINY_PDF branch must be returned via NextResponse.json')
  const bodies = extractAllNextResponseBodies(SRC.slice(nextResponseIdx))
  const tinyBody = bodies[0]
  assert.ok(tinyBody, 'TINY_PDF body must be parseable')
  parseOnly(tinyBody.body)
  for (const canonical of ['error', 'needsManualFallback', 'code']) {
    assert.ok(
      hasKeyAtKeyPosition(tinyBody.body, canonical),
      `TINY_PDF body must include key "${canonical}" at a KEY position.\n\nBody:\n${tinyBody.body}`,
    )
  }
  assert.ok(/['"]TINY_PDF['"]/.test(tinyBody.body), "TINY_PDF body's `code` key must be the literal string 'TINY_PDF'.")
  assert.match(tinyBody.statusChunk, /status:\s*400/, 'TINY_PDF must return status 400')
})

// =====================================================================
// Lock 6 \u2014 JSON-unsafe constructs guard.
//
// Earlier versions invoked the Function and called factory() to
// run JSON.stringify across the parsed body. That EXECUTION
// failed for module-scope identifiers (MAX_FILE_BYTES,
// HAS_ANY_LLM_KEY, etc.) because the Function constructor
// doesn't have access to module scope.
//
// This lock is SOURCE-PATTERN based. It catches:
//   (a) Constructs that JSON.stringify would drop silently
//       (Promise, Symbol, Map, WeakMap, Set, BigInt, fetch,
//       arrow functions, function declarations, class
//       declarations).
//   (b) Constructs that would throw at runtime because they
//       reference module-scope identifiers or import APIs not
//       available inside a Function body (process.env, require,
//       import()).
//
// If a future route adds ANY of these, the test refuses
// silently-dropping data drift without executing the body.
// =====================================================================

test('Lock 6: every NextResponse.json body avoids JSON-unsafe + module-scope constructs', () => {
  const bodies = extractAllNextResponseBodies(SRC)
  assert.ok(bodies.length >= 4, `expected at least 4 NextResponse.json return sites, found ${bodies.length}`)
  const unsafePatterns = [
    { pattern: /\bPromise\b/, name: 'Promise' },
    { pattern: /\bSymbol\s*\(/, name: 'Symbol(' },
    { pattern: /\bnew\s+Map\b/, name: 'new Map' },
    { pattern: /\bnew\s+WeakMap\b/, name: 'new WeakMap' },
    { pattern: /\bnew\s+Set\b/, name: 'new Set' },
    { pattern: /\bBigInt\s*\(/, name: 'BigInt(' },
    { pattern: /\bfetch\s*\(/, name: 'fetch(' },
    { pattern: /\bawait\s+fetch\b/, name: 'await fetch' },
    { pattern: /\([^)]*\)\s*=>/, name: 'arrow function expression (...params => ...)' },
    { pattern: /\bfunction\s+[a-zA-Z_$]/, name: 'function declaration' },
    { pattern: /\bclass\s+[A-Z]/, name: 'class declaration' },
    { pattern: /\bprocess\.env\.(?!NODE_ENV\b|NEXT_PUBLIC_)\w+/, name: 'process.env.X (non-NODE_ENV + non-NEXT_PUBLIC_ — leaks secret at build-time)' },
    { pattern: /\brequire\s*\(/, name: 'require()' },
    { pattern: /\bimport\s*\(/, name: 'import()' },
  ]
  for (const { body } of bodies) {
    for (const { pattern, name } of unsafePatterns) {
      assert.ok(
        !pattern.test(body),
        `NextResponse.json body must not contain construct "${name}" \u2014 either JSON.stringify drops it silently OR it throws at runtime via Function-scope lookup.\n\nBody:\n${body}`,
      )
    }
  }
})

// =====================================================================
// Lock 8 \u2014 Fatal-error branch (PASSWORD_PROTECTED / CORRUPT_DOCX).
// These MUST return 400 with code discriminator + readable
// Swedish `error:` text + needsManualFallback: false (the file
// ISN'T saved in this branch).
// =====================================================================

test('Lock 8: fatal-error branch (PASSWORD_PROTECTED / CORRUPT_DOCX) parses + has 400 + code + error', () => {
  // Anchor on `isFatal`: the ONLY return path with status 400 +
  // `code` that uses the fatal-error discriminator. Slice from
  // there forward to find the body's NextResponse.json.
  const marker = 'const isFatal = code === '
  const markerIdx = SRC.indexOf(marker)
  assert.ok(markerIdx >= 0, 'fatal-error branch marker must be present in route.js')
  const sliceFrom = SRC.indexOf('return NextResponse.json', markerIdx)
  assert.ok(sliceFrom > markerIdx, 'fatal-error branch must be returned via NextResponse.json')
  const bodies = extractAllNextResponseBodies(SRC.slice(sliceFrom))
  const fatalBody = bodies[0]
  assert.ok(fatalBody, 'fatal-error body must be parseable')
  parseOnly(fatalBody.body)
  for (const canonical of ['error', 'code', 'needsManualFallback']) {
    assert.ok(
      hasKeyAtKeyPosition(fatalBody.body, canonical),
      `fatal-error body must include key "${canonical}" at a KEY position.\n\nBody:\n${fatalBody.body}`,
    )
  }
  // For fatal errors route.js uses TWO distinct code paths:
  //   (a) `error: e.message` — surfaces the thrown exception's
  //       message verbatim so the UI shows what actually went wrong.
  //   (b) `code` ES6 shorthand — uses the OUTER `code` variable
  //       captured earlier in the function (PASSWORD_PROTECTED,
  //       CORRUPT_DOCX) as the discriminator. The shorthand
  //       shape (no colon, just `code,`) hides the value source.
  // Lock: assert (a) the body actually surfaces `e.message` (so the
  // thrown text reaches the user) and (b) `code` is shorthand
  // (positive lookahead for `,` or `}` after the key) so a future
  // refactor doesn't silently switch to a hardcoded literal.
  assert.match(fatalBody.body, /error:\s*e\.message/, 'fatal-error body must surface `error: e.message` so the thrown text reaches the user.')
  assert.match(fatalBody.body, /\bcode\s*(?=,|\s*\})/, 'fatal-error body must use ES6 `code,` shorthand (the outer `code` variable carries the discriminator).')
  // needsManualFallback: false is INSIDE the body (not the status
  // block) — verify on body. The status block is just
  // `{ status: 400 }`; the boolean flag lives alongside error +
  // code + needsManualFallback in the FIRST argument to
  // NextResponse.json.
  assert.match(fatalBody.body, /needsManualFallback:\s*false/, 'fatal-error body must set needsManualFallback: false (file ISN\\u0027T saved in this branch).')
  assert.match(fatalBody.statusChunk, /status:\s*400/, 'fatal-error must return status 400')
})

// =====================================================================
// Lock 9 \u2014 Outer catch fallthrough \u2014 returns 400 with a
// category-discriminator-free `error:` text. This is the "outer
// safety net" that surfaces a Mongo blip, a non-categorised
// extraction throw, or any unanticipated failure. The lock
// ensures it parses + has the right shape.
// =====================================================================

test('Lock 9: outer catch fallthrough parses + has 400 + error key', () => {
  // Anchor on the LAST \u0060catch (\u0060 LITERAL since nested catch
  // blocks come BEFORE the outer catch in source order. Robust to
  // refactors that ADD new return statements after the catch
  // (which would break a brittle LAST-`return NextResponse.json`
  // anchor): adding a new return does NOT introduce a new catch
  // block.
  // Documented limitations:
  //   - Misses ES2019 \u0060catch { \u0060 optional-binding form
  //     (not used in route.js, would only break if refactored).
  //   - If a JSDoc-style \u0060@example catch (e) {\u0060 comment
  //     precedes a return, comment-text could match. route.js has
  //     no JSDoc near the outer catch so this is hypothetical.
  const catchMatches = [...SRC.matchAll(/catch\s*\(\s*\w+\s*\)\s*\{/g)]
  assert.ok(catchMatches.length >= 1, 'expected at least one catch block in route.js')
  const lastCatchIdx = catchMatches[catchMatches.length - 1].index
  const sliceFrom = SRC.indexOf('return NextResponse.json', lastCatchIdx)
  assert.ok(
    sliceFrom > lastCatchIdx,
    'outer catch block must contain a return NextResponse.json(...) after its closing brace.',
  )
  const bodies = extractAllNextResponseBodies(SRC.slice(sliceFrom))
  const catchBody = bodies[0]
  assert.ok(catchBody, 'outer catch body must be parseable')
  parseOnly(catchBody.body)
  for (const canonical of ['error']) {
    assert.ok(
      hasKeyAtKeyPosition(catchBody.body, canonical),
      `outer catch body must include key "${canonical}" at a KEY position.\n\nBody:\n${catchBody.body}`,
    )
  }
  assert.match(catchBody.statusChunk, /status:\s*400/, 'outer catch must return status 400')
})
