/**
 * lib/extension-profile.js — single source of truth for the SAFE
 * profile shape served to the JobbPiloten Auto-Fill extension.
 *
 * Both `/api/extension/profile` (GET) and `/api/extension/token` (POST)
 * import this — so the mint-time snapshot the dashboard receives and
 * every refresh the extension pulls later is guaranteed to share the
 * exact same field set. Adding a new field to the extension only
 * requires touching this file, not two route files.
 *
 * SAFETY: SENSITIVE FIELDS THAT MUST NEVER APPEAR HERE
 *   • `clerkId`        (auth credential — extension token is the credential)
 *   • `cvText`         (20+ KB free-form text — blows past chrome.storage)
 *   • `profilePicture` (data URLs up to 2-3 MB — same storage pressure)
 *   • `personalNumber` (Swedish personnummer — bank ID / credit-checks)
 *
 * If a downstream consumer needs a stripped private field, intentionally
 * add it here and back-link the reason in this comment so a future
 * reviewer doesn't re-add it server-side thinking the matcher needs it.
 */
import { z } from 'zod'

// 2026-07-16 (Round-12) — Auto-fill field registry. The same module is
// imported by app/settings/page.js so the field set, defaults, and
// Swedish labels cannot drift between the safe-extension-profile
// builder (server) and the settings form (client). `getRound12Defaults`
// is the safe-empty baseline; we layer per-field strict type-coercion
// on top because Mongo can store `undefined`, `null`, or wrong-shape
// values for any of these 16 keys.
import {
  ROUND12_BOOLEAN_KEYS,
  ROUND12_STRING_KEYS,
  getRound12Defaults,
} from './extension-profile-fields.js'

/**
 * Compose the safe profile response the content script uses as the
 * canonical fill source.
 *
 * @param {Object} profile             full profile document from MongoDB
 * @param {Object|null} latestApplication full application document, or null
 * @returns {Object}                    JSON-safe object the extension consumes
 */
// ---- 2026-07-21 (BUG 3 helper) — parseAddressComponents() ----
//
// Splits a raw Swedish address string into structured
// { street, zip, city, country } components. Recognises the
// common Swedish format "<Streetname>, <City>, <123 45>, <Country>"
// but the parser is permissive: segments are matched by
// fingerprint, not by position, so weird real-world orders
// ("Sverige, 123 45 Angered, Streetname 30") still resolve
// correctly. The function NEVER throws — a malformed input
// degrades to { street: '', zip: '', city: '', country: '' }
// so the build stays non-throwing for the content-script fill
// path.
//
// Format fingerprint table:
//   • ZIP  — `\d{3}\s?\d{2}` (Swedish: "123 45" or "12345")
//   • COUNTRY — exact-match against the country allow-list
//   • STREET — assumed to be the FIRST segment not matched by
//              the other fingerprints (per convention, but the
//              function will skip forward)
//   • CITY  — first text-only segment that follows either the
//              street or the zip, whichever comes first
function parseAddressComponents(rawAddress) {
  const empty = { street: '', zip: '', city: '', country: '' }
  if (!rawAddress || typeof rawAddress !== 'string') return empty
  const trimmed = rawAddress.trim()
  if (!trimmed) return empty
  const COUNTRY = /^(sverige|norge|danmark|finland|island|sweden|norway|denmark|finland|iceland)$/i
  const ZIP = /^(\d{3}\s?\d{2})$/
  const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return empty
  // Single-line fallback: try to peel a trailing ZIP off the
  // end of a single segment; otherwise the whole thing is the
  // street.
  if (parts.length === 1) {
    const m = parts[0].match(/^(.+?)\s+(\d{3}\s?\d{2})$/)
    if (m) return { street: m[1].trim(), zip: m[2], city: '', country: '' }
    return { street: parts[0], zip: '', city: '', country: '' }
  }
  // Multi-part: classify each.
  const classified = parts.map((p) => {
    if (COUNTRY.test(p)) return 'country'
    if (ZIP.test(p.replace(/\s/g, ''))) return 'zip'
    return 'text'
  })
  let street = '', zip = '', city = '', country = ''
  for (let i = 0; i < parts.length; i++) {
    if (classified[i] === 'country' && !country) country = parts[i]
    else if (classified[i] === 'zip' && !zip) zip = parts[i]
  }
  const textParts = parts.filter((_, i) => classified[i] === 'text')
  if (textParts.length >= 1 && !street) street = textParts[0]
  if (textParts.length >= 2 && !city) city = textParts[1]
  return { street, zip, city, country }
}

