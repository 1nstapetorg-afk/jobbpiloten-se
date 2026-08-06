/**
 * GET /api/health — public uptime + dependency probe (no auth).
 *
 * Round-89 — a single endpoint a monitoring cron (or a human with
 * curl) can hit to see whether the two load-bearing dependencies are
 * alive:
 *
 *   {
 *     status: 'ok' | 'degraded',   // 'ok' only when BOTH are true
 *     db: boolean,                 // MongoDB ping succeeded
 *     groq: boolean,               // Groq quota check succeeded
 *     timestamp: ISO string,
 *   }
 *
 *   • db    — `db.command({ ping: 1 })` through the shared
 *     self-healing singleton (lib/mongo.js). The driver's
 *     serverSelectionTimeoutMS (5s dev / 10s prod) keeps a down
 *     database from hanging the probe.
 *   • groq  — reuses lib/groq.js#probeGroqHealth (the same 1-token
 *     probe as /api/admin/ai-status). In mock mode (Round-87 E2E) or
 *     not-configured the probe returns degraded WITHOUT firing a real
 *     API call, so a keyless dev env stays honest and quota-free.
 *
 * Deliberately in middleware's public route list (see middleware.js),
 * so a healthy deployment is verifiable from the outside without any
 * session. Response never contains secrets.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { probeGroqHealth } from '@/lib/groq';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Review-fix (2026-08-06): a PUBLIC health endpoint must not burn Groq
// TPD quota on every hit — a monitor pinging every 30s would fire
// ~2,880 real API calls/day of the exact scarce resource this endpoint
// exists to watch. Cache the probe result for PROBE_TTL_MS; fresh hits
// within the window reuse the cached value. The probe is ALSO bounded
// with a timeout so a hung provider can never hang the monitoring
// endpoint itself (a dead /api/health is worse than a degraded one).
const PROBE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 5_000;
let _probeCache = null; // { at: number, value: probeResult }

async function cachedGroqProbe() {
  const now = Date.now();
  if (_probeCache && now - _probeCache.at < PROBE_TTL_MS) {
    return _probeCache.value;
  }
  const value = await Promise.race([
    probeGroqHealth(),
    new Promise((resolve) =>
      setTimeout(() => resolve({ status: 'degraded', reachable: false, detail: 'probe-timeout' }), PROBE_TIMEOUT_MS),
    ),
  ]);
  _probeCache = { at: now, value };
  return value;
}

export async function GET() {
  // db probe — ping the shared Mongo handle.
  let db = false;
  try {
    const database = await getDb();
    await database.command({ ping: 1 });
    db = true;
  } catch (_) {
    db = false;
  }

  // groq probe — reuse the admin health-check probe (1 token,
  // mock/not-configured short-circuit without any API call), served
  // from a 60s TTL cache so repeated public hits don't burn quota.
  let groq = false;
  try {
    const probe = await cachedGroqProbe();
    groq = probe.status === 'ok';
  } catch (_) {
    groq = false;
  }

  return NextResponse.json({
    status: db && groq ? 'ok' : 'degraded',
    db,
    groq,
    timestamp: new Date().toISOString(),
  });
}
