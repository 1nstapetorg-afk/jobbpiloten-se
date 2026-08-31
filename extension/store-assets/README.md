# Chrome Web Store assets — JobbPiloten Auto-Fill (v1.0.0)

Store asset requirements per Google's Chrome Web Store developer docs
(https://developer.chrome.com/docs/webstore/images).

## Screenshots (listing page)

- **Dimensions:** 1280×800 (or 640×400, 1:1.6 — we standardise on
  1280×800).
- **Format:** PNG or JPEG. The SVGs in this folder are PLACEHOLDERS —
  replace each with a real PNG/JPG capture before uploading.
- **Count:** at least 1, max 5. We ship 2:
  - `screenshot-1-placeholder.svg` — the popup (connected state:
    profile pill, Fyll i nu, mejlutkast).
  - `screenshot-2-placeholder.svg` — autofill in action on a job
    application form.
- **Content rules:** no phone mockups, no fake UI, no nudity/violence,
  no misleading claims, no transparent/checkerboard backgrounds.

## Promo tile (store front page)

- **Dimensions:** exactly 440×280.
- **Format:** PNG or JPEG. `promo-tile-440x280.svg` is a placeholder.
- Keep the JobbPiloten brand (indigo gradient + plane glyph) and the
  tagline readable at 440px width.

## Canonical upload artifact

Upload **`dist/extension-1.0.0-cws.zip`** (built by `yarn package:extension`,
which runs the validators + lints first) to the CWS dashboard. It is
built from the same flat layout with `*.md` files stripped. Do NOT
upload the repo-root `extension-v1.0.0.zip` — that is a manual,
unfiltered copy (includes `CSP.md` / `README.md` / `STORE_DESCRIPTION.md`)
kept only as a quick sideload artifact.

## How to replace a placeholder

1. Load the extension (`chrome://extensions` → Developer mode →
   Load unpacked → `extension/`).
2. Open the popup and the dashboard against a real job form.
3. Capture at the exact sizes above (e.g. `import` a window capture
   into a 1280×800 canvas), export PNG.
4. Overwrite the matching file in this folder **and** upload the PNG
   to the CWS dashboard.

## Permission audit (v1.0.0, Round-88)

| Permission | Used by | Droppable? |
|---|---|---|
| `activeTab` | popup fill trigger | no — core UX |
| `storage` | token/profile/errors persistence | no — core |
| `scripting` | content-script management | no — core |
| `tabs` | `chrome.tabs.query`/`create` (openAuthFlow, dashboard fallback, `tab.url` read for env resolution) | no — actively used |
| `windows` | `chrome.windows.create`/`remove` (480×720 auth popup window) | no — actively used |

No OAuth flow exists (the extension uses the web app's opaque
`/api/extension/token` mint), so the `identity` permission is
intentionally NOT declared.
