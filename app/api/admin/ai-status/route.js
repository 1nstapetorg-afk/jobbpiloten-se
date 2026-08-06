/**
 * GET /api/admin/ai-status
 *
 * Round-88 — Groq quota / LLM health check for operators. The single
 * biggest recurring operational risk is Groq's TPD (tokens-per-day)
 * quota: when exhausted, EVERY LLM call 429s and the app degrades to
 * rule-based fallbacks — which a support session can mistake for a
 * code bug (the Round-86 "502" that started that whole investigation
 * was really an exhausted quota). This endpoint gives an operator a
 * one-line answer without grepping server logs.
 *
 * Auth:
 *   • 401 — not signed in at all (Clerk OR demo, via resolveClerkId).
 *   • 403 — signed in but not on the admin allow-list
 *     (`ADMIN_USER_IDS` env, comma-separated; default `demo-user-001`
 *     for the soft-launch admin user).
 *
 * Response shape (stable — a future /admin UI can render it):
 *   {
 *     status: 'ok' | 'degraded',
 *     groq: {
 *       quotaExhausted: boolean,   // TPD-exhaustion detected
 *       mockMode: boolean,         // Round-87 E2E mock active — NOT a real outage
 *       reachable: boolean,        // provider responded (or mock/no-key)
 *       detail: string,            // ok | mock-mode | not-configured | quota-exhausted | model-level | unreachable | echo
 *     },
 *     timestamp: ISO string,
 *   }
 *
 * SECURITY: GROQ_API_KEY is never part of the response — the probe
 * (lib/groq.js#probeGroqHealth) returns only booleans + a short
 * detail string.
 */

import { NextResponse } from 'next/server';
import { resolveClerkId } from '@/lib/auth';
import { probeGroqHealth } from '@/lib/groq';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin allow-list — env-driven so a real production admin can be
// added without a code deploy. `demo-user-001` is the soft-launch
// admin (demo mode + Clerk-mode dev both resolve to it via the
// Round-85 demo fallback).
const ADMIN_ALLOWLIST = String(process.env.ADMIN_USER_IDS || 'demo-user-001')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export async function GET(request) {
  const clerkId = await resolveClerkId(request);
  if (!clerkId) {
    return NextResponse.json({ error: 'Inte inloggad — logga in först' }, { status: 401 });
  }
  if (!ADMIN_ALLOWLIST.includes(clerkId)) {
    return NextResponse.json({ error: 'Endast för administratörer' }, { status: 403 });
  }

  const probe = await probeGroqHealth();

  return NextResponse.json({
    status: probe.status,
    groq: {
      quotaExhausted: probe.quotaExhausted,
      mockMode: probe.mockMode,
      reachable: probe.reachable,
      detail: probe.detail,
    },
    timestamp: new Date().toISOString(),
  });
}
