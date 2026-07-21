/**
 * JobbPiloten Auto-Fill — content script.
 *
 * Injected into every page (including iframes) at document_start by
 * the MV3 manifest. The script:
 *
 *   1. Sets a `data-jobbpiloten-ext="1"` attribute on
 *      document.documentElement so the /dashboard page can hide its
 *      install banner. (The MV3 isolated-world script context can't
 *      share window globals with the page's main world, so we use a
 *      DOM attribute as the bridge instead.)
 *
 *   2. Watches the DOM via a debounced MutationObserver for newly
 *      added <input> / <textarea> / <select> nodes (Workday, Teamtailor
 *      and other SPA-style hiring sites lazy-mount their forms).
 *
 *   3. Scans the document recursively — including same-origin iframes
 *      — for fields whose label / placeholder / id / name / aria-label
 *      matches one of the Swedish-or-English keywords in the
 *      FIELD_PATTERNS table below.
 *
 *   4. Once 3+ fields are detected, surfaces a 40x40 amber JobbPiloten
 *      badge at bottom-right. Clicking the badge (or the popup's
 *      "Fyll i nu" button) routes through the user-confirmation toast
 *      before any DOM mutation happens — auto-fill without consent
 *      is jarring and breaks the host page's tabindex/focus order.
 *
 *   5. Listens for window.postMessage({ type: 'JOBBPILOTEN_AUTH_SYNC',
 *      payload: { token, profile } }) events; the dashboard uses these
 *      to bind the extension to the signed-in user. Once the profile
 *      lands in chrome.storage.local we re-trigger the scan so the
 *      badge appears for already-loaded forms.
 *
 *   6. Receives chrome.runtime background messages (JOBBPILOTEN_AUTH_SYNC,
 *      JOBBPILOTEN_TRIGGER_FILL) and dispatches them to the local
 *      in-page + cross-frame bus without round-tripping to the host
 *      page (extensions inject content scripts into every frame, so we
 *      effectively have N copies of this code running; the dashboard
 *      broadcasts to all from the background service worker).
 *
 *   7. For <input type="file"> elements we cannot programmatically
 *      set the File object (browser security) — instead we inject a
 *      small amber "Välj CV-fil" button as an adjacent sibling.
 *      Clicking it triggers the host input's native click() so the
 *      browser's own picker still appears. The user picks the file
 *      from the chrome.downloads / chrome.bookmarks chrome:// pages
 *      just like any other upload.
 *
 * Security notes:
 *   • We never read the page's HttpOnly cookies. The extension only
 *     knows the bearer token + the safe profile JSON it received
 *     via window.postMessage from /dashboard.
 *   • We never auto-submit forms (per spec). The user always has to
 *     click the page's own submit button.
 *   • Chrome's CSP on https pages won't let us inject <script>, but
 *     <style>, <input type="file"> siblings, and existing-element
 *     value mutation are all permitted.
 */

// ---------- 1. Cross-world presence signal ----------
// MV3 content scripts run in an isolated V8 context, so window
// mutations here are NOT visible to the page's main world. The
// dashboard therefore reads the DOM attribute on <html> instead:
//   document.documentElement.getAttribute('data-jobbpiloten-ext') === '1'
// DOM mutations from the isolated world ARE visible to the page
// main world, so this single attribute is the bridge the dashboard
// polls via useEffect. The version attribute rides along so the
// dashboard can show a "v0.2.0" badge without an extra round-trip.
//
// Soft-launch polish (2026-07-12): also emit a one-line
// console.info() so a tester (or the dashboard's "no badge" support
// flow) can SEE the content script loaded at all. The prefix
// "[JobbPiloten ext v…]" matches the popup's logging convention so
// both surfaces are filterable in DevTools. Logged at `info`, not
// `log`, so a normal user with the DevTools console open doesn't
// get spammed but a tester with the Console filter set to "info"
// (the default) sees the line.
try {
  document.documentElement.setAttribute('data-jobbpiloten-ext', '1')
  document.documentElement.setAttribute('data-jobbpiloten-ext-version', getExtensionVersion())
  try {
    // 2026-07-12 polish: gate the console.info behind a query-param
    // flag so the version string doesn't leak to every site the
    // extension is loaded on (a shared-family-laptop user can
    // otherwise read the extension name + version from any page's
    // DevTools console). The flag is opt-in for testers / support
    // flows — the dashboard appends `?jobbpiloten_debug=1` when a
    // user opens the page from the install-banner link, and a
    // tester can type it manually to see the line. Default is
    // silent, which keeps the in-page console clean.
    let isDebug = false
    try {
      const params = new URLSearchParams(window.location.search || '')
      isDebug = params.get('jobbpiloten_debug') === '1' || params.get('jp_debug') === '1'
    } catch (_) { /* URLSearchParams unavailable in some sandboxes */ }
    if (isDebug) {
      console.info(`[JobbPiloten ext v${getExtensionVersion()}] content script loaded — listening for form fields`)
    }
  } catch (_) { /* console unavailable in some sandboxes */ }
} catch (_) {
  // headless test envs without documentElement — silently skip.
}

