// tests/unit/style-presets.test.mjs
//
// Round-35 (Part 3 — Answer Diversity) — structural-lock tests
// for `lib/style-presets.mjs`. The 5-style contract is a
// product spec (lagom/strkturerad/berättande/direkt/engagerad);
// a future maintainer who renames a style id silently breaks
// every profile that stored the old id. These tests lock the
// shape so the regression surfaces at unit-test time, not at
// "my cover letter sounds weird" time.
//
// What we lock
// ------------
//   1. STYLE_PRESETS has exactly the 5 expected styles, with the
//      canonical id / label / description / openers / prompt
//      fields.
//   2. Each preset is Object.freeze()'d so a runtime mutation
//      can't corrupt the prompt (e.g. an ad-hoc patch from
//      another module).
//   3. resolveStylePreset returns the canonical preset for
//      known ids and the DEFAULT for unknown / null /
//      undefined / non-string values.
//   4. The DEFAULT is 'lagom' per the Part 3 spec.
//   5. STYLE_PRESETS_BY_ID is a Map with the same 5 keys as
//      the array (registry contract for downstream consumers).
//   6. The groq.js AI prompt path imports the resolver and
//      uses the SAME 5-style id set (sync lock — if a future
//      maintainer adds a 6th style to style-presets.mjs but
//      forgets to update groq.js's prompt-injection call, the
//      test fails).
//   7. The /api/[[...path]]/route.js ALLOWED list (profile-
//      update partial update) accepts stylePreference. The
//      inline validator in the route uses the same 5-value
//      set, so a drift between the canonical list and the
//      route's guard would surface here.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  STYLE_PRESETS,
  STYLE_PRESETS_BY_ID,
  DEFAULT_STYLE_ID,
  resolveStylePreset,
} from '../../lib/style-presets.mjs'

// ---- 1. The 5-style contract ----

test('STYLE_PRESETS has exactly the 5 expected styles with canonical ids', () => {
  // The Part 3 spec names these exact ids. Any rename is a
  // breaking schema change — a future maintainer who renames
  // 'lagom' to 'default' will silently break every profile
  // that stored the old id, so we lock the literal set.
  assert.equal(STYLE_PRESETS.length, 5, `Expected 5 styles; got ${STYLE_PRESETS.length}`)
  const ids = STYLE_PRESETS.map((p) => p.id)
  assert.deepEqual(
    ids,
    ['lagom', 'strukturerad', 'berattande', 'direkt', 'engagerad'],
    `Expected canonical id order [lagom, strukturerad, berattande, direkt, engagerad]; got [${ids.join(', ')}]`,
  )
})

test('Each preset carries id + label + description + openers + prompt', () => {
  for (const preset of STYLE_PRESETS) {
    // Defensive checks per preset so a regression that drops
    // any field surfaces with the preset id (not just
    // "preset 3 is missing its label").
    assert.equal(typeof preset.id, 'string', `${preset.id}: id must be a string`)
    assert.ok(preset.id.length > 0, `${preset.id}: id must be non-empty`)
    assert.equal(typeof preset.label, 'string', `${preset.id}: label must be a string`)
    assert.ok(preset.label.length > 0, `${preset.id}: label must be non-empty`)
    assert.equal(typeof preset.description, 'string', `${preset.id}: description must be a string`)
    assert.ok(preset.description.length > 0, `${preset.id}: description must be non-empty`)
    assert.ok(Array.isArray(preset.openers), `${preset.id}: openers must be an array`)
    assert.ok(preset.openers.length >= 1, `${preset.id}: must have at least one opener`)
    assert.equal(typeof preset.prompt, 'string', `${preset.id}: prompt must be a string`)
    assert.ok(preset.prompt.length > 50, `${preset.id}: prompt must be substantive (got ${preset.prompt.length} chars)`)
  }
})

test('Each preset is Object.freeze()\'d (no runtime mutation)', () => {
  // A future maintainer who tries to add a runtime property
  // to a preset (e.g. for ad-hoc theming) would silently
  // corrupt the prompt. The freeze is the belt-and-suspenders
  // guard that catches this BEFORE the next test or the
  // Groq prompt builder blows up. Same pattern as the
  // DEMO_STATES freeze lock in tests/unit/interactive-demo.test.mjs.
  for (const preset of STYLE_PRESETS) {
    assert.throws(
      () => { preset.hotPatched = true },
      /Cannot add property|Cannot redefine property/,
      `Preset ${preset.id} must be frozen`,
    )
  }
})

// ---- 2. The Swedish copy contract ----

