// 2026-07-21 (Round-73 / BUG A verification / ITEM 4)
// STATIC-TEXT assertion (NOT a VM-sandbox roundtrip).
//
// The previous implementation tried to load popup.js in a vm
// sandbox with mocked chrome.* APIs + a synchronous onChanged fire,
// but the test was brittle: the synchronous onChanged was swallowed
// by the mock's own try/catch, the dynamic ESM import chain
// (./lib/dashboard-url-resolver.js, etc.) failed for unrelated
// reasons before reaching the rename site, and the trailing
// `assert.ok(true)` was unconditional theatre. The code-reviewer
// flagged the file as failing to detect a real regression.
//
// This replacement asserts the rename directly on the source.
// A regression that re-introduces `const connected` block-scope
// OR removes the breadcrumb OR drops `isConnected` would flip
// at least one of these. Reads <5KB; runs in <50ms.
//
// Locked by: extension/popup.js + content.js FIELD_PATTERNS

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const POPUP_JS = resolve(__dirname, '../../extension/popup.js')
const CONTENT_JS = resolve(__dirname, '../../extension/content.js')

test('Round-73 / BUG A: block-scoped const connected removed from popup.js', () => {
  const src = readFileSync(POPUP_JS, 'utf8')
  // Find any line declaring `const connected` — the pre-fix shape
  // had EXACTLY one declaration inside loadAndPaint at the renamed
  // location (was ~3134). Post-fix it must be ZERO.
  const matches = src.match(/^\s*const\s+connected\s*=/gm) || []
  assert.equal(
    matches.length,
    0,
    `popup.js must not declare block-scoped "const connected" — was the TDZ shadow. Found ${matches.length} occurrence(s).`,
  )
})

test('Round-73 / BUG A: rename uses isConnected in loadAndPaint', () => {
  const src = readFileSync(POPUP_JS, 'utf8')
  assert.match(
    src,
    /\bconst\s+isConnected\s*=\s*!!token\s*&&\s*!!profile\b/,
    'loadAndPaint must declare isConnected = !!token && !!profile',
  )
})

test('Round-73 / BUG A: module-level var connected stays at line 35', () => {
  const src = readFileSync(POPUP_JS, 'utf8')
  // The hoisted declaration must be `var`, not `let`/`const`.
  // This enforces the Round-72.2 invariant that the module-binding
  // is NOT block-scoped (TDZ-free).
  assert.match(
    src,
    /^var\s+connected\s*=\s*false\b/m,
    'popup.js must declare module-level var connected = false',
  )
})

test('Round-73 / BUG A: breadcrumb comment references Round-73 / BUG A', () => {
  const src = readFileSync(POPUP_JS, 'utf8')
  assert.match(
    src,
    /Round-73\s*\/\s*BUG\s*A/,
    'rename breadcrumb comment must reference Round-73 / BUG A',
  )
})

test('Round-73 / BUG F: split nuvarande arbete patterns present', () => {
  const src = readFileSync(CONTENT_JS, 'utf8')
  // The Round-73 / BUG F addition routed "Nuvarande titel" /
  // "Current title" to currentJobTitle and "Nuvarande
  // arbetsgivare" / "Current employer" to currentOrganization.
  // These are the split patterns; the combined fallback remains.
  assert.match(
    src,
    /profileKey:\s*['"]currentJobTitle['"]/,
    'content.js must route Nuvarande titel to currentJobTitle',
  )
  assert.match(
    src,
    /profileKey:\s*['"]currentOrganization['"]/,
    'content.js must route Nuvarande arbetsgivare to currentOrganization',
  )
})
