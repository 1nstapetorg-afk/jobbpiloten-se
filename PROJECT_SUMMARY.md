# PROJECT_SUMMARY.md — JobbPiloten

> Generated 2026-07-09 for soft-launch to friends & family.

## What is JobbPiloten?

A subscription-based Swedish SaaS that helps job-seekers apply faster:

- **AI-assisted cover letters** in Swedish, personalised per job and candidate
- **Job matching** against Arbetsförmedlingen's open API
- **Aktivitetsrapport PDF** for Arbetsförmedlingen (A4, monthly)
- **Web-push notifications** when new matching jobs are found
- **Legal pages** (GDPR-aware Integritetspolicy + Användarvillkor)
- **Saved applications** (star toggle), filter tabs, three-tier URL fallback
- **Toast system** for action feedback (all Swedish)

The user always reviews and sends the application themselves. JobbPiloten never sends an application on the user's behalf — the framing on the landing page is honest about this and emphasises "AI förbereder, du skickar".

---

## Features List

### Landningssida (`app/page.js`)
- Hero med person-foto, notif-badge, CTA till `/dashboard` eller `/sign-up`
- "Så fungerar det" — 3 steg: profil, AI-matchning, Aktivitetsrapport
- 3-tier prissida (Basic / Professional / Elite) med monthly/annual toggle
- FAQ accordion (5 frågor inkl. "Skickar AI:n ansökningar åt mig?" → "Nej.")
- "Beta"-badge i nav (subtle, amber outline)
- Footer med Integritetspolicy + Användarvillkor-länkar (`data-testid="footer-privacy"` / `footer-terms`)

### Onboarding (`app/onboarding/page.js`)
- 4 steg: karriärinfo, personuppgifter, preferenser, CV-sammanfattning
- Pre-fill från Clerk user (email + fullName)
- Skickar till `/onboarding` efter Clerk sign-up, ersätter till `/dashboard` om profil finns
- POST `/api/profile` upsertar Mongo-profil + auto-seed:ar 12 ansökningar

### Dashboard (`app/dashboard/page.js`)
- Hero-bar med "Kör AI-assistenten nu"-knappen
- "Automatisk AI-assistent (Cron)" — körs 09:00 med manuell "Kör Cron Nu (test)"
- 4 stats-cards (denna-månad, totalt, streak, nästa-rapport)
- Push-notiser-kort (toggle)
- "Aktivitetsrapport denna månad" med PDF-download
- **"Lediga jobb för dig"** — matchade AF-jobb med "Gå till ansökan"-knapp
- **Ansökningar**-tabell med filter-tabs (Alla / Ej ansökta / Ansökta / Sparade)
  - Vänliga tomtillstånd med ikoner (Briefcase / Rocket / Send / Star), `aria-live="polite"`
  - Status-badge (Förberedd / Ansökt / Bekräftad)
  - Inline-åtgärder (Markera som ansökt / Jag fick svar / Visa brev)
  - ⭐ Stjärntoggle för att spara en ansökan — optimistic update, per-row loading
- Förbered-modal: AI-genererat brev, jobbinfo, kontaktuppgifter, knappar för Kopiera / Öppna ansökningssida / Markera som ansökt
- Three-tier URL fallback för "Öppna ansökningssida": direkt jobUrl → Platsbanken → Google-sök

### Auth & Payments
- Clerk (Google OAuth, test-läge) + demo-fallback när keys saknas
- Stripe 3 tiers × 2 intervall
- Customer Portal för uppsägning/uppgradering
- Webhook `checkout.session.completed` + `customer.subscription.*`

### Cron-pipeline
- Daglig push-cron (`/api/cron`, POST med `x-cron-secret`) — definierad i `vercel.json` som `0 7 * * *` UTC = 09:00 Stockholm-tid (CEST sommartid)
- Pre-check: hoppar över användare utan aktiv push-prenumeration (compound-index `idx_clerkId_active` på `push_subscriptions`)
- Skickar batch-notis `"Vi hittade X nya jobb som matchar dig!"` via `lib/push.js`
- Service worker (`public/service-worker.js`) renderar notis + öppnar `/dashboard` vid klick

