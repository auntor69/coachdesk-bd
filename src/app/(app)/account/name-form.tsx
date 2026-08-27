'use client'

/**
 * One box and a button — and no current password, unlike the form under it.
 *
 * The difference is deliberate and worth knowing about before you copy this file: the
 * password form asks for the current password because a shared centre phone means an
 * open session proves somebody signed in and not who is holding it now, and a password
 * change locks the real owner out. A name change locks nobody out of anything, so the
 * extra box would only cost a founder the fix to their own misspelt name.
 */
import { useActionState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import type { T } from '@/lib/i18n'
import { MAX_NAME } from '@/lib/limits'
import { changeOwnName, type AccountState } from './actions'

export function NameForm({
  fullName,
  t,
  common,
}: {
  /** Empty for an account that never had a name typed into it, which is a real state. */
  fullName: string
  t: T<'account'>
  common: T<'common'>
}) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    changeOwnName,
    null,
  )

  return (
    <form action={action} className="flex flex-col gap-3">
      {state?.error && <Alert>{state.error}</Alert>}
      {state?.ok && (
        <p role="status" className="text-sm font-medium text-brand-700">
          {state.ok}
        </p>
      )}

      {/* `name` rather than `given-name`: one box holds the whole name here, and a
          Bangla name does not split into two the way the autofill vocabulary assumes. */}
      <Field
        label={t.nameLabel}
        name="name"
        defaultValue={fullName}
        required
        maxLength={MAX_NAME}
        autoComplete="name"
      />

      <Button type="submit" full disabled={pending}>
        {pending ? common.saving : t.nameSubmit}
      </Button>
    </form>
  )
}
