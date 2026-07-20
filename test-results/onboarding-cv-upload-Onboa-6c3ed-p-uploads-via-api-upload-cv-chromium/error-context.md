# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: onboarding-cv-upload.spec.js >> Onboarding: CV upload >> dragging a PDF on the Granska step uploads via /api/upload-cv
- Location: tests\e2e\onboarding-cv-upload.spec.js:46:7

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('button:has-text("Nästa")')
    - locator resolved to <button class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-9 px-4 py-2 gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">…</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="rounded-xl border border-slate-200 bg-white shadow-xl p-4 sm:p-5">…</div> from <div role="region" data-testid="cookie-consent-banner" aria-labelledby="jp-cookie-consent-title" class="fixed inset-x-2 bottom-2 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-md z-50">…</div> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="rounded-xl border border-slate-200 bg-white shadow-xl p-4 sm:p-5">…</div> from <div role="region" data-testid="cookie-consent-banner" aria-labelledby="jp-cookie-consent-title" class="fixed inset-x-2 bottom-2 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-md z-50">…</div> subtree intercepts pointer events
    - retrying click action
      - waiting 100ms
    111 × waiting for element to be visible, enabled and stable
        - element is visible, enabled and stable
        - scrolling into view if needed
        - done scrolling
        - <div class="rounded-xl border border-slate-200 bg-white shadow-xl p-4 sm:p-5">…</div> from <div role="region" data-testid="cookie-consent-banner" aria-labelledby="jp-cookie-consent-title" class="fixed inset-x-2 bottom-2 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-md z-50">…</div> subtree intercepts pointer events
      - retrying click action
        - waiting 500ms

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - region "Notifications alt+T"
  - generic [ref=e3]:
    - generic [ref=e4]:
      - img [ref=e5]
      - generic [ref=e7]:
        - strong [ref=e8]: 🔧 Demo-läge
        - text: — Clerk-nycklar saknas eller är ogiltiga. Applikationen körs i demonstrationsläge.
        - link "Logga in som demo-användare" [ref=e9] [cursor=pointer]:
          - /url: /sign-in
        - text: eller konfigurera Clerk-nycklar i
        - code [ref=e10]: .env
        - text: för riktig autentisering.
    - button "Stäng" [ref=e11] [cursor=pointer]:
      - img [ref=e12]
  - generic [ref=e16]:
    - generic [ref=e17]:
      - generic [ref=e18]:
        - generic [ref=e19]: Skapa din profil
        - generic [ref=e20]: Steg 1 av 4
      - progressbar [ref=e21]
      - generic [ref=e23]:
        - generic [ref=e24]: Karriärinfo
        - generic [ref=e25]: Personuppgifter
        - generic [ref=e26]: Preferenser
        - generic [ref=e27]: Granska
    - generic [ref=e28]:
      - generic [ref=e29]:
        - generic [ref=e30]:
          - text: Önskade jobbtitlar (separera med komma)
          - textbox "t.ex. Frontend Developer, UX Designer" [ref=e31]
        - generic [ref=e32]:
          - text: Erfarenhetsnivå
          - combobox [ref=e33] [cursor=pointer]:
            - generic: Välj nivå
            - img [ref=e34]
        - generic [ref=e36]:
          - text: Önskade orter (separera med komma)
          - textbox "t.ex. Stockholm, Göteborg, Remote" [ref=e37]
        - generic [ref=e38]:
          - generic [ref=e39]:
            - text: Minimilön (kr/mån)
            - spinbutton [ref=e40]
          - generic [ref=e41]:
            - text: Maxlön (kr/mån)
            - spinbutton [ref=e42]
      - generic [ref=e43]:
        - button "Tillbaka" [disabled]:
          - img
          - text: Tillbaka
        - button "Nästa" [ref=e44] [cursor=pointer]:
          - text: Nästa
          - img
  - button "Open Next.js Dev Tools" [ref=e50] [cursor=pointer]:
    - img [ref=e51]
  - alert [ref=e54]
  - region "Vi använder cookies" [ref=e55]:
    - generic [ref=e57]:
      - img [ref=e59]
      - generic [ref=e61]:
        - generic [ref=e62]: Vi använder cookies
        - paragraph [ref=e63]:
          - text: Vi använder cookies för att du ska kunna logga in och för att förbättra din upplevelse. Vi delar inte din data med tredje part.
          - link "Läs mer i vår integritetspolicy" [ref=e64] [cursor=pointer]:
            - /url: /privacy
          - text: .
        - generic [ref=e65]:
          - button "Endast nödvändiga" [ref=e66] [cursor=pointer]
          - button "Acceptera alla" [ref=e67] [cursor=pointer]
          - button "Stäng" [ref=e68] [cursor=pointer]:
            - img [ref=e69]
        - paragraph [ref=e72]: Endast nödvändiga = sessionscookie för inloggning. Acceptera alla = samma + anonymiserad statistik i framtiden.