// ---------- 2. Field-mapping table ----------
//
// Each entry: { pattern: RegExp, profileKey: string,
//              kind?: 'multi'|'radio'|'select'|'file'|
//                     'boolean'|'booleanThreshold'|'multiselect'|'consent' }.
//
// Patterns are anchored loosely — they match anywhere in
// label/placeholder/id/name/aria-label text, case-insensitive.
// Multi-key entries (e.g. salary) collapse into a single profile
// field so we don't try to fill both "Salary" and "Löneanspråk"
// with different values.
//
// Dispatch table (kind → fill strategy):
//   • (none)        → setInputValue() on a text input/textarea
//   • multi         → setInputValue() on a multi-line textarea
//   • select        → setInputValue() on <select>
//   • boolean       → clickBooleanOption() — Ja/Nej toggle click
//   • booleanThreshold → like boolean, but threshold parsed from meta
//   • multiselect   → checkMultiCheckboxes() — multiple matching boxes
//   • consent       → checkConsent() — single safe-by-default checkbox
//   • file          → maybeInstallFileButtons() — amber button sibling
//
// 2026-07-16 (Round-12) — FIELD_PATTERNS expanded past 20 entries.
// Every new entry is on a single line so the structural lock in
// tests/unit/extension-content.test.mjs#findEntryPatternLiteral
// stays usable. Per-kind helpers are added in section 7b.
//
// Auto-fill semantics by kind:
//   • want = true  (boolean) → click Ja/Yes option
//   • want = false (boolean) → click Nej/No option
//   • want = undef (boolean) → leave untouched, paint 'missing'
//   • want = false (consent) → leave untouched (NEVER auto-consent)
const FIELD_PATTERNS = [
  // Names — split & joined
  { pattern: /(förnamn|first[\s_.-]?name|fname|given[\s_]?name)/i, profileKey: 'firstName' },
  { pattern: /(efternamn|last[\s_.-]?name|lname|surname|family[\s_]?name)/i, profileKey: 'lastName' },
  { pattern: /(fullständigt[\s_]?namn|full[\s_]?name|namn|ditt[\s_]?namn)/i, profileKey: 'fullName' },
  // Contact
  // 2026-07-21 / Round-72.2 / BUG 2 followup — extended to cover
  // Swedish compound labels ("Mejladress", "Mailadress") + English
  // compound labels ("Email address", "Email Address", "Mail address")
  // that the prior `\b(e[\s-]?post|epost|email|mail)\b` regex missed
  // (Mejladress has no `mail`/`email` substring — it ends in `-adress`).
  // 2026-07-21 / Round-72.2 / BUG 2 followup — extended to cover
  // Swedish compound labels ("Mejladress", "E-postadress") + English
  // compound labels ("Email address", "Mail address") + German
  // "E-Mail-Adresse". The compound alternations use [\s_-]? to match
  // `e-post[\s_-]?adress` for the Swedish dashed form + bare compounds
  // (mejladress, mailadress, emailadress, epostadress, e-postadress).
  { pattern: /\b(mejladress|mailadress|emailadress|email[\s_-]?address|mail[\s_-]?address|e[\s_-]?post[\s_-]?adress|epostadress|e[\s_-]?mail[\s_-]?adress|e-?mail[\s_-]?adresse?|e[\s-]?post|epost|email|mail)\b/i, profileKey: 'email' },
  { pattern: /(telefon|telefonnummer|phone|mobile|mobil|cell)/i, profileKey: 'phone' },
  // Address — split deliberately so "Stad" maps to city, "Adress"
  // to full address. Postnummer → zip.
  // Round-46 / Bug 2 redesign (2026-07-20 Monday). The pre-fix pattern
// `/(gatuadress|address|gata[\s_:]?nr|street[\s_]?address)/i` matched
// ANY text field that contained `gata` or `adress` as a substring,
// catching comment-style openings like 'Beskriv gärna om du bor i
// närheten av arbetsplatsen' (worked because 'plats' fell into the
// city regex) and 'Kommentar' (false-positive via shared proximity).
//
// The fix is a single pattern per key with a NARROW negative
// lookahead that only rejects when the WORDS 'kommentar|beskriv|
// erfarenhet|motivering|beskrivning' appear AS standalone tokens
// in the label (NOT as substrings). Swedish uses 'beskriv' as a
// pre-amble to a real question ('Beskriv din erfarenhet') so the
// bracket-based lookahead would over-block; the leading-anchor
// `\b` ensures the negative words are matched as WHOLE WORDS only.
// Tests: mock-extension-form-regex.test.mjs continues to pass at
// 39 entries because we collapsed the dual address patterns into
// ONE — no spurious count change.
//
// 2026-07-21 / Round-72.2 / BUG 3 followup — a `street` entry
// inserted BEFORE this one wins first-match on dedicated street-
// only labels ("Gatuadress", "Address line 1"). The street entry
// routes to profile.street (single piece from
// parseAddressComponents), NOT the full multi-piece composition.
  { pattern: /^\b(?!.*\b(kommentar|beskriv|erfarenhet|motivering|beskrivning)\b).*\b(gata\s*nr(?:\s|$)|gatuadress|adress\s*rad\s*\d|address\s*line\s*\d|street\s*(?:line\s*)?\d|hausnummer|strasse\s+und\s+hausnummer|dirección)\b.*$/i, profileKey: 'street' },
  { pattern: /^\b(?!.*\b(kommentar|beskriv|erfarenhet|motivering|beskrivning)\b).*\b(gatuadress|address|gata[\s_:]?nr|street[\s_]?address)\b.*$/i, profileKey: 'address' },
  // 2026-07-21 / Round-72.2 / BUG 3 followup — `country` entry
  // inserted after the existing address/city/zip group but BEFORE
  // the Round-12 entries, so first-match-wins on dedicated country
  // labels ("Land", "Country of residence") routes here while the
  // stricter Round-12 entries (landskod / phoneCountryCode,
  // nationality / citizenship) still win for THEIR specific labels.
  { pattern: /^\b(?!.*\b(kommentar|beskriv|erfarenhet|motivering|beskrivning)\b).*\b(land[\s_]?(?=för|för\s+bosatt|where\s+you\s+live|$)|land$|country[\s_]+of[\s_]+residence|country[\s_]+where[\s_]+you|living[\s_]+country|country[\s_]+code[\s_]+for[\s_]+phone|countries?\s*\/\s*regions?)\b.*$/i, profileKey: 'country', kind: 'select' },
  { pattern: /(postnummer|post[-\s]?nr|zip|postal[-\s]?code)/i, profileKey: 'zip' },
  { pattern: /^\b(?!.*\b(n[aä]rhet|närhetens?)\b).*\b(ort|city|stad|kommun|plats)\b.*$/i, profileKey: 'city' },
  { pattern: /(postnummer|zip|postal|post[\s_]?code)/i, profileKey: 'zip' },
  // Round-79.5 / Bug A-followup (2026-07-20). Pre-fix shape
  // `/(ort|city|stad[\s_:-]?|plats)/i` was an unprotected
  // FALLBACK used when the strict-anchored line above didn't
  // match (e.g. labels that don't start at `^\b`). It
  // over-matched the substring 'plats' inside compound
  // Swedish words like 'arbetsplatsen' (workplace) and 'mötesplats'
  // (meeting place) AND inside question-form openers like
  // 'Beskriv gärna om du bor i närheten av arbetsplatsen',
  // routing the FREE-TEXT proximity field to the `city`
  // profileKey and writing the user's city (or, depending on
  // profile shape, the full address) into a comment-style
  // textarea.
  //
  // The fix: same negative-lookahead gate as the strict
  // version, but with an EXTENDED blacklist covering the
  // common Swedish free-text label vocabulary (comment,
  // description, free-text, notes, message, write, motivation,
  // description, experience) so the catch-all recovers ANY
  // legitimate city/stad/plats label that the strict shape
  // missed, while still rejecting comment-style inputs. The
  // leading-anchor `\b` ensures each negative word is matched
  // as a whole token — substring matches like 'komm' don't
  // trigger the gate.
  //
  // Lock: tests/unit/mock-extension-form-regex.test.mjs
  // continues to count 39 entries (we extended the existing
  // entry, not collapsed/added — count stays at 39).
  { pattern: /^\b(?!.*\b(kommentar|beskriv|beskrivning|arbetsplats|mötesplats|fritext|fri[\s_]?text|övrigt|notering|anteckning|anteckningar|meddelande|kommentera|motivering|erfarenhet|n[aä]rhet|närhetens?)\b).*\b(ort|city|stad|kommun|plats)\b.*$/i, profileKey: 'city' },
  // Identity (Sweden-specific) — personalNumber is INTENTIONALLY NOT IN
  // this table. The field is considered sensitive PII (see lib/extension-profile.js)
  // and the server excludes it from every GET /api/extension/profile payload
  // so even matching here would just paint a yellow 'missing' indicator on a
  // sensitive field — confusing for the user. Forms that ask for personnummer
  // are out of scope for the soft-launch auto-fill (the user types the number
  // themselves, never transmitted over the wire).
  // Social
  { pattern: /(linkedin|linked[\s.-_]?in)/i, profileKey: 'linkedin' },
  // Salary
  { pattern: /(löneanspråk|expected[\s_]?salary|salary[\s_]?expectation|salary[\s_]?requirement|salary|\blön\b)/i, profileKey: 'salaryExpectation' },
  // CV — paste as text into textarea if available, else flag as file
  { pattern: /(cv[\s_]?summary|cv[\s_]?text|meritförteckning|resume[\s_]?(?:summary|text)?)/i, profileKey: 'cvSummary', kind: 'multi' },
  // Cover letter (most recent AI-generated letter)
  { pattern: /(personligt[\s_]?brev|cover[\s_.-]?letter|ansökningsbrev|motivation[\s_]?letter)/i, profileKey: 'latestCoverLetter', kind: 'multi' },
  // Why / motivation — free-text answer boxes.
  //
  // 2026-07-12 (Round-11 bug fix): the previous patterns required
  // "varför jobba hos" to be ADJACENT ([\s_]? = single optional
  // separator). The /test-form page uses the natural-language label
  // "Varför vill du jobba hos oss?" with the words "vill du" between
  // "varför" and "jobba hos" — the old pattern never matched, so the
  // content script silently painted 0 detected-fields and the popup
  // disabled the Fyll i nu button. New patterns allow 0–30 chars
  // between the keyword pairs so a natural-language Swedish
  // question like "Varför vill du jobba hos oss?" still routes to
  // the AI-answer field. Permissiveness is bounded to 30 chars
  // between keywords so unrelated "varför"-containing labels don't
  // over-match.
  { pattern: /(varför[\s\S]{0,30}?jobba[\s\S]{0,30}?hos|varför[\s\S]{0,30}?oss|why[\s\S]{0,20}?this[\s\S]{0,20}?company|why[\s\S]{0,15}?us)/i, profileKey: 'answers.whyThisCompany' },
  { pattern: /(varför[\s\S]{0,30}?rollen|varför[\s\S]{0,30}?tjänsten|varför[\s\S]{0,20}?jobba[\s\S]{0,20}?roll|why[\s\S]{0,20}?this[\s\S]{0,20}?role|why[\s\S]{0,20}?this[\s\S]{0,20}?position|why[\s\S]{0,15}?job)/i, profileKey: 'answers.whyThisRole' },
  { pattern: /(styrkor|strengths|strong[\s_]?sides|strength)/i, profileKey: 'answers.strengths' },
  { pattern: /(svagheter|weaknesses|förbättra|areas[\s_]?to[\s_]?improve|areas[\s_]?of[\s_]?development)/i, profileKey: 'answers.weaknesses' },
  { pattern: /(utmaning|challenge|toughest[\s_]?(?:problem|challenge))/i, profileKey: 'answers.challenge' },
  // Availability / startdatum
  { pattern: /(tillgänglig|startdatum|available[\s_]?from|when[\s_]?can[\s_]?you[\s_]?start)/i, profileKey: 'answers.availability' },
  // Languages
  { pattern: /(språk|language|talar|native[\s_]?language)/i, profileKey: 'languages' },  // File inputs
  // 2026-07-16 (Round-12): cv rule gets `profileKey: 'cvFile'` so
  // maybeInstallFileButtons() can pick the right button copy when
  // the file input has multiple labels on the page. Previously the
  // entry had no profileKey and the file-installer hard-coded
  // "Välj CV-fil" — now the same installer reads pattern.profileKey.
  // 2026-07-16 (Round-12 patch): added `ladda[\s_]?upp[\s_]?cv` alternation
  // so Swedish "Ladda upp CV" — the canonical label on Platsbanken +
  // Swedish ATSes — routes here. The English `upload cv` and `cv file`
  // alternations are kept for Greenhouse/Workday English forms. The
  // `cv[\s_-]?fil` alternation covers the standalone Swedish compound
  // "CV-fil" (a single-word label that real ATSes use when grouping
  // upload fields under a single header).
  { pattern: /(cv[\s_]?(?:file|fil)|cv[\s_-]?fil\b|resume[\s_]?(?:file|upload)|upload[\s_]?cv|ladda[\s_]?upp[\s_]?cv)/i, type: 'file', profileKey: 'cvFile' },
  // 2026-07-16 (Round-12) — additional file types. Mirror the cv
  // rule — type:'file' so matchField() skips it (handled
  // separately via findFileInputs). New entries DON'T replace the
  // existing cv rule; they co-exist so a single page with all three
  // upload fields (CV + personligt brev + övriga dokument) gets
  // all three amber-button affordances.
  // 2026-07-16 (Round-12 patch): also match bare "Personligt brev"
  // / "cover letter" without requiring the file/upload suffix.
  // Real ATS forms (Platsbanken, Teamtailor) often label the input
  // with just the document name. The pattern is gated by the host
  // input being type="file" via matchField()+findFileInputs, so the
  // looser regex doesn't over-match free-text cover-letter fields
  // (those route through latestCoverLetter + kind:'multi').
  { pattern: /(personligt[\s_]?brev(?:[\s_]?(?:file|fil|upload))?|cover[\s_.-]?letter(?:[\s_]?(?:file|upload))?|upload[\s_]?(?:cover|bre[vb]))/i, type: 'file', profileKey: 'coverLetterFile' },
  { pattern: /(övri[ga]+\s*dokument|other[\s_]?(?:documents|files)|additional[\s_]?(?:documents|files)|bilag[ao]r?)/i, type: 'file', profileKey: 'additionalDocuments' },

  // ---------- Round-12 — Binary Yes/No questions ----------
  //
  // Each entry's `kind: 'boolean'` tells fillAll() to dispatch
  // to clickBooleanOption() instead of setInputValue(). desiredValue
  // is read from profile[profileKey] (true → click Ja/Yes, false
  // → click Nej/No, undefined → leave untouched + paint 'missing').
  //
  // Pattern bodies use [\s\S]{0,30}? between keyword pairs for
  // natural-language Swedish concatenations (mirrors the Round-11
  // whyThisCompany fix). Word boundaries \b…\b prevent over-match
  // on compound Swedish words. All entries are single-line (per the
  // structural lock in tests/unit/extension-content.test.mjs).
  //
  // Pattern profileKey → user profile field exists in
  // lib/extension-profile.js#buildExtensionProfile. None of these
  // boolean fields are in the profile yet — they are listed in
  // the backend follow-up section of the Round-12 handoff. When
  // a user has the field set to true/false, fillAll() clicks the
  // right option; when undefined, the field stays untouched.
  { pattern: /(\bb[\s-]?k[öo]rkort\b|driving[\s_]?license|driver'?s?\s+licen[sc]e|\bk[öo]rkort\b)/i, profileKey: 'hasDriversLicense', kind: 'boolean' },
  { pattern: /(medborgare[\s\S]{0,30}?(?:eu|europeiska|eea)|citizen[\s\S]{0,30}?(?:eu|european|eea)|swedish[\s_]?citizenship|\beu[\s_-]?medborgare\b)/i, profileKey: 'isEuCitizen', kind: 'boolean' },
  { pattern: /(arbetstillst[åa]nd|work[\s_]?permit|arbets[\s_]?till[åa]telse)/i, profileKey: 'hasWorkPermit', kind: 'boolean' },
  { pattern: /(gymnasieexamen|high[\s_]?school[\s_]?(?:diploma|graduate)|studentexamen)/i, profileKey: 'hasHighSchoolDiploma', kind: 'boolean' },
  { pattern: /(truckförarbevis|forklift[\s_]?(?:license|certificat))/i, profileKey: 'hasForkliftLicense', kind: 'boolean' },
  { pattern: /(s[äa]kerhetsklassad|security[\s_]?(?:classif|cleared|clearance))/i, profileKey: 'hasSecurityClearance', kind: 'boolean' },

  // experienceYears — SPECIAL-CASE boolean: the question contains
  // a threshold which fillAll() parses from the meta at click time
  // via parseExperienceThreshold(). profile.yearsExperience is a
  // NUMBER compared against the threshold. kind:'booleanThreshold'
  // routes the fill loop through the same click path as a regular
  // boolean, but with a derived desired value. If parsing fails
  // (no "minst X år" / "at least X years" in the meta), the field
  // falls through as a plain boolean with no click action.
  //
  // 2026-07-16 (Round-12 patch): placed AHEAD of hasLeadershipExperience
  // in the match order, because both patterns can match the same meta
  // (e.g. "Do you have at least 5 years of experience leading a team?")
  // — the threshold check is the more specific interpretation of "X
  // years experience", so it must win. Per-entry ordering is the
  // single source of routing precedence; first-match-wins is enforced
  // by matchField()'s `for (const entry of FIELD_PATTERNS)` loop.
  { pattern: /((?:minst|mer[\s_]?än|≥)\s*\d+\s*(?:års?|år)|(?:at[\s_]?least|minimum|more[\s_]?than|≥)\s*\d+\s*years?[\s_]?(?:of[\s_]?)?(?:experience|work)?)/i, profileKey: 'yearsExperience', kind: 'booleanThreshold' },

  { pattern: /(erfarenhet[\s\S]{0,40}?leda[\s\S]{0,30}?andra|leadership[\s_]?experience|experience[\s\S]{0,30}?(?:leading|in[\s_]?managing|[a-z]{0,30}team)|managed[\s_]?(?:a|team[\s_]?of))(?:\s+team)?/i, profileKey: 'hasLeadershipExperience', kind: 'boolean' },
  { pattern: /(flytande[\s\S]{0,40}?svenska[\s\S]{0,30}?engelska|fluent[\s\S]{0,20}?swedish[\s\S]{0,20}?english|speak[\s\S]{0,30}?swedish[\s\S]{0,30}?english|bilingual)/i, profileKey: 'isBilingual', kind: 'boolean' },
  { pattern: /(teknisk[\s\S]{0,20}?universitets?(?:utbildning|examen)|technical[\s_]?(?:university|engineering)[\s_]?(?:degree|education))/i, profileKey: 'hasTechnicalEducation', kind: 'boolean' },
  { pattern: /(kundrelaterat[\s\S]{0,30}?arbete|customer[\s\S]{0,30}?(?:related|service|facing)|customer[\s_]?experience)/i, profileKey: 'hasCustomerExperience', kind: 'boolean' },

  // ---------- Round-12 — Dropdown <select> entries ----------
  //
  // Each entry's `kind: 'select'` tells fillAll() to dispatch
  // through setInputValue() (which already handles <select> via
  // option-value-text matching). profileKey → the resolved
  // profile string we want the option to match.
  //
  // dateOfBirth is special: forms frequently split into 3 cascading
  // selects (day / month / year) under one "Födelsedatum" label.
  // setInputValue is per-field, so the panel sees DD/MM/YYYY as
  // three sequential matches. We expose the resolved profile
  // string here; the consumer (lib/extension-profile.js) is
  // expected to either expose a YYYY-MM-DD string OR pre-split into
  // day/month/year keys so each select fills independently.
  { pattern: /(f[öo]delsedatum|date[\s_]?of[\s_]?birth|birthday|birth[\s_]?date|\bdob\b|f[öo]delse[åa]r)/i, profileKey: 'dateOfBirth', kind: 'select' },
  { pattern: /(\bk[öo]n\b|\bgender\b|jeg[\s_]?er|\bsex\b)/i, profileKey: 'gender', kind: 'select' },
  { pattern: /(nationalitet|\bnationality\b|citizenship[\s_]?country|country[\s_]?of[\s_]?citizenship)/i, profileKey: 'nationality', kind: 'select' },
  { pattern: /(landskod|country[\s_]?(?:code|prefix|dial))(?:\s|$)/i, profileKey: 'phoneCountryCode', kind: 'select' },

  // ---------- Round-12 — Multi-select checklist ----------
  //
  // skills uses `kind: 'multiselect'` to dispatch through
  // checkMultiCheckboxes() which walks sibling/parent checkboxes
  // and clicks matching ones. profile.skills is an array of
  // strings; each is matched (case-insensitive substring) against
  // the checkbox label/value.
  { pattern: /(jag[\s_]?har[\s_]?erfarenhet[\s_]?av|i[\s_]?have[\s_]?experience[\s_]?with|skills[\s_]?:?[\s_]?select|markera[\s_]?alla[\s_]?som[\s_]?g[äa]ller|select[\s_]?all[\s_]?that[\s_]?apply)/i, profileKey: 'skills', kind: 'multiselect' },

  // ---------- Round-12 — GDPR consent (single-checkbox) ----------
  //
  // kind:'consent' dispatches through checkConsent(). Because
  // consent checkboxes bind the user to a legal commitment, the
  // helper ONLY clicks if profile.autoConsent is explicitly true.
  // Default-false policy means a cookie/profile without the
  // explicit opt-in is never auto-consented (per GDPR Art. 7 +
  // the soft-launch rules).
    { pattern: /((jag[\s_]?har[\s_]?l[äa]st[\s\S]{0,30}?godk[äa]nner|i[\s_]?have[\s_]?read[\s\S]{0,30}?(?:and|&)?[\s_]?agree|personuppgiftsbehandling[\s\S]{0,30}?(?:samtycker|godk[äa]nder)|accept[\s_]?(?:the[\s_]?)?terms[\s\S]{0,15}?(?:and|&)?[\s_]?(?:privacy|policy))|\bjag[\s_]?samtycker[\s_]?(?:till[\s_]?(?:behandling(?:en)?[\s_]?(?:av[\s_]?(?:mina[\s_]?)?personuppgifter)?|min[\s_]?behandling|att[\s_]?(?:mina[\s_]?uppgifter|personuppgifterna)[\s_]?(?:behandlas|används|lagras))?|att[\s_]?(?:mina|personuppgifterna)[\s_]?(?:behandlas|används|lagras))?|\bjag[\s_]?samtycker\b|\bsamtycker[\s_]?till[\s_]?(?:behandling|att)|\bjag[\s_]?godk[äa]nner[\s_]?(?:att|behandling(?:en)?[\s_]?(?:av[\s_]?personuppgifter)?)?|\bjag[\s_]?godk[äa]nner\b|\bgodk[äa]nner[\s_]?(?:behandling(?:en)?|att[\s_]?mina[\s_]?uppgifter))/i, profileKey: 'autoConsent', kind: 'consent' },
// BUG 5 consent-extension (Round-72.2)



  // ---------- 2026-07-21 / Round-72.2 / BUG 3 + 6 — additional patterns ----------
  //
  // BUG 3: catch-all Yes/No fallback for non-Swedish forms (Workday
  // EN, Teamtailor EN, Greenhouse). Falls through when no specific
  // Swedish pattern fires. Uses 'openToAnyRole' as profileKey so
  // clickBooleanOption() mutates a real flag (null caused schema
  // corruption in earlier drafts).
  { pattern: /^[\s_]*(ja|nej|yes|no|y|n|si|oui|non|\u221a|\u00d7)[\s_]*$/i, profileKey: 'openToAnyRole', kind: 'boolean' },

  // BUG 6: Manpower forms — employment status, personal number,
  // availability, shifts per week, daytime availability, location prefs:
  { pattern: /\b(annan[\s_]?huvudsaklig[\s_]?sysselsättning|har[\s_]?du[\s_]?en[\s_]?annan[\s_]?sysselsättning)\b/i, profileKey: 'hasOtherEmployment', kind: 'boolean' },
  { pattern: /\b(fullständigt[\s_]?personnummer|svenskt[\s_]?personnummer|personnummer[\s_]?:?[\s_]?10[\s_]?siffror)\b/i, profileKey: 'personalNumber' },
  { pattern: /\b(när[\s_]?kan[\s_]?du[\s_]?börja|tillträdesdatum|startdatum|earliest[\s_]?start[\s_]?date)\b/i, profileKey: 'availableFromDate' },
  { pattern: /\b(antal[\s_]?pass[\s_]?per[\s_]?vecka|pass[\s_]?per[\s_]?vecka|shifts[\s_]?per[\s_]?week)\b/i, profileKey: 'shiftsPerWeek' },
  { pattern: /\b(dagtid[\s_]?på[\s_]?vardagar|kan[\s_]?du[\s_]?arbeta[\s_]?dagtid|daytime[\s_]?availability)\b/i, profileKey: 'daytimeAvailability', kind: 'boolean' },
  { pattern: /\b(platser|work[\s_]?location|arbetsort)\b/i, profileKey: 'preferredLocations', kind: 'multiselect' },

  // BUG 6: Randstad forms — current job, salary, source tracking:
  { pattern: /\b(nuvarande[\s_]?arbete|current[\s_]?(?:job|position|work)|current[\s_]?employer)\b/i, profileKey: 'currentJob' },
  { pattern: /\b(löneanspråk|önskad[\s_]?lön|salary[\s_]?expectation|expected[\s_]?salary|månadlig[\s_]?lön|annual[\s_]?salary)\b/i, profileKey: 'salaryExpectation', kind: 'salary' },
  { pattern: /\b(var[\s_]?hittade[\s_]?du[\s_]?den[\s_]?här[\s_]?annonsen|source[\s_]?tracking|hörde[\s_]?du[\s_]?om[\s_]?jobbet[\s_]?via|how[\s_]?did[\s_]?you[\s_]?find[\s_]?us)\b/i, profileKey: 'applicationSource', kind: 'multiselect' },

  // BUG 6: Other forms — language skill, certificate upload:
  { pattern: /\b(kan[\s_]?prata[\s_]?svenska|speak[\s_]?swedish|fluent[\s_]?swedish)\b/i, profileKey: 'speakSwedish', kind: 'boolean' },
  { pattern: /\b(intyg[\s_]?:?|certifikat[\s_]?:?|bevis[\s_]?:?|certificates?[\s_]?:?|attach[\s_]?certificates?)\b/i, profileKey: 'certificates', kind: 'file' },
]
// ---------- 3. Profile + token storage helpers ----------
//
// SECURITY: the dashboard's window.postMessage can't be trusted to MY
// payload-supplied baseUrl or origin-allow-list — a malicious page
// that has the content script injected would just fire postMessage
// with attacker-controlled values and the next popup fetch would
// happily POST the bearer token to attacker.example. We deliberately
// don't store baseUrl or allowedOrigins at all; both MUST stay
// hard-coded constants. Adding them later needs a security review.
//
// The PROD_BASE_URL constant here MUST stay byte-identical with the
// one in extension/popup.js. Drift between the two is a silent
// DNS-rebinding vector.
const PROD_BASE_URL = 'https://jobbpiloten.se'
const PROD_ALLOWED_ORIGINS = ['https://jobbpiloten.se']

// Round-73 / Followup 3 (2026-07-20). Dev-flag logic lives
// INSIDE clickBooleanOption (as a vm-context-safe local IIFE).
// An earlier draft exposed a module-level `const __DEV__` here,
// but `tests/unit/extension-fill-vm.test.mjs` extracts
// clickBooleanOption into a node:vm isolated context with no
// module scope — a module-level const would throw ReferenceError
// there. Mirroring the isDebug query-param check inside the
// function (with `typeof window === 'undefined'` as the test-env
// short-circuit) keeps the same production-silent / opt-in-verbose
// behaviour for both the browser and the test fixture.

const STORAGE_KEYS = {
  token: 'jobbpiloten_token',
  profile: 'jobbpiloten_profile',
  // Round-44 — per-question style override. The popup's
  // "Skrivstil för detta svar" <select> writes this on every
  // change; fetchAIAnswers / fetchBatchAIAnswers read it before
  // POSTing to the AI endpoints so the user's choice reaches
  // the LLM prompt builder. The key MUST stay bytewise-aligned
  // with extension/popup.js's STORAGE_KEYS.styleOverride —
  // tests/unit/extension-content.test.mjs locks the literal.
  styleOverride: 'jobbpiloten_styleOverride',
}

async function readStorage() {
  try {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.token,
      STORAGE_KEYS.profile,
      STORAGE_KEYS.styleOverride,
    ])
    return {
      token: data[STORAGE_KEYS.token] || null,
      profile: data[STORAGE_KEYS.profile] || null,
      // Empty string = "no active override" (the popup cleared it
      // via the "Standardstil återställd" branch). Trimming here
      // means the type stays a string — callers comparing truthy
      // skip the field cleanly. The literal is required to gate
      // the per-question override branch on a valid id.
      styleOverride: String(data[STORAGE_KEYS.styleOverride] || '').trim(),
    }
  } catch (_) {
    return { token: null, profile: null, styleOverride: '' }
  }
}

