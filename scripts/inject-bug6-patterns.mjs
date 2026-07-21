// Round-72.2 // 2026-07-21 — bulletproof inject-script for BUG 3 + 6
// FIELD_PATTERNS entries. Uses a regex anchor on the closing `]`
// (followed by the SECTION 3 separator comment) so the script is
// insensitive to whitespace, full-content re-runs (re-running is
// a no-op via the "BUG 6:" idempotency check), and any tweaks the
// pre-amble entries have received in earlier rounds.
//
// - Idempotent: re-running is a no-op.
// - Anchored: looks for the SECTION 3 separator (// ----- 3. ...)
//   to confirm it's appending to the FIELD_PATTERNS array end.
// - Stops on whitespace or comment changes.

import fs from 'node:fs'
import path from 'node:path'

const file = path.join(process.cwd(), 'extension', 'content.js')
const src = fs.readFileSync(file, 'utf8')

if (src.includes('Round-72.2 / BUG 3 + 6')) {
  console.log('inject-bug6-patterns: already applied (idempotent skip)')
  process.exit(0)
}

// Regex: a lone `]` followed by newline + the SECTION 3 separator
// comment. Anchored on the next-line lookahead so we are sure we
// are at the FIELD_PATTERNS array end, not a mid-array close.
const re = /\]\s*\n(?=\/\/ ---------- 3\. Profile)/
const m = src.match(re)
if (!m) {
  console.error('inject-bug6-patterns: cannot locate FIELD_PATTERNS closing `]`')
  process.exit(1)
}

const bug6 = `

  // ---------- 2026-07-21 / Round-72.2 / BUG 3 + 6 — additional patterns ----------
  //
  // BUG 3: catch-all Yes/No fallback for non-Swedish forms (Workday
  // EN, Teamtailor EN, Greenhouse). Falls through when no specific
  // Swedish pattern fires. Uses 'openToAnyRole' as profileKey so
  // clickBooleanOption() mutates a real flag (null caused schema
  // corruption in earlier drafts).
  { pattern: /^[\\s_]*(ja|nej|yes|no|y|n|si|oui|non|\\u221a|\\u00d7)[\\s_]*$/i, profileKey: 'openToAnyRole', kind: 'boolean' },

  // BUG 6: Manpower forms — employment status, personal number,
  // availability, shifts per week, daytime availability, location prefs:
  { pattern: /\\b(annan[\\s_]?huvudsaklig[\\s_]?syssels\u00e4ttning|har[\\s_]?du[\\s_]?en[\\s_]?annan[\\s_]?syssels\u00e4ttning)\\b/i, profileKey: 'hasOtherEmployment', kind: 'boolean' },
  { pattern: /\\b(fullst\u00e4ndigt[\\s_]?personnummer|svenskt[\\s_]?personnummer|personnummer[\\s_]?:?[\\s_]?10[\\s_]?siffror)\\b/i, profileKey: 'personalNumber' },
  { pattern: /\\b(n\u00e4r[\\s_]?kan[\\s_]?du[\\s_]?b\u00f6rja|tilltr\u00e4desdatum|startdatum|earliest[\\s_]?start[\\s_]?date)\\b/i, profileKey: 'availableFromDate' },
  { pattern: /\\b(antal[\\s_]?pass[\\s_]?per[\\s_]?vecka|pass[\\s_]?per[\\s_]?vecka|shifts[\\s_]?per[\\s_]?week)\\b/i, profileKey: 'shiftsPerWeek' },
  { pattern: /\\b(dagtid[\\s_]?p\u00e5[\\s_]?vardagar|kan[\\s_]?du[\\s_]?arbeta[\\s_]?dagtid|daytime[\\s_]?availability)\\b/i, profileKey: 'daytimeAvailability', kind: 'boolean' },
  { pattern: /\\b(platser|work[\\s_]?location|arbetsort)\\b/i, profileKey: 'preferredLocations', kind: 'multiselect' },

  // BUG 6: Randstad forms — current job, salary, source tracking:
  { pattern: /\\b(nuvarande[\\s_]?arbete|current[\\s_]?(?:job|position|work)|current[\\s_]?employer)\\b/i, profileKey: 'currentJob' },
  { pattern: /\\b(l\u00f6neanspr\u00e5k|\u00f6nskad[\\s_]?l\u00f6n|salary[\\s_]?expectation|expected[\\s_]?salary|m\u00e5nadlig[\\s_]?l\u00f6n|annual[\\s_]?salary)\\b/i, profileKey: 'salaryExpectation', kind: 'salary' },
  { pattern: /\\b(var[\\s_]?hittade[\\s_]?du[\\s_]?den[\\s_]?h\u00e4r[\\s_]?annonsen|source[\\s_]?tracking|h\u00f6rde[\\s_]?du[\\s_]?om[\\s_]?jobbet[\\s_]?via|how[\\s_]?did[\\s_]?you[\\s_]?find[\\s_]?us)\\b/i, profileKey: 'applicationSource', kind: 'multiselect' },

  // BUG 6: Other forms — language skill, certificate upload:
  { pattern: /\\b(kan[\\s_]?prata[\\s_]?svenska|speak[\\s_]?swedish|fluent[\\s_]?swedish)\\b/i, profileKey: 'speakSwedish', kind: 'boolean' },
  { pattern: /\\b(intyg[\\s_]?:?|certifikat[\\s_]?:?|bevis[\\s_]?:?|certificates?[\\s_]?:?|attach[\\s_]?certificates?)\\b/i, profileKey: 'certificates', kind: 'file' },
`

// Replace `]\n` (followed by SECTION 3 separator) with bug6 + `]\n`.
const out = src.replace(re, bug6 + ']\n')
fs.writeFileSync(file, out)
console.log('inject-bug6-patterns: applied')
