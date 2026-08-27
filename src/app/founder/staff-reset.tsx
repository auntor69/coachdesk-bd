'use client'

/**
 * "They cannot get in" — the founder's end of a phone call that has nowhere else to go.
 *
 * WHY THIS IS ON THE PANEL AND NOT IN A DATABASE CONSOLE. Login here is a number and a
 * password, with no email behind it, so there is no reset link to send. /account covers
 * a password you still know. The owner's staff screen covers a teacher who belongs to
 * no other centre, and refuses everybody else on purpose — read lib/auth/reset.ts for
 * the takeover that refusal exists to stop. What is left over is an owner, a manager,
 * and a teacher who works at two centres, and the refusal copy on that screen tells all
 * three of them to ring the founder. Until this form existed, answering that call meant
 * opening a SQL console, which is a habit worth not forming.
 *
 * BEHIND A DISCLOSURE, like the billing forms and for the same reason: the customer
 * list is a list. It is also the least-used control on the page — most calls are about
 * money — and an open password box on every card would be the loudest thing on a screen
 * built for scanning.
 *
 * BOTH FIELDS ARE VISIBLE, INCLUDING THE PASSWORD, and that is deliberate rather than
 * sloppy. The founder is going to say this password out loud down a phone line; masking
 * it would mean typing a secret they cannot check into a form whose only confirmation is
 * somebody else failing to log in. The owner's teacher form does the same thing for the
 * same reason.
 *
 * The refusal sentences and the success line are both composed by the action — `words`
 * is string leaves only, and the confirmation carries the account's name, which this
 * component never sees. See the note at the top of ./center-billing.tsx.
 */

import { useActionState, useEffect, useRef } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { resetCenterStaffPassword, type FounderState } from './actions'

/** String leaves only — this group is handed to a client component. */
export type LockoutWords = {
  summary: string
  body: string
  phone: string
  phoneHint: string
  password: string
  passwordHint: string
  submit: string
  saving: string
  failed: string
  errors: {
    noAccount: string
    self: string
    platformAdmin: string
    notStaff: string
  }
}

export function StaffReset({
  centerId,
  words,
}: {
  centerId: string
  words: LockoutWords
}) {
  const [state, act, saving] = useActionState<FounderState, FormData>(
    resetCenterStaffPassword,
    null,
  )
  const form = useRef<HTMLFormElement>(null)

  /**
   * Unique across the whole list, exactly as on the billing forms: `Field` falls back
   * to the control's `name` for its id, so eleven cards would put eleven
   * `id="phone"` in one document and every label would focus the first card's box. A
   * founder typing a new password into the wrong customer's form is the one mistake
   * this particular screen must not make easy.
   */
  const fid = (name: string) => `${name}-lockout-${centerId}`

  useEffect(() => {
    // Emptied once it has been set. The next call is about a different person, and a
    // form still holding the last one's number and password is how the wrong account
    // gets reset — the password is on screen in plain text, so this is also the only
    // thing that takes it off a founder's phone.
    if (state?.ok) form.current?.reset()
  }, [state])

  return (
    <details className="mt-2 border-t border-line pt-2">
      <summary
        className="inline-flex min-h-tap cursor-pointer list-none items-center
          font-medium text-brand-700"
      >
        {words.summary}
      </summary>

      <form ref={form} action={act} className="mt-2 flex flex-col gap-3">
        <input type="hidden" name="centerId" value={centerId} />

        {/* What this does and what it does not do, before the fields rather than
            after them: that other phones stay signed in is the thing a founder is
            most likely to assume the other way round. */}
        <p className="text-sm text-ink-soft">{words.body}</p>

        {state?.error && <Alert>{state.error}</Alert>}
        {/* The account's name, read back off the screen and down the phone. Nothing
            on the panel changed, so nothing revalidates this away — it stays until
            the founder submits again or leaves. */}
        {state?.ok && (
          <p role="status" className="font-medium text-brand-700">
            {state.ok}
          </p>
        )}

        <Field
          label={words.phone}
          hint={words.phoneHint}
          id={fid('phone')}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="01712345678"
          required
          maxLength={20}
          className="num"
        />

        <Field
          label={words.password}
          hint={words.passwordHint}
          id={fid('password')}
          name="password"
          // Not a masked field. See the note at the top of this file: the founder has
          // to read this out loud, and `autoComplete="off"` keeps the browser from
          // offering to remember somebody else's password on the founder's own phone.
          type="text"
          autoComplete="off"
          required
          minLength={MIN_PASSWORD}
          maxLength={72}
        />

        <Button type="submit" variant="secondary" disabled={saving} full>
          {saving ? words.saving : words.submit}
        </Button>
      </form>
    </details>
  )
}
