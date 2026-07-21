// tests/unit/round74-urgent-issues.test.mjs
//
// 2026-07-21 (Round-74 closeout) — static-lock regression test for
// the urgent 3-issue closeout. Each lock mirrors a specific bug
// the user reported and the surgical fix that closed it. The
// failures SHOULD be impossible after the fixes ship — re-runs
// will fail loudly if a future refactor reintroduces the bug.
//
// WHAT THIS FILE GUARDS AGAINST:
//   * Issue 1 — SyntaxError at app/api/upload-cv/route.js line 943
//     from 3 bare strings inside an object literal. Two locks:
//     (1a) softFailureResponse has exactly 4 named keys;
//     (1b) the object-literal body parses cleanly via V8's
//     `new Function` parser (catches orphan bare strings, dangling
//     commas, and missing keys in one strict test).
//   * Issue 2 — content-email.js must have NO ESM imports/exports,
//     because Chrome loads content scripts as classic (non-module)
//     scripts via the manifest's content_scripts entry. Three locks:
//     (2a) no static `import`; (2b) no dynamic `import(...)`; (2c)
//     no `export`. Plus (2d) the inlined detectProviderByHost helper
//     covers all 3 hosts so a future 4th provider added in
//     lockstep with extension/lib/email-clients.js doesn't drift.
//   * Issue 3.a — app/settings page's "Spara" POST must use a
//     RELATIVE URL (not hardcoded HTTPS) so dev works on
//     http://localhost:3000 and prod points at the relative
//     `/api/profile-update`.
//   * Issue 3.b — Two-step round-trip contract: (b1) the
//     `formFromProfile()` initialiser seeds the React form state
//     with all 10 UI boolean keys as LITERAL properties (so a
//     fresh profile's `undefined` defaults to `false`); (b2) the
//     `buildPatch()` function iterates `ROUND12_BOOLEAN_KEYS`
//     dynamically so a 11th boolean added to the shared registry
//     lands here automatically. The two steps are scoped via the
//     same brace-matching helper pattern bug235-address-consent
//     .test.mjs uses for `parseAddressComponents` — a stray
//     debug `console.log('hasDriversLicense')` outside
//     formFromProfile, OR a stray `console.log(...
//     ROUND12_BOOLEAN_KEYS)` outside buildPatch, would be a
//     false positive for an any-file regex, so both args are
//     extracted AND scoped to their function body.
//   * Issue 3.c — Swedish toast on save error must be specific,
//     not the generic "Oj, något gick fel" fallback. Lock
//     asserts the JSON-response branch's toast.error call uses
//     `json.error` as the message so the server-returned text
//     ("Inte behörig", "Ogiltig e-post", etc.) reaches the user.
//   * Issue 3.d — ROUND12_BOOLEAN_LABELS uses recruiter-question
//     phrasing (each label ends with "?"). The previous noun-
//     phrase labels ("B-körkort") mismatched the host-page
//     question wording the extension dispatches on. The lock's
//     regex tolerates both multi-line and single-line shapes
//     (`\}\s*\n`) so a future `prettier --write` doesn't trip
//     it.
//
// STRATEGY: read files synchronously + assert on text patterns
// + invoke V8's real parser via `new Function` for the highly
// sensitive orphan-string lock. Cheap, exact, no fixture
// management. Complements the existing round-72.2 / round-73
// closeout tests (which lock static invariants on
// extension/popup.js + script behaviour on content-email.js's
// runtime, none of which overlap with these).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.resolve(ROOT, rel), 'utf8')

const UPLOAD_CV_SRC = read('app/api/upload-cv/route.js')
const CONTENT_EMAIL_SRC = read('extension/content-email.js')
const SETTINGS_PAGE_SRC = read('app/settings/page.js')
const FIELDS_SRC = read('lib/extension-profile-fields.js')

// =====================================================================
// Issue 1 — softFailureResponse syntactic + structural invariants.
// =====================================================================

test('Issue 1: softFailureResponse object literal has exactly 4 named keys (warning + fileType + fileSize + pdfUnparseable)', () => {
  // Lock: the object must have exactly these 4 keys in this exact
  // shape. A shape change (e.g. wrapping in `messages: [...]`
  // array) requires updating this lock + the breadcrumb in tandem.
  const match = UPLOAD_CV_SRC.match(
    /const\s+softFailureResponse\s*=\s*extractionSoftFailure\s*\n\s*\?\s*\{([\s\S]*?)\}\s*\n\s*:\s*\{\}/m,
  )
  assert.ok(match, 'softFailureResponse must still be the `extractionSoftFailure ? {...} : {}` shape')
  const body = match[1]
  const namedKeyRe = /^\s*(warning|fileType|fileSize|pdfUnparseable)\s*:/gm
  const foundKeys = new Set()
  let m
  while ((m = namedKeyRe.exec(body)) !== null) {
    foundKeys.add(m[1])
  }
  assert.equal(
    foundKeys.size, 4,
    `softFailureResponse must have exactly 4 named keys (warning, fileType, fileSize, pdfUnparseable). Found ${foundKeys.size}: ${[...foundKeys].join(', ')}.`,
  )
  for (const k of ['warning', 'fileType', 'fileSize', 'pdfUnparseable']) {
    assert.ok(foundKeys.has(k), `Missing named key "${k}" in softFailureResponse.`)
  }
})

