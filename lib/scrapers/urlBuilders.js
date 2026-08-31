/**
 * Pre-filled search-URL builders for the Swedish job boards that
 * JobbPiloten does NOT scrape — they expose no public API and their
 * robots.txt restricts automated access. We construct a search URL
 * with the user's profile-derived query + location so clicking the
 * card deep-links them into the live search results page.
 *
 * Round-94/95 followup (2026-08-07): Blocket Jobb is shut down
 * (jobb.blocket.se is NXDOMAIN) — the Blocket URL helper was removed
 * entirely, and Ledigajobb (./ledigajobb.js) is the non-AF board we
 * scrape. The Jobbsafari helper below serves the "Letar du bredare?"
 * card; Jobbland's helper lives in ./jobbland.js.
 *
 * Single fan-in point for the shared helpers so the dashboard only has
 * to import from '@/lib/jobScraper' (which re-exports these helpers) —
 * no direct bleeding of new module paths into the React bundle.
 *
 * Export model: define the local function as a non-exported `function`
 * declaration, then re-export with a single `export {…}` block at
 * the bottom. This avoids Next.js's duplicate-export detection if a
 * caller accidentally imports the same name twice.
 */

import { buildLedigaJobbSearchUrl } from './ledigajobb.js'

/**
 * Construct a Jobbsafari search URL. Jobbsafari uses query-string
 * params with full Swedish edge cases (ÅÄÖ) encoded. Returns null
 * when both query and location are empty.
 */
function buildJobSafariSearchUrl({ query = '', location = '' } = {}) {
  const trimmedQuery = String(query || '').trim()
  const trimmedLocation = String(location || '').trim()
  if (!trimmedQuery && !trimmedLocation) return null
  const params = new URLSearchParams()
  if (trimmedQuery) params.set('q', trimmedQuery)
  if (trimmedLocation) params.set('l', trimmedLocation)
  return `https://jobbsafari.se/jobb?${params.toString()}`
}

// Single export block — avoids duplicate-export errors in module
// bundlers that lint for accidental name collisions.
export {
  buildLedigaJobbSearchUrl,
  buildJobSafariSearchUrl,
}
