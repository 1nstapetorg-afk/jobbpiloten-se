# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: all-issues-smoke.spec.js >> All-issues smoke spec >> valid text PDF upload: 200 OK + success line + file card renders
- Location: tests\e2e\all-issues-smoke.spec.js:138:7

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('[data-testid="settings-cv-success"]')
Expected substring: "tecken hittades"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('[data-testid="settings-cv-success"]')

```

```yaml
- region "Notifications alt+T"
- strong: 🔧 Demo-läge
- text: — Clerk-nycklar saknas eller är ogiltiga. Applikationen körs i demonstrationsläge.
- link "Logga in som demo-användare":
  - /url: /sign-in
- text: eller konfigurera Clerk-nycklar i
- code: .env
- text: för riktig autentisering.
- button "Stäng"
- alert
- navigation:
  - link "JobbPiloten":
    - /url: /
  - link "Dashboard":
    - /url: /dashboard
- text: Konto
- heading "Inställningar" [level=1]
- paragraph: Hantera din profil, prenumeration och notiser. Du kan också exportera eller radera dina uppgifter när som helst.
- text: Profil Informationen AI:n använder för att skriva dina personliga brev.
- heading "Din profilbild" [level=3]
- paragraph: Välj en av våra tecknade avatarer eller ladda upp ett eget foto — bilden visas i dashboardens sidhuvud och i brev-modalen.
- img "Profilbild"
- paragraph: Ingen bild vald — JobbPilotens standardikon visas just nu.
- tablist "Profilbildkälla":
  - tab "Välj avatar" [selected]
  - tab "Ladda upp foto"
- text: 0 av 16 samlade · Vanlig 0/5 Ovanlig 0/5 Sällsynt 0/4 Episk 0/2
- option "Piloten":
  - img
  - text: Piloten
- option "Navigatören":
  - img
  - text: Navigatören
- option "Upptäckaren":
  - img
  - text: Upptäckaren
- option "Ingenjören":
  - img
  - text: Ingenjören
- option "Kreatören":
  - img
  - text: Kreatören
- option "Strategen":
  - img
  - text: Strategen
- option "Utforskaren":
  - img
  - text: Utforskaren
- option "Kaptenen":
  - img
  - text: Kaptenen
- option "Byggaren":
  - img
  - text: Byggaren
- option "Forskaren":
  - img
  - text: Forskaren
- option "Konstnären":
  - img
  - text: Konstnären
- option "Mentorn":
  - img
  - text: Mentorn
- option "Hjälten":
  - img
  - text: Hjälten
- option "Innovatören":
  - img
  - text: Innovatören
- option "Visionären":
  - img
  - text: Visionären
- option "Mystikern":
  - img
  - text: Mystikern
- paragraph: Bilden lagras som en del av din profil (max 2 MB). Inga tredjeparts-API:er används — allt ligger i din egen MongoDB-dokument och visas bara i JobbPiloten.
- heading "Personuppgifter" [level=3]
- text: Fullständigt namn
- textbox "Fullständigt namn":
  - /placeholder: Anna Andersson
  - text: Demo Användare
- text: E-post
- textbox "E-post":
  - /placeholder: anna@example.se
  - text: demo@jobbpiloten.se
- text: Telefon
- textbox "Telefon":
  - /placeholder: 070-123 45 67
- text: Personnummer
- textbox "Personnummer":
  - /placeholder: YYYYMMDD-XXXX
- text: Adress
- textbox "Adress":
  - /placeholder: Storgatan 1, 111 22 Stockholm
- text: LinkedIn-URL
- textbox "LinkedIn-URL":
  - /placeholder: https://linkedin.com/in/anna
- text: Arbetsförmedlingens ärendenummer (valfritt)
- textbox "Arbetsförmedlingens ärendenummer (valfritt)":
  - /placeholder: t.ex. 2024-12345
