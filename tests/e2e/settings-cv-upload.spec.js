import { test, expect } from './_fixtures/auth'
import { PDFDocument, StandardFonts } from 'pdf-lib'

/**
 * E2E spec for the CV upload flow on /settings.
 *
 * Tests share the demoUserId profile (set by `_fixtures/auth`). To keep
 * state predictable across runs the `beforeEach` hook resets the cv
 * fields via `/api/profile-update`, so each test starts from a known
 * "no CV on file" baseline. The reset endpoint writes
 * `cvText: '', cvFileName: '', cvFileSize: 0, cvUploadedAt: null` —
 * Mongo treats the explicit `null` as an assignment.
 *
 * Fixtures generated in-memory via `pdf-lib` so we don't have to commit
 * a binary blob. Two flavors we care about:
 *   • text PDF — three short lines, exercises the success path
 *     ("✓ CV lästes in — N tecken hittades")
 *   • image-only PDF — empty page, exercises the empty-hint path
 *     ("CV uppladdad — men texten kunde inte tolkas")
 *
 * The server uses `pdfjs-dist` (Round-14 migration away from the
 * deprecated pdf-parse v2 fallback). pdfjs-dist is tolerant enough
 * to extract the drawn text from a text PDF and to return the
 * empty string for a no-text PDF after the image-only operator
 * walk classifies it. We rely on that for the empty-text assertions.
 */

async function makeTextPdf(label) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 200])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(label, { x: 30, y: 130, size: 16, font })
  page.drawText('Frontendutvecklare', { x: 30, y: 95, size: 12, font })
  page.drawText('Stockholm, Sverige', { x: 30, y: 75, size: 12, font })
  return await doc.save()
}

async function makeImageOnlyPdf() {
  const doc = await PDFDocument.create()
  // Empty page, no drawText → trimmed extraction result is "".
  doc.addPage([300, 200])
  return await doc.save()
}

async function clearCv(page) {
  const res = await page.request.post('/api/profile-update', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      cvText: '',
      cvFileName: '',
      cvFileSize: 0,
      cvUploadedAt: null,
    },
  })
  // 200 if profile existed, 404 if not — both fine for cleanup.
  expect([200, 404]).toContain(res.status())
}

test.describe.serial('Settings: CV upload', () => {
  test.beforeEach(async ({ page }) => {
    await clearCv(page)
  })

  test('dropzone is visible when no CV is uploaded', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await expect(page.locator('[data-testid="settings-cv-filecard"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="settings-cv-preview-toggle"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="settings-cv-success"]')).toHaveCount(0)
  })

  test('uploading a text PDF parses server-side, shows the file card and the success line', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
      state: 'visible',
      timeout: 20_000,
    })

    const pdfBytes = await makeTextPdf('CV fixture Volvobilar Stockholm')
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'cv-fixture.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdfBytes),
    })

    // File card replaces the dropzone after a successful round-trip
    // through /api/upload-cv → pdfjs-dist → MongoDB → /api/profile.
    await page.waitForSelector('[data-testid="settings-cv-filecard"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await expect(page.locator('[data-testid="settings-cv-filecard"]')).toContainText('cv-fixture.pdf')

    // Success indicator inline — copy is stable on the "tecken hittades"
    // substring. Char count is locale-formatted ("sv-SE") so it could
    // be "60" with thin spaces; we just assert the structure.
    await expect(page.locator('[data-testid="settings-cv-success"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-cv-success"]')).toContainText('tecken hittades')

    // Sonner toast announces success — the new wording is "lästes in".
    await expect(
      page.locator('[data-sonner-toast]:has-text("lästes in")').first(),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('image-only PDF triggers the empty-hint banner instead of an error', async ({ page }) => {
    // The route treats TRIM-EMPTY text as a 200 OK with needsManualFallback.
    // The UI then renders the in-section empty-hint banner rather than the
    // server-error alert. This is the "scanned / image-only PDF" path.
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
      state: 'visible',
      timeout: 20_000,
    })

    const emptyBytes = await makeImageOnlyPdf()
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'scanned.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(emptyBytes),
    })

    await page.waitForSelector('[data-testid="settings-cv-filecard"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await expect(page.locator('[data-testid="settings-cv-filecard"]')).toContainText('scanned.pdf')

    // The empty-hint banner renders, NOT the generic error alert.
    await expect(page.locator('[data-testid="settings-cv-empty-hint"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-cv-empty-hint"]')).toContainText('kunde inte tolka texten')
    await expect(page.locator('[data-testid="settings-cv-error"]')).toHaveCount(0)

    // Success-line is absent (no char count for an empty extraction).
    await expect(page.locator('[data-testid="settings-cv-success"]')).toHaveCount(0)
  })

  test('invalid extension shows the in-section alert and keeps the dropzone', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
      state: 'visible',
      timeout: 20_000,
    })

    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'cv-fixture.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('not a real file'),
    })

    // Client validates before round-tripping; error banner appears inline.
    await expect(page.locator('[data-testid="settings-cv-error"]')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('[data-testid="settings-cv-error"]')).toContainText('Endast PDF, DOC och DOCX stöds')

    // Dropzone still visible — no card should have appeared.
    await expect(page.locator('[data-testid="settings-cv-dropzone"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-cv-filecard"]')).toHaveCount(0)
  })

  test('remove button clears the file and returns to the dropzone', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
      state: 'visible',
      timeout: 20_000,
    })

    // Upload first so the file card branch renders with the × button.
    const pdfBytes = await makeTextPdf('CV fixture remove test')
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'cv-fixture.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdfBytes),
    })
    await page.waitForSelector('[data-testid="settings-cv-filecard"]', {
      state: 'visible',
      timeout: 20_000,
    })

    // The component's handleRemove posts to /api/profile-update which
    // wipes the cv fields, then onChanged fires → outer load() refetches.
    await page.locator('[data-testid="settings-cv-remove"]').click()

    // Dropzone reappears once the profile state clears.
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
      state: 'visible',
      timeout: 15_000,
    })
    await expect(page.locator('[data-testid="settings-cv-filecard"]')).toHaveCount(0)
  })
})
