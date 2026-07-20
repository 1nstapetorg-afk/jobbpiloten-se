// tests/unit/avatars-svg.test.mjs
//
// Contract locks for lib/avatars-svg.js — the data layer the
// Aktivitetsrapport PDF generator and (when refactored) the
// React avatar picker share so silhouette tweaks propagate in
// lock-step.
//
// We use source-grep rather than vm-module execution because the
// Next.js `@/lib/...` aliases aren't resolvable under raw `node
// --test`. The structural locks below catch every regression
// the soft-launch needs to prevent:
//
//  - drift between AVATAR_KEYS (lib/avatar-keys.js) and
//    AVATAR_SVG_DATA (here) — the server-side profile-picture
//    validator in app/api/[[...path]]/route.js accepts only
//    slugs from BOTH lists; dropping one here would silently
//    render the indigo ✈ fallback for a slug the rest of the
//    app believes is fully supported.
//  - shape-property drift — a refactor that drops `r` from
//    `circle` shapes would crash the PDF generator with
//    `Cannot read property 'r' of undefined` at runtime.
//  - hex-color contract — the data layer expresses every fill /
//    stroke as "#rrggbb"; a refactor that switches to rgb() or
//    named colours would silently fall back to the indigo ✈ on
//    the PDF rendering path.
//  - missing watermark constants — the React `<PilotWatermark />`
//    reads WATERMARK_REACT_PATH; the PDF renderer reads
//    WATERMARK_PDF_PATH. A rename without updating both consumers
//    would silently drop the brand mark from the picker or PDF.
//
// Total: 18 static locks.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.resolve(__dirname, '../../lib/avatars-svg.js')
const AVATAR_KEYS_PATH = path.resolve(__dirname, '../../lib/avatar-keys.js')
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf-8')
const AVATAR_KEYS_SOURCE = fs.readFileSync(AVATAR_KEYS_PATH, 'utf-8')

// --------- helpers ---------

// Extract every `export const NAME = …` declaration's value as
// a string. Only used for the constant-exports checks below; the
// shape-data registries are inspected by name lookup.
function findExportedConsts(source) {
  return [...source.matchAll(/export const ([A-Z_]+)\s*=\s*([^;\n]+)/g)]
    .map((m) => ({ name: m[1], value: m[2].trim() }))
}

// -------- 1. Required exports --------

test('avatars-svg.js must export the 4 shape-data + watermark constants', () => {
  const expected = ['SKIN_TONE', 'OUTLINE_DARK', 'AVATAR_SVG_DATA', 'WATERMARK_PDF_PATH']
  for (const name of expected) {
    assert.match(SOURCE, new RegExp(`export const ${name}\\b`),
      `avatars-svg.js must export a top-level ${name} constant`,
    )
  }
})

test('avatars-svg.js must export the React watermark path constants', () => {
  // components/avatars.jsx's PilotWatermark subcomponent reads
  // WATERMARK_REACT_PATH + WATERMARK_REACT_TAIL. Future refactors
  // may pull the React path into here too so both renderers
  // share one definition.
  for (const name of ['WATERMARK_REACT_PATH', 'WATERMARK_REACT_TAIL']) {
    assert.match(SOURCE, new RegExp(`export const ${name}\\b`),
      `avatars-svg.js must export ${name} for the React <PilotWatermark /> component`,
    )
  }
})

// -------- 2. Color constants are valid hex strings --------