```

# Test source

```ts
  1  | import { test, expect } from './_fixtures/auth'
  2  | import { PDFDocument, StandardFonts } from 'pdf-lib'
  3  | 
  4  | /**
  5  |  * E2E spec for the CV upload flow inside the onboarding Granska step.
  6  |  *
  7  |  * The onboarding wizard renders the SAME `<CVFileUpload>` component as
  8  |  * the /settings page — but it lives in the wizard body, not in a
  9  |  * dedicated /settings route, so we have a separate spec that
  10 |  * navigates the stepper before asserting the upload contract.
  11 |  *
  12 |  * Onboarding step indexing:
  13 |  *   step 0 → Karriärinfo  → "Nästa" → step 1
  14 |  *   step 1 → Personuppgifter → "Nästa" → step 2
  15 |  *   step 2 → Preferenser   → "Nästa" → step 3
  16 |  *   step 3 → Granska       → "Slutför"  (this is where the dropzone lives)
  17 |  */
  18 | 
  19 | async function makeTextPdf(label) {
  20 |   const doc = await PDFDocument.create()
  21 |   const page = doc.addPage([300, 200])
  22 |   const font = await doc.embedFont(StandardFonts.Helvetica)
  23 |   page.drawText(label, { x: 30, y: 130, size: 16, font })
  24 |   page.drawText('Stockholm, Sverige', { x: 30, y: 95, size: 12, font })
  25 |   return await doc.save()
  26 | }
  27 | 
  28 | async function clearCv(page) {
  29 |   const res = await page.request.post('/api/profile-update', {
  30 |     headers: { 'Content-Type': 'application/json' },
  31 |     data: {
  32 |       cvText: '',
  33 |       cvFileName: '',
  34 |       cvFileSize: 0,
  35 |       cvUploadedAt: null,
  36 |     },
  37 |   })
  38 |   expect([200, 404]).toContain(res.status())
  39 | }
  40 | 
  41 | test.describe.serial('Onboarding: CV upload', () => {
  42 |   test.beforeEach(async ({ page }) => {
  43 |     await clearCv(page)
  44 |   })
  45 | 
  46 |   test('dragging a PDF on the Granska step uploads via /api/upload-cv', async ({ page }) => {
  47 |     await page.goto('/onboarding')
  48 | 
  49 |     // Wait until the wizard's forward button is rendered.
  50 |     await page.waitForSelector('button:has-text("Nästa")', {
  51 |       state: 'visible',
  52 |       timeout: 20_000,
  53 |     })
  54 | 
  55 |     // Click through to step 3 (Granska). The wizard advances on click;
  56 |     // we don't fill any of the early-step fields — `Nästa` is just a
  57 |     // stepper advance in this implementation, not a submit.
  58 |     for (let i = 0; i < 3; i++) {
> 59 |       await page.locator('button:has-text("Nästa")').click()
     |                                                      ^ Error: locator.click: Test timeout of 60000ms exceeded.
  60 |       // Brief settle so DOM reconciliation finishes before the next click.
  61 |       await page.waitForTimeout(150)
  62 |     }
  63 | 
  64 |     // On the Granska step, the shared CVFileUpload dropzone renders.
  65 |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
  66 |       state: 'visible',
  67 |       timeout: 20_000,
  68 |     })
  69 | 
  70 |     const pdfBytes = await makeTextPdf('CV fixture onboarding Volvobilar')
  71 |     await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
  72 |       name: 'cv-onboarding.pdf',
  73 |       mimeType: 'application/pdf',
  74 |       buffer: Buffer.from(pdfBytes),
  75 |     })
  76 | 
  77 |     // File card replaces the dropzone after a successful round-trip.
  78 |     // This confirms: (a) the dropzone accepts the input event,
  79 |     // (b) the upload endpoint writes cvText back, (c) the file card
  80 |     // component reacts to the new profile state once it refetches.
  81 |     // We deliberately DON'T click "Slutför" — that would trigger a
  82 |     // dashboard redirect chain that belongs in a separate spec.
  83 |     await page.waitForSelector('[data-testid="settings-cv-filecard"]', {
  84 |       state: 'visible',
  85 |       timeout: 20_000,
  86 |     })
  87 |     await expect(page.locator('[data-testid="settings-cv-filecard"]')).toContainText('cv-onboarding.pdf')
  88 |   })
  89 | })
  90 | 
```