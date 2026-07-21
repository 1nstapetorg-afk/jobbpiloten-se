'use client'

import { useEffect } from 'react'

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error('[app/error.tsx] Root layout error caught:', error)
  }, [error])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '2rem',
      fontFamily: 'system-ui, sans-serif',
      textAlign: 'center',
    }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: '#dc2626' }}>
        Något gick fel
      </h1>
      <p style={{ marginBottom: '1.5rem', color: '#6b7280', maxWidth: '480px' }}>
        Ett oväntat fel uppstod när sidan skulle laddas. Försök igen eller
        kontrollera att alla miljövariabler är korrekt konfigurerade.
      </p>
      <pre style={{
        background: '#f3f4f6',
        padding: '1rem',
        borderRadius: '8px',
        fontSize: '0.8rem',
        color: '#374151',
        maxWidth: '100%',
        overflow: 'auto',
        marginBottom: '1.5rem',
        textAlign: 'left',
      }}>
        {error?.message || 'Inget felmeddelande tillgängligt'}
      </pre>
      <button
        onClick={() => reset()}
        style={{
          padding: '0.75rem 1.5rem',
          background: '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '1rem',
        }}
      >
        Försök igen
      </button>
    </div>
  )
}
