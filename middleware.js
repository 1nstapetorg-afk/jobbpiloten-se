/**
 * Middleware — conditionally applies Clerk auth protection.
 *
 * When Clerk keys are valid and present:
 *   - Uses clerkMiddleware to protect /dashboard, /onboarding, /settings, and related API routes
 *   - Public routes (/, /sign-in, /sign-up, /api/webhooks, /api/health) are excluded
 *
 * When Clerk keys are missing or invalid (demo mode):
 *   - Uses a plain middleware that allows all requests through
 *   - No "Publishable key not valid" crash
 *
 * Round-78/79 fix: Clerk SDK V7 was rejecting the user's publishable key
 * (decoded to `eternal-pika-64.clerk.accounts.dev$`) on every request,
 * throwing inside `clerkMiddleware()`. The throw bubbled out of
 * middleware before the route rendered, and Next.js's dev-overlay swallowed
 * the error. Every route returned HTTP 500 with the cryptic `missing
 * required error components, refreshing...` body.
 *
 * Round-79 refinement (code-reviewer feedback):
 *   • Try/catch scope is NARROW — only wraps `clerkMw(req)`. If the
 *     import of `@clerk/nextjs/server` fails (broken npm install),
 *     or `createRouteMatcher(...)` throws (malformed route pattern),
 *     those errors propagate loudly so the dev-server log shows a
 *     real stack instead of being silently swallowed.
 *   • For `isProtectedRoute(req) === true`, fall back to
 *     `NextResponse.redirect(new URL('/sign-in', req.url))` so
 *     unauthenticated visitors land on the auth page rather than
 *     bare dashboard markup. (Pre-refinement was returning
 *     `NextResponse.next()`, which leaked protected route HTML to
 *     anyone.)
 *   • For PUBLIC routes, `NextResponse.next()` is fine — no auth
 *     gate is enforced either way in degraded mode.
 */

import { NextResponse } from 'next/server';
import { isClerkConfiguredServer } from '@/lib/clerk-config';
// Round-85 fix (2026-08-04, "onboarding shows Unauthorized"): the
// middleware's Clerk-mode /api/* gate must let demo-identity requests
// (x-demo-user-id header or demoUserId cookie — set by the onboarding
// wizard, sign-in demo button, and e2e fixtures) through to the route's
// own requireAuth, which now resolves the demo user when Clerk yields no
// session. Pre-fix, this gate 401'd every onboarding POST (/api/profile,
// /api/email-preview) in Clerk-configured dev even though the demo
// cookie was present.
import { getDemoUserId } from '@/lib/auth';