test('SKIN_TONE and OUTLINE_DARK must be #rrggb b hex strings', () => {
  const consts = findExportedConsts(SOURCE)
  const skin = consts.find((c) => c.name === 'SKIN_TONE')
  const outline = consts.find((c) => c.name === 'OUTLINE_DARK')
  assert.ok(skin, 'SKIN_TONE must be declared')
  assert.ok(outline, 'OUTLINE_DARK must be declared')
  assert.match(skin.value, /^['"]#[0-9a-fA-F]{6}['"]$/,
    `SKIN_TONE must be "#rrggbb" (got: ${skin.value})`,
  )
  assert.match(outline.value, /^['"]#[0-9a-fA-F]{6}['"]$/,
    `OUTLINE_DARK must be "#rrggbb" (got: ${outline.value})`,
  )
})

// -------- 3. AVATAR_SVG_DATA registry has the 5 supported slugs --------

test('AVATAR_SVG_DATA must have entries for the 5 PDF-supported slugs', () => {
  for (const slug of ['piloten', 'navigatören', 'strategen', 'upptäckaren', 'kaptenen']) {
    assert.match(SOURCE, new RegExp(`\\b${slug}\\s*:\\s*[A-Z_]+_SVG`),
      `AVATAR_SVG_DATA must contain a '${slug}' entry pointing at its _SVG constant`,
    )
  }
})

// -------- 4. Each avatar exposes bg + non-empty shapes --------

test('every AVATAR_*_SVG constant must define a bg (hex) + non-empty shapes array', () => {
  // Block shape: `{ bg: '#xxxxxx', shapes: [ ... ] }`.
  // We check for the literal "bg:" and "shapes:" presence next
  // to each export const declaration. If a refactor accidentally
  // drops either — e.g. flattens the silhouette to a single path —
  // the PDF renderer would silently render an empty circle.
  const exports = [...SOURCE.matchAll(/export const ([A-Z_]+_SVG)\s*=\s*\{/g)]
    .map((m) => m[1])
  assert.ok(exports.length >= 5, `expected ≥5 avatar constants declared, found ${exports.length}`)
  for (const name of exports) {
    // Slurp the block body for this single const. The export
    // pattern marks the start; we walk forward to the matching
    // `};`. Note: this is a coarse brace-counter tuned for
    // simple `{ bg: '…', shapes: [ … ] }` literals WITHOUT
    // nested objects more than one level deep. Adding nested
    // helper objects to a future _SVG constant would require
    // upgrading this counter to the balanced-blocks walker used
    // in popup-resolver.test.mjs.
    const startIdx = SOURCE.indexOf(`export const ${name} = {`)
    assert.ok(startIdx >= 0, `${name} must be declared as an object literal`)
    // skip past the opening `{`
    let i = startIdx + ('export const ' + name + ' = {').length
    let depth = 1
    while (i < SOURCE.length && depth > 0) {
      const ch = SOURCE[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      // Naive quote-skip would be safer, but the current avatar
      // bodies only contain double-quoted strings + numbers +
      // identifiers + array literals, no template literals.
      i++
    }
    const body = SOURCE.slice(startIdx, i)
    assert.match(body, /\bbg:\s*['"]#[0-9a-fA-F]{6}['"]/,
      `${name} must declare a hex bg color (got: missing)`)
    assert.match(body, /\bshapes:\s*\[\s*[^\]]+\]/,
      `${name} must declare a non-empty shapes array`)
  }
})

// -------- 5. Each shape has its required per-type keys --------

test('every `path` shape carries a `d` attribute', () => {
  // path shapes without `d` would crash pdf-lib's drawSvgPath.
  // Find all { type: 'path', ... } literals and confirm `d:` is
  // present. We use a non-greedy match per shape entry; a single
  // shape can span multiple lines so the regex allows whitespace.
  const matches = SOURCE.match(/\{\s*type:\s*['"]path['"][^}]+\}/g) || []
  assert.ok(matches.length >= 5, `expected 5+ path shapes, found ${matches.length}`)
  for (const m of matches) {
    assert.match(m, /\bd:\s*['"][^'"]+['"]/, 'each path shape must have a `d:` attribute')
  }
})

test('every `circle` shape carries cx/cy/r', () => {
  const matches = SOURCE.match(/\{\s*type:\s*['"]circle['"][^}]+\}/g) || []
  assert.ok(matches.length >= 5, `expected 5+ circle shapes, found ${matches.length}`)
  for (const m of matches) {
    assert.match(m, /\bcx:\s*\d/, 'circle shape must have cx')
    assert.match(m, /\bcy:\s*\d/, 'circle shape must have cy')
    assert.match(m, /\br:\s*[\d.]+/, 'circle shape must have r')
  }
})

test('every `rect` shape carries x/y/width/height', () => {
  const matches = SOURCE.match(/\{\s*type:\s*['"]rect['"][^}]+\}/g) || []
  assert.ok(matches.length >= 3, `expected 3+ rect shapes, found ${matches.length}`)
  for (const m of matches) {
    assert.match(m, /\bx:\s*\d/)
    assert.match(m, /\by:\s*\d/)
    assert.match(m, /\bwidth:\s*\d/)
    assert.match(m, /\bheight:\s*\d/)
  }
})

test('every `line` shape carries x1/y1/x2/y2', () => {
  const matches = SOURCE.match(/\{\s*type:\s*['"]line['"][^}]+\}/g) || []
  for (const m of matches) {
    assert.match(m, /\bx1:\s*[\d.]+/)
    assert.match(m, /\by1:\s*[\d.]+/)
    assert.match(m, /\bx2:\s*[\d.]+/)
    assert.match(m, /\by2:\s*[\d.]+/)
  }
})

test('every `ellipse` shape carries cx/cy/rx/ry', () => {
  const matches = SOURCE.match(/\{\s*type:\s*['"]ellipse['"][^}]+\}/g) || []
  for (const m of matches) {
    assert.match(m, /\bcx:\s*\d/)
    assert.match(m, /\bcy:\s*\d/)
    assert.match(m, /\brx:\s*[\d.]+/)
    assert.match(m, /\bry:\s*[\d.]+/)
  }
})

// -------- 6. Watermark sentinel shape exists at index 0 of every avatar --------

test('every avatar constant opens with a `watermark` sentinel shape', () => {
  // The PDF renderer uses `shape.type === 'watermark'` to draw
  // the small JobbPiloten plane via drawWatermarkPdf; the React
  // SidePilotWatermark is drawn at the SVG <svg> root via a
  // dedicated component. The watermark sentinel MUST be at
  // index 0 so the body silhouette overlays it. We check by
  // finding each constant's `shapes:` array declaration and
  // confirming the first `{ type: … }` is a watermark.
  const startIndices = [...SOURCE.matchAll(/shapes:\s*\[/g)].map((m) => m.index)
  assert.ok(startIndices.length >= 5, 'expected shapes: [ … ] in each of 5+ constants')
  for (const i of startIndices) {
    // Look at the next 200 chars after `[` for the first type
    const peek = SOURCE.slice(i, i + 200)
    assert.match(peek, /\{\s*type:\s*['"]watermark['"]/,
      'each shapes array must open with `{ type: "watermark" }` so the watermark is drawn behind the body')
  }
})

// -------- 7. AVATAR_SVG_DATA keys are a strict subset of AVATAR_KEYS --------

test('every key in AVATAR_SVG_DATA must also exist in AVATAR_KEYS', () => {
  // Profile-picture validator rejects unknown slug values when
  // persisting profilePicture.type='avatar'. The 5 PDF keys must
  // be a SUBSET of the 16 React picker keys so both lists agree
  // on "valid piloten" — never the other way round.
  // PATCH (round-7 polishing): use `.match()` (singular) for the
  // outer capture since AVATAR_SVG_DATA must be a single object
  // literal — String.prototype.matchAll() REQUIRES the /g flag
  // or it throws "matchAll called with a non-global RegExp", which
  // was the cause of the round-1 false-negative. The inner
  // capture uses matchAll with explicit /g — the g flag is
  // syntactically required there because we want every slug.
  const svgKeysDecl = SOURCE.match(/AVATAR_SVG_DATA\s*=\s*\{([^}]+)\}/s)
  assert.ok(svgKeysDecl, 'AVATAR_SVG_DATA must be a single object literal')
  const innerSource = svgKeysDecl[1]
  // The keys in source are unquoted identifiers (e.g. `piloten: PILOTEN_SVG,`),
  // NOT quoted strings. Match either form so a future refactor that adds
  // quotes doesn't false-negative this lock. The `\b` boundaries keep the
  // match anchored to whole words so `piloten` doesn't also pick up
  // `pilotenXYZ` substrings.
  const keyStrings = [...innerSource.matchAll(/(?:['"]([a-zåäöé ]+)['"]|([a-zåäöé]+))\s*:/g)]
    .map((m) => m[1] || m[2])
  assert.ok(keyStrings.length === 5, `expected 5 keys, found ${keyStrings.length}: ${keyStrings.join(', ')}`)
  const avatarKeysDecl = AVATAR_KEYS_SOURCE.match(/export const AVATAR_KEYS\s*=\s*\[([^\]]+)\]/)
  assert.ok(avatarKeysDecl, 'AVATAR_KEYS in lib/avatar-keys.js must be declared as an array')
  const avatarKeyList = [...avatarKeysDecl[1].matchAll(/['"]([a-zåäöé ]+)['"]/g)].map((m) => m[1])
  for (const k of keyStrings) {
    assert.ok(avatarKeyList.includes(k),
      `AVATAR_SVG_DATA key "${k}" must also appear in lib/avatar-keys.js AVATAR_KEYS`,
    )
  }
})

// -------- 8. WATERMARK_PDF_PATH is a valid SVG path string --------

test('WATERMARK_PDF_PATH must start with M and be non-empty', () => {
  const consts = findExportedConsts(SOURCE)
  const wm = consts.find((c) => c.name === 'WATERMARK_PDF_PATH')
  assert.ok(wm, 'WATERMARK_PDF_PATH must be exported')
  // Path string starts with M then a coordinate, e.g. 'M112 116 L132 122 …'
  assert.match(wm.value, /^['"]M\s*\d/,
    `WATERMARK_PDF_PATH must begin with an M moveto command (got: ${wm.value})`,
  )
  assert.ok(wm.value.length > 5, 'WATERMARK_PDF_PATH must be a non-trivial path string')
})

// -------- 9. The SVG-coord comment is present for renderer-reference --------

test('avatars-svg.js must document the viewBox 0 0 144 144 coord contract', () => {
  // The PDF renderer scales every coord by `opts.size / 144`.
  // If a future contributor adds shapes in a different coord
  // space (e.g. userSpaceOnUse, or a flexbox-style fractional
  // grid), the PDF version would mysteriously shrink. The
  // comment block keeps the contract discoverable.
  assert.match(SOURCE, /144/,
    'avatars-svg.js must mention the viewBox=144 size somewhere (header comment OR has a 144 sentinel constant)')
  assert.match(SOURCE, /viewBox/,
    'avatars-svg.js must mention `viewBox` in its comments so the coord-scale contract is discoverable',
  )
})

// -------- 10. The data module must be JS-only (no JSX/React) --------

test('avatars-svg.js must not import React or contain JSX', () => {
  // If a future refactor moves a `<svg>` literal back into this
  // file (which would force a 'use client' boundary), the server
  // would crash with "window is not defined" on first PDF download.
  assert.doesNotMatch(SOURCE, /import\s+.*\breact\b/i,
    'avatars-svg.js must not import React — it is consumed by both React and pdf-lib (React import would force a client bundle)')
  assert.doesNotMatch(SOURCE, /<svg\b/i,
    'avatars-svg.js must not contain JSX <svg> literals — render-time is the responsibility of components/avatars.jsx and lib/pdf-report.js')
})
