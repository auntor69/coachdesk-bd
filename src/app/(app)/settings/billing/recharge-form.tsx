'use client'

/**
 * The recharge form — the half of §11.9's screen that talks back to the server.
 *
 * A CLIENT COMPONENT FOR ONE REASON: `useActionState`, so a refusal lands beside the field
 * that caused it instead of on a fresh page. Everything else here is finished values — the
 * suggestions are priced on the server, the phone number comes from the environment, and
 * nothing in this file can compute a bonus. §11.4's rule holds across the boundary: the
 * amount is the only figure the customer picks, and it arrives at the action to be checked
 * against three counts the form has never seen.
 *
 * THE SUGGESTIONS ARE RADIOS INSIDE THE AMOUNT FIELD'S OWN GROUP, which is the smallest
 * thing that works. A button per suggestion and a text box would be two controls writing
 * one value, and the reader would have to guess which one wins; a radio set with a text box
 * beside it is one value with two ways to say it, and the radio is visibly selected.
 *
 * ALL FOUR AMOUNTS ARE SHOWN WITH THEIR BONUS. §11.6's ladder only works if the rungs are
 * visible — an owner who cannot see that ৳7,800 earns 5% more will type the ৳5,000 they had
 * in mind and never learn there was a step.
 */

import { useActionState, useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'

import { submitRechargeClaim, type RechargeState } from './actions'

/**
 * One rung of the ladder, as sentences the server already wrote.
 *
 * THE AMOUNTS, THE BONUS AND THE DAY COUNT ALL ARRIVE FINISHED, and that is a boundary
 * rather than a style: `RechargeWords` is full of functions (`offerBonus`, `daysAtSize`,
 * `offerMonths`), and a function cannot cross from a Server Component into a Client
 * Component — React refuses to serialise it and the page throws at render. The same
 * negotiation `src/app/founder/recharge-queue.tsx` makes with `QueueWords`, and the same one
 * the dictionaries make with `T<'group'>`. Every figure here is priced on the server anyway
 * (§11.4), so passing them as text costs nothing and removes the last reason this file would
 * want a number.
 */
export type Suggestion = {
  months: number
  /** The radio's own value in whole taka, as a string. */
  value: string
  /** "৳7,800" — already formatted. */
  amount: string
  /** "৫% বোনাস (৳390)" or "এই অঙ্কে বোনাস নেই". */
  bonus: string
  /** "আপনার বর্তমান আকারে প্রায় ২২ দিন।", or null when the rate could not be read. */
  days: string | null
}

/** The subset of `RechargeWords` this form draws, with every function already resolved. */
export type RechargeFormWords = {
  offerTitle: string
  typedLabel: string
  typedHint: string
  trxLabel: string
  trxHint: string
  senderLabel: string
  senderHint: string
  confirm: string
  confirming: string
  agreeLead: string
  agreeJoin: string
  agreeTail: string
  agreeChanged: string
  /** The two documents' own titles, copied from lib/legal/policies.ts by the panel. */
  termsLabel: string
  refundsLabel: string
}

export function RechargeForm({
  suggestions,
  words,
  termsHref,
  refundsHref,
  askAgain,
}: {
  suggestions: Suggestion[]
  words: RechargeFormWords
  termsHref: Route
  refundsHref: Route
  /** True when a version of either document changed since this centre last agreed. */
  askAgain: boolean
}) {
  const [state, submit, pending] = useActionState<RechargeState, FormData>(
    submitRechargeClaim,
    null,
  )

  // What the amount box holds. `''` rather than a prefilled figure, so a suggestion has to
  // be chosen deliberately — a form that opens with ৳2,600 in it is a form somebody
  // submits by accident.
  const [amount, setAmount] = useState('')

  // The consent tick. Uncontrolled would be wrong here: React empties an uncontrolled field
  // when a form action returns, so a refusal — a mistyped TrxID, an amount below a day's rate
  // — would silently clear the tick and the reader would have to find it again.
  const [agreed, setAgreed] = useState(false)

  return (
    <form action={submit} className="mt-3 flex flex-col gap-3">
      <fieldset>
        <legend className="text-sm font-medium text-ink-soft">{words.offerTitle}</legend>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {suggestions.map((s) => (
            <label
              key={s.months}
              className={`flex min-h-tap cursor-pointer items-center gap-3 rounded-xl border p-3
                ${amount === s.value ? 'border-brand-500 bg-brand-50' : 'border-line'}`}
            >
              <input
                type="radio"
                name="offer"
                className="size-4"
                value={s.value}
                checked={amount === s.value}
                onChange={() => setAmount(s.value)}
              />
              <span className="flex flex-1 flex-col">
                <span className="font-semibold text-ink">{s.amount}</span>
                {/* The credit, and the bonus only where there is one: a line reading
                    "৳2,600 + ৳0 bonus" on the first rung is a discount that does not
                    exist, which is worse than no line at all. Composed on the server for
                    both reasons — see `Suggestion`. */}
                <span className="text-sm text-ink-soft">{s.bonus}</span>
                {s.days !== null && (
                  <span className="text-xs text-ink-faint">{s.days}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink-soft">{words.typedLabel}</span>
        <input
          name="amount"
          inputMode="numeric"
          autoComplete="off"
          className="min-h-tap rounded-xl border border-line bg-white px-3 text-ink"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ''))}
        />
        <span className="text-xs text-ink-faint">{words.typedHint}</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink-soft">{words.trxLabel}</span>
        <input
          name="trxId"
          required
          maxLength={40}
          autoComplete="off"
          className="min-h-tap rounded-xl border border-line bg-white px-3 text-ink"
        />
        <span className="text-xs text-ink-faint">{words.trxHint}</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink-soft">{words.senderLabel}</span>
        <input
          name="sender"
          required
          inputMode="tel"
          maxLength={20}
          autoComplete="off"
          placeholder="01XXXXXXXXX"
          className="min-h-tap rounded-xl border border-line bg-white px-3 text-ink"
        />
        <span className="text-xs text-ink-faint">{words.senderHint}</span>
      </label>

      {/*
        THE CONSENT TICK (§11.6, §14.1). The balance is non-refundable and the terms are the
        ones that say so, so this is the line §11.6 commits to showing before the tap — and
        it is the recharge at which the acceptance is recorded.

        IT IS DRAWN ON EVERY RECHARGE, ticked or not. A box that is pre-ticked because we
        have a row from last time is a box nobody reads, and the tick takes a second; what
        the stored version buys is the sentence underneath, which appears only when the
        words have actually changed since this centre last agreed.
      */}
      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-2.5 text-sm text-ink-soft">
          <input
            type="checkbox"
            name="agree"
            value="on"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            required
            className="mt-0.5 size-4 shrink-0 accent-brand-600"
          />
          <span>
            {words.agreeLead}{' '}
            <Link
              href={termsHref}
              target="_blank"
              className="font-semibold text-brand-700 underline"
            >
              {words.termsLabel}
            </Link>{' '}
            {words.agreeJoin}{' '}
            <Link
              href={refundsHref}
              target="_blank"
              className="font-semibold text-brand-700 underline"
            >
              {words.refundsLabel}
            </Link>{' '}
            {words.agreeTail}
          </span>
        </label>

        {askAgain && (
          <p className="text-xs text-late">{words.agreeChanged}</p>
        )}
      </div>

      {state?.error && (
        <p role="alert" className="text-sm font-medium text-absent">
          {state.error}
        </p>
      )}
      {state?.ok && <p className="text-sm font-medium text-present">{state.ok}</p>}

      <button
        type="submit"
        disabled={pending}
        className="min-h-tap rounded-xl bg-brand-600 px-5 font-semibold text-white
          hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? words.confirming : words.confirm}
      </button>
    </form>
  )
}
