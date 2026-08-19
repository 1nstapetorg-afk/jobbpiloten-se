// tests/unit/jobbland-scraper.test.mjs
//
// Lock the public contract of lib/scrapers/jobbland.js — the
// Round-95 (2026-08-07) replacement source for the retired Blocket
// leg (Duunitori's board, which also absorbed Jobbsafari).
//
//   1. buildJobblandSearchUrl — pure function tests. No fetch,
//      deterministic.
//   2. scrapeJobblandJobs — mocked global.fetch: real `.job-card`
//      markup mapping, soft-block 403, network error, empty page.
//      Restores global.fetch after each test via test.afterEach.
//
// Run via `yarn test:unit` (the package.json script wires
// `node --test tests/unit/**`).

import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { buildJobblandSearchUrl, scrapeJobblandJobs } from '../../lib/scrapers/jobbland.js'

// Process-unique seed baked into every test's urlKey so the module-
// level `_cache` / `_negCache` cannot collide across test runs OR
// across tests within this file.
const SEED = `${Date.now()}-${Math.random().toString(36).slice(2)}`

// ---------- 1. buildJobblandSearchUrl — pure function tests ----------

test('buildJobblandSearchUrl returns null when both query and location are empty', () => {
  assert.equal(buildJobblandSearchUrl({ query: '', location: '' }), null)
  assert.equal(buildJobblandSearchUrl({ query: ' ', location: '   ' }), null)
})

test('buildJobblandSearchUrl builds `search=` query when only a query is provided', () => {
  assert.equal(
    buildJobblandSearchUrl({ query: 'lagerarbetare', location: '' }),
    'https://jobbland.se/lediga-jobb?search=lagerarbetare',
  )
})

test('buildJobblandSearchUrl builds `location=` query when only a location is provided', () => {
  assert.equal(
    buildJobblandSearchUrl({ query: '', location: 'Stockholm' }),
    'https://jobbland.se/lediga-jobb?location=Stockholm',
  )
})

test('buildJobblandSearchUrl combines search + location and percent-encodes Swedish diacritics', () => {
  // Verified live: the site's own search form submits `name="search"`
  // + `name="location"`. URLSearchParams percent-encodes å/ö/ä, which
  // the site accepts (Göteborg → G%C3%B6teborg).
  assert.equal(
    buildJobblandSearchUrl({ query: 'lagerarbetare', location: 'Göteborg' }),
    'https://jobbland.se/lediga-jobb?search=lagerarbetare&location=G%C3%B6teborg',
  )
})

// ---------- 2. scrapeJobblandJobs — mocked global.fetch ------------

// Builds a synthetic jobbland.se search page wrapping the supplied
// listing descriptors in the real `.job-card` anchor shape captured
// live on 2026-08-07 (href + data-company attrs, h3 title, <p>
// company, `.job-card__content__meta` div with "Ort · period").
function jobblandCardHtml(listings) {
  const cards = listings
    .map(
      (l) => `<a href="${l.url}" title="${l.title}" data-id="${l.dataId || '123'}" data-position="0" data-category="Test" data-variant="Test" data-company="${l.company}" class="ds-card-base ds-card-base--is-link job-card gtm-jobs-search" data-v-1>
        <div class="job-card__logo"><img src="https://example.com/logo.png" alt="${l.company} logotyp"></div>
        <div class="job-card__content">
          <h3 class="typography typography--h3" data-v-1>${l.title}</h3>
          <p class="typography typography--p" data-v-1>${l.company}</p>
          <div class="job-card__content__meta">${l.location}
            <span class="job-card__content__meta__separator">·</span>
            Ansökningsperiod 1/8 – 15/8
          </div>
          <div class="job-card__content__tags"><div class="tag-cloud"><div class="basic-tag"><span>Test</span></div></div></div>
        </div>
      </a>
      <div class="job-card__favorite-button"><button aria-label="Spara jobb" class="button">x</button></div>`,
    )
    .join('')
  return `<html><head><title>Lediga jobb - Jobbland</title></head><body><div>${cards}</div></body></html>`
}

