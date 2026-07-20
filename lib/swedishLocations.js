/**
 * Swedish locations → Arbetsförmedlingen JobSearch API region codes.
 *
 * The AF JobTechDev search API exposes job ads filtered by Län (county)
 * through the `region` query parameter: `&region=01,14,12`. Län codes are
 * the most reliable filter keys because they cover a stable two-digit
 * numeric range (01-25) and are independent of the surface-text spelling
 * (`Göteborg` vs `Goteborg` vs `Göteborgs stad`).
 *
 * Mapping strategy: a curated list of top Swedish cities (the ones that
 * appear in onboarding's "Önskade orter" field) → their parent Län. We
 * deliberately fall back to text-search on the AF `l=` parameter when a
 * city isn't in this map so an unrecognised location still produces
 * a useful (broader) result set rather than an empty feed.
 *
 * The dashboard uses `locationToLänCodes(userLocations)` to convert the
 * profile's `locations` array into something the AF API can filter on.
 * The route also uses `isRemoteFriendlyText()` to recognise the common
 * "Distansarbete"/"Remote"/"Sverige" sentinels that should bypass the
 * region filter entirely (no point constraining a remote-eligible
 * candidate to Göteborg just because Göteborg is in their list).
 *
 * Diacritic handling: user input is normalised (lowercase + Swedish
 * diacritics stripped) before matching so a user typing "Goteborg"
 * (common when their keyboard is configured without åäö) still resolves
 * to the Göteborg entry. A separate alias map handles shorthands like
 * "gbg" and very common misspellings like "stokholm".
 */

// ---- Diacritic stripping ----
// One-way normalisation. The canonical LÄN_BY_CITY must keep its
// diacritics (the AF API itself uses them in `workplace_address.region`)
// but user input is normalised before comparison so we don't require
// every visitor to type them.
function stripDiacritics(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/é/g, 'e')
    .replace(/ü/g, 'u')
    .replace(/ñ/g, 'n')
}

// ---- Län (county) table ----
// Format: human name → AF region code. AF Län ids are two-digit strings.
// Source: Arbetsförmedlingen's JobTechDev taxonomy (statistik region/län).
export const LÄN_BY_CITY = {
  // Stockholm area
  'Stockholm': '01',
  'Solna': '01',
  'Sundbyberg': '01',
  'Nacka': '01',
  'Huddinge': '01',
  'Tyresö': '01',
  'Täby': '01',
  'Lidingö': '01',
  'Kista': '01', // Ericsson / Kista-staden
  'Sollentuna': '01',

  // Göteborg
  'Göteborg': '14',
  'Mölndal': '14',
  'Partille': '14',
  'Kungälv': '14',
  'Borås': '14',
  'Trollhättan': '14',
  'Skövde': '14',
  'Lidköping': '14',
  'Uddevalla': '14',

  // Malmö / Skåne
  'Malmö': '12',
  'Lund': '12',
  'Helsingborg': '12',
  'Kristianstad': '12',
  'Landskrona': '12',
  'Trelleborg': '12',
  'Ystad': '12',
  'Hässleholm': '12',

  // Uppsala
  'Uppsala': '03',
  'Enköping': '03',

  // Östergötland
  'Linköping': '05',
  'Norrköping': '05',
  'Motala': '05',

  // Södermanland
  'Eskilstuna': '04',
  'Katrineholm': '04',

  // Jönköping
  'Jönköping': '06',
  'Värnamo': '06',

  // Kronoberg
  'Växjö': '07',
  'Ljungby': '07',

  // Kalmar / Gotland
  'Kalmar': '08',
  'Västervik': '08',
  'Visby': '09',

  // Blekinge
  'Karlskrona': '10',
  'Ronneby': '10',

  // Halland
  'Halmstad': '13',
  'Varberg': '13',
  'Kungsbacka': '13',

  // Värmland
  'Karlstad': '17',
  'Arvika': '17',

  // Örebro
  'Örebro': '18',
  'Lindesberg': '18',

  // Västmanland
  'Västerås': '19',
  'Hallstahammar': '19',

  // Dalarna
  'Borlänge': '20',
  'Falun': '20',
  'Mora': '20',

  // Gävleborg
  'Gävle': '21',
  'Sandviken': '21',
  'Hudiksvall': '21',

  // Västernorrland
  'Sundsvall': '22',
  'Örnsköldsvik': '22',
  'Härnösand': '22',

  // Jämtland / Härjedalen
  'Östersund': '23',

  // Västerbotten
  'Umeå': '24',
  'Skellefteå': '24',

  // Norrbotten
  'Luleå': '25',
  'Boden': '25',
  'Kiruna': '25',
  'Piteå': '25',

  // Common fallbacks — leave the list open for future on-boardings
  // without code changes by always doing a lowercase substring search.
}

