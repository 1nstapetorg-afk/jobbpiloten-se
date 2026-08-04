import { test, expect } from './_fixtures/auth'
import { PDFDocument, StandardFonts } from 'pdf-lib'

/**
 * E2E spec for the Round-80 CV AI-extraction review panel
 * (`components/CVFileUpload.jsx` — the editable "AI-extraherade
 * uppgifter från CV:t" panel that appears after an upload when the
 * server returns `aiExtracted`).
 *
 * Determinism design: the review panel only renders when
 * /api/upload-cv responds with `aiExtracted`, which the real server
 * only produces when (a) extracted text clears the 50-char floor AND
 * (b) an LLM key is configured (HAS_ANY_LLM_KEY). CI has no LLM key,
 * so a real-flow test would be a 20s-timeout coin flip there. We
 * therefore INTERCEPT /api/upload-cv with a canned `aiExtracted`
 * payload — the same in-memory-fixture philosophy the existing CV
 * specs use with pdf-lib — so the UI contract (panel render → edit →
 * Spara till profil → toast → collapse) is exercised deterministically
 * on every run, key or no key. The upload-cv→aiExtracted server chain
 * itself is covered by tests/unit/cv-ocr-lib.test.mjs +
 * tests/unit/cv-extract.test.mjs (pure modules) and the live smoke in
 * scripts/smoke-ocr.mjs.
 *
 * Fixture: a tiny text PDF built with pdf-lib (matches the other CV
 * specs — no binary blob committed). The intercepted response ignores
 * the file content; only the component's round-trip shape matters.
 */

async function makeTextPdf(label) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 400])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  // Round-84: the upload route's TINY_PDF heuristic (Round-58 / Bug 3)
  // rejects sub-8KB PDFs whose extracted text is <
  // MIN_VALID_CV_TEXT_CHARS (50). These fixtures are ~0.9 KB, so the
  // page must carry >= 50 chars of extractable text to pass the gate
  // (the label alone is ~25).
  const bodyLines = [
    label,
    'Frontendutvecklare',
    'Frontendutvecklare med 5+ års erfarenhet av React, Next.js och Node.js.',
    'Tidigare roller hos Spotify och Klarna. CI/CD med Docker och AWS.',
  ]
  bodyLines.forEach((line, i) => page.drawText(line, { x: 30, y: 370 - i * 28, size: 12, font }))
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
  expect([200, 404]).toContain(res.status())
}

/** Canned /api/upload-cv response carrying aiExtracted (see header). */
function aiExtractedUploadResponse() {
  return {
    ok: true,
    cvText: 'Frontend Developer med 5+ års erfarenhet av React, TypeScript, Next.js och Node.js. Stockholm-baserad, öppen för hybrid eller heltid. Tidigare roller på Spotify (2 år, frontend) och Klarna (3 år, senior frontend). CI/CD med Docker och AWS.',
    cvFileName: 'cv-extract-fixture.pdf',
    cvFileSize: 24576,
    cvTextChars: 230,
    needsManualFallback: false,
    aiExtracted: {
      skills: ['React', 'TypeScript', 'Next.js'],
      experience: 'Medior',
      yearsExperience: 5,
      currentJobTitle: 'Frontendutvecklare',
      currentOrganization: 'Acme AB',
      education: 'Civilingenjör Datateknik, KTH',
      summary: 'Erfaren frontendutvecklare med fokus på React och TypeScript.',
    },
  }
}

