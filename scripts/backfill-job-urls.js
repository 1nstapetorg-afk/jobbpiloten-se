/**
 * Round-55 / Bug 2 backfill — applications.jobUrl hydration.
 *
 * Context: the dashboard's `resolveApplicationUrl()` resolver already
 * has a 3-tier chain (direct jobUrl → Platsbanken from externalId →
 * Google-search fallback). The pre-Round-55 complaint was that
 * users see "Sök jobbet" → Google search because the underlying
 * applications have `jobUrl: null` AND `externalId: null`.
 *
 * Root cause: legacy applications were created via the SAMPLE_JOBS
 * fallback path (Round-22 era) which never had a real URL. Round-46's
 * apply-now schema change persisted `jobUrl: job.url || null` but
 * the migration never re-populated the legacy rows. This script
 * walks the applications collection, fetches each row's AF ad by
 * `externalId`, and writes the resolved `webpage_url` back to
 * `jobUrl` so the next dashboard render shows the real link.
 *
 * Usage:
 *   MONGO_URL=mongodb://... DB_NAME=jobbpiloten node scripts/backfill-job-urls.js
 *   # or via the existing migrate pattern:
 *   npm run migrate:job-urls
 *   # default mode is dry-run. To actually write, set LIVE=1:
 *   LIVE=1 MONGO_URL=... DB_NAME=... node scripts/backfill-job-urls.js
 *
 * Idempotent: re-running is a no-op because the filter only
 * matches rows still missing jobUrl.
 */

const { MongoClient } = require('mongodb')

const AF_API_BASE = 'https://jobsearch.api.jobtechdev.se/search'
const COLLECTION = 'applications'
const AF_FETCH_TIMEOUT_MS = 6000
const BATCH_SIZE = 50
const RATE_LIMIT_DELAY_MS = 250 // 4 req/sec — well below AF's 10/sec cap

const isDryRun = !process.env.LIVE
const isVerbose = !!process.env.VERBOSE

// Round-58 / Followup 3 — production hardening: the AF API
// occasionally returns HTML error pages (502 from an upstream
// proxy, 5xx with text/html) when its cache is cold or a
// CDN node is down. Parsing those as JSON blows up with
// `Unexpected token '<'` and aborts the entire migration.
// Guard BEFORE `.json()` so a single bad response becomes a
// miss, not a global abort. Also early-return on res.ok so
// 404 / 410 from AF don't pollute the success counters.
const CONTENT_TYPE_JSON = 'application/json'
function isJsonContentType(contentType) {
  return String(contentType || '').toLowerCase().includes(CONTENT_TYPE_JSON)
}

/**
 * Resolve the canonical job URL from a single AF ad.
 * Mirrors the resolver in lib/jobScraper.js#resolveAFJobUrl so the
 * backfill writes the same URL the dashboard would resolve today.
 */
function resolveAfJobUrlFromHit(hit) {
  if (!hit) return null
  const applicationDetails = hit.application_details || {}
  const applicationLinks = Array.isArray(hit.application_links) ? hit.application_links : []
  const fallback = hit.id ? `https://arbetsformedlingen.se/platsbanken/annonser/${hit.id}` : null
  return (
    hit.webpage_url ||
    applicationDetails.url ||
    applicationDetails.webAddress ||
    (applicationLinks[0] && applicationLinks[0].url) ||
    hit.external_url ||
    fallback ||
    null
  )
}

