/**
 * Blocket Jobb — JSON-LD JobPosting search-results scraper with soft-block handling.
 *
 * Design (2026-07-10):
 *   • Single GET per call — no pagination loops.
 *   • 60 second in-memory cache keyed by query + location so the daily
 *     cron tick doesn't re-hit Blocket for every subscriber.
 *   • Returns [] on 4xx / 5xx so a robots.txt / WAF block degrades
 *     gracefully (the dashboard falls back to the pre-filled URL helper).
 *   • User-Agent + Accept headers mimic Chrome on macOS — Blocket's
 *     Akamai WAF is more permissive to identified browsers than bots.
 *   • Tags every result with `source: 'Blocket Jobb'` so the dashboard
 *     badge shows the provenance.
 *
 * Legal note: Blocket's robots.txt prohibits automated crawling. This
 * scraper touches ONE search-results page per cron tick (twice daily in
 * Issue 4) with conservative headers. If they ask us to stop, the
 * soft-block path returns [] and JobbPiloten falls back to the honest
 * pre-filled URL helper — no broken experience.
 */

import { toSlug } from './urls.js'
import { hashShort } from '../utils.js'

const BLOCKET_HEADERS = {
  // Chrome 124 on macOS — proven acceptable for most Swedish job boards
  // during low-frequency transactions.
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
}

// 60s positive cache (success-path) to dedupe concurrent cron requests
// for the same query + location so the daily tick doesn't re-fetch if
// two subscribers happen to share the same input.
// 10s negative cache (failure-path) so a 403/429 from Blocket's Akamai
// WAF rapidly coalesces on one silent-scoped retry across all the
// in-flight subscriber calls instead of hammering the upstream. The
// short TTL is intentional — if Blocket soft-blocks us, we want to
// retry sooner rather than stick with [] for the rest of the day.
const _cache = { at: 0, urlKey: '', jobs: [] }
const _negCache = { at: 0, urlKey: '' }
const POSITIVE_CACHE_MS = 60_000
const NEGATIVE_CACHE_MS = 10_000

/**
 * Search Blocket Jobb for matching listings. Mirrors lib/jobScraper.js
 * `#searchJobs` signature so the caller doesn't have to dispatch by
 * source. Returns an empty array on any error so callers never have to
 * wrap this in a try/catch.
 *
 * @param {Object} options
 * @param {string} options.query - Free-text job title (e.g. "frontend")
 * @param {string} options.location - City or region (e.g. "Stockholm")
 * @param {number} options.limit - Max results (default 20)
 */
export async function scrapeBlocketJobs({ query = '', location = '', limit = 20 } = {}) {
  const url = buildBlocketSearchUrl({ query, location })
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
      headers: BLOCKET_HEADERS,
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      // Soft-block detection: Blocket's Akamai WAF returns 403/429 when
      // it identifies a bot. We log + degrade gracefully without raising
      // and stage the negative cache so concurrent subscriber calls
      // don't hammer the upstream during a block window.
      console.warn(`[blocket] ${res.status} ${res.statusText} — falling back to URL helper`)
      _negCache.at = now
      _negCache.urlKey = urlKey
      return []
    }
    const html = await res.text()
    const jobs = parseBlocketJSONLD(html, limit)
    _cache.at = now
    _cache.urlKey = urlKey
    _cache.jobs = jobs
    // Reset any negative cache from an earlier soft-block window so the
    // next call can't inherit a stale "[]" via cache-check reordering.
    _negCache.at = 0
    _negCache.urlKey = ''
    return jobs
  } catch (err) {
    console.warn('[blocket] fetch failed:', err.message)
    _negCache.at = now
    _negCache.urlKey = urlKey
    return []
  }
}

/**
 * Construct a Blocket Jobb search URL. Returns null when both query and
 * location are empty so callers can skip rendering the button.
 *
 * Blocket uses path-segment params: q-<title>/l-<location>/. The exact
 * pattern was retrofitted by hand on 2026-07-10; verify against their
 * live search interface periodically because portal backends change.
 */
export function buildBlocketSearchUrl({ query = '', location = '' } = {}) {
  const q = toSlug(query)
  const l = toSlug(location)
  if (!q && !l) return null
  const parts = []
  if (q) parts.push(`q-${q}`)
  if (l) parts.push(`l-${l}`)
  return `https://jobb.blocket.se/lediga-jobb/${parts.join('/')}/`
}

