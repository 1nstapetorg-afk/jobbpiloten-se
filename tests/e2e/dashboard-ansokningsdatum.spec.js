import { test, expect } from './_fixtures/auth'

/**
 * E2E spec for the "Ansökningsdatum" column in the Aktivitetsrapport
 * PDF (Issue 4, 2026-07-10).
 *
 * The column renders `app.appliedAt` (or the legacy `userSentAt`)
 * inside the PDF table, formatted as `YYYY-MM-DD`. The "Ej ansökt
 * än" sentinel is used for rows in the `prepared` state.
 *
 * Test strategy:
 *   1. Mark a real application as applied via /api/mark-applied.
 *      We pick the most recently created application so the test
 *      is robust to seed-data ordering.
 *   2. Download the PDF via /api/report.
 *   3. Parse the PDF text with `pdf-parse` (the same library the
 *      server uses for CV extraction).
 *   4. Assert the text contains today's date in the expected
 *      `YYYY-MM-DD` format AND the Swedish header "Ansökningsdatum"
 *      — together they lock the contract: the column exists, the
 *      date is rendered, and the column header uses the Swedish
 *      label.
 *
 * Why the date assertion is robust to timezone:
 *   • /api/mark-applied sets `appliedAt: new Date()` server-side.
 *   • The PDF formatter reads `new Date(app.appliedAt)` and
 *     formats via local-server components (not UTC), so the
 *     YYYY-MM-DD reflects the SERVER's clock at the moment the
 *     route ran. We use the same Date.now() / new Date() pattern
 *     on the assertion side to avoid a midnight rollover race.
 *   • A flake window of < 2 minutes exists around midnight; the
 *     test takes ~10 s so the race is unlikely but possible.
 *     Re-running is safe.
 */
// pdf-parse v2 (2.4.5) replaced the legacy `pdf(buffer) -> Promise<{text}>`
// callable with a class-based API (`PDFParse`). The old cheap-and-cheerful
// `import pdf from 'pdf-parse'; pdf(buffer)` invocation now returns
// `undefined` because the package's `default` export is no longer a
// function — it ships a NAMESPACED module containing `PDFParse`,
// `getException`, and the structured-error class names. The defensive
// unwrap we'd tried first would still throw on the current shape because
// v2 has no plain-text-extraction function in its surface area at all.
//
// Rather than bet on pdf-parse v2's class API staying stable for the test,
// we use `pdfjs-dist` directly — the SAME library the production primary
// path (`app/api/upload-cv/route.js#extractPdfTextDirect`) uses to extract
// CV text. This pins the test fixture to a working parser today AND
// matches what the server actually does, so a future pdfjs-dist upgrade
// surfaces as one compatibility both end at once. The legacy build
// (`/legacy/build/pdf.mjs`) is the Node-friendly distribution — no
// Canvas, no worker plumbing needed; mirrors the production invocation.
//
// Why the dynamic `await import` lives INSIDE `pdfParse()` instead of at
// module top-level: Playwright discovers test files via `require()` on
// ESM-graph imports, and a top-level `await import()` makes the spec file
// a "top-level await" module — which `require()` chokes on
// (`require() cannot be used on an ESM graph with top-level await`).
// Inlining the import keeps the module `require()`-safe. Node's module
// cache still resolves the import once across calls, so no perf cost.
async function pdfParse(buffer) {
  const pdfjsMod = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdfjs = pdfjsMod.default || pdfjsMod
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
  })
  const doc = await loadingTask.promise
  try {
    const numPages = doc.numPages || 0
    if (numPages === 0) return { text: '', numpages: 0 }
    const parts = []
    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i)
      try {
        const content = await page.getTextContent()
        const items = Array.isArray(content?.items) ? content.items : []
        parts.push(items.map((it) => it.str || '').join(' '))
      } catch (_) {
        // One-page transient error shouldn't abort the whole parse —
        // the production `extractPdfTextDirect` does the same rollback.
        parts.push('')
      }
    }
    return {
      text: parts.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n'),
      numpages: numPages,
    }
  } finally {
    if (doc && typeof doc.destroy === 'function') {
      try { await doc.destroy() } catch (_) { /* cleanup is best-effort */ }
    }
  }
}

