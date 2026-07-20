# E2E tests (Playwright + Chromium)

This folder holds end-to-end tests written in `@playwright/test`. They
drive a real Chromium browser against a running `yarn dev` instance and
exercise the most user-visible surfaces of /settings + the new
dashboard gear-icon navigation.

## Assumed preconditions

For the tests to actually pass, the dev environment must have:

- **A running Next.js dev server.** The Playwright config's `webServer`
  block runs `yarn dev` automatically unless one is already up on
  `http://localhost:3000`.
- **A reachable MongoDB** with at least one seeded profile for the
  `demo-user-001` clerkId (the cookie `_fixtures/auth.js` injects).
  Run the dev onboarding flow once (or pre-seed the DB) before
  triggering the suite.
- **Clerk keys absent / placeholder** so the server falls back to the
  demo-cookie auth path (see `lib/auth.js` → `getDemoUserId`).

If any of these is not satisfied the test will not pass; we deliberately
keep the suite narrow so failures point at exactly one cause.

## Running locally

```bash
yarn dev                  # in one shell, OR let Playwright auto-spin it
yarn test:e2e             # in another shell

# Or with a visible browser (helpful when iterating on UI):
yarn test:e2e:headed

# List tests without running (parses the specs; useful in CI):
yarn test:e2e:list

# Against staging / production:
PLAYWRIGHT_BASE_URL=https://jobbpiloten.se yarn test:e2e
```

## Auth pattern

All tests extend a single fixture in `_fixtures/auth.js` that injects
the `demoUserId=demo-user-001` cookie into the browser context **before**
the page navigates. This matches the demo-mode fallback that lives in
`lib/auth.js` server-side. No global storageState file is needed.

## Covered surfaces

- `settings.spec.js` — profile editor (loaded form, dirty + save flow,
  GDPR export download, GDPR art. 17 phrase-gate delete dialog).
- `dashboard-nav.spec.js` — gear-icon visibility + click-through to
  /settings, plus the back-to-dashboard affordance from /settings.

## When adding a new spec

- Always import `test, expect` from `./_fixtures/auth`, never directly
  from `@playwright/test`, so the demo cookie seeds the context.
- Add `data-testid` attributes to any new interactive surface so the
  test can find it deterministically — `data-testid` survives
  refactors better than role label hunting.
- If a test starts depending on a new fixture (logged-in user with
  profile, etc.) add a fresh fixture under `_fixtures/` instead of
  patching the auth fixture blindly.