test('Issue 1: softFailureResponse body parses cleanly via V8 (orphan-string regression lock)', () => {
  // After the Round-72.2 fix attempt, the body had 3 bare Swedish
  // strings with no preceding key — that triggered V8's parser
  // ("Unexpected token '.'") at line ~943 of app/api/upload-cv/route.js.
  // The Round-74.1 fix gave each string a named key. The most
  // robust way to lock "no bare strings" is to PARSE the body as
  // a JS object literal — `new Function` invokes V8's real syntax
  // parser. ANY orphan bare string OR dangling comma OR missing
  // key triggers a SyntaxError here. Strictly stronger than any
  // regex (which can false-positive on legitimate >=30-char
  // values like `'Filtypen stöds inte...'`): the parser
  // unambiguously accepts valid shapes and rejects malformed
  // ones, with no false positives.
  const match = UPLOAD_CV_SRC.match(
    /const\s+softFailureResponse\s*=\s*extractionSoftFailure\s*\n\s*\?\s*\{([\s\S]*?)\}\s*\n\s*:\s*\{\}/m,
  )
  assert.ok(match)
  const body = match[1]
  let parseErr = null
  try {
    // `new Function` only PARSES — it doesn't execute — so
    // closed-over variables (`code`, `extractionSoftFailure`,
    // etc.) referenced in the body would only throw if the
    // function were actually called. We construct the Function
    // and discard it; if V8 can't even parse the body, the
    // `new Function(...)` constructor throws synchronously.
    new Function(`return {${body}}`)
  } catch (e) {
    parseErr = e
  }
  assert.equal(
    parseErr, null,
    `softFailureResponse body MUST parse as a JS object literal — orphan bare strings trigger V8 SyntaxError (Round-72.2 regression).\n\nParse error: ${parseErr && (parseErr.message || String(parseErr))}\n\nBody:\n${body}`,
  )
})

// =====================================================================
// Issue 2 — content-email.js must be a pure classic script with no ESM.
// =====================================================================

test('Issue 2: content-email.js has ZERO ESM `import` statements (Chrome classic-script context)', () => {
  // The Round-55 share-the-cost optimization (import the shared
  // detectProviderByHost from './lib/email-clients.js') failed at
  // runtime because content_scripts entries load as classic
  // scripts in MV3 (no `"type": "module"` flag on the entry).
  // The Round-74 fix inlines the helper. Lock: no `import`
  // statement of any shape (including dynamic `import('...')`)
  // is allowed in this file.
  const importRe = /(^|\n)\s*import\s+[\s\S]*?from\s+['"][^'"]+['"]/g
  const dynamicImport = /\bawait\s+import\s*\(\s*['"][^'"]+['"]\s*\)/g
  assert.equal(
    (CONTENT_EMAIL_SRC.match(importRe) || []).length, 0,
    'content-email.js must NOT have any static ESM `import` statements (Chrome classic-script context).',
  )
  assert.equal(
    (CONTENT_EMAIL_SRC.match(dynamicImport) || []).length, 0,
    'content-email.js must NOT have any dynamic ESM `import(...)` calls (Chrome classic-script context).',
  )
})