test.describe.serial('Settings: CV AI-extraction review panel', () => {
  test.beforeEach(async ({ page }) => {
    await clearCv(page)
  })

  test('upload with aiExtracted renders the review panel pre-filled with CV data', async ({ page }) => {
    // Deterministic aiExtracted — see header comment (no live LLM call).
    await page.route('**/api/upload-cv', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(aiExtractedUploadResponse()),
      })
    })

    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
      state: 'visible',
      timeout: 20_000,
    })

    const pdfBytes = await makeTextPdf('CV fixture extraction panel')
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'cv-extract-fixture.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdfBytes),
    })

    // The AI-extraction review panel appears. (We deliberately do NOT
    // assert the file card here — the mock intercepts /api/upload-cv
    // and never persists to Mongo, so the parent's profile refetch
    // still returns empty CV fields. File-card rendering is covered by
    // settings-cv-upload.spec.js with a real round-trip.)
    await page.waitForSelector('[data-testid="cv-extract-review"]', {
      state: 'visible',
      timeout: 20_000,
    })

    // Panel is pre-filled from the aiExtracted payload (comma-joined skills).
    await expect(page.locator('[data-testid="cv-extract-skills"]')).toHaveValue(
      'React, TypeScript, Next.js',
    )
    await expect(page.locator('[data-testid="cv-extract-experience"]')).toHaveValue('Medior')
    await expect(page.locator('[data-testid="cv-extract-years"]')).toHaveValue('5')
    await expect(page.locator('[data-testid="cv-extract-jobtitle"]')).toHaveValue('Frontendutvecklare')
    await expect(page.locator('[data-testid="cv-extract-org"]')).toHaveValue('Acme AB')
    await expect(page.locator('[data-testid="cv-extract-education"]')).toHaveValue(
      'Civilingenjör Datateknik, KTH',
    )
    await expect(page.locator('[data-testid="cv-extract-summary"]')).toHaveValue(
      'Erfaren frontendutvecklare med fokus på React och TypeScript.',
    )
  })

  test('Spara till profil posts the EDITED fields to /api/profile-update, toasts, collapses', async ({ page }) => {
    await page.route('**/api/upload-cv', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(aiExtractedUploadResponse()),
      })
    })

    // Capture the profile-update payload the panel's save button sends.
    let savedPayload = null
    await page.route('**/api/profile-update', async (route) => {
      savedPayload = JSON.parse(route.request().postData() || '{}')
      await route.continue()
    })

    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
      state: 'visible',
      timeout: 20_000,
    })

    const pdfBytes = await makeTextPdf('CV fixture save edited fields')
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'cv-extract-fixture.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdfBytes),
    })
    await page.waitForSelector('[data-testid="cv-extract-review"]', {
      state: 'visible',
      timeout: 20_000,
    })

    // User edits two fields before saving.
    await page.locator('[data-testid="cv-extract-skills"]').fill('React, Vue, Tailwind')
    await page.locator('[data-testid="cv-extract-education"]').fill('Master Data Science, SU')

    await page.locator('[data-testid="cv-extract-save"]').click()

    // Success toast (Swedish copy).
    await expect(
      page.locator('[data-sonner-toast]:has-text("Profiluppgifter sparade")').first(),
    ).toBeVisible({ timeout: 10_000 })

    // The payload must carry the user's edits, not the canned values.
    await expect
      .poll(() => savedPayload, { timeout: 10_000 })
      .toEqual({
        skills: ['React', 'Vue', 'Tailwind'],
        experience: 'Medior',
        currentJobTitle: 'Frontendutvecklare',
        currentOrganization: 'Acme AB',
        yearsExperience: 5,
        education: 'Master Data Science, SU',
        cvSummary: 'Erfaren frontendutvecklare med fokus på React och TypeScript.',
      })

    // Panel collapses after a successful save.
    await expect(page.locator('[data-testid="cv-extract-review"]')).toHaveCount(0)
  })

  test('Avbryt closes the panel without sending any profile update', async ({ page }) => {
    let profileUpdateCalls = 0
    await page.route('**/api/upload-cv', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(aiExtractedUploadResponse()),
      })
    })
    await page.route('**/api/profile-update', async (route) => {
      profileUpdateCalls += 1
      await route.continue()
    })

    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
      state: 'visible',
      timeout: 20_000,
    })

    const pdfBytes = await makeTextPdf('CV fixture cancel')
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'cv-extract-fixture.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdfBytes),
    })
    await page.waitForSelector('[data-testid="cv-extract-review"]', {
      state: 'visible',
      timeout: 20_000,
    })

    await page.getByRole('button', { name: 'Avbryt' }).click()

    // Panel closes; NO /api/profile-update was fired by the panel.
    await expect(page.locator('[data-testid="cv-extract-review"]')).toHaveCount(0)
    expect(profileUpdateCalls).toBe(0)
  })
})
