# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: settings-cv-upload.spec.js >> Settings: CV upload >> uploading a text PDF parses server-side, shows the file card and the success line
- Location: tests\e2e\settings-cv-upload.spec.js:75:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-testid="settings-cv-success"]')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
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
- text: cv-fixture.pdf 966 B
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
  1   | import { test, expect } from './_fixtures/auth'
  2   | import { PDFDocument, StandardFonts } from 'pdf-lib'
  3   | 
  4   | /**
  5   |  * E2E spec for the CV upload flow on /settings.
  6   |  *
  7   |  * Tests share the demoUserId profile (set by `_fixtures/auth`). To keep
  8   |  * state predictable across runs the `beforeEach` hook resets the cv
  9   |  * fields via `/api/profile-update`, so each test starts from a known
  10  |  * "no CV on file" baseline. The reset endpoint writes
  11  |  * `cvText: '', cvFileName: '', cvFileSize: 0, cvUploadedAt: null` —
  12  |  * Mongo treats the explicit `null` as an assignment.
  13  |  *
  14  |  * Fixtures generated in-memory via `pdf-lib` so we don't have to commit
  15  |  * a binary blob. Two flavors we care about:
  16  |  *   • text PDF — three short lines, exercises the success path
  17  |  *     ("✓ CV lästes in — N tecken hittades")
  18  |  *   • image-only PDF — empty page, exercises the empty-hint path
  19  |  *     ("CV uppladdad — men texten kunde inte tolkas")
  20  |  *
  21  |  * The server uses `pdfjs-dist` (Round-14 migration away from the
  22  |  * deprecated pdf-parse v2 fallback). pdfjs-dist is tolerant enough
  23  |  * to extract the drawn text from a text PDF and to return the
  24  |  * empty string for a no-text PDF after the image-only operator
  25  |  * walk classifies it. We rely on that for the empty-text assertions.
  26  |  */
  27  | 
  28  | async function makeTextPdf(label) {
  29  |   const doc = await PDFDocument.create()
  30  |   const page = doc.addPage([300, 200])
  31  |   const font = await doc.embedFont(StandardFonts.Helvetica)
  32  |   page.drawText(label, { x: 30, y: 130, size: 16, font })
  33  |   page.drawText('Frontendutvecklare', { x: 30, y: 95, size: 12, font })
  34  |   page.drawText('Stockholm, Sverige', { x: 30, y: 75, size: 12, font })
  35  |   return await doc.save()
  36  | }
  37  | 
  38  | async function makeImageOnlyPdf() {
  39  |   const doc = await PDFDocument.create()
  40  |   // Empty page, no drawText → trimmed extraction result is "".
  41  |   doc.addPage([300, 200])
  42  |   return await doc.save()
  43  | }
  44  | 
  45  | async function clearCv(page) {
  46  |   const res = await page.request.post('/api/profile-update', {
  47  |     headers: { 'Content-Type': 'application/json' },
  48  |     data: {
  49  |       cvText: '',
  50  |       cvFileName: '',
  51  |       cvFileSize: 0,
  52  |       cvUploadedAt: null,
  53  |     },
  54  |   })
  55  |   // 200 if profile existed, 404 if not — both fine for cleanup.
  56  |   expect([200, 404]).toContain(res.status())
  57  | }
  58  | 
  59  | test.describe.serial('Settings: CV upload', () => {
  60  |   test.beforeEach(async ({ page }) => {
  61  |     await clearCv(page)
  62  |   })
  63  | 
  64  |   test('dropzone is visible when no CV is uploaded', async ({ page }) => {
  65  |     await page.goto('/settings')
  66  |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
  67  |       state: 'visible',
  68  |       timeout: 20_000,
  69  |     })
  70  |     await expect(page.locator('[data-testid="settings-cv-filecard"]')).toHaveCount(0)
  71  |     await expect(page.locator('[data-testid="settings-cv-preview-toggle"]')).toHaveCount(0)
  72  |     await expect(page.locator('[data-testid="settings-cv-success"]')).toHaveCount(0)
  73  |   })
  74  | 
  75  |   test('uploading a text PDF parses server-side, shows the file card and the success line', async ({ page }) => {
  76  |     await page.goto('/settings')
  77  |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
  78  |       state: 'visible',
  79  |       timeout: 20_000,
  80  |     })
  81  | 
  82  |     const pdfBytes = await makeTextPdf('CV fixture Volvobilar Stockholm')
  83  |     await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
  84  |       name: 'cv-fixture.pdf',
  85  |       mimeType: 'application/pdf',
  86  |       buffer: Buffer.from(pdfBytes),
  87  |     })
  88  | 
  89  |     // File card replaces the dropzone after a successful round-trip
  90  |     // through /api/upload-cv → pdfjs-dist → MongoDB → /api/profile.
  91  |     await page.waitForSelector('[data-testid="settings-cv-filecard"]', {
  92  |       state: 'visible',
  93  |       timeout: 20_000,
  94  |     })
  95  |     await expect(page.locator('[data-testid="settings-cv-filecard"]')).toContainText('cv-fixture.pdf')
  96  | 
  97  |     // Success indicator inline — copy is stable on the "tecken hittades"
  98  |     // substring. Char count is locale-formatted ("sv-SE") so it could
  99  |     // be "60" with thin spaces; we just assert the structure.
