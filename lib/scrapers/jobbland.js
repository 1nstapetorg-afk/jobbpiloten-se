/**
 * jobbland.se — pre-filled URL helper + soft-block-tolerant HTML scraper.
 *
 * Two exports:
 *   1. `buildJobblandSearchUrl` — URL helper for the dashboard's honest
 *      deep-link buttons. Always present, never broken.
 *   2. `scrapeJobblandJobs` — a best-effort HTML scraper that mirrors
 *      `lib/scrapers/ledigajobb.js`'s cache + soft-block handling.
 *
 * Background (Round-95, 2026-08-07 — Blocket Jobb replacement):
 *   - Blocket Jobb was shut down permanently on 2026-12-16 (Schibsted);
 *     the domain jobb.blocket.se is NXDOMAIN. Duunitori (which acquired
 *     Jobbsafari) runs jobbland.se as its Swedish job board, so this
 *     scraper restores the THIRD waterfall leg the multiSource search
 *     lost when Blocket retired.
 *   - Verified live: jobbland.se serves search results at
 *     `https://jobbland.se/lediga-jobb?search=<query>&location=<city>`
 *     (its own search form submits `name="search"` + `name="location"`).
 *     The page is plain HTML — NO JSON-LD JobPosting markup — so a
 *     custom regex parser walks the `.job-card` anchors, same
 *     conservative posture as ledigajobb.js.
 *   - robots.txt blocks automated crawling only on URLs with 3+ query
 *     params; our search URL carries at most 2, but we still keep the
 *     single-GET-per-tick + negative-cache discipline so a soft block
 *     degrades to [] instead of hammering the site.
 *
 * Legal note: same posture as ledigajobb.js — a SINGLE low-volume GET
 * per cron tick. Operators MUST disable this source if the site ever
 * asks us to stop — set JOBBLAND_SCRAPER_ENABLED=0 in the runtime env
 * and the multiSourceSearchJobs waterfall drops the call site
 * automatically.
 */

import { hashShort } from '../utils.js'

// Same Chrome fingerprint as the other scrapers so the sources cannot
// be told apart by behavioural heuristics.
const JOBBLAND_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
}

// Same 60s positive / 10s negative cache windows as the other
// scrapers, keyed per urlKey so sources stay isolated.
const _cache = { at: 0, urlKey: '', jobs: [] }
const _negCache = { at: 0, urlKey: '' }
const POSITIVE_CACHE_MS = 60_000
const NEGATIVE_CACHE_MS = 10_000

const JOBBLAND_BASE = 'https://jobbland.se'

/**
 * Build a jobbland.se search URL. Returns null when both query and
 * location are empty so callers can skip rendering the button.
 *
 * URL pattern (verified live 2026-08-07): `https://jobbland.se/
 * lediga-jobb?search=<query>&location=<city>` — the site's own search
 * form uses `name="search"` (yrkestitel/kategori/företag) and
 * `name="location"` (ort). URLSearchParams percent-encodes Swedish
 * diacritics automatically (Göteborg → G%C3%B6teborg), which the
 * site accepts.
 */
export function buildJobblandSearchUrl({ query = '', location = '' } = {}) {
  const trimmedQuery = String(query || '').trim()
  const trimmedLocation = String(location || '').trim()
  if (!trimmedQuery && !trimmedLocation) return null
  const params = new URLSearchParams()
  if (trimmedQuery) params.set('search', trimmedQuery)
  if (trimmedLocation) params.set('location', trimmedLocation)
  return `${JOBBLAND_BASE}/lediga-jobb?${params.toString()}`
}

/**
 * Search jobbland.se for matching listings. Mirrors the other
 * scrapers' signature so the caller doesn't dispatch by source.
 * Returns an empty array on any error so callers never have to wrap
 * this in a try/catch.
 *
 * @param {Object} options
 * @param {string} options.query - Free-text job title (e.g. "lagerarbetare")
 * @param {string} options.location - City or region (e.g. "Göteborg")
 * @param {number} options.limit - Max results (default 20)
 */