export function buildExtensionProfile(profile, latestApplication) {
  // Safe-empty defaults — used as the fallback when Mongo has no value
  // for one of the new Round-12 fields (e.g. a brand-new profile). The
  // strict type-coercion below turns each `undefined` / `null` / wrong-
  // shape value into the canonical safe default so the extension's
  // `resolveProfileRaw` always sees the right type.
  const r12Defaults = getRound12Defaults()

  // Split fullName into parts so the dedicated firstName/lastName
  // fields still work for forms that split the name (LinkedIn /
  // Workday split; Swedish ATS sites typically don't).
  const fullName = String(profile?.fullName || '').trim()
  const nameParts = fullName.split(/\s+/).filter(Boolean)
  const firstName = profile?.firstName || nameParts[0] || ''
  const lastName = profile?.lastName || nameParts.slice(1).join(' ') || ''

  // Split-address heuristic — most forms want "Stad" individually
  // rather than the full address. We expose `address` and `city`
  // separately so the regex in content.js can route either way.
  //
  // 2026-07-21 (BUG 3 fix) — multi-part address splitter. The
  // pre-fix shape took `address.split(',').slice(-1)[0]` as city,
  // which on the canonical Swedish "street, city, 123 45, country"
  // shape returned "Sverige" (the country) instead of the city,
  // and on a single-part address returned the FULL string as city.
  // Both cases produced the "all address fields show the same
  // full string" symptom 8/8 forms reported. The fix:
  //   • parseAddressComponents() walks comma segments, identifies
  //     each by its Swedish-pattern fingerprint (3-4 digit+space
  //     ZIP, country-name match), and emits per-component
  //   • expose `street`, `zip`, `city`, `country` ALONGSIDE the
  //     raw `address` string so existing patterns (which look up
  //     profile.address as a legacy fallback) still work
  //   • content.js FIELD_PATTERNS also gains entries for `street`
  //     and `country` so the dedicated UI fields hit the right
  //     key. The legacy `address` pattern remains the catch-all
  //     for non-split generic address inputs.
  const address = String(profile?.address || '').trim()
  const addressParts = parseAddressComponents(address)
  // Backwards-compat: legacy callers reading `city` Get the
  // extracted city component (or '' when not parseable), NOT the
  // raw trailing comma-segment.
  const city = addressParts.city

  // Fallback answers from cvSummary so a user with a written CV
  // summary gets a sensible draft in "whyThisRole" / "strengths"
  // textareas on the host page even before the AI-adaptation layer
  // ships (Round 2 of the spec). Edit cvSummary + extend the
  // answers.steps in /settings to override.
  const fallbackStrengths = profile?.cvSummary
    ? profile.cvSummary.split('\n').slice(0, 2).join(' ').slice(0, 280)
    : ''
  const fallbackWhy = profile?.cvSummary
    ? `Jag ser mig själv som en bra match för rollen baserat på min bakgrund inom ${
        (profile?.jobTitles || [])[0] || 'branschen'
      }.`
    : ''

  return {
    // Identity (split-name covers both single + separated-field forms)
    fullName,
    firstName,
    lastName,
    // Contact (LinkedIn is filtered to detect data-qa / data-testid in
    // content.js too so ATS pages that hide it under those attrs still
    // route through the link/linkedin regex).
    email: profile?.email || '',
    phone: profile?.phone || '',
    // 2026-07-21 (BUG 3) — expose per-component address keys so
    // content.js's MATCHED entries route the right component to
    // the right UI field. The legacy `address` is dropped to the
    // raw street-only string so a generic "address" field gets
    // just the street line (not the full multi-part blob); the
    // remaining components stay accessible via `street`/`zip`/
    // `city`/`country`.
    address: addressParts.street || address,
    street: addressParts.street,
    zip: addressParts.zip,
    city: addressParts.city,
    country: addressParts.country,
    zip: '', // No zip field today; expose as '' so the content script
             // doesn't crash on a missing-key lookup.
    linkedin: profile?.linkedin || '',
    // personalNumber intentionally OMITTED — see file-level comment.
    salaryExpectation: profile?.salaryMin || null,
    experience: profile?.experience || '',
    workPreference: profile?.workPreference || '',
    employmentType: profile?.employmentType || '',
    languages: profile?.languages || [],
    answers: {
      whyThisCompany: profile?.answers?.whyThisCompany || fallbackWhy,
      whyThisRole: profile?.answers?.whyThisRole || fallbackWhy,
      strengths: profile?.answers?.strengths || fallbackStrengths,
      weaknesses: profile?.answers?.weaknesses || '',
      challenge: profile?.answers?.challenge || '',
      availability: profile?.answers?.availability || 'Omgående',
    },
    // Cover-letter spec pattern — `user.latestCoverLetter`. Pass
    // through the most recent AI-generated cover letter so a
    // textarea labelled "personligt brev" gets a draft, not an
    // empty box.
    latestCoverLetter: latestApplication?.coverLetter || null,
    cvSummary: profile?.cvSummary || '',
    // ---- 2026-07-16 (Round-12) — Auto-fill extension fields ----
    // These are the new fields the Round-12 extension FIELD_PATTERNS
    // dispatch on. They were added to the dashboard settings page in
    // the same commit so users can populate them; the extension's
    // fillAll() reads them from chrome.storage.local.profile via
    // resolveProfileValue / resolveProfileRaw. Defaults are
    // permissive-empty so the extension can still run on a profile
    // that hasn't been touched yet (booleans → false → leave the
    // host field untouched; numbers → 0 → fall through as missing).
    //
    // Iteration is driven by ROUND12_BOOLEAN_KEYS / ROUND12_STRING_KEYS
    // (lib/extension-profile-fields.js) so a 17th field added to the
    // shared registry lands here automatically. Each field falls back
    // to the shared `r12Defaults` value when the Mongo doc is missing
    // the key, has the wrong type, or holds `null` / `undefined`.
    // Boolean credentials / licences — strict boolean coercion so the
    // JSON output is always `true | false` (never `undefined` / `null`).
    ...Object.fromEntries(
      ROUND12_BOOLEAN_KEYS
        .filter((k) => k !== 'autoConsent') // autoConsent handled below
        .map((k) => [
          k,
          Boolean(profile?.[k]) === true,
        ]),
    ),
    // Number: years of experience. The extension parses a "minst X år"
    // threshold from the question text and compares profile.yearsExperience
    // against it. Default 0 means any threshold question → false unless
    // the user has explicitly set their years count.
    yearsExperience: Number.isFinite(Number(profile?.yearsExperience))
      ? Number(profile.yearsExperience)
      : r12Defaults.yearsExperience,
    // Demographics (select / text) — string-typed, default ''.
    ...Object.fromEntries(
      ROUND12_STRING_KEYS
        .filter((k) => k !== 'phoneCountryCode') // phoneCountryCode handled below
        .map((k) => [
          k,
          typeof profile?.[k] === 'string' ? profile[k] : r12Defaults[k],
        ]),
    ),
    // Default '+46' (Sweden) — the extension's gender/dob/etc. fields
    // typically pair with a country-code dropdown. Users editing the
    // profile can change to '+47' (NO) etc.; the form enforces length ≤ 8.
    phoneCountryCode: typeof profile?.phoneCountryCode === 'string' && profile.phoneCountryCode
      ? profile.phoneCountryCode
      : r12Defaults.phoneCountryCode,
    // Skills — string[] of competencies. The extension's multiselect
    // dispatch clicks checkboxes whose label text matches one of the
    // strings. Default [] so the extension leaves every checkbox alone
    // until the user opts in.
    skills: Array.isArray(profile?.skills)
      ? profile.skills.filter((s) => typeof s === 'string')
      : r12Defaults.skills,
    // GDPR / terms auto-consent. DEFAULT FALSE for legal safety —
    // clicking a GDPR consent checkbox on the user's behalf without
    // their explicit opt-in could bind them to a legal commitment.
    // The extension paints this with a dedicated `consent_unchecked`
    // slate-grey dashed outline (vs. yellow `missing`) so the user
    // sees the data IS on their profile and just needs to flip this
    // toggle if they want JobbPiloten to click for them.
    autoConsent: Boolean(profile?.autoConsent) === true,
  }
}

