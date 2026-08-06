// tests/unit/round89-waitlist.test.mjs
//
// Round-89 — contract tests for /api/waitlist (landing-page waitlist).
//
// Why a vm harness (same pattern as round88-stripe-webhook): the route
// imports `next/server` (NextResponse), which throws outside a request
// scope in plain Node. We evaluate the route source with the imported
// names supplied as sandbox globals — the REAL zod validator, a mocked
// getDb (collection spy), and a mocked resolveClerkId — so the
// validation + upsert + admin-gate behavior runs end-to-end without a
// server or MongoDB.
//
// Contract under test:
//   1. POST valid email        → 201, normalized (lowercased) write with
//                                { email, createdAt: Date, source: 'landing' }
//                                via $setOnInsert + upsert
//   2. POST duplicate          → 409 (upsertedCount 0), no second write
//   3. POST invalid email      → 400, zero DB calls
//   4. POST non-JSON body      → 400
//   5. GET admin               → 200 entries list
//   6. GET non-admin           → 403
//   7. GET unauthenticated     → 401
//
// Network-safety: no real Mongo / network ever fires — getDb is a spy.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const ROUTE_PATH = path.join(ROOT, 'app', 'api', 'waitlist', 'route.js')
const ROUTE_SRC = fs.readFileSync(ROUTE_PATH, 'utf8')

// ---------------------------------------------------------------------------
// vm harness — same transform as the Stripe webhook test: strip imports +
// the `export` keyword, supply every imported name as a sandbox global.
// ---------------------------------------------------------------------------

function transformRouteSource(src) {
  return src
    .replace(/^import\s+[^\n]*;\n/gm, '')
    .replace(/^export\s+(?=const|async|function)/gm, '')
}

// Minimal duck-typed NextResponse (same as the Stripe harness): static
// json(body, init) + constructor(text, { status }) + async json().
class NextResponseStub {
  constructor(body, init = {}) {
    this.status = init.status || 200
    this._body = body
    this._jsonBody = typeof body === 'object' ? body : null
  }
  static json(body, init = {}) {
    return new NextResponseStub(body, init)
  }
  async json() {
    if (this._jsonBody !== null) return this._jsonBody
    if (typeof this._body === 'string') return { text: this._body }
    return this._body
  }
}

async function buildHarness({ clerkId, db }) {
  // Real zod — pulled in via dynamic import so the sandbox gets the
  // genuine validator (a fake could diverge from zod's email rules).
  const { z } = await import('zod')
  const sandbox = {
    console,
    process,
    NextResponse: NextResponseStub,
    z,
    getDb: () => db,
    resolveClerkId: async () => clerkId,
  }
  vm.createContext(sandbox)
  vm.runInContext(transformRouteSource(ROUTE_SRC), sandbox, { filename: 'api/waitlist/route.js' })
  return { POST: sandbox.POST, GET: sandbox.GET }
}

// In-memory waitlist spy: records every updateOne / find call shape.
function makeDbSpy({ upsertedCount = 1, entries = [] } = {}) {
  const calls = []
  const db = {
    collection: (name) => ({
      updateOne: async (filter, update, options) => {
        calls.push({ name, filter, update, options })
        return { matchedCount: 0, upsertedCount: options?.upsert ? upsertedCount : 0 }
      },
      find: () => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => entries,
          }),
        }),
      }),
    }),
  }
  return { db, calls }
}

const reqWithBody = (body) => ({ json: async () => body })
const reqBadJson = { json: async () => { throw new Error('bad body') } }

// ---------------------------------------------------------------------------
// 1. POST valid email → 201 + normalized upsert shape
// ---------------------------------------------------------------------------

test('Round-89 waitlist: valid email → 201 + normalized $setOnInsert write', async () => {
  const { db, calls } = makeDbSpy({ upsertedCount: 1 })
  const { POST } = await buildHarness({ clerkId: null, db })

  // Mixed case must be normalized to lowercase before the upsert key.
  const res = await POST(reqWithBody({ email: 'Foo@Bar.SE' }))

  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.status, 'waitlisted')
  assert.equal(calls.length, 1, 'exactly one updateOne expected')
  const c = calls[0]
  assert.equal(c.name, 'waitlist')
  assert.equal(c.filter.email, 'foo@bar.se', 'email must be lowercased for dup detection')
  assert.equal(c.update.$setOnInsert.email, 'foo@bar.se')
  assert.equal(c.update.$setOnInsert.source, 'landing', 'source must be the whitelisted literal')
  // Realm-safe Date check — instanceof Date fails across vm realms.
  assert.equal(
    Object.prototype.toString.call(c.update.$setOnInsert.createdAt),
    '[object Date]',
    'createdAt must be a Date',
  )
  assert.equal(c.options.upsert, true, 'must upsert so re-submits collapse onto one row')
})

// ---------------------------------------------------------------------------
// 2. POST duplicate → 409
// ---------------------------------------------------------------------------

test('Round-89 waitlist: duplicate email (upsertedCount 0) → 409', async () => {
  const { db, calls } = makeDbSpy({ upsertedCount: 0 })
  const { POST } = await buildHarness({ clerkId: null, db })

  const res = await POST(reqWithBody({ email: 'hej@jobbpiloten.se' }))

  assert.equal(res.status, 409)
  const body = await res.json()
  assert.equal(body.ok, false)
  assert.match(body.error, /redan i kön/)
  assert.equal(calls.length, 1, 'dup check must still run the upsert (no find-then-insert race)')
})

