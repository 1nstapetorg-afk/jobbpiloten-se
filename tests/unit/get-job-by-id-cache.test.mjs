// tests/unit/get-job-by-id-cache.test.mjs
//
// Lock the Round-20 LRU carve-out on lib/jobScraper#getJobById:
//   1. Sequential identical calls coalesce into one network fetch.
//   2. Concurrent identical calls coalesce into one in-flight Promise.
//   3. Concurrent DIFFERENT ids still each fire one fetch (no cross-id
//      poll).
//   4. A 404-equivalent AF response (res.ok=false) is cached as null —
//      a second call within TTL short-circuits, not retries.
//   5. A caught network error is also mapped to null + cached the same
//      way (single contract for the dashboard, regardless of cause).
//
// SEED pattern at the top mirrors tests/unit/ledigajobb-scraper.test.mjs
// so each test's jobId is unique — module-level cache + in-flight Maps
// never collide across the suite. Run via `yarn test:unit`.

import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { getJobById } from '../../lib/jobScraper.js'

const SEED = `${Date.now()}-${Math.random().toString(36).slice(2)}`

// A minimal AF-shaped hit; just enough to round-trip mapAFJob without
// throwing. Real fixtures don't matter for the cache contract — the
// mappers are tested elsewhere.
const buildAFHit = (id) => ({
  id,
  headline: `Cached job ${id}`,
  employer: { name: 'Cached Co' },
  workplace_address: { municipality: 'Stockholm', country: 'SE' },
  description: { text: 'cached body' },
  webpage_url: `https://example.com/${id}`,
})

// Save + restore global.fetch so a single failing test doesn't poison
// the rest of the suite. Module-level `_jobByIdCache`/`_jobByIdInFlight`
// are isolated by SEED-unique jobIds, not by reset.
const realFetch = global.fetch
const realError = console.error
afterEach(() => {
  global.fetch = realFetch
  // Swallow the [jobScraper] getJobById error logs the wrapper emits on
  // 404 + network-error paths so the test output stays clean.
  console.error = realError
})

test('getJobById issues exactly one fetch on the first call and returns the parsed job', async () => {
  let fetchCount = 0
  global.fetch = async () => {
    fetchCount += 1
    return new Response(JSON.stringify(buildAFHit(`A-${SEED}`)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  // Suppress console.error so the success path doesn't print anything.
  console.error = () => {}
  const job = await getJobById(`A-${SEED}`)
  assert.equal(fetchCount, 1, 'first call must hit the network')
  assert.equal(job?.id, `af-A-${SEED}`)
  assert.equal(job?.company, 'Cached Co')
})

test('getJobById serves the second identical call from cache (no second fetch)', async () => {
  let fetchCount = 0
  global.fetch = async () => {
    fetchCount += 1
    return new Response(JSON.stringify(buildAFHit(`B-${SEED}`)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  console.error = () => {}
  const jobId = `B-${SEED}`
  const first = await getJobById(jobId)
  const second = await getJobById(jobId)
  assert.equal(fetchCount, 1, 'second identical call within TTL must NOT hit the network')
  assert.deepEqual(first, second)
  // Cache key sanity — returned object identity may differ but the
  // shape is the same (the LRU stores a snapshot, not a ref).
  assert.equal(first?.id, second?.id)
  assert.equal(first?.title, second?.title)
})

test('getJobById coalesces concurrent identical calls into one in-flight fetch', async () => {
  let fetchCount = 0
  let resolveFirst
  global.fetch = async () => {
    fetchCount += 1
    return new Promise((resolve) => {
      resolveFirst = resolve
    })
  }
  console.error = () => {}
  const jobId = `C-${SEED}`
  // Launch three callers BEFORE the first fetch resolves — they all
  // share the same in-flight Promise. This is the single-flight
  // contract that React StrictMode's double-invocation exercises in
  // dev, AND the user double-clicking a push deep-link can trigger
  // in production.
  const p1 = getJobById(jobId)
  const p2 = getJobById(jobId)
  const p3 = getJobById(jobId)
  assert.equal(fetchCount, 1, 'three concurrent identical callers must launch ONE fetch')
  // Resolve the in-flight fetch and confirm all three callers get the
  // same mapped job back.
  resolveFirst(new Response(JSON.stringify(buildAFHit(jobId)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  const [j1, j2, j3] = await Promise.all([p1, p2, p3])
  assert.equal(j1?.id, j2?.id)
  assert.equal(j2?.id, j3?.id)
  assert.equal(j1?.id, `af-${jobId}`)
})

test('getJobById caches a 404-equivalent (res.ok=false) as null within TTL', async () => {
  let fetchCount = 0
  global.fetch = async () => {
    fetchCount += 1
    return new Response('not found', { status: 404 })
  }
  console.error = () => {}
  const jobId = `D-${SEED}`
  const first = await getJobById(jobId)
  const second = await getJobById(jobId)
  assert.equal(first, null, '404 must map to null')
  assert.equal(second, null, 'second call within TTL must serve the cached null (no second fetch)')
  assert.equal(fetchCount, 1, 'a 404-equivalent must NOT trigger a second network round-trip')
})

test('getJobById maps a network error to null + caches it just like a 404', async () => {
  let fetchCount = 0
  global.fetch = async () => {
    fetchCount += 1
    throw new Error('ETIMEDOUT')
  }
  console.error = () => {}
  const jobId = `E-${SEED}`
  const first = await getJobById(jobId)
  const second = await getJobById(jobId)
  assert.equal(first, null, 'caught network error must map to null')
  assert.equal(second, null, 'second call within TTL must serve the cached null')
  assert.equal(fetchCount, 1, 'a network error must NOT trigger a second round-trip within TTL')
})

test('getJobById fires independent fetches for distinct ids (no cross-id staleness)', async () => {
  const seen = []
  global.fetch = async (url) => {
    const s = String(url)
    seen.push(s)
    // Pull the trailing id off `/<jobId>` of the AF base path.
    const jobId = s.split('/').pop()
    return new Response(JSON.stringify(buildAFHit(jobId)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  console.error = () => {}
  const ids = [`X1-${SEED}`, `X2-${SEED}`, `X3-${SEED}`]
  const jobs = await Promise.all(ids.map((id) => getJobById(id)))
  assert.equal(seen.length, 3, 'three distinct ids must launch three independent fetches')
  // Each returned job corresponds to the requested id — no cross-id
  // staleness.
  assert.deepEqual(
    jobs.map((j) => j?.id),
    ids.map((id) => `af-${id}`),
  )
})
