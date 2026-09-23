'use client'

/**
 * Buying student places, priced as the owner types.
 *
 * The figure moves per keystroke for the reason ./calculator.tsx gives — but unlike the
 * calculator this one is a commitment, so the arithmetic here has to be the arithmetic
 * the server bills. Both sides call `capacityCostBdt` over the same bands from the same
 * ceiling; the price shown is the price the intent opens at, or the owner reads ৳600
 * and gets asked for ৳750.
 *
 * `ceiling` IS THE PAID CEILING, not `session.ceiling`. See ./actions.ts: a trial moves
 * the effective one and `settle_payment_intent` reads the paid row, so pricing from the
 * trial would quote a number the database later refuses.
 */

import { useActionState, useEffect, useRef, useState } from 'react'

import { Alert, Button } from '@/components/ui'
import { toAsciiDigits } from '@/lib/bd/phone'
import { digits } from '@/lib/bd/time'
import type { Locale } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { mintIdempotencyKey } from '@/lib/idempotency'
import { MAX_PLACES } from '@/lib/limits'
import { formatTaka } from '@/lib/money'
import { capacityCostBdt, nextSeatCostBdt } from '@/lib/plans'
import { buyStudentPlaces, type UpgradeState } from './actions'

/** String leaves only — this crosses to the browser. */
export type PlacesWords = {
  label: string
  hint: string
  quote: string
  submit: string
  submitting: string
}

/** The twin of `count` in ./calculator.tsx, and of the one in ./actions.ts. */
function count(raw: string, max: number): number {
  const n = Number.parseInt(toAsciiDigits(raw).replace(/[^\d]/g, ''), 10)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, max)
}

export function BuyPlaces({
  ceiling,
  locale,
  words,
}: {
  /** `studentCeiling(paid plan, paid capacity).ceiling` — where the bands start. */
  ceiling: number
  locale: Locale
  words: PlacesWords
}) {
  const [state, buy, buying] = useActionState<UpgradeState, FormData>(
    buyStudentPlaces,
    null,
  )

  // A string, so the field may be empty while somebody clears it. Empty on mount
  // rather than a default: this form spends money, and a number already sitting in it
  // is a number somebody can submit without having chosen it.
  const [places, setPlaces] = useState('')
  const keyRef = useRef<HTMLInputElement>(null)

  /*
   * The replay guard, minted after mount rather than during render — it reads a random
   * source, and a form Next replays offline has to arrive carrying the key it was sent
   * with so it lands on the intent it already opened.
   *
   * Mount only, so a retry after an error reuses it: that is the point. `openIntent`
   * hands back the existing row for a key it has seen, so an owner tapping again
   * because the first tap said "could not start" does not end up with two purchases.
   * A success unmounts this form, so the next one gets a fresh key.
   */
  useEffect(() => {
    const input = keyRef.current
    if (input && !input.value) input.value = mintIdempotencyKey()
  }, [])

  const n = count(places, MAX_PLACES)

  /*
   * One purchase at a time, and the field goes away when it opens.
   *
   * The next thing this owner has to do is send money against the reference now
   * showing above, not buy more places — and a filled-in field left under a
   * confirmation is one accidental tap from a second bill the founder has to
   * reconcile. Reloading the page brings the form back.
   */
  if (state?.ok) {
    return (
      <p role="status" className="mt-3 font-medium text-brand-700">
        {state.ok}
      </p>
    )
  }

  return (
    <form action={buy} className="mt-3 flex flex-col gap-3">
      {state?.error && <Alert>{state.error}</Alert>}

      <input type="hidden" name="idempotencyKey" ref={keyRef} />

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">{words.label}</span>
        {/* text + inputMode, for the reasons NumberField in ./calculator.tsx sets out. */}
        <input
          type="text"
          inputMode="numeric"
          name="places"
          value={places}
          maxLength={String(MAX_PLACES).length}
          onChange={(e) =>
            setPlaces(toAsciiDigits(e.target.value).replace(/[^\d]/g, ''))
          }
          className="num min-h-tap w-full rounded-xl border-2 border-line bg-white px-3
            text-lg font-semibold text-ink"
        />
      </label>

      {/* Before they have typed, what one more place costs — the bands make that the
          only honest single number. After, the whole bill and the ceiling it buys. */}
      <p className="text-sm text-ink-soft">
        {n > 0
          ? fill(words.quote, {
              n: digits(n, locale),
              taka: formatTaka(capacityCostBdt(ceiling, ceiling + n)),
              to: digits(ceiling + n, locale),
            })
          : fill(words.hint, { taka: formatTaka(nextSeatCostBdt(ceiling)) })}
      </p>

      <Button type="submit" disabled={buying || n <= 0} full>
        {buying ? words.submitting : words.submit}
      </Button>
    </form>
  )
}
