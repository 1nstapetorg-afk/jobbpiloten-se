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

// Round-89 — SEO hardening (landing page). App-wide default metadata
// lives here because app/page.js is a client component (Next.js only
// accepts `export const metadata` from Server Components). The title +
// description double as the / landing's <title> and meta description;
// og-image.png (1200×630) is the social share card.
export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'JobbPiloten — AI-driven jobbsökning',
  description: 'AI hittar matchande jobb och skriver personliga brev på svenska. Du granskar och skickar. Aktivitetsrapport till Arbetsförmedlingen ingår.',
  keywords: 'jobbsökning, AI, Arbetsförmedlingen, CV, personligt brev, Sverige',
  // Canonical — the landing lives at the origin root; social scrapers
  // and search engines normalise /?utm=... style duplicates to it.
  alternates: {
    canonical: '/',
  },
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
    title: 'JobbPiloten — AI-driven jobbsökning',
    description: 'AI hittar matchande jobb och skriver personliga brev på svenska — du skickar ansökningarna',
    url: SITE_URL,
    siteName: 'JobbPiloten',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'JobbPiloten — AI-driven jobbsökning',
      },
    ],
    type: 'website',
    locale: 'sv_SE',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'JobbPiloten — AI-driven jobbsökning',
    description: 'Din AI-assistent för jobbsökandet — hitta jobb och få personliga brev skrivna av AI',
    images: ['/og-image.png'],
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
        {/* Round-89 — Plausible analytics (privacy-friendly, no cookies).
            Auto-tracks pageviews for the configured domain; custom
            events (sign_up, onboarding_complete, cover_letter_generated,
            job_applied) fire via window.plausible() from
            lib/analytics.js#trackPlausible. Harmless when absent in dev. */}
        <script defer data-domain="jobbpiloten.se" src="https://plausible.io/js/script.js"></script>
        {/* Round-89 — JSON-LD structured data (SoftwareApplication) so
            search engines can surface JobbPiloten as an app result. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'JobbPiloten',
              description: 'AI-driven jobbsökning: hitta matchande jobb, få personliga brev skrivna av AI på svenska och skicka Aktivitetsrapporten till Arbetsförmedlingen.',
              applicationCategory: 'BusinessApplication',
              operatingSystem: 'Any',
              url: SITE_URL,
              image: `${SITE_URL}/og-image.png`,
              inLanguage: 'sv-SE',
            }),
          }}
        />
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
