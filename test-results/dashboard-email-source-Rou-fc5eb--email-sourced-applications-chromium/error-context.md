# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard-email-source.spec.js >> Round-38 / Part 4 — email-source application surface >> filter chip + Mail tag render for email-sourced applications
- Location: tests\e2e\dashboard-email-source.spec.js:62:7

# Error details

```
Error: Mail tag renders for source: email rows

expect(locator).toBeVisible() failed

Locator: getByTestId('application-source-email')
Expected: visible
Error: strict mode violation: getByTestId('application-source-email') resolved to 2 elements:
    1) <span data-testid="application-source-email" class="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md border bg-amber-50 text-amber-800 border-amber-200">…</span> aka getByTestId('application-source-email').first()
    2) <span data-testid="application-source-email" class="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md border bg-amber-50 text-amber-800 border-amber-200">…</span> aka getByTestId('application-source-email').nth(1)

Call log:
  - Mail tag renders for source: email rows with timeout 5000ms
  - waiting for getByTestId('application-source-email')

```

# Page snapshot

```yaml
- generic [ref=e1]:
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
  - generic [ref=e19] [cursor=pointer]:
    - button "Open Next.js Dev Tools" [ref=e20]:
      - img [ref=e21]
    - generic [ref=e24]:
      - button "Open issues overlay" [ref=e25]:
        - generic [ref=e26]:
          - generic [ref=e27]: "0"
          - generic [ref=e28]: "1"
        - generic [ref=e29]: Issue
      - button "Collapse issues badge" [ref=e30]:
        - img [ref=e31]
  - alert [ref=e33]
  - generic [ref=e34]:
    - navigation [ref=e35]:
      - generic [ref=e36]:
        - link "JobbPiloten Professional" [ref=e37] [cursor=pointer]:
          - /url: /
          - img [ref=e39]
          - generic [ref=e41]: JobbPiloten
          - generic [ref=e42]: Professional
        - generic [ref=e43]:
          - link "Öppna inställningar" [ref=e44] [cursor=pointer]:
            - /url: /settings
            - img [ref=e45]
          - generic [ref=e48]:
            - img "Profilbild" [ref=e49]:
              - img [ref=e50]
            - generic [ref=e52]: Hej Demo!
    - generic [ref=e53]:
      - status [ref=e54]:
        - img [ref=e55]
        - generic [ref=e58]: "Nästa uppdatering:"
        - generic [ref=e59]: om 17 h 10 min
        - generic [ref=e60]: AI letar nya matchande jobb varje morgon.
      - status [ref=e61]:
        - generic [ref=e63]: ✈
        - generic [ref=e64]:
          - generic [ref=e65]: Installera JobbPiloten Auto-Fill
          - paragraph [ref=e66]: Fyll i jobbansökningar med ett klick — förnamn, e-post, personligt brev, LinkedIn och mer direkt från din JobbPiloten-profil. Ingen inmatning, inga misstag, och inget lämnar din webbläsare utan din knapp.
          - generic [ref=e67]:
            - link "Installera (steg-för-steg)" [ref=e68] [cursor=pointer]:
              - /url: /extension-install
            - generic [ref=e69]: v0.2 • < 25 KB • varken spårar eller sparar formulärdata
      - generic [ref=e73]:
        - generic [ref=e74]:
          - generic [ref=e75]: Din AI-assistent
          - heading "Redo för nästa ansökan" [level=1] [ref=e76]
          - paragraph [ref=e77]: Klicka nedan för att låta AI:n förbereda ett personligt brev — klart att skicka på 10 sekunder.
          - generic "Saknar 1 fält för AF — fyll i dem i /settings." [ref=e78]: 1 fält kvar för AF
        - button "Kör AI-assistenten nu" [ref=e79] [cursor=pointer]:
          - img
          - text: Kör AI-assistenten nu
      - generic [ref=e80]:
        - generic [ref=e81]:
          - generic [ref=e82]:
            - img [ref=e83]
            - text: Automatisk AI-assistent (Cron)
          - generic [ref=e85]: Körs varje dag kl. 09:00 CET — letar fram matchande jobb och förbereder ansökningar för aktiva prenumeranter
        - generic [ref=e86]:
          - generic [ref=e87]:
            - button "Kör Cron Nu (test)" [ref=e88] [cursor=pointer]:
              - img
              - text: Kör Cron Nu (test)
            - generic [ref=e89]: Manuell trigger
          - generic [ref=e90]:
            - generic [ref=e91]: Senaste cron-loggar
            - generic [ref=e95]: 2026-07-17
      - generic [ref=e96]:
        - generic [ref=e98]:
          - generic [ref=e99]:
            - generic [ref=e100]:
              - generic [ref=e101]: "0"
              - generic "oförändrat" [ref=e102]:
                - img [ref=e103]
                - text: oförändrat
            - generic [ref=e104]: Sparade jobb denna period
          - img [ref=e106]
        - generic [ref=e109]:
          - generic [ref=e110]:
            - generic [ref=e111]:
              - generic [ref=e112]: "0"
              - generic "oförändrat" [ref=e113]:
                - img [ref=e114]
                - text: oförändrat
            - generic [ref=e115]: Ansökningar juli
          - img [ref=e117]
        - generic [ref=e121]:
          - generic [ref=e122]:
            - generic [ref=e124]: "14"
            - generic [ref=e125]: Totalt antal
          - img [ref=e127]
        - generic [ref=e131]:
          - generic [ref=e132]:
            - generic [ref=e133]:
              - generic [ref=e134]: "0"
              - generic "oförändrat" [ref=e135]:
                - img [ref=e136]
                - text: oförändrat
            - generic [ref=e137]: Bekräftade av AF denna period
          - img [ref=e139]
      - generic [ref=e141]:
        - generic [ref=e142]:
          - generic [ref=e143]:
            - img [ref=e144]
            - text: Push-notiser
          - generic [ref=e147]: Få notiser när AI hittar ett matchande jobb
        - generic [ref=e149]:
          - generic [ref=e152]: Inaktiva
          - button "Aktivera push-notiser" [ref=e153] [cursor=pointer]:
            - img
            - text: Aktivera push-notiser
      - generic [ref=e154]:
        - generic [ref=e155]:
          - generic [ref=e156]: Aktivitetsrapport — juli 2026
          - generic [ref=e157]: Färdig att skicka till Arbetsförmedlingen
        - generic [ref=e159]:
          - generic [ref=e160]:
            - generic [ref=e161]:
              - img [ref=e162]
              - generic [ref=e165]: 0 ansökningar denna period
              - generic [ref=e166]: Du ligger efter takten
            - button "Ladda ner PDF" [ref=e167] [cursor=pointer]:
              - img
              - text: Ladda ner PDF
          - 'progressbar "AF compliance: 0 av 14 ansökningar" [ref=e168]'
          - paragraph [ref=e170]:
            - text: 0 av 14 ansökningar — pace kräver 9 vid dag 20. Skicka fler för att hinna ikapp. Detta är AF:s
            - strong [ref=e171]: standardmål på 14 ansökningar/månad
            - text: — du ansvarar själv för att din individuella handlingsplan uppfylls. Kontrollera alltid mot AF:s aktuella krav.
      - generic [ref=e172]:
        - generic [ref=e173]:
          - generic [ref=e174]:
            - img [ref=e175]
            - text: Lediga jobb för dig
          - generic [ref=e178]: Matchade mot din profil från Arbetsförmedlingen — AI förbereder ansökan, du skickar
        - generic [ref=e180]:
          - status [ref=e181]: Filtrerar på Stockholm
          - generic [ref=e183]:
            - generic [ref=e184]:
              - img [ref=e185]
              - text: Dagens jobb
            - generic [ref=e187]:
              - generic [ref=e188]:
                - 'generic "Matchning: roll 100%, ort 100%, erfarenhet 47%, anställningstyp 100%" [ref=e189]': 82% match
                - generic [ref=e191]:
                  - generic [ref=e192]: H
                  - generic [ref=e193]:
                    - generic [ref=e194]: Frontend Developer Hotmat.se
                    - generic [ref=e195]: Hotmat.se Sverige AB
                - generic [ref=e196]:
                  - generic [ref=e197]:
                    - img [ref=e198]
                    - text: Upplands Väsby, Stockholms län, Sverige
                  - generic "Matchning baserad på din ort-preferens" [ref=e201]:
                    - generic [ref=e202]: ✓
                    - text: Matchar din ort
                  - generic [ref=e203]:
                    - img [ref=e204]
                    - text: Arbetsförmedlingen
                - generic [ref=e208]:
                  - button "Förbered" [ref=e209] [cursor=pointer]:
                    - img
                    - text: Förbered
                  - img [ref=e210]
                - generic [ref=e213]: Topp
                - button "Spara till JobbPiloten" [ref=e214] [cursor=pointer]:
                  - img
                  - text: Spara till JobbPiloten
              - generic [ref=e215]:
                - 'generic "Matchning: roll 100%, ort 100%, erfarenhet 47%, anställningstyp 100%" [ref=e216]': 82% match
                - generic [ref=e218]:
                  - generic [ref=e219]: A
                  - generic [ref=e220]:
                    - generic [ref=e221]: Frontend Developer – Planning
                    - generic [ref=e222]: Aira Group AB
                - generic [ref=e223]:
                  - generic [ref=e224]:
                    - img [ref=e225]
                    - text: Stockholm, Stockholms län, Sverige
                  - generic "Matchning baserad på din ort-preferens" [ref=e228]:
                    - generic [ref=e229]: ✓
                    - text: Matchar din ort
                  - generic [ref=e230]:
                    - img [ref=e231]
                    - text: Arbetsförmedlingen
                - generic [ref=e235]:
                  - button "Förbered" [ref=e236] [cursor=pointer]:
                    - img
                    - text: Förbered
                  - img [ref=e237]
                - button "Spara till JobbPiloten" [ref=e240] [cursor=pointer]:
                  - img
                  - text: Spara till JobbPiloten
              - generic [ref=e241]:
                - 'generic "Matchning: roll 100%, ort 100%, erfarenhet 47%, anställningstyp 100%" [ref=e242]': 82% match
                - generic [ref=e244]:
                  - generic [ref=e245]: S
                  - generic [ref=e246]:
                    - generic [ref=e247]: Frontend Developer till Synsam Group
                    - generic [ref=e248]: Synsam Group Sweden AB
                - generic [ref=e249]:
                  - generic [ref=e250]:
                    - img [ref=e251]
                    - text: Stockholm, Stockholms län, Sverige
                  - generic "Matchning baserad på din ort-preferens" [ref=e254]:
                    - generic [ref=e255]: ✓
                    - text: Matchar din ort
                  - generic [ref=e256]:
                    - img [ref=e257]
                    - text: Arbetsförmedlingen
                - generic [ref=e261]:
                  - button "Förbered" [ref=e262] [cursor=pointer]:
                    - img
                    - text: Förbered
                  - img [ref=e263]
                - button "Spara till JobbPiloten" [ref=e266] [cursor=pointer]:
                  - img
                  - text: Spara till JobbPiloten
          - generic [ref=e267]:
            - generic [ref=e268]: Fler matchningar
            - generic [ref=e270]:
              - generic [ref=e271]:
                - generic [ref=e272]: I
                - generic [ref=e273]:
                  - generic [ref=e274]: Frontend Fullstack Developer
                  - generic [ref=e275]:
                    - generic [ref=e276]: Innosights Consulting Service AB
                    - generic [ref=e277]: ·
                    - generic [ref=e278]:
                      - img [ref=e279]
                      - text: Solna, Stockholms län, Sverige
                    - generic [ref=e282]: · ✓ matchar din ort
              - button "Gå till ansökan" [ref=e283] [cursor=pointer]:
                - img
                - text: Gå till ansökan
          - paragraph [ref=e285]: Visar 4 jobb just nu — alla hämtade
      - generic [ref=e286]:
        - generic [ref=e287]:
          - generic [ref=e288]:
            - img [ref=e289]
            - text: Letar du bredare?
          - generic [ref=e292]: "Vi matchar mot Arbetsförmedlingen ovan. För fler jobb, sök även på andra plattformar:"
        - generic [ref=e293]:
          - generic [ref=e294]:
            - link "Sök på Blocket jobb.blocket.se" [ref=e295] [cursor=pointer]:
              - /url: https://jobb.blocket.se/lediga-jobb/q-frontend-developer/l-stockholm/
              - img [ref=e296]
              - text: Sök på Blocket
              - generic [ref=e300]: jobb.blocket.se
            - link "Sök på Jobbsafari jobbsafari.se" [ref=e301] [cursor=pointer]:
              - /url: https://jobbsafari.se/jobb?q=Frontend+Developer&l=Stockholm
              - img [ref=e302]
              - text: Sök på Jobbsafari
              - generic [ref=e306]: jobbsafari.se
          - paragraph [ref=e307]: Båda sidor öppnas i din webbläsare. JobbPiloten skrapar eller lagrar inte Blocket / Jobbsafari-listan — vi använder bara AF:s öppna API.
      - generic [ref=e308]:
        - generic [ref=e310]:
          - generic [ref=e311]:
            - generic [ref=e312]: Ansökningar
            - generic [ref=e313]: Ansökningshistorik
          - tablist "Filtrera ansökningar" [ref=e314]:
            - tab "Alla· 14" [ref=e315] [cursor=pointer]:
              - text: Alla
              - generic [ref=e316]: · 14
            - tab "Ej ansökta· 14" [ref=e317] [cursor=pointer]:
              - text: Ej ansökta
              - generic [ref=e318]: · 14
            - tab "Ansökta· 0" [ref=e319] [cursor=pointer]:
              - text: Ansökta
              - generic [ref=e320]: · 0
            - tab "Sparade· 0" [ref=e321] [cursor=pointer]:
              - text: Sparade
              - generic [ref=e322]: · 0
            - tab "E-post· 2" [active] [selected] [ref=e323] [cursor=pointer]:
              - text: E-post
              - generic [ref=e324]: · 2
        - generic [ref=e326]:
          - generic [ref=e327]:
            - generic [ref=e328]:
              - generic [ref=e329]: "?"
              - generic [ref=e331]: NaN-NaN-NaN
              - button "Spara ansökan" [ref=e332] [cursor=pointer]:
                - img [ref=e333]
            - generic [ref=e335]:
              - generic [ref=e336]:
                - img [ref=e337]
                - text: Mejl
              - generic [ref=e340]: Förberedd
            - button "Markera som ansökt" [ref=e343] [cursor=pointer]:
              - img
              - text: Markera som ansökt
          - generic [ref=e344]:
            - generic [ref=e345]:
              - generic [ref=e346]: "?"
              - generic [ref=e348]: NaN-NaN-NaN
              - button "Spara ansökan" [ref=e349] [cursor=pointer]:
                - img [ref=e350]
            - generic [ref=e352]:
              - generic [ref=e353]:
                - img [ref=e354]
                - text: Mejl
              - generic [ref=e357]: Förberedd
            - button "Markera som ansökt" [ref=e360] [cursor=pointer]:
              - img
              - text: Markera som ansökt
    - contentinfo [ref=e361]:
      - generic [ref=e362]:
        - generic [ref=e363]: © 2026 JobbPiloten
        - navigation "Juridiskt" [ref=e364]:
          - link "Integritetspolicy" [ref=e365] [cursor=pointer]:
            - /url: /privacy
          - link "Användarvillkor" [ref=e366] [cursor=pointer]:
            - /url: /terms
          - link "Kontakt" [ref=e367] [cursor=pointer]:
            - /url: mailto:hej@jobbpiloten.se
  - region "Vi använder cookies" [ref=e368]:
    - generic [ref=e370]:
      - img [ref=e372]
      - generic [ref=e374]:
        - generic [ref=e375]: Vi använder cookies
        - paragraph [ref=e376]:
          - text: Vi använder cookies för att du ska kunna logga in och för att förbättra din upplevelse. Vi delar inte din data med tredje part.
          - link "Läs mer i vår integritetspolicy" [ref=e377] [cursor=pointer]:
            - /url: /privacy
          - text: .
        - generic [ref=e378]:
          - button "Endast nödvändiga" [ref=e379] [cursor=pointer]
          - button "Acceptera alla" [ref=e380] [cursor=pointer]
          - button "Stäng" [ref=e381] [cursor=pointer]:
            - img [ref=e382]
        - paragraph [ref=e385]: Endast nödvändiga = sessionscookie för inloggning. Acceptera alla = samma + anonymiserad statistik i framtiden.
```

