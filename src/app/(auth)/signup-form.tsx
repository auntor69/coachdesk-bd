'use client'

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'

import { signUp, type SignupState } from './actions'
import { Alert, Button, Field } from '@/components/ui'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { digits } from '@/lib/bd/time'

/**
 * One form, one or two steps.
 *
 * `passwordHint` and the two code numbers arrive already written or already read, from
 * the page. The number in the hint is `MIN_PASSWORD` and the number this form refuses
 * below is `MIN_PASSWORD`, so they cannot drift apart — but the digit in the sentence
 * has to be Bangla, and the OTP constants live in a module that imports `node:crypto`,
 * which a browser bundle must not contain. So both come down as props.
 *
 * `codeRequired` is the server's own answer to whether an SMS gateway exists. It
 * decides what is drawn and nothing else: the code is checked and the account created
 * inside one Server Action call, so a browser that lied about this step would simply
 * be asked for a code it does not have.
 *
 * Step one's inputs stay mounted and hidden while the code box is up, so the number,
 * name and password are still submitted with the code — the account is made in the
 * same request that proves the number, and there is nothing in between to hold.
 *
 * They are controlled because they have to be: React empties an uncontrolled field
 * once a form action returns, so the hidden three would submit blank alongside the
 * code and the account would be created with no name and no password. Held here, in
 * the browser, and never echoed back through the action's answer — a password in a
 * server response is a password in a payload somebody can read.
 */
export function SignupForm({
  passwordHint,
  codeRequired,
  codeLength,
  resendAfter,
}: {
  passwordHint: string
  codeRequired: boolean
  codeLength: number
  resendAfter: number
}) {
  const [state, formAction, pending] = useActionState<SignupState, FormData>(
    signUp,
    null,
  )

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')

  // Both pieces of local state are pinned to the answer they belong to, rather than
  // reset by an effect when a new one arrives. `useActionState` hands back a fresh
  // object on every submit, so comparing against it is the reset: a new answer makes
  // the override and the half-finished countdown stale without anything having to
  // notice. Resetting state from inside an effect is a cascading render, and eslint's
  // react-hooks/set-state-in-effect rule refuses it.
  const [editingFor, setEditingFor] = useState<SignupState>(null)
  const showCode = Boolean(state?.awaitingCode) && editingFor !== state

  const [counted, setCounted] = useState<{ from: SignupState; left: number }>({
    from: null,
    left: 0,
  })

  // A countdown belongs to a send: the answer that carries an expiry opens the whole
  // cooldown, and a refusal that named a wait opens exactly that. Every other answer —
  // a wrong code, above all — leaves the button available rather than adding a fresh
  // minute to the wait for a code that never arrived. Tapping it early costs one round
  // trip and no message: the cooldown is checked before anything is inserted or sent,
  // and the refusal comes back with the server's own number of seconds.
  const opening = state?.wait ?? (state?.expiresIn == null ? 0 : resendAfter)

  const wait
    = !state?.awaitingCode
      ? 0
      : counted.from === state
        ? counted.left
        : opening

  // Ticked by a timer, so the number on the screen is state and nothing reads the clock
  // during render — which react-hooks/purity would refuse, and rightly.
  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setCounted({ from: state, left: wait - 1 }), 1000)
    return () => clearTimeout(timer)
  }, [wait, state])

  // Which of the three sentences the submit button carries. Written out because the
  // button means two different things: one step or two, it is the only button, and on
  // step one of two it sends a code rather than creating anything.
  const creating = showCode || !codeRequired
  const submitLabel = creating
    ? pending
      ? 'তৈরি হচ্ছে…'
      : 'অ্যাকাউন্ট খুলুন'
    : pending
      ? 'কোড পাঠানো হচ্ছে…'
      : 'কোড পাঠান'

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && !state.field && <Alert>{state.error}</Alert>}

      {showCode && (
        <p className="text-ink-soft">
          <span className="font-semibold text-ink">{state?.sentTo}</span> নম্বরে{' '}
          {digits(codeLength, 'bn')} সংখ্যার একটি কোড পাঠানো হয়েছে।
        </p>
      )}

      {/* Hidden, not unmounted: a hidden input still submits, and these three values
          have to travel with the code. */}
      <div hidden={showCode} className="flex flex-col gap-4">
        <Field
          label="আপনার নাম"
          name="name"
          autoComplete="name"
          placeholder="মোঃ রফিকুল ইসলাম"
          value={name}
          onChange={(e) => setName(e.target.value)}
          // A required input the visitor cannot see is a submit that fails with a
          // message no browser will show. They are filled by the time this is hidden.
          required={!showCode}
          autoFocus
          error={state?.field === 'name' ? state.error : undefined}
        />

        <Field
          label="মোবাইল নম্বর"
          hint={
            codeRequired
              ? 'এই নম্বরে কোড যাবে, এবং এই নম্বর দিয়েই লগইন করবেন'
              : 'এই নম্বর দিয়েই লগইন করবেন'
          }
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="username"
          placeholder="০১৭১২৩৪৫৬৭৮"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required={!showCode}
          error={state?.field === 'phone' ? state.error : undefined}
        />

        <Field
          label="পাসওয়ার্ড"
          hint={passwordHint}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required={!showCode}
          error={state?.field === 'password' ? state.error : undefined}
        />
      </div>

      {showCode && (
        <Field
          label="এসএমএসে আসা কোড"
          name="code"
          type="text"
          inputMode="numeric"
          // Android and iOS both fill this from the message itself, which saves the
          // visitor reading six digits off a notification and typing them back.
          autoComplete="one-time-code"
          maxLength={codeLength}
          placeholder={'০'.repeat(codeLength)}
          required
          autoFocus
          error={state?.field === 'code' ? state.error : undefined}
        />
      )}

      <Button type="submit" full disabled={pending}>
        {submitLabel}
      </Button>

      {showCode && (
        <div className="flex flex-col gap-2">
          <Button
            type="submit"
            name="intent"
            value="resend"
            variant="secondary"
            full
            disabled={pending || wait > 0}
          >
            {wait > 0
              ? `আরও ${digits(wait, 'bn')} সেকেন্ড`
              : 'নতুন কোড পাঠান'}
          </Button>

          <Button
            type="button"
            variant="ghost"
            full
            disabled={pending}
            onClick={() => setEditingFor(state)}
          >
            নম্বর বদলান
          </Button>
        </div>
      )}

      <p className="text-center text-ink-soft">
        আগে থেকেই অ্যাকাউন্ট আছে?{' '}
        <Link href="/login" className="font-semibold text-brand-700 underline">
          লগইন করুন
        </Link>
      </p>
    </form>
  )
}
