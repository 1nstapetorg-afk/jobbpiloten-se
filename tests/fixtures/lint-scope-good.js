// tests/fixtures/lint-scope-good.js
//
// Round-50 test fixture — VERIFY the linter does NOT flag this file.
//
// This fixture contains legal code shapes that look like scope
// leaks but are correct. The linter must produce zero flags:
//
// Use case 1 — module-scope const used inside a function
//   const MODULE_CONST = 5
//   function useModuleConst() { return MODULE_CONST + 1 }
//   ↑ Correct — function reads a declaration that lives in the
//     outer (module) scope. Skipping this would be a false-positive.
//
// Use case 2 — function parameter named like a popular counter
//   function withIParam(i, j) { return i + j }
//   ↑ Short-identifier noise. The NOISE_SKIP_NAMES allowlist
//     keeps `i` + `j` out of the linter output.
//
// Use case 3 — string + comment mentions of a long identifier
//   const MODULE_CONST = 5
//   /** MODULE_CONST is referenced here but as a docblock */
//   const label = "MODULE_CONST for display"
//   ↑ Strings + comments are skipped by the scanner.
//
// Use case 4 — name reused for shadowing purposes (rare; should
// not throw ReferenceError)
//   function outer() {
//     const inner = 1
//     { const inner = 2 }              ← JS block-scoped inner
//     return inner
//   }
//   ↑ The two `inner` bindings are scoped to different blocks.
//     The linter does look for inner declarations, but the SECOND
//     `inner = 2` redeclaration is unrelated to the first.
//
// =============================================================================
// Round-50.3 (fix-unblock-236) — additional safe patterns
// =============================================================================
// These were phantom-leak false positives BEFORE Round-50.3. After the
// linter improvements, each must produce zero flags.
//
// Use case 5 — PROPERTY-ACCESS SKIP (Round-50.3 fix #1)
//   function caller() {
//     const p = { jobTitles: 'X', locations: ['Y'] }
//     return p.jobTitles
//   }
//   ↑ `p.jobTitles` is a property access on the object LHS — it's
//     bound to `p`, not to any const named `jobTitles` declared
//     in another function. Pre-fix the linter flagged this as a
//     cross-function leak.
//
// Use case 6 — OBJECT-LITERAL KEY SKIP (Round-50.3 fix #2)
//   const MY_RANGES = [
//     { lo: 0x0a000000, hi: 0x0affffff, label: 'RFC1918' },
//     { lo: 0x64400000, hi: 0x647fffff, label: 'CGN' },
//   ]
//   function useRange() {
//     return MY_RANGES[0].hi
//   }
//   ↑ `lo: ...` and `hi: ...` are OBJECT KEYS in an object literal.
//     They're the property NAMES being assigned, not free-variable
//     reads. The `MY_RANGES[0].hi` access is a property-chain read.
//     Both must be skipped.
//
// Use case 7 — PARAMETER BODY SHADOW (Round-50.3 fix #3)
//   function usesMonth(month) {
//     return { processed: month, count: month.length }
//   }
//   function snapshotter() {
//     const month = '2030-01'
//     return usesMonth(month)
//   }
//   ↑ `month` declared in `snapshotter` is passed AS the `month`
//     parameter to `usesMonth`. Inside `usesMonth`'s body, `month`
//     refers to the PARAMETER, not to `snapshotter`'s local const.
//     Pre-fix the linter flagged this as a cross-function leak.
//
// Use case 8 — LET SHADOW (Round-50.3 fix #4, var/let aware)
//   function setter() {
//     let arr = 1
//     arr = arr + 1
//     return arr
//   }
//   function wrapper() {
//     const arr = [1, 2, 3]
//     return setter() || arr.length
//   }
//   ↑ Inside `setter`, `let arr = 1` shadows any outer `arr`.
//     `arr = arr + 1` reads `arr` then assigns the result back.
//     VAR_DECL_RE has been widened to also catch `let` so the
//     shadow inside `setter` is recognised by the body-const
//     logic. Pre-fix the linter missed let-decls and incorrectly
//     flagged internal `arr` reads as cross-function leaks.
//
// Use case 9 — DESTRUCTURED PARAMETER BINDING (documented limitation)
//   function caller() {
//     const opts = { bold: 'Helvetica' }
//     return draw(opts)
//   }
//   function draw({ bold }) {
//     return bold
//   }
//   ↑ `bold` inside `draw` is a destructured-parameter binding.
//     The linter's extractParamNames treats destructuring-pattern
//     internals as opaque (only top-level params are extracted), so
//     `bold` may not be in `params`. This is a Round-50.3 KNOWN
//     LIMITATION; the destructured-pattern per-leaf extraction
//     attempted in Round-50.3 was reverted because it regressed
//     flag counts. Future Round-51 work should switch to an AST
//     scanner for full destructuring coverage.
//
// Use case 10 — TERNARY OPERAND PRESERVED (gated object-key skip)
//   function pick(condition, a, b) {
//     return condition ? a : b
//   }
//   ↑ The ternary `? a : b` has the identifier `b` followed by `:`.
//     The Round-50.3 gated object-key skip correctly DOES NOT
//     skip it — `b`'s `:` is the TERNARY separator, not an
//     object-literal key separator. Pre-Round-50.3.4 the linter
//     skipped `b` as if it were a key; post-fix it correctly
//     records `b` as a free use that resolves to the parameter.
//
// Use case 11 — SPREAD / REST NOT PROPERTY ACCESS (Round-50.3 followup)
//   function outer() {
//     const args = [1, 2, 3]
//     return inner(...args)
//   }
//   function inner(...rest) {
//     return rest.length
//   }
//   ↑ `...args` in `outer` is a SPREAD, not a property access. The
//     first non-ws char before `args` is the third `.` of a `...`
//     sequence — the Round-50.3 followup disambiguates by checking
//     that src[k-1] is not also `.`. Pre-followup the linter would
//     skip `args` as a property access, silently missing real
//     scope leaks. Same for `...rest` in `inner`'s parameter
//     list (param-list shadow handles it).

