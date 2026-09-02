'use client'

/**
 * Paying for the plan: how many months, and — when there is anywhere to go — which tier.
 *
 * Priced by `monthlyBillBdt` over the counts the server read, because that is the
 * function ./actions.ts bills with. A second formula here would show one number and
 * charge another.
 *
 * `from` IS A PROP AND NOT A CLOCK READ. Where coverage starts depends on
 * `coaching_centers.paid_through`, so only the server can work it out — and a component
 * that read `Date.now()` during render would be an impure call the compiler refuses.
 */

import { useActionState, useEffect, useRef, useState } from 'react'

import { Alert, Button } from '@/components/ui'
import { formatMonth } from '@/lib/bd/time'
import type { Locale } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { mintIdempotencyKey } from '@/lib/idempotency'
import { formatTaka } from '@/lib/money'
import {
  DEFAULT_MONTHS_COVERED,
  coverageEnd,
  type MonthsCovered,
} from '@/lib/platform/billing'
import { monthlyBillBdt, planFor, type PlanId } from '@/lib/plans'
import { buySubscription, type UpgradeState } from './actions'

/** String leaves only — this crosses to the browser. */
export type SubscribeWords = {
  planLabel: string
  monthsLabel: string
  quote: string
  submit: string
  submitting: string
}

/** An option: the count the form posts, and the label the server localised. */
export type MonthChoice = { value: MonthsCovered; label: string }

/**
 * A tier this purchase may be for. `''` is "stay where I am", which is what a renewal
 * posts and what ./actions.ts reads as a null `target_plan`.
 */
export type SubscribeChoice = { value: '' | PlanId; label: string }

export function BuySubscription({
  plan,
  plans,
  months: choices,
  students,
  teachers,
  branches,
  from,
  locale,
  words,
}: {
  /** The tier the bill is computed from when the choice is `''`. */
  plan: PlanId
  /**
   * What this purchase may be for, in the order it is offered — the first is the
   * default. ./page.tsx builds the whole list, renewal included, because a downgrade
   * and a mid-term move are both phone calls and neither belongs in a dropdown that
   * would come back as an error.
   */
  plans: SubscribeChoice[]
  months: MonthChoice[]
  /** The counts the bill is computed from — the same three the server priced with. */
  students: number
  teachers: number
  branches: number
  /** First day of the first month covered, `YYYY-MM-01`. */
  from: string
  locale: Locale
  words: SubscribeWords
}) {
  const [state, buy, buying] = useActionState<UpgradeState, FormData>(
    buySubscription,
    null,
  )

  // The cheapest purchase on the card, not the dearest: a dropdown cannot be empty, so
  // its default has to be the one nobody minds having chosen without noticing.
  const [months, setMonths] = useState<MonthsCovered>(DEFAULT_MONTHS_COVERED)
  const [target, setTarget] = useState<'' | PlanId>(plans[0]?.value ?? '')
  const keyRef = useRef<HTMLInputElement>(null)

  // After mount, and once. ./buy-places.tsx sets out why both halves matter.
  useEffect(() => {
    const input = keyRef.current
    if (input && !input.value) input.value = mintIdempotencyKey()
  }, [])

  const total =
    monthlyBillBdt(planFor(target === '' ? plan : target), students, teachers, branches)
    * months

  // One purchase at a time, and the form goes away when it opens — the same reasoning
  // as the places card, plus a harder rule: ./actions.ts refuses a second subscription
  // intent outright, because two of them would cover the same months twice.
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

      {plans.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="buyPlan" className="text-sm font-medium text-ink">
            {words.planLabel}
          </label>
          {/* Native, and text-base for the iOS zoom reason ./upgrade-request.tsx gives. */}
          <select
            id="buyPlan"
            name="plan"
            value={target}
            onChange={(e) => setTarget(e.target.value as '' | PlanId)}
            className="min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base
              outline-none transition-colors focus:border-brand-500"
          >
            {plans.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="buyMonths" className="text-sm font-medium text-ink">
          {words.monthsLabel}
        </label>
        <select
          id="buyMonths"
          name="months"
          value={months}
          onChange={(e) => setMonths(Number(e.target.value) as MonthsCovered)}
          className="min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base
            outline-none transition-colors focus:border-brand-500"
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>

      {/* The bill and the window it buys, both recomputed as the dropdowns move. */}
      <p className="text-sm text-ink-soft">
        {fill(words.quote, {
          taka: formatTaka(total),
          from: formatMonth(from, locale),
          until: formatMonth(coverageEnd(from, months), locale),
        })}
      </p>

      <Button type="submit" disabled={buying || total <= 0} full>
        {buying ? words.submitting : words.submit}
      </Button>
    </form>
  )
}
