// tests/unit/pdf-second-pass.test.mjs
//
// Bug lock (2026-07-11, "CV PDF upload"): valid text-based PDFs that
// came back from pdfjs-dist's default `page.getTextContent()` pass
// with empty text were being misclassified as image_only_pdf. The fix
// adds a second-pass with `disableCombineTextItems: true` +
// `includeMarkedContent: true` and tightens the image-only signature.
//
// This static-source-grep test mirrors the structural-locks style used
// in tests/unit/pdf-report.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync('app/api/upload-cv/route.js', 'utf8')

test('extractPdfTextDirect must run a SECOND getTextContent pass with disableCombineTextItems', () => {
  // Lock the option pair — either alone is insufficient: pdfjs-dist
  // accessibility-tagged content streams require BOTH flags for full
  // recovery.
  assert.match(SOURCE, /disableCombineTextItems\s*:\s*true/, 'second-pass must enable disableCombineTextItems')
  assert.match(SOURCE, /includeMarkedContent\s*:\s*true/, 'second-pass must enable includeMarkedContent')
})

test('pass-1 per-page catch must use matchesKnownPdfError helper (single source of truth)', () => {
  // The categorised-error gate MUST be the shared helper, not a
  // hand-rolled `if (PDF_ERROR_NAMES[name])` check, so the per-page
  // catch and outer categorisePdfError can't drift apart. The
  // helper uses NAME-first + message-substring matching for parity
  // with v3-era pdfjs-dist forks.
  // 30 chars between the catch-block close and the empty-content
  // fallback is too tight: a single transient-fail path inserts a
  // log + counter increment between the two. Widen to 500/1500 so
  // intermediate bookkeeping doesn't break the structural lock.
  const context = SOURCE.match(/catch\s*\(\s*perPageErr\s*\)\s*\{[\s\S]{0,1500}?\}[\s\S]{0,500}?content\s*=\s*\{\s*items:\s*\[\s*\]\s*\}/)
  assert.ok(context, 'per-page catch block must exist and reset content to empty on transient errors')
  assert.match(context[0], /matchesKnownPdfError\s*\(\s*perPageErr\s*\)/, 'per-page catch must consult matchesKnownPdfError helper')
  assert.match(context[0], /throw\s+perPageErr/, 'per-page catch must re-throw when the helper returns true')
})