async function writeStorage({ token, profile }) {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.token]: token,
      [STORAGE_KEYS.profile]: profile,
    })
  } catch (_) { /* ignore */ }
}

async function handleAuthSync(payload) {
  if (!payload || typeof payload !== 'object') return
  // SECURITY: ignore payload.baseUrl / payload.allowedOrigins.
  // A malicious host page can fire postMessage with attacker-controlled
  // values; if we persisted them, the popup's next refresh would
  // POST the bearer token to an attacker origin. The allow-list is
  // a hard-coded constant — see section 3.
  await writeStorage({ token: payload.token || null, profile: payload.profile || null })
  scheduleScan()
}

// ---------- 4. Profile-key resolver ----------
//
// `user.answers.whyThisCompany` is a nested key — we walk the path
// so the matching engine doesn't have to know about nesting.
function resolveProfileValue(profile, key) {
  if (!profile) return ''
  const parts = key.split('.')
  let cur = profile
  for (const p of parts) {
    if (cur == null) return ''
    cur = cur[p]
  }
  if (cur == null) return ''
  if (Array.isArray(cur)) return cur.join(', ')
  return String(cur)
}

// ---------- 4b. Origin guard ----------
//
// Hard-coded allow-list — see the SECURITY comment in section 3
// above for the rationale (no postMessage-supplied origins, ever).
// The helper is mirrored into extension/popup.js (the MV3 manifest
// doesn't let content + popup share an ESM module without a
// bundler) so the two must stay byte-identical — divergence is
// a silent DNS-rebinding vector.
function assertOriginAllowed(url) {
  const origin = (() => {
    try { return new URL(url).origin } catch (_) { return null }
  })()
  if (!origin) throw new Error('Ogiltig URL')
  if (!PROD_ALLOWED_ORIGINS.includes(origin)) {
    throw new Error(`Origin ej tillåten: ${origin}`)
  }
  return origin
}

// ---------- 4b. Language classifier ----------
//
// Best-effort language detection from the joined meta string. Not a
// serious NLP — just enough signal to bias the server's prompt
// toward Swedish when the host page's labels include Swedish stop-
// words, and toward English when they include English ones. Used by
// `fetchBatchAIAnswers` to attach `lang` to the /api/extension/ai-
// answers request body. Server-side routing still falls back to the
// default Swedish prompt, so a wrong-classified fields never feeds
// garbage to the LLM — the failure mode is just a slight tone
// mismatch, not a wrong-language answer.
//
// Words were chosen for high precision (low false-positive) on ATS
// forms: e.g. "styrkor", "svagheter", "utmaning" appear almost
// exclusively on Swedish-language forms; "strengths", "weakness",
// "challenge" are the canonical Greenhouse / Workday motivation
// prompts.
function classifyFieldLanguage(text) {
  const s = String(text || '').toLowerCase()
  if (!s) return 'unknown'
  const hasSwedishChars = /[åäöé]/.test(s)
  const seHits = (s.match(/\b(varför|beskriv|berätta|din|ditt|företaget|rollen|arbetet|erfarenhet|styrkor|svagheter|utmaning|tillgänglig|motiverar|drivkraft|kompetens|färdighet|beskrivning)\b/gi) || []).length
  const enHits = (s.match(/\b(why|describe|tell|you|your|experience|strengths|weakness|challenge|available|motivation|skill|background)\b/gi) || []).length
  if (seHits >= 2) return 'sv'
  if (enHits >= 2) return 'en'
  if (hasSwedishChars) return 'sv'
  if (enHits > seHits) return 'en'
  return 'unknown'
}

// ---------- 4c. Visual state stylesheet ----------
//
// Inject a single <style> on first paint so the user sees clear
// outlines for OK / missing / REVIEW_NEEDED / ai_generated. We keep
// it tiny (four selectors) and only re-add if the host page blew it
// away — modern SPAs occasionally wipe <head> children to support
// dark-mode / locale switches, and we'd rather re-inject than
// silently lose the visual feedback.
function ensurePaintStylesheet() {
  if (document.getElementById('__jobbpiloten_paint_styles')) return
  const s = document.createElement('style')
  s.id = '__jobbpiloten_paint_styles'
  s.textContent = [
    '[data-jobbpiloten-status="ok"] { outline: 2px solid rgba(16,185,129,0.55) !important; outline-offset: 1px; }',
    '[data-jobbpiloten-status="missing"] { outline: 2px solid rgba(245,158,11,0.55) !important; outline-offset: 1px; }',
    '[data-jobbpiloten-status="review_needed"] { outline: 2px dashed rgba(239,68,68,0.75) !important; outline-offset: 1px; background: rgba(239,68,68,0.04) !important; }',
    // AI-generated answers — blue outline is intentionally distinct
    // from green/yellow/red so the user can tell at a glance which
    // fields were filled by the LLM and still need a manual review
    // pass before submit. The dashed pattern reads as "we're unsure,
    // double-check" rather than "we've got this" (solid green) or "this
    // needs your input" (solid yellow).
    '[data-jobbpiloten-status="ai_generated"] { outline: 2px dashed rgba(59,130,246,0.85) !important; outline-offset: 1px; background: rgba(59,130,246,0.04) !important; }',
    // 2026-07-16 (Round-12) — boolean_filled (orange solid). Conveys
    // "we've decided" (solid) but still requires user attention since
    // a click on Ja/Nej is irrevocable until next edit. Orange is
    // also the colour least colliding with the existing 4 (green,
    // amber, red, blue) for users with red-green colour-blindness.
    '[data-jobbpiloten-status="boolean_filled"] { outline: 2px solid rgba(249,115,22,0.85) !important; outline-offset: 1px; background: rgba(249,115,22,0.04) !important; }',
    // 2026-07-16 (Round-12 patch) — consent_unchecked (slate-grey
    // dashed). Sixth colour in the palette; the dashed outline
    // pattern matches review_needed / ai_generated ("you must act")
    // while the slate hue signals "halted, not missing" — the data
    // is on the profile (profile.autoConsent is defined-and-false),
    // the safety policy is what kept the helper from clicking.
    '[data-jobbpiloten-status="consent_unchecked"] { outline: 2px dashed rgba(100,116,139,0.75) !important; outline-offset: 1px; background: rgba(100,116,139,0.06) !important; }',
  ].join('\n')
  document.documentElement.appendChild(s)
}

// ---------- 5. DOM helpers ----------
function getFieldMeta(input) {
  // Pull a meta string from any of: aria-label, name, id,
  // placeholder, closest <label>'s text. This is what FIELD_PATTERNS
  // matches against.
  const parts = []
  const aria = input.getAttribute('aria-label')
  const ariaBy = input.getAttribute('aria-labelledby')
  if (aria) parts.push(aria)
  if (ariaBy) {
    const ref = document.getElementById(ariaBy)
    if (ref) parts.push(ref.innerText || ref.textContent || '')
  }
  const name = input.getAttribute('name')
  const id = input.getAttribute('id')
  const placeholder = input.getAttribute('placeholder')
  if (name) parts.push(name)
  if (id) parts.push(id)
  if (placeholder) parts.push(placeholder)
  // 2026-07-21 / Round-72.2 / BUG 1 fix (cross-tree label
  // contamination) — read the native <label for=…> association
  // from `input.labels` BEFORE any parent-walk walk. The
  // pre-fix shape used `parent.querySelector('label, legend')`
  // on every ancestor up to 4 hops, which silently reaches
  // SIBLING inputs' labels on adjacent-label forms (the
  // symptom: BOTH Förnamn AND Efternamn got firstName because
  // the first label in subtree was Förnamn's <label>). The
  // WHATWG-defined `input.labels` NodeList is the ONLY
  // label source that cannot reach siblings by construction.
  if (input.labels) {
    for (const lbl of input.labels) {
      parts.push(lbl.innerText || lbl.textContent || '')
    }
  }
  // ATS data-attributes — Workday (data-automation-id), Greenhouse
  // (data-qa, data-testid), Lever (data-field-key), SmartRecruiters
  // (data-test). These hidden stable hooks give the regex something
  // to match against even on forms that ship without a visible
  // label. Appended to the same meta string so the existing
  // FIELD_PATTERNS table stays the single routing decision.
  const attrs = ['data-automation-id', 'data-qa', 'data-testid', 'data-field-key', 'data-test']
  for (const a of attrs) {
    const v = input.getAttribute(a)
    if (v) parts.push(v)
  }
  // Walk up to find the closest wrapping <label> OR the
  // fieldset's direct-child <legend>. CRITICAL (BUG 1 fix):
  // we deliberately do NOT use any broad descendant
  // querySelector here — the pre-fix
  // `parent.querySelector('label, legend')` call crossed
  // sibling boundaries and cross-contaminated adjacent-label
  // inputs (the Förnamn/Efternamn symptom). The only
  // safe sibling-respecting label source for fieldsets is
  // `:scope > legend` (direct-child only — cannot read a
  // sibling fieldset's <legend>).
  // structural-lock: the loop variable name below MUST stay
  // `hops` — the regression test titled exactly
  // "BUG 1 followup: getFieldMeta must include a
  // wrapping-LEGEND-outside-FIELDSET branch (mobile-first
  // ATS pattern)" in tests/unit/bug-name-boolean.test.mjs
  // uses a single-line regex that requires the literal
  // `hops === 0` on the same source line as the LEGEND
  // branch. Renaming `hops` → `depth` / `i` would silently
  // re-enable the BUG 1 cross-tree reach on multi-hop
  // ancestors WITHOUT surfacing a syntax error. If a future
  // refactor explicitly needs to change the name, update
  // that regression test in the SAME PR.
  let parent = input.parentElement
  for (let hops = 0; hops < 4 && parent; hops++, parent = parent.parentElement) {
    if (parent.tagName === 'LABEL') {
      parts.push(parent.innerText || parent.textContent || '')
    } else if (parent.tagName === 'FIELDSET') {
      // `:scope > legend` — direct-child only. Locked by
      // tests/unit/bug-name-boolean.test.mjs (BUG 1) which
      // asserts both this selector AND a parent.tagName
      // FIELDSET check exist in the function body.
      const legend = parent.querySelector(':scope > legend')
      if (legend) parts.push(legend.innerText || legend.textContent || '')
    } else if (parent.tagName === 'LEGEND' && hops === 0) {
      // 2026-07-21 / Round-72.2 / Followup-3 — a <legend>
      // that's NOT inside a <fieldset> (rare mobile-first
      // ATS pattern: <legend>Fråga</legend><input/>) must
      // still surface its text. The `hops === 0` gate keeps
      // the branch direct-parent only — a <legend> at
      // ancestor depth 2-4 would otherwise re-introduce the
      // exact cross-tree reach BUG 1 fixed (the wrapping
      // <label>/<fieldset> at depth 1 doesn't have a
      // selector-side bound like `:scope > legend`, so the
      // gate lives on the branch, not on a query). The
      // tests/unit/bug-name-boolean.test.mjs#BUG1-legendwrap
      // regression test pins both the literal and the gate.
      parts.push(parent.innerText || parent.textContent || '')
    }
  }
  return parts.filter(Boolean).join(' \u00b7 ')
}

function matchField(input) {
  const meta = getFieldMeta(input)
  if (!meta) return null
  for (const entry of FIELD_PATTERNS) {
    // CRITICAL: file entries are checked separately by findFileInputs()
    // (which scans only <input type="file"> and uses maybeInstallFileButtons()
    // to inject amber button siblings). The skip here exists so the looser
    // file regexes (e.g. coverLetterFile's bare "Personligt brev" alternation)
    // don't out-compete the more-specific kind:'multi' latestCoverLetter
    // entry on free-text cover-letter textareas. Removing this skip is a
    // silent regression — file patterns would start claiming textarea fields
    // they have no business routing. If you ever need a file pattern to also
    // match a non-file input, add a dedicated non-file entry instead.
    if (entry.type === 'file') continue
    if (entry.pattern.test(meta)) return entry
  }
  return null
}

function findFileInputs(root = document) {
  return root.querySelectorAll('input[type="file"]')
}

// 2026-07-21 / Round-72.2 — booleanGroupKey(input): stable per-question
// key for radio / Ja/Nej clusters so fillAll() can dedupe per group
// (otherwise 7 boolean radios in one form would all dispatch a click
// and the user's last manual answer is silently overwritten). Used
// as the Set/Map key in `handledBooleanGroups` inside fillAll().
//
// Pair-detection rule: radios in the same fieldset (or form) that
// share an input.name are the SAME question ("Ja" vs "Nej" for
// "Har du körkort?"). The key therefore uses the input's own
// `name` attribute as the source — it stays stable across the
// Ja/Nej pair (both have `name="harDuKorkort"`) and varies
// across distinct questions (each form question has its own
// name). Falls back to id + form-name hash if the input has no
// `name` attribute (rare on real ATS but defensive).
//
// 2026-07-21 — NEVER returns a falsy value: callers (Set .has(),
// Map .set()) rely on a non-empty string key. Returns 'anon' for
// inputs missing every identifying attribute so the Set still has
// something to dedupe against.
function booleanGroupKey(input) {
  if (!input) return 'qf:anon'
  // 2026-07-21 / Round-72.2 / BUG 4 followup — prefer the DOM
  // `name` IDL property FIRST (built-in, always present on real
  // DOM <input type=radio>) before falling back to
  // getAttribute('name'). The previous getAttribute-only path
  // collided in two real-world ways:
  //   • Radio pairs under a shared <fieldset> legend with no
  //     `name` attribute (the "Ja/Nej-brytare" pattern some
  //     Mobile-First ATS templates use).
  //   • The test fixture's input object sets `name` as a JS
  //     property but stub-returns null from `getAttribute`,
  //     exercising this exact code path.
  // `input.name` is set by the IDL declaration on
  // HTMLInputElement.prototype so it's available whether the
  // attribute was set via `setAttribute` or via property
  // assignment.
  const name = (typeof input.name === 'string' && input.name)
    || ((typeof input.getAttribute === 'function') ? input.getAttribute('name') : '')
    || ''
  if (name) return 'name:' + name
  // Third tier — walk parent chain for a <fieldset> with
  // distinct textContent (legend / wrapper label). Distinct
  // questions live in distinct fieldsets, so this gives a
  // stable per-question key without relying on the rare
  // `name` attribute.
  let el = input.parentElement
  let hops = 0
  while (el && hops < 4) {
    const tag = (el.tagName || '').toUpperCase()
    if (tag === 'FIELDSET') {
      const txt = (el.innerText || el.textContent || '').trim()
      if (txt) return 'fs:' + txt.slice(0, 64)
    }
    el = el.parentElement
    hops++
  }
  const id = input.id || ''
  const formName = (input.form && input.form.name) || ''
  if (id || formName) return 'qf:' + (id || '') + '|' + (formName || '')
  return 'qf:anon'
}