// ---- Zod request schemas ----
//
// Validates the request bodies the extension sends to /api/extension/*.
// Currently only the answer endpoint accepts a body, but the schema is
// exported so future extension endpoints can validate the same way
// instead of re-implementing per-field allow-lists inline.
//
// Note: the JSON body is `.safeParse`'d in the route, NOT `.parse`, so
// a malformed payload surfaces as a 400 with structured ZodError issues
// instead of throwing inside the route handler. The extension expects a
// non-2xx + JSON body, falls back to "no answer" gracefully.
export const ExtensionAnswerBodySchema = z.object({
  question: z.string().min(1).max(2_000),
  field: z.enum([
    'whyThisCompany',
    'whyThisRole',
    'strengths',
    'weaknesses',
    'challenge',
    'availability',
  ]),
  // Round-42 (Part 3 polish): per-question style override. The
  // popup's "Skrivstil för detta svar" dropdown writes this. The
  // server forwards it to the LLM as the style modifier; if the
  // field is absent, the profile's default `stylePreference` is
  // used (no behavioural change for pre-Round-42 clients).
  style: z.string().min(1).max(64).optional(),
})

// Mirror of the enum above for clients (content.js) and the existing
// manual allow-list in app/api/extension/answer/route.js \u2014 all three
// surfaces should read from this Set rather than hard-code the
// array. Used in content.js's AI_FIELDS check.
export const EXTENSION_ANSWER_FIELD_NAMES = [
  'whyThisCompany',
  'whyThisRole',
  'strengths',
  'weaknesses',
  'challenge',
  'availability',
]

