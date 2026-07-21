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
 */

import { NextResponse } from 'next/server';
import { isClerkConfiguredServer } from '@/lib/clerk-config';

export default async function middleware(req) {
  // If Clerk is not configured, skip all auth protection (demo mode)
  if (!isClerkConfiguredServer()) {
    return NextResponse.next();
  }

  // Clerk is configured — wrap in try/catch so a Clerk mount-time
  // or first-request failure (key format rejection, network blip to
  // clerk.accounts.dev, V7 SDK incompat with Next 15 Edge runtime)
  // doesn't take down every route with a 500. Round-78 diagnostic
  // confirmed middleware.js was the cascade trigger: when Clerk
  // threw, Next.js returned the dev-overlay "missing required
  // error components, refreshing..." body for ALL routes because
  // middleware runs BEFORE the route renders.
  try {
    const { clerkMiddleware, createRouteMatcher } = await import('@clerk/nextjs/server');

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
        await auth.protect();
      }
    });

    return await clerkMw(req);
  } catch (error) {
    // SURFACE THE REAL ERROR: previously this fired-and-died silently
    // because the dev-overlay caught it before Next.js logged to
    // stderr. Now it logs so the dev-server console + CI capture it.
    console.error('[middleware] Clerk middleware init/execution failed:', error && error.message ? error.message : error)
    // Graceful degradation: allow the request through (server-side
    // route handlers will enforce auth via lib/auth.js#requireAuth).
    // This matches the demo-mode behaviour (NextResponse.next()).
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