### Toasts
- Sonner-via-`<Toaster/>` (`richColors position="top-right"`) i `app/providers.js`, inuti `<ThemeProvider>` (krävs av shadcn Sonner)
- Alla meddelanden på svenska:
  - Success: `Jobb sparat!`, `Borttaget från sparade`, `Ansökan markerad som skickad!`, `Markerad som bekräftad!`, `Nytt brev skrivet!`, `Push-notiser aktiverade!`, `Cron kördes! X ...`
  - Error: `Oj, något gick fel` + ev. server-meddelande

### Legal pages
- `/privacy` — GDPR-aware Integritetspolicy, 10 sektioner
- `/terms` — Användarvillkor, 10 sektioner (inkl. AI-transparens, ångerrätt, svensk rätt)

---

## Tech Stack

| Lager | Teknik |
|---|---|
| Framework | Next.js 15 (App Router, JS) |
| Runtime | Node.js 20+ |
| Frontend | React 18, Tailwind CSS, shadcn/ui, lucide-react |
| Toasts | Sonner (`richColors position="top-right" closeButton`) |
| Theme | next-themes (ThemeProvider i providers.js) |
| Backend | Next.js API routes (Node runtime), native `mongodb` driver |
| Databas | MongoDB 6+ (lokalt eller Atlas) |
| AI / LLM | Groq `llama-3.3-70b-versatile` (OpenAI-kompatibelt SDK) |
| PDF | `pdf-lib` (server-side) |
| Auth | Clerk 6 + demo-fallback |
| Betalning | Stripe (test-läge) |
| Push | `web-push` + VAPID, egen service worker |
| Cron | Vercel Cron via `vercel.json` (`0 7 * * *`) + extern scheduler |
| Tester | yarn build (Next 15 har inbyggd typecheck/lint) |
| Package manager | Yarn |

---

## File Structure

```
jobbpiloten/
├── .env.example
├── .gitignore
├── README.md                        # Simple root doc (tech stack + run locally + env)
├── PROJECT_SUMMARY.md               # This file
├── PROJECT_STATUS.md                # Project state + soft-launch checklist
├── middleware.js                    # Clerk middleware
├── vercel.json                      # Cron schedule (09:00 UTC+2 dagligen)
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── jsconfig.json
├── next.config.js
├── components.json
│
├── app/
│   ├── layout.js                    # Root layout
│   ├── providers.js                 # Clerk + ThemeProvider + Sonner <Toaster/>
│   ├── globals.css
│   │
│   ├── page.js                      # Landningssida (publik, Beta-badge)
│   │
│   ├── privacy/page.js              # GDPR-aware Integritetspolicy
│   ├── terms/page.js                # Användarvillkor
│   │
│   ├── sign-in/[[...sign-in]]/page.js
│   ├── sign-up/[[...sign-up]]/page.js
│   │
│   ├── onboarding/page.js           # 4-step onboarding (skyddad)
│   ├── dashboard/page.js            # Dashboard (skyddad) — alla features
│   │
│   └── api/
│       ├── [[...path]]/route.js     # Catch-all: profile, applications, apply-now,
│       │                            #   stats, jobs-available, report, checkout,
│       │                            #   portal, toggle-saved, mark-applied,
│       │                            #   mark-confirmed, regenerate-cover-letter,
│       │                            #   push-subscribe/unsubscribe/dismiss/status/notify
│       ├── cron/route.js            # Daglig push cron (med pre-check + index)
│       └── webhooks/stripe/route.js # Stripe webhooks (signature-verifierade)
│
├── components/
│   ├── DemoBanner.jsx               # Demo-läge banner
│   ├── ErrorBoundary.jsx
│   ├── legal/Section.jsx            # Delad hjälpkomponent för /privacy + /terms
│   └── ui/                          # shadcn-komponenter (Button, Card, Dialog,
│                                    #   Toast, Toaster, sonner.jsx, ...)
│
├── hooks/
│   ├── useAuth.js                   # Clerk + demo-fallback hook
│   ├── use-mobile.jsx
│   └── use-toast.js                 # Gammal shadcn toast hook (legacy)
│
├── lib/
│   ├── auth.js                      # demoUser + getDemoUserId
│   ├── groq.js                      # generateCoverLetter (Groq-klient)
│   ├── jobScraper.js                # AF OpenAPI-klient + resolveAFJobUrl
│   ├── push.js                      # web-push + VAPID helpers
│   └── utils.js
│
├── public/
│   ├── favicon.svg
│   ├── og-image.svg
│   └── service-worker.js            # Push-mottagare + klick → /dashboard
│
└── tests/                           # (placeholder)
```