// Convenience Set for the answer route — derived from the array above
// so the route's allow-list never drifts from the Zod enum when we
// add a 7th motivation field.
export const EXTENSION_ANSWER_FIELD_SET = new Set(EXTENSION_ANSWER_FIELD_NAMES)

// ---- Batch AI-answer Zod schema ----
//
// Sentinel identifiers for unmatched form fields. The content script's
// batch endpoint accepts any id from this set OR a generic `custom`
// id (the host page's free-text labels don't always match our
// motivation enum). The enum is deliberately open at the `custom`
// end so Workday / Greenhouse / Teamtailor / Platsbanken idiosyncratic
// questions still route through the AI without a code change.
export const EXTENSION_BATCH_FIELD_IDS = [
  ...EXTENSION_ANSWER_FIELD_NAMES,
  'custom',
]

// Hard cap on `fields.length` per call — tying the cap to a single
// `max(12)` constant keeps the LLM cost ceiling auditable. The
// number is also reflected in the settings-page copy ("max 12 svar
// per klick") so the user-visible wording can't drift from the code.
export const EXTENSION_BATCH_MAX_FIELDS = 12

// Per-field label cap. The 1.5 KB figure is the soft cap mirrored in
// extension/content.js (`slice(0, 1_500)`); doubling here gives the
// server room to defend against a hand-crafted curious-client POST.
export const EXTENSION_BATCH_LABEL_MAX = 3_000

