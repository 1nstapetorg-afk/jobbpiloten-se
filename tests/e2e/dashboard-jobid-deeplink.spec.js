// tests/e2e/dashboard-jobid-deeplink.spec.js
//
// Lock both paths of the Round-18 deep-link + Round-19 404-toast
// tone-disconnect in one place so a future regression is caught
// the same way the pre-Round-19 bug surfaced — silently firing the
// generic reuse-toast on a withdrawn announcement.
//
// Strategy:
//   • The dashboard's `?jobId` useEffect (app/dashboard/page.js
//     ~line 789) calls /api/jobs-available?jobId=X. We mock THAT
//     one endpoint via page.route interception. The other panel
//     fetches (profile, applications, stats, the non-jobId
//     jobs-available call) hit the real dev server via the auth
//     fixture's demoUserId cookie + localStorage.demoUser seed.
//   • Success path: 200 response with a single cacheable fake job.
//     Asserts the prep modal opens (the fake job's UNIQUE title
//     becomes visible — no testid needed) AND that the `?jobId`
//     query param has been stripped from the URL after success.
//   • 404 path: 404 response with `{ error: 'not_found' }`. Asserts
//     the SPECIFIC Swedish copy "Jobbet finns inte längre…" fires
//     (not the generic "försök igen senare") AND the modal does
//     NOT open.
//
// File extension note: kept `.spec.js` (not `.mjs`) to match the
// existing convention in this directory — the 16 sibling specs
// (dashboard-nav, dashboard-ansokningsdatum, settings-avatar, …)
// all use `.js`. Playwright's default testMatch is `*.(spec|test)
// .(js|ts|mjs)` so the `.js` here is unambiguous.
//
// Run via `yarn playwright test tests/e2e/dashboard-jobid-deeplink.spec.js`.

import { test, expect } from './_fixtures/auth'

// UNIQUE jobIds per test so the two tests can't accidentally route
// each other's mocked responses. Date.now() baked into the id keeps
// repeated test runs independent of Vercel/local Round-20 LRU.
const SUCCESS_JOB_ID = `pw-success-${Date.now()}`
const NOT_FOUND_JOB_ID = `pw-notfound-${Date.now()}`
// UNIQUE text anchors so the modal/toast assertions are unambiguous.
const MOCK_TITLE = `Playwright Mocked SeniorDeveloper (${SUCCESS_JOB_ID})`
const MOCK_COMPANY = 'Playwright Mock Co'
const SPECIFIC_TOAST_COPY = 'Jobbet finns inte längre — kanske har annonsen dragits tillbaka.'
const GENERIC_TOAST_COPY = 'Kunde inte öppna ansökan — försök igen senare.'

// Function-predicate form for `page.route`. Idiomatic across Playwright
// versions + unambiguous: matches exactly the `?jobId=<expected>`
// request we want to mock. Other request shapes pass through to the
// dev server untouched. Switching from the regex form (which had
// path-anchoring quirks in v1.40.x against Next.js + served URLs
// with port + https) — see Round-21 review (h) + the v1.40 trace
// showing the regex didn't fire while the predicate did.
const matchJobId = (expected) => (url) =>
  url.pathname === '/api/jobs-available' && url.searchParams.get('jobId') === expected

// openPrepModal (app/dashboard/page.js line 737) issues a SECOND POST
// to /api/apply-now after the GET to /api/jobs-available?jobId=X
// resolves. Without mocking it too, the test's success path rejected
// in openPrepModal's catch — the dashboard then fires the generic
// "Kunde inte öppna ansökan" toast and the URL-strip is skipped.
// Round-21 trace v1 confirmed this was the failure mode.
//
// We mock apply-now to return a synthetic application row whose
// `id` is unique per test so the dashboard's strips-job-from-list
// step doesn't clobber other test state. The 200 + ok:true contract
// is enough — the dashboard only reads `json.application`.
//
// Playwright's page.route URL-predicate form (`(url) => boolean`)
// only receives a parsed `URL` — there is NO `.request` accessor on
// it. v1.40 traced `url.request is not a function` as the failure
// mode here. Method filtering has to move INSIDE the handler:
const matchApplyNow = (url) => url.pathname === '/api/apply-now'

