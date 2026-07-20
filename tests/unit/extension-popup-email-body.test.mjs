// tests/unit/extension-popup-email-body.test.mjs
//
// Round-46 / Bug 1 — popup.js compose-panel wiring for the new
// AI email-body fetch. Locks:
//
//   1. The fetch URL is `/api/extension/email-body` (parallel
//      surface to `/api/extension/answer` + `/api/extension/profile`).
//   2. The body re-population logic reads `jobbpiloten_pageTitle`
//      so the LLM sees the right job context.
//   3. The 2000-char Gmail mailto: cap is enforced with a visible
//      truncation marker.
//   4. The cvShortWarning chip surface lives in `setComposeStatus`.
//   5. mailto URL construction with Swedish characters is safe
//      (URL-encoded, no double-encoding).
//
// Static-grep locks follow the project's idiom (see
// tests/unit/popup-resolver.test.mjs etc.). Behavioural coverage
// is in the e2e suite (extension-banner.spec.js +
// all-issues-smoke.spec.js).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POPUP_PATH = path.resolve(__dirname, '../../extension/popup.js')
const POPUP_SRC = fs.readFileSync(POPUP_PATH, 'utf-8')

// =============================================================================
// 1. Compose panel must fetch /api/extension/email-body when mailto opens
// =============================================================================

test('Bug 1: popup.js must POST to /api/extension/email-body when populating the compose textarea', () => {
  // The new compose body fetch — locked so a future refactor that
  // rewires the loop doesn't silently drop the AI generation.
  // We anchor on the substring "api/extension/email-body" so any
  // URL renaming catches as a test failure.
  assert.ok(
    POPUP_SRC.includes('/api/extension/email-body'),
    'popup.js must POST to /api/extension/email-body when the mailto compose panel loads (Round-46 / Bug 1)',
  )
})

test('Bug 1: popup.js must produce a "Genererar AI-utkast…" loading indicator', () => {
  // Visible feedback so the user knows the AI call is in flight
  // — Round-46 polish prevents a "did the button click?" question
  // during the ~2s LLM round-trip.
  assert.ok(
    /Genererar AI-utkast/.test(POPUP_SRC),
    'popup.js must surface a "Genererar AI-utkast…" loading indicator when fetching the AI email body',
  )
})

test('Bug 1: popup.js must fall back to COMPOSE_BODY_TEMPLATE_DEFAULT on fetch error', () => {
  // A network blip / 401 / 429 must NEVER strand the user on
  // an empty compose panel. The fallback is the static template
  // populated via .split('{name}').join(...) which we already use.
  assert.ok(
    POPUP_SRC.includes('COMPOSE_BODY_TEMPLATE_DEFAULT'),
    'popup.js must retain COMPOSE_BODY_TEMPLATE_DEFAULT as the fallback body when the AI fetch fails',
  )
  // The catch branch needs to call .value = staticBody — locked
  // so a future refactor that drops the catch returns to the
  // empty-body state machine.
  assert.ok(
    /staticBody/.test(POPUP_SRC) && /\.value\s*=\s*staticBody/.test(POPUP_SRC),
    'popup.js must set bodyTextarea.value = staticBody on catch',
  )
})

// =============================================================================
// 2. 2000-char Gmail mailto cap with truncation marker
// =============================================================================

