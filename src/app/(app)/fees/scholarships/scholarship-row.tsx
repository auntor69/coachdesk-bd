'use client'

/**
 * One named waiver, with the two things about it that may still be corrected.
 *
 * WHAT CAN CHANGE AND WHAT CANNOT. The name and whether it is still offered; never the
 * rule. `app.guard_fee_scholarship()` freezes `percent` and `amount_bdt` because every
 * bill this award ever labelled also stores the figure it waived — so the rule is printed
 * here as a fact, not as a field, and the note says why.
 *
 * RETIRING IS NOT DELETING. Unticking "in use" keeps the award off the waiver panel's
 * select while every bill it ever labelled keeps its label and `fee_waiver_month` keeps
 * totalling what it cost. There is no remove button at all: the invoice FK is
 * `on delete set null`, so deleting one would quietly unlabel months of history, and the
 * DELETE grant is refused for every non-server role anyway.
 *
 * ONE FORM FOR BOTH, and the checkbox is a real checkbox — so an owner who unticks it and
 * presses Save is sending "off", not omitting a field. That is why the action may read
 * absence as off here while the settings screens need explicit on/off buttons.
 *
 * SHUT UNTIL ASKED, like the subject and exam-kind rows: this list is read far more often
 * than it is edited, so a row is a name, its rule, and a quiet way in.
 */
import { useActionState, useState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import { MAX_NAME } from '@/lib/limits'
import type { T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { formatTaka as taka } from '@/lib/money'
import { updateScholarship, type FeeState } from '../actions'

export function ScholarshipRow({
  id,
  name,
  percent,
  amountBdt,
  active,
  t,
  common,
}: {
  id: string
  name: string
  /** The share, or null when the rule is a fixed figure. Exactly one of the two is set. */
  percent: number | null
  amountBdt: number | null
  active: boolean
  t: T<'scholarships'>
  common: T<'common'>
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<FeeState, FormData>(
    updateScholarship,
    null,
  )

  // The rule as a sentence. A malformed row — only reachable from before the constraint
  // existed — prints nothing rather than "null% of the fee".
  const rule =
    percent !== null
      ? fill(t.percentRule, { percent })
      : amountBdt !== null
        ? taka(amountBdt)
        : ''

  return (
    <li className="rounded-xl border border-line bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-ink">
            <span className="truncate">{name}</span>
            {!active && (
              <span
                className="shrink-0 rounded-full bg-surface-alt px-2 py-0.5 text-xs
                  font-semibold text-ink-faint"
              >
                {t.retiredTag}
              </span>
            )}
          </p>
          {rule && <p className="num text-sm text-ink-soft">{rule}</p>}
        </div>
        {/* A plain underlined word and not a button — the wide buttons in this app do
            the thing the screen is for. */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex min-h-tap shrink-0 items-center text-sm font-medium
            text-brand-700"
        >
          {open ? common.cancel : common.edit}
        </button>
      </div>

      {open && (
        <form
          action={formAction}
          className="flex flex-col gap-3 border-t border-line px-4 py-4"
        >
          <input type="hidden" name="awardId" value={id} />

          {state?.error && <Alert>{state.error}</Alert>}
          {state?.ok && (
            <p role="status" className="font-medium text-brand-700">
              {state.ok} ✓
            </p>
          )}

          {/* The repair nearly every owner needs: a mistyped name, which every bill
              already labelled will read correctly the moment this is saved — the name
              is joined live, the figures are frozen. */}
          <Field
            label={t.name}
            id={`award-name-${id}`}
            name="name"
            defaultValue={name}
            required
            maxLength={MAX_NAME}
            autoComplete="off"
          />

          <label className="flex min-h-tap items-center gap-3">
            <input
              type="checkbox"
              name="active"
              defaultChecked={active}
              className="size-5 rounded border-2 border-line accent-brand-600"
            />
            <span className="font-medium text-ink">{t.activeLabel}</span>
          </label>

          {/* Only when it is already off. Under the tick rather than above it, because
              this is the answer to the worry the word "retired" creates. */}
          {!active && <p className="text-sm text-ink-soft">{t.retiredNote}</p>}

          {/* The rule is not a field, and the reason it is not is worth one line at the
              point where an owner would look for it. */}
          <p className="text-sm text-ink-faint">{t.ruleFrozen}</p>

          <Button type="submit" disabled={pending} full>
            {pending ? t.saving : t.save}
          </Button>
        </form>
      )}
    </li>
  )
}
