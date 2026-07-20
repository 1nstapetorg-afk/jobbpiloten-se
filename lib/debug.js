/**
 * Debug-instrumentation gate for shipped code.
 *
 * The round-15 openJobOrSearch + resolveAFJobUrl work shipped with
 * four temporary log statements stripped from lib/jobScraper.js,
 * app/api/[[...path]]/route.js, and app/dashboard/page.js. Future
 * debug instrumentation that DESPERATELY needs to ship (e.g.
 * investigates a production issue) must go through this helper so a
 * single env flag disables all of it at once. The unit test
 * `tests/unit/no-debug-joburl-logs.test.mjs` walks the source tree
 * and fails if any actual log call escapes — this helper is not on
 * that list because it's a wrapper, not a log statement.
 *
 * Usage:
 *
 *   import { isJobUrlDebug } from '@/lib/debug'
 *   if (isJobUrlDebug()) {
 *     // ...a guarded console call with the DEBUG-jobUrl tag here...
 *   }
 *
 * Environment:
 *
 *   DEBUG_JOBURL=1   enables the gate (defaults to disabled)
 *
 * Notes:
 *
 *   • Node-only check (we read `process.env` once at module load).
 *     Browser bundles receive `false` since the env var doesn't
 *     survive the build, so the helper is automatically a no-op in
 *     the client bundle. No additional bundler config needed.
 *   • Pure boolean — never accepts a level/threshold. Pilot-feature
 *     work is the only consumer right now; multi-tier debug flags
 *     are out of scope.
 *   • The unit test's failure message is allowed to point at
 *     `lib/debug.js#isJobUrlDebug()` because this file exists.
 *     Removing this helper without updating that pointer will leave
 *     the message dangling.
 */

const ENABLED = process.env.DEBUG_JOBURL === '1'

/**
 * Returns true when debug instrumentation for the
 * openJobOrSearch / resolveAFJobUrl flow is allowed to emit logs.
 * Returns false otherwise (the default). Browser bundles always
 * receive false since `process.env.DEBUG_JOBURL` is undefined in
 * the client bundle.
 */
export function isJobUrlDebug() {
  return ENABLED
}
