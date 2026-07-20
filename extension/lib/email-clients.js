/**
 * JobbPiloten Auto-Fill — Round-55 / Followup 3.
 *
 * Shared email-client host list + URL/host helper functions.
 *
 * TWO CONSUMERS, ONE SOURCE OF TRUTH:
 *   1. extension/popup.js's `isActiveTabEmailClient()` — used by the
 *      Round-54 URL-based mode auto-switch gate. Matches the active
 *      tab's URL against this host list.
 *   2. extension/content-email.js's `detectProvider()` — used by
 *      the compose-target detector to pick the right DOM lookup
 *      table (Gmail / Outlook personal / Outlook business).
 *
 * DRIFT FOOTGUN: pre-Round-55 both consumers inlined the same
 * three-host list verbatim. A 4th webmail provider (e.g. ProtonMail
 * web) added to one site but not the other would leave a host where
 * the compose-target detector works but the auto-switch doesn't
 * fire — or vice versa. This module collapses both lists into one
 * single export so a single edit covers both call sites.
 *
 * PURE-JS, NO chrome.* DEPENDENCIES — every helper accepts a URL
 * or hostname as an argument. This is the same pattern as
 * extension/lib/dashboard-url-resolver.js, so the two shared
 * extension modules follow identical boundary contracts (the
 * static-regex test contract in tests/unit/popup-resolver.test.mjs
 * for the resolver, and a new tests/unit/email-clients.test.mjs for
 * this module).
 *
 * EXPORTS:
 *   • EMAIL_CLIENT_HOSTS   — ordered list of canonical webmail hosts
 *   • isEmailClientUrl(url) — substring/prefix match against the list
 *   • detectProviderByHost(host) — host-only mapper for content-email.js
 *   • EMAIL_CLIENT_PREFIXES — the `https://` URL prefixes each host
 *                             expands to. Used by `isActiveTabUrl()` to
 *                             avoid substring false-positives like
 *                             `evil-mail.google.com.attacker.com/`.
 *                             The `.startsWith(prefix)` test is
 *                             exact-prefix; trailing `/` is optional.
 */

/**
 * Canonical list of supported webmail hosts.
 *
 * ORDER MATTERS: the popup's auto-switch iterates this list in
 * declaration order. The first hit wins, so a host appearing earlier
 * gets priority when a URL is somehow ambiguous (none of the
 * current entries overlap, but the contract is "first match wins"
 * for any future addition).
 */
export const EMAIL_CLIENT_HOSTS = [
  'mail.google.com',     // Gmail (https://mail.google.com/mail/u/N/...)
  'outlook.live.com',    // Outlook personal (https://outlook.live.com/mail/...)
  'outlook.office.com',  // Outlook business (https://outlook.office.com/mail/...)
]

/**
 * HTTPS URL prefixes derived from EMAIL_CLIENT_HOSTS. Used by
 * `isEmailClientUrl()` so the match is anchored at the scheme+host
 * boundary, not a substring match anywhere in the URL.
 *
 * The `https://` prefix is mandatory — content scripts run on the
 * scheme the user is browsing, and any of the three supported
 * webmail clients on http:// would either (a) redirect to https://
 * or (b) be a downgrade attack. We refuse non-https URLs by
 * construction.
 */
export const EMAIL_CLIENT_PREFIXES = EMAIL_CLIENT_HOSTS.map((h) => `https://${h}/`)

/**
 * Match a URL string against the email-client host list.
 *
 * The check is anchored at the scheme+host boundary via the
 * `EMAIL_CLIENT_PREFIXES` list (substring-free). This is the same
 * security stance as `extension/content.js`'s `assertOriginAllowed`
 * helper — a URL like `https://evil-mail.google.com.attacker.com/`
 * would substring-match `mail.google.com` but its scheme+host
 * starts with `https://evil-mail.google.com.attacker.com/`, which
 * is NOT in `EMAIL_CLIENT_PREFIXES`, so the match is correctly
 * false.
 *
 * Returns `false` for non-string inputs (null, undefined, numbers)
 * so a bad runtime read never accidentally auto-switches.
 *
 * @param {string|undefined|null} url - The URL to test (typically from
 *   `chrome.tabs.query` `tab.url`).
 * @returns {boolean}
 */
export function isEmailClientUrl(url) {
  if (typeof url !== 'string' || !url) return false
  const lower = url.toLowerCase()
  return EMAIL_CLIENT_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

/**
 * Map a hostname string to the canonical provider key consumed by
 * content-email.js's DOM lookup tables.
 *
 * Returns one of:
 *   - 'gmail'             — mail.google.com
 *   - 'outlook-personal'  — outlook.live.com
 *   - 'outlook-business'  — outlook.office.com
 *   - null                — any other host
 *
 * The 3-way split mirrors the THREE buildTargeter() branches in
 * content-email.js (gmail / outlook-personal / outlook-business).
 * Adding a 4th provider requires:
 *   1. Add the host to `EMAIL_CLIENT_HOSTS` above.
 *   2. Add the matching `case` here returning the new key.
 *   3. Add a `if (PROVIDER === 'new-key')` branch in
 *      buildTargeter() in content-email.js with the right DOM lookups.
 *   4. Add a regression test in tests/unit/email-clients.test.mjs
 *      covering the new host + the 4 other hosts in the list.
 *
 * @param {string|undefined|null} host - Bare hostname (no scheme, no path).
 * @returns {'gmail'|'outlook-personal'|'outlook-business'|null}
 */
export function detectProviderByHost(host) {
  if (typeof host !== 'string' || !host) return null
  const h = host.toLowerCase()
  if (h === 'mail.google.com') return 'gmail'
  if (h === 'outlook.live.com') return 'outlook-personal'
  if (h === 'outlook.office.com') return 'outlook-business'
  return null
}
