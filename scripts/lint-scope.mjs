#!/usr/bin/env node
/**
 * scripts/lint-scope.mjs
 *
 * Round-51 — replaces the Round-50.3 char-walker with an AST-based
 * scope-leak detector (powered by `acorn`, already a devDependency at
 * `^8.17.0`).
 *
 * Why the rewrite
 * ────────────────
 * The Round-50.3 char-walker had a DOCUMENTED ceiling of 34 phantom
 * leaks in production lib/*.js (`tests/unit/lint-scope.test.mjs` Test
 * 3 pinned `PRODUCED_CEILING = 34`). The 34 were false positives from
 * destructuring patterns the regex walker couldn't parse:
 *   - `const { a, b } = obj`
 *   - `const [x, y] = arr`
 *   - `for (const [k, v] of entries)`
 *   - `function f({ bold })` (destructured param)
 *
 * The AST scanner recognises every one of these via node-type checks
 * (no string-level heuristics), so the production ceiling drops to 0.
 *
 * Properties that used to need explicit regex guards are now
 * structurally handled by the AST:
 *   - property access (`p.x`, `obj[key]`, `obj?.x`) — `MemberExpression`
 *   - object-literal keys (`{ key: value }`) — `Property` non-computed
 *   - ternary operands (`a ? b : c`) — `ConditionalExpression`
 *   - spread / rest (`...arr`) — `SpreadElement`/`RestElement` argument
 *   - parameter-body shadow — `Function.params` extraction
 *   - let/var bindings — `VariableDeclaration.kind` accepts any of const|let|var
 *
 * Fixture contracts preserved (proven by tests/unit/lint-scope.test.mjs):
 *   1. fixtures/lint-scope-bad.js  — SHARED must flag (1 cross-function + 1 cross-scope)
 *   2. fixtures/lint-scope-good.js — 0 flags across all 11 documented use cases
 *   3. fixtures/lint-scope-spread-bad.js — `arr` must flag (cross-function via spread)
 *   4. Production lib/ — 0 flags
 *
 * Exit codes:
 *   0 — clean.
 *   1 — one or more scope leaks reported.
 *
 * Usage:
 *   yarn lint:scope
 *   node scripts/lint-scope.mjs tests/fixtures/lint-scope-good-dir   # ad-hoc scan
 */

import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'acorn'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
// Optional CLI argument: pass a directory to lint instead of ./lib.
// Used by tests/unit/lint-scope.test.mjs to feed fixture files
// through the same scanner the developer-facing `yarn lint:scope`
// runs. Falls back to ./lib when no argument is supplied.
const LIB_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'lib')

// =============================================================================
// Section 1 — Binding extraction from destructuring patterns
// =============================================================================

/**
 * Recursively extract every Identifier AST node that is being BOUND
 * (declared or destructured) starting from a pattern node. Handles:
 *   - Identifier      (the simple case: `const x`)
 *   - ObjectPattern   with Property values + RestElement
 *                     (for `const { a, b: c, ...rest } = obj`)
 *   - ArrayPattern    (for `const [x, y] = arr`)
 *   - RestElement     (for `function f(...rest)` and `const [...rest] = arr`)
 *   - AssignmentPattern (for the default-value case `function f(x = 1)`)
 *
 * Returns the ACTUAL AST Identifier nodes so a Set membership check
 * can recognise them later in the use walk (avoids stringly-typed
 * identifiers that could collide across scopes).
 */
function extractBindings(pat, bindings = []) {
  if (!pat) return bindings
  if (pat.type === 'Identifier') {
    bindings.push(pat)
  } else if (pat.type === 'ObjectPattern') {
    for (const p of pat.properties) {
      if (p.type === 'RestElement') {
        extractBindings(p.argument, bindings)
      } else if (p.type === 'Property') {
        extractBindings(p.value, bindings)
      }
    }
  } else if (pat.type === 'ArrayPattern') {
    for (const e of pat.elements) {
      if (e) extractBindings(e, bindings)
    }
  } else if (pat.type === 'RestElement') {
    extractBindings(pat.argument, bindings)
  } else if (pat.type === 'AssignmentPattern') {
    extractBindings(pat.left, bindings)
  }
  return bindings
}

