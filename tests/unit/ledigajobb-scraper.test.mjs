// tests/unit/ledigajobb-scraper.test.mjs
//
// Lock the public contract of lib/scrapers/ledigajobb.js + the
// `lj` field on the multiSource waterfall in lib/jobScraper.js.
// Mirrors tests/unit/blocket-scraper.test.mjs in shape (SEED,
// unindexed-afterEach, mocked global.fetch) so the two scrapers
// can never drift in cache policy or metric shape.
//
// Run via `yarn test:unit`.

import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { buildLedigaJobbSearchUrl } from '../../lib/scrapers/ledigajobb.js'
import { scrapeLedigajobbJobs } from '../../lib/scrapers/ledigajobb.js'
import { multiSourceSearchJobs } from '../../lib/jobScraper.js'
import { hashShort } from '../../lib/utils.js'

// Process-unique seed baked into every test's urlKey so the module-
// level `_cache` / `_negCache` (cache windows 60s / 10s) cannot
// collide across runs OR across tests within this file. Each test
// also adds a unique letter so two parallel tests can't accidentally
// share state.
const SEED = `${Date.now()}-${Math.random().toString(36).slice(2)}`

// ---------- 1. buildLedigaJobbSearchUrl — pure-function tests ----------

test('buildLedigaJobbSearchUrl returns null when both query and location are empty', () => {
  assert.equal(buildLedigaJobbSearchUrl({ query: '', location: '' }), null)
  // Pure whitespace is also "empty" after toSlug strips it.
  assert.equal(buildLedigaJobbSearchUrl({ query: ' ', location: '   ' }), null)
})

test('buildLedigaJobbSearchUrl builds an "Q-…" path when only query is provided', () => {
  assert.equal(
    buildLedigaJobbSearchUrl({ query: 'frontend', location: '' }),
    'https://ledigajobb.se/sok/q-frontend/',
  )
})

test('buildLedigaJobbSearchUrl builds an "L-…" path when only location is provided', () => {
  assert.equal(
    buildLedigaJobbSearchUrl({ query: '', location: 'Stockholm' }),
    'https://ledigajobb.se/sok/l-stockholm/',
  )
})

test('buildLedigaJobbSearchUrl places query BEFORE location', () => {
  // Mirror the Blocket ordering — reordering would silently route to
  // a different (often empty) results page on the upstream site.
  assert.equal(
    buildLedigaJobbSearchUrl({ query: 'backend', location: 'Göteborg' }),
    'https://ledigajobb.se/sok/q-backend/l-göteborg/',
  )
})

test('buildLedigaJobbSearchUrl downcases + hyphenates + KEEPS Swedish diacritics', () => {
  // Slug shape must match the upstream path grammar so the
  // dashboard's deep-link button lands on a real results page.
  assert.equal(
    buildLedigaJobbSearchUrl({ query: 'MÅLARE', location: 'Malmö' }),
    'https://ledigajobb.se/sok/q-målare/l-malmö/',
  )
})

// ---------- 2. scrapeLedigajobbJobs — mocked global.fetch ------------

// Save + restore global.fetch so a single failing test doesn't poison
// the rest of the suite. Module-level caches are reset logically by
// using a unique urlKey per test (see SEED).
const realFetch = global.fetch
afterEach(() => {
  global.fetch = realFetch
})

test('scrapeLedigajobbJobs returns [] on 403 (soft-block — no crash)', async () => {
  global.fetch = async () => new Response('forbidden', { status: 403 })
  const jobs = await scrapeLedigajobbJobs({
    query: `unique-A-${SEED}`,
    location: 'Stockholm',
    limit: 20,
  })
  assert.deepEqual(jobs, [])
})

test('scrapeLedigajobbJobs returns [] on network error (no crash)', async () => {
  global.fetch = async () => {
    throw new Error('ETIMEDOUT')
  }
  const jobs = await scrapeLedigajobbJobs({
    query: `unique-B-${SEED}`,
    location: 'Malmö',
    limit: 20,
  })
  assert.deepEqual(jobs, [])
})

