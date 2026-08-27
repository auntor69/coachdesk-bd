'use client'

/**
 * The column of amount boxes that loads a centre's opening arrears in one press.
 *
 * THE INPUTS ARE UNCONTROLLED, and that is the load-bearing decision in this file. A
 * centre can have three hundred students, so three hundred boxes; holding each one's
 * text in React state would re-render the whole column on every keystroke, and on the
 * ৳8,000 Android phone this product is built for that is a visible stutter on the one
 * screen an owner types into for twenty minutes. So the DOM keeps the text, one
 * delegated `onChange` on the form adds up what is there, and the list itself is
 * memoised on props that never change — the state that ticks lives only in the total.
 *
 * THE TOTAL IS THE SAFETY CHECK, which is why it is here at all. Nothing in the
 * arithmetic can catch ৳30,000 typed for ৳3,000, and the cap in the action is the
 * column's ceiling rather than a guess at a plausible fee — so the thing that catches
 * a fat-fingered amount is an owner reading a figure they can compare against the
 * bottom of their own register. It sits next to the submit button rather than in a
 * sticky bar: the shell already fixes a nav to the bottom of the screen, and a second
 * fixed strip fighting it for the same forty pixels is worse than a figure that is
 * exactly where the button is.
 *
 * ONE BOX PER STUDENT AND NO VISIBLE LABEL ON IT. The name is already the row, so a
 * label would print it twice; the box carries an `aria-label` instead, because a
 * screen reader arriving at the input on its own would otherwise hear "edit text" three
 * hundred times. It is a bare input rather than the shared `Field` for both of those
 * reasons, and because `Field` derives its id from `name` — fine for one form, wrong
 * for a repeated row.
 */
import { memo, useActionState, useState } from 'react'

import { Alert, Button, Card } from '@/components/ui'
import { digits } from '@/lib/bd/time'
import { ARREARS_FIELD_PREFIX, arrearsTyped } from '@/lib/fees/arrears'
import type { Locale, T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { formatTaka } from '@/lib/money'
import { recordArrears, type FeeState } from '../actions'

/** One row of the column: who the box belongs to, and what the paper calls them. */
export type ArrearsRow = {
  id: string
  name: string
  code: string | null
}

const INPUT_CLASS =
  'min-h-tap w-28 shrink-0 rounded-xl border-2 border-line bg-white px-3 ' +
  'text-right text-base outline-none transition-colors ' +
  'placeholder:text-ink-faint focus:border-brand-500'

const SELECT_CLASS =
  'min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base ' +
  'outline-none focus:border-brand-500'

export function ArrearsForm({
  rows,
  months,
  defaultMonth,
  locale,
  t,
  common,
}: {
  rows: ArrearsRow[]
  months: { value: string; label: string }[]
  defaultMonth: string
  locale: Locale
  t: T<'arrears'>
  common: T<'common'>
}) {
  const [state, formAction, pending] = useActionState<FeeState, FormData>(
    recordArrears,
    null,
  )

  const [tally, setTally] = useState({ filled: 0, total: 0 })

  /**
   * Re-adds every box on each keystroke, read straight out of the DOM.
   *
   * The arithmetic is `arrearsTyped`, which is the module the action's own plan comes
   * from — so the figure the owner checks before they press is arrived at by the same
   * reader and the same summation as the figure that gets written, including the
   * Bangla numerals a phone keyboard produces and the ৳ an owner types out of habit.
   */
  function recount(form: HTMLFormElement) {
    const raws: string[] = []
    for (const [key, value] of new FormData(form).entries()) {
      if (!key.startsWith(ARREARS_FIELD_PREFIX) || typeof value !== 'string') continue
      raws.push(value)
    }
    setTally(arrearsTyped(raws))
  }

  return (
    <form
      action={formAction}
      onChange={(e) => recount(e.currentTarget)}
      className="flex flex-col gap-4"
    >
      {state?.error && <Alert>{state.error}</Alert>}
      {state?.warn && <Alert tone="warn">{state.warn}</Alert>}
      {state?.ok && (
        <p role="status" className="font-medium text-brand-700">
          {state.ok}
        </p>
      )}

      <Card>
        <p className="text-sm text-ink-soft">{t.howTo}</p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="periodMonth" className="font-medium text-ink">
              {t.month}
            </label>
            <span className="text-sm text-ink-soft">{t.monthHint}</span>
            <select
              id="periodMonth"
              name="periodMonth"
              defaultValue={defaultMonth}
              className={SELECT_CLASS}
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
            {/* Capped at 28 so the same choice means the same thing in February,
                exactly as the invoice generator's is. */}
            <select id="dueDay" name="dueDay" defaultValue="10" className={SELECT_CLASS}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {fill(t.dayOption, { d: digits(d, locale) })}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex items-center gap-3 border-b border-line bg-surface-alt px-4 py-2">
          <span className="min-w-0 flex-1 text-sm font-medium text-ink-soft">
            {t.colStudent}
          </span>
          <span className="w-28 shrink-0 text-right text-sm font-medium text-ink-soft">
            {t.colAmount}
          </span>
        </div>
        <ArrearsRows rows={rows} amountFor={t.amountFor} />
      </div>

      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-ink-soft">
            {fill(t.filledCount, { n: digits(tally.filled, locale) })}
          </span>
          <span className="text-right">
            <span className="block text-sm text-ink-soft">{t.total}</span>
            <span className="block text-xl font-semibold text-ink">
              {formatTaka(tally.total)}
            </span>
          </span>
        </div>

        <div className="mt-4">
          <Button type="submit" disabled={pending} full>
            {pending ? common.creating : t.submit}
          </Button>
        </div>

        <p className="mt-3 text-sm text-ink-faint">{t.safeToRepeat}</p>
      </Card>
    </form>
  )
}

/**
 * The column itself, memoised away from the total that ticks above it.
 *
 * Both props are stable for the life of the screen — the rows come from the server and
 * the label template is a string — so this bails out of every re-render the running
 * total causes, and the three hundred inputs are never touched again after mount.
 */
const ArrearsRows = memo(function ArrearsRows({
  rows,
  amountFor,
}: {
  rows: ArrearsRow[]
  amountFor: string
}) {
  return (
    <ul>
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex items-center gap-3 border-t border-line px-4 py-2
            first:border-t-0"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink">{row.name}</span>
            {row.code && (
              <span className="block truncate text-xs text-ink-faint">{row.code}</span>
            )}
          </span>
          {/* An explicit id per row because the name repeats, and text rather than
              number so a Bangla keypad's ৩০০০ and a typed ৳ both survive to the
              action's reader instead of being swallowed by the browser. */}
          <input
            id={`${ARREARS_FIELD_PREFIX}${row.id}`}
            name={`${ARREARS_FIELD_PREFIX}${row.id}`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={fill(amountFor, { name: row.name })}
            className={INPUT_CLASS}
          />
        </li>
      ))}
    </ul>
  )
})
