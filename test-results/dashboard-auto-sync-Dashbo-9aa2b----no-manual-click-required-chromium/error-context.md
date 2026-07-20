# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard-auto-sync.spec.js >> Dashboard: auto-sync fires on mount (BUG A fix) >> JOBBPILOTEN_AUTH_SYNC fires automatically when dashboard mounts with extension detected -- no manual click required
- Location: tests\e2e\dashboard-auto-sync.spec.js:46:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-testid="extension-connect-button"]')
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for locator('[data-testid="extension-connect-button"]')

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
  - link "JobbPiloten Professional":
    - /url: /
  - link "Öppna inställningar":
    - /url: /settings
  - img "Profilbild"
  - text: Hej Demo!
- status: "Nästa uppdatering: om 17 h 10 min AI letar nya matchande jobb varje morgon."
- status:
  - text: Installera JobbPiloten Auto-Fill
  - paragraph: Fyll i jobbansökningar med ett klick — förnamn, e-post, personligt brev, LinkedIn och mer direkt från din JobbPiloten-profil. Ingen inmatning, inga misstag, och inget lämnar din webbläsare utan din knapp.
  - link "Installera (steg-för-steg)":
    - /url: /extension-install
  - text: v0.2 • < 25 KB • varken spårar eller sparar formulärdata
- text: Din AI-assistent
- heading "Redo för nästa ansökan" [level=1]
- paragraph: Klicka nedan för att låta AI:n förbereda ett personligt brev — klart att skicka på 10 sekunder.
- text: 1 fält kvar för AF
- button "Kör AI-assistenten nu"
- text: Automatisk AI-assistent (Cron) Körs varje dag kl. 09:00 CET — letar fram matchande jobb och förbereder ansökningar för aktiva prenumeranter
- button "Kör Cron Nu (test)"
- text: Manuell trigger Senaste cron-loggar 2026-07-17 0 oförändrat Sparade jobb denna period 0 oförändrat Ansökningar juli 12 Totalt antal 0 oförändrat Bekräftade av AF denna period Push-notiser Få notiser när AI hittar ett matchande jobb Inaktiva
- button "Aktivera push-notiser"
- text: Aktivitetsrapport — juli 2026 Färdig att skicka till Arbetsförmedlingen 0 ansökningar denna period Du ligger efter takten
- button "Ladda ner PDF"
- 'progressbar "AF compliance: 0 av 14 ansökningar"'
- paragraph:
  - text: 0 av 14 ansökningar — pace kräver 9 vid dag 20. Skicka fler för att hinna ikapp. Detta är AF:s
  - strong: standardmål på 14 ansökningar/månad
  - text: — du ansvarar själv för att din individuella handlingsplan uppfylls. Kontrollera alltid mot AF:s aktuella krav.
- text: Lediga jobb för dig Matchade mot din profil från Arbetsförmedlingen — AI förbereder ansökan, du skickar
- status: Filtrerar på Stockholm
- text: Dagens jobb 82% match Frontend Developer Hotmat.se Hotmat.se Sverige AB Upplands Väsby, Stockholms län, Sverige Matchar din ort Arbetsförmedlingen
- button "Förbered"
- text: Topp
- button "Spara till JobbPiloten"
- text: 82% match Frontend Developer – Planning Aira Group AB Stockholm, Stockholms län, Sverige Matchar din ort Arbetsförmedlingen
- button "Förbered"
- button "Spara till JobbPiloten"
- text: 82% match Frontend Developer till Synsam Group Synsam Group Sweden AB Stockholm, Stockholms län, Sverige Matchar din ort Arbetsförmedlingen
- button "Förbered"
- button "Spara till JobbPiloten"
- text: Fler matchningar Frontend Fullstack Developer Innosights Consulting Service AB · Solna, Stockholms län, Sverige · ✓ matchar din ort
- button "Gå till ansökan"
- paragraph: Visar 4 jobb just nu — alla hämtade
- text: "Letar du bredare? Vi matchar mot Arbetsförmedlingen ovan. För fler jobb, sök även på andra plattformar:"
- link "Sök på Blocket jobb.blocket.se":
  - /url: https://jobb.blocket.se/lediga-jobb/q-frontend-developer/l-stockholm/
- link "Sök på Jobbsafari jobbsafari.se":
  - /url: https://jobbsafari.se/jobb?q=Frontend+Developer&l=Stockholm