- paragraph: Visas i din Aktivitetsrapport så AF kan koppla rapporten till ditt ärende.
- heading "Karriärprofil" [level=3]
- text: Önskade jobbtitlar (komma-separerade)
- textbox "Önskade jobbtitlar (komma-separerade)":
  - /placeholder: Frontend Developer, UX Designer
  - text: Frontend Developer
- text: Önskade orter (komma-separerade)
- textbox "Önskade orter (komma-separerade)":
  - /placeholder: Stockholm, Göteborg, Distans
  - text: Stockholm
- text: Minimilön (kr/mån)
- spinbutton "Minimilön (kr/mån)": "35000"
- text: Erfarenhetsnivå
- combobox "Erfarenhetsnivå": Medior
- text: Arbetsform
- combobox "Arbetsform": Hybrid
- text: Anställningstyp (välj en eller flera)
- checkbox "Heltid" [checked]
- text: Heltid
- checkbox "Deltid"
- text: Deltid
- checkbox "Konsult"
- text: Konsult
- checkbox "Praktik"
- text: Praktik
- checkbox "Tillsvidare"
- text: Tillsvidare
- checkbox "Visstid"
- text: Visstid
- paragraph: Tomt = alla typer visas. AI:n använder dina val för att filtrera bort jobb som inte matchar.
- text: Branscher att undvika
- checkbox "Försvar"
- text: Försvar
- checkbox "Tobak"
- text: Tobak
- checkbox "Spel"
- text: Spel
- checkbox "Olja & Gas"
- text: Olja & Gas
- heading "CV-fil" [level=3]
- paragraph: Ladda upp ditt CV så använder AI:n texten i dina personliga brev. Du kan fortfarande skriva en kort sammanfattning nedan som reserv eller komplement.
- text: cv-smoke.pdf 878 B
- paragraph: Uppladdad 2026-07-20
- button "Byt fil"
- button "Ta bort CV-fil"
- text: Filen är uppladdad men vi kunde inte tolka texten (t.ex. en skannad bild-PDF). Skriv en kort sammanfattning nedan så AI:n kan använda den i dina personliga brev. Eller skriv manuell sammanfattning
- textbox "Eller skriv manuell sammanfattning":
  - /placeholder: Valfri kort sammanfattning. AI:n använder CV-filen om den finns — detta är ett reservalternativ.
- paragraph: 0 / 1500 tecken
- button "Förbättra formulering" [disabled]
- link "Ladda ner CV-PDF":
  - /url: /api/cv-pdf
- text: "Resultatfokus — ton: starka verb, mätbara effekter."
- alert:
  - strong: Skriv en kort sammanfattning av ditt CV
  - text: så AI:n kan skriva personliga brev. Utan en källa genereras bara generiska svar.
- heading "Auto-fill-inställningar" [level=3]
- paragraph: Dessa fält styr hur JobbPiloten-tillägget fyller i ansökningsformulär åt dig. Kryssrutorna motsvarar ja/nej-frågor (körkort, arbetstillstånd, erfarenhet, språk, etc.). Dropdowns och datum används för frågor om ålder, kön och nationalitet. Kompetenserna matchas mot kryssrute-listor i ansökan (Maskiner, Service, etc.).
- text: B-körkort
- switch "B-körkort"
- text: EU/EEA-medborgare
- switch "EU/EEA-medborgare"
- text: Arbetstillstånd
- switch "Arbetstillstånd"
- text: Gymnasieexamen
- switch "Gymnasieexamen"
- text: Truckförarbevis
- switch "Truckförarbevis"
- text: Säkerhetsklassad
- switch "Säkerhetsklassad"
- text: Ledarerfarenhet
- switch "Ledarerfarenhet"
- text: Tvärspråkig (SV + EN)
- switch "Tvärspråkig (SV + EN)"
- text: Teknisk utbildning
- switch "Teknisk utbildning"
- text: Kundservice-erfarenhet
- switch "Kundservice-erfarenhet"
- text: År av erfarenhet
- spinbutton "År av erfarenhet": "0"
- text: Födelsedatum
- textbox "Födelsedatum"
- text: Kön
- combobox "Kön": Välj kön
- text: Nationalitet
- textbox "Nationalitet":
  - /placeholder: Svensk, Norsk, ...
