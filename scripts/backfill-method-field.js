/**
 * One-off MongoDB migration: backfill the `method` field on applications.
 *
 * The product pivoted from an "AI applies autonomously" model to an
 * "AI assists the user" model. The stored value `method: 'AI-pilot (förberedd)'`
 * was renamed to `'AI-assistent (förberedd)'` in the application code; this
 * script updates existing rows in MongoDB so the UI and any analytics that
 * read the field stay consistent.
 *
 * Usage:
 *   MONGO_URL=mongodb://... DB_NAME=jobbpiloten node scripts/backfill-method-field.js
 *   # or via npm:
 *   npm run migrate:method
 *
 * Dry-run (prints what would be changed without writing):
 *   DRY_RUN=1 MONGO_URL=... DB_NAME=... node scripts/backfill-method-field.js
 *
 * Idempotent: re-running is a no-op because the filter only matches rows
 * still containing the old value.
 */

const { MongoClient } = require('mongodb');

const OLD_VALUE = 'AI-pilot (förberedd)';
const NEW_VALUE = 'AI-assistent (förberedd)';
const COLLECTION = 'applications';
const isDryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

async function main() {
  const mongoUrl = process.env.MONGO_URL;
  const dbName = process.env.DB_NAME;

  if (!mongoUrl) {
    console.error('Error: MONGO_URL env var is required');
    console.error('Usage: MONGO_URL=mongodb://... DB_NAME=jobbpiloten node scripts/backfill-method-field.js');
    process.exit(1);
  }
  if (!dbName) {
    console.error('Error: DB_NAME env var is required');
    process.exit(1);
  }

  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();
    const db = client.db(dbName);
    const coll = db.collection(COLLECTION);

    const matchCount = await coll.countDocuments({ method: OLD_VALUE });

    console.log(`Backfill ${isDryRun ? '(DRY RUN) ' : ''}summary:`);
    console.log(`  Collection:   ${COLLECTION}`);
    console.log(`  Database:     ${dbName}`);
    console.log(`  Filter:       { method: "${OLD_VALUE}" }`);
    console.log(`  Would set:    { method: "${NEW_VALUE}" }`);
    console.log(`  Matched:      ${matchCount}`);

    if (matchCount === 0) {
      console.log(`No applications found with method="${OLD_VALUE}". Nothing to update.`);
      return;
    }

    if (isDryRun) {
      console.log(`DRY RUN: no documents were modified. Re-run without DRY_RUN to apply.`);
      return;
    }

    const result = await coll.updateMany(
      { method: OLD_VALUE },
      { $set: { method: NEW_VALUE } },
    );

    console.log(`  Modified:     ${result.modifiedCount}`);

    if (result.matchedCount !== result.modifiedCount) {
      console.warn(`  Warning: matched/modified count mismatch — some docs may have been modified concurrently.`);
    }
  } catch (err) {
    console.error('Backfill failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();
