// tests/unit/route-precedence.test.mjs
//
// Round-39 (diagnostic followup) — Static-route-wins-over-catch-all
// contract lock for the email-source application endpoint.
//
// CONTEXT
// -------
// The project has two route files that COULD match POST
// /api/applications/email:
//
//   1. STATIC  — app/api/applications/email/route.js
//      Full implementation: requireAuth → JSON parse → field caps
//      → Mongo insertOne → return { ok, application }.
//
//   2. CATCH-ALL — app/api/[[...path]]/route.js
//      The catch-all POST handler chain used to inline a
//      `if (path === 'applications/email' && request.method === 'POST')`
//      branch that called three undefined helpers
//      (safeJsonBody, resolveUserId, stripInternal). On Round-38
//      code-review, that branch was deleted because Next.js App
//      Router gives static routes strict precedence over an
//      optional catch-all (the dead branch was unreachable in
//      practice but the undefined function references were a
//      footgun for future maintainers).
//
// The deleted branch was replaced with a comment block pointing
// readers at the canonical handler. This test pins the
// post-deletion shape so:
//
//   • the static file keeps its name + path + POST export
//   • the catch-all keeps the comment-block pointer (NOT a
//     re-introduced inline branch)
//   • a future refactor that renames, moves, or removes the
//     static file surfaces a unit-test failure BEFORE the e2e
//     suite or a production POST ever breaks
//
// Why this lives in tests/unit (not a Next.js integration test):
//   • Runs in `node --test` without a build step.
//   • Locks the structural contract — file path, exports, comment
//     shape — which is the part most likely to drift silently
//     during a refactor.
//   • Behavioural coverage of the handler lives in
//     tests/e2e/dashboard-email-source.spec.js (browser-level);
//     this unit test is the cheap early-warning barrier behind it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATIC_PATH = path.resolve(__dirname, '../../app/api/applications/email/route.js')
const CATCHALL_PATH = path.resolve(__dirname, '../../app/api/[[...path]]/route.js')

// --- 1. Static route file must exist at the canonical path ---

test('app/api/applications/email/route.js must exist at the canonical static path', () => {
  // The dashboard's e2e spec, the popup's compose panel, and the
  // extension's email-handler all POST to /api/applications/email
  // — Next.js resolves that exact path to this file via its
  // file-based router. A maintainer who renames the directory
  // (e.g. email-source/route.js) without updating the callers
  // would break the contract silently.
  assert.ok(
    fs.existsSync(STATIC_PATH),
    'static route file must exist at app/api/applications/email/route.js so the file-based router can resolve /api/applications/email',
  )
})

// --- 2. Static route must export POST + nodejs runtime ---

test('app/api/applications/email/route.js must export async function POST', () => {
  const src = fs.readFileSync(STATIC_PATH, 'utf-8')
  // The pattern matches both `export async function POST` and the
  // multi-line `export async function POST(` form (with or without
  // an argument — Next.js's signature is `POST(request: Request)`).
  assert.match(
    src,
    /export\s+async\s+function\s+POST\s*\(/,
    'static route must export async function POST so the file-based router binds the handler',
  )
})

test('app/api/applications/email/route.js must declare nodejs runtime (for Mongo/Mongoose compat)', () => {
  // `runtime = 'nodejs'` is required for the top-level
  // `await import('mongodb')` lazy singleton — the Edge runtime
  // doesn't support Node-built-in modules like `crypto` and
  // `fs`. A regression to the default runtime would 500 the
  // first POST to /api/applications/email because the Mongo
  // dynamic import would throw at module-load time.
  const src = fs.readFileSync(STATIC_PATH, 'utf-8')
  assert.match(
    src,
    /export\s+const\s+runtime\s*=\s*['"]nodejs['"]/,
    'static route must declare `export const runtime = "nodejs"` for the top-level Mongo import to work',
  )
})

// --- 3. Catch-all must NOT have a re-introduced inline branch ---

test('catch-all POST handler must NOT re-inline the applications/email branch', () => {
  // This is the regression that the Round-38 hotfix removed: an
  // `if (path === 'applications/email' && request.method === 'POST')`
  // branch in the catch-all POST handler. The branch referenced
  // three helpers (safeJsonBody, resolveUserId, stripInternal) that
  // did not exist in the catch-all module, so a hypothetical
  // routing-priority bump during a refactor would have produced
  // a runtime ReferenceError. We lock the comment-block-only
  // shape here.
  const src = fs.readFileSync(CATCHALL_PATH, 'utf-8')
  assert.doesNotMatch(
    src,
    /if\s*\(\s*path\s*===\s*['"]applications\/email['"]/,
    'catch-all must NOT inline a path === "applications/email" branch — the static route at app/api/applications/email/route.js owns that contract',
  )
})

// --- 4. Catch-all must keep the pointer comment block ---

test('catch-all POST handler must keep the canonical-handler pointer comment', () => {
  // The replacement for the removed inline branch was a comment
  // block pointing readers at app/api/applications/email/route.js.
  // A maintainer who deletes the comment without re-introducing
  // the inline branch would leave the dead-code-removal story
  // undocumented and confuse future readers ("why doesn't the
  // catch-all handle /api/applications/email? — oh, the static
  // route wins"). Pin the comment so the rationale is durable.
  const src = fs.readFileSync(CATCHALL_PATH, 'utf-8')
  assert.match(
    src,
    /app\/api\/applications\/email\/route\.js/,
    'catch-all must reference app/api/applications/email/route.js in a comment so future maintainers can find the canonical handler',
  )
  assert.match(
    src,
    /Round-38/i,
    'catch-all must reference Round-38 in the pointer comment so the rationale is discoverable via grep',
  )
})

// --- 5. End-to-end sanity: the two files are in the expected layout ---

test('app/api must have both the static applications/email dir AND the catch-all [[...path]] dir', () => {
  // Belt-and-braces: even if the static file is renamed (caught
  // by test #1), we want a maintainer to be able to grep
  // `app/api/applications` and find the contract. This test
  // confirms the directory layout is consistent with the
  // documented Next.js file-based router expectations.
  const apiDir = path.resolve(__dirname, '../../app/api')
  const hasApplications = fs.existsSync(path.join(apiDir, 'applications'))
  const hasCatchall = fs.existsSync(path.join(apiDir, '[[...path]]'))
  assert.ok(hasApplications, 'app/api/applications directory must exist (parent of the static email route)')
  assert.ok(hasCatchall, 'app/api/[[...path]] directory must exist (parent of the catch-all route)')
  // The static file MUST live inside the applications directory —
  // Next.js's file-based router uses the directory path as the
  // route URL. A file at app/api/email.js would map to
  // /api/email, not /api/applications/email.
  assert.ok(
    fs.existsSync(path.join(apiDir, 'applications/email/route.js')),
    'static route must live at app/api/applications/email/route.js so the file-based router maps it to /api/applications/email',
  )
})