// ---------------------------------------------------------------------------
// 3. POST invalid email → 400, no DB write
// ---------------------------------------------------------------------------

test('Round-89 waitlist: invalid email → 400 + zero DB calls', async () => {
  const { db, calls } = makeDbSpy()
  const { POST } = await buildHarness({ clerkId: null, db })

  const res = await POST(reqWithBody({ email: 'inte-en-epost' }))

  assert.equal(res.status, 400)
  const body = await res.json()
  assert.equal(body.ok, false)
  assert.match(body.error, /giltig e-postadress/)
  assert.equal(calls.length, 0, 'validation must fail before touching Mongo')
})

// ---------------------------------------------------------------------------
// 4. POST non-JSON body → 400
// ---------------------------------------------------------------------------

test('Round-89 waitlist: non-JSON body → 400', async () => {
  const { db, calls } = makeDbSpy()
  const { POST } = await buildHarness({ clerkId: null, db })

  const res = await POST(reqBadJson)

  assert.equal(res.status, 400)
  assert.equal((await res.json()).error, 'Ogiltig JSON.')
  assert.equal(calls.length, 0)
})

// ---------------------------------------------------------------------------
// 4b. DB-write failure → structured 503 (not an HTML 500 throw)
// ---------------------------------------------------------------------------

test('Round-89 waitlist: Mongo write failure → 503 (structured JSON, never a throw)', async () => {
  // getDb resolves, but the updateOne itself throws (transient network
  // blip mid-query). The route must translate that into the same
  // Swedish 503 JSON every other route uses — an unhandled throw would
  // render Next.js's HTML 500 and break the landing form's res.json().
  const db = {
    collection: () => ({
      updateOne: async () => { throw new Error('network blip') },
    }),
  }
  const { POST } = await buildHarness({ clerkId: null, db })

  const res = await POST(reqWithBody({ email: 'write-fail@example.com' }))

  assert.equal(res.status, 503)
  assert.match((await res.json()).error, /tillfälligt otillgänglig/)
})

test('Round-89 waitlist: Mongo read failure on admin GET → 503', async () => {
  const db = {
    collection: () => ({
      find: () => ({ sort: () => { throw new Error('read blip') } }),
    }),
  }
  const { GET } = await buildHarness({ clerkId: 'demo-user-001', db })

  const res = await GET()

  assert.equal(res.status, 503)
  assert.match((await res.json()).error, /tillfälligt otillgänglig/)
})

// ---------------------------------------------------------------------------
// 5. GET admin → 200 entries
// ---------------------------------------------------------------------------

test('Round-89 waitlist: admin GET → 200 + entries without _id', async () => {
  const entries = [
    { _id: 'obj-id-1', email: 'a@b.se', createdAt: new Date('2026-08-06T00:00:00Z'), source: 'landing' },
    { _id: 'obj-id-2', email: 'c@d.se', createdAt: new Date('2026-08-05T00:00:00Z'), source: 'landing' },
  ]
  const { db, calls } = makeDbSpy({ entries })
  // Admin allow-list default includes demo-user-001 (ADMIN_USER_IDS).
  const { GET } = await buildHarness({ clerkId: 'demo-user-001', db })

  const res = await GET()

  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.entries.length, 2)
  assert.equal(body.entries[0].email, 'a@b.se')
  assert.equal(body.entries[0]._id, undefined, '_id must never leak to the admin response')
  assert.equal(body.entries[0].source, 'landing')
})

// ---------------------------------------------------------------------------
// 6. GET non-admin → 403
// ---------------------------------------------------------------------------

test('Round-89 waitlist: non-admin GET → 403', async () => {
  const { db, calls } = makeDbSpy()
  const { GET } = await buildHarness({ clerkId: 'some-other-user', db })

  const res = await GET()

  assert.equal(res.status, 403)
  assert.match((await res.json()).error, /Endast för administratörer/)
  assert.equal(calls.length, 0)
})

// ---------------------------------------------------------------------------
// 7. GET unauthenticated → 401
// ---------------------------------------------------------------------------

test('Round-89 waitlist: unauthenticated GET → 401', async () => {
  const { db, calls } = makeDbSpy()
  const { GET } = await buildHarness({ clerkId: null, db })

  const res = await GET()

  assert.equal(res.status, 401)
  assert.equal(calls.length, 0)
})

// ---------------------------------------------------------------------------
// 8. Source locks — the upsert + whitelisted source contract (regression net)
// ---------------------------------------------------------------------------

test('Round-89 waitlist: route must use $setOnInsert upsert on the waitlist collection', () => {
  assert.match(
    ROUTE_SRC,
    /db\.collection\(['"]waitlist['"]\)\s*\.\s*updateOne/,
    'waitlist writes must go through db.collection("waitlist").updateOne',
  )
  assert.match(
    ROUTE_SRC,
    /\$setOnInsert:\s*\{\s*email,\s*createdAt:\s*now,\s*source:\s*['"]landing['"]\s*\}/,
    'the upsert seed must be { email, createdAt: now, source: "landing" }',
  )
  assert.match(
    ROUTE_SRC,
    /upsertedCount\s*===\s*1/,
    '201 must be gated on upsertedCount === 1 (else 409)',
  )
})

test('Round-89 waitlist: POST must validate with zod before any DB access', () => {
  assert.match(ROUTE_SRC, /z\.object\(\{\s*email:/, 'schema must validate the email field with zod')
  assert.match(ROUTE_SRC, /safeParse/, 'the route must safeParse (never throw) the payload')
})
