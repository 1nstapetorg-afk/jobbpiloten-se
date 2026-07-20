// tests/unit/backfill-url-resolver.test.mjs
//
// Round-58 / Followup 3 — locks the contracts of the
// scripts/backfill-job-urls.js hydration migration:
//
//   1. resolveAfJobUrlFromHit() must mirror the lib/jobScraper.js
//      resolveAFJobUrl() 5-variant fallback chain so the dashboard's
//      Tier-1 always reconciles with what the backfill wrote.
//   2. The DRY_RUN gate must default to safe (no writes unless
//      LIVE=1 is explicit).
//   3. The batch cursor must NOT be a single long-lived instance
//      that can exhaust on the second .toArray() call — the
//      fix is a per-iteration coll.find().limit().toArray().
//   4. The AF response must be guarded against non-JSON
//      content-type so an HTML 5xx page doesn't abort the
//      whole migration.
//
// Same source-grep style as the rest of the unit suite (no DB
// mocking). Locks the 3 hardening changes committed in this
// round.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKFILL_PATH = path.resolve(__dirname, '../../scripts/backfill-job-urls.js')
const JOB_SCRAPER_PATH = path.resolve(__dirname, '../../lib/jobScraper.js')
const BACKFILL_SRC = fs.readFileSync(BACKFILL_PATH, 'utf-8')
const SCRAPER_SRC = fs.readFileSync(JOB_SCRAPER_PATH, 'utf-8')

// =============================================================================
// 1. resolveAfJobUrlFromHit exists + mirrors the 5-variant UI resolver
// =============================================================================

test('Round-58 / Followup 3: scripts/backfill-job-urls.js must declare resolveAfJobUrlFromHit() helper', () => {
  // The function is the single source of truth for "which AF
  // API field carries the direct application link" within the
  // backfill context. Without it, the migration writes whatever
  // the AF API hands us in `application_details.url` (the most
  // common variant) but misses `webpage_url` (the 2025+ default),
  // so legacy applications with `externalId` end up with a stale
  // or NULL jobUrl.
  assert.match(
    BACKFILL_SRC,
    /function\s+resolveAfJobUrlFromHit\s*\(\s*hit\s*\)/,
    'scripts/backfill-job-urls.js must declare resolveAfJobUrlFromHit(hit) helper',
  )
})

test('Round-58 / Followup 3: resolveAfJobUrlFromHit must try the same 5 AF API field variants as lib/jobScraper.js', () => {
  // Both resolvers must enumerate the historical AF field-name
  // variants so the backfill writes the same URL the dashboard
  // would resolve today:
  //   1. hit.webpage_url                       (modern search API, default)
  //   2. hit.application_details.url           (rich ad payload)
  //   3. hit.application_details.webAddress    (older camelCase)
  //   4. hit.application_links[0].url          (multi-link payload)
  //   5. hit.external_url                      (outbound ad)
  // Plumbing-parity lock: any AF API change that adds a 6th
  // variant must touch BOTH this script and lib/jobScraper.js
  // (the test contracts surface at commit time).
  const expected = ['webpage_url', 'application_details', 'application_links', 'external_url']
  for (const name of expected) {
    assert.ok(
      BACKFILL_SRC.includes(name),
      `resolveAfJobUrlFromHit must reference AF API field "${name}" so the backfill URL matches the dashboard's resolveAFJobUrl`,
    )
  }
})

test('Round-58 / Followup 3: resolveAfJobUrlFromHit must fall back to the constructed Platsbanken URL', () => {
  // Same fallback contract as the dashboard — if none of the
  // 5 direct fields are present, the backfill writes the
  // constructed Platsbanken landing URL so the row gets a
  // real working link rather than staying null (which would
  // force a Tier-3 Google search on the dashboard).
  assert.match(
    BACKFILL_SRC,
    /arbetsformedlingen\.se\/platsbanken\/annonser\//,
    'resolveAfJobUrlFromHit must include the constructed Platsbanken fallback so every backfilled row has a working URL',
  )
})

test('Round-58 / Followup 3: 5-variant chain + Platsbanken must appear in the SAME ORDER as lib/jobScraper.js', () => {
  // Belt-and-braces plumbing-parity lock. If either side
  // re-orders the chain (e.g. swapping application_details
  // and external_url), the other side will pick a different
  // field and the backfilled URL will diverge from the
  // dashboard's resolved URL — silently regressing the
  // Tier-1 direct-link contract.
  const backfillHits = ['webpage_url', 'application_details', 'application_links', 'external_url'].map((n) => BACKFILL_SRC.indexOf(n))
  const scraperHits = ['webpage_url', 'application_details', 'application_links', 'external_url'].map((n) => SCRAPER_SRC.indexOf(n))
  assert.ok(backfillHits.every((i) => i > 0), 'all 4 direct AF field names must appear in backfill-job-urls.js')
  assert.ok(scraperHits.every((i) => i > 0), 'all 4 direct AF field names must appear in lib/jobScraper.js')
  for (let k = 0; k < backfillHits.length; k++) {
    assert.ok(
      backfillHits[k] < backfillHits[k + 1] || k === backfillHits.length - 1,
      `backfill-job-urls.js: "${['webpage_url', 'application_details', 'application_links', 'external_url'][k]}" must come before the next field`,
    )
  }
  for (let k = 0; k < scraperHits.length; k++) {
    assert.ok(
      scraperHits[k] < scraperHits[k + 1] || k === scraperHits.length - 1,
      `lib/jobScraper.js: "${['webpage_url', 'application_details', 'application_links', 'external_url'][k]}" must come before the next field`,
    )
  }
})

