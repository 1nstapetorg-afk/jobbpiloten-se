'use client'

// Round-78 / urgent-debug — Root-layout catastrophic error boundary.
// IMPORTANT: this file is rendered OUTSIDE the root layout, so it
// MUST include its own <html> + <body> wrapper. Next.js's docs are
// explicit about this. Without it, ANY error that escapes the root
// layout itself surfaces as the cryptic "missing required error
// components, refreshing..." dev-overlay message.
//
// Inline styles only — no imports of custom components, no
// Tailwind classes, no theme provider. Reason: a global-error
// crash happens AFTER the entire provider tree has failed, so
// any dependency on those providers would re-crash.

export default function GlobalError({ error, reset }) {
  // Inline style sheet (no Tailwind) so this component works even
  // if the user-agent never delivered the global stylesheet.
  const cardStyle = {
    maxWidth: 480,
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '32px 24px',
    textAlign: 'center',
    boxShadow: '0 4px 16px rgba(15, 23, 42, 0.06)',
  }
  const buttonStyle = {
    background: '#0f172a',
    color: '#ffffff',
    border: 0,
    borderRadius: 8,
    padding: '10px 20px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
  }

  return (
    <html lang="sv">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: '#f8fafc',
          }}
        >
          <div style={cardStyle}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>
              Något gick fel på riktigt
            </h1>
            <p style={{ color: '#475569', margin: '0 0 24px', lineHeight: 1.5 }}>
              Vi kunde inte ladda appen — en kritisk komponent kraschade. Försök igen,
              eller rapportera felet om det fortsätter.
            </p>
            {error && error.message ? (
              <pre
                data-testid="global-error-message"
                style={{
                  background: '#f1f5f9',
                  color: '#dc2626',
                  fontSize: 12,
                  textAlign: 'left',
                  borderRadius: 6,
                  padding: 12,
                  overflowX: 'auto',
                  marginBottom: 16,
                  maxHeight: 160,
                }}
              >
                {String(error.message)}
              </pre>
            ) : null}
            <button
              type="button"
              onClick={() => reset && reset()}
              data-testid="global-error-reset"
              style={buttonStyle}
            >
              Försök igen
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
