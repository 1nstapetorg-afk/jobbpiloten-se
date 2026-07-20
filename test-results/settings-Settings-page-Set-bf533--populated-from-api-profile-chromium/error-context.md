# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: settings.spec.js >> Settings page >> Settings: profile editor >> loads profile fields populated from /api/profile
- Location: tests\e2e\settings.spec.js:26:7

# Error details

```
Error: expect(locator).toBeDisabled() failed

Locator:  locator('[data-testid="settings-save"]')
Expected: disabled
Received: enabled
Timeout:  5000ms

Call log:
  - Expect "toBeDisabled" with timeout 5000ms
  - waiting for locator('[data-testid="settings-save"]')
    14 × locator resolved to <button data-testid="settings-save" class="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-8 rounded-md px-3 text-xs bg-indigo-600 hover:bg-indigo-700 text-white">…</button>
       - unexpected value "enabled"

```

```yaml
- button "Spara ändringar"
```

# Test source

```ts
  1   | import { test, expect } from './_fixtures/auth'
  2   | 
  3   | /**
  4   |  * E2E spec for the /settings page.
  5   |  *
  6   |  * Each test assumes:
  7   |  *   - dev server reachable at http://localhost:3000
  8   |  *   - Mongo reachable by the server with at least one seeded demo user
  9   |  *     (`demoUserId=demo-user-001` is what `_fixtures/auth` sets)
  10  |  *   - the demo user has already passed /onboarding so a profile exists
  11  |  *
  12  |  * If any of these is false the test will surface a clear Playwright
  13  |  * failure with the underlying error rather than hanging — timeout is
  14  |  * generous (60s on the suite) but failures are loud.
  15  |  *
  16  |  * Isolation: tests are wrapped in `test.describe.serial(...)` so they
  17  |  * execute in declaration order. The destructive account-delete test is
  18  |  * intentionally LAST so its database side-effect (profile + applications
  19  |  * gone) cannot race other tests. Combined with `workers: 1` in
  20  |  * playwright.config.js this also protects cross-file specs that share
  21  |  * the same demoUserId cookie.
  22  |  */
  23  | 
  24  | test.describe.serial('Settings page', () => {
  25  | test.describe('Settings: profile editor', () => {
  26  |   test('loads profile fields populated from /api/profile', async ({ page }) => {
  27  |     await page.goto('/settings')
  28  |     // Wait until the ProfileEditor Card has hydrated (i.e. the loader
  29  |     // Skeleton vanishes and a real input appears).
  30  |     await page.waitForSelector('[data-testid="settings-fullName"]', { state: 'visible', timeout: 20_000 })
  31  |     await expect(page.getByRole('heading', { name: /Inställningar/ })).toBeVisible()
  32  |     // Save button starts disabled when the form equals the loaded profile.
> 33  |     await expect(page.locator('[data-testid="settings-save"]')).toBeDisabled()
      |                                                                 ^ Error: expect(locator).toBeDisabled() failed
  34  |   })
  35  | 
  36  |   test('edit + save a field shows success toast and clears dirty state', async ({ page }) => {
  37  |     await page.goto('/settings')
  38  |     await page.waitForSelector('[data-testid="settings-fullName"]', { state: 'visible', timeout: 20_000 })
  39  | 
  40  |     const fullName = page.locator('[data-testid="settings-fullName"]')
  41  |     const original = await fullName.inputValue()
  42  |     await fullName.fill(original ? `${original} *` : 'Anna Andersson *')
  43  | 
  44  |     // Save button enables once the dirty counter shows > 0.
  45  |     const save = page.locator('[data-testid="settings-save"]')
  46  |     await expect(save).toBeEnabled()
  47  |     await save.click()
  48  | 
  49  |     // Sonner toast appears in a [data-sonner-toast] element. We assert the
  50  |     // text starts with "Profil uppdaterad" — exact copy may drift.
  51  |     await expect(
  52  |       page.locator('[data-sonner-toast]:has-text("Profil uppdaterad")').first(),
  53  |     ).toBeVisible({ timeout: 10_000 })
  54  |     // After re-fetch, the new value is round-tripped so the form is no
  55  |     // longer dirty and the save button is disabled again.
  56  |     await expect(save).toBeDisabled()
  57  |   })
  58  | })
  59  | 
  60  | test.describe('Settings: GDPR art. 20 export', () => {
  61  |   test('clicking "Ladda ner JSON" triggers a download', async ({ page }) => {
  62  |     await page.goto('/settings')
  63  |     await page.waitForSelector('[data-testid="settings-export"]', { state: 'visible', timeout: 20_000 })
  64  | 
  65  |     const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
  66  |     await page.locator('[data-testid="settings-export"]').click()
  67  |     const download = await downloadPromise
  68  | 
  69  |     // Filename follows the convention in app/settings/page.js:
  70  |     // `jobbpiloten-data-YYYY-MM-DD.json`
  71  |     expect(download.suggestedFilename()).toMatch(/^jobbpiloten-data-\d{4}-\d{2}-\d{2}\.json$/)
  72  |   })
  73  | })
  74  | 
  75  | // Round-31 ISOLATION MIGRATION — RESOLVED.
  76  | // The auth fixture (tests/e2e/_fixtures/auth.js) now derives the
  77  | // per-test clerkId via `demo-user-001-w${testInfo.workerIndex}-h${hash(testInfo.title)}`,
  78  | // so this destructive test safely wipes only its own per-test
  79  | // Mongo document and never cascades to parallel siblings. With
  80  | // per-test isolation in place, playwright.config.js flipped
  81  | // `fullyParallel: true` back from Round-30's belt-and-braces
  82  | // `false` — the spec suite reclaims the throughput Round-30 had
  83  | // sacrificed. The Round-30 hint (per-worker clerkId) was a partial
  84  | // fix; the Round-31 per-test fix is the complete one.
  85  | test.describe('Settings: GDPR art. 17 account delete', () => {
  86  |   test('button is disabled until the confirm phrase is typed exactly', async ({ page }) => {
  87  |     await page.goto('/settings')
  88  |     await page.waitForSelector('[data-testid="settings-open-delete"]', { state: 'visible', timeout: 20_000 })
  89  |     await page.locator('[data-testid="settings-open-delete"]').click()
  90  | 
  91  |     // Confirm button starts disabled (phrase empty).
  92  |     const confirm = page.locator('[data-testid="settings-delete-confirm-button"]')
  93  |     await expect(confirm).toBeDisabled()
  94  | 
  95  |     // Wrong phrase (lowercase / partial) keeps it disabled.
  96  |     await page.locator('[data-testid="settings-delete-confirm"]').fill('radera mitt konto')
  97  |     await expect(confirm).toBeDisabled()
  98  | 
  99  |     // Aprrox text with trailing whitespace also rejected.
  100 |     await page.locator('[data-testid="settings-delete-confirm"]').fill('RADERA MITT KONTO ')
  101 |     // The dialog resets on re-open; here the value matches trimmed string but
  102 |     // the comparison is exact, so it should still be disabled until the
  103 |     // user types exactly the phrase. Adjust behavior if loosening later.
  104 |     await expect(confirm).toBeDisabled()
  105 | 
  106 |     // Finally, exact phrase — button enables.
  107 |     await page.locator('[data-testid="settings-delete-confirm"]').fill('RADERA MITT KONTO')
  108 |     await expect(confirm).toBeEnabled()
  109 |   })
  110 | 
  111 |   test('successful delete closes the workflow with an emerald summary', async ({ page }) => {
  112 |     // Uses a temporary demo user so this test does not destroy other tests'
  113 |     // shared fixture. The fixture-as-test-name convention lets us isolate
  114 |     // state if needed.
  115 |     await page.goto('/settings')
  116 |     await page.waitForSelector('[data-testid="settings-open-delete"]', { state: 'visible', timeout: 20_000 })
  117 |     await page.locator('[data-testid="settings-open-delete"]').click()
  118 |     await page.locator('[data-testid="settings-delete-confirm"]').fill('RADERA MITT KONTO')
  119 |     await page.locator('[data-testid="settings-delete-confirm-button"]').click()
  120 | 
  121 |     // The success banner inside the dialog body asserts the per-collection
  122 |     // delete counts the server reported.
  123 |     await expect(
  124 |       page.locator('text=Kontot är raderat').first(),
  125 |     ).toBeVisible({ timeout: 15_000 })
  126 |   })
  127 | })
  128 | }) // end of test.describe.serial('Settings page')
  129 | 
```