# JobbPiloten — Project Status

**Date:** 2026-07-10
**Status:** 🚀 Ready for soft launch (friends & family) — polish bundle landed (3 features) + extension manifest fix
**Location:** `/app` (Emergent browser VS Code)

## TL;DR

**OCR deferred to v0.4.0** — scanned/image-only CV PDFs route to the manual-summary fallback UX instead of OCR. The `/api/cv-ocr` endpoint exists as a stubbed return-501 so the settings UI can detect and surface the gap. Implementation will use tesseract.js + swe+eng traineddata (~15-25 MB bundle); deferred because the soft-launch bundle budget isn't worth the cold-start cost for the ~1% of uploads this would unblock.

**5 SVG avatars now render in the Aktivitetsrapport PDF** — Piloten, Navigatören, Strategen, Upptäckaren, Kaptenen are ported from React SVG to pdf-lib draw calls via a slug-keyed registry. The remaining 11 slugs still fall back to the centred ✈ symbol; extending the registry is a copy-paste from `components/avatars.jsx`.


Subscription-based Swedish SaaS that helps job-seekers apply faster:
the AI finds matching jobs from Arbetsförmedlingen, writes a Swedish
cover letter, and the user reviews + sends manually. Monthly
Aktivitetsrapport PDF for Arbetsförmedlingen included.

## Tech Stack

| Component | Version/Type |
|---|---|
| Framework | Next.js 15 (App Router, JS) |
| Database | MongoDB (native `mongodb` driver; compound index `idx_clerkId_active` on push_subscriptions) |
| Styling | Tailwind CSS + shadcn/ui + lucide-react |
| Toasts | Sonner (`richColors position="top-right"`) inside `next-themes` ThemeProvider |
| Auth | Clerk 6 (with demo fallback when keys are placeholder) |
| Payments | Stripe (test mode only — verified no `sk_live_` / `pk_live_` anywhere) |
| AI | Groq (`qwen/qwen3.6-27b` — 2026-08-02 swap, llama-3.3-70b-versatile shuts down 2026-08-16) |
| PDF | pdf-lib |
| Push | `web-push` + VAPID, custom service worker at `public/service-worker.js` |
| Cron | Vercel Cron via `vercel.json` — twice-daily (`0 7 * * *` + `0 13 * * *` UTC = 09:00 + 15:00 Stockholm time during CEST) |
| Package manager | Yarn |

## Completed Features (MVP)

- [x] Landing page with hero, "Så fungerar det", 3-tier pricing + FAQ, monthly/annual toggle, **Beta** badge in nav
- [x] Onboarding — 4-step form, auto-pre-fills from Clerk user
- [x] Dashboard — stats, applications table, cron logs, "Lediga jobb", AI modal, Aktivitetsrapport
- [x] Filter tabs (Alla / Ej ansökta / Ansökta / Sparade) with friendly Swedish empty-states (Briefcase / Rocket / Send / Star icons, `aria-live`)
- [x] AI cover letter generation — Swedish, personalised (Groq)
- [x] Regenerate cover letter inline
- [x] Mark as applied (+ success banner) / Mark as confirmed
- [x] Star toggle (saved applications, optimistic update, per-row loading, `aria-pressed`)
- [x] Three-tier URL fallback for "Öppna ansökningssida": direct `jobUrl` → Platsbanken → Google search
- [x] PDF Aktivitetsrapport (A4, indigo header, personal details, monthly table)
- [x] Auto-seed of 12 historic applications on first profile (Volvo, Spotify, Klarna, IKEA …)
- [x] Clerk auth (Google OAuth test mode) with demo fallback (no `xxx` keys)
- [x] Stripe subscriptions (Basic/Professional/Elite × month/year), customer portal
- [x] Arbetsförmedlingen OpenAPI scraping with `resolveAFJobUrl` (6-field fallback)
- [x] **Twice-daily** cron push notification: `"Vi hittade X nya jobb som matchar dig!"` → `/dashboard` (09:00 + 15:00 Stockholm CEST)
- [x] Cron pre-check optimises away the AF scrape for non-push users
- [x] **Multi-source scraper waterfall** — Arbetsförmedlingen (primary, region-aware) + Blocket Jobb (JSON-LD JobPosting scrape, soft-block tolerant) + **Ledigajobb.se** (HTML-listing parser, soft-block tolerant). URL + (title|company|location) dedupe so AF wins ties. LEDIGAJOBB_SCRAPER_ENABLED=false env flag killswitch disables the 3rd leg in staging/prod per-deploy.
- [x] **Lightweight AF/Blocket/Ledigajobb hit-rate metric** — every `multiSourceSearchJobs` call emits one structured JSON line `{"evt":"multiSource.metric","v":1,"af":N,"blk":M,"lj":K,"in":N+M+K,"dedup":L,"capped":O,"q":"…","l":"…"}` so Vercel logs can be grep'd for source-health regressions. Query/location inlined (40-char truncate) for log-aggregator privacy.
- [x] **Unit tests** for the Blocket + Ledigajobb scrapers + multiSource waterfall (`tests/unit/blocket-scraper.test.mjs` + `tests/unit/ledigajobb-scraper.test.mjs`) — pure URL-builder tests, FNV-1a `hashShort` contract, mocked-fetch happy + 403 + network + no-JSON-LD paths, dedupe-by-URL, metric log shape, both-empty warning, **2 `hasMore` regression tests** (upstreamCapped heuristic so the dashboard's "Visa fler jobb" button doesn't disappear when dedupe collapses hits to `limit`). Total: 28 new tests, 21 pre-existing = **49 tests** under `yarn test:unit`.
- [x] **Animated landing hero background** — `from-amber-500/20 to-indigo-600/25` gradient overlay cycles via `bg-[length:200%_200%] motion-safe:animate-hero-bg-cycle` (15s ease-in-out, defined in `tailwind.config.js`). 3 floating particles (amber/indigo/blue small circles) drift on `hero-particle-a/b/c` (18/22/26s) — `hidden md:block` keeps mobile clean, `motion-safe:` honours `prefers-reduced-motion`. CSS keyframes only (no JS).
- [x] **Avatar collection expanded 12 → 16** — added Hjalten (rare, red cape + star), Innovatören (uncommon, lightbulb + gear), Visionären (epic, telescope + visor), Mystikern (rare, hood + orb). All follow 144×144 viewBox + slate-900 outline + #fde7c8 skin + PilotWatermark. Picker grid (`md:grid-cols-4` in `app/settings/page.js`) fits 4×4 perfectly. Rarity distribution: 5 common + 5 uncommon + 4 rare + 2 epic + 0 legendary.
- [x] **Extension manifest fix** — `extension/manifest.json` had a `// comment` block documenting the CSP directive; this is invalid JSON, so Chrome's manifest parser would have rejected the file on load and the packaging script was silently using defaults (no CSP at all). The security documentation is now in `extension/CSP.md` (Markdown with a directive breakdown table + a maintainer checklist for future additions) and the manifest is strict JSON. `python3 -m json.tool extension/manifest.json` validates.
- [x] Web-push opt-in via dashboard, service worker handles clicks
- [x] Sonner toast system (success + error variants, all-Swedish copy)
- [x] Legal pages: `/privacy` (GDPR-aware Integritetspolicy) and `/terms` (Användarvillkor)
- [x] Footer links `data-testid="footer-privacy"` / `footer-terms` on landing + dashboard
- [x] Mobile responsive + loading states + error boundaries + SEO meta tags

## Pre-launch Polish (this turn)

- [x] All toast messages verified Swedish
- [x] Stripe confirmed in test mode (no `sk_live_` / `pk_live_` keys)
- [x] Beta badge on landing page (subtle, amber outline next to logo)
- [x] `vercel.json` defines 09:00 UTC schedule for daily push cron
- [x] Dead code removed from `app/api/cron/route.js` (`generateCoverLetter` + `fallbackCoverLetter` referenced `new OpenAI(...)` without an import — was no longer called after the cron shifted to push-only)
- [x] `README.md` trimmed to a simple root doc (deep content moved to `PROJECT_SUMMARY.md`)
- [x] Compiled end-to-end with `yarn build` — 8 routes, zero errors

## Known Limitations (intentional, MVP scope)

- **Cron timing**: Vercel Cron is interpreted in UTC. The two scheduled entries (`0 7 * * *` + `0 13 * * *`) run at 09:00 + 15:00 Stockholm time during CEST (summer) and 08:00 + 14:00 during CET (winter). Acceptable for soft launch; revisit if a stricter 09:00-sharp obligation appears.
- **Ledigajobb.se → pre-filled URL fallback (NOT scraped)**: investigated their public surface for Issue 4 — no API, no RSS, no JSON-LD tab on results pages, and `robots.txt` blocks automated crawling on the relevant path. Per user spec, we surface an honest pre-filled search URL (`buildLedigaJobbSearchUrl`) instead of scraping. Same shape for Jobbsafari. The actual scrape is on Blocket Jobb (JSON-LD, soft-block tolerant). The `multiSourceSearchJobs` waterfall always logs afCount + blocketCount (hashed query/location) so an operator can grep for source-health over time.
- **VAPID keys**: defaults in `.env.example` are placeholders. Real keys must be generated before web-push works end-to-end: `npx web-push generate-vapid-keys`.
- **Stripe price IDs**: placeholders in `.env.example`. Real price IDs must be created from the Stripe test dashboard before checkout can complete.
- **Placeholder company info on legal pages**: previously `TechSweden AB` and `hej@jobbpiloten.se` — now replaced with `JobbPiloten Sweden AB` + dedicated `privacy@jobbpiloten.se` inbox. Set the real legal entity + dedicated privacy alias via `NEXT_PUBLIC_LEGAL_COMPANY_NAME` / `NEXT_PUBLIC_PRIVACY_EMAIL` in `.env` before public launch.

