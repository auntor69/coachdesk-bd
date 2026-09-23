'use client'

/**
 * The way out of §3.4's dead end, for the reader who cannot buy.
 *
 * The card this sits in used to be the whole answer: "there are no places left", and
 * nothing else. For an owner that is a sales conversation nobody starts; for the branch
 * manager standing in front of a family it is worse, because the person who can pay is
 * not in the room. §3.7's fork puts a button here instead — one that files a record HQ
 * can act on rather than sending them off to find a phone number.
 *
 * Its own <form>, unlike the twin on the import screen, which borrows that screen's
 * form with `formAction` because a nested <form> is illegal and a five-hundred-line
 * paste is expensive to lose. Nothing on this card is worth preserving, so this one is
 * plain.
 *
 * FINISHED SENTENCES RATHER THAN A DICTIONARY SLICE. Both of these count places, and a
 * count-dependent string is a function that cannot cross into a client component — see
 * `T` in lib/i18n. The page resolves them; the success line comes back from the action
 * itself.
 */

import { useActionState } from 'react'

import { Alert, Button } from '@/components/ui'
import { requestPlaces, withdrawPlacesRequest, type UpgradeState } from '../../billing/actions'

export function AskPlaces({
  ask,
  asking,
  /** The sentence for an ask already on file, or null if this branch has not asked. */
  asked,
  withdraw,
}: {
  ask: string
  asking: string
  asked: string | null
  withdraw: string
}) {
  const [askState, askAction, pending] = useActionState<UpgradeState, FormData>(
    requestPlaces,
    null,
  )
  const [withdrawn, withdrawAction, withdrawing] = useActionState<UpgradeState, FormData>(
    withdrawPlacesRequest,
    null,
  )

  /** What is on file, plus whatever this screen has done to it since it loaded. */
  const filed = withdrawn?.ok ? null : (askState?.ok ?? asked)

  return (
    <form className="mt-3 flex flex-col gap-2">
      {(askState?.error || withdrawn?.error) && (
        <Alert>{askState?.error ?? withdrawn?.error}</Alert>
      )}

      {filed !== null ? (
        <>
          <p role="status" className="num text-sm font-medium text-brand-700">
            {filed}
          </p>
          <Button
            type="submit"
            formAction={withdrawAction}
            disabled={withdrawing}
            variant="ghost"
            className="self-start px-0"
          >
            {withdraw}
          </Button>
        </>
      ) : (
        <Button
          type="submit"
          formAction={askAction}
          disabled={pending}
          variant="secondary"
          full
        >
          {pending ? asking : ask}
        </Button>
      )}
    </form>
  )
}
