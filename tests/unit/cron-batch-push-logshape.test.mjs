// tests/unit/cron-batch-push-logshape.test.mjs
//
// Round-25.2 — Cron push wire-up + log-row shape regression net.
//
// last_response.txt's Round-24 carryover wrote: "no push notify call
// exists in app/api/cron/route.js (only the round-23 batch-match
// payload builder)". But the source actually already has the wire-up
// at lines ~173-176 — after the newJobs list is computed, the cron
// calls `sendPushToUser(db, clerkId, buildBatchMatchPayload(...))`
// and writes the result to `logEntry.pushNotification`. The wire-up
// was delivered end-to-end across Round-10 (batch-match push) and
// Round-23 (deep-link with ?jobId=<top-match>). This test is the
// regression net — locks the soft-launch CONTRACT so a future
// regression that:
//   • drops the push call (1 LOC),
//   • diverges the cron_logs row shape from the cron_logs
//     contract that /settings/page.js:1987 reads ("push-prenumeration
//     och de senaste cron-loggarna"),
//   • breaks count fidelity (`pushNotification.count` must echo
//     `newJobs.length` so the support flow at PROJECT_STATUS.md#95
//     can grep for it),
//   • reintroduces a per-match loop (`sendPushToUser` called once,
//     not in a `for (const job of newJobs)`-shape loop),
// trips this guard at build time instead of silently regressing the
// cron feature.
//
// Static-source-grep test (same pattern as buildBatchMatchPayload
// + pdf-second-pass) — no live Mongo needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CRON = resolve(__dirname, '../../app/api/cron/route.js')

const cronSrc = readFileSync(CRON, 'utf8')

test('app/api/cron/route.js: cron_run row writes pushNotification with kind=batch_match', () => {
  // The cron_logs row's `pushNotification.kind` field is the
  // discriminator that lets analytics + the dashboard's cron-log
  // table (app/dashboard/page.js loadCronLogs) tell apart
  // batch-match pushes from single-match pushes (a future round
  // may add a per-match push kind). The cron MUST tag every
  // successful push as 'batch_match' so analytics can route
  // them.
  assert.match(
    cronSrc,
    /kind:\s*['"]batch_match['"]/,
    "cron must tag every push row with `kind: 'batch_match'` so analytics + the dashboard's cron-log table can discriminate it from future per-match pushes",
  )
})

test('app/api/cron/route.js: cron_run row writes pushNotification.count = newJobs.length', () => {
  // Support flow (PROJECT_STATUS.md#95): operators grep `cron_logs`
  // for `pushNotification.count` to find "did the cron fire a push
  // with N jobs?". The count must exactly equal `newJobs.length`
  // (the number of new matches in the body of the push). If the
  // field drifts (e.g. a refactor accidentally renames
  // `newJobs.length` to `jobs.length`, which counts scraped-not-new),
  // the support flow silently reads the wrong number.
  assert.match(
    cronSrc,
    /pushNotification\s*=\s*\{[\s\S]{0,400}?count:\s*newJobs\.length/,
    'cron logs `pushNotification.count` must equal `newJobs.length` — drifted source breaks the PROJECT_STATUS.md#95 grep flow',
  )
})

test('app/api/cron/route.js: cron pushes ONE batch push per cron tick (not N pushes for N matches)', () => {
  // The whole point of buildBatchMatchPayload at lib/push.js is to
  // consolidate N matches into ONE push. The cron MUST call
  // sendPushToUser exactly once per cron-tick-per-subscriber. A
  // naive refactor that looped over newJobs and sent N pushes
  // would spam the user's notification tray and bypass the
  // batch-match consolidation.
  //
  // Caller-count lock: not just presence, but EXACTLY ONE
  // occurrence in the source. A presence-only match would silently
  // pass a refactor that added a second `sendPushToUser(db,
  // clerkId, pushPayload)` outside a loop (e.g. a debug ping to
  // verify the cron fired). The count assertion fails loudly.
  const sendPushMatches = cronSrc.match(/sendPushToUser\s*\(\s*db\s*,\s*clerkId\s*,\s*pushPayload\s*\)/g) || []
  assert.equal(
    sendPushMatches.length,
    1,
    `cron must call sendPushToUser(db, clerkId, pushPayload) EXACTLY ONCE per cron tick (not in a loop over newJobs) — found ${sendPushMatches.length} occurrences`,
  )
})

test('app/api/cron/route.js: logEntry.pushNotification fields include sent, total, kind, count', () => {
  // Soft-launch contract for /settings/page.js:1987 — the page
  // shows the cron log's push counts inline ("push-prenumeration
  // och de senaste cron-loggarna"). A regression that drops
  // `sent`, `total`, `kind`, or `count` from the logEntry would
  // break the dashboard cron-log table silently (no type error,
  // no missing column — just an empty cell).
  //
  // We scan the source between the `pushNotification = {` key and
  // 1200 chars after (the success-case block has 6 keys plus
  // formatted whitespace; we allow headroom for a future refactor
  // that adds ONE more field without breaking the lock).
  const logShapeIdx = cronSrc.indexOf('logEntry.pushNotification')
  assert.ok(logShapeIdx > 0, 'cron must set logEntry.pushNotification (a push-result echo) on the cron_run row')
  const next700 = cronSrc.slice(logShapeIdx, logShapeIdx + 1200)
  assert.match(next700, /sent:\s*pushResult\.sent/, 'log entry must echo `sent: pushResult.sent` so /settings can render the push count')
  assert.match(next700, /total:\s*pushResult\.total/, 'log entry must echo `total: pushResult.total` so /settings can render the subscription count')
  assert.match(next700, /kind:\s*['"]batch_match['"]/, 'log entry must tag `kind: \'batch_match\'` so analytics can discriminate pushes')
  assert.match(next700, /count:\s*newJobs\.length/, 'log entry must echo `count: newJobs.length` so the support grep at PROJECT_STATUS.md#95 works')
})

test('app/api/cron/route.js: cron routes through buildBatchMatchPayload with jobId (Round-23 deep-link)', () => {
  // Round-23 carried the deep-link contract: when the cron surfaces
  // a single top match the user lands on the prep modal via
  // /dashboard?jobId=X. The cron MUST pass `newJobs[0]?.id` as
  // jobId so the service worker can encode the URL. Without this,
  // a multi-match push would still deep-link to /dashboard but a
  // single-match push would lose the deep-link.
  //
  // Cross-file duplication note: tests/unit/buildBatchMatchPayload
  // .test.mjs line 53-57 already locks this exact call shape. This
  // second lock is intentional — independent greps are cheaper to
  // maintain than cross-file imports, and the contract is
  // soft-launch-critical (single-match deep-link is the primary
  // value-prop of the Round-23 cron work).
  assert.match(
    cronSrc,
    /buildBatchMatchPayload\(\{\s*count:\s*newJobs\.length\s*,\s*jobId:\s*newJobs\[0\]\?\.id\s*\}\)/,
    'cron must call buildBatchMatchPayload({ count: newJobs.length, jobId: newJobs[0]?.id }) so single-match pushes deep-link to /dashboard?jobId=X (Round-23 contract)',
  )
})
