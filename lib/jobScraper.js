/**
 * Arbetsförmedlingen Job Search API client (MVP) + multi-source waterfall.
 *
 * Primary source uses the public JobTechDev search API:
 *   https://jobsearch.api.jobtechdev.se/search
 *
 * No API key required — this is open data.
 *
 * Issue 4 (2026-07-10): added a multi-source waterfall that
 *   1. queries AF (primary, structured, region-filterable),
 *   2. queries Blocket Jobb (JSON-LD JobPosting scrape, soft-block
 *      tolerant — see lib/scrapers/blocket.js),
 *   3. dedupes by URL then by (title + company + location).
 * Each leg still returns our internal job shape (the same object the
 * dashboard already renders), so the cards just light up with a richer
 * `source` badge.
 *
 * Blocket, Jobbsafari and ledigajobb.se also serve as honest
 * pre-filled URL fallbacks (lib/scrapers/urlBuilders.js) for the
 * "Letar du bredare?" card.
 */

import { scrapeBlocketJobs } from './scrapers/blocket.js'
import { scrapeLedigajobbJobs } from './scrapers/ledigajobb.js'
import {
  buildBlocketSearchUrl,
  buildLedigaJobbSearchUrl,
  buildJobSafariSearchUrl,
  toSlug,
} from './scrapers/urlBuilders.js'
import { truncate } from './utils.js'

// Re-export the public URL/slug helpers so existing imports of the form
// `import { buildBlocketSearchUrl, buildJobSafariSearchUrl } from
// '@/lib/jobScraper'` continue to work without editing the dashboard.
export {
  buildBlocketSearchUrl,
  buildJobSafariSearchUrl,
  buildLedigaJobbSearchUrl,
  toSlug,
}

const AF_API_BASE = 'https://jobsearch.api.jobtechdev.se/search'

// ---- Round-20: getJobById LRU cache ----
// Module-level TTL+size-bounded cache for `getJobById` so a flood of
// distinct bogus ?jobId= deep-links (e.g. a malicious user hammering
// /dashboard?jobId=X with random ids) can't cripple the upstream AF
// API. The cache is intentional-only (we never read it back as
// unless `getJobById` populates it first).
//
// Trade-offs (settled after a think-through):
//   • TTL = 30s. Long enough that a user double-clicking the same
//     push notification coalesces into one fetch; short enough that
//     stale announcements self-refresh quickly.
//   • Size cap = 256 entries. Robust against the "many distinct ids
//     over a short window" pattern (256 entries × ~1 KB each ≈ 256
//     KB worst case). Eviction is FIFO by Map insertion order — the
//     first-inserted, still-alive entry drops first. We do NOT
//     re-rank by recency: the goal is bounded memory, not least-
//     recently-used precision.
//   • Single-flight: a concurrent call for the same jobId awaits the
//     same in-flight Promise rather than launching a second fetch.
//     Coalesces e.g. a user double-clicking the prep modal.
//   • Null results ARE cached. Both a 404-equivalent AF response and
//     a caught network error map to null at the inner fetcher, so
//     the cache stores null for 30s. The trade-off is documented:
//     a 30s window of "job not found" is acceptable for transient
//     failures because the route + dashboard already distinguish
//     not-found from "no profile match" via the error sentinel.
//
// The cache and in-flight tracking are intentionally not exported —
// the SEED pattern in tests/unit/get-job-by-id-cache.test.mjs keeps
// each test isolated by jobId uniqueness instead of needing a
// _resetCache() helper.
const JOB_CACHE_TTL_MS = 30_000
const JOB_CACHE_MAX = 256
const _jobByIdCache = new Map()        // jobId -> { result: Job|null, ts: number }
const _jobByIdInFlight = new Map()    // jobId -> Promise<Job|null>

/**
 * Search for jobs via Arbetsförmedlingen's open API.
 *
 * @param {Object} options
 * @param {string} options.query  - Free-text search (e.g. "frontend", "sjuksköterska")
 * @param {string} options.location - Free-text municipality or region (e.g. "Stockholm", "Göteborg")
 * @param {string|string[]} options.region - Numeric AF Län code(s) (e.g. "14" or ["01","14","12"]) — more reliable than free-text location
 * @param {number} options.limit  - Max results (default 20, max 100)
 * @returns {Promise<Array>} Array of job objects in internal format
 *
 * Region parameter is the most reliable filter because the AF API
 * exposes two-digit Län codes (01-25) that always match — the
 * free-text `l=` parameter is fuzzy and breaks on accents / abrasions.
 * Multiple codes can be passed comma-separated (which the AF API
 * accepts natively) so a user with two preferred cities gets the
 * union of both regions in a single round-trip.
 */
