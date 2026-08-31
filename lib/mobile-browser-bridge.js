/**
 * lib/mobile-browser-bridge.js — lazy, SSR-safe bridge to the
 * @capgo/capacitor-inappbrowser native plugin.
 *
 * Round-95 (mobile in-app browser). The plugin packages register a global
 * `Capacitor` object + native plugin at import time and touch
 * `window`/`Capacitor` globals, which is NOT safe to do during Next.js
 * server rendering. Every function here therefore `await import(...)`s the
 * packages lazily — nothing Capacitor-related is imported at module top
 * level — so lib/browser-store.jsx (which imports this module) can be
 * evaluated server-side without throwing.
 *
 * Every wrapper is a resolved no-op on the web and swallows errors: an
 * autofill/browser hiccup must never break a user-facing action. On web
 * the store falls back to an <iframe> for the content layer.
 */

let _cache = null

async function load() {
  if (_cache) return _cache
  const core = await import('@capacitor/core')
  const mod = await import('@capgo/capacitor-inappbrowser')
  _cache = { Capacitor: core.Capacitor, InAppBrowser: mod.InAppBrowser }
  return _cache
}

/** True only when running inside the Capacitor native shell (iOS/Android). */
export async function isNativePlatform() {
  try {
    const { Capacitor } = await load()
    return typeof Capacitor?.isNativePlatform === 'function' && Capacitor.isNativePlatform()
  } catch (_) {
    return false
  }
}

/**
 * Open the native webview BEHIND the Capacitor host WebView (toBack) with
 * no native toolbar, so the React browser screen (top bar / tab bar / FAB)
 * renders as chrome on top of the native content. Returns the webview id,
 * or null on web / failure.
 */
export async function openWebView(url) {
  try {
    const { InAppBrowser } = await load()
    const res = await InAppBrowser.openWebView({
      url,
      toolbarType: 'blank',
      toBack: true,
      enabledSafeTopMargin: false,
      isPresentAfterPageLoad: false,
    })
    return (res && res.id) || null
  } catch (_) {
    return null
  }
}

export async function closeWebView(id) {
  try {
    const { InAppBrowser } = await load()
    await InAppBrowser.close(id ? { id } : undefined)
  } catch (_) { /* no-op */ }
}

export async function setWebViewUrl(id, url) {
  try {
    const { InAppBrowser } = await load()
    await InAppBrowser.setUrl({ url, id })
  } catch (_) { /* no-op */ }
}

export async function executeScript(id, code) {
  try {
    const { InAppBrowser } = await load()
    await InAppBrowser.executeScript({ code, id })
  } catch (_) { /* no-op */ }
}

export async function postMessageToWebView(id, detail) {
  try {
    const { InAppBrowser } = await load()
    await InAppBrowser.postMessage({ detail, id })
  } catch (_) { /* no-op */ }
}

export async function reloadWebView(id) {
  try {
    const { InAppBrowser } = await load()
    await InAppBrowser.reload(id ? { id } : undefined)
  } catch (_) { /* no-op */ }
}

/**
 * Register a URL-change listener (fires on every in-webview navigation).
 * Returns an unsubscribe function (no-op on web / failure). Used by the
 * store to update the address bar + re-check autofill on navigation.
 */
export async function addUrlChangeListener(cb) {
  try {
    const { InAppBrowser } = await load()
    const handle = await InAppBrowser.addListener('urlChangeEvent', cb)
    return () => { try { handle?.remove?.() } catch (_) { /* no-op */ } }
  } catch (_) {
    return () => { /* no-op */ }
  }
}

/**
 * Register a `messageFromWebview` listener. The injected autofill script
 * posts `{ action: 'autofilled', count }` via window.mobileApp.postMessage;
 * the store surfaces that as the "marked applied / success toast" trigger.
 */
export async function addMessageFromWebViewListener(cb) {
  try {
    const { InAppBrowser } = await load()
    const handle = await InAppBrowser.addListener('messageFromWebview', cb)
    return () => { try { handle?.remove?.() } catch (_) { /* no-op */ } }
  } catch (_) {
    return () => { /* no-op */ }
  }
}
