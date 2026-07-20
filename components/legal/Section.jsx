/**
 * Shared visual section helper for the legal pages (/privacy, /terms).
 *
 * Drives the "divided card" pattern used across all 10–11 sections on each
 * legal page: rounded outer card, divider between sections, indigo icon,
 * tight content padding. Keeps the legal-info styling in one place so it
 * only needs to be tweaked once.
 */
export default function Section({ icon: Icon, title, children }) {
  return (
    <section className="p-6 md:p-8">
      <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2 mb-3">
        {Icon && <Icon className="w-5 h-5 text-indigo-600 shrink-0" />}
        <span>{title}</span>
      </h2>
      <div className="text-slate-700 leading-relaxed text-sm space-y-1">{children}</div>
    </section>
  )
}