export async function searchJobs({ query = '', location = '', region = '', limit = 20, offset = 0 } = {}) {
  try {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (region) {
      const regionParam = Array.isArray(region) ? region.filter(Boolean).join(',') : String(region);
      if (regionParam) params.set('region', regionParam);
    }
    if (location) params.set('l', location);
    params.set('limit', String(Math.min(limit, 100)));
    if (offset > 0) params.set('offset', String(offset));

    const url = `${AF_API_BASE}?${params.toString()}`;
    console.log('[jobScraper] fetching', url);

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000), // 8s timeout
    });

    if (!res.ok) {
      console.error('[jobScraper] AF API error:', res.status, res.statusText);
      return [];
    }

    const data = await res.json();
    const hits = data.hits || [];

    return hits.map(mapAFJob).filter(Boolean);
  } catch (err) {
    console.error('[jobScraper] fetch error:', err.message);
    return [];
  }
}

/**
 * Multi-source waterfall — combines AF + Blocket Jobb, dedupes, and
 * returns a single ranked list. Used by /api/jobs-available and
 * /api/cron so both surfaces show the larger combined pool.
 *
 * Dedup key order:
 *   1. URL (exact, case-insensitive trimmed) — strongest signal that
 *      two sources are listing the same ad.
 *   2. `company|title|location` — catches the case where Blocket and
 *      AF both index the same posting but Blocket's URL is just the
 *      category landing page (rare but observed in practice).
 *
 * Returns jobs in the SAME internal format as `searchJobs` so callers
 * downstream of this (the dashboard jobs-available handler, the cron
 * path) need no further mapping.
 *
 * Bounded fall-back: if AF throws a network error, we still return
 * Blocket jobs (and vice-versa) rather than an empty array — a
 * partial result is more useful than none.
 */