- text: Telefon landskod (default +46)
- textbox "Telefon landskod (default +46)":
  - /placeholder: "+46"
  - text: "+46"
- paragraph: Används i dropdown-menyn för landskod på ansökningsformulär.
- text: Kompetenser (välj alla som gäller)
- checkbox "Maskiner"
- text: Maskiner
- checkbox "Sanering"
- text: Sanering
- checkbox "Service"
- text: Service
- checkbox "Förvaltning"
- text: Förvaltning
- checkbox "Truck"
- text: Truck
- checkbox "Kundsupport"
- text: Kundsupport
- checkbox "Lager"
- text: Lager
- checkbox "Städ"
- text: Städ
- checkbox "Transport"
- text: Transport
- checkbox "Bygg"
- text: Bygg
- paragraph: JobbPiloten klickar automatiskt i motsvarande kryssrutor i ansökningsformulär (t.ex. en lista “Markera alla som gäller”).
- text: Auto-godkänn GDPR-samtycke
- paragraph:
  - strong: Som standard är detta AV.
  - text: Om du slår på det kommer JobbPiloten-tillägget automatiskt klicka i GDPR/cookies-rutor som matchar mönstret
  - emphasis: jag har läst och godkänner
  - text: . Detta binder dig juridiskt — slå bara på det om du är säker på att du vill godkänna alla sådana villkor i förväg.
- switch "Auto-godkänn GDPR-samtycke"
- text: Du har
- strong: "1"
- text: osparade ändringar.
- button "Återställ"
- button "Spara ändringar"
- text: Prenumeration Hantera din plan och fakturering via Stripe. Plan Professional Status Inaktiv Intervall —
- button "Välj plan"
- text: Betalningar hanteras av Stripe — vi ser aldrig ditt kortnummer. Push-notiser Få en notis när AI-assistenten hittar nya matchande jobb. Inaktiva
- button "Aktivera push-notiser"
- paragraph: Push-notiser används bara för nya jobb-träffar. Inga reklam eller nyhetsbrev skickas via push. Du kan när som helst slå av notiserna ovan eller i webbläsarens inställningar.
- text: Webbläsartillägg Installera JobbPiloten Auto-Fill för att fylla i ansökningsformulär med ett klick. Inte installerat
- link "Installera (steg-för-steg)":
  - /url: /extension-install
- paragraph: Soft-launch — vi laddar via Chrome's "Load unpacked"-läge tills Chrome Web Store-granskningen är klar.
- text: JobbPiloten Auto-Fill Webbläsare och enheter som är anslutna till din profil. Inga anslutna enheter AI-hjälp i ansökningsformulär Låter AI skriva svar på frågor som "Varför vill du jobba hos oss?" när du fyller i ansökningar via vår browser-extension. Låt AI skriva svar på okända frågor
- paragraph: När på fyller JobbPiloten fält som saknar matchande profilvärde via Groq (max 12 svar per klick, max 200 ord per svar).
- switch "Aktivera AI-svar på okända frågor" [checked]
- text: AI har skrivit 0 svar åt dig denna månad Aktiv 0 / 50 använda 50 kvar Månadstak per plan
- list:
  - listitem: Basic Ingår i gratisplanen 10
  - listitem: Pro Ingår i Pro 50
  - listitem: Elite Obegränsat i Elite obegränsat
- link "Se pris →":
  - /url: /#priser
