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

// Round-88 — demo connect fix (Clerk-configured non-production).
// `localStorage.jobbpiloten_forceDemo === '1'` is set ONLY by the
// explicit "Logga in som demo-användare" button (extension-auth +
// sign-in). In non-production with Clerk configured but NO Clerk
// session, that flag makes useUser() return the demo user from
// localStorage — mirroring the server's Round-85 demo-cookie
// fallback (lib/auth.js). Production ignores the flag entirely
// (Clerk remains the only auth boundary); and a REAL Clerk session
// always wins, even in non-production, so a stale demo flag can
// never shadow a signed-in Clerk user.
const FORCE_DEMO_KEY = 'jobbpiloten_forceDemo'

export function useUser() {
  const isConfigured = isClerkConfigured();
  const demo = useDemoUser();

  const [clerkUser, setClerkUser] = useState({ user: null, isLoaded: false, isSignedIn: false });
  const [forceDemoUser, setForceDemoUser] = useState(() => {
    if (process.env.NODE_ENV === 'production') return null;
    if (typeof window === 'undefined') return null;
    try {
      if (window.localStorage.getItem(FORCE_DEMO_KEY) !== '1') return null;
      const raw = window.localStorage.getItem('demoUser');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  });

  // React to the flag being set AFTER mount (demo button click in a
  // same-tab flow without a reload, or a storage event from another
  // tab). The extension-auth flow reloads after signInDemo, but
  // keeping this listener makes the flag live for any future caller.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const sync = () => {
      try {
        if (window.localStorage.getItem(FORCE_DEMO_KEY) === '1') {
          const raw = window.localStorage.getItem('demoUser');
          setForceDemoUser(raw ? JSON.parse(raw) : null);
        } else {
          setForceDemoUser(null);
        }
      } catch (_) {
        setForceDemoUser(null);
      }
    };
    window.addEventListener(FORCE_DEMO_KEY, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(FORCE_DEMO_KEY, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

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

  // A real Clerk session always wins — non-production demo flag only
  // kicks in when Clerk yields no session (mirror of lib/auth.js).
  if (clerkUser.user) return clerkUser;
  if (forceDemoUser) return { user: forceDemoUser, isLoaded: true, isSignedIn: true };

  return clerkUser;
}