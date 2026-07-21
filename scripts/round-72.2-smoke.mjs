#!/usr/bin/env node
// scripts/round-72.2-smoke.mjs
//
// 2026-07-21 / Round-72.2 / Followup-1 — pre-release smoke-test
// against the bundled HTML fixtures. Loads each fixture, extracts
// the <input>/<textarea>/<select> elements via regex-only parsing
// (no DOM-parser deps in package.json), then runs the
// FIELD_PATTERNS regexes (extracted live from
// `extension/content.js`) against each element's reconstructed
// "meta string". Catches BUG 1 (name duplication), BUG 3 (address
// split overlap), and BUG 4 (boolean radio dedup) regressions on
// the bundled fixtures BEFORE shipping v0.2.3.
//
// Usage:
//   node scripts/round-72.2-smoke.mjs
//
// Exit code: 0 = all fixtures PASS, 1 = at least one regression.
//
// This script does NOT take the place of manual testing on real
// Swedish recruiter forms — it just guarantees the bundled
// fixtures stay regression-free for the round-72.2 fixes.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const CONTENT_JS = path.join(REPO, 'extension', 'content.js')
const FIXTURES = [
  path.join(REPO, 'app', 'mock-extension-form.html'),
  path.join(REPO, 'app', 'test-swedish-form.html'),
]

// ---------------------------------------------------------------------------
// 1. Extract FIELD_PATTERNS array from extension/content.js via balanced-brace
//    walk (mirrors the style used by scripts/lint-field-patterns.mjs).
// ---------------------------------------------------------------------------
function extractFieldPatterns(src) {
  const start = src.indexOf('const FIELD_PATTERNS = [')
  if (start < 0) throw new Error('FIELD_PATTERNS not found in extension/content.js')
  let depth = 0
  let end = -1
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end < 0) throw new Error('FIELD_PATTERNS array end not found')
  const body = src.slice(start, end + 1)
  // Walk char-by-char — split on top-level `{...}` entries.
  // Each entry has `pattern: /.../flags` + `profileKey: '...'` + optional `kind` + optional `type`.
  // The Round-12 file entries (cvFile / coverLetterFile / additionalDocuments)
  // declare `type: 'file'` (NOT `kind: 'file'`) and `matchField()` skips them
  // for non-file inputs — the extractor must capture both fields so the
  // smoke-test's matchEntries() skip predicate works correctly.
  const entries = []
  let i = 0
  while (i < body.length) {
    if (body[i] === '{') {
      let depth = 1
      let j = i + 1
      while (j < body.length && depth > 0) {
        if (body[j] === '{') depth++
        else if (body[j] === '}') depth--
        if (depth > 0) j++
      }
      const entry = body.slice(i, j + 1)
      i = j + 1
      const patternMatch = entry.match(/pattern:\s*(\/(?:\\\/|[^\/\n\\])+\/[gimsuy]*)/)
      const profileKeyMatch = entry.match(/profileKey:\s*'([^']+)'/)
      if (patternMatch && profileKeyMatch) {
        const patternStr = patternMatch[1]
        const m = patternStr.match(/^\/(.*)\/([gimsuy]*)$/)
        if (m) {
          let pattern
          try { pattern = new RegExp(m[1], m[2]) } catch (_) { continue }
          const kindMatch = entry.match(/kind:\s*'([^']+)'/)
          const typeMatch = entry.match(/type:\s*'([^']+)'/)
          entries.push({
            pattern,
            profileKey: profileKeyMatch[1],
            kind: kindMatch ? kindMatch[1] : 'text',
            type: typeMatch ? typeMatch[1] : undefined,
          })
        }
      }
    } else {
      i++
    }
  }
  return entries
}

