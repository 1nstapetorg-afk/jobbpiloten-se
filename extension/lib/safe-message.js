/**
 * extension/lib/safe-message.js
 *
 * Defensive wrappers for the two chrome message APIs the popup relies
 * on. Without these, `chrome.tabs.sendMessage` to a tab without a
 * content script (chrome:// pages, the Chrome Web Store, PDF viewer,
 * a closed/backgrounded tab) rejects asynchronously; if the calling
 * handler is structured as an `await chain` without try/catch (popup.js
 * historically had this pattern), the rejection surfaces nowhere and
 * the popup looks frozen to the user — Bug 2 from the 2026-07-20
 * Monday-test session.
 *
 * The fix wraps each send in a Promise.race against a timeout. After
 * `DEFAULT_TIMEOUT_MS` we resolve to a sentinel `{ ok: false, reason:
 * 'timeout' }` so the caller can branch into a friendly toast like
 * "Bakgrundsskriptet svarar inte — försök igen" rather than letting
 * the dangling Promise sit forever. We DO NOT throw — calling code
 * usually wants to fall through to the next branch, not crash the
 * whole click handler.
 *
 * The `runtime-send-timeout` and `tabs-send-timeout` reasons are also
 * recorded under `chrome.runtime.lastError`-shaped objects so the
 * popup's existing {ok, reason} branch logic (which inspects
 * lastError first, then timeout) keeps working unchanged.
 */

export const DEFAULT_TIMEOUT_MS = 3000

const TIMEOUT_OK_FALSE = Object.freeze({ ok: false, reason: 'timeout' })
const LAST_ERROR_OK_FALSE = Object.freeze({ ok: false, reason: 'lastError' })

/**
 * Send a message to the extension's background service worker with a
 * hard timeout. Resolves with the reply, or with the sentinel object
 * `{ ok: false, reason: 'timeout' | 'lastError' }` on failure (NEVER
 * throws — caller's existing error branches handle both shapes).
 *
 * @param {object} message
 * @param {number} [timeoutMs]
 * @returns {Promise<unknown>}
 */
export function safeRuntimeSend(message, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(TIMEOUT_OK_FALSE)
    }, timeoutMs)
    try {
      chrome.runtime.sendMessage(message, (reply) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (chrome.runtime?.lastError) {
          resolve(LAST_ERROR_OK_FALSE)
        } else {
          resolve(reply)
        }
      })
    } catch (_) {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(LAST_ERROR_OK_FALSE)
      }
    }
  })
}

/**
 * Send a message to a specific tab's content script with a hard
 * timeout. Same shape as safeRuntimeSend — never throws, returns the
 * reply or a `{ ok: false, reason }` sentinel. The most common
 * reason here is `'lastError'` because the tab is
 * chrome://settings, the Chrome Web Store, or has been closed since
 * the query.
 *
 * @param {number} tabId
 * @param {object} message
 * @param {number} [timeoutMs]
 * @returns {Promise<unknown>}
 */
export function safeTabsSendMessage(tabId, message, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(TIMEOUT_OK_FALSE)
    }, timeoutMs)
    try {
      chrome.tabs.sendMessage(tabId, message, (reply) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (chrome.runtime?.lastError) {
          resolve(LAST_ERROR_OK_FALSE)
        } else {
          resolve(reply)
        }
      })
    } catch (_) {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(LAST_ERROR_OK_FALSE)
      }
    }
  })
}

/**
 * Wrap a chrome.storage.local.get() in a timeout. Defaults to
 * DEFAULT_TIMEOUT_MS so a hung MV3 worker can't freeze the popup
 * past 3 s waiting on storage.
 *
 * @param {string|string[]|object} keys
 * @param {number} [timeoutMs]
 * @returns {Promise<object>}
 */
export function safeStorageGet(keys, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve({ __safeStorageTimeout: true })
    }, timeoutMs)
    try {
      chrome.storage.local.get(keys, (data) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(data || {})
      })
    } catch (_) {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ __safeStorageGetThrow: true })
      }
    }
  })
}