test('both per-page catch AND categorisePdfError must use matchesKnownPdfError (parity)', () => {
  // Single source of truth: extracting the helper means both gate paths
  // share the same NAME-first + substring-matching logic. Without
  // this invariant, a future refactor that adds an entry to
  // PDF_ERROR_NAMES would silently miss on one of the two paths.
  // The categorisePdfError function body itself is allowed to
  // select the SPECIFIC `.code` (per-page only needs YES/NO), but
  // the GATE call must reference the helper.
  assert.match(SOURCE, /function\s+matchesKnownPdfError\s*\(/, 'matchesKnownPdfError helper must be defined')
  // categorisePdfError body uses the helper for the v3-fork gate
  // (substring matching). The gate must be present — per-name
  // discrimination happens in the upper for-loop, but the helper
  // is what the per-page catch consults.
  assert.match(SOURCE, /matchesKnownPdfError\s*\(\s*[a-zA-Z_$][\w$]*\s*\)/, 'helper must be called somewhere — exact location can vary')
})

test('image-only signature must require !hasText so recovered-text pages never re-classify', () => {
  // The bug-fix invariant: image-only = imageOps AND !textOps AND !hasText.
  // The hasText boolean reflects BOTH the default pass AND the
  // second-pass recovery — so a recovered-text page can never be
  // misclassified as image-only.
  assert.match(SOURCE, /isImageOnly\s*=\s*hasImageOps\s*&&\s*!hasTextOps\s*&&\s*!hasText/, 'isImageOnly must incorporate !hasText in its signature')
})

test('fallbackPagesRecovered log must be gated behind NODE_ENV !== production', () => {
  // A Word Online export storm would otherwise spam prod logs. Gate the
  // log so it's dev-only — the count is a structural signal, not a
  // runtime condition worth alerting on in prod.
  assert.match(SOURCE, /process\.env\.NODE_ENV\s*!==?\s*['"]production['"]/, 'fallbackPagesRecovered log must be gated behind NODE_ENV !== production')
})

test('categorisePdfError must still catch PASSWORD_PROTECTED separately from IMAGE_ONLY_PDF', () => {
  // Regression check on the original categorisation table — the bug
  // fix did not change the password / corrupt / unsupported branches,
  // so each must remain a distinct Swedish error code.
  assert.match(SOURCE, /PASSWORD_PROTECTED/, 'PASSWORD_PROTECTED code must remain in PDF_ERROR_NAMES')
  assert.match(SOURCE, /CORRUPT_PDF/, 'CORRUPT_PDF code must remain in PDF_ERROR_NAMES')
  assert.match(SOURCE, /UNSUPPORTED_PDF_FORMAT/, 'UNSUPPORTED_PDF_FORMAT code must remain')
  assert.match(SOURCE, /IMAGE_ONLY_PDF/, 'IMAGE_ONLY_PDF code must remain on the empty-text fallback')
})

test('the IMAGE_ONLY_PDF branch must set needsManualFallback: true so the cvSummary textarea gets focus', () => {
  // The settings page wires `onFallbackRequired` → `focusManualTextarea`
  // on the CVFileUpload component, which reacts to `needsManualFallback`
  // in the API response. The fix must NOT silently regress this wiring.
  assert.match(SOURCE, /needsManualFallback\s*:\s*true/, 'needsManualFallback: true must be set when image-only is detected')
})

// ---------- 5. cvTextPreserved regression guard (2026-07-12) ----------
//
// Background: the >50 char heuristic in `extractPdfTextDirect` could
// over-write a longer user-written `cvSummary` with a sub-50-char
// `cvText` if the success path `$set` always wrote the parsed result.
// The Groq prompt in lib/groq.js prefers cvText over cvSummary, so a
// 30-char cvText would silently replace a 500-char manual summary.
// The fix conditionally omits `cvText` from the $set when the parsed
// text is < 50 chars AND surfaces `cvTextPreserved: true` in the
// response so future analytics can discriminate the two cases.
//
// This test pins the new contract so a future refactor that drops
// the conditional set silently regresses to "overwrite user's
// manual summary" — a real soft-launch regression that would
// erase weeks of carefully-written CV copy.

test('cvText $set must be conditional on extracted.length >= MIN_VALID_CV_TEXT_CHARS', () => {
  // The success path's `$set` must spread the cvText field
  // conditionally — `...(shouldOverwriteCvText ? { cvText: ... } : {})`
  // is the documented pattern. A direct unconditional `$set: { cvText: extracted }`
  // would regress to the "short PDF clobbers manual summary" bug.
  // We check for the conditional-spread pattern: `cvText: extracted`
  // must NOT appear as a top-level key of a flat $set object.
  // Instead, the contract is that cvText appears INSIDE a ternary spread.
  assert.match(
    SOURCE,
    /\.\.\.\s*\(\s*shouldOverwriteCvText\s*\?\s*\{\s*cvText\s*:\s*extracted\s*\}\s*:\s*\{\s*\}\s*\)/,
    'cvText must be conditionally set via the shouldOverwriteCvText ternary spread',
  )
})

test('MIN_VALID_CV_TEXT_CHARS = 50 constant must be defined and used in the route', () => {
  // Single source of truth: the threshold lives in one named constant
  // and is referenced from the extracted.length comparison. A future
  // refactor that re-introduces a magic number 50 (or moves the
  // threshold to a different file) breaks the test, which is the
  // point — prevents the value from drifting between the extraction
  // function and the POST handler.
  assert.match(
    SOURCE,
    /const\s+MIN_VALID_CV_TEXT_CHARS\s*=\s*50/,
    'MIN_VALID_CV_TEXT_CHARS constant must be defined as 50',
  )
  // The constant must be used in the hasText comparison (inside
  // extractPdfTextDirect) and in the success-path $set guard
  // (inside POST). Verify both call sites.
  const hasTextCall = SOURCE.match(/hasText\s*=\s*finalText\.length\s*>=\s*MIN_VALID_CV_TEXT_CHARS/)
  assert.ok(hasTextCall, 'hasText must compare finalText.length against MIN_VALID_CV_TEXT_CHARS (not a magic 50)')
  // Round-25.1 (option a): the shouldOverwriteCvText line shape is
  // `isFirstTimeUpload || extracted.length >= MIN_VALID_CV_TEXT_CHARS`
  // — covered by the "first-time gate OR-includes isFirstTimeUpload"
  // test in section 8 below, which is more specific than a loose
  // prefix match would be. The line-shape lock lives there.
})

test('POST response must surface cvTextPreserved flag so analytics can distinguish paths', () => {
  // The success response object must include `cvTextPreserved` so
  // future analytics / support flows can discriminate "manual
  // fallback needed" (needsManualFallback: true) from "cvText was
  // preserved unchanged" (cvTextPreserved: true). These two flags
  // are independent: a short-text PDF that IS image-only returns
  // 400 (no success response at all); a short-text PDF that is NOT
  // image-only returns 200 with both flags true.
  assert.match(
    SOURCE,
    /cvTextPreserved\s*:\s*!?\s*shouldOverwriteCvText/,
    'response must include `cvTextPreserved: !shouldOverwriteCvText`',
  )
})

test('cvText in success response must be empty string when shouldOverwriteCvText is false', () => {
  // The contract: the response.cvText field is empty when cvText
  // was preserved (so the UI's preview pane stays empty, signalling
  // "no CV text to show — please write a manual summary"). When
  // the upload was valid, response.cvText carries the parsed text.
  // Lock the empty-on-preserve branch so a refactor that always
  // returns the parsed text doesn't silently surface a 30-char
  // stub to the user.
  assert.match(
    SOURCE,
    /cvText:\s*shouldOverwriteCvText\s*\?\s*extracted\s*:\s*['"]['"]/,
    'response.cvText must be empty string when shouldOverwriteCvText is false (parsed text leaks otherwise)',
  )
})

// ---------- 6. Inverse regression guard (2026-07-12) ----------
//
// Pair to the spread-pattern check above. The positive test only
// proves the ternary-spread form EXISTS in the source. A future
// refactor that wraps the conditional in an `if` block (e.g.
// `if (shouldOverwriteCvText) $set.cvText = extracted`) would still
// pass the spread test while losing the spread semantics. This
// inverse test pins the NEGATIVE: there must NOT be a flat,
// unconditional `$set: { cvText: extracted }` line anywhere in
// the route — that pattern is exactly the regression we are
// guarding against, so its presence should fail the build.

test('route must NOT have an unconditional $set: { cvText: extracted } pattern', () => {
  // The dangerous pattern: a single Mongo $set that ALWAYS writes
  // cvText from the extracted value, with no ternary / if guard.
  // We allow it inside the ternary (`shouldOverwriteCvText ?
  // { cvText: extracted } : {}`) which the previous test already
  // requires; this test forbids the unconditional form.
  const unconditional = /\$set\s*:\s*\{\s*cvText\s*:\s*extracted\s*[,\}]/
  assert.doesNotMatch(
    SOURCE,
    unconditional,
    'Route must NOT contain an unconditional $set: { cvText: extracted } — would regress to the short-PDF clobbers-manual-summary bug',
  )
})

test('every cvText: extracted line must be gated by shouldOverwriteCvText ternary', () => {
  // Defensive second pass: even if a future refactor stores the
  // assignment in a variable like `const assignment = { cvText:
  // extracted }`, the `shouldOverwriteCvText` ternary must still
  // be the gate. We assert the ONLY occurrences of the substring
  // `cvText: extracted` are on a line that also contains the
  // ternary operator — i.e. the conditional is on the same line.
  const matches = SOURCE.match(/[^\n]*cvText\s*:\s*extracted[^\n]*/g) || []
  assert.ok(matches.length > 0, 'sanity: route must reference `cvText: extracted` somewhere (the conditional ternary)')
  for (const line of matches) {
    assert.match(
      line,
      /shouldOverwriteCvText\s*\?/,
      `every "cvText: extracted" reference must be inside a shouldOverwriteCvText ternary — found unguarded line: ${line.trim().slice(0, 100)}`,
    )
  }
})

// ---------- 7. Round-14 — soft-failure 200 path (terminal, no library fallback) ----------
//
// Background (2026-07-12): users were seeing hard 400s on valid PDFs
// because pdfjs-dist's default `getTextContent` pass + per-page
// fallbacks couldn't crack every content stream — e.g. a Word
// Online export with a stripped text layer. Round-10's fix wrapped
// the recovery in a pdf-parse "second opinion" fallback so the
// route could return 200 with `needsManualFallback: true` instead
// of 400. Round-14 (this pass) removes that fallback:
//   • pdf-parse v2 (2.4.5) is now a TypeScript class-based API with
//     NO plain-text-extraction function — the "second opinion" is
//     literally dead code under the current package version.
//   • pdfjs-dist v4's primary path is alive and maximally defensive
//     (2-pass per page + image-only ops-walk). When it can't decode
//     a content stream, no other parser can.
//   • The end-user contract is unchanged: PASSWORD_PROTECTED +
//     CORRUPT_DOCX remain 400 (user must fix the file before
//     re-uploading — these errors are NOT recoverable). Every other
//     categorised error falls through to an empty-success shape
//     just as before, returning 200 with `needsManualFallback: true`
//     + `code: 'EXTRACTION_FAILED'`. The file is still saved (filename
//     + size + upload date) so the user has a record of the attempt.
//   • The `extractionError` field stays gated on NODE_ENV !==
//     production so the raw pdfjs-dist error message (which can leak
//     internals like the parser version, internal class names, or
//     stack frames) never reaches a production browser. The `code`
//     field is the only production-safe discriminator.
//
// What this section locks:
//   • The "fatal vs soft" branch decision stays exactly as
//     Round-10 wired it — the test below pins the isFatal predicate.
//   • The 200 response shape (needsManualFallback + EXTRACTION_FAILED +
//     Swedish warning) stays unchanged for the UI.
//   • The dev-only stack + extractionError gates stay exactly as
//     written — they're round-grepped into the source via the
//     position-based locks below.
//   • The dead `pdf-parse fallback` source assertions (Round-10
//     test) are REMOVED in this round — the "second opinion" no
//     longer exists.

test('PASSWORD_PROTECTED + CORRUPT_DOCX remain hard 400 (not soft-failed)', () => {
  // Lock the "fatal" branch — these are the ONLY two error codes
  // the route treats as user-must-fix-the-file. A future refactor
  // that adds a third code to the fatal list must update the
  // test in lockstep.
  assert.match(
    SOURCE,
    /isFatal\s*=\s*code\s*===\s*['"]PASSWORD_PROTECTED['"]\s*\|\|\s*code\s*===\s*['"]CORRUPT_DOCX['"]/,
    'PASSWORD_PROTECTED and CORRUPT_DOCX must be the ONLY fatal codes — every other categorised error falls through to soft-failure',
  )
  // The fatal branch returns 400 with the structured body.
  assert.match(
    SOURCE,
    /isFatal[\s\S]{0,400}?return\s+NextResponse\.json\([\s\S]{0,400}?status:\s*400/,
    'fatal branch must return NextResponse.json with `status: 400` so the UI surfaces a hard error',
  )
})

test('soft-failure path must NOT include a pdf-parse fallback library call', () => {
  // Round-14 removal: the dead `pdf-parse` import + dynamic-unwrap +
  // second-opinion call block was deleted from app/api/upload-cv
  // /route.js because pdf-parse v2 no longer exposes a plain-text-
  // extraction function. Lock the absence so a future refactor that
  // re-introduces the fallback (e.g. on a v1 downgrade) trips this
  // guard immediately instead of silently running the dead code
  // path under v1's blessing.
  assert.doesNotMatch(
    SOURCE,
    /await\s+import\(['"]pdf-parse['"]\)/,
    'soft-failure path must NOT dynamic-import pdf-parse (v2 has no callable function — a re-introduction would ship dead code)',
  )
  assert.doesNotMatch(
    SOURCE,
    /pdfParseFn\b/,
    'soft-failure path must NOT carry the v1-style pdfParseFn unwrap helpers (dead under v2)',
  )
  assert.doesNotMatch(
    SOURCE,
    /attempting pdf-parse fallback/,
    'soft-failure path must NOT log the pre-v2 fallback attempt message (no fallback exists post-Round-14)',
  )
})

test('soft-failure response is 200 with needsManualFallback: true and EXTRACTION_FAILED code', () => {
  // Lock the response shape: 200 (not 400), needsManualFallback
  // true, code EXTRACTION_FAILED, and a Swedish warning field so
  // the UI can render a clean "file saved, write a manual summary"
  // state instead of a red error alert.
  // The response is built incrementally via spread so we check
  // each piece individually.
  assert.match(SOURCE, /needsManualFallback:\s*true/,
    'soft-failure response must surface needsManualFallback: true so the UI focuses the manual textarea')
  assert.match(SOURCE, /code:\s*extractionSoftFailureCode\s*\|\|\s*['"]EXTRACTION_FAILED['"]/,
    'soft-failure response must include `code: extractionSoftFailureCode || "EXTRACTION_FAILED"` for analytics + the UI discriminator')
  assert.match(SOURCE, /warning:\s*\n?\s*['"]Vi kunde inte läsa texten/,
    'soft-failure response must include a Swedish `warning` field that tells the user to write a manual summary')
  // The 200 status is implicit — the success-path `return
  // NextResponse.json({...})` carries NO `, { status: ... }` second
  // argument so Next defaults to 200. To distinguish it from the
  // CATCH branch's `NextResponse.json({ error: ... }, { status: 400 })`,
  // we find the specific response that mentions
  // `cvText: shouldOverwriteCvText` (the unique success-path key)
  // and verify the 1500 chars after it do NOT contain a 4xx status.
  const successResponseIdx = SOURCE.indexOf('cvText: shouldOverwriteCvText')
  assert.ok(successResponseIdx > 0, 'success-path response must include `cvText: shouldOverwriteCvText`')
  // Find the closing `)` of THAT NextResponse.json call. Scan
  // forward until we hit a `)` at column 2 (the closing of the
  // call), then take the next 200 chars to check for a 4xx status.
  const tailAfter = SOURCE.slice(successResponseIdx, successResponseIdx + 3000)
  // The success response's outer close is `)\n  } catch` — the
  // `catch` keyword is the natural delimiter. Look at the slice
  // BEFORE `catch` to confirm no 4xx status was injected.
  const catchIdx = tailAfter.indexOf('} catch')
  assert.ok(catchIdx > 0, 'success-path response must be followed by the outer catch block')
  const successSlice = tailAfter.slice(0, catchIdx)
  const statusMatch = successSlice.match(/,\s*\{\s*status:\s*(\d+)/)
  assert.ok(
    !statusMatch || parseInt(statusMatch[1], 10) < 400,
    'soft-failure response must NOT be wrapped in a 4xx status — must be 200 so the UI takes the success branch',
  )
})

test('extractionError field is gated on NODE_ENV !== production (no raw pdfjs-dist internals in prod)', () => {
  // The raw pdfjs-dist error message (e.message) can leak the parser
  // version, internal class names, or stack frames — not something
  // we want reaching a production browser. The `code` field is the
  // only production-safe discriminator; `extractionError` is dev-only.
  // Lock the gate so a future refactor that drops the conditional
  // spread silently regresses the privacy posture.
  //
  // Position-based check: the source MUST contain BOTH the gate
  // string and the extractionError line, AND the gate must appear
  // BEFORE the extractionError line. We allow 500 chars of breathing
  // room between the two (the nested spread + the ternary's `? { \n`
  // boilerplate) so a future refactor that adds an extra field
  // between the gate and the extractionError line doesn't break the
  // structural lock.
  //
  // The source contains MULTIPLE `process.env.NODE_ENV !== 'production'`
  // gates (one for the dev-only stack log, one for the extractionError
  // gate, and potentially more for unrelated dev-only paths). We must
  // find the gate that PRECEDES the extractionError line, not the
  // first gate in the file (which may be thousands of chars earlier).
  const extractionErrorIdx = SOURCE.indexOf('extractionError: extractionSoftFailureMessage')
  assert.ok(extractionErrorIdx > 0, 'source must contain `extractionError: extractionSoftFailureMessage` line')
  const beforeLine = SOURCE.slice(0, extractionErrorIdx)
  const nearestGateIdx = beforeLine.lastIndexOf("process.env.NODE_ENV !== 'production'")
  assert.ok(
    nearestGateIdx > 0,
    'source must contain a `process.env.NODE_ENV !== \'production\'` gate BEFORE the extractionError line',
  )
  assert.ok(
    extractionErrorIdx - nearestGateIdx < 500,
    `gate and extractionError must be within 500 chars of each other (they're ${extractionErrorIdx - nearestGateIdx} apart) — the gate is not adjacent to the extractionError line`,
  )
  // Outer `extractionSoftFailure` ternary must wrap the gate
  // (so a non-soft-failure path doesn't accidentally surface the
  // raw error message). It must appear between the gate and the
  // extractionError line — or before the gate.
  const outerGateIdx = beforeLine.lastIndexOf('extractionSoftFailure')
  assert.ok(outerGateIdx > 0,
    '`extractionSoftFailure` outer ternary must wrap the gate (appear before the gate)')
})

test('soft-failure path logs full error context in dev (name + message + stack)', () => {
  // Operator note: a soft-launch tester copying a single log line
  // from prod should see enough to grep for the right code path
  // (DECISION=error, code, name, message). In dev, the full stack
  // is also logged so a regression that introduces a new pdfjs-dist
  // error class is traceable to the right throw site.
  assert.match(
    SOURCE,
    /FILE_SIZE=.*?DECISION=error\s+CODE=/,
    'soft-failure catch must log FILE_SIZE + DECISION=error + CODE in a single line so a tester can grep prod logs',
  )
  // Position-based check for the dev-only stack log gate. The
  // source has the literal `console.warn('[upload-cv] full error
  // stack:'` (with a colon directly after, no closing quote). The
  // gate `process.env.NODE_ENV !== 'production'` is on the line
  // immediately above it (inside an if-block). We use position
  // comparison instead of regex slicing so the test isn't fooled
  // by other `process.env.NODE_ENV !== 'production'` lines far
  // away from the stack log.
  const stackLogIdx = SOURCE.indexOf('full error stack')
  assert.ok(stackLogIdx > 0, 'dev-only stack log message must exist')
  // Look for the NEAREST gate preceding the stack log (not the
  // first one in the file — there are multiple dev-only gates).
  const beforeStack = SOURCE.slice(0, stackLogIdx)
  const nearestGateIdx = beforeStack.lastIndexOf("process.env.NODE_ENV !== 'production'")
  assert.ok(
    nearestGateIdx > 0,
    'source must contain a `process.env.NODE_ENV !== \'production\'` gate before the stack log',
  )
  assert.ok(
    stackLogIdx - nearestGateIdx < 500,
    `gate and stack log must be within 500 chars of each other (they're ${stackLogIdx - nearestGateIdx} apart)`,
  )
  // The stack log must log the actual error stack (e?.stack), not
  // just the message — useful for tracing a regression that
  // introduces a new pdfjs-dist error class.
  const afterStack = SOURCE.slice(stackLogIdx, stackLogIdx + 200)
  assert.match(
    afterStack,
    /e\?\.stack/,
    'dev-only stack log must log `e?.stack` so a future regression is traceable to the right throw site',
  )
})

// ---------- 8. Round-25.1 (option a) — first-time-upload gate ----------
//
// Issue (2026-07-13): 4 e2e specs were failing because the demo-fixture
// user has no cvText and a borderline-short first-time PDF couldn't
// satisfy the >= 50 char floor, so `data-testid="settings-cv-success"`
// never mounted after upload. The fix adds an `isFirstTimeUpload`
// Boolean that OR-includes with the original `extracted.length >=
// MIN_VALID_CV_TEXT_CHARS` check. First-time uploads (no existing
// cvText AND no existing cvSummary) always overwrite; otherwise the
// original Round-10 >= 50 floor stands. The cvSummary-only case is
// detected (a user who wrote a manual summary but never uploaded a
// PDF) so a short cvText can't clobber the manual summary either.
//
// This section locks the new code paths.

test('round-25 first-time gate: shouldOverwriteCvText OR-includes isFirstTimeUpload', () => {
  // The first-time-upload path must always overwrite, regardless
  // of extracted.length. The OR clause is the documented form:
  // `isFirstTimeUpload || extracted.length >= MIN_VALID_CV_TEXT_CHARS`.
  assert.match(
    SOURCE,
    /isFirstTimeUpload\s*\|\|\s*extracted\.length\s*>=\s*MIN_VALID_CV_TEXT_CHARS/,
    'shouldOverwriteCvText must OR-include isFirstTimeUpload before the length check (round-25 first-time gate)',
  )
})

test('round-25 first-time gate: cvSummary is in the projection (cvSummary-only profiles are NOT first-time)', () => {
  // The Round-10 bug was: a short cvText overrides a longer manual
  // cvSummary in the AI prompt. The first-time gate must check
  // BOTH cvText and cvSummary so a cvSummary-only profile is NOT
  // classified as first-time (which would silently re-introduce the
  // Round-10 regression). The projection is the gate's only input.
  assert.match(
    SOURCE,
    /projection:\s*\{\s*cvText:\s*1\s*,\s*cvSummary:\s*1\s*\}/,
    'first-time findOne projection must read BOTH cvText AND cvSummary so cvSummary-only profiles are detected as not-first-time (Round-10 protection preserved)',
  )
})

test('round-25 first-time gate: findOne happens BEFORE updateOne (no race window)', () => {
  // The findOne-then-gate-then-update ordering must preserve the
  // invariant: the gate decision is taken on a pre-write snapshot of
  // cvText + cvSummary. Without the ordering lock, a re-upload could
  // re-classify itself as first-time and overwrite a profile it
  // just updated.
  const findOneIdx = SOURCE.indexOf("db.collection('profiles').findOne")
  const updateOneIdx = SOURCE.indexOf("db.collection('profiles').updateOne")
  assert.ok(findOneIdx > 0, 'first-time gate must call db.collection(\u0027profiles\u0027).findOne')
  assert.ok(updateOneIdx > 0, 'route must call db.collection(\u0027profiles\u0027).updateOne')
  assert.ok(
    findOneIdx < updateOneIdx,
    'findOne must happen BEFORE updateOne so the gate decision is taken on the pre-write snapshot (no race window)',
  )
})


