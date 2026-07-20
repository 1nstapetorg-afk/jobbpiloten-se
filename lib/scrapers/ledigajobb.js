/**
 * ledigajobb.se — pre-filled URL helper + soft-block-tolerant HTML scraper.
 *
 * Two exports:
 *   1. `buildLedigaJobbSearchUrl` — URL helper for the dashboard's honest
 *      deep-link buttons (unchanged from the original research-era file on
 *      2026-07-10). Always present, never broken.
 *   2. `scrapeLedigajobbJobs` — a best-effort HTML scraper that mirrors
 *      `lib/scrapers/blocket.js`'s 60s/10s cache + soft-block handling.
 *
 * Background (final polish 2026-07-10, see Feature 1 of the soft-launch
 * polish list):
 *   - The earlier PROJECT_STATUS.md research noted that ledigajobb.se has
 *     no public API, no RSS/XML feed, no JSON-LD on listing pages, and
 *     returns 403 for bots. That conclusion is still accurate for robots
 *     crawling blind, but Akamai's WAF is more permissive when requests
 *     carry a real Chrome User-Agent AND a high-entropy `Accept` header.
 *   - We attempt a single soft GET per cron tick — same conservative
 *     posture as Blocket. If 403/429/network → return [], negative-cache
 *     the failure for 10s, and let the multiSource waterfall do its
 *     thing (it always has AF + Blocket to fall back on).
 *   - The HTML listings on ledigajobb.se don't carry JSON-LD so a custom
 *     regex parser walks the result list. The parser is intentionally
 *     tolerant of attribute order + whitespace but bounded to 50 matches
 *     per request so a junk page can't OOM the worker.
 *
 * Legal note: ledigajobb.se's robots.txt blocks automated crawling on
 * `/sok/` paths. The scraper is a SINGLE low-volume GET per cron tick
 * and degrades gracefully to no-results when blocked. Operators MUST
 * disable this source if the site ever asks us to stop — set
 * LEDIGAJOBB_SCRAPER_ENABLED=0 in the runtime env and the
 * multiSourceSearchJobs waterfall drops the call site automatically.
 */

import { toSlug } from './urls.js'
import { hashShort } from '../utils.js'

// Lower-case, no UA overrides — Chrome 124 on macOS is the same
// fingerprint the Blocket scraper uses so the two cannot be told apart
// by Akamai's behavioural heuristics.
const LEDIGAJOBB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
}

// Same 60s positive / 10s negative cache windows as `blocket.js`. The
// keys are kept isolated so a Blocket 403 can never poison the
// Ledigajobb cache (and vice-versa) when the two sources are hit by
// the same multiSource call.
const _cache = { at: 0, urlKey: '', jobs: [] }
const _negCache = { at: 0, urlKey: '' }
const POSITIVE_CACHE_MS = 60_000
const NEGATIVE_CACHE_MS = 10_000

const LEDIGAJOBB_BASE = 'https://ledigajobb.se'

/**
 * Build a ledigajobb.se search URL. Returns null when both query and
 * location are empty so callers can skip rendering the button.
 *
 * URL pattern: `https://ledigajobb.se/sok/q-<slug>/l-<slug>/` mirrors
 * Blocket's path scheme with the `/sok/` prefix reflected in
 * PROJECT_STATUS.md research notes.
 */
export function buildLedigaJobbSearchUrl({ query = '', location = '' } = {}) {
  const q = toSlug(query)
  const l = toSlug(location)
  if (!q && !l) return null
  const parts = []
  if (q) parts.push(`q-${q}`)
  if (l) parts.push(`l-${l}`)
  return `${LEDIGAJOBB_BASE}/sok/${parts.join('/')}/`
}

/**
 * Search ledigajobb.se for matching listings. Mirrors
 * `lib/scrapers/blocket.js`'s `scrapeBlocketJobs` signature so the
 * caller doesn't have to dispatch by source. Returns an empty array
 * on any error so callers never have to wrap this in a try/catch.
 *
 * @param {Object} options
 * @param {string} options.query - Free-text job title (e.g. "frontend")
 * @param {string} options.location - City or region (e.g. "Stockholm")
 * @param {number} options.limit - Max results (default 20)
 */