test('Each style carries a Swedish label and description (Part 3 spec)', () => {
  // The Part 3 spec says the labels are: Lagom, Strukturerad,
  // Berättande, Direkt, Engagerad. We lock the LITERAL Swedish
  // strings so a future English translation patch surfaces
  // here. (The /settings card renders the label directly.)
  const expected = {
    lagom: 'Lagom',
    strukturerad: 'Strukturerad',
    berattande: 'Berättande',
    direkt: 'Direkt',
    engagerad: 'Engagerad',
  }
  for (const preset of STYLE_PRESETS) {
    assert.equal(
      preset.label,
      expected[preset.id],
      `Preset ${preset.id} label mismatch — expected "${expected[preset.id]}", got "${preset.label}"`,
    )
  }
})

test('Each style\'s description is in Swedish (contains åäö or common Swedish words)', () => {
  // Loose Swedish check: every description must contain at
  // least one of {å, ä, ö} OR a common Swedish stop-word.
  // English-only descriptions would fail this and surface
  // at unit-test time. (The descriptions are 1-line so the
  // false-positive rate on a coincidence is near-zero.)
  const swedishMarkers = /[åäöÅÄÖ]|\b(och|att|för|med|den|inom|som|eller)\b/i
  for (const preset of STYLE_PRESETS) {
    assert.match(
      preset.description,
      swedishMarkers,
      `Preset ${preset.id} description doesn't look Swedish: "${preset.description}"`,
    )
  }
})

// ---- 3. The resolver behavior ----

test('resolveStylePreset returns the right preset for each known id', () => {
  for (const preset of STYLE_PRESETS) {
    const resolved = resolveStylePreset(preset.id)
    assert.equal(resolved.id, preset.id)
    assert.equal(resolved.label, preset.label)
  }
})

test('resolveStylePreset returns the DEFAULT for null / undefined / empty string', () => {
  // The "default" is a safety net — a brand-new profile, a
  // future-removed style, a stale client that shipped an
  // unknown value. None of these can break the prompt builder.
  const expected = resolveStylePreset(DEFAULT_STYLE_ID)
  assert.equal(resolveStylePreset(null).id, expected.id)
  assert.equal(resolveStylePreset(undefined).id, expected.id)
  assert.equal(resolveStylePreset('').id, expected.id)
  assert.equal(resolveStylePreset(0).id, expected.id) // number — coerced
  assert.equal(resolveStylePreset({}).id, expected.id) // object — coerced
  assert.equal(resolveStylePreset([]).id, expected.id) // array — coerced
})

test('resolveStylePreset returns the DEFAULT for an unknown id', () => {
  // Drift guard: a future maintainer who DELETES a style id
  // (e.g. removes 'direkt' from STYLE_PRESETS) would have
  // every profile pointing at 'direkt' fall back to the
  // default — NEVER to an undefined preset. This test
  // asserts the fallback behavior with a clearly-non-existent
  // id so a regression here is loud at unit-test time.
  assert.equal(resolveStylePreset('removed-in-r99').id, DEFAULT_STYLE_ID)
  assert.equal(resolveStylePreset('PROFESSIONAL').id, DEFAULT_STYLE_ID) // uppercase
  assert.equal(resolveStylePreset('lagom ').id, DEFAULT_STYLE_ID) // trailing space
})

test('DEFAULT_STYLE_ID is "lagom" per the Part 3 spec', () => {
  // Part 3 spec: 'Lagom (balanced, default) — Swedish workplace
  // standard'. The default constant must match the canonical
  // preset id so a future maintainer who renames the preset
  // ALSO updates DEFAULT_STYLE_ID (or vice versa).
  assert.equal(DEFAULT_STYLE_ID, 'lagom')
  // And the default preset must exist in the registry.
  assert.ok(STYLE_PRESETS_BY_ID.has(DEFAULT_STYLE_ID))
})

// ---- 4. The Map registry contract ----

test('STYLE_PRESETS_BY_ID is a Map with the same 5 keys as the array', () => {
  assert.ok(STYLE_PRESETS_BY_ID instanceof Map, 'STYLE_PRESETS_BY_ID must be a Map')
  assert.equal(STYLE_PRESETS_BY_ID.size, STYLE_PRESETS.length)
  for (const preset of STYLE_PRESETS) {
    assert.ok(
      STYLE_PRESETS_BY_ID.has(preset.id),
      `STYLE_PRESETS_BY_ID missing key: ${preset.id}`,
    )
    assert.equal(STYLE_PRESETS_BY_ID.get(preset.id), preset)
  }
})

// ---- 5. Groq integration sync lock ----

