'use client'

/**
 * Raises a month's invoices in one press.
 *
 * Folded into a `<details>` because it is used once a month and the board below
 * it is used every day. Open by default only when the month has no invoices yet,
 * which is the one moment this is the reason the owner came to the screen.
 *
 * The month is a select rather than a date input: an owner bills this month or
 * chases last month, never March 2029, and Android's native month picker is
 * inconsistent enough that a three-item list is both faster and more predictable.
 */
import { useActionState } from 'react'

import { Alert, Button } from '@/components/ui'
import { digits } from '@/lib/bd/time'
import type { Locale, T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { generateInvoices, type FeeState } from './actions'

export function InvoiceGenerator({
  months,
  defaultMonth,
  openByDefault,
  locale,
  t,
  common,
}: {
  months: { value: string; label: string }[]
  defaultMonth: string
  openByDefault: boolean
  /** For the 28 day numbers, which a Bangla reader expects in Bangla numerals. */
  locale: Locale
  t: T<'invoices'>
  common: T<'common'>
}) {
  const [state, formAction, pending] = useActionState<FeeState, FormData>(
    generateInvoices,
    null,
  )

  return (
    <details
      open={openByDefault}
      className="rounded-2xl border border-line bg-white px-5 py-4"
    >
      <summary className="cursor-pointer list-none font-semibold text-brand-700">
        {t.open}
      </summary>

      <form action={formAction} className="mt-4 flex flex-col gap-3">
        {state?.error && <Alert>{state.error}</Alert>}
        {state?.ok && (
          <p role="status" className="font-medium text-brand-700">
            {state.ok}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="periodMonth" className="font-medium text-ink">
            {t.month}
          </label>
          <select
            id="periodMonth"
            name="periodMonth"
            defaultValue={defaultMonth}
            className="min-h-tap rounded-xl border-2 border-line bg-white px-4
              text-base outline-none focus:border-brand-500"
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="dueDay" className="font-medium text-ink">
            {t.dueDay}
          </label>
          <span className="text-sm text-ink-soft">{t.dueDayHint}</span>
          <select
            id="dueDay"
            name="dueDay"
            defaultValue="10"
            className="min-h-tap rounded-xl border-2 border-line bg-white px-4
              text-base outline-none focus:border-brand-500"
          >
            {/* Capped at 28 so the same choice means the same thing in February.
                The action refuses anything outside this range rather than
                quietly moving it. */}
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {fill(t.dayOption, { d: digits(d, locale) })}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" disabled={pending} full>
          {pending ? common.creating : t.submit}
        </Button>

        <p className="text-sm text-ink-faint">{t.safeToRepeat}</p>
      </form>
    </details>
  )
}
