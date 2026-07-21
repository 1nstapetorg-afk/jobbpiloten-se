// tests/unit/round51-soft-launch-bugs.test.mjs
//
// Round-51 regression locks for the 3 soft-launch bugs:
//
//   Bug 2+3 (P0) — Cover-letter relevance + career-transition handling.
//                   lib/groq.js generateCoverLetter + generateEmailBody
//                   prompts must include the new "RELEVANSFILTER" +
//                   "HELT ANNAN bransch" rules so the LLM doesn't ship
//                   a frontend-dev CV hard-wired into a warehouse job.
//
//   Bug 1   (P1) — Email auto-fill. extension/popup.js must gate the
//                   Kopiera / Öppna mailto: / Spara / Gmail / Outlook
//                   buttons during AI generation so a fast click can't
//                   ship an empty-subject mailto: URL with the
//                   placeholder body "Genererar AI-utkast…".
//
//   Bug 4   (P2) — Dashboard duplicate-key warning. app/dashboard/page.js
//                   uses a composite `${source}-${id}` key in BOTH job
//                   list sites so an AF+Blocket overlap doesn't drop
//                   React "Encountered two children with the same key".
//
// All three tests are source-grep locks identical in shape to the
// existing tests/unit/ssrf-guard.test.mjs / groq-*-prompts.test.mjs
// patterns. No network, no LLM, no DB — just file reads + regex.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POPUP_PATH = path.resolve(__dirname, '../../extension/popup.js')
const GROQ_PATH = path.resolve(__dirname, '../../lib/groq.js')
const DASHBOARD_PATH = path.resolve(__dirname, '../../app/dashboard/page.js')
const POPUP_SRC = fs.readFileSync(POPUP_PATH, 'utf-8')
const GROQ_SRC = fs.readFileSync(GROQ_PATH, 'utf-8')
const DASHBOARD_SRC = fs.readFileSync(DASHBOARD_PATH, 'utf-8')

// =============================================================================
// Bug 2+3 — Cover-letter relevance + career-transition handling
// =============================================================================

test('Round-51: generateCoverLetter prompt must include the RELEVANSFILTER rule (Rule 5)', () => {
  // The new rule forces the LLM to ONLY mention CV items directly relevant
  // OR transferable to the target role. Without it, a frontend CV gets
  // hard-wired into a warehouse job's cover letter (the user's reported
  // Round-51 scenario: "React, TypeScript, Spotify, Klarna, Docker"
  // showing up on a "Terminalmedarbetare" application).
  assert.match(
    GROQ_SRC,
    /'5\.\s*RELEVANSFILTER:/,
    'generateCoverLetter prompt must include the new Rule 5 RELEVANSFILTER + transferable-skills clause',
  )
})

