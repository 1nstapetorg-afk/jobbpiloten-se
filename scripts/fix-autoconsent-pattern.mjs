// scripts/fix-autoconsent-pattern.mjs
//
// 2026-07-21 / Round-72.2 / BUG 5 followup — the prior autoConsent
// pattern required `personuppgiftsbehandling` BEFORE `samtycker`,
// which misses the canonical Swedish consent label
// "Jag samtycker till behandling av mina personuppgifter" (where
// samtycker precedes personuppgiftsbehandling). The
// bug235-address-consent.test.mjs BUG 5 test at line ~130 locks this
// exact string.
//
// Idempotent via marker comment `// BUG 5 consent-extension`.
// Pre-write .test() safety gate; aborts without writing if any
// override string fails to match.

import fs from 'node:fs'
import path from 'node:path'

const FILE = path.resolve(process.cwd(), 'extension/content.js')
let src = fs.readFileSync(FILE, 'utf8')

const MARKER = '// BUG 5 consent-extension (Round-72.2)'
if (src.includes(MARKER)) {
  console.log('[fix-autoconsent-pattern] marker present, skipping')
  process.exit(0)
}

// Update the marker check too — see the marker placement in NEW_ENTRY below.
// We use a regex literal (single source of truth for the alternations)
// so the script doesn't accidentally double-escape backslashes the way
// bash heredoc eval did in the previous attempt.
//
// NOTE: `[\\s_]?` in a JS template literal evaluates to the literal
// string `[\s_]?`. When written to content.js, that string becomes
// part of the regex literal `/..[\s_]?../` — and there `[\s_]?` is
// regex character-class `[ \t\r\n\f\v_]?` (whitespace OR underscore).
//
// The regex covers all four Swedish consent variants the test locks:
//   1. "Jag har läst och godkänner" (clause-prefixed godkänner)
//   2. "I have read and agree" (English)
//   3. "personuppgiftsbehandling: Jag samtycker" (reverse-order, original)
//   4. "Accept the terms and privacy policy"
//
// PLUS the bare Swedish alternations missing in the pre-fix shape:
//   5. "jag samtycker till behandling av mina personuppgifter" (canonical)
//   6. "jag samtycker till behandling" (truncated)
//   7. "jag samtycker" (bare)
//   8. "samtycker till behandling" (without "jag")
//   9. "jag godkänner" (bare affirmative)
//  10. "godkänner behandling" (bare godkänner)
const NEW_ENTRY =
  '  ' + // Original entry has 2-space indentation.
  '{ pattern: /((jag[\\s_]?har[\\s_]?l[äa]st[\\s\\S]{0,30}?godk[äa]nner|i[\\s_]?have[\\s_]?read[\\s\\S]{0,30}?(?:and|&)?[\\s_]?agree|personuppgiftsbehandling[\\s\\S]{0,30}?(?:samtycker|godk[äa]nder)|accept[\\s_]?(?:the[\\s_]?)?terms[\\s\\S]{0,15}?(?:and|&)?[\\s_]?(?:privacy|policy))|\\bjag[\\s_]?samtycker[\\s_]?(?:till[\\s_]?(?:behandling(?:en)?[\\s_]?(?:av[\\s_]?(?:mina[\\s_]?)?personuppgifter)?|min[\\s_]?behandling|att[\\s_]?(?:mina[\\s_]?uppgifter|personuppgifterna)[\\s_]?(?:behandlas|används|lagras))?|att[\\s_]?(?:mina|personuppgifterna)[\\s_]?(?:behandlas|används|lagras))?|\\bjag[\\s_]?samtycker\\b|\\bsamtycker[\\s_]?till[\\s_]?(?:behandling|att)|\\bjag[\\s_]?godk[äa]nner[\\s_]?(?:att|behandling(?:en)?[\\s_]?(?:av[\\s_]?personuppgifter)?)?|\\bjag[\\s_]?godk[äa]nner\\b|\\bgodk[äa]nner[\\s_]?(?:behandling(?:en)?|att[\\s_]?mina[\\s_]?uppgifter))/i, profileKey: \'autoConsent\', kind: \'consent\' },'
  + '\n' + MARKER

// Extract regex source from NEW_ENTRY for the pre-write verification.
const reSrcMatch = NEW_ENTRY.match(/\/((?:[^/\\]|\\.)+)\/i/)
if (!reSrcMatch) {
  console.error('[fix-autoconsent-pattern] could not parse NEW_ENTRY regex literal; aborting')
  process.exit(1)
}
const re = new RegExp(reSrcMatch[1], 'i')

const overrides = [
  'Jag godkänner',
  'Jag samtycker till behandling av mina personuppgifter',
  'Jag samtycker till behandling',
  'Jag samtycker',
  'samtycker till behandling',
  'Jag har läst och godkänner villkoren',
  'personuppgiftsbehandling: Jag samtycker',
  'I have read and agree to the privacy policy',
  'Godkänner behandling av mina personuppgifter',
  'Jag godkänner behandling av personuppgifter',
]
let allMatch = true
for (const s of overrides) {
  const ok = re.test(s)
  console.log(`${ok ? 'PASS' : 'FAIL'}  "${s}"`)
  if (!ok) allMatch = false
}
if (!allMatch) {
  console.error('[fix-autoconsent-pattern] NEW_ENTRY fails one or more override cases; not writing')
  process.exit(2)
}

// Locate the existing broken entry. Use a non-greedy regex so we match
// the right entry even if other autoConsent-shaped entries live elsewhere.
const BROKEN_REGEX = /\{ pattern: \/[^/]+\/i, profileKey: 'autoConsent', kind: 'consent' \},/
const m = src.match(BROKEN_REGEX)
if (!m) {
  console.error('[fix-autoconsent-pattern] could not locate existing autoConsent entry in source')
  process.exit(3)
}
console.log(`[fix-autoconsent-pattern] matched ${m[0].length} chars at offset ${m.index}`)

src = src.replace(BROKEN_REGEX, NEW_ENTRY.trimEnd() + '\n')
fs.writeFileSync(FILE, src)
console.log(`[fix-autoconsent-pattern] wrote ${FILE}`)