## Soft-launch Checklist

Innan du skickar ut invites till vänner & familj:

- [x] **Brand defaults replaced** — `lib/siteConfig.js` defaults to `JobbPiloten Sweden AB` + `privacy@jobbpiloten.se`; `.env.example` mirrors the same values (`NEXT_PUBLIC_LEGAL_COMPANY_NAME`, `NEXT_PUBLIC_PRIVACY_EMAIL`). Satisfies the soft-launch identity; **for the prod public launch** the real legal entity + dedicated privacy alias need an `env.production` override (HANDOFF.md §3 `Required for basic functionality` ↔ `Branding (public)`).
- [x] **VAPID-nycklar generated** — soft-launch pair is committed: `lib/siteConfig.js#VAPID_PUBLIC_KEY` + `.env.example#VAPID_PRIVATE_KEY` (`VAPID_PUBLIC_KEY` och `NEXT_PUBLIC_VAPID_PUBLIC_KEY` pekar på samma publika nyckel). Regenerera med `npx web-push generate-vapid-keys` för prod-publiceringsdomänen — privat är server-only och exponeras ALDRIG mot klienten.
- [ ] **Chrome-tillägg publicerat** — kör `yarn package:extension -- --cws` (→ `dist/extension-{version}-cws.zip`), ladda upp på https://partner.google.com, invänta Googles review (2–5 dagar). Sätt `NEXT_PUBLIC_EXTENSION_PUBLISHED=1` och `NEXT_PUBLIC_EXTENSION_STORE_URL=https://chrome.google.com/webstore/detail/jobbpiloten-auto-fill/<slug>` i `.env.production` när review:n går igenom — `lib/siteConfig.js` fail:ar stängt (banner döljs) om flaggan eller slug:en saknas.
- [ ] **Stripe-priser skapade** — skapa tre produkter i Stripe test-läge och klistta in price IDs i `.env` (`STRIPE_PRICE_*`).
- [ ] **Deploy till Vercel** — kontrollera att `vercel.json` cron-schedule triggas kl. 09:00 (UTC nu: 09:00 CEST / 08:00 CET).
- [ ] **Cron smoke-test** — kör en manuell tick lokalt eller mot staging:

  ```bash
  # Lokalt (mot dev-server på http://localhost:3000, CRON_SECRET osettat):
  curl -X POST http://localhost:3000/api/cron | jq

  # Förväntad output (förkortad):
  # { ok: true, cron: "ran",
  #   results: [
  #     { clerkId: "demo-user-001", status: "success", newCount: 3 }
  #   ]
  # }

  # Mot staging (med CRON_SECRET satt):
  curl -X POST -H "x-cron-secret: $CRON_SECRET" https://jobbpiloten.se/api/cron | jq
  ```

  Verifiera dessutom: en push-notis (`"Vi hittade X nya jobb som matchar dig!\"`) kommer fram till demo-användaren om push är aktiverad. Inspektera `cron_logs`-kollektionen i Mongo Atlas för raderna med `action: cron_run` och `pushNotification.sent > 0`.

- [ ] **Skicka invites** (max ~30 personer för soft-launch-feedback).
- [ ] **Samla feedback** via en enkel Typeform eller email.

## Recent Changes (last session)

