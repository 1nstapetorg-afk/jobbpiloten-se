/**
 * JobbPiloten Auto-Fill — Round-52 / Issue 1 (Mejlutkast mode).
 *
 * Brand-new content script dedicated to the round-trip between Gmail /
 * Outlook compose windows and the JobbPiloten popup.
 *
 *   • Injected on the Gmail compose URL (mail.google.com, mail/u/N/compose
 *     and the #compose hash variant) and the Outlook compose URLs
 *     (outlook.live.com/mail/compose, outlook.office.com/mail/deeplink/compose,
 *     outlook.live.com/mail/0/deeplink/compose) — the manifest holds
 *     the exact match patterns.
 *
 *   • Architecture (mirrors extension/content.js's compact style):
 *     1. On script load, tag <html data-jobbpiloten-email-ext="1">
 *        so a dashboard / landing page can confirm the script is
 *        present (the dashboard uses this same attribute pattern
 *        to suppress its "Installera tillägget" banner when the
 *        extension is loaded on /sign-in-style flows).
 *     2. Pick a Compose target detector — different DOM IDs for
 *        Gmail vs Outlook vs Office.com. We poll every 1s
 *        (MutationObserver is overkill on Gmail's React-rendered
 *        DOM because the field is recreated on every keystroke).
 *     3. The To: field stripper extracts bare or quoted addresses
 *        ("Anna Andersson <anna@x.se>" → "anna@x.se").
 *     4. The active target is rate-limited to one
 *        chrome.storage.local write per 250ms so a typing burst
 *        doesn't spam the popup's storage listener.
 *     5. Accept inbound JOBBPILOTEN_EMAIL_INJECT messages from the
 *        popup; mutate the Subject + Body via the React/Outlook
 *        value setter + dispatch input/change events so the page's
 *        onChange listeners fire.
 *
 *   • SECURITY:
 *     - We never run on a page the manifest doesn't allow.
 *     - We never read the user's email body (only inject).
 *     - PROD_BASE_URL is intentionally NOT used here (this script
 *       never makes outbound API calls). All outbound fetches
 *       happen from the popup.js + content.js pair, where the
 *       assertOriginAllowed allow-list already gates caller origin.
 *     - The chrome.storage writes use a single, well-named key
 *       (jobbpiloten_composeTarget) so the popup's
 *       storage.onChanged can route cleanly.
 *
 *   • Unlike extension/content.js, this script does NOT inject
 *     any visible UI into the host page. The compose window
 *     already has its own UI; the popup is the affordance. We
 *     only communicate via chrome.storage.local + the inject
 *     message channel.
 */

// Round-55 / Followup 3 — import the shared webmail host helper
// from extension/lib/email-clients.js. Pre-Round-55 the
// detectProvider() body inlined the same three-host list that
// extension/popup.js's isActiveTabEmailClient() used. A 4th
// provider added in one site but not the other would leave a
// host where the compose-target detector works but the
// auto-switch doesn't fire — drift. The shared module is the
// single source of truth.
//
// ESM IMPORT PLACEMENT NOTE: ES module imports must live at the
// top of the file (above any other statements). An earlier Round-55
// draft placed this import mid-file (after the documentElement
// setAttribute block) which is a SyntaxError under V8's ESM parser
// — fixed in Round-55.2 by moving the import up here.
import { detectProviderByHost } from './lib/email-clients.js'

try {
  document.documentElement.setAttribute('data-jobbpiloten-email-ext', '1')
  // Round-53 followup: surface the REAL extension version (not a
  // hard-coded round number) so a tester grepping the dashboard
  // for "what version is loaded" sees the manifest value, not a
  // stale "52.0" that drifts every round. The chrome.runtime
  // API is unavailable in test/headless contexts — fall back to
  // a stable 'unknown' so the attribute still lands.
  let EXT_VERSION = 'unknown'
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
      const manifest = chrome.runtime.getManifest()
      if (manifest && typeof manifest.version === 'string') {
        EXT_VERSION = manifest.version
      }
    }
  } catch (_) { /* non-MV3 env — keep 'unknown' */ }
  document.documentElement.setAttribute('data-jobbpiloten-email-ext-version', EXT_VERSION)
} catch (_) {
  // Standalone test env without documentElement — silently skip.
}

