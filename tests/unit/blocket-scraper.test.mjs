// tests/unit/blocket-scraper.test.mjs
//
// Lock the public contract of lib/scrapers/blocket.js + urlBuilders.js
// + the multiSource waterfall in lib/jobScraper.js. Three independent
// layers of regression coverage:
//
//   1. buildBlocketSearchUrl — pure function tests. No fetch, deterministic.
//   2. hashShort                — locked FNV-1a contract (deterministic,
//                                 base36 output) so the scraper id
//                                 derivation in blocket.js can't drift.
//   3. scrapeBlocketJobs + multiSourceSearchJobs — mocked global.fetch
//                                 + unique urlKey per test (so the
//                                 module-level _cache / _negCache
//                                 never collide across runs). Restores
//                                 global.fetch + console.* after each
//                                 test via test.afterEach.
//
// Run via `yarn test:unit` (the package.json script wires
// `node --test tests/unit/**`).

import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { buildBlocketSearchUrl } from '../../lib/scrapers/urlBuilders.js'
import { hashShort } from '../../lib/utils.js'
import { scrapeBlocketJobs } from '../../lib/scrapers/blocket.js'
import { multiSourceSearchJobs } from '../../lib/jobScraper.js'

// Process-unique seed baked into every test's urlKey so the module-
// level `_cache` / `_negCache` (cache windows 60s / 10s) cannot collide
// across test runs OR across tests within this file. Each test also
// adds a unique letter so two parallel tests can't accidentally
// share state.
const SEED = `${Date.now()}-${Math.random().toString(36).slice(2)}`

// ---------- 1. buildBlocketSearchUrl — pure function tests ----------

test('buildBlocketSearchUrl returns null when both query and location are empty', () => {
  assert.equal(buildBlocketSearchUrl({ query: '', location: '' }), null)
  // Pure whitespace is also "empty" after toSlug strips it.
  assert.equal(buildBlocketSearchUrl({ query: ' ', location: '   ' }), null)
})

test('buildBlocketSearchUrl builds a `q-…` path when only query is provided', () => {
  assert.equal(
    buildBlocketSearchUrl({ query: 'frontend', location: '' }),
    'https://jobb.blocket.se/lediga-jobb/q-frontend/',
  )
})

test('buildBlocketSearchUrl builds an `l-…` path when only location is provided', () => {
  assert.equal(
    buildBlocketSearchUrl({ query: '', location: 'Stockholm' }),
    'https://jobb.blocket.se/lediga-jobb/l-stockholm/',
  )
})

test('buildBlocketSearchUrl places query BEFORE location (q/l convention)', () => {
  // The order matters because Blocket's path parser uses q/l parsing
  // rules; reorder would silently route to a different (often empty)
  // results page on their backend. Note: `toSlug` keeps Swedish Ö
  // (see `buildBlocketSearchUrl downcases + KEEPS Swedish diacritics`
  // test below) — the URL keeps `göteborg` literal so it matches
  // Blocket's own URL grammar.
  assert.equal(
    buildBlocketSearchUrl({ query: 'backend', location: 'Göteborg' }),
    'https://jobb.blocket.se/lediga-jobb/q-backend/l-göteborg/',
  )
})

test('buildBlocketSearchUrl downcases + hyphenates + KEEPS Swedish diacritics', () => {
  // toSlug lowers + replaces whitespace with `-`, but the
  // `[^\w\u00C0-\u017F\-]` character class intentionally PRESERVES
  // Swedish ÅÄÖåäö so users searching "Målare" / "Malmö" still get
  // meaningful URLs that match Blocket's own URL grammar. The
  // dashboard buttons deep-link into Blocket's search results so the
  // slug shape has to match.
  assert.equal(
    buildBlocketSearchUrl({ query: 'MÅLARE', location: 'Malmö' }),
    'https://jobb.blocket.se/lediga-jobb/q-målare/l-malmö/',
  )
  // Whitespace still becomes a hyphen
  assert.equal(
    buildBlocketSearchUrl({ query: 'frontend utvecklare', location: 'Malmö' }),
    'https://jobb.blocket.se/lediga-jobb/q-frontend-utvecklare/l-malmö/',
  )
})

// ---------- 2. hashShort contract ----------

test('hashShort returns a deterministic base36 string for the same input', () => {
  assert.equal(hashShort('hello'), hashShort('hello'))
  assert.equal(hashShort('/some/url'), hashShort('/some/url'))
  assert.notEqual(hashShort('hello'), hashShort('HELLO'))
  assert.notEqual(hashShort('hello'), hashShort('world'))
})

