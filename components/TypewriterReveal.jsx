'use client'

// components/TypewriterReveal.jsx — Round-94 (professional polish):
// cover-letter reveal effect.
//
// The generated letter shows its first 50 characters immediately (so
// the user reads the opening line instantly), then the remainder fades
// in over 350ms. The FULL text is always in the DOM from the first
// render — selectable, screen-reader friendly and e2e-readable — only
// the opacity is animated. No layout shift, no timers on long text.

export default function TypewriterReveal({ text = '', head = 50 }) {
  if (!text) return null
  if (text.length <= head) return <>{text}</>
  return (
    <>
      {text.slice(0, head)}
      <span className="animate-[fade-in-soft_0.35s_ease-out_0.12s_both]">
        {text.slice(head)}
      </span>
    </>
  )
}