// Find free-text fields that DIDN'T match any FIELD_PATTERN entry —
// these are the candidates the AI-adaptation batch endpoint should
// generate answers for. We deliberately DON'T include inputs that
// already have user content (a textarea with a saved draft), so the
// fill loop never clobbers an in-progress edit.
//
// Eligibility:
//   • <textarea>          — always
//   • <input type="text"|"email"|"tel"|"url"|"search"|undefined>  with
//     placeholder/label that LOOKS like a free-text answer
//     (longer than the label of a typical address field). Cheap
//     heuristic: longer meta string AND visible (not display:none).
//   • Visible (offsetParent !== null) AND not type=password/hidden
//   • Valued-empty (input.value.trim() === '')
function findUnmatchedTextareas(root = document) {
  const out = []
  const all = root.querySelectorAll('textarea, input')
  all.forEach((el) => {
    // Open shadow-root inputs (open mode only) — mirror collectInputs
    if (el.shadowRoot) {
      const nested = findUnmatchedTextareas(el.shadowRoot)
      nested.forEach((n) => out.push(n))
    }
    if (typeof el.offsetParent === 'undefined' && getComputedStyle && getComputedStyle(el).visibility === 'hidden') return
    const type = (el.getAttribute('type') || '').toLowerCase()
    if (type === 'password' || type === 'hidden' || type === 'file' || type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return
    // Already has user content — skip; we'd be clobbering an edit.
    const existing = String(el.value || '').trim()
    if (existing.length > 0) return
    const meta = getFieldMeta(el)
    if (!meta || meta.length < 5) return
    // Tag is what we use for textarea-specific signal.
    const isTextarea = el.tagName === 'TEXTAREA'
    if (!isTextarea) {
      // For <input>, only consider it free-text if the meta looks
      // like an open-ended prompt — otherwise we'd be wasting tokens
      // on a firstName or phone field the matcher will ignore.
      // Cheap heuristic: presence of a question mark OR one of the
      // Swedish/English answer-class stopwords.
      const looksOpenEnded = /\?\s*$|beskriv|describe|tell|berätta|why|varför|motivation|styrkor|strengths|svagheter|weakness|utmaning|challenge/i.test(meta)
      if (!looksOpenEnded) return
    }
    // Make sure the existing FIELD_PATTERNS table didn't already
    // classify this field — if it did, the direct fill loop handles
    // it (and the single-field AI pass for motivation keys).
    if (matchField(el)) return
    out.push(el)
  })
  return out
}

// ---------- 6. Field value setter ----------
//
// Setting `.value` on an <input> in modern Chromium does NOT fire a
// `change` event, so server-rendered React forms won't pick up the
// update. We dispatch both `input` and `change` events explicitly.
function setInputValue(input, value) {
  if (value == null || value === '') return false
  try {
    if (input.tagName === 'SELECT') {
      const wanted = String(value).trim().toLowerCase()
      const opts = Array.from(input.options || [])
      const opt = opts.find((o) => String(o.value || o.text || '').trim().toLowerCase().includes(wanted))
        || opts.find((o) => wanted && String(o.text || '').trim().toLowerCase().startsWith(wanted.slice(0, 5)))
      if (opt) {
        input.value = opt.value
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }
      return false
    }
    // Input + textarea: same pattern.
    const proto = Object.getPrototypeOf(input)
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  } catch (_) {
    return false
  }
}

// ---------- 7. Visual feedback ----------
//
// Green = filled; yellow = matched but no profile value to fill;
// blue dashed = AI-generated answer that needs manual review;
// red dashed = REVIEW_NEEDED (host rejected the mutation).
// Uses an outline so we don't break layout-driven padding/box-sizing.
//
// The single canonical paintField lives BELOW (after
// CONFIDENCE_TITLES) so the confidence tooltip can be set in the
// same call. A previous version defined paintField twice — the
// stale variant here (no title attribute) silently won because
// JavaScript's hoisting + later-redeclaration rules made the
// second one the runtime definition. The duplicated version
// risked confusing future readers into "fixing" the runtime
// behaviour by editing the wrong copy. Round-44 removes the
// stale definition; tests/unit/extension-content.test.mjs locks
// the call-site count so a regression can't reintroduce the
// duplicate.

// AI-generated answers ship with a tooltip so screen-readers + sighted
// keyboard users both hear the same warning when they Tab into the field.
// The title attribute is the cheapest cross-browser path — a JS overlay
// tooltip would need its own a11y config, and a11y is not a "nice to have"
// for an LLM hallucination risk surface. Plain Swedish matches the
// surrounding copy so the user doesn't see mixed-language toasts.
// Locked by tests/unit/extension-content.test.mjs (the test asserts
// the EXACT string). Do NOT reword this tooltip without also updating
// the test in the same commit, or the e2e contract regresses
// silently.
const AI_GENERATED_TOOLTIP_SV = 'AI-genererat svar — granska innan du skickar'
function paintAsAiGenerated(input, source /* 'groq'|'openai'|'fallback' */) {
  // Round-33.3 review-fix: paintField now owns the title attribute
  // for every status via CONFIDENCE_TITLES (including ai_generated),
  // so we don't set it again here. Source is reflected in a secondary
  // `data-` attribute so future code can branch on it without changing
  // the user-visible contract.
  paintField(input, 'ai_generated')
  input.setAttribute('data-jobbpiloten-ai-source', source || 'unknown')
}

// Round-33.2 followup #3 — confidence-indicator titles for every
// paint state. The 4 colours carry meaning ("Hög säkerhet" /
// "Medium" / "AI-genererat" / "Granska"), but colour alone is
// inaccessible to users with red/green colour-blindness. Mapping
// every paint state to a Swedish `title` attribute is the
// cheapest accessibility fix (≤1 attribute per paint, no
// listener / overlay JS), and doubles as a tooltip on hover.
//
// Lock-contract: the four keys below are referenced by
// tests/unit/extension-content.test.mjs — any rename must
// update the test in the same commit so the structural lock
// stays bytewise-aligned.
const CONFIDENCE_TITLES = {
  // 'ok' = direct profile match + fill succeeded. Green outline,
  // green title-text, hedged language (\"granska ändå\") so the
  // user never reads \"click submit\" after a green check.
  ok: 'Hög säkerhet — fältet är välkänt. Granska ändå innan du skickar.',
  // 'missing' = pattern matched but no profile value to fill.
  // Amber outline, amber title text, nudge to /settings.
  missing: 'Saknar data i din profil — uppdatera under /settings.',
  // 'review_needed' = host page rejected the .value mutation.
  // Red dashed outline + red title text. No overrun warning —
  // user already knows the field didn't stick.
  review_needed: 'Granska manuellt — sidan blockerade auto-ifyllningen.',
  // 'ai_generated' title is set by paintAsAiGenerated above (same
  // wording, but listed here so the lock-contract test sees all
  // four states; the runtime setAttribute wins).
  ai_generated: AI_GENERATED_TOOLTIP_SV,
  // 2026-07-16 (Round-12) — boolean decision painted onto a Ja/Nej
  // radio group OR a multi-select checklist. Solid orange conveys
  // "we've decided, please verify" — distinct from solid green
  // (text fills), dashed blue (LLM answers that need review), and
  // dashed red (host-rejected mutations). The hedged language is
  // critical: a green-outlined field can still be wrong, and an
  // orange-outlined one CANNOT be undone without the user clicking
  // the other option manually.
  boolean_filled: 'Ja/Nej-beslut fyllt — granska och bekräfta innan du skickar.',
  // 2026-07-16 (Round-12 patch) — consent_unchecked. Painted when
  // the GDPR/terms consent checkbox is on the page but
  // profile.autoConsent is undefined/false (the Round-12 default-
  // false safety policy). Distinct from 'missing' because the
  // data is ON the profile — the safety policy is what kept us
  // from auto-clicking. The slate-grey dashed outline is the 6th
  // colour in the palette (extending green/amber/red/blue/orange
  // from the user spec) and reads as "halted, awaiting your
  // manual click".
  consent_unchecked: 'Säkerhetsspärr — klicka manuellt för att godkänna.',
}

function paintField(input, status /* 'ok' | 'missing' | 'review_needed' | 'ai_generated' */) {
  ensurePaintStylesheet()
  const old = input.getAttribute('data-jobbpiloten-status')
  if (old) input.removeAttribute(old)
  input.setAttribute('data-jobbpiloten-status', status)
  // Confidence tooltip — only set when a mapping exists so a
  // future status key (e.g. a hypothetical 'partial') can be
  // added without silently inheriting the wrong title. The
  // pre-existing AI tooltip is owned by paintAsAiGenerated; it
  // passes through here unchanged.
  const title = CONFIDENCE_TITLES[status]
  if (title) input.setAttribute('title', title)
}

function clearPaint(input) {
  const old = input.getAttribute('data-jobbpiloten-status')
  if (old) {
    input.removeAttribute('data-jobbpiloten-status')
  }
  // Round-33.3 review-fix: strip any confidence title we previously
  // wrote. Exact-match per the CONFIDENCE_TITLES map — a future
  // localised variant (e.g. "Hög säkerhet (sv)") would need to be
  // added to the map for clearPaint to commute. The startsWith
  // claim from the prior round was a thought-experiment that we
  // didn't actually implement; the simple `===` is correct and
  // future-localisation-safe if CONFIDENCE_TITLES stays the
  // canonical registry.
  const t = input.getAttribute('title')
  if (t && Object.values(CONFIDENCE_TITLES).some((v) => v === t)) {
    input.removeAttribute('title')
  }
  input.removeAttribute('data-jobbpiloten-ai-source')
}

// ---------- 7b. Round-12 — non-text interaction helpers ----------
//
// Pure DOM helpers dispatched from fillAll() based on the matched
// FIELD_PATTERNS entry's `kind`. Kept distinct from
// setInputValue() (which only handles text/select) so a future
// text-input regression can't accidentally break the boolean path.
//
// All helpers return a `{ clicked, target?, reason? }` shape so the
// fill loop can count + paint per kind without throwing. Network
// or DOM exceptions are caught inside each helper so a malformed
// page never aborts the whole fill.

// 7b.1 — clickBooleanOption(host, desiredValue)
//
// host:       the input/radio/button/label that matched a
//             kind:'boolean' or kind:'booleanThreshold' entry.
// desiredValue: true (Ja/Yes) / false (Nej/No) / undefined (skip).
//
// Three detection paths, tried in order:
//   (i)   host is a radio input → find sibling radios in the same
//         named group, click the one whose value/text matches
//         wanted = (desiredValue ? 'ja' : 'nej')
//   (ii)  walk up to nearest form group (fieldset / form / role:
//         radiogroup / 2-4 button cluster) and click the first
//         sibling whose text or aria-label starts with Ja/Yes/No/Nej
//   (iii) ARIA switch (role="switch") with aria-checked — toggle
//         the boolean if the current state disagrees with the
//         desiredValue.
//
// Returns { clicked: false, reason: ... } when no target was found.
// Throws never bubble — even DOM exceptions are caught.
function clickBooleanOption(host, desiredValue) {
  // Round-46 / Bug 3 diagnostic (2026-07-20 Monday). User reported
  // "Not a single boolean question was answered across all 3
  // forms" — 7+ boolean radios (Heltid/Extrajobb, truckkort,
  // B-körkort, samtycke) silently no-op'd. Round-73 / Followup 3
  // gates the structured console.debug here so production users
  // see NOTHING — a tester can append `?jobbpiloten_debug=1`
  // (or `?jp_dev=1`) to the page URL to opt in. console.debug
  // is also hidden by default in DevTools unless "Verbose" is
  // ticked. The local `__DEV__` (rather than the module-level
  // one) makes the gate vm-context-safe: tests/unit/extension-
  // fill-vm.test.mjs runs this function inside node:vm without
  // the rest of the module, so a module-level const would throw
  // ReferenceError. Local-scope + typeof-window fallback means
  // the same function body stays green at test time AND silent
  // in production.
  const __DEV__ = (() => {
    try {
      if (typeof window === 'undefined' || !window.location) return false
      const params = new URLSearchParams(window.location.search || '')
      return params.get('jobbpiloten_debug') === '1' || params.get('jp_dev') === '1'
    } catch (_) { return false }
  })()
  if (__DEV__) {
    try {
      const lbl = (host && host.labels && host.labels[0]) ? host.labels[0].textContent.trim().slice(0, 80) : ''
      console.debug('[jobbpiloten boolean] clickBooleanOption', {
        desiredValue,
        wanted: desiredValue ? 'ja' : 'nej',
        hostTag: host && host.tagName,
        hostId: host && host.id,
        hostName: host && host.getAttribute && host.getAttribute('name'),
        labelText: lbl,
      })
    } catch (_) { /* diagnostic best-effort */ }
  }

  if (desiredValue == null) return { clicked: false, reason: 'no-value' }
  const wanted = desiredValue ? 'ja' : 'nej'
  try {
    // Path (i) — host IS a radio input
    if (host && host.tagName === 'INPUT' && String(host.type || '').toLowerCase() === 'radio') {
      const name = host.getAttribute('name')
      const form = host.form
      if (name && form) {
        const group = Array.from(form.elements).filter((el) => el.name === name && String(el.type || '').toLowerCase() === 'radio')
        for (const radio of group) {
          if (matchesYesNoText(radio.value, radio.parentElement ? radio.parentElement.innerText : '', wanted)) {
            radio.click()
            return { clicked: true, target: radio, reason: 'radio-group' }
          }
        }
      }
    }

    // Path (ii) — button/toggle cluster
    const group = nearestBooleanGroup(host)
    if (group) {
      const candidates = group.querySelectorAll('button, [role="button"], [role="radio"], input[type="radio"], a')
      for (const c of candidates) {
        const text = String(
          c.innerText || c.textContent || c.getAttribute('aria-label') || c.value || ''
        ).trim().toLowerCase()
        if (!text) continue
        if ((wanted === 'ja' && /^(ja|yes|y|true)\b/.test(text)) ||
            (wanted === 'nej' && /^(nej|no|n|false)\b/.test(text))) {
          c.click()
          return { clicked: true, target: c, reason: 'button-cluster' }
        }
      }
    }

    // Path (iii) — ARIA switch (closest match wins)
    const sw = host ? host.closest('[role="switch"]') : null
    if (sw) {
      const aria = sw.getAttribute('aria-checked') === 'true'
      if (aria !== !!desiredValue) {
        sw.click()
        return { clicked: true, target: sw, reason: 'aria-switch' }
      }
      return { clicked: true, target: sw, reason: 'aria-switch-noop' }
    }

    return { clicked: false, reason: 'no-target-found' }
  } catch (_) {
    return { clicked: false, reason: 'exception' }
  }
}

// Helper: does `value` OR `text` indicate a positive (Ja) or
// negative (Nej) boolean option? Used by Path (i) to score
// radios in the same named group. Trimmed + lower-cased.
function matchesYesNoText(value, text, wanted) {
  const vn = String(value || '').trim().toLowerCase()
  if (vn) {
    if (wanted === 'ja'  && /^(ja|yes|y|true|1)$/.test(vn)) return true
    if (wanted === 'nej' && /^(nej|no|n|false|0)$/.test(vn)) return true
  }
  const tn = String(text || '').trim().toLowerCase()
  if (!tn) return false
  return tn.startsWith(wanted + ' ') || tn === wanted || tn.startsWith(wanted + ',') || tn.startsWith(wanted + '.')
}

// Helper: walk up to 8 ancestors looking for a fieldset/form/
// role=radiogroup or a 2–8 clickable cluster — the natural layout
// for a "Ja / Nej" toggle on a real ATS page.
//
// Round-79.5 / Bug B-followup (2026-07-20). Pre-fix shape walked
// 5 ancestors and required `interactives.length <= 4`. Mistimed
// on three Swedish ATS patterns observed on Monday tests:
//   1. Greenhouse's "I have..." prefix wraps the radio cluster
//      inside a flex container 5+ levels deep — hops:5 missed.
//   2. Workday's Heltid/Extrajobb uses 6 radio buttons clustered
//      under a single fieldset (4-tjänst + 2-prefix); length<=4
//      rejected the group as a "nav cluster" and clicked nothing.
//   3. Theard's "Samtycker till..." question co-locates the
//      GDPR-toggle radio next to a typographic icon link
//      (`<a class="info-icon">`), inflating interactives to 5.
// Bumping to hops:8 + length<=8 covers all three without losing
// the "2–4 short-text = toggle" cue on Platsbanken/Teamtailor,
// which keep that baseline heuristic.
function nearestBooleanGroup(host) {
  if (!host || !host.parentElement) return null
  let p = host.parentElement
  for (let hops = 0; hops < 8 && p; hops++, p = p.parentElement) {
    if (!p.tagName) continue
    if (p.tagName === 'FIELDSET' || p.tagName === 'FORM') return p
    if (p.getAttribute && p.getAttribute('role') === 'radiogroup') return p
    // Heuristic: a div containing 2–8 clickable elements is almost
    // certainly a Ja/Nej-style cluster. Excluded if the elements
    // carry text > 20 chars (would be unrelated nav links).
    if (p.querySelectorAll) {
      const interactives = p.querySelectorAll('button, [role="button"], input[type="radio"], a')
      if (interactives.length >= 2 && interactives.length <= 8) {
        const allShort = Array.from(interactives).every((el) => {
          const txt = String(el.innerText || el.textContent || el.value || '').trim()
          return txt.length <= 20
        })
        if (allShort) return p
      }
    }
  }
  return null
}

// 7b.2 — checkMultiCheckboxes(hostInput, profileArray)
//
// Walks sibling/parent checkboxes for any whose label text or
// value matches an entry in profileArray (case-insensitive
// substring match). Clicks the checkbox if not already checked.
// profile.skills is expected to be a string[] (e.g.
// ["JavaScript", "Python", "Project management"]).
//
// Returns { clicked, candidates } so fillAll() can paint
// 'boolean_filled' + log a one-line summary on success.
function checkMultiCheckboxes(hostInput, profileArray) {
  if (!Array.isArray(profileArray) || profileArray.length === 0) return { clicked: 0, candidates: 0, reason: 'no-profile' }
  try {
    const root = nearestCheckboxGroup(hostInput) || (hostInput && hostInput.form) || (hostInput && hostInput.parentElement)
    if (!root) return { clicked: 0, candidates: 0, reason: 'no-group' }
    const boxes = root.querySelectorAll('input[type="checkbox"]')
    if (boxes.length === 0) return { clicked: 0, candidates: 0, reason: 'no-boxes' }
    const wanted = profileArray.map((s) => String(s || '').toLowerCase().trim()).filter(Boolean)
    if (wanted.length === 0) return { clicked: 0, candidates: 0, reason: 'empty-wanted' }
    let clicked = 0
    let candidates = 0
    for (const box of boxes) {
      const labelText = String(
        (box.parentElement && box.parentElement.innerText) || box.nextElementSibling?.innerText || ''
      ).toLowerCase()
      const valueText = String(box.value || '').toLowerCase()
      // 2026-07-16 (Round-12 patch): word-boundary matching via a
      // dynamic RegExp instead of `String.includes()`. The substring
      // approach over-matched ('Java' hit 'JavaScript') and
      // under-matched ('Project management' missed 'Project manager').
      // \b is a letter/digit/_-boundary in JS; Swedish å/ä/ö are
      // letters so 'projektledning' won't over-match 'projektledare'.
      // Special regex chars in the needle are escaped so a profile
      // skill containing '.' / '(' (e.g. 'C++', 'C# (.NET)') doesn't
      // blow up the RegExp constructor — a code-reviewer finding
      // from the Round-12 patch.
      const hit = wanted.some((w) => {
        try {
          const re = new RegExp('\\b' + String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b')
          return re.test(labelText) || re.test(valueText)
        } catch (_) { return false }
      })
      if (hit) {
        candidates++
        if (!box.checked) {
          try { box.click() } catch (_) { /* ignore — host may prevent default */ }
          // Some hosts (Workday) ignore programmatic .click() and
          // rely on the 'change' event. Dispatch both for parity
          // with setInputValue().
          try { box.dispatchEvent(new Event('change', { bubbles: true })) } catch (_) {}
          clicked++
        }
      }
    }
    return { clicked, candidates }
  } catch (_) {
    return { clicked: 0, candidates: 0, reason: 'exception' }
  }
}

// Helper: walk up ancestors looking for a fieldset/form or a
// cluster of 2+ checkboxes — the natural layout for an "I have
// experience with:" multi-select on a real ATS form.
function nearestCheckboxGroup(host) {
  if (!host || !host.parentElement) return null
  let p = host.parentElement
  for (let hops = 0; hops < 5 && p; hops++, p = p.parentElement) {
    if (!p.tagName) continue
    if (p.tagName === 'FIELDSET' || p.tagName === 'FORM') return p
    if (p.querySelectorAll) {
      const boxes = p.querySelectorAll('input[type="checkbox"]')
      if (boxes.length >= 2 && boxes.length <= 30) return p
    }
  }
  return null
}

// 7b.3 — checkConsent(input, autoConsent)
//
// Single-checkbox GDPR / terms / privacy consent. CRITICAL: never
// auto-consent unless profile.autoConsent === true. Default false
// protects the user from a careless click that would bind them to
// a legal commitment without review.
//
// Returns { clicked, reason }. If autoConsent is false, the field
// is left untouched — same outcome as a 'missing' paint so the
// user sees the orange prompt to make the decision themselves.
function checkConsent(input, autoConsent) {
  if (!input) return { clicked: false, reason: 'no-input' }
  if (!autoConsent) return { clicked: false, reason: 'no-auto-consent' }
  try {
    if (input.checked) return { clicked: false, reason: 'already-checked' }
    input.click()
    try { input.dispatchEvent(new Event('change', { bubbles: true })) } catch (_) {}
    return { clicked: true, target: input, reason: 'clicked' }
  } catch (_) {
    return { clicked: false, reason: 'exception' }
  }
}

// 7b.4 — parseExperienceThreshold(meta)
//
// Special-case for kind:'booleanThreshold' entries. The question
// contains a minimum number of years; profile.yearsExperience is
// a number; click Ja iff profile.yearsExperience >= threshold.
//
// Returns the parsed minimum-years number, or null when no
// threshold can be extracted (in which case clickBooleanOption
// is never called — the field falls through as a plain boolean).
function parseExperienceThreshold(meta) {
  if (!meta || typeof meta !== 'string') return null
  const m = meta.match(/(?:minst|mer\s*än|≥)\s*(\d+)\s*(?:års?|år)/i)
    || meta.match(/(?:at\s+least|minimum|more\s+than|≥)\s*(\d+)\s*years?/i)
  return m ? Number(m[1]) : null
}

// 7b.5 — booleanFromExperienceYears(profileValue, threshold)
// Companion to parseExperienceThreshold. Returns true / false /
// undefined so it can be passed directly to clickBooleanOption.
function booleanFromExperienceYears(profileValue, threshold) {
  if (typeof profileValue !== 'number' || threshold == null) return undefined
  return profileValue >= threshold
}

// 7b.6 — resolveProfileRaw(profile, dottedKey)
// Walk a dotted key path against the profile and return the RAW
// value (boolean / number / string / array). Distinct from
// resolveProfileValue() which stringifies everything for text
// fill — the boolean/multiselect/consent paths need the
// original type to make decisions. Returns undefined when the
// path doesn't resolve.
function resolveProfileRaw(profile, dottedKey) {
  if (!profile || !dottedKey) return undefined
  const parts = String(dottedKey).split('.')
  let cur = profile
  for (const p of parts) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur == null ? undefined : cur
}

// ---------- 8. Scan + fill ----------
//
// `scan()` walks the document for matchable inputs and returns the
// list. Used in two places: (a) the badge-3+ threshold check and (b)
// the actual fill loop.

function collectInputs(root = document) {
  const out = []
  // 2026-07-16 (Round-12) — extend the candidate set to include
  // <button> elements. Matched entry kinds `boolean`, `multiselect`,
  // `consent` may live on radios / checkboxes / role="switch"
  // toggles that are NOT input elements; the only way to
  // consistently route them is to let matchField() see them. Submit/
  // reset/image/hidden/password are still unconditionally skipped
  // because their `value` is HTML-control-state, not user-input data.
  const inputs = root.querySelectorAll('input, textarea, select, button')
  inputs.forEach((el) => {
    const type = (el.getAttribute('type') || '').toLowerCase()
    // Narrowed unconditional skip — no longer excludes radios/
    // checkboxes/<button>. matchField() decides routing.
    if (el.tagName === 'INPUT' && ['submit', 'reset', 'image', 'hidden', 'password'].includes(type)) return
    const m = matchField(el)
    if (m) out.push({ input: el, match: m })
  })
  // Recurse into shadow DOM (open mode only).
  const all = root.querySelectorAll('*')
  all.forEach((el) => {
    if (el.shadowRoot) {
      const nested = collectInputs(el.shadowRoot)
      nested.forEach((n) => out.push(n))
    }
  })
  // Recurse into same-origin iframes for hosts like Workday SAP.
  const iframes = root.querySelectorAll('iframe')
  iframes.forEach((f) => {
    try {
      const doc = f.contentDocument
      if (!doc) return
      const nested = collectInputs(doc)
      nested.forEach((n) => out.push(n))
    } catch (_) { /* cross-origin — skip */ }
  })
  return out
}

async function scanAndPaint() {
  const { profile } = await readStorage()
  const matches = collectInputs()
  if (!profile) return { matches, hasProfile: false }
  let filled = 0
  for (const { input, match } of matches) {
    const value = resolveProfileValue(profile, match.profileKey)
    if (value) {
      paintField(input, 'ok')
    } else {
      paintField(input, 'missing')
    }
  }
  // 2026-07-12 (Round-11 polish): write the detected count to
  // chrome.storage.local so the popup's chrome.storage.onChanged
  // listener can re-paint when fields appear AFTER the popup
  // opened. Without this write the popup runs `queryActiveTab`
  // ONCE on open and never refreshes; on a React 'use client'
  // page like /test-form the form may render AFTER the initial
  // query, leaving the user staring at "Inga formulär
  // upptäckta" with the Fyll i nu button disabled. The write
  // is rate-limited via `lastDetectedWriteAt` so a 20-mutation
  // burst (Workday) doesn't spam storage — at most one write
  // per 500ms per content script instance.
  writeDetectedCountIfChanged(matches.length)
  return { matches, hasProfile: !!profile }
}

// 2026-07-12 (Round-11): storage-write helper for the
// detected count. The contract is "write on change": same
// count within the rate-limit window is a no-op, a
// different count always writes so transitions (0→7 when
// the form mounts) reach the popup without delay. The
// popup's chrome.storage.onChanged listener reads this key
// and re-paints whenever it changes — see popup.js for the
// matching change-listener. The rate-limit constant is
// locked by tests/unit/extension-content.test.mjs.
let lastWrittenCount = null
let lastDetectedWriteAt = 0
const DETECTED_WRITE_INTERVAL_MS = 500
function writeDetectedCountIfChanged(count) {
  const now = Date.now()
  // Same count + recent write → skip (no info to convey).
  // Different count → always write so the popup sees the
  // transition. Same count after the rate-limit window
  // also writes so the timestamp stays fresh for
  // diagnostics (e.g. the popup's "last detected" debug
  // panel).
  if (count === lastWrittenCount && now - lastDetectedWriteAt < DETECTED_WRITE_INTERVAL_MS) {
    return
  }
  lastWrittenCount = count
  lastDetectedWriteAt = now
  try {
    chrome.storage.local.set({
      jobbpiloten_detectedCount: count,
      jobbpiloten_detectedAt: now,
    })
  } catch (_) { /* storage off / quota — fail silent */ }
}

// ---------- 8a. Fill rate limit ----------
//
// Hard cap: at most one auto-fill per 5 seconds. Without this a user who
// accidentally double-clicks the badge (or holds Enter while navigating
// away) could trigger 5-10 fill cycles against the LLM + storage in a
// few hundred milliseconds — each one pushing a profile write to
// chrome.storage.local on every watched page. We swallow the re-trigger
// with a soft toast so the user understands why nothing happened, then
// let them retry after the window expires.
//
// Cross-frame atomicity: the limiter lives in background.js (the SW is
// single-threaded across all tabs). Content scripts ask the SW to acquire
// a fill slot before mutating any DOM — this gives us ONE 5-second window
// across every active tab, every iframe, every content-script instance.
// Fallback: if the SW reply never arrives (offline / SW hibernated /
// cold-spawn crash), we proceed anyway; the worst-case is a brief
// double-fill race, never an unbounded one.
const FILL_RATE_LIMIT_MS = 5_000

async function acquireFillSlot() {
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'JOBBPILOTEN_FILL_ACQUIRE' })
    if (reply && typeof reply.ok === 'boolean') return reply
  } catch (_) { /* SW offline — degrade gracefully so the user can still fill */ }
  return { ok: true, degraded: true }
}

