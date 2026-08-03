/**
 * lib/field-taxonomy.js — shared industry field taxonomy (Round-81/83).
 *
 * Single source of truth for the 9 JobbPiloten industries and their
 * industry-core ("Tier 2") application-form fields.
 *
 * Origin: the form-field corpus built by the isolated scraper
 * (~/jobbpiloten-scraper). `lib/data/extension_field_schema.json` is
 * the ground-truth evidence artifact (the Round-83 complete version —
 * "Scraped corpus + known industry patterns" — replacing the raw
 * scraper tiers; the 68-form corpus evidence history lives in
 * HANDOFF.md). This module is the curated, UX-ready projection of
 * that schema plus domain knowledge where the corpus is thin
 * (industries with few live forms).
 *
 * Two projections:
 *   • Round-81 — INDUSTRY_BOOLEAN_KEYS / INDUSTRY_FIELDS: the
 *     flat-boolean registry the extension's FIELD_PATTERNS dispatch on.
 *   • Round-83 — UNIVERSAL_FIELDS / INDUSTRY_STRUCTURED_FIELDS: the
 *     complete typed schema (select / multiselect / text / url /
 *     textarea / file) stored on the profile as
 *     `industryFields[<industryId>][<fieldId>]` (nested per industry)
 *     and dual-written onto the legacy booleans where a 1:1 mapping
 *     exists (STRUCTURED_TO_BOOLEAN).
 *
 * Consumers (one-directional imports, no cycles):
 *   • app/onboarding/page.js      — industry dropdown + structured form
 *   • app/settings/page.js        — industry selector + field toggles
 *   • app/api/[[...path]]/route.js — profile POST/update validation
 *   • lib/extension-profile.js    — safe profile for the extension
 * The Chrome extension gets a bundled plain-JS copy at
 * extension/lib/field-taxonomy.js (no imports — MV3 content scripts
 * cannot load ESM modules from lib/).
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

// =====================================================================
// Round-83 — Complete structured (typed) industry field taxonomy
// =====================================================================
//
// Source: lib/data/extension_field_schema.json (complete version,
// Round-83 — "Scraped corpus + known industry patterns"). Where the
// scraper corpus was thin the schema was supplemented with known
// industry questions (truck types, ADR/YKB for transport, Office
// suite for kontor, …).
//
// This is the TYPED projection of the taxonomy: each field carries
// its UI type (`select` | `multiselect` | `text` | `url` | `textarea`
// | `file`), an option list for select/multiselect, and a `required`
// flag. Answers are stored on the profile under
// `profile.industryFields[<industryId>][<fieldId>]` (a nested object
// per the Round-83 Mongo contract) and ALSO dual-written onto the
// legacy flat booleans (INDUSTRY_BOOLEAN_KEYS) where a 1:1 mapping
// exists so the pre-Round-83 extension fill + tests stay green.
//
// The 9 industry ids mirror INDUSTRY_IDS above — drift is locked by
// tests/unit/field-taxonomy-industries.test.mjs.

// ---- Universal fields (every application form asks for these) ----
//
// `key` = the safe-extension-profile key the popup reads for status
// (file-typed fields use the stored-file key; `answers.availability`
// is nested under the answers object). `personalNumber` is listed for
// schema completeness but is deliberately NOT surfaced in the
// extension popup (the safe profile excludes it — see
// lib/extension-profile.js).
export const UNIVERSAL_FIELDS = [
  { id: 'full_name', key: 'fullName', label: 'Fullständigt namn', type: 'text', required: true },
  { id: 'email', key: 'email', label: 'E-post', type: 'email', required: true },
  { id: 'phone', key: 'phone', label: 'Telefon', type: 'tel', required: true },
  { id: 'address', key: 'address', label: 'Adress', type: 'text', required: false },
  { id: 'postal_code', key: 'zip', label: 'Postnummer', type: 'text', required: false },
  { id: 'city', key: 'city', label: 'Stad', type: 'text', required: false },
  { id: 'personal_number', key: 'personalNumber', label: 'Personnummer', type: 'text', required: false, pattern: '\\d{8}-\\d{4}' },
  { id: 'linkedin', key: 'linkedin', label: 'LinkedIn-profil', type: 'url', required: false },
  { id: 'summary', key: 'cvSummary', label: 'Sammanfattning / Profiltext', type: 'textarea', required: false },
  { id: 'cv', key: 'cvFileName', label: 'Ladda upp CV', type: 'file', required: true, accept: '.pdf,.doc,.docx' },
  { id: 'cover_letter', key: 'latestCoverLetter', label: 'Personligt brev', type: 'file', required: false, accept: '.pdf,.doc,.docx' },
  { id: 'other_documents', key: 'otherDocuments', label: 'Övriga dokument', type: 'file', required: false, accept: '.pdf,.doc,.docx' },
  { id: 'availability', key: 'answers.availability', label: 'När kan du börja?', type: 'select', options: ['Omgående', 'Inom 1 vecka', 'Inom 1 månad', 'Enligt överenskommelse'], required: false },
  { id: 'salary_expectation', key: 'salaryExpectation', label: 'Löneanspråk', type: 'text', required: false },
]

// ---- Per-industry structured fields (Tier 2 industry-core) ----
//
// Display order within each industry = the onboarding/settings form
// order. ids are stable storage keys (snake_case, mirroring the
// schema); labels are the canonical Swedish recruiter question.
export const INDUSTRY_STRUCTURED_FIELDS = {
  lager: [
    { id: 'forklift_license', label: 'Har du truckkörkort?', type: 'select', options: ['Ja', 'Nej', 'Pågående'], required: true },
    { id: 'forklift_types', label: 'Vilka trucktyper har du kört?', type: 'multiselect', options: ['A1 - låglyftande', 'A2 - låglyftande med plattform', 'A3 - höglyftande', 'A4 - höglyftande med plattform', 'B1 - motviktstruck', 'B2 - teleskoptruck', 'D1 - skjutstativtruck'], required: false },
    { id: 'physical_capacity', label: 'Kan du arbeta fysiskt krävande arbete?', type: 'select', options: ['Ja', 'Nej'], required: true },
    { id: 'shift_work', label: 'Kan du arbeta skift?', type: 'select', options: ['Ja', 'Nej', 'Endast dagtid', 'Endast kväll', 'Endast natt'], required: true },
    { id: 'heavy_lifting', label: 'Kan du lyfta tungt (upp till 25 kg)?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'warehouse_experience', label: 'Hur många års erfarenhet har du av lagerarbete?', type: 'select', options: ['Ingen', 'Mindre än 1 år', '1-2 år', '3-5 år', 'Mer än 5 år'], required: false },
    { id: 'driving_license_b', label: 'Har du körkort B?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'reach_truck', label: 'Har du erfarenhet av skjutstativtruck?', type: 'select', options: ['Ja', 'Nej'], required: false },
  ],
  'vård': [
    { id: 'care_certificate', label: 'Har du vårdbiträdesutbildning?', type: 'select', options: ['Ja', 'Nej', 'Pågående'], required: true },
    { id: 'hlr_certificate', label: 'Har du HLR-certifikat?', type: 'select', options: ['Ja', 'Nej', 'Pågående'], required: false },
    { id: 'hygiene_pass', label: 'Har du hygienpass?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'first_aid', label: 'Har du första hjälpen-utbildning?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'healthcare_experience', label: 'Hur många års erfarenhet har du inom vård?', type: 'select', options: ['Ingen', 'Mindre än 1 år', '1-2 år', '3-5 år', 'Mer än 5 år'], required: false },
    { id: 'night_shift_care', label: 'Kan du arbeta natt inom vård?', type: 'select', options: ['Ja', 'Nej', 'Endast dag/kväll'], required: true },
    { id: 'dementia_care', label: 'Har du erfarenhet av demensvård?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'lifting_patients', label: 'Kan du hantera patientförflyttning?', type: 'select', options: ['Ja', 'Nej'], required: false },
  ],
  kontor: [
    { id: 'office_experience', label: 'Hur många års erfarenhet har du av kontorsarbete?', type: 'select', options: ['Ingen', 'Mindre än 1 år', '1-2 år', '3-5 år', 'Mer än 5 år'], required: false },
    { id: 'computer_skills', label: 'Har du god datorvana?', type: 'select', options: ['Ja', 'Nej'], required: true },
    { id: 'microsoft_office', label: 'Vilka Microsoft Office-program behärskar du?', type: 'multiselect', options: ['Word', 'Excel', 'PowerPoint', 'Outlook', 'Teams', 'Ingen'], required: false },
    { id: 'language_swedish', label: 'Svenska i tal och skrift', type: 'select', options: ['Modersmål', 'Flytande', 'God', 'Grundläggande'], required: true },
    { id: 'language_english', label: 'Engelska i tal och skrift', type: 'select', options: ['Flytande', 'God', 'Grundläggande', 'Ingen'], required: false },
    { id: 'customer_service', label: 'Har du erfarenhet av kundtjänst?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'phone_skills', label: 'Känner du dig bekväm med telefonarbete?', type: 'select', options: ['Ja', 'Nej'], required: false },
  ],
  IT: [
    { id: 'programming_languages', label: 'Vilka programmeringsspråk behärskar du?', type: 'multiselect', options: ['JavaScript', 'TypeScript', 'Python', 'Java', 'C#', 'PHP', 'Ruby', 'Go', 'Rust', 'SQL', 'Ingen'], required: false },
    { id: 'frameworks', label: 'Vilka ramverk/plattformar har du erfarenhet av?', type: 'multiselect', options: ['React', 'Next.js', 'Vue', 'Angular', 'Node.js', 'Django', 'Laravel', '.NET', 'Spring', 'Ingen'], required: false },
    { id: 'years_it_experience', label: 'Hur många års erfarenhet har du inom IT?', type: 'select', options: ['Ingen', 'Mindre än 1 år', '1-2 år', '3-5 år', '5-10 år', 'Mer än 10 år'], required: true },
    { id: 'remote_work', label: 'Vill du arbeta remote, hybrid eller på plats?', type: 'select', options: ['Endast remote', 'Helst remote', 'Hybrid', 'Helst på plats', 'Endast på plats'], required: false },
    { id: 'github_portfolio', label: 'Länk till GitHub/portfolio', type: 'url', required: false },
    { id: 'certifications', label: 'IT-certifieringar', type: 'multiselect', options: ['AWS', 'Azure', 'Google Cloud', 'CompTIA', 'Cisco', 'Scrum/Agile', 'Ingen'], required: false },
    { id: 'database_experience', label: 'Databaser du har erfarenhet av', type: 'multiselect', options: ['MySQL', 'PostgreSQL', 'MongoDB', 'SQL Server', 'Oracle', 'Redis', 'Ingen'], required: false },
  ],
  bygg: [
    { id: 'construction_experience', label: 'Hur många års erfarenhet har du inom bygg?', type: 'select', options: ['Ingen', 'Mindre än 1 år', '1-2 år', '3-5 år', 'Mer än 5 år'], required: false },
    { id: 'driving_license_b', label: 'Har du körkort B?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'driving_license_c', label: 'Har du körkort C/CE?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'work_at_height', label: 'Kan du arbeta på höjd?', type: 'select', options: ['Ja', 'Nej'], required: true },
    { id: 'safety_training', label: 'Har du byggarbetsmiljöutbildning?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'tool_experience', label: 'Vilka verktyg/maskiner har du erfarenhet av?', type: 'multiselect', options: ['Handverktyg', 'Elverktyg', 'Svets', 'Grävmaskin', 'Kran', 'Lift', 'Ingen'], required: false },
    { id: 'physical_capacity', label: 'Kan du arbeta fysiskt krävande arbete?', type: 'select', options: ['Ja', 'Nej'], required: true },
  ],
  restaurang: [
    { id: 'food_handling', label: 'Har du hygienpass för livsmedel?', type: 'select', options: ['Ja', 'Nej', 'Pågående'], required: true },
    { id: 'serving_license', label: 'Har du serveringscertifikat (alkohol)?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'kitchen_experience', label: 'Hur många års erfarenhet har du från kök?', type: 'select', options: ['Ingen', 'Mindre än 1 år', '1-2 år', '3-5 år', 'Mer än 5 år'], required: false },
    { id: 'serving_experience', label: 'Hur många års erfarenhet har du från servering?', type: 'select', options: ['Ingen', 'Mindre än 1 år', '1-2 år', '3-5 år', 'Mer än 5 år'], required: false },
    { id: 'shift_work', label: 'Kan du arbeta kvällar och helger?', type: 'select', options: ['Ja', 'Nej', 'Endast kväll', 'Endast helg'], required: true },
    { id: 'stress_tolerance', label: 'Trivs du i ett högt arbetstempo?', type: 'select', options: ['Ja', 'Nej'], required: false },
  ],
  'sälj': [
    { id: 'sales_experience', label: 'Hur många års erfarenhet har du inom försäljning?', type: 'select', options: ['Ingen', 'Mindre än 1 år', '1-2 år', '3-5 år', 'Mer än 5 år'], required: false },
    { id: 'b2b_b2c', label: 'Har du erfarenhet av B2B eller B2C-försäljning?', type: 'multiselect', options: ['B2B', 'B2C', 'Båda', 'Ingen'], required: false },
    { id: 'driving_license_b', label: 'Har du körkort B?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'target_driven', label: 'Trivs du med resultatbaserade mål?', type: 'select', options: ['Ja', 'Nej'], required: true },
    { id: 'customer_meetings', label: 'Är du bekväm med kundbesök?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'phone_sales', label: 'Har du erfarenhet av telefonförsäljning?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'language_swedish', label: 'Svenska i tal och skrift', type: 'select', options: ['Modersmål', 'Flytande', 'God', 'Grundläggande'], required: true },
  ],
  industri: [
    { id: 'production_experience', label: 'Hur många års erfarenhet har du från industri/produktion?', type: 'select', options: ['Ingen', 'Mindre än 1 år', '1-2 år', '3-5 år', 'Mer än 5 år'], required: false },
    { id: 'shift_work', label: 'Kan du arbeta skift?', type: 'select', options: ['Ja', 'Nej', 'Endast dagtid', 'Endast kväll', 'Endast natt'], required: true },
    { id: 'physical_capacity', label: 'Kan du arbeta fysiskt krävande arbete?', type: 'select', options: ['Ja', 'Nej'], required: true },
    { id: 'machine_operation', label: 'Har du erfarenhet av maskindrift?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'quality_control', label: 'Har du erfarenhet av kvalitetskontroll?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'safety_training', label: 'Har du industriell säkerhetsutbildning?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'forklift_license', label: 'Har du truckkörkort?', type: 'select', options: ['Ja', 'Nej', 'Pågående'], required: false },
  ],
  transport: [
    { id: 'driving_license_c', label: 'Har du körkort C/CE?', type: 'select', options: ['Ja', 'Nej'], required: true },
    { id: 'ykb', label: 'Har du YKB (yrkeskompetensbevis)?', type: 'select', options: ['Ja', 'Nej', 'Pågående'], required: true },
    { id: 'digital_tacho', label: 'Har du erfarenhet av digital färdskrivare?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'adr_certificate', label: 'Har du ADR-certifikat (farligt gods)?', type: 'select', options: ['Ja', 'Nej'], required: false },
    { id: 'driving_experience', label: 'Hur många års erfarenhet har du av yrkeskörning?', type: 'select', options: ['Ingen', 'Mindre än 1 år', '1-2 år', '3-5 år', 'Mer än 5 år'], required: false },
    { id: 'long_distance', label: 'Kan du köra långdistans?', type: 'select', options: ['Ja', 'Nej', 'Endast region'], required: false },
    { id: 'night_driving', label: 'Kan du köra natt?', type: 'select', options: ['Ja', 'Nej'], required: false },
  ],
}

// ---- Structured field id → legacy flat boolean key ----
//
// Round-83 dual-write bridge. Where a structured question has a clear
// 1:1 legacy boolean equivalent, the onboarding/API write the answer
// to BOTH `industryFields` AND the flat boolean so the pre-Round-83
// extension fill + tests keep working. Selects whose options are
// years/levels ("Ingen"…"Mer än 5 år") map to the boolean via
// structuredAnswerToBoolean() (anything ≠ "Nej"/"Ingen" → true).
export const STRUCTURED_TO_BOOLEAN = {
  forklift_license: 'hasForkliftLicense',
  physical_capacity: 'canLiftHeavy',
  shift_work: 'canShiftWork',
  driving_license_b: 'hasDriversLicense',
  care_certificate: 'hasCareAssistantEducation',
  hlr_certificate: 'hasHLRCertification',
  healthcare_experience: 'hasNursingExperience',
  office_experience: 'hasOfficeExperience',
  computer_skills: 'hasComputerSkills',
  customer_service: 'hasCustomerExperience',
  years_it_experience: 'hasCodingExperience',
  construction_experience: 'hasConstructionExperience',
  work_at_height: 'canWorkAtHeights',
  food_handling: 'hasFoodHandlingCertificate',
  kitchen_experience: 'hasServiceExperience',
  serving_experience: 'hasServiceExperience',
  sales_experience: 'hasSalesExperience',
  production_experience: 'hasIndustrialExperience',
  driving_license_c: 'hasTruckLicenseCE',
  driving_experience: 'hasTransportExperience',
}

// Best-effort mapping of a structured answer onto a boolean. Arrays
// (multiselect) → true when non-empty. Strings → false for the
// explicit negative values (nej / ingen / no / none / inte) AND for
// 'pågående' (in-progress): a user whose truck licence / certificate
// is only "Pågående" must NEVER have the legacy boolean dispatch
// click "Ja" on a "Har du X?" radio — the extension would
// misrepresent them as holding a finished licence. The targeted
// fill pass still handles 'Pågående' precisely (it picks the
// 'Pågående' option where present).
export function structuredAnswerToBoolean(answer) {
  if (answer == null || answer === '') return false
  if (Array.isArray(answer)) return answer.length > 0
  const s = String(answer).toLowerCase().trim()
  return !['nej', 'ingen', 'inget', 'no', 'none', 'inte', 'pågående'].includes(s)
}

// ---- Round-83 validation/coercion helper (shared by the API routes) ----
//
// Returns a cleaned `{ fieldId: value }` object for the given
// industry. Unknown field ids and values outside the field's option
// list (select/multiselect) are dropped; text/url answers are
// capped at 500 chars. File-typed fields are never accepted here
// (they are uploaded via CVFileUpload, not posted as text).
export function sanitizeIndustryFields(industryId, raw) {
  const defs = INDUSTRY_STRUCTURED_FIELDS[industryId]
  if (!defs || !raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const def of defs) {
    if (!Object.prototype.hasOwnProperty.call(raw, def.id)) continue
    const v = raw[def.id]
    if (v == null || v === '') continue
    if (def.type === 'multiselect') {
      if (Array.isArray(v)) {
        const cleaned = v.filter((x) => typeof x === 'string' && def.options.includes(x))
        if (cleaned.length > 0) out[def.id] = Array.from(new Set(cleaned))
      }
    } else if (def.type === 'select') {
      if (typeof v === 'string' && def.options.includes(v)) out[def.id] = v
    } else if (def.type === 'text' || def.type === 'url' || def.type === 'email' || def.type === 'tel' || def.type === 'textarea') {
      if (typeof v === 'string') out[def.id] = v.slice(0, 500)
    }
    // file-typed fields are intentionally skipped (uploaded elsewhere)
  }
  return out
}

// Map a cleaned industryFields object onto the legacy flat booleans
// (dual-write). Only fields with a STRUCTURED_TO_BOOLEAN entry
// contribute; the boolean value comes from structuredAnswerToBoolean.
export function industryFieldsToBooleans(industryId, fields) {
  const out = {}
  if (!fields || typeof fields !== 'object') return out
  for (const [fieldId, value] of Object.entries(fields)) {
    const boolKey = STRUCTURED_TO_BOOLEAN[fieldId]
    if (boolKey) out[boolKey] = structuredAnswerToBoolean(value)
  }
  return out
}

// Convenience: the structured field set for an industry (or []).
export function structuredFieldsFor(industryId) {
  if (!industryId) return []
  return INDUSTRY_STRUCTURED_FIELDS[industryId] || []
}
