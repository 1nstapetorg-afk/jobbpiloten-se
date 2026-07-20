// tests/unit/_helpers/probe-esm.mjs
//
// Round-79.5 SHARED helper consumed by both
// tests/unit/popup-esm-parse.test.mjs AND
// tests/unit/extension-mailto-detector-source.test.mjs. The two
// tests lock the SAME orphan-`}` invariant — factored here so a
// future change to the invariant shape only needs to happen ONCE
// across both call sites (zero drift risk).
//
// The orphan-`}` invariant is the BASELINE misshape V8 always
// rejects at compile-time:
//   - async function refreshDetectedFields() { await ... }
//   - }
//   }    <-- orphan top-level `}` — V8: "Unexpected token '}'"
//
// The fixture string is built via String.fromCharCode from a
// char-code array (rather than a template-literal body) so this
// helper itself has zero coupling to template-literal syntax and
// cannot be broken by accidental backticks.
//
// The probeStringAsESM helper pipes the source to `node --check
// --input-type=module -` (stdin pipeline) which is the SAME V8
// module-graph compile pipeline Chrome MV3 uses to load the
// extension. Any structural defect accepted by Chrome's loader
// is therefore INVISIBLE to this probe, and any defect rejected
// by Chrome's loader is caught by this probe.

import * as childProcess from 'node:child_process'

/**
 * Probe a raw source string as ESM. Returns null on success or a
 * string with the EXACT V8 SyntaxError stderr on failure. Locks
 * the same `node --check --input-type=module -` pipeline that
 * Chrome MV3 uses to load the extension scripts.
 */
export function probeStringAsESM(src) {
  try {
    childProcess.execFileSync(
      process.execPath,
      ['--check', '--input-type=module', '-'],
      { input: src, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000 },
    )
    return null
  } catch (e) {
    const stderr = String(e?.stderr?.toString?.() || e?.stderr || e?.stdout?.toString?.() || '')
    if (stderr) return stderr
    return String(e?.message || e)
  }
}

/**
 * Round-79.5 minimal reproduction: an async function containing
 * `await` (the same SHAPE the popup.js bug had), followed by an
 * ORPHAN top-level closing-brace with no matching open-brace.
 * V8 rejects this with a SyntaxError because an orphan brace is
 * one of the few syntactic defects the parser ALWAYS surfaces at
 * compile-time (no contextual recovery).
 *
 * We deliberately built the source from a char-code array (rather
 * than a template-literal body) so the fixture itself has zero
 * coupling to template-literal syntax and cannot be broken by
 * accidental backticks. V8 rejects this string regardless of
 * contextual-recovery changes in future V8 releases.
 *
 * Sibling lock to tests/unit/popup-esm-parse.test.mjs — used in
 * lockstep so a regression of the probe mechanism shows up in BOTH
 * files at the same time.
 */
export const ROUND_79_5_MINIMAL_BROKEN = String.fromCharCode(
  //  async function refreshDetectedFields() {
  97, 115, 121, 110, 99, 32, 102, 117, 110, 99, 116, 105, 111, 110, 32, 114, 101, 102, 114, 101, 115, 104, 68, 101, 116, 101, 99, 116, 101, 100, 70, 105, 101, 108, 100, 115, 40, 41, 32, 123, 10,
  //    const clickProf = await chrome.storage.local.get([bbp])
  32, 32, 99, 111, 110, 115, 116, 32, 99, 108, 105, 99, 107, 80, 114, 111, 102, 32, 61, 32, 97, 119, 97, 105, 116, 32, 99, 104, 114, 111, 109, 101, 46, 115, 116, 111, 114, 97, 103, 101, 46, 108, 111, 99, 97, 108, 46, 103, 101, 116, 40, 91, 39, 106, 111, 98, 98, 112, 105, 108, 111, 116, 101, 110, 95, 112, 114, 111, 102, 105, 108, 101, 39, 93, 41, 10,
  //    setStatus({ profile: clickProf.jobbpiloten_profile })
  32, 32, 115, 101, 116, 83, 116, 97, 116, 117, 115, 40, 123, 32, 112, 114, 111, 102, 105, 108, 101, 58, 32, 99, 108, 105, 99, 107, 80, 114, 111, 102, 46, 106, 111, 98, 98, 112, 105, 108, 111, 116, 101, 110, 95, 112, 114, 111, 102, 105, 108, 101, 32, 125, 41, 10,
  //  }
  125, 10,
  //  // comment line
  47, 47, 32, 99, 111, 109, 109, 101, 110, 116, 10,
  //  }    <-- ORPHAN top-level closing brace (the structural defect)
  125, 10,
  //  export { refreshDetectedFields }
  101, 120, 112, 111, 114, 116, 32, 123, 32, 114, 101, 102, 114, 101, 115, 104, 68, 101, 116, 101, 99, 116, 101, 100, 70, 105, 101, 108, 100, 115, 32, 125, 10,
)