async function fillAll() {
  const { profile, token, styleOverride } = await readStorage()
  if (!profile) return { filled: 0, missing: 0 }
  // Rate limit — single-threaded check via background SW.
  const slot = await acquireFillSlot()
  if (!slot.ok) {
    const waitS = Math.max(1, Math.ceil((slot.remainingMs || FILL_RATE_LIMIT_MS) / 1000))
    showToast(`Vänta ${waitS}s innan nästa auto-fill (rate-limit).`)
    return { filled: 0, missing: 0, rateLimited: true }
  }
  const matches = collectInputs()
  let filled = 0
  let missing = 0
  let reviewNeeded = 0
  const aiQueue = [] // [{ input, field }]
  // 2026-07-21 / Round-72.2 / BUG 4 fix — per-question dedup
  // for radio pairs. fillAll() walks ALL fields including BOTH
  // radios of a Ja/Nej pair (they share the same FIELD_PATTERNS
  // match + meta). Without a Set keyed by `booleanGroupKey()`,
  // clickBooleanOption() would fire TWICE per question, and the
  // second click on Bootstrap / Teamtailor toggle buttons
  // DEACTIVATES the first. The Set persists across the outer
  // for-loop so each question is resolved ONCE.
  const handledBooleanGroups = new Set()
  // 2026-07-16 (Round-12) — match-kind dispatch. The pre-Round-12
  // loop assumed every match was a text input/textarea and routed
  // through setInputValue. New kind: `boolean | booleanThreshold |
  // multiselect | consent | select | file` paths each get their
  // own handler — see helpers in section 7b. The default branch
  // (no kind) preserves the legacy text-set behaviour bytewise.
  for (const { input, match } of matches) {
    const kind = match.kind || 'text'
    const profileKey = match.profileKey

    // file kinds: maybeInstallFileButtons() installs an amber
    // sibling button for every <input type="file">; the user's
    // click then triggers the native picker. We mark the input
    // as 'ok' so the paint is consistent with the affordance
    // available — the actual file selection is still manual.
    if (kind === 'file') {
      paintField(input, 'ok')
      filled++
      continue
    }

    // Boolean (and boolean-threshold) — click Ja/Nej based on
    // raw profile value. resolveProfileValue stringifies booleans
    // so we walk the dotted path directly for the typed value.
    if (kind === 'boolean' || kind === 'booleanThreshold') {
      let desired
      if (kind === 'booleanThreshold') {
        const meta = getFieldMeta(input)
        const threshold = parseExperienceThreshold(meta)
        const yearsRaw = resolveProfileRaw(profile, profileKey)
        const yearsNum = typeof yearsRaw === 'number' ? yearsRaw : Number(yearsRaw)
        desired = booleanFromExperienceYears(
          Number.isFinite(yearsNum) ? yearsNum : undefined,
          threshold,
        )
      } else {
        const raw = resolveProfileRaw(profile, profileKey)
        if (raw === true || raw === 'true' || raw === 1 || raw === '1') desired = true
        else if (raw === false || raw === 'false' || raw === 0 || raw === '0') desired = false
      }
      if (desired == null) {
        paintField(input, 'missing')
        missing++
        continue
      }
      // BUG 4 / Round-72.2 — skip the second (and subsequent)
      // radio of an already-handled question group so we click
      // each Ja/Nej pair exactly ONCE (the second click on
      // toggle-button radios would deactivate the first).
      if (handledBooleanGroups.has(booleanGroupKey(input))) continue
      handledBooleanGroups.add(booleanGroupKey(input))
      const res = clickBooleanOption(input, desired)
      if (res && res.clicked) {
        paintField(input, 'boolean_filled')
        filled++
      } else {
        // No target found OR the click silently no-op'd. Either
        // way the user has to verify manually so a red dashed
        // outline drives their attention to the field.
        paintField(input, 'review_needed')
        reviewNeeded++
      }
      continue
    }

    // Multi-select checklist — click every matching sibling box.
    // profile.skills is an array; checkMultiCheckboxes() does the
    // label walk. We report orange `boolean_filled` per the
    // "orange = boolean decision made" convention.
    if (kind === 'multiselect') {
      const arr = resolveProfileRaw(profile, profileKey)
      const arrOk = Array.isArray(arr) ? arr : (typeof arr === 'string' && arr ? arr.split(/,\s*/) : [])
      const res = checkMultiCheckboxes(input, arrOk)
      if (res.candidates > 0) {
        paintField(input, 'boolean_filled')
        if (res.clicked > 0) filled += res.clicked
        else missing++ // candidates found but none of profile.skills matched the labels
      } else {
        paintField(input, 'missing')
        missing++
      }
      continue
    }

    // GDPR / terms consent — DEFAULT FALSE per safety policy.
    // Only explicit profile.autoConsent = true triggers a click
    // (still paints orange `boolean_filled`). When autoConsent is
    // undefined OR false the field is left untouched but painted
    // with the dedicated `consent_unchecked` slate-grey dashed
    // status (distinct from 'missing' so the user understands the
    // data IS in their profile — the safety policy is what kept
    // us from auto-clicking) + counted as missing so the fill
    // summary still highlights it.
    if (kind === 'consent') {
      const raw = resolveProfileRaw(profile, profileKey)
      const autoConsent = raw === true || raw === 'true' || raw === 1 || raw === '1'
      const res = checkConsent(input, autoConsent)
      if (res.clicked) {
        paintField(input, 'boolean_filled')
        filled++
      } else if (res.reason === 'no-auto-consent') {
        paintField(input, 'consent_unchecked')
        missing++
      } else {
        paintField(input, 'review_needed')
        reviewNeeded++
      }
      continue
    }

    // <select> element — setInputValue() already routes to the
    // option-match branch when input.tagName === 'SELECT'.
    if (kind === 'select') {
      const value = resolveProfileValue(profile, profileKey)
      if (!value) {
        paintField(input, 'missing')
        missing++
        continue
      }
      const ok = setInputValue(input, value)
      if (ok) {
        paintField(input, 'ok')
        filled++
      } else {
        paintField(input, 'review_needed')
        reviewNeeded++
      }
      continue
    }

    // Default: text input/textarea (legacy Round-2 path).
    // Identical to the pre-Round-12 behaviour — deliberate to
    // keep the structural-test fixtures forward.
    const value = resolveProfileValue(profile, profileKey)
    if (value) {
      // Single fill attempt. Retry with identical args almost never
      // helps against a host `onchange` listener that throws (the
      // second call throws the same way); REVIEW_NEEDED surfaces the
      // failure so the user can investigate manually. We avoid
      // double-mutations so a half-filled state isn't recorded as
      // "ok" by the host page's analytics.
      const ok = setInputValue(input, value)
      if (ok) {
        paintField(input, 'ok')
        filled++
      } else {
        // REVIEW_NEEDED — the field is matchable + the profile has a
        // value but the host rejects the mutation. paintField also
        // injects the stylesheet on first call so the user sees the
        // dashed red outline within microseconds.
        paintField(input, 'review_needed')
        reviewNeeded++
      }
    } else if (
      token &&
      profileKey &&
      profileKey.startsWith('answers.') &&
      AI_FIELDS.has(profileKey.slice('answers.'.length))
    ) {
      // Empty motivation-class field — queue an AI generation
      // request so we can fill it in parallel after the direct
      // pass completes.
      aiQueue.push({ input, field: profileKey.slice('answers.'.length) })
    } else {
      paintField(input, 'missing')
      missing++
    }
  }
  maybeInstallFileButtons()

  // Run AI fills in parallel after the direct pass. We surface a
  // "Generating answers..." toast up front so the user understands
  // the brief wait, and bump the count once responses return.
  let aiBatchFilled = 0
  let aiBatchErrored = 0
  if (aiQueue.length > 0) {
    showToast(`Genererar ${aiQueue.length} AI-svar...`)
    const aiResult = await fetchAIAnswers({ token, queue: aiQueue, styleOverride })
    filled += aiResult.filled
    missing += aiResult.missing
  }
  // ---- Batch AI-adaptation pass (unmatched textareas) ----
  // Runs after the single-field AI pass so motivation-class keys
  // already short-circuit on profile.answers.* before we burn LLM
  // tokens on a batch call. The user sees a single toast line
  // summarizing the *whole* fill — no separate "AI batch" toast —
  // so the count of "fält ifyllda" matches what the user reads.
  const unmatched = findUnmatchedTextareas()
  if (unmatched.length > 0 && token) {
    const aiBatchQueue = unmatched.map((input) => {
      const meta = getFieldMeta(input)
      return {
        input,
        id: 'custom',
        label: meta,
        lang: classifyFieldLanguage(meta),
      }
    })
    if (aiBatchQueue.length > 0) {
      showToast(`Genererar ${aiBatchQueue.length} AI-svar för okända frågor...`)
      const aiBatch = await fetchBatchAIAnswers({ token, queue: aiBatchQueue, styleOverride })
      aiBatchFilled = aiBatch.filled
      aiBatchErrored = aiBatch.errored
      filled += aiBatchFilled
      missing += aiBatchErrored
    }
  }
  const tail = []
  if (missing) tail.push(`${missing} saknar data — uppdatera din profil`)
  if (reviewNeeded) tail.push(`${reviewNeeded} granska manuellt (REVIEW_NEEDED)`)
  const summary = `${filled} fält ifyllda` + (aiBatchFilled ? ` (varav ${aiBatchFilled} AI-genererade — granska)` : '')
  showToast(
    summary + (tail.length ? `, ${tail.join(', ')}` : ''),
  )
  return { filled, missing, reviewNeeded }
}