export async function scrapeJobblandJobs({ query = '', location = '', limit = 20 } = {}) {
  const url = buildJobblandSearchUrl({ query, location })
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
      headers: JOBBLAND_HEADERS,
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.warn(`[jobbland] ${res.status} ${res.statusText} — falling back to pre-filled URL helper`)
      _negCache.at = now
      _negCache.urlKey = urlKey
      return []
    }
    const html = await res.text()
    const jobs = parseJobblandListings(html, limit)
    _cache.at = now
    _cache.urlKey = urlKey
    _cache.jobs = jobs
    _negCache.at = 0
    _negCache.urlKey = ''
    return jobs
  } catch (err) {
    console.warn('[jobbland] fetch failed:', err.message)
    _negCache.at = now
    _negCache.urlKey = urlKey
    return []
  }
}

/**
 * Jobbland renders each listing as an `<a class="… job-card …"
 * href="/jobb/<slug>" data-company="…">` whose inner body carries the
 * title (`<h3>`), the company (`<p>` — a data-company attribute on the
 * anchor is the authoritative copy) and a `.job-card__content__meta`
 * div with "Ort · Ansökningsperiod …". No JSON-LD, so the parser is a
 * single tolerant regex over the card anchors, bounded to 50 matches
 * per request so a junk page can't OOM the worker.
 */
const JOB_CARD_RE = /<a\b([^>]*\bclass="[^"]*job-card[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi

function parseJobblandListings(html, limit) {
  const out = []
  if (!html || typeof html !== 'string') return out
  let guard = 0
  JOB_CARD_RE.lastIndex = 0
  let m
  while ((m = JOB_CARD_RE.exec(html)) !== null && out.length < limit && guard < 50) {
    guard++
    try {
      const job = mapJobblandCard(m[1], m[2])
      if (job) out.push(job)
    } catch (_) {
      // Malformed captures — skip silently.
    }
  }
  return out
}

function mapJobblandCard(attrs, body) {
  // href is required and must point at a real /jobb/ detail page
  // (recommended/editorial cards without one are skipped).
  const hrefMatch = /\bhref="([^"]+)"/.exec(attrs)
  const href = hrefMatch && hrefMatch[1]
  if (!href || !href.includes('/jobb/')) return null

  // Authoritative fields live on the anchor tag.
  const companyMatch = /\bdata-company="([^"]*)"/.exec(attrs)
  const idMatch = /\bdata-id="([^"]*)"/.exec(attrs)

  // Title: prefer the <h3> heading inside the card body; fall back to
  // the anchor's title="" attribute.
  const h3 = /<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(body)
  const titleAttr = /\btitle="([^"]*)"/.exec(attrs)
  const title = (h3 ? stripTags(h3[1]) : '').trim() ||
    (titleAttr ? titleAttr[1] : '') ||
    ''

  // Company: data-company attribute wins; the <p> is a fallback for
  // cards that omit the attribute.
  const company = (companyMatch && stripTags(companyMatch[1]).trim()) ||
    (() => {
      const p = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(body)
      return p ? stripTags(p[1]).trim() : ''
    })() ||
    'Okänd arbetsgivare'

  // Location: first token of the meta div ("Göteborg · Ansökningsperiod…").
  const meta = /<div class="job-card__content__meta">([\s\S]*?)<\/div>/i.exec(body)
  const location = meta
    ? stripTags(meta[1]).split(/[·\n]/).map((s) => s.trim()).filter(Boolean)[0] || 'Okänd ort'
    : 'Okänd ort'

  if (!title) return null
  const abs = href.startsWith('http') ? href : `${JOBBLAND_BASE}${href.startsWith('/') ? '' : '/'}${href}`
  return {
    id: `jobbland-${hashShort(abs)}`,
    externalId: idMatch ? idMatch[1] : null,
    company,
    title,
    location,
    municipality: extractMunicipality(location),
    region: null,
    country: 'SE',
    description: '',
    source: 'Jobbland',
    url: abs,
    published: null,
    applicationDeadline: null,
    employmentType: null,
  }
}

/** Pull the city token out of a comma-separated display string. */
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
