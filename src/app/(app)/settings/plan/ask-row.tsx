'use client'

/**
 * One branch's ask, with the two answers an owner has.
 *
 * A COMPONENT PER ROW, like payroll/terms-row.tsx and for the same reason: each row owns
 * its own `useActionState`, so an owner answering Mirpur does not see the result appear
 * beside Uttara's ask. Two `formAction`s over one hidden id, which is ask-places.tsx's
 * shape — the buttons disagree about what to do, not about which row.
 *
 * FINISHED SENTENCES ONLY. The line names a branch and counts places, the button carries
 * a price; all three are composed on the server, where a count-dependent string is still
 * a function. See `T` in lib/i18n.
 */

import { useActionState, useEffect, useRef } from 'react'

import { Alert, Button } from '@/components/ui'
import { mintIdempotencyKey } from '@/lib/idempotency'
import { answerAsk, declineAsk, type UpgradeState } from './actions'

export function AskRow({
  id,
  line,
  buy,
  decline,
}: {
  id: string
  line: string
  buy: string
  decline: string
}) {
  const [bought, answer, answering] = useActionState<UpgradeState, FormData>(
    answerAsk,
    null,
  )
  const [closed, dismiss, dismissing] = useActionState<UpgradeState, FormData>(
    declineAsk,
    null,
  )
  const keyRef = useRef<HTMLInputElement>(null)

  // Minted after mount, per buy-places.tsx: an offline replay must land on the intent it
  // already opened rather than opening a second one at the same price.
  useEffect(() => {
    const input = keyRef.current
    if (input && !input.value) input.value = mintIdempotencyKey()
  }, [])

  const done = bought?.ok ?? closed?.ok ?? null

  return (
    <form className="rounded-xl border border-line bg-white p-3">
      <p className="num text-sm font-medium text-ink">{line}</p>

      {(bought?.error || closed?.error) && (
        <div className="mt-2">
          <Alert>{bought?.error ?? closed?.error}</Alert>
        </div>
      )}

      {/*
        The row's controls go away once it has been answered, and the revalidate takes the
        row itself away a moment later. Leaving them up would offer a second purchase for
        an ask that is already closed — refused by `answerAsk`, but only after the owner
        had been invited to try.
      */}
      {done !== null ? (
        <p role="status" className="mt-2 text-sm font-medium text-brand-700">
          {done}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="ask" value={id} />
          <input type="hidden" name="idempotencyKey" ref={keyRef} />

          <Button
            type="submit"
            formAction={answer}
            disabled={answering || dismissing}
            full
          >
            {buy}
          </Button>
          <Button
            type="submit"
            formAction={dismiss}
            disabled={answering || dismissing}
            variant="ghost"
            className="self-start px-0"
          >
            {decline}
          </Button>
        </div>
      )}
    </form>
  )
}