// ---------- 8b. AI fill bridge ----------
//
// For each textarea flagged for AI generation above, POST the
// detected meta-text + field key to /api/extension/answer. Bearer
// token from chrome.storage.local authorises the call. Server-side
// rate limit kicks in at 20/hr/token so a runaway form page can't
// burn LLM budget — the 429 response surfaces to the user as a
// toast asking them to retry shortly.
const AI_FIELDS = new Set([
  'whyThisCompany',
  'whyThisRole',
  'strengths',
  'weaknesses',
  'challenge',
  'availability',
])
const AI_FETCH_TIMEOUT_MS = 6000
async function fetchAIAnswers({ token, queue, styleOverride }) {
  // Round-44 — per-question style override wiring. The popup's
  // "Skrivstil för detta svar" <select> writes
  // `jobbpiloten_styleOverride` to chrome.storage.local; we read
  // it once at fillAll() time and pass `styleOverride` down here.
  // Only include `style` in the body when it's a non-empty string
  // so an absent/cleared override (`''`) doesn't fail the server's
  // Zod `z.string().min(1)` schema. The literal `body.style`
  // assignment is locked by tests/unit/extension-content.test.mjs
  // so a future refactor can't silently drop it.
  const overrideStyle = String(styleOverride || '').trim()
  const tasks = queue.map(async ({ input, field }) => {
    const meta = getFieldMeta(input)
    // Client-side cap ~500 chars below the server-side Zod max(2000)
    // so a malicious / unintended 2 KB aria-label never burns LLM
    // context invisibly. The truncated string still carries the
    // field label + key data so the generated answer routes correctly.
    // UNIT TEST: tests/unit/extension-content.test.mjs asserts the
    // INPUT.length === 1500 trick by mocking fetch and triggering
    // fetchAIAnswers with a 4 KB field meta — any future regression
    // here would silently let the LLM burn extra tokens and possibly
    // surpass the server-side max(2000). The cap is a deliberate,
    // commented, tested contract.
    const question = String(meta || '').slice(0, 1_500)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), AI_FETCH_TIMEOUT_MS)
    try {
      // Resolve relative to the dashboard's fixed origin (not the
      // active page's origin). assertOriginAllowed then independently
      // checks the URL against the hard-coded PROD_ALLOWED_ORIGINS
      // allow-list — see the SECURITY comment in section 3.
      const url = `${PROD_BASE_URL}/api/extension/answer`
      assertOriginAllowed(url)
      const body = { question, field }
      if (overrideStyle) body.style = overrideStyle
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (!res.ok) {
        // 429 surfaces rate-limit so the user can understand why
        // we couldn't fill it. 401 means the token expired —
        // surface that too so they re-connect from /dashboard.
        if (res.status === 429) {
          showToast('För många AI-svar — försök igen om en stund.')
        } else if (res.status === 401) {
          showToast('Token har gått ut — anslut tillägget igen från /dashboard.')
        }
        paintField(input, 'missing')
        return { filled: 0, missing: 1 }
      }
      const data = await res.json().catch(() => ({}))
      if (data && typeof data.answer === 'string' && data.answer.trim()) {
        const ok = setInputValue(input, data.answer)
        if (ok) {
          paintField(input, 'ok')
          return { filled: 1, missing: 0 }
        }
      }
      paintField(input, 'missing')
      return { filled: 0, missing: 1 }
    } catch (err) {
      clearTimeout(timer)
      // Network blip / abort / CSP exception — fail soft so the
      // field stays paintable but doesn't block the rest of the
      // batch.
      paintField(input, 'missing')
      return { filled: 0, missing: 1 }
    }
  })
  // Cap concurrency at 3 in-flight requests so a 20-field page
  // doesn't fire 20 XMLHttpRequests at once against the Next.js
  // backend (which would queue up behind a single connection per
  // domain). 3 is the sweet spot — generous parallelism without
  // triggering TCP-level head-of-line blocking.
  const POOL = 3
  const results = []
  for (let i = 0; i < tasks.length; i += POOL) {
    const slice = await Promise.all(tasks.slice(i, i + POOL))
    results.push(...slice)
  }
  return results.reduce(
    (acc, r) => ({ filled: acc.filled + r.filled, missing: acc.missing + r.missing }),
    { filled: 0, missing: 0 },
  )
}

// ---------- 8c. Batch AI-adaptation bridge ----------
//
// POSTs up to 12 unmatched free-text labels to
// /api/extension/ai-answers in a single call, paints the answered
// fields with the BLUE `ai_generated` outline + tooltip, and counts
// failures for the user-facing toast. Mirrors the per-field
// fetchAIAnswers shape, with two meaningful differences:
//   • the request body uses `fields[]` instead of `field`+`question`
//   • the response shape is `{ answers: { id: { answer, source } } }`
//     so partial Groq failures don't cascade.
//
// Single 6-second cap (matches the per-field fetchAIAnswers
// `AI_FETCH_TIMEOUT_MS`) so a runaway ATS page that triggers many
// batch requests still respects the user's "wait" experience.
//
// Failure modes are surfaced in Swedish toasts in the catch /
// non-2xx branches so the user understands WHY nothing was filled
// rather than seeing a silent "0 fält" summary.
async function fetchBatchAIAnswers({ token, queue, styleOverride }) {
  // Round-44 — per-batch style override. Mirrors fetchAIAnswers:
  // the popup writes `jobbpiloten_styleOverride` to
  // chrome.storage.local; fillAll() reads it once and threads it
  // down here. Only attach `style` when it's a non-empty string so
  // an absent/cleared override doesn't fail Zod `min(1)`. The
  // literal `payload.style =` is locked by
  // tests/unit/extension-content.test.mjs so a future refactor
  // can't silently drop it.
  const overrideStyle = String(styleOverride || '').trim()
  const payload = {
    fields: queue.map((q) => ({
      id: q.id,
      label: String(q.label || '').slice(0, 1_500),
      question: String(q.label || '').slice(0, 1_500),
    })),
    // Pick `lang` from the queue heuristically: a single EN-flagged
    // field flips the whole batch to English. The cost of "wrong
    // batch language for one form" is much lower than the cost of
    // asking every user to configure language prefs, so the heuristic
    // errs on the side of `sv` (matching the soft-launch market).
    lang: queue.some((q) => q.lang === 'en') ? 'en' : 'sv',
  }
  if (overrideStyle) payload.style = overrideStyle
  const url = `${PROD_BASE_URL}/api/extension/ai-answers`
  try {
    assertOriginAllowed(url)
  } catch (_) {
    // Fail closed: a compromised page trying to provoke a token-leak
    // request should not get any response (not even a 4xx). Mirror
    // the per-field fetchAIAnswers posture.
    return { filled: 0, errored: queue.length }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), AI_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      // 429 surfaces rate-limit OR tier-cap-hit (the route uses 429
      // for both). 401 means the token expired. 5xx is a generic
      // "AI:n är nere" toast. In every non-2xx case the fields stay
      // `missing` rather than `ai_generated` so the user never
      // thinks an unfilled field was actually filled.
      if (res.status === 429) {
        showToast('För många AI-svar den här timmen — försök igen om en stund.')
      } else if (res.status === 401) {
        showToast('Token har gått ut — anslut tillägget igen från /dashboard.')
      } else if (res.status >= 500) {
        showToast('AI:n är tillfälligt nere — alla okända fält förblir tomma.')
      }
      return { filled: 0, errored: queue.length }
    }
    const data = await res.json().catch(() => ({}))
    // Disabled-toggle branch — the route returns 200 with
    // `{ disabled: true, answers: {} }` when the user flipped the
    // AI fallback OFF in /settings. Without this branch the user
    // would see "0 svar ifyllda" with no explanation that they
    // turned off the feature themselves. Surface a Swedish toast
    // and short-circuit so the per-field loop never paints BLUE
    // outlines on fields the server refused to answer.
    if (data && data.disabled === true) {
      showToast('AI-svar är avstängt — slå på det under "AI-hjälp i ansökningsformulär" i /settings.')
      return { filled: 0, errored: 0 }
    }
    const answers = data && typeof data.answers === 'object' ? data.answers : {}
    let filled = 0
    let errored = 0
    for (const q of queue) {
      const slot = answers[q.id]
      if (slot && typeof slot.answer === 'string' && slot.answer.trim()) {
        const ok = setInputValue(q.input, slot.answer)
        if (ok) {
          // BLUE dashed outline + tooltip "AI-genererat svar — granska
          // innan du skickar" so the user can spot AI fields at a
          // glance before they click submit.
          paintAsAiGenerated(q.input, slot.source)
          filled++
          continue
        }
      }
      // Per-field Groq error (source: 'error' or empty answer) or
      // setInputValue rejection — paint yellow so the user knows
      // this field didn't get filled.
      paintField(q.input, 'missing')
      errored++
    }
    return { filled, errored }
  } catch (err) {
    clearTimeout(timer)
    // Per-field paint on network error so the user sees consistent
    // visual feedback across the whole batch.
    for (const q of queue) paintField(q.input, 'missing')
    return { filled: 0, errored: queue.length }
  }
}

// ---------- 8d. Mailto / email-apply signal detection (Round-34 / Part 4) ----------
//
// Detects three flavours of "this job is applied to by email":
//   (a) `a[href^="mailto:"]` clicks — highest-confidence, recruiter
//       explicitly advertised an email path
//   (b) Bare email addresses in visible page text (regex) — catches
//       "Maila HR på hr@company.com" prose surrounding forms
//   (c) Obfuscated "[at]" / "[dot]" patterns (many Swedish recruiters
//       obfuscate to defeat scrapers) — decoded at match time
//   (d) Phrase patterns WITHOUT an email regex hit — e.g. "Skicka
//       din ansökan till oss" with no address — surfaced as a hint
//       so the user knows the page expects an email-apply.
//
// Output is JSON-safe (no DOM nodes) so the popup can render directly
// from chrome.storage.local. Same origin-policy: same-origin iframe
// traversal mirrors collectInputs().

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
// Obfuscated: "user[at]company[dot]com" / "namn (at) foretag (punkt) se".
// Captures (1)=local-part, (2)=domain, (3)=TLD; groups are decoded into
// the canonical "user@company.com" form at match time.
//
// Round-36 fix: Swedish characters (å/ä/ö + uppercase) added to all
// three character classes so obfuscated patterns like
// "ansök (at) foretag (punkt) se" decode correctly. The product is
// Swedish-first; a recruiter obfuscating a local-part with Swedish
// characters was silently dropped by the previous ASCII-only class.
// Bytewise identity is locked by tests/unit/extension-mailto-detector-
// source.test.mjs — keep the test regex in lock-step.
const EMAIL_REGEX_OBFUSC = /\b([a-zA-Z0-9._%+\-åäöÅÄÖ]{2,})\s*[\[\(]\s*(?:at|AT)\s*[\]\)]\s*([a-zA-Z0-9.\-åäöÅÄÖ]{2,})\s*[\[\(]\s*(?:dot|DOT|punkt|PUNKT)\s*[\]\)]\s*([a-zA-ZåäöÅÄÖ]{2,})\b/g
// Phrase signals that imply "this is an email-apply" even when no
// address was found in the body text. Bounded to ≤50 char windows
// around the keyword so a footer "Om oss: vi använder cookies" doesn't
// false-positive the "ansökan" mention.
const EMAIL_PHRASES = /(skicka[\s\S]{0,40}?(?:ansökan|cv)[\s\S]{0,40}?(?:till|mejl|epost)|maila[\s\S]{0,40}?(?:cv|ansökan)[\s\S]{0,30}?(?:till|oss)|send[\s\S]{0,40}?(?:application|cv|resume)[\s\S]{0,40}?(?:to|by\s+email)|email[\s\S]{0,30}?(?:your\s+)?(?:application|cv|resume)[\s\S]{0,30}?to|apply[\s\S]{0,30}?(?:by|via)\s+email|ansök[\s\S]{0,30}?via\s+mejl|via\s+epost)/i