const realFetch = global.fetch
afterEach(() => {
  global.fetch = realFetch
})

test('scrapeJobblandJobs maps a single .job-card into our internal shape', async () => {
  const html = jobblandCardHtml([
    {
      title: 'Lagerarbetare',
      url: `/jobb/lagerarbetare-test-${SEED}`,
      company: 'ACME Lager AB',
      location: 'Göteborg',
      dataId: `2026-${SEED}`,
    },
  ])
  global.fetch = async () =>
    new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })

  const jobs = await scrapeJobblandJobs({
    query: `unique-A-${SEED}`,
    location: 'Göteborg',
    limit: 20,
  })

  assert.equal(jobs.length, 1)
  const [j] = jobs
  assert.equal(j.title, 'Lagerarbetare')
  assert.equal(j.company, 'ACME Lager AB')
  assert.equal(j.location, 'Göteborg')
  assert.equal(j.municipality, 'Göteborg')
  assert.equal(j.country, 'SE')
  assert.equal(j.source, 'Jobbland')
  assert.equal(j.externalId, `2026-${SEED}`)
  // Stable id derived from the ABSOLUTE URL via the shared hashShort.
  assert.equal(j.id, `jobbland-${(await import('../../lib/utils.js')).hashShort(`https://jobbland.se/jobb/lagerarbetare-test-${SEED}`)}`)
  assert.ok(j.url.startsWith('https://jobbland.se/jobb/'), 'relative hrefs must resolve to absolute jobbland.se URLs')
})

test('scrapeJobblandJobs maps multiple cards and stops at limit', async () => {
  const listings = Array.from({ length: 5 }, (_, i) => ({
    title: `Roll ${i}`,
    url: `/jobb/roll-${i}-${SEED}`,
    company: `Co ${i}`,
    location: 'Stockholm',
  }))
  global.fetch = async () =>
    new Response(jobblandCardHtml(listings), { status: 200 })

  const jobs = await scrapeJobblandJobs({
    query: `unique-B-${SEED}`,
    location: 'Stockholm',
    limit: 3,
  })
  assert.equal(jobs.length, 3, 'limit must cap the returned page')
})

test('scrapeJobblandJobs returns [] on 403 (soft-block — no crash)', async () => {
  global.fetch = async () => new Response('forbidden', { status: 403 })
  const jobs = await scrapeJobblandJobs({
    query: `unique-C-${SEED}`,
    location: 'Stockholm',
    limit: 20,
  })
  assert.deepEqual(jobs, [])
})

test('scrapeJobblandJobs returns [] on network error (no crash)', async () => {
  global.fetch = async () => {
    throw new Error('ETIMEDOUT')
  }
  const jobs = await scrapeJobblandJobs({
    query: `unique-D-${SEED}`,
    location: 'Malmö',
    limit: 20,
  })
  assert.deepEqual(jobs, [])
})

test('scrapeJobblandJobs returns [] when response contains no .job-card markup', async () => {
  global.fetch = async () =>
    new Response('<html><body><h1>Inga jobb just nu</h1></body></html>', { status: 200 })
  const jobs = await scrapeJobblandJobs({
    query: `unique-E-${SEED}`,
    location: 'Uppsala',
    limit: 20,
  })
  assert.deepEqual(jobs, [])
})

test('scrapeJobblandJobs skips non-/jobb/ anchors (recommended/editorial cards)', async () => {
  const html = `<a href="/blogg/nyheter" data-company="Editorial" class="ds-card job-card gtm-jobs-recommended">
    <h3 class="typography">Bli chef</h3></a>` +
    jobblandCardHtml([
      { title: 'Äkta jobb', url: `/jobb/akta-${SEED}`, company: 'Real AB', location: 'Lund' },
    ])
  global.fetch = async () => new Response(html, { status: 200 })
  const jobs = await scrapeJobblandJobs({
    query: `unique-F-${SEED}`,
    location: 'Lund',
    limit: 20,
  })
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].title, 'Äkta jobb')
})