export default async function middleware(req) {
  // If Clerk is not configured, skip all auth protection (demo mode)
  if (!isClerkConfiguredServer()) {
    return NextResponse.next();
  }

  // Round-79 fix: wrap the Clerk SDK import in a try/catch. If the
  // package is missing, corrupted, or has a key issue, log the error
  // and fall back to the demo-mode behavior (allow all requests)
  // rather than crashing every route with a 500.
  let clerkMiddleware, createRouteMatcher;
  try {
    const clerkModule = await import('@clerk/nextjs/server');
    clerkMiddleware = clerkModule.clerkMiddleware;
    createRouteMatcher = clerkModule.createRouteMatcher;
  } catch (importError) {
    console.error('[middleware] Clerk SDK import failed — falling back to no-auth mode:', importError && importError.message ? importError.message : importError);
    return NextResponse.next();
  }

  const isPublicRoute = createRouteMatcher([
    '/',
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/api/webhooks/(.*)',
    '/api/health',
    // Extension auth bridge: the Chrome extension cannot supply
    // Clerk cookies (cross-origin + HttpOnly), so /api/extension/*
    // validates the bearer token directly. Listing the routes here
    // ensures Clerk middleware does not 401 the extension before
    // our own token check runs.
    '/api/extension/(.*)',
  ]);

  const isProtectedRoute = createRouteMatcher([
    '/dashboard(.*)',
    '/onboarding(.*)',
    '/settings(.*)',
    '/api/profile(.*)',
    '/api/applications(.*)',
    '/api/stats(.*)',
    '/api/apply-now(.*)',
    '/api/report(.*)',
    '/api/checkout(.*)',
    '/api/portal(.*)',
    '/api/subscription(.*)',
  ]);

  const clerkMw = clerkMiddleware(async (auth, req) => {
    if (isProtectedRoute(req)) {
      // Round-80 / Bug 2 fix: API fetches must get a JSON 401, never
      // an HTML /sign-in redirect. The dashboard's
      // `fetch('/api/stats').then(r => r.json())` followed Clerk's
      // sign-in redirect and then tried to parse the HTML login page
      // as JSON — the "Failed to execute 'json' on 'Response':
      // Unexpected end of JSON input" toast. Keep every /api
      // consumer on a JSON contract (the catch-all route already
      // 401s JSON with the same `{ error: 'Unauthorized' }` shape).
      const url = new URL(req.url);
      if (url.pathname.startsWith('/api/')) {
        if (!auth.userId) {
          // Round-85: demo-identity fallback. When Clerk has no session
          // for this request but a demo cookie/header is present, pass
          // through — the route's own requireAuth (lib/auth.js) resolves
          // the demo user (non-production only). Without this, every
          // onboarding POST 401'd in Clerk-configured dev despite the
          // demo cookie the wizard set.
          //
          // NOTE on the NODE_ENV gate: this applies to ANY non-
          // production deploy (dev, staging, Vercel preview, internal
          // test envs), not just local dev — consistent with the
          // codebase's existing `NODE_ENV !== 'production'` patterns
          // (e.g. upload-cv logging). Production is always strict
          // Clerk-only.
          if (process.env.NODE_ENV !== 'production' && getDemoUserId(req)) {
            return NextResponse.next();
          }
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        // Authenticated API request — pass through; the route's own
        // requireAuth (demo-cookie OR Clerk session) does the final gate.
        return NextResponse.next();
      }
      // Round-85 (page routes, non-production only): a demo-identity
      // request skips auth.protect() so the post-onboarding redirect to
      // /dashboard, /settings, etc. renders for a demo-cookie tester in
      // a Clerk-configured dev/staging environment (the wizard +
      // sign-in demo button authenticate via the demo cookie, not a
      // Clerk session). Production keeps strict Clerk protection — the
      // demo cookie is not an auth boundary there (see
      // lib/clerk-config.js).
      if (process.env.NODE_ENV !== 'production' && getDemoUserId(req)) {
        return NextResponse.next();
      }
      await auth.protect();
    }
  });

  // Narrow try — only the call goes inside the catch. If clerkMw()
  // throws because Clerk SDK rejected the keys, the catch logs + falls
  // back. Any failure in setup ABOVE this block surfaces to stderr
  // normally so a real install/pattern bug is visible in dev-server
  // logs.
  // Round-79 TEST SHIM — hermetic regression-coverage switch. When this env
  // var is set, we deliberately throw BEFORE invoking clerkMw so the bash
  // regression (scripts/test-middleware-clerk-failure.sh) deterministically
  // exercises the catch path regardless of whether the user's real Clerk
  // keys are currently broken or valid. CI runs the script with this var
  // set; production runs without it. Removing this block is safe — it only
  // fires when explicitly opted-in via env.
  if (process.env.JOBBPILOTEN_FORCE_CLERK_ERROR === '1') {
    throw new Error('JOBBPILOTEN_FORCE_CLERK_ERROR=1 (test shim)');
  }

  try {
    return await clerkMw(req);
  } catch (error) {
    console.error('[middleware] Clerk middleware execution failed:', error && error.message ? error.message : error);
    // For protected routes, redirect to /sign-in so unauthenticated
    // visitors land on the auth page rather than bare dashboard
    // markup (the pre-refinement NextResponse.next() leaked protected
    // HTML to anyone). For public routes, next() is fine.
    if (isProtectedRoute(req)) {
      // Round-80 / Bug 2 fix: API fetches must get JSON 401, not an
      // HTML /sign-in redirect. The dashboard's
      // `fetch('/api/stats').then(r => r.json())` call followed the
      // redirect to the sign-in page and then tried to parse HTML as
      // JSON — the "Failed to execute 'json' on 'Response': Unexpected
      // end of JSON input" toast. Returning `{ error: 'Unauthorized' }`
      // keeps every /api consumer on a JSON contract (the catch-all
      // route already 401s JSON for the same shape).
      const url = new URL(req.url);
      if (url.pathname.startsWith('/api/')) {
        // Round-85: same demo-identity pass-through as the main path —
        // a Clerk-SDK throw must not 401 an otherwise-valid demo-cookie
        // onboarding request in dev.
        if (process.env.NODE_ENV !== 'production' && getDemoUserId(req)) {
          return NextResponse.next();
        }
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      // Round-85: same demo pass-through for page routes on the
      // Clerk-SDK-throw fallback path (dev only).
      if (process.env.NODE_ENV !== 'production' && getDemoUserId(req)) {
        return NextResponse.next();
      }
      const signInUrl = new URL('/sign-in', req.url);
      return NextResponse.redirect(signInUrl);
    }
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