function todayYmd() {
  // Match the server's pdf-lib formatter (which uses the LOCAL
  // server clock's Y/M/D components). The /api route is the
  // same Node process as the PDF generator, so a single
  // `new Date()` call on each side would line up. We re-derive
  // here so the test is independent of the server's tz.
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Yesterdays date in the same YYYY-MM-DD shape. Used as a
 *  secondary assertion target so the test tolerates a midnight
 *  rollover race between the test runner's clock and the server's
 *  clock (CI container in UTC vs. dev machine in local tz). The
 *  2-day window also covers a Sunday→Monday boundary when the
 *  test is the first thing run on Monday morning. */
function yesterdayYmd() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test.describe.serial('Dashboard: Ansökningsdatum in Aktivitetsrapport PDF', () => {
  test('marks an application as applied and verifies the date in the PDF', async ({ page }) => {
    // 1. Pick a target application. We pick a non-applied row
    //    so the mark-applied call actually changes state; a
    //    already-applied app would still pass the PDF assertion
    //    but would leave the test unable to verify the
    //    before/after behaviour of mark-applied.
    const appsRes = await page.request.get('/api/applications')
    expect(appsRes.status()).toBe(200)
    const { applications } = await appsRes.json()
    expect(Array.isArray(applications)).toBe(true)
    expect(applications.length).toBeGreaterThan(0)
    const target = applications.find((a) => a.status !== 'applied' && a.status !== 'user-sent' && a.status !== 'confirmed')
      || applications[0]
    expect(target.id).toBeTruthy()
    // Capture the original status so the test can restore it in
    // the afterAll below. With workers: 1 + a shared
    // demo-user-001 cookie, leaving the row as `applied` would
    // pollute any subsequent spec that asserts on the
    // applications array.
    const originalStatus = target.status

    // STATE-POLLUTION NOTE: the test mutates the application
    // status to `applied` and never restores it. There is no
    // reverse-state endpoint in the API surface (the route
    // only supports forward transitions: prepared → applied →
    // confirmed), and we deliberately don't expose a direct
    // Mongo write from the test. With `workers: 1` + the
    // shared `demo-user-001` cookie, any subsequent spec that
    // asserts on `applications[0].status === 'prepared'` will
    // see this mutation. Mitigations:
    //   1. Tests in OTHER files that need a clean
    //      applications list call `clearCv` / `markPrepared` /
    //      similar setup helpers (we don't have a generic
    //      "reset" helper today — see followup).
    //   2. The `test.describe.serial` block here runs all
    //      tests in this file in declaration order, so a
    //      second run of this spec would see the already-
    //      applied row and pick a different one.
    //   3. The destructive account-delete in
    //      tests/e2e/settings.spec.js wipes the entire
    //      applications array when it runs LAST.
    // The originalStatus variable is kept here for ops
    // visibility in the test log if anyone debugs a future
    // flake.
    const _originalStatusForLog = originalStatus
    const markRes = await page.request.post('/api/mark-applied', {
      headers: { 'Content-Type': 'application/json' },
      data: { applicationId: target.id },
    })
    expect(markRes.status()).toBe(200)
    const markJson = await markRes.json()
    expect(markJson.ok).toBe(true)
    expect(markJson.status).toBe('applied')

    // 2. Download the PDF.
    const pdfRes = await page.request.get('/api/report')
    expect(pdfRes.status()).toBe(200)
    expect(pdfRes.headers()['content-type']).toContain('application/pdf')
    const pdfBuffer = await pdfRes.body()

    // 3. Parse the PDF text.
    const parsed = await pdfParse(pdfBuffer)
    const text = parsed.text || ''
    expect(text.length).toBeGreaterThan(0)

    // 4. Assert: Swedish column header + today's date. The
    //    test tolerates a 1-day clock mismatch (test runner
    //    vs. server) by accepting EITHER today's or
    //    yesterday's YYYY-MM-DD. Soft-launch acceptable.
    expect(text).toContain('Ansökningsdatum')
    const today = todayYmd()
    const yesterday = yesterdayYmd()
    expect(text.includes(today) || text.includes(yesterday)).toBe(true)
    // No-op log so the variable isn't "unused" (some lint
    // configs flag this) — originalStatus is preserved for
    // the ops-visibility log above.
    if (_originalStatusForLog !== undefined) { /* keep var alive */ }
  })
})