export const ExtensionBatchAnswerBodySchema = z.object({
  fields: z.array(z.object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(EXTENSION_BATCH_LABEL_MAX),
    // The full DOM meta is also accepted so the server can reroute on
    // language if `lang` was wrong — client-side classification is
    // best-effort and the server is the source of truth.
    question: z.string().max(EXTENSION_BATCH_LABEL_MAX).optional(),
  })).min(1).max(EXTENSION_BATCH_MAX_FIELDS),
  jobUrl: z.string().url().max(2_000).optional().or(z.literal('')),
  jobTitle: z.string().max(280).optional().or(z.literal('')),
  // Optional `company`. Drives the LLM prompt's "at {company}"
  // slot so an answer can route on company-specific phrasing. The
  // extension scrapes the posting's <title> when it can; otherwise
  // the prompt falls back to "företaget" and the answer degrades
  // gracefully.
  company: z.string().max(280).optional().or(z.literal('')),
  // Best-effort language hint from the content script's tiny
  // heuristic. Server can ignore / override if the label disagrees.
  lang: z.enum(['sv', 'en']).optional(),
  // Round-42 (Part 3 polish): per-BATCH style override. The popup
  // can set "use this style for the whole batch" without per-field
  // UX. Optional — the per-field `style` key on the inner objects
  // takes precedence when present so the popup can mix-and-match.
  style: z.string().min(1).max(64).optional(),
})

export const EXTENSION_BATCH_FIELD_SET = new Set(EXTENSION_BATCH_FIELD_IDS)

// ---- Email-body Zod schema (Round-46 / Bug 1) ----
//
// Validates POST /api/extension/email-body requests. The compose
// panel fires before mailto opens so the body is structured
// (greeting + intro + CV-references + closing signature + CV
// attachment line). All fields are optional except `lang` defaults
// — the LLM call needs SOME context to produce a usable email,
// but the prompt gracefully handles empty jobTitle/company with
// the literal "företaget" / "tjänsten" placeholders so the email
// is still presentable on a sparsely-detected page.
//
// The defaults match the popup's compose panel contract: the
// extension may scrape jobTitle + company from the page <title>
// but the regex can't always recover both. Empty strings here
// mean "let the LLM infer" — never an error.
//
// Hard caps on string lengths mirror the existing /api/extension/*
// routes so a malicious POST can't blow up the Mongo read pool.
export const ExtensionEmailBodySchema = z.object({
  // jobUrl is the HTML fetch target for the LLM's job-context.
  // Empty string allowed (extension may not have access to the
  // page DOM yet). When present, server-side scrapes up to 4 KB
  // and follows up to 3 redirects, capped at 4s timeout.
  jobUrl: z.string().url().max(2_000).optional().or(z.literal('')),
  jobTitle: z.string().max(280).optional().or(z.literal('')),
  company: z.string().max(280).optional().or(z.literal('')),
  lang: z.enum(['sv', 'en']).optional(),
})

// ---- Email-draft Zod schema (Round-52 / Issue 1 — Mejlutkast flow) ----
//
// The Mejlutkast flow is what powers the user-in-compose experience
// (Gmail/Outlook compose windows). The popup sends:
//
//   - recipientEmail: REQUIRED — the address currently typed in the
//     Gmail/Outlook To: field. Used by the server to match against
//     recent applications (the candidate MAY have previously
//     applied to a job at this company).
//   - jobId: optional — when the user picked a specific job from
//     the "Vilket jobb gäller detta mejlet?" picker. Wins over the
//     matched-recent-application lookup.
//   - companyHint: optional — a free-text company name from the
//     page title (used when no recent application matches).
//   - lang: optional — 'sv' default; 'en' for English locales.
//
// Returns subject + body + matchedJob + recentJobs. The popup
// shows the matchedJob as the "best guess" pill and recentJobs as
// the picker fallback. Hard caps mirror ExtensionEmailBodySchema
// so the two routes share the same defensive posture.
export const ExtensionEmailDraftSchema = z.object({
  recipientEmail: z.string().min(3).max(280),
  jobId: z.string().max(64).optional().or(z.literal('')),
  companyHint: z.string().max(280).optional().or(z.literal('')),
  lang: z.enum(['sv', 'en']).optional(),
})
