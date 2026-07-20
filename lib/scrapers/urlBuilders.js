/**
 * Pre-filled search-URL builders for the Swedish job boards that
 * JobbPiloten does NOT scrape — they expose no public API and their
 * robots.txt restricts automated access. We construct a search URL
 * with the user's profile-derived query + location so clicking the
 * card deep-links them into the live search results page.
 *
 * Blocket Jobb is the only board we DO scrape (see ./blocket.js) — but
 * it still needs a URL helper for the "Letar du bredare?" card and as
 * a graceful fallback if the scrape hits a soft-block.
 *
 * Single fan-in point for all three so the dashboard only has to
 * import from '@/lib/jobScraper' (which re-exports these helpers) — no
 * direct bleeding of new module paths into the React bundle.
 *
 * Export model: define the local function as a non-exported `function`
 * declaration, then re-export with a single `export {…}` block at
 * the bottom. This avoids Next.js's duplicate-export detection if a
 * caller accidentally imports the same name twice.
 */

import { buildBlocketSearchUrl } from './blocket.js'
import { buildLedigaJobbSearchUrl } from './ledigajobb.js'
import { toSlug } from './urls.js'

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
  buildBlocketSearchUrl,
  buildLedigaJobbSearchUrl,
  buildJobSafariSearchUrl,
  toSlug,
}
