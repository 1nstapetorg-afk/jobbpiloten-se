# JobbPiloten — Project Handoff

> **Prepared:** 2026-07-14
> **Purpose:** Complete handoff to a new AI agent working locally in VS Code.
> **Repository state at handoff:** soft-launch bundle landed (v0.2.3 extension), `Beta` badge on landing, 103+ unit tests, 1+ Playwright E2E specs.

Read this document top-to-bottom before making any change. It reflects **only what is in the current `/app` working tree** — no aspirational features.

---

## 0. Disambiguation

The user has another project also called "JobbPiloten" in their workspace. **This** codebase can be identified by:

- `package.json` → `"name": "nextjs-mongo-template"` (yes, the internal name is still the template's)
- Presence of `PROJECT_STATUS.md` mentioning `Round-N` narrative and `last_response.txt`
- Presence of the Chrome extension at `extension/` (manifest v3, version 0.2.3)
- MongoDB collections: `profiles`, `applications`, `push_subscriptions`, `cron_logs`, `saved_jobs`, `ai_usage`, `account_deletions`, `extension_tokens`, `push_dismissals`
- `middleware.js` with **conditional** Clerk activation (demo-mode fallback when keys are `xxx` placeholders)
- Cron in `vercel.json` runs **twice daily** (`0 7 * * *` and `0 13 * * *` UTC)

If the other project uses TypeScript, Prisma, custom auth UI, or is missing the Chrome extension — it is **not** this one.

---

## 1. Exact Tech Stack (versions verified from `node_modules` on 2026-07-14)

### Runtime
| Layer | Choice | Version |
|---|---|---|
| Language | **JavaScript** (JSX) — NOT TypeScript. `jsconfig.json`, not `tsconfig.json`. | — |
| Runtime | Node.js | 20+ (dev container ships Node 20.20.2) |
| Package manager | Yarn 1 (classic) | 1.22.22 |

### Framework & UI
| Package | Version | Notes |
|---|---|---|
| `next` | **15.5.16** | App Router. `NODE_OPTIONS='--max-old-space-size=2048'` in the `dev` script. |
| `react` | 18.3.1 | |
| `react-dom` | 18.3.1 | |
| `tailwindcss` | 3.4.1 | Config in `tailwind.config.js` with hero animation keyframes (`hero-bg-cycle`, `hero-particle-a/b/c`). |
| `postcss` | 8 (resolved to 8.5.10 via `resolutions`) | |
| `autoprefixer` | 10.4.19 | |
| `tailwindcss-animate` | 1.0.7 | |
| `tailwind-merge` | 3.3.1 | |
| `class-variance-authority` | 0.7.1 | |
| `clsx` | 2.1.1 | |
| `lucide-react` | 0.516.0 | Icon set. |
| `framer-motion` | 11.18.0 | Used in `app/settings/page.js` and a few UI pieces. |
| `next-themes` | 0.4.6 | Powers Sonner's theme. |

### shadcn/ui + Radix primitives
shadcn config: `components.json`. All UI primitives from `@radix-ui/react-*` (Accordion, Alert-Dialog, Avatar, Checkbox, Collapsible, Context-Menu, Dialog, Dropdown-Menu, Hover-Card, Label, Menubar, Navigation-Menu, Popover, Progress, Radio-Group, Scroll-Area, Select, Separator, Slider, Slot, Switch, Tabs, Toast, Toggle, Toggle-Group, Tooltip). Versions pinned in `package.json` — do not upgrade without regression testing.

### Forms & Data
| Package | Version | Notes |
|---|---|---|
| `react-hook-form` | 7.58.1 | |
| `@hookform/resolvers` | 5.1.1 | |
| `zod` | 3.25.67 | Validation. |
| `@tanstack/react-query` | 5.56.2 | Wired in `app/providers.js`. |
| `@tanstack/react-table` | 8.21.3 | |
| `swr` | 2.3.8 | Used alongside react-query in a few spots. |
| `date-fns` | 4.1.0 | |
| `dayjs` | 1.11.13 | |

### Auth
| Package | Version | Notes |
|---|---|---|
| `@clerk/nextjs` | **7.5.13** (NOT v6 — `PROJECT_STATUS.md` says "Clerk 6" but installed is 7) | v7 dropped `<SignedIn>`/`<SignedOut>` — code uses `useUser()` from `@/hooks/useAuth`. |

**Critical Clerk detail:** the app has a **demo-mode fallback**. When `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` or `CLERK_SECRET_KEY` is empty/`xxx`/<20 chars, `lib/clerk-config.js#isClerkConfiguredServer()` returns false and `middleware.js` returns `NextResponse.next()` without any Clerk protection. `app/providers.js` swaps in a `DemoAuthProvider` that mirrors Clerk's `useUser()` shape (`{ user, isLoaded, isSignedIn }`), so page components need no branching. The demo user id is resolved from the `x-demo-user-id` header or `demoUserId=...` cookie (see `lib/auth.js#getDemoUserId`).

### Payments
| Package | Version | Notes |
|---|---|---|
| `stripe` | **22.3.0** | Server-side only. API version pinned to `'2025-06-30.basil'`. |

Six env-driven price IDs. `PRICE_MAP` in `app/api/[[...path]]/route.js` maps `Tier:interval` → env var. Test mode enforced (no `sk_live_` / `pk_live_` anywhere in codebase — verified).

### Database
| Package | Version | Notes |
|---|---|---|
| `mongodb` | **6.6.0** | Native driver. **NO Prisma. NO Mongoose.** |

Connection pattern: singleton on `global._mongoClientPromise` in every route that touches DB (see `app/api/[[...path]]/route.js` around line 55).

### AI / LLM
| Package | Version | Notes |
|---|---|---|
| `openai` | ^6.45.0 | Used as an OpenAI-compatible client. |
| **Provider:** Groq | via env `GROQ_API_KEY` | Model: `llama-3.3-70b-versatile`. Client instantiated in `lib/groq.js` with `baseURL: 'https://api.groq.com/openai/v1'`. |

`lib/groq.js#generateCoverLetter(profile, job, options)` is the single entry point. It has fallbacks for Emergent LLM proxy (`EMERGENT_LLM_KEY`), OpenAI (`OPENAI_API_KEY`), and OpenRouter (`OPENROUTER_API_KEY`, Round-72). Rule-based fallback ("normaliseProfile" template) if all providers fail.

### PDF, Push, Extras
| Package | Version | Purpose |
|---|---|---|
| `pdf-lib` | ^1.17.1 | Aktivitetsrapport PDF generation. Custom avatar renderer in `lib/pdf-report.js` (5 SVG avatars ported to pdf-lib draw calls). |
| `pdf-parse` | ^2.4.5 | CV upload parsing. |
| `pdfjs-dist` | ^4.0.379 | Client-side PDF preview in settings. |
| `mammoth` | ^1.12.0 | `.docx` CV parsing. |
| `web-push` | ^3.6.7 | Server → browser push notifications (VAPID). |
| `sonner` | 2.0.5 | Toast system (mounted in `app/providers.js`, wrapper in `components/ui/sonner.jsx`). |
| `uuid` | 11.1.1 | |
| `axios` | 1.16.0 | |
| `lodash` | 4.18.1 (resolutions pin) | |

### Testing
| Package | Version | Notes |
|---|---|---|
| `@playwright/test` | ^1.61.1 | E2E specs in `tests/e2e/`. Config: `playwright.config.js`. |
| **Unit tests** | `node --test` via `find tests/unit -name '*.test.mjs'` | 78 unit test files as of 2026-07-14. |
| `acorn` | ^8.17.0 | Used by unit tests for AST-level structural locks. |
| `globals` | 16.2.0 | |

### DevOps
| Tool | Version | Notes |
|---|---|---|
| `docx` | ^9.7.1 | Used by unit tests / scripts. |
| Vercel Cron | — | `vercel.json` schedule (see §5). |

**Not used anywhere (do not add):** TypeScript, Prisma, Mongoose, tRPC, Redux, Zustand, GraphQL, Emotion, styled-components, Vitest, Jest, Storybook.

---

## 2. Directory Tree with File Purposes

```
/app/                                (project root)
│
├── README.md                        Short (80-line) intro + local-run recipe.
├── PROJECT_SUMMARY.md               Deep 370-line spec: features, endpoints, schema, setup.
├── PROJECT_STATUS.md                Round-log + soft-launch checklist + net test count (2026-07-10).
├── TESTING.md                       Manual test checklist for the Chrome extension on real sites.
├── HANDOFF.md                       This file.
├── last_response.txt                110K+ char narrative of every Round-N delivery.
├── .env.example                     Full env template with placeholders + comments.
├── .gitignore                       Ignores node_modules, .next, .env, backups/, dist/, tests artifacts.
├── package.json                     Scripts + deps. `packageManager: yarn@1.22.22`.
├── yarn.lock
├── postcss.config.js
├── tailwind.config.js               Colors + hero-bg-cycle keyframes + hero-particle-{a,b,c}.
├── jsconfig.json                    Path aliases: @/*, @/components/*, @/lib/*, @/app/*.
├── next.config.js                   NO `output: 'standalone'` (regression-locked). `outputFileTracingIncludes` keeps `./extension/**/*` bundled with `/api/extension/download`.
├── components.json                  shadcn config.
├── middleware.js                    68 lines. CONDITIONAL Clerk activation (see §5.1).
├── vercel.json                      Cron: `0 7 * * *` and `0 13 * * *` UTC → 09:00 + 15:00 Stockholm (CEST) → 08:00 + 14:00 (CET).
├── playwright.config.js             PORT-aware webServer (default 3000, override via `PORT=3001`).
│
├── app/                             Next.js App Router pages
│   ├── layout.js                    Root <html> + font, wraps children in <Providers>.
│   ├── providers.js                 ClerkProvider OR DemoAuthProvider + QueryClient + ThemeProvider + Sonner <Toaster /> + <InstallBanner />.
│   ├── globals.css                  Tailwind directives + shadcn CSS variables.
│   │
│   ├── page.js                      (759 lines) Landing page: hero, "Så fungerar det", 3-tier pricing (annual/monthly toggle), FAQ, Beta-badge, footer with /privacy + /terms links.
│   │
│   ├── privacy/page.js              GDPR Integritetspolicy (10 sections).
│   ├── terms/page.js                Användarvillkor (10 sections).
│   ├── legal/cookies/page.js        Cookie policy.
│   │
│   ├── sign-in/[[...sign-in]]/page.js   Clerk <SignIn /> with JobbPiloten branding.
│   ├── sign-up/[[...sign-up]]/page.js   Clerk <SignUp />  with JobbPiloten branding.
│   │
│   ├── onboarding/page.js           (572 lines) 4-step form: career, personal, preferences, CV summary. Pre-fills from Clerk user. Redirects to /dashboard if profile exists.
│   ├── dashboard/page.js            (2899 lines) THE main app. Stats, jobs-available, applications table with filter tabs, star toggle, AI regenerate, PDF download, cron manual trigger, push toggle, extension install banner, upgrade banner. Has a `.bak-final` file next to it — safe to delete (see §7).
│   ├── settings/page.js             (2758 lines) Profile edit, CV upload (PDF/DOCX), subscription management (Customer Portal), notification preferences, push toggle, avatar picker (16 avatars, 5 rarity tiers), extension setup, GDPR export/delete, style-presets picker.
│   │
│   ├── extension-auth/page.js       Chrome extension OAuth bridge — receives token from popup, syncs to chrome.storage.
│   ├── extension-install/page.js    Static install guide for the extension.
│   ├── test-form/page.js            7-field test form for the extension's auto-fill (Test on real jobsites via TESTING.md).
│   │
│   └── api/                         All backend endpoints
│       ├── [[...path]]/route.js     (1426 lines) CATCH-ALL. Handles ~30 paths:
│       │                              GET: health, profile, applications, subscription, stats, report,
│       │                                   push-status, jobs-available, public/stats
│       │                              POST: profile, profile-update, account-export, account-delete,
│       │                                    checkout, portal, push-subscribe, push-unsubscribe,
│       │                                    push-dismiss, notify, toggle-saved, mark-applied,
│       │                                    regenerate-cover-letter, mark-confirmed, apply-now
│       │
│       ├── cron/route.js            (345 lines) DAILY PUSH cron. Read via POST + x-cron-secret header.
│       │                            Never writes to `applications` (user always sends manually).
│       │                            Skips users with no active push_subscription (compound index).
│       │
│       ├── webhooks/stripe/route.js Stripe webhook — raw body via req.text(), signature verified.
│       │                            Handles checkout.session.completed, customer.subscription.updated/deleted.
│       │
│       ├── ai-usage/route.js        Report / consume AI usage quota (ai_usage collection).
│       ├── applications/
│       │   ├── email/route.js       Standalone endpoint for email-based application drafts.
│       │   └── recent/route.js      Feed of the user's most recent applications.
│       ├── cv-enhance/route.js      Groq-powered CV rewrite.
│       ├── cv-ocr/route.js          STUBBED: returns 501. Real OCR (tesseract.js + swe+eng) deferred to v0.4.0.
│       ├── cv-pdf/route.js          Render user's CV as PDF preview.
│       ├── email-draft/route.js     Groq draft for the "email application" flow.
│       ├── email-preview/route.js   Preview handler for the same.
│       ├── saved-answers/route.js       CRUD for reusable Q&A responses (`saved_answers` collection).
│       ├── saved-answers/[id]/route.js  DELETE handler for saved answers.
│       ├── saved-jobs/route.js      List saved jobs (star toggle back-end).
│       ├── track/route.js           Analytics beacon.
│       ├── upload-cv/route.js       Multipart CV upload (PDF/DOCX → text via pdf-parse/mammoth → Groq summary).
│       └── extension/               Chrome extension backend (bearer-token authenticated, NOT Clerk):
│           ├── token/route.js       Mint short-lived bearer token from Clerk session.
│           ├── profile/route.js     Fetch user profile via bearer token.
│           ├── answer/route.js      Save Q&A from extension.
│           ├── ai-answers/route.js  Generate contextual answers via Groq.
│           ├── email-body/route.js  Email-application body generator.
│           └── download/route.js    Serves the extension's own .zip for install-from-URL flow.
│
├── components/                      React components (all .jsx)
│   ├── avatars.jsx                  16 avatar SVGs (Piloten, Navigatören, Strategen, ..., Visionären, Mystikern).
│   ├── ProfileAvatar.jsx            Client-side avatar renderer.
│   ├── CVFileUpload.jsx             Drag+drop CV upload with progress.
│   ├── CookieConsent.jsx            Cookie banner (respects Cookies policy).
│   ├── DemoBanner.jsx               "You are in demo mode" banner (hidden when Clerk configured).
│   ├── ErrorBoundary.jsx            React error boundary wrapper.
│   ├── InstallBanner.jsx            "Install the Chrome extension" prompt on /dashboard.
│   ├── InteractiveDemo.jsx          Landing-page interactive walkthrough.
│   ├── legal/Section.jsx            Reused by /privacy and /terms for numbered section blocks.
│   └── ui/                          shadcn/ui primitives (~40 files: button, card, dialog, dropdown, sonner, sidebar, sheet, table, tabs, ...).
│
├── hooks/
│   ├── useAuth.js                   `useUser()` — proxies Clerk's hook when configured, else pulls from DemoAuthContext.
│   ├── use-mobile.jsx               Responsive breakpoint helper.
│   └── (use-toast.js referenced but replaced by Sonner — see providers.js)
│
├── lib/                             Server + shared logic
│   ├── auth.js                      requireAuth(request), resolveClerkId, getDemoUserId. See §5.2.
│   ├── auth-cookie.js               Demo session cookie set/get + localStorage bootstrap.
│   ├── clerk-config.js              isClerkConfiguredServer() / isClerkConfiguredClient() — the CANONICAL "is Clerk on?" check.
│   ├── groq.js                      (937 lines) LLM entry point: generateCoverLetter, generateEmailBody, style-preset injection, industry-mismatch guard, transferable-skills builder. Falls back to rule-based template if no provider key.
│   ├── jobScraper.js                (531 lines) Multi-source waterfall: Arbetsförmedlingen OpenAPI (primary), Blocket Jobb JSON-LD scrape, Ledigajobb.se HTML scrape. Dedupe by URL then (company|title|location). Emits `evt=multiSource.metric` JSON line per call for log aggregation.
│   ├── scrapers/
│   │   ├── blocket.js               Blocket Jobb JSON-LD parser (soft-block tolerant).
│   │   ├── ledigajobb.js            Ledigajobb.se HTML parser (blocked by robots — fallback URL builder).
│   │   ├── urlBuilders.js           buildLedigaJobbSearchUrl, buildJobbsafariSearchUrl, buildBlocketSearchUrl.
│   │   └── urls.js                  Constants + PROD_BASE_URL.
│   ├── pdf-report.js                Aktivitetsrapport PDF renderer. A4, indigo header, personal details, avatar (5 SVG-ported avatars, 11 fall back to ✈), monthly table.
│   ├── push.js                      web-push helpers: buildBatchMatchPayload, buildJobMatchPayload, sendPushToUser, broadcastPush.
│   ├── cv-enhance.js                Prompt builder for /api/cv-enhance.
│   ├── saved-answers.js             CRUD helper for saved_answers collection.
│   ├── extension-profile.js         Bearer-token profile shaper for /api/extension/profile.
│   ├── ats-keywords.js              Curated Swedish/English ATS keyword lists.
│   ├── transferable-skills.js       Cross-industry skill mapping.
│   ├── match-score.js               Job ↔ profile matching score algorithm.
│   ├── af-compliance.js             Arbetsförmedlingen pacing rules (Round-41 feature: keep users on-track for their weekly obligation).
│   ├── avatars-svg.js               SVG snippets for the 5 avatars ported to pdf-lib.
│   ├── avatar-keys.js               PROFILE_PICTURE_AVATARS constant + rarity tiers.
│   ├── swedishLocations.js          locationsToLänCodes, isRemoteFriendlyText, doesJobMatchUserLocation.
│   ├── siteConfig.js                Brand defaults (JobbPiloten Sweden AB, privacy@jobbpiloten.se) + extension publication flag reader.
│   ├── ssrf-guard.js                Prevents SSRF in URL-fetching endpoints.
│   ├── style-consistency.js         Prompt style enforcement.
│   ├── style-presets.mjs            5 answer/letter styles (formell, personlig, driven, kort, kreativ). CANONICAL source — ALLOWED_STYLE_IDS derived from this at module load.
│   ├── analytics.js                 Client-side analytics wrapper.
│   ├── ai-usage.js                  Quota tracking helper.
│   ├── debug.js                     Console-noise gate (NODE_ENV-aware).
│   ├── demo-state-machine.mjs       Interactive-demo state transitions.
│   ├── groq.js (see above)
│   ├── sanitise-winansi.js          Strip non-WinAnsi glyphs from PDF text (pdf-lib limitation).
│   ├── siteConfig.js (see above)
│   ├── ssrf-guard.js (see above)
│   ├── utils.js                     cn() (Tailwind classname merger), truncate(), hashShort() (FNV-1a base36 — NOT a privacy primitive; see JSDoc warning).
│   └── constants/testIds/           data-testid constants (auth.js, home.js, index.js).
│
├── public/
│   ├── favicon.svg
│   ├── og-image.svg
│   ├── manifest.json                PWA manifest.
│   ├── service-worker.js            Push notification receiver + click → /dashboard.
│   └── icon-*.png / icon-*.svg      PWA icons (192, 512, maskable).
│
├── extension/                       Chrome extension (Manifest v3, version 0.2.3, name "JobbPiloten Auto-Fill")
│   ├── manifest.json                Strict JSON (no comments). CSP docs moved to CSP.md.
│   ├── CSP.md                       Content-Security-Policy directive breakdown + maintainer checklist.
│   ├── background.js                Service worker (event-driven, no persistent state).
│   ├── content.js                   Injected on <all_urls>, runs at document_start, handles postMessage bridge with the dashboard.
│   ├── content-email.js             Email-composer detection (Gmail, Outlook web) for email-application flow.
│   ├── popup.html / popup.css / popup.js   Toolbar popup UI.
│   ├── lib/
│   │   ├── dashboard-url-resolver.js    Pure module: 4-tier resolver chain (sync-storage → local-storage → manifest → build-config → PROD_BASE_URL_DEFAULT) with `parseValidOrigin()` gate.
│   │   └── email-clients.js             Selectors for Gmail / Outlook / Yahoo / Superhuman composers.
│   ├── build-config.json            Version + prod base URL fallback.
│   ├── icons/                       16/48/128 PNG + SVG source.
│   ├── _locales/sv/messages.json    i18n (Swedish only for now).
│   └── README.md                    Extension-specific README.
│
├── tests/
│   ├── SETUP.md                     Playwright + MongoDB + PORT fallback recipe.
│   ├── unit/                        78 .test.mjs files (node --test). Structural locks + behavioral tests.
│   ├── e2e/                         Playwright specs (~15 files) — auth-contract, dashboard-*, ai-hjalp-toggle, cv-magic-bytes, ...
│   └── e2e/_fixtures/               Auth fixture (per-TEST clerkId, addInitScript arg passthrough, cookie-name lock).
│
├── scripts/                         Node/Python helpers (run via `yarn` scripts):
│   ├── backfill-method-field.js     One-off DB migration (already run, kept for reference).
│   ├── backfill-job-urls.js         One-off DB migration.
│   ├── generate-pwa-icons.js        Regenerate icon-*.png from SVG.
│   ├── generate-extension-icons.js  Same for the extension.
│   ├── lint-scope.mjs               Custom lint for demo/prod-scope separation.
│   ├── package-extension.py         Build extension ZIP: yarn package:extension [--cws].
│   ├── smoke-saved-answers.mjs      Post-deploy smoke for /api/saved-answers.
│   └── validate-extension.js        Validate manifest + files before packaging.
│
├── backups/                         GITIGNORED. Pre-commit snapshots.
├── dist/                            GITIGNORED. Packaged extension ZIPs.
├── test-results/                    GITIGNORED. Playwright artifacts (screenshots, traces).
└── node_modules/                    GITIGNORED.
```

**Non-source files present in the working tree (do NOT commit):**
- `.emergent/`, `memory/`, `test_reports/`, `test_result.md`, `test_report_*.pdf`, `backend_test.py` — Emergent platform artifacts.
- `app/dashboard/page.js.bak-final` — stale backup, delete on first commit.
- `extension-test.mjs`, `tmp-test-empty-pdf.mjs`, `walkthrough.mjs` — dev-only scratch files (already in .gitignore).
- `jobbpiloten-complete-backup.zip` at project root — leftover backup, delete.

---

## 3. Environment Variables (from `.env.example`)

**KEYS ONLY — no values in this handoff.** Copy `.env.example` → `.env` and fill in.

### Required for basic functionality
| Key | Purpose |
|---|---|
| `MONGO_URL` | Mongo connection string |
| `DB_NAME` | Database name (default `jobbpiloten`) |
| `NEXT_PUBLIC_BASE_URL` | Absolute base URL for redirects (`http://localhost:3000` in dev) |

### Branding (public)
| Key | Purpose |
|---|---|
| `NEXT_PUBLIC_LEGAL_COMPANY_NAME` | Shown on /privacy + /terms (default `JobbPiloten Sweden AB`) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | `hej@jobbpiloten.se` default |
| `NEXT_PUBLIC_PRIVACY_EMAIL` | `privacy@jobbpiloten.se` default |

### LLM
| Key | Purpose |
|---|---|
| `GROQ_API_KEY` | **Primary provider.** `gsk_...` from console.groq.com |
| `EMERGENT_LLM_KEY` | Fallback (Emergent proxy) |
| `OPENAI_API_KEY` | Second fallback (direct OpenAI) — requires code change in `lib/groq.js#pickProvider` |
| `OPENROUTER_API_KEY` | Third fallback (Round-72) — OpenAI-compatible proxy to Anthropic/Llama/Mistral via `vendor/model` slugs. Default model `anthropic/claude-3.5-sonnet`; override via `OPENROUTER_MODEL`. `sk-or-...` from openrouter.ai |

### Clerk (optional — demo mode fallback if empty/xxx)
| Key | Purpose |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_test_...` |
| `CLERK_SECRET_KEY` | `sk_test_...` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/dashboard` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/onboarding` |

### Stripe (test mode only)
| Key | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from `stripe listen --forward-to localhost:3000/api/webhooks/stripe` |
| `STRIPE_PRICE_BASIC_MONTHLY` | Price ID (149 SEK/mån) |
| `STRIPE_PRICE_BASIC_YEARLY` | Price ID (1490 SEK/år) |
| `STRIPE_PRICE_PRO_MONTHLY` | Price ID (349 SEK/mån) |
| `STRIPE_PRICE_PRO_YEARLY` | Price ID (3490 SEK/år) |
| `STRIPE_PRICE_ELITE_MONTHLY` | Price ID (799 SEK/mån) |
| `STRIPE_PRICE_ELITE_YEARLY` | Price ID (7990 SEK/år) |

### Web-push (VAPID)
| Key | Purpose |
|---|---|
| `VAPID_PUBLIC_KEY` | Server-side (`lib/push.js`) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | **Same value**, client-side (dashboard/settings subscribe flow) |
| `VAPID_PRIVATE_KEY` | Server-only — NEVER prefix with `NEXT_PUBLIC_` |
| `VAPID_SUBJECT` | `mailto:...` |

Generate: `npx web-push generate-vapid-keys`

### Chrome extension (public)
| Key | Purpose |
|---|---|
| `NEXT_PUBLIC_EXTENSION_PUBLISHED` | `1` when Chrome Web Store publication is live; empty hides install banner |
| `NEXT_PUBLIC_EXTENSION_STORE_URL` | Full CWS URL with slug |

### Cron / misc
| Key | Purpose |
|---|---|
| `CRON_SECRET` | Passed as `x-cron-secret` header to `/api/cron`. Empty in dev = open. Generate `openssl rand -hex 32` for prod. |
| `CORS_ORIGINS` | `*` default |

---

## 4. Database Schema

MongoDB, native driver, **no ORM**. All collections use `clerkId` as the tenant key (falls back to demo id `demo-user-001` in demo mode). `userId` is a separate internal UUID kept for legacy compatibility.

### `profiles`
```js
{
  clerkId: string,                    // primary tenant key
  userId: string,                     // internal UUID
  fullName, email, phone, personalNumber, address, linkedin: string,
  jobTitles: string[],
  locations: string[],
  salaryMin: number | null,
  experience: 'Junior' | 'Medior' | 'Senior',
  workPreference: 'remote' | 'hybrid' | 'onsite',
  employmentType: 'heltid' | 'deltid' | 'konsult',
  industriesToAvoid: string[],
  cvSummary: string,                  // Groq-generated summary, used in cover letter prompts
  cvOriginal: string,                 // raw parsed text (from pdf-parse/mammoth)
  cvUploadedAt: Date,
  avatarKey: string,                  // one of PROFILE_PICTURE_AVATARS
  stylePreference: string,            // one of STYLE_PRESETS.map(p => p.id) — see lib/style-presets.mjs
  tier: 'Basic' | 'Professional' | 'Elite',
  billingInterval: 'month' | 'year' | null,
  subscriptionStatus: 'active' | 'trialing' | 'canceled' | 'inactive' | null,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  stripePriceId: string,
  currentPeriodEnd: Date,
  cancelAtPeriodEnd: boolean,
  preferences: { emailNotifications, pushEnabled, weeklyDigest: boolean },
  createdAt, updatedAt: Date,
}
```

### `applications`
```js
{
  id: string (UUID),                  // client-side id (not _id)
  clerkId: string,
  userId: string,
  jobId: string,                      // matches jobScraper result.id when applicable
  company, title, location, source, description, jobUrl: string,
  coverLetter: string,                // Groq output OR user-edited
  emailBody: string,                  // for email-application flow
  status: 'Skickad' | 'Under granskning' | 'Läst av arbetsgivare' | 'Intervju bokad' | 'applied' | 'confirmed',
  saved: boolean,                     // star toggle
  appliedAt: Date,
  markedAppliedAt: Date | null,
  confirmedAt: Date | null,
  method: 'AI-assistent' | 'AI-automatisk ansökan' (legacy),
}
```

### `push_subscriptions`
```js
{
  clerkId: string,
  endpoint: string,
  keys: { p256dh, auth: string },
  userAgent: string,
  active: boolean,
  createdAt, lastUsedAt: Date,
}
```
**Compound index:** `{ clerkId: 1, active: 1 }` named `idx_clerkId_active`, created lazily in `/api/cron/route.js` on first run. Cron pre-check queries this to skip users without active subscriptions.

### `cron_logs`
```js
{
  action: 'cron_run' | 'cron_skipped_no_push',
  ts: Date,
  clerkId: string | null,
  newCount: number,                   // jobs found
  pushNotification: { sent: number, failed: number },
  source: 'multi',                    // Arbetsförmedlingen + Blocket + Ledigajobb waterfall
  metric: { af, blk, lj, in, dedup, capped }, // matches the multiSource.metric log shape
  error: string | null,
}
```
Note: `push_not_subscribed` skips no longer write here (avoids collection bloat).

### `saved_jobs`
```js
{
  clerkId: string,
  jobId: string,
  company, title, location, source, jobUrl: string,
  savedAt: Date,
}
```

### `saved_answers`
```js
{
  id: string (UUID),
  clerkId: string,
  question: string,
  answer: string,
  category: string,                   // 'motivation' | 'strength' | 'weakness' | ...
  usageCount: number,
  createdAt, updatedAt: Date,
}
```

### `ai_usage`
```js
{
  clerkId: string,
  ts: Date,
  kind: 'cover-letter' | 'email-body' | 'cv-summary' | 'answer',
  provider: 'groq' | 'emergent' | 'openai' | 'rule-based',
  model: string,
  tokensIn, tokensOut: number,
  ms: number,
}
```

### `extension_tokens`
```js
{
  token: string (opaque, 64+ hex chars),
  clerkId: string,
  createdAt, lastUsedAt: Date,
  expiresAt: Date,                    // short-lived (24h default)
  active: boolean,
}
```

### `push_dismissals`
```js
{
  clerkId: string,
  ts: Date,
  reason: string,
}
```

### `account_deletions`
```js
{
  clerkId: string,
  requestedAt: Date,
  completedAt: Date | null,
  scheduledPurgeAt: Date,             // 30-day grace window
}
```

---

## 5. Key Architectural Decisions & Patterns

### 5.1. Middleware — Conditional Clerk Activation
`/middleware.js` uses a **runtime check** (`isClerkConfiguredServer()`) to decide whether to run Clerk protection. If keys are missing/xxx/short → `NextResponse.next()` unconditionally (demo mode). If keys look real → dynamically imports `clerkMiddleware` and applies route matchers.

**Why:** the app runs in three modes without code changes: full-Clerk prod, Clerk-test-mode dev, and no-Clerk demo (used by e2e tests and the interactive product demo).

**Public routes:** `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/api/webhooks/(.*)`, `/api/health`, `/api/extension/(.*)`
**Protected routes:** `/dashboard(.*)`, `/onboarding(.*)`, `/settings(.*)`, and 8 `/api/*` prefixes.

Extension routes are explicitly public because the extension cannot supply Clerk cookies cross-origin — they use bearer-token auth (`extension_tokens` collection).

### 5.2. Auth Helper Pattern
`lib/auth.js` exports:
- `requireAuth(request)` → returns `{ userId, demo, response? }`. If no auth, `response` is a ready-to-return 401 `NextResponse`.
- `resolveClerkId(request)` → picks Clerk userId when configured, else the demo header/cookie id.
- `getDemoUserId(request)` → reads `x-demo-user-id` header, then `demoUserId=...` cookie.

Every protected route starts with:
```js
const { userId, response } = await requireAuth(request);
if (response) return response;
```

### 5.3. Single Catch-All API + Dedicated Webhook
`/app/api/[[...path]]/route.js` (1426 lines) handles ~30 sub-paths via a `path === 'x'` chain inside GET/POST/PUT/DELETE handlers. This is intentional: less file overhead, tighter shared imports (Mongo singleton, Stripe client, PRICE_MAP).

**Exceptions with dedicated files** (each has a specific reason):
- `/app/api/webhooks/stripe/route.js` — needs `req.text()` raw body for signature verification, cannot flow through catch-all.
- `/app/api/cron/route.js` — long-running batch loop, deserves isolation for observability.
- `/app/api/upload-cv/route.js` — multipart parsing.
- `/app/api/cv-*` + `/app/api/email-*` + `/app/api/applications/*` + `/app/api/saved-*` + `/app/api/extension/*` + `/app/api/ai-usage` + `/app/api/track` — dedicated files for cleaner ownership; extracted during Round 20+.

### 5.4. Multi-Source Job Scraper Waterfall
`lib/jobScraper.js#multiSourceSearchJobs` queries in parallel:
1. **Arbetsförmedlingen OpenAPI** (`jobsearch.api.jobtechdev.se/search`) — primary, region-aware, most trustworthy.
2. **Blocket Jobb** — JSON-LD `JobPosting` scrape from listing pages. 403-tolerant.
3. **Ledigajobb.se** — HTML scrape. Killswitch: `LEDIGAJOBB_SCRAPER_ENABLED=false`.

Dedup: URL-first, then `(company|title|location)`. AF wins ties.

`hasMore` uses an `upstreamCapped` heuristic: `combined.length > offset+limit OR any single source returned exactly limit`. Prevents "Visa fler jobb" from disappearing when dedupe collapses hits.

**Metric log line** (one per call):
```json
{"evt":"multiSource.metric","v":1,"af":N,"blk":M,"lj":K,"in":N+M+K,"dedup":L,"capped":O,"q":"…","l":"…"}
```
Query/location are **truncated to 40 chars** (not hashed — hashing kommun names is broken privacy; see `truncate` JSDoc note in `lib/utils.js`).

### 5.5. Cron Does NOT Auto-Apply
`/api/cron/route.js` only sends push notifications ("Vi hittade X nya jobb som matchar dig!"). The user always reviews and sends applications manually from `/dashboard`. This is a **product decision** and reflected in landing-page copy ("AI förbereder, du skickar") and in FAQ #1.

### 5.6. Toast System
Sonner via shadcn wrapper in `components/ui/sonner.jsx`. `<Toaster richColors position="top-right" closeButton />` is mounted **inside** `<ThemeProvider>` in `app/providers.js` (shadcn Sonner requires it). Use `import { toast } from 'sonner'` in components.

**All copy is Swedish.** Examples:
- `toast.success('Jobb sparat!')`
- `toast.error('Oj, något gick fel')`
- `toast.success('Nytt brev skrivet!')`

### 5.7. Testing Patterns
Two conventions locked by review:
- **Per-file / per-page over aggregate** — one test per source file/page (with explicit path in test name) is strictly more diagnostic. Aggregate ("found N expected 4") only allowed when signal is cross-cutting.
- **Backtick-aware regex** — pin literals with `/['"\`]literal['"\`]/` so a future template-literal swap doesn't silently break.

Structural locks live in `tests/unit/*.test.mjs` (78 files). Behavioral tests exercise real modules with stubbed deps. E2E specs in `tests/e2e/` use a per-TEST clerkId fixture in `tests/e2e/_fixtures/auth.js`.

### 5.8. Extension Bridge Contract
The extension talks to the dashboard via `window.postMessage`. Two messages, both required, both locked by Playwright spec `env-aware-dashboard-url.spec.js`:
- `JOBBPILOTEN_SET_DASHBOARD_URL` — sets base URL in extension storage.
- `JOBBPILOTEN_AUTH_SYNC` — pushes bearer token + profile + baseUrl + allowedOrigins.

Fired on `dashboard.connectExtension()`. Read by `extension/content.js#handleDashboardUrl()`.

### 5.9. Path Aliases
`jsconfig.json` maps:
- `@/*` → project root
- `@/components/*` → `./components/*`
- `@/lib/*` → `./lib/*`
- `@/app/*` → `./app/*`

Use these in every import.

### 5.10. AI Provider Order (`lib/groq.js#pickProvider`)
1. `GROQ_API_KEY` → Groq (`llama-3.3-70b-versatile`)
2. else `EMERGENT_LLM_KEY` → Emergent proxy (OpenAI-compatible)
3. else `OPENAI_API_KEY` → OpenAI direct
4. else `OPENROUTER_API_KEY` → OpenRouter proxy (Round-72; default `anthropic/claude-3.5-sonnet`, override via `OPENROUTER_MODEL`)
5. else rule-based template (no LLM call — deterministic Swedish letter with 3 openings/middles/closings)

Never throws — always returns a Swedish cover letter of some quality.

---

## 6. Current Feature Checklist

### Landing (`/`)
- [x] Hero with laptop CSS mockup (amber→indigo gradient + dot grid + compass rose)
- [x] Animated hero background (motion-safe, prefers-reduced-motion aware)
- [x] "Så fungerar det" 3-step visual
- [x] 3-tier pricing (Basic 149/1490, Pro 349/3490, Elite 799/7990) with monthly/annual toggle
- [x] Annual subline "Faktureras årsvis · X SEK/år (spara Y SEK)" (only when annual toggle on)
- [x] AI-ansvar tooltip on Professional + Elite tier cards
- [x] Beta badge in nav (amber outline)
- [x] FAQ accordion (5 questions, including "Skickar AI:n ansökningar åt mig?" → "Nej.")
- [x] Footer links `data-testid="footer-privacy"` / `footer-terms`

### Onboarding (`/onboarding`)
- [x] 4 steps: career info, personal details, preferences, CV summary
- [x] Pre-fills email + fullName from Clerk (or demo user)
- [x] Auto-seed 12 historic applications on first POST /api/profile
- [x] Redirects to /dashboard if profile already exists

### Dashboard (`/dashboard`)
- [x] Stats: this-month applications, total, streak (consecutive-day counter), next-report date
- [x] Push-subscribe toggle
- [x] "Aktivitetsrapport denna månad" with PDF download
- [x] "Lediga jobb för dig" — matched AF+Blocket+Ledigajobb jobs (multi-source waterfall)
- [x] Applications table with filter tabs: Alla / Ej ansökta / Ansökta / Sparade
- [x] Friendly empty states (Briefcase / Rocket / Send / Star icons, `aria-live="polite"`)
- [x] Status badges: Förberedd / Ansökt / Bekräftad
- [x] Star toggle for saved applications (optimistic update, per-row loading, `aria-pressed`)
- [x] Prepare-modal: AI-generated letter, job info, contact details, Copy / Open application / Mark as applied buttons
- [x] Three-tier URL fallback: direct jobUrl → Platsbanken → Google search
- [x] Inline "Regenerate cover letter" (Groq)
- [x] Cron manual trigger button (dev-only visual, wired to POST /api/cron)
- [x] Extension install banner (`InstallBanner.jsx`) with 4-tier dashboard-url resolver
- [x] Upgrade banner when `subscriptionStatus === 'inactive'`
- [x] Checkout success banner when `?checkout=success` in URL
- [x] Subscription card with tier, status, renewal date, "Hantera prenumeration" → Stripe Customer Portal
- [x] Groq-authored letters honour user's `stylePreference` (5 presets)
- [x] AF compliance card (Round-41) — weekly obligation pacing helper

### Settings (`/settings`)
- [x] Profile edit (all onboarding fields + LinkedIn URL)
- [x] Avatar picker — 16 avatars, 5 rarity tiers (common/uncommon/rare/epic/legendary)
- [x] CV upload — PDF via pdf-parse, DOCX via mammoth. Groq re-summarises `cvSummary` field on upload.
- [x] CV OCR — **stubbed 501** (deferred to v0.4.0). Settings UI reads the 501 and surfaces the gap honestly.
- [x] Style preference picker (formell / personlig / driven / kort / kreativ)
- [x] Notification preferences (email, push, weekly digest)
- [x] Extension setup section
- [x] Subscription management (Customer Portal link)
- [x] GDPR export (`POST /api/profile action=account-export`) + delete (30-day grace window)

### Auth
- [x] Clerk Google OAuth (test mode) at `/sign-in`, `/sign-up`
- [x] Demo mode fallback (no keys required) with cookie-based session
- [x] After sign-up → `/onboarding`; after sign-in → `/dashboard`

### Payments
- [x] Stripe Checkout (test mode) for 3 tiers × 2 intervals
- [x] Stripe Customer Portal for upgrade/downgrade/cancel
- [x] Webhook: `checkout.session.completed` + `customer.subscription.updated` + `customer.subscription.deleted`

### Push Notifications
- [x] VAPID web-push
- [x] Dashboard + settings subscribe toggle
- [x] Compound index `idx_clerkId_active` on `push_subscriptions` (lazy-created)
- [x] Cron pre-check skips users without active subscription
- [x] Custom service worker (`public/service-worker.js`) renders notification + opens `/dashboard` on click

### Cron
- [x] Twice-daily push cron (09:00 + 15:00 CEST / 08:00 + 14:00 CET)
- [x] `x-cron-secret` header required in prod (empty CRON_SECRET allows in dev)
- [x] Structured metric log line per multi-source call

### Chrome Extension (JobbPiloten Auto-Fill, v0.2.3)
- [x] Manifest v3, event-driven service worker
- [x] Content script injected at `document_start` on `<all_urls>`
- [x] Popup with 4-tier dashboard URL resolver + settings panel
- [x] Auto-fill on `/test-form` and real job sites
- [x] AI-assisted answers via Groq (`/api/extension/ai-answers`)
- [x] Email composer detection (Gmail, Outlook web)
- [x] Bearer-token auth via `/api/extension/token`
- [x] Cross-tab settings sync via `chrome.storage.onChanged`
- [x] Sideload works today (`Load unpacked`). Chrome Web Store publication pending (soft-launch item, see §7)

### Legal
- [x] `/privacy` — 10-section GDPR Integritetspolicy
- [x] `/terms` — 10-section Användarvillkor
- [x] `/legal/cookies` — Cookie policy
- [x] Cookie consent banner (`CookieConsent.jsx`)

### Testing
- [x] 78 unit test files (`node --test` via `yarn test:unit`)
- [x] Playwright E2E specs (`yarn test:e2e`) — ~15 specs including auth-contract, dashboard filter tabs, saved-star toggle, extension env-aware URL contract
- [x] `tests/SETUP.md` recipes for fresh-shell prerequisites (Chromium install, MongoDB reachability, PORT fallback)

---

## 7. Known Bugs / TODOs / Non-Obvious Gotchas

### Open items (from `PROJECT_STATUS.md#Soft-launch Checklist`)
- [ ] Chrome extension not yet published to Chrome Web Store. Sideload works. When published, set `NEXT_PUBLIC_EXTENSION_PUBLISHED=1` + `NEXT_PUBLIC_EXTENSION_STORE_URL=<full slug>`.
- [ ] Real Stripe price IDs need to be pasted into `.env` before checkout can complete in prod (placeholders in `.env.example`).
- [ ] Deploy to Vercel — verify `vercel.json` cron actually triggers 09:00.
- [ ] Cron smoke test — `curl -X POST -H "x-cron-secret: $CRON_SECRET" $BASE_URL/api/cron | jq`, verify push notification arrives on demo user.
- [ ] Send invites (max ~30 people).

### Intentional non-features (do NOT "fix" these)
- **OCR deferred to v0.4.0.** `/api/cv-ocr/route.js` returns HTTP 501 by design. Scanned/image-only PDFs route to manual-summary UX. Reason: ~15-25 MB tesseract.js bundle isn't worth it for the ~1% of uploads it would unblock during soft launch.
- **Ledigajobb.se → pre-filled URL, not scraped.** Their `robots.txt` blocks automated crawling. `buildLedigaJobbSearchUrl` in `lib/scrapers/urlBuilders.js` gives an honest search URL instead. Same for Jobbsafari. Blocket IS scraped (JSON-LD, public).
- **Cron in UTC, not Stockholm.** Vercel Cron only accepts UTC. `0 7` runs at 09:00 CEST (summer) / 08:00 CET (winter). Accepted for soft launch.
- **`hashShort` is NOT a privacy primitive.** JSDoc in `lib/utils.js` warns future devs: FNV-1a 32-bit is brute-forceable in <1ms against ~290 Swedish kommun names. Log lines use inline `truncate(value, 40)` instead.
- **`next.config.js` deliberately has NO `output: 'standalone'`.** Locked by `tests/unit/next-config-no-standalone.test.mjs`. Vercel handles its own per-route serverless packaging; setting `standalone` breaks Vercel's CSS bundle path resolution.
- **`.next` stale-chunk bug.** If you see `Cannot find module './5611.js'` on the dashboard, cold rebuild: `rm -rf .next && yarn build`. Documented in soft-launch checklist.

### Files that should NOT be committed
- `app/dashboard/page.js.bak-final` — leftover from a Round-25 refactor. Delete on first commit.
- `jobbpiloten-complete-backup.zip` at project root — pre-migration backup, delete.
- `last_response.txt` — 110K narrative log. Useful reference but not source. Keep local, do not commit.
- `backups/` folder contents — `.gitignore`-d but present.

### Placeholders currently in `.env.example` (must be replaced for prod)
- Both `VAPID_PUBLIC_KEY` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` are set to a soft-launch shared value in `.env.example`. Regenerate with `npx web-push generate-vapid-keys` for prod (both env vars point to the SAME public key — private is separate and server-only).
- Company name / privacy email — `NEXT_PUBLIC_LEGAL_COMPANY_NAME=JobbPiloten Sweden AB` and `NEXT_PUBLIC_PRIVACY_EMAIL=privacy@jobbpiloten.se` are the current defaults in `lib/siteConfig.js`.

### Round-40 bug fix carryover
`requireAuth(req)` used to accept `(request)` in some routes and `()` in others. Fixed and locked by `tests/unit/saved-answers-auth-arg.test.mjs`. If you add a new route calling `requireAuth`, always pass the `request` object.

### Non-obvious `useCallback` in settings
`app/settings/page.js` uses `useCallback` for the page-level `load` function to keep the `useEffect([isLoaded, load])` dependency stable. Removing it triggers infinite re-renders.

---

## 8. Build / Deployment Steps

### 8.1. Local (fresh clone)
```bash
# 1. Install deps
yarn install                                # NEVER use npm — resolutions pin lodash and postcss.

# 2. Copy env template
cp .env.example .env
# Fill in .env (see §3). At minimum: MONGO_URL, DB_NAME, NEXT_PUBLIC_BASE_URL, GROQ_API_KEY.
# Leave Clerk keys blank for demo mode.

# 3. Start MongoDB
docker run -d --name jobbpiloten-mongo -p 27017:27017 mongo:6

# 4. (Optional) Generate VAPID keys for push
npx web-push generate-vapid-keys
# Paste public into VAPID_PUBLIC_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY, private into VAPID_PRIVATE_KEY.

# 5. Dev server
yarn dev                                    # http://localhost:3000
# NODE_OPTIONS='--max-old-space-size=2048' is set inside the yarn script — dev bundle can OOM at 512MB.
```

### 8.2. Tests
```bash
yarn test:unit                              # 78 files, ~2-3s total
yarn test:scope                             # Custom demo/prod scope lint
yarn test:e2e                               # Playwright — see tests/SETUP.md first!
yarn test:e2e:headed                        # With browser window
yarn test:e2e:list                          # Just list specs
yarn test:e2e:ci                            # Single worker (Vercel CI mode)
```

First-time Playwright setup:
```bash
yarn playwright install chromium            # ~6s
pgrep -a mongod                             # Verify MongoDB up
PORT=3001 yarn dev                          # If :3000 is taken by a root-owned process
PORT=3001 yarn test:e2e                     # Match PORT for the runner
```

### 8.3. Manual cron trigger
```bash
# Local (no CRON_SECRET):
curl -X POST http://localhost:3000/api/cron | jq

# Staging/prod (with CRON_SECRET):
curl -X POST -H "x-cron-secret: $CRON_SECRET" https://jobbpiloten.se/api/cron | jq
```
Expected: `{ ok: true, cron: "ran", results: [ { clerkId, status: "success", newCount: N } ] }`
Verify `cron_logs` collection: rows with `action: "cron_run"` and `pushNotification.sent > 0`.

### 8.4. Production (Vercel)
1. Connect GitHub repo to Vercel.
2. Add all env vars from §3 (both `NEXT_PUBLIC_*` and secret keys).
3. Vercel auto-detects Next.js 15 App Router.
4. `vercel.json` cron activates automatically after first deploy — check Vercel dashboard → Crons.
5. Verify no `sk_live_` / `pk_live_` in the deployed env (test mode locked).

**Do NOT set `output: 'standalone'`** in `next.config.js`. Regression-locked by `tests/unit/next-config-no-standalone.test.mjs`.

### 8.5. Chrome Extension packaging
```bash
yarn package:extension                      # → dist/extension-{version}.zip (dev sideload)
yarn package:extension:cws                  # → dist/extension-{version}-cws.zip (Chrome Web Store upload)
yarn validate:extension                     # Sanity check before packaging
```
Upload the `-cws.zip` to https://partner.google.com. Google review 2-5 days. When live, set `NEXT_PUBLIC_EXTENSION_PUBLISHED=1` + `NEXT_PUBLIC_EXTENSION_STORE_URL=...`.

---

## 9. Non-Obvious Setup Requirements

### 9.1. Memory
Next.js dev bundle OOMs at Node's default 512MB heap because of Clerk + Radix + framer-motion. The `dev` script sets `NODE_OPTIONS='--max-old-space-size=2048'`. If you rename or bypass the script, add this back.

### 9.2. Mongo singleton across hot-reloads
Every route creates the client once via `global._mongoClientPromise`. If you copy-paste a new route and forget this pattern, hot-reload will leak connections and MongoDB will refuse new ones after ~100 restarts.

### 9.3. `params` must be awaited (Next 15)
Next 15 changed dynamic route params to a Promise. In every catch-all, do:
```js
export async function GET(req, ctx) {
  const params = await ctx.params;
  const path = (params?.path || []).join('/');
  ...
}
```

### 9.4. Sonner must be inside `<ThemeProvider>`
See `app/providers.js`. Moving `<Toaster />` outside `<ThemeProvider>` breaks dark-mode colors (silently).

### 9.5. Clerk v7 API differences
- `SignedIn` / `SignedOut` components DO NOT exist. Use `useUser()` from `@/hooks/useAuth`.
- `authMiddleware` is gone. Use `clerkMiddleware` + `createRouteMatcher` from `@clerk/nextjs/server`.
- `auth()` in server actions/routes returns a Promise now: `const { userId } = await auth();`.

### 9.6. Middleware conditional import
`middleware.js` uses `await import('@clerk/nextjs/server')` inside the function body, NOT a top-level static import. This is deliberate: static import would evaluate Clerk's module (which crashes with "Publishable key not valid" if keys are placeholder). Dynamic import is the only way to have a true demo-mode fallback.

### 9.7. `dashboard/page.js` is 2899 lines
Do not split it without a plan. Round-42 attempted it and reverted after breaking 6 E2E specs. If you must edit it: use `mcp_search_replace` with heavy context, never `overwrite=true`.

### 9.8. Extension host_permissions wildcard skip
`extension/manifest.json` uses `<all_urls>` in `content_scripts.matches`. The popup's dashboard-url resolver has a wildcard-skip guard in its 4-tier chain — if you add a specific host permission, add a test in `tests/unit/popup-resolver.test.mjs`.

### 9.9. `openai` npm package is used as the Groq client
`lib/groq.js` imports `OpenAI` from `openai` and points `baseURL` at `https://api.groq.com/openai/v1`. Groq's API is OpenAI-compatible. There is NO `groq-sdk` package installed — do not add one.

### 9.10. PDF fonts
`pdf-lib` embeds `StandardFonts.Helvetica`. Swedish characters (å, ä, ö) render fine, but any Unicode outside WinAnsi will crash. `lib/sanitise-winansi.js` strips non-WinAnsi glyphs from user input before passing to pdf-lib. Use it in any new PDF endpoint.

### 9.11. `resolutions` in `package.json`
`follow-redirects`, `form-data`, `picomatch`, `postcss`, `yaml`, `lodash` are pinned via yarn resolutions to sidestep transitive vulnerabilities and lodash version drift. Do not remove without verifying `yarn audit` stays clean.

### 9.12. `outputFileTracingIncludes` for extension
`next.config.js` has:
```js
outputFileTracingIncludes: {
  '/api/extension/download': ['./extension/**/*'],
}
```
Because that route reads files from `./extension/` at runtime via `fs`. Vercel's bundler tree-shakes serverless functions and would otherwise ship a function that crashes with ENOENT.

### 9.13. Playwright `PORT` fallback
`playwright.config.js` reads `PORT` env var. If `:3000` is occupied by a root-owned process in your sandbox and you can't kill it, do:
```bash
PORT=3001 yarn dev            # in one shell
PORT=3001 yarn test:e2e       # in another
```

### 9.14. `styled` vs `standalone` for extension i18n
`extension/manifest.json` uses `__MSG_extName__` and `__MSG_extDescription__` referring to `_locales/sv/messages.json`. Adding an English locale later means adding `_locales/en/messages.json` with the same keys — do not rename the keys.

---

## 10. Quick Reference Card

**Package manager:** `yarn` (never npm)
**Dev URL:** `http://localhost:3000`
**MongoDB:** `mongodb://localhost:27017/jobbpiloten`
**LLM provider:** Groq (`llama-3.3-70b-versatile`) via OpenAI-compatible SDK
**Cron schedule:** `0 7 * * *` + `0 13 * * *` UTC
**Test command:** `yarn test:unit && yarn test:e2e`
**Build command:** `yarn build`
**Chrome extension:** `yarn package:extension:cws` → upload ZIP

**Auth modes:**
- Clerk configured → real Clerk auth
- Clerk keys empty/xxx → demo mode (cookie `demoUserId=demo-user-001`)

**Primary source files to read first when picking up:**
1. `PROJECT_STATUS.md` — current state + open items
2. `middleware.js` — auth flow
3. `app/api/[[...path]]/route.js` — most backend logic
4. `app/dashboard/page.js` — most frontend logic
5. `lib/groq.js` + `lib/jobScraper.js` — core business logic
6. `tests/unit/` — structural + behavioral locks

**If a test fails, read the test name — it points at the exact file/pattern that regressed.**

---

*End of handoff. Good luck.*
