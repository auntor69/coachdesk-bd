'use client'

/**
 * One amount, a column of ticks, and one press that raises a bill each.
 *
 * WHY EVERY BOX STARTS TICKED. This form's job is "the whole batch sat the exam", which
 * is the shape of nearly every one-off fee a coaching centre charges. Starting empty
 * would mean forty taps before the first useful press; starting full means the owner
 * unticks the two who did not sit it. The clear button is there for the other case.
 *
 * THE TICKS ARE READ OUT OF THE DOM, not held in state, for the reason arrears-form.tsx
 * gives at length: three hundred rows re-rendering on every tap is a visible stutter on
 * the phone this product is built for. One delegated `onChange` on the form re-adds
 * what is ticked, the list is memoised on props that never change, and the only state
 * that ticks is the count and the total beside the button.
 *
 * THE TOTAL IS THE SAFETY CHECK. Nothing here can tell ৳300 meant for ৳3,000 apart, so
 * the figure an owner reads before pressing is `ticked × amount` — the number they can
 * compare against what they expected to raise.
 */
import { memo, useActionState, useEffect, useRef, useState } from 'react'

import { Alert, Button, Card } from '@/components/ui'
import { digits, formatDate } from '@/lib/bd/time'
import { CHARGE_CATEGORIES, type ChargeStudent } from '@/lib/fees/charge'
import {
  MAX_INSTALMENTS,
  MIN_INSTALMENTS,
  instalmentPlan,
  type Instalment,
} from '@/lib/fees/instalments'
import { mintIdempotencyKey } from '@/lib/idempotency'
import type { Locale, T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { formatTaka, parseTaka, sumTaka } from '@/lib/money'
import { oneOffCharge, type FeeState } from '../actions'

const INPUT_CLASS =
  'min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base ' +
  'outline-none transition-colors placeholder:text-ink-faint focus:border-brand-500'

const SELECT_CLASS =
  'min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base ' +
  'outline-none focus:border-brand-500'

export function ChargeForm({
  students,
  months,
  defaultMonth,
  categories,
  locale,
  t,
  common,
}: {
  students: ChargeStudent[]
  months: { value: string; label: string }[]
  defaultMonth: string
  /**
   * The category labels, passed as a plain record rather than reached through `T<'fees'>`.
   *
   * That group holds counted sentences, and `T` maps every function leaf to `never` so a
   * client component cannot be handed one — see lib/i18n/index.ts. The labels beside them
   * are strings and travel fine on their own.
   */
  categories: Record<string, string>
  locale: Locale
  t: T<'charge'>
  common: T<'common'>
}) {
  const [state, formAction, pending] = useActionState<FeeState, FormData>(
    oneOffCharge,
    null,
  )

  const [tally, setTally] = useState({
    ticked: students.length,
    total: 0,
    each: 0,
    parts: 1,
    plan: [] as Instalment[],
  })

  const form = useRef<HTMLFormElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)

  // Mint on mount, and again after each success — the house pattern from payment-row.tsx.
  // The reset is what makes the re-mint necessary: the same key against a cleared form
  // would be refused by the index rather than raising the next charge.
  useEffect(() => {
    if (state?.ok) form.current?.reset()
    const input = keyRef.current
    if (input && (state?.ok || !input.value)) input.value = mintIdempotencyKey()
    if (form.current) recount(form.current)
  }, [state])

  /**
   * Re-adds the ticks and multiplies, straight out of the DOM.
   *
   * `parseTaka` is the action's own reader, so the figure the owner checks is arrived at
   * from their keystrokes the same way the billed figure is — including a Bangla keypad's
   * ৩০০ and a typed ৳. `sumTaka` rather than `ticked * amount` for the same reason: it is
   * what the action totals with, and it is where the ceiling lives.
   *
   * THE TOTAL DOES NOT DIVIDE BY THE PARTS, and that is the point of the control: the box
   * holds the whole fee, so `ticked × amount` is what the centre is owed whether it arrives
   * in one payment or twelve. The schedule underneath is where the parts are shown.
   */
  function recount(el: HTMLFormElement) {
    const data = new FormData(el)
    const ticked = data.getAll('studentId').length
    const read = parseTaka(String(data.get('amount') ?? ''))
    const each = read === null || read <= 0 ? 0 : read
    const parts = Number(data.get('instalments') ?? 1) || 1

    setTally({
      ticked,
      each,
      parts,
      total: each === 0 ? 0 : sumTaka(Array(ticked).fill(each)),
      // The action's own arithmetic, imported rather than reimplemented, so what is on
      // screen before the press is what Postgres is asked for after it.
      plan:
        parts > 1
          ? instalmentPlan({
              total: each,
              count: parts,
              firstMonth: String(data.get('periodMonth') ?? ''),
              dueDay: Number(data.get('dueDay') ?? 10),
            })
          : [],
    })
  }

  /** Tick or clear every box, then re-add: setting `.checked` fires no change event. */
  function setAll(checked: boolean) {
    const el = form.current
    if (!el) return
    for (const box of el.querySelectorAll<HTMLInputElement>('input[name="studentId"]')) {
      box.checked = checked
    }
    recount(el)
  }

  return (
    <form
      ref={form}
      action={formAction}
      onChange={(e) => recount(e.currentTarget)}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="idempotencyKey" ref={keyRef} />

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
            <label htmlFor="category" className="font-medium text-ink">
              {t.category}
            </label>
            {/* Built from the module's list, not from the enum: `tuition` is absent
                there on purpose, and the action refuses it if a browser sends it. */}
            <select id="category" name="category" className={SELECT_CLASS}>
              {CHARGE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categories[c]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="amount" className="font-medium text-ink">
              {t.amount}
            </label>
            <span className="text-sm text-ink-soft">{t.amountHint}</span>
            {/* Text, not number, so a Bangla keypad's ৩০০ and a typed ৳ reach the
                action's reader instead of being swallowed by the browser. */}
            <input
              id="amount"
              name="amount"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="periodMonth" className="font-medium text-ink">
              {t.month}
            </label>
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
            {/* 28, so the same choice means the same thing in February. */}
            <select id="dueDay" name="dueDay" defaultValue="10" className={SELECT_CLASS}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {fill(t.dayOption, { d: digits(d, locale) })}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="instalments" className="font-medium text-ink">
              {t.instalments}
            </label>
            <span className="text-sm text-ink-soft">{t.instalmentsHint}</span>
            {/* Below the month and the deadline because it reads from both: part one is
                billed in that month on that day, and the rest follow it monthly. */}
            <select
              id="instalments"
              name="instalments"
              defaultValue="1"
              className={SELECT_CLASS}
            >
              <option value="1">{t.payInFull}</option>
              {Array.from(
                { length: MAX_INSTALMENTS - MIN_INSTALMENTS + 1 },
                (_, i) => i + MIN_INSTALMENTS,
              ).map((n) => (
                <option key={n} value={n}>
                  {fill(t.partsOption, { n: digits(n, locale) })}
                </option>
              ))}
            </select>
          </div>

          {/*
           * The agreement, before it is agreed to. An owner splitting ৳6,000 three ways is
           * committing the family to three dates, and the only place they can check those
           * dates is here — once the bills are raised, changing them means cancelling one
           * and charging again.
           *
           * Hidden until there is an amount to divide, because a schedule of ৳0 answers
           * nothing. Shown as "too small" rather than blank when the fee will not divide
           * that many ways, which is the same refusal the action would give.
           */}
          {tally.parts > 1 && tally.each > 0 && (
            <div className="rounded-xl border border-line bg-surface-alt px-4 py-3">
              {tally.plan.length === 0 ? (
                <p className="text-sm text-ink-soft">{t.scheduleTooSmall}</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-ink-soft">{t.scheduleTitle}</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {tally.plan.map((part) => (
                      <li
                        key={part.no}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <span className="text-ink-soft">
                          {fill(t.partOf, {
                            n: digits(part.no, locale),
                            of: digits(part.of, locale),
                          })}
                        </span>
                        <span className="font-medium text-ink">
                          {formatTaka(part.amountBdt)} · {formatDate(part.dueDate, locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-ink-faint">{t.scheduleNote}</p>
                </>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="note" className="font-medium text-ink">
              {t.note}
            </label>
            <span className="text-sm text-ink-soft">{t.noteHint}</span>
            <input
              id="note"
              name="note"
              type="text"
              autoComplete="off"
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </Card>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex items-center gap-3 border-b border-line bg-surface-alt px-4 py-2">
          <span className="min-w-0 flex-1 text-sm font-medium text-ink-soft">
            {t.colStudent}
          </span>
          {/* type="button" on both: inside a form, a bare button submits. */}
          <button
            type="button"
            onClick={() => setAll(true)}
            className="min-h-tap px-2 text-sm font-medium text-brand-700"
          >
            {t.tickAll}
          </button>
          <button
            type="button"
            onClick={() => setAll(false)}
            className="min-h-tap px-2 text-sm font-medium text-brand-700"
          >
            {t.tickNone}
          </button>
        </div>
        <ChargeRows students={students} />
      </div>

      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-ink-soft">
            {fill(t.tickedCount, { n: digits(tally.ticked, locale) })}
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
 * The column, memoised away from the total that ticks above it.
 *
 * Every prop is stable — the roster comes from the server — so this bails out of every
 * re-render a keystroke in the amount box causes. No `aria-label`: the name is the
 * checkbox's own label, which is what the wrapping `<label>` says.
 */
const ChargeRows = memo(function ChargeRows({
  students,
}: {
  students: ChargeStudent[]
}) {
  return (
    <ul>
      {students.map((student) => (
        <li key={student.id} className="border-t border-line first:border-t-0">
          <label className="flex min-h-tap cursor-pointer items-center gap-3 px-4 py-2">
            <input
              type="checkbox"
              name="studentId"
              value={student.id}
              defaultChecked
              className="h-5 w-5 shrink-0 accent-brand-600"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{student.name}</span>
              {student.code && (
                <span className="block truncate text-xs text-ink-faint">
                  {student.code}
                </span>
              )}
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
})
