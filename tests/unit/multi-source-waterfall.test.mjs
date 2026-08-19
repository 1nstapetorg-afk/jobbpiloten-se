// tests/unit/multi-source-waterfall.test.mjs
//
// Locks two contracts that survive the Round-94/95 Blocket retirement:
//
//   1. hashShort — the shared FNV-1a base36 id-derivation helper in
//      lib/utils.js (used by ledigajobb.js + jobbland.js to derive
//      stable dashboard ids).
//   2. multiSourceSearchJobs — the AF + Ledigajobb + Jobbland waterfall
//      in lib/jobScraper.js: URL/tuple dedupe, the structured metric
//      log (af/blk/lj/jl), the all-empty warn tag, and the `hasMore`
//      upstreamCapped heuristic.
//
// Blocket-specific coverage (buildBlocketSearchUrl + scrapeBlocketJobs)
// was removed in the Round-94/95 cleanup — Blocket Jobb shut down
// permanently (jobb.blocket.se is NXDOMAIN) and the scraper module was
// deleted. The `blk` metric field stays pinned to 0 for log-shape
// stability.
//
// Run via `yarn test:unit` (the package.json script wires
// `node --test tests/unit/**`).

import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { hashShort } from '../../lib/utils.js'
import { multiSourceSearchJobs } from '../../lib/jobScraper.js'

// Process-unique seed baked into every test's urlKey so the module-
// level `_cache` / `_negCache` (cache windows 60s / 10s) cannot collide
// across test runs OR across tests within this file. Each test also
// adds a unique letter so two parallel tests can't accidentally
// share state.
const SEED = `${Date.now()}-${Math.random().toString(36).slice(2)}`

const realFetch = global.fetch
const realLog = console.log
const realWarn = console.warn
afterEach(() => {
  global.fetch = realFetch
  console.log = realLog
  console.warn = realWarn
})

// ---------- 1. hashShort contract ----------

test('hashShort returns a deterministic base36 string for the same input', () => {
  assert.equal(hashShort('hello'), hashShort('hello'))
  assert.equal(hashShort('/some/url'), hashShort('/some/url'))
  assert.notEqual(hashShort('hello'), hashShort('HELLO'))
  assert.notEqual(hashShort('hello'), hashShort('world'))
})

test('hashShort returns base36-only characters (no uppercase, no punctuation)', () => {
  // The job-id contract in ledigajobb.js / jobbland.js requires base36
  // because Mongo + /dashboard URLs pass back the id unmodified.
  // Uppercase or punctuation in the hash would produce URLs that look
  // "broken" on first sight.
  assert.match(hashShort('/dashboard/job/abc'), /^[0-9a-z]+$/)
  assert.match(hashShort(''), /^[0-9a-z]+$/)
})

test('hashShort tolerates empty + nullish input gracefully', () => {
  // The shared util is called from every scraper's id derivation with
  // no guarantee that callers pass non-empty strings; a crash here
  // would break the whole multiSource waterfall.
  assert.equal(typeof hashShort(''), 'string')
  assert.equal(typeof hashShort(null), 'string')
  assert.equal(typeof hashShort(undefined), 'string')
})

// ---------- 2. multiSourceSearchJobs — dedupe + metric + warn --------
//
// Round-94 followup (2026-08-07): the waterfall now runs AF + Ledigajobb
// + Jobbland (Blocket Jobb shut down — see lib/jobScraper.js header).
// These tests mock the Ledigajobb leg with its HTML listing shape so
// the dedupe / metric / warn contracts stay locked against the LIVE
// waterfall.

// Builds a synthetic Ledigajobb search HTML page wrapping the supplied
// listing descriptors ({ title, url, company, location }) in the
// `article-with-classes` shape the parser recognises.
function ljListingHtml(listings) {
  const articles = listings
    .map(
      (l) => `<article class="job-listing">
        <a href="${l.url}" class="job-link"><h2>${l.title}</h2></a>
        <span class="company">${l.company}</span>
        <span class="location">${l.location}</span>
      </article>`,
    )
    .join('')
  return `<html><body>${articles}</body></html>`
}

