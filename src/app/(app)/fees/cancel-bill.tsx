'use client'

/**
 * The two controls that make a mistaken bill undoable: the cancel step at the foot of
 * a board row, and the row a cancelled bill becomes underneath the board.
 *
 * WHY THEY ARE HERE AT ALL. `fee_invoices.voided_at` has been in the schema since the
 * first migration and every read path in the product honours it, but until
 * 20260811000028 nothing could set it. So a student who left in June and whose
 * enrolment nobody closed went on owing ৳2,000 in the headline figure on the board the
 * product is sold on, in the arrears the month-close screen opens July with, and on the
 * worklist telling the owner to message their parent. See lib/fees/void.ts for the one
 * rule cancelling has, and the migration for why it is a cancellation and not a delete.
 *
 * THE CONFIRMATION IS THE ROW MOVING, NOT A MESSAGE. Both board queries filter
 * `voided_at is null`, so a cancelled invoice leaves the list the moment the
 * revalidation lands and this component unmounts with its `useActionState` inside it —
 * there is no place for a "done" line to live. That is why the cancelled section below
 * the board is rendered open rather than tucked away: the owner watches a name leave one
 * list and appear, struck through, in the other, which says more than a sentence would.
 * An error is different — it means nothing moved — so a failure keeps the panel and
 * shows why.
 */
import { useActionState, useState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import { formatMonth } from '@/lib/bd/time'
import { MAX_TEXT } from '@/lib/limits'
import { cancelVerdict, type CancelledBill } from '@/lib/fees/void'
import type { Locale, T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { formatTaka as taka } from '@/lib/money'
import { voidInvoice, restoreInvoice, type FeeState } from './actions'

/**
 * The cancel step under one board row.
 *
 * Shut by default and opened by a plain underlined word, not a button. It shares a
 * panel with "জমা নিন", which an owner taps fifty times on a collection day, and the
 * two must not be mistakable for each other at arm's length on a phone — so this one
 * has no fill, no border, and sits at the very bottom with a rule above it.
 *
 * `paid` is the netted figure the view computed: a payment handed back in full leaves
 * nothing on the bill and such a bill is as cancellable as one nobody ever paid. The
 * verdict comes from the shared rule so the button, the Server Action and the database
 * trigger cannot answer differently.
 */
export function CancelBill({
  invoiceId,
  paid,
  t,
  common,
}: {
  invoiceId: string
  /** `paid_bdt` from fee_invoice_balances, already through `Number()`. */
  paid: number
  t: T<'cancel'>
  common: T<'common'>
}) {
  const [state, formAction, pending] = useActionState<FeeState, FormData>(
    voidInvoice,
    null,
  )
  const [asking, setAsking] = useState(false)

  // Answered before the round trip so an owner is told the rule while they are still
  // looking at the figure it is about. The server asks again — a Server Action is a
  // public HTTP endpoint — and so does the trigger, which is the one that cannot be
  // talked out of it.
  const blocked = cancelVerdict({ paid, voidedAt: null }) === 'paid'

  if (!asking) {
    return (
      <div className="mt-4 border-t border-line pt-3">
        {/* An error survives here because nothing moved: the row is still on the
            board, so this component is still mounted to show it. */}
        {state?.error && <Alert>{state.error}</Alert>}
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="inline-flex min-h-tap items-center text-sm text-ink-faint
            underline"
        >
          {t.open}
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      {blocked ? (
        <>
          <p className="font-medium text-ink">{t.paidTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.paidNote}</p>
          <div className="mt-2">
            <Button type="button" variant="ghost" onClick={() => setAsking(false)}>
              {t.keep}
            </Button>
          </div>
        </>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="invoiceId" value={invoiceId} />

          <div>
            <p className="font-medium text-ink">{t.heading}</p>
            <p className="mt-1 text-sm text-ink-soft">{t.warning}</p>
          </div>

          {/* Optional, and the label says so, because a bill raised against a child
              who left is self-evident to the person cancelling it — a required box
              here would be answered with a full stop. Capped at the column's own
              limit rather than truncated after the fact. */}
          <Field
            label={`${t.reason} (${common.optional})`}
            id={`void-reason-${invoiceId}`}
            name="reason"
            placeholder={t.reasonHint}
            maxLength={MAX_TEXT}
          />

          {state?.error && <Alert>{state.error}</Alert>}

          {/* Keep-it first and full width, cancel second and narrow. The habit this
              screen builds is "the wide button at the bottom is the one you press",
              and a confirm step is the worst place to break it — so the wide one here
              is the one that changes nothing. */}
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAsking(false)}
              full
            >
              {t.keep}
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? t.cancelling : t.confirm}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

/**
 * One cancelled bill, under the board, with the way back.
 *
 * Struck through rather than greyed out. Grey on this screen already means "settled",
 * which is the opposite of what happened here — a settled bill was paid and a cancelled
 * one never will be — and a strike-through is the mark an owner has been drawing through
 * a line in a paper khata for years.
 *
 * The restore is the only reason this list exists rather than the rows simply
 * disappearing. A cancelled invoice keeps its unique (enrollment_id, period_month), so
 * re-running the generator will not raise a replacement: that is right for a student who
 * left and a trap for somebody who tapped the wrong row, and this button is the whole of
 * the way out.
 */
export function CancelledRow({
  bill,
  locale,
  t,
}: {
  bill: CancelledBill
  /** For `formatMonth`, which writes the month in the reader's own numerals. */
  locale: Locale
  t: T<'cancel'>
}) {
  const [state, formAction, pending] = useActionState<FeeState, FormData>(
    restoreInvoice,
    null,
  )

  return (
    <li className="rounded-xl border border-line bg-white px-4 py-3">
      <p className="truncate font-medium text-ink-soft line-through">
        {bill.name}
        {bill.studentCode && (
          <span className="num ml-2 text-sm text-ink-faint">{bill.studentCode}</span>
        )}
      </p>

      <p className="text-sm text-ink-faint">
        {bill.periodMonth && fill(t.forMonth, { month: formatMonth(bill.periodMonth, locale) })}
      </p>

      {/* Not struck through, and not in the row's own colour. This is the figure the
          owner is checking — how much came off the total — and it is the one thing on
          the row that is a live fact rather than a record of a cancelled one. */}
      <p className="num mt-0.5 text-sm text-ink-soft">
        {fill(t.amount, { amount: taka(bill.net) })}
      </p>

      {/* Only when they left one. A blank line under a name reads as a rendering
          fault rather than as "they wrote nothing". */}
      {bill.reason && (
        <p className="mt-1 text-sm text-ink-soft">
          <span className="text-ink-faint">{t.reasonLabel}:</span> {bill.reason}
        </p>
      )}

      {state?.error && (
        <div className="mt-2">
          <Alert>{state.error}</Alert>
        </div>
      )}

      {/* Low-emphasis in the other direction from the cancel control: restoring puts
          a debt back on a family's ledger, so it is deliberate but not alarming —
          nothing is lost either way, because the bill can be cancelled again. */}
      <form action={formAction} className="mt-2">
        <input type="hidden" name="invoiceId" value={bill.id} />
        <Button type="submit" variant="ghost" disabled={pending}>
          {pending ? t.restoring : t.restore}
        </Button>
      </form>
    </li>
  )
}
