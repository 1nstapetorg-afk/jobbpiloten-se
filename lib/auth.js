/**
 * Auth utility — single source of truth for Clerk vs Demo mode detection,
 * Clerk-or-demo userId resolution, and the route-level requireAuth helper
 * that wraps a missing userId in a ready-to-go 401 NextResponse.
 *
 * Three route handlers (catch-all, upload-cv, extension-token) used to
 * carry their own inline copies of `isClerkConfigured` + `requireAuth`
 * + `resolveClerkId` — the 401 message drifted at one point (catch-all
 * said "Unauthorized", upload-cv said "Unauthorized — logga in i
 * demoläge") and the inline checks tested different placeholder patterns.
 * Centralising here makes the contract identical across all callers and
 * keeps the key-rejection logic in one auditable place.
 *
 * Round-10 tightening: the previous version called `isClerkConfigured()`
 * twice on the auth-failing path (once inside `resolveClerkId` to pick
 * Clerk-vs-demo, once in `requireAuth` to choose the message). Both
 * reads were redundant — the env-var check is a stable property for
 * the lifetime of a single request. The refactored `resolveAuthState`
 * computes the branch ONCE and threads `demo: boolean` through to
 * `requireAuth`. Public API of `resolveClerkId` and `requireAuth`
 * unchanged; behaviour identical.
 */

import { NextResponse } from 'next/server'
import { isClerkConfiguredServer } from '@/lib/clerk-config'

/**
 * Demo-mode user id resolver. Reads the `x-demo-user-id` header first
 * (used by fetch() calls from the client), then falls back to parsing
 * the `demoUserId=...` cookie. Returns null when neither path yields
 * an id.
 */
export function getDemoUserId(request) {
  const headerId = request.headers?.get('x-demo-user-id')
  if (headerId) return headerId

  const cookieStr = request.headers?.get('cookie') || ''
  const match = cookieStr.match(/demoUserId=([^;]+)/)
  if (match) return decodeURIComponent(match[1])
  return null
}

/**
 * Demo user object — mirror of Clerk's useUser() shape so the demo-mode
 * session shows the dashboard's onboarding UI identically to a real
 * Clerk login. Used by the client `useAuth()` shim (hooks/useAuth.js).
 */
export function getDemoUser() {
  return {
    id: 'demo-user-001',
    firstName: 'Demo',
    lastName: 'Användare',
    fullName: 'Demo Användare',
    primaryEmailAddress: {
      emailAddress: 'demo@jobbpiloten.se',
    },
    emailAddresses: [
      { emailAddress: 'demo@jobbpiloten.se', id: 'demo-email-1' },
    ],
    imageUrl: null,
    createdAt: new Date(),
  }
}

/**
 * Internal helper — do the Clerk-vs-demo branch ONCE per request and
 * return both pieces of state. Used by:
 *   • `resolveClerkId` (below) — only needs the userId string.
 *   • `requireAuth` (below) — needs the `demo` flag to choose the
 *     Swedish demo-mode 401 message.
 *
 * Calling `isClerkConfiguredServer()` once here (instead of twice across the
 * two helpers) saves one env-var read per failing-auth request. That's
 * a trivial perf win individually, but the design intent is more
 * important: the demo-vs-clerk branch is a single decision that
 * BOTH helpers need to make, and surfacing it via `resolveAuthState`
 * keeps that single-decision invariant obvious to the next reader.
 */
async function resolveAuthState(request) {
  const configured = isClerkConfiguredServer()
  if (configured) {
    const { auth } = await import('@clerk/nextjs/server')
    const { userId } = await auth()
    return { userId: userId || null, demo: false }
  }
  return { userId: getDemoUserId(request), demo: true }
}

/**
 * Resolve the active user's clerkId. Under Clerk, returns the
 * `auth().userId`. Under demo mode, returns the `getDemoUserId` value.
 * Returns null if neither path yields an id.
 *
 * Distinct from `requireAuth` (below) — callers that want to handle
 * "no user" themselves (e.g. the extension-token POST which returns a
 * custom "Inte inloggad" Swedish message) use this directly; route
 * handlers that just want the 401 boilerplate use `requireAuth`.
 */
export async function resolveClerkId(request) {
  const { userId } = await resolveAuthState(request)
  return userId
}

/**
 * Route-level auth wrapper. Returns either `{ userId }` or
 * `{ error: NextResponse }` so a handler can do:
 *
 *   const { userId, error } = await requireAuth(request)
 *   if (error) return error
 *
 * The 401 message is bilingual-friendly depending on mode:
 *   • Clerk mode → "Unauthorized" (Clerk's own sign-in handles the UI).
 *   • Demo mode → "Unauthorized — logga in i demoläge" (the demo login
 *     form expects this exact phrase to render the inline demo button).
 *
 * The `demo` flag comes from the same `resolveAuthState` call that
 * resolved the userId, so we don't re-check `isClerkConfiguredServer()` here.
 */
export async function requireAuth(request) {
  const { userId, demo } = await resolveAuthState(request)
  if (!userId) {
    return {
      error: NextResponse.json(
        { error: demo ? 'Unauthorized — logga in i demoläge' : 'Unauthorized' },
        { status: 401 },
      ),
    }
  }
  return { userId }
}