export async function multiSourceSearchJobs({ query = '', location = '', region = '', limit = 20, offset = 0, employmentTypes = null } = {}) {
  const tasks = []
  // AF primary — region-aware when caller passed codes.
  tasks.push(
    searchJobs({ query, location, region, limit }).catch((e) => {
      console.warn('[multiSource] AF scraper failed:', e?.message)
      return []
    }),
  )
  // Blocket Jobb secondary — soft-block-tolerant (gracefully degrades
  // to [] on a 403/429 so callers see no behavioural disruption).
  tasks.push(
    scrapeBlocketJobs({ query, location, limit }).catch((e) => {
      console.warn('[multiSource] Blocket scraper failed:', e?.message)
      return []
    }),
  )
  // Ledigajobb.se tertiary — ALSO soft-block-tolerant. Source was
  // added 2026-07-10 as the third waterfall leg after Blocket's own
  // Akamai WAF issues were observed; the architecture mirrors Blocket
  // (see lib/scrapers/ledigajobb.js) so a 403 falls back to [] AND
  // short-circuits to Blocket-only results inside dedupe + the
  // user-visible dashboard. Operators can disable the source per-env
  // by exporting LEDIGAJOBB_SCRAPER_ENABLED=false in the runtime —
  // the route then drops the leg entirely.
  if (process.env.LEDIGAJOBB_SCRAPER_ENABLED !== 'false') {
    tasks.push(
      scrapeLedigajobbJobs({ query, location, limit }).catch((e) => {
        console.warn('[multiSource] Ledigajobb scraper failed:', e?.message)
        return []
      }),
    )
  }
  const [afJobs, blocketJobs, ledigajobbJobs] = await Promise.all(tasks)
  const ledigajobbJobsSafe = ledigajobbJobs || []
  const deduped = dedupeJobs([...afJobs, ...blocketJobs, ...ledigajobbJobsSafe])
  // Apply the multi-select employment-type filter AFTER dedupe so
  // duplicate AF/Blocket entries that the user has explicitly
  // opted into aren't both kept just because the dedupe key
  // matched. `filterByEmploymentType` is a no-op when
  // `employmentTypes` is empty/null, so the legacy callers
  // (without the new arg) keep their current behaviour.
  const combined = filterByEmploymentType(deduped, employmentTypes)
  // Apply offset AFTER filter so paging is stable across
  // filter-state changes (a page-2 fetch is the same `slice`
  // whether the user just toggled a checkbox or not). Limit is
  // applied last so the final array length is the page-size the
  // caller asked for.
  const windowed = combined.slice(offset, offset + limit)
  // `hasMore` is computed against the un-windowed combined list so
  // the dashboard knows whether to render the "Visa fler jobb"
  // button even if the current page returned exactly `limit` jobs
  // (which would otherwise look identical to "this was the last
  // page"). Capped at offset+limit because `combined` may itself
  // be smaller than the upstream scrapers' `limit` if dedupe
  // collapsed entries.
  //
  // The `upstreamCapped` heuristic covers the case where any single
  // source returned exactly `limit` hits (the per-source cap). In
  // that case we can't infer "no more pages" from `combined.length`
  // alone — dedupe may have collapsed entries so the user sees
  // exactly `limit` results, but the next page could still yield
  // fresh ads. Hiding the button there would lose the user's place;
  // showing it for one extra round-trip is cheap (one AF round-trip)
  // and corrects itself on the next click.
  const upstreamCapped =
    afJobs.length >= limit ||
    blocketJobs.length >= limit ||
    ledigajobbJobsSafe.length >= limit
  const hasMore = upstreamCapped || combined.length > offset + limit
  const result = windowed

  // ---- Lightweight AF/Blocket hit-rate metric ----
  // Operator-visible source health log: ONE structured JSON line per
  // call so Vercel logs can be grepped for `evt=multiSource.metric` to
  // detect regressions (e.g. both sources 0 over a 24h window) without
  // parsing free-form warnings.
  //
  // Field semantics (so downstream log readers don't have to guess):
  //   af, blk     — per-source RAW hit counts (pre-dedupe)
  //   in          — in = af + blk (pre-dedupe total)
  //   dedup       — POST-dedupe, PRE-limit
  //                 (duplicates_removed = in − dedup)
  //   capped      — POST-limit (final count returned to caller)
  //                 (truncation = dedup − capped when capped < dedup)
  //   q, l        — TRUNCATED query + location (40-char cap) so the
  //                 user's actual strings show up in Vercel logs and
  //                 operators can grep by them. See privacy note below.
  //
  // Privacy note: we INLINE truncated query + location rather than
  // hashing. A 32-bit FNV-1a hash on a low-cardinality field like
  // Swedish municipality is brute-forceable in <1ms against a list
  // of ~290 kommun names — a hash that anyone with log access can
  // reverse isn't a privacy boundary, it's just friction. Honest
  // truncate is the safer posture; the 40-char cap matches what
  // Vercel's log search UI supports per token segment anyway.
  //
  // Schema versioning: `v: 1` so future field additions don't trip
  // log parsers that key on field count = 8.
  const metric = {
    evt: 'multiSource.metric',
    v: 1,
    af: afJobs.length,
    blk: blocketJobs.length,
    lj: ledigajobbJobsSafe.length,
    in: afJobs.length + blocketJobs.length + ledigajobbJobsSafe.length,
    dedup: combined.length,
    capped: result.length,
    offset,
    hasMore,
    q: truncate(query, 40),
    l: truncate(location, 40),
  }
  console.log(JSON.stringify(metric))

  if (afJobs.length === 0 && blocketJobs.length === 0) {
    // Ops visibility for a fully-empty scrape (both AF + Blocket
    // returned zero jobs for this query + location). The structured
    // metric line above already carries per-source counts + truncated
    // query/location for grep-able source-health monitoring, so this
    // human-readable warning is a plain tag that operators can alert
    // on without parsing JSON.
    console.warn('[multiSource] both sources returned empty')
    return { jobs: result, hasMore }
  }
  return { jobs: result, hasMore }
}

/**
 * Dedupe by URL first, then by (company|title|location). Preserves the
 * first occurrence so AF (preferred, region-aware) wins ties over
 * Blocket (broader, secondary).
 */
function dedupeJobs(jobs) {
  const seen = new Set()
  const out = []
  for (const job of jobs) {
    if (!job) continue
    const urlKey = canonicalUrl(job.url)
    if (urlKey) {
      if (seen.has(`u|${urlKey}`)) continue
      seen.add(`u|${urlKey}`)
    }
    const textKey = `t|${(job.company || '').toLowerCase()}|${(job.title || '').toLowerCase()}|${(job.location || '').toLowerCase()}`
    if (seen.has(textKey)) continue
    seen.add(textKey)
    out.push(job)
  }
  return out
}

function canonicalUrl(value) {
  if (!value) return ''
  const trimmed = String(value).trim()
  if (!trimmed) return ''
  // Lowercase + drop trailing slash so trivial variant paths collapse.
  return trimmed.replace(/\/+$/, '').toLowerCase()
}