// ---- Shorthand / common-misspelling alias map ----
// Keys are pre-normalised (lowercase + diacritics stripped). Values are
// either: (a) a canonical city name that exists in LÄN_BY_CITY, or
// (b) `null`, which acts as an explicit reject for things like
//     "Köpenhamn" (outside Sweden) so the matcher doesn't accidentally
//     surface a real Swedish city as a fallback.
//
// The list is curated from observed onboarding text — extend it when a
// new pattern shows up in /api/profile-update logs.
const CITY_ALIASES = {
  // Göteborg shorthands
  gbg: 'Göteborg',
  goteborg: 'Göteborg',
  // Stockholm shorthands
  sthlm: 'Stockholm',
  sthl: 'Stockholm',
  stokholm: 'Stockholm',
  // Common misspellings of diacritic cities — the diacritic-stripping
  // pass would catch these too, but listing them keeps the lookup O(1)
  // and lets us assert intent in a single round-trip.
  malmo: 'Malmö',
  norrkoping: 'Norrköping',
  linkoping: 'Linköping',
  orebro: 'Örebro',
  vasteras: 'Västerås',
  vaxjo: 'Växjö',
  umea: 'Umeå',
  skelleftea: 'Skellefteå',
  lulea: 'Luleå',
  // Explicit rejects — cities outside Sweden that we'd otherwise be
  // tempted to map loosely. They return null so callers fall through
  // to the AF text-search pass with whatever the user typed.
  koppenhamn: null,
  kopenhamn: null,
  oslo: null,
  helsingfors: null,
  tallinn: null,
}

// ---- Sentinels ----
// Locations that mean "the user is open to anything" and should not
// restrict the region filter.
const REMOTE_FRIENDLY_PATTERNS = [
  'distansarbete',
  'distans',
  'remote',
  'hemifrån',
  'var som helst',
  'hela sverige',
  'sverige',
  'anywhere',
]

/**
 * Is this location string a sentinel meaning "no location constraint"?
 * Used to short-circuit region filtering so a "Distansarbete" entry in
 * the profile doesn't constrain the search to a single Län.
 *
 * Now diacritic-strip aware — a user typing "Hela Sverige" or "hela
 * sverige" / "Distans Arbete" all hit. Lowercase + trimmed compare.
 */
export function isRemoteFriendlyText(value) {
  const norm = stripDiacritics(String(value || '').trim())
  if (!norm) return false
  return REMOTE_FRIENDLY_PATTERNS.includes(norm)
}

/**
 * Convert a single location string → AF Län code, or null if unknown.
 * Resolution order:
 *   1. Exact match in LÄN_BY_CITY.            → "Göteborg" → "14"
 *   2. Normalised alias lookup.                → "gbg", "goteborg" → "14"
 *   3. Diacritic-stripped canonical match.    → "Goteborg" → "14"
 *   4. Diacritic-stripped substring match.     → "göt" → "14"
 * Returns null when nothing matches so callers can fall through to
 * the AF text-search pass.
 */
