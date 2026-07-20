import { defineConfig, devices } from '@playwright/test'

// Round-27.1b: PORT-aware derivation. Default 3000 to match pre-Round-27
// behaviour. Set `PORT=3001 yarn test:e2e` to run a webServer on a
// different port (useful when port 3000 is occupied by another process
// in a sandbox where non-root `kill` cannot free it — see tests/SETUP.md).
// PLAYWRIGHT_BASE_URL overrides for deployed instances and stays a
// hard override — when set, the PORT-derived baseURL is ignored.
const PORT = process.env.PORT || '3000'

// Round-31.2 (HOTFIX from live-smoke failure): workers derivation
// MUST be hoisted OUTSIDE the `defineConfig({...})` object literal.
// An earlier version of this file declared `const w = ...; const
// workers = ...` as inline declarations INSIDE the object — which
// is a JavaScript SyntaxError (`Unexpected keyword 'const'`).
// The bug lurked from Round-30 because `yarn build` doesn't parse
// this file (Next's build pipeline doesn't execute the test
// runner config); only `yarn test:e2e` (via Playwright) ever
// evaluated it. The multi-worker smoke in Followup #1 surfaced
// the bug — and it's the canary any future "TypeError inside
// config" regression needs. The fix is structural: hoist the
// declarations to module scope, reference them via shorthand
// `workers: workers` (or implicit bare `workers,`) inside the
// object literal so the JS parser is happy. NaN-safe semantics
// preserved identically to Round-30 / Round-30.1.
const w = Number(process.env.PLAYWRIGHT_WORKERS)
const workers = Number.isInteger(w) && w >= 1 ? w : 2

/**
 * Playwright config for /settings + dashboard navigation E2E.
 *
 * One project (chromium), one reporter (`list` so first-touch feedback is
 * immediate), one webServer (`yarn dev`). `reuseExistingServer: true`
 * means: if you already have `yarn dev` running locally, the test runner
 * will use that one — no double-boot. Set `PLAYWRIGHT_BASE_URL` to point
 * at a deployed instance if you want to run against staging.
 *
 * The tests rely on the demo-cookie auth path (no Clerk key required) —
 * see tests/e2e/_fixtures/auth.js for how each test seeds the cookie
 * before navigation, and lib/auth.js on the server side for how the
 * cookie is read.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Tests need a generous timeout: profile-save + toast + re-fetch is
  // ~1-2s in dev, but first navigation can cold-start a Next 15 compile.
  timeout: 60_000,
  expect: { timeout: 5_000 },
  // Round-31: fullyParallel = true is safe again, thanks to
  // per-test clerkId isolation in tests/e2e/_fixtures/auth.js.
  // Round-30 set fullyParallel = false as belt-and-braces after
  // discovering that per-worker-only isolation (per Round-30
  // migration) left tests within the SAME worker sharing the
  // same DEMO_CLERK_ID — a GDPR destructive op could cascade-
  // fail a parallel read-only test in the same worker. Round-31
  // replaces the module-load TEST_PARALLEL_INDEX derivation with
  // a PER-TEST testInfo.workerIndex + hash(testInfo.title) pair,
  // so every test has its own `demo-user-001-w${workerIdx}-h${hash}`
  // clerkId. Each test then owns its own Mongo document; the GDPR
  // destructive test wipes ONLY its own row and never touches a
  // parallel sibling. fullyParallel can flip back to true and the
  // spec suite regains the throughput Round-30 sacrificed. The
  // trade-off: at full parallelism with `workers: 2`, the runner
  // hits Mongo with N x seedDemoUser POSTs concurrently. seedApps
  // is a small upsert (12 docs) so this is fast; no observable
  // contention has surfaced.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Round-31.2 hotfix: workers value is bound at module scope ABOVE
  // this object literal (JS SyntaxError otherwise — declarations
  // cannot appear mid-literal). The shorthand `workers,` here reads
  // the module-scope const value into the config object's
  // `workers` property. NaN-safe semantics (Round-30 + Round-30.1)
  // preserved verbatim.
  workers,
  // Round-27.7 second-pass reviewer flagged that just rolling back
  // workers would cascade-fail dashboard-nav via shared
  // `demo-user-001` cookie. Round-29.3 SCAFFOLD: opt-in env override
  // — `PLAYWRIGHT_WORKERS=N yarn test:e2e` is honored, but the
  // cookie-collision risk DELIBERATELY remained unfixed so a local
  // maintainer flipping the var got cascade failures TODAY and
  // knew to land the per-worker-clerkId migration first (TODO
  // marker at tests/e2e/settings.spec.js — `Settings: GDPR art. 17
  // account delete`).
  //
  // Round-30 COMPLETES the migration: tests/e2e/_fixtures/auth.js
  // now derives the per-WORKER clerkId from `TEST_PARALLEL_INDEX`.
  // Round-31 further refines that to per-TEST (testInfo.workerIndex
  // + hash(testInfo.title)), so each test owns its own Mongo
  // document. Combined with `fullyParallel: true` flipped in
  // Round-31, the cascade is closed both cross-worker AND within-
  // worker. `workers: 2` (NOT 4) keeps `yarn dev`'s Next 15
  // compile path from starving on a 4-core laptop. Explicit
  // `PLAYWRIGHT_WORKERS` override still wins for power-users
  // tuning flaky CI weekends. NaN-safe: bad values (empty, 'foo',
  // '2.5') fall back to 2, NOT the playwright "auto = CPU count"
  // interpretation of `workers: 0`. The const declaration that
  // computes `w`/`workers` lives at module scope ABOVE this
  // object literal (Round-31.2 hotfix — JS SyntaxError otherwise).
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // The demo-mode cookie is set per-test via context.addCookies() — no
    // global storageState needed.
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Round-78 (2026-07-20) — Windows-shell-safe port forwarding.
    // The Round-27.1b shape inlined PORT into the cmdline as
    // `PORT=${PORT} yarn dev`, which is POSIX-shell syntax. On
    // Windows cmd.exe, the prefix is parsed as a literal command
    // name (`'PORT' is not recognized as an internal or external
    // command`) and Playwright aborts with Exit code 1 before
    // next dev ever binds. The Round-78 fix forwards PORT via
    // Playwright's `env` object instead, which merges into the
    // webServer subprocess's process.env — scripts/run-dev.mjs
    // reads `process.env.PORT` and passes it to `next dev`, so
    // the same port actually reaches next.js without any
    // in-shell env-var prefix.
    //
    // Belt-and-braces: we also keep PORT in the closure scope
    // (computed from outer `process.env.PORT || '3000'`) so a
    // `PORT=3001 yarn test:e2e` invocation still binds next dev
    // to :3001 even when the wrapping shell is cmd.exe (where
    // `PORT=3001 yarn ...` is treated as a literal command name,
    // not a prefix).
    command: 'yarn dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { PORT },
  },
})
