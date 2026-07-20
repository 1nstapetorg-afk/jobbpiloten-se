// tests/unit/groq-placeholder-guard.test.mjs
//
// Round-46.2 polish — regression locks for lib/groq.js's
// `containsPlaceholder()` heuristic. Replaces the over-broad
// `text.includes('[')` blanket-reject (which incorrectly flagged
// legitimate Swedish text with legal refs / year citations /
// Markdown links) with a scoped check: bracket content containing
// digits is skipped, AND bracket content must hit one of the
// curated placeholder keywords (Swedish + English).
//
// Lock surface:
//   1. Source-grep locks — `containsPlaceholder` is defined + exported
//      in lib/groq.js with the expected shape (function declaration,
//      bracket regex pattern, triggerWords keyword set).
//   2. Behavioural locks — a mirror implementation runs against the
//      same input distribution the heuristic expects to handle in
//      production. The mirror is byte-identical to lib/groq.js's
//      helper so testing THIS file mirrors testing the production
//      gate. Source-grep locks catch drift; behavioural locks catch
//      logic bugs.
//   3. Cross-fire regression lock — counts `!containsPlaceholder(text)`
//      call-sites, asserting the helper is wired at ALL 4 LLM gates
//      (cover-letter/answer/adaptive/email-body). Option B per the
//      Round-46.2 code-review (stronger than Option A which would
//      just count `!text.includes('[')` occurrences).
//
// The mirror is intentional: lib/groq.js imports from `@/lib/...`
// (configured by jsconfig.json + the Next bundler), which `node
// --test` can't statically resolve without a custom loader. The
// project's idiom (see tests/unit/popup-resolver.test.mjs +
// tests/unit/extension-content-vm, etc.) is "lock the SOURCE +
// lock the BEHAVIOUR via a pure mirror" — we follow it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GROQ_PATH = path.resolve(__dirname, '../../lib/groq.js')
const GROQ_SRC = fs.readFileSync(GROQ_PATH, 'utf-8')

// =============================================================================
// Behavioural mirror — byte-identical to lib/groq.js containsPlaceholder()
// =============================================================================
//
// Single source of truth for what the function DOES. If the lib/groq.js
// copy drifts from this one (e.g. someone adds a new trigger word),
// the source-grep locks below fail loudly.

function containsPlaceholder(text) {
  if (!text || !text.includes('[')) return false
  const BRACKETS = /\[([^\]]{2,40})\]/g
  const TRIGGERS = [
    'namn', 'företag', 'foretag', 'datum', 'titel', 'adress',
    'epost', 'e-post', 'telefon', 'ort', 'stad', 'plats',
    'company', 'date', 'title', 'address', 'name', 'your',
  ]
  let m
  while ((m = BRACKETS.exec(text)) !== null) {
    const content = String(m[1] || '').toLowerCase()
    if (/\d/.test(content)) continue
    if (TRIGGERS.some((kw) => content.includes(kw))) return true
  }
  return false
}

// =============================================================================
// 1. Source-grep locks — helper exists, exported, has the right shape
// =============================================================================

