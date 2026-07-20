// tests/e2e/_helpers/seedDemoUser.js
//
// Round-24: extracted from tests/e2e/_fixtures/auth.js so any spec that
// needs the canonical Swedish-form demo seed can import + call directly
// without copy-pasting the 50-line try/catch dance.
//
// Round-26.2 (option b): DEMO_PROFILE_PAYLOAD extended with cvText +
// cvFileName + cvFileSize (+ cvUploadedAt via Round-26.4 factory)
// so a future spec that goes to /settings WITHOUT calling clearCv
// in beforeEach will see the success element mount on first paint.
// Existing tests that DO call clearCv (settings-cv-upload,
// cv-magic-bytes, all-issues-smoke, and the rest of the soft-launch
// e2e cluster) continue to behave exactly as before because clearCv
// wipes the seeded cvText back to empty before the test body enters
// — the seed cvText is invisible to these specs.
//
// ROUND-30 FLOW CHANGE — IMPORTANT (do not regress):
// The 4 CV fields (cvText, cvFileName, cvFileSize, cvUploadedAt)
// ride a SINGLE atomic POST through `/api/profile` (per Round-30.1).
// Pre-Round-30.1 they were seeded via a SECOND POST to
// `/api/profile-update` (Round-29.4 split). The Round-30 route.js
// update at app/api/[[...path]]/route.js adds these 4 fields to the
// conditional doc-merge loop on `if (path === 'profile')`, so the
// single POST now writes all 18 fields (canonical + CV) in one
// Mongo round-trip. The structural-lock test in
// tests/unit/seedDemoUser-fixture.test.mjs enforces the SINGLE-POST
// invariant via `data: fullPayload` + `cvText:` presence and a
// `doesNotMatch` guard against any re-introduction of the legacy
// `/api/profile-update` call.
//
// CRITICAL clearCv-WIPE INTERACTION (do not violate — future
// maintainers WILL prune one as "redundant" otherwise):
//   • Option (b)'s seed cvText is ONLY meaningful for specs that
//     do NOT call clearCv in beforeEach. Today: zero such specs
//     exist in the suite.
//   • Option (a)'s Round-25.1 first-time-upload gate stays in
//     app/api/upload-cv/route.js and IS the actual fix for the
//     failing upload cluster. Option (b) is complementary, NOT
//     a replacement — a previous design session considered a
//     literal swap, but the clearCv wipe defeated it without
//     test-level rework.
//
// Round-26.4 (option b fix): cvUploadedAt moved OUT of
// DEMO_PROFILE_PAYLOAD and spread inline as
// `new Date().toISOString()` at the seedDemoUser() call site.
// The old fixed ISO date (e.g. '2026-01-15T10:00:00.000Z') made
// the demo user's "uploaded at" timestamp look 6+ months stale
// in any UI rendering relative time ("Laddades upp för 6
// månader sedan") against a mid-2026 demo. The Realistic
// Swedish CV constraint (NOT "Lorem ipsum") stays — see the
// per-field rationale in the payload constant.
//
// Round-28.3 (factory refactor): the inline-spread pattern
// (`{ ...DEMO_PROFILE_PAYLOAD, cvUploadedAt: new Date().toISOString() }`)
// extracted into a `buildDemoProfilePayload()` local helper so
// any future "Frankenstein spread" at a single call site stays
// fragment-free. Function declaration (NOT arrow) for grep-
// friendly boundaries and visual consistency with `isStrict()`
// below it. NOT exported — `seedDemoUser` is the only public
// entry point, and exposing the factory risks specs bypassing
// the REQUIRED_APP_COUNT post-seed verify. The Round-26.5
// position-check structural-lock test in tests/unit/seedDemoUser-
// fixture.test.mjs gets its anchor string updated from
// 'function isStrict' to 'function buildDemoProfilePayload' to
// track this boundary shift.
//
// Round-29.4 (TWO-POST split, HISTORICAL): the catch-all route's
// POST /api/profile handler at app/api/[[...path]]/route.js hardcoded
// its `doc` object and silently dropped cvText/cvFileName/cvFileSize/
// cvUploadedAt. Round-29 split seedDemoUser into two POSTs: 1a
// `/api/profile` (canonical) + 1b `/api/profile-update` (CV via the
// partial-update ALLOW-list) to work around the drop.
//
// Round-30 TWO-POST RETIREMENT (this round): the per-worker fixture
// migration (tests/e2e/_fixtures/auth.js derives `demo-user-001-w${idx}`
// from `process.env.TEST_PARALLEL_INDEX`) revealed the Round-29.4
// split is unnecessary AND introduced a race window — between POST 1a
// upsert and POST 1b's CV-field patch, a parallel worker's destructive
// operation (clearCv / account-delete) could 404 the CV POST and leave
// the profile partially seeded for the active worker. The fix:
// `if (path === 'profile')` POST handler in `app/api/[[...path]]/route.js`
// now conditionally merges the 4 CV fields into the `doc` object
// ONLY when present in the payload (Round-30 thinker critical #1:
// never use `cvText: source.cvText || ''` — onboarding resubmits
// without CV fields and a literal `|| ''` would wipe the user's
// uploaded CV on every profile save). With the route change in
// place, seedDemoUser reverts to a SINGLE atomic POST that writes
// canonical + CV fields in one Mongo round-trip. The race window
// is gone. The Round-29.4 TWO-POST structural-lock test in
// tests/unit/seedDemoUser-fixture.test.mjs is REPLACED with a
// Round-30.1 SINGLE-POST + cvText-in-body assertion.
//
// Seeds two things, in order:
//   1. POST /api/profile with the canonical Swedish demo profile
//      (frontend dev, Stockholm, heltid, etc.).
//   2. GET /api/applications and assert >= REQUIRED_APP_COUNT entries
//      so a future route regression that drops seedApplications() from
//      the first-POST path surfaces in the FIXTURE, not as a 20s
//      timeout three specs downstream.
//
// Idempotency: the catch-all's `existingApps === 0` gate at
// app/api/[[...path]]/route.js:474 makes seedApplications() a first-
// POST-per-clerkId one-shot. Re-runs are safe; canonical fields get
// updated but the sample apps stay put.
//
// CI semantics mirror the auth fixture exactly: throw on any failure
// in CI, log-warn-and-continue in local dev so a transient blip
// (ECONNREFUSED on cold server, MongoTimeout, etc.) doesn't take
// down spec discovery.
//
// Usage:
//   import { seedDemoUser } from './_helpers/seedDemoUser'
//   test('my spec', async ({ context }) => {
//     await seedDemoUser(context)
//     // ... navigate to /dashboard ...
//   })

