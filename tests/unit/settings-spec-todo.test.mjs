// tests/unit/settings-spec-todo.test.mjs
//
// Round-31.1 dedicated test file (split from tests/unit/auth-fixture.test.mjs
// after the code-reviewer flagged cross-file coupling).
//
// The TODO marker at tests/e2e/settings.spec.js's
//   `Settings: GDPR art. 17 account delete`
// block was historically:
//
//   "TODO (Round-30+): ISOLATION MIGRATION"
//   "..this destructive test currently wipes the shared "demo-user-001"..."
//   "...Once we migrate the auth fixture to use per-worker clerkIds..."
//
// Round-31 resolved this TODO via the per-TEST fixture migration
// (each test gets its own `demo-user-001-w${workerIndex}-h${hash(testInfo.title)}`
// clerkId → GDPR destructive op only wipes its OWN row → no
// cascade to parallel siblings). The current marker reads:
//
//   "Round-31 ISOLATION MIGRATION — RESOLVED."
//
// This test locks the resolution by failing if a future maintainer
// re-adds the legacy TODO marker. Co-located in its own file
// (NOT in tests/unit/auth-fixture.test.mjs) so the auth-fixture
// test's responsibility matches its filename.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SETTINGS_SOURCE = readFileSync('tests/e2e/settings.spec.js', 'utf8')

test('Round-31.1: settings.spec.js GDPR-delete pre-Round-31 TODO marker is RETIRED (uses doesNotMatch)', () => {
  // The exact pre-Round-31 marker phrase must NOT be present
  // anywhere in tests/e2e/settings.spec.js. If it is, a maintainer
  // reverted the migration (or a future tool regenerated the file
  // from a stale template) — the GDPR delete test would again wipe
  // the shared per-worker-or-shared clerkId and cascade-fail
  // parallel read-only specs.
  assert.doesNotMatch(
    SETTINGS_SOURCE,
    /TODO\s*\(Round-30\+\):\s*ISOLATION\s+MIGRATION/,
    'tests/e2e/settings.spec.js must NOT contain `TODO (Round-30+): ISOLATION MIGRATION` — Round-31 resolved this TODO marker via per-test fixture migration. Re-adding it indicates a regression to per-worker-or-shared cookie.',
  )
})

test('Round-31.1: settings.spec.js GDPR-delete block carries the post-Round-31 RESOLVED marker', () => {
  // Symmetric positive assertion: the Round-31 RESOLVED marker
  // is in place. This is what a reader of the test name expects
  // to find; the doesNotMatch above traps a regression to the
  // old TODO form, this match traps a regression to NEITHER form
  // (i.e. someone silently removed the marker entirely).
  // Round-31.1 polish (code-reviewer cosmetic): tolerate typography
  // variants between the "—" (em-dash) literal we wrote and the
  // "--" / "–" (en-dash / double-hyphen) variants a future
  // maintainer might normalize to. The marker must read
  // substantively the same, but the dash character is a property
  // of the editor, not the migration contract.
  assert.match(
    SETTINGS_SOURCE,
    /Round-31\s+ISOLATION\s+MIGRATION\s*[-—–]{1,2}\s*RESOLVED\./,
    'tests/e2e/settings.spec.js must contain the post-Round-31 marker (e.g. `Round-31 ISOLATION MIGRATION — RESOLVED.`) so future maintainers see the migration is complete — em-dash / en-dash / double-hyphen all tolerated for typography normalization (a maintainer who silently drops the marker loses the historical contract)',
  )
})
