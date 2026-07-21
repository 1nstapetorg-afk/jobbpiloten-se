'use client'

// Round-78 / urgent-debug — Per-route ErrorBoundary.
// Without this file Next.js's dev-overlay shows the cryptic
// `missing required error components, refreshing...` message and
// never surfaces the underlying error. Adding it makes every
// route's error legible to the developer (and to the user).
//
// Behaviour:
//   • Logs the error + componentStack via console.error so the
//     server-side stderr actually captures THE real error (was
//     silently swallowed before).
//   • Renders a Swedish "Något gick fel" UI with the actual
//     error message + a "Försök igen" reset button (Next.js
//     calls `reset()` which re-try-renders the segment).

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function Error({ error, reset }) {
  useEffect(() => {
    // SURFACE THE REAL ERROR: previously this fired-and-died
    // silently because the dev-overlay consumed the error before
    // it reached our boundary. Now it logs to stderr so the
    // dev-server console (and CI logs) capture the actual stack.
    console.error('[app/error.tsx] caught route error:', error)
    if (error && error.stack) {
      console.error('[app/error.tsx] component/cause stack:', error.stack)
    }
  }, [error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-slate-200 p-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Något gick fel</h1>
        <p className="text-slate-600 mb-6">
          Vi kunde inte ladda sidan. Försök igen — eller rapportera felet om det fortsätter.
        </p>
        {error && error.message ? (
          <pre
            data-testid="route-error-message"
            className="bg-slate-100 text-left text-xs rounded p-3 overflow-x-auto mb-6 max-h-40 text-slate-800"
          >
            {String(error.message)}
          </pre>
        ) : null}
        <Button onClick={() => reset && reset()} className="w-full" data-testid="route-error-reset">
          Försök igen
        </Button>
      </div>
    </div>
  )
}