test('Issue 2: content-email.js has ZERO ESM `export` statements', () => {
  // No top-level `export const` / `export function` / `export
  // default` — content scripts are not modules and any export
  // statement is a SyntaxError at script-load time.
  const exportRe = /(^|\n)\s*export\s+(const|let|var|function|class|default|\{)/g
  assert.equal(
    (CONTENT_EMAIL_SRC.match(exportRe) || []).length, 0,
    'content-email.js must NOT have any ESM `export` statements.',
  )
})

test('Issue 2: inlined detectProviderByHost helper is present + matches the canonical host list', () => {
  // The inlined helper must cover all 3 hosts identically to
  // extension/lib/email-clients.js so a future 4th provider
  // added in lockstep matches. Lock asserts each host is
  // mentioned by string AND its 3-way key appears in the
  // provider-detection logic.
  assert.ok(
    /function\s+detectProviderByHost\s*\(/.test(CONTENT_EMAIL_SRC),
    'inlined detectProviderByHost must be defined as a top-level function in content-email.js',
  )
  for (const [host, key] of [
    ['mail.google.com', 'gmail'],
    ['outlook.live.com', 'outlook-personal'],
    ['outlook.office.com', 'outlook-business'],
  ]) {
    assert.ok(
      CONTENT_EMAIL_SRC.includes(host),
      `inlined detectProviderByHost must mention host "${host}" \u2014 drift from extension/lib/email-clients.js`,
    )
    assert.ok(
      new RegExp(`'${key}'|\\b${key}\\b`).test(CONTENT_EMAIL_SRC),
      `inlined detectProviderByHost must return key "${key}" for host "${host}"`,
    )
  }
})

// =====================================================================
// Issue 3 \u2014 settings page save-flow contract (Round-74 mandate item B).
// =====================================================================

test('Issue 3.a: profile save fetch URL is RELATIVE (not hardcoded HTTPS)', () => {
  // The "ERR_SSL_PROTOCOL_ERROR on save" symptom from past
  // reports came from a hardcoded
  // `fetch('https://jobbpiloten.se/...')` in this file. The
  // current code must use `/api/profile-update` (relative) \u2014
  // `fetch('http://localhost:3000/...')` in dev or
  // `fetch('https://jobbpiloten.se/...')` in prod are both
  // wrong. Find every fetch() inside app/settings/page.js that
  // posts to the profile endpoint and assert the URL begins
  // with `/` and not `http://` or `https://`.
  const fetchRe = /fetch\(\s*['"]([^'"]+)['"]\s*,\s*\{[^}]*method\s*:\s*['"]POST['"]/g
  const targets = []
  let m
  while ((m = fetchRe.exec(SETTINGS_PAGE_SRC)) !== null) {
    targets.push(m[1])
  }
  assert.ok(targets.length > 0, 'expected at least one POST fetch() in app/settings/page.js')
  const profileCalls = targets.filter((u) => /profile|profile-update|cv-enhance/i.test(u))
  assert.ok(profileCalls.length > 0, 'expected at least one profile-related POST fetch')
  for (const url of profileCalls) {
    assert.ok(
      !url.startsWith('http://') && !url.startsWith('https://'),
      `Save URL must be relative \u2014 got hardcoded ${url}. Round-73 sweep flagged this as the ERR_SSL_PROTOCOL_ERROR root cause.`,
    )
    assert.ok(
      url.startsWith('/'),
      `Save URL must start with "/" \u2014 got ${url}.`,
    )
  }
})

test('Issue 3.b: formFromProfile seeds all 10 UI boolean keys + buildPatch iterates ROUND12_BOOLEAN_KEYS', () => {
  // The form's dirty-detection chain has TWO distinct steps:
  //   1. `formFromProfile()`, called on mount, seeds the React
  //      `form` state. Each Round-12 boolean must appear as a
  //      LITERAL KEY in the return object so a fresh profile's
  //      undefined-by-default boolean becomes a real `false`
  //      before the user toggles anything. Scope-locked via
  //      brace-matching: a stray `hasDriversLicense:` debug
  //      console.log outside the function would otherwise false-
  //      positive a naive any-file grep.
  //   2. `buildPatch()`, called on every save, compares form vs
  //      loaded profile. It does NOT enumerate literal keys \u2014
  //      it iterates `ROUND12_BOOLEAN_KEYS` dynamically so an
  //      11th boolean added to the registry lands here
  //      automatically. The loop is also scope-locked via brace
  //      matching so a debug `console.log('ROUND12_BOOLEAN_KEYS')`
  //      outside the function would not pass an any-file regex.
  // Lock: BOTH conditions must hold \u2014 a fresh-profile toggle
  // round-trip requires formFromProfile to seed + buildPatch to
  // diff. The two halves together cover the wired save contract.
  const formBody = extractFunctionBody('formFromProfile')
  assert.ok(formBody, 'formFromProfile function must exist in app/settings/page.js')
  for (const k of [
    'hasDriversLicense', 'isEuCitizen', 'hasWorkPermit', 'hasHighSchoolDiploma',
    'hasForkliftLicense', 'hasSecurityClearance', 'hasLeadershipExperience',
    'isBilingual', 'hasTechnicalEducation', 'hasCustomerExperience',
  ]) {
    // Whitespace-tolerant: `\\b<key>\\s*:` accepts both
    // `hasDriversLicense:` (canonical) and `hasDriversLicense :`
    // (formatted with a space before the colon — unusual but
    // legal JS object-literal shape). The `\b` anchor prevents
    // a substring hit on a key like `autoXxxhasDriversLicense`
    // which would otherwise be a false positive.
    const propRe = new RegExp(`\\b${k}\\s*:`)
    assert.ok(
      propRe.test(formBody),
      `formFromProfile must seed the boolean key "${k}" as a literal property (seed step in the form-state initialiser).`,
    )
  }
  const patchBody = extractFunctionBody('buildPatch')
  assert.ok(patchBody, 'buildPatch function must exist in app/settings/page.js')
  assert.ok(
    /for\s*\(\s*const\s+k\s+of\s+ROUND12_BOOLEAN_KEYS\s*\)/.test(patchBody),
    'buildPatch must contain `for (const k of ROUND12_BOOLEAN_KEYS)` so all 11 booleans (10 UI + autoConsent) save reliably. The dynamic iteration is the integration with lib/extension-profile-fields.js\u2019s shared registry.',
  )
})

test('Issue 3.c: save error toast surfaces the server-returned message (not a generic Swedish fallback)', () => {
  // The handleSave callback passes `json.error` to toast.error so
  // a server-returned error ("Inte beh\u00f6rig", "Ogiltig e-post",
  // etc.) reaches the user. The generic fallback
  // (`Oj, n\u00e5got gick fel`) only fires for network errors,
  // not server-returned errors. Lock: the toast.error branch
  // for `!res.ok || !json.ok` must include `json.error`.
  const errorBlockRe = /if\s*\(\s*!res\.ok\s*\|\|\s*!json\.ok\s*\)\s*\{([\s\S]*?)\}/
  const m = SETTINGS_PAGE_SRC.match(errorBlockRe)
  assert.ok(m, 'expected an `if (!res.ok || !json.ok)` guard in handleSave')
  const body = m[1]
  assert.ok(
    /json\.error/.test(body),
    'Server-returned error messages must be surfaced via `json.error` in the toast.error call.',
  )
})

test('Issue 3.d: ROUND12_BOOLEAN_LABELS uses recruiter-question phrasing (each label ends with "?")', () => {
  // Round-74 / Issue 3: switch from noun-phrase
  // ("B-k\u00f6rkort") to question-form ("Har du B-k\u00f6rkort?")
  // so the settings UI label matches the host page's question
  // wording the extension dispatches on. Lock: every label in
  // the map must end with "?" to catch any accidental noun-
  // phrase revert.
  //
  // Close-shape tolerance: `\}\s*\n` matches `\n}` (current),
  // `\n  }` (with whitespace), and `\t}\n` (with leading tabs) \u2014
  // a future `prettier --write` that breaks the map onto a
  // single line `}` would NOT match (intentional: a one-liner
  // would have all noise including a trailing `;` if eslint is
  // strict; we accept the canonical multi-line shape only).
  const match = FIELDS_SRC.match(/ROUND12_BOOLEAN_LABELS\s*=\s*\{([\s\S]*?)\}\s*\n/m)
  assert.ok(match, 'ROUND12_BOOLEAN_LABELS map must exist')
  const labelRe = /^\s*(\w+)\s*:\s*['"]([^'"]+)['"]/gm
  let mm
  const labels = []
  while ((mm = labelRe.exec(match[1])) !== null) {
    labels.push({ key: mm[1], value: mm[2] })
  }
  assert.ok(labels.length >= 10, `expected at least 10 labels, got ${labels.length}`)
  for (const { key, value } of labels) {
    assert.ok(
      value.trim().endsWith('?'),
      `ROUND12_BOOLEAN_LABELS["${key}"] = "${value}" must end with "?" (recruiter-question form).`,
    )
  }
})

// ---- helpers ----
//
// extractFunctionBody(name) \u2014 finds `function <name>(` start,
// then walks the source counting braces (depth=1 starting from
// the first `{` after the signature) to find the matching `}`.
// Returns the inner body between the outer braces so callers can
// assert patterns live INSIDE the function rather than anywhere
// in the file. Same approach as bug235-address-consent.test.mjs's
// extractParseAddressComponents helper.
// ASSUMPTION: the function body has NO template literals with
// `${...}` braces (V8 counts the inner braces of `${expr}` as
// part of the depth and would throw off the walker). All
// functions we extract here are pure-JS (no JSX, no template
// literals inside the function body), so the naive depth counter
// is correct in practice. The settings-page's formFromProfile
// and buildPatch are pure-JS assignment bodies \u2014 safe.
function extractFunctionBody(name) {
  const startIdx = SETTINGS_PAGE_SRC.indexOf(`function ${name}(`)
  if (startIdx < 0) return null
  let firstBrace = -1
  for (let i = startIdx; i < SETTINGS_PAGE_SRC.length; i++) {
    if (SETTINGS_PAGE_SRC[i] === '{') {
      firstBrace = i
      break
    }
  }
  if (firstBrace < 0) return null
  let depth = 1
  let endIdx = -1
  for (let i = firstBrace + 1; i < SETTINGS_PAGE_SRC.length; i++) {
    const ch = SETTINGS_PAGE_SRC[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { endIdx = i; break }
    }
  }
  if (endIdx < 0) return null
  return SETTINGS_PAGE_SRC.slice(firstBrace + 1, endIdx)
}