export function locationToLänCode(value) {
  const t = String(value || '').trim()
  if (!t) return null
  // 1. Exact match first (case-sensitive, accents matter — keeps the
  // curated surface form for fresh-onboarding power users).
  if (LÄN_BY_CITY[t]) return LÄN_BY_CITY[t]
  const norm = stripDiacritics(t)
  // 2. Pre-normalised alias lookup. An explicit null value means
  // "explicitly no match — don't fall through to substring".
  if (norm && Object.prototype.hasOwnProperty.call(CITY_ALIASES, norm)) {
    const canonical = CITY_ALIASES[norm]
    if (canonical === null) return null
    if (LÄN_BY_CITY[canonical]) return LÄN_BY_CITY[canonical]
  }
  // 3. Diacritic-stripped canonical-name match.
  if (norm) {
    for (const [city, code] of Object.entries(LÄN_BY_CITY)) {
      if (stripDiacritics(city) === norm) return code
    }
  }
  // 4. Substring fall-back (only first hit wins).
  if (norm) {
    for (const [city, code] of Object.entries(LÄN_BY_CITY)) {
      const cityNorm = stripDiacritics(city)
      if (cityNorm.startsWith(norm) || norm.startsWith(cityNorm)) return code
    }
  }
  return null
}

/**
 * Convert an array of user-supplied locations to a list of unique AF
 * Län codes. Filters out remote-friendly entries (they widen rather
 * than narrow the search). De-duplicates so a duplicate city entry
 * in the profile doesn't double-include the region code.
 */
export function locationsToLänCodes(locations) {
  if (!Array.isArray(locations)) return []
  const seen = new Set()
  const codes = []
  for (const loc of locations) {
    if (isRemoteFriendlyText(loc)) continue
    const code = locationToLänCode(loc)
    if (code && !seen.has(code)) {
      seen.add(code)
      codes.push(code)
    }
  }
  return codes
}

/**
 * Does the job's location string match one of the user's preferred
 * locations? Used to tag each card with a "matchar din ort" badge so
 * the user can see at a glance which jobs landed because of the
 * location filter vs which one just happened to mention the city in
 * the headline.
 *
 * Matches on both the original (diacritic-bearing) and the
 * diacritic-stripped forms of each user location so AF hits that
 * return "Vastra Gotalands lan" / "Skane" still light up the badge
 * even when the user typed "Göteborg" / "Malmö".
 */
export function doesJobMatchUserLocation(job, userLocations) {
  if (!job || !Array.isArray(userLocations) || userLocations.length === 0) {
    return false
  }
  const jobLocRaw = String(job.location || '')
  if (!jobLocRaw) return false
  const jobLoc = jobLocRaw.toLowerCase()
  const jobLocNorm = stripDiacritics(jobLocRaw)
  for (const loc of userLocations) {
    const t = String(loc || '').trim()
    if (!t) continue
    const tLower = t.toLowerCase()
    const tNorm = stripDiacritics(t)
    // Match the user input verbatim (case-insensitive).
    if (jobLoc.includes(tLower)) return true
    // Match the diacritic-stripped variant — catches "Västra Götalands
    // län" vs "Goteborg" mismatches in AF `workplace_address.region`.
    if (tNorm && jobLocNorm.includes(tNorm)) return true
    // Match the parent Län name in either form.
    const code = locationToLänCode(loc)
    if (code) {
      const länLower = länNameFromCode(code)
      if (länLower) {
        if (jobLoc.includes(länLower)) return true
        const länNorm = stripDiacritics(länLower)
        if (länNorm && jobLocNorm.includes(länNorm)) return true
      }
    }
  }
  return false
}

// Display labels for the Län codes — used by doesJobMatchUserLocation
// to broaden the match. Keep the table short: only the names that
// actually show up in AF `workplace_address.region`.
const LÄN_NAMES = {
  '01': 'stockholm',
  '03': 'uppsala',
  '04': 'södermanland',
  '05': 'östergötland',
  '06': 'jönköping',
  '07': 'kronoberg',
  '08': 'kalmar',
  '09': 'gotland',
  '10': 'blekinge',
  '12': 'skåne',
  '13': 'halland',
  '14': 'västra götaland',
  '17': 'värmland',
  '18': 'orebro',
  '19': 'västmanland',
  '20': 'dalarna',
  '21': 'gävleborg',
  '22': 'västernorrland',
  '23': 'jämtland',
  '24': 'västerbotten',
  '25': 'norrbotten',
}

export function länNameFromCode(code) {
  return LÄN_NAMES[code] || ''
}