---

## Setup Instructions (from scratch)

### Prerequisites
- Node.js 20+
- Yarn
- MongoDB 6+ (lokalt via docker eller Atlas)
- Groq API-nyckel (gratis på [console.groq.com](https://console.groq.com))
- Stripe test-läge keys (från [dashboard.stripe.com/test/apikeys](https://dashboard.stripe.com/test/apikeys))
- (Valfritt) Clerk test-läge keys för Google OAuth

### 1. Installera beroenden

```bash
yarn install
```

### 2. Skapa `.env`

Kopiera `.env.example` till `.env` och fyll i:

```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=jobbpiloten
NEXT_PUBLIC_BASE_URL=http://localhost:3000

GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx

# Clerk (valfritt — lämna tomt för demo-läge som använder demoUser)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxx
CLERK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxx

# Stripe (test-läge)
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxx
STRIPE_PRICE_BASIC_MONTHLY=price_xxxx
STRIPE_PRICE_BASIC_YEARLY=price_xxxx
STRIPE_PRICE_PRO_MONTHLY=price_xxxx
STRIPE_PRICE_PRO_YEARLY=price_xxxx
STRIPE_PRICE_ELITE_MONTHLY=price_xxxx
STRIPE_PRICE_ELITE_YEARLY=price_xxxx

# Web-push VAPID
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:hej@jobbpiloten.se

CRON_SECRET=cron-secret-123
```

Generera VAPID:
```bash
npx web-push generate-vapid-keys
```

### 3. Starta MongoDB

```bash
docker run -d --name mongo -p 27017:27017 mongo:6
```

### 4. Kör dev-servern

```bash
yarn dev
```

Öppna [http://localhost:3000](http://localhost:3000).

### 5. Testa manuellt cron

```bash
curl -X POST -H "x-cron-secret: cron-secret-123" http://localhost:3000/api/cron
```

### 6. Produktionsbygge

```bash
yarn build && yarn start
```

Deploya till Vercel — `vercel.json` aktiveras automatiskt och kör cron dagligen kl. 09:00 Stockholm-tid.

### 7. E2E-testmiljö (Playwright + MongoDB + PORT-fallback)

För `yarn test:e2e` (Playwright-specs mot en levande dev-server med
den Clerk-lösa demo-cookie-stubben), se `tests/SETUP.md` →
**First-time setup on a fresh sandbox**. Det täcker de tre
vanligaste setup-blockersna:

1. `yarn playwright install chromium` (binary-download; ~6 s).
2. `pgrep -a mongod` (MongoDB-tillgänglighet).
3. `PORT=3001 yarn dev` + `PORT=3001 yarn test:e2e` (port-fallback
   om port 3000 är upptagen av en root-owned process).

Den fullständiga receptacle-checklistan finns i
`tests/SETUP.md` → **Validating the prerequisites from a fresh
shell** (med bash-recept + Round-33-verifierade timings).

---

## Soft-launch Checklist

Innan du skickar ut invites till vänner & familj:

- [ ] Byt ut `TechSweden AB` och `hej@jobbpiloten.se` mot riktigt företag på `/privacy` och `/terms`
- [ ] Generera riktiga VAPID-nycklar för produktionsdomänen (samma publika key — användare slipper återaktivera push)
- [ ] Skapa riktiga Stripe-priser i test-läge och klistra in price IDs
- [ ] Kör en cron-tick manuellt och verifiera att push-notisen faktiskt kommer fram (man kan testa med `curl`-POST mot `/api/cron` + ett par demo-användare)
- [ ] Deploy till Vercel med `.env.production`, kontrollera att `vercel.json` cron-schedule triggas
- [ ] Skicka invites (max ~30 personer för soft-launch-feedback)

---

## Tips om vidareutveckling

- **E-post/SMS-notiser** — utöka `lib/push.js` med en notifications-modul (t.ex. Resend/Postmark för e-post)
- **Fler jobbkällor** — `lib/jobScraper.js` har bara AF idag; lägg till LinkedIn/Indeed/etc. med samma `{ id, company, title, location, description, source, url, externalId }`-format
- **Inställningssida** — `/settings` för att pausa/avsluta prenumeration, ändra preferenser, exportera raderingsrequest (GDPR §17)
- **E2E-tester** — lägg till `tests/` med Playwright/Cypress + Playwright för filter-tabellen och saved-star-toggle

---

## Strukturella testmönster

Strukturella låsningstester i `tests/unit/` används för att verifiera
att source-pattern (cookie-namn, helper-imports, route-konstanter,
mode-flaggor, demo-button-literal, etc.) finns kvar i produktions-
koden. Två konventioner att följa:

### Per-PER-FILE / per-PER-SIDA över aggregate

Använd **EN TEST PER FIL/PER SIDA** (med explicit route/path i
test-namnet) istället för en samlad aggregate-räknare. Per-page-
tester är strikt mer diagnostiska vid fel (visar exakt vilken sida
som tappade mönstret), medan aggregate-tester bara visar
"found N expected 4" utan att peka ut källan.

**Undantag:** aggregate är OK när det bär signal som per-page-tester
inte kan (t.ex. räkna helpers som matchar ett visst regex över HELA
kodbasen där "vilken sida" är irrelevant).

Konvention från Round-33.1 review-återkoppling på
`tests/unit/demo-button-call-sites.test.mjs` (aggregate-testet
togs bort som redundant efter kritisk review-granskning).

### Backtick-quote-aware regex

Demo-button / cookie-literal-pin ska använda
`/['"\`]literal['"\`]/` (single + double + backtick) så att en
framtida maintainer som byter till template-literal-style inte tyst
bryter testet. Round-33 reviewer-flaggad som "cheap insurance".

### Exempel (per Round-33 demo-button-call-sites)

```javascript
// Backtick-aware regex — covers 'demo-user-001', "demo-user-001",
// AND `demo-user-001`.
const DEMO_USER_LITERAL = /['"`]demo-user-001['"`]/

for (const { route, path } of DEMO_BUTTON_PAGES) {
  test(`Round-33: ${route} page (${path}) still contains the 'demo-user-001' literal`, () => {
    if (!existsSync(path)) {
      assert.fail(`${path} missing — page removed without updating this test`)
    }
    assert.match(readFileSync(path, 'utf8'), DEMO_USER_LITERAL, `(${path}) must contain 'demo-user-001'`)
  })
}
```

### Referens-exempel i tests/unit/

- `tests/unit/auth-fixture.test.mjs` — per-TEST clerkId + addInitScript
  arg passthrough + cookie-name lock (Round-31 design).
- `tests/unit/demo-button-call-sites.test.mjs` — 4 per-page source-grep
  pin för `demo-user-001`-literal i manual-demo-button-flödet.
- `tests/unit/playwright-config.test.mjs` — regression-lock modell-scope
  hoist (Round-31.2 hotfix från multi-worker smoke-attempt).

## Round index

Varje round (Round-N) är en logisk leverans-batch dokumenterad i
`last_response.txt`. Tabellen nedan ger en 1-radig sammanfattning
så maintainers kan hoppa direkt till en round utan att scrolla
genom hela narrativet (filen är 110K+ tecken). Läs hela
`last_response.txt → Round-N` för fullständig diff, validering
och carryover-lista.

| Round | Leverans | Nyckelfiler |
|---|---|---|
| 1–10 | Pre-MVP: landningssida, Clerk auth, Stripe, cron, push-notiser, extension | `app/page.js`, `app/api/cron/`, `lib/push.js`, `extension/` |
| 11–20 | CV upload + parsing, e-post-pipeline, push deep-link, jobId deeplink | `app/api/upload-cv/`, `app/api/extension/`, `lib/jobScraper.js` |
| 21–25 | Dashboard-trender, auto-save svar, settings-page, GDPR export/delete | `app/dashboard/page.js`, `app/settings/page.js`, `app/api/profile` |
| 26–30 | Cover-letter auto-save, svar-minne backend, interactive demo, e-post filter | `app/dashboard/page.js`, `lib/saved-answers.js`, `components/InteractiveDemo.jsx` |
| 31–34 | Per-TEST e2e fixture, multi-worker smoke, trust + cookies, style-presets | `tests/e2e/_fixtures/auth.js`, `app/legal/cookies/`, `lib/style-presets.mjs` |
| 35–37 | 5-style answer diversity, env-setup timing, settings e2e, missing Link import fix | `lib/groq.js`, `tests/SETUP.md`, `app/page.js` |
| 38 | Saved-answers backend, /api/applications/email standalone, dashboard Mail tag | `app/api/saved-answers/`, `app/api/applications/email/`, `app/dashboard/page.js` |
| 39 | Legal Groq residency lock, route-precedence lock, stale .bak cleanup | `app/privacy/page.js`, `tests/unit/route-precedence.test.mjs` |
| 40 | requireAuth(req) bug fix, saved-answers smoke hardening, e2e fixture import fix | `app/api/saved-answers/route.js`, `scripts/smoke-saved-answers.mjs`, `tests/e2e/dashboard-email-source.spec.js` |
| 41 | **AF compliance check** — pace helper, dashboard card, PDF footer, /api/stats safeDayKey | `lib/af-compliance.js`, `app/dashboard/page.js`, `lib/pdf-report.js`, `app/api/[[...path]]/route.js` |

## Round-73 (2026-07-20) helper contracts

- **`lib/profile-check.js`** is the SSOT for "is the profile usable?". Use `isProfileComplete(profile)` (pure predicate: `fullName` OR `email` non-empty trimmed) or `requireCompleteProfile(db, userId)` (async wrapper that returns `{ ok, profile }` or a 404 NextResponse). The canonical 404 message + status are exported as `PROFILE_MISSING_STATUS = 404` + `PROFILE_MISSING_ERROR_MESSAGE`.
- **`extension/lib/safe-message.js`** is required for every `chrome.*` message/storage call in `extension/popup.js`. `safeRuntimeSend` / `safeTabsSendMessage` / `safeStorageGet` never throw — they resolve to `{ ok: false, reason: 'timeout' | 'lastError' }` or `{ __safeStorageTimeout: true }` sentinels.
- **`app/dashboard/page.js`** auto-sync `useEffect` watches `[user, profile, extensionInstalled]` and fires `connectExtension()` once (guarded by `useRef(false)`). The popup's "Anslut din profil" fallback opens `/dashboard` in a new tab via `chrome.tabs.create({ url })` (URL via `resolveEnvAuthBaseUrl()`).

## License

Intern MVP — använd fritt i projektet.
