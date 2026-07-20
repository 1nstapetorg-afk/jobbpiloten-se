'use client';

/**
 * Unified auth hook — replaces direct imports from @clerk/nextjs.
 *
 * When Clerk keys are valid → uses Clerk's useUser()
 * When Clerk keys are invalid → uses DemoAuthProvider context
 *
 * Both return the same shape: { user, isLoaded, isSignedIn }
 */

import { useEffect, useState } from 'react';
import { useDemoUser } from '@/app/providers';
import { isClerkConfiguredClient } from '@/lib/clerk-config';

// Client-side check for Clerk configuration. The canonical
// implementation lives in lib/clerk-config.js — see that file for
// the rationale behind the public/secret split.
const isClerkConfigured = isClerkConfiguredClient;

export function useUser() {
  const isConfigured = isClerkConfigured();
  const demo = useDemoUser();

  const [clerkUser, setClerkUser] = useState({ user: null, isLoaded: false, isSignedIn: false });

  useEffect(() => {
    if (!isConfigured) return;

    let cancelled = false;
    // Dynamic import to avoid crash when Clerk module fails
    import('@clerk/nextjs').then(mod => {
      if (cancelled) return;
      try {
        const result = mod.useUser();
        setClerkUser(result);
      } catch (e) {
        // Clerk hook threw (e.g. no ClerkProvider) — use demo fallback
        if (!cancelled) setClerkUser({ user: null, isLoaded: true, isSignedIn: false });
      }
    }).catch(() => {
      if (!cancelled) setClerkUser({ user: null, isLoaded: true, isSignedIn: false });
    });

    return () => { cancelled = true; };
  }, [isConfigured]);

  if (!isConfigured) return demo;

  return clerkUser;
}