test('scrapeLedigajobbJobs returns [] when response contains no parseable listings', async () => {
  global.fetch = async () =>
    new Response('<html><body>Sorry, no jobs here.</body></html>', { status: 200 })
  const jobs = await scrapeLedigajobbJobs({
    query: `unique-C-${SEED}`,
    location: 'Uppsala',
    limit: 20,
  })
  assert.deepEqual(jobs, [])
})

test('scrapeLedigajobbJobs parses the `article-with-classes` pattern (article + h2 + company + location)', async () => {
  // Pattern 1 — most stable layout. ledigajobb.se's desktop HTML uses
  // an <article> wrapper with class-typed <span>s for company &
  // location.
  const html = `
    <html>
      <body>
        <article class="job-listing">
          <a href="/jobb/cooler-roll-${SEED}" class="job-link">
            <h2>Senior Frontend-utvecklare</h2>
          </a>
          <span class="company">Volvo Cars</span>
          <span class="location">Göteborg</span>
        </article>
        <article class="job-listing">
          <a href="/jobb/another-${SEED}" class="job-link">
            <h2>Backend Developer</h2>
          </a>
          <span class="company">Spotify</span>
          <span class="location">Stockholm</span>
        </article>
      </body>
    </html>
  `
  global.fetch = async () => new Response(html, { status: 200 })
  const jobs = await scrapeLedigajobbJobs({
    query: `unique-D-${SEED}`,
    location: 'Göteborg',
    limit: 20,
  })
  assert.equal(jobs.length, 2)
  assert.equal(jobs[0].title, 'Senior Frontend-utvecklare')
  assert.equal(jobs[0].company, 'Volvo Cars')
  assert.equal(jobs[0].municipality, 'Göteborg')
  assert.equal(jobs[0].country, 'SE')
  assert.equal(jobs[0].source, 'Ledigajobb')
  // Stable id derived from the URL via hashShort. The `ledigajobb-`
  // prefix keeps these ids from colliding with AF / Blocket ids in
  // the dedupe pipeline.
  assert.equal(jobs[0].id, `ledigajobb-${hashShort(jobs[0].url)}`)
})

test('scrapeLedigajobbJobs parses the `anchor-flattened` pattern with newline separator', async () => {
  // Pattern 2 — mobile-rendered variant. The <a> body has flattened
  // text separated by \n so the page doesn't pull in extra markup
  // for low-bandwidth clients.
  const url = `https://ledigajobb.se/jobb/eol-${SEED}`
  const html = `
    <html>
      <body>
        <a class="job-link" href="${url}">
          Designer
          Klarna
          Stockholm
        </a>
      </body>
    </html>
  `
  global.fetch = async () => new Response(html, { status: 200 })
  const jobs = await scrapeLedigajobbJobs({
    query: `unique-E-${SEED}`,
    location: 'Stockholm',
    limit: 20,
  })
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].title, 'Designer')
  assert.equal(jobs[0].company, 'Klarna')
  assert.equal(jobs[0].location, 'Stockholm')
  assert.equal(jobs[0].url, url)
})

test('scrapeLedigajobbJobs parses the `anchor-flattened` pattern with middle-dot separator', async () => {
  // Pattern 2 — variant where the upstream uses `·` separators
  // instead of newlines. Both shapes are commonly seen on the
  // same page across releases, so the parser treats them
  // symmetrically.
  const url = `https://ledigajobb.se/jobb/eolm-${SEED}`
  const html = `
    <html>
      <body>
        <a class="job-link" href="${url}">DevOps · SAAB · Linköping</a>
      </body>
    </html>
  `
  global.fetch = async () => new Response(html, { status: 200 })
  const jobs = await scrapeLedigajobbJobs({
    query: `unique-F-${SEED}`,
    location: 'Linköping',
    limit: 20,
  })
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].title, 'DevOps')
  assert.equal(jobs[0].company, 'SAAB')
  assert.equal(jobs[0].location, 'Linköping')
})