/**
 * Normalize an Arbetsförmedlingen `employment_type` value (or any
 * other source's equivalent) into one of the canonical slugs the
 * /settings form exposes: `heltid`, `deltid`, `konsult`, `praktik`,
 * `tillsvidare`, `visstid`. AF's raw vocabulary is wider (e.g.
 * `behovsanställning`, `vikariat`, `projektanställning`,
 * `sommarjobb`) and a single ad may carry a hyphenated compound,
 * so we match by keyword rather than strict equality.
 *
 * Falls back to `'heltid'` when the source field is missing — AF
 * returns the implicit "regular full-time" shape for the vast
 * majority of ads that omit the field.
 *
 * Issue 2 (2026-07-10) — added so the multi-select
 * `employmentType` filter in the new waterfall can do an exact
 * match against one of the canonical slugs without leaking the AF
 * vocabulary into the rest of the codebase.
 */
export function normalizeEmploymentType(raw) {
  if (!raw) return 'heltid'
  const t = String(raw).toLowerCase().trim()
  if (!t) return 'heltid'
  if (t.includes('praktik')) return 'praktik'
  if (t.includes('sommarjobb')) return 'praktik' // summer gigs land with internship-class roles
  if (t.includes('behovsanst') || t.includes('vikariat') || t.includes('visstid') || t.includes('projektanst') || t.includes('trainee')) return 'visstid'
  if (t.includes('tillsvidare')) return 'tillsvidare'
  if (t.includes('deltid')) return 'deltid'
  if (t.includes('konsult')) return 'konsult'
  return 'heltid'
}

/**
 * Filter a flat list of jobs to those whose normalized employment
 * type is in `employmentTypes`. Returns the input unchanged when
 * the filter array is empty / null / undefined (the contract: an
 * empty array = "no filter applied", which mirrors how the
 * settings form treats "I haven't picked anything yet" — show me
 * everything).
 *
 * Operates on the result of `mapAFJob`/`scrapeBlocketJobs`/
 * `scrapeLedigajobbJobs` — i.e. each job has a normalized
 * `employmentType` slug, or `null` for sources that don't expose
 * the field. The fallback in `normalizeEmploymentType` makes
 * `null` count as `heltid` for the filter, so a user who selects
 * only `heltid` will still see the broad AF feed (correct: AF's
 * default is full-time, the user explicitly opted in to it).
 */
export function filterByEmploymentType(jobs, employmentTypes) {
  if (!Array.isArray(employmentTypes) || employmentTypes.length === 0) return jobs
  const set = new Set(employmentTypes)
  return jobs.filter((job) => set.has(normalizeEmploymentType(job?.employmentType)))
}


/**
 * Fetch a single job by its Arbetsförmedlingen ID.
 *
 * @param {string} jobId - The AF job ID (e.g. "12345678")
 * @returns {Promise<Object|null>} Job object or null
 */
/**
 * Fetch a single job by its Arbetsförmedlingen ID.
 *
 * @param {string} jobId - The AF job ID (e.g. "12345678")
 * @returns {Promise<Object|null>} Job object or null
 *
 * Round-20: wrapped in a module-level LRU cache + single-flight
 * coalescer. See the configuration block at the top of this file
 * for the trade-offs (TTL=30s, size=256, null-results cacheable).
 * Concurrent callers for the same jobId await the same in-flight
 * Promise; the second identical call within 30s short-circuits to
 * the cached result without hitting the network again.
 */
export async function getJobById(jobId) {
  // Concurrent callers (e.g. a user double-clicking a push deep-link,
  // or React StrictMode's deliberate double-invocation in dev) should
  // share the same in-flight Promise. Check in-flight BEFORE the
  // cache so a caller that arrived mid-fetch doesn't accidentally
  // // serve a half-written cache entry.
  const inFlight = _jobByIdInFlight.get(jobId)
  if (inFlight) return inFlight

  const now = Date.now()
  const cached = _jobByIdCache.get(jobId)
  if (cached && now - cached.ts < JOB_CACHE_TTL_MS) {
    // Cache hit within TTL — even null is cacheable so a repeated
    // 404-equivalent AF call coalesces into one network round-trip.
    return cached.result
  }

  // Cache miss / expired. Launch a new fetch, track it for single-
  // flight, and persist the result on completion. Errors thrown from
  // the inner fetcher are deliberately swallowed there (mapped to
  // null) — this wrapper stays awaitable so the return-type contract
  // (`Promise<Object|null>`) is preserved.
  const promise = _fetchJobByIdRaw(jobId)
  _jobByIdInFlight.set(jobId, promise)
  try {
    const result = await promise
    // Bounded insertion: when at the size cap, evict the oldest
    // INSERTED (Map preserves insertion order). We intentionally
    // check size BEFORE inserting so the new entry pushes an old one
    // out instead of growing past the cap.
    if (_jobByIdCache.size >= JOB_CACHE_MAX) {
      const oldestKey = _jobByIdCache.keys().next().value
      if (oldestKey != null && oldestKey !== jobId) {
        _jobByIdCache.delete(oldestKey)
      }
    }
    _jobByIdCache.set(jobId, { result, ts: Date.now() })
    return result
  } finally {
    // Always clear the in-flight tracker so the next caller starts a
    // fresh fetch (the cache above has the result if it was a hit).
    _jobByIdInFlight.delete(jobId)
  }
}

