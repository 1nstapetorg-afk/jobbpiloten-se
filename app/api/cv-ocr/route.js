/**
 * POST /api/cv-ocr
 *
 * Stub OCR endpoint for scanned-PDF image extraction. Returns
 * `501 Not Implemented` with `code: 'OCR_NOT_CONFIGURED'` so the UI
 * can show a "OCR-tjänsten är inte aktiverad i denna version" amber
 * alert instead of an empty state.
 *
 * Why a stub instead of wiring tesseract.js right now:
 *   • tesseract.js core + swe.traineddata + eng.traineddata adds
 *     ~15-25 MB to the serverless bundle. Vercel's 250 MB cap
 *     allows it but the cold-start penalty (>5s on first OCR call)
 *     is user-visible in the request lifecycle.
 *   • Scanned/image-only PDFs are ~1% of CV uploads today (the AF
 *     auto-fill path doesn't generate them; only deliberate scans).
 *   • The existing manual-summary fallback UX (settings page's
 *     `<empty-hint>` banner → textarea) covers the same user need
 *     with zero bundle impact.
 *   • Deferred to v0.4.0 per PROJECT_STATUS.md. When implemented,
 *     the entry point will be `POST /api/cv-ocr` with a multipart
 *     upload body. Token-gating will follow the AI-fallback opt-in
 *     pattern (`profile.aiFallbackEnabled`).
 *
 * Route is auth-gated so a casual POST still 401s correctly — the
 * contract is "exists + protected, returns 501 once authed".
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Auth gate uses the canonical helper from `@/lib/auth` so the
// 401 message contract (`'Unauthorized' / 'Unauthorized — logga
// in i demoläge'`) is identical to every other protected route.
// See `lib/auth.js#requireAuth` for the Clerk-vs-demo branch and
// `lib/clerk-config.js#isClerkConfiguredServer` for the env-var
// gate that picks the branch.

async function handleNotConfigured() {
  // 501 is the canonical "we know about this route but haven't
  // shipped it yet" status. Returning a structured body lets the
  // settings UI detect this case directly via `code ===
  // 'OCR_NOT_CONFIGURED'` rather than pattern-matching the Swedish
  // error string.
  return NextResponse.json(
    {
      error: 'OCR-tjänsten är inte aktiverad i denna version. Skriv en kort sammanfattning manuellt i fältet nedan — AI:n använder den i dina personliga brev.',
      code: 'OCR_NOT_CONFIGURED',
      // Forward-compatible fields so the eventual implementation can
      // fill these in without breaking the client shape.
      needsManualFallback: true,
      retryWithOcr: false,
      // Drop the implementedIn when the actual tesseract.js wiring
      // ships so the UI can flip from amber-alert to "retry"-button
      // automatically.
      scheduledFor: 'v0.4.0',
    },
    { status: 501 },
  );
}

export async function POST(request) {
  const authRes = await requireAuth(request);
  if (authRes.error) return authRes.error;
  // Future implementation (v0.4.0+):
  //   1. Parse FormData, capture `file` (image/png|jpeg|webp OR
  //      PDF — pdfjs-dist renders the first page to a Canvas in
  //      the browser before posting, OR we render on the server
  //      via pdfjs-dist + node-canvas).
  //   2. Dynamic-import tesseract.js so non-OCR routes don't pay
  //      the ~15 MB startup cost.
  //   3. Run OCR with locale='swe+eng' so Swedish text reads cleanly
  //      even if the scan has a stray English subtitle.
  //   4. Trim + collapse whitespace + cap at MAX_CV_TEXT_CHARS and
  //      return `{ ok: true, cvText, needsManualFallback: cvText==='' }`.
  return handleNotConfigured();
}

// GET is also rejected with 501 — protects against accidental
// browser refreshes leaving the user staring at the same route.
export async function GET() {
  return handleNotConfigured();
}
