/**
 * lib/siteConfig.js — single source of truth for site-wide constants.
 *
 * The placeholder values below are flagged with the comment block
 * `LAUNCH-GATE PLACEHOLDER` so a quick grep before launch surfaces every
 * spot that needs a real value. To override any of them without editing
 * code, set the matching env var (NEXT_PUBLIC_SUPPORT_EMAIL, etc.) before
 * the production build. In dev, the defaults are used so the dashboard,
 * footer links, and email subjects all resolve to something sensible.
 *
 * NOTE: All three contact emails route to the same inbox at the time of
 * launch. We keep them as separate env-settable values so the company can
 * route privacy@ and support@ to different addresses later without code
 * changes.
 */

/* eslint-disable no-unused-vars */

// ---- LAUNCH-GATE VALUES ----
// These defaults match the brand identity for the soft-launch window
// (vänner & familj). Override via env var when the real legal entity /
// dedicated privacy alias is in place — see .env.example for the full
// list of NEXT_PUBLIC_* overrides for the legal pages, sitesettings API,
// and service-worker mailto: link.

export const LEGAL_COMPANY_NAME =
  process.env.NEXT_PUBLIC_LEGAL_COMPANY_NAME || 'JobbPiloten Sweden AB'

export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'hej@jobbpiloten.se'

export const PRIVACY_EMAIL =
  process.env.NEXT_PUBLIC_PRIVACY_EMAIL || 'privacy@jobbpiloten.se'

// Email used as the VAPID subject (mailto:) when no VAPID_SUBJECT env var
// is set. Web-push requires a mailto: URL here per the VAPID spec.
export const PUSH_VAPID_FALLBACK_SUBJECT = `mailto:${SUPPORT_EMAIL}`

// Marketing / brand canonical site URL. Search engines and OpenGraph tags
// use this to normalize links.
export const SITE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || 'https://jobbpiloten.se'

// ---- VAPID public key shipped to the browser ----
// Must match the server-side VAPID_PRIVATE_KEY used by lib/push.js.
// The default below is the public half of a fresh VAPID pair that
// `npx web-push generate-vapid-keys` produced during the 2026-07-17
// soft-launch rotation (Round-72). Override via env var before
// deploying to staging / production so you do NOT have to invalidate
// existing subscribers. The matching private key lives in
// VAPID_PRIVATE_KEY (server-only — never expose to the browser).
// Shared between app/dashboard/page.js and app/settings/page.js.
export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  'BJm3rikMkVeqR1yXDwz6pYRwf6_8mDcjNr-o34lO4Uz-lAE5Kzp86map_Cy8BTR6CVt-iyflDXqx3YMJPGcmE5A'

// ---- Chrome Web Store (JobbPiloten Auto-Fill extension) ----
// Launch-gate for the install banner on /dashboard. During the soft-
// launch window (vänner & familj) the banner is enabled by default so
// testers can find the install page via the dashboard's amber card.
// `EXTENSION_STORE_URL` falls back to `/extension-install` (relative
// path) so the soft-launch build never renders a broken link to a
// /details/PLACEHOLDER slug — it points at our own install page
// instead, which carries sideloading instructions for Chrome's
// "Load unpacked" mode.
//
// To ship the extension publicly:
//   1. `yarn package:extension -- --cws` → dist/extension-{version}-cws.zip
//   2. Upload to https://partner.google.com (one-time $5 fee + review).
//   3. After Google publishes (typical 2-5 days), copy the resulting
//      public URL (typically
//      https://chrome.google.com/webstore/detail/jobbpiloten-auto-fill/<slug>)
//      and set both env vars below, then redeploy. The banner will
//      then auto-link to the CWS slug instead of the local install page.
export const EXTENSION_PUBLISHED =
  process.env.NEXT_PUBLIC_EXTENSION_PUBLISHED === '1'

// Default to the local install guide so the soft-launch banner is
// always clickable. The page itself explains both the CWS install
// (when published) and the sideload install (for testers).
export const EXTENSION_STORE_URL =
  process.env.NEXT_PUBLIC_EXTENSION_STORE_URL || '/extension-install'

// Path to the dedicated install instructions page. Kept as a
// constant so the dashboard banner, settings card, and any future
// share links all resolve to the same place.
export const EXTENSION_INSTALL_GUIDE_PATH = '/extension-install'
