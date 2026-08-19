// lighthouserc.js — Lighthouse CI configuration (Round-94 followup).
//
// Audits the two primary surfaces on every PR against the Round-94
// targets:
//   Performance    ≥ 0.90
//   Accessibility  ≥ 0.95
//   Best Practices ≥ 0.95
//   SEO            ≥ 0.95
//
// The dashboard route requires auth, so `extraHeaders` forwards the
// same demo-session cookie the e2e suite uses (see
// tests/e2e/_fixtures/auth.js). The CI workflow seeds a demo profile
// for that cookie BEFORE the audit runs so the dashboard renders real
// content instead of redirecting to /onboarding. The landing page
// ignores the cookie and audits anonymously.

module.exports = {
  ci: {
    collect: {
      // Two URLs: the public landing page and the authenticated
      // dashboard. numberOfRuns 2 → LHCI reports the median so a
      // single cold paint can't flake the score either way.
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/dashboard',
      ],
      numberOfRuns: 2,
      settings: {
        // GitHub Actions runners run as root — Chromium refuses to
        // launch the sandbox in that context. --no-sandbox is
        // standard for CI containers (the Playwright suite uses the
        // same approach via its own launcher).
        chromeFlags: '--no-sandbox',
        // Auth for the /dashboard audit: the demo cookie is read
        // server-side by lib/auth.js → getDemoUserId, exactly like
        // the Playwright fixture. Ignored by the anonymous / route.
        extraHeaders: {
          Cookie: 'demoUserId=lhci-audit',
        },
      },
    },
    assert: {
      assertions: {
        // Round-94 targets — each category gates the build (error).
        // If a target is temporarily unreachable while tuning, flip
        // the assertion to 'warn' so the report still publishes but
        // the check stops blocking.
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.95 }],
        'categories:seo': ['error', { minScore: 0.95 }],
        // Sanity caps: a PWA installable check and viewport can both
        // fail on a purely client-rendered route; keep the gate on
        // the four categories above only.
      },
    },
    upload: {
      // temporary-public-storage publishes the HTML report to LHCI's
      // ephemeral storage and prints the shareable URL in the job log.
      // No credentials needed; reports expire after 7 days.
      target: 'temporary-public-storage',
    },
  },
}
