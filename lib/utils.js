import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

/**
 * cn — Tailwind-aware class-name merger. Used by every shadcn/ui
 * component in components/ui/* so duplicate Tailwind utility classes
 * resolve to the last-wins ordering expected by the design system.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * truncate(value, n) — single-ellipsis truncation for log lines and
 * narrow-card text. Single canonical implementation shared by every
 * server module so the helper can't drift between files.
 *
 *   truncate('Frontend Developer', 10) → 'Frontend …'  (9 chars + ellipsis = 10)
 *
 * Used by:
 *   - lib/jobScraper.js  ([multiSource] metric log — query + location)
 *   - app/api/[[...path]]/route.js  (Aktivitetsrapport PDF row truncations)
 *
 * PRIVACY NOTE: do NOT swap this for `hashShort` "for privacy" in
 * log lines. Swedish municipalities are a low-cardinality field —
 * 32-bit FNV-1a is brute-forceable in <1ms against a list of ~290
 * kommun names, so a hash that anyone with Vercel log access can
 * reverse isn't a privacy boundary, it's just friction. Honest
 * truncate (40 chars in `lib/jobScraper.js:metric`) is the safer
 * posture and the cap matches Vercel's log search UI.
 */
export function truncate(value, n) {
  const s = String(value == null ? '' : value);
  if (!n || s.length <= n) return s;
  return `${s.slice(0, Math.max(0, n - 1))}…`;
}

/**
 * hashShort(s) — deterministic 32-bit FNV-1a hash, base36-encoded.
 * Single canonical implementation shared by every scraper that needs to
 * derive a stable id from an arbitrary URL or string. Earlier copies lived
 * privately inside lib/scrapers/blocket.js and lib/jobScraper.js; hoisting
 * it here means the test suite can lock the contract (deterministic,
 * base36-only output) and the id-derivation logic can't drift between
 * callers.
 *
 * NOT a cryptographic hash — 32 bits is plenty to dedupe collisions on a
 * few thousand jobs per scrape but a motivated attacker trivially finds
 * collisions. Acceptable here because the only consumer is dashboard id
 * collapse (see `mapBlocketJob` in blocket.js), not security.
 *
 *   hashShort('frontend')  → '9o9wzg'
 *   hashShort('frontend')  → '9o9wzg'     (deterministic)
 *   hashShort('backend')   → 'e6v3kd'     (different input → different output)
 */
export function hashShort(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}