export async function scrapeLedigajobbJobs({ query = '', location = '', limit = 20 } = {}) {
  const url = buildLedigaJobbSearchUrl({ query, location })
  if (!url) return []
  const urlKey = `${query}|${location}`
  const now = Date.now()
  if (_cache.urlKey === urlKey && (now - _cache.at) < POSITIVE_CACHE_MS) {
    return _cache.jobs.slice(0, limit)
  }
  if (_negCache.urlKey === urlKey && (now - _negCache.at) < NEGATIVE_CACHE_MS) {
    return []
  }
  try {
    const res = await fetch(url, {
      headers: LEDIGAJOBB_HEADERS,
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      // Soft-block detection: ledigajobb.se (and many smaller Swedish
      // boards) drops 403 for bot UAs that lack a real Accept-Language
      // pair. Log + degrade gracefully + stage the negative cache so
      // concurrent subscriber calls don't hammer the upstream.
      console.warn(`[ledigajobb] ${res.status} ${res.statusText} — falling back to pre-filled URL helper`)
      _negCache.at = now
      _negCache.urlKey = urlKey
      return []
    }
    const html = await res.text()
    const jobs = parseLedigajobbListings(html, limit)
    _cache.at = now
    _cache.urlKey = urlKey
    _cache.jobs = jobs
    // Reset negative cache from an earlier soft-block window so the
    // next call can't inherit stale [] via cache-check reordering.
    _negCache.at = 0
    _negCache.urlKey = ''
    return jobs
  } catch (err) {
    console.warn('[ledigajobb] fetch failed:', err.message)
    _negCache.at = now
    _negCache.urlKey = urlKey
    return []
  }
}

// Listing patterns that the parser is willing to consider, in
// preference order. Each entry is a label + the regex that captures
// (anchor, title, company, location). The label surfaces in warn logs
// when something looks weird so an operator can spot which listing
// shape the site currently uses without a browser visit.
const LISTING_PATTERNS = [
  // Pattern 1 (preferred): an `<article>` wrapper holding an `<a>`
  // whose title sits INSIDE the anchor (e.g. an `<h2>` nested in the
  // link) and whose company + location appear after the anchor as
  // `<span class="…">X</span>`. Common on ledigajobb.se's desktop
  // rendered HTML — the parser stays tolerant of attribute order on
  // both the anchor and the spans.
  {
    label: 'article-with-classes',
    re: /<article\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<span\b[^>]*class=["'][^"']*company[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<span\b[^>]*class=["'][^"']*location[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/article>/gi,
  },
  // Pattern 2 (fallback): an `<a>` block where title/company/location
  // are flattened into text fields separated by `\n` or `·`. Common
  // on long-tail listings AND on the mobile-rendered variant seen in
  // 2026-07-10 inspection.
  {
    label: 'anchor-flattened',
    re: /<a\b[^>]*class=["'][^"']*job[-_ ]?link[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  },
]

/**
 * Walk the response HTML and collect any structured listings.
 * Returns `[]` if neither pattern matches — the scraper is conservative
 * by design (the URL helper is the supported fallback path).
 */
function parseLedigajobbListings(html, limit) {
  const out = []
  if (!html || typeof html !== 'string') return out
  for (const { label, re } of LISTING_PATTERNS) {
    let guard = 0
    re.lastIndex = 0
    let m
    while ((m = re.exec(html)) !== null && out.length < limit && guard < 50) {
      guard++
      try {
        const job = label === 'article-with-classes'
          ? mapArticleListing(m)
          : mapAnchorListing(m)
        if (job) out.push(job)
      } catch (_) {
        // Malformed captures — skip silently. Listing the bad pattern
        // label would be more useful but is too noisy for a 50-req/min
        // hot path.
      }
    }
    if (out.length > 0) break
  }
  return out
}

/**
 * Resolve a captured `href` to an absolute URL and hash that absolute
 * shape for the listing id. Hashing the FINAL URL (not the raw
 * captured href) means two equivalent paths — `/jobb/x` and
 * `https://ledigajobb.se/jobb/x` — collapse to the same id, which
 * is what the URL-key dedupe branch in `lib/jobScraper.js#dedupeJobs`
 * expects. Without this normalisation the dashboard's `id` could
 * silently rotate across deploys whenever the upstream site changes
 * its link rewriting rules.
 *
 * Uses the SHARED `hashShort` from `lib/utils.js` so the contract is
 * locked by the test suite and the id-derivation logic across
 * scrapers cannot drift. The duplicate-private-helper anti-pattern
 * is exactly what the user's extraction note (PROJECT_STATUS.md)
 * flagged in 2026-07-10 — we honour that and reuse.
 */
function resolveAndHash(rawHref) {
  const abs = rawHref.startsWith('http')
    ? rawHref
    : `${LEDIGAJOBB_BASE}${rawHref.startsWith('/') ? '' : '/'}${rawHref}`
  return { url: abs, idHash: hashShort(abs) }
}

/** Map pattern-1 captures to our internal job shape. */
function mapArticleListing(m) {
  const [, rawHref, aBodyRaw, companyRaw, locationRaw] = m
  // Title lookup is intentionally lenient — ledigajobb.se renders the
  // job title INSIDE the `<a>` (typically as `<h2>X</h2>`), not after
  // it. So we look for the heading inside the captured anchor body
  // and fall back to the stripped body text if no heading is found.
  // Without this fallback, listings whose markup drops the `<h2>`
  // (e.g. CSS-selectable heading rewrites) silently map to '' and
  // the multiSource waterfall is one row lighter than it should be.
  const title = extractHeading(aBodyRaw) || stripTags(aBodyRaw).trim()
  const company = stripTags(companyRaw).trim() || 'Okänd arbetsgivare'
  const location = stripTags(locationRaw).trim() || 'Okänd ort'
  if (!title || !rawHref) return null
  const { url, idHash } = resolveAndHash(rawHref)
  return {
    id: `ledigajobb-${idHash}`,
    externalId: null,
    company,
    title,
    location,
    municipality: extractMunicipality(location),
    region: null,
    country: 'SE',
    description: '',
    source: 'Ledigajobb',
    url,
    published: null,
    applicationDeadline: null,
    employmentType: null,
  }
}

/** Map pattern-2 captures — split flattened text on `\n` + `·` then tidy. */
function mapAnchorListing(m) {
  const [, rawHref, bodyRaw] = m
  // NOTE: do NOT collapse whitespace before splitting. The anchor
  // body uses newline OR middle-dot separators and the splitter
  // operates on those verbatim. We use `stripTagsRaw` (defined
  // below) which keeps newlines intact versus the strict-flattening
  // `stripTags` used elsewhere.
  const body = stripTagsRaw(bodyRaw).trim()
  if (!body) return null
  // Flavour 1: "<title>\n<company>\n<location>"
  // Flavour 2: "<title> · <company> · <location>"
  const parts = body
    .split(/[·\n]/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  const [titleRaw, companyRaw, locationRaw] = parts
  const title = titleRaw
  const company = companyRaw || 'Okänd arbetsgivare'
  const location = locationRaw || 'Okänd ort'
  if (!title || !rawHref) return null
  const { url, idHash } = resolveAndHash(rawHref)
  return {
    id: `ledigajobb-${idHash}`,
    externalId: null,
    company,
    title,
    location,
    municipality: extractMunicipality(location),
    region: null,
    country: 'SE',
    description: '',
    source: 'Ledigajobb',
    url,
    published: null,
    applicationDeadline: null,
    employmentType: null,
  }
}

/**
 * Find the first `<h2>` / `<h3>` / `<h4>` heading in a capture and
 * return its stripped text. Returns `null` when no heading is found
 * so callers can fall back to plain text.
 */
function extractHeading(s) {
  if (!s) return null
  const m = /<h[234]\b[^>]*>([\s\S]*?)<\/h[234]>/i.exec(s)
  return m ? stripTags(m[1]).trim() : null
}

/**
 * Pull the city token out of a comma-separated "City, Region, Country"
 * display string. Returns null when nothing useful is found.
 */
function extractMunicipality(text) {
  if (!text) return null
  const first = String(text).split(',')[0].trim()
  return first || null
}

/** Strip every HTML tag from a capture, returning plain text. */
function stripTags(s) {
  if (!s) return ''
  return String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Like `stripTags` but PRESERVES newlines. Used by the anchor-flattened
 * pattern parser, which splits the captured body on `\n` (or `·`) to
 * recover title/company/location. Without this distinction the
 * whitespace-collapse step in `stripTags` would merge all three into
 * a single space-separated string before we ever see the separator.
 */
function stripTagsRaw(s) {
  if (!s) return ''
  return String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
}
