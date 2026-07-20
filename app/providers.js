'use client';

/**
 * Providers wrapper.
 * When Clerk keys are valid → wraps in ClerkProvider + QueryClientProvider.
 * When Clerk keys are invalid → wraps in DemoAuthProvider + QueryClientProvider.
 *
 * DemoAuthProvider provides a React Context that matches Clerk's useUser() shape,
 * so existing page components work without import changes.
 *
 * Also mounts the shadcn/Sonner <Toaster /> so any call to `toast.success(...)`
 * renders the floating toast notification anywhere in the app.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster, toast } from '@/components/ui/sonner';
import InstallBanner from '@/components/InstallBanner';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { setDemoSessionCookie, hasDemoSessionCookie } from '@/lib/auth-cookie';
import { isClerkConfiguredClient } from '@/lib/clerk-config';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

// ---- Demo Auth Context (mirrors Clerk's useUser) ----
const DemoAuthContext = createContext({
  user: null,
  isLoaded: false,
  isSignedIn: false,
});

export const useDemoUser = () => useContext(DemoAuthContext);

function DemoAuthProvider({ children }) {
  const [state, setState] = useState({ user: null, isLoaded: false, isSignedIn: false });

  useEffect(() => {
    // Check if we have a demo user session (from sign-in form)
    const stored = localStorage.getItem('demoUser');
    if (stored) {
      try {
        const user = JSON.parse(stored);
        // Re-bootstrap the demo auth cookie from localStorage if it's
        // missing. The cookie (30-day TTL, see sign-in page) can be
        // wiped by browser privacy settings, dev tools, or expire on
        // a long gap between sessions — but localStorage is more
        // durable. Without this re-bootstrap, the next API call
        // would 401 (server reads the cookie only) and the dashboard
        // would redirect to /onboarding as if the profile were
        // missing, which looks like "lost my login". The Clerk
        // guard is critical: a Clerk-mode user with stale
        // `localStorage.demoUser` from a previous demo session must
        // NOT have the demo cookie re-bootstrapped — otherwise the
        // server would route them into demo data on top of their
        // real Clerk session. Uses the shared helper from
        // `lib/auth-cookie.js` so the TTL / SameSite / conditional
        // Secure flag stay in lock-step with the sign-in and
        // onboarding pages.
        if (!isClerkConfiguredClient() && !hasDemoSessionCookie()) {
          setDemoSessionCookie(user.id);
        }
        setState({ user, isLoaded: true, isSignedIn: true });
        return;
      } catch (e) {
        // ignore parse error
      }
    }

    // No demo user — still mark loaded so pages render (they'll redirect to sign-in)
    setState({ user: null, isLoaded: true, isSignedIn: false });
  }, []);

  return (
    <DemoAuthContext.Provider value={state}>
      {children}
    </DemoAuthContext.Provider>
  );
}

// ---- Dynamic Clerk wrapper ----
function ClerkAwareProvider({ children }) {
  const [ClerkProvider, setClerkProvider] = useState(null);
  const [clerkLoaded, setClerkLoaded] = useState(false);

  useEffect(() => {
    // Only check on client side. Canonical check lives in
    // lib/clerk-config.js — the public-key-only variant is correct
    // here because we only need to decide whether to mount
    // <ClerkProvider /> client-side; the server's secret-key check
    // runs separately inside `lib/auth.js#requireAuth`.
    const isConfigured = isClerkConfiguredClient();

    if (isConfigured) {
      // Dynamically import ClerkProvider only when keys are valid
      import('@clerk/nextjs').then(mod => {
        setClerkProvider(() => mod.ClerkProvider);
        setClerkLoaded(true);
      }).catch(() => {
        // Fallback if Clerk fails to load
        setClerkLoaded(true);
      });
    } else {
      setClerkLoaded(true);
    }
  }, []);

  if (!clerkLoaded) {
    // Show nothing while determining auth mode (brief flash)
    return (
      <QueryClientProvider client={queryClient}>
        <DemoAuthProvider>{children}</DemoAuthProvider>
      </QueryClientProvider>
    );
  }

  if (ClerkProvider) {
    return (
      <QueryClientProvider client={queryClient}>
        <ClerkProvider
          publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
          signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || '/sign-in'}
          signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || '/sign-up'}
          signInFallbackRedirectUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL || '/dashboard'}
          signUpFallbackRedirectUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL || '/onboarding'}
        >
          {children}
        </ClerkProvider>
      </QueryClientProvider>
    );
  }

  // Clerk not configured — use demo auth
  return (
    <QueryClientProvider client={queryClient}>
      <DemoAuthProvider>{children}</DemoAuthProvider>
    </QueryClientProvider>
  );
}

// ---- Global observability bridge (Round-9 followup closure) ----
// 2026-07-12 — The /extension-auth popup page emits a window-scoped
// CustomEvent('jobbpiloten:tokenMinted', { detail: { source, ts,
// tokenPrefix, firstName } }) on every successful mint. Without a
// consumer the emit is invisible — only /settings showed a new
// connection on the next refresh. This bridge mounts ONE global
// listener that converts the event into a Sonner toast. The detail
// shape is privacy-safe by construction (tokenPrefix ≤ 8 hex chars,
// NO full bearer / email / profile serialised) — see the
// privacy-contract e2e test in tests/e2e/extension-auth-handshake.
//
// Why mount globally in Providers instead of in /settings:
//   • A user watching the dashboard can confirm the handshake
//     completed without navigating to /settings.
//   • Future surfaces (e.g. browser push notifications when the tab
//     is backgrounded) can hook the same event without touching
//     /extension-auth.
//
// SSR-safe: returns null. useEffect is no-op on the server because
// we early-return when typeof window === 'undefined'.
function TokenMintBridge() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onTokenMinted(ev) {
      const detail = (ev && ev.detail) || {}
      // Defensive parsing: the popup-side emit is contract-locked by
      // the e2e suite, but a regression that breaks the contract
      // shouldn't throw inside the listener — we degrade to a generic
      // toast instead of white-screening the page.
      const rawFirstName = String(detail.firstName || 'Användare').slice(0, 50)
      const source = detail.source === 'extension-popup-auth' ? 'Popup' : 'Dashboard'
      const prefix = String(detail.tokenPrefix || '').slice(0, 8)
      const desc = prefix
        ? `${rawFirstName} — ansluten via ${source}. Tokenprefix: ${prefix}…`
        : `${rawFirstName} — ansluten via ${source}.`
      toast.success('JobbPiloten-tillägget anslutet ✓', {
        description: desc,
        duration: 4000,
      })
    }
    window.addEventListener('jobbpiloten:tokenMinted', onTokenMinted)
    return () => window.removeEventListener('jobbpiloten:tokenMinted', onTokenMinted)
  }, [])
  return null
}

export function Providers({ children }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <ClerkAwareProvider>
        {/* Sonner toast portal — renders floating notifications. Position
            top-right on desktop, bottom on mobile via Toaster's responsive
            defaults. richColors makes success/error/info visually distinct. */}
        <Toaster richColors position="top-right" closeButton />
        {children}
        {/* Mounted globally so the PWA install prompt can appear on any
            page (landing, dashboard, sign-in, etc.). The component listens
            for `beforeinstallprompt` and only renders when the browser
            signals the site is installable. SSR-safe: returns null until
            the event fires on the client. */}
        <InstallBanner />
        {/* Round-9 observability bridge — converts the popup-side
            CustomEvent into a Sonner toast (visible anywhere in the
            app). Returns null; mounts a single addEventListener. */}
        <TokenMintBridge />
      </ClerkAwareProvider>
    </ThemeProvider>
  );
}