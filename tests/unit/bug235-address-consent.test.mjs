// tests/unit/bug235-address-consent.test.mjs
//
// 2026-07-21 — Regression locks for the second wave of bugs
// the user reported after testing on 8 real Swedish job forms.
// Each fix is anchored to a BUG-N prefix in the source.
//
// BUG 2 — Email/phone not filled on 7/8 forms
//   Pre-fix patterns missed Swedish variants like "Mejladress"
//   (email) and "Mobilnummer" (phone). The fix extends both
//   alternations without breaking existing matches.
//
// BUG 3 — Address overfill
//   Pre-fix returned "Sverige" as city (last comma segment) on
//   the canonical Swedish "<street>, <city>, <123 45>, <Country>"
//   shape and the FULL string as city on a single-part address.
//   The fix introduces parseAddressComponents() + dedicated
//   `street` + `country` FIELD_PATTERNS entries.
//
// BUG 5 — Consent boxes left unchecked
//   Pre-fix consent pattern required the multi-clause "jag har
//   läst ... godkänner" shape; plain "Jag godkänner" was missed.
//   The fix adds three plain alternations.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXT_PATH = path.resolve(__dirname, '../../extension/content.js')
const PROF_PATH = path.resolve(__dirname, '../../lib/extension-profile.js')
const EXT_SRC = fs.readFileSync(EXT_PATH, 'utf8')
const PROF_SRC = fs.readFileSync(PROF_PATH, 'utf8')

// ---------------------------------------------------------------------------
// BUG 2 — broader email + phone patterns
// ---------------------------------------------------------------------------

test('BUG 2: email pattern must match standard Swedish + English label variants', () => {
  const m = EXT_SRC.match(
    /\{ pattern: \/([^/]+)\/i, profileKey: 'email' \}/
  )
  assert.ok(m, 'FIELD_PATTERNS must have a profileKey: "email" entry')
  const re = new RegExp(m[1], 'i')
  for (const label of ['Mejladress', 'E-post', 'E-postadress', 'E-mailadress', 'E-mail', 'Email', 'Mail', 'Mailadress']) {
    assert.ok(
      re.test(label),
      `BUG 2 regression: email pattern /${m[1]}/ did not match "${label}"`,
    )
  }
})

test('BUG 2: phone pattern must match Swedish "Mobilnummer" + English "Cell phone"', () => {
  const m = EXT_SRC.match(
    /\{ pattern: \/([^/]+)\/i, profileKey: 'phone' \}/
  )
  assert.ok(m, 'FIELD_PATTERNS must have a profileKey: "phone" entry')
  const re = new RegExp(m[1], 'i')
  for (const label of ['Telefon', 'Telefonnummer', 'Mobilnummer', 'Mobil', 'Mobile', 'Phone', 'Cell phone', 'Cellphone', 'Cell']) {
    assert.ok(
      re.test(label),
      `BUG 2 regression: phone pattern /${m[1]}/ did not match "${label}"`,
    )
  }
})

// ---------------------------------------------------------------------------
// BUG 3 — address parser + dedicated street/country FIELD_PATTERNS
// ---------------------------------------------------------------------------