test('scrapeLedigajobbJobs returns early on empty query+location (no GET issued)', async () => {
  // When toSlug strips both query and location to '', the URL
  // builder returns null and the scraper MUST short-circuit so we
  // don't accidentally point at the site's home page.
  let fetchCalled = false
  global.fetch = async () => {
    fetchCalled = true
    return new Response('should not be fetched', { status: 200 })
  }
  const jobs = await scrapeLedigajobbJobs({ query: '', location: '', limit: 20 })
  assert.deepEqual(jobs, [])
  assert.equal(fetchCalled, false)
})

// ---------- 3. multiSourceSearchJobs metric shape -------------------

const realLog = console.log
const realWarn = console.warn
afterEach(() => {
  console.log = realLog
  console.warn = realWarn
})

test('multiSourceSearchJobs emits the lj field on the metric log per call', async () => {
  const captured = []
  console.log = (...args) => captured.push(args.join(' '))
  // Make AF succeed with 1 result, Blocket fail, Ledigajobb succeed
  // with 1 result. The `in` count should be 1 + 0 + 1 = 2.
  const sharedUrl = `https://example.com/canonical-${SEED}`
  global.fetch = async (url) => {
    const s = String(url)
    if (s.includes('jobtechdev')) {
      return new Response(
        JSON.stringify({
          hits: [
            {
              id: 'x',
              headline: 'AF Win',
              employer: { name: 'AF Co' },
              workplace_address: { municipality: 'Göteborg', country: 'SE' },
              description: { text: '' },
              webpage_url: sharedUrl,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (s.includes('ledigajobb.se')) {
      return new Response(
        `<html><body>
          <article class="j">
            <a href="${sharedUrl}" class="job-link">
              <h2>Ledigajobb Win</h2>
            </a>
            <span class="company">LJ Co</span>
            <span class="location">Göteborg</span>
          </article>
        </body></html>`,
        { status: 200 },
      )
    }
    return new Response('forbidden', { status: 403 })
  }
  const { jobs } = await multiSourceSearchJobs({
    query: `unique-G-${SEED}`,
    location: 'Göteborg',
    limit: 20,
  })
  // AF wins the URL-key dedupe tie (shared URL is identical).
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].id, `af-x`)
  const metric = captured.find((l) => l.includes('"evt":"multiSource.metric"'))
  assert.ok(metric, 'metric log must be emitted every call')
  const parsed = JSON.parse(metric)
  assert.equal(parsed.af, 1)
  assert.equal(parsed.blk, 0)
  assert.equal(parsed.lj, 1)
  assert.equal(parsed.in, 2, 'in = af + blk + lj (pre-dedupe total)')
  assert.equal(parsed.dedup, 1, 'AF + LJ collapsed on shared URL -> dedup = 1')
  assert.equal(parsed.capped, 1)
})

test('multiSourceSearchJobs emits lj=0 + the canonical both-empty warn when only Ledigajobb fails', async () => {
  // Both AF and Blocket fail; Ledigajobb is up but returns 403.
  // Same end-user behaviour as before Ledigajobb was added: warning
  // fires + jobs=[] + the metric shows all three zero counts.
  const capturedLog = []
  const capturedWarn = []
  console.log = (...args) => capturedLog.push(args.join(' '))
  console.warn = (...args) => capturedWarn.push(args.join(' '))
  global.fetch = async () => {
    throw new Error('down for all')
  }
  const { jobs } = await multiSourceSearchJobs({
    query: `unique-H-${SEED}`,
    location: 'Stockholm',
    limit: 20,
  })
  assert.deepEqual(jobs, [])
  const warn = capturedWarn.find((l) => l.includes('[multiSource] both sources returned empty'))
  assert.ok(warn)
  const metric = capturedLog.find((l) => l.includes('"evt":"multiSource.metric"'))
  assert.ok(metric)
  const parsed = JSON.parse(metric)
  assert.equal(parsed.af, 0)
  assert.equal(parsed.blk, 0)
  assert.equal(parsed.lj, 0)
})
