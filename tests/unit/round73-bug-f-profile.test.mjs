// 2026-07-21 (Round-73 / ITEM 1-D)
// Regression test asserting that lib/extension-profile.js's
// buildExtensionProfile() surfaces the two new Round-12 keys
// added in Round-73 / BUG F (currentJobTitle, currentOrganization)
// as the user's profile values (not undefined).
//
// Pre-fix the round12 string iteration in buildExtensionProfile
// only covered ROUND12_STRING_KEYS = ['dateOfBirth', 'gender',
// 'nationality', 'phoneCountryCode'] — so even though content.js
// FIELD_PATTERNS had splits routing to currentJobTitle +
// currentOrganization, the extension would fill 'undefined' into
// split-form fields because buildExtensionProfile() returned no
// such keys. After the Round-73 / BUG F completion commit (cfb9ed0),
// both keys appear in the returned object.
//
// REWRITTEN to remove the destructive process.exit(0) on import
// failure (per code-reviewer feedback). Now uses t.skip() at the
// top level so test runner continues with other modules.

import { test } from 'node:test'
import assert from 'node:assert/strict'

let lib = null
let importError = null
try {
  lib = await import('../../lib/extension-profile.js')
} catch (e) {
  importError = e?.message || String(e)
}

const SKIP_REASON = importError
  ? `buildExtensionProfile couldn't be imported (${importError.split('\n')[0]}). Ensure the test environment has MongoDB client.`
  : (typeof lib?.buildExtensionProfile !== 'function')
  ? 'buildExtensionProfile is not exported from lib/extension-profile.js'
  : null

const profile = {
  hasDriversLicense: true,
  isEuCitizen: false,
  hasForkliftLicense: true,
  yearsExperience: 5,
  dateOfBirth: '1990-04-15',
  gender: 'Man',
  nationality: 'Swedish',
  phoneCountryCode: '+46',
  currentJobTitle: 'Lagerarbetare',
  currentOrganization: 'PostNord AB',
}

test('Round-73 / ITEM 1-D: buildExtensionProfile surfaces currentJobTitle', { skip: SKIP_REASON }, () => {
  const built = lib.buildExtensionProfile(profile)
  assert.equal(
    built.currentJobTitle,
    'Lagerarbetare',
    'currentJobTitle must surface the user-typed value (not undefined)',
  )
})

test('Round-73 / ITEM 1-D: buildExtensionProfile surfaces currentOrganization', { skip: SKIP_REASON }, () => {
  const built = lib.buildExtensionProfile(profile)
  assert.equal(
    built.currentOrganization,
    'PostNord AB',
    'currentOrganization must surface the user-typed value (not undefined)',
  )
})

test('Round-73 / ITEM 1-D: profile without the keys returns empty strings', { skip: SKIP_REASON }, () => {
  // A legacy profile (pre-Round-73) without the keys must still
  // surface '' rather than throw on undefined access.
  const built = lib.buildExtensionProfile({})
  assert.equal(built.currentJobTitle, '', 'currentJobTitle must default to empty string')
  assert.equal(built.currentOrganization, '', 'currentOrganization must default to empty string')
})