const MODULE_CONST = 5

function useModuleConst() {
  return MODULE_CONST + 1
}

function withNoiseParams(i, j, k) {
  return i + j + k
}

/**
 * This docblock mentions `MODULE_CONST` and `useModuleConst` as
 * documentation only — strings + comments must be skipped.
 */
const label = 'Reference to MODULE_CONST in a string literal should be ignored.'

function blockScopeShadow() {
  const inner = 10
  if (inner > 5) {
    const inner = 20
    return inner
  }
  return inner
}

// Use case 5 — FUNCTION returning a property of an object it constructed.
function caller() {
  const p = { jobTitles: 'X', locations: ['Y'] }
  return p.jobTitles
}

// Use case 6 — OBJECT-LITERAL KEYS + property chain access.
const MY_RANGES = [
  { lo: 0x0a000000, hi: 0x0affffff, label: 'RFC1918' },
  { lo: 0x64400000, hi: 0x647fffff, label: 'CGN' },
]
function useRange() {
  return MY_RANGES[0].hi
}

// Use case 7 — PARAMETER BODY SHADOW. `month` in `usesMonth` is the
// parameter, not `snapshotter`'s local const.
function usesMonth(month) {
  return { processed: month, count: month.length }
}
function snapshotter() {
  const month = '2030-01'
  return usesMonth(month)
}

// Use case 8 — LET SHADOW INSIDE A FUNCTION BODY. `let arr = 1`
// is the widened VAR_DECL_RE catch.
function setter() {
  let arr = 1
  arr = arr + 1
  return arr
}
function wrapper() {
  const arr = [1, 2, 3]
  return setter() || arr.length
}

// Use case 10 — TERNARY OPERAND PRESERVED. `b`'s `:` is the ternary
// colon, not an object key colon.
function pick(condition, a, b) {
  return condition ? a : b
}

// Use case 11 — SPREAD / REST NOT PROPERTY ACCESS (cross-function).
// The Round-50.3 followup disambiguates `...x` (triple-dot spread)
// from `obj.x` (single-dot property access) AND from `3..x` (two-dot
// decimal+property) via the triple-dot guard. The previous fixture
// version declared the const and the spread in the SAME function's
// body, so `inOwnBody` short-circuited before the property-access
// skip was reached — the triple-dot path was never exercised.
//
// This version crosses a function boundary:
//   - `spreadProducer` declares `const values`.
//   - `spreadConsumer` has `values` as a REST PARAMETER (`...values`).
//   - Inside `spreadConsumer`'s body, `...values` is a SPREAD of
//     that rest parameter.
//   - The linter checks uses of `const values` (from spreadProducer)
//     outside spreadProducer's body. The use in spreadConsumer's
//     body IS outside spreadProducer's body → `inOwnBody` = FALSE.
//   - The triple-dot guard must allow `values` to be RECORDED as a
//     use (not property-access-skipped) so isShadowed can fire.
//   - isShadowed: spreadConsumer's param list contains `values` →
//     shadowed → NOT flagged.
//
// End-to-end validation: pre-followup (single-dot guard), the
// triple-dot `...values` would be incorrectly skipped as property
// access, so `values` would never be recorded, and the shadow check
// would never fire. The test would pass vacuously (no flags because
// no uses were recorded at all). With the triple-dot guard, `values`
// IS recorded, isShadowed correctly shadows it via the rest
// parameter, and the fixture still produces zero flags — proving
// the path is exercised and the guard is correct.
function spreadConsumer(...values) {
  return Math.max(...values)
}
function spreadProducer() {
  const values = [1, 2, 3]
  return values
}
