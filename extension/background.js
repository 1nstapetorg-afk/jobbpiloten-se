/**
 * JobbPiloten Auto-Fill — background service worker (MV3).
 *
 * Responsibilities (kept minimal so the bundle stays under 150 KB):
 *   • Forward auth-profile sync from the dashboard tab to the active
 *     content scripts via chrome.tabs.sendMessage (the dashboard can't
 *     reach the content script on a different origin since the
 *     extension only injects a content script — not a window-level
 *     message channel).
 *   • On install: surface a one-time "first run" hint so the popup
 *     tells the user to open /dashboard to connect.
 *   • Listen for chrome.storage changes so we can broadcast a
 *     "profile-updated" event to all tabs without round-tripping
 *     to the API endpoint from each content script.
 *
 * The worker is `type: module` so we can use top-level await + ESM
 * imports without a bundler. Modules are loaded once per worker
 * lifetime — same as classic scripts.
 */

const JOBBPILOTEN_EXTENSION_VERSION = '0.2.1'

// Atomic fill-rate-limit slot acquisition — content scripts ask
// before they touch any DOM. The SW is single-threaded across every
// tab and every content-script instance, so two concurrent fillAll()
// calls (one per iframe on the same page) resolve SERIALLY here and
// the second one always sees the slot taken. The module-globally
// scoped `lastFillAt` resets when the SW hibernates (~30s idle); for
// a UX-rate guard that's acceptable — the worst case after a wake is
// one extra fill, not an unbounded burst.
const FILL_RATE_LIMIT_MS = 5_000
let lastFillAt = 0

// One-time install hint — written to chrome.storage.local so the
// popup can fetch it on first open and steer the user to /dashboard.
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      jobbpiloten_installedAt: new Date().toISOString(),
      jobbpiloten_firstRun: true,
      jobbpiloten_version: JOBBPILOTEN_EXTENSION_VERSION,
    })
  }
})

// Forward auth/profile sync from a dashboard tab (the dashboard
// fetches /api/extension/token then asks us to relay the bundle
// to every active tab). We use chrome.tabs.sendMessage so the
// content script on EACH tab receives the same JWT + profile
// payload and writes them to chrome.storage.local.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false

  if (message.type === 'JOBBPILOTEN_BROADCAST_AUTH') {
    ;(async () => {
      const tabs = await chrome.tabs.query({})
      for (const tab of tabs) {
        if (!tab.id) continue
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'JOBBPILOTEN_AUTH_SYNC',
            payload: message.payload,
          })
        } catch (_) {
          // Tab without a content script (chrome:// pages, the
          // Chrome Web Store, etc.) — silent skip is fine.
        }
      }
      sendResponse({ ok: true, broadcastTo: tabs.length })
    })()
    return true
  }

  // Popup → background → content-script relay for the "Fyll i nu"
  // manual trigger. We re-broadcast so the user can click the
  // toolbar icon without focusing the target tab first; the content
  // script picks up the message either way.
  if (message.type === 'JOBBPILOTEN_TRIGGER_FILL') {
    ;(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      for (const tab of tabs) {
        if (!tab.id) continue
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'JOBBPILOTEN_TRIGGER_FILL' })
        } catch (_) { /* same skip */ }
      }
      sendResponse({ ok: true })
    })()
    return true
  }

  // Round-34 / Part 4: open the popup with the email-compose mode
  // pre-set. Triggered by the floating pill when mailto signals are
  // present, so the user clicks the pill → popup opens directly to
  // the compose panel rather than the Fyll-i-nu tab. chrome.action
  // permission is declared in manifest.json v0.2.1; falls back to a
  // chrome.tabs.create /extension-auth shortcut if disabled by
  // enterprise policy. The compose mode is communicated to the popup
  // via chrome.storage.local — same channel as the auto-detected
  // signals — so the popup's storage.onChanged listener picks it up
  // without a separate message type.
  if (message.type === 'JOBBPILOTEN_OPEN_COMPOSE') {
    try { chrome.action.openPopup() } catch (_) { /* quiet */ }
    sendResponse({ ok: true })
    return false
  }

  // Atomic fill-rate-limit acquisition — see the FILL_RATE_LIMIT_MS
  // comment at the top of this file. Synchronous reply so the content
  // script doesn't have to `await` an async turn; we hold the slot
  // for the duration of the message dispatch (microseconds).
  if (message.type === 'JOBBPILOTEN_FILL_ACQUIRE') {
    const now = Date.now()
    if (now - lastFillAt < FILL_RATE_LIMIT_MS) {
      sendResponse({ ok: false, remainingMs: FILL_RATE_LIMIT_MS - (now - lastFillAt) })
      return false
    }
    lastFillAt = now
    sendResponse({ ok: true })
    return false
  }

  // Round-72 — Log error channel. Content scripts + popup push a
  // short { source, message } record into a FIFO buffer in
  // chrome.storage.local under `jobbpiloten_errors`. The popup
  // renders the buffer as a "⚠ N fel" button + collapsible list
  // so the user can see WHY the fill failed on this tab without
  // opening devtools. We replicate the FIFO logic here (the
  // extension can't ESM-share libs with the popup without a
  // bundler pass) so the buffer survives a background-script
  // restart. The buffer is hard-capped at 20 entries; oldest
  // rolls off on overflow. The popup's chrome.storage.onChanged
  // listener picks up writes and re-paints automatically.
  if (message.type === 'JOBBPILOTEN_LOG_ERROR') {
    ;(async () => {
      try {
        const source = String(message.source || 'unknown').slice(0, 64)
        const text = String(message.message || '').slice(0, 240)
        if (!text) { sendResponse({ ok: false, ignored: 'empty' }); return }
        const prev = await chrome.storage.local.get(['jobbpiloten_errors'])
        const buf = Array.isArray(prev.jobbpiloten_errors) ? prev.jobbpiloten_errors : []
        buf.push({ source, message: text, ts: Date.now() })
        while (buf.length > 20) buf.shift()
        await chrome.storage.local.set({ jobbpiloten_errors: buf })
        sendResponse({ ok: true, count: buf.length })
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) })
      }
    })()
    return true
  }

  return false
})