test('multiSourceSearchJobs dedupes when AF and Ledigajobb share the same URL', async () => {
  // Same URL + different titles. Exercises the FIRST branch in
  // `dedupeJobs` (URL-key match). AF wins the tie.
  const sharedUrl = `https://example.com/canonical-F-${SEED}`
  global.fetch = async (url) => {
    if (String(url).includes('jobtechdev')) {
      return new Response(
        JSON.stringify({
          hits: [
            {
              id: '1',
              headline: 'Frontend',
              employer: { name: 'Acme' },
              workplace_address: { municipality: 'Stockholm', country: 'SE' },
              description: { text: '' },
              webpage_url: sharedUrl,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(
      ljListingHtml([
        { title: 'Frontend Developer', url: sharedUrl, company: 'Acme', location: 'Stockholm' },
      ]),
      { status: 200 },
    )
  }
  const { jobs } = await multiSourceSearchJobs({
    query: `unique-F-${SEED}`,
    location: 'Stockholm',
    limit: 20,
  })
  // AF (primary) wins the URL-key tie. Title+company prevents
  // accidental duplicate from a non-canonical URL variant.
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].id, `af-1`)
  assert.equal(jobs[0].url, sharedUrl)
})

test('multiSourceSearchJobs dedupes by (company|title|location) when URLs differ', async () => {
  // Different URLs but identical (company, title, location) tuple —
  // exercises the SECOND branch in `dedupeJobs` (title-key fallback
  // when URL-key didn't match). AF (primary) still wins the tie.
  const afUrl = `https://example.com/af-distinct-${SEED}`
  const ljUrl = `https://example.com/lj-distinct-${SEED}`
  global.fetch = async (url) => {
    if (String(url).includes('jobtechdev')) {
      return new Response(
        JSON.stringify({
          hits: [
            {
              id: 'z',
              headline: 'Identical Title',
              employer: { name: 'Identical Co' },
              workplace_address: { municipality: 'Lund', country: 'SE' },
              description: { text: '' },
              webpage_url: afUrl,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    // Location mirrors the AF tuple shape ('Lund, SE' — municipality +
    // country) so the (company|title|location) text-key actually
    // matches; a bare 'Lund' would silently dodge the dedupe branch
    // this test exists to exercise.
    return new Response(
      ljListingHtml([
        { title: 'Identical Title', url: ljUrl, company: 'Identical Co', location: 'Lund, SE' },
      ]),
      { status: 200 },
    )
  }
  const { jobs } = await multiSourceSearchJobs({
    query: `unique-I-${SEED}`,
    location: 'Lund',
    limit: 20,
  })
  // Two URLs non-matching, but identical tuple. AF wins.
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].id, 'af-z')
  assert.equal(jobs[0].url, afUrl)
})

test('multiSourceSearchJobs emits a structured JSON metric log per call', async () => {
  const captured = []
  console.log = (...args) => {
    captured.push(args.join(' '))
  }
  // Make AF succeed with 2 results, Ledigajobb fail (returning []).
  global.fetch = async (url) => {
    if (String(url).includes('jobtechdev')) {
      return new Response(
        JSON.stringify({
          hits: [
            {
              id: 'a',
              headline: 'One',
              employer: { name: 'A' },
              workplace_address: { municipality: 'X', country: 'SE' },
              description: { text: '' },
              webpage_url: `https://example.com/a-${SEED}`,
            },
            {
              id: 'b',
              headline: 'Two',
              employer: { name: 'B' },
              workplace_address: { municipality: 'Y', country: 'SE' },
              description: { text: '' },
              webpage_url: `https://example.com/b-${SEED}`,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response('forbidden', { status: 403 })
  }
  const { jobs } = await multiSourceSearchJobs({
    query: `unique-G-${SEED}`,
    location: 'Linköping',
    limit: 20,
  })
  assert.equal(jobs.length, 2)
  // Find the metric line. It uses `evt:multiSource.metric` so a log-
  // aggregator can grep for it cheaply.
  const metricLine = captured.find((l) => l.includes('"evt":"multiSource.metric"'))
  assert.ok(metricLine, 'multiSourceSearchJobs must emit a JSON metric line every call')
  const parsed = JSON.parse(metricLine)
  assert.equal(parsed.evt, 'multiSource.metric')
  assert.equal(typeof parsed.v, 'number')
  assert.equal(parsed.af, 2)
  assert.equal(parsed.blk, 0)
  assert.equal(parsed.lj, 0)
  assert.equal(parsed.jl, 0, 'Jobbland leg (Round-95) must appear in the metric — 0 here (403 mock)')
  assert.equal(parsed.in, 2)
  assert.equal(parsed.dedup, 2)
  assert.equal(parsed.capped, 2)
  // Privacy: query/location are INLINED (truncated to 40 chars) rather
  // than hashed. Operators grep Vercel logs by `q=...` and `l=...`
  // directly. The truncate cap keeps freak-length search strings from
  // blowing up each log line.
  assert.equal(typeof parsed.q, 'string')
  assert.equal(parsed.q.length <= 40, true)
  assert.equal(parsed.l, 'Linköping')
})

test('multiSourceSearchJobs metric keeps blk:0 (retired Blocket leg) while af+lj+jl populate', async () => {
  // Round-94/95 followup: Blocket Jobb is shut down, so the waterfall
  // no longer calls it — the metric's blk field stays a stable 0
  // (log-shape compat) while af + lj + jl carry the real counts.
  // NOTE: this test's 403 mock also silences the Jobbland leg, so jl
  // reads 0 here — the dedicated jobbland-scraper.test.mjs locks the
  // live parse path.
  const captured = []
  console.log = (...args) => captured.push(args.join(' '))
  const sharedUrl = `https://example.com/blk0-${SEED}`
  global.fetch = async (url) => {
    if (String(url).includes('jobtechdev')) {
      return new Response(
        JSON.stringify({
          hits: [
            {
              id: 'z',
              headline: 'AF Only',
              employer: { name: 'AF Co' },
              workplace_address: { municipality: 'Stockholm', country: 'SE' },
              description: { text: '' },
              webpage_url: sharedUrl,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(
      ljListingHtml([
        { title: 'LJ Win', url: sharedUrl, company: 'LJ Co', location: 'Stockholm, SE' },
      ]),
      { status: 200 },
    )
  }
  const { jobs } = await multiSourceSearchJobs({
    query: `unique-blk0-${SEED}`,
    location: 'Stockholm',
    limit: 20,
  })
  assert.equal(jobs.length, 1, 'AF wins the shared-URL dedupe tie')
  const metric = captured.find((l) => l.includes('"evt":"multiSource.metric"'))
  assert.ok(metric)
  const parsed = JSON.parse(metric)
  assert.equal(parsed.af, 1)
  assert.equal(parsed.blk, 0, 'blk must stay 0 — Blocket leg retired (Round-94)')
  assert.equal(parsed.lj, 1)
  assert.equal(parsed.jl, 0)
  assert.equal(parsed.in, 2, 'in = af + blk(0) + lj + jl(0) (pre-dedupe total)')
})

test('multiSourceSearchJobs warns (simple tag) and emits q/l in metric when all sources fail', async () => {
  // Round-95: "all sources" = AF + Ledigajobb + Jobbland (Blocket
  // leg retired).
  // The warn line is now a simple grep-able tag (operators alerting
  // off it don't have to parse JSON). The TRUNCATED query + location
  // are still emitted — just on the structured `evt:multiSource.metric`
  // log line one statement earlier.
  const capturedLog = []
  const capturedWarn = []
  console.log = (...args) => capturedLog.push(args.join(' '))
  console.warn = (...args) => capturedWarn.push(args.join(' '))
  global.fetch = async () => {
    throw new Error('down for both')
  }
  const { jobs } = await multiSourceSearchJobs({
    query: `unique-H-${SEED}-this-is-a-very-long-search-string-that-definitely-needs-truncation-to-keep-log-lines-bounded`,
    location: 'Västerås',
    limit: 20,
  })
  assert.deepEqual(jobs, [])
  const warn = capturedWarn.find((l) => l.includes('[multiSource] all sources returned empty'))
  assert.ok(warn, 'all-empty branch must warn with the simple [multiSource] tag')
  assert.ok(warn.length < 80, 'warn tag must be a bounded fixed string')
  const metric = capturedLog.find((l) => l.includes('"evt":"multiSource.metric"'))
  assert.ok(metric, 'both-empty branch must still emit the structured metric line')
  const parsed = JSON.parse(metric)
  assert.equal(parsed.af, 0)
  assert.equal(parsed.blk, 0)
  assert.equal(parsed.lj, 0)
  assert.equal(parsed.jl, 0)
  assert.equal(parsed.l, 'Västerås')
  assert.ok(parsed.q.length <= 40, 'metric.q must be capped at 40 chars')
})

// ---------- 3. hasMore upstreamCapped heuristic (2026-07-10) -------
//
// Lock the bug-fix for the case where dedupe collapses all upstream
// hits to exactly `limit` — without `upstreamCapped`, the dashboard's
// "Visa fler jobb" button would disappear even though the next page
// could still yield fresh ads.

test('multiSourceSearchJobs returns hasMore=true when any source is at the per-source limit', async () => {
  // AF returns exactly 10 jobs (its limit cap). Ledigajobb + Jobbland
  // fail (403) so we know the truthy came from AF, not a coincidence.
  // After dedupe the combined list still equals 10 = limit, so the
  // OLD logic (`combined.length > offset + limit`) would have returned
  // false. The new `upstreamCapped` heuristic catches this and returns
  // true.
  const hits = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}-${SEED}`,
    headline: `Role ${i}`,
    employer: { name: `Co ${i}` },
    workplace_address: { municipality: 'Stockholm', country: 'SE' },
    description: { text: '' },
    webpage_url: `https://example.com/m${i}-${SEED}`,
  }))
  global.fetch = async (url) => {
    if (String(url).includes('jobtechdev')) {
      return new Response(
        JSON.stringify({ hits }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response('forbidden', { status: 403 })
  }
  const { jobs, hasMore } = await multiSourceSearchJobs({
    query: `unique-HM1-${SEED}`,
    location: 'Stockholm',
    limit: 10,
  })
  assert.equal(jobs.length, 10, 'page should be filled to the limit')
  assert.equal(hasMore, true, 'upstreamCapped must flip hasMore=true when a source hit its per-source cap')
})

test('multiSourceSearchJobs returns hasMore=false when no source is at the per-source limit', async () => {
  // AF returns 5 jobs, Ledigajobb returns 5 jobs (all unique), Jobbland
  // 403s. combined is 10 = limit, but neither live source is capped,
  // so hasMore stays false — there really is nothing left.
  const afHits = Array.from({ length: 5 }, (_, i) => ({
    id: `a${i}-${SEED}`,
    headline: `AF ${i}`,
    employer: { name: `AF Co ${i}` },
    workplace_address: { municipality: 'Göteborg', country: 'SE' },
    description: { text: '' },
    webpage_url: `https://example.com/a${i}-${SEED}`,
  }))
  const ljListings = Array.from({ length: 5 }, (_, i) => ({
    title: `LJ ${i}`,
    url: `https://example.com/lj${i}-${SEED}`,
    company: `LJ Co ${i}`,
    location: 'Göteborg',
  }))
  global.fetch = async (url) => {
    if (String(url).includes('jobtechdev')) {
      return new Response(
        JSON.stringify({ hits: afHits }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(
      ljListingHtml(ljListings),
      { status: 200 },
    )
  }
  const { jobs, hasMore } = await multiSourceSearchJobs({
    query: `unique-HM2-${SEED}`,
    location: 'Göteborg',
    limit: 10,
  })
  assert.equal(jobs.length, 10)
  assert.equal(hasMore, false, 'no source is at the per-source cap, so hasMore must be false')
})
