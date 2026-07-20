'use client'

import { useState, useEffect, useReducer, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import {
  Sparkles, Send, Check, MapPin, Briefcase, Smartphone,
  PlayCircle, ArrowRight, Lock, ShieldCheck, PartyPopper,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DEMO_STATES,
  DEMO_ACTIONS,
  DEMO_TIMING,
  demoReducer,
} from '@/lib/demo-state-machine'

// =========================================================================
//  STATE MACHINE — re-exported for downstream consumers
// =========================================================================
//
// The reducer + state/action constants + timing live in
// `lib/demo-state-machine.mjs` (a pure ES module with no JSX) so
// they're importable from `node --test` — which can't parse .jsx
// files. The component re-exports them so a future consumer that
// imports only from `@/components/InteractiveDemo` still sees the
// full state-machine surface (the @/components/InteractiveDemo
// test below asserts the re-export contract).
export { DEMO_STATES, DEMO_ACTIONS, DEMO_TIMING, demoReducer }

// =========================================================================
//  MOCK DATA
// =========================================================================
//
// Hard-coded Swedish-language job + AI-filled application. NO
// backend call — this is a self-contained landing-page demo per the
// Part 1 spec ("Mock AI responses — no backend call needed for
// demo"). Future: the same shape can be generated client-side from
// the user's profile if we ever want personalised demos.

const MOCK_JOB = {
  company: 'Spotify',
  companyInitial: 'S',
  // Spotify's brand-emerald — kept generic (not Spotify's exact
  // hex) to avoid implying an official partnership.
  companyGradient: 'from-emerald-500 to-emerald-700',
  role: 'Frontend-utvecklare',
  location: 'Stockholm',
  // 2-3 sentence mock job description for the card + the "Varför
  // vill du jobba hos oss?" mock answer.
  description: 'Vi söker en frontend-utvecklare som brinner för att bygga tillgängliga, snabba och vackra webbupplevelser i världsklass.',
  contractType: 'Heltid',
}

// Field shape: { id, label, value, tone, kind, placeholder }
//   tone = 'high'   → emerald border + ✓ "Hög säkerhet" pill (data the
//                       AI is confident about: name, email, phone)
//   tone = 'review' → amber border + ⚠ "Granska" pill (AI-drafted
//                       from CV but should be re-read for personal
//                       voice — "Berätta kort om dig själv")
//   tone = 'ai'     → blue border + ✨ "AI-genererad" pill (fully
//                       AI-composed, user can edit freely —
//                       "Varför vill du jobba hos oss?" + "Vad är
//                       din största styrka?")
//   kind = 'input'  → single-line text input
//   kind = 'textarea' → multi-line textarea
//   placeholder  → shown in the field while the demo is in FORM_OPEN
//                  (no AI fill yet). Once AI_FILLING → REVIEW → READY
//                  the field shows the populated value. Round-52
//                  / Issue 5 (P1) — the pre-fix demo loaded with
//                  pre-filled mock data; the new contract is
//                  "empty form on mount, animated fill on click".
//                  The placeholder text is the visible affordance
//                  that tells the visitor "this is where your data
//                  would land" so the empty state doesn't read as
//                  broken.
const MOCK_FIELDS = [
  {
    id: 'name',
    label: 'Namn',
    value: 'Anna Andersson',
    placeholder: 'Ditt namn',
    tone: 'high',
    kind: 'input',
  },
  {
    id: 'email',
    label: 'E-post',
    value: 'anna.andersson@example.se',
    placeholder: 'din@email.se',
    tone: 'high',
    kind: 'input',
  },
  {
    id: 'phone',
    label: 'Telefon',
    value: '070-123 45 67',
    placeholder: '070-123 45 67',
    tone: 'high',
    kind: 'input',
  },
  {
    id: 'about',
    label: 'Berätta kort om dig själv',
    value: 'Jag har jobbat som frontend-utvecklare i sju år och brinner för att bygga användarvänliga gränssnitt. På Klarna ledde jag migreringen av betalflödet till en ny design som ökade konverteringen med 18%.',
    placeholder: 'Skriv en kort presentation…',
    tone: 'review',
    kind: 'textarea',
  },
  {
    id: 'why',
    label: 'Varför vill du jobba hos oss?',
    value: 'Spotify ligger i framkant av streaming-teknik och jag har länge beundrat hur ni kombinerar teknisk excellens med musikupplevelse i världsklass. Min erfarenhet av prestandaoptimering och tillgänglighet passar perfekt för era produkter.',
    placeholder: 'AI:n hjälper dig formulera ett svar…',
    tone: 'ai',
    kind: 'textarea',
  },
  {
    id: 'strength',
    label: 'Vad är din största styrka?',
    value: 'Min största styrka är att jag kan översätta komplexa tekniska koncept till intuitiva användarupplevelser. Jag har en bakgrund i både design och utveckling, vilket gör att jag kan prata flytande med båda teamen.',
    placeholder: 'AI:n hjälper dig formulera ett svar…',
    tone: 'ai',
    kind: 'textarea',
  },
]

// Tone → visual class. The border colour carries the
// green/amber/blue meaning from the Part 1 spec; the bg tint
// echoes the colour at 40% opacity so the field still reads as
// white-dominant on the page.
const TONE_BORDER = {
  high: 'border-emerald-400 focus-within:border-emerald-500',
  review: 'border-amber-400 focus-within:border-amber-500',
  ai: 'border-blue-400 focus-within:border-blue-500',
}
const TONE_LABEL = {
  high: { text: 'Hög säkerhet', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  review: { text: 'Granska', tone: 'text-amber-700 bg-amber-50 border-amber-200' },
  ai: { text: 'AI-genererad', tone: 'text-blue-700 bg-blue-50 border-blue-200' },
}

// =========================================================================
//  COMPONENT
// =========================================================================

export default function InteractiveDemo() {
  const [state, dispatch] = useReducer(demoReducer, DEMO_STATES.IDLE)
  // Mobile detection via media query. We don't need a hydration
  // guard because the `hidden md:block` / `md:hidden` Tailwind
  // classes already pick the correct CSS at SSR; the JS check
  // here only controls whether the MOBILE-FALLBACK CTA routes to
  // /sign-up or to /extension-install (where it would be
  // meaningless on mobile).
  // Auto-advance timers. The reducer owns the state machine; the
  // component owns the side effects. Each effect owns ONE timer
  // and clears it on state change so we never get overlapping
  // setTimeout calls.
  useEffect(() => {
    if (state === DEMO_STATES.AI_FILLING) {
      const t = setTimeout(
        () => dispatch({ type: DEMO_ACTIONS.AI_FILL_DONE }),
        DEMO_TIMING.aiFillMs,
      )
      return () => clearTimeout(t)
    }
    if (state === DEMO_STATES.REVIEW) {
      const t = setTimeout(
        () => dispatch({ type: DEMO_ACTIONS.REVIEW_DONE }),
        DEMO_TIMING.reviewMs,
      )
      return () => clearTimeout(t)
    }
  }, [state])

  return (
    <section
      id="demo"
      className="py-20 sm:py-24 bg-gradient-to-b from-white via-indigo-50/30 to-white"
      data-testid="interactive-demo"
      aria-label="Interaktiv demo av JobbPiloten"
    >
      <div className="container mx-auto px-4">
        {/* Section header — same rhythm as the rest of the landing
            page (centered badge + h2 + subline) so the demo slot
            doesn't feel like a different page. */}
        <div className="text-center max-w-2xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full mb-4 border border-indigo-100">
            <Sparkles className="w-3 h-3" /> Prova direkt — utan konto
          </div>
          <h2 className="text-4xl font-bold text-slate-900">Så här fungerar det</h2>
          <p className="mt-4 text-slate-600">
            Klicka <strong>Ansök nu</strong> och se hur AI:n fyller i en hel ansökan på under 5 sekunder —
            med färgkodade fält som visar vad som är AI-genererat och vad du bör granska.
          </p>
        </div>

        {/* Mobile fallback — only shown on <sm. Per the Part 1
            spec, mobile users get a static poster + a CTA. The
            mobile fallback is always <sm-visible (md:hidden)
            and always points to /sign-up, because:
              1. The /extension-install CTA only makes sense on
                 a desktop browser where the Chrome Web Store /
                 sideload flow can run.
              2. SSR + hydration race fix: previously we
                 branch-selected the CTA based on a
                 window.matchMedia isMobile state that defaults
                 to false, so a mobile user saw /extension-install
                 briefly before the post-hydration swap. Always
                 rendering the mobile-safe CTA on SSR + client
                 removes the race. The desktop demo card
                 (success state) carries the /extension-install
                 link separately. */}
        <div className="md:hidden" data-testid="interactive-demo-mobile-fallback">
          <MobileFallback />
        </div>

        {/* Desktop interactive demo — the real state-machine demo. */}
        <div className="hidden md:block max-w-3xl mx-auto">
          <DemoCard state={state} dispatch={dispatch} />
        </div>

        {/* Trust strip — same as the rest of the landing */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-emerald-600" />
            Inga uppgifter skickas — detta är en mock-demo
          </span>
          <span className="text-slate-300">·</span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
            Inga konton skapas vid klick
          </span>
        </div>
      </div>
    </section>
  )
}

// ---- Demo card (desktop) -------------------------------------------------

function DemoCard({ state, dispatch }) {
  // Border colour for the card itself changes by state — gives
  // a subtle ambient feedback that "something happened" without
  // stealing focus from the field-level colour coding.
  const cardAccent = {
    [DEMO_STATES.IDLE]: 'border-slate-200',
    [DEMO_STATES.FORM_OPEN]: 'border-slate-200',
    [DEMO_STATES.AI_FILLING]: 'border-indigo-300 shadow-indigo-100/50',
    [DEMO_STATES.REVIEW]: 'border-amber-300 shadow-amber-100/50',
    [DEMO_STATES.READY]: 'border-emerald-300 shadow-emerald-100/50',
    [DEMO_STATES.SUCCESS]: 'border-emerald-400 shadow-emerald-200/50',
  }[state]

  return (
    <motion.div
      layout
      transition={{ layout: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } }}
      data-testid="interactive-demo-card"
      data-state={state}
      className={`relative rounded-2xl bg-white border-2 shadow-sm ${cardAccent} overflow-hidden`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {state === DEMO_STATES.IDLE && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            data-testid="demo-job-card"
          >
            <JobCard
              job={MOCK_JOB}
              onApply={() => dispatch({ type: DEMO_ACTIONS.CLICK_APPLY })}
            />
          </motion.div>
        )}

        {(state === DEMO_STATES.FORM_OPEN ||
          state === DEMO_STATES.AI_FILLING ||
          state === DEMO_STATES.REVIEW ||
          state === DEMO_STATES.READY) && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            data-testid="demo-form"
          >
            <ApplicationForm
              job={MOCK_JOB}
              state={state}
              onAiFill={() => dispatch({ type: DEMO_ACTIONS.CLICK_AI_FILL })}
              onSend={() => dispatch({ type: DEMO_ACTIONS.CLICK_SEND })}
            />
          </motion.div>
        )}

        {state === DEMO_STATES.SUCCESS && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            data-testid="demo-success"
          >
            <SuccessState
              onReset={() => dispatch({ type: DEMO_ACTIONS.RESET })}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ---- Idle state: the job card -------------------------------------------

function JobCard({ job, onApply }) {
  return (
    <div className="p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${job.companyGradient} flex items-center justify-center text-white text-2xl font-bold shadow-sm shrink-0`} aria-hidden="true">
          {job.companyInitial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <Briefcase className="w-3.5 h-3.5" />
            <span>Ledigt jobb</span>
            <span className="text-slate-300">·</span>
            <span>{job.contractType}</span>
          </div>
          <h3 className="mt-1 text-xl font-bold text-slate-900 leading-tight">{job.role}</h3>
          <div className="mt-0.5 text-sm font-medium text-slate-700">{job.company}</div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
            <MapPin className="w-3 h-3" />
            <span>{job.location}</span>
          </div>
        </div>
      </div>
      <p className="mt-4 text-sm text-slate-600 leading-relaxed">{job.description}</p>
      <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <Button
          onClick={onApply}
          data-testid="demo-apply-btn"
          className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white h-11 px-6 w-full sm:w-auto"
        >
          Ansök nu <ArrowRight className="ml-1.5 w-4 h-4" />
        </Button>
        <span className="text-xs text-slate-500 sm:ml-1">
          Klicka för att se hela ansökningsflödet
        </span>
      </div>
    </div>
  )
}

// ---- Form state (FORM_OPEN → AI_FILLING → REVIEW → READY) ---------------

function ApplicationForm({ job, state, onAiFill, onSend }) {
  // Which fields show their tone-coded border + label?
  //   AI_FILLING: nothing yet (fields are still "loading")
  //   REVIEW:     yes (this is the "Granska innan du skickar" beat)
  //   READY:      yes (the user can still see what's AI vs profile)
  // We only reveal the colour-coded border AFTER the AI fill
  // completes — the "AI fyller i" phase is the loading state.
  const showTone = state === DEMO_STATES.REVIEW || state === DEMO_STATES.READY
  const isFilling = state === DEMO_STATES.AI_FILLING
  const canSend = state === DEMO_STATES.READY
  // Round-52 / Issue 5 (P1) — fields are EMPTY during FORM_OPEN
  // (placeholders only) and populate on AI fill. The state-machine
  // reducer is unchanged — only the render side learns the
  // "isEmpty" beat so the existing tests/unit/interactive-demo.test.mjs
  // contract stays green. Tests assert the FORM_OPEN branch
  // separately.
  const isEmpty = state === DEMO_STATES.FORM_OPEN

  return (
    <div className="p-6 sm:p-8">
      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
        <Briefcase className="w-3.5 h-3.5" />
        <span>Ansökan till {job.company}</span>
        <span className="text-slate-300">·</span>
        <span>{job.role}</span>
      </div>

      <div className="mt-5 space-y-3">
        {MOCK_FIELDS.map((field, idx) => (
          <DemoField
            key={field.id}
            field={field}
            showTone={showTone}
            isFilling={isFilling}
            isEmpty={isEmpty}
            // Stagger the "AI is filling" loading shimmer so it
            // feels like a sequential flow rather than a global
            // spinner. 80ms × field-index gives ~480ms for 6
            // fields, well under the 2200ms AI_FILLING total.
            shimmerDelayMs={isFilling ? idx * 80 : 0}
            isReady={canSend}
          />
        ))}
      </div>

      {/* Bottom action row — context-dependent. The "Förbered
          med AI" pill is the primary CTA in FORM_OPEN. After
          the fill animation it morphs into a "Klar att skicka"
          button gated on the READY state. Round-52 / Issue 5
          followup: the "Klar att skicka" button is now visible
          (but disabled) during FORM_OPEN + AI_FILLING + REVIEW
          so the visitor sees the destination CTA at all times.
          Pre-fix the button only appeared at READY which felt
          jarring — the user clicked "Förbered med AI" and then
          had to wait through three states before the next
          affordance surfaced. */}
      <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-slate-100">
        <div className="text-xs text-slate-500" data-testid="demo-status-hint">
          {state === DEMO_STATES.FORM_OPEN && (
            <span>Klicka <strong>Förbered med AI</strong> för att fylla i alla fält.</span>
          )}
          {state === DEMO_STATES.AI_FILLING && (
            <span className="inline-flex items-center gap-1.5 text-indigo-700">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" /> AI:n fyller i dina svar…
            </span>
          )}
          {state === DEMO_STATES.REVIEW && (
            <span className="inline-flex items-center gap-1.5 text-amber-700">
              ⚠ Granska innan du skickar — AI-guessade svar är markerade i blått.
            </span>
          )}
          {state === DEMO_STATES.READY && (
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <Check className="w-3.5 h-3.5" /> Alla fält ifyllda — redo att skicka.
            </span>
          )}
        </div>

        {state === DEMO_STATES.FORM_OPEN && (
          <Button
            onClick={onAiFill}
            data-testid="demo-pill"
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white h-10 px-5 shadow-sm"
          >
            <Sparkles className="w-4 h-4 mr-1.5" />
            Förbered med AI
          </Button>
        )}

        {state !== DEMO_STATES.FORM_OPEN && state !== DEMO_STATES.SUCCESS && (
          <Button
            onClick={onSend}
            disabled={!canSend}
            data-testid="demo-send-btn"
            data-disabled={!canSend}
            aria-disabled={!canSend}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white h-10 px-5 shadow-sm"
          >
            <Send className="w-4 h-4 mr-1.5" /> Klar att skicka
          </Button>
        )}
      </div>
    </div>
  )
}

// ---- One form field with tone-aware styling -----------------------------

function DemoField({ field, showTone, isFilling, isEmpty, shimmerDelayMs, isReady }) {
  // The border class only changes once `showTone` is true. Before
  // that, all fields render as neutral input/textarea shells.
  const borderClass = showTone ? TONE_BORDER[field.tone] : 'border-slate-200 focus-within:border-slate-400'
  const bgClass = showTone ? 'bg-white' : 'bg-slate-50'

  // Round-52 / Issue 5 (P1) — the empty-form contract. During
  // FORM_OPEN the field renders with an empty `value` so React
  // shows the placeholder text ("Ditt namn", "din@email.se", etc.)
  // instead of the mock data. After the AI fill completes
  // (REVIEW / READY) the field shows the populated value. We
  // switch from `defaultValue` to controlled `value` because
  // React's warning suppresses on read-only inputs — the field
  // is still effectively read-only, but the value visibly flips
  // from "" to the mock text the moment the AI_FILLING shimmer
  // resolves, which is the visual feedback the spec asks for.
  const renderedValue = isEmpty ? '' : field.value
  return (
    <div
      data-testid={`demo-field-${field.id}`}
      data-tone={field.tone}
      data-empty={isEmpty ? 'true' : 'false'}
      className={`rounded-lg border-2 transition-colors duration-300 ${borderClass} ${bgClass} px-3 py-2`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <label
          htmlFor={`demo-input-${field.id}`}
          className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider"
        >
          {field.label}
        </label>
        {showTone && (
          <span
            data-testid={`demo-field-tone-${field.id}`}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${TONE_LABEL[field.tone].tone}`}
          >
            {TONE_LABEL[field.tone].text}
          </span>
        )}
      </div>
      {isFilling ? (
        <div
          className="h-4 rounded bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 bg-[length:200%_100%] motion-safe:animate-pulse"
          style={{ animationDelay: `${shimmerDelayMs}ms` }}
          aria-label="AI fyller i detta fält"
        />
      ) : field.kind === 'textarea' ? (
        <textarea
          id={`demo-input-${field.id}`}
          value={renderedValue}
          placeholder={field.placeholder || ''}
          readOnly
          rows={3}
          aria-readonly="true"
          className="w-full text-sm text-slate-800 placeholder:text-slate-400 bg-transparent border-0 focus:outline-none resize-none leading-relaxed"
        />
      ) : (
        <input
          id={`demo-input-${field.id}`}
          type="text"
          value={renderedValue}
          placeholder={field.placeholder || ''}
          readOnly
          aria-readonly="true"
          className="w-full text-sm text-slate-800 placeholder:text-slate-400 bg-transparent border-0 focus:outline-none"
        />
      )}
    </div>
  )
}

// ---- Success state -------------------------------------------------------

function SuccessState({ onReset }) {
  // Confetti: 36 small absolute-positioned divs that animate
  // outward with random rotations, distances, and colours. Pure
  // CSS / Framer Motion — no canvas-confetti dependency, no
  // extra package.json entry. The "burst" re-keys on each
  // success-state mount so re-clicking "Starta om" → click
  // through → success re-triggers the animation.
  const confettiKey = useRef(0)
  useEffect(() => { confettiKey.current += 1 }, [])
  const particles = Array.from({ length: 36 }, (_, i) => {
    // Deterministic seed per index so SSR + client agree (no
    // hydration mismatch). Each particle has: a colour (one of
    // 4 brand-emerald/indigo/amber/rose accents), an angle (0-2π),
    // a distance (40-180px from the card centre), and a rotation
    // (±720°).
    const colours = ['#10b981', '#6366f1', '#f59e0b', '#ec4899']
    const angle = (i / 36) * Math.PI * 2
    const dist = 60 + (i % 5) * 24
    return {
      id: i,
      color: colours[i % 4],
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - 40, // bias upward
      rotate: (i % 2 === 0 ? 1 : -1) * (180 + (i % 7) * 60),
    }
  })

  return (
    <div className="p-6 sm:p-10 text-center relative" data-testid="demo-success">
      {/* Confetti burst — absolute layer over the success card. */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        aria-hidden="true"
        data-testid="demo-confetti"
      >
        {particles.map((p) => (
          <motion.span
            key={`${confettiKey.current}-${p.id}`}
            initial={{ x: '50%', y: '50%', rotate: 0, opacity: 1 }}
            animate={{
              x: `calc(50% + ${p.dx}px)`,
              y: `calc(50% + ${p.dy}px)`,
              rotate: p.rotate,
              opacity: 0,
            }}
            transition={{ duration: 1.2 + (p.id % 4) * 0.15, ease: 'easeOut' }}
            className="absolute top-0 left-0 w-2 h-3 rounded-sm"
            style={{ backgroundColor: p.color }}
          />
        ))}
      </div>

      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 200, damping: 14 }}
        className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mb-4"
      >
        <Check className="w-8 h-8" strokeWidth={3} />
      </motion.div>

      <h3 className="text-2xl sm:text-3xl font-bold text-slate-900">
        Så här fungerar det på riktiga jobbsidor
      </h3>
      <p className="mt-2 text-slate-600 max-w-md mx-auto">
        Med JobbPiloten Auto-Fill görs hela flödet i din webbläsare — direkt på arbetsgivarens ansökningssida.
        Inga kopiera-och-klistra-steg, ingen AI som skickar utan ditt godkännande.
      </p>

      <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Button
          asChild
          className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white h-11 px-6"
        >
          <Link
            href="/extension-install"
            data-testid="demo-cta"
          >
            <PartyPopper className="w-4 h-4 mr-1.5" />
            Installera tillägget och prova på din nästa ansökan
          </Link>
        </Button>
        <button
          type="button"
          onClick={onReset}
          data-testid="demo-reset-btn"
          className="text-sm text-slate-500 hover:text-slate-700 underline-offset-2 hover:underline transition-colors"
        >
          Starta om demo
        </button>
      </div>
    </div>
  )
}

// ---- Mobile fallback -----------------------------------------------------

function MobileFallback() {
  // Static visual mockup of the desktop demo — same colour
  // palette, same field layout, but no interactivity. The
  // purpose is to show mobile visitors what they'd see on
  // desktop without forcing them through a cramped 6-field
  // form on a 360px-wide screen.
  return (
    <div className="max-w-md mx-auto rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6">
        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
          <Smartphone className="w-3.5 h-3.5" />
          <span>Mobil demo</span>
        </div>
        <h3 className="mt-2 text-xl font-bold text-slate-900">Så här ser det ut på din dator</h3>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          Den interaktiva demolayouten är optimerad för desktop — på mobilen ger vi dig
          en stillbild av arbetsflödet och en direktlänk för att komma igång.
        </p>

        {/* Mini-mockup — 3 stacked colour-tinted rectangles
            representing the form / AI / send beats, in the
            brand palette. Pure CSS, no animation. */}
        <div className="mt-4 space-y-2">
          <div className="rounded-md border-2 border-emerald-200 bg-emerald-50/50 px-3 py-2 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-medium text-slate-700">Namn, e-post, telefon (från profilen)</span>
          </div>
          <div className="rounded-md border-2 border-amber-200 bg-amber-50/50 px-3 py-2 flex items-center gap-2">
            <span className="text-amber-600 text-xs">⚠</span>
            <span className="text-xs font-medium text-slate-700">Berätta om dig (AI-utkast — granska)</span>
          </div>
          <div className="rounded-md border-2 border-blue-200 bg-blue-50/50 px-3 py-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-medium text-slate-700">Varför oss? (AI-genererad)</span>
          </div>
        </div>

        <div className="mt-6">
          <Button
            asChild
            className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white h-11 px-6 w-full"
          >
            <Link
              href="/sign-up"
              data-testid="demo-mobile-cta"
            >
              <ArrowRight className="w-4 h-4 mr-1.5" />
              Skapa konto och kör igång
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
