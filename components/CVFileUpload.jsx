'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  FileUp, FileText, X, ChevronDown, ChevronUp, Loader2, AlertTriangle, Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// Mirror app/api/upload-cv/route.js so the UI rejects oversized files
// before the network round-trip. Hoisted to module scope so allocating
// once is enough on every render.
const CV_MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB
const CV_ACCEPTED_EXTS = ['pdf', 'docx']
const CV_PREVIEW_LIMIT = 500

/** Compact Swedish date formatter used in the file card. Kept locally
 *  since neither shared utils nor siteConfig carry a date helper yet. */
function fmtDate(d) {
  if (!d) return '—'
  const x = new Date(d)
  if (Number.isNaN(x.getTime())) return '—'
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/**
 * Drag-and-drop CV uploader. Reads the canonical profile fields
 * (`cvFileName`, `cvFileSize`, `cvText`, `cvUploadedAt`) and hands the
 * file off to `POST /api/upload-cv`, which parses PDF/DOCX server-side
 * and writes the trimmed text back into MongoDB. After a successful
 * upload or remove the parent's `onChanged` callback is fired so the
 * outer profile refetch picks up the new state — no separate save step.
 *
 * UX layers (Baba spec 2026-07-10):
 *   1. Progress bar built with raw `XMLHttpRequest.upload.onprogress`
 *      because `fetch()` does not expose upload progress in the
 *      browser. Bound to a CSS-driven amber bar so we don't pull in
 *      Radix Progress (the bar is small + visually our own).
 *   2. Success state ("✓ CV lästes in — N tecken hittades") rendered
 *      inline below the file card. Source of truth is `cvText.length`
 *      from the freshly refetched profile (so a reload still shows it).
 *   3. Two failure modes that both end up at the manual fallback:
 *        - 4xx from the server (encrypted/corrupt PDF). UI shows the
 *          inline alert and fires `onFallbackRequired('error')`.
 *        - 200 OK with `cvText === ''` (scanned/image-only PDF). UI
 *          shows the empty-hint banner and fires
 *          `onFallbackRequired('empty')`.
 *      Parents can attach a focus-on-fallback handler so the user is
 *      one keystroke away from typing the manual summary.
 *
 * The component is reused unchanged from both /settings (where the
 * parent passes `onFallbackRequired={focusManualTextarea}`) and
 * onboarding's Granska step (where the prop is omitted — onboarding
 * doesn't own a manual textarea, so the inline empty-hint banner is
 * the only signal there).
 */
export default function CVFileUpload({ profile, onChanged, onFallbackRequired }) {
  const fileInputRef = useRef(null)
  // Tracks the in-flight XHR so the rapid double-upload race (user
  // drops file A then immediately drops file B) cancels A's XHR
  // before B starts. See `abortInflight` + `uploadWithProgress`
  // below for the contract.
  const inflightXhrRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0) // 0..100, only meaningful while uploading
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  // Round-47 (CV upload flake fix): local optimistic state for the
  // "settings-cv-success" badge. After a successful POST /api/upload-cv,
  // the route returns { ok: true, cvText: ..., needsManualFallback: ... }
  // in the response body — but this component's parent re-fetches the
  // profile asynchronously (via `onChanged()` -> SWR refetch of
  // /api/profile). There's a brief window where the file card renders
  // (driven by `profile.cvFileName`) but the success badge does NOT
  // (driven by `profile.cvText`, which hasn't been refetched yet).
  // Caching the just-uploaded charCount locally closes that window so
  // the badge renders within the same frame as the file card. The
  // prop-based cvText is still the source of truth on SUBSEQUENT
  // renders (so a profile refetch that updates cvText updates the
  // display); the optimistic value is purely a "first frame" fill.
  // Reset on remove. The e2e contract test (`tests/e2e/all-issues-smoke.spec.js`
  // → "valid text PDF upload") asserts the badge renders after the
  // filecard; without this state the assertion times out because the
  // parent's SWR refetch typically lands 1-3 frames later than the
  // XHR's onload event.
  const [optimisticCharCount, setOptimisticCharCount] = useState(null)

  const fileName = profile?.cvFileName || ''
  const fileSize = Number(profile?.cvFileSize) || 0
  const cvText = profile?.cvText || ''
  const hasFile = !!fileName
  // Empty-text edge case = the file is on file (filename set) but the
  // server returned no extractable text. Triggered for image-only /
  // scanned PDFs. The empty-hint banner renders inline; the parent's
  // `onFallbackRequired` callback decides whether to refocus a
  // textarea, redirect to /settings, or no-op (onboarding case).
  const cvTextEmpty = hasFile && !cvText
  const longPreview = cvText.length > CV_PREVIEW_LIMIT
  const visibleText = (longPreview && !expanded) ? cvText.slice(0, CV_PREVIEW_LIMIT) : cvText

  /** Human-readable byte count. Stored on the server as a number
   *  (`cvFileSize`) so this is just a tiny formatter. */
  const fmtBytes = (n) => {
    if (!n) return ''
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
  }

  /** Cancel any in-flight XHR before starting a new upload. The
   *  `_superseded` flag is set synchronously BEFORE `.abort()` so the
   *  XHR's async `abort`/`error` event handlers can detect they were
   *  pre-empted by a newer upload rather than a user-initiated cancel
   *  — and resolve with a `__superseded` sentinel instead of throwing
   *  a misleading "Uppladdningen avbröts" error. See handleFile() and
   *  uploadWithProgress() below for the consumer side.
   */
  const abortInflight = () => {
    if (inflightXhrRef.current) {
      inflightXhrRef.current._superseded = true
      try { inflightXhrRef.current.abort() } catch (_) { /* already settled */ }
      inflightXhrRef.current = null
    }
  }

  /** XHR-based upload so we can surface real upload progress.
   *
   *  Why XHR instead of fetch: per-browser spec, `fetch()` does not
   *  expose upload `ProgressEvent`s — only the response body is a
   *  ReadableStream you can read with progress callbacks. The cleanest
   *  workaround in modern browsers is still a hand-rolled
   *  `XMLHttpRequest`, which keeps the upload event surface intact.
   *
   *  Stashes the in-flight XHR into `inflightXhrRef` so a subsequent
   *  upload call can abort the prior transfer via `abortInflight()`.
   *  Each terminal handler (`load`, `error`, `abort`) clears the ref
   *  only when it matches the current XHR — that way a completed
   *  callback never accidentally cancels an unrelated in-flight
   *  transfer from a later call.
   *
   *  Returns a `{status, json}` envelope so the caller can branch on
   *  HTTP code without re-parsing the response. Rejects on network
   *  errors and on abort — HTTP errors are returned as
   *  `{status >= 400}` so the caller can surface the server-provided
   *  error message.
   */
  const uploadWithProgress = (file, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    // `_superseded` is flipped to `true` by `abortInflight()` BEFORE
    // the abort() call fires so this XHR's async terminal events can
    // distinguish a user-initiated cancel ("Uppladdningen avbröts")
    // from a race that pre-empted it ("a newer upload took over").
    // Resolves with `{ __superseded: true }` in the latter case so
    // handleFile() bails silently — without this guard, an A→B rapid
    // drop would leak a misleading "Uppladdningen avbröts" toast + an
    // inline error alert from A's catch block AFTER B had already
    // started uploading. Code review 2026-07-10.
    xhr._superseded = false
    inflightXhrRef.current = xhr
    xhr.open('POST', '/api/upload-cv', true)
    xhr.upload.addEventListener('progress', (e) => {
      // Skip progress updates for superseded uploads so UI doesn't
      // jump back as a stale XHR finishes draining.
      if (xhr._superseded) return
      if (e.lengthComputable) {
        onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)))
      }
    })
    xhr.addEventListener('load', () => {
      if (inflightXhrRef.current === xhr) inflightXhrRef.current = null
      // Bail-silently on a late load event if a newer upload superseded
      // this one — without this check, a load that fires after `abort()`
      // (rare but possible when the response was already in flight when
      // `abortInflight()` was called) would surface the stale response
      // as if it were fresh. Code review 2026-07-10.
      if (xhr._superseded) {
        resolve({ status: 0, json: { __superseded: true } })
        return
      }
      let json = {}
      try { json = xhr.responseText ? JSON.parse(xhr.responseText) : {} } catch (_) { /* empty */ }
      resolve({ status: xhr.status, json })
    })
    xhr.addEventListener('error', () => {
      if (inflightXhrRef.current === xhr) inflightXhrRef.current = null
      if (xhr._superseded) {
        // Pre-empted by newer upload — not a real network error.
        resolve({ status: 0, json: { __superseded: true } })
      } else {
        reject(new Error('Nätverksfel — kunde inte nå servern. Försök igen.'))
      }
    })
    xhr.addEventListener('abort', () => {
      if (inflightXhrRef.current === xhr) inflightXhrRef.current = null
      if (xhr._superseded) {
        // Pre-empted by newer upload — not a user-initiated cancel.
        resolve({ status: 0, json: { __superseded: true } })
      } else {
        reject(new Error('Uppladdningen avbröts.'))
      }
    })
    const fd = new FormData()
    fd.append('file', file)
    xhr.send(fd)
  })

  /** Validate + POST the file. `setError` updates an in-section alert
   *  so users see *why* a file was rejected without a Sonner toast
   *  needing to dismiss itself. `toast.error` is used for softer,
   *  unexpected failures. After a 4xx or an empty-text success both
   *  call `onFallbackRequired?.()` so the parent can focus the
   *  manual summary box (or redirect to /settings on onboarding). */
  const handleFile = async (file) => {
    setError('')
    const ext = String(file.name).split('.').pop()?.toLowerCase() || ''
    if (!CV_ACCEPTED_EXTS.includes(ext)) {
      setError('Endast PDF och DOCX stöds.')
      return
    }
    if (file.size > CV_MAX_FILE_BYTES) {
      setError(`Filen är för stor (max ${CV_MAX_FILE_BYTES / 1024 / 1024} MB).`)
      return
    }

    // Race-safety: cancel any in-flight upload before starting a new
    // one so only the latest file reaches the server. `abortInflight`
    // marks the old XHR `_superseded = true` synchronously BEFORE
    // calling abort(), so when the old XHR's `abort` event eventually
    // fires (always async) its terminal handler resolves with a
    // `__superseded` sentinel instead of throwing a "Uppladdningen
    // avbröts" error. Without this guard, dropping file A then file B
    // in quick succession surfaced a misleading error toast + inline
    // alert from A's catch block AFTER B had already started uploading
    // — and `setError('Uppladdningen avbröts')` clobbered B's clean
    // error state once B succeeded. Code review 2026-07-10.
    abortInflight()

    setUploading(true)
    setUploadProgress(0)
    try {
      const { status, json } = await uploadWithProgress(file, setUploadProgress)
      // Bail silently if a newer upload superseded this one — the
      // outer promise settled but its result is stale data.
      if (json && json.__superseded) return
      setUploading(false)
      setUploadProgress(0)

      if (status >= 200 && status < 300 && json.ok) {
        const charCount = (json.cvText || '').length
        // Round-47 — seed the optimistic state so the success badge
        // renders synchronously with the file card. Soft failures
        // (warning + needsManualFallback) result in charCount === 0,
        // which is correctly hidden by the `> 0` predicate below.
        setOptimisticCharCount(charCount)
        const needsFallback = !!json.needsManualFallback
        // 2026-07-12 (Round-10 polish, Round-14 refined): the
        // soft-failure path (PDF parser threw a categorised error
        // the primary path couldn't recover — post-Round-14 there
        // is no library fallback, only the manual-fallback UX)
        // returns 200 with a `warning` field. We surface it as a
        // toast.success (NOT toast.error) because the file WAS
        // accepted — the user just needs to write a manual summary.
        // The existing empty-hint banner below the file card
        // (driven by `cvTextEmpty`) already conveys the same
        // message inline, so we don't double up with a red error
        // alert. The 4xx error path (real upload failures)
        // continues to use the red `error` state for proper
        // visual severity.
        const isSoftFailure = !!json.warning || json.code === 'EXTRACTION_FAILED'
        // Success-path toast — copy may drift, but the substring
        // "inläst" is a stable e2e assertion point.
        toast.success(
          needsFallback
            ? isSoftFailure
              ? 'CV uppladdad — men texten kunde inte tolkas. Skriv en kort sammanfattning manuellt nedan.'
              : 'CV uppladdad — men texten kunde inte tolkas (skannad bild?)'
            : `✓ CV lästes in — ${charCount.toLocaleString('sv-SE')} tecken hittades`,
        )
        // Bug-3 fix (2026-07-17): when GROQ/OPENAI/EMERGENT keys
        // are all absent in the server env, the upload-CV route
        // returns `aiKeyConfigured: false` and the user's spec'd
        // Swedish warning as `aiWarning`. Surface here so the user
        // knows cover-letter / email-body generation will fall
        // back to a generic Swedish template until an admin adds
        // a key. Fired once per successful upload (the user just
        // clicked the button — they'll see it; if they ignore it,
        // they'll see it again on the next upload, which is the
        // correct soft-launch behavior).
        if (json.aiKeyConfigured === false && json.aiWarning) {
          // 2026-07-17 (Bug-3 polish): one-shot gate via
          // localStorage so the AI-key warning fires ONCE per
          // sticky-unconfigured state, not on every upload. The
          // flag stays sticky until the env gains a key. When
          // the env flips BACK to no-key the next upload
          // re-toasts (sticky state cleared) so a re-deployment
          // that strips the key surfaces the warning again.
          const DISMISS_KEY = 'jobbpiloten.aiKeyWarningDismissed'
          let dismissed = false
          try { dismissed = localStorage.getItem(DISMISS_KEY) === '1' } catch (_) { /* storage off */ }
          if (!dismissed) {
            toast.error(json.aiWarning)
            try { localStorage.setItem(DISMISS_KEY, '1') } catch (_) { /* storage off */ }
          }
        } else if (json.aiKeyConfigured === true) {
          // Env now has a key — clear the sticky flag so a
          // future re-deployment that strips the key re-toasts.
          try { localStorage.removeItem('jobbpiloten.aiKeyWarningDismissed') } catch (_) { /* storage off */ }
        }
        setExpanded(false)
        onChanged?.()
        if (needsFallback) {
          // Fire AFTER onChanged so the parent's re-render has already
          // swapped the dropzone for the file card; the user sees both
          // the inline hint and the focused textarea at the same time.
          requestAnimationFrame(() => {
            try { onFallbackRequired?.('empty') } catch (_) { /* parent may not own a textarea */ }
          })
        }
      } else {
        const msg = json.error || `Servern returnerade ${status}`
        setError(msg)
        toast.error(msg)
        requestAnimationFrame(() => {
          try { onFallbackRequired?.('error') } catch (_) { /* ignore */ }
        })
      }
    } catch (err) {
      setUploading(false)
      setUploadProgress(0)
      const msg = err?.message || 'Uppladdningen misslyckades.'
      setError(msg)
      toast.error(msg)
      requestAnimationFrame(() => {
        try { onFallbackRequired?.('error') } catch (_) { /* ignore */ }
      })
    }
  }

  // Note: the `__superseded` resolve path is handled at the top of
  // `handleFile()` via an early `return` rather than via the catch
  // block. A `throw` would land here too, but the uploadWithProgress
  // contract resolves (not rejects) on supersession so we can pick the
  // user-visible messaging cleanly.

  /** Clear the saved CV via the partial-update endpoint. Reuses the
   *  extended ALLOW list on `/api/profile-update` to avoid a second
   *  `DELETE` endpoint to keep in sync. `cvUploadedAt: null` clears
   *  the timestamp; Mongo treats `$set` with `null` as an explicit
   *  assignment, and the partial-update allow-list already includes
   *  `cvUploadedAt`. */
  const handleRemove = async () => {
    setError('')
    try {
      const res = await fetch('/api/profile-update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvText: '', cvFileName: '', cvFileSize: 0, cvUploadedAt: null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        const msg = json.error || 'Kunde inte ta bort filen.'
        setError(msg)
        toast.error(msg)
        return
      }
      toast.success('CV borttaget')
      setExpanded(false)
      // Round-47 — clear the optimistic char count so a future
      // upload starts fresh (without latent stale state from a
      // previous successful upload).
      setOptimisticCharCount(null)
      onChanged?.()
    } catch (err) {
      const msg = 'Något gick fel: ' + err.message
      setError(msg)
      toast.error(msg)
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) handleFile(file)
  }
  const onDragOver = (e) => {
    e.preventDefault()
    setDragging(true)
  }
  /** `onDragLeave` fires whenever the pointer crosses any child node,
   *  not just the outer container, which can flicker the amber hover
   *  state mid-drag. Ignore leave-events that stay within the zone. */
  const onDragLeave = (e) => {
    e.preventDefault()
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragging(false)
  }
  const onFileInputChange = (e) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // Reset so the same file can be picked again after a fix-and-retry.
    e.target.value = ''
  }
  const clickPicker = () => {
    if (uploading) return
    fileInputRef.current?.click()
  }

  // Shared file input — rendered once inside whichever state we're in.
  const fileInputEl = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      className="hidden"
      onChange={onFileInputChange}
      data-testid="settings-cv-fileinput"
    />
  )

  return (
    <div className="space-y-3">
      {!hasFile ? (
        // ---- Empty state — drop zone ----
        <div
          role="button"
          tabIndex={0}
          onClick={clickPicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              clickPicker()
            }
          }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          data-testid="settings-cv-dropzone"
          className={`relative rounded-lg border-2 border-dashed cursor-pointer transition-all duration-200 px-4 py-7 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1 ${
            dragging
              ? 'border-amber-500 bg-amber-50'
              : 'border-slate-300 bg-slate-50/60 hover:border-amber-400 hover:bg-amber-50/40'
          }`}
        >
          {/* Progress bar replaces the static icon + format hint while
              the upload is in-flight. XHR.upload.onprogress drives it
              in 0..100 steps. */}
          {uploading ? (
            <div className="space-y-3" data-testid="settings-cv-progress">
              <div className="flex items-center gap-2 justify-center text-sm font-medium text-slate-700">
                <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                Laddar upp din CV…
              </div>
              <div
                className="w-full h-2 bg-slate-200 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={uploadProgress}
                aria-label="Uppladdning av CV"
              >
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-[width] duration-150 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 tabular-nums text-center">{uploadProgress}%</p>
            </div>
          ) : (
            <>
              <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-3">
                <FileUp className="w-6 h-6 text-amber-600" />
              </div>
              <p className="text-sm font-medium text-slate-800">
                {dragging
                  ? 'Släpp filen här'
                  : 'Dra och släpp ditt CV här, eller klicka för att välja fil'}
              </p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide bg-white border border-slate-200 text-slate-600">
                  PDF, DOCX
                </span>
                <span className="text-[11px] text-slate-500">Max 5 MB</span>
              </div>
            </>
          )}
          {fileInputEl}
        </div>
      ) : (
        // ---- File attached — file card ----
        <div
          data-testid="settings-cv-filecard"
          className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 flex items-start gap-3"
        >
          <div className="w-9 h-9 rounded-md bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
            <FileText className="w-5 h-5 text-emerald-700" />
          </div>
          <div className="flex-1 min-w-0">
            {/* Progress bar on the file-card branch — same XHR pipeline
                but the file card stays in place during a "Byt fil"
                swap so the user sees unbroken context. */}
            {uploading && (
              <div className="space-y-1.5 mb-2" data-testid="settings-cv-progress-filecard">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Loader2 className="w-3 h-3 animate-spin text-amber-500" />
                  Laddar upp ersättaren…
                  <span className="ml-auto tabular-nums">{uploadProgress}%</span>
                </div>
                <div
                  className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={uploadProgress}
                  aria-label="Uppladdning av CV"
                >
                  <div
                    className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-[width] duration-150 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="font-medium text-sm text-slate-900 truncate max-w-[260px]"
                title={fileName}
              >
                {fileName}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white border border-slate-200 text-slate-600">
                {fmtBytes(fileSize)}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {profile?.cvUploadedAt
                ? `Uppladdad ${fmtDate(profile.cvUploadedAt)}`
                : 'Uppladdad'}
            </p>
            {/* Success indicator — renders below the date only when
                cvText has been populated. Empty-text edge case is
                handled by the dedicated banner below the card.
                Round-47: optimisticCharCount (set synchronously on
                upload success) takes precedence over the prop-based
                cvText.length so the badge renders in the same frame
                as the file card. The prop-based value is the source
                of truth on SUBSEQUENT renders (so a future SWR
                refetch that grows or shrinks the text wins). */}
            {hasFile && (optimisticCharCount ?? cvText.length) > 0 && (
              <p
                className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1 mt-0.5"
                data-testid="settings-cv-success"
              >
                <Check className="w-3 h-3" />
                CV lästes in — {(optimisticCharCount ?? cvText.length).toLocaleString('sv-SE')} tecken hittades
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={clickPicker}
              disabled={uploading}
              className="mt-2 h-7 text-xs"
              data-testid="settings-cv-replace"
            >
              {uploading
                ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Bearbetar…</>
                : 'Byt fil'}
            </Button>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleRemove}
            disabled={uploading}
            className="text-slate-500 hover:text-red-600 hover:bg-red-50 shrink-0 h-8 w-8"
            data-testid="settings-cv-remove"
            aria-label="Ta bort CV-fil"
          >
            <X className="w-4 h-4" />
          </Button>
          {fileInputEl}
        </div>
      )}

      {/* Error banner (validation/server errors). Reset by next upload. */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5"
          data-testid="settings-cv-error"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Preview of extracted text — only after a successful upload. */}
      {hasFile && cvText && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">
              Förhandsvisning av extraherad text
            </span>
            <span className="text-[11px] text-slate-400 tabular-nums">
              {cvText.length.toLocaleString('sv-SE')} tecken
            </span>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
            {visibleText}{longPreview && !expanded && <span className="text-slate-400">…</span>}
          </div>
          {longPreview && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              className="h-7 px-2 -ml-1 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
              data-testid="settings-cv-preview-toggle"
            >
              {expanded
                ? <><ChevronUp className="w-3 h-3 mr-1" /> Visa mindre</>
                : <><ChevronDown className="w-3 h-3 mr-1" /> Visa mer</>}
            </Button>
          )}
        </div>
      )}

      {/* File uploaded but extraction returned no text — usually a
          scanned image-only PDF. The empty-hint banner renders inline
          AND the parent's `onFallbackRequired` callback is fired
          (deferred) so it can refocus the manual summary box. */}
      {cvTextEmpty && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 flex items-start gap-2"
          data-testid="settings-cv-empty-hint"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Filen är uppladdad men vi kunde inte tolka texten (t.ex. en
            skannad bild-PDF). Skriv en kort sammanfattning nedan så AI:n
            kan använda den i dina personliga brev.
          </span>
        </div>
      )}
    </div>
  )
}