// =============================================================================
// Section 2 — Keys that are NOT AST node children (scalar / metadata)
// =============================================================================
//
// Property-access, optional-chaining, and AST-metadata fields don't
// contain node children — they're scalar or shape metadata. Skipping
// them in the default-recursion prevents the walker from treating
// them as their own AST nodes with a child traversal requirement.

const NON_NODE_KEYS = new Set([
  // Universal AST metadata (present on every node)
  'type', 'start', 'end', 'loc', 'range',
  // Scalars
  'name', 'raw', 'value', 'operator', 'kind', 'prefix',
  // Boolean / shape flags
  'computed', 'delegate', 'async', 'generator', 'static',
  'optional', 'sourceType', 'expression',
  // Parent links (we set them manually via linkParents — see below)
  'parent',
])

// =============================================================================
// Section 3 — Allowlist for short-identifier noise
// =============================================================================
//
// Loop counters + common parameter names generate so many syntactic
// uses that flagging them as scope leaks is pure noise. Thealist is
// carried verbatim from the Round-50 walker to keep existing test
// fixture outcomes identical.

const NOISE_SKIP_NAMES = new Set([
  'i', 'j', 'k', 'n', 'm', 't', 'x', 'y', 'z',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
  'v', 'p', 'q', 'r', 's', 'u', 'w',
  'ch', 'nl', 'id', 'fn', 'cb', 'kv', 'ok', 'fd', 'fd2',
  'date', 'name', 'type', 'kind', 'addr', 'opts', 'resp', 'req',
  'job', 'doc', 'ids', 'out', 'cur', 'tok', 'key', 'val',
  'src', 'dst', 'lhs', 'rhs', 'buf', 'raw', 'row', 'col',
  'msg', 'err', 'log', 'url', 'uri', 'env', 'cfg', 'cmd',
])

function isSkippable(name) {
  return NOISE_SKIP_NAMES.has(name)
}

// =============================================================================
// Section 4 — Helpers
// =============================================================================

function lineForOffset(src, offset) {
  return (src.slice(0, offset).match(/\n/g) || []).length + 1
}

function contextSnippet(src, start, end, maxHalf = 40) {
  const s = Math.max(0, start - maxHalf)
  const e = Math.min(src.length, end + maxHalf)
  return src.slice(s, e).replace(/\n/g, '\\n')
}

function addToMap(map, key, value) {
  if (!map.has(key)) map.set(key, [])
  map.get(key).push(value)
}

// =============================================================================
// Section 5 — Pass 1: AST walk to build the scope tree
// =============================================================================
//
// `visit` recursively walks the AST, populating:
//   ctx.functionDecls: [{ name, bodyOpen, bodyClose, paramListOpen, paramListClose, params }]
//   ctx.moduleDecls:  [Identifier nodes that live at module scope]
//   ctx.bodyConsts:   Map<functionName, [Identifier nodes declared inside that function]>
//
// The walker refuses to descend into binding / property-name / label
// contexts (handled explicitly in switch cases) so a `Property.key`
// is never recorded as a USE.
//
// Inside a `FunctionDeclaration / FunctionExpression / ArrowFunctionExpression`,
// the BODY is walked with `currentFunction` set to this function. This
// is how the scanner knows "const X = 1" inside the function body
// belongs to this function's bodyConsts, not moduleDecls.

