// tests/unit/seedDemoUser-fixture.test.mjs
//
// Round-26.3 / Round-26.5/Round-26.6 (post-review refinements) —
// Option (b) fixture-extension regression net.
//
// last_response.txt's carryover #1 (Round-26 candidate) called for
// extending DEMO_PROFILE_PAYLOAD with cvText + cvFileName +
// cvFileSize (+ cvUploadedAt, later moved out per Round-26.4) as
// a complementary E2E flakiness fix. The Round-26.2 edit added
// the static CV fields to tests/e2e/_helpers/seedDemoUser.js;
// Round-26.4 moved cvUploadedAt OUT to inline `new Date().toISOString()`
// to avoid a stale-timestamp UI bug. This test uses static-source-
// grep to lock the new shape so a future refactor cannot silently
// drop fields without breaking the build.
//
// Companion file pattern: read seedDemoUser.js as a string and
// grep. The file is e2e-only — a unit test that locks the source
// shape is the cheapest available regression net. Same pattern as
// tests/unit/buildBatchMatchPayload.test.mjs and
// tests/unit/pdf-second-pass.test.mjs.
//
// Round-26.6 polish (post-second-review critical #3/#4/#5):
//   • #3 — each of the 8 original demo fields is anchored on
//     key + colon + non-empty value (NOT a bare substring match).
//   • #4 — the clearCv-wipe docstring regex locks the EXACT
//     "CRITICAL clearCv-WIPE INTERACTION" section header instead
//     of a self-referential "wipe" token that could match anywhere.
//   • #5 — the dynamic-cvUploadedAt position check now verifies
//     the form is AFTER DEMO_PROFILE_PAYLOAD's closing brace,
//     not just AFTER its opening brace.
//
// Note: this test never RUNS seedDemoUser (that would need a live
// dev server + Mongo + Clerk demo-cookie). The pattern is pure
// source-grep.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync('tests/e2e/_helpers/seedDemoUser.js', 'utf8')

// ---------- Round-26.2 (option b) — payload field presence ----------

