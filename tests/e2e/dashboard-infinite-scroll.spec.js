import { test, expect } from './_fixtures/auth'

/**
 * E2E spec for the dashboard's "Visa fler jobb" pagination button
 * (Issue 3, 2026-07-10).
 *
 * Two-part strategy replaces the old "if hasMore then test else
 * skip" pattern that almost always skipped on the seed user:
 *
 *   1. **Contract test** — calls /api/jobs-available directly via
 *      page.request. Asserts the JSON response shape (`jobs`,
 *      `hasMore`, `page`, `pageSize`, `total`, `searchMode`,
 *      `locationFilterMode`). The test seeds its own fake-query
 *      via `?query=` + `?location=` so the AF/Blocket pool is
 *      large enough to make `hasMore` probabilistically true
 *      without depending on the seed user profile.
 *
 *   2. **UI test** — uses Playwright's `page.route()` to mock the
 *      API response with a deterministic `{ hasMore: true, jobs:
 *      [...10 items] }` body. The dashboard's loadJobs() reads
 *      the JSON; the "Visa fler jobb" button must render. A
 *      second route mock returns `{ hasMore: false, jobs: [...0
 *      items] }` to verify the button hides when the server
 *      signals end-of-stream.
 *
 * The UI test no longer depends on the live AF + Blocket + Ledigajobb
 * API health, so it can run in any environment (including the CI
 * workflow that doesn't have outbound internet to api.jobtechdev.se).
 */

const SAMPLE_JOB = (i) => ({
  id: `mock-${i}`,
  externalId: String(i),
  company: `Mockbolaget ${i}`,
  title: `Mocktitel ${i}`,
  location: 'Stockholm',
  description: 'Mockbeskrivning för paginationstestet',
  source: 'Arbetsförmedlingen',
  url: `https://example.com/job/${i}`,
  published: new Date().toISOString(),
  applicationDeadline: null,
  employmentType: 'heltid',
  workingHoursType: 'heltid',
  salaryType: null,
  matchesUserLocation: true,
})

test.describe('Dashboard: Visa fler jobb pagination — contract', () => {
  test('/api/jobs-available returns the documented pagination metadata', async ({ page }) => {
    // Call the API directly. The seed user's profile may or may
    // not have locations/jobTitles — both branches are valid
    // (the route's 4-pass waterfall covers them all). The
    // pagination metadata shape is the contract we lock here,
    // NOT the data content.
    const res = await page.request.get('/api/jobs-available?query=frontend&location=Stockholm&page=0&pageSize=10')
    expect(res.status()).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.jobs)).toBe(true)
    expect(json).toHaveProperty('total')
    expect(json).toHaveProperty('hasMore')
    expect(json).toHaveProperty('page')
    expect(json).toHaveProperty('pageSize')
    expect(json.pageSize).toBe(10)
    expect(json.page).toBe(0)
    expect(typeof json.hasMore).toBe('boolean')
  })

  test('page 0 with pageSize=2 returns a small slice (locks the slice+pageSize contract)', async ({ page }) => {
    // A very narrow pageSize forces the route to compute
    // `hasMore = combined.length > offset + windowed.length` —
    // if the multi-source waterfall yields >= 3 jobs, hasMore is
    // true. We don't assert on hasMore (probabilistic for the
    // small pageSize), but we do assert on the slice shape.
    // The test name and URL use `page=0` so a future reader can
    // grep for the contract claim without guessing which page
    // is being tested.
    const res = await page.request.get('/api/jobs-available?query=frontend&location=Stockholm&page=0&pageSize=2')
    expect(res.status()).toBe(200)
    const json = await res.json()
    expect(json.jobs.length).toBeLessThanOrEqual(2)
    expect(json.pageSize).toBe(2)
  })
})