function visit(node, ctx) {
  if (!node || typeof node !== 'object') return
  switch (node.type) {
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression': {
      const name = node.id ? node.id.name : '<anon>'
      const paramIdents = []
      for (const p of node.params) {
        extractBindings(p, paramIdents)
      }
      const fnEntry = {
        name,
        bodyOpen: -1,
        bodyClose: -1,
        paramListOpen: node.params[0]?.start ?? -1,
        paramListClose:
          node.params.length > 0 ? node.params[node.params.length - 1].end : -1,
        params: paramIdents,
      }
      ctx.functionDecls.push(fnEntry)
      // Default value expressions for params (AssignmentPattern.right)
      // are evaluated in the OUTER scope, not the inner function's.
      const outerCtx = ctx
      for (const p of node.params) {
        if (p.type === 'AssignmentPattern' && p.right) {
          visit(p.right, outerCtx)
        }
      }
      // Body itself is the new function's lexical scope.
      const newCtx = { ...ctx, currentFunction: fnEntry }
      if (node.body && node.body.type === 'BlockStatement') {
        fnEntry.bodyOpen = node.body.start + 1
        fnEntry.bodyClose = node.body.end - 1
        for (const child of node.body.body) {
          visit(child, newCtx)
        }
      } else if (node.body) {
        // Round-51 followup: arrow function with expression body
        // (e.g. `arr.map((x) => x.id)`) — was leaving bodyOpen at
        // -1, which made findOutermostFunction in Pass 2 fail to
        // recognise the arrow's range. Result: uses inside the arrow
        // body were treated as at-module-scope, defeating Layer 1.5
        // (param shadow) and producing false-positive cross-scope
        // flags for arrow-local identifiers with the same name as a
        // body const elsewhere. Fix: set bodyOpen/bodyClose to the
        // body's start/end so the arrow IS recognised as an
        // enveloping scope. The body's own node range is the
        // correct lexical scope — any Identifier inside the body
        // sits between body.start and body.end inclusive.
        fnEntry.bodyOpen = node.body.start
        fnEntry.bodyClose = node.body.end
        visit(node.body, newCtx)
      }
      return
    }
    case 'VariableDeclaration': {
      for (const d of node.declarations) {
        const bindings = extractBindings(d.id, [])
        for (const b of bindings) {
          if (ctx.currentFunction) {
            addToMap(ctx.bodyConsts, ctx.currentFunction.name, b)
          } else {
            ctx.moduleDecls.push(b)
          }
        }
        // Initializer expression is in the CURRENT scope (which is the
        // currentFunction for body consts, or module for module consts).
        if (d.init) visit(d.init, ctx)
      }
      return
    }
    case 'ForOfStatement':
    case 'ForInStatement': {
      // for (const X of arr) or for (const [a, b] of entries) — X
      // (and the destructured bindings) are declarations in the
      // current scope, NOT free variable uses. The right side of
      // `for (X of arr)` is a regular expression.
      if (node.left) {
        if (node.left.type === 'VariableDeclaration') {
          for (const d of node.left.declarations) {
            const bindings = extractBindings(d.id, [])
            for (const b of bindings) {
              if (ctx.currentFunction) {
                addToMap(ctx.bodyConsts, ctx.currentFunction.name, b)
              } else {
                ctx.moduleDecls.push(b)
              }
            }
          }
        } else if (node.left.type === 'Identifier') {
          // for (x of arr) — x is read, not declared
          visit(node.left, ctx)
        }
      }
      if (node.right) visit(node.right, ctx)
      if (node.body) visit(node.body, ctx)
      return
    }
    // ----- Identifier-binding / property-name / label contexts -----
    // These contexts would otherwise be visited by the default
    // recursion which would treat e.g. `obj.x` as a "use of x" or
    // `if (x > y)` as a "use of `if`". We explicitly skip them.
    case 'Property': {
      // Skip the .key when !computed (it's a property name, not a use).
      if (node.computed && node.key) visit(node.key, ctx)
      if (node.value) visit(node.value, ctx)
      return
    }
    case 'MemberExpression': {
      // The object is a real use; the property is only a use when
      // accessed via bracket notation (computed). For `obj.x`, x is a
      // property name.
      visit(node.object, ctx)
      if (node.computed) visit(node.property, ctx)
      return
    }
    case 'MethodDefinition':
    case 'PropertyDefinition': {
      if (node.computed && node.key) visit(node.key, ctx)
      if (node.value) visit(node.value, ctx)
      return
    }
    case 'ChainExpression': {
      // Optional-chain wrapper (older acorn versions): the syntactic
      // expression is in `.expression`. Newer acorn folds `?.` into
      // the inner expression's `.optional = true`, so this is a
      // defensive fallback.
      if (node.expression) visit(node.expression, ctx)
      return
    }
    case 'LabeledStatement': {
      // The label is a label NAME, not a variable read.
      if (node.body) visit(node.body, ctx)
      return
    }
    case 'BreakStatement':
    case 'ContinueStatement': {
      // label (if present) is a label name; otherwise, no-op.
      // No fall-through to visitChildren.
      return
    }
    // ----- Default: recurse into all AST-node children -----
    default: {
      visitChildren(node, ctx)
    }
  }
}

