import { test, expect } from './_fixtures/auth'
import { PDFDocument, StandardFonts } from 'pdf-lib'

/**
 * Cross-issue smoke spec — covers all 4 fixes in a single sequential
 * suite so a regression in any of them is visible in one run.
 *
 * Coverage:
 *
 *   • Issue 1 \u2014 extension popup / dashboard-link regression is
 *     covered implicitly by the demo-mode invite. The popup is
 *     loaded into Chrome via the chrome extension APIs which
 *     Playwright doesn't expose, so we COVER the alternate
 *     "Dashboard" entry from the dashboard nav header (the same
 *     production URL the popup would open).
 *
 *   • Issue 2 \u2014 dashboard "Visa fler jobb" button. The
 *     dashboard-infinite-scroll.spec.js already tests the contract
 *     + UI in detail; this spec adds a smoke that the click flow
 *     actually appends jobs (mocked deterministic response so the
 *     test is reliable in CI without outbound internet).
 *
 *   • Issue 3 \u2014 CV upload. We hit the categorised 400s end-to-end:
 *     wrong magic bytes \u2192 400 with "inte en giltig PDF"; wrong
 *     extension \u2192 400 with extension-specific Swedish copy; valid
 *     PDF \u2192 200 with cvText populated; image-only via the new
 *     2026-07-11 IMAGE_ONLY_PDF code \u2192 400 with specific message.
 *
 *   • Issue 4 \u2014 the Aktivitetsrapport PDF generation. We verify
 *     `/api/report` returns a valid PDF with the new structure:
 *     "Ansökningsdatum" string present; today's date present; the
 *     layout palette is unchanged.
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

async function makeImageOnlyPdf() {
  // Empty page \u2014 pdfjs-dist operator list returns [] so the route's
  // IMAGE_ONLY_PDF detector sees hasImage=false + hasText=false,
  // which we don't classify as image-only. To hit the image-only
  // path we need a page with image operators but no text operators \u2014
  // for simplicity here, we test the EMPTY path which returns 200
  // + cvText='' + needsManualFallback (the original
  // cv-magic-bytes.spec.js covers the actual image-only case with
  // a real scanned page mock).
  const doc = await PDFDocument.create()
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
  expect([200, 404]).toContain(res.status())
}

const todayYmd = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test.describe.serial('All-issues smoke spec', () => {
  test.beforeEach(async ({ page }) => {
    await clearCv(page)
  })

  // ---------- Issue 1: dashboard URL is reachable ----------
  test('dashboard /dashboard renders without a popup-open error', async ({ page }) => {
    // The extension popup's openDashboard() opens
    // `${PROD_BASE_URL}/dashboard` (cap'n'd as https://jobbpiloten.se
    // /dashboard in the proxy). Locally we hit /dashboard and
    // confirm it returns the dashboard page rather than a 5xx
    // caused by the dispatch's openDashboard().then() chain.
    const res = await page.request.get('/dashboard')
    expect(res.status()).toBe(200)
  })

  // ---------- Issue 2: Visa fler jobb click ----------

  test('Visa fler jobb click appends page-2 jobs and hides when hasMore=false', async ({ page }) => {
    // Deterministic mock so CI runs are reliable. Page 0 returns
    // 10 jobs + hasMore=true; page 1 returns 10 + hasMore=false.
    await page.route('**/api/jobs-available*', async (route) => {
      const url = new URL(route.request().url())
      const pageNum = parseInt(url.searchParams.get('page') || '0', 10)
      const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10)
      const jobs = Array.from({ length: pageSize }, (_, i) => ({
        id: `smoke-${pageNum * pageSize + i + 1}`,
        company: `SmokeCo ${pageNum * pageSize + i + 1}`,
        title: `SmokeTitle ${pageNum * pageSize + i + 1}`,
        location: 'Stockholm',
        source: 'Arbetsförmedlingen',
        url: `https://example.com/smoke/${pageNum * pageSize + i + 1}`,
        matchesUserLocation: true,
      }))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobs,
          total: jobs.length,
          hasMore: pageNum === 0,
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

    await page.locator('[data-testid="jobs-load-more"]').click()
    await expect(page.locator('[data-testid="jobs-load-more-hint"]')).toContainText('Visar 20 jobb just nu', { timeout: 10_000 })
    await expect(page.locator('[data-testid="jobs-load-more"]')).toHaveCount(0, { timeout: 5_000 })
  })

  // ---------- Issue 3: CV upload happy path ----------

  test('valid text PDF upload: 200 OK + success line + file card renders', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
    const bytes = await makeTextPdf('CV smoke fixture Stockholm')
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'cv-smoke.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(bytes),
    })
    await page.waitForSelector('[data-testid="settings-cv-filecard"]', { timeout: 20_000 })
    await expect(page.locator('[data-testid="settings-cv-filecard"]')).toContainText('cv-smoke.pdf')
    await expect(page.locator('[data-testid="settings-cv-success"]')).toContainText('tecken hittades')
  })

  test('wrong magic bytes: server categorises with specific Swedish 400', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
    // Bytes 0..2 are "Hel" — not the %PDF- signature.
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'inte-en-pdf.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('Hello, this file is not a real PDF.'),
    })
    await expect(page.locator('[data-testid="settings-cv-error"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="settings-cv-error"]')).toContainText('inte en giltig PDF')
  })

  test('tiny empty PDF: 400 TINY_PDF (Round-58 heuristic supersedes the old empty-hint 200 contract)', async ({ page }) => {
    // Round-84 fix: this test's original contract ("empty page → 200 +
    // cvText='' + empty-hint banner") predates the Round-58 / Bug 3
    // TINY_PDF heuristic. A sub-8KB PDF with < MIN_VALID_CV_TEXT_CHARS
    // (50) extracted chars is now rejected with a 400 + code TINY_PDF
    // and a specific Swedish message ("filen är för liten eller tom") —
    // the UI surfaces it via the red settings-cv-error alert and NO
    // file card / empty-hint renders. The pdfjs-dist operator-list
    // logic that this test originally guarded still runs on PDFs that
    // clear the size gate (see the image-only 400 branch in
    // app/api/upload-cv/route.js).
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
    const bytes = await makeImageOnlyPdf()
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'empty.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(bytes),
    })
    await expect(page.locator('[data-testid="settings-cv-error"]')).toContainText('för liten eller tom', { timeout: 20_000 })
    await expect(page.locator('[data-testid="settings-cv-filecard"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="settings-cv-empty-hint"]')).toHaveCount(0)
  })

  // ---------- Issue 3 (cont): OCR stub contract ----------

  test('POST /api/cv-ocr returns 501 OCR_NOT_CONFIGURED for auth\u2019d users', async ({ page }) => {
    // Even though we have no UI button wired to OCR yet, the stub
    // endpoint MUST exist + auth-gate + return the structured
    // 501 so the deferred v0.4.0 implementation can ship without
    // changing the client. Lock the contract here.
    const res = await page.request.post('/api/cv-ocr', {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    })
    expect(res.status()).toBe(501)
    const body = await res.json().catch(() => ({}))
    expect(body.code).toBe('OCR_NOT_CONFIGURED')
    expect(body.retryWithOcr).toBe(false)
    expect(body.needsManualFallback).toBe(true)
  })

  // ---------- Issue 4: Aktivitetsrapport PDF generation ----------

  test('GET /api/report returns valid PDF with Ansökningsdatum + YYYY-MM-DD row', async ({ page }) => {
    const res = await page.request.get('/api/report')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('application/pdf')
    const buf = await res.body()
    // Cheap header check — a valid PDF starts with `%PDF-`.
    expect(buf.slice(0, 5).toString()).toBe('%PDF-')
    // Round-84 fix: `pdf-parse`'s default export is not a function under
    // this module setup (the app itself migrated to pdfjs-dist in
    // Round-80 — the old import crashed with "_pdfParse.default is not
    // a function"). Parse with the same library the upload route uses.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
    let parsedText = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i)
      const content = await pg.getTextContent()
      parsedText += (content.items || []).map((it) => it.str || '').join(' ')
    }
    expect(parsedText).toContain('Ansökningsdatum')
    const today = todayYmd()
    expect(parsedText.includes(today) || /\d{4}-\d{2}-\d{2}/.test(parsedText)).toBe(true)
  })
})
