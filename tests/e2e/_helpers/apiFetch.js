// tests/e2e/_helpers/apiFetch.js
//
// E2E fetch helper, shared across tests/e2e/** specs.
//
// Routes through Playwright's `page.request.fetch` (the APIRequestContext
// wrapper around fetch) rather than `page.evaluate(fetch())`. Both share
// the browser context's cookies but `page.request.fetch` honours
// `playwright.config.js`'s `use.baseURL` automatically — so the helper
// works on a freshly-created page that's still on `about:blank`. The
// older `page.evaluate(fetch(path))` design throws
// "Failed to parse URL from /api/..." on about:blank because there's
// no document base URL.
//
// Call signature is `(page, path, init)` mirroring the browser Fetch
// API so existing assertions don't change. The `init` shape matches
// `RequestInit`: `method`, `headers`, `body` (string | URLSearchParams
// | FormData | object). The body branch is future-proofed for specs
// that POST a real payload — none of today's call sites need it, but
// the helper generalises cleanly so we don't ship a per-spec duplicate
// the next time a contract test needs a body.
//
// Returns `{ status, body, contentType }` so the assertion layer can
// branch on HTTP code without re-parsing.

export async function apiFetch(page, path, init = {}) {
  // Map standard-fetch `init` (method / headers / body) into
  // APIRequestContext options.
  const opts = {}
  if (init.method) opts.method = init.method
  if (init.headers) opts.headers = { ...init.headers }

  // Body forwarding — supports three shapes (none of the current call
  // sites supply a body, this is forward-compat for spec authors who
  // need to POST a real payload):
  //
  //   • FormData instance → opts.multipart (object keyed by field).
  //     Each entry becomes a string OR a `{ name, mimeType, buffer }`
  //     tuple for File/Blob values — Playwright's multipart option
  //     expects this exact shape.
  //   • URLSearchParams   → opts.form (key/value object).
  //   • plain object      → opts.data (Playwright serialises to JSON
  //                         and sets Content-Type: application/json).
  //   • string            → opts.data (passed verbatim).
  if (init.body !== undefined && init.body !== null) {
    if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
      const parts = {}
      for (const [key, value] of init.body.entries()) {
        if (value instanceof Blob) {
          parts[key] = {
            name: value.name || key,
            mimeType: value.type || 'application/octet-stream',
            buffer: Buffer.from(await value.arrayBuffer()),
          }
        } else if (typeof value === 'string') {
          parts[key] = value
        } else {
          parts[key] = String(value)
        }
      }
      opts.multipart = parts
    } else if (typeof URLSearchParams !== 'undefined' && init.body instanceof URLSearchParams) {
      opts.form = Object.fromEntries(init.body.entries())
    } else {
      // Plain object (Playwright serialises to JSON) or raw string.
      opts.data = init.body
    }
  }

  const res = await page.request.fetch(path, opts)
  const text = await res.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    // Non-JSON bodies (e.g. multipart error) come back as raw text —
    // surface as the body field so the test message is meaningful.
    body = text
  }
  // Note: APIResponse uses METHODS (status(), headers(), text()) not
  // properties (status, headers, text) like the browser FetchResponse.
  // A failure here looks like "Received: [Function status]" — easy to
  // miss in test output.
  return {
    status: res.status(),
    body,
    contentType: res.headers()['content-type'] || '',
  }
}
