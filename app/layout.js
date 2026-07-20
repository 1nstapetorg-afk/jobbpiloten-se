import { Providers } from './providers';
import DemoBanner from '@/components/DemoBanner';
import CookieConsent from '@/components/CookieConsent';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SITE_URL } from '@/lib/siteConfig';
import './globals.css';

// PWA-specific viewport. Next 15 exposes this through `viewport` export so
// the <meta name="viewport"> and <meta name="theme-color"> tags are emitted
// automatically. viewportFit: 'cover' lets the page extend under the iOS
// notch / Android status bar — required for a "feels native" install.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#f59e0b',
}

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'JobbPiloten — Din AI-assistent för jobbsökandet',
  description: 'AI hittar matchande jobb och skriver personliga brev. Du granskar och skickar. Aktivitetsrapport till Arbetsförmedlingen ingår.',
  keywords: 'jobbsökning, AI, Arbetsförmedlingen, CV, personligt brev, Sverige',
  // PWA — installable site, opens standalone (no browser chrome).
  applicationName: 'JobbPiloten',
  appleWebApp: {
    capable: true,
    title: 'JobbPiloten',
    statusBarStyle: 'default',
  },
  formatDetection: {
    telephone: false,
  },
  manifest: '/manifest.json',
  openGraph: {
    title: 'JobbPiloten — Din AI-assistent för jobbsökandet',
    description: 'AI hittar matchande jobb och skriver personliga brev — du skickar ansökningarna',
    images: ['/og-image.svg'],
    type: 'website',
    locale: 'sv_SE',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'JobbPiloten',
    description: 'Din AI-assistent för jobbsökandet',
    images: ['/og-image.svg'],
  },
  icons: {
    // PNG icons listed first — modern launchers and Lighthouse installability
    // audits score higher when PNG entries are present. SVG variants stay
    // as a secondary tier for browsers that prefer SVG and as inline
    // (no extra HTTP request) fallback.
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
      { url: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
      { url: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
    ],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="sv" suppressHydrationWarning>
      <head>
        {/* Tell browser translation extensions not to rewrite our markup (avoids hydration lang/text mismatches) */}
        <meta name="google" content="notranslate" />
        {/* iOS PWA defaults — status bar tint matches our amber theme so the
            standalone launch reads as one continuous surface. */}
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="JobbPiloten" />
      </head>
      <body translate="no">
        {/* TooltipProvider lives at the layout root so every page that mounts
            a Radix <Tooltip> can skip its own Provider wrapper. Keeps the
            150ms delayDuration consistent app-wide (Settings, Onboarding,
            Dashboard, Landing etc.) and prevents the duplication that
            Issue #3 of the soft-launch checklist called out. */}
        <TooltipProvider delayDuration={150}>
          <Providers>
            <DemoBanner />
            {children}
            {/* CookieConsent — GDPR banner. Mounted OUTSIDE the
                per-page Suspense tree so the banner survives
                route-level fallbacks without unmounting. Renders
                nothing until client hydration reads localStorage,
                which keeps the SSR markup free of FOUC for
                returning users (see components/CookieConsent.jsx
                for the full hydration rationale). */}
            <CookieConsent />
          </Providers>
        </TooltipProvider>
      </body>
    </html>
  );
}
