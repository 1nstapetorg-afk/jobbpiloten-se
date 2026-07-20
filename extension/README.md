# JobbPiloten Auto-Fill — Chrome extension

> Swedish-only Chrome extension (MV3) that auto-fills job-application
> forms with the user's saved JobbPiloten profile. Single source of
> truth is the dashboard at `https://jobbpiloten.se/dashboard` — the
> extension never asks for first-party login, it just consumes the
> bearer token the dashboard hands it.

## Snabbinstall för utvecklare (Load unpacked)

För mjukvarutestning och vänner & familj under soft-launch — kör
tillägget utan att gå via Chrome Web Store. Stegen tar under 60
sekunder:

1. **Öppna `chrome://extensions`** i Chrome 121+ (Manifest V3-stöd).
2. **Slå på Utvecklarläge** (Developer mode) uppe till höger.
3. **Klicka "Ladda upp okomprimerad"** (Load unpacked).
4. **Välj mappen `/extension`** i detta repo (inte `dist/`-zippfilen).

> 💡 Behöver du paketera mappen först? Kör `yarn package:extension`
> i projektroten. Skriptet skapar `dist/extension.zip` med rätt
> layout för sideload.

När tillägget är installerat ser du en ✈-ikon i Chrome-verktygsfältet.
För en första kontroll:

- Besök `/test-form` på en JobbPiloten-instans (lokalt:
  `http://localhost:3000/test-form`).
- Den orange ✈-ikonen ska dyka upp nere till höger.
- Klicka ikonen → alla 7 fält fylls i från din anslutna profil.

För en komplett steg-för-steg-guide med skärmdumpar och
felsökningschecklista, se [`/app/extension-install/page.js`](../app/extension-install/page.js)
(samma innehåll som `/extension-install`-sidan i appen) eller
[`../TESTING.md`](../TESTING.md) för manuella testfall på riktiga
jobbplatser.

## Publiceringsflöde (Chrome Web Store)

När Google godkänt tillägget:

1. Kör `yarn package:extension` — emitterar nu **både**
   `dist/extension-{version}.zip` (sideload) och
   `dist/extension-{version}-cws.zip` (CWS-upload) i samma körning.
   Båda zippena har `manifest.json` i zip-roten. (Tidigare var
   `--cws` en separat flagga; default-beteendet är nu CWS-aktiverat
   så att en utvecklare inte glömmer emitera CWS-varianten före en
   Chrome Web Store-uppladdning — se commit-historiken för den
   specifika stale-zip-footgun som fixades.)
2. Ladda upp `dist/extension-{version}-cws.zip` på
   <https://partner.google.com> (engångs $5 + recension, vanligen
   2-5 dagar).
3. Sätt `NEXT_PUBLIC_EXTENSION_PUBLISHED=1` och
   `NEXT_PUBLIC_EXTENSION_STORE_URL=https://chrome.google.com/webstore/detail/jobbpiloten-auto-fill/<slug>`
   i `.env.production` — installera-knappen på `/dashboard` och
   `/extension-install` pekar då automatiskt på CWS-länken.

> Vill du köra packagern utan att först köra `yarn validate:extension`
> (snabb iterating när man jobbar direkt på `scripts/package-extension.py`)
> använd `yarn package:extension:cws` istället — den skipp:ar
> validator-steget och kör bara Python-packagern med `--cws`.

## What it does

