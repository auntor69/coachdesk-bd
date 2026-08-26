'use client'

/**
 * Writing down a fee the centre decided not to charge, at the foot of a board row.
 *
 * WHY IT EXISTS. `fee_invoices.discount_bdt` has been in the schema since the first
 * migration, the balances view computes `net_bdt` from it, this very board renders
 * "(৳২০০ ছাড়)" under a student's name, the CSV export has a column for it and
 * lib/fees/month-close.ts nets it out of the month's billed figure. Until
 * 20260811000030 nothing in the product could set it, so an owner who waived a fee —
 * which a coaching centre does constantly — had two places to put it and both were
 * wrong: bill the discounted figure, and `amount_bdt` stops being the fee; or record a
 * payment the family never made, which is permanent and stops the drawer reconciling.
 *
 * THE FIGURE IS PREFILLED WITH THE CURRENT WAIVER, which is the one place this form
 * disagrees with refund.tsx directly above it. A refund is money leaving and the two
 * plausible amounts differ, so its box is empty on purpose. A waiver is a number already
 * stored on the bill, and the owner opening this panel is either changing it or reading
 * it — an empty box would ask them to remember what it was.
 *
 * SO THE ONE SENTENCE THAT MATTERS IS "IT REPLACES". `discount.current` is shown only
 * when there is already a waiver, because the risk it answers only exists then: an owner
 * who believes they are adding ৳100 to an existing ৳200 and types 100 has just given the
 * family ৳100 less than they meant to. The prefill and that sentence are one decision.
 *
 * NO IDEMPOTENCY KEY, unlike the payment and refund forms beside it. Those INSERT, so a
 * replay writes a second row; this is a SET to an absolute figure, so the second arrival
 * of the same request stores the same number and the trigger's `is distinct from` does not
 * even re-stamp who granted it. Idempotent by shape, which is what `useOffline` replaying
 * a Server Action needs.
 *
 * THE CONFIRMATION STAYS ON SCREEN, like the refund panel's and unlike the cancel step's:
 * a discounted invoice is still on the board, so this component survives the revalidation
 * and can say what the bill is now worth.
 */