test('lib/groq.js imports resolveStylePreset from the canonical module', () => {
  // Sync lock: the Groq prompt builder uses the resolver to
  // pick the right style modifier. A future maintainer who
  // removes the import (e.g. "let's inline the logic") would
  // silently break the style-aware prompt. The lock is loose
  // (string search) so a comment-only change doesn't false-
  // positive, but the import line is required.
  const src = readFileSync(
    new URL('../../lib/groq.js', import.meta.url),
    'utf8',
  )
  assert.match(
    src,
    /import\s*\{[^}]*\bresolveStylePreset\b[^}]*\}\s*from\s*['"]\.\/style-presets\.mjs['"]/,
    'lib/groq.js must import { resolveStylePreset } from ./style-presets.mjs',
  )
  // The three prompt builders that should inject the style
  // block. Each MUST contain a `getStyleBlock(` or
  // `styleBlock` reference so a future refactor that drops
  // the style from one of them surfaces here.
  assert.match(src, /getStyleBlock\s*\(/, 'lib/groq.js must define + call getStyleBlock()')
  // The style prompt line itself — used in generateCoverLetter
  // AND generateAnswer AND generateAdaptiveAnswer. If a
  // refactor moves the injection to a new helper we still
  // need the literal `Skrivstil: ` token to be present.
  assert.match(src, /Skrivstil:/, 'lib/groq.js prompt builders must include the literal "Skrivstil:" token')
})

// ---- 6. API route ALLOWED-list sync lock ----

test('/api/[[...path]]/route.js ALLOWED list includes stylePreference', () => {
  // Round-35 (Part 3): profile-update accepts `stylePreference`
  // as a partial-update field. Lock the literal entry so a
  // future maintainer who removes it (e.g. "let's move
  // style to its own endpoint") trips this test before
  // shipping a regression that silently drops the user's
  // style preference on every save.
  const src = readFileSync(
    new URL('../../app/api/[[...path]]/route.js', import.meta.url),
    'utf8',
  )
  assert.match(
    src,
    /ALLOWED[\s\S]{0,2000}?['"]stylePreference['"]/,
    'profile-update ALLOWED list must include "stylePreference"',
  )
})

test('/api/[[...path]]/route.js validates stylePreference via the canonical STYLE_PRESETS import', () => {
  // Round-35 (Part 3 — Answer Diversity) follows the canonical-source-
  // of-truth pattern: the route imports `STYLE_PRESETS` from
  // `lib/style-presets.mjs` and derives the validator set via
  // `new Set(STYLE_PRESETS.map((p) => p.id))`. This test locks the
  // import + the derivation so a future maintainer who
  // (a) removes the import — every stylePreference write silently
  //     gets rejected by the in-line Set check (fail-closed)
  // (b) hardcodes the 5 ids again — drift between the validator
  //     and the canonical preset list (adding a 6th style would
  //     only update the .mjs file, not the route)
  // surfaces here.
  const src = readFileSync(
    new URL('../../app/api/[[...path]]/route.js', import.meta.url),
    'utf8',
  )
  // 1. The import line — any of the two path forms we use in
  //    this repo (the '@/' alias or the explicit relative path).
  const hasImport = /import\s*\{[^}]*\bSTYLE_PRESETS\b[^}]*\}\s*from\s*['"](@\/lib\/style-presets\.mjs|\.\.\/\.\.\/lib\/style-presets\.mjs|\.\/lib\/style-presets\.mjs|\.\.\/lib\/style-presets\.mjs)['"]/.test(src)
  assert.ok(hasImport, 'Route must import { STYLE_PRESETS } from a style-presets.mjs path')
  // 2. The derivation — the route should call `.map(...)` on
  //    STYLE_PRESETS and the result must include a `.id` property
  //    access (the canonical recipe `STYLE_PRESETS.map((p) => p.id)`).
  //    A hand-rolled literal of 5 ids would NOT match this pattern.
  //    Note: we deliberately avoid the obvious-looking
  //    `STYLE_PRESETS\.map\(([^)]*=>[^)]*\.id[^)]*)\)` form because
  //    the inner parameter parens `(p)` introduce a `)` BEFORE
  //    the `=>`, which the `[^)]*` exclusion would block. The
  //    bounded `.{0,50}\.id` form below handles the inner-`)`
  //    case correctly while still being tight enough to reject
  //    unrelated code that happens to mention `.map(` elsewhere.
  assert.match(
    src,
    /STYLE_PRESETS\.map\([\s\S]{0,60}?\.id[\s\S]{0,5}?\)/,
    'Route must derive the validator set via STYLE_PRESETS.map((p) => p.id) — not a hardcoded literal',
  )
  // 3. The .has() check that the gate uses. Guards against a future
  //    maintainer who replaces the Set with a brittle if-chain.
  assert.match(
    src,
    /ALLOWED_STYLE_IDS\.has\(/,
    'Route must use ALLOWED_STYLE_IDS.has() for the stylePreference gate',
  )
})
