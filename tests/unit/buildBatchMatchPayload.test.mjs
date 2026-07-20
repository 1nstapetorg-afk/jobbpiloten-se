// tests/unit/buildBatchMatchPayload.test.mjs
//
// Round-23 cron push deep-link regression net — locks the round-23
// extension to lib/push.js#buildBatchMatchPayload so a future regression
// that drops jobId from the payload, hardcodes url='/dashboard', or
// stops passing jobId from the cron fails the build.
//
// Note: this test uses STATIC-SOURCE pattern matching (regex on the
// raw file), NOT ESM import. lib/push.js does
// `import { PUSH_VAPID_FALLBACK_SUBJECT } from './siteConfig'` (bare
// relative — fine for Next.js's webpack bundler, but raw Node's
// strict ESM resolver rejects it). The same static-source pattern is
// already used in tests/unit/no-debug-joburl-logs.test.mjs and
// tests/unit/round23-dashboard-cleanup.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUSH = resolve(__dirname, '../../lib/push.js')
const CRON = resolve(__dirname, '../../app/api/cron/route.js')

const pushSrc = readFileSync(PUSH, 'utf8')
const cronSrc = readFileSync(CRON, 'utf8')

test('lib/push.js: buildBatchMatchPayload signature accepts `{ count, jobId }`', () => {
  assert.match(
    pushSrc,
    /export\s+function\s+buildBatchMatchPayload\(\{\s*count\s*,\s*jobId\s*\}\)/,
    'signature must destructure count AND jobId so a future regression that drops jobId fails loudly',
  )
})

test('lib/push.js: url deep-links to /dashboard?jobId=<encoded> when jobId is present', () => {
  // The canonical form is: `url: jobId ? `/dashboard?jobId=${encodeURIComponent(jobId)}` : '/dashboard'`
  assert.match(
    pushSrc,
    /url:\s*jobId\s*\?\s*`\/dashboard\?jobId=\$\{encodeURIComponent\(jobId\)\}`\s*:\s*'\/dashboard'/,
    'must use encodeURIComponent for safe URL composition (Round-23 cron wire-up)',
  )
})

test('lib/push.js: payload exposes `jobId: jobId || null` field', () => {
  assert.match(
    pushSrc,
    /jobId:\s*jobId\s*\|\|\s*null/,
    'must expose jobId at the payload root so the service worker can read it independently of the URL shape',
  )
})

test('app/api/cron/route.js: passes jobId to buildBatchMatchPayload (top match)', () => {
  assert.match(
    cronSrc,
    /buildBatchMatchPayload\(\{\s*count:\s*newJobs\.length\s*,\s*jobId:\s*newJobs\[0\]\?\.id\s*\}\)/,
    'cron must pass the top matched job id so the push notification deep-links to /dashboard?jobId=X',
  )
})
