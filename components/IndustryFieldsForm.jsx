'use client'

// components/IndustryFieldsForm.jsx — shared structured industry-field
// form (Round-83/84).
//
// The complete per-industry taxonomy (lib/field-taxonomy.js
// INDUSTRY_STRUCTURED_FIELDS) renders here once and is reused by BOTH
// the onboarding wizard (app/onboarding/page.js) and /settings
// (app/settings/page.js) so the two surfaces can never drift apart:
// select → shadcn Select with the schema's option list, multiselect →
// checkbox chips, text/url → Input. Answers live in a flat object
// keyed by schema field id ({ forklift_license: 'Ja',
// forklift_types: ['A1 - låglyftande'], … }).
//
// testid contract (locked by tests/e2e/onboarding-industry.spec.js):
//   • wrapper:  data-testid={wrapperTestid} (default
//               `${testidPrefix}s`? No — passed explicitly)
//   • field:    ${testidPrefix}-<fieldId>
//   • select:   ${testidPrefix}-<fieldId>-trigger / -opt-<slug>
//   • multi:    ${testidPrefix}-<fieldId>-opt-<slug>
//   • text/url: ${testidPrefix}-<fieldId>

import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { structuredFieldsFor } from '@/lib/field-taxonomy'

/** testid slug — stable lowercase alnum slug for option testids
 *  ("Mindre än 1 år" → "mindre-an-1-ar"). Kept in this shared module
 *  so onboarding + settings + the E2E spec reference the same contract. */
export function testidSlug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x'
}

export default function IndustryFieldsForm({
  industry,
  value = {},
  onChange,
  onToggleMulti,
  testidPrefix = 'onboarding-industry-field',
  wrapperTestid = 'onboarding-industry-fields',
  heading,
}) {
  if (!industry) return null
  const fields = structuredFieldsFor(industry)
  return (
    <div className="space-y-4 border-t border-dashed border-slate-200 pt-4" data-testid={wrapperTestid}>
      {heading && <Label className="text-sm font-semibold text-slate-800">{heading}</Label>}
      {fields.map((f) => {
        const val = value[f.id]
        if (f.type === 'multiselect') {
          return (
            <div key={f.id} data-testid={`${testidPrefix}-${f.id}`}>
              <Label className="text-sm text-slate-700">{f.label}</Label>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                {(f.options || []).map((opt) => {
                  const isChecked = Array.isArray(val) && val.includes(opt)
                  return (
                    <label
                      key={opt}
                      className="flex items-center gap-2 text-sm text-slate-700 px-2.5 py-1.5 rounded-md border border-slate-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => onToggleMulti?.(f.id, opt)}
                        data-testid={`${testidPrefix}-${f.id}-opt-${testidSlug(opt)}`}
                      />
                      <span className="text-xs">{opt}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )
        }
        if (f.type === 'select') {
          return (
            <div key={f.id} data-testid={`${testidPrefix}-${f.id}`}>
              <Label className="text-sm text-slate-700">{f.label}</Label>
              <Select
                value={typeof val === 'string' ? val : ''}
                onValueChange={(v) => onChange?.(f.id, v)}
              >
                <SelectTrigger data-testid={`${testidPrefix}-${f.id}-trigger`}>
                  <SelectValue placeholder="Välj…" />
                </SelectTrigger>
                <SelectContent>
                  {(f.options || []).map((opt) => (
                    <SelectItem
                      key={opt}
                      value={opt}
                      data-testid={`${testidPrefix}-${f.id}-opt-${testidSlug(opt)}`}
                    >
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        }
        // text / url — plain input
        return (
          <div key={f.id}>
            <Label className="text-sm text-slate-700">{f.label}</Label>
            <Input
              type={f.type === 'url' ? 'url' : 'text'}
              value={typeof val === 'string' ? val : ''}
              onChange={(e) => onChange?.(f.id, e.target.value)}
              data-testid={`${testidPrefix}-${f.id}`}
            />
          </div>
        )
      })}
    </div>
  )
}
