// tests/unit/mobile-autofill.test.mjs
//
// Round-95 (mobile in-app browser, Chrome-extension replacement) — locks
// the autofill-bridge contract in lib/mobile-autofill.js:
//
//   1. generateAutofillScript() returns a self-contained IIFE string that
//      embeds the profile JSON, the job JSON, the field-pattern table, the
//      Swedish toast copy, and the floating "JobbPiloten" button.
//   2. The generated script is syntactically valid JavaScript (no template
//      literal / backtick escaping bugs) and maps the serialized pattern
//      objects through their `source` / `key` fields (the Round-95 fix that
//      replaced a broken `p.s` / `p.k` mapping).
//   3. sanitizeAutofillPayload() coerces nullish inputs to {}.
//
// Run via `yarn test:unit` (`node --test tests/unit/**`).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  AUTOFILL_TOAST,
  AUTOFILL_FILL_ACTION,
  AUTOFILL_DONE_ACTION,
  generateAutofillScript,
  sanitizeAutofillPayload,
} from '../../lib/mobile-autofill.js'

test('AUTOFILL_TOAST matches the locked Swedish copy', () => {
  assert.equal(AUTOFILL_TOAST, 'Formuläret ifyllt! Kontrollera och skicka.')
})

test('AUTOFILL_FILL_ACTION / AUTOFILL_DONE_ACTION are the bridge verbs', () => {
  assert.equal(AUTOFILL_FILL_ACTION, 'fill')
  assert.equal(AUTOFILL_DONE_ACTION, 'autofilled')
})

test('generateAutofillScript returns a self-contained IIFE string', () => {
  const script = generateAutofillScript()
  assert.equal(typeof script, 'string')
  assert.ok(script.startsWith('(function () {'), 'script must be an IIFE string')
  assert.ok(script.endsWith('})();\n'), 'script must be a closed IIFE expression')
})

test('generateAutofillScript embeds the profile JSON', () => {
  const profile = {
    fullName: 'Anna Andersson',
    email: 'anna-andersson-42@example.com',
    phone: '+46701234567',
    cvSummary: 'Erfaren frontend-utvecklare.',
  }
  const script = generateAutofillScript(profile)
  // The email is a unique token that must survive JSON.stringify + embedding.
  assert.ok(script.includes('anna-andersson-42@example.com'), 'profile email must be embedded')
  assert.ok(script.includes('Erfaren frontend-utvecklare.'), 'profile cvSummary must be embedded')
})

test('generateAutofillScript embeds the job JSON', () => {
  const job = { title: 'Frontend-utvecklare', company: 'Acme AB', url: 'https://jobbland.se/1' }
  const script = generateAutofillScript({}, job)
  assert.ok(script.includes('Frontend-utvecklare'), 'job title must be embedded')
  assert.ok(script.includes('Acme AB'), 'job company must be embedded')
})

test('generateAutofillScript embeds the field-pattern table + toast + FAB', () => {
  const script = generateAutofillScript()
  // Field-pattern sources (the taxonomy the fill loop matches labels against).
  assert.ok(script.includes('förnamn|first name'), 'firstName pattern must be present')
  assert.ok(script.includes('personligt brev|cover letter'), 'cover-letter pattern must be present')
  // Toast copy.
  assert.ok(script.includes(AUTOFILL_TOAST), 'toast copy must be present')
  // Floating button markup + Swedish label.
  assert.ok(script.includes('jp-mobile-fab'), 'FAB id must be present')
  assert.ok(script.includes('Fyll i automatiskt'), 'FAB aria-label must be present')
  // Native bridge verbs.
  assert.ok(script.includes('messageFromNative'), 'script must listen for the native fill command')
  assert.ok(script.includes('window.mobileApp'), 'script must post the fill result to the native bridge')
})

test('generated script maps patterns through source/key (Round-95 bug fix)', () => {
  // Regression lock: the serialized pattern objects carry `source`/`key`
  // (not `s`/`k`), so the injected map MUST read p.source / p.key. A prior
  // draft read p.s / p.k and produced `new RegExp("undefined")` — a script
  // that parses but fills nothing.
  const script = generateAutofillScript()
  assert.ok(script.includes('p.source'), 'pattern regex must read the serialized `source` field')
  assert.ok(script.includes('p.key'), 'pattern dispatch must read the serialized `key` field')
  assert.ok(!script.includes('p.s,'), 'must not reference a non-existent `s` field')
  assert.ok(!script.includes('p.k,'), 'must not reference a non-existent `k` field')
})

test('generated script is syntactically valid JavaScript', () => {
  const script = generateAutofillScript(
    { fullName: 'A', email: 'a@b.se', answers: { strengths: 'x' } },
    { title: 'T' },
  )
  // new Function compiles the body without executing it, so a syntax error
  // (unbalanced quotes, stray backtick, etc.) throws here. The IIFE never
  // runs because we only construct — references to window/document resolve
  // at call time, not compile time.
  assert.doesNotThrow(() => new Function(script), 'script must compile as a JS function body')
})

test('generateAutofillScript is idempotence-safe (guards double injection)', () => {
  const script = generateAutofillScript()
  assert.ok(script.includes('__jobbpilotenMobileLoaded'), 'script must self-guard against double injection')
})

test('sanitizeAutofillPayload coerces nullish inputs to empty objects', () => {
  assert.deepEqual(sanitizeAutofillPayload(null, undefined), { profile: {}, job: {} })
  assert.deepEqual(sanitizeAutofillPayload({ email: 'a@b.se' }, null), {
    profile: { email: 'a@b.se' },
    job: {},
  })
})

test('generated script embeds the field-type validity guard (Round-96 Bug 2)', () => {
  const script = generateAutofillScript(
    { fullName: 'Anna A', email: 'anna@example.com', phone: '+46701234567' },
    { title: 'Utvecklare' },
  )
  assert.ok(script.includes('function isValidValue'), 'script must define the field-type validator')
  assert.ok(script.includes('isValidValue(entry.key, value)'), 'fill loop must call the validator before setValue')
  assert.ok(script.includes('"[Autofill] Mapping"'), 'script must log each field mapping for DevTools debugging')
})

test('generated script guards against cross-field type mismatches (Round-96 Bug 2)', () => {
  // A cover-letter block must never be accepted as an email / phone / name.
  const letter = 'Hej! Här är mitt personliga brev med många rader...\nErfaren utvecklare.\nMvh Anna'
  const script = generateAutofillScript(
    { fullName: 'Anna Andersson', email: letter, phone: 'Inte ett nummer' },
    { title: 'Rollen' },
  )
  assert.ok(script.includes('function isValidValue'), 'validator must be present')
  // The validator body must contain the email/phone type checks.
  assert.ok(/key === "email"/.test(script), 'must type-check email (require @ with a dot)')
  assert.ok(/key === "phone"/.test(script), 'must type-check phone (require digits)')
})
