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

  // Clerk is configured — use clerkMiddleware
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

  return clerkMw(req);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};