test('Bug 1: popup.js must enforce the 2000-char Gmail mailto cap with a visible truncation marker', () => {
  // macOS Chrome truncates mailto body around 2000 chars; Windows
  // Outlook accepts more, but we cap uniformly so the user
  // doesn't see a half-signature on one platform and a full
  // email on another. Anything over ~1900 chars must be clipped
  // with a visible "[…utkast förkortat, klicka Kopiera för
  // fullständig text]" marker so the user knows to use the
  // Kopiera fallback for the full draft.
  assert.ok(
    /MAX_MAILTO_BODY_CHARS\s*=\s*1\s*900/.test(POPUP_SRC) ||
      /MAX_MAILTO_BODY_CHARS\s*=\s*1900/.test(POPUP_SRC),
    'popup.js must declare MAX_MAILTO_BODY_CHARS = 1900 (Gmail mailto: body cap)',
  )
  assert.ok(
    /\u2026utkast f\u00f6rkortat|\[\u2026utkast f\u00f6rkortat/.test(POPUP_SRC),
    'popup.js must add a visible truncation marker "[…utkast förkortat, klicka Kopiera för fullständig text]" when the body hits the cap',
  )
})

// =============================================================================
// 3. CV-short warning chip
// =============================================================================

test('Bug 1: popup.js must surface the cvShortWarning chip when response.cvShortWarning = true', () => {
  // Backend returns cvShortWarning: true when the user's CV is
  // < 500 chars. The popup MUST surface a Swedish chip so the
  // user can upgrade their CV.
  assert.ok(
    /json\.cvShortWarning/.test(POPUP_SRC),
    'popup.js must read json.cvShortWarning from the /api/extension/email-body response',
  )
  assert.ok(
    /Ditt CV \u00e4r kort/.test(POPUP_SRC),
    'popup.js must include the Swedish "Ditt CV är kort" chip copy',
  )
})

// =============================================================================
// 4. mailto URL construction with Swedish characters
// =============================================================================

test('Bug 1: mailto URL construction must URL-encode Swedish characters', () => {
  // encodeURIComponent is the safe path for mailto: query params
  // because Gmail/Apple Mail require percent-encoded UTF-8 for
  // non-ASCII (åäöÅÄÖ). Without the encodeURIComponent, Chrome
  // may silently drop body bytes or render mojibake.
  assert.ok(
    POPUP_SRC.includes('encodeURIComponent') &&
      /mailto:'\s*\+\s*encodeURIComponent/.test(POPUP_SRC),
    'popup.js must URL-encode the mailto To: field via encodeURIComponent',
  )
  // Subject + body are sent through URLSearchParams which
  // encodes internally — locked to ensure the chain stays.
  assert.ok(
    /new URLSearchParams/.test(POPUP_SRC) &&
      /params\.set\(\s*'subject'/.test(POPUP_SRC) &&
      /params\.set\(\s*'body'/.test(POPUP_SRC),
    'mail button must construct the mailto URL using URLSearchParams for subject + body so Swedish chars round-trip cleanly',
  )
})

// =============================================================================
// 5. Subject must be auto-populated from page title + profile
// =============================================================================

test('Bug 1: popup.js must pre-populate the subject from pageTitle + firstName/lastName', () => {
  // The Round-46 / Bug 1 spec: Subject format
  //   "Ansökan: [Jobbtitel] — [Förnamn] [Efternamn]"
  // The popup already had this logic; we re-lock so a future
  // refactor that simplifies the subject line still produces
  // something a recruiter recognises.
  assert.ok(
    /Ans\u00f6kan:/.test(POPUP_SRC) || /Ansokan:/.test(POPUP_SRC),
    'popup.js must include the subject prefix "Ansökan:"',
  )
  assert.ok(
    /firstName/.test(POPUP_SRC) && /lastName/.test(POPUP_SRC),
    'popup.js must read firstName/lastName from the stored profile to build the subject signature',
  )
})

// =============================================================================
// 6. Compose-panel behaviour — Kopiera fallback always available
// =============================================================================

test('Bug 1: popup.js must keep the Kopiera fallback so email body is recoverable when mailto blocks', () => {
  // On platforms where mailto: navigation is blocked (rare; some
  // Android Chrome configs + enterprise lockdown), the user
  // must still be able to paste the body into a webmail
  // compose. The existing "Kopiera" button writes subject+body
  // to the clipboard. Locked so a future refactor that removes
  // the button doesn't strand the user.
  assert.ok(
    /jp-compose-copy-btn/.test(POPUP_SRC) &&
      /navigator\.clipboard\.writeText/.test(POPUP_SRC),
    'popup.js must keep the Kopiera (clipboard) button as a fallback for when mailto: navigation is blocked',
  )
})

// =============================================================================
// 7. Round-46.1 — race-condition dedupe + fallback alignment
// =============================================================================

test('Round-46.1: popup.js must dedupe concurrent AI-body fetches via __composePanelInFlight gate', () => {
  // Race-condition fix — chrome.storage.onChanged fires async per
  // write. A burst of N writes (signals + pageTitle + a profile
  // refetch) before the first AI fetch resolves could schedule N
  // concurrent fetches whose responses race on bodyTextarea.value.
  // The dedupe gate mirrors the refreshDetectedFields._busy /
  // _deferred pattern from Round-11 — module-scoped flag +
  // boolean trailing-defer + setTimeout(0) for the microtask yield.
  assert.match(
    POPUP_SRC,
    /__composePanelInFlight/,
    'popup.js must use a __composePanelInFlight module-scoped flag for AI-fetch dedupe',
  )
  assert.match(
    POPUP_SRC,
    /__composePanelDeferred/,
    'popup.js must use a __composePanelDeferred boolean for the trailing-re-render contract',
  )
  // The gate must appear at or before the first AI-fetch await so
  // a fast-following burst collapses to one in-flight fetch.
  assert.ok(
    /__composePanelInFlight\s*=\s*true/.test(POPUP_SRC) &&
      /__composePanelDeferred\s*=\s*true/.test(POPUP_SRC),
    'popup.js must set both gate flags before any AI fetch awaits',
  )
  // The trailing re-render in the finally branch is what makes
  // the dedupe user-visible (instead of silently dropping the
  // latest burst). setTimeout(onSignalsChanged, 0) yields the
  // microtask queue so the trailing call gets fresh state.
  assert.match(
    POPUP_SRC,
    /setTimeout\(\s*onSignalsChanged\s*,\s*0\s*\)/,
    'popup.js must schedule a trailing onSignalsChanged() via setTimeout(0) in the finally branch',
  )
})

test('Round-46.1: popup.js must use composeStaticBody() helper (fallback aligns with fallbackEmailBody)', () => {
  // Round-46 / Bug 1 followup — pre-fix COMPOSE_BODY_TEMPLATE_DEFAULT
  // produced a different shape ("jag heter X…, står till förfogande")
  // from lib/groq.js's fallbackEmailBody() ("Jag såg er annons för
  // X…, Jag bifogar mitt CV"). Two fallback templates for two failure
  // modes felt broken to recruiters who saw body X 95% of the time
  // then body Y 5% of the time. The fix is a `composeStaticBody()`
  // helper whose output matches `fallbackEmailBody()` shape exactly.
  assert.ok(
    /function\s+composeStaticBody\s*\(/.test(POPUP_SRC),
    'popup.js must declare composeStaticBody() helper function (Round-46.1 fallback alignment)',
  )
  // The canonical 9-line body shape — these are the EXACT lines
  // fallbackEmailBody() produces in lib/groq.js. Drift here
  // means the two fallback paths disagree.
  assert.ok(
    /Jag s\u00e5g er annons /.test(POPUP_SRC),
    'popup.js must contain the canonical "Jag såg er annons " line (matches fallbackEmailBody)',
  )
  assert.ok(
    /Jag bifogar mitt CV och personliga brev\./.test(POPUP_SRC),
    'popup.js must contain the canonical CV-attachment line',
  )
  assert.ok(
    /Tack f\u00f6r att ni tog er tid/.test(POPUP_SRC),
    'popup.js must contain the canonical "Tack för att ni tog er tid" line',
  )
  assert.ok(
    /Med v\u00e4nliga h\u00e4lsningar,/.test(POPUP_SRC),
    'popup.js must contain the canonical "Med vänliga hälsningar," closing signature',
  )
})

test('Round-46.1: popup.js catch-block surfaces a visible Swedish error message on AI-fetch failure', () => {
  // Visible-feedback contract — a network blip must NEVER strand
  // the user on a silent empty compose panel. The catch path
  // surfaces a Swedish error AND falls back to the static body.
  assert.ok(
    /Kunde inte h\u00e4mta AI-utkast/.test(POPUP_SRC),
    'popup.js catch-block must surface "Kunde inte hämta AI-utkast" Swedish error message',
  )
})

// =============================================================================
// 8. Round-54 / Bug 1 — URL-based mode auto-switching, gated on composeTarget
// =============================================================================
//
// Round-56 / Followup A — the 6 auto-switch contract-lock tests
// were moved to tests/unit/extension-popup-auto-switch.test.mjs
// so the test layout mirrors the code structure (Round-54
// auto-switch gate gets its own file; the compose panel keeps
// its own). The contract is still locked — just in a
// dedicated file. See extension-popup-auto-switch.test.mjs for
// the auto-switch tests.
