# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mejlutkast-api.spec.js >> Mejlutkast API: /api/email-draft >> returns 400 when recipientEmail is missing (Zod validation)
- Location: tests\e2e\mejlutkast-api.spec.js:118:7

# Error details

```
Error: token mint failed: 200 {"token":"cf5d9f4d40d8495e0fefea7aa4cfb1608925c9e294001c43974ba4baa5250670","expiresAt":"2026-10-18T13:51:26.977Z","profile":{"fullName":"Demo Användare","firstName":"Demo","lastName":"Användare","email":"demo@jobbpiloten.se","phone":"","address":"","city":"","zip":"","linkedin":"","salaryExpectation":35000,"experience":"Medior","workPreference":"hybrid","employmentType":["heltid"],"languages":[],"answers":{"whyThisCompany":"","whyThisRole":"","strengths":"","weaknesses":"","challenge":"","availability":"Omgående"},"latestCoverLetter":"Hej iZettle (PayPal)!\n\nDet var med stor entusiasm jag såg att ni söker en Sales Development Representative i Stockholm.\n\nMed bakgrund som Medior inom Frontend Developer har jag byggt en solid grund i just de områden ni efterfrågar. Rollens fokus stämmer väl med min bakgrund och drivkrafter.\n\nJag skulle uppskatta ett samtal för att berätta mer om hur jag kan bidra hos iZettle (PayPal).\n\nMed vänliga hälsningar,\nDemo Användare","cvSummary":"","hasDriversLicense":false,"isEuCitizen":false,"hasWorkPermit":false,"hasHighSchoolDiploma":false,"hasForkliftLicense":false,"hasSecurityClearance":false,"hasLeadershipExperience":false,"isBilingual":false,"hasTechnicalEducation":false,"hasCustomerExperience":false,"yearsExperience":0,"dateOfBirth":"","gender":"","nationality":"","phoneCountryCode":"+46","skills":[],"autoConsent":false}}
```

# Test source