function makeApplyNowMock(currentJobId) {
  return async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        application: {
          id: `pw-app-${currentJobId}`,
          company: MOCK_COMPANY,
          title: `Playwright Mocked SeniorDeveloper (${currentJobId})`,
          location: 'Stockholm',
          source: 'Arbetsförmedlingen',
          coverLetter: 'Personligt brev — genererat av Playwright-mocken.',
          jobUrl: null,
          externalId: null,
          status: 'prepared',
          appliedAt: new Date().toISOString(),
          method: 'AI-assistent (förberedd)',
        },
      }),
    })
  }
}

test.describe.serial('Dashboard: ?jobId= deep-link from push notifications', () => {
  test('success path opens the prep modal + strips ?jobId from URL', async ({ page }) => {
    await page.route(matchJobId(SUCCESS_JOB_ID), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobs: [
            {
              id: `af-${SUCCESS_JOB_ID}`,
              externalId: SUCCESS_JOB_ID,
              company: MOCK_COMPANY,
              title: MOCK_TITLE,
              location: 'Stockholm',
              description: 'Mocked deep-link from /dashboard?jobId=',
              source: 'Arbetsförmedlingen',
              url: `https://example.com/playwright-mock-${SUCCESS_JOB_ID}`,
            },
          ],
          hasMore: false,
        }),
      })
    })

    await page.route(matchApplyNow, makeApplyNowMock(SUCCESS_JOB_ID))
    await page.goto(`/dashboard?jobId=${encodeURIComponent(SUCCESS_JOB_ID)}`)

    // PRIMARY signal: URL strip. The dashboard's ?jobId effect calls
    // router.replace('/dashboard') ONLY AFTER `await openPrepModal(jobs[0])`
    // resolves — see app/dashboard/page.js lines 825-830. Mock both the
    // /api/jobs-available GET AND the /api/apply-now POST so openPrepModal
    // returns successfully; if either mocks miss, openPrepModal throws,
    // the catch toast fires, and the URL is never stripped.
    await page.waitForFunction(
      () => new URLSearchParams(window.location.search).get('jobId') === null,
      { timeout: 10_000 },
    )
    const remainingJobId = await page.evaluate(
      () => new URLSearchParams(window.location.search).get('jobId'),
    )
    expect(remainingJobId).toBeNull()

    // SECONDARY signal: the mocked job title becomes visible in some
    // document node — modal + side-panel + sonner portals all count.
    // The URL-strip above (PRIMARY signal) is the binding contract;
    // if openPrepModal ever throws, the strip never fires and this
    // assertion is moot. Keep this as a hard assertion so a future
    // regression that opens some OTHER modal in error also gets caught.
    await expect(page.getByText(MOCK_TITLE).first()).toBeVisible({ timeout: 5_000 })
  })

  test('404 path fires the specific Swedish toast + does NOT open the modal', async ({ page }) => {
    await page.route(matchJobId(NOT_FOUND_JOB_ID), async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          jobs: [],
          hasMore: false,
          error: 'not_found',
        }),
      })
    })

    await page.route(matchApplyNow, makeApplyNowMock(NOT_FOUND_JOB_ID))
    await page.goto(`/dashboard?jobId=${encodeURIComponent(NOT_FOUND_JOB_ID)}`)

    // SPECIFIC toast copy — the Round-19 fix lands here. A future
    // regression that collapses this back to the generic copy will
    // fail this assertion BEFORE the modal-open check.
    await expect(
      page.getByText(SPECIFIC_TOAST_COPY, { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 })

    // Round-21 review (e): the defensive generic-copy count must be
    // STRICT ZERO. A count of 1 IS exactly the regression we're
    // guarding against — the generic "Kunde inte öppna…" copy
    // surfacing in addition to (or instead of) the specific copy
    // is the wrong tone. Tighten from `<= 1` to `=== 0`.
    const genericCopyCount = await page.getByText(GENERIC_TOAST_COPY, { exact: false }).count()
    expect(genericCopyCount).toBe(0)

    // Modal must NOT open — bogus id returns 404, dashboard skips
    // openPrepModal entirely. We assert immediately after the toast
    // becomes visible (no arbitrary wait) — the toast visibility is
    // the real signal that the !res.ok branch fired.
    const modalOpened = await page
      .getByText('Playwright Mocked SeniorDeveloper', { exact: false })
      .count()
    expect(modalOpened).toBe(0)

    // URL NOT stripped on 404 — the dashboard's effect early-returns
    // after the toast.error in the !res.ok branch and never reaches
    // params.delete('jobId'). If this contract changes, the test
    // will scream and the related Round-19 logic needs re-thinking.
    expect(page.url()).toContain(`jobId=${NOT_FOUND_JOB_ID}`)
  })
})