When you visit a job-application page (Workday, Teamtailor, Greenhouse,
Lever, SmartRecruiters, classic ATS' HTML form, etc.) the extension:

1. Detects `<input>` / `<textarea>` / `<select>` fields whose label,
   placeholder, `name`, `id`, or `aria-label` matches one of the
   Swedish-or-English keywords in [`FIELD_PATTERNS`](./content.js).
2. Renders a small JobbPiloten badge at bottom-right when 3+ matches
   are found.
3. On click (or "Fyll i nu" from the popup), fills the matched fields
   with values from the connected profile.

Sensitivities:
- never auto-submits — the user always has to click the page's own
  submit button
- never reads password fields (explicit exclusion in `collectInputs`)
- never reads file inputs (the extension injects a button that opens
  the host's native file picker instead)
- never reads HttpOnly cookies — only the bearer token + safe profile
  JSON the dashboard ships via `window.postMessage`

## How to load it in developer mode

1. Open `chrome://extensions` in Chrome 121+ (Manifest V3).
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the JobbPiloten icon to your toolbar (puzzle-piece icon → pin).
5. Make sure the dashboard is open at `https://jobbpiloten.se/dashboard`
   at some point — the extension won't connect otherwise. (See
   "Connecting your profile" below.)

The extension folder layout:

```
extension/
├── manifest.json       # MV3 manifest (matches: <all_urls>)
├── content.js          # field detector + filler, runs on every page
├── background.js       # MV3 service worker — minimal broadcast relay
├── popup.html          # vanilla-ESM popup (360px wide)
├── popup.js            # popup script
├── popup.css           # popup styles
└── icons/              # PNGs at 16/48/128 (rebuilt via yarn icons:extension)
```

## Connecting your profile

1. Open `https://jobbpiloten.se/dashboard` in any tab.
2. Click the **Anslut din profil** button on the extension card.
3. A bearer token + the safe profile JSON are posted into the
   content-script via `window.postMessage({ type: 'JOBBPILOTEN_AUTH_SYNC' })`.
4. The content script writes `{ token, profile, base_url }` to
   `chrome.storage.local`. Future forms on any tab (in the same Chrome
   profile) get auto-fillable.

Connection survives:
- Tab-close → vault persists in `chrome.storage.local`
- Browser restart → vault persists
- Profile update on the dashboard → use the popup's **Uppdatera data**
  button, or re-click **Anslut**.

Connection breaks when:
- Manually calling "Logga ut" from `/settings` (which deletes the
  extension tokens server-side, invalidating the local copy)
- 30 days of inactivity (server-side cron prunes `extension_tokens`,
  see `app/api/cron/route.js`)

## How to test on different sites

Each host has a different DOM convention — the matcher table covers the
most common ones. To verify a new site:

1. Open DevTools on the page, run `document.querySelectorAll('input, textarea, select')`.
2. For each match, inspect the `name`, `id`, `placeholder`,
   `aria-label`, parent's `<label>` text, plus any `data-*` attributes.
3. Note which keyword in `FIELD_PATTERNS` would catch each. If a field
   has none, either add an entry to the table or change the host's
   markup.
4. Confirm the badge surfaces with 3+ matches, and that clicking it
   fills the right values.

If `chrome://extensions → JobbPiloten → Service worker → Inspect` shows
`fetch` errors, the dashboard origin guard probably denied the request
(see API contract below).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Badge never appears | DOM has fewer than 3 matches, or the page is in an iframe-only context. | Open the popup → check the **Upptäckta fält** count. If 0, no fields match the keyword table. If 1-2, lower the threshold. |
| Badge appears but click fills nothing | Token expired or storage cleared. | Open `/dashboard`, click **Anslut** again. |
| "Token ogiltig — anslut igen" toast | Server-side token was pruned (90-day inactivity) or revoked. | Same as above. |
| "Kunde inte läsa status" | `chrome.storage.local` blocked (rare — only on managed Chrome devices). | Out of scope; the popup surfaces the underlying error verbatim. |
| "För många AI-svar" toast on a long form | Too many free-text motivation fields within 1 hour (server rate-limit). | Either fill manually, or wait an hour. |
| "Vänta Xs innan nästa auto-fill" toast | Hard 5-second rate-limit between fills; accidental double-click. | Wait and retry. |
| "REVIEW_NEEDED" yellow outline on a field | Mutation was rejected by the host listener. | Open the page's devtools and check for `onchange` listeners that call `event.preventDefault()` — JobbPiloten cannot bypass them. |
| Pulse animation visible despite OS-level reduced-motion | matchMedia returned `false` because the OS settings flipped after page load. | Refresh the page. |

### Origin guard

Even if a malicious page somehow injects a `fetch()` into this
extension's popup, the **origin guard** blocks the bearer token from
leaving the browser unless the destination URL is on the allow-list
(`https://jobbpiloten.se` plus any staging origin the dashboard
whitelisted at last auth-sync). The guard is enforced inside
`assertOriginAllowed(url, allowedOrigins)` — if a request fails the
guard, the popup surfaces the error verbatim.

### Bundle-size budget

`yarn package:extension -- --cws` produces a CWS-ready zip with
manifest at zip-root. The target is **< 50 KB** unpacked:

| File | Approx size |
|---|---|
| `manifest.json` | ~1 KB |
| `content.js` | ~16 KB (inlined comments) |
| `background.js` | ~2 KB |
| `popup.html` + `popup.css` | ~3 KB |
| `popup.js` | ~4 KB |
| `icons/*` | ~6 KB total (16/48/128 PNGs) |

Run `du -sh dist/extension-cws.zip` after packaging to confirm.

## API contract between extension and backend

| Endpoint | Method | Auth | Payload | Response | Notes |
|---|---|---|---|---|---|
| `/api/extension/token` | POST | Cookie (Clerk or demo) | empty | `{ ok, token, profile }` | Creates an `extension_tokens` row + returns a fresh opaque token + a SAFE projection of the profile. |
| `/api/extension/profile` | GET | Bearer (the token above) | empty | `{ fullName, firstName, lastName, email, phone, address, ... }` | Excludes `personalNumber` (PII), `cvText` (too large for chrome.storage), and `profilePicture` data URL. |
| `/api/extension/answer` | POST | Bearer | `{ question, field }` | `{ answer }` | AI-generated motivation answer for one of `whyThisCompany` / `whyThisRole` / etc. **Rate limited** server-side at 20/hour/token. |

### Profile JSON shape written to `chrome.storage.local`

A subset of the full profile document — see
[`lib/extension-profile.js`](../lib/extension-profile.js) for the
field-level allow-list. The projection intentionally excludes:

- `personalNumber` (will never be sent to the browser)
- `cvText` (too large for chrome.storage quota, and content script
  doesn't need it because `/api/upload-cv` already parsed it server-side)
- `profilePicture` (2-3 MB data URL — chrome.storage would fail to
  accept it; the popup doesn't need it)
- `subscriptionStatus`, `tier`, `emailVerified`, etc. (irrelevant
  to fill behaviour)

### Auth-sync channel protocol

The dashboard posts the connector to the content-script running in its
own tab via `window.postMessage`:

```js
window.postMessage({
  type: 'JOBBPILOTEN_AUTH_SYNC',
  payload: { token, profile, baseUrl, allowedOrigins }
}, window.location.origin)
```

The content script:

1. Validates `ev.source === window` (same-window context only)
2. Writes `{ jobbpiloten_token, jobbpiloten_profile, jobbpiloten_base_url,
   jobbpiloten_allowed_origins }` to `chrome.storage.local`
3. Re-runs the scan pass so already-loaded forms become fillable.

The background page independently broadcasts the same payload to
**every active tab** via `chrome.tabs.sendMessage`, so forms on
different sites (or in inactive tabs) get the same auth-state without
the user needing a per-site connect dance.

## Development

```bash
# Build sideload + CWS zips (manifest at zip root, both emitted by default)
yarn package:extension

# Same as above, BUT skip the validator pre-check (fast iteration on the
# packager itself — don't ship this in CI)
yarn package:extension:cws

# Run the app + e2e suite end-to-end (requires `yarn dev` running)
yarn test:e2e
```

### Comment conventions — version tags

`extension/popup.js` and `extension/popup.html` contain a number of
inline comments tagged with a release version, e.g.
`// v0.2.2 — Anslut din profil primary CTA`. **These comments mark the
release that INTRODUCED the feature, not the current release.** The
current release is `const VERSION = '0.2.3'` (mirrored as the
`"version"` field in `extension/manifest.json`). A v0.2.4 release that
touchs the same code should leave the v0.2.2 historical markers alone
— they describe lineage, not state. If the convention ever flips,
search the repo for `v(MAJOR).(MINOR)` and bump all matching comments
in one commit to keep the diff atomic.

### Adding a new field pattern

Edit `FIELD_PATTERNS` in [`content.js`](./content.js). Each entry is
`{ pattern: RegExp, profileKey: string, kind?: 'multi' | 'file' }`.

Conventions:
- Patterns are case-insensitive, anchored loosely — they match anywhere
  in the joined meta-string.
- Use `kind: 'multi'` for fields that should be filled with the full
  multi-line answer (CV summary, cover letter).
- Use `type: 'file'` (not `kind`) for `<input type="file">` siblings.

Be careful adding high-cardinality patterns — every matched
host-page field increases the LLM rate-limit pressure. Prefer
narrower keywords (e.g. `löneanspråk` over `lön`) so background-noise
forms don't trigger.

## Security model in one paragraph

The extension is **isolated world** at document_start, so the
page's main world cannot read its globals. The page can read the
`data-jobbpiloten-ext="1"` attribute we set on `<html>` — that's
deliberately the only outbound channel we expose. The bearer token
lives in `chrome.storage.local` (encrypted at rest by Chrome), never
on disk in plain text. The popup's outbound fetches are constrained
to a hard-coded origin allow-list (extended per auth-sync) so DNS
rebinding cannot exfiltrate. We never auto-submit forms — all fills
pause for user confirmation — so even a hostile host page cannot
trick the user into sending a server-side action.