```ts
  1   | // tests/e2e/mejlutkast-api.spec.js
  2   | //
  3   | // Round-52 / Issue 1 (P0) — E2E contract for the new Mejlutkast
  4   | // API surface that powers the popup's Gmail/Outlook compose flow.
  5   | //
  6   | // What this covers:
  7   | //   • /api/applications/recent (GET) — 5 most recent applications
  8   | //     for the "Vilket jobb gäller detta mejlet?" picker
  9   | //   • /api/email-draft (POST) — AI-generated Subject + Body with
  10  | //     matchedJob + recentJobs + remaining + cvShortWarning
  11  | //
  12  | // What this does NOT cover (and why):
  13  | //   • The popup's chrome.storage + chrome.tabs.sendMessage round-trip
  14  | //     — that requires a real MV3 install which Playwright can't
  15  | //     simulate. The popup-side is locked via static-source-grep
  16  | //     tests in tests/unit/popup-handshake.test.mjs and a Round-52
  17  | //     followup unit test file.
  18  | //   • The actual Gmail/Outlook DOM injection — content-email.js
  19  | //     runs on those hosts and Playwright can't load a real Chrome
  20  | //     extension. The injection logic is locked via the popup
  21  | //     source-grep tests.
  22  | //
  23  | // Auth shape: the routes use the same opaque extension-token scheme
  24  | // as /api/extension/* (Authorization: Bearer <64-hex>). The e2e
  25  | // fixture's demo cookie is read by the underlying Clerk-or-demo
  26  | // auth, so the tests that exercise the routes go through the
  27  | // standard clerk-OR-demo path. The token-mint path is separately
  28  | // covered by tests/unit/extension-token-ttl.test.mjs (mint contract)
  29  | // + tests/e2e/extension-auth-handshake.spec.js (handshake round-trip).
  30  | //
  31  | // Why Playwright (vs node --test): the routes depend on the Next.js
  32  | // runtime + the catch-all Clerk-or-demo cookie + Mongo — running
  33  | // them in a bare `node --test` would require mocking the entire
  34  | // request envelope, which defeats the purpose of an integration
  35  | // test. The catch-all `/api/[[...path]]/route.js` is the canonical
  36  | // test target for ANY 401-gate check; the dedicated routes (this
  37  | // spec) are tested at the e2e level to catch real-route regressions
  38  | // that unit tests can't see (e.g. a route param parse bug).
  39  | 
  40  | import { test, expect } from './_fixtures/auth'
  41  | import { apiFetch } from './_helpers/apiFetch'
  42  | 
  43  | /**
  44  |  * Helper: mint a 64-hex token via the canonical handshake route.
  45  |  * Returns the raw token so the spec can attach it to subsequent
  46  |  * apiFetch calls via the Authorization: Bearer header. The token
  47  |  * has a 90-day TTL and the route ignores it for "real" auth — it's
  48  |  * the extension's bearer credential.
  49  |  */
  50  | async function mintExtensionToken(page) {
  51  |   const res = await apiFetch(page, '/api/extension/token', { method: 'POST' })
  52  |   if (!res.ok) {
> 53  |     throw new Error(`token mint failed: ${res.status} ${JSON.stringify(res.body)}`)
      |           ^ Error: token mint failed: 200 {"token":"cf5d9f4d40d8495e0fefea7aa4cfb1608925c9e294001c43974ba4baa5250670","expiresAt":"2026-10-18T13:51:26.977Z","profile":{"fullName":"Demo Användare","firstName":"Demo","lastName":"Användare","email":"demo@jobbpiloten.se","phone":"","address":"","city":"","zip":"","linkedin":"","salaryExpectation":35000,"experience":"Medior","workPreference":"hybrid","employmentType":["heltid"],"languages":[],"answers":{"whyThisCompany":"","whyThisRole":"","strengths":"","weaknesses":"","challenge":"","availability":"Omgående"},"latestCoverLetter":"Hej iZettle (PayPal)!\n\nDet var med stor entusiasm jag såg att ni söker en Sales Development Representative i Stockholm.\n\nMed bakgrund som Medior inom Frontend Developer har jag byggt en solid grund i just de områden ni efterfrågar. Rollens fokus stämmer väl med min bakgrund och drivkrafter.\n\nJag skulle uppskatta ett samtal för att berätta mer om hur jag kan bidra hos iZettle (PayPal).\n\nMed vänliga hälsningar,\nDemo Användare","cvSummary":"","hasDriversLicense":false,"isEuCitizen":false,"hasWorkPermit":false,"hasHighSchoolDiploma":false,"hasForkliftLicense":false,"hasSecurityClearance":false,"hasLeadershipExperience":false,"isBilingual":false,"hasTechnicalEducation":false,"hasCustomerExperience":false,"yearsExperience":0,"dateOfBirth":"","gender":"","nationality":"","phoneCountryCode":"+46","skills":[],"autoConsent":false}}
  54  |   }
  55  |   return res.body.token
  56  | }
  57  | 
  58  | test.describe.serial('Mejlutkast API: /api/applications/recent', () => {
  59  |   test('returns 401 when no Authorization header is supplied', async ({ page }) => {
  60  |     // The route uses extension-token auth, NOT the demo cookie. So
  61  |     // a request with the demo cookie but NO bearer must still 401
  62  |     // (the cookie is read by Clerk-or-demo auth which the route
  63  |     // explicitly bypasses). The /api/email-body route is the same.
  64  |     const res = await apiFetch(page, '/api/applications/recent')
  65  |     expect(res.status).toBe(401)
  66  |     expect(typeof res.body?.error).toBe('string')
  67  |     expect(res.body.error).toMatch(/ogiltig|saknad/i)
  68  |   })
  69  | 
  70  |   test('returns 401 when the bearer is malformed (not 64-hex)', async ({ page }) => {
  71  |     const res = await apiFetch(page, '/api/applications/recent', {
  72  |       headers: { Authorization: 'Bearer not-a-real-token' },
  73  |     })
  74  |     expect(res.status).toBe(401)
  75  |     expect(res.body.error).toMatch(/ogiltig|saknad/i)
  76  |   })
  77  | 
  78  |   test('returns the 5 most-recent applications with safe subset of fields', async ({ page }) => {
  79  |     // The fixture seeds 12 applications for the demo user via
  80  |     // seedDemoUser. The /api/applications/recent route should cap
  81  |     // the response at 5 entries (per the JSDoc) and only surface
  82  |     // the safe subset (id + jobTitle + companyName + source + createdAt).
  83  |     const token = await mintExtensionToken(page)
  84  |     const res = await apiFetch(page, '/api/applications/recent', {
  85  |       headers: { Authorization: `Bearer ${token}` },
  86  |     })
  87  |     expect(res.status).toBe(200)
  88  |     expect(Array.isArray(res.body?.applications)).toBe(true)
  89  |     expect(res.body.applications.length).toBeGreaterThan(0)
  90  |     expect(res.body.applications.length).toBeLessThanOrEqual(5)
  91  |     for (const app of res.body.applications) {
  92  |       // Required keys
  93  |       expect(typeof app.id).toBe('string')
  94  |       expect(typeof app.jobTitle).toBe('string')
  95  |       expect(typeof app.companyName).toBe('string')
  96  |       // Forbidden keys — the safe-subset projection must NOT leak
  97  |       // these into chrome.storage.local. Caught a previous round
  98  |       // where the projection forgot to omit emailAddress.
  99  |       expect(app.emailAddress).toBeUndefined()
  100 |       expect(app.bodyText).toBeUndefined()
  101 |       expect(app.subject).toBeUndefined()
  102 |       expect(app.coverLetter).toBeUndefined()
  103 |     }
  104 |   })
  105 | })
  106 | 
  107 | test.describe.serial('Mejlutkast API: /api/email-draft', () => {
  108 |   test('returns 401 when no Authorization header is supplied', async ({ page }) => {
  109 |     const res = await apiFetch(page, '/api/email-draft', {
  110 |       method: 'POST',
  111 |       headers: { 'Content-Type': 'application/json' },
  112 |       body: { recipientEmail: 'recruiter@fortnox.se' },
  113 |     })
  114 |     expect(res.status).toBe(401)
  115 |     expect(res.body.error).toMatch(/ogiltig|saknad/i)
  116 |   })
  117 | 
  118 |   test('returns 400 when recipientEmail is missing (Zod validation)', async ({ page }) => {
  119 |     const token = await mintExtensionToken(page)
  120 |     const res = await apiFetch(page, '/api/email-draft', {
  121 |       method: 'POST',
  122 |       headers: {
  123 |         'Content-Type': 'application/json',
  124 |         Authorization: `Bearer ${token}`,
  125 |       },
  126 |       body: {},
  127 |     })
  128 |     expect(res.status).toBe(400)
  129 |     expect(res.body.error).toMatch(/ogiltig/i)
  130 |     expect(Array.isArray(res.body.issues)).toBe(true)
  131 |   })
  132 | 
  133 |   test('returns 200 with matchedJob=null when no recent application matches the recipient', async ({ page }) => {
  134 |     // The fixture's demo user has 12 seeded applications. None of
  135 |     // them have an emailAddress or companyName that would match
  136 |     // "stranger@nowhere.test". The route must surface matchedJob=null
  137 |     // + the recentJobs list so the popup can populate the picker
  138 |     // fallback.
  139 |     const token = await mintExtensionToken(page)
  140 |     const res = await apiFetch(page, '/api/email-draft', {
  141 |       method: 'POST',
  142 |       headers: {
  143 |         'Content-Type': 'application/json',
  144 |         Authorization: `Bearer ${token}`,
  145 |       },
  146 |       body: { recipientEmail: 'stranger@nowhere.test', lang: 'sv' },
  147 |     })
  148 |     expect(res.status).toBe(200)
  149 |     expect(res.body.matchedJob).toBeNull()
  150 |     expect(Array.isArray(res.body.recentJobs)).toBe(true)
  151 |     // Subject is always set (buildSubject has a graceful default).
  152 |     expect(typeof res.body.subject).toBe('string')
  153 |     expect(res.body.subject.length).toBeGreaterThan(0)
```