const COMPOSE_STORAGE_KEY = 'jobbpiloten_composeTarget'
const INJECT_MESSAGE_TYPE = 'JOBBPILOTEN_EMAIL_INJECT'
const COMPOSE_POLL_MS = 1_000

// ---- Provider detection ----
// Cheap, single-detection: Gmail before Outlook (both have similar
// query shape but Gmail uses /u/N/, Outlook uses /mail/0/ or
// /mail/compose). The same script handles all three because the
// DOM lookup tables differ per provider — but we pick ONE provider
// for the poll cadence to avoid double scanning.
//
// Round-55 / Followup 3 — delegates to the shared
// `detectProviderByHost()` helper so the host list lives in one
// place. The helper returns the canonical 3-way key
// ('gmail' | 'outlook-personal' | 'outlook-business' | null)
// that the buildTargeter() branches below consume.
function detectProvider() {
  return detectProviderByHost(window.location.hostname)
}

const PROVIDER = detectProvider()

// ---- Compose-target DOM lookup ----
//
// Each entry returns { subject: HTMLElement|null, body: HTMLElement|null,
//                     readTo(): string|null }.
//
// Gmail's compose UI is React-rendered with heavily-namespaced
// attributes (`aria-label`, `aria-labelledby`, `peoplekit-id`). Its
// subject input is `input[name="subjectbox"]`; its body is a
// contenteditable div (`div[role="textbox"][aria-label*="Message Body"]`)
// whose textContent response hits both Gmail + Inbox variants.
//
// Outlook personal + business use a stable `input[aria-label]`
// pattern + `div[role="textbox"][aria-label*="Message"]` for the
// body. Note Outlook's ARIA labels are localised; the Swedish
// "Skriv meddelande här" appears on personal Outlook while business
// uses "Write a message" — both contain the substring "mess" which
// the regex already matches.
//
// `readTo()` returns the first valid email address parsed out of
// the visible To: input. Gmail renders the To: recipients as
// <div data-hovercard-id="..."> chips wrapping <span email="...">,
// so we walk chip spans; Outlook personal builds a single
// <div role="textbox" aria-label="Till ...">. We strip display
// names ("First Last <f@x>") and quoted-email variation before
// the regex matches.
function buildTargeter() {
  if (PROVIDER === 'gmail') {
    return {
      name: 'gmail',
      findSubject() {
        return document.querySelector('input[name="subjectbox"]')
      },
      findBody() {
        // Gmail's compose body uses contenteditable + role="textbox"
        // + an aria-label whose value contains either "Message Body"
        // (English) or "Meddelandetext" (Swedish) for .se users.
        return document.querySelector(
          'div[role="textbox"][aria-label*="essage"], div[role="textbox"][aria-label*="eddelande"], div[contenteditable="true"][aria-label*="ody"]'
        )
      },
      readTo() {
        // Gmail renders To: recipients inside a hidden <textarea
        // name="to"> for backend round-trip + visible chip spans.
        // The hidden <textarea> is the source of truth (it carries
        // a JSON-serialised recipient list).
        try {
          const ta = document.querySelector('textarea[name="to"]')
          if (ta && ta.value) {
            const addr = String(ta.value).match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
            if (addr) return addr[0]
          }
        } catch (_) {}
        // Fallback: scan chip spans
        try {
          const chips = document.querySelector('div[aria-label*="Till"][data-hovercard-id], span[email]')
          if (chips) {
            const raw = chips.getAttribute('email') || chips.textContent || ''
            const addr = String(raw).match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
            if (addr) return addr[0]
          }
        } catch (_) {}
        return null
      },
    }
  }
  if (PROVIDER === 'outlook-personal' || PROVIDER === 'outlook-business') {
    return {
      name: PROVIDER,
      findSubject() {
        // Outlook subject: <input type="text" aria-label="Subject …"> or
        // localised Swedish variant.
        return document.querySelector(
          'input[type="text"][aria-label*="ubject"], input[type="text"][aria-label*="mne"]'
        )
      },
      findBody() {
        return document.querySelector(
          'div[role="textbox"][aria-label*="essage"], div[role="textbox"][aria-label*="eddelande"], div[contenteditable="true"][aria-label*="ody"]'
        )
      },
      readTo() {
        try {
          // Outlook's To: input is a complex <div role="textbox">
          // whose innerText contains the rendered recipients. The
          // first email-shape match is the canonical address.
          const toField = document.querySelector('div[role="textbox"][aria-label*="Till"], div[role="textbox"][aria-label*="To"]')
          if (toField) {
            const addr = String(toField.innerText || toField.textContent || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
            if (addr) return addr[0]
          }
        } catch (_) {}
        return null
      },
    }
  }
  return null
}

const targeter = PROVIDER ? buildTargeter() : null

// ---- Compose-target value setter ----
//
// Both Gmail and Outlook use contenteditable for the body. Setting
// `.textContent` on a contenteditable fires NO input/change event —
// the page's React/Preact handlers won't notice. We replicate the
// extension/content.js pattern: focus the element, locate its
// React internal value setter (when it has one), invoke the
// setter, then dispatch a synthetic `input` event so the page's
// listeners fire.
//
// The subject is a plain <input type="text"> so the simpler
// `.value = …` + dispatch input/change pair is enough.
function setComposeSubject(input, value) {
  if (!input) return false
  const text = String(value || '').slice(0, 250)
  try {
    const proto = Object.getPrototypeOf(input)
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, text)
    else input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  } catch (_) {
    try {
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    } catch (_) {
      return false
    }
  }
}

