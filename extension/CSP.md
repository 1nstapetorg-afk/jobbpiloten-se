# Extension Content-Security-Policy

The extension's Content-Security-Policy is set in
[`manifest.json`](./manifest.json) under `content_security_policy.extension_pages`.

> Chrome ignores the `<meta http-equiv="Content-Security-Policy">` in
> `popup.html` when the manifest is present; the meta is a read-only
> shadow kept for parity. The directive list in the manifest is the
> **SECURITY ceiling** for the extension pages — any addition there
> must be a narrowing exception with an inline comment naming the
> legitimate need.

## Directive breakdown

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'none'` | Block everything by default |
| `script-src` | `'self'` | Bundled `popup.js` / `background.js` only |
| `style-src` | `'self'` | `popup.css` only (no `<style>`/`blob:`) |
| `img-src` | `'self' data:` | Toolbar icons + `data:` URIs for the small inline avatar SVGs |
| `connect-src` | `'self' https://jobbpiloten.se https://*.vercel.app https://*.preview.emergentagent.com http://localhost:* https://mail.google.com https://outlook.live.com https://outlook.office.com https://*.arbetsformedlingen.se https://*.blocket.se` | Outbound fetch/XHR targets. Production dashboard (`jobbpiloten.se`), Vercel preview deployments, the local dev server, the three webmail hosts (Gmail + Outlook personal/business — the compose-side AI draft fetch), and the two Swedish job-board hosts (Arbetsförmedlingen + Blocket) whose `host_permissions` are required for the content script's direct fetch paths. **Always keep this in parity with `host_permissions`** — a pattern present in `host_permissions` but missing here will throw a CSP violation at runtime even though Chrome will load the extension. |
| `object-src` | `'none'` | Close `<object>`/`<embed>` surface |
| `form-action` | `'none'` | Close `<form action>` hijack surface |
| `frame-ancestors` | `'none'` | Popup refuses to be iframed |

## Why a separate file?

`manifest.json` must be strict JSON — Chrome's manifest parser
rejects the file outright if it sees a `//` comment (this used to
be a silent footgun: the packaging script fell back to defaults
and the resulting `.zip` would fail to load in Chrome with
`Manifest is not valid JSON`). Keeping the security rationale
here in Markdown means the manifest stays parseable while the
reasoning for each directive is preserved for the next person
who needs to widen or tighten it.

## When you need to add a directive

1. Add the directive to `manifest.json` (the manifest JSON itself
   has no comments — the justification must live in the **commit
   message** so `git log -p manifest.json` shows the security
   review trail).
2. **If adding a host to `connect-src`, also add it to
   `host_permissions` (and vice versa).** One without the other
   either trips a runtime CSP block (missing connect-src) or
   silently fails the API call (missing host_permissions).
3. Update the table above.
4. Run `yarn package:extension` and verify no manifest warning
   is emitted by the packaging script.
5. Run `yarn validate:extension` — the validator exits non-zero on
   any manifest sanity failure, so the chain won't silently ship
   a malformed CSP.