function visitChildren(node, ctx) {
  for (const key of Object.keys(node)) {
    if (NON_NODE_KEYS.has(key)) continue
    const child = node[key]
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === 'object' && c.type) visit(c, ctx)
      }
    } else if (child && typeof child === 'object' && child.type) {
      visit(child, ctx)
    }
  }
}

// =============================================================================
// Section 6 — Scope queries (Pass 2 helpers)
// =============================================================================

/** Innermost function whose body envelops `offset`. Returns null if
 *  the offset is at module scope (outside every function body). */
function findInnermostFunction(functionDecls, offset) {
  let innermost = null
  for (const f of functionDecls) {
    if (f.bodyOpen !== -1 && offset > f.bodyOpen && offset < f.bodyClose) {
      if (!innermost || f.bodyOpen > innermost.bodyOpen) innermost = f
    }
  }
  return innermost
}

/** Outermost function whose body envelops `offset`. Differs from
 *  findInnermostFunction in nested-function cases: if you have
 *  `outer { inner { ... } }` and the offset is inside `inner`'s body,
 *  findInnermostFunction returns `inner` while findOutermostFunction
 *  returns `outer`. We use the OUTERMOST for shadow-checking because
 *  lexical scoping binds closer-to-outer before closer-to-inner. */
function findOutermostFunction(functionDecls, offset) {
  let outermost = null
  for (const f of functionDecls) {
    if (f.bodyOpen !== -1 && offset > f.bodyOpen && offset < f.bodyClose) {
      if (!outermost || f.bodyOpen < outermost.bodyOpen) outermost = f
    }
  }
  return outermost
}

/** Is the offset inside F's lexical scope? That includes F's body
 *  AND the body of any function declared inside F. The latter is
 *  what makes nested closures correctly resolve to outer locals. */
function isInFunctionScope(offset, F, functionDecls) {
  if (!F || F.bodyOpen === -1) return false
  // Direct hit — offset is inside F's body braces.
  if (offset > F.bodyOpen && offset < F.bodyClose) return true
  // Indirect hit — offset is in a nested function's body and that
  // nested function is enclosed by F. Byte-range comparison is a
  // sufficient heuristic for ESM (no nested function ever escapes its
  // declaring function's body span).
  for (const g of functionDecls) {
    if (g === F) continue
    if (g.bodyOpen === -1) continue
    if (offset > g.bodyOpen && offset < g.bodyClose) {
      if (g.bodyOpen > F.bodyOpen && g.bodyClose < F.bodyClose) return true
    }
  }
  return false
}