test('BUG 3: parseAddressComponents() is defined in the profile builder', () => {
  assert.ok(
    /function\s+parseAddressComponents\s*\(/.test(PROF_SRC),
    'BUG 3 regression: parseAddressComponents() helper missing — content.js would dump the full address into every UI field',
  )
})

test('BUG 3: parseAddressComponents() returns the correct split on the canonical Swedish 4-part address', () => {
  const fn = extractParseAddressComponents()
  const r = fn('Hjällbogården 30, Angered, 424 36, Sverige')
  assert.deepEqual(
    r,
    { street: 'Hjällbogården 30', zip: '424 36', city: 'Angered', country: 'Sverige' },
    `BUG 3 regression: mis-parsed canonical Swedish address. Got ${JSON.stringify(r)}`,
  )
})

test('BUG 3: parseAddressComponents() peels a trailing ZIP off a single-segment address', () => {
  const fn = extractParseAddressComponents()
  const r = fn('Storgatan 1 111 22')
  assert.equal(r.zip, '111 22', 'trailing ZIP must be peeled off a single-segment address')
  assert.ok(
    r.street.startsWith('Storgatan'),
    `street should start with "Storgatan"; got "${r.street}"`,
  )
})

test('BUG 3: parseAddressComponents() returns a safe empty object on null/empty input', () => {
  const fn = extractParseAddressComponents()
  assert.deepEqual(fn(null), { street: '', zip: '', city: '', country: '' })
  assert.deepEqual(fn(''), { street: '', zip: '', city: '', country: '' })
  assert.deepEqual(fn('   '), { street: '', zip: '', city: '', country: '' })
})

test('BUG 3: content.js FIELD_PATTERNS must include a `street` profileKey entry', () => {
  assert.ok(
    /profileKey:\s*'street'/.test(EXT_SRC),
    'BUG 3 regression: FIELD_PATTERNS must have a profileKey: "street" entry so dedicated street UI fields route to the parsed street component',
  )
})

test('BUG 3: content.js FIELD_PATTERNS must include a `country` profileKey entry', () => {
  assert.ok(
    /profileKey:\s*'country'/.test(EXT_SRC),
    'BUG 3 regression: FIELD_PATTERNS must have a profileKey: "country" entry — pre-fix, the Land/Country field stayed empty',
  )
})

// ---------------------------------------------------------------------------
// BUG 5 — plain Swedish consent alternatives
// ---------------------------------------------------------------------------

test('BUG 5: at least one autoConsent entry must match plain "Jag godkänner"', () => {
  const matches = EXT_SRC.matchAll(
    /\{ pattern: \/([^/]+)\/i, profileKey: 'autoConsent', kind: 'consent' \}/g
  )
  let found = false
  for (const m of matches) {
    if (new RegExp(m[1], 'i').test('Jag godkänner')) { found = true; break }
  }
  assert.ok(
    found,
    'BUG 5 regression: no autoConsent entry matches plain "Jag godkänner" — Swedish GDPR-consent forms stay unchecked',
  )
})

test('BUG 5: at least one autoConsent entry must match "Jag samtycker till behandling"', () => {
  const matches = EXT_SRC.matchAll(
    /\{ pattern: \/([^/]+)\/i, profileKey: 'autoConsent', kind: 'consent' \}/g
  )
  let found = false
  for (const m of matches) {
    if (new RegExp(m[1], 'i').test('Jag samtycker till behandling av mina personuppgifter')) {
      found = true
      break
    }
  }
  assert.ok(
    found,
    'BUG 5 regression: no autoConsent entry matches "Jag samtycker"',
  )
})

// ---------------------------------------------------------------------------
// BUG 6 — file button visibility
// ---------------------------------------------------------------------------

test('BUG 6: file-button inline CSS has elevated padding/font-weight/border/box-shadow for visual prominence', () => {
  const startIdx = EXT_SRC.indexOf('function maybeInstallFileButtons(')
  assert.ok(startIdx > 0)
  let depth = 0
  let endIdx = -1
  for (let i = startIdx; i < EXT_SRC.length; i++) {
    const ch = EXT_SRC[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { endIdx = i; break }
    }
  }
  const body = EXT_SRC.slice(startIdx, endIdx + 1)
  assert.ok(/padding:\s*1[0-9]px|2[0-9]px/.test(body), 'BUG 6: padding must be ≥ 10px')
  assert.ok(/font:\s*7\d\d/.test(body), 'BUG 6: font-weight must be 700+')
  assert.ok(/2px/.test(body), 'BUG 6: border must include a 2px line')
  assert.ok(/box-shadow\s*:/.test(body), 'BUG 6: must include box-shadow')
})

// ---- helper ----
function extractParseAddressComponents() {
  const startIdx = PROF_SRC.indexOf('function parseAddressComponents(')
  assert.ok(startIdx > 0, 'parseAddressComponents must exist')
  let depth = 0
  let endIdx = -1
  for (let i = startIdx; i < PROF_SRC.length; i++) {
    const ch = PROF_SRC[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { endIdx = i; break }
    }
  }
  return new Function(`${PROF_SRC.slice(startIdx, endIdx + 1)}; return parseAddressComponents;`)()
}