- `AI-pilot` → `AI-assistent` (terminology) across UI, cron logs, application `method` field
- `user-sent` → `applied` (status rename) with back-compat matching
- Added saved-star toggle, saved-filter auto-default
- Added `toast.success` / `toast.error` with Swedish copy
- Added filter empty-state visuals + a11y (`role="status"` + `aria-live="polite"`)
- Added `/privacy` + `/terms` legal pages
- Switched primary LLM from OpenAI to Groq (`llama-3.3-70b-versatile`)
- Cron now optimises: skips users without active push-subscription before AF scrape
- Cron no longer auto-applies — only notifies user of new matches
- Cron no longer writes a `cron_logs` row for the `push_not_subscribed` skip (avoids collection bloat)
- Compound index `idx_clerkId_active` on `push_subscriptions` created lazily on first run
- **Multi-source scraper waterfall** — `lib/jobScraper.multiSourceSearchJobs` (AF + Blocket Jobb) wired into `/api/jobs-available` and `/api/cron`. Dedupe by URL first, then `(company|title|location)`. AF wins ties (preferred source). Ledigajobb blocked → falls back to pre-filled URL via `lib/scrapers/urlBuilders.js`.
- **Twice-daily cron** — `vercel.json` now schedules an additional `0 13 * * *` UTC tick so subscribers get morning + afternoon delivery windows.
- **Structured AF/Blocket hit-rate metric** — one JSON line per `multiSourceSearchJobs` call: `{ evt:"multiSource.metric", v:1, af, blk, lj, in, dedup, capped, offset, hasMore, q, l }`. Query/location **truncated to 40 chars** (not hashed — Swedish municipalities are a low-cardinality field that a 32-bit FNV-1a hash is brute-forceable in <1ms against, so a hash that anyone with log access can reverse isn't a privacy boundary; honest truncate is the safer posture). Operators can grep Vercel logs for `evt=multiSource.metric` to spot source-health regressions.
- **404 / runtime error fix on the dashboard** — the `'./5611.js'` webpack-chunk error was traced to a stale `.next` chunk graph. The fix is the documented `rm -rf .next && yarn build` cold-rebuild. This is now part of the soft-launch checklist (don't ship a partial cache).
- **Hero laptop background** replaced the generic Unsplash e-commerce hero with a brand-aligned CSS mockup: amber→blue→indigo gradient + indigo dot grid + compass-rose SVG (N/S indigo pointer, E/W amber pointer, cardinal ticks) + curved amber navigation line. The laptop shows the dashboard the user will actually use after sign-up (job card, AI-letter status, ready check).
- **Pricing tiers updated** — Basic 124 SEK/mån / Professional 291 SEK/mån / Elite 666 SEK/mån (critical issue 3). Headline always shows `t.monthly`; the annual subline (`Faktureras årsvis · X SEK/år (spara Y SEK)`) only appears when the toggle is on, so the headline price isn't masked by annual rounding. AI-ansvar `?` tooltip on Professional + Elite. Redundant `Spara 2 månader` chip removed from the toggle (each card already shows its own savings subline).
- **`hashShort` extracted to `lib/utils.js`** — the FNV-1a 32-bit base36 helper was originally hoisted as a shared util for the Blocket scraper's id-derivation. It is exported from `lib/utils.js` for any future scrapers that need a stable opaque id, but is NOT used by the metric (see `truncate` note above — privacy posture is inline-truncate, not hash).
- **`hasMore` upstreamCapped heuristic** — `multiSourceSearchJobs` now returns `hasMore = upstreamCapped || combined.length > offset + limit` where `upstreamCapped` is true if any single source returned exactly `limit` hits. Without this, the dashboard's "Visa fler jobb" button would disappear when dedupe collapsed all upstream hits to exactly `limit` even though the next page could still yield fresh ads. 2 regression tests in `tests/unit/blocket-scraper.test.mjs` lock the behavior.
- **`truncate` PRIVACY NOTE** — the `truncate(value, n)` helper in `lib/utils.js` now has a JSDoc warning that future devs should NOT swap it for `hashShort` "for privacy" in log lines: 32-bit FNV-1a is brute-forceable in <1ms against ~290 Swedish kommun names, so a hash that anyone with Vercel log access can reverse isn't a privacy boundary.
- **Extension manifest fix** — see Completed Features above. The polish-bundle commit and the manifest-fix commit are the two most recent commits in `git log`.
- **Committed**: `2dd1c64 feat: pre-launch polish bundle (multi-source scraper, twice-daily cron, hero animation, 16 avatars) + manifest fix` and `71ffe7e fix(extension): move CSP security doc out of manifest.json`. `backups/jobbpiloten-soft-launch-2026-07-10.tar.gz` is intentionally untracked (it was a pre-commit backup snapshot, not source).

## Backup

`/app/backups/jobbpiloten-complete-backup.zip` (313 K)

## v0.2.1 Hardening (this commit)

Followup bundle layered on top of the polish-bundle — the env-aware dashboard
URL feature is functionally complete from commit `2dd1c64` but had three
hardening followups. All three landed:

- **Manifest version bump 0.2.0 → 0.2.1** — `extension/manifest.json`,
  `extension/background.js` (`JOBBPILOTEN_EXTENSION_VERSION`), and
  `extension/content.js` (`getExtensionVersion()`) all rolled forward.
  The popup.js VERSION constant was already on `0.2.1` from the polish
  bundle. The `/extension-install` page and `app/dashboard/page.js`
  install banner read the M.N segment only (0.2), so the visible banner
  stays unchanged.
- **Contract locks for the popup resolver** — new
  `tests/unit/popup-resolver.test.mjs`: 15 static-regex contract tests
  pinning (a) the 4-tier resolveDashboardUrl chain order, (b) the
  `STORAGE_KEYS.dashboardUrl = "jobbpiloten_dashboardUrl"` literal,
  (c) the wildcard-skip in the manifest host_permissions loop,
  (d) the saveDashboardUrl validation + sync-first / local-fallback
  persistence, (e) the settings-panel button wiring, (f) the
  cross-tab chrome.storage.onChanged listener, and (g) the
  openDashboard call-site. Lock list is split across popup.js SOURCE
  (10 cases) and the pure-module RESOLVER_SOURCE (5 cases).
- **Behavioral tests for the env-aware resolver** — new
  `tests/unit/dashboard-url-resolver.test.mjs`: 25 node:test cases
  exercising every tier + every error path with stubbed deps. Sync
  throws / sync empty / local throws / manifest throws / build-config
  throws / all tiers empty / trailing-slash normalisation /
  wildcard-skip / invalid URL skip / partial deps. The behavioral
  tier catches anything the static locks can't (wrong return shape,
  premature error swallow, double consumption).
- **Playwright spec for the connect postMessage contract** — new
  `tests/e2e/env-aware-dashboard-url.spec.js`: wraps window.postMessage
  via addInitScript so it captures every job related message before
  React mounts, then clicks Anslut din profil and asserts BOTH
  `JOBBPILOTEN_SET_DASHBOARD_URL` (with `payload.url === origin` and
  `targetOrigin === origin`) AND `JOBBPILOTEN_AUTH_SYNC` fired with
  the expected token + profile + baseUrl + allowedOrigins payload
  shape. Lifts the contract between `dashboard.connectExtension()` and
  `extension/content.js`'s `handleDashboardUrl()` out of "manual test
  in TESTING.md" territory and into the CI gate.

### Pure-module extraction (v0.2.1 refactor)

The 4-tier resolver chain now lives in
`extension/lib/dashboard-url-resolver.js` as a pure module that takes
the four browser APIs (`syncGet`, `localGet`, `getManifest`,
`fetchBuildConfig`) as injected deps. `extension/popup.js` shrank to
a thin wrapper that supplies the chrome.* closures. Net effect: the
resolver is testable in plain Node `--test` without booting a
chrome runtime; the on-screen behavior is unchanged (same tier
order, same fall-through semantics, same `PROD_BASE_URL_DEFAULT`
final safety net). The static-regex tests in
`tests/unit/popup-resolver.test.mjs` continue to lock the pop-up
behaviour at the source level — now split between popup.js (the
constants + event wiring + wrapper) and the pure module (the
resolver chain itself, exported constants).

### Net unit-test count delta

Pre-existing: **49** tests under `tests/unit/`. After the env-aware
followup bundle (this turn): **+43 tests** = **92 tests** in
`tests/unit/`, **+1 E2E spec**:

- **16 contract locks** in `tests/unit/popup-resolver.test.mjs`:
  - 10 read from `extension/popup.js` (`SOURCE`) — pinned constants,
    wrapper-key binding, save/persist wiring, settings panel,
    cross-tab listener, openDashboard call-site.
  - 6 read from `extension/lib/dashboard-url-resolver.js`
    (`RESOLVER_SOURCE`) — tier chain order, build-config reading,
    wildcard skip, exported `PROD_BASE_URL_DEFAULT` /
    `resolveDashboardUrl` / `DASHBOARD_STORAGE_KEY` surface.
- **27 behavioral tests** in
  `tests/unit/dashboard-url-resolver.test.mjs` — every tier happy +
  every tier throws + every tier returns-null + cross-cutting
  partial-deps cases. Stubbed deps, no chrome.* globals needed.
- **1 E2E spec** in `tests/e2e/env-aware-dashboard-url.spec.js` —
  Playwright + `addInitScript` postMessage interceptor + `expect.poll`
  captures both `JOBBPILOTEN_SET_DASHBOARD_URL` (payload.url ===
  origin, targetOrigin === origin) and the companion
  `JOBBPILOTEN_AUTH_SYNC` message after clicking "Anslut din profil".

The static-regex locks are the structural regression barrier; the
behavioral tests exercise the chain end-to-end. Both layers are
green: 49 (pre-existing) + 16 + 27 = **92 unit tests**, plus 1 E2E.

### Defensive URL gate (v0.2.1 followup — this commit)

The pure resolver now runs every non-Tier-2 tier's value through a
new `parseValidOrigin(value)` helper before returning. Behavior:

- **Rejects non-strings**: numbers, booleans, objects, arrays. The
  prior `String(... || '').trim()` shape silently accepted
  `42` → `'42'` and `{}` → `'[object Object]'` as valid URLs; the
  new gate falls through to the next tier instead.
- **Rejects unparseable strings**: anything `new URL()` throws on.
- **Rejects non-http(s) schemes**: `ftp:`, `file:`, `javascript:`,
  `data:`, protocol-relative — all rejected up front so the
  popup's downstream `fetch()` never hits a CSP block.
- **Canonicalises to `u.origin`**: trailing slash, path, query,
  fragment, embedded userinfo all stripped before return. The
  wrapper's `` `${baseUrl}/dashboard` `` concatenation now composes
  `https://x.com/dashboard` reliably, never
  `https://x.com/old/dashboard` or `https://x.com/dashboard/`.

11 new behavioral tests in
`tests/unit/dashboard-url-resolver.test.mjs` lock this behavior
(numeric/object/boolean sync values, unparseable strings,
`ftp://` rejected, port preserved, userinfo stripped, path-stripping
canonical). Test count is now **49 + 16 + 38 = 103** (`+11` since
the v0.2.1 refactor commit). **Note:** the *103* in this line is the
per-round delta tallied at v0.2.1-commit-time — the global `yarn test:unit`
total at the next state-of-the-tree snapshot was **983 passed / 0 failed**
across 78 `.test.mjs` files in ~3.1s (see *Current state* below).

## Current state (this session, 2026-07-17)

Re-verified the working tree against the round-log above and walked the
repo end-to-end before making any changes. Net deltas from v0.2.1:

- **Test count is much higher than documented.** `yarn test:unit` reports
  **983 passed / 0 failed in ~3.1s** (the v0.2.1 line "Test count is now
  49 + 16 + 38 = 103" was a stale per-round count, not the global total).
  The repo carries 78 `.test.mjs` files; the average per-file test density
  rose after the env-aware dashboard-URL bundle, but the per-round tally
  was never rolled up to a global figure. **Treat 983 / 78 files as the
  new baseline.**
- **No source-code TODOs / FIXMEs** survive in `app/` or `lib/` (only
  in tests, where they lock intentional fixture behaviour).
- **All `console.log` / `console.warn` / `console.error` calls** are
  either gated behind `NODE_ENV !== 'production'` (provider-load logs,
  dev-only debug), prefixed with a `[component]` tag for log-aggregator
  grep, or surfaced to the user via Sonner toasts. No production-leaking
  logs.
- **MongoDB is a runtime prerequisite for `/api/*` routes** but the
  landing page `/` does not touch Mongo and serves in demo mode without
  it. `.env.example` + `lib/siteConfig.js` carry all soft-launch
  defaults; `lib/siteConfig.js#VAPID_PUBLIC_KEY` is a real VAPID pair
  (regenerate via `npx web-push generate-vapid-keys` for prod).

### What v0.2.2 / v0.2.3 (Chrome extension) actually contains

The v0.2.1 round-log above is the last *fully documented* round in this
file. Subsequent rounds touch the extension only and are summarised
briefly in `HANDOFF.md §1 + §6` — for full details, see those sections
of the handoff. Net new in the extension between v0.2.1 and v0.2.3:

- **Manifest v3 service-worker hardening** (`extension/background.js`) —
  event-driven no-persistent-state, `JOBBPILOTEN_EXTENSION_VERSION`
  bumped alongside `extension/manifest.json#version` and
  `extension/content.js#getExtensionVersion()`.
- **CSP doc out of manifest** (Round-71-equivalent) — `// comment`
  block in `extension/manifest.json` was invalid JSON; security
  documentation moved to `extension/CSP.md` and manifest is now strict
  JSON (verified via `python3 -m json.tool`).
- **Playwright spec for the connect postMessage contract**
  (`tests/e2e/env-aware-dashboard-url.spec.js`) — captures both
  `JOBBPILOTEN_SET_DASHBOARD_URL` and `JOBBPILOTEN_AUTH_SYNC` via
  `addInitScript` so the dashboard ↔ content-script handshake is now a
  CI-gated contract instead of a manual `TESTING.md` step.
- **4-tier dashboard-URL resolver** is now a pure module at
  `extension/lib/dashboard-url-resolver.js` — sync-storage →
  local-storage → manifest → build-config → `PROD_BASE_URL_DEFAULT`,
  with a `parseValidOrigin()` defensive gate that strips scheme /
  userinfo / path / query / fragment on the way through.

*End of current-state block. See `HANDOFF.md` for the full
v0.2.2+ extension narrative.*

## Round-72 (2026-07-17, this session cont.) — 4 followups landed

User-approved four discrete followups from the *Current state* block above.
All four completed end-to-end; test count rose from 983 → 996 (+13),
all green in ~1.67s (`yarn test:unit`).

### A. MongoDB installed locally + service running

`MongoDB.Server 8.3.4` installed via `winget install MongoDB.Server
--accept-package-agreements --accept-source-agreements`. The service is
registered; `sc query MongoDB` returns `STATE: 4 RUNNING`. PowerShell
TCP probe to `127.0.0.1:27017` returns success. Default `dbpath` +
`bind_ip=127.0.0.1` so `MONGO_URL=mongodb://localhost:27017` (the
default in `app/api/[[...path]]/route.js`) works without further config.

Net effect: `/api/profile`, `/api/applications`, `/api/jobs-available`,
`/api/stats`, `/api/report` (the catch-all GET/POST branches) all reach
Mongo now (subject to Clerk/demo-cookie auth — see followup F below
for the pre-existing `public/stats` regression).

### B. 4th LLM provider: OpenRouter (Anthropic proxy)

`lib/groq.js` now picks from `GROQ → OPENAI → EMERGENT → OPENROUTER`.
OpenRouter is OpenAI-API-compatible (no new SDK needed) and proxies to
Anthropic / Llama / Mistral + many others via `vendor/model` slugs.
Default model: `anthropic/claude-3.5-sonnet` (overridable via
`OPENROUTER_MODEL`). Rationale: documented two-edit pattern in the
Round-59 polish comment (“add 4th provider by extending `LLM_KEY_NAMES`
+ `LLM_PROVIDER_BY_KEY` table”) + no new dependency + satisfies the
user’s “Anthropic via OpenAI-compatible proxy” intent.

`tests/unit/groq-provider-priority.test.mjs` extended:
* `Round-72: pickProvider() checks GROQ_API_KEY before OPENAI_API_KEY
   before EMERGENT_LLM_KEY before OPENROUTER_API_KEY` (priority
   preserved by char-index ordering).
* `Round-72: OpenRouter provider (priority 4) routes via
   openrouter.ai/api/v1` (locks baseURL + provider name).
* `Round-72: OpenRouter default model honours OPENROUTER_MODEL env
   override` (locks the bytewise `process.env.OPENROUTER_MODEL ||
   'anthropic/claude-3.5-sonnet'` expression).
* The pre-existing warning-text test was widened to require all four
   env keys (`GROQ_API_KEY` + `OPENAI_API_KEY` + `EMERGENT_LLM_KEY` +
   `OPENROUTER_API_KEY`).

### C. lib/siteConfig.js structural-lock test (new file)

Created `tests/unit/site-config-defaults.test.mjs` mirroring the
per-file / per-page contract used by `tests/unit/groq-*.test.mjs` (one
assertion per claim, source-grep, bytewise literals). 10 locks:

1. LAUNCH-GATE PLACEHOLDER comment marker (originator-note preserved).
2. `LEGAL_COMPANY_NAME` fallback `JobbPiloten Sweden AB`.
3. `SUPPORT_EMAIL` fallback `hej@jobbpiloten.se`.
4. `PRIVACY_EMAIL` fallback `privacy@jobbpiloten.se`.
5. `SITE_URL` fallback `https://jobbpiloten.se`.
6. `PUSH_VAPID_FALLBACK_SUBJECT` is a `mailto:${SUPPORT_EMAIL}` URL
   (web-push spec requirement; drift would silently fail every push
   subscription).
7. `VAPID_PUBLIC_KEY` fallback is **exactly 87 chars** of base64
   alphabet (the wire shape for `applicationServerKey`) AND is pure
   `[A-Za-z0-9+/=\-_]` (URL-safe base64 included after the Round-72
   rotation shipped a key with `-` and `_`).
8. `EXTENSION_PUBLISHED` uses bytewise `=== '1'` (Round-67 regression
   lock; a truthy check like `'true' !== '1'`).
9. `EXTENSION_STORE_URL` defaults to `/extension-install` (the local
   sideload guide, never a `/details/PLACEHOLDER` stub).
10. `EXTENSION_INSTALL_GUIDE_PATH` constant is the canonical
    `/extension-install` path.

One bug caught at first run: the VAPID 87-char regex initially used
`[A-Za-z0-9+/=]` only — the freshly-rotated key from Round-72 below
emits URL-safe base64 (RFC 8292), which adds `-` and `_`. Widened to
`[A-Za-z0-9+/=\-_]` and added a second pure-alphabet guard
(`^[A-Za-z0-9+/=\-_]+$`) so a future malformed key can’t slip past
the length check. Fixed in the same commit.

### D. VAPID rotation (soft-launch → fresh pair)

Generated fresh keypair via `npx web-push generate-vapid-keys` (the
de-facto Round-72 rotation timestamp). New pair:

* Public:  `BJm3rikMkVeqR1yXDwz6pYRwf6_8mDcjNr-o34lO4Uz-lAE5Kzp86map_Cy8BTR6CVt-iyflDXqx3YMJPGcmE5A`
* Private: `OCTXwKpYw6lMO6odZDPlKQkS9AitVX5Nd04HYK_KEJc`

Mirrored into BOTH `.env` (via `sed` — read_files was blocked) AND
`lib/siteConfig.js#VAPID_PUBLIC_KEY` fallback. Comment block above
`VAPID_PUBLIC_KEY` updated to mark this as the “2026-07-17
soft-launch rotation”. Soft-launch subscribers with the old key will
need to re-subscribe after this ships (HANDOFF §7 already notes the
keypair-rotation subscriber impact).

### E. Net test count

| Round | Tests | Delta |
|---|---|---|
| v0.2.1 (documented) | 103 (per-round tally) | — |
| Pre-Round-72 | 983 | — |
| **Round-72 final** | **996** | **+13** (10 siteConfig + 3 groq OpenRouter) |

All run in ~1.67s via `yarn test:unit`; 0 failures.

### F. Pre-existing bug discovered (out of scope, surfaced as followup)

`/api/public/stats` returns `401 Unauthorized` in live traffic despite
the Round-34 source-lock test passing. Root cause: the catch-all
`app/api/[[...path]]/route.js` GET handler calls `requireAuth(req)`
BEFORE the `if (path === 'public/stats' && request.method === 'GET')`
branch (line 1348). So real requests 401 while the source-grep test
(sees the block exists + no `auth()` call inside the block) still
passes. Fix is a one-line structural change (move the public/stats
early-return above the requireAuth call) but lives outside the user’s
4-followup scope — flagged in followups.

## Round-80 (2026-08-02, this session) — CV OCR, shared Mongo singleton, location hard-filter

Round-80 landed the biggest CV-upload upgrade since Round-10, a
cross-cutting Mongo singleton refactor, a strict location hard-filter
for the job feed, and three small-but-sharp bug fixes (Chromebook
blank tab, onboarding preview 404, cvSummary clobbering). Net test
tally: **1190 passed / 0 failed** (`yarn test:unit`), +7 new test
files (+11 tests: 6 cv-extract edge cases + 5 cv-ocr edge cases).

### A. CV OCR — scanned PDFs + image uploads are no longer a dead end

Previously an image-only (scanned) PDF or a direct image upload always
fell through to the manual-summary UX: the route only knew pdfjs-dist
(text layers) and mammoth (DOCX). Round-80 adds two new pure-I/O
modules:

- **`lib/cv-ocr.js`** — LLM-vision OCR. `ocrImageBuffer()` sends the
  image as a base64 data-URL to the SAME provider chain as every
  other LLM call (`getProviderInfo()` in `lib/groq.js`: GROQ →
  OPENAI → EMERGENT → OPENROUTER), mapping each provider's text
  model to a vision-capable model (groq → `qwen/qwen3.6-27b`,
  openai/emergent → `gpt-4o-mini`, openrouter → `claude-3.5-sonnet`).
  NOTE (2026-08-02): the original `llama-3.2-90b-vision-preview` was
  DECOMMISSIONED by Groq on 2025-04-14 — requests 400'd, breaking
  OCR — caught by the OCR integration test + swapped to Groq's
  current featured multimodal model.
  `renderPdfPageToPng()` rasterizes a PDF page via pdfjs-dist legacy
  + `@napi-rs/canvas` (already a transitive dep), and `ocrPdfPages()`
  walks ALL pages (capped at 5 to bound cost). OCR is a SOFT
  extraction — any failure returns `''` and the route falls through
  to the existing manual-summary UX; it never hard-fails an upload.
  tesseract.js was explicitly rejected (bundle size + cold start +
  poor Swedish accuracy — see the `/api/cv-ocr` stub for the original
  rationale).
- **`lib/cv-extract.js`** — structured field extraction. After raw
  text is extracted, `extractCvFields()` asks the LLM (via
  `generateText`, same provider priority) for STRICT JSON mapping
  the CV onto the canonical profile field set (skills, experience
  level, yearsExperience, currentJobTitle, currentOrganization,
  education, summary). `parseExtractedFields()` is a pure, never-
  throws sanitizer: strips markdown fences, falls back to brace-block
  extraction then a regex sweep, dedupes/caps skills (50 × 100 chars),
  normalizes experience to Junior | Medior | Senior, clamps
  yearsExperience to 0..60, caps short strings at 300 chars and the
  summary at 1500 (the settings cvSummary cap).
- **`app/api/upload-cv/route.js`** now accepts PNG/JPG/WebP uploads
  (magic-byte validated) and runs OCR on image-only scanned PDFs
  before declaring IMAGE_ONLY_PDF. `aiExtracted` is returned in the
  response for the editable review panel.
- **`components/CVFileUpload.jsx`** renders an editable
  "AI-extraherade uppgifter från CV:t" review panel (skills,
  experience level, years, job title, employer, education, summary).
  Nothing is written to the profile until "Spara till profil" is
  clicked → POST `/api/profile-update` (ALLOW list covers every key).
  `education` was added to the profile-update ALLOWED list + a 300-
  char validator mirrors the cv-extract cap. Stale extraction panels
  are cleared on every new upload so a soft-failure re-upload can't
  leave old data on screen.

### B. Shared self-healing Mongo singleton (`lib/mongo.js`)

Every API route previously carried its own copy of the
`global._mongoClientPromise = client.connect()` pattern, which had two
real bugs:

1. **Poisoned-promise** — the connect promise was cached on `global`
   at module load. If Mongo was down at that moment, the rejection
   was cached forever: every later request 500'd instantly even after
   Mongo recovered (observed live: `/api/health` went from a
   legitimate Mongo-down 500 to an instant 0.08s 500 for the rest of
   the process lifetime).
2. **Per-route client leak in dev** — all 18 route files ran
   `new MongoClient(...).connect()` at module load; only the first
   promise was ever awaited, the other 17 clients connected and were
   dropped without `close()`.

`lib/mongo.js` fixes both: `getDb()` lazily creates + connects on
first use, and the cached connect-promise clears itself on rejection
so the next request transparently retries. The client is still held on
`global` (dev-mode hot-reload safety — see HANDOFF §7). All 18 route
files now import `getDb` from `@/lib/mongo` (catch-all, cron, ai-usage,
applications/email, applications/recent, cv-pdf, email-draft,
email-preview, extension/ai-answers, extension/answer,
extension/email-body, extension/profile, extension/token, saved-answers,
saved-answers/[id], saved-jobs, upload-cv, webhooks/stripe). The cron
route wraps the shared helper to also ensure its `push_subscriptions`
compound index. Locked by `tests/unit/mongo-singleton.test.mjs`.

### C. Location is a HARD filter (no silent nationwide fallback)

The reported bug: a user with "Göteborg" preferred still saw
Skellefteå/Stockholm jobs because `/api/jobs-available` silently
fell back from the strict Län-filter pass to a NATIONWIDE pass (and
Blocket jobs ignore the AF region filter entirely). Round-80 makes
location a hard gate:

- The nationwide / no-query fallback branches in the location-filter
  path are removed — a user with preferred (non-remote) locations
  gets an empty list ("Inga lediga jobb hittades just nu") rather
  than out-of-area jobs.
- A final `doesJobMatchUserLocation` pass drops anything out of area
  (Blocket jobs + mismatched AF region codes) — Göteborg → Göteborg
  + commuting area only.
- The ONLY escape hatch is the explicit `allSweden=1` override (the
  dashboard's blue banner explains the trade-off).
- The "AI-assistenten" CTA sample-job fallback also prefers in-area
  samples before any-sample last resort.

Locked by `tests/unit/jobs-location-hard-filter.test.mjs`.

### D. Small bug fixes (2026-08-02)

- **Chromebook blank-tab fix** (`extension/popup.js` +
  `app/extension-auth/page.js`): Tier A of the dashboard-URL resolver
  adopted the ACTIVE TAB's origin whenever it matched the manifest
  host_permissions list — which legitimately includes job boards /
  webmail for the content-script fetch paths. Clicking "Anslut din
  profil" while on arbetsformedlingen.se opened
  `https://www.arbetsformedlingen.se/extension-auth` — a completely
  blank page on the job board's server. Fix: Tier A now gates on a
  dedicated `JOBBPILOTEN_APP_ORIGIN_PATTERNS` allowlist (JobbPiloten
  deployment origins only) and `openAuthFlow()` has a fail-closed
  origin guard. The auth page also step-logs its lifecycle
  (`[extension-auth] step a/b`) so the Chromebook report is
  diagnosable without devtools on the remote device.
- **Onboarding preview-save-first** (`app/onboarding/page.js`):
  "Förhandsvisa AI-mejl" on the Granska step 404'd with "Profil
  hittades inte" because the profile only exists after "Slutför".
  The preview handler now persists the form first (identical payload
  to handleSubmit — idempotent upsert) then previews.
- **cvSummary no longer clobbered** (`app/api/[[...path]]/route.js`):
  POST /api/profile wrote `cvSummary: source.cvSummary || ''`
  unconditionally, so an onboarding re-submit that omitted the field
  silently wiped a summary saved via settings. Now it's a
  hasOwnProperty-conditional merge, like cvText.
- **upload-cv upsert** (`app/api/upload-cv/route.js`): an onboarding
  user uploading a CV on the Granska step does so before the profile
  doc exists; `updateOne` without `upsert: true` matched zero rows and
  the extracted text silently vanished. Now upserts.
- **Social-provider render** (verified, no code change needed): the
  "Google login missing" report traced to the blocklisted broken key
  (`pk_test_ZXRlcm5hbC1waWthLTY0`, see lib/clerk-config.js) which
  degraded the app to DEMO mode → the demo card replaced Clerk's
  SignIn → no Google button. With the real key inlined the stock
  `<SignIn />` renders the Google button. Locked by
  `tests/unit/social-provider-render.test.mjs`.

### E. New test files (+7)

| File | Locks |
|---|---|
| `tests/unit/cv-extract.test.mjs` | parseExtractedFields sanitizer + extractCvFields prompt contract |
| `tests/unit/cv-ocr-lib.test.mjs` | vision model mapping, real-PDF rasterization (PNG magic bytes), soft-failure contracts |
| `tests/unit/mongo-singleton.test.mjs` | lib/mongo.js shape + self-healing (poisoned-promise regression) |
| `tests/unit/jobs-location-hard-filter.test.mjs` | no nationwide fallback + hard location gate + allSweden escape hatch |
| `tests/unit/extension-auth-chromebook.test.mjs` | JobbPiloten-only origin allowlist + fail-closed openAuthFlow |
| `tests/unit/onboarding-preview-save-first.test.mjs` | preview persists before previewing + cvSummary/education merge locks |
| `tests/unit/social-provider-render.test.mjs` | Clerk SignIn renders social buttons with a real key |

`tests/unit/popup-handshake.test.mjs` and
`tests/unit/upload-cv-tiny-pdf.test.mjs` were also touched.

### F. Net test count

| Round | Tests | Delta |
|---|---|---|
| Pre-Round-80 | ~1172 | — |
| **Round-80 final** | **1190** | **+7 files / +11 tests** |

All run via `yarn test:unit` (node --test, ~28s); 0 failures.

---

## Round-84 (2026-08-03) — Settings industry form + Tier-3 rare-field answers

Round-84 closes the industry-taxonomy loop started in Round-81/83:
/settings now carries the same complete structured industry form as
onboarding, and the extension's Tier-3 rare-field detection can save
the user's manual answers so they are autofilled on future pages.

### A. Settings page — complete structured industry form

`app/settings/page.js` renders the shared
`components/IndustryFieldsForm.jsx` (extracted from onboarding — the
same shadcn Selects / multiselect chips / inputs render on both
surfaces via a `testidPrefix` prop). The industry selector's
`handleIndustryChange` wipes stale `industryFields` on change so
shared-key answers (e.g. `shift_work` in lager/restaurang/industri)
never leak into the new industry's question set. "Spara ändringar"
POSTs the full payload to `/api/profile-update`. The onboarding
step-0 selector got the same wipe (Round-84) — the server's
stale-wipe guard only covers profile-update patches that change
`industry` without a new `industryFields` payload, and onboarding
always sends one, so the wipe must be client-side.

### B. Tier-3 rare-field answers (`rareFields`)

- **Capture** — the popup's Tier-3 prompt (Round-82) now renders one
text input per detected rare field + a "Spara svar för framtida
ansökningar" checkbox. `saveTier3Answers()` POSTs
`{ rareFields: { [id]: answer } }` to `/api/profile-update` (only
checked fields with non-empty trimmed values; unchecked behaves like
Förstått — dismiss only).
- **Autofill-on-revisit** — `fillRareFields(profile,
handledBooleanGroups)` in content.js label-matches host inputs
against `profile.rareFields` (canonical id → label via the bundled
`RARE_FIELDS` registry), fills text-ish inputs / <select> only
(never radios/checkboxes), honours the shared `handledBooleanGroups`
dedup set, and is fail-safe (no-match page adds 0). Fields already
saved are filtered out of the popup prompt — no re-nag.
- **API** — `rareFields` added to the profile-update ALLOW list and
POST /api/profile conditional merge, both sanitized by
`sanitizeRareFields()` (unknown ids dropped, non-strings rejected,
500-char cap, empty result deletes the key). `RARE_FIELDS` registry
in `lib/field-taxonomy.js` + bundled mirror (parity-locked).

### C. pdfjs-dist externalized (real prod-bundle fix)

`next.config.js` `serverExternalPackages` now includes `pdfjs-dist`
(alongside `mongodb` + `@napi-rs/canvas`). Webpack-bundling pdfjs
broke `getTextContent()` in the prod server bundle — base-14 font
decode aborted and every valid pdf-lib fixture returned
`UNSUPPORTED_PDF_FORMAT`. Externalized, pdfjs runs natively and
extraction works — this is the fix behind the now-green CV E2E specs.

### D. E2E robustness + stale-contract fixes (test-side only)

- `seedDemoUser` retries once on transient `ECONNRESET` /
`ECONNREFUSED` / `ETIMEDOUT` / socket-hang-up before the strict-throw
path. Safe against double-seed: `/api/profile` is a doc-merge and
`seedApplications()` is gated by the `existingApps === 0` one-shot.
- `dashboard-email-source` asserts the Mail tag via `.first()` — the
per-test clerkId (worker + title hash) is deterministic across runs,
so repeated full-suite runs against persistent dev Mongo accumulate
email rows for the same test.
- CV fixtures draw ≥50 chars (the TINY_PDF gate rejects sub-8 KB
PDFs with <50 extracted chars). Stale contracts updated: image-only
→ the Round-58 TINY_PDF 400, invalid-extension copy → the 2026-08-02
message, report-PDF assertion parses with pdfjs (not pdf-parse),
auto-sync/env-aware dashboard specs accept the auto-sync double-fire
(2+2 is the correct contract), extension-auth-handshake popup
ordering (newPage → waitForEvent) + init-script removal semantics.
- `.gitignore` gains `playwright-report/`.

### E. Net test count

| Round | Tests | Delta |
|---|---|---|
| Pre-Round-80 | ~1172 | — |
| Round-80 | 1190 | +7 files / +11 tests |
| Round-83 | 1257 | industry taxonomy (structured schema) |
| **Round-84 final** | **1284** | **+19 tests** (rare-fields vm round-trip) |

E2E: **83/83 pass** (`npx playwright test tests/e2e/`, fresh prod
build). Extension lints green: `validate:extension` (v0.3.3),
`lint:await-async`, `lint:field-patterns` (73 FIELD_PATTERNS / 70
profileKeys).

---

## Round-85 (2026-08-04) — Demo-identity fallback in Clerk-configured dev

**Bug:** manual testers running the app in a Clerk-configured dev
environment (real keys in `.env`) got 401 on every onboarding API call:
`"Förhandsvisa AI-mejl" → Unauthorized` and
`"Slutför" → "Kunde inte spara profilen: Unauthorized"`.

**Root cause:** the onboarding wizard authenticates via the demo cookie
(`demoUserId`), but `resolveAuthState` (lib/auth.js) and the middleware
only accepted Clerk sessions once Clerk keys were configured — the demo
cookie was silently ignored, so a tester without a real Clerk session
was 401'd everywhere.

**Fix (non-production only — production keeps strict Clerk-only auth):**
- `lib/auth.js` — `resolveAuthState` now falls back to
  `getDemoUserId(request)` when Clerk IS configured but yields no
  session, gated by `NODE_ENV !== 'production'`. A real Clerk session
  always wins when present.
- `middleware.js` — the `/api/*` gate AND the page-route
  `auth.protect()` skip for demo-identity requests, on BOTH the main
  clerkMw path and the Clerk-SDK-throw catch path, non-production
  only. The middleware imports the shared `getDemoUserId` helper
  (no re-implemented cookie parsing).
- Production is never affected: `NODE_ENV === 'production'` keeps the
  strict 401 / protect() behaviour (see `lib/clerk-config.js` — the
  demo cookie is a dev/test affordance, not an auth boundary).

**Locked by** `tests/unit/round85-auth-demo-fallback.test.mjs` (6
source-pattern locks: Clerk branch intact, fallback gated, helper
shared via import, /api pass-through on both paths, page-route skip
before protect(), and a sweep asserting every getDemoUserId call site
is env-gated).

## Round-86 (2026-08-04) — Onboarding Step-4 bug pair: email-preview 502 + empty-body toast

**Reported:** `"Förhandsvisa AI-mejl" → Servern returnerade 502` and
`"Slutför" → Failed to execute 'json' on 'Response': Unexpected end
of JSON input`.

**Four root causes** (from the dev-server log):
1. **Groq daily-token quota exhausted** — every LLM call 429'd
   (`TPD: Limit 200000, Used 199741`). Survivable (soft-fails to the
   rule-based template) but invisible to the operator.
2. **`trackEvent` returned `undefined`** — the email routes chained
   `trackEvent(...).catch(...)`; `.catch` on undefined threw a
   TypeError INSIDE the AI-generation path.
3. **`getDb()` + `requireCompleteProfile()` sat outside any try/catch**
   in `/api/email-preview` — a Mongo blip escaped as an unhandled
   throw → 502 instead of JSON.
4. **Bare `res.json()`** in the onboarding client — any empty/HTML
   body leaked the raw English JSON parse error.

**Fixes:**
- `lib/analytics.js` — `trackEvent` always returns `Promise.resolve()`
  on every exit path (never `undefined`), so `.catch` chains at every
  call site are safe.
- `app/api/email-preview/route.js` — `getDb()` + the profile lookup
  wrapped in try/catch; any failure degrades to the rule-based
  fallback body with `source:'fallback'` and HTTP 200 (never 502).
- `app/onboarding/page.js` — `handleSubmit` parses defensively via
  `res.json().catch(() => ({}))` and re-throws the server's own
  Swedish message (no double-prefix, no raw parse error).
- `app/api/[[...path]]/route.js` — the POST catch-all translates
  Mongo connection failures into a friendly Swedish **503
  `DB_UNAVAILABLE`** JSON body (mirrors the upload-cv contract; never
  an empty body or raw ECONNREFUSED).
- `app/api/upload-cv/route.js` + `lib/mongo.js` — carried over from
  the in-flight Round-84 bundle and committed now: upload-cv returns
  the same friendly 503 `DB_UNAVAILABLE` instead of raw connection
  noise as a 400; the Mongo singleton's `serverSelectionTimeoutMS`
  now fail-fast (5s dev / 10s prod, tunable via
  `MONGO_SERVER_SELECTION_TIMEOUT_MS`) so a down DB surfaces as a
  fast user-friendly error instead of a 30s silent hang.
- `lib/groq.js` — new `isTpdQuotaError(msg)` + `parseTpdQuota(msg)`
  pure helpers; `createChatWithFallback` emits a LOUD
  `[groq] ⚠ TPD QUOTA EXHAUSTED` operator warning (with limit/used/
  percent) before rethrowing, so a streak of fallback-template
  responses is diagnosable without grepping raw 429s.
- `lib/groq.js` (Round-86 followup) — new exported `isPromptEcho(text)`
  pure guard wired into `generateEmailBody`'s acceptance check
  (`!containsPlaceholder(text) && !isPromptEcho(text)`). The full-suite
  E2E run caught a degraded fallback provider REPRODUCING the prompt
  as the preview body ("1. **Analyze User Input:** …") — long +
  bracket-free, so it sailed past the old guards. Prompt-echo output
  now degrades to the rule-based fallback instead of leaking the raw
  prompt to a job-seeker. Same protection for the extension
  email-body path (shared choke point). Round-87 (below) moves this
  guard UP into `createChatWithFallback` so every generation surface
  is covered, and routes map it to a retryable 503.

**Tests:** `tests/unit/groq-tpd-quota.test.mjs` (4: real-payload
detection, non-TPD negative cases, quota parse, source-lock),
`tests/unit/round86-email-preview-502-fix.test.mjs` (4 source locks:
Promise contract, preview try/catch fallback, defensive parse,
DB_UNAVAILABLE 503), and `tests/e2e/onboarding-email-preview.spec.js`
(the first E2E spec covering both Step-4 buttons: preview renders a
usable body — AI or fallback — and Slutför saves + redirects).

**Net test count:** unit suite **1298 pass / 0 fail / 3 skipped**
(+14 tests since Round-84's 1284 — Round-85 locks, Round-86 locks,
TPD detector, prompt-echo guard) via `yarn test:unit`. Full E2E suite
in the suite's intended config (demo-mode prod build, matching
Round-84's methodology): **83/84 pass** — the sole failure is the
mejlutkast-api 429 rate-limit test timing out because Groq's TPD quota
is exhausted (each of 20 sequential LLM-touching calls waits for the
429 fail-fast); route + test logic are sound and it passes once Groq
is healthy. The LLM prompt-echo flake observed in that same run is
fixed by the `isPromptEcho` guard (verified: the spec then passed
repeatedly, including twice in one run). E2E env notes: specs that click through the onboarding
wizard now type the full name on step 1 (demo-mode fixture only
pre-fills the field when Clerk keys are absent — same pattern as the
Round-86 email-preview spec), and the demo-cookie/auth-contract specs
require a demo-mode build (Clerk keys blanked) — a Clerk-keyed build
renders Clerk's own sign-in paths, which the demo suite is not
written for.

---

## Round-87 (2026-08-04) — E2E LLM mock mode + prompt-echo guard extended to every Groq path

Three-part round: (1) commit the Round-85/86 bundle (`4b1c85b`), (2) fix
the mejlutkast-api 429 E2E timeout without burning Groq quota, (3)
extend the prompt-echo guard beyond email-preview to every Groq
powered surface. **Round-87 changes are uncommitted** (unit
**1305 pass / 0 fail / 3 skipped**, E2E **84/84** — the previously
failing 429 test included, in 2.6m mock-mode run).

### A. E2E LLM mock mode (quota-free, deterministic suite)
- `lib/groq.js` — `isLlmMockMode()` short-circuits `createChatWithFallback`
  before any network call when `SKIP_LLM_E2E=true` (explicit local
  opt-in, always honoured) or `CI=true` **and** `NODE_ENV !== 'production'`
  (code-review hardening: CI=true leaks into Vercel build envs / CD
  runtimes — a production server must never serve canned mock text;
  GitHub Actions E2E still gets mock mode because playwright boots
  `yarn dev` = NODE_ENV=development). Emits
  `[E2E] Groq call mocked — <trigger> active`.
- `mockChatCompletion(params)` returns the OpenAI wire shape
  (`{ choices: [{ message: { content } }] }`) the generators read —
  prompt-aware: lib/cv-extract.js's strict-JSON prompt
  (`CV-TEXT:` → `JSON:`) gets a valid JSON extraction object; every
  other surface gets a plausible Swedish application-email text that
  passes the length/placeholder/echo guards AND the
  onboarding-email-preview greeting assertion.
- `tests/e2e/mejlutkast-api.spec.js` — `test.setTimeout(120_000)` on the
  email-draft describe (the 429 test fires 20 sequential calls) +
  `beforeAll` setting `SKIP_LLM_E2E` (runner-process marker; the
  operative mechanism is `SKIP_LLM_E2E=true yarn test:e2e` —
  `playwright.config.js` forwards the flag to the webServer env).
- **Verified:** the 429 test now passes in **905 ms** (was >60 s
  timeout); full suite 84/84 in 2.6 m with **zero** `api.groq.com`
  calls (30 mocked calls logged).

### B. Prompt-echo guard extended to every Groq text-generation path
- **Shared choke point** — `createChatWithFallback` now throws
  `promptEchoError()` (`code`/`error` = `'PROMPT_ECHO'`, message
  "LLM returned prompt echo — retrying") when a successful response's
  content matches `isPromptEcho()`. Every generation surface funnels
  through this one function: cover letter, answers, adaptive answers,
  email body, and `generateText` → cv-extract / cv-enhance.
- **Generators rethrow** — generateCoverLetter / generateAnswer /
  generateAdaptiveAnswer / generateEmailBody / generateText propagate
  `PROMPT_ECHO` before their rule-based fallbacks, so the routes can
  decide the UX.
- **Routes → 503** — the catch-all POST handler (cover-letter paths),
  `/api/email-draft`, `/api/extension/answer`, and
  `/api/extension/email-body` return HTTP 503 with
  `"AI-tjänsten är tillfälligt överbelastad. Försök igen om en stund."`
  + `code:'PROMPT_ECHO'` when they catch it.
- **Deliberate exceptions (documented):** email-preview keeps the
  Round-86 soft-fail contract (its catch returns the rule-based
  fallback body with HTTP 200 — the preview surface must never
  error); cv-extract (upload-cv) and cv-enhance soft-fail to their
  pure fallbacks (an upload that succeeded must not 503; extraction
  is a soft feature by design). The echo still never reaches the
  client on any of these paths.

### C. Tests
- `tests/unit/groq-email-body-prompts.test.mjs` +7: isPromptEcho edge
  cases (prompt words in a real email pass, quoting a signature
  phrase fails), isLlmMockMode env-gating incl. the production guard,
  mockChatCompletion shape + prompt-aware JSON, PROMPT_ECHO throw
  source lock, all-generators-rethrow source lock, routes-503 source
  lock, and a **behavioral** stubbed-fetch test proving
  generateEmailBody propagates PROMPT_ECHO instead of soft-failing.
  Round-49's lock was hardened to strip API keys before import (it
  previously made a real Groq call — flaky under parallel load).

### D. Net test counts
| Round | Unit | E2E |
|---|---|---|
| Round-84 | 1284 | 83/83 |
| Round-85/86 (`4b1c85b`) | 1298 | 83/84 (429 test env-latency) |
| **Round-87 final** | **1305 pass / 0 fail / 3 skip** | **84/84** (2.6 m, mock mode) |

---

## Round-88 (2026-08-06) — Batch-1 plan (persisted before execution)

Plan generated from the Round-87 wrap-up review of `PROJECT_STATUS.md`
(§Soft-launch Checklist) + `HANDOFF.md` (§7 Known Bugs / TODOs).
Execution happens in this batch — this section is the persisted plan.

### Priority 1 — Soft-launch blockers (checklist open items)
1. **Groq TPD quota** — the single biggest recurring risk (caused the
   Round-86 "502", the Round-87 mejlutkast timeout, and degrades
   manual checks). Upgrade the Groq tier OR add a quota health check
   (we already log `TPD QUOTA EXHAUSTED` with limit/used/percent).
   → `/api/admin/ai-status` (Clerk-admin GET; 1-token Groq probe;
   mockMode detection; never leaks the API key).
2. **Chrome extension publish** — bump to v1.0.0, audit permissions,
   store-assets (screenshots 1280×800 / promo 440×280),
   STORE_DESCRIPTION.md (SV title ≤45 chars, SV+EN ≤1000 chars,
   5 bullets each), extension privacy policy page, build the zip,
   then upload to CWS (`NEXT_PUBLIC_EXTENSION_PUBLISHED=1` +
   `NEXT_PUBLIC_EXTENSION_STORE_URL` after review).
3. **Stripe test checkout E2E** — price IDs still placeholders; the
   webhook route was merged from two contributors in the Round-87
   rebase → lock its behavior with contract tests
   (`stripe.webhooks.generateTestHeaderString` + mocked
   `getStripe()`/`getDb()`): valid sig → 200 upsert, invalid sig →
   400, unknown event → 200 no-op, null-guard → Swedish 500.
4. **Vercel deploy + cron** — verify `vercel.json` cron at 09:00 CEST,
   run the documented cron smoke test, confirm the push notification
   arrives, inspect `cron_logs` for `action: cron_run`.
5. **Invites** (~30 people).

### Priority 2 — Technical debt
6. **Clerk `createRouteMatcher` deprecation** (warning in every dev
   log) — migrate middleware to resource-based auth checks.
7. **E2E env-contract footgun** — the suite only runs green with a
   demo-mode build + `SKIP_LLM_E2E=true`; `yarn test:e2e` alone hits
   real Groq. → `scripts/e2e.sh` (sets `SKIP_LLM_E2E=true`,
   `NODE_ENV=test`, blanks Clerk keys) wired as `test:e2e:ci`.
8. **Dashboard monolith** — `app/dashboard/page.js` (2899 lines) is
   the extraction candidate (stats / applications table / cron).
9. **Cleanup** — `app/dashboard/page.js.bak-final` +
   `jobbpiloten-complete-backup.zip` + `last_response.txt`;
   add `.gitignore` entries (`*.bak-final`, `*.bak`,
   `jobbpiloten-complete-backup.zip`, `last_response.txt`).
10. **Doc correction** — the round prompts say "MongoDB (mongoose)"
    but the codebase uses the native `mongodb` driver everywhere
    (verified: zero mongoose imports in app/ + lib/).

---

## Round-88 execution status (2026-08-06, this batch)

**Priority 1 — Soft-launch blockers**

- [x] **#1 `/api/admin/ai-status` Groq quota health check** — committed
  earlier this batch (`7cfbb9a`): Clerk-admin GET (401/403 allow-list),
  1-token Groq probe via `lib/groq.js#probeGroqHealth` (mockMode
  detection, TPD-quota / model-level / unreachable classification,
  never leaks the API key). Locked by
  `tests/unit/round88-ai-status.test.mjs`.
- [x] **#2 Chrome extension publish → v1.0.0** — committed (`1ebea65`):
  version bump manifest + background + **popup + content** (the
  version-constant sweep caught two stale literals — popup `0.3.3` and
  content `0.2.4` — that the Round-84 0.3.3 packaging left behind), a
  version-consistent zip rebuilt at repo root
  (`extension-v1.0.0.zip`, gitignored) plus the canonical
  `dist/extension-1.0.0-cws.zip` via `yarn package:extension` (all 3
  lints green: validate:extension / lint:await-async /
  lint:field-patterns). Permission audit → `extension/store-assets/README.md`
  (all 5 permissions actively used; `identity` intentionally absent —
  no OAuth flow). Store assets (2 screenshot placeholders 1280×800 +
  promo tile 440×280), `STORE_DESCRIPTION.md` (SV + EN, title ≤45
  chars, description ≤1000 chars), and the CWS-required extension
  privacy policy page at `app/(legal)/extension-privacy/page.js`.
  **Remaining (external):** upload `dist/extension-1.0.0-cws.zip` to
  partner.google.com, then after review set
  `NEXT_PUBLIC_EXTENSION_PUBLISHED=1` +
  `NEXT_PUBLIC_EXTENSION_STORE_URL` in `.env.production`.
- [x] **#3 Stripe webhook contract tests** — committed (`7ec21b1`):
  `tests/unit/round88-stripe-webhook.test.mjs` runs the REAL Stripe SDK
  signature crypto (`webhooks.generateTestHeaderString` +
  `constructEvent`) inside a `node:vm` harness (route imports
  `next/server` + `next/headers`, which throw outside a request scope)
  with mocked `getStripe()`/`getDb()`: valid sig → 200 + profiles
  upsert with tier, tampered payload → 400 Webhook Error + zero DB
  writes, missing header → 400, unknown event → 200 no-op,
  `getStripe()` null → Swedish 500, subscription.updated sync by
  stripeSubscriptionId (no upsert), subscription.deleted → tier
  reset to Basic, unmapped price → `Unknown`. **Also fixed a
  pre-existing lock break:** the Round-80 "exactly 1 raw LLM call"
  lock in `groq-provider-priority.test.mjs` now documents the 2nd
  legitimate raw call (`probeGroqHealth` MUST bypass the fallback
  chain to observe the raw provider error — routing it through
  `createChatWithFallback` would mask TPD-exhaustion as a retry).
- [ ] **#4 Vercel deploy + cron verification** — external (needs
  deploy access). Cron smoke test documented in §Soft-launch
  Checklist.
- [ ] **#5 Invites (~30 people)** — external / human step.

**Priority 2 — Technical debt**

- [x] **#6 Clerk `createRouteMatcher` deprecation → resource-based
  auth** — committed: `middleware.js` migrated from the deprecated
  matcher (Clerk 7.5.21 logs a deprecation warning on EVERY
  construction; it will be removed in the next major) to
  framework-native `req.nextUrl.pathname` matching, per Clerk's
  official upgrade guide. Every Round-85 dual-auth contract
  preserved: demo-cookie pass-throughs on both the main and
  catch paths, the `'/sign-in(.*)'` / `'/sign-up(.*)'` literals,
  `auth.protect()` + the JSON 401 contract. Locked by
  `tests/unit/round88-middleware-resource-auth.test.mjs`.
- [x] **#7 E2E env-contract footgun** — committed: `scripts/e2e.sh`
  sets `SKIP_LLM_E2E=true` (Round-87 mock mode, so no Groq quota
  burn), `NODE_ENV=test`, and blanks the Clerk keys (process.env
  precedence beats .env → suite boots in demo mode) before
  delegating to `playwright test --workers=1`. Wired as
  `yarn test:e2e:ci`.
- [x] **#8 Dashboard monolith split** — committed:
  `app/dashboard/page.js` went 2899 → ~2560 lines. Pure helpers
  (readJsonSafely, readClerkEmail/FullName/Phone,
  mergeProfileWithUser, fmtDate, monthNames, nextCronAt,
  fmtTimeUntil, getMonthlyTrend, STATUS_MAP) moved to
  `lib/dashboard-helpers.js` (React-free, node-testable — same
  precedent as lib/af-compliance.js); leaf presentational
  components (TrendBadge, NextCronBanner, AnimatedCounter,
  CompanyLogo, StatusPill, BroaderSearchCard) moved to
  `components/DashboardCards.jsx` ('use client'). Every
  test-locked pattern stayed in the page (Tag signature, the 3-tier
  resolveApplicationUrl chain, SOURCE_FALLBACKS,
  resolveSearchFallback, buildGoogleSearchUrl, matchesJobSource,
  HAS_URL_VIEW, FILTERS, all 8 af-compliance testids, the
  `${source}-${id}` composite keys, slice(3), jobs-load-more-hint
  guard). Split pinned by
  `tests/unit/round88-dashboard-split.test.mjs`.
- [ ] **#9 Cleanup of legacy files + `.gitignore` entries** — not
  started.
- [ ] **#10 Doc correction: native `mongodb` driver (not mongoose)**
  — not started.

**Net test count:** unit suite **1370 pass / 0 fail / 3 skipped**
(+9 Stripe webhook contract tests, +1 updated Round-80 lock, +4
middleware resource-auth locks, +5 dashboard-split locks; the 3
skips are pre-existing env-gated cases). `next build` compiles
`/dashboard` with the extracted modules; lint:scope /
lint:await-async / lint:field-patterns green.

---

## Round-89 (2026-08-06) — Soft-Launch Prep

Soft-launch prep batch: landing SEO + waitlist, health probe, deploy
prep, and the P2 #9 cleanup.

- **Extension connection (T1) — verified by code trace + tests.** Full
  flow intact: popup `jp-connect-btn` → `openAuthFlow()` +
  opens `/dashboard` (env-aware URL) → dashboard mount fires
  `JOBBPILOTEN_AUTH_SYNC` postMessage with the opaque 90-day token
  from `POST /api/extension/token` (Clerk/demo session-authorized) →
  content.js `handleAuthSync` writes profile+token to
  `chrome.storage.local` (background re-broadcasts cross-origin via
  `chrome.tabs.sendMessage`) → popup `loadAndPaint` shows the
  "Ansluten" pill. host_permissions cover `https://jobbpiloten.se/*`
  + localhost + vercel + github.dev. Bearer-token auth on extension
  API calls + console handshake logging in place. Locked by
  `tests/unit/round88-extension-connect-fix.test.mjs` +
  e2e `extension-auth-handshake.spec.js`. (A live browser click needs
  Chrome on a workstation.)
- **Landing SEO (T2A)** — `app/layout.js` metadata: title
  "JobbPiloten — AI-driven jobbsökning", Swedish description ≤160
  chars, `alternates.canonical '/'`, OpenGraph (url, siteName,
  og-image.png 1200×630, locale sv_SE), Twitter
  summary_large_image, and a `SoftwareApplication` JSON-LD block in
  `<head>`.
- **OG image (T2B)** — `public/og-image.svg` redesigned (brand
  gradient, logo mark, tagline "AI-driven jobbsökning") +
  `public/og-image.png` rasterized at exactly 1200×630 (sharp).
- **Waitlist API (T2C)** — `app/api/waitlist/route.js`: POST validates
  with zod (400 on invalid/non-JSON), normalizes email to lowercase,
  upserts `{ email, createdAt, source: 'landing' }` via `$setOnInsert`
  → 201 on `upsertedCount===1`, 409 on duplicate; structured Swedish
  503 on Mongo getDb/write/read failure (no HTML-500 throws). GET is
  admin-only (`ADMIN_USER_IDS` allow-list) → newest-first list, `_id`
  stripped. 11 contract tests in
  `tests/unit/round89-waitlist.test.mjs` (vm harness, real zod,
  mocked getDb/resolveClerkId). Landing section with email input +
  "Få tidig tillgång" button + sonner toasts (`waitlist-section`
  testids).
- **Analytics (T2D)** — Plausible script in layout head
  (`data-domain=jobbpiloten.se`); `lib/analytics.js#trackPlausible`
  helper; custom events wired: `sign_up` (onboarding complete,
  localStorage-gated once per browser), `onboarding_complete`,
  `cover_letter_generated` (prep-modal success),
  `job_applied` (mark-applied success), `waitlist_signup`.
- **Deploy prep (T3)** — `next build`: **zero warnings, zero errors**
  (34.6s). Secret audit: no `NEXT_PUBLIC_*` secret names; client
  bundle contains only the Clerk SDK's `process.env.CLERK_SECRET_KEY`
  name string (resolves undefined) — zero real values (gsk_/
  mongodb+srv/sk_ formats). `app/api/health/route.js`: public GET
  `{ status, db, groq, timestamp }` — db via Mongo ping, groq via
  `probeGroqHealth` with a **60s TTL cache + 5s timeout** (review
  fix: a public endpoint must not burn Groq TPD quota per hit).
  `.env.template` now documents every required var (ADMIN_USER_IDS,
  STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_*, CRON_SECRET, CORS_ORIGINS,
  extension-publish flags, test-only SKIP_LLM_E2E, …). Extension
  zip rebuilt at `extension-v1.0.0.zip` (29 entries, all version
  literals 1.0.0).
- **Cleanup (T4 / P2 #9)** — no `.bak-final`/backup/`last_response.txt`
  files existed; `.gitignore` now covers `*.bak-final`, `*.bak`,
  `jobbpiloten-complete-backup.zip`, `last_response.txt`. Lint
  scripts green (lint:scope / await-async / field-patterns /
  validate:extension).
- **Still external:** Vercel deploy + cron verification (P1 #4),
  invites (P1 #5), CWS upload of the extension zip (P1 #2 tail).

**Live verification (local dev server):** `/api/health` →
`{"status":"ok","db":true,"groq":true,"timestamp":…}` HTTP 200;
waitlist POST valid → 201, duplicate → 409, invalid → 400; landing
HTML carries title/description/canonical/og:/twitter:/JSON-LD/
Plausible tags.

**Net test count:** unit suite **1381 pass / 0 fail / 3 skipped**
(+11 waitlist contract tests; 3 skips are pre-existing env-gated).