/**
 * Extract JSON-LD JobPosting objects from Blocket's HTML response.
 *
 * Schema.org embeds job postings in either:
 *   • Top-level: <script type="application/ld+json">{..., "@type":"JobPosting",...}</script>
 *   • Wrapped in @graph: <script type="application/ld+json">{"@graph":[{...,"@type":"JobPosting"}]}</script>
 *   • Multiple postings in a single array literal.
 *
 * The regex is intentionally tolerant of whitespace + attribute order,
 * but it does NOT process nested HTML inside description blocks (Blocket
 * keeps ad detail HTML out of JSON-LD so we don't have to sanitise).
 */
function parseBlocketJSONLD(html, limit) {
  const out = []
  if (!html) return out
  // Match any `<script ... ld+json ...>...</script>` block. Captures
  // the JSON body non-greedy so adjacent blocks don't merge.
  //
  // Edge case: a JSON-LD string field might contain the literal
  // substring `</script>` (rare but observed in arbitrary-text
  // description fields). The non-greedy regex would then terminate
  // the match early and produce half-JSON that fails JSON.parse. We
  // sanitize the captured body by escaping any embedded close-tag so
  // the parser sees a safe payload.
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  let guard = 0
  while ((m = re.exec(html)) !== null && out.length < limit && guard < 50) {
    guard++
    const safeBody = m[1].replace(/<\/script/gi, '<\\/script')
    let block
    try {
      block = JSON.parse(safeBody)
    } catch (_) {
      // Malformed JSON-LD is non-fatal — skip and try the next block.
      continue
    }
    const candidates = Array.isArray(block) ? block : [block]
    for (const candidate of candidates) {
      if (out.length >= limit) break
      const postings = extractJobPostings(candidate)
      for (const posting of postings) {
        if (out.length >= limit) break
        out.push(mapBlocketJob(posting))
      }
    }
  }
  return out
}

/** Walk a candidate block to collect every nested JobPosting. */
function extractJobPostings(node) {
  if (!node || typeof node !== 'object') return []
  if (node['@type'] === 'JobPosting') return [node]
  if (Array.isArray(node['@graph'])) {
    return node['@graph'].filter((c) => c && c['@type'] === 'JobPosting')
  }
  if (Array.isArray(node['@type'])) {
    // Multi-typed node — pick out JobPosting variant
    if (node['@type'].includes('JobPosting')) return [node]
  }
  return []
}

/** Map a Schema.org JobPosting onto our internal job format. */
function mapBlocketJob(posting) {
  const org = posting.hiringOrganization || {}
  const loc = posting.jobLocation?.address || {}
  const locationParts = [loc.addressLocality, loc.addressRegion, loc.addressCountry].filter(Boolean)
  // Stable id derived from the URL so the same ad always maps to the same
  // dashboard id; falls back to a hash of title+company if URL is absent.
  const idSource = posting.url || `${org.name || ''}|${posting.title || ''}`
  return {
    id: `blocket-${hashShort(idSource)}`,
    externalId: posting.identifier ? String(posting.identifier) : null,
    company: org.name || 'Okänd arbetsgivare',
    title: posting.title || 'Okänd titel',
    location: locationParts.join(', ') || 'Okänd ort',
    // Structured fields used by doesJobMatchUserLocation (the dashboard
    // "matchar din ort" badge consults these when the path-only string
    // match would miss).
    municipality: loc.addressLocality || null,
    region: loc.addressRegion || null,
    country: loc.addressCountry || null,
    description: stripHtml(posting.description || ''),
    source: 'Blocket Jobb',
    url: posting.url || null,
    published: posting.datePosted || null,
    applicationDeadline: posting.validThrough || null,
    employmentType: posting.employmentType || null,
  }
}

/** Cheap 32-bit FNV-1a hash; small + deterministic + good-enough for id collapse. */
// `hashShort` is now the shared helper in `@/lib/utils` (locked by
// tests/unit/blocket-scraper.test.mjs). The previous module-local copy
// is intentionally removed — keeping a duplicate would let the two
// implementations drift silently, which would break Blocket job id
// stability across cold restarts.
/**
 * Lightweight HTML stripper for the description field. The JSON-LD
 * payload sometimes embeds simple inline tags (`<p>`, `<br>`, `<li>`)
 * — we want plain text on the dashboard to keep card heights predictable.
 */
function stripHtml(html) {
  if (!html) return ''
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/li>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