test('hashShort returns base36-only characters (no uppercase, no punctuation)', () => {
  // The job-id contract in blocket.js (and the qh / lh metric keys in
  // jobScraper.js) require base36 because Mongo + /dashboard URLs pass
  // back the id unmodified. Uppercase or punctuation in the hash would
  // produce URLs that look "broken" on first sight.
  assert.match(hashShort('/dashboard/job/abc'), /^[0-9a-z]+$/)
  assert.match(hashShort(''), /^[0-9a-z]+$/)
})

test('hashShort tolerates empty + nullish input gracefully', () => {
  // The shared util is called from jobScraper.metric with no guarantees
  // that callers pass non-empty strings; a crash here would break every
  // millisecond of multiSource waterfall log volume.
  assert.equal(typeof hashShort(''), 'string')
  assert.equal(typeof hashShort(null), 'string')
  assert.equal(typeof hashShort(undefined), 'string')
})

// ---------- 3. scrapeBlocketJobs — mocked global.fetch ------------

// Builds a synthetic Blocket search HTML page wrapping the supplied
// JSON-LD block(s) in `<script type="application/ld+json">…</script>`.
function jsonLdHtml(blocks) {
  const scripts = blocks
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
    .join('')
  return `<!doctype html><html><head>${scripts}</head><body></body></html>`
}

// Save + restore global.fetch so a single failing test doesn't poison
// the rest of the suite. module-level caches are reset logically by
// using unique urlKey per test (see SEED).
const realFetch = global.fetch
afterEach(() => {
  global.fetch = realFetch
})

test('scrapeBlocketJobs maps a single valid JobPosting into our internal shape', async () => {
  const html = jsonLdHtml([
    {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Senior Frontend-utvecklare',
      identifier: 'b-12345',
      url: `https://example.com/job/A-${SEED}`,
      datePosted: '2026-07-09T10:00:00Z',
      hiringOrganization: { name: 'Volvo Cars' },
      jobLocation: { address: { addressLocality: 'Göteborg', addressCountry: 'SE' } },
      description: '<p>Cool job.</p>',
    },
  ])
  global.fetch = async () =>
    new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })

  const jobs = await scrapeBlocketJobs({
    query: `unique-A-${SEED}`,
    location: 'Göteborg',
    limit: 20,
  })

  assert.equal(jobs.length, 1)
  const [j] = jobs
  assert.equal(j.title, 'Senior Frontend-utvecklare')
  assert.equal(j.company, 'Volvo Cars')
  assert.equal(j.municipality, 'Göteborg')
  assert.equal(j.country, 'SE')
  assert.equal(j.source, 'Blocket Jobb')
  assert.equal(j.externalId, 'b-12345')
  // Stable id derived from the URL via the shared hashShort helper.
  assert.equal(j.id, `blocket-${hashShort(j.url)}`)
  assert.match(j.description, /Cool job/)
})

test('scrapeBlocketJobs walks @graph blocks (nested JobPosting)', async () => {
  // Blocket sometimes returns a single <script> whose root is
  // `{ "@graph": [ {...}, {...} ] }`. Confirms extractJobPostings picks
  // up the JobPosting variant and ignores the other types.
  const html = jsonLdHtml([
    {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'ShouldBeIgnored' },
        {
          '@type': 'JobPosting',
          title: 'Backend',
          url: `https://example.com/job/B-${SEED}`,
          hiringOrganization: { name: 'Spotify' },
          jobLocation: { address: { addressLocality: 'Stockholm', addressCountry: 'SE' } },
        },
      ],
    },
  ])
  global.fetch = async () => new Response(html, { status: 200 })

  const jobs = await scrapeBlocketJobs({
    query: `unique-B-${SEED}`,
    location: 'Stockholm',
    limit: 20,
  })
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].title, 'Backend')
  assert.equal(jobs[0].company, 'Spotify')
})

test('scrapeBlocketJobs returns [] on 403 (soft-block — no crash)', async () => {
  // Akamai 403 degrades gracefully to []; downstream callers fall back
  // to the pre-filled search URL helper.
  global.fetch = async () => new Response('forbidden', { status: 403 })
  const jobs = await scrapeBlocketJobs({
    query: `unique-C-${SEED}`,
    location: 'Stockholm',
    limit: 20,
  })
  assert.deepEqual(jobs, [])
})

test('scrapeBlocketJobs returns [] on network error (no crash)', async () => {
  global.fetch = async () => {
    throw new Error('ETIMEDOUT')
  }
  const jobs = await scrapeBlocketJobs({
    query: `unique-D-${SEED}`,
    location: 'Malmö',
    limit: 20,
  })
  assert.deepEqual(jobs, [])
})

