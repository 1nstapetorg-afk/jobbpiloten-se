/**
 * lib/field-taxonomy.js — shared industry field taxonomy (Round-81).
 *
 * Single source of truth for the 9 JobbPiloten industries and their
 * industry-core ("Tier 2") application-form fields.
 *
 * Origin: the form-field corpus built by the isolated scraper
 * (~/jobbpiloten-scraper). `data/processed/extension_field_schema.json`
 * is the ground-truth evidence artifact (tiers computed from 68 real
 * application forms — 66 complete, ≥5 real fields — across Teamtailor /
 * getwiser / varbi / reachmee / jobylon; noise-filtered since
 * Round-81 follow-up, see HANDOFF.md); this module is the curated,
 * UX-ready projection of that schema plus domain knowledge where the
 * corpus is thin (industries with few live forms). The two must stay in
 * sync when the corpus grows — re-run the scraper's build-taxonomy.js
 * and reconcile Tier 2 additions here.
 *
 * Consumers (one-directional imports, no cycles):
 *   • app/onboarding/page.js      — industry dropdown + industry fields
 *   • app/settings/page.js        — industry selector + field toggles
 *   • app/api/[[...path]]/route.js — profile POST/update validation
 *   • lib/extension-profile.js    — safe profile for the extension
 * The Chrome extension gets a bundled plain-JS copy at
 * extension/lib/field-taxonomy.js (no imports — MV3 content scripts
 * cannot load ESM modules from lib/).
 */

// ---- The 9 industries (dropdown order = display order) ----
export const INDUSTRIES = [
  { id: 'lager', label: 'Lager & logistik' },
  { id: 'vård', label: 'Vård & omsorg' },
  { id: 'kontor', label: 'Kontor & administration' },
  { id: 'IT', label: 'IT & teknik' },
  { id: 'bygg', label: 'Bygg & anläggning' },
  { id: 'restaurang', label: 'Restaurang & hotell' },
  { id: 'sälj', label: 'Försäljning' },
  { id: 'industri', label: 'Industri & produktion' },
  { id: 'transport', label: 'Transport' },
]

export const INDUSTRY_IDS = INDUSTRIES.map((i) => i.id)

export const INDUSTRY_LABELS = Object.fromEntries(INDUSTRIES.map((i) => [i.id, i.label]))

// ---- Round-81: industry-specific boolean keys ----
//
// These join ROUND12_BOOLEAN_KEYS (lib/extension-profile-fields.js) as
// the extension's boolean registry. Each key maps 1:1 to a
// FIELD_PATTERNS entry in extension/content.js and to a <Switch>
// toggle in app/settings/page.js. Default value is false so the
// extension leaves the host field untouched unless the user has
// explicitly opted in.
export const INDUSTRY_BOOLEAN_KEYS = [
  'canLiftHeavy',
  'canShiftWork',
  'hasCareAssistantEducation',
  'hasHLRCertification',
  'hasNursingExperience',
  'hasOfficeExperience',
  'hasComputerSkills',
  'hasCodingExperience',
  'hasConstructionExperience',
  'canWorkAtHeights',
  'hasFoodHandlingCertificate',
  'hasServiceExperience',
  'hasSalesExperience',
  'hasIndustrialExperience',
  'hasTruckLicenseCE',
  'hasTransportExperience',
]

// Swedish UI labels — in RECRUITER-QUESTION form ("Kan du …?") so the
// settings toggle reads identically to the host-page question the
// extension's FIELD_PATTERNS dispatch on.
export const INDUSTRY_BOOLEAN_LABELS = {
  canLiftHeavy: 'Klarar du fysiskt krävande arbete (t.ex. lyfta tungt)?',
  canShiftWork: 'Kan du arbeta skift (dag/kväll/natt)?',
  hasCareAssistantEducation: 'Har du vårdbiträdes- eller undersköterskeutbildning?',
  hasHLRCertification: 'Har du HLR-certifikat (hjärt- och lungräddning)?',
  hasNursingExperience: 'Har du erfarenhet av vård- och omsorgsarbete?',
  hasOfficeExperience: 'Har du kontors- eller administrationserfarenhet?',
  hasComputerSkills: 'Har du god datorvana (Office, verksamhetssystem)?',
  hasCodingExperience: 'Har du programmeringserfarenhet?',
  hasConstructionExperience: 'Har du bygg- eller anläggningserfarenhet?',
  canWorkAtHeights: 'Kan du arbeta på hög höjd?',
  hasFoodHandlingCertificate: 'Har du hygienutbildning / livsmedelstillstånd?',
  hasServiceExperience: 'Har du serverings- eller serviceerfarenhet?',
  hasSalesExperience: 'Har du säljerfarenhet?',
  hasIndustrialExperience: 'Har du industri- eller produktionserfarenhet?',
  hasTruckLicenseCE: 'Har du CE-körkort (lastbil)?',
  hasTransportExperience: 'Har du transport- eller körerfarenhet?',
}