# Test source

```ts
  1   | // tests/e2e/dashboard-email-source.spec.js
  2   | //
  3   | // Round-38 / Part 4 — Email-source application surface.
  4   | // Locks the contract for the two user-visible pieces of the email-
  5   | // application feature added in Round-34 + polished in Round-38:
  6   | //   1. The "E-post" filter chip in the dashboard applications table
  7   | //      (FILTERS array entry `key: 'email'`, `match: (a) => a.source === 'email'`).
  8   | //   2. The amber Mail tag rendered on each row whose `source` is 'email'
  9   | //      (data-testid="application-source-email").
  10  | //
  11  | // The spec seeds an email-sourced application via the API helper
  12  | // (apiFetch → /api/applications/email), then asserts both surfaces
  13  | // from the dashboard. A Round-37-style per-test clerkId is used
  14  | // so a parallel e2e run never collides on a shared row.
  15  | //
  16  | // What we lock
  17  | // ------------
  18  | //   1. The filter chip is visible in the tab strip (data-testid="filter-email")
  19  | //   2. Clicking the chip filters the table to email-sourced rows
  20  | //   3. The Mail tag renders on the row (data-testid="application-source-email")
  21  | //   4. The empty-state copy renders when the user has 0 email rows
  22  | //   5. The "all" chip returns the full list
  23  | //
  24  | // The spec is intentionally a single happy-path test per contract
  25  | // rather than a brute-force matrix: the e2e fixtures already
  26  | // exercise the filter empty-state elsewhere (dashboard-filter
  27  | // contract), and the Mail tag rendering is a presentational concern
  28  | // that doesn't merit redundant tests.
  29  | 
  30  | import { test, expect } from './_fixtures/auth'
  31  | 
  32  | async function postEmailApplication(req, emailAddress, subject, bodyText) {
  33  |   // Uses the same /api/applications/email route the popup
  34  |   // compose panel calls. The route requires an authenticated
  35  |   // session, which the auth fixture provides via the
  36  |   // `demoUserId` cookie set on `context` in tests/e2e/_fixtures/auth.js.
  37  |   //
  38  |   // Round-40 fix (carryover from e2e smoke + Round-39): the
  39  |   // previous version imported from `@playwright/test` (not the
  40  |   // auth fixture), so the `request` fixture had no cookies and
  41  |   // POST /api/applications/email returned 401. Importing the
  42  |   // auth fixture sets the per-TEST demoUserId cookie on
  43  |   // `context`, and `context.request` inherits that cookie so the
  44  |   // route's requireAuth() resolves the demo clerkId and the POST
  45  |   // returns 2xx. We also drop the `API_BASE` constant — using
  46  |   // `context.request` honours playwright.config.js's `use.baseURL`
  47  |   // automatically, so a relative `/api/...` path works against
  48  |   // both `localhost:3000` (default) and `PLAYWRIGHT_BASE_URL=...`
  49  |   // (deployed-instance override).
  50  |   return await req.post('/api/applications/email', {
  51  |     data: {
  52  |       emailAddress,
  53  |       subject,
  54  |       bodyText,
  55  |       // jobTitle + companyName optional — left out for the
  56  |       // minimal e2e payload.
  57  |     },
  58  |   })
  59  | }
  60  | 
  61  | test.describe('Round-38 / Part 4 — email-source application surface', () => {
  62  |   test('filter chip + Mail tag render for email-sourced applications', async ({ page, context }) => {
  63  |     // Seed: write one email-prepared application. The route
  64  |     // returns the saved doc (with source: 'email', status:
  65  |     // 'prepared', etc.) so the dashboard's /api/applications
  66  |     // fetch surfaces it.
  67  |     const subject = 'Testansökan — Frontend-utvecklare (Spotify)'
  68  |     const postRes = await postEmailApplication(
  69  |       context.request,
  70  |       'recruiter@spotify.example',
  71  |       subject,
  72  |       'Hej, jag är intresserad av tjänsten. Bifogat CV. /Anna',
  73  |     )
  74  |     expect(postRes.ok(), 'POST /api/applications/email should return 2xx').toBeTruthy()
  75  |     const postJson = await postRes.json()
  76  |     expect(postJson.ok, 'Response should have ok: true').toBe(true)
  77  |     expect(postJson.application.source, 'Persisted app should carry source: email').toBe('email')
  78  |     expect(postJson.application.status, 'Persisted app should carry status: prepared').toBe('prepared')
  79  | 
  80  |     // 1. Open the dashboard — the filter chip + Mail tag are
  81  |     //    present in the same render, so a single page load
  82  |     //    exercises both surfaces.
  83  |     await page.goto('/dashboard')
  84  | 
  85  |     // 2. The filter chip is visible in the tab strip.
  86  |     const emailChip = page.getByTestId('filter-email')
  87  |     await expect(emailChip, 'E-post filter chip is rendered in the tab strip').toBeVisible()
  88  |     await expect(emailChip, 'E-post chip has accessible role=tab').toHaveRole('tab')
  89  | 
  90  |     // 3. Click the chip — the table filters to email-sourced
  91  |     //    rows. The seeded row is the only one (per the
  92  |     //    per-test clerkId isolation), so the table shows 1 row
  93  |     //    and the Mail tag is visible on it.
  94  |     await emailChip.click()
  95  | 
  96  |     // 4. The Mail tag is rendered on the row.
  97  |     const mailTag = page.getByTestId('application-source-email')
> 98  |     await expect(mailTag, 'Mail tag renders for source: email rows').toBeVisible()
      |                                                                      ^ Error: Mail tag renders for source: email rows
  99  |     await expect(mailTag, 'Mail tag shows the Swedish label').toHaveText('Mejl')
  100 | 
  101 |     // 5. Switch back to the "all" chip — the row count returns
  102 |     //    to >= 1 (per-test isolation guarantees no other rows).
  103 |     const allChip = page.getByTestId('filter-all')
  104 |     await allChip.click()
  105 |     // No specific count assertion — other rows from the seed
  106 |     // (AF applications, sample jobs) may or may not be present.
  107 |     // The chip toggle itself is the contract.
  108 |     await expect(allChip, 'Alla chip is active after toggle').toHaveAttribute('aria-selected', 'true')
  109 |   })
  110 | 
  111 |   test('empty state renders when no email-sourced applications exist', async ({ page }) => {
  112 |     // Mount with a fresh demo user. The fixture's per-test
  113 |     // clerkId means no leftover email rows from previous tests
  114 |     // in the same run. The "E-post" chip should still render
  115 |     // (it's part of the FILTERS array regardless of corpus
  116 |     // size), but the empty-state copy kicks in.
  117 |     await page.goto('/dashboard')
  118 |     const emailChip = page.getByTestId('filter-email')
  119 |     await expect(emailChip, 'E-post chip is rendered even with 0 email rows').toBeVisible()
  120 |     await emailChip.click()
  121 |     const empty = page.getByTestId('empty-email')
  122 |     await expect(empty, 'E-post empty state renders when 0 email rows').toBeVisible()
  123 |   })
  124 | })
  125 | 
```