- text: AI-stil för ansökningar Välj vilken röst AI:n ska använda när den skriver dina personliga brev och svar.
- radiogroup "AI-skrivstil":
  - 'radio "Lagom Aktiv Balanserad — varken för formell eller för casual. Svensk arbetsplatsstandard. “Jag har lång erfarenhet av...” Alla öppningar: “Jag har lång erfarenhet av...” · “Min bakgrund inom...”" [checked]'
  - text: Lagom Aktiv
  - paragraph: Balanserad — varken för formell eller för casual. Svensk arbetsplatsstandard.
  - paragraph: “Jag har lång erfarenhet av...”
  - paragraph: "Alla öppningar: “Jag har lång erfarenhet av...” · “Min bakgrund inom...”"
  - radio "Strukturerad Punktlistor, analytiskt och faktadrivet."
  - text: Strukturerad
  - paragraph: Punktlistor, analytiskt och faktadrivet.
  - radio "Berättande Story-drivet, personliga exempel och narrativa bågar."
  - text: Berättande
  - paragraph: Story-drivet, personliga exempel och narrativa bågar.
  - radio "Direkt Koncis, rakt på sak, inget fluff."
  - text: Direkt
  - paragraph: Koncis, rakt på sak, inget fluff.
  - radio "Engagerad Entusiastisk, missionsdriven, företagsfokuserad."
  - text: Engagerad
  - paragraph: Entusiastisk, missionsdriven, företagsfokuserad.
- paragraph: Stilvalet sparas direkt och börjar gälla vid nästa AI-generering. Du kan när som helst byta tillbaka.
- text: Sparade svar AI:n återanvänder dessa svar när du möter en liknande fråga i nästa ansökan.
- list:
  - listitem:
    - text: Inga sparade svar — klicka
    - strong: Spara
    - text: på ett AI-svar för att lägga till.
- text: "Data & integritet Exportera eller radera dina uppgifter — rättigheter enligt GDPR art. 17 och 20. Ladda ner mina uppgifter Hämtar en JSON-fil med allt vi lagrar om dig: profil, ansökningar, push-prenumeration och de senaste cron-loggarna. Inga externa system anropas."
- button "Ladda ner JSON"
- text: Radera mitt konto Raderar permanent alla dina uppgifter. Kan inte ångras. Kom ihåg att avbryta din prenumeration via Stripe först — det gör den inte automatiskt.
- button "Radera konto"
- contentinfo:
  - text: Frågor? Maila
  - link "hej@jobbpiloten.se":
    - /url: mailto:hej@jobbpiloten.se
  - text: .
- region "Vi använder cookies":
  - text: Vi använder cookies
  - paragraph:
    - text: Vi använder cookies för att du ska kunna logga in och för att förbättra din upplevelse. Vi delar inte din data med tredje part.
    - link "Läs mer i vår integritetspolicy":
      - /url: /privacy
    - text: .
  - button "Endast nödvändiga"
  - button "Acceptera alla"
  - button "Stäng"
  - paragraph: Endast nödvändiga = sessionscookie för inloggning. Acceptera alla = samma + anonymiserad statistik i framtiden.
