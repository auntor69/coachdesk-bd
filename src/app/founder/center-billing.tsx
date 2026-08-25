'use client'

/**
 * The two things the founder does to a customer: record what they paid, and set what
 * they are on.
 *
 * BEHIND A DISCLOSURE because the customer list is a list. Every card on /founder is
 * something the founder reads — the bill, the usage, whether the centre has gone quiet
 * — and exactly one card at a time is something they are acting on. Eleven cards with
 * two open forms each is a screen nobody can scan, and scanning is what that page is
 * for.
 *
 * ONE DISCLOSURE, TWO FORMS, and that is not a detail. They are separate `<form>`
 * elements posting to separate Server Actions, so the plan `<select>` cannot ride along
 * on a payment: a founder taking ৳1,999 from a Pro teacher while the dropdown happens
 * to read "Centre" would otherwise have trebled that customer's bill without touching
 * it. See the note at the top of ./actions.ts.
 *
 * EVERY DYNAMIC SENTENCE IS COMPOSED ON THE SERVER. `words` is strings only — no
 * functions, so the whole group crosses the boundary as-is — and anything with a taka
 * figure or a month in it comes back inside the action's own `ok`/`warn`. That is why
 * this file has no `fill`, no `formatTaka` and no dictionary import: there is nothing
 * here to interpolate.
 */

import { useActionState, useEffect, useRef } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import { MAX_LABEL, MAX_TEXT } from '@/lib/limits'
import type { CenterStatus, PaymentMethod } from '@/lib/supabase/types'
import type { PlanId } from '@/lib/plans'
import { recordCenterPayment, setCenterPlan, type FounderState } from './actions'

/**
 * Labels for both forms.
 *
 * String leaves only, deliberately: the dictionary's `founder` group carries functions
 * — `quiet`, `signedUp`, the two confirmation builders — and a group with a function in
 * it cannot be handed to a client component at all. Keeping the money labels in a
 * function-free sub-group means the page passes `t.money` whole instead of picking
 * twenty fields by hand, and a label added to the dictionary appears here for free.
 */
export type BillingWords = {
  open: string
  payTitle: string
  amount: string
  amountHint: string
  method: string
  coversFrom: string
  months: string
  reference: string
  referenceHint: string
  note: string
  pay: string
  paying: string
  planTitle: string
  plan: string
  state: string
  apply: string
  applying: string
  notActive: string
  forbidden: string
  noCenter: string
  badAmount: string
  badMethod: string
  badPeriod: string
  badMonths: string
  badPlan: string
  badStatus: string
  failed: string
}

/** A `<select>` option whose label was localised by the server that built it. */
export type Choice<V extends string | number> = { value: V; label: string }