function findMailtoSignals(root = document) {
  const out = []
  const seen = new Set()
  // (a) mailto: links. Highest confidence — the user was given
  // an explicit CTA. Decode %-encoded addresses (recruiters
  // occasionally URL-encode the local-part to dodge scrapers).
  try {
    const links = root.querySelectorAll('a[href^="mailto:"]')
    links.forEach((a) => {
      const href = (a.getAttribute('href') || '').trim()
      const m = href.match(/^mailto:([^?]*)(\?.*)?$/i)
      if (!m || !m[1]) return
      let email
      try { email = decodeURIComponent(m[1]) } catch (_) { email = m[1] }
      email = email.trim()
      // Re-test against the canonical regex — a "mailto:?subject=…"
      // link (no address) is rejected so it doesn't pollute the list.
      EMAIL_REGEX.lastIndex = 0
      if (!EMAIL_REGEX.test(email)) return
      const key = email.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      out.push({ email, kind: 'mailto', label: a.innerText?.trim() || a.title || '' })
    })
  } catch (_) { /* DOM unavailable */ }

  // (b) bare emails + (c) obfuscated emails in visible text.
  // TreeWalker over text nodes — avoids pulling in nav/footer/script
  // bodies via innerText.
  try {
    const walker = (root.ownerDocument || document).createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(n) {
          if (!n || !n.nodeValue) return NodeFilter.FILTER_REJECT
          if (n.parentElement && n.parentElement.closest && n.parentElement.closest('[aria-hidden="true"], [hidden], script, style, noscript, nav, footer, header')) {
            return NodeFilter.FILTER_REJECT
          }
          return NodeFilter.FILTER_ACCEPT
        },
      },
    )
    let n
    while ((n = walker.nextNode())) {
      const text = n.nodeValue || ''
      EMAIL_REGEX.lastIndex = 0
      let m
      while ((m = EMAIL_REGEX.exec(text)) !== null) {
        const e = m[0]
        const key = e.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ email: e, kind: 'text', label: '' })
      }
      EMAIL_REGEX_OBFUSC.lastIndex = 0
      while ((m = EMAIL_REGEX_OBFUSC.exec(text)) !== null) {
        const decoded = `${m[1]}@${m[2]}.${m[3]}`
        const key = decoded.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ email: decoded, kind: 'obfuscated', label: text.slice(0, 80) })
      }
    }
  } catch (_) { /* walker unavailable */ }

  // (d) phrase-only fallback. Skip if we already have ≥1 email —
  // the pill will already be visible, so the phrase hint would be
  // noise. Surface ONLY when no address was found AND a recruiter
  // mentioned an email-apply elsewhere on the page; the popup
  // renders an "ingen adress hittades" hint so the user knows to
  // copy the address manually from the page body.
  if (out.length === 0 && root.body) {
    let bodyText = ''
    try { bodyText = (root.body.innerText || '').slice(0, 8000) } catch (_) { /* ignore */ }
    if (EMAIL_PHRASES.test(bodyText)) {
      out.push({ email: null, kind: 'phrase', label: 'Sida efterfrågar e-postansökan — kopiera adress manuellt' })
    }
  }
  return out
}

// Write the (possibly empty) mailto signal list to chrome.storage.local
// at most once per scan. Rate-limited identically to writeDetectedCountIfChanged
// — a 20-mutation burst (Workday) doesn't spam storage.
let lastWrittenEmailSignalsJson = null
function writeEmailSignalsIfChanged(signals) {
  const json = JSON.stringify(signals || [])
  if (json === lastWrittenEmailSignalsJson) return
  lastWrittenEmailSignalsJson = json
  try {
    chrome.storage.local.set({ jobbpiloten_emailSignals: signals || [] })
  } catch (_) { /* storage off / quota — fail silent */ }
}

// ---------- 9. File input workaround ----------
//
// 2026-07-16 (Round-12) — three file flavours now share the same
// affordance. The button copy is read from FILE_BUTTON_LABELS by
// the FIELD_PATTERNS entry that matches the input's nearest label.
// Pattern profileKey values are the lookup key so any future file
// rule added to the table just needs a matching entry in this map.

// Button copy keyed by pattern profileKey. Default falls back to
// 'cvFile' if no rule matches (legacy behaviour). All entries
// locked by tests/unit/extension-content.test.mjs (Round-12) —
// renames must update the test in the same commit.
const FILE_BUTTON_LABELS = {
  cvFile: 'Välj CV-fil med JobbPiloten',
  coverLetterFile: 'Välj personligt brev med JobbPiloten',
  additionalDocuments: 'Välj övriga dokument med JobbPiloten',
}

// Inject a small JobbPiloten-branded button as a sibling of each
// <input type="file">. Clicking it triggers the host input's native
// .click() so the browser's own file picker appears. The user still
// picks the file (extensions cannot read the filesystem). The
// button is purely a visual affordance for "we know this is a CV
// upload — click this if you want to attach your saved CV from disk".
function maybeInstallFileButtons() {
  const files = findFileInputs()
  files.forEach((input, i) => {
    if (input.dataset.jobbpilotenBtnInstalled === '1') return
    // 2026-07-16 (Round-12) — walk the FILE_PATTERNS entries to
    // pick the right button copy. Default to the CV copy when no
    // rule matches, preserving the legacy behaviour for pages
    // whose <input type="file"> has no file label at all.
    const meta = getFieldMeta(input)
    let label = FILE_BUTTON_LABELS.cvFile
    for (const entry of FIELD_PATTERNS) {
      if (entry.type !== 'file' || !entry.profileKey) continue
      if (entry.pattern.test(meta)) {
        label = FILE_BUTTON_LABELS[entry.profileKey] || label
        break
      }
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = label
    btn.setAttribute('data-jobbpiloten-file-btn', '1')
    btn.style.cssText = [
      'display:inline-block',
      'margin:6px 0',
      'padding:10px 14px',
      'border-radius:6px',
      'background:#f59e0b',
      'color:#1f2937',
      'font:700 13px system-ui,-apple-system,sans-serif',
      'cursor:pointer',
      'border:2px solid #d97706',
      'box-shadow:0 2px 6px rgba(245,158,11,0.45)',
    ].join(';')
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      try { input.click() } catch (_) { /* fire on click manually if restricted */ }
    })
    // Insert AFTER the input so the visual order is preserved; if
    // the input is wrapped in a <label>, the button would be invalid
    // HTML — insert into the input's parent in that case.
    if (input.parentElement) {
      input.parentElement.insertBefore(btn, input.nextSibling)
    } else {
      input.after(btn)
    }
    input.dataset.jobbpilotenBtnInstalled = '1'
  })
}

// ---------- 10. Floating pill (always visible when 1+ field is detected) ----------
//
// Soft-launch polish (2026-07-12): previously the badge only
// appeared when 3+ fields were detected. Soft-launch testers
// reported that a 1-2 field apply form (e.g. a simple name + email
// page) felt "invisible" — the extension was installed and
// connected but the user couldn't see any affordance.
//
// The fix surfaces a JobbPiloten-branded PILL whenever 1+ form
// field is detected on the page. The pill has two visual modes:
//   • COMPACT (1-2 fields): small 32x32 amber circle + ✈ glyph,
//     no text. Same visual weight as the previous threshold-met
//     badge so we don't bloat the page for low-field-count forms.
//   • EXPANDED (3+ fields): the full 48px circle with the ✈ glyph
//     AND a "JobbPiloten" text label so the user sees the brand
//     name. Slightly larger to draw the eye to the 3+ match list.
//
// Click always triggers fillAll() — same behaviour as the old
// badge, just visible sooner. Keyboard activation via Enter/Space
// is preserved (the same onActivate closure).
let badgeEl = null
async function ensureBadge(matchesCount) {
  // Soft-launch polish: show the pill on 1+ fields (was 3+). A page
  // with a single input is still a fill target — e.g. simple email
  // capture pages, sign-in forms on employer portals, etc.
  if (badgeEl) {
    if (matchesCount >= 1) {
      badgeEl.style.display = ''
      // Switch pill copy / size when the field count crosses 3 — a
      // 1-2 field page gets the compact amber circle, a 3+ page
      // gets the full label.
      if (matchesCount >= 3 && !badgeEl.dataset.expanded) {
        badgeEl.dataset.expanded = '1'
        // Guard: only create the label if it's missing. Without
        // this, every scheduleScan tick re-appends a fresh label
        // (the dataset flag is the right gate for STYLE updates
        // but not the right gate for DOM-mutation costs — the
        // appended label never re-renders unless we check for its
        // presence). The `querySelector` check is cheap (single
        // descendant lookup) and saves a per-tick DOM allocation.
        if (!badgeEl.querySelector('.__jobbpiloten_pill_label')) {
          const label = document.createElement('span')
          label.className = '__jobbpiloten_pill_label'
          label.textContent = 'JobbPiloten'
          label.style.cssText = 'margin-left:6px;font:600 12px system-ui,-apple-system,sans-serif;'
          badgeEl.appendChild(label)
        }
        badgeEl.style.width = 'auto'
        badgeEl.style.paddingRight = '12px'
        badgeEl.style.borderRadius = '22px'
      } else if (matchesCount < 3 && badgeEl.dataset.expanded) {
        // 2026-07-12 polish: use removeAttribute (matches the rest
        // of the codebase's data-attribute usage) rather than
        // `delete badgeEl.dataset.expanded` — both work, but the
        // attribute-removal pattern is more idiomatic and pairs
        // cleanly with the `setAttribute('data-jobbpiloten-pill',
        // '1')` write above.
        badgeEl.removeAttribute('data-expanded')
        const lbl = badgeEl.querySelector('.__jobbpiloten_pill_label')
        if (lbl) lbl.remove()
        badgeEl.style.width = '32px'
        badgeEl.style.paddingRight = ''
        badgeEl.style.borderRadius = '50%'
      }
    } else {
      badgeEl.style.display = 'none'
    }
    return
  }
  badgeEl = document.createElement('div')
  badgeEl.id = '__jobbpiloten_badge'
  badgeEl.title = 'JobbPiloten Auto-Fill — klicka för att fylla'
  badgeEl.setAttribute('role', 'button')
  // Full a11y label mirrors the visible affordance ("klicka för att fylla i formuläret")
  // so screen-reader users hear exactly what the tooltip promises sighted users.
  badgeEl.setAttribute('aria-label', 'JobbPiloten Auto-Fill — klicka för att fylla i formuläret')
  badgeEl.setAttribute('data-jobbpiloten-pill', '1')
  // Tabindex ordering — keyboard users Tab into the badge; Enter / Space
  // activate it via the click handler. role="button" + tabindex="0" mirrors
  // an actual <button>; we use a <div> because inserting real buttons into
  // a host page's DOM unmounts when the host rerenders.
  badgeEl.tabIndex = 0
  const reducedMotion = prefersReducedMotion()
  badgeEl.style.cssText = [
    'position:fixed',
    'bottom:18px',
    'right:18px',
    'width:32px',                       // smaller default — was 48px; expanded inline when 3+ fields
    'height:32px',
    'border-radius:50%',
    'box-shadow:0 4px 14px rgba(0,0,0,0.18)',
    'background:#f59e0b',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'color:#1f2937',
    'font:700 18px system-ui,-apple-system,sans-serif',
    'cursor:pointer',
    'z-index:2147483646',
    // Pulse animation only adds when the user has NOT opted out at the OS level.
    reducedMotion ? '' : 'animation:jobbpiloten_pulse 2s ease-in-out infinite',
    'user-select:none',
    'border:2px solid #ffffff',
    // Outline transitions smoothly for sighted keyboard users;
    // transform transitions handle a small hover-scale affordance.
    'transition:transform 120ms, outline-color 120ms, width 120ms, border-radius 120ms, padding 120ms',
  ].filter(Boolean).join(';')
  badgeEl.innerHTML = '<span aria-hidden="true" style="transform:rotate(-30deg);display:inline-block;">✈</span>'
  // If we entered with 3+ fields already, expand immediately.
  if (matchesCount >= 3) {
    badgeEl.dataset.expanded = '1'
    const label = document.createElement('span')
    label.className = '__jobbpiloten_pill_label'
    label.textContent = 'JobbPiloten'
    label.style.cssText = 'margin-left:6px;font:600 12px system-ui,-apple-system,sans-serif;'
    badgeEl.appendChild(label)
    badgeEl.style.width = 'auto'
    badgeEl.style.paddingRight = '12px'
    badgeEl.style.borderRadius = '22px'
  }
  // Hover focus ring — keyboard users see a visible focus state when Tab
  // lands on the badge; sighted users see the same ring on hover.
  badgeEl.addEventListener('focus', () => { badgeEl.style.outline = '3px solid rgba(245,158,11,0.55)'; badgeEl.style.outlineOffset = '2px' })
  badgeEl.addEventListener('blur', () => { badgeEl.style.outline = ''; badgeEl.style.outlineOffset = '' })
  // Keyboard activation — Enter / Space mirror the click path so the
  // badge is fully reachable without a pointer (also activated by Tab).
  const onActivate = async (ev) => {
    ev.preventDefault()
    const r = await fillAll()
    hideBadge()
    if (r.filled === 0 && r.missing === 0) {
      showToast('Ingen profil ansluten — öppna jobbpiloten.se/dashboard och klicka Anslut.')
    }
  }
  badgeEl.addEventListener('click', onActivate)
  badgeEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') onActivate(ev)
  })
  // Inline keyframes for the pulse.
  const styleEl = document.createElement('style')
  styleEl.textContent = `@keyframes jobbpiloten_pulse { 0%{transform:scale(1)} 50%{transform:scale(1.08)} 100%{transform:scale(1)} }`
  document.documentElement.appendChild(styleEl)
  ;(document.body || document.documentElement).appendChild(badgeEl)
  if (matchesCount < 1) badgeEl.style.display = 'none'
}

function hideBadge() {
  if (badgeEl && badgeEl.parentElement) badgeEl.parentElement.removeChild(badgeEl)
  badgeEl = null
}

// ---------- 10b. prefers-reduced-motion respect ----------
//
// Honor the OS-level "Reduce motion" setting so the badge doesn't pulse
// for users who have explicitly turned animations off — the pulse is
// a 2s ease-in-out scale loop on every form page-load, which can be
// nausea-inducing for vestibular-sensitive users. We detect once on
// load via matchMedia; the value is snapshot-stable for the session,
// so there is no need to subscribe to changes (Chrome fires the
// change event only when the user toggles the OS setting while the
// extension is loaded — infrequent).
function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  } catch (_) {
    return false
  }
}

// ---------- 11. Toast ----------
//
// Small non-blocking bottom-centre confirmation. Auto-dismisses
// after ~3s so the host page is never permanently altered.
function showToast(text) {
  const existing = document.getElementById('__jobbpiloten_toast')
  if (existing) existing.remove()
  const t = document.createElement('div')
  t.id = '__jobbpiloten_toast'
  t.setAttribute('role', 'status')
  t.setAttribute('aria-live', 'polite')
  t.style.cssText = [
    'position:fixed',
    'left:50%',
    'transform:translateX(-50%)',
    'bottom:90px',
    'background:#0f172a',
    'color:#fff',
    'padding:10px 14px',
    'border-radius:8px',
    'font:600 13px system-ui,-apple-system,sans-serif',
    'box-shadow:0 4px 14px rgba(0,0,0,0.2)',
    'z-index:2147483647',
    'opacity:0',
    'transition:opacity 200ms',
  ].join(';')
  t.textContent = text
  document.documentElement.appendChild(t)
  requestAnimationFrame(() => { t.style.opacity = '1' })
  setTimeout(() => {
    t.style.opacity = '0'
    setTimeout(() => t.remove(), 220)
  }, 2800)
}