// Keep the magic number in sync with `pickRandom(SAMPLE_JOBS, 12)`
// at app/api/[[...path]]/route.js:1120 — bump both together.
const REQUIRED_APP_COUNT = 12

const DEMO_PROFILE_PAYLOAD = {
  fullName: 'Demo Användare',
  email: 'demo@jobbpiloten.se',
  jobTitles: ['Frontend Developer'],
  locations: ['Stockholm'],
  experience: 'Medior',
  workPreference: 'hybrid',
  employmentType: ['heltid'],
  salaryMin: 35000,
  // Round-26.2 (option b): the 3 CV fields below are seeded so a
  // future spec that goes to /settings WITHOUT calling clearCv in
  // beforeEach will see the success element mount on first paint.
  //
  //   cvText       — realistic Swedish CV copy, NOT "Lorem ipsum".
  //                  Length is ~270 chars so the route's
  //                  MIN_VALID_CV_TEXT_CHARS = 50 floor clears with
  //                  headroom — even a refactor that re-tightens
  //                  the gate doesn't mechanically reject the seed.
  //                  Round-30.1: flows through `/api/profile`
  //                  (single atomic POST), NOT via the Round-29.4
  //                  `/api/profile-update` partial-update path.
  //   cvFileName   — 'cv-demo-frontend.pdf' so the file card in
  //                  /settings renders with a realistic filename.
  //                  Round-30.1: same atomic flow as cvText.
  //   cvFileSize   — 24576 bytes (24 KB, typical small PDF).
  //                  Round-30.1: same atomic flow as cvText.
  //
  //   cvUploadedAt — NOT in DEMO_PROFILE_PAYLOAD. It's computed
  //                  inside `buildDemoProfilePayload()` (Round-28.3)
  //                  via `new Date().toISOString()` so the demo
  //                  user's "uploaded at" timestamp is always TODAY.
  //                  A fixed ISO date would look stale in any UI
  //                  that renders relative time from cvUploadedAt
  //                  (originally Round-26.4 fix). Round-30.1: the
  //                  dynamic timestamp flows through `/api/profile`
  //                  single atomic POST — no more two-step dance.
  cvText: 'Frontend Developer med 5+ års erfarenhet av React, TypeScript, Next.js och Node.js. Stockholm-baserad, öppen för hybrid eller heltid. Tidigare roller på Spotify (2 år, frontend) och Klarna (3 år, senior frontend). CI/CD med Docker och AWS. Modern testning med Jest och Playwright.',
  cvFileName: 'cv-demo-frontend.pdf',
  cvFileSize: 24576,
}

// Round-28.3: build the canonical demo profile payload at call time.
// The static DEMO_PROFILE_PAYLOAD above carries only the deterministic
// fields; the timestamp-sensitive ones (currently just cvUploadedAt;
// future candidates: lastLoginAt, pushSubscriptionExpiresAt) live in
// this factory so the call site can never accidentally hard-code a
// stale date. Function declaration (consistency with isStrict below)
// rather than arrow function so source-grep boundary tests can lock
// `}\n\nfunction buildDemoProfilePayload` as the static-payload closure.
function buildDemoProfilePayload() {
  return {
    ...DEMO_PROFILE_PAYLOAD,
    cvUploadedAt: new Date().toISOString(),
  }
}

