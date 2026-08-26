'use client'

/**
 * The button an owner presses when they have decided to pay us.
 *
 * The one control on the one screen where that decision gets made, which is why it is
 * a form and not a `mailto:` — see ./actions.ts for what it writes and why the row is
 * keyed on the centre.
 *
 * TWO STATES AND NO DISCLOSURE. Every other multi-field form in the product hides
 * behind a `<details>`, because those screens are lists and a list of open forms
 * cannot be scanned. This one is the last card on a page the reader has just scrolled
 * through a price ladder and a calculator to reach, and a summary they have to tap
 * first is one more thing between a decision and telling us about it.
 *
 * EVERY DYNAMIC SENTENCE IS COMPOSED ON THE SERVER, the same rule the founder panel's
 * forms follow: `words` is string leaves only so the whole group crosses the boundary
 * as-is, and the pending line — which names a plan and a date, both localised and one
 * of them a Bangla numeral — arrives already built. There is nothing here to
 * interpolate and no dictionary import.
 */

import { useActionState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import { MAX_TEXT } from '@/lib/limits'
import type { PlanId } from '@/lib/plans'
import {
  requestUpgrade,
  withdrawUpgradeRequest,
  type UpgradeState,
} from './actions'

/** String leaves only — this group is handed to a client component. */
export type UpgradeWords = {
  pick: string
  note: string
  noteHint: string
  send: string
  sending: string
  withdraw: string
  withdrawing: string
  ownerOnly: string
  badPlan: string
  failed: string
  sent: string
  withdrawn: string
}

/** A `<select>` option whose label was localised by the server that built it. */
export type PlanChoice = { value: PlanId; label: string }

export function UpgradeRequest({
  choices,
  suggested,
  pendingLine,
  pendingNote,
  words,
}: {
  /** The paid tiers this centre is not already on, cheapest first. */
  choices: PlanChoice[]
  /**
   * The tier the dropdown opens on: the next one up from where they are.
   *
   * A default rather than a blank first option, because the overwhelmingly common
   * request is the next rung — a free teacher wanting Pro, a Pro teacher who has
   * outgrown 150 students wanting Centre — and an owner who has to choose before they
   * can submit is being asked to re-read a price list they just read.
   */
  suggested: PlanId
  /**
   * "You asked for Teacher Pro on 26 August" — built on the server, absent when there
   * is no open request. Its presence is what switches this component between its two
   * states.
   */
  pendingLine: string | null
  /** What the owner typed with the request, shown back so they can see we have it. */
  pendingNote: string | null
  words: UpgradeWords
}) {
  const [askState, ask, asking] = useActionState<UpgradeState, FormData>(
    requestUpgrade,
    null,
  )
  const [dropState, drop, dropping] = useActionState<UpgradeState, FormData>(
    withdrawUpgradeRequest,
    null,
  )

  /*
   * The pending branch reads from the server's row, not from `askState`.
   *
   * `revalidatePath` in the action re-renders this page, so a successful request
   * arrives back as a `pendingLine` — which means the confirmation the owner sees is
   * the stored fact rather than the action's own optimism. The `ok` sentence is still
   * shown above it, because a page that silently rearranges itself after a tap does
   * not tell the reader their tap worked.
   */
  if (pendingLine) {
    return (
      <div className="mt-3 flex flex-col gap-2">
        {askState?.ok && (
          <p role="status" className="font-medium text-brand-700">
            {askState.ok}
          </p>
        )}
        {dropState?.error && <Alert>{dropState.error}</Alert>}

        <p className="font-medium text-ink">{pendingLine}</p>
        {pendingNote && (
          <p className="text-sm text-ink-soft">“{pendingNote}”</p>
        )}

        <form action={drop}>
          <Button type="submit" variant="secondary" disabled={dropping}>
            {dropping ? words.withdrawing : words.withdraw}
          </Button>
        </form>
      </div>
    )
  }

  return (
    <form action={ask} className="mt-3 flex flex-col gap-3">
      {askState?.error && <Alert>{askState.error}</Alert>}
      {/* Only reachable when the write succeeded and the re-render has not caught up
          — a withdrawal's confirmation, since a request's own lands in the branch
          above. Kept so neither tap is ever silent. */}
      {dropState?.ok && (
        <p role="status" className="font-medium text-brand-700">
          {dropState.ok}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="wantsPlan" className="font-medium text-ink">
          {words.pick}
        </label>
        {/* Native, and text-base: iOS Safari zooms the page on any focused control
            under 16px and the layout never comes back. Same reasoning as the
            founder panel's own dropdowns. */}
        <select
          id="wantsPlan"
          name="plan"
          defaultValue={suggested}
          className="min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base
            outline-none transition-colors focus:border-brand-500"
        >
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <Field
        label={words.note}
        hint={words.noteHint}
        id="wantsNote"
        name="note"
        maxLength={MAX_TEXT}
      />

      <Button type="submit" disabled={asking} full>
        {asking ? words.sending : words.send}
      </Button>
    </form>
  )
}
