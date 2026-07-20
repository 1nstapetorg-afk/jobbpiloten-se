// tests/unit/settings-cv-preview-immediate-spec.test.mjs
//
// Round-27.3b — structural-lock unit test for
// `tests/e2e/settings-cv-preview-immediately.spec.js`.
//
// This test is the contract that keeps the new preview-immediately
// spec tied to the option (b) seed path:
//   1. The spec file exists at the canonical Round-27.3a path.
//   2. It imports from the auth fixture (so seedDemoUser runs).
//   3. It does NOT mention `clearCv` anywhere — the whole point of
//      option (b) is for the spec to start from a seeded
//      "CV already on file" baseline; a future maintainer silently
//      adding a clearCv wipe would regress this spec to the
//      dropzone baseline without anyone noticing, so this lock
//      makes that drift break the build instead.
//   4. It asserts the seeded filename + the success-line anchor so
//      removing the assertions also breaks the build.
//
// Companion pattern to tests/unit/pdf-second-pass.test.mjs and
// tests/unit/buildBatchMatchPayload.test.mjs — pure source-grep,
// no live dev server needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const SPEC_PATH = 'tests/e2e/settings-cv-preview-immediately.spec.js'
const EXISTS = existsSync(SPEC_PATH)
const SOURCE = EXISTS ? readFileSync(SPEC_PATH, 'utf8') : ''

test('Round-27.3a: preview-immediately spec file exists at canonical path', () => {
  assert.ok(
    EXISTS,
    `${SPEC_PATH} must exist — this is the option (b) seed-path regression net. If this fails, the spec was renamed or moved; update the path here.`,
  )
})

test('Round-27.3a: preview-immediately spec imports from the auth fixture (so seedDemoUser runs)', () => {
  if (!EXISTS) return // skip — existence assertion will surface the real error
  assert.match(
    SOURCE,
    /from\s+['"]\.\/_fixtures\/auth['"]/,
    'preview-immediately spec must `import { test, expect } from "./_fixtures/auth"` so the auth fixture\'s `seedDemoUser(context)` runs and populates cvText/cvFileName/cvFileSize before spec body',
  )
})

test('Round-27.3a: preview-immediately spec does NOT call `clearCv(` (no silent regression to dropzone baseline)', () => {
  if (!EXISTS) return // skip — existence assertion will surface the real error
  // Anchored on the function-call form `clearCv(` so this lock CATCHES
  // the regression where a future maintainer adds a `clearCv(page)`
  // invocation in `beforeEach` while still ALLOWING the spec file's own
  // doc comments to mention the word by name (e.g. explaining why
  // `beforeEach` is intentionally absent). A bare-keyword search would
  // false-positive on legitimate doc-comments and force every maintainer
  // to copy-edit prose to satisfy a test — that's the kind of over-
  // protection that erodes test-trust over time. Keep this lock on the
  // function-call shape.
  //
  // SCOPE NOTE (Round-28.1a — second-pass reviewer critical #2 fix):
  // this regex is ID-level, not effect-level. It catches an importable
  // `clearCv(page)` invocation in `beforeEach`. It does NOT catch a
  // semantic-equivalent wipe — e.g. manually posting
  // `{ cvText: '', cvFileName: '', cvFileSize: 0, cvUploadedAt: null }`
  // to `/api/profile-update`. That manual-wipe pattern is an
  // out-of-scope regression for THIS lock; it would surface as a 20 s
  // timeout in the spec itself (settings-cv-filecard never mounts)
  // rather than as a silent pass, so the regression-net contract
  // holds even without effect-level AST analysis here.
  assert.doesNotMatch(
    SOURCE,
    /clearCv\s*\(/,
    'preview-immediately spec MUST NOT call `clearCv(...)` — its whole purpose is to exercise the option (b) seeded-pre-cvText path. A `clearCv(page)` invocation in `beforeEach` would silently regress the spec to the dropzone baseline. Mentioning the word in a comment is fine (this lock is anchored on the function-call shape, not the bare keyword).',
  )
})

test('Round-27.3a: preview-immediately spec asserts the SEEDED filename appears in the file card', () => {
  if (!EXISTS) return
  assert.match(
    SOURCE,
    /cv-demo-frontend\.pdf/,
    'preview-immediately spec must assert the SEEDED filename (cv-demo-frontend.pdf from DEMO_PROFILE_PAYLOAD) appears in the file card — without it the spec could mount a stale/blank file card and still pass',
  )
})

test('Round-27.3a: preview-immediately spec asserts the success-line copy anchor ("tecken hittades")', () => {
  if (!EXISTS) return
  assert.match(
    SOURCE,
    /tecken hittades/,
    'preview-immediately spec must assert the success-line substring "tecken hittades" — without it the spec could pass with an empty / wrong-content cvText mount',
  )
})

test('Round-27.3a: preview-immediately spec asserts the file card replaces the dropzone (no side-by-side render)', () => {
  if (!EXISTS) return
  assert.match(
    SOURCE,
    /settings-cv-dropzone["'][^}]*toHaveCount\(0\)/,
    'preview-immediately spec must assert the dropzone element count is 0 — without it a regression that renders both UIs side-by-side would silently pass',
  )
})
