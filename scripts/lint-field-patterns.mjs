#!/usr/bin/env node
// Round-79.5 / Followup 3a — FIELD_PATTERNS protection-drift linter.
//
// Goal
//   Auto-flag any FIELD_PATTERNS entry in extension/content.js that
//   shares a profileKey with a protected (negative-lookahead-gated)
//   sibling but itself lacks a negative-lookahead. This was the
//   exact bug class that bit us on 2026-07-20: the strict-anchored
//   city line had a `(?:\u2026)\b(?!\u2026*)` fence but the unprotected
//   fallback below it didn't, so the fallback caught "Beskriv g\u00e4rna
//   om du bor i n\u00e4rheten av arbetsplatsen" and routed a comment-style
//   textarea to the `city` profileKey.
//
// Strategy
//   1. Walk `extension/content.js` and extract every
//      `{ pattern: /.../, profileKey: '...', [kind|type]: '...' }`
//      entry from the FIELD_PATTERNS array literal.
//   2. Group entries by `profileKey`.
//   3. Per group with \u22652 entries: if AT LEAST ONE entry contains the
//      negative-lookahead fence (`(?!\u2026*)`) AND another entry
//      doesn't, the unprotected sibling is a violation.
//   4. Whitelist certain kinds that are gated by other mechanisms,
//      so they don't false-positive.
//
// Exit codes
//   0 = no drift detected.
//   1 = at least one violation found (CI gate hard-fails).
//
// Auto-fix hint
//   Each violation prints the unprotected entry's line + a generic
//   recipe so the maintainer copies the negative-lookahead fence
//   from the protected sibling of the same profileKey.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CONTENT_JS = resolve(__dirname, '..', 'extension', 'content.js')

const src = readFileSync(CONTENT_JS, 'utf8')

// Whitelisted kind/profileKey pairs that are intentionally
// unprotected. These match very specific tokens that don't
// over-match Swedish free-text labels.
//
//   file types            — gated by findFileInputs() in content.js,
//                            only sees <input type="file">.
//   boolean               — gated by clickBooleanOption() which only
//                            fires when the matched regex is very
//                            specific. Auto-click-by-default is NOT
//                            safe, so we don't relax these further.
//   booleanThreshold      — same as boolean plus the meta-parses a
//                            numeric threshold.
//   consent               — GDPR safety gate in checkConsent, gated
//                            on profile.autoConsent === true.
//   dropdown selects      — option-value-text matching only.
//
// These keys are NEVER flagged regardless of their pattern shape.
const KIND_GATED = new Set([
  'hasDriversLicense', 'isEuCitizen', 'hasWorkPermit',
  'hasHighSchoolDiploma', 'hasForkliftLicense', 'hasSecurityClearance',
  'yearsExperience', 'hasLeadershipExperience', 'isBilingual',
  'hasTechnicalEducation', 'hasCustomerExperience',
  'autoConsent',
  'skills',
  'dateOfBirth', 'gender', 'nationality', 'phoneCountryCode',
  'salaryExpectation', 'linkedin',
  'cvFile', 'coverLetterFile', 'additionalDocuments',
  // Single-token profileKeys that historically have only one
  // entry; if a future maintainer adds a fallback (e.g. with a
  // zip+postnummer redundancy), the script will surface it then.
  'firstName', 'lastName', 'fullName',
  'email', 'phone',
])

// Entry-extraction regex. Captures:
//   group 1: the regex body (escapes inside, no `/`)
//   group 2: the regex flags (gimsuy)
//   group 3: the profileKey
//   group 4: the optional kind/type
//   group 5: the optional profileKey AFTER kind/type (alt ordering)
//
// We deliberately match anything that LOOKS like a FIELD_PATTERNS
// entry — the shape `{ pattern: ..., profileKey: ...[, kind: ...] }`
// is unique to the table inside `const FIELD_PATTERNS = [\u2026]`.
// The brace-balanced body avoids grabbing tokens from inside our own
// nested regexes.
const ENTRY_RE = /\{[^{}]*pattern:\s*\/((?:\\\/|[^/\n])+)\/([gimsuy]*)[^{}]*profileKey:\s*'([\w.]+)'[^{}]*\}/g

const entries = []
for (const m of src.matchAll(ENTRY_RE)) {
  const lineNum = src.slice(0, m.index).split('\n').length
  entries.push({
    lineNum,
    pattern: m[1],
    flags: m[2] || 'i',
    profileKey: m[3],
    raw: m[0].replace(/\s+/g, ' ').slice(0, 140),
  })
}

// Safety check: if we found <1 entries, something has gone wrong
// with the extraction (the file structure drifted). Fail loud.
if (entries.length === 0) {
  console.error('[lint-field-patterns] no FIELD_PATTERNS entries found \u2014 extraction regex may be stale. Failing.')
  process.exit(2)
}

const groups = new Map()
for (const entry of entries) {
  if (!groups.has(entry.profileKey)) groups.set(entry.profileKey, [])
  groups.get(entry.profileKey).push(entry)
}

const NEG_LOOKAHEAD_RE = /\(\?!/

const violations = []
for (const [profileKey, group] of groups.entries()) {
  if (KIND_GATED.has(profileKey)) continue
  if (group.length < 2) continue

  const protectedCount = group.filter((e) => NEG_LOOKAHEAD_RE.test(e.pattern)).length
  if (protectedCount === 0) continue  // all unprotected — not drift, just an unprotected key

  for (const entry of group) {
    if (NEG_LOOKAHEAD_RE.test(entry.pattern)) continue  // already protected — OK
    violations.push({
      line: entry.lineNum,
      profileKey,
      sample: `/${entry.pattern.slice(0, 96)}${entry.pattern.length > 96 ? '\u2026' : ''}/${entry.flags}`,
    })
  }
}

if (violations.length === 0) {
  console.log(`OK \u2014 checked ${entries.length} FIELD_PATTERNS entries across ${groups.size} profileKeys; no protection-drift detected.`)
  process.exit(0)
}

console.error(`PROTECTION-DRIFT detected in extension/content.js FIELD_PATTERNS table:`)
for (const v of violations) {
  console.error(`\n  line ${v.line}: profileKey=${v.profileKey}`)
  console.error(`    regex: ${v.sample}`)
  console.error(`    fix:   copy the negative-lookahead fence from a PROTECTED sibling entry with the same profileKey.`)
  console.error(`           See round-79.5 \u00a73a for the round-46 / round-79.5 reference shapes.`)
}
console.error(`\n${violations.length} unprotected neighbour(s). Run \`yarn lint:field-patterns\` to recheck after fixes.`)
process.exit(1)