// =============================================================================
// Section 7 — Pass 2: scan uses of each tracked declaration
// =============================================================================
//
// For every tracked decl_info (one per function-body const + one per
// module-scope const), we walk the AST and for every Identifier node
// with the same name as the decl:
//   - Skip if it's the decl site itself (bindingNodes has it)
//   - Skip if it's noise (NOISE_SKIP_NAMES)
//   - For module-scope decls: never flag (module scope is global;
//     use either resolves to the module const or is shadowed by a
//     closer binding — neither case is a leak)
//   - For body-scope decls: flag if the use is OUTSIDE the
//     declaring function's scope AND no closer binding shadows.
//     Closer bindings: param of the outermost enclosing function,
//     body-const of the outermost enclosing function, or a
//     module-scope const declared after this body decl.

function checkUse(identifierNode, declInfo, ctx, src, issues) {
  if (isSkippable(identifierNode.name)) return
  if (ctx.bindingNodes.has(identifierNode)) return  // binding site, not a free use

  const useOffset = identifierNode.start
  const name = identifierNode.name

  // --- Module-scope decls: resolution always succeeds ---
  //
  // A module-scope const is in scope from anywhere in the file. A
  // use either resolves to the module const or is shadowed by a
  // closer function-local binding. Neither outcome is a leak — there
  // is no scenario where the developer's intent is for the use to
  // resolve to a different const but actually resolves to nothing
  // (which would be the "leak" case for body-scope decls).
  if (declInfo.declFunction === '<module>') {
    const outermost = findOutermostFunction(ctx.functionDecls, useOffset)
    if (outermost) {
      if (outermost.params.some((p) => p.name === name)) return
      const bodyDecls = ctx.bodyConsts.get(outermost.name) || []
      if (bodyDecls.some((d) => d.name === name && d.start < useOffset)) return
    }
    return  // module const is the resolution or is shadowed — no leak
  }

  // --- Body-scope decls ---
  const declaringFn = ctx.functionDecls.find((f) => f.name === declInfo.declFunction)
  // Own-body or nested-body use → resolves correctly via lexical
  // scope. `isInFunctionScope` includes nested closures.
  if (declaringFn && isInFunctionScope(useOffset, declaringFn, ctx.functionDecls)) {
    return
  }

  // Use is outside the declaring function's scope. Check whether a
  // closer binding shadows it.
  const outermost = findOutermostFunction(ctx.functionDecls, useOffset)

  // Layer 1.5 (replaces the Round-50.2 LIST_SHADOW + PARAM_BODY_SHADOW):
  // Is there a param binding on the outermost function containing the
  // use? If yes, the use is bound to that param, not to our decl.
  if (outermost && outermost.params.some((p) => p.name === name)) return

  // Layer 2 (body-const shadow): a body-const inside the outermost
  // function with the same name and declared BEFORE the use.
  if (outermost) {
    const bodyDecls = ctx.bodyConsts.get(outermost.name) || []
    if (bodyDecls.some((d) => d.name === name && d.start < useOffset)) return
  }

  // Layer 3 (module-scope shadow): a module-scope const with the same
  // name was declared AFTER our body decl and BEFORE the use.
  if (ctx.moduleDecls.some(
    (d) => d.name === name && d.start > declInfo.declStart && d.start < useOffset,
  )) {
    return
  }

  // No closer binding → real leak. Flag.
  const kind = outermost ? 'cross-function' : 'cross-scope'
  issues.push({
    constName: name,
    declFunction: declInfo.declFunction,
    declLine: declInfo.declLine,
    refLine: identifierNode.loc.start.line,
    kind,
    ctxUse: contextSnippet(src, identifierNode.start, identifierNode.end),
    ctxDecl: contextSnippet(
      src,
      declInfo.declStart,
      declInfo.declStart + Math.max(60, name.length + 12),
    ),
  })
}

