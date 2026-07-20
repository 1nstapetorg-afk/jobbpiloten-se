'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * Demo mode banner — shown at the top of every page when Clerk keys are invalid/missing.
 * Dismissible via X button (stored in sessionStorage).
 */
export default function DemoBanner() {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if Clerk is configured
    const pubKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    const isConfigured = pubKey && pubKey.length > 20 && !pubKey.includes('xxx');
    if (isConfigured) {
      setShow(false);
      return;
    }

    // Check if user dismissed the banner this session
    const dismissedFlag = sessionStorage.getItem('demoBannerDismissed');
    if (dismissedFlag) {
      setDismissed(true);
      setShow(false);
    } else {
      setShow(true);
    }
  }, []);

  const handleDismiss = () => {
    sessionStorage.setItem('demoBannerDismissed', 'true');
    setShow(false);
    setDismissed(true);
  };

  if (!show) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5">
      <div className="container mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <span>
            <strong>🔧 Demo-läge</strong> — Clerk-nycklar saknas eller är ogiltiga. 
            Applikationen körs i demonstrationsläge. 
            <a
              href="/sign-in"
              className="ml-1 underline font-medium hover:text-amber-900"
            >
              Logga in som demo-användare
            </a>
            {' '}eller konfigurera Clerk-nycklar i <code className="bg-amber-100 px-1 rounded text-xs">.env</code> för riktig autentisering.
          </span>
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 p-1 rounded hover:bg-amber-100 transition"
          aria-label="Stäng"
        >
          <X className="w-4 h-4 text-amber-600" />
        </button>
      </div>
    </div>
  );
}