- paragraph: Båda sidor öppnas i din webbläsare. JobbPiloten skrapar eller lagrar inte Blocket / Jobbsafari-listan — vi använder bara AF:s öppna API.
- text: Ansökningar Ansökningshistorik
- tablist "Filtrera ansökningar":
  - tab "Alla· 12" [selected]
  - tab "Ej ansökta· 12"
  - tab "Ansökta· 0"
  - tab "Sparade· 0"
  - tab "E-post· 0"
- text: Product Designer Klarna 2026-07-19
- button "Spara ansökan"
- text: Stockholm LinkedIn Förberedd
- button "Markera som ansökt"
- button "Visa brev"
- text: QA Engineer Tink 2026-07-18
- button "Spara ansökan"
- text: Stockholm Blocket Jobb Förberedd
- button "Markera som ansökt"
- button "Visa brev"
- text: Project Manager Northvolt 2026-07-17
- button "Spara ansökan"
- text: Skellefteå Arbetsförmedlingen Förberedd
- button "Markera som ansökt"
- button "Visa brev"
- text: Backend Engineer Spotify 2026-07-16
- button "Spara ansökan"
- text: Stockholm Arbetsförmedlingen Förberedd
- button "Markera som ansökt"
- button "Visa brev"
- text: Frontend-utvecklare Volvo Cars 2026-07-15
- button "Spara ansökan"
- text: Göteborg LinkedIn Förberedd
- button "Markera som ansökt"
- button "Visa brev"
- text: Customer Success Manager Bolt 2026-07-14
- button "Spara ansökan"
- text: Göteborg Metrojobb Förberedd
- button "Markera som ansökt"
- button "Visa brev"
- text: Data Analyst IKEA 2026-07-13
- button "Spara ansökan"
- text: Malmö Indeed.se Förberedd
- button "Markera som ansökt"
- button "Visa brev"
- text: PR & Communications Mynewsdesk 2026-07-12
- button "Spara ansökan"
- text: Stockholm Blocket Jobb Förberedd
- button "Markera som ansökt"
- button "Visa brev"
- text: UX Researcher Epidemic Sound 2026-07-11
- button "Spara ansökan"
- text: Stockholm LinkedIn Förberedd
- button "Markera som ansökt"
- button "Visa brev"
- text: Android-utvecklare Truecaller 2026-07-10
- button "Spara ansökan"
- text: Stockholm LinkedIn Förberedd
- button "Markera som ansökt"
- button "Visa brev"
- text: Fullstack-utvecklare H&M Group 2026-07-09
- button "Spara ansökan"
- text: Stockholm Monster.se Förberedd
- button "Markera som ansökt"
- button "Visa brev"
- text: DevOps Engineer Ericsson 2026-07-08
- button "Spara ansökan"
- text: Kista Arbetsförmedlingen Förberedd
- button "Markera som ansökt"
- button "Visa brev"
- contentinfo:
  - text: © 2026 JobbPiloten
  - navigation "Juridiskt":
    - link "Integritetspolicy":
      - /url: /privacy
    - link "Användarvillkor":
      - /url: /terms
    - link "Kontakt":
      - /url: mailto:hej@jobbpiloten.se
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
  1   | // tests/e2e/dashboard-auto-sync.spec.js
  2   | //
  3   | // E2E spec for the dashboard's auto-sync useEffect added in
  4   | // Round-46 / 2026-07-20 (BUG A from the Monday test pass).
  5   | //
  6   | // CONTRACT (the fix that landed this useEffect):
  7   | //   When the dashboard mounts with ALL THREE conditions truthy:
  8   | //     - user (Clerk-or-demo) is loaded
  9   | //     - profile is fetched (not redirected to /onboarding)
  10  | //     - extension is detected as installed (`data-jobbpiloten-ext="1"`)
  11  | //   the dashboard must AUTO-FIRE connectExtension(), which posts
  12  | //   JOBBPILOTEN_AUTH_SYNC via window.postMessage so the content
  13  | //   script hydrates chrome.storage.local end-to-end. The user
  14  | //   should NOT have to manually click "Anslut din profil" on every
  15  | //   device after every browser restart — that was the symptom that
  16  | //   surfaced the bug.
  17  | //
  18  | // What this catches:
  19  | //   - The autoSyncAttemptedRef guard regressed (StrictMode double-
  20  | //     fire would still produce the message but waste a
  21  | //     /api/extension/token round-trip).
  22  | //   - The deps array `[user, profile, extensionInstalled]` lost a
  23  | //     dependency (e.g. someone refactored to `[user, profile]`
  24  | //     and the auto-sync never re-fires after the extension poll
  25  | //     flips `extensionInstalled` true).
  26  | //   - The auto-sync useEffect was moved INTO `load()` instead of
  27  | //     its own useEffect (race with content-script mount).
  28  | //   - The dashboard's connectExtension function regressed (the
  29  | //     old `Profil hittades inte` round-46 bug).
  30  | //
  31  | // What this does NOT cover:
  32  | //   - The popup's Anslut click (covered by
  33  | //     popup-jp-connect-bug-b.spec.js logic + tests/e2e/
  34  | //     env-aware-dashboard-url.spec.js for the manual-click path).
  35  | //   - The actual chrome.storage write (requires a real Chrome
  36  | //     install — covered manually in TESTING.md).
  37  | //
  38  | // Companion test: tests/e2e/env-aware-dashboard-url.spec.js covers
  39  | // the MANUAL click path. Together they lock both the auto-fire
  40  | // contract AND the manual fallback contract so a future refactor
  41  | // can't silently regress either path.
  42  | 
  43  | import { test, expect } from './_fixtures/auth'
  44  | 
  45  | test.describe('Dashboard: auto-sync fires on mount (BUG A fix)', () => {
  46  |   test('JOBBPILOTEN_AUTH_SYNC fires automatically when dashboard mounts with extension detected -- no manual click required', async ({ page }) => {
  47  |     // 1. Capture EVERY postMessage the page fires (same wrapper as
  48  |     //    env-aware-dashboard-url.spec.js). addInitScript runs BEFORE
  49  |     //    any page script, so the wrapper is in place by the time
  50  |     //    React's auto-sync useEffect is mounted.
  51  |     await page.addInitScript(() => {
  52  |       /** @type {Array<{type: string|null, payload: any, targetOrigin: string}>} */
  53  |       window.__capturedAutoSyncMessages = []
  54  |       const originalPostMessage = window.postMessage.bind(window)
  55  |       window.__postMessageWrapperInstalledForAutoSync = true
  56  |       window.postMessage = function patchedPostMessage(...args) {
  57  |         try {
  58  |           const message = args[0]
  59  |           window.__capturedAutoSyncMessages.push({
  60  |             type: (message && typeof message === 'object') ? message.type : null,
  61  |             payload: (message && typeof message === 'object') ? message.payload : null,
  62  |             targetOrigin: args[1],
  63  |           })
  64  |         } catch (_) {
  65  |           // Capture is best-effort; a false capture must NOT crash
  66  |           // the page (same fallback as env-aware-dashboard-url.spec.js).
  67  |         }
  68  |         return originalPostMessage(...args)
  69  |       }
  70  |     })
  71  | 
  72  |     // 2. Navigate to /dashboard. The auto-sync useEffect is wired
  73  |     //    at the top of the component and watches
  74  |     //    `[user, profile, extensionInstalled]`. Both `user` and
  75  |     //    `profile` will become truthy once the dashboard's `load()`
  76  |     //    fetch chain resolves. `extensionInstalled` is flipped via
  77  |     //    a separate polling effect that reads the
  78  |     //    `data-jobbpiloten-ext` attribute every 1s + on window focus.
  79  |     await page.goto('/dashboard')
  80  | 
  81  |     // 3. Wait for the dashboard's profile-fetch to settle BEFORE
  82  |     //    flipping the extension flag. The auto-sync guard requires
  83  |     //    ALL THREE deps truthy, so flipping the flag before the
  84  |     //    profile arrives would NOT trigger the auto-sync (the
  85  |     //    effect re-runs once profile becomes truthy though, so a
  86  |     //    late flip still works, but a deterministic test waits
  87  |     //    for connect button visibility first).
  88  |     const connectButton = page.locator('[data-testid="extension-connect-button"]')
> 89  |     await expect(connectButton).toBeVisible({ timeout: 30_000 })
      |                                 ^ Error: expect(locator).toBeVisible() failed
  90  | 
  91  |     // 4. CRITICAL: simulate extension detection WITHOUT clicking
  92  |     //    the button. Dispatching the focus event short-circuits
  93  |     //    the 1-second poll, so the test doesn't have a blind sleep.
  94  |     await page.evaluate(() => {
  95  |       document.documentElement.setAttribute('data-jobbpiloten-ext', '1')
  96  |       window.dispatchEvent(new Event('focus'))
  97  |     })
  98  | 
  99  |     // 5. Poll the captured list for at least ONE
  100 |     //    JOBBPILOTEN_AUTH_SYNC message. The auto-sync useEffect
  101 |     //    should fire connectExtension() which posts the message
  102 |     //    without ANY user interaction.
  103 |     //
  104 |     //    Why poll: the auto-sync fires inside a React effect tick
  105 |     //    that depends on the polling-effect updating
  106 |     //    `extensionInstalled`, which depends on the focus event
  107 |     //    landing in the polling queue. A constant 5s sleep would
  108 |     //    be either flaky (too short on cold-start) or slow.
  109 |     const expectedOrigin = new URL(page.url()).origin
  110 |     await expect
  111 |       .poll(
  112 |         async () => {
  113 |           const msgs = await page.evaluate(() => window.__capturedAutoSyncMessages || [])
  114 |           return {
  115 |             total: msgs.length,
  116 |             auth: msgs.filter((m) => m.type === 'JOBBPILOTEN_AUTH_SYNC').length,
  117 |             setUrl: msgs.filter((m) => m.type === 'JOBBPILOTEN_SET_DASHBOARD_URL').length,
  118 |           }
  119 |         },
  120 |         {
  121 |           // 30s: covers the first-compile of /api/extension/token
  122 |           // + the dashboard's polling interval + Mongo round-trip.
  123 |           timeout: 30_000,
  124 |           intervals: [100, 250, 500, 1000],
  125 |           message:
  126 |             'dashboard auto-sync should fire JOBBPILOTEN_AUTH_SYNC on mount without manual click (BUG A fix verification)',
  127 |         },
  128 |       )
  129 |       .toEqual({
  130 |         total: expect.any(Number),
  131 |         auth: expect.toBeGreaterThanOrEqual(1),
  132 |         setUrl: expect.any(Number),
  133 |       })
  134 | 
  135 | 
  136 |     // 6. Snapshot the captured messages and assert the AUTH_SYNC
  137 |     //    shape: it should carry token + profile + baseUrl +
  138 |     //    allowedOrigins so the popup's fetch() can resolve
  139 |     //    without Tier-3 build-config (same contract as the
  140 |     //    manual-click path in env-aware-dashboard-url.spec.js).
  141 |     const messages = await page.evaluate(() => window.__capturedAutoSyncMessages || [])
  142 |     const authMessages = messages.filter((m) => m.type === 'JOBBPILOTEN_AUTH_SYNC')
  143 |     expect(authMessages.length).toBeGreaterThanOrEqual(1)
  144 |     const authMsg = authMessages[0]
  145 |     expect(authMsg.payload).toBeTruthy()
  146 |     expect(typeof authMsg.payload.token).toBe('string')
  147 |     expect(authMsg.payload.token.length).toBeGreaterThan(0)
  148 |     expect(authMsg.payload.profile).toBeTruthy()
  149 |     expect(typeof authMsg.payload.baseUrl).toBe('string')
  150 |     expect(authMsg.payload.baseUrl).toBe(expectedOrigin)
  151 |     // targetOrigin must be the same as the dashboard origin so
  152 |     // the content-script listener (which accepts only same-
  153 |     // origin posts) doesn't silently swallow the message.
  154 |     expect(authMsg.targetOrigin).toBe(expectedOrigin)
  155 | 
  156 |     // 7. Guard assertion: the auto-sync useEffect's
  157 |     //    `autoSyncAttemptedRef` should produce AT LEAST 1 fire
  158 |     //    (the mount itself fires it) AND AT MOST 2 fires (1 for
  159 |     //    the real mount + 1 for the React 18 StrictMode dev
  160 |     //    double-mount — production runs without strict mode
  161 |     //    would get exactly 1). A regression that drops the
  162 |     //    auto-sync useEffect (silent zero-fire) is caught by the
  163 |     //    `>= 1` bound; a regression that drops the ref guard
  164 |     //    (unbounded re-fires across poll ticks) is caught by the
  165 |     //    `<= 2` bound.
  166 |     expect(authMessages.length).toBeGreaterThanOrEqual(1)
  167 |     expect(authMessages.length).toBeLessThanOrEqual(2)
  168 |   })
  169 | })
  170 | 
```