> 100 |     await expect(page.locator('[data-testid="settings-cv-success"]')).toBeVisible()
      |                                                                       ^ Error: expect(locator).toBeVisible() failed
  101 |     await expect(page.locator('[data-testid="settings-cv-success"]')).toContainText('tecken hittades')
  102 | 
  103 |     // Sonner toast announces success — the new wording is "lästes in".
  104 |     await expect(
  105 |       page.locator('[data-sonner-toast]:has-text("lästes in")').first(),
  106 |     ).toBeVisible({ timeout: 10_000 })
  107 |   })
  108 | 
  109 |   test('image-only PDF triggers the empty-hint banner instead of an error', async ({ page }) => {
  110 |     // The route treats TRIM-EMPTY text as a 200 OK with needsManualFallback.
  111 |     // The UI then renders the in-section empty-hint banner rather than the
  112 |     // server-error alert. This is the "scanned / image-only PDF" path.
  113 |     await page.goto('/settings')
  114 |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
  115 |       state: 'visible',
  116 |       timeout: 20_000,
  117 |     })
  118 | 
  119 |     const emptyBytes = await makeImageOnlyPdf()
  120 |     await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
  121 |       name: 'scanned.pdf',
  122 |       mimeType: 'application/pdf',
  123 |       buffer: Buffer.from(emptyBytes),
  124 |     })
  125 | 
  126 |     await page.waitForSelector('[data-testid="settings-cv-filecard"]', {
  127 |       state: 'visible',
  128 |       timeout: 20_000,
  129 |     })
  130 |     await expect(page.locator('[data-testid="settings-cv-filecard"]')).toContainText('scanned.pdf')
  131 | 
  132 |     // The empty-hint banner renders, NOT the generic error alert.
  133 |     await expect(page.locator('[data-testid="settings-cv-empty-hint"]')).toBeVisible()
  134 |     await expect(page.locator('[data-testid="settings-cv-empty-hint"]')).toContainText('kunde inte tolka texten')
  135 |     await expect(page.locator('[data-testid="settings-cv-error"]')).toHaveCount(0)
  136 | 
  137 |     // Success-line is absent (no char count for an empty extraction).
  138 |     await expect(page.locator('[data-testid="settings-cv-success"]')).toHaveCount(0)
  139 |   })
  140 | 
  141 |   test('invalid extension shows the in-section alert and keeps the dropzone', async ({ page }) => {
  142 |     await page.goto('/settings')
  143 |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
  144 |       state: 'visible',
  145 |       timeout: 20_000,
  146 |     })
  147 | 
  148 |     await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
  149 |       name: 'cv-fixture.exe',
  150 |       mimeType: 'application/octet-stream',
  151 |       buffer: Buffer.from('not a real file'),
  152 |     })
  153 | 
  154 |     // Client validates before round-tripping; error banner appears inline.
  155 |     await expect(page.locator('[data-testid="settings-cv-error"]')).toBeVisible({ timeout: 5_000 })
  156 |     await expect(page.locator('[data-testid="settings-cv-error"]')).toContainText('Endast PDF, DOC och DOCX stöds')
  157 | 
  158 |     // Dropzone still visible — no card should have appeared.
  159 |     await expect(page.locator('[data-testid="settings-cv-dropzone"]')).toBeVisible()
  160 |     await expect(page.locator('[data-testid="settings-cv-filecard"]')).toHaveCount(0)
  161 |   })
  162 | 
  163 |   test('remove button clears the file and returns to the dropzone', async ({ page }) => {
  164 |     await page.goto('/settings')
  165 |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
  166 |       state: 'visible',
  167 |       timeout: 20_000,
  168 |     })
  169 | 
  170 |     // Upload first so the file card branch renders with the × button.
  171 |     const pdfBytes = await makeTextPdf('CV fixture remove test')
  172 |     await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
  173 |       name: 'cv-fixture.pdf',
  174 |       mimeType: 'application/pdf',
  175 |       buffer: Buffer.from(pdfBytes),
  176 |     })
  177 |     await page.waitForSelector('[data-testid="settings-cv-filecard"]', {
  178 |       state: 'visible',
  179 |       timeout: 20_000,
  180 |     })
  181 | 
  182 |     // The component's handleRemove posts to /api/profile-update which
  183 |     // wipes the cv fields, then onChanged fires → outer load() refetches.
  184 |     await page.locator('[data-testid="settings-cv-remove"]').click()
  185 | 
  186 |     // Dropzone reappears once the profile state clears.
  187 |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
  188 |       state: 'visible',
  189 |       timeout: 15_000,
  190 |     })
  191 |     await expect(page.locator('[data-testid="settings-cv-filecard"]')).toHaveCount(0)
  192 |   })
  193 | })
  194 | 
```