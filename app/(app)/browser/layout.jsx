/**
 * app/(app)/browser/layout.jsx — full-screen layout for the Round-95
 * in-app browser (mobile extension replacement).
 *
 * Server component (so it can carry metadata); the page itself is a
 * client component. The layout is intentionally minimal: it establishes a
 * full-height surface with the iOS notch / Android status-bar safe areas
 * applied via CSS env() so the browser chrome never sits under the
 * status bar or home indicator.
 *
 * The background is transparent so that, on NATIVE, the
 * @capgo/capacitor-inappbrowser webview opened with `toBack: true` shows
 * through behind the React chrome. On WEB the page renders its own
 * <iframe> content layer, so the transparent background is harmless.
 */

export const metadata = {
  title: 'Webbläsare — JobbPiloten',
  description: 'Ansök i appen med automatisk ifyllning av din JobbPiloten-profil.',
}

export default function BrowserLayout({ children }) {
  return (
    <div
      className="relative h-[100dvh] w-full overflow-hidden bg-transparent"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {children}
    </div>
  )
}
