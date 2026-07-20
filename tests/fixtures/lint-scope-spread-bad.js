// tests/fixtures/lint-scope-spread-bad.js
//
// Round-50.3 followup — bad fixture for the spread-disambiguation
// guard. The linter MUST flag this file. The old single-dot guard
// would silently miss the leak (it would skip `...arr` as property
// access, so `arr` would never be recorded as a use). The new
// triple-dot guard correctly records `arr` as a use and the linter
// flags the cross-function scope leak.
//
// Bug pattern:
//   function producer() {
//     const arr = [1, 2, 3]
//     return arr
//   }
//   function consumer() {
//     return Math.max(...arr)   // ← arr is from producer's body
//   }
//
// The use of `arr` in `...arr` (consumer's body) is outside
// producer's body, so `inOwnBody` = FALSE. isShadowed checks:
//   - Layer 1 (param list): no function has `arr` in its param list
//     at this offset → no shadow
//   - Body candidates: consumer. consumer has no `arr` param, no
//     `const arr` in its body → no shadow
//   - Module scope: no `const arr` at module scope → no shadow
// Result: NOT shadowed → FLAGGED as cross-function scope leak.
//
// This is the proof point for the triple-dot guard. Without it, the
// OLD single-dot guard would set `propAccess = true` for `...arr`
// (the first non-ws char is `.`), skip `arr` as property access, and
// the linter would produce ZERO flags — silently missing a real
// Round-49-class scope leak.

function spreadProducer() {
  const arr = [1, 2, 3]
  return arr
}

function spreadConsumer() {
  return Math.max(...arr)
}
