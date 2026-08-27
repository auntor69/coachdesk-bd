'use client'

/**
 * Three boxes and a button, and the first box is the one that matters.
 *
 * The current password is asked for even though the reader is already signed in.
 * Centre phones are shared — that is the same assumption the service worker is built
 * around — so a live session proves somebody signed in, not who is holding the phone.
 * The action re-checks it against the auth server; this form only collects it.
 */
import { useActionState } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import { MIN_PASSWORD } from '@/lib/auth/password'
import type { T } from '@/lib/i18n'
import { changeOwnPassword, type AccountState } from './actions'

export function PasswordForm({
  t,
  common,
  nextHint,
}: {
  t: T<'account'>
  common: T<'common'>
  /**
   * Already filled. `account.nextHint` quotes MIN_PASSWORD as a `{n}` template, and
   * the server resolves it: fill.ts is for sentences whose value the server does not
   * know yet, and this one it knows before the page is sent.
   */
  nextHint: string
}) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    changeOwnPassword,
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

      {/* autoComplete tells the phone's keychain which is which. Without it a
          password manager offers the saved password for all three boxes and
          saves the old one back over the new. */}
      <Field
        label={t.current}
        hint={t.currentHint}
        name="current"
        type="password"
        required
        autoComplete="current-password"
      />
      <Field
        label={t.next}
        hint={nextHint}
        name="next"
        type="password"
        required
        minLength={MIN_PASSWORD}
        autoComplete="new-password"
      />
      <Field
        label={t.confirm}
        name="again"
        type="password"
        required
        minLength={MIN_PASSWORD}
        autoComplete="new-password"
      />

      <Button type="submit" full disabled={pending}>
        {pending ? common.saving : t.submit}
      </Button>
    </form>
  )
}
