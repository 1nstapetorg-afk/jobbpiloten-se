/**
 * lib/mobile-autofill.js — mobile in-app browser autofill bridge.
 *
 * Round-95 (mobile app browser, Chrome-extension replacement). The Chrome
 * extension runs `extension/content.js` inside every page it has
 * `host_permissions` for; on mobile we instead inject a SELF-CONTAINED
 * JavaScript string into the @capgo/capacitor-inappbrowser webview via
 * `InAppBrowser.executeScript({ code })`.
 *
 * `generateAutofillScript(profileData, jobData)` returns that string. The
 * string is a zero-dependency IIFE — no imports, no backticks, no `${}`
 * (it must survive embedding in a template literal AND running inside an
 * arbitrary third-party page). It:
 *
 *   1. Rebuilds a curated copy of the extension's FIELD_PATTERNS table
 *      (label/name/id/placeholder/autocomplete → profile key), the same
 *      universal fields `lib/field-taxonomy.js` defines.
 *   2. Creates a floating "JobbPiloten ✈" button in the bottom-right.
 *   3. On tap (or on a `messageFromNative` event with `{ action: 'fill' }`),
 *      fills every matched text/select/textarea field from the profile,
 *      flashes a subtle green border on each filled field, and shows the
 *      toast "Formuläret ifyllt! Kontrollera och skicka.".
 *   4. Reports the filled-field count back to the app via
 *      `window.mobileApp.postMessage({ action: 'autofilled', count })`
 *      when the native bridge is present (the plugin injects
 *      `window.mobileApp` automatically).
 *
 * Pure module (no React/Capacitor imports) so it is unit-testable under
 * node --test: tests assert the generated string embeds the profile data,
 * the field-pattern sources, the toast copy, and the floating-button
 * markup, and that the script is syntactically valid JavaScript.
 */

/** Toast copy shown after a successful fill (locked by unit tests). */
export const AUTOFILL_TOAST = 'Formuläret ifyllt! Kontrollera och skicka.'

/** postMessage action the injected script listens for (app → webview). */
export const AUTOFILL_FILL_ACTION = 'fill'

/** postMessage action the injected script emits (webview → app). */
export const AUTOFILL_DONE_ACTION = 'autofilled'

/**
 * Curated copy of the extension's FIELD_PATTERNS table (extension/content.js),
 * reduced to the universal + motivation fields a mobile form needs. Each
 * `source` is a RegExp source (no slashes/flags — always matched with `i`),
 * `key` is the dot-addressable path into the profile object, and `kind`
 * is '' | 'multi' (textarea) | 'select' (dropdown).
 *
 * The regexes are intentionally looser than the extension's (single-line,
 * substring matching) because the mobile script is smaller and the
 * page-context is a single job-application form, not the open web.
 */
const MOBILE_FIELD_PATTERNS = [
  { source: 'förnamn|first name|fname|given name', key: 'firstName' },
  { source: 'efternamn|last name|lname|surname|family name', key: 'lastName' },
  { source: 'fullständigt namn|full name|ditt namn|\\bnamn\\b', key: 'fullName' },
  { source: 'mejladress|mailadress|email|e-post|epost|e-postadress|e-post', key: 'email' },
  { source: 'telefon|telefonnummer|phone|mobile|mobil|cell', key: 'phone' },
  { source: 'gatuadress|address|street|gata', key: 'street' },
  { source: 'postnummer|postnr|zip|postal code', key: 'zip' },
  { source: '\\bort\\b|\\bcity\\b|\\bstad\\b|\\bkommun\\b', key: 'city' },
  { source: 'linkedin', key: 'linkedin' },
  { source: 'löneanspråk|önskad lön|salary|lön', key: 'salaryExpectation' },
  { source: 'personligt brev|cover letter|ansökningsbrev', key: 'latestCoverLetter', kind: 'multi' },
  { source: 'sammanfattning|meritförteckning|profil|about you|about me', key: 'cvSummary', kind: 'multi' },
  { source: 'varför.*hos|why.*company|why.*us', key: 'answers.whyThisCompany', kind: 'multi' },
  { source: 'varför.*(roll|tjänst|position|jobb)|why.*(role|position|job)', key: 'answers.whyThisRole', kind: 'multi' },
  { source: 'styrkor|strengths', key: 'answers.strengths', kind: 'multi' },
  { source: 'svagheter|weaknesses', key: 'answers.weaknesses', kind: 'multi' },
  { source: 'tillgänglig|startdatum|available|start date', key: 'answers.availability', kind: 'select' },
  { source: 'födelsedatum|födelseår|birth|dob', key: 'dateOfBirth', kind: 'select' },
  { source: '\\bkön\\b|\\bgender\\b|\\bsex\\b', key: 'gender', kind: 'select' },
]

/** Field tags the fill loop skips (files/radios/checkboxes/submits). */
const SKIP_TAGS = new Set(['FILE', 'RADIO', 'CHECKBOX', 'SUBMIT', 'BUTTON', 'RESET', 'IMAGE'])
const SKIP_TYPES = new Set(['file', 'radio', 'checkbox', 'submit', 'button', 'reset', 'image', 'password', 'hidden'])

