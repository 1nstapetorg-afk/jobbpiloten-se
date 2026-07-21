/**
 * lib/extension-profile-fields.js — Round-12 auto-fill extension
 * field registry. Single source of truth for the 16 new fields that
 * power the extension's yes/no + dropdown + multi-select + consent
 * dispatch (Round-12 FIELD_PATTERNS in extension/content.js).
 *
 * Both lib/extension-profile.js#buildExtensionProfile (server-side,
 * composes the safe JSON sent to the extension via the dashboard's
 * JOBBPILOTEN_AUTH_SYNC postMessage) and app/settings/page.js
 * (UI-side, seeds the settings form) import from here so the field
 * set, defaults, and Swedish labels cannot drift between the two
 * surfaces.
 *
 * The same module is unit-tested in
 * tests/unit/extension-profile.test.mjs (Round-12 followup) so a
 * future removal silently breaks the build instead of breaking
 * users at runtime.
 */

// ---- Boolean credential / licence fields (11 keys) ----
//
// Each key maps 1:1 to a FIELD_PATTERNS entry in extension/content.js
// with `kind: 'boolean' | 'booleanThreshold'`. Default value is
// false so the extension leaves the host field untouched unless
// the user has explicitly opted in. autoConsent is included here so
// the server-side validators (app/api/[[...path]]/route.js) can
// iterate one canonical list.
export const ROUND12_BOOLEAN_KEYS = [
  'hasDriversLicense',
  'isEuCitizen',
  'hasWorkPermit',
  'hasHighSchoolDiploma',
  'hasForkliftLicense',
  'hasSecurityClearance',
  'hasLeadershipExperience',
  'isBilingual',
  'hasTechnicalEducation',
  'hasCustomerExperience',
  'autoConsent',
]

// Boolean keys that surface as <Switch> toggles in the settings page.
// Excludes autoConsent — that toggle lives in its own amber safety
// block so the GDPR warning is always adjacent to the control.
// Derived from ROUND12_BOOLEAN_KEYS so adding a new boolean to the
// canonical list automatically picks it up here unless it's in
// AUTO_CONSENT_EXCLUDE.
const AUTO_CONSENT_EXCLUDE = new Set(['autoConsent'])
export const ROUND12_UI_BOOLEAN_KEYS = ROUND12_BOOLEAN_KEYS.filter(
  (k) => !AUTO_CONSENT_EXCLUDE.has(k),
)

// Swedish UI labels for the 10 UI-facing toggles (excludes
// autoConsent — that one is labelled inline in its amber block).
//
// Round-74 / Issue 3 — labels are in RECRUITER-QUESTION form
// ("Har du ...?") to match the actual prompt wording the
// extension's FIELD_PATTERNS dispatch on. The previous labels
// were noun-phrase ("B-körkort", "Truckförarbevis") — readable
// in the settings UI but mismatched against the host page's
// question phrasing so users had to mentally translate between
// the toggle's label and the form's question to know what they
// were consenting to. The two surfaces now read identically:
// settings toggle ↔ host-page question.
export const ROUND12_BOOLEAN_LABELS = {
  hasDriversLicense: 'Har du B-körkort?',
  isEuCitizen: 'Är du EU/EEA-medborgare?',
  hasWorkPermit: 'Har du arbetstillstånd?',
  hasHighSchoolDiploma: 'Har du gymnasieexamen?',
  hasForkliftLicense: 'Har du truckförarbevis?',
  hasSecurityClearance: 'Har du säkerhetsprövning?',
  hasLeadershipExperience: 'Har du ledarerfarenhet?',
  isBilingual: 'Är du tvåspråkig (SV + EN)?',
  hasTechnicalEducation: 'Har du teknisk utbildning?',
  hasCustomerExperience: 'Har du kundserviceerfarenhet?',
}

// ---- String-typed fields (4 keys) ----
//
// These render as <Input> (text/date) or <Select> in the settings
// page and surface as Dropdown / Text entries in the extension's
// FIELD_PATTERNS table. Default is the empty string.
export const ROUND12_STRING_KEYS = [
  'dateOfBirth',
  'gender',
  'nationality',
  'phoneCountryCode',
  'currentJobTitle',
  'currentOrganization',
]

// Select options for the gender field. The four values mirror the
// Swedish AF-style form taxonomy. Order is preserved for visual
// stability in the <Select>.
export const ROUND12_GENDER_OPTIONS = [
  { value: 'Man', label: 'Man' },
  { value: 'Kvinna', label: 'Kvinna' },
  { value: 'Annat', label: 'Annat' },
  { value: 'Vill inte uppge', label: 'Vill inte uppge' },
]

// Skills multi-select chips. The extension's multiselect dispatch
// matches each entry (case-insensitive word-boundary) against
// checkbox labels on the host page. Order is preserved for visual
// stability; users can pick any subset.
export const ROUND12_SKILL_OPTIONS = [
  'Maskiner',
  'Sanering',
  'Service',
  'Förvaltning',
  'Truck',
  'Kundsupport',
  'Lager',
  'Städ',
  'Transport',
  'Bygg',
]

// ---- Per-field default values ----
//
// Centralised so the extension's safe-empty defaults and the settings
// form's initial state can never drift. Returns a fresh object on
// every call so consumers can mutate the result without affecting
// future calls.
//
// Safe-empty semantics:
//   • All booleans → false (extension leaves host field untouched)
//   • yearsExperience → 0 (threshold check fails unless user opts in)
//   • All strings → '' (avoid String() coercion surprises on the
//     extension's resolveProfileValue path)
//   • phoneCountryCode → '+46' (Sweden default; user can change
//     to '+47' etc. via the settings page)
//   • skills → [] (no chips selected; extension leaves every
//     checkbox alone)
export function getRound12Defaults() {
  const out = {
    yearsExperience: 0,
    skills: [],
  }
  // Boolean defaults — all 11 keys (incl. autoConsent) → false so
  // the extension leaves every host field untouched unless the
  // user explicitly opts in.
  for (const k of ROUND12_BOOLEAN_KEYS) out[k] = false
  // String defaults — 3 keys (dateOfBirth / gender / nationality)
  // default to ''. phoneCountryCode is NOT in this loop because it
  // has a non-empty default ('+46') and would be silently overwritten
  // if iterated here — see `out.phoneCountryCode = '+46'` below.
  for (const k of ROUND12_STRING_KEYS) {
    if (k === 'phoneCountryCode') continue
    out[k] = ''
  }
  // phoneCountryCode — assigned AFTER the string-keys loop so it
  // survives. Sweden default ('+46') is what the form initialises
  // and what buildExtensionProfile falls back to on empty string /
  // null / undefined input.
  out.phoneCountryCode = '+46'
  return out
}

// Total number of new Round-12 fields. Used by tests/unit/extension-profile.test.mjs
// to assert buildExtensionProfile returns exactly this many new keys.
// Computed at module load so the test cannot drift if a key is
// added/removed without updating the test fixture.
export const ROUND12_TOTAL_FIELDS =
  ROUND12_BOOLEAN_KEYS.length + ROUND12_STRING_KEYS.length + 2 // +2 for yearsExperience (number) and skills (array)