function isStrict() {
  // Round-25.3 polish: pin to `=== 'true'` so any tool that sets
  // CI=1 (Travis convention), CI= (literally empty string), CI=null
  // (the literal string), or any other truthy-but-not-'true' value
  // doesn't accidentally trip the strict path. Real CIs we ship to
  // (GitHub Actions, Vercel Cron, CircleCI) all set `CI=true` as a
  // string, so the pin is safe across our actual deployment targets.
  //
  // The pre-Round-25 comment said "followup note suggests pinning
  // to === 'true' if any tooling ever sets CI= to literally empty,
  // but that lives in the fixture, not here — this helper is a
  // leaf." That hygiene held for two rounds; Round-25 picks up
  // the carried note.
  return process.env.CI === 'true'
}

export async function seedDemoUser(context) {
  // Round-30.1 SINGLE-POST seed. The factory returns the full payload
  // (canonical + CV), and seedDemoUser() ships it in ONE POST. The
  // /api/profile handler's Round-30 doc-merge loop accepts the 4 CV
  // fields when present in the payload (otherwise leaves them
  // untouched in Mongo). Single Mongo round-trip, no race window.
  //
  // Per-TEST isolation (Round-31 PRIMARY): seedDemoUser() does NOT
  // take an explicit clerkId argument — the per-TEST DEMO_CLERK_ID
  // (derived by tests/e2e/_fixtures/auth.js from testInfo.workerIndex
  // + hash(testInfo.title)) is carried by the cookie set on `context`,
  // and context.request.post applies it automatically. The verify
  // step below reads the active clerkId via /api/profile so the
  // warning copy surfaces the actual per-test id (no more
  // 'demo-user-001' hardcoded in error strings that would mislead
  // worker 3 into thinking the canonical seed had failed for the
  // global demo user).
  const fullPayload = buildDemoProfilePayload()

  try {
    const profileRes = await context.request.post('/api/profile', {
      headers: { 'Content-Type': 'application/json' },
      data: fullPayload,
    })
    if (!profileRes.ok()) {
      const msg = `[seedDemoUser] seed POST /api/profile returned ${profileRes.status()} — continuing without seeded profile. Likely causes: (a) catch-all route regression at app/api/[[...path]]/route.js removing the doc-merge loop; (b) Mongo unreachable; (c) auth cookie missing per-worker DEMO_CLERK_ID.`
      if (isStrict()) throw new Error(msg)
      console.warn(msg)
    }
  } catch (e) {
    if (isStrict()) throw e
    console.warn(
      `[seedDemoUser] seed POST /api/profile threw: ${e?.message || String(e)} — continuing without seeded profile`,
    )
  }

  // 2. Defensive post-seed verify. A future regression that drops
  //    seedApplications() from the first-POST path would otherwise
  //    surface as 20s timeouts three specs later ("missing
  //    application row"). Cheap (one GET) — only counts (no parsing).
  //
  //    Round-30 template the clerkId from the live `/api/profile`
  //    GET rather than hardcoding 'demo-user-001' — the per-worker
  //    fixture seeds `demo-user-001-w${idx}` so the warning copy
  //    must point at the actual user whose seed failed or it
  //    misleads readers cross-referencing the Mongo row.
  try {
    const profileRes = await context.request.get('/api/profile')
    const appsRes = await context.request.get('/api/applications')
    const activeClerkId = profileRes.ok()
      ? (await profileRes.json().catch(() => ({})))?.profile?.clerkId || 'unknown-clerkId'
      : 'unknown-clerkId'
    if (!appsRes.ok()) {
      const msg = `[seedDemoUser] verify GET /api/applications returned ${appsRes.status()} for ${activeClerkId}`
      if (isStrict()) throw new Error(msg)
      console.warn(`${msg} — cannot verify seed`)
      return
    }
    const appsJson = await appsRes.json().catch(() => ({}))
    const appCount = Array.isArray(appsJson?.applications) ? appsJson.applications.length : 0
    if (appCount < REQUIRED_APP_COUNT) {
      const msg = `[seedDemoUser] seed verification failed: expected >= ${REQUIRED_APP_COUNT} apps for ${activeClerkId}, got ${appCount} — specs depending on applications may fail`
      if (isStrict()) throw new Error(msg)
      console.warn(msg)
    }
  } catch (e) {
    if (isStrict()) throw e
    // appsRes.json().catch above may have thrown (already formatted
    // with our msg); only the outer catch eats truly unexpected
    // throwables (e.g. transport) so local-dev stays quiet.
    console.warn(`[seedDemoUser] verify GET /api/applications threw: ${e?.message || String(e)}`)
  }
}