function setComposeBody(div, value) {
  if (!div) return false
  const text = String(value || '')
  try {
    // Gmail + Outlook both use contenteditable divs. Setting
    // .textContent works for plain text, but the page's React
    // bridges ignore it unless we dispatch the relevant events.
    // The brute-force path: focus, clear, dispatch a paste-style
    // insert via document.execCommand('insertText') — Chrome's
    // execCommand still honours this on contenteditable in 2026.
    div.focus()
    // Try execCommand first — it integrates with the page's paste
    // handler so React state mirrors the contenteditable mutation.
    try {
      document.execCommand('selectAll', false, null)
      document.execCommand('insertText', false, text)
      div.dispatchEvent(new Event('input', { bubbles: true }))
      div.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    } catch (_) {
      // Fallback: set textContent + dispatch events. Not as
      // perfectly-integrated as execCommand but accepts the text
      // even when execCommand is unavailable (some enterprise
      // Chrome configs disable it).
      div.textContent = text
      div.dispatchEvent(new Event('input', { bubbles: true }))
      div.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
  } catch (_) {
    return false
  }
}

// ---- Storage write (debounced) ----
//
// Per the project idiom, write to chrome.storage.local ONLY when
// the JSON differs from the previous write, plus a 250ms rate
// ceiling. The popup's storage.onChanged listener routes on the
// same key, so duplicate writes collapse to one popup re-paint.
let lastWrittenComposeJson = null
let lastComposeWriteAt = 0
const COMPOSE_WRITE_INTERVAL_MS = 250
function writeComposeTargetIfChanged(payload) {
  const json = JSON.stringify(payload || {})
  const now = Date.now()
  if (json === lastWrittenComposeJson && now - lastComposeWriteAt < COMPOSE_WRITE_INTERVAL_MS) {
    return
  }
  lastWrittenComposeJson = json
  lastComposeWriteAt = now
  try {
    chrome.storage.local.set({ [COMPOSE_STORAGE_KEY]: payload })
  } catch (_) {
    // Quota exceeded / storage off — fail silent.
  }
}

// ---- Polling loop ----
//
// Gmail is React + dispatches state changes on every keystroke in
// the To: field, so a MutationObserver on the parent would fire
// dozens of times per second. A simple setInterval(1000) keeps
// the surface small. Single-flight guarded by an in-flight flag so
// a slow DOM access on one tick doesn't overlap the next.
let pollInFlight = false
function pollComposeState() {
  if (pollInFlight) return
  pollInFlight = true
  try {
    if (!targeter) return
    const subjectEl = targeter.findSubject()
    const bodyEl = targeter.findBody()
    const toAddr = targeter.readTo()
    if (!toAddr && !subjectEl && !bodyEl) {
      // No compose window open yet — clear the cached target so a
      // popup-open doesn't ship a stale recipient. This is the
      // "user closed compose" path the popup needs to detect.
      writeComposeTargetIfChanged({
        provider: PROVIDER,
        present: false,
        recipient: null,
        url: window.location.href,
        capturedAt: Date.now(),
      })
      return
    }
    writeComposeTargetIfChanged({
      provider: PROVIDER,
      present: true,
      recipient: toAddr || null,
      hasSubject: !!subjectEl,
      hasBody: !!bodyEl,
      url: window.location.href,
      capturedAt: Date.now(),
    })
  } finally {
    pollInFlight = false
  }
}

// ---- Inbound injection handler ----
//
// The popup sends {type:'JOBBPILOTEN_EMAIL_INJECT', subject, body}
// via chrome.runtime.sendMessage -> chrome.tabs.sendMessage (or
// the content-script bridge). We ack with {injected: true} (or
// {injected: false, error}) so the popup can update the toast.
try {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false
    if (message.type !== INJECT_MESSAGE_TYPE) return false
    const subject = String(message.subject || '')
    const body = String(message.body || '')
    ;(async () => {
      try {
        if (!targeter) {
          sendResponse({ injected: false, error: 'Ingen komposition detekterad' })
          return
        }
        const subjectEl = targeter.findSubject()
        const bodyEl = targeter.findBody()
        if (!subjectEl || !bodyEl) {
          sendResponse({ injected: false, error: 'Kunde inte hitta ämne- eller brödtextfältet' })
          return
        }
        const subjectOk = setComposeSubject(subjectEl, subject)
        // Give the React state a microtask to settle before the
        // body mutation. Setting subject synchronously then body
        // async has been observed to drop the body on Outlook
        // because the focused-out state change resets the body.
        await new Promise((resolve) => setTimeout(resolve, 30))
        const bodyEl2 = targeter.findBody() || bodyEl
        const bodyOk = setComposeBody(bodyEl2, body)
        sendResponse({ injected: !!(subjectOk && bodyOk), subjectOk, bodyOk })
      } catch (err) {
        sendResponse({ injected: false, error: (err && err.message) || String(err) })
      }
    })()
    return true
  })
} catch (_) {
  // Firefox-style browsers without chrome.runtime — degrade silently.
}

// ---- Kickoff ----
//
if (PROVIDER && targeter) {
  // Immediate scan so a popup opened immediately after the user
  // hits /compose sees the recipient without waiting a full poll
  // cycle. Rate-limit / dedupe is handled inside writeComposeTargetIfChanged.
  //
  // Round-53 followup: we DO NOT add a `pagehide` handler that
  // calls chrome.storage.local.remove(COMPOSE_STORAGE_KEY). Gmail
  // and Outlook are full SPAs — pagehide fires on every internal
  // navigation (clicking a message, archiving, switching folders)
  // while the user remains "in compose". The pre-fix handler
  // wiped the cached recipient mid-session, breaking the popup's
  // context. The poll loop overwrites the key on the next tick
  // anyway, so the explicit cleanup is both harmful AND redundant.
  pollComposeState()
  setInterval(pollComposeState, COMPOSE_POLL_MS)
}
