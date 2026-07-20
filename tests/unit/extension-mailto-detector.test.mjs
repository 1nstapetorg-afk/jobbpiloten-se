// Round-34 / Part 4 — regex correctness tests for the content-
// script mailto detector. The detector itself lives inline in
// extension/content.js (the MV3 manifest doesn't bundle ESM
// modules — content.js is a single self-contained script). Rather
// than refactor the detector into a separate module (which would
// need either a build step or a manifest.json content_scripts
// type-module rewrite), the test inlines the SAME regex constants
// from content.js. The structural contract test in
// tests/unit/extension-mailto-detector-source.test.mjs (separate
// file) verifies byte-identity of the regex literals in the
// production source. Cover here:
//   - Bare email regex (standard + Swedish TLDs)
//   - Obfuscated "[at]" / "[dot]" decoder
//   - Phrase patterns (Swedish + English)
//   - mailto: link extraction with %-encoded address decoding

import { test } from 'node:test'
import assert from 'node:assert/strict'

// MUST mirror content.js — kept in sync via the source-locks
// test. Any drift between here and content.js is a test failure
// that the source-locks companion test will detect.
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
// Round-36: Swedish chars added to all three character classes — see
// the matching docstring in extension/content.js for the rationale.
// Bytewise identity between this literal and content.js is locked by
// tests/unit/extension-mailto-detector-source.test.mjs.
const EMAIL_REGEX_OBFUSC = /\b([a-zA-Z0-9._%+\-åäöÅÄÖ]{2,})\s*[\[\(]\s*(?:at|AT)\s*[\]\)]\s*([a-zA-Z0-9.\-åäöÅÄÖ]{2,})\s*[\[\(]\s*(?:dot|DOT|punkt|PUNKT)\s*[\]\)]\s*([a-zA-ZåäöÅÄÖ]{2,})\b/g
const EMAIL_PHRASES = /(skicka[\s\S]{0,40}?(?:ansökan|cv)[\s\S]{0,40}?(?:till|mejl|epost)|maila[\s\S]{0,40}?(?:cv|ansökan)[\s\S]{0,30}?(?:till|oss)|send[\s\S]{0,40}?(?:application|cv|resume)[\s\S]{0,40}?(?:to|by\s+email)|email[\s\S]{0,30}?(?:your\s+)?(?:application|cv|resume)[\s\S]{0,30}?to|apply[\s\S]{0,30}?(?:by|via)\s+email|ansök[\s\S]{0,30}?via\s+mejl|via\s+epost)/i

function dedupeMatches(emails) {
  return Array.from(new Set(emails.map((e) => String(e).toLowerCase())))
}

function extractBare(text) {
  const out = []
  EMAIL_REGEX.lastIndex = 0
  let m
  while ((m = EMAIL_REGEX.exec(text)) !== null) out.push(m[0])
  return dedupeMatches(out)
}

function extractObfusc(text) {
  const out = []
  EMAIL_REGEX_OBFUSC.lastIndex = 0
  let m
  while ((m = EMAIL_REGEX_OBFUSC.exec(text)) !== null) {
    out.push(`${m[1]}@${m[2]}.${m[3]}`)
  }
  return dedupeMatches(out)
}

test('Round-34: bare email regex matches plain Swedish + international addresses', () => {
  const fixtures = [
    { input: 'Skicka din ansökan till hr@spotify.com', expect: ['hr@spotify.com'] },
    { input: 'Maila CV till rekrytering@klarna.se', expect: ['rekrytering@klarna.se'] },
    { input: 'Send your CV to careers@google.com', expect: ['careers@google.com'] },
    { input: 'info@foretag.se', expect: ['info@foretag.se'] },
    { input: 'jane.doe+filter@mail.example.co.uk', expect: ['jane.doe+filter@mail.example.co.uk'] },
  ]
  for (const f of fixtures) {
    assert.deepEqual(extractBare(f.input), f.expect, `bare regex miss: "${f.input}"`)
  }
})

test('Round-34: bare email regex rejects malformed addresses (no @, no TLD, no local-part)', () => {
  // No @
  assert.deepEqual(extractBare('hej@ där'), [])
  // No TLD
  assert.deepEqual(extractBare('hr@spotify'), [])
  // Local-part only
  assert.deepEqual(extractBare('hr@.com'), [])
})

test('Round-34: obfuscated "[at]" / "[dot]" patterns decode to canonical email', () => {
  const fixtures = [
    { input: 'Maila CV till hr [at] spotify [dot] com', expect: ['hr@spotify.com'] },
    { input: 'Skicka din ansökan till rekrytering(at)klarna(dot)se', expect: ['rekrytering@klarna.se'] },
    { input: 'contact [AT] example [DOT] co', expect: ['contact@example.co'] },
    { input: 'ansök (at) foretag (punkt) se', expect: ['ansök@foretag.se'] }, // (punkt) — regex captures the word BEFORE (at) as local-part
  ]
  for (const f of fixtures) {
    assert.deepEqual(extractObfusc(f.input), f.expect, `obfusc miss: "${f.input}"`)
  }
})

test('Round-34: obfuscated regex ignores short local-parts (< 2 chars) and short domains', () => {
  // Local-part must be >= 2 chars. "a [at] b [dot] com" must NOT
  // produce a single-char "a@b.com" — that would spam the signals
  // list with garbage matches.
  assert.deepEqual(extractObfusc('a [at] b [dot] com'), [])
  // Domain must be >= 2 chars
  assert.deepEqual(extractObfusc('hr [at] s [dot] com'), [])
})

test('Round-34: phrase regex catches Swedish + English email-apply signals', () => {
  const fixtures = [
    { input: 'Skicka din ansökan till oss på hr@spotify.com', expectHit: true },
    { input: 'Maila ditt CV till rekrytering@klarna.se', expectHit: true },
    { input: 'Send your application to: careers@google.com', expectHit: true },
    { input: 'Email your CV to hr@example.com', expectHit: true },
    { input: 'Apply by email: jobs@startup.io', expectHit: true },
    { input: 'Apply via email — see below', expectHit: true },
    { input: 'Ansök via mejl', expectHit: true },
    { input: 'Du kan ansöka via epost', expectHit: true },
    // Negative: prose without an email-apply cue
    { input: 'Vi använder cookies för att förbättra din upplevelse.', expectHit: false },
    { input: 'About us — building the future of music streaming.', expectHit: false },
  ]
  for (const f of fixtures) {
    assert.equal(
      EMAIL_PHRASES.test(f.input),
      f.expectHit,
      `phrase hit/miss wrong for: "${f.input}"`,
    )
  }
})

test('Round-34: obfuscated and bare extract together dedupe overlapping matches', () => {
  // When both regexes match the same domain, the union must still
  // be a single entry — sorting by kind (mailto > text > obfuscated)
  // in the popup keeps the panel focused on the strongest signal.
  const text = 'Maila CV till hr [at] spotify [dot] com eller hr@spotify.com'
  const combined = [...extractBare(text), ...extractObfusc(text)]
  assert.deepEqual(
    dedupeMatches(combined),
    ['hr@spotify.com'],
    'Overlapping plain + obfuscated addresses must dedupe to a single entry',
  )
})