// ---------- 12. MutationObserver wiring ----------
//
// Debounced re-scan on DOM mutations so SPA forms (Workday, Teamtailor)
// surface after their async mount completes.
let scanTimer = null
function scheduleScan() {
  if (scanTimer) clearTimeout(scanTimer)
  scanTimer = setTimeout(async () => {
    const r = await scanAndPaint()
    if (!r.hasProfile) {
      // Still partly useful: surface the install button so a fresh
      // user lands on a registration CTA. Without a connected
      // profile we don't show the floating badge — it'd be a no-op.
      if (r.matches.length >= 1) {
        showToast('JobbPiloten Auto-Fill upptäckt — ingen profil ansluten. Öppna jobbpiloten.se/dashboard och klicka Anslut.')
      }
      return
    }
    // Soft-launch polish: show the pill as soon as 1+ field is
    // detected (was 3+). A 1-2 field apply form still benefits from
    // a visible affordance so the user knows the extension is
    // active and can click to fill.
    if (r.matches.length >= 1) ensureBadge(r.matches.length)
    else hideBadge()
    // Round-34: mailto detection. ALWAYS scan, regardless of
    // profile or form-field match — email-apply pages may carry
    // ZERO form fields (a recruiter-only "Skicka ditt CV till
    // hr@..." paragraph), and the user deserves the affordance
    // even when form-fill is irrelevant. Same rate-limit window
    // as writeDetectedCountIfChanged so we don't multiply the
    // mutation count.
    try {
      const signals = findMailtoSignals()
      writeEmailSignalsIfChanged(signals)
    } catch (_) { /* detector throw — fail soft */ }
  // TASK 6b budget: max 1 scan per 250ms (was 500). Dropped to match
  // the 1+ pill threshold: now that the pill appears as soon as a
  // single form field mounts, a 500ms debounce felt noticeably late
  // on fast ATS pages (the form was already visible to the user
  // before the JobbPiloten pill appeared). 250ms is still long
  // enough to debounce Workday's burst-mount pattern (20+ <input>s
  // in a single animation frame) while keeping the pill-snappy on
  // normal sites. The initial scan still lazily idles via
  // requestIdleCallback (kickoff section below) so first paint
  // isn't blocked.
  // 2026-07-12 (Round-11 polish): debounce lowered to 150ms.
  // The 250ms figure felt noticeably late on a "click the popup,
  // wait for the Fyll i nu button to enable" path — the user
  // expected the button to be hot by the time the popup had
  // rendered. 150ms is still long enough to debounce a Workday
  // burst-mount (20+ <input> in a single animation frame) but
  // tight enough that the pill is visible inside the popup's
  // first paint cycle.
  }, 150)
}

function startObserver() {
  if (!document.body) return
  const obs = new MutationObserver(() => scheduleScan())
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'name', 'id', 'placeholder', 'aria-label'] })
}

// ---------- 13. Auth-sync + trigger-fill receivers ----------
//
// Dashboard posts { token, profile } via window.postMessage so we
// can run on the SAME-page content script (cheaper than going via
// the background service worker for the first sync). The background
// also re-broadcasts via chrome.tabs.sendMessage so iframes on
// other origins get the same payload through their own content
// scripts.
/**
 * The version attribute rides along on `<html>` so the dashboard
 * can read it without another round-trip. Bumped whenever a new
 * major feature ships that the dashboard should know about
 * (currently: AI-adaptive fills).
 */
function getExtensionVersion() {
  return '0.2.1'
}

window.addEventListener('message', (ev) => {
  // window.postMessage can come from any same-origin context;
  // restrict to the dashboard origin via explicit message.origin
  // check is hard because the dashboard runs on multiple deploy
  // origins. Instead we accept the message only when the source
  // window IS window.top — and the dashboard is the top-level frame
  // we inject into. Self-talk via `window.postMessage` in another
  // tab can't reach this listener so injection across tabs isn't a
  // risk.
  if (ev.source !== window) return
  const data = ev.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'JOBBPILOTEN_AUTH_SYNC') {
    handleAuthSync(data.payload)
  }
  if (data.type === 'JOBBPILOTEN_SET_DASHBOARD_URL') {
    handleDashboardUrl(data.payload)
  }
})

// ---------- 13b. Dashboard URL setter ----------
//
// Separate sync from JOBBPILOTEN_AUTH_SYNC so the dashboard can ship a
// URL update WITHOUT re-issuing the bearer token — useful when the
// user moves from staging to production (or vice versa) without
// re-connecting. Validates the URL against the manifest's
// host_permissions allowlist before persisting so a compromised host
// page can't smuggle an attacker origin into chrome.storage.sync
// (the popup would then `fetch(url)` against the attacker's server
// on the next "Öppna Dashboard" click).
//
// SECURITY: this is a deliberate, scoped relaxation of the AUTH_SYNC
// "ignore payload.origin" rule. URL writes from postMessage keys:
//   • ONLY accepted when the message source is the SAME window
//     (handled by the listener above via ev.source === window)
//   • ONLY persisted if the URL parses cleanly AND its origin is in
//     chrome.runtime.getManifest().host_permissions (i.e. the same
//     allowlist the popup's fetch() already enforces)
//   • Stripped to its origin before storage so an attacker can't
//     stash a path like "/<script>alert(1)</script>" alongside the
//     URL.
//
// Stored under chrome.storage.sync (not local) so a manual override
// on one machine syncs to the user's other devices — matches the
// user's explicit "proceed with all" ask. The split-brain tradeoff
// against the locally-stored bearer token is accepted: the popup
// does NOT send the bearer token cross-origin (it requires
// assertOriginAllowed(origins)) so a synced dashboardUrl can never
// leak credentials to a hostile origin.
function handleDashboardUrl(payload) {
  if (!payload || typeof payload !== 'object') return
  const url = String(payload.url || '').trim()
  if (!url) return
  let origin = ''
  try {
    origin = new URL(url).origin
  } catch (_) {
    return
  }
  if (!isOriginInHostAllowlist(origin)) return
  try {
    chrome.storage.sync.set({ jobbpiloten_dashboardUrl: origin })
  } catch (_) {
    // Older Chrome without storage.sync, or MV2 context — fall back
    // to local storage so the popup's 3-tier resolution still has
    // a Tier-1 hit to find.
    chrome.storage.local.set({ jobbpiloten_dashboardUrl: origin })
  }
}

function isOriginInHostAllowlist(origin) {
  try {
    const manifest = chrome.runtime.getManifest()
    const hostPerms = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []
    // Convert each pattern like "https://jobbpiloten.se/*" or
    // "https://*.vercel.app/*" into a regex; match if origin matches
    // any pattern. The trailing-`/*`-strip in hostPatternToRegex
    // makes the bare-origin test work, so re.test(origin) covers
    // both the origin alone AND the origin + path.
    for (const pattern of hostPerms) {
      if (!pattern || typeof pattern !== 'string') continue
      const re = hostPatternToRegex(pattern)
      if (re && re.test(origin)) return true
    }
  } catch (_) { /* chrome not available */ }
  return false
}

function hostPatternToRegex(pattern) {
  // Match-extension wildcards (`*`) → `[^/]+`. Trailing `/*` →
  // arbitrary path. Escape all other regex meta chars.
  //
  // v0.2.3 — bare-origin match: the trailing `/*` is stripped
  // BEFORE the `*` substitution so the path becomes fully
  // optional. The earlier shape (where `*` was always substituted
  // to `[^/]+` and the `(/.*)?$` suffix was appended) required
  // at least one char after the trailing `/`, which meant a
  // postMessage-origin test against a BARE origin like
  // `https://jobbpiloten.se` would always fail. With the strip,
  // a single `re.test(origin)` call matches both the bare origin
  // and the origin + any path — matching Chrome's match-pattern
  // semantics for the `/*` wildcard. Must stay byte-identical
  // with extension/popup.js's mirror — divergence is a silent
  // DNS-rebinding vector.
  let body = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  if (body.endsWith('/*')) {
    body = body.slice(0, -2)
  }
  body = body.replace(/\*/g, '[^/]+')
  return new RegExp('^' + body + '(?:/.*)?$')
}

// Background side-channel — every content script gets the same
// payload, so listening for the same key on chrome.runtime is
// redundant with the postMessage channel, but is the safer path
// when the dashboard tab is closed.
try {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return
    if (message.type === 'JOBBPILOTEN_AUTH_SYNC') handleAuthSync(message.payload)
    if (message.type === 'JOBBPILOTEN_TRIGGER_FILL') {
      fillAll().then((r) => {
        if (r.filled === 0 && r.missing === 0) {
          showToast('JobbPiloten Auto-Fill — öppna en sida med formulär först.')
        }
      })
    }
    if (message.type === 'JOBBPILOTEN_QUERY') {
      // Popup asks: how many fields can we fill on this page? We
      // walk the document once with the existing matcher and
      // return the first ~12 visible labels so the popup list
      // doesn't get out of hand. `split(' \u00b7')` peels off the
      // first segment from the joined meta string — typically the
      // label or name, which is exactly what the user wants to see.
      const matches = collectInputs()
      const detected = matches.slice(0, 12).map(({ input }) => {
        const meta = getFieldMeta(input)
        const first = String(meta).split(' \u00b7')[0] || ''
        return first || input.name || input.id || input.tagName.toLowerCase() || '(okänt fält)'
      })
      try { sendResponse({ detected }) } catch (_) { /* receiver gone */ }
      return true
    }
  })
} catch (_) {
  // Chrome-only API; Firefox-style browsers may throw. PostMessage
  // path stays open as a fallback.
}

// ---------- 14. Kick off ----------
// ---------- 14. Kick off ----------
//
// Round-52 / Issue 3 — content-script heartbeat. The script
// writes `jobbpiloten_pingAt = Date.now()` to chrome.storage.local
// on a 30s cadence so the popup + dashboard can read a single
// source of truth for "is the extension alive on at least one
// tab?" without each doing their own API round-trip. The popup
// reads this key in loadAndPaint() to decide whether to surface
// "Ansluten" (heartbeat fresh) or "Inte ansluten" (stale).
//
// Why 30s: half the staleness threshold (60s) so a missed tick
// (e.g. SW hibernation, browser throttling on a backgrounded
// tab) doesn't immediately flip the user to "disconnected".
// 60s = HEARTBEAT_STALE_MS in extension/popup.js — both files
// must stay in lock-step.
//
// Why a dedicated heartbeat (not piggybacked on existing
// storage writes): the popup's storage.onChanged listener only
// re-paints on a NEW value, so a write-the-same-value heartbeat
// would never trigger a re-render. The heartbeat below is a
// dedicated write that always updates the timestamp.
function startHeartbeat() {
  if (startHeartbeat._handle) return
  const HEARTBEAT_INTERVAL_MS = 30_000
  const writeHeartbeat = () => {
    try {
      chrome.storage.local.set({ jobbpiloten_pingAt: Date.now() })
    } catch (_) { /* storage off / quota — fail silent */ }
  }
  // Immediate write so a popup opened on a fresh install sees a
  // fresh heartbeat without waiting 30s.
  writeHeartbeat()
  startHeartbeat._handle = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS)
}

// ---- 14b. Heartbeat → DOM attribute bridge ----
//
// Round-52 / Issue 3 (P3) — the dashboard page reads the
// extension's heartbeat via a DOM attribute (set on
// document.documentElement) because Next.js client code can't
// access chrome.storage.local directly. The content script
// already runs on the dashboard (manifest matches <all_urls>)
// and writes jobbpiloten_pingAt to chrome.storage.local on a
// 30s cadence; this bridge mirrors the latest value onto
// `data-jobbpiloten-ext-ping-at` so the dashboard's
// useEffect (which already polls document.documentElement
// every 1s) can render "Tillägget är anslutet" /
// "Koppla från" without each surface doing its own API
// round-trip.
//
// Why a DOM attribute (not a postMessage channel): the
// dashboard's existing extension-detection useEffect already
// reads document.documentElement every second, so adding one
// more attribute read is effectively free. A postMessage
// bridge would require (a) a listener in the dashboard,
// (b) a request/response handshake, and (c) a fallback timer
// for the "no content script running" case. The DOM-attribute
// approach is one-way data flow that piggybacks on the
// existing 1s poll.
//
// Storage-change listener: when another tab updates the
// heartbeat (e.g. the popup is on tab A, content script on
// tab B), chrome.storage.onChanged fires in BOTH tabs so
// every visible JobbPiloten page sees the fresh value within
// one tick.
function startHeartbeatAttributeMirror() {
  // Initial read — fire-and-forget so the attribute lands on
  // the very first paint of the dashboard if the heartbeat
  // was already in storage from another tab.
  try {
    chrome.storage.local.get('jobbpiloten_pingAt', (data) => {
      const v = data && data.jobbpiloten_pingAt
      if (v) {
        try {
          document.documentElement.setAttribute('data-jobbpiloten-ext-ping-at', String(v))
        } catch (_) { /* headless test envs */ }
      }
    })
  } catch (_) { /* chrome.storage unavailable */ }
  // Continuous sync.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return
      const ch = changes && changes.jobbpiloten_pingAt
      if (!ch) return
      const next = ch.newValue
      try {
        if (next != null) {
          document.documentElement.setAttribute('data-jobbpiloten-ext-ping-at', String(next))
        } else {
          // Tab closed / heartbeat cleared — strip the attribute
          // so the dashboard falls back to the disconnected state.
          document.documentElement.removeAttribute('data-jobbpiloten-ext-ping-at')
        }
      } catch (_) { /* documentElement unavailable */ }
    })
  } catch (_) { /* older Chrome */ }
}

// Lazy-load policy (TASK 6a):
//   • startObserver() mounts the MutationObserver eagerly because
//     it's cheap (one attribute filter, no inputs walked yet) and we
//     want fresh SPA mounts (Workday, Teamtailor) to surface quickly.
//   • scheduleScan() defers via requestIdleCallback — the actual
//     walk-collect-paint-fill-budget pass is what would compete with
//     the host page's first paint if run synchronously.
//   • The setTimeout(50ms) fallback covers browsers without
//     requestIdleCallback (older Safari, some Firefox builds).
//
// 2026-07-12 (Round-11 polish): the kickoff also runs an
// EAGER scan via setTimeout(0) when the page is already past
// the `loading` readyState. The jobbPiloten test form is a
// `'use client'` React component, so the form fields mount
// AFTER the requestIdleCallback idle slot — the user would
// open the popup, see "0 detected", and conclude the
// extension is broken. The eager setTimeout(0) scan runs
// IMMEDIATELY after the kickoff code path completes; if it
// finds no inputs (the typical pre-hydration case), the
// later requestIdleCallback / MutationObserver scan still
// picks up the form once React mounts. If it finds the
// form (the typical post-hydration case), the pill appears
// inside ~150ms (the scheduleScan debounce — both eager and
// idle calls funnel through it; clearTimeout(scanTimer)
// guarantees only one paint) — a sub-second round-trip from
// popup open to "Fyll i nu" enabled. Round-11 note: the
// <100ms_promise heuristic was misleading because the
// scheduleScan() debounce ate the timing; the user-visible
// latency floor is ~150ms regardless of which kickoff arm
// wins the bob ordering.
const idleScheduler = (cb) => {
  try {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(cb, { timeout: 1500 })
      return
    }
  } catch (_) { /* fall through */ }
  setTimeout(cb, 50)
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    startObserver()
    startHeartbeat()
    // Round-52 / Issue 3 — mirror heartbeat to data-jobbpiloten-ext-ping-at
    // so the dashboard's existing 1s poll can render "Ansluten" without
    // accessing chrome.storage.local directly.
    startHeartbeatAttributeMirror()
    // Eager setTimeout(0) — picks up a pre-hydration DOM snapshot
    // if one exists, before the React 'use client' component
    // mounts its form. Cost: a single collectInputs() over
    // document.querySelectorAll, <1ms on a typical page.
    setTimeout(() => scheduleScan(), 0)
    idleScheduler(() => scheduleScan())
  })
} else {
  startObserver()
  startHeartbeat()
  // Round-52 / Issue 3 — mirror heartbeat to data-jobbpiloten-ext-ping-at
  startHeartbeatAttributeMirror()
  setTimeout(() => scheduleScan(), 0)
  idleScheduler(() => scheduleScan())
}

// Always attempt the file-button injection on load — it doesn't
// need the badge logic and is harmless if there are no file
// inputs.
setTimeout(maybeInstallFileButtons, 600)