// ---------------------------------------------------------------------------
// 2. Regex-only HTML form-element extractor (no JSDOM dep).
// ---------------------------------------------------------------------------
function extractFormElements(html) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
  const elems = []
  const tagRx = /<(input|textarea|select)\b([^>]*?)\/?>(?:[^<]*?<\/\1>)?/gi
  let m
  while ((m = tagRx.exec(cleaned)) !== null) {
    const tag = m[1].toLowerCase()
    if (tag === 'input') {
      const a = parseAttrs(m[2])
      elems.push({ tag, attrs: a, offset: m.index })
    } else {
      // textarea/select — capture attrs on open tag + possibly inner label value
      const a = parseAttrs(m[2])
      elems.push({ tag, attrs: a, offset: m.index })
    }
  }
  return elems
}

function parseAttrs(s) {
  const out = {}
  const rx = /([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g
  let m
  while ((m = rx.exec(s)) !== null) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

// ---------------------------------------------------------------------------
// 3. Reconstruct per-element "meta string" — mirrors getFieldMeta's parts[].
//    Static analysis has no DOM, so we approximate via the HTML text just
//    BEFORE the element's offset (capping at 600 chars to keep it cheap).
// ---------------------------------------------------------------------------
function buildMeta(html, el) {
  const parts = []
  const aria = el.attrs['aria-label']
  if (aria) parts.push(aria)
  const name = el.attrs.name
  if (name) parts.push(name)
  const id = el.attrs.id
  if (id) parts.push(id)
  const placeholder = el.attrs.placeholder
  if (placeholder) parts.push(placeholder)
  for (const k of ['data-automation-id', 'data-qa', 'data-testid', 'data-field-key', 'data-test']) {
    const v = el.attrs[k]
    if (v) parts.push(v)
  }
  const before = html.slice(Math.max(0, el.offset - 600), el.offset)
  // <label for="id">...</label> just before this offset.
  if (id) {
    const rx = new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*["']${id}["'][^>]*>([^<]+?)<\\/label>`, 'i')
    const m = before.match(rx)
    if (m) parts.push(m[1].trim())
  }
  // Wrapping <label>...</label> just before offset.
  const wrapRx = /<label\b[^>]*>([^<]+?)<\/label>\s*$/i
  const wrapMatch = before.match(wrapRx)
  if (wrapMatch && !parts.includes(wrapMatch[1].trim())) {
    parts.push(wrapMatch[1].trim())
  }
  // <fieldset>...<legend>...</legend> before offset — take the LAST
  // (most-nearest) one.
  const fsRx = /<fieldset\b[^>]*>[\s\S]*?<legend\b[^>]*>([^<]+?)<\/legend>/gi
  let lastFsLegend = null
  let fm
  while ((fm = fsRx.exec(before)) !== null) {
    lastFsLegend = fm[1].trim()
  }
  if (lastFsLegend && !parts.includes(lastFsLegend)) parts.push(lastFsLegend)
  // Wrapping <legend> without <fieldset> (Round-72.2 / Followup-3 path):
  // <legend>Fråga</legend><input/> — capture via raw text pattern just before
  // offset, only when there's no preceding <fieldset> open tag.
  const wrapLegendRx = /<legend\b[^>]*>([^<]+?)<\/legend>\s*$/i
  const wrapLegendMatch = before.match(wrapLegendRx)
  if (wrapLegendMatch && !before.includes('<fieldset') && wrapLegendMatch[1].trim() !== lastFsLegend) {
    parts.push(wrapLegendMatch[1].trim())
  }
  return parts.filter(Boolean).join(' \u00b7 ')
}

// ---------------------------------------------------------------------------
// 4. Run ALL FIELD_PATTERNS against each element, return first-match-wins list.
//    (Mirrors matchField() in extension/content.js — file entries are skipped
//    here because findFileInputs is a separate input-type='file' scan, and
//    types != 'file' inputs would over-match the looser file alternations.)
// ---------------------------------------------------------------------------
function matchEntries(el, meta, entries) {
  const matches = []
  for (const entry of entries) {
    // Skip file-pattern entries for non-file inputs (mirror matchField()
    // in extension/content.js which checks `entry.type === 'file'`).
    // The cvFile / coverLetterFile / additionalDocuments rules in
    // FIELD_PATTERNS declare `type: 'file'` (NOT `kind: 'file'`) — a
    // `<textarea>` labelled "Personligt brev" would otherwise match
    // `coverLetterFile`'s pattern and produce a false positive.
    if (entry.type === 'file' && el.attrs.type !== 'file') continue
    if (entry.pattern.test(meta)) matches.push(entry)
  }
  return matches
}

// ---------------------------------------------------------------------------
// 5. Regression checks — one per Round-72.2 BUG.
// ---------------------------------------------------------------------------
function checkBug1(elemsWithMeta) {
  // BUG 1 regression: two inputs within a 400-char window BOTH match
  // firstName. The pre-fix getFieldMeta() read sibling labels via
  // `parent.querySelector('label, legend')` and both Förnamn+
  // Efternamn ended up routed to firstName. Post-fix the labels are
  // sourced per-input (input.labels or wrapping label) so each route
  // is unique.
  const failures = []
  for (let i = 0; i < elemsWithMeta.length; i++) {
    for (let j = i + 1; j < elemsWithMeta.length; j++) {
      const a = elemsWithMeta[i]
      const b = elemsWithMeta[j]
      if (b.offset - a.offset > 400) break
      const aKeys = a.matches.map((x) => x.profileKey)
      const bKeys = b.matches.map((x) => x.profileKey)
      if (aKeys.includes('firstName') && bKeys.includes('firstName')) {
        failures.push({
          i, j,
          aMeta: a.meta.slice(0, 80),
          bMeta: b.meta.slice(0, 80),
        })
      }
    }
  }
  return failures
}

function checkBug3(elemsWithMeta) {
  // BUG 3 regression: an input should not match MULTIPLE of
  // {street, address, zip, city, country} — those are disjoint
  // profileKeys. A real form has 4 separate inputs (gata, postnummer,
  // ort, land) each matching EXACTLY ONE. If an input matches 2+
  // → over-fill regression (the user gets "Hjällbogårdet 30" in
  // BOTH street and zip, etc.).
  const ADDR_KEYS = new Set(['street', 'address', 'zip', 'city', 'country'])
  const failures = []
  for (const e of elemsWithMeta) {
    const matched = e.matches.map((m) => m.profileKey).filter((k) => ADDR_KEYS.has(k))
    if (matched.length > 1) {
      failures.push({
        meta: e.meta.slice(0, 80),
        overmatched: matched,
      })
    }
  }
  return failures
}

function checkBug4(elemsWithMeta) {
  // BUG 4 regression: when two radios share the same `name=` attribute
  // (the Ja/Nej pair of a boolean question), `handledBooleanGroups()`
  // short-circuits the second click ONLY if their matches route to
  // `kind: 'boolean'` (boolean / booleanThreshold). A radio pair
  // whose members route to `kind: 'select'` (e.g. the `gender` group
  // routing via \bkön\b|\bgender\b pattern with `kind: 'select'`) is
  // OUT OF SCOPE — handledBooleanGroups only applies to boolean fills,
  // not select/option fills. The real BUG 4 regression to detect is:
  // a radio pair that routes to plain text (no kind, no boolean, no
  // select — incoherent filling of a <input type=radio> with
  // setInputValue).
  const failures = []
  const radiosByName = {}
  for (const e of elemsWithMeta) {
    if (e.el.attrs.type === 'radio' && e.el.attrs.name) {
      const k = `name:${e.el.attrs.name}`
      if (!radiosByName[k]) radiosByName[k] = []
      radiosByName[k].push(e)
    }
  }
  for (const [k, list] of Object.entries(radiosByName)) {
    if (list.length < 2) continue
    for (const r of list) {
      // First-match-wins — mirrors extension/content.js#matchField(),
      // which returns on the FIRST matching FIELD_PATTERNS entry. Inspecting
      // the full matches[] set would let a `boolean` match in the second
      // slot mask a real `text` routing for a radio input.
      const firstKind = r.matches[0]?.kind || 'text'
      const isBoolean = firstKind === 'boolean' || firstKind === 'booleanThreshold'
      const isSelect = firstKind === 'select'
      if (r.matches.length > 0 && !isBoolean && !isSelect) {
        failures.push({
          key: k,
          reason: `radio pair member routes to "${firstKind}" instead of clickBooleanOption — handledBooleanGroups dedup gate does not fire, so BOTH radios of a pair get dispatched independently`,
          meta: r.meta.slice(0, 80),
          firstMatch: `${r.matches[0].profileKey}${firstKind !== 'text' ? '/' + firstKind : ''}`,
        })
      }
    }
  }
  return failures
}

// ---------------------------------------------------------------------------
// 6. Main — run per-fixture, accumulate failures, exit 0/1.
// ---------------------------------------------------------------------------
function main() {
  const contentSrc = fs.readFileSync(CONTENT_JS, 'utf8')
  const patterns = extractFieldPatterns(contentSrc)
  console.log(`[smoke] extracted ${patterns.length} FIELD_PATTERNS entries from extension/content.js`)

  let totalFailures = 0
  let fixturesProcessed = 0
  for (const fix of FIXTURES) {
    if (!fs.existsSync(fix)) {
      console.log(`[smoke] SKIP ${path.basename(fix)} (file not found)`)
      continue
    }
    fixturesProcessed++
    const html = fs.readFileSync(fix, 'utf8')
    const elems = extractFormElements(html)
    console.log(`\n[smoke] === ${path.basename(fix)} (${html.length} bytes, ${elems.length} form elements) ===`)
    const enriched = []
    for (const el of elems) {
      const meta = buildMeta(html, el)
      const matches = matchEntries(el, meta, patterns)
      enriched.push({ el, meta, matches, offset: el.offset })
    }
    const b1 = checkBug1(enriched)
    const b3 = checkBug3(enriched)
    const b4 = checkBug4(enriched)
    const tag = (ok) => (ok ? 'PASS' : 'FAIL')
    console.log(`[smoke]   BUG 1 (name dedup):              ${tag(b1.length === 0)}`)
    if (b1.length) {
      for (const f of b1) {
        console.log(`            pair (${f.i},${f.j}) BOTH match firstName:`)
        console.log(`              [${f.i}] "${f.aMeta}"`)
        console.log(`              [${f.j}] "${f.bMeta}"`)
      }
      totalFailures += b1.length
    }
    console.log(`[smoke]   BUG 3 (address disjoint):        ${tag(b3.length === 0)}`)
    if (b3.length) {
      for (const f of b3) {
        console.log(`            overmatched: meta="${f.meta}" keys=${f.overmatched.join(', ')}`)
      }
      totalFailures += b3.length
    }
    console.log(`[smoke]   BUG 4 (boolean pairs boolean):  ${tag(b4.length === 0)}`)
    if (b4.length) {
      for (const f of b4) {
        console.log(`            ${f.key}: meta="${f.meta}" matches=${f.matches.join(', ')}`)
      }
      totalFailures += b4.length
    }
    let matched = 0
    for (const e of enriched) {
      if (e.matches.length > 0) matched++
    }
    console.log(`[smoke]   coverage:                       ${matched} of ${enriched.length} elements matched >= 1 FIELD_PATTERNS`)
  }

  if (fixturesProcessed === 0) {
    console.log('\n[smoke] FAIL: no fixtures found at the expected paths')
    process.exit(1)
  }
  if (totalFailures > 0) {
    console.log(`\n[smoke] FAIL: ${totalFailures} regression(s) detected across ${fixturesProcessed} fixture(s)`)
    process.exit(1)
  } else {
    console.log(`\n[smoke] PASS: no regressions across ${fixturesProcessed} fixture(s)`)
    process.exit(0)
  }
}

main()