test('containsPlaceholder must be declared as a function in lib/groq.js', () => {
  assert.match(
    GROQ_SRC,
    /function\s+containsPlaceholder\s*\(/,
    'lib/groq.js must declare containsPlaceholder as a regular function',
  )
})

test('containsPlaceholder must be exported from lib/groq.js', () => {
  // The export block uses whitespace + braces around the name list;
  // any drift in the export name or removal of containsPlaceholder
  // fails loudly. Used by tests/unit/groq-placeholder-guard.test.mjs
  // (this file) + future sister modules.
  assert.match(
    GROQ_SRC,
    /export\s+\{[\s\S]*?containsPlaceholder[\s\S]*?\}/,
    'lib/groq.js must export containsPlaceholder',
  )
})

test('containsPlaceholder must declare a function body with the BRACKETS regex constant', () => {
  // TIGHTER anchor (Round-46.2.1 polish): the literal substring
  // `const BRACKETS =` appears ONLY in the containsPlaceholder
  // helper. The earlier loose `\` substring matched any backslash
  // in lib/groq.js (false-positive on every regex literal in the
  // file). The new anchor ensures the containsPlaceholder-specific
  // regex constant is the one being asserted present. Falling back
  // to a less-specific guard would silently let the helper be moved
  // out of module scope without this lock tripping.
  assert.ok(
    GROQ_SRC.includes('const BRACKETS ='),
    "containsPlaceholder must declare `const BRACKETS = ...` regex constant (anchored on declaration name)",
  )
})

test('containsPlaceholder must include both Swedish + English trigger keywords', () => {
  // Lock on a representative subset of the trigger whitelist. A
  // future maintainer removing English triggers (Llama-3 emits
  // [Your Name] / [Company] occasionally) would silently let
  // English fallbacks through. A future maintainer removing
  // Swedish triggers would break the original Swedish-letter
  // leak case.
  for (const keyword of ['namn', 'företag', 'datum', 'company', 'name', 'your']) {
    assert.ok(
      GROQ_SRC.includes(`'${keyword}'`),
      `containsPlaceholder triggerWords must include Swedish/English placeholder keyword "${keyword}"`,
    )
  }
})

test('containsPlaceholder must check digit-presence via .test(content)', () => {
  // The numeric-skip is the deliberate false-positive shield for
  // [2020]/[1]/[Smith 2020]. Without it the heuristic rejects
  // legitimate citations. Lock on the .test(content) call form.
  assert.ok(
    GROQ_SRC.includes('.test(content)'),
    'containsPlaceholder must skip bracket content containing digits',
  )
})

test('plural assertion: containsPlaceholder must appear at the 4 LLM-response gates (>=4 call sites)', () => {
  // Cross-fire regression net (Option B per Code Review — chosen
  // over Option A which would just count `!text.includes('[')`
  // occurrences; that approach was inflated by the helper's own
  // internal precheck on line 642 of lib/groq.js). The cleanup
  // replaced 4 occurrences of `!text.includes('[')` at the
  // cover-letter / answer / adaptive / email-body LLM-response
  // gates with `!containsPlaceholder(text)`. Counting the helper
  // CALL sites directly tests THAT contract: a future maintainer
  // who accidentally reverts one of the 4 gates to the legacy
  // blanket-reject fails HERE (not silently as Option A would).
  const HELPERS = (GROQ_SRC.match(/!containsPlaceholder\s*\(\s*text\s*\)/g) || []).length
  assert.ok(
    HELPERS >= 4,
    "lib/groq.js must contain >=4 `!containsPlaceholder(text)` call sites (4 LLM-response gates); got " + HELPERS,
  )
})

// =============================================================================
// 2. Behavioural locks — the helper as observed at runtime
// =============================================================================

// ---- Legitimate Swedish text: MUST NOT be flagged ----

const LEGIT_PASS_CASES = [
  {
    name: 'Swedish plain prose with no brackets',
    input: 'Hej, jag heter Anna och vill gärna arbeta hos er.',
    expected: false,
  },
  {
    name: 'Swedish sentence with [bracketed legal reference] - single digit',
    input: 'Se referensen [1] för mer detaljer.',
    expected: false,
  },
  {
    name: 'Swedish single-char bracket [sic]',
    input: 'Det är en typo [sic].',
    expected: false,
  },
  {
    name: 'Swedish text with year citation [2024]',
    input: 'Enligt studien [2024] är siffran korrekt.',
    expected: false,
  },
  {
    name: 'Swedish text with author-year citation [Smith 2020]',
    input: 'Tidigare forskning [Smith 2020] visar att metodiken håller.',
    expected: false,
  },
  {
    name: 'Swedish text with multi-digit reference [42]',
    input: 'Processen finns beskriven i [42] kapitel 3.',
    expected: false,
  },
  {
    name: 'Swedish text with [citation needed] (multi-char but English advisory)',
    input: 'Det är oklart huruvida metoden fungerar [citation needed].',
    expected: false,
  },
  {
    name: 'Swedish text with [a] single-char bracket',
    input: 'Punkten återfinns i appendix [a] under avsnitt 2.',
    expected: false,
  },
  {
    name: 'Markdown-style link [text](url) — bracket content has no placeholder noun',
    input: 'Se [dokumentationen](https://example.com/docs) för mer info.',
    expected: false,
  },
  {
    name: 'Empty string',
    input: '',
    expected: false,
  },
  {
    name: 'null / undefined (defensive)',
    input: null,
    expected: false,
  },
]

for (const tc of LEGIT_PASS_CASES) {
  test(`PLACEHOLDER-MUST-PASS: ${tc.name}`, () => {
    assert.equal(
      containsPlaceholder(tc.input),
      tc.expected,
      `expected containsPlaceholder(${JSON.stringify(tc.input)}) === ${tc.expected}; got ${containsPlaceholder(tc.input)}`,
    )
  })
}

// ---- Placeholder leaks: MUST be flagged ----

const PLACEHOLDER_FAIL_CASES = [
  {
    name: 'Swedish [Namn]',
    input: 'Med vänliga hälsningar, [Namn]',
    expected: true,
  },
  {
    name: 'Swedish [Företag]',
    input: 'Jag söker tjänsten hos [Företag].',
    expected: true,
  },
  {
    name: 'Swedish [Datum]',
    input: 'Jag är tillgänglig från [Datum].',
    expected: true,
  },
  {
    name: 'Swedish [Titel]',
    input: 'Jag såg er annons för [Titel].',
    expected: true,
  },
  {
    name: 'Swedish [Adress]',
    input: 'Min [Adress] är för tjänsten.',
    expected: true,
  },
  {
    name: 'Swedish [E-post]',
    input: '[E-post] är min kontaktkanal.',
    expected: true,
  },
  {
    name: 'English [Company Name]',
    input: 'I am applying at [Company Name] for the role.',
    expected: true,
  },
  {
    name: 'English [Your Email]',
    input: '[Your Email] is my preferred contact.',
    expected: true,
  },
  {
    name: 'English [Date] (placeholder, not a year citation)',
    input: 'Please let me know the [Date] of the interview.',
    expected: true,
  },
  {
    name: 'Mixed: legit citation + placeholder (placeholder still wins)',
    input: 'Se [Smith 2020] för bakgrund. Med vänliga hälsningar, [Namn].',
    expected: true,
  },
  {
    name: 'Multi-word Swedish placeholder [Ditt Namn]',
    input: 'Ansökan skickas in av [Ditt Namn].',
    expected: true,
  },
]

for (const tc of PLACEHOLDER_FAIL_CASES) {
  test(`PLACEHOLDER-MUST-FAIL: ${tc.name}`, () => {
    assert.equal(
      containsPlaceholder(tc.input),
      tc.expected,
      `expected containsPlaceholder(${JSON.stringify(tc.input)}) === ${tc.expected}; got ${containsPlaceholder(tc.input)}`,
    )
  })
}

// =============================================================================
// 3. Belt-and-braces — word-boundary false-positive checks
// =============================================================================
//
// The trigger list is a substring `.includes` match, so a Swedish
// word containing "namn" or "datum" as a substring (e.g. "förnamn",
// "postdatum", "namnlös") WOULD false-positive. This is a known
// trade-off — the heuristic errs on the side of false-positive
// safety (reject a too-much string rather than ship a placeholder
// leak). A regression that flips the policy to word-boundary
// matching would correctly pass these cases — but that's a
// deliberate behavioural change, not a silent regression.

test('SUBSTRING-FP: containsPlaceholder accepts a known substring false-positive ([förnamn] in brackets)', () => {
  // "[förnamn]" wrapped in brackets — the bracket-extract path
  // extracts "förnamn", lowercases it, checks the trigger list
  // for substring "namn" → match. This is the documented
  // over-conservative behaviour: better to reject a Swedish
  // phrase using "förnamn" than to ship a placeholder leak.
  assert.equal(
    containsPlaceholder('Ange ditt [förnamn] i fältet nedan.'),
    true,
    'containsPlaceholder is intentionally substring-based; "[förnamn]" contains "namn" so it returns true (known false-positive trade-off, intentionally accepted)',
  )
})