```

# Test source

```ts
  49  |   // for simplicity here, we test the EMPTY path which returns 200
  50  |   // + cvText='' + needsManualFallback (the original
  51  |   // cv-magic-bytes.spec.js covers the actual image-only case with
  52  |   // a real scanned page mock).
  53  |   const doc = await PDFDocument.create()
  54  |   doc.addPage([300, 200])
  55  |   return await doc.save()
  56  | }
  57  | 
  58  | async function clearCv(page) {
  59  |   const res = await page.request.post('/api/profile-update', {
  60  |     headers: { 'Content-Type': 'application/json' },
  61  |     data: {
  62  |       cvText: '',
  63  |       cvFileName: '',
  64  |       cvFileSize: 0,
  65  |       cvUploadedAt: null,
  66  |     },
  67  |   })
  68  |   expect([200, 404]).toContain(res.status())
  69  | }
  70  | 
  71  | const todayYmd = () => {
  72  |   const d = new Date()
  73  |   return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  74  | }
  75  | 
  76  | test.describe.serial('All-issues smoke spec', () => {
  77  |   test.beforeEach(async ({ page }) => {
  78  |     await clearCv(page)
  79  |   })
  80  | 
  81  |   // ---------- Issue 1: dashboard URL is reachable ----------
  82  |   test('dashboard /dashboard renders without a popup-open error', async ({ page }) => {
  83  |     // The extension popup's openDashboard() opens
  84  |     // `${PROD_BASE_URL}/dashboard` (cap'n'd as https://jobbpiloten.se
  85  |     // /dashboard in the proxy). Locally we hit /dashboard and
  86  |     // confirm it returns the dashboard page rather than a 5xx
  87  |     // caused by the dispatch's openDashboard().then() chain.
  88  |     const res = await page.request.get('/dashboard')
  89  |     expect(res.status()).toBe(200)
  90  |   })
  91  | 
  92  |   // ---------- Issue 2: Visa fler jobb click ----------
  93  | 
  94  |   test('Visa fler jobb click appends page-2 jobs and hides when hasMore=false', async ({ page }) => {
  95  |     // Deterministic mock so CI runs are reliable. Page 0 returns
  96  |     // 10 jobs + hasMore=true; page 1 returns 10 + hasMore=false.
  97  |     await page.route('**/api/jobs-available*', async (route) => {
  98  |       const url = new URL(route.request().url())
  99  |       const pageNum = parseInt(url.searchParams.get('page') || '0', 10)
  100 |       const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10)
  101 |       const jobs = Array.from({ length: pageSize }, (_, i) => ({
  102 |         id: `smoke-${pageNum * pageSize + i + 1}`,
  103 |         company: `SmokeCo ${pageNum * pageSize + i + 1}`,
  104 |         title: `SmokeTitle ${pageNum * pageSize + i + 1}`,
  105 |         location: 'Stockholm',
  106 |         source: 'Arbetsförmedlingen',
  107 |         url: `https://example.com/smoke/${pageNum * pageSize + i + 1}`,
  108 |         matchesUserLocation: true,
  109 |       }))
  110 |       await route.fulfill({
  111 |         status: 200,
  112 |         contentType: 'application/json',
  113 |         body: JSON.stringify({
  114 |           jobs,
  115 |           total: jobs.length,
  116 |           hasMore: pageNum === 0,
  117 |           page: pageNum,
  118 |           pageSize,
  119 |           searchMode: 'strict',
  120 |           locationFilterMode: 'strict',
  121 |           userLocations: ['Stockholm'],
  122 |         }),
  123 |       })
  124 |     })
  125 | 
  126 |     await page.goto('/dashboard')
  127 |     await expect(page.locator('[data-testid="dagens-jobb-card"]').first()).toBeVisible({ timeout: 20_000 })
  128 |     await expect(page.locator('[data-testid="jobs-load-more"]')).toBeVisible()
  129 |     await expect(page.locator('[data-testid="jobs-load-more-hint"]')).toContainText('Visar 10 jobb just nu')
  130 | 
  131 |     await page.locator('[data-testid="jobs-load-more"]').click()
  132 |     await expect(page.locator('[data-testid="jobs-load-more-hint"]')).toContainText('Visar 20 jobb just nu', { timeout: 10_000 })
  133 |     await expect(page.locator('[data-testid="jobs-load-more"]')).toHaveCount(0, { timeout: 5_000 })
  134 |   })
  135 | 
  136 |   // ---------- Issue 3: CV upload happy path ----------
  137 | 
  138 |   test('valid text PDF upload: 200 OK + success line + file card renders', async ({ page }) => {
  139 |     await page.goto('/settings')
  140 |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
  141 |     const bytes = await makeTextPdf('CV smoke fixture Stockholm')
  142 |     await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
  143 |       name: 'cv-smoke.pdf',
  144 |       mimeType: 'application/pdf',
  145 |       buffer: Buffer.from(bytes),
  146 |     })
  147 |     await page.waitForSelector('[data-testid="settings-cv-filecard"]', { timeout: 20_000 })
  148 |     await expect(page.locator('[data-testid="settings-cv-filecard"]')).toContainText('cv-smoke.pdf')
> 149 |     await expect(page.locator('[data-testid="settings-cv-success"]')).toContainText('tecken hittades')
      |                                                                       ^ Error: expect(locator).toContainText(expected) failed
  150 |   })
  151 | 
  152 |   test('wrong magic bytes: server categorises with specific Swedish 400', async ({ page }) => {
  153 |     await page.goto('/settings')
  154 |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
  155 |     // Bytes 0..2 are "Hel" — not the %PDF- signature.
  156 |     await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
  157 |       name: 'inte-en-pdf.pdf',
  158 |       mimeType: 'application/pdf',
  159 |       buffer: Buffer.from('Hello, this file is not a real PDF.'),
  160 |     })
  161 |     await expect(page.locator('[data-testid="settings-cv-error"]')).toBeVisible({ timeout: 10_000 })
  162 |     await expect(page.locator('[data-testid="settings-cv-error"]')).toContainText('inte en giltig PDF')
  163 |   })
  164 | 
  165 |   test('empty PDF: 200 OK + empty cvText + empty-hint banner (NOT 400)', async ({ page }) => {
  166 |     // Verifies the 2026-07-11 linchpin contract: the route's new
  167 |     // isImageOnly detection (run via pdfjs-dist operator list) does
  168 |     // NOT mis-classify pdf-lib's empty `addPage` as image-only. The
  169 |     // empty-hint banner is the document end-state.
  170 |     await page.goto('/settings')
  171 |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
  172 |     const bytes = await makeImageOnlyPdf()
  173 |     await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
  174 |       name: 'empty.pdf',
  175 |       mimeType: 'application/pdf',
  176 |       buffer: Buffer.from(bytes),
  177 |     })
  178 |     await page.waitForSelector('[data-testid="settings-cv-filecard"]', { timeout: 20_000 })
  179 |     await expect(page.locator('[data-testid="settings-cv-empty-hint"]')).toBeVisible()
  180 |     await expect(page.locator('[data-testid="settings-cv-empty-hint"]')).toContainText('kunde inte tolka texten')
  181 |     await expect(page.locator('[data-testid="settings-cv-error"]')).toHaveCount(0)
  182 |     await expect(page.locator('[data-testid="settings-cv-success"]')).toHaveCount(0)
  183 |   })
  184 | 
  185 |   // ---------- Issue 3 (cont): OCR stub contract ----------
  186 | 
  187 |   test('POST /api/cv-ocr returns 501 OCR_NOT_CONFIGURED for auth\u2019d users', async ({ page }) => {
  188 |     // Even though we have no UI button wired to OCR yet, the stub
  189 |     // endpoint MUST exist + auth-gate + return the structured
  190 |     // 501 so the deferred v0.4.0 implementation can ship without
  191 |     // changing the client. Lock the contract here.
  192 |     const res = await page.request.post('/api/cv-ocr', {
  193 |       headers: { 'Content-Type': 'application/json' },
  194 |       data: {},
  195 |     })
  196 |     expect(res.status()).toBe(501)
  197 |     const body = await res.json().catch(() => ({}))
  198 |     expect(body.code).toBe('OCR_NOT_CONFIGURED')
  199 |     expect(body.retryWithOcr).toBe(false)
  200 |     expect(body.needsManualFallback).toBe(true)
  201 |   })
  202 | 
  203 |   // ---------- Issue 4: Aktivitetsrapport PDF generation ----------
  204 | 
  205 |   test('GET /api/report returns valid PDF with Ansökningsdatum + YYYY-MM-DD row', async ({ page }) => {
  206 |     const res = await page.request.get('/api/report')
  207 |     expect(res.status()).toBe(200)
  208 |     expect(res.headers()['content-type']).toContain('application/pdf')
  209 |     const buf = await res.body()
  210 |     // Cheap header check \u2014 a valid PDF starts with `%PDF-`.
  211 |     expect(buf.slice(0, 5).toString()).toBe('%PDF-')
  212 |     const parsed = await pdfParse(buf)
  213 |     expect(parsed.text).toContain('Ansökningsdatum')
  214 |     const today = todayYmd()
  215 |     expect(parsed.text.includes(today) || /\d{4}-\d{2}-\d{2}/.test(parsed.text)).toBe(true)
  216 |   })
  217 | })
  218 | 
```