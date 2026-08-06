// lib/mongo.js — shared MongoDB client singleton for the API routes.
//
// Why this module exists (Round-80 diagnostic):
//   Every API route previously carried its own copy of this pattern:
//
//     let clientPromise;
//     if (!global._mongoClientPromise) {
//       const client = new MongoClient(...);
//       global._mongoClientPromise = client.connect();
//     }
//     clientPromise = global._mongoClientPromise;
//
//   That shape had two real bugs:
//
//     1. Poisoned-promise. `client.connect()` fired at module load and
//        its RESULT (a promise) was cached on `global`. If Mongo was
//        down at that moment the promise REJECTED, and the cached
//        rejection was never cleared — every subsequent request awaited
//        the same rejected promise and 500'd instantly, even after
//        Mongo came back. (The driver's background topology monitor
//        reconnects fine; the wrapper promise just stays rejected until
//        a full server restart.) Observed live: /api/health went from a
//        legitimate Mongo-down 500 to an instant 0.08s 500 forever.
//
//     2. Per-route client leak in dev. All 18 route files ran
//        `new MongoClient(...).connect()` at module load; only the
//        first one's promise was ever awaited, the other 17 clients
//        connected and were dropped without `close()`.
//
//   The fix: one module owns the client. `getDb()` lazily creates +
//   connects on first use, and the cached connect-promise clears itself
//   on rejection so the next request transparently retries with a fresh
//   connect (the driver re-uses the same client — MongoClient.connect()
//   is idempotent once a topology is healthy).
//
//   The client is held on `global` (not module scope) so Next.js
//   dev-mode hot-reloads of this file don't leak a new client + pool
//   each time the module re-evaluates — same rationale as the original
//   singleton (see HANDOFF.md §7: "hot-reload will leak connections and
//   MongoDB will refuse new ones after ~100 restarts").
import { MongoClient } from 'mongodb';

let connectPromise = null;

function getClient() {
  if (!global._jobbpilotenMongoClient) {
    // Round-84 fix (2026-08-04, "MongoDB down hangs every API"): the
    // driver's default serverSelectionTimeoutMS is 30s, so when the
    // database is unreachable every API route (dashboard's /api/stats,
    // /api/applications, /api/profile, settings, /api/upload-cv…) hung
    // for 30s before erroring — the dashboard/settings "infinite
    // spinner" and the slow ECONNREFUSED upload failure. A fail-fast
    // cap makes a Mongo outage surface as a fast, user-friendly error
    // instead of a long silent hang. The client itself is unchanged
    // (one shared singleton, self-healing connectPromise).
    //
    // Tunable via MONGO_SERVER_SELECTION_TIMEOUT_MS: dev defaults to
    // 5s (fail fast — a down local Mongo must never hang the UI);
    // production defaults to 10s (a serverless cold start reaching a
    // distant Atlas cluster can legitimately take longer than 5s on
    // first connect, and a transient slow connect should not surface
    // as a spurious DB_UNAVAILABLE 503). The self-healing
    // connectPromise (cleared on rejection) means a timeout is
    // retried on the next request either way.
    const defaultTimeout = process.env.NODE_ENV === 'production' ? 10_000 : 5_000
    const parsed = Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS)
    const serverSelectionTimeoutMS = Number.isFinite(parsed) && parsed > 0
      ? parsed
      : defaultTimeout
    global._jobbpilotenMongoClient = new MongoClient(
      process.env.MONGO_URL || 'mongodb://localhost:27017/jobbpiloten',
      {
        serverSelectionTimeoutMS,
        // connectTimeoutMS only bounds the initial TCP handshake
        // (server selection is governed by serverSelectionTimeoutMS);
        // set it slightly lower so a dead-host SYN is refused fast.
        connectTimeoutMS: Math.min(serverSelectionTimeoutMS, 5_000),
      },
    );
  }
  return global._jobbpilotenMongoClient;
}

function ensureConnected() {
  if (!connectPromise) {
    connectPromise = getClient().connect().catch((err) => {
      // Self-healing: drop the cached promise on failure so a transient
      // Mongo outage can't poison the singleton for the rest of the
      // process lifetime (see header comment). The error still
      // propagates to the caller, which owns its try/catch.
      connectPromise = null;
      throw err;
    });
  }
  return connectPromise;
}

/**
 * Resolve the shared Mongo Database handle.
 *
 * Lazily creates + connects the singleton client on first use and
 * re-throws connect failures so callers can translate them into their
 * own error shape (most routes wrap route bodies in try/catch).
 */
export async function getDb() {
  await ensureConnected();
  return getClient().db(process.env.DB_NAME);
}