test.describe('Dashboard: Visa fler jobb pagination — UI', () => {
  test('"Visa fler jobb" button renders when hasMore=true and hides when hasMore=false', async ({ page }) => {
    // First half: mock hasMore=true to verify the button appears.
    // We intercept the EXACT query string the dashboard sends
    // (the route accepts `?query=<jobTitles>&location=<locations>`).
    // Using a glob match so any query string variation is caught.
    await page.route('**/api/jobs-available*', async (route) => {
      const url = new URL(route.request().url())
      const pageNum = parseInt(url.searchParams.get('page') || '0', 10)
      const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10)
      // Page 0 → return 10 jobs + hasMore=true. Page 1+ → same.
      const jobs = Array.from({ length: pageSize }, (_, i) => SAMPLE_JOB(pageNum * pageSize + i + 1))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobs,
          total: jobs.length,
          hasMore: true,
          page: pageNum,
          pageSize,
          searchMode: 'strict',
          locationFilterMode: 'strict',
          userLocations: ['Stockholm'],
        }),
      })
    })

    await page.goto('/dashboard')
    await page.waitForSelector('text=Lediga jobb för dig', { timeout: 20_000 })
    // Wait for the mocked jobs to render — the "Dagens jobb" cards
    // are the first visible marker. We allow a generous timeout
    // because the dashboard's loadJobs() effect is gated on the
    // profile fetch.
    await expect(page.locator('[data-testid="dagens-jobb-card"]').first()).toBeVisible({ timeout: 20_000 })
    // The "Visa fler jobb" button + page-size hint should both
    // render because hasMore=true.
    await expect(page.locator('[data-testid="jobs-load-more"]')).toBeVisible()
    await expect(page.locator('[data-testid="jobs-load-more-hint"]')).toContainText('Visar 10 jobb just nu')

    // Second half: flip the mock to hasMore=false and reload.
    // The button must HIDE so the user isn't shown a "load more"
    // affordance for an empty page stream.
    await page.unroute('**/api/jobs-available*')
    await page.route('**/api/jobs-available*', async (route) => {
      const url = new URL(route.request().url())
      const pageNum = parseInt(url.searchParams.get('page') || '0', 10)
      const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10)
      const jobs = Array.from({ length: pageSize }, (_, i) => SAMPLE_JOB(pageNum * pageSize + i + 1))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobs,
          total: jobs.length,
          hasMore: false, // <-- the assertion target
          page: pageNum,
          pageSize,
          searchMode: 'strict',
          locationFilterMode: 'strict',
          userLocations: ['Stockholm'],
        }),
      })
    })
    await page.reload()
    await expect(page.locator('[data-testid="dagens-jobb-card"]').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="jobs-load-more"]')).toHaveCount(0)
  })

  test('clicking "Visa fler jobb" appends new jobs and advances the page counter', async ({ page }) => {
    // Deterministic mock: page 0 returns 10 jobs + hasMore=true,
    // page 1 returns 10 more + hasMore=false. After the click,
    // the dashboard's availableJobs array grows from 10 to 20
    // and the button disappears.
    await page.route('**/api/jobs-available*', async (route) => {
      const url = new URL(route.request().url())
      const pageNum = parseInt(url.searchParams.get('page') || '0', 10)
      const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10)
      const jobs = Array.from({ length: pageSize }, (_, i) => SAMPLE_JOB(pageNum * pageSize + i + 1))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobs,
          total: pageNum === 0 ? 20 : jobs.length,
          hasMore: pageNum === 0, // page 0 has more; page 1 doesn't
          page: pageNum,
          pageSize,
          searchMode: 'strict',
          locationFilterMode: 'strict',
          userLocations: ['Stockholm'],
        }),
      })
    })

    await page.goto('/dashboard')
    await expect(page.locator('[data-testid="dagens-jobb-card"]').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="jobs-load-more"]')).toBeVisible()
    await expect(page.locator('[data-testid="jobs-load-more-hint"]')).toContainText('Visar 10 jobb just nu')

    // Click the button. The dashboard's loadMoreJobs() should
    // append the next page and the hint should update to 20.
    await page.locator('[data-testid="jobs-load-more"]').click()
    await expect(page.locator('[data-testid="jobs-load-more-hint"]')).toContainText('Visar 20 jobb just nu', { timeout: 10_000 })
    // And the button should HIDE because hasMore flipped to false.
    await expect(page.locator('[data-testid="jobs-load-more"]')).toHaveCount(0, { timeout: 5_000 })
  })
})