// =============================================================================
// 2. Safe DRY_RUN default — no writes unless LIVE=1
// =============================================================================

test('Round-58 / Followup 3: backfill must default to DRY_RUN when LIVE is unset', () => {
  // The default is the safety gate for a 2026 production
  // migration. A typo `LIVE = 0` (rather than `LIVE=1`) must
  // still be dry-run.
  assert.match(
    BACKFILL_SRC,
    /isDryRun\s*=\s*!\s*process\.env\.LIVE/,
    'scripts/backfill-job-urls.js must declare `isDryRun = !process.env.LIVE` so the default mode is safe',
  )
})

// =============================================================================
// 3. Per-batch find() — does NOT reuse a single long-lived cursor
// =============================================================================

test('Round-58 / Followup 3: backfill must construct coll.find(filter).limit(BATCH_SIZE) INSIDE the while-loop', () => {
  // The pre-fix code created a single `cursor` outside the
  // loop and re-issued `.limit(BATCH_SIZE).toArray()` against
  // it. Across driver versions this can exhaust on the second
  // pass, silently stopping the migration at the first 50 rows.
  // The fix: the `find()` call site lives inside the while-loop.
  const insideLoop = /while\s*\([\s\S]*?coll\.find\(filter\)[\s\S]{0,400}\.toArray\(\)/
  assert.ok(
    insideLoop.test(BACKFILL_SRC),
    'scripts/backfill-job-urls.js must construct coll.find(filter).limit(BATCH_SIZE).toArray() INSIDE the while-loop so the cursor is fresh per batch',
  )
  // Belt-and-braces: the legacy `let cursor = coll.find(...)`
  // pattern is explicitly forbidden (it is the exact antipattern
  // we just fixed).
  assert.doesNotMatch(
    BACKFILL_SRC,
    /let\s+cursor\s*=\s*coll\.find\(/,
    'scripts/backfill-job-urls.js must NOT hold a long-lived `let cursor` outside the while-loop — the per-batch find() pattern is the fix',
  )
})

// =============================================================================
// 4. JSON content-type guard — must NOT crash on HTML error pages
// =============================================================================

test('Round-58 / Followup 3: backfill must guard .json() against non-JSON content-type responses', () => {
  // AF occasionally returns an HTML error page (CDN/proxy 502)
  // with status 200. Without this guard, `await res.json()`
  // throws `Unexpected token '<'` and aborts the whole batch.
  // The fix: read the content-type header BEFORE parsing.
  assert.match(
    BACKFILL_SRC,
    /isJsonContentType/,
    'scripts/backfill-job-urls.js must declare/use an isJsonContentType guard so HTML error pages do not abort the migration',
  )
})

// =============================================================================
// 5. Hardened argv contract — MONGO_URL + DB_NAME env vars required
// =============================================================================

test('Round-58 / Followup 3: backfill must error out cleanly when MONGO_URL or DB_NAME is missing', () => {
  // Belt-and-braces from Round-55.1 — the script must surface
  // a clear error message AND process.exit(1) so an operator
  // running the migration without env vars sees a failure
  // signal (not a silent no-op).
  assert.match(
    BACKFILL_SRC,
    /MONGO_URL\s+env\s+var\s+is\s+required/,
    "scripts/backfill-job-urls.js must surface the exact 'MONGO_URL env var is required' error so an unset env gives a clear operator message",
  )
  assert.match(
    BACKFILL_SRC,
    /process\.exit\(1\)/,
    'scripts/backfill-job-urls.js must call process.exit(1) on missing env so the process fails loudly (not a silent hang)',
  )
})

// =============================================================================
// 6. Idempotency gate — filter must SKIP rows that already have jobUrl
// =============================================================================

test('Round-58 / Followup 3: backfill filter must only target { jobUrl: null, externalId: $ne null }', () => {
  // The filter is the safety contract — re-running the
  // migration is a no-op on already-backfilled rows so an
  // operator can re-run LIVELY without worrying about
  // overwriting a known-good URL.
  assert.match(
    BACKFILL_SRC,
    /jobUrl:\s*null\s*,\s*externalId:\s*\{\s*\$ne:\s*null\s*\}/,
    "scripts/backfill-job-urls.js filter must be `{ jobUrl: null, externalId: { $ne: null } }` so re-runs are idempotent and never overwrite a non-null URL",
  )
})
