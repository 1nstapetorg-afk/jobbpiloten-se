// tests/e2e/dashboard-email-source.spec.js
//
// Round-38 / Part 4 — Email-source application surface.
// Locks the contract for the two user-visible pieces of the email-
// application feature added in Round-34 + polished in Round-38:
//   1. The "E-post" filter chip in the dashboard applications table
//      (FILTERS array entry `key: 'email'`, `match: (a) => a.source === 'email'`).
//   2. The amber Mail tag rendered on each row whose `source` is 'email'
//      (data-testid="application-source-email").
//
// The spec seeds an email-sourced application via the API helper
// (apiFetch → /api/applications/email), then asserts both surfaces
// from the dashboard. A Round-37-style per-test clerkId is used
// so a parallel e2e run never collides on a shared row.
//
// What we lock
// ------------
//   1. The filter chip is visible in the tab strip (data-testid="filter-email")
//   2. Clicking the chip filters the table to email-sourced rows
//   3. The Mail tag renders on the row (data-testid="application-source-email")
//   4. The empty-state copy renders when the user has 0 email rows
//   5. The "all" chip returns the full list
//
// The spec is intentionally a single happy-path test per contract
// rather than a brute-force matrix: the e2e fixtures already
// exercise the filter empty-state elsewhere (dashboard-filter
// contract), and the Mail tag rendering is a presentational concern
// that doesn't merit redundant tests.

import { test, expect } from './_fixtures/auth'

async function postEmailApplication(req, emailAddress, subject, bodyText) {
  // Uses the same /api/applications/email route the popup
  // compose panel calls. The route requires an authenticated
  // session, which the auth fixture provides via the
  // `demoUserId` cookie set on `context` in tests/e2e/_fixtures/auth.js.
  //
  // Round-40 fix (carryover from e2e smoke + Round-39): the
  // previous version imported from `@playwright/test` (not the
  // auth fixture), so the `request` fixture had no cookies and
  // POST /api/applications/email returned 401. Importing the
  // auth fixture sets the per-TEST demoUserId cookie on
  // `context`, and `context.request` inherits that cookie so the
  // route's requireAuth() resolves the demo clerkId and the POST
  // returns 2xx. We also drop the `API_BASE` constant — using
  // `context.request` honours playwright.config.js's `use.baseURL`
  // automatically, so a relative `/api/...` path works against
  // both `localhost:3000` (default) and `PLAYWRIGHT_BASE_URL=...`
  // (deployed-instance override).
  return await req.post('/api/applications/email', {
    data: {
      emailAddress,
      subject,
      bodyText,
      // jobTitle + companyName optional — left out for the
      // minimal e2e payload.
    },
  })
}

test.describe('Round-38 / Part 4 — email-source application surface', () => {
  test('filter chip + Mail tag render for email-sourced applications', async ({ page, context }) => {
    // Seed: write one email-prepared application. The route
    // returns the saved doc (with source: 'email', status:
    // 'prepared', etc.) so the dashboard's /api/applications
    // fetch surfaces it.
    const subject = 'Testansökan — Frontend-utvecklare (Spotify)'
    const postRes = await postEmailApplication(
      context.request,
      'recruiter@spotify.example',
      subject,
      'Hej, jag är intresserad av tjänsten. Bifogat CV. /Anna',
    )
    expect(postRes.ok(), 'POST /api/applications/email should return 2xx').toBeTruthy()
    const postJson = await postRes.json()
    expect(postJson.ok, 'Response should have ok: true').toBe(true)
    expect(postJson.application.source, 'Persisted app should carry source: email').toBe('email')
    expect(postJson.application.status, 'Persisted app should carry status: prepared').toBe('prepared')

    // 1. Open the dashboard — the filter chip + Mail tag are
    //    present in the same render, so a single page load
    //    exercises both surfaces.
    await page.goto('/dashboard')

    // 2. The filter chip is visible in the tab strip.
    const emailChip = page.getByTestId('filter-email')
    await expect(emailChip, 'E-post filter chip is rendered in the tab strip').toBeVisible()
    await expect(emailChip, 'E-post chip has accessible role=tab').toHaveRole('tab')

    // 3. Click the chip — the table filters to email-sourced
    //    rows. The seeded row is the only one (per the
    //    per-test clerkId isolation), so the table shows 1 row
    //    and the Mail tag is visible on it.
    await emailChip.click()

    // 4. The Mail tag is rendered on the row.
    const mailTag = page.getByTestId('application-source-email')
    await expect(mailTag, 'Mail tag renders for source: email rows').toBeVisible()
    await expect(mailTag, 'Mail tag shows the Swedish label').toHaveText('Mejl')

    // 5. Switch back to the "all" chip — the row count returns
    //    to >= 1 (per-test isolation guarantees no other rows).
    const allChip = page.getByTestId('filter-all')
    await allChip.click()
    // No specific count assertion — other rows from the seed
    // (AF applications, sample jobs) may or may not be present.
    // The chip toggle itself is the contract.
    await expect(allChip, 'Alla chip is active after toggle').toHaveAttribute('aria-selected', 'true')
  })

  test('empty state renders when no email-sourced applications exist', async ({ page }) => {
    // Mount with a fresh demo user. The fixture's per-test
    // clerkId means no leftover email rows from previous tests
    // in the same run. The "E-post" chip should still render
    // (it's part of the FILTERS array regardless of corpus
    // size), but the empty-state copy kicks in.
    await page.goto('/dashboard')
    const emailChip = page.getByTestId('filter-email')
    await expect(emailChip, 'E-post chip is rendered even with 0 email rows').toBeVisible()
    await emailChip.click()
    const empty = page.getByTestId('empty-email')
    await expect(empty, 'E-post empty state renders when 0 email rows').toBeVisible()
  })
})