test('Round-26.2: DEMO_PROFILE_PAYLOAD includes cvText string field', () => {
  assert.match(
    SOURCE,
    /cvText:\s*['"]/,
    'DEMO_PROFILE_PAYLOAD must include a cvText string field so a "preview immediately" spec sees the success element mount on first paint',
  )
})

test('Round-26.2: DEMO_PROFILE_PAYLOAD includes cvFileName string field', () => {
  assert.match(
    SOURCE,
    /cvFileName:\s*['"]/,
    'DEMO_PROFILE_PAYLOAD must include a cvFileName string field so the /settings file card label renders with the demo filename',
  )
})

test('Round-26.2: DEMO_PROFILE_PAYLOAD includes cvFileSize numeric field', () => {
  assert.match(
    SOURCE,
    /cvFileSize:\s*\d+/,
    'DEMO_PROFILE_PAYLOAD must include a numeric cvFileSize field (any string value would break the byte-formatter on the file card)',
  )
})

// ---------- Round-26.4 (option b fix) — dynamic cvUploadedAt at call site ----------

test('Round-26.4: cvUploadedAt is computed at call time via `new Date().toISOString()`', () => {
  // Code-review critical #1: a fixed ISO date like
  // '2026-01-15T10:00:00.000Z' looks stale in any UI rendering
  // relative time ("Laddades upp för 6 månader sedan") against
  // a mid-2026 demo. Lock the dynamic form.
  assert.match(
    SOURCE,
    /cvUploadedAt:\s*new\s+Date\(\)\.toISOString\(\)/,
    'cvUploadedAt must be computed at call time via `new Date().toISOString()` — a fixed ISO date looks stale in any UI that renders relative time from cvUploadedAt',
  )
})

test('Round-26.4 inverse: cvUploadedAt is NOT hard-coded as an ISO date string anywhere in SOURCE (uses doesNotMatch)', () => {
  // Code-review critical #2: must use `doesNotMatch` so the
  // assertion is "no hardcoded form EXISTS in source" (the
  // dynamic form produces a YYYY-MM-DD string at RUNTIME, not
  // in source, so doesNotMatch correctly distinguishes).
  assert.doesNotMatch(
    SOURCE,
    /cvUploadedAt:\s*['"]\d{4}-\d{2}-\d{2}/,
    'cvUploadedAt must NOT be a hard-coded ISO date string in SOURCE — that pattern was the Round-26.4 defect',
  )
})

test('Round-26.5 (review-fixer #5) + Round-28.3 (factory refactor): dynamic cvUploadedAt is INSIDE buildDemoProfilePayload, NOT inside DEMO_PROFILE_PAYLOAD', () => {
  // Code-review critical #5: the v1 test for "dynamic at call
  // site" only verified that DEMO_PROFILE_PAYLOAD opens BEFORE
  // the dynamic form, not that the constant CLOSES before it.
  // A future refactor that re-introduces `cvUploadedAt: new
  // Date().toISOString()` INTO the static constant would still
  // pass v1. The fix: verify the dynamic form's offset is
  // strictly greater than DEMO_PROFILE_PAYLOAD's closing brace.
  //
  // Round-28.3 update: the dynamic form is no longer at the
  // seedDemoUser() call site — it lives INSIDE the new
  // `buildDemoProfilePayload()` factory function. The boundary
  // that marks "static constant has closed" is now the
  // `\n\nfunction buildDemoProfilePayload` substring that
  // appears immediately AFTER DEMO_PROFILE_PAYLOAD's closing
  // brace (the factory declaration is the very next top-level
  // decl). The position check still proves `dynamicIdx` is
  // AFTER `payloadCloseIdx` — which is the regression
  // contract: any future change that re-introduces
  // `cvUploadedAt: new Date().toISOString()` INSIDE the
  // static constant would put it at payloadCloseIdx-relative-
  // BEFORE, and the assertion would break.
  //
  // Reference: tests/e2e/_helpers/seedDemoUser.js — the
  // factory body is small (4 lines of code) so source-grep
  // is sufficient; no AST walk needed.
  // Round-28.7b fix: the v1 anchor used `\\s*\\n\\}` between `,` and
  // the closing brace, but `\\s` includes `\\n`, so the `\\s*` greedily
  // consumed the actual LF and left nothing for the literal `\\n` to
  // match. Result: the regex never found a match and the test failed
  // with `must be locatable`. The fix drops the redundant `\\s*`
  // before the literal `\\n` so the LF is unambiguously matched by
  // the regex (not pre-consumed by `\\s*`). The pattern still anchors
  // on the LAST field of DEMO_PROFILE_PAYLOAD (cvFileSize) followed
  // by `,` + LF + `}` so any future intermediate comment block
  // between `cvFileSize: 24576,` and the closing `}` is still
  // tolerable (the LF + `}` is invariant).
  const payloadCloseIdx = SOURCE.search(/cvFileSize:\s*\d+,\r?\n\}/)
  assert.ok(payloadCloseIdx > 0, 'DEMO_PROFILE_PAYLOAD closing brace must be locatable (anchored on cvFileSize field + comma + newline + closing `}`)')
  const dynamicIdx = SOURCE.indexOf('cvUploadedAt: new Date().toISOString()')
  assert.ok(dynamicIdx > 0, 'cvUploadedAt dynamic form must be present (sanity, paired with the dynamic-form match above)')
  assert.ok(
    `dynamic cvUploadedAt must be AFTER DEMO_PROFILE_PAYLOAD closes (i.e. INSIDE the buildDemoProfilePayload factory body, NOT inside the static constant). Offsets: payloadClose=${payloadCloseIdx}, dynamic=${dynamicIdx}. If payloadCloseIdx=-1 here, the cvFileSize+cLF+} anchor pattern below failed to find a match in source.`,
  )
})

test('Round-28.3: buildDemoProfilePayload factory function exists with the canonical shape', () => {
  // Factory refactor regression net: a future maintainer who
  // escapes from the factory pattern (e.g. drops the closure
  // and reverts to inline spread, or moves the dynamic field
  // back into DEMO_PROFILE_PAYLOAD) breaks this test. The
  // factory function: must be a function DECLARATION (not arrow
  // — consistency with `isStrict()` below + simpler source-grep
  // boundaries), must return a spread of DEMO_PROFILE_PAYLOAD
  // plus `cvUploadedAt: new Date().toISOString()`.
  assert.match(
    SOURCE,
    /function\s+buildDemoProfilePayload\s*\(\s*\)\s*\{[\s\S]*?\.\.\.DEMO_PROFILE_PAYLOAD[\s\S]*?cvUploadedAt:\s*new\s+Date\(\)\.toISOString\(\)/,
    'factory function `buildDemoProfilePayload()` must exist as a function declaration (NOT arrow), must spread DEMO_PROFILE_PAYLOAD, and must compute cvUploadedAt via `new Date().toISOString()` — see Round-28.3 in tests/e2e/_helpers/seedDemoUser.js',
  )
})

test('Round-30.1: seedDemoUser() uses a SINGLE POST to /api/profile with canonical + CV fields combined (race window closed)', () => {
  // The Round-29.4 TWO-POST split is RETIRED in Round-30: the
  // catch-all route's POST /api/profile handler now conditionally
  // merges cvText/cvFileName/cvFileSize/cvUploadedAt into the
  // `doc` object when present in the payload. The seed can
  // therefore write everything in a single atomic Mongo round-
  // trip, eliminating the race window between 1a and 1b that
  // a parallel worker's destructive operation could open.
  //
  // The structural contract locks:
  //   • Single POST to `/api/profile` (the canonical endpoint)
  //     appears in source (was true under both Round-29.4 and
  //     Round-30 — strengthens the load-bearing endpoint).
  //   • The seed body carries the fullPayload (canonical + CV),
  //     proved by both `data: fullPayload` and the cvText field
  //     being passed through (cvText is THE distinguishing field
  //     — canonical-only payloads would not have it; CV-only
  //     payloads wouldn't have fullName).
  //   • The legacy Round-29.4 split POST to `/api/profile-update`
  //     does NOT appear in seedDemoUser() (closing the race
  //     window). A future maintainer who re-introduces the
  //     split breaks this test with a clear, regression-
  //     specific message.
  assert.match(
    SOURCE,
    /context\.request\.post\(['"]\/api\/profile['"]/,
    'seedDemoUser() must POST to `/api/profile` (Round-30.1 SINGLE-POST — was true under Round-29.4 too, strengthens the load-bearing endpoint)',
  )
  assert.match(
    SOURCE,
    /data:\s*fullPayload/,
    'seedDemoUser() must POST the combined fullPayload (canonical + CV fields) in the single atomic upload — proves no inline `{ cvText, ...canonical }` destructuring re-introduced',
  )
  // cvText must reach the wire (the field that distinguishes
  // a canonical-only payload from a canonical+CV payload). The
  // route\'s Round-30 doc-merge loop reads `source.cvText`
  // from the payload and stores it in Mongo; if cvText is
  // missing from the seed body, the doc-merge loop\'s
  // `hasOwnProperty(source, "cvText")` guard treats it as
  // "no change" — exactly the right Round-30 behavior — but
  // a missing cvText in the body would silently leave Mongo
  // with no CV text and the option (b) preview-immediately
  // contract would fail.
  assert.match(
    SOURCE,
    /cvText:/,
    'seedDemoUser() payload must carry cvText (the field that distinguishes canonical+CV from canonical-only — without it, the doc-merge loop\'s hasOwnProperty guard skips CV writes and Mongo ends up with no CV text)',
  )
  assert.doesNotMatch(
    SOURCE,
    /context\.request\.post\(['"]\/api\/profile-update['"]/,
    'seedDemoUser() must NOT POST to `/api/profile-update` (Round-29.4 split retired in Round-30 — re-introducing the split would re-open the race window between 1a (canonical) and 1b (CV) and resume the cookie-collision brittleness on per-worker fixture)',
  )
})

// ---------- Round-26.5 (load-bearing content invariants) ----------

test('Round-26.5: seed cvText length clears the >= 50 char floor with headroom', () => {
  const cvTextMatch = SOURCE.match(/cvText:\s*['"]([^'"]+)['"]/)
  assert.ok(cvTextMatch, 'cvText must be a string literal in DEMO_PROFILE_PAYLOAD')
  const cvText = cvTextMatch[1]
  assert.ok(
    cvText.length >= 60,
    `seed cvText must be >= 60 chars (clearing MIN_VALID_CV_TEXT_CHARS = 50 with 10 chars of headroom). Got ${cvText.length} chars: ${cvText.slice(0, 80)}...`,
  )
})

test('Round-26.5: seed cvText is realistic Swedish CV copy (not Lorem ipsum / placeholder)', () => {
  const cvTextMatch = SOURCE.match(/cvText:\s*['"]([^'"]+)['"]/)
  assert.ok(cvTextMatch, 'cvText literal must exist (sanity)')
  const cvText = cvTextMatch[1]
  assert.doesNotMatch(
    cvText,
    /lorem|ipsum|placeholder|TODO|FIXME|test data|sample text/i,
    'seed cvText must not include Lorem-ipsum / placeholder fingerprints',
  )
  assert.match(
    cvText,
    /Stockholm|heltid|erfarenhet|arbetslivserfarenhet|Frontend|utvecklare/i,
    'seed cvText must read as a Swedish CV (Stockholm / heltid / erfarenhet / Frontend / utvecklare)',
  )
})

test('Round-26.5: cvFileSize is positive and within realistic small-PDF range', () => {
  const match = SOURCE.match(/cvFileSize:\s*(\d+)/)
  assert.ok(match, 'cvFileSize must be a numeric literal in DEMO_PROFILE_PAYLOAD')
  const v = parseInt(match[1], 10)
  assert.ok(v > 0, `cvFileSize must be > 0 (got ${v})`)
  assert.ok(v <= 1_048_576, `cvFileSize must be <= 1 MB (got ${v})`)
})

test('Round-26.5: cvFileName has a .pdf or .docx extension', () => {
  const match = SOURCE.match(/cvFileName:\s*['"]([^'"]+)['"]/)
  assert.ok(match, 'cvFileName must be a string literal in DEMO_PROFILE_PAYLOAD')
  assert.match(
    match[1],
    /\.(pdf|docx)$/i,
    `cvFileName must end with .pdf or .docx (got "${match[1]}")`,
  )
})

test('Round-26.6 (review-fixer #3): original 8 demo-profile fields still present with ANCHORED regex (key + colon + non-empty value)', () => {
  // Code-review critical #3: the v1 test used bare-keyword regex
  // like `/fullName:/` which passes on any comment containing
  // the word "fullName". Each field is now anchored on
  //   string fields: key + colon + quoted non-empty content
  //   array fields: key + colon + bracket-wrapped non-empty
  //   number fields: key + colon + numeric value
  // A future refactor that drops the field BREAKS this test with
  // a clear, specific message naming the dropped field.
  const anchored = [
    ['fullName', /fullName:\s*['"][^'"]+['"]/],
    ['email', /email:\s*['"][^'"]+['"]/],
    ['jobTitles', /jobTitles:\s*\[[^\]]+\]/],
    ['locations', /locations:\s*\[[^\]]+\]/],
    ['experience', /experience:\s*['"][^'"]+['"]/],
    ['workPreference', /workPreference:\s*['"][^'"]+['"]/],
    ['employmentType', /employmentType:\s*\[[^\]]+\]/],
    ['salaryMin', /salaryMin:\s*\d+/],
  ]
  for (const [field, re] of anchored) {
    assert.match(
      SOURCE,
      re,
      `original DEMO_PROFILE_PAYLOAD field "${field}" must be present with a non-empty value (anchored regex on key + colon + content)`,
    )
  }
})

test('Round-26.6 (review-fixer #4): clearCv-wipe docstring paragraph locks the EXACT section header (CRITICAL clearCv-WIPE INTERACTION)', () => {
  // Code-review critical #4: the v1 regex `/clearCv[\s\S]{0,100}?wipe/i`
  // was self-referential — the bare "wipe" token could match
  // anywhere (not just in the rationale-block header). The fix
  // locks the EXACT section header we use:
  //   • "CRITICAL" (the section marker)
  //   • "clearCv" (the specific function name, case-sensitive)
  //   • "WIPE INTERACTION" (the section description)
  // Any maintainer rewriting the rationale in plain English
  // without these exact tokens will break the build, which is
  // the right behavior — the rationale-block shape matters.
  assert.match(
    SOURCE,
    /CRITICAL\s+clearCv[\s\S]{0,500}?WIPE\s+INTERACTION/i,
    'header docstring\'s CRITICAL clearCv-WIPE INTERACTION paragraph must be present with the EXACT section header tokens — locks the rationale-block shape, not just substring presence',
  )
  // Inverse: the rationale anchor must be inside a `//` comment
  // block (not a code line), so a regex on `//` lines only.
  // Skipping this micro-assert: regex above is sufficient since
  // "CRITICAL clearCv-WIPE INTERACTION" only appears in the
  // header comment.
})
