/**
 * extension/lib/field-taxonomy.js — bundled copy of the shared industry
 * taxonomy (app-side source of truth: lib/field-taxonomy.js).
 *
 * MV3 content scripts cannot import ESM modules from lib/, so this is a
 * hand-synced plain-JS projection. The industry field sets power:
 *   • extension/content.js  — industry FIELD_PATTERNS dispatch (a
 *     matched question routes to the profile key, e.g. canShiftWork)
 *   • extension/popup.js     — "Relevanta fält för din bransch" list
 *
 * Keep this file byte-consistent with lib/field-taxonomy.js in the app
 * repo. The scraper's extension_field_schema.json (Tier 2 rows) is the
 * ground-truth evidence for the per-industry sets below.
 */
const FIELD_TAXONOMY = {
  industries: [
    { id: 'lager', label: 'Lager & logistik' },
    { id: 'vård', label: 'Vård & omsorg' },
    { id: 'kontor', label: 'Kontor & administration' },
    { id: 'IT', label: 'IT & teknik' },
    { id: 'bygg', label: 'Bygg & anläggning' },
    { id: 'restaurang', label: 'Restaurang & hotell' },
    { id: 'sälj', label: 'Försäljning' },
    { id: 'industri', label: 'Industri & produktion' },
    { id: 'transport', label: 'Transport' },
  ],
  labels: {
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
    hasDriversLicense: 'Har du B-körkort?',
    hasForkliftLicense: 'Har du truckförarbevis?',
    hasCustomerExperience: 'Har du kundserviceerfarenhet?',
    hasHighSchoolDiploma: 'Har du gymnasieexamen?',
    hasTechnicalEducation: 'Har du teknisk utbildning?',
    isBilingual: 'Är du tvåspråkig (SV + EN)?',
  },
  // key -> canonical Swedish question labels for questions the
  // extension may meet (used by the popup list + tooltips).
  fields: {
    lager: [
      { key: 'hasForkliftLicense' },
      { key: 'canLiftHeavy' },
      { key: 'canShiftWork' },
      { key: 'hasDriversLicense' },
    ],
    vård: [
      { key: 'hasCareAssistantEducation' },
      { key: 'hasHLRCertification' },
      { key: 'hasNursingExperience' },
      { key: 'canShiftWork' },
      { key: 'hasDriversLicense' },
    ],
    kontor: [
      { key: 'hasOfficeExperience' },
      { key: 'hasComputerSkills' },
      { key: 'hasCustomerExperience' },
      { key: 'hasHighSchoolDiploma' },
    ],
    IT: [
      { key: 'hasCodingExperience' },
      { key: 'hasTechnicalEducation' },
      { key: 'hasComputerSkills' },
      { key: 'isBilingual' },
    ],
    bygg: [
      { key: 'hasConstructionExperience' },
      { key: 'canWorkAtHeights' },
      { key: 'canLiftHeavy' },
      { key: 'hasDriversLicense' },
    ],
    restaurang: [
      { key: 'hasFoodHandlingCertificate' },
      { key: 'hasServiceExperience' },
      { key: 'canShiftWork' },
    ],
    sälj: [
      { key: 'hasSalesExperience' },
      { key: 'hasCustomerExperience' },
      { key: 'hasDriversLicense' },
      { key: 'isBilingual' },
    ],
    industri: [
      { key: 'hasIndustrialExperience' },
      { key: 'canShiftWork' },
      { key: 'canLiftHeavy' },
      { key: 'hasForkliftLicense' },
    ],
    transport: [
      { key: 'hasTruckLicenseCE' },
      { key: 'hasTransportExperience' },
      { key: 'hasDriversLicense' },
      { key: 'canShiftWork' },
    ],
  },
}

// Convenience helpers (no global pollution — this file is bundled into
// content.js via a build step or loaded as a classic script in the
// popup; keep everything namespaced under FIELD_TAXONOMY).
if (typeof globalThis !== 'undefined') {
  globalThis.FIELD_TAXONOMY = FIELD_TAXONOMY
}
