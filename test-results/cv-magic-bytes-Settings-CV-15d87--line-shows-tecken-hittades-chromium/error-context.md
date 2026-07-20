# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cv-magic-bytes.spec.js >> Settings: CV magic-bytes validation >> valid PDF: 200 OK, file card renders, success line shows tecken hittades
- Location: tests\e2e\cv-magic-bytes.spec.js:68:7

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
- text: cv-magic.pdf 872 B
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
  3   | import { Document, Packer, Paragraph } from 'docx'
  4   | 
  5   | /**
  6   |  * E2E spec for the CV upload magic-bytes validation
  7   |  * (Issue 5, 2026-07-10).
  8   |  *
  9   |  * The route enforces the file's actual byte signature, not just
  10  |  * its MIME type or extension, so a hand-crafted .doc renamed to
  11  |  * .docx is rejected with a SPECIFIC Swedish error message instead
  12  |  * of surfacing as a generic "corrupt file" parser exception.
  13  |  *
  14  |  * Coverage matrix:
  15  |  *   • Valid text PDF — happy path, 200 OK + cvText populated
  16  |  *   • Valid DOCX — happy path via mammoth, 200 OK + cvText populated
  17  |  *   • Wrong magic bytes (.doc-style file with .pdf extension) —
  18  |  *     400 with the "är inte en giltig PDF" message
  19  |  *   • Image-only PDF (empty page) — 200 OK with empty cvText +
  20  |  *     `needsManualFallback: true` so the UI can show the empty-hint
  21  |  *
  22  |  * The existing settings-cv-upload.spec.js covers most of these;
  23  |  * this spec focuses on the DOCX path and the SPECIFIC magic-byte
  24  |  * rejection message to lock the contract introduced on 2026-07-10.
  25  |  */
  26  | 
  27  | async function makeTextPdf(label) {
  28  |   const doc = await PDFDocument.create()
  29  |   const page = doc.addPage([300, 200])
  30  |   const font = await doc.embedFont(StandardFonts.Helvetica)
  31  |   page.drawText(label, { x: 30, y: 130, size: 16, font })
  32  |   return await doc.save()
  33  | }
  34  | 
  35  | async function makeDocx() {
  36  |   // Minimal valid DOCX: one paragraph with "Hej från DOCX".
  37  |   const doc = new Document({
  38  |     sections: [
  39  |       {
  40  |         children: [
  41  |           new Paragraph({ text: 'Hej från DOCX — test-CV skapad av cv-magic-bytes.spec.js' }),
  42  |           new Paragraph({ text: 'Anna Andersson, Stockholm' }),
  43  |         ],
  44  |       },
  45  |     ],
  46  |   })
  47  |   return await Packer.toBuffer(doc)
  48  | }
  49  | 
  50  | async function clearCv(page) {
  51  |   const res = await page.request.post('/api/profile-update', {
  52  |     headers: { 'Content-Type': 'application/json' },
  53  |     data: {
  54  |       cvText: '',
  55  |       cvFileName: '',
  56  |       cvFileSize: 0,
  57  |       cvUploadedAt: null,
  58  |     },
  59  |   })
  60  |   expect([200, 404]).toContain(res.status())
  61  | }
  62  | 
  63  | test.describe.serial('Settings: CV magic-bytes validation', () => {
  64  |   test.beforeEach(async ({ page }) => {
  65  |     await clearCv(page)
  66  |   })
  67  | 
  68  |   test('valid PDF: 200 OK, file card renders, success line shows tecken hittades', async ({ page }) => {
  69  |     await page.goto('/settings')
  70  |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
  71  |     const bytes = await makeTextPdf('CV magic-bytes PDF test')
  72  |     await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
  73  |       name: 'cv-magic.pdf',
  74  |       mimeType: 'application/pdf',
  75  |       buffer: Buffer.from(bytes),
  76  |     })
  77  |     await page.waitForSelector('[data-testid="settings-cv-filecard"]', { timeout: 20_000 })
  78  |     await expect(page.locator('[data-testid="settings-cv-filecard"]')).toContainText('cv-magic.pdf')
> 79  |     await expect(page.locator('[data-testid="settings-cv-success"]')).toContainText('tecken hittades')
      |                                                                       ^ Error: expect(locator).toContainText(expected) failed
  80  |   })
  81  | 
  82  |   test('valid DOCX: 200 OK, file card renders, success line shows tecken hittades', async ({ page }) => {
  83  |     await page.goto('/settings')
  84  |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
  85  |     const bytes = await makeDocx()
  86  |     await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
  87  |       name: 'cv-magic.docx',
  88  |       mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  89  |       buffer: Buffer.from(bytes),
  90  |     })
  91  |     await page.waitForSelector('[data-testid="settings-cv-filecard"]', { timeout: 20_000 })
  92  |     await expect(page.locator('[data-testid="settings-cv-filecard"]')).toContainText('cv-magic.docx')
  93  |     // DOCX is parsed via mammoth, so the success line should still
  94  |     // appear with the extracted-text character count.
  95  |     await expect(page.locator('[data-testid="settings-cv-success"]')).toContainText('tecken hittades')
  96  |   })
  97  | 
  98  |   test('invalid magic bytes (text file with .pdf extension): 400 with SPECIFIC Swedish error', async ({ page }) => {
  99  |     await page.goto('/settings')
  100 |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
  101 |     // The first 5 bytes are "Hello" (0x48 0x65 0x6C 0x6C 0x6F) — NOT
  102 |     // the PDF signature (0x25 0x50 0x44 0x46 0x2D = "%PDF-"). The
  103 |     // server's magic-byte guard rejects this with a SPECIFIC message
  104 |     // instead of letting the parser throw a generic "corrupt file".
  105 |     await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
  106 |       name: 'inte-en-pdf.pdf',
  107 |       mimeType: 'application/pdf',
  108 |       buffer: Buffer.from('Hello, this is not a PDF — the magic bytes are wrong on purpose.'),
  109 |     })
  110 |     // The error alert renders inline (not as a Sonner toast) so
  111 |     // the user sees WHY the file was rejected. The exact wording
  112 |     // is part of the contract; we match on the stable phrase
  113 |     // "inte en giltig PDF".
  114 |     await expect(page.locator('[data-testid="settings-cv-error"]')).toBeVisible({ timeout: 10_000 })
  115 |     await expect(page.locator('[data-testid="settings-cv-error"]')).toContainText('inte en giltig PDF')
  116 |     // The dropzone is still visible — no file card should have
  117 |     // appeared.
  118 |     await expect(page.locator('[data-testid="settings-cv-filecard"]')).toHaveCount(0)
  119 |   })
  120 | 
  121 |   test('.doc file renamed to .docx: 400 with the SPECIFIC 2026-07-10 Swedish message', async ({ page }) => {
  122 |     // Issue 5 (2026-07-10) added a SPECIALISED error message for
  123 |     // the most common upload pitfall: a classic .doc (OLE2
  124 |     // compound document) renamed to .docx by the user. The
  125 |     // server's validateMagicBytes() detects this case and
  126 |     // returns a Swedish sentence naming the exact fix
  127 |     // ("Konvertera till .docx eller PDF i Word/Google Docs").
  128 |     //
  129 |     // The OLE2 compound document signature is
  130 |     //   0xD0 0xCF 0x11 0xE0 0xA1 0xB1 0x1A 0xE1
  131 |     // — emitted by every Word 97-2003 .doc file. We prepend
  132 |     // this to a benign payload so the server's check sees the
  133 |     // real-world byte pattern instead of "Hello" (which would
  134 |     // also fail, but with the GENERIC "inte en giltig DOCX"
  135 |     // message — the wrong contract).
  136 |     const ole2Signature = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
  137 |     const body = Buffer.from('This is a classic Word .doc saved as .docx by mistake.')
  138 |     const fakeDocx = Buffer.concat([ole2Signature, body])
  139 |     // NOTE: the MIME is intentionally the OOXML type because
  140 |     // the route's MIME check (`ALLOWED_MIME.has(mime)`) is
  141 |     // INDEPENDENT of the magic-bytes check. The bug we're
  142 |     // testing lives in the file's CONTENT, not its declared
  143 |     // type — a hand-crafted curl POST can lie about either,
  144 |     // and the route defends against both attacks separately.
  145 |     // A real-world user uploads with a matching MIME; the
  146 |     // attack surface is the file's first bytes, which the
  147 |     // OLE2 signature simulates.
  148 | 
  149 |     await page.goto('/settings')
  150 |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
  151 |     await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
  152 |       name: 'gamal-doc.docx', // lying extension to trigger the specific branch
  153 |       mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  154 |       buffer: fakeDocx,
  155 |     })
  156 | 
  157 |     // The 2026-07-10 specialised error message must be visible.
  158 |     // Match on the stable phrase "äldre .doc-fil" (the .doc
  159 |     // mention) and "Konvertera till .docx eller PDF" (the fix
  160 |     // instructions). Both are part of the locked contract;
  161 |     // changing either requires updating the route AND this test.
  162 |     await expect(page.locator('[data-testid="settings-cv-error"]')).toBeVisible({ timeout: 10_000 })
  163 |     await expect(page.locator('[data-testid="settings-cv-error"]')).toContainText('äldre .doc-fil')
  164 |     await expect(page.locator('[data-testid="settings-cv-error"]')).toContainText('Konvertera till .docx eller PDF')
  165 |     // The dropzone is still visible — no file card should have
  166 |     // appeared.
  167 |     await expect(page.locator('[data-testid="settings-cv-filecard"]')).toHaveCount(0)
  168 |   })
  169 | 
  170 |   test('image-only PDF: 200 OK with empty cvText + needsManualFallback, empty-hint banner renders', async ({ page }) => {
  171 |     await page.goto('/settings')
  172 |     await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
  173 |     // Empty page PDF — no drawText call means pdf-parse returns
  174 |     // an empty string, and the image-only detector (added 2026-07-10)
  175 |     // sees no text operators but no image operators either, so it
  176 |     // falls through to the "empty text" success path.
  177 |     const bytes = await (async () => {
  178 |       const d = await PDFDocument.create()
  179 |       d.addPage([300, 200])
```