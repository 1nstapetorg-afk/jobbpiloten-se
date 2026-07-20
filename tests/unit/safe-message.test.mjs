// tests/unit/safe-message.test.mjs
//
// Unit tests for extension/lib/safe-message.js — the defensive
// timeout-racing wrappers around chrome.runtime.sendMessage,
// chrome.tabs.sendMessage, and chrome.storage.local.get.
//
// Background: Round-46 / 2026-07-20 Monday testing surfaced that
// the extension popup's "Anslut din profil" button appeared to do
// nothing on click when the extension-auth page or content script
// crashed/hung. The root cause was a missing timeout race on
// chrome.sendMessage calls — the awaited Promise just sat there
// forever. The fix wraps each call in safe-{Runtime,Tabs}Send + a
// safeStorageGet helper; these tests lock the timeout/lastError/
// success contracts so future "simplification" refactors can't
// re-introduce the freeze.
//
// Run via `yarn test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TIMEOUT_MS,
  safeRuntimeSend,
  safeTabsSendMessage,
  safeStorageGet,
} from '../../extension/lib/safe-message.js'

// ─── Test helpers ─────────────────────────────────────────────────

/**
 * Install a fake chrome.* namespace on globalThis for one test.
 * Pass the impls you want; defaults are no-ops that never resolve
 * (so a test that DOESN'T override will deterministically hit the
 * timeout branch and assert the sentinel).
 */
function installChrome({ runtime, tabs, storage } = {}) {
  const prev = globalThis.chrome
  globalThis.chrome = {
    runtime: runtime || {
      sendMessage: () => {
        // Pending forever — never calls back, never rejects.
        // The timeout race will resolve first. This default forces
        // any test that forgets to override sendMessage into the
        // TIMEOUT branch so the invariant assertion below holds.
      },
      lastError: undefined,
    },
    tabs: tabs || {
      sendMessage: () => {
        // Same pending-forever default — see runtime comment.
        // The TIMEOUT branch assertion below requires this default.
      },
    },
    storage: storage || {
      local: {
        get: () => {
          // Same — pending-forever default forces the TIMEOUT
          // (well, __safeStorageTimeout: true) branch.
        },
      },
    },
  }
  return () => {
    if (prev === undefined) {
      delete globalThis.chrome
    } else {
      globalThis.chrome = prev
    }
  }
}

// ─── DEFAULT_TIMEOUT_MS constant ──────────────────────────────────

test('DEFAULT_TIMEOUT_MS is 3000 — the Bug 2 fix value', () => {
  // Hard-coded because the popup's UX promise is "no more than a
  // 3-second freeze" for any chrome.* call. A future refactor
  // that lowers this below ~500ms starts triggering timeout
  // sentinels on healthy slow-network round-trips; raising it
  // above ~5000ms makes the "Frozen click" UX bug observable
  // again on slow machines. Pin the 3000ms contract.
  assert.equal(DEFAULT_TIMEOUT_MS, 3000)
})

// ─── safeRuntimeSend ──────────────────────────────────────────────

test('safeRuntimeSend: resolves with the chrome reply on success', async () => {
  const teardown = installChrome({
    runtime: {
      sendMessage: (_msg, cb) => cb({ ok: true, payload: 'reply' }),
      lastError: undefined,
    },
  })
  try {
    const reply = await safeRuntimeSend({ type: 'PING' })
    assert.deepEqual(reply, { ok: true, payload: 'reply' })
  } finally {
    teardown()
  }
})

test('safeRuntimeSend: returns `{ ok: false, reason: "lastError" }` when chrome.runtime.lastError is set', async () => {
  // lastError is the canonical chrome signal that the recipient
  // was unreachable (background SW crashed, popup closed, etc).
  // The wrapper must NOT throw — the caller branches into a
  // friendly toast path.
  const teardown = installChrome({
    runtime: {
      sendMessage: (_msg, cb) => {
        // chrome convention: sendMessage callback receives
        // `lastError` populated, `reply` undefined.
        globalThis.chrome.runtime.lastError = {
          message: 'The recipient does not exist.',
        }
        cb(undefined)
        globalThis.chrome.runtime.lastError = undefined
      },
      lastError: undefined,
    },
  })
  try {
    const reply = await safeRuntimeSend({ type: 'PING' })
    assert.equal(reply.ok, false)
    assert.equal(reply.reason, 'lastError')
  } finally {
    teardown()
  }
})

test('safeRuntimeSend: returns `{ ok: false, reason: "timeout" }` after DEFAULT_TIMEOUT_MS when chrome never replies', async () => {
  // The Bug 2 root cause: pre-fix code awaited
  // chrome.runtime.sendMessage without a timeout race; the
  // hang below is exactly what the tester's frozen click was.
  // We keep the test fast by passing a 50ms timeout.
  const teardown = installChrome() // pending-forever default
  try {
    const reply = await safeRuntimeSend({ type: 'PING' }, 50)
    assert.equal(reply.ok, false)
    assert.equal(reply.reason, 'timeout')
  } finally {
    teardown()
  }
})

test('safeRuntimeSend: never throws (caught-throw returns lastError sentinel)', async () => {
  // chrome.runtime.sendMessage can THROW synchronously on
  // unhandled extension states (e.g. when the SW has been
  // unregistered mid-call). The wrapper must normalize the
  // throw into the same `{ ok: false, reason: 'lastError' }`
  // sentinel so the caller's branches don't need a try/catch.
  const teardown = installChrome({
    runtime: {
      sendMessage: () => {
        throw new Error('Invocation of form chrome.runtime.sendMessage requires at least one argument...')
      },
      lastError: undefined,
    },
  })
  try {
    const reply = await safeRuntimeSend({ type: 'PING' })
    assert.equal(reply.ok, false)
    assert.equal(reply.reason, 'lastError')
  } finally {
    teardown()
  }
})

// ─── safeTabsSendMessage ──────────────────────────────────────────

test('safeTabsSendMessage: resolves with the content-script reply on success', async () => {
  const teardown = installChrome({
    runtime: { lastError: undefined },
    tabs: {
      sendMessage: (tabId, _msg, cb) =>
        cb({ ok: true, fields: ['#name', '#email'] }),
    },
  })
  try {
    const reply = await safeTabsSendMessage(42, { type: 'JOBBPILOTEN_QUERY' })
    assert.deepEqual(reply, { ok: true, fields: ['#name', '#email'] })
  } finally {
    teardown()
  }
})

test('safeTabsSendMessage: returns the lastError sentinel when the tab has no content script', async () => {
  // chrome:// pages, the Chrome Web Store, and PDF viewer tabs
  // have no content script — chrome.tabs.sendMessage sets
  // lastError and calls cb(undefined). The wrapper must NOT
  // throw and must surface the same { ok, reason } shape as
  // safeRuntimeSend so callers can branch uniformly.
  const teardown = installChrome({
    runtime: { lastError: undefined },
    tabs: {
      sendMessage: (_tabId, _msg, cb) => {
        globalThis.chrome.runtime.lastError = {
          message: 'Could not establish connection. Receiving end does not exist.',
        }
        cb(undefined)
        globalThis.chrome.runtime.lastError = undefined
      },
    },
  })
  try {
    const reply = await safeTabsSendMessage(99, { type: 'JOBBPILOTEN_QUERY' }, 50)
    assert.equal(reply.ok, false)
    assert.equal(reply.reason, 'lastError')
  } finally {
    teardown()
  }
})

test('safeTabsSendMessage: returns the timeout sentinel after DEFAULT_TIMEOUT_MS', async () => {
  const teardown = installChrome() // pending-forever default
  try {
    const reply = await safeTabsSendMessage(99, { type: 'JOBBPILOTEN_QUERY' }, 50)
    assert.equal(reply.ok, false)
    assert.equal(reply.reason, 'timeout')
  } finally {
    teardown()
  }
})

// ─── safeStorageGet ───────────────────────────────────────────────

test('safeStorageGet: resolves with the storage dict on success', async () => {
  const teardown = installChrome({
    storage: {
      local: {
        get: (_keys, cb) =>
          cb({ token: 't', profile: { fullName: 'A' } }),
      },
    },
  })
  try {
    const got = await safeStorageGet(['token', 'profile'])
    assert.deepEqual(got, { token: 't', profile: { fullName: 'A' } })
  } finally {
    teardown()
  }
})

test('safeStorageGet: returns `{ __safeStorageTimeout: true }` after DEFAULT_TIMEOUT_MS', async () => {
  // Note: safeStorageGet uses a different sentinel shape than the
  // other two helpers (`__safeStorageTimeout: true` vs the
  // uniform `{ ok: false, reason: ... }`) because the original
  // caller (loadStorage in popup.js) used truthy-flag checks
  // before the helpers were unified. Locking the divergent shape
  // here so a future refactor that wants to unify them gets a
  // failing test as the prompt.
  const teardown = installChrome() // pending-forever default
  try {
    const got = await safeStorageGet('token', 50)
    assert.equal(got.__safeStorageTimeout, true)
  } finally {
    teardown()
  }
})

test('safeStorageGet: returns `{ __safeStorageGetThrow: true }` when chrome.storage.local.get throws synchronously', async () => {
  const teardown = installChrome({
    storage: {
      local: {
        get: () => {
          throw new Error('storage sync API unavailable')
        },
      },
    },
  })
  try {
    const got = await safeStorageGet('token')
    assert.equal(got.__safeStorageGetThrow, true)
  } finally {
    teardown()
  }
})

test('safeStorageGet: returns `{}` when chrome.storage.local.get resolves with nothing (defensive empty-coalesce)', async () => {
  // The wrapper does `data || {}` so a null/undefined cb arg
  // (rare, but happens on contended storage reads in some Chrome
  // builds) doesn't propagate as `undefined` to callers that do
  // `got.token` destructures — would crash.
  const teardown = installChrome({
    storage: {
      local: {
        get: (_keys, cb) => cb(null),
      },
    },
  })
  try {
    const got = await safeStorageGet('token')
    assert.deepEqual(got, {})
  } finally {
    teardown()
  }
})
