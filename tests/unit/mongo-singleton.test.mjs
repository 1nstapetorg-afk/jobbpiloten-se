// tests/unit/mongo-singleton.test.mjs
//
// Round-80 regression locks for the shared Mongo singleton (lib/mongo.js).
//
// Background: every API route previously carried its own copy of
//
//   let clientPromise;
//   if (!global._mongoClientPromise) {
//     const client = new MongoClient(...);
//     global._mongoClientPromise = client.connect();
//   }
//   clientPromise = global._mongoClientPromise;
//
// That shape cached the RESULT of `client.connect()` on `global`. When
// Mongo was down at module load the promise REJECTED, and the cached
// rejection was never cleared — every later request awaited the same
// rejected promise and 500'd instantly, even after Mongo recovered
// (the driver's background topology monitor reconnects, but the wrapper
// promise stayed rejected until a full server restart). Observed live:
// /api/health went from a legitimate Mongo-down 500 to a permanent
// 0.08s 500.
//
// These locks pin the replacement contract:
//   1. lib/mongo.js is the single Mongo entry point (exports getDb).
//   2. The cached connect-promise self-heals: the .catch clears the
//      cache so the next request retries with a fresh connect.
//   3. The client is held on `global` (not module scope) so dev-mode
//      hot-reloads of lib/mongo.js don't leak a new client + pool.
//   4. No API route still carries the old poisoned singleton pattern,
//      and every route resolves the db via `@/lib/mongo`.
//
// Structural-grep style matches the repo's existing lock tests (e.g.
// tests/unit/site-config-defaults.test.mjs, popup-resolver.test.mjs).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MONGO_LIB = join(ROOT, 'lib', 'mongo.js')
const API_DIR = join(ROOT, 'app', 'api')

const mongoSrc = readFileSync(MONGO_LIB, 'utf8')

function* walkApiRoutes(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* walkApiRoutes(full)
    } else if (entry === 'route.js') {
      yield full
    }
  }
}

const routeFiles = [...walkApiRoutes(API_DIR)]

test('Round-80: lib/mongo.js exists and exports getDb as a function', () => {
  assert.match(mongoSrc, /export async function getDb\(\)/, 'lib/mongo.js must export getDb()')
})

test('Round-80: lib/mongo.js keeps the client on `global` (hot-reload leak guard)', () => {
  assert.match(mongoSrc, /global\._jobbpilotenMongoClient/, 'client must be cached on global')
})

test('Round-80: the cached connect-promise self-heals on rejection', () => {
  // The .catch must clear the cached promise so a transient Mongo
  // outage can't poison the singleton for the rest of the process.
  assert.match(
    mongoSrc,
    /connect\(\)\.catch\(\(err\) => \{[\s\S]*?connectPromise = null[\s\S]*?throw err/,
    'connect() must be wrapped in a .catch that clears the cached promise and rethrows',
  )
})

test('Round-80: no API route still carries the poisoned singleton pattern', () => {
  const offenders = []
  for (const file of routeFiles) {
    const src = readFileSync(file, 'utf8')
    if (/global\._mongoClientPromise/.test(src)) {
      offenders.push(`${file}: global._mongoClientPromise`)
    }
    if (/new MongoClient\(/.test(src)) {
      offenders.push(`${file}: new MongoClient(`)
    }
    if (/\blet clientPromise\b/.test(src)) {
      offenders.push(`${file}: let clientPromise`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `the old poisoned singleton must not survive in any route file:\n${offenders.join('\n')}`,
  )
})

test('Round-80: every Mongo-touching API route resolves the db via @/lib/mongo', () => {
  // Routes that never touch Mongo (cv-ocr 501 stub, extension/download
  // zip server, track beacon, cv-enhance pure-Groq call) legitimately
  // have no import — only require it where `collection(` is used.
  const missing = routeFiles.filter((f) => {
    const src = readFileSync(f, 'utf8')
    const touchesMongo = /\.collection\(/.test(src)
    return touchesMongo && !/from ['"]@\/lib\/mongo['"]/.test(src)
  })
  assert.deepEqual(
    missing,
    [],
    `every Mongo-touching route must import getDb from '@/lib/mongo':\n${missing.join('\n')}`,
  )
})

test('Round-80: cron keeps its push_subscriptions index wrapper around the shared db', () => {
  const cronSrc = readFileSync(join(API_DIR, 'cron', 'route.js'), 'utf8')
  assert.match(
    cronSrc,
    /getDb as getSharedDb/,
    'cron must import the shared helper under an alias so its local getDb can wrap it',
  )
  assert.match(
    cronSrc,
    /const db = await getSharedDb\(\)/,
    'cron getDb must delegate to the shared helper',
  )
  assert.match(
    cronSrc,
    /createIndex\([\s\S]*?idx_clerkId_active/,
    'cron must still ensure the push_subscriptions compound index',
  )
})
