'use client'

// components/Confetti.jsx — Round-94 (professional polish): a brief,
// dependency-free confetti burst used to celebrate onboarding
// completion ("Slutför").
//
// Purposeful-delight rules:
//   • 40 small pieces, absolutely positioned, fall + spin via the
//     `confetti-fall` keyframe (defined in app/globals.css).
//   • Self-cleaning: the overlay unmounts after 1.8s so it never
//     blocks interaction or lingers on the redirect.
//   • Zero third-party deps (no canvas-confetti) — keeps the client
//     bundle lean; the effect is honest and cheap.

import { useEffect, useState } from 'react'

const COLORS = ['#f59e0b', '#6366f1', '#3b82f6', '#10b981', '#ec4899', '#f43f5e']

export default function Confetti({ count = 40 }) {
  const [pieces] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: 6 + Math.random() * 6,
      delay: Math.random() * 0.25,
      duration: 1.1 + Math.random() * 0.6,
      color: COLORS[i % COLORS.length],
      rotate: Math.random() * 360,
    })),
  )
  const [alive, setAlive] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setAlive(false), 1800)
    return () => clearTimeout(t)
  }, [])

  if (!alive) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute top-[-16px] block rounded-[2px]"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: Math.round(p.size * 0.6),
            backgroundColor: p.color,
            transform: `rotate(${p.rotate}deg)`,
            animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
          }}
        />
      ))}
    </div>
  )
}