async function fetchAfAd(externalId) {
  const url = `${AF_API_BASE}/${encodeURIComponent(externalId)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), AF_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    })
    if (!res.ok) {
      if (isVerbose) console.warn(`[backfill] ${externalId}: AF returned ${res.status}`)
      return null
    }
    // Round-58 / Followup 3 — JSON content-type guard. A 200
    // response with text/html body (CDN/proxy error page) is
    // a valid AF result shape-wise but unsafe to JSON.parse.
    // Treat it as a miss so the row stays for re-runs.
    if (!isJsonContentType(res.headers.get('content-type'))) {
      if (isVerbose) console.warn(`[backfill] ${externalId}: AF returned non-JSON content-type "${res.headers.get('content-type')}"`)
      return null
    }
    const hit = await res.json()
    return resolveAfJobUrlFromHit(hit)
  } catch (err) {
    if (isVerbose) console.warn(`[backfill] ${externalId}: fetch failed (${err.message || err})`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const mongoUrl = process.env.MONGO_URL
  const dbName = process.env.DB_NAME
  if (!mongoUrl) {
    console.error('Error: MONGO_URL env var is required')
    console.error('Usage: MONGO_URL=mongodb://... DB_NAME=jobbpiloten node scripts/backfill-job-urls.js')
    process.exit(1)
  }
  if (!dbName) {
    console.error('Error: DB_NAME env var is required')
    process.exit(1)
  }

  const client = new MongoClient(mongoUrl)
  try {
    await client.connect()
    const db = client.db(dbName)
    const coll = db.collection(COLLECTION)

    // The filter is the key idempotency gate: rows already with a
    // jobUrl are skipped. externalId IS NOT NULL filters out
    // SAMPLE_JOBS-derived rows (no real id) and any other non-AF
    // source whose jobUrl is genuinely unknowable.
    const filter = { jobUrl: null, externalId: { $ne: null } }
    const totalCandidates = await coll.countDocuments(filter)
    console.log(`Backfill ${isDryRun ? '(DRY RUN) ' : ''}summary:`)
    console.log(`  Collection:   ${COLLECTION}`)
    console.log(`  Database:     ${dbName}`)
    console.log(`  Filter:       { jobUrl: null, externalId: { $ne: null } }`)
    console.log(`  Candidates:   ${totalCandidates}`)
    if (totalCandidates === 0) {
      console.log('No applications need backfilling. Done.')
      return
    }
    if (isDryRun) {
      console.log('DRY RUN: no documents will be modified. Re-run with LIVE=1 to apply.')
    }

    // Walk the candidates in batches with a polite rate-limit
    // between AF round-trips. We do per-row upserts (not a bulk
    // write) so a single AF 404 / 5xx doesn't poison the whole batch.
    //
    // Round-58 / Followup 3 — cursor bug fix. The pre-fix code held
    // a single `cursor` instance across the while-loop and re-issued
    // `.limit(BATCH_SIZE).toArray()` against it. That pattern is
    // fragile across driver versions: the first `.toArray()` may
    // exhaust the underlying server-side cursor on some Mongo
    // releases, after which the second pass returns [] and the
    // script silently exits with only the first batch processed.
    // The robust pattern is to construct a fresh `find().limit()`
    // per loop iteration. Since `updateOne` writes `jobUrl` to a
    // matching row, the `{ jobUrl: null }` filter naturally drops
    // it from the next batch.
    let processed = 0
    let backfilled = 0
    let skipped = 0
    let errors = 0
    let batch = []
    while ((batch = await coll.find(filter).project({ externalId: 1, _id: 1 }).limit(BATCH_SIZE).toArray()).length > 0) {
      for (const row of batch) {
        processed += 1
        const externalId = row.externalId
        const jobUrl = await fetchAfAd(externalId)
        if (!jobUrl) {
          skipped += 1
          continue
        }
        if (!isDryRun) {
          try {
            await coll.updateOne({ _id: row._id }, { $set: { jobUrl, jobUrlBackfilledAt: new Date() } })
            backfilled += 1
          } catch (e) {
            errors += 1
            if (isVerbose) console.warn(`[backfill] ${externalId}: updateOne failed (${e.message || e})`)
          }
        } else {
          backfilled += 1
        }
        await delay(RATE_LIMIT_DELAY_MS)
      }
      console.log(`  Progress: ${processed}/${totalCandidates} processed, ${backfilled} backfilled, ${skipped} skipped, ${errors} errors`)
    }
    console.log(`\nFinal ${isDryRun ? '(DRY RUN) ' : ''}result:`)
    console.log(`  Processed:   ${processed}`)
    console.log(`  Backfilled:  ${backfilled}`)
    console.log(`  Skipped:     ${skipped} (AF returned null)`)
    console.log(`  Errors:      ${errors}`)
  } catch (err) {
    console.error('Backfill failed:', err.message)
    process.exitCode = 1
  } finally {
    await client.close()
  }
}

main()