/** Walk every Identifier node in the AST and check it against the
 *  given `declInfo`. Identifier is a leaf so we don't recurse into
 *  its children.
 *
 *  Two CRITICAL filters prevent false positives:
 *
 *  ── NAME GATE — without the `declInfo.name === node.name` early
 *     return, the walker would call `checkUse` for every Identifier
 *     in the AST regardless of name, creating massive false
 *     positives (e.g. scanning for `p` in caller would falsely flag
 *     every OTHER identifier as a "leak of p"). Round-50's
 *     char-walker didn't have this concern because it filtered by
 *     char position; the AST walker adds a name-match filter to
 *     match the AST's structural semantics.
 *
 *  ── STRUCTURAL SKIPS — the recursion MUST apply the same
 *     property-name / member-expression / label skips that
 *     `visit()` (Pass 1) applies when building bindingNodes.
 *     Without them, the walker treats `Property.key` in a
 *     shorthand (`const { userId } = ...`), `MemberExpression.property`
 *     (`p.jobTitles`), and labels as free-floating Identifier
 *     uses. Round-50.1 didn't need this because its byte-walk
 *     pattern matching naturally ignored property keys, but the
 *     AST walker MUST mirror the structure-aware behaviour of
 *     Pass 1 — otherwise shadow checks (Layer 2) fail because
 *     `bindingNodes` was correctly built WITHOUT those keys, but
 *     Pass 2 is now VISITING them as if they were free uses.
 *     This single filter was the source of 109 false positives
 *     in the initial Round-51 rollout. */
function walkIdentifiers(node, declInfo, ctx, src, issues) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'Identifier') {
    if (declInfo.name !== undefined && node.name !== declInfo.name) {
      // Identifier's name doesn't match the decl we're scanning for —
      // skip every shadow check. This is the most important filter
      // in the scanner: ~99% of identifier walks are dropped here.
      return
    }
    checkUse(node, declInfo, ctx, src, issues)
    return
  }

  // ----- Identifier-binding / property-name / label contexts -----
  // The structural skips here MUST match `visit()` (Pass 1) bit
  // for bit. Drift here causes Pass 2 to read property keys /
  // member expressions / label identifiers as use sites, defeating
  // the shadow detection on Layer 2.
  switch (node.type) {
    case 'Property': {
      // Skip the .key when !computed (it's a property NAME, not a
      // use). For `{ userId }` shorthand this is also a binding
      // site — the binding is recorded by Pass 1 via extractBindings
      // (which reads the value Identifier), so the key's Identifier
      // node is not in bindingNodes; visits here would falsely mark
      // it as a use.
      if (node.computed && node.key) walkIdentifiers(node.key, declInfo, ctx, src, issues)
      if (node.value) walkIdentifiers(node.value, declInfo, ctx, src, issues)
      return
    }
    case 'MemberExpression': {
      // The object IS a use (a real variable read); the property is
      // only a use when computed. For `obj.x`, x is a property name.
      walkIdentifiers(node.object, declInfo, ctx, src, issues)
      if (node.computed) walkIdentifiers(node.property, declInfo, ctx, src, issues)
      return
    }
    case 'MethodDefinition':
    case 'PropertyDefinition': {
      if (node.computed && node.key) walkIdentifiers(node.key, declInfo, ctx, src, issues)
      if (node.value) walkIdentifiers(node.value, declInfo, ctx, src, issues)
      return
    }
    case 'ChainExpression': {
      // Optional-chain wrapper (older acorn versions): the syntactic
      // expression is in `.expression`. Newer acorn folds `?.` into
      // the inner expression's `.optional = true`, so this is a
      // defensive fallback mirroring Pass 1.
      if (node.expression) walkIdentifiers(node.expression, declInfo, ctx, src, issues)
      return
    }
    case 'LabeledStatement': {
      // Label is a label name, not a variable read.
      if (node.body) walkIdentifiers(node.body, declInfo, ctx, src, issues)
      return
    }
    case 'BreakStatement':
    case 'ContinueStatement': {
      // Label (if present) is a label name; otherwise, no-op.
      return
    }
    // ----- Default: recurse into AST-node children -----
    default: {
      for (const key of Object.keys(node)) {
        if (NON_NODE_KEYS.has(key)) continue
        const child = node[key]
        if (Array.isArray(child)) {
          for (const c of child) {
            if (c && typeof c === 'object' && c.type) walkIdentifiers(c, declInfo, ctx, src, issues)
          }
        } else if (child && typeof child === 'object' && child.type) {
          walkIdentifiers(child, declInfo, ctx, src, issues)
        }
      }
    }
  }
}

