'use client'

/**
 * Handing money back out, at the foot of a board row.
 *
 * WHY IT EXISTS. lib/fees/void.ts refuses to cancel a bill that has money on it and
 * sends the owner here: hand the money back, then cancel. Until now there was nowhere
 * to go — `fee_payments` has allowed a negative row since the first migration and every
 * total in the product nets rather than counts, so the schema was ready and the screen
 * was not. That left the owner of a student who paid ৳500 and then left with a bill they
 * could neither collect nor cancel.
 *
 * A REFUND IS A ROW, NOT AN EDIT. Nothing deletes a payment and nothing rewrites one
 * (20260811000017 revokes both), so this writes a second entry with a negative amount
 * and its own receipt number. The register still adds up to the cash in the drawer, and
 * a parent holding the first slip can be handed the second.
 *
 * NOTHING IS PREFILLED, unlike the payment form directly above it, which fills in what
 * is owed because paying in full is the normal case. Here the two plausible figures —
 * everything the bill took, or just the part that was overpaid — differ, and they are
 * both written out above the box. Guessing one of them into the field would be guessing
 * which conversation is happening at the desk, and this is the one write in the product
 * that cannot be taken back.
 *
 * THE CONFIRMATION STAYS ON SCREEN, unlike cancel-bill.tsx's, whose row leaves the
 * board. A refunded invoice is still an invoice and still on the list, so this component
 * survives the revalidation and shows what happened, what is now owed, and a link to the
 * slip. The amount field is cleared and the idempotency token re-minted, so the panel
 * being still open is not an invitation to hand the same money over twice.
 */
import { useActionState, useEffect, useRef, useState } from 'react'


import { MethodPicker, type MethodLabels } from '@/components/method-picker'
import { PaperLink } from '@/components/paper-link'
import { Alert, Button, Field } from '@/components/ui'
import { refundable } from '@/lib/fees/refund'
import { mintIdempotencyKey } from '@/lib/idempotency'
import { MAX_TEXT } from '@/lib/limits'
import type { T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { formatTaka as taka } from '@/lib/money'
import type { PaymentMethod } from '@/lib/supabase/types'
import { refundPayment, type FeeState } from './actions'

export function RefundBill({
  invoiceId,
  paid,
  remaining,
  t,
  methods,
  common,
}: {
  invoiceId: string
  /**
   * `paid_bdt` from fee_invoice_balances through `Number()` — the netted total, so a
   * bill already partly refunded offers only what is left. This is the ceiling.
   */
  paid: number
  /**
   * `remaining_bdt`, likewise netted. Negative means the family is in credit, which is
   * the second of the two figures shown above the box.
   */
  remaining: number
  t: T<'refund'>
  /** Shared with the payment form above, so the six labels are one list. */
  methods: MethodLabels
  common: T<'common'>
}) {
  const [state, formAction, pending] = useActionState<FeeState, FormData>(
    refundPayment,
    null,
  )
  const [asking, setAsking] = useState(false)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const formRef = useRef<HTMLFormElement>(null)

  /**
   * The token that makes this submit arrive once however many times it is delivered.
   * Same mechanism and the same effect order as the payment form — see payment-row.tsx
   * for why it cannot come out of render — and here for a heavier reason: a refund that
   * lands twice is cash out of the drawer twice, and neither row can be deleted by
   * anybody afterwards.
   */
  const keyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Clear the typed figure once the money is on the record, then re-mint: `reset()`
    // puts every control back to its default and this input has no default, so minting
    // first would hand the next refund an empty token. Not after an error — nothing was
    // written, so keeping the token means retyping the same amount is still
    // deduplicated.
    if (state?.ok) formRef.current?.reset()

    const input = keyRef.current
    if (input && (state?.ok || !input.value)) input.value = mintIdempotencyKey()
  }, [state])

  // The shared rule's own answer, so the sentence above the box and the refusal the
  // server would give cannot disagree. Never negative and never NaN — it is rendered.
  const ceiling = refundable(paid)
  const credit = remaining < 0 ? -remaining : 0

  if (!asking) {
    return (
      <div className="mt-4 border-t border-line pt-3">
        {/* An error, and a confirmation, both survive a closed panel: the row is still
            on the board either way, so this component is still mounted. Keeping the
            "৳500 handed back" line visible after the owner shuts the form is the whole
            point of it — they closed the box, they did not undo the refund. */}
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
          {t.open}
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <form ref={formRef} action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        {/* No value in the markup, on purpose: written after mount by the effect
            above, because a uuid minted during render would differ between the
            server and the browser. */}
        <input type="hidden" name="idempotencyKey" ref={keyRef} />

        <div>
          <p className="font-medium text-ink">{t.heading}</p>
          {/* Both figures, because they are the two amounts an owner might mean and
              typing the wrong one cannot be undone. The first is the ceiling; the
              second appears only when a parent actually overpaid, since "৳0 বেশি জমা
              আছে" on a normal bill is a line that has to be read and dismissed. */}
          <p className="num mt-1 text-sm text-ink-soft">
            {fill(t.held, { amount: taka(ceiling) })}
          </p>
          {credit > 0 && (
            <p className="num mt-0.5 text-sm text-ink-soft">
              {fill(t.credit, { amount: taka(credit) })}
            </p>
          )}
          <p className="mt-1 text-sm text-ink-soft">{t.warning}</p>
        </div>

        <Field
          label={t.amount}
          id={`refund-amount-${invoiceId}`}
          name="amount"
          // Not type="number", for the reason the payment field gives: it strips a
          // thousands separator and refuses Bangla digits, and parseTaka handles both.
          type="text"
          inputMode="decimal"
          required
          maxLength={12}
          className="num"
        />

        <MethodPicker
          id={`refund-method-${invoiceId}`}
          legend={t.method}
          labels={methods}
          value={method}
          onChange={setMethod}
        />

        {/* Optional, and the label says so. Nobody chasing a parent out of the door
            with cash will fill it in, but "কেন এই টাকা ফেরত গেল" is a real question
            three weeks later and this is the only place the answer can come from. */}
        <Field
          label={`${t.note} (${common.optional})`}
          id={`refund-note-${invoiceId}`}
          name="note"
          placeholder={t.noteHint}
          maxLength={MAX_TEXT}
        />

        {state?.error && <Alert>{state.error}</Alert>}
        {state?.ok && (
          <p role="status" className="font-medium text-brand-700">
            {state.ok}
          </p>
        )}
        {state?.warn && <Alert tone="warn">{state.warn}</Alert>}
        {/* The slip for the money that went out, offered the moment it exists. A
            parent who was handed cash back has nothing in writing until this is
            printed, and the number beside it is what the owner reads out first. */}
        {state?.receipt && (
          <div className="flex items-center gap-2">
            <PaperLink
              href={`/fees/receipt/${state.receipt.id}`}
              label={`${t.receiptLink} ${state.receipt.no}`}
            >
              {t.receiptLink}
            </PaperLink>
            <span className="num text-ink-soft">#{state.receipt.no}</span>
          </div>
        )}

        {/* Shut-it first and full width, the write second and narrow — the same way
            round as the cancel step, and for the same reason: the habit this screen
            builds is "the wide button at the bottom is the one you press", and the
            one irreversible form on the board is the worst place to reward it. */}
        <div className="flex flex-col gap-2">
          <Button type="button" variant="secondary" onClick={() => setAsking(false)} full>
            {t.keep}
          </Button>
          <Button type="submit" variant="danger" disabled={pending}>
            {pending ? t.refunding : t.confirm}
          </Button>
        </div>
      </form>
    </div>
  )
}