test('scrapeBlocketJobs returns [] when response contains no JSON-LD', async () => {
  global.fetch = async () =>
    new Response('<html><body>Sorry, no jobs here.</body></html>', { status: 200 })
  const jobs = await scrapeBlocketJobs({
    query: `unique-E-${SEED}`,
    location: 'Uppsala',
    limit: 20,
  })
  assert.deepEqual(jobs, [])
})

// ---------- 4. multiSourceSearchJobs — dedupe + metric + warn -------

const realLog = console.log
const realWarn = console.warn
afterEach(() => {
  console.log = realLog
  console.warn = realWarn
})

test('multiSourceSearchJobs dedupes when AF and Blocket share the same URL', async () => {
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
      jsonLdHtml([
        {
          '@type': 'JobPosting',
          title: 'Frontend Developer',
          url: sharedUrl,
          hiringOrganization: { name: 'Acme' },
          jobLocation: { address: { addressLocality: 'Stockholm', addressCountry: 'SE' } },
        },
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
  const blkUrl = `https://example.com/blk-distinct-${SEED}`
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
    return new Response(
      jsonLdHtml([
        {
          '@type': 'JobPosting',
          title: 'Identical Title',
          url: blkUrl,
          hiringOrganization: { name: 'Identical Co' },
          jobLocation: { address: { addressLocality: 'Lund', addressCountry: 'SE' } },
        },
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
  // Make AF succeed with 2 results, Blocket fail (returning []).
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

test('multiSourceSearchJobs warns (simple tag) and emits q/l in metric when both sources fail', async () => {
  // The warn line is now a simple grep-able tag (operators alerting
  // off it don't have to parse JSON). The TRUNCATED query + location
  // are still emitted — just on the structured `evt:multiSource.metric`
  // log line one statement earlier, so the other multiSource test
  // already locks `parsed.q.length <= 40` + `parsed.l` for the metric
  // log. Here we just verify both branches fire when both sources
  // fail (network error → both return []) so neither is a dead code
  // path.
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
  const warn = capturedWarn.find((l) => l.includes('[multiSource] both sources returned empty'))
  assert.ok(warn, 'both-empty branch must warn with the simple [multiSource] tag')
  // The warn line is now a fixed tag (no interpolated query/location),
  // so its length is bounded by the literal string — not by any
  // user-supplied input.
  assert.ok(warn.length < 80, 'warn tag must be a bounded fixed string')
  // The metric log line above still carries the truncated query +
  // location so operators can still reconstruct the user payload.
  const metric = capturedLog.find((l) => l.includes('"evt":"multiSource.metric"'))
  assert.ok(metric, 'both-empty branch must still emit the structured metric line')
  const parsed = JSON.parse(metric)
  assert.equal(parsed.af, 0)
  assert.equal(parsed.blk, 0)
  assert.equal(parsed.l, 'Västerås')
  assert.ok(parsed.q.length <= 40, 'metric.q must be capped at 40 chars')
})

// ---------- 5. hasMore upstreamCapped heuristic (2026-07-10) ------
//
// Lock the bug-fix for the case where dedupe collapses all upstream
// hits to exactly `limit` — without `upstreamCapped`, the dashboard's
// "Visa fler jobb" button would disappear even though the next page
// could still yield fresh ads.

test('multiSourceSearchJobs returns hasMore=true when any source is at the per-source limit', async () => {
  // AF returns exactly 10 jobs (its limit cap). Blocket fails so we
  // know the truthy came from AF, not a coincidence. After dedupe the
  // combined list still equals 10 = limit, so the OLD logic
  // (`combined.length > offset + limit`) would have returned false.
  // The new `upstreamCapped` heuristic catches this and returns true.
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
  // AF returns 5 jobs, Blocket returns 5 jobs (all unique). combined
  // is 10 = limit, but neither source is capped, so hasMore stays
  // false — there really is nothing left.
  const afHits = Array.from({ length: 5 }, (_, i) => ({
    id: `a${i}-${SEED}`,
    headline: `AF ${i}`,
    employer: { name: `AF Co ${i}` },
    workplace_address: { municipality: 'Göteborg', country: 'SE' },
    description: { text: '' },
    webpage_url: `https://example.com/a${i}-${SEED}`,
  }))
  const blkBlocks = Array.from({ length: 5 }, (_, i) => ({
    '@type': 'JobPosting',
    title: `Blk ${i}`,
    url: `https://example.com/b${i}-${SEED}`,
    hiringOrganization: { name: `Blk Co ${i}` },
    jobLocation: { address: { addressLocality: 'Göteborg', addressCountry: 'SE' } },
  }))
  global.fetch = async (url) => {
    if (String(url).includes('jobtechdev')) {
      return new Response(
        JSON.stringify({ hits: afHits }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(
      jsonLdHtml(blkBlocks),
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
