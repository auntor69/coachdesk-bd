'use client'

/**
 * The add-a-thing form that subjects and exam types share.
 *
 * Both are a name plus an optional Bangla name, and both are entered in bursts —
 * an owner setting up sits down and adds six subjects at once. So the form stays
 * on screen after a successful save and clears itself, rather than navigating
 * away and making them find it again.
 */
import { useActionState, useEffect, useRef } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import type { T } from '@/lib/i18n'
import type { ActionState } from './actions'
import { MAX_NAME } from '@/lib/limits'

export function QuickAdd({
  action,
  common,
  label,
  hint,
  placeholder,
  placeholderBn,
  children,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>
  /**
   * The chrome — the second name field's label and the submit button. From
   * `common` rather than a group of its own because both are words this app
   * already says on every other form, and a form that said "যোগ করুন" here and
   * something else elsewhere would be the only one that did.
   */
  common: T<'common'>
  label: string
  hint?: string
  placeholder: string
  placeholderBn: string
  children?: React.ReactNode
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
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
      {state?.error && <Alert>{state.error}</Alert>}
      {state?.ok && (
        <p role="status" className="font-medium text-brand-700">
          {state.ok} ✓
        </p>
      )}

      {/* Two shapes, because the form has two homes. Below `xl` it is the width of
          the screen under the list, and two name fields side by side beat two 670px
          ones stacked. From `xl` it is a 386px rail beside the list, where side by
          side would be two 180px fields. The button follows the same rule, and
          the pair is aligned on its bottom edge because only the first field carries
          a hint — two inputs at different heights is the tell.

          No `id` on either field, unlike the panels in list-row.tsx: this is the one
          add form on the screen, so `Field`'s fallback to the input's name is
          unambiguous here — and `name`/`nameBn` are what the action reads. */}
      <div className="grid gap-3 sm:grid-cols-2 sm:items-end xl:grid-cols-1">
        <Field
          label={label}
          hint={hint}
          name="name"
          placeholder={placeholder}
          required
          maxLength={MAX_NAME}
        />
        <Field
          label={`${common.bnName} (${common.optional})`}
          name="nameBn"
          placeholder={placeholderBn}
          maxLength={MAX_NAME}
        />
      </div>

      {children}

      <Button
        type="submit"
        disabled={pending}
        full
        className="sm:w-auto sm:self-start xl:w-full"
      >
        {pending ? common.adding : common.add}
      </Button>
    </form>
  )
}
