import { test, expect } from './_fixtures/auth'
import { PDFDocument, StandardFonts } from 'pdf-lib'

/**
 * E2E spec for the CV upload flow inside the onboarding Granska step.
 *
 * The onboarding wizard renders the SAME `<CVFileUpload>` component as
 * the /settings page — but it lives in the wizard body, not in a
 * dedicated /settings route, so we have a separate spec that
 * navigates the stepper before asserting the upload contract.
 *
 * Onboarding step indexing:
 *   step 0 → Karriärinfo  → "Nästa" → step 1
 *   step 1 → Personuppgifter → "Nästa" → step 2
 *   step 2 → Preferenser   → "Nästa" → step 3
 *   step 3 → Granska       → "Slutför"  (this is where the dropzone lives)
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
    'Stockholm, Sverige',
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

test.describe.serial('Onboarding: CV upload', () => {
  test.beforeEach(async ({ page }) => {
    await clearCv(page)
  })

  test('dragging a PDF on the Granska step uploads via /api/upload-cv', async ({ page }) => {
    await page.goto('/onboarding')

    // Wait until the wizard's forward button is rendered.
    await page.waitForSelector('button:has-text("Nästa")', {
      state: 'visible',
      timeout: 20_000,
    })

    // Click through to step 3 (Granska). The wizard advances on click;
    // we don't fill any of the early-step fields — `Nästa` is just a
    // stepper advance in this implementation, not a submit.
    for (let i = 0; i < 3; i++) {
      await page.locator('button:has-text("Nästa")').click()
      // Brief settle so DOM reconciliation finishes before the next click.
      await page.waitForTimeout(150)
    }

    // On the Granska step, the shared CVFileUpload dropzone renders.
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
      state: 'visible',
      timeout: 20_000,
    })

    const pdfBytes = await makeTextPdf('CV fixture onboarding Volvobilar')
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'cv-onboarding.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdfBytes),
    })

    // Round-84 fix: the onboarding wizard intentionally passes an
    // EMPTY profile to CVFileUpload (a brand-new user has no saved CV
    // yet) and does NOT refetch after upload — the file card is
    // profile-driven (`profile.cvFileName`) and only renders once the
    // post-onboarding profile load picks the file up. So the upload
    // contract is verified via the API round-trip instead: the file
    // must be stored with its extracted text. (Settings, which
    // refetches via SWR on `onChanged`, shows the card immediately —
    // covered by cv-magic-bytes.spec.js.)
    await expect
      .poll(async () => {
        const res = await page.request.get('/api/profile')
        const body = await res.json()
        const p = body.profile || body
        return p.cvFileName
      }, { timeout: 15_000, intervals: [200, 500, 1000] })
      .toBe('cv-onboarding.pdf')
    const res = await page.request.get('/api/profile')
    const body = await res.json()
    const p = body.profile || body
    expect(p.cvText || '').toContain('Frontendutvecklare')
  })
})
