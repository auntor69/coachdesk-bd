'use client'

/**
 * Getting out of a purchase that was opened by mistake.
 *
 * WITHOUT THIS, A MISTYPED QUOTE SITS ON THE SCREEN FOR SEVEN DAYS with a reference the
 * owner is invited to send money against. That was survivable on the places card, where
 * a second purchase is simply more places; it is not survivable for a subscription,
 * where ./actions.ts allows one open intent at a time — so a wrong twelve months would
 * block the right one until the quote lapsed.
 *
 * `pending -> cancelled` and `initiated -> cancelled` are both §11.2 transitions, so the
 * guard admits this and refuses it the moment money has settled.
 */

import { useActionState } from 'react'

import { Alert, Button } from '@/components/ui'
import { cancelPurchase, type UpgradeState } from './actions'

/** String leaves only — this crosses to the browser. */
export type CancelWords = {
  cancel: string
  cancelling: string
}

export function CancelPurchase({ id, words }: { id: string; words: CancelWords }) {
  const [state, cancel, cancelling] = useActionState<UpgradeState, FormData>(
    cancelPurchase,
    null,
  )

  // The row above this button is the purchase, and a successful cancel takes it away on
  // the next render. Until then the confirmation stands in for the button, so the tap is
  // never silent and never repeatable.
  if (state?.ok) {
    return (
      <p role="status" className="mt-2 text-sm font-medium text-brand-700">
        {state.ok}
      </p>
    )
  }

  return (
    <form action={cancel} className="mt-2">
      {state?.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="intent" value={id} />
      <Button type="submit" variant="secondary" disabled={cancelling}>
        {cancelling ? words.cancelling : words.cancel}
      </Button>
    </form>
  )
}
