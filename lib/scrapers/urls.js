/**
 * Shared URL-slug helper for the pre-filled-search URL builders.
 *
 * Each Swedish job-board helper in lib/scrapers/* needs the same
 * normalisation — trim + lowercase + replace whitespace with hyphens +
 * strip non-word chars. Keeping the helper in a single small module so
 * the three boards (ledigajobb, Blocket, Jobbsafari) can't drift.
 *
 * Mirrors the private `toSlug()` that used to live inside
 * lib/jobScraper.js — that copy has been removed in Issue 4 in favour
 * of this shared module, which is re-used everywhere.
 */

export function toSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    // strip non-word chars but keep Swedish diacritics (åäöé etc.)
    .replace(/[^\w\u00C0-\u017F\-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