// =============================================================================
// Section 8 — File-level lint
// =============================================================================

function lintFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf-8')
  let ast
  try {
    ast = parse(src, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      ranges: true,
    })
  } catch (e) {
    console.error(`${filePath}: parse error: ${e.message}`)
    return []
  }

  // Pass 1
  const ctx = {
    functionDecls: [],
    moduleDecls: [],
    bodyConsts: new Map(),
    currentFunction: null,
    bindingNodes: new Set(),
  }
  visit(ast, ctx)
  // Index every binding Identifier so USE-walk can skip the binding sites.
  for (const d of ctx.moduleDecls) ctx.bindingNodes.add(d)
  for (const arr of ctx.bodyConsts.values()) {
    for (const d of arr) ctx.bindingNodes.add(d)
  }
  for (const f of ctx.functionDecls) {
    for (const p of f.params) ctx.bindingNodes.add(p)
  }

  // Pass 2 — for each tracked declaration, walk the AST and check
  // every use whose name matches. The name gate inside walkIdentifiers
  // ensures only same-name uses trigger checkUse — otherwise we'd
  // flood the scan with false positives.
  const issues = []
  for (const d of ctx.moduleDecls) {
    walkIdentifiers(
      ast,
      {
        name: d.name,
        declFunction: '<module>',
        declLine: lineForOffset(src, d.start),
        declStart: d.start,
      },
      ctx,
      src,
      issues,
    )
  }
  for (const fnEntry of ctx.functionDecls) {
    const decls = ctx.bodyConsts.get(fnEntry.name) || []
    for (const d of decls) {
      walkIdentifiers(
        ast,
        {
          name: d.name,
          declFunction: fnEntry.name,
          declLine: lineForOffset(src, d.start),
          declStart: d.start,
        },
        ctx,
        src,
        issues,
      )
    }
  }

  return issues
}

// =============================================================================
// Section 9 — Output + main
// =============================================================================

function reportIssues(file, issues) {
  if (issues.length === 0) return false
  console.error(`${file}: ${issues.length} potential scope leak(s)`)
  for (const issue of issues) {
    console.error(
      `  ${issue.kind}: const ${issue.constName} declared in function ${issue.declFunction} (line ${issue.declLine}) is read at line ${issue.refLine}`,
    )
    console.error(`    decl context: ${issue.ctxDecl}`)
    console.error(`    ref  context: ...${issue.ctxUse}...`)
  }
  return true
}

function main() {
  if (!fs.existsSync(LIB_DIR)) {
    console.error(`lib/ directory not found at ${LIB_DIR}`)
    process.exit(2)
  }
  const files = fs.readdirSync(LIB_DIR).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
  if (files.length === 0) {
    console.error(`No lib/*.js files found at ${LIB_DIR}`)
    process.exit(0)
  }
  console.error(`Linting ${files.length} file(s) in ${LIB_DIR} ...`)
  let totalIssues = 0
  for (const file of files) {
    const issues = lintFile(path.join(LIB_DIR, file))
    if (reportIssues(file, issues)) totalIssues += issues.length
  }
  if (totalIssues > 0) {
    console.error(`\n${totalIssues} potential scope leak(s) across lib/*.js`)
    process.exit(1)
  } else {
    console.error('OK — no scope leaks detected.')
    process.exit(0)
  }
}

main()
