// tests/unit/extension-taxonomy-parity.test.mjs
//
// Locks the Chrome-extension bundled taxonomy (extension/lib/field-taxonomy.js,
// plain JS for MV3) to the app-side source of truth (lib/field-taxonomy.js).
// If the scraper corpus grows and someone updates one side but not the other,
// this test fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const app = await import(`${ROOT}lib/field-taxonomy.js`);
const base = await import(`${ROOT}lib/extension-profile-fields.js`);

function loadBundled() {
  const src = readFileSync(`${ROOT}extension/lib/field-taxonomy.js`, 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.FIELD_TAXONOMY;
}

test('extension bundled taxonomy matches app source of truth', () => {
  const bund = loadBundled();

  // Helper: cross-realm values from the vm sandbox fail deepStrictEqual on
  // prototype identity, so compare via JSON normalization.
  const norm = (v) => JSON.parse(JSON.stringify(v));

  // 1. Same 9 industries, same display order
  assert.equal(
    JSON.stringify(norm(bund.industries.map((i) => i.id))),
    JSON.stringify(norm(app.INDUSTRIES.map((i) => i.id))),
    'industry list differs between app lib and bundled copy'
  );

  // 2. Same per-industry field-key sequences
  for (const id of app.INDUSTRIES.map((i) => i.id)) {
    assert.equal(
      JSON.stringify(norm(bund.fields[id].map((f) => f.key))),
      JSON.stringify(norm(app.INDUSTRY_FIELDS[id].map((f) => f.key))),
      `field set differs for industry ${id}`
    );
  }

  // 3. Every key the bundled fields reference has a display label
  const bundKeys = new Set(Object.keys(bund.labels));
  for (const id of bund.industries.map((i) => i.id)) {
    for (const { key } of bund.fields[id]) {
      assert.ok(bundKeys.has(key), `bundled fields[${id}] references ${key} with no label`);
    }
  }

  // 4. App INDUSTRY_BOOLEAN_LABELS agree with the bundled labels on the
  //    industry keys (bundled additionally carries base ROUND12 labels)
  for (const key of app.INDUSTRY_BOOLEAN_KEYS) {
    assert.equal(
      bund.labels[key],
      app.INDUSTRY_BOOLEAN_LABELS[key],
      `label differs for ${key}`
    );
  }

  // 5. Every bundled label is either an industry key or a base ROUND12 key
  const baseKeys = new Set(base.ROUND12_BOOLEAN_KEYS || []);
  for (const key of bundKeys) {
    assert.ok(
      app.INDUSTRY_BOOLEAN_KEYS.includes(key) || baseKeys.has(key),
      `bundled label ${key} is neither an industry key nor a base ROUND12 key`
    );
  }

  // 6. App field sets only reference industry keys or base ROUND12 keys
  for (const id of app.INDUSTRIES.map((i) => i.id)) {
    for (const { key } of app.INDUSTRY_FIELDS[id]) {
      assert.ok(
        app.INDUSTRY_BOOLEAN_KEYS.includes(key) || baseKeys.has(key),
        `app fields[${id}] references ${key} which is neither industry nor base key`
      );
    }
  }
});

test('extension bundled structuredFields match app INDUSTRY_STRUCTURED_FIELDS (Round-83)', () => {
  const bund = loadBundled();
  const norm = (v) => JSON.parse(JSON.stringify(v));
  assert.ok(bund.structuredFields, 'bundled copy must carry structuredFields (Round-83)')
  for (const id of app.INDUSTRY_IDS) {
    assert.equal(
      JSON.stringify(norm(bund.structuredFields[id].map((f) => f.id))),
      JSON.stringify(norm(app.INDUSTRY_STRUCTURED_FIELDS[id].map((f) => f.id))),
      `structured field-id sequence differs for industry ${id}`
    )
    // Deep-compare id/label/type/options/required so a label edit on
    // one side can't silently drift the popup/extension from the app.
    assert.equal(
      JSON.stringify(norm(bund.structuredFields[id])),
      JSON.stringify(norm(app.INDUSTRY_STRUCTURED_FIELDS[id])),
      `structured field defs differ for industry ${id}`
    )
  }
  assert.equal(
    JSON.stringify(norm(bund.structuredToBoolean || {})),
    JSON.stringify(norm(app.STRUCTURED_TO_BOOLEAN || {})),
    'bundled structuredToBoolean map must match the app mapping'
  )
})

test('taxonomy sanity: lager and vård expose the expected key fields', () => {
  const lager = app.INDUSTRY_FIELDS.lager.map((f) => f.key);
  assert.ok(lager.includes('hasForkliftLicense'), 'lager must include truckförarbevis');
  assert.ok(lager.includes('canLiftHeavy'), 'lager must include fysisk arbetsförmåga');
  assert.ok(lager.includes('canShiftWork'), 'lager must include skiftarbete');

  const vard = app.INDUSTRY_FIELDS['vård'].map((f) => f.key);
  assert.ok(vard.includes('hasCareAssistantEducation'), 'vård must include vårdbiträdesutbildning');
  assert.ok(vard.includes('hasHLRCertification'), 'vård must include HLR-certifikat');
});
