// tests/fixtures/lint-scope-bad.js
//
// Round-50 test fixture — VERIFY the linter catches this file.
//
// This fixture replicates the Round-49 bug pattern from lib/groq.js:
// a `const SHARED = ...` declared inside one function, then read
// inside a sibling function. The pre-fix behaviour was a synchronous
// ReferenceError (when the sibling function is invoked), which the
// route's outer try/catch surfaces as a 500 to the user.
//
// The Round-50 scripts/lint-scope.mjs scanner must flag SHARED on
// the `return SHARED * 2` line because that read is outside the
// declaring function's body.
//
// Use case 1 — cross-function leak:
//   function outer() { const SHARED = 'top secret' }
//   function sibling() { return SHARED * 2 }   ← ReferenceError
//
// Use case 2 — no false positive on legit module-scope:
//   const MODULE_CONST = 5
//   function useModuleConst() { return MODULE_CONST + 1 }   ← OK

function outer() {
  const SHARED = 'top secret'
  return SHARED
}

// Bug case #1 — sibling function reads SHARED outside outer's body.
// Pre-fix this would throw ReferenceError on invocation.
function sibling() {
  return SHARED * 2
}

// Bug case #2 — top-level expression at module scope reads SHARED.
// Pre-fix this would also throw (any IO before sibling() is even
// called would error out).
module.exports = { sibling, out: SHARED.length }