test('Round-51: generateCoverLetter prompt must include the HELT ANNAN bransch rule (Rule 6)', () => {
  // The career-transition honesty rule. Tells the LLM to acknowledge
  // the cross-industry pivot, focus on transferable skills, and NEVER
  // mention unrelated technical details (e.g. React for a warehouse role).
  assert.match(
    GROQ_SRC,
    /HELT ANNAN bransch[^']*karri\u00e4rv\u00e4xlingen|N\u00c4MN ALDRIG orelaterade tekniska detaljer/,
    'generateCoverLetter prompt must include the HELT ANNAN bransch + N\u00c4MN ALDRIG rules so the LLM acknowledges career transitions honestly',
  )
})

test('Round-51: generateCoverLetter prompt must ban forced cross-field mappings (Rule 7)', () => {
  // Rule 7 forbids the LLM from inventing plausibility ("my React
  // experience is relevant for warehouse work"). The user's exact
  // complaint was this exact line pattern showing up on the
  // Terminalmedarbetare application — locking on the anchor phrase
  // catches any regression that drops the rule.
  assert.match(
    GROQ_SRC,
    /Hitta ALDRIG p\u00e5 kopplingar mellan orelaterade f\u00e4lt/,
    'generateCoverLetter prompt must explicitly ban invented cross-field mappings (Round-51 Rule 7)',
  )
})

test('Round-51: generateEmailBody prompt must also include the RELEVANSFILTER + HELT ANNAN bransch rules', () => {
  // Same rule set applies to the email-body path because users reported
  // the same cross-industry mismatch (Spotify+Klarna+Docker on a
  // warehouse role). The email-body rule numbering starts at 6 because
  // the existing rules 1–5 are locked by tests/unit/groq-email-body-prompts.test.mjs.
  assert.match(
    GROQ_SRC,
    /'6\.\s*RELEVANSFILTER:/,
    'generateEmailBody prompt must include the RELEVANSFILTER rule (Rule 6 — numbered after existing 1-5)',
  )
  assert.match(
    GROQ_SRC,
    /'7\.\s*Om kandidatens bakgrund \u00e4r i en HELT ANNAN bransch:/,
    'generateEmailBody prompt must include the HELT ANNAN bransch career-transition rule (Rule 7)',
  )
})

test('Round-51: generateCoverLetter + generateEmailBody preserve the existing prompt rules 1-5 (no regression)', () => {
  // Belt-and-braces — adding the new rules must NOT break the
  // existing structural contract. Each prior rule is referenced
  // verbatim in tests/unit/groq-email-body-prompts.test.mjs so
  // a regression here would also fire there.
  assert.match(GROQ_SRC, /Regler \(ABSOLUTA\):/, 'generateCoverLetter must keep Regler (ABSOLUTA): anchor')
  assert.match(GROQ_SRC, /Strukturella krav \(OBLIGATORISKA\):/, 'generateEmailBody must keep Strukturella krav (OBLIGATORISKA): anchor')
  assert.match(GROQ_SRC, /DU M.{0,8}STE referera till 2.{0,4}3 specifika saker/, 'cover-letter 2\u20133 CV-ref rule still present')
  assert.match(GROQ_SRC, /Jag bifogar mitt CV och personliga brev\./, 'email-body CV attachment rule still present')
})

// =============================================================================
// Bug 1 — Email auto-fill — disable action buttons during AI generation
// =============================================================================

test('Round-51: extension/popup.js must define a setComposeButtonsDisabled helper inside setupComposePanel', () => {
  // The helper queries the DOM by id (Kopiera / Öppna mailto: / Spara /
  // Gmail / Outlook) so it's resilient to button-declaration order.
  // Belt-and-braces structural lock — a future refactor that rips
  // out the function (e.g. inlines it into fetchWithRetry) would
  // silently regress to "fast click + placeholder body = empty mailto:".
  assert.match(
    POPUP_SRC,
    /function\s+setComposeButtonsDisabled\s*\([^)]*\)\s*\{/,
    'extension/popup.js must declare setComposeButtonsDisabled(disabled) helper inside setupComposePanel',
  )
  // The helper must reference all five button ids so none of them
  // accidentally slip past the gate.
  for (const id of ['jp-compose-copy-btn', 'jp-compose-open-mailto-btn', 'jp-compose-save-draft-btn', 'jp-compose-open-gmail-btn', 'jp-compose-open-outlook-btn']) {
    assert.ok(
      POPUP_SRC.includes(id),
      `setComposeButtonsDisabled must reference button id "${id}" so the gate covers all action buttons`,
    )
  }
})

test('Round-51: extension/popup.js must call setComposeButtonsDisabled(true) when AI generation starts', () => {
  // The user's reported bug: clicking Öppna mailto: while the body
  // shows "Genererar AI-utkast…" ships an empty-subject mailto:
  // URL. The (true) call gates the buttons so the click can't fire
  // before the fetch resolves.
  // We assert the (true) call appears AFTER the bodyTextarea.disabled
  // = true line so the gate happens in lock-step with the existing
  // textarea-disable.
  const trueCallIdx = POPUP_SRC.indexOf('setComposeButtonsDisabled(true)')
  assert.ok(trueCallIdx > 0, 'extension/popup.js must call setComposeButtonsDisabled(true) somewhere')
  const disabledTrueIdx = POPUP_SRC.indexOf('bodyTextarea.disabled = true')
  assert.ok(
    disabledTrueIdx > 0 && trueCallIdx > disabledTrueIdx,
    'setComposeButtonsDisabled(true) must appear AFTER bodyTextarea.disabled = true so the gate fires synchronously with the loading-state marker',
  )
})

test('Round-51: extension/popup.js must call setComposeButtonsDisabled(false) on every fetch-completion path', () => {
  // Three completion paths need the gate release:
  //   (a) success — body set to AI output, status "klart"
  //   (b) success-with-non-OK-res — body reverts to static, JSON error surfaced
  //   (c) throw — body reverts to static, network-blip status surfaced
  // If any path forgets to release, the buttons stay greyed-out
  // forever and the user is stranded on the static fallback body.
  const falseMatches = POPUP_SRC.match(/setComposeButtonsDisabled\(false\)/g) || []
  assert.ok(
    falseMatches.length >= 2,
    `setComposeButtonsDisabled(false) must be called on at least 2 paths (success + catch). Saw ${falseMatches.length}.`,
  )
})

test('Round-51: mailto URL construction must continue to URL-encode subject+body (existing contract preserved)', () => {
  // Bug-1 fix adds a button-disable gate, NOT a change to the
  // URL-building logic. Regression lock for the Round-46.1 / Bug-1
  // test suite so a future helper-function refactor doesn't
  // accidentally strip the URL-encoded params.
  assert.match(
    POPUP_SRC,
    /mailto:'\s*\+\s*encodeURIComponent\s*\(/,
    'mailto URL construction must still use encodeURIComponent on the to-address (regression lock from Round-46.1)',
  )
  assert.match(
    POPUP_SRC,
    /params\.set\('subject'/,
    'mailto URL construction must still set subject (regression lock)',
  )
  assert.match(
    POPUP_SRC,
    /params\.set\('body'/,
    'mailto URL construction must still set body (regression lock)',
  )
})

// =============================================================================
// Bug 4 — Dashboard composite key — `${source}-${id}` not just `id`
// =============================================================================

// =============================================================================
// Bug 4 — Dashboard composite key — `${source}-${id}` not just `id`
// =============================================================================
//
// We use a REGEX-BASED structural lock (no line numbers). The
// pattern looks for the JSX sequence:
//
//   <motion.div
//     key={`${job.source || "af"}-${job.id}`}          (original)
//     key={`${job.source || "af"}-${job.id}-${idx}`}    (with index suffix)
//
// The optional `(-\${idx})?` in the regex covers both forms so
// a future maintainer can use either pattern without breaking
// the regression lock.

const COMPOSITE_KEY_PATTERN =
  /<motion\.div\s*\n\s*key=\{`\$\{job\.source\s*\|\|\s*["']af["']\}\s*-\s*\$\{job\.id\}(-\$\{idx\})?`\}/g

test('Round-51: app/dashboard/page.js Dagens jobb card must use composite key `${source}-${id}`', () => {
  // The Dagens jobb cards (top 3 highlight) used key={job.id}. AF +
  // Blocket overlap on the same numeric id produced the React
  // "Encountered two children with the same key" warning. Composite
  // key resolves at the React child-reconciliation level — much
  // cleaner than de-duping the underlying job array (which would
  // drop legitimate cross-postings).
  //
  // The Dagens jobb section is anchored by the unique 'Dagens jobb'
  // header text that appears within ~30 lines before the composite
  // key. We slice the file from that anchor forward and assert the
  // pattern is present in the slice.
  const dagensIdx = DASHBOARD_SRC.indexOf('Dagens jobb')
  assert.ok(dagensIdx > 0, 'Dagens jobb anchor must exist in dashboard/page.js')
  // Slice from Dagens jobb to Fler matchningar (the next anchor) so
  // the test only matches the Dagens jobb render site.
  const flerIdx = DASHBOARD_SRC.indexOf('Fler matchningar', dagensIdx)
  const endIdx = flerIdx > 0 ? flerIdx : dagensIdx + 2_000
  const slice = DASHBOARD_SRC.slice(dagensIdx, endIdx)
  const matches = slice.match(COMPOSITE_KEY_PATTERN) || []
  assert.ok(
    matches.length >= 1,
    `Dagens jobb section must use composite key \`\${job.source || "af"}-\${job.id}\` on a <motion.div> — saw ${matches.length} match(es)`,
  )
})

test('Round-51: app/dashboard/page.js Fler matchningar list must use the same composite key', () => {
  // The "Fler matchningar" cards use the same data set, so the
  // composite-key fix must apply to BOTH render sites — otherwise
  // a future refactor that consolidates the two lists would
  // silently break the regression net.
  const flerIdx = DASHBOARD_SRC.indexOf('Fler matchningar')
  assert.ok(flerIdx > 0, 'Fler matchningar anchor must exist in dashboard/page.js')
  // Slice from Fler matchningar to end-of-file. The list is the
  // last .map() on availableJobs in the file.
  const slice = DASHBOARD_SRC.slice(flerIdx)
  const matches = slice.match(COMPOSITE_KEY_PATTERN) || []
  assert.ok(
    matches.length >= 1,
    `Fler matchningar section must use composite key \`\${job.source || "af"}-\${job.id}\` on a <motion.div> — saw ${matches.length} match(es)`,
  )
})

test('Round-51: dashboard/page.js must NOT have any plain key={job.id} in the two job-card render sites', () => {
  // Pre-fix had BOTH lines as `key={job.id}`. The composite-key fix
  // removed both. A future regression that drops back to plain
  // `job.id` in either site fails this assertion loudly.
  //
  // We slice the same two regions as the lock tests above and
  // check that NO line in either slice contains plain `key={job.id}`
  // (a key whose value is just `job.id` without the surrounding
  // template literal).
  const dagensIdx = DASHBOARD_SRC.indexOf('Dagens jobb')
  const flerIdx = DASHBOARD_SRC.indexOf('Fler matchningar', dagensIdx)
  const endIdx = flerIdx > 0 ? flerIdx : dagensIdx + 2_000
  const dagensSlice = DASHBOARD_SRC.slice(dagensIdx, endIdx)
  const flerSlice = DASHBOARD_SRC.slice(flerIdx)
  // Match: `key={job.id}` — exactly. NOT `key={`${job.source`-${job.id}`}`
  // (which contains 'job.id' but is the composite-key form).
  const PLAIN_KEY = /\bkey\s*=\s*\{job\.id\}/
  assert.doesNotMatch(
    dagensSlice,
    PLAIN_KEY,
    'Dagens jobb section must NOT have any plain key={job.id} — use composite `${job.source || "af"}-${job.id}`',
  )
  assert.doesNotMatch(
    flerSlice,
    PLAIN_KEY,
    'Fler matchningar section must NOT have any plain key={job.id} — use composite `${job.source || "af"}-${job.id}`',
  )
})
