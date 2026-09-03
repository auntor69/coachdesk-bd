'use client'

/**
 * The add-a-branch form.
 *
 * NOT `QuickAdd`, which subjects and exam kinds share. That form's second field is a
 * Bangla name and this table has no `name_bn` column; more to the point, that form has no
 * room for the sentence below the button, and this is the only add form in settings that
 * has to carry one.
 *
 * THE PRICE IS ON THE FORM, and §3.7 asks for it in as many words: an owner must not
 * learn what a tap cost from next month's invoice. `costLine` is worked out by the page
 * from `nextBranchCostBdt`, so it is the marginal figure — what THIS branch adds — and it
 * says "nothing" while the included three are not used up.
 *
 * Stays on screen and clears itself after a save, like `QuickAdd`: an institution writing
 * itself down sits and adds all six buildings at once.
 */
import { useActionState, useEffect, useRef } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import type { T } from '@/lib/i18n'
import { MAX_NAME, MAX_TEXT } from '@/lib/limits'
import { createBranch, type BranchState } from './actions'

export function AddBranch({
  title,
  costLine,
  t,
  common,
}: {
  title: string
  /** What this one adds to the monthly bill, in a whole sentence. */
  costLine: string
  t: T<'branchForm'>
  common: T<'common'>
}) {
  const [state, formAction, pending] = useActionState<BranchState, FormData>(
    createBranch,
    null,
  )
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.ok) formRef.current?.reset()
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-5"
    >
      <h2 className="font-semibold text-ink">{title}</h2>

      {state?.error && <Alert>{state.error}</Alert>}
      {state?.ok && (
        <p role="status" className="font-medium text-brand-700">
          {state.ok} ✓
        </p>
      )}

      {/* Paired while this form has the page's width, stacked again once it is the rail
          beside the list (§20.8.8): from `sm` there is room for two fields on a line, and
          from `xl` the form is 384px and there is not. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <Field
          label={t.nameLabel}
          name="name"
          placeholder={t.namePlaceholder}
          required
          maxLength={MAX_NAME}
          autoComplete="off"
        />

        <Field
          label={`${t.addressLabel} (${common.optional})`}
          hint={t.addressHint}
          name="address"
          maxLength={MAX_TEXT}
          autoComplete="off"
        />
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? common.adding : t.submit}
        </Button>
        {/* Under the button, where the staff row puts its consequence and the bill
            screen puts its total: this is the answer to "what does this cost me", and
            an owner asks it with their thumb already on the button. */}
        <p className="mt-2 max-w-prose text-sm text-ink-soft">{costLine}</p>
      </div>
    </form>
  )
}