/**
 * Inner fetcher that does the actual AF round-trip. Catches ALL
 * errors (network, JSON parse) and maps them to null so the cache
 * wrapper's contract stays simple. Isolated from `getJobById` so the
 * caching logic is testable without mocking the network twice.
 */
async function _fetchJobByIdRaw(jobId) {
  try {
    const url = `${AF_API_BASE}/${jobId}`
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.error('[jobScraper] getJobById error:', res.status, res.statusText)
      return null
    }
    const data = await res.json()
    return mapAFJob(data)
  } catch (err) {
    console.error('[jobScraper] getJobById fetch error:', err.message)
    return null
  }
}

/**
 * Resolve the best job/ad URL from an AF API hit.
 *
 * The AF API has historically exposed the application link under several
 * different field names depending on ad source/version:
 *   - hit.webpage_url                       (modern search API, default)
 *   - hit.application_details.url           (rich ad payload)
 *   - hit.application_details.webAddress    (older / camelCase variant)
 *   - hit.application_links[0].url          (multi-link payload)
 *   - hit.external_url                      (outbound ad)
 *
 * `hit.employer.webAddress` is deliberately placed AFTER the constructed
 * Platsbanken landing page because it is the employer's corporate site, not
 * the job ad, and would mislead the user if the AF ad-link fields are empty.
 */
function resolveAFJobUrl(hit) {
  const employer = hit.employer || {};
  const applicationDetails = hit.application_details || {};
  const applicationLinks = Array.isArray(hit.application_links) ? hit.application_links : [];
  const fallback = `https://arbetsformedlingen.se/platsbanken/annonser/${hit.id}`;

  return (
    hit.webpage_url ||
    applicationDetails.url ||
    applicationDetails.webAddress ||
    (applicationLinks[0] && applicationLinks[0].url) ||
    hit.external_url ||
    fallback ||
    employer.webAddress || // last resort: company site
    null
  );
}

/**
 * Map an Arbetsförmedlingen API hit to our internal job format.
 *
 * Persists `region` + `municipality` as separate fields (in addition
 * to the comma-joined `location` string) so the dashboard can render
 * a "Matchar din ort Göteborg" badge against the structured field
 * without having to substring-match the display string.
 */
function mapAFJob(hit) {
  if (!hit || !hit.id) return null;

  const employer = hit.employer || {};
  const workplace = hit.workplace_address || {};
  const description = hit.description || {};

  const jobUrl = resolveAFJobUrl(hit);

  return {
    id: `af-${hit.id}`,          // prefix to avoid collisions with other sources
    externalId: String(hit.id),
    company: employer.name || 'Okänd arbetsgivare',
    title: hit.headline || 'Okänd titel',
    location: [
      workplace.municipality,
      workplace.region,
      workplace.country,
    ].filter(Boolean).join(', ') || 'Okänd ort',
    // Structured fields used by the location-match badge (see
    // doesJobMatchUserLocation in lib/swedishLocations.js). Both
    // fall back to null rather than empty string so callers can
    // truthy-check without worrying about whitespace games.
    municipality: workplace.municipality || null,
    region: workplace.region || null,
    country: workplace.country || null,
    description: description.text || '',
    source: 'Arbetsförmedlingen',
    url: jobUrl,
    published: hit.publication_date ? new Date(hit.publication_date).toISOString() : null,
    applicationDeadline: hit.application_deadline || null,
    employmentType: hit.employment_type || null,
    workingHoursType: hit.working_hours_type || null,
    salaryType: hit.salary_type || null,
  };
}
