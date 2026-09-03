'use client'

/**
 * Naming a waiver the centre grants, at the top of the list of them.
 *
 * ONE VALUE BOX, NOT TWO. The rule is either a share of the fee or a fixed figure and
 * never both — `fee_scholarships_one_rule` refuses a row carrying two — so two boxes
 * would be an invitation to fill in both and be told off for it. The select above the box
 * decides what the box means, exactly as it does on the waiver panel.
 *
 * THE RULE IS FROZEN ONCE SAVED, and the form says so before it is submitted rather than
 * after. `app.guard_fee_scholarship()` refuses a change to `percent` or `amount_bdt`
 * because every bill the award ever labelled also holds the figure it waived: editing
 * "50%" to "25%" afterwards would make all of that history read as a lie. So a new rule
 * is a new name, and an owner needs to know that while they are choosing the name.
 *
 * Stays on screen and clears itself, like the subject and exam-kind forms: an owner
 * setting up names sibling, merit and hardship in one sitting.
 */
import { useActionState, useRef, useState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import { MAX_NAME } from '@/lib/limits'
import type { T } from '@/lib/i18n'
import { createScholarship, type FeeState } from '../actions'

/** The waiver panel's select, to the pixel: one control, one look. */
const SELECT_CLASS =
  'min-h-tap rounded-xl border-2 border-line bg-white px-4 text-base outline-none' +
  ' focus:border-brand-500'

/**
 * A share, because it is the kind that earns its keep: 50% is right against a ৳1,500 fee
 * and a ৳2,200 fee without anybody recomputing it.
 */
const DEFAULT_KIND = 'percent'

export function ScholarshipForm({
  t,
  className = '',
}: {
  t: T<'scholarships'>
  /** The grid slot, because on a laptop this form is the rail. See the page. */
  className?: string
}) {
  const [kind, setKind] = useState(DEFAULT_KIND)
  const formRef = useRef<HTMLFormElement>(null)

  /*
   * The server action behind a client wrapper, so a saved award empties the form.
   *
   * Cleared here and not in an effect: this is the event finishing, and `reset()` alone
   * would not be enough anyway — it cannot move a controlled select, so the next award
   * would be named against the previous rule.
   */
  const [state, formAction, pending] = useActionState<FeeState, FormData>(
    async (prev, formData) => {
      const next = await createScholarship(prev, formData)
      if (next?.ok) {
        formRef.current?.reset()
        setKind(DEFAULT_KIND)
      }
      return next
    },
    null,
  )

  return (
    <form
      ref={formRef}
      action={formAction}
      className={`flex flex-col gap-3 rounded-2xl border border-line bg-white p-5
        ${className}`}
    >
      <h2 className="font-semibold text-ink">{t.addHeading}</h2>

      {/* Why anybody would name a waiver at all, inside the form it is about rather than
          in a card of its own above it: an owner who has never done this cannot tell from
          an empty list why they would start, and a one-sentence card floating over a form
          is the page furniture §37 asks us to stop drawing. */}
      <p className="text-sm text-ink-soft">{t.why}</p>

      {state?.error && <Alert>{state.error}</Alert>}
      {state?.ok && (
        <p role="status" className="font-medium text-brand-700">
          {state.ok} ✓
        </p>
      )}

      {/* The name is what the report totals by, so the hint gives examples rather than
          explaining the field: an owner who types "ছাড়" has named nothing. */}
      <Field
        label={t.name}
        hint={t.nameHint}
        name="name"
        required
        maxLength={MAX_NAME}
        autoComplete="off"
      />

      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">{t.kind}</span>
        <select
          name="kind"
          value={kind}
          // Cleared rather than converted, for the reason the waiver panel gives: "50"
          // read as taka is a fifty-taka waiver, and converting would be the form
          // deciding what the owner meant.
          onChange={(event) => {
            setKind(event.target.value)
            const box = formRef.current?.elements.namedItem('value')
            if (box instanceof HTMLInputElement) box.value = ''
          }}
          className={SELECT_CLASS}
        >
          <option value="percent">{t.kindPercent}</option>
          <option value="taka">{t.kindTaka}</option>
        </select>
      </label>

      {/* One box, labelled by the select above it. Not type="number", for the reason
          every money field here gives: it strips a thousands separator and refuses
          Bangla digits, and parseTaka takes both. */}
      <Field
        label={kind === 'percent' ? t.percentValue : t.takaValue}
        name="value"
        type="text"
        inputMode="decimal"
        required
        maxLength={12}
        className="num"
        autoComplete="off"
      />

      {/* Above the button, because it is a thing to know before pressing it. */}
      <p className="text-sm text-ink-soft">{t.ruleFrozen}</p>

      <Button type="submit" disabled={pending} full>
        {pending ? t.adding : t.add}
      </Button>
    </form>
  )
}