// ---- Per-industry field sets (Tier 2 industry-core) ----
//
// A user who picks an industry is asked exactly these questions during
// onboarding (and sees them in /settings). Keys reference either
// ROUND12_BOOLEAN_KEYS or INDUSTRY_BOOLEAN_KEYS; labels are the
// canonical Swedish question. One key can appear in several industries
// (e.g. canShiftWork spans lager/vård/industri) — the profile key is
// shared, only the "asks" set differs.
export const INDUSTRY_FIELDS = {
  lager: [
    { key: 'hasForkliftLicense', label: 'Har du truckförarbevis?' },
    { key: 'canLiftHeavy', label: INDUSTRY_BOOLEAN_LABELS.canLiftHeavy },
    { key: 'canShiftWork', label: INDUSTRY_BOOLEAN_LABELS.canShiftWork },
    { key: 'hasDriversLicense', label: 'Har du B-körkort?' },
  ],
  vård: [
    { key: 'hasCareAssistantEducation', label: INDUSTRY_BOOLEAN_LABELS.hasCareAssistantEducation },
    { key: 'hasHLRCertification', label: INDUSTRY_BOOLEAN_LABELS.hasHLRCertification },
    { key: 'hasNursingExperience', label: INDUSTRY_BOOLEAN_LABELS.hasNursingExperience },
    { key: 'canShiftWork', label: INDUSTRY_BOOLEAN_LABELS.canShiftWork },
    { key: 'hasDriversLicense', label: 'Har du B-körkort?' },
  ],
  kontor: [
    { key: 'hasOfficeExperience', label: INDUSTRY_BOOLEAN_LABELS.hasOfficeExperience },
    { key: 'hasComputerSkills', label: INDUSTRY_BOOLEAN_LABELS.hasComputerSkills },
    { key: 'hasCustomerExperience', label: 'Har du kundserviceerfarenhet?' },
    { key: 'hasHighSchoolDiploma', label: 'Har du gymnasieexamen?' },
  ],
  IT: [
    { key: 'hasCodingExperience', label: INDUSTRY_BOOLEAN_LABELS.hasCodingExperience },
    { key: 'hasTechnicalEducation', label: 'Har du teknisk utbildning?' },
    { key: 'hasComputerSkills', label: INDUSTRY_BOOLEAN_LABELS.hasComputerSkills },
    { key: 'isBilingual', label: 'Är du tvåspråkig (SV + EN)?' },
  ],
  bygg: [
    { key: 'hasConstructionExperience', label: INDUSTRY_BOOLEAN_LABELS.hasConstructionExperience },
    { key: 'canWorkAtHeights', label: INDUSTRY_BOOLEAN_LABELS.canWorkAtHeights },
    { key: 'canLiftHeavy', label: INDUSTRY_BOOLEAN_LABELS.canLiftHeavy },
    { key: 'hasDriversLicense', label: 'Har du B-körkort?' },
  ],
  restaurang: [
    { key: 'hasFoodHandlingCertificate', label: INDUSTRY_BOOLEAN_LABELS.hasFoodHandlingCertificate },
    { key: 'hasServiceExperience', label: INDUSTRY_BOOLEAN_LABELS.hasServiceExperience },
    { key: 'canShiftWork', label: INDUSTRY_BOOLEAN_LABELS.canShiftWork },
  ],
  sälj: [
    { key: 'hasSalesExperience', label: INDUSTRY_BOOLEAN_LABELS.hasSalesExperience },
    { key: 'hasCustomerExperience', label: 'Har du kundserviceerfarenhet?' },
    { key: 'hasDriversLicense', label: 'Har du B-körkort?' },
    { key: 'isBilingual', label: 'Är du tvåspråkig (SV + EN)?' },
  ],
  industri: [
    { key: 'hasIndustrialExperience', label: INDUSTRY_BOOLEAN_LABELS.hasIndustrialExperience },
    { key: 'canShiftWork', label: INDUSTRY_BOOLEAN_LABELS.canShiftWork },
    { key: 'canLiftHeavy', label: INDUSTRY_BOOLEAN_LABELS.canLiftHeavy },
    { key: 'hasForkliftLicense', label: 'Har du truckförarbevis?' },
  ],
  transport: [
    { key: 'hasTruckLicenseCE', label: INDUSTRY_BOOLEAN_LABELS.hasTruckLicenseCE },
    { key: 'hasTransportExperience', label: INDUSTRY_BOOLEAN_LABELS.hasTransportExperience },
    { key: 'hasDriversLicense', label: 'Har du B-körkort?' },
    { key: 'canShiftWork', label: INDUSTRY_BOOLEAN_LABELS.canShiftWork },
  ],
}

// Flatten every industry-specific question label into one map for the
// settings form's full toggle list (an "alla branschfält" view).
export const ALL_INDUSTRY_FIELD_LABELS = Object.fromEntries(
  INDUSTRY_BOOLEAN_KEYS.map((k) => [k, INDUSTRY_BOOLEAN_LABELS[k]]),
)

export function fieldsForIndustry(industryId) {
  if (!industryId) return []
  return INDUSTRY_FIELDS[industryId] || []
}