/**
 * Normalize arbitrary profile/job data into a JSON-safe payload so the
 * generated script never embeds `undefined`, functions, or circular refs.
 * `undefined` / functions are dropped by JSON.stringify; here we also
 * coerce nulls to '' for string-ish fields so the fill loop skips them
 * cleanly (setValue already treats '' as "leave alone").
 */
export function sanitizeAutofillPayload(profileData, jobData) {
  return {
    profile: profileData && typeof profileData === 'object' ? profileData : {},
    job: jobData && typeof jobData === 'object' ? jobData : {},
  }
}

/**
 * Build the self-contained injected script. See the module header for the
 * full contract. `profileData` and `jobData` are serialized with
 * JSON.stringify so the result is a deterministic, embeddable string.
 */
export function generateAutofillScript(profileData = {}, jobData = {}) {
  const { profile, job } = sanitizeAutofillPayload(profileData, jobData)
  const patternsJson = JSON.stringify(MOBILE_FIELD_PATTERNS)
  const profileJson = JSON.stringify(profile)
  const jobJson = JSON.stringify(job)
  const toastJson = JSON.stringify(AUTOFILL_TOAST)
  const fillActionJson = JSON.stringify(AUTOFILL_FILL_ACTION)
  const doneActionJson = JSON.stringify(AUTOFILL_DONE_ACTION)

  // The body deliberately avoids backticks and ${} so it can live inside
  // this template literal without escaping, and stays parseable as a plain
  // ES5-ish string once injected.
  return '(function () {\n' +
    '  if (window.__jobbpilotenMobileLoaded) { return; }\n' +
    '  window.__jobbpilotenMobileLoaded = true;\n' +
    '  var PROFILE = ' + profileJson + ';\n' +
    '  var JOB = ' + jobJson + ';\n' +
    '  var PATTERNS = ' + patternsJson + ';\n' +
    '  var TOAST = ' + toastJson + ';\n' +
    '  var FILL_ACTION = ' + fillActionJson + ';\n' +
    '  var DONE_ACTION = ' + doneActionJson + ';\n' +
    '  var FIELD_PATTERNS = PATTERNS.map(function (p) {\n' +
    '    return { re: new RegExp(p.source, "i"), key: p.key, kind: p.kind || "" };\n' +
    '  });\n' +
    '  function resolvePath(obj, path) {\n' +
    '    var parts = String(path || "").split(".");\n' +
    '    var cur = obj;\n' +
    '    for (var i = 0; i < parts.length; i++) {\n' +
    '      if (cur == null) { return undefined; }\n' +
    '      cur = cur[parts[i]];\n' +
    '    }\n' +
    '    return cur;\n' +
    '  }\n' +
    '  function getMeta(input) {\n' +
    '    var parts = [];\n' +
    '    if (input.name) { parts.push(input.name); }\n' +
    '    if (input.id) { parts.push(input.id); }\n' +
    '    if (input.getAttribute) {\n' +
    '      parts.push(input.getAttribute("placeholder") || "");\n' +
    '      parts.push(input.getAttribute("aria-label") || "");\n' +
    '      parts.push(input.getAttribute("autocomplete") || "");\n' +
    '    }\n' +
    '    if (input.labels && input.labels[0]) { parts.push(input.labels[0].innerText || input.labels[0].textContent || ""); }\n' +
    '    if (input.closest) {\n' +
    '      var wrap = input.closest("label, fieldset, .form-group, .form-row, .field");\n' +
    '      if (wrap) { parts.push(wrap.innerText || wrap.textContent || ""); }\n' +
    '    }\n' +
    '    return parts.filter(Boolean).join(" · ");\n' +
    '  }\n' +
    '  function matchField(input) {\n' +
    '    var meta = getMeta(input);\n' +
    '    if (!meta) { return null; }\n' +
    '    for (var i = 0; i < FIELD_PATTERNS.length; i++) {\n' +
    '      var entry = FIELD_PATTERNS[i];\n' +
    '      if (entry.re.test(meta)) { return entry; }\n' +
    '    }\n' +
    '    return null;\n' +
    '  }\n' +
    '  function setValue(input, value) {\n' +
    '    if (value == null || value === "") { return false; }\n' +
    '    try {\n' +
    '      if (input.tagName === "SELECT") {\n' +
    '        var wanted = String(value).toLowerCase();\n' +
    '        var opts = Array.prototype.slice.call(input.options || []);\n' +
    '        for (var i = 0; i < opts.length; i++) {\n' +
    '          var text = String(opts[i].text || opts[i].value || "").toLowerCase();\n' +
    '          if (text.indexOf(wanted) !== -1 || (wanted && text.indexOf(wanted.slice(0, 4)) === 0)) {\n' +
    '            input.value = opts[i].value;\n' +
    '            input.dispatchEvent(new Event("change", { bubbles: true }));\n' +
    '            return true;\n' +
    '          }\n' +
    '        }\n' +
    '        return false;\n' +
    '      }\n' +
    '      var proto = Object.getPrototypeOf(input);\n' +
    '      var desc = Object.getOwnPropertyDescriptor(proto, "value");\n' +
    '      var setter = (desc && desc.set) || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;\n' +
    '      if (setter) { setter.call(input, value); } else { input.value = value; }\n' +
    '      input.dispatchEvent(new Event("input", { bubbles: true }));\n' +
    '      input.dispatchEvent(new Event("change", { bubbles: true }));\n' +
    '      return true;\n' +
    '    } catch (e) { return false; }\n' +
    '  }\n' +
    '  function highlight(input) {\n' +
    '    try {\n' +
    '      var prev = input.style.outline;\n' +
    '      input.style.outline = "2px solid #10b981";\n' +
    '      input.style.outlineOffset = "1px";\n' +
    '      setTimeout(function () { input.style.outline = prev; }, 2200);\n' +
    '    } catch (e) { /* cosmetic only */ }\n' +
    '  }\n' +
    '  function toast(msg) {\n' +
    '    try {\n' +
    '      var old = document.getElementById("jp-mobile-toast");\n' +
    '      if (old) { old.parentNode.removeChild(old); }\n' +
    '      var el = document.createElement("div");\n' +
    '      el.id = "jp-mobile-toast";\n' +
    '      el.setAttribute("role", "status");\n' +
    '      el.textContent = msg;\n' +
    '      el.style.cssText = "position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483647;background:#111827;color:#fff;padding:12px 18px;border-radius:10px;font:600 14px/1.3 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.25);max-width:86vw;text-align:center;";\n' +
    '      document.body.appendChild(el);\n' +
    '      setTimeout(function () { if (el.parentNode) { el.parentNode.removeChild(el); } }, 3200);\n' +
    '    } catch (e) { /* cosmetic only */ }\n' +
    '  }\n' +
    '  function fillAll() {\n' +
    '    var inputs = document.querySelectorAll("input, textarea, select");\n' +
    '    var filled = 0;\n' +
    '    for (var i = 0; i < inputs.length; i++) {\n' +
    '      var input = inputs[i];\n' +
    '      if (SKIP_TAGS.indexOf(input.tagName) !== -1) { continue; }\n' +
    '      var type = String((input.getAttribute && input.getAttribute("type")) || "").toLowerCase();\n' +
    '      if (SKIP_TYPES.indexOf(type) !== -1) { continue; }\n' +
    '      var existing = String(input.value || "").trim();\n' +
    '      if (existing.length > 0) { continue; }\n' +
    '      var entry = matchField(input);\n' +
    '      if (!entry) { continue; }\n' +
    '      var value = resolvePath(PROFILE, entry.key);\n' +
    '      if (value == null || value === "") { continue; }\n' +
    '      if (setValue(input, value)) { filled++; highlight(input); }\n' +
    '    }\n' +
    '    if (filled > 0) { toast(TOAST); }\n' +
    '    try {\n' +
    '      if (window.mobileApp && typeof window.mobileApp.postMessage === "function") {\n' +
    '        window.mobileApp.postMessage({ action: DONE_ACTION, count: filled });\n' +
    '      }\n' +
    '    } catch (e) { /* bridge absent — web/dev fallback */ }\n' +
    '    return filled;\n' +
    '  }\n' +
    '  function createButton() {\n' +
    '    if (document.getElementById("jp-mobile-fab")) { return; }\n' +
    '    var btn = document.createElement("button");\n' +
    '    btn.id = "jp-mobile-fab";\n' +
    '    btn.type = "button";\n' +
    '    btn.setAttribute("aria-label", "Fyll i automatiskt");\n' +
    '    btn.textContent = "✈ JobbPiloten";\n' +
    '    btn.style.cssText = "position:fixed;right:16px;bottom:24px;z-index:2147483646;background:#4f46e5;color:#fff;border:0;border-radius:999px;padding:14px 18px;font:600 15px/1 system-ui,sans-serif;box-shadow:0 8px 24px rgba(79,70,229,0.4);cursor:pointer;";\n' +
    '    btn.addEventListener("click", function () { fillAll(); });\n' +
    '    (document.body || document.documentElement).appendChild(btn);\n' +
    '  }\n' +
    '  function listenForNative() {\n' +
    '    try {\n' +
    '      window.addEventListener("messageFromNative", function (ev) {\n' +
    '        var detail = (ev && ev.detail) || {};\n' +
    '        if (detail && detail.action === FILL_ACTION) { fillAll(); }\n' +
    '      });\n' +
    '    } catch (e) { /* bridge absent */ }\n' +
    '  }\n' +
    '  window.JobbPilotenMobile = { fill: fillAll, matchField: matchField, getMeta: getMeta };\n' +
    '  if (document.readyState === "loading") {\n' +
    '    document.addEventListener("DOMContentLoaded", function () { createButton(); });\n' +
    '  } else {\n' +
    '    createButton();\n' +
    '  }\n' +
    '  listenForNative();\n' +
    '})();\n'
}