export function CenterBilling({
  centerId,
  plan,
  status,
  suggestedAmount,
  periods,
  months,
  plans,
  statuses,
  words,
  methods,
}: {
  centerId: string
  /** The centre's current tier and state, so both `<select>`s open on the truth. */
  plan: PlanId
  status: CenterStatus
  /**
   * What this centre should be billed this month, prefilled — the same reasoning as
   * the fee board prefilling what a parent owes: paying the quoted figure is the
   * normal case, and typing a number that is already on screen is where mistakes
   * come from. Blank when the bill is zero, because a free tier has nothing to pay
   * and a prefilled ৳0 would be refused on submit.
   */
  suggestedAmount: number
  /** The months a payment may be recorded against, already formatted. */
  periods: Choice<string>[]
  /** 1 / 3 / 6 / 12, labelled in the reader's own numerals. */
  months: Choice<number>[]
  plans: Choice<PlanId>[]
  statuses: Choice<CenterStatus>[]
  words: BillingWords
  /**
   * The six wallet labels, borrowed from the fee board's dictionary group rather than
   * copied into this one. They name the same six things — cash and the three mobile
   * wallets a Bangladeshi is handed money in — and a screen that called bKash
   * something different from the fee board would be a translation bug nobody notices
   * for a year. One owner for the words, two readers.
   */
  methods: Record<PaymentMethod, string>
}) {
  const [payState, payAction, paying] = useActionState<FounderState, FormData>(
    recordCenterPayment,
    null,
  )
  const [planState, planAction, applying] = useActionState<FounderState, FormData>(
    setCenterPlan,
    null,
  )
  const payForm = useRef<HTMLFormElement>(null)

  /**
   * A DOM id that is unique across the whole list, and it has to be.
   *
   * `Field` and `Select` both fall back to the control's `name` when given no id, which
   * is fine on a screen with one form and wrong on this one: eleven cards each holding
   * an input named `amount` puts eleven `id="amount"` in the document, and
   * `<label for="amount">` resolves to whichever came first. Tapping the amount label
   * on the seventh centre would focus the first centre's field — a founder typing money
   * into the wrong customer's form, which is the one mistake this screen must not make
   * easy.
   */
  const fid = (name: string) => `${name}-${centerId}`

  // Clear the amount once it is recorded. `disabled={paying}` is what stops a double
  // tap mid-flight; this is what stops the tap that comes after the confirmation, on a
  // form still holding the figure that was just banked. There is no idempotency key on
  // a hand-recorded receipt and no way to delete one, so the same money entered twice
  // is a number the founder has to reconcile by hand.
  useEffect(() => {
    if (payState?.ok) payForm.current?.reset()
  }, [payState])

  return (
    <details className="mt-3 border-t border-line pt-2">
      <summary
        className="inline-flex min-h-tap cursor-pointer list-none items-center
          font-medium text-brand-700"
      >
        {words.open}
      </summary>

      <div className="mt-2 flex flex-col gap-4">
        {/* ------------------------------------------------------------------ */}
        {/* The receipt                                                        */}
        {/* ------------------------------------------------------------------ */}
        <form ref={payForm} action={payAction} className="flex flex-col gap-3">
          <input type="hidden" name="centerId" value={centerId} />
          <p className="font-semibold text-ink">{words.payTitle}</p>

          {payState?.error && <Alert>{payState.error}</Alert>}
          {payState?.ok && (
            <p role="status" className="font-medium text-brand-700">
              {payState.ok}
            </p>
          )}
          {payState?.warn && <Alert tone="warn">{payState.warn}</Alert>}

          <Field
            label={words.amount}
            hint={words.amountHint}
            id={fid('amount')}
            name="amount"
            // Not type="number": it refuses Bangla digits and strips a thousands
            // separator, and parseTaka reads both. inputMode still brings up the pad.
            type="text"
            inputMode="decimal"
            defaultValue={suggestedAmount > 0 ? String(suggestedAmount) : ''}
            required
            maxLength={12}
            className="num"
          />

          <Select
            label={words.method}
            id={fid('method')}
            name="method"
            defaultValue="bkash"
          >
            {(Object.keys(methods) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {methods[m]}
              </option>
            ))}
          </Select>

          {/* The window, as two controls rather than a start and an end date. A
              founder knows "August, for a year"; asking them for 2027-07-31 is asking
              them to do the arithmetic the server does in one tested line. */}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label={words.coversFrom}
              id={fid('coversFrom')}
              name="coversFrom"
              defaultValue={periods[Math.floor(periods.length / 2)]?.value}
            >
              {periods.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>

            <Select
              label={words.months}
              id={fid('months')}
              name="months"
              defaultValue={months[0]?.value}
            >
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>

          <Field
            label={words.reference}
            hint={words.referenceHint}
            id={fid('reference')}
            name="reference"
            placeholder="8N7A6B5C4D"
            maxLength={MAX_LABEL}
            className="num"
          />

          <Field
            label={words.note}
            id={fid('note')}
            name="note"
            maxLength={MAX_TEXT}
          />

          <Button type="submit" disabled={paying} full>
            {paying ? words.paying : words.pay}
          </Button>
        </form>

        {/* ------------------------------------------------------------------ */}
        {/* The tier                                                           */}
        {/* ------------------------------------------------------------------ */}
        <form
          action={planAction}
          className="flex flex-col gap-3 border-t border-line pt-4"
        >
          <input type="hidden" name="centerId" value={centerId} />
          <p className="font-semibold text-ink">{words.planTitle}</p>

          {planState?.error && <Alert>{planState.error}</Alert>}
          {planState?.ok && (
            <p role="status" className="font-medium text-brand-700">
              {planState.ok}
            </p>
          )}
          {planState?.warn && <Alert tone="warn">{planState.warn}</Alert>}

          <div className="grid grid-cols-2 gap-3">
            <Select label={words.plan} id={fid('plan')} name="plan" defaultValue={plan}>
              {plans.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>

            <Select
              label={words.state}
              id={fid('status')}
              name="status"
              defaultValue={status}
            >
              {statuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>

          <Button type="submit" variant="secondary" disabled={applying} full>
            {applying ? words.applying : words.apply}
          </Button>
        </form>
      </div>
    </details>
  )
}

/**
 * A native `<select>` wearing `Field`'s clothes.
 *
 * Local rather than added to components/ui.tsx, which is explicit about being the
 * primitives *every* screen shares: four dropdowns on one admin screen is not a
 * pattern yet. Native because it is the right control on a phone — Android and iOS
 * both give it a full-height picker that a custom listbox spends a week failing to
 * match — and `text-base` because iOS Safari zooms the page on any focused control
 * under 16px and the layout never comes back.
 */
function Select({
  label,
  id,
  name,
  defaultValue,
  children,
}: {
  label: string
  /** Unique across the page — see `fid` above. Falls back to the name. */
  id?: string
  name: string
  defaultValue?: string | number
  children: React.ReactNode
}) {
  const selectId = id ?? name
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="font-medium text-ink">
        {label}
      </label>
      <select
        id={selectId}
        name={name}
        defaultValue={defaultValue}
        className="min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base
          outline-none transition-colors focus:border-brand-500"
      >
        {children}
      </select>
    </div>
  )
}