import { useActionState, useState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import { maxDiscount, netAfterDiscount } from '@/lib/fees/discount'
import { MAX_TEXT } from '@/lib/limits'
import type { T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { formatTaka as taka, parseTaka } from '@/lib/money'
import { discountInvoice, type FeeState } from './actions'

export function DiscountBill({
  invoiceId,
  billed,
  discount,
  voidedAt,
  t,
  common,
}: {
  invoiceId: string
  /**
   * `amount_bdt` from fee_invoice_balances through `Number()` — the fee the centre
   * charges, before any waiver. Not `net_bdt`: the ceiling is the whole fee, and
   * measuring against the net figure would make each edit relative to the last one.
   */
  billed: number
  /** `discount_bdt`, likewise — what is waived today, which is what the box starts at. */
  discount: number
  /**
   * `voided_at`. A cancelled bill is off every total, so a waiver on it changes nothing
   * anybody can see; the panel says so rather than hiding the control.
   */
  voidedAt: string | null
  t: T<'discount'>
  common: T<'common'>
}) {
  const [state, formAction, pending] = useActionState<FeeState, FormData>(
    discountInvoice,
    null,
  )
  const [asking, setAsking] = useState(false)

  /**
   * What the owner has typed, so the "what will be left" line can follow the keystrokes.
   *
   * Controlled rather than read on submit, because the whole argument for this panel is
   * that the consequence of the figure is visible before it is stored. Starts at the
   * stored waiver, and `''` for no waiver rather than `'0'` — a box containing a zero
   * invites an owner to type after it and send 0500.
   */
  const [typed, setTyped] = useState(discount > 0 ? String(discount) : '')

  // The same parser the Server Action uses, so the preview and the stored figure cannot
  // disagree about what "১,৫০০" means. `null` while the box is empty or halfway through
  // a number, which previews the bill as it stands.
  const wanted = parseTaka(typed)
  const ceiling = maxDiscount(billed)
  const left = netAfterDiscount(billed, wanted ?? 0)

  if (!asking) {
    return (
      <div className="mt-4 border-t border-line pt-3">
        {/* Both an error and a confirmation survive a closed panel: the row stays on the
            board either way, so this component is still mounted. Keeping "৳২০০ ছাড় দেওয়া
            হলো" visible after the owner shuts the form is the point of it — they closed
            the box, they did not undo the waiver. */}
        {state?.error && <Alert>{state.error}</Alert>}
        {state?.ok && (
          <p role="status" className="font-medium text-brand-700">
            {state.ok}
          </p>
        )}
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="inline-flex min-h-tap items-center text-sm text-ink-faint underline"
        >
          {/* "ছাড় বদলান" once there is one. "ছাড় দিন" over an existing ৳২০০ would invite
              the owner to think tapping it adds a second waiver. */}
          {discount > 0 ? t.edit : t.open}
        </button>
      </div>
    )
  }

  // Told rather than prevented, for the reason cancel-bill.tsx gives: an owner who cannot
  // find a control assumes the app is broken, and one who is told why learns the rule at
  // the moment it matters. The trigger refuses this too, in the only place that counts.
  if (voidedAt) {
    return (
      <div className="mt-4 border-t border-line pt-3">
        <p className="font-medium text-ink">{t.voidedTitle}</p>
        <p className="mt-1 text-sm text-ink-soft">{t.voidedNote}</p>
        <div className="mt-2">
          <Button type="button" variant="ghost" onClick={() => setAsking(false)}>
            {t.keep}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="invoiceId" value={invoiceId} />

        <div>
          <p className="font-medium text-ink">{t.heading}</p>
          {/* The fee, which is the figure the ceiling is measured against. */}
          <p className="num mt-1 text-sm text-ink-soft">
            {fill(t.billed, { amount: taka(ceiling) })}
          </p>
          {/* Only when there is already a waiver — see the header. This is the sentence
              that stops an owner adding to a figure the form is about to replace. */}
          {discount > 0 && (
            <p className="num mt-0.5 text-sm text-ink-soft">
              {fill(t.current, { amount: taka(discount) })}
            </p>
          )}
        </div>

        <Field
          label={t.amount}
          id={`discount-amount-${invoiceId}`}
          name="amount"
          // Not type="number", for the reason the payment and refund fields give: it
          // strips a thousands separator and refuses Bangla digits, and parseTaka takes
          // both.
          type="text"
          inputMode="decimal"
          required
          maxLength={12}
          className="num"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />

        {/* The consequence, under the box, following the keystrokes. Drawn from the
            shared rule rather than computed here, so it never previews a negative figure
            while the owner is still typing past the ceiling. */}
        <p className="num text-sm text-ink-soft" aria-live="polite">
          {left <= 0 && (wanted ?? 0) > 0
            ? t.leavesNothing
            : fill(t.leaves, { amount: taka(left) })}
        </p>

        {/* Optional, and the label says so — but it is the field that matters most on
            this form, because a cancelled bill leaves the board and a discounted one
            stays on it, and "এই পরিবারের বিল কম কেন" is a question the owner will ask
            themselves months later. Capped at the column's own limit. */}
        <Field
          label={`${t.reason} (${common.optional})`}
          id={`discount-reason-${invoiceId}`}
          name="reason"
          placeholder={t.reasonHint}
          maxLength={MAX_TEXT}
        />

        {state?.error && <Alert>{state.error}</Alert>}
        {state?.ok && (
          <p role="status" className="font-medium text-brand-700">
            {state.ok}
          </p>
        )}
        {state?.warn && <Alert tone="warn">{state.warn}</Alert>}

        {/* Shut-it first and full width, the write second — the same order as the cancel
            and refund steps, so the habit "the wide button is the safe one" holds across
            all three. `primary` and not `danger`, unlike those two: waiving a fee is a
            decision an owner is proud of, it is reversible by retyping, and a red button
            would make them hesitate over it in front of the parent. */}
        <div className="flex flex-col gap-2">
          <Button type="button" variant="secondary" onClick={() => setAsking(false)} full>
            {t.keep}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t.saving : t.confirm}
          </Button>
        </div>
      </form>

      {/* Taking the waiver off is typing zero, and nobody types zero to undo something —
          so it is its own control. Its own form, and not a submit button inside the one
          above: a submitter carrying `name="amount"` would be a *second* `amount` entry
          after the field's, and `FormData.get` answers with the first. A form of its own
          sends exactly one figure, and the field above it — `required`, and possibly
          emptied by the owner — cannot block it either. Same action, so the same
          `useActionState` reports the result. */}
      {discount > 0 && (
        <form action={formAction} className="mt-2">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <input type="hidden" name="amount" value="0" />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-tap items-center text-sm text-ink-faint
              underline"
          >
            {pending ? t.clearing : t.clear}
          </button>
        </form>
      )}
    </div>
  )
}
