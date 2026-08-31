'use client'

/**
 * Purchases a centre has started and not yet paid for, and the founder's Confirm.
 *
 * ON THE CARD, NOT BEHIND THE DISCLOSURE, for `AskedToUpgrade`'s reason: this is a
 * customer waiting on us rather than something the founder does to a customer they have
 * already decided about. Somebody has been told where to send money; until this block is
 * empty, the transfer in the founder's own bKash app has nothing recorded against it.
 *
 * ONE FORM PER PURCHASE, in an inner component, because each needs its own pending flag
 * and its own message. Two intents under one `useActionState` would put "confirmed" under
 * whichever row was rendered first.
 *
 * A LAPSED QUOTE GETS NO CONFIRM BUTTON. `settle_payment_intent` refuses an expired
 * intent, so a Confirm there would be a button that always fails; what the founder does
 * instead is cancel it and quote again at today's price.
 *
 * Every dynamic sentence arrives pre-composed — `words` is string leaves only, and the
 * taka figure that comes back after a confirmation is built inside the action.
 */

import { useActionState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import { MAX_LABEL, MAX_TEXT } from '@/lib/limits'
import type { PaymentMethod } from '@/lib/supabase/types'
import {
  cancelCenterPurchase,
  confirmCenterPurchase,
  type FounderState,
} from './actions'
import { Select } from './center-billing'

/** String leaves only — this group is handed to a client component. */
export type PurchaseWords = {
  title: string
  hint: string
  fresh: string
  waiting: string
  lapsed: string
  lapsedHint: string
  reference: string
  referenceHint: string
  method: string
  note: string
  confirm: string
  confirming: string
  cancel: string
  cancelling: string
  already: string
  cancelled: string
  noIntent: string
  noReference: string
  expiredQuote: string
  closed: string
  refused: string
  failed: string
}

/** One open intent, with every sentence in it composed by the page. */
export type OpenPurchase = {
  id: string
  /** "180 student places — ৳3,240". */
  line: string
  /** "Quoted 31 August · good until 7 September · CD-1A2B3C4D". */
  meta: string
  /** Whether the customer has been given the instructions yet (`initiated`). */
  told: boolean
  /** The quote's clock has run out. Nothing sweeps for these; see the migration. */
  lapsed: boolean
}

export function CenterPurchases({
  centerId,
  items,
  words,
  methods,
}: {
  centerId: string
  items: OpenPurchase[]
  words: PurchaseWords
  /** The fee board's own wallet names, as `CenterBilling` uses them. */
  methods: Record<PaymentMethod, string>
}) {
  return (
    <div className="mt-2 rounded-xl border-2 border-late/40 bg-late/5 p-3">
      <p className="font-semibold text-ink">{words.title}</p>
      <p className="mt-0.5 text-sm text-ink-soft">{words.hint}</p>

      <ul className="mt-2 flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="border-t border-late/30 pt-2 first:border-0 first:pt-0"
          >
            <Purchase centerId={centerId} item={item} words={words} methods={methods} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function Purchase({
  centerId,
  item,
  words,
  methods,
}: {
  centerId: string
  item: OpenPurchase
  words: PurchaseWords
  methods: Record<PaymentMethod, string>
}) {
  const [state, confirm, confirming] = useActionState<FounderState, FormData>(
    confirmCenterPurchase,
    null,
  )
  const [dropped, cancel, cancelling] = useActionState<FounderState, FormData>(
    cancelCenterPurchase,
    null,
  )

  // Unique across the page, not just across this form: eleven cards holding an input
  // named `providerRef` would otherwise share one `id` and one `<label for>`. See `fid`
  // in ./center-billing.tsx.
  const fid = (name: string) => `${name}-${item.id}`

  // Cancel is a second form, and it has to be a sibling rather than a nested one: two
  // `<form>`s inside each other is invalid HTML and the browser drops the inner one. The
  // button lives beside Confirm and reaches this form by id, so a stray Enter in the
  // TrxID field cannot close the quote instead of settling it.
  const cancelForm = `cancel-${item.id}`

  const cancelButton = (
    <Button
      type="submit"
      form={cancelForm}
      variant="secondary"
      disabled={cancelling || confirming}
    >
      {cancelling ? words.cancelling : words.cancel}
    </Button>
  )

  return (
    <>
      <p className="font-semibold text-ink">{item.line}</p>

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span
          className="rounded-lg border border-late/40 bg-white px-2 py-0.5 text-xs
            font-medium text-late"
        >
          {item.told ? words.waiting : words.fresh}
        </span>
        {item.lapsed && (
          <span
            className="rounded-lg border border-red-600 bg-red-600 px-2 py-0.5 text-xs
              font-semibold text-white"
          >
            {words.lapsed}
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-ink-faint">{item.meta}</p>

      {state?.error && (
        <div className="mt-2">
          <Alert>{state.error}</Alert>
        </div>
      )}
      {/* Shown until the re-render lands, so a tap on a slow connection is never
          silent. `revalidatePath` removes the whole row once it arrives. */}
      {state?.ok && (
        <p role="status" className="mt-1 text-sm font-medium text-brand-700">
          {state.ok}
        </p>
      )}
      {dropped?.error && (
        <div className="mt-2">
          <Alert>{dropped.error}</Alert>
        </div>
      )}
      {dropped?.ok && (
        <p role="status" className="mt-1 text-sm font-medium text-ink-soft">
          {dropped.ok}
        </p>
      )}

      <form id={cancelForm} action={cancel} className="hidden">
        <input type="hidden" name="centerId" value={centerId} />
        <input type="hidden" name="intentId" value={item.id} />
      </form>

      {item.lapsed ? (
        <>
          <p className="mt-1 text-sm text-ink-soft">{words.lapsedHint}</p>
          <div className="mt-2">{cancelButton}</div>
        </>
      ) : (
        <form action={confirm} className="mt-2 flex flex-col gap-3">
          <input type="hidden" name="centerId" value={centerId} />
          <input type="hidden" name="intentId" value={item.id} />

          <div className="grid gap-3 sm:grid-cols-2">
            {/* The one fact only the founder has: the TrxID off their own phone. Never
                prefilled — the code in the line above is ours, and sending that back as
                the provider's reference would reconcile a payment against nothing. */}
            <Field
              label={words.reference}
              hint={words.referenceHint}
              id={fid('providerRef')}
              name="providerRef"
              placeholder="8N7A6B5C4D"
              required
              maxLength={MAX_LABEL}
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
          </div>

          <Field label={words.note} id={fid('note')} name="note" maxLength={MAX_TEXT} />

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={confirming || cancelling}>
              {confirming ? words.confirming : words.confirm}
            </Button>
            {cancelButton}
          </div>
        </form>
      )}
    </>
  )
}
