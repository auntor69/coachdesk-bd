'use client'

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'

import { signUp, type SignupState } from './actions'
import { Alert, Button, Field } from '@/components/ui'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { EMAIL_CODE_MAX, RESEND_COOLDOWN_SECONDS } from '@/lib/auth/email-otp'
import { digits } from '@/lib/bd/time'

/**
 * One form, two steps (§5.4).
 *
 * `passwordHint` and the code length arrive already written or already read,
 * from the page. The number in the hint is `MIN_PASSWORD` and the number this
 * form refuses below is `MIN_PASSWORD`, so they cannot drift apart — but the
 * digit in the sentence has to be Bangla, and the constants live in a module a
 * browser bundle must not re-derive, so both come down as imports it can hold.
 *
 * Step one's inputs stay mounted and hidden while the code box is up, so the
 * address, name and password are still submitted with the code — the account is
 * confirmed in the same request that proves the address, and nothing has to be
 * held anywhere in between.
 *
 * They are controlled because they have to be: React empties an uncontrolled
 * field once a form action returns, so the hidden three would submit blank
 * alongside the code. Held here, in the browser, and never echoed back through
 * the action's answer — a password in a server response is a password in a
 * payload somebody can read.
 */
export function SignupForm({
  passwordHint,
  terms,
  privacy,
}: {
  passwordHint: string
  /** Where the two documents the checkbox names are read, and what they are called. */
  terms: { href: Route; label: string }
  privacy: { href: Route; label: string }
}) {
  const [state, formAction, pending] = useActionState<SignupState, FormData>(
    signUp,
    null,
  )

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Controlled for the same reason the three above are, and it matters more here: React
  // empties an uncontrolled field when a form action returns, so an untracked tick box would
  // be cleared the moment the code step appeared — and the code step is the one that records
  // the consent. It would post nothing, and the account would be refused after the email had
  // been confirmed, which is the worst order for that to happen in.
  const [agreed, setAgreed] = useState(false)

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

  // The resend countdown. One number, and it belongs to the button rather than
  // the code: Supabase refuses a resend inside its own sixty-second window, so
  // the button counts down exactly that long, whatever the code's own lifetime.
  // Tapping it early costs one refused round trip and no message.
  const wait
    = !state?.awaitingCode
      ? 0
      : counted.from === state
        ? counted.left
        : RESEND_COOLDOWN_SECONDS

  // Ticked by a timer, so the number on the screen is state and nothing reads the clock
  // during render — which react-hooks/purity would refuse, and rightly.
  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setCounted({ from: state, left: wait - 1 }), 1000)
    return () => clearTimeout(timer)
  }, [wait, state])

  // Which of the two sentences the submit button carries. Written out because the
  // button means two different things: on step one it asks for the code to be sent,
  // and on step two it confirms it.
  const submitLabel = showCode
    ? pending
      ? 'অ্যাকাউন্ট হচ্ছে…'
      : 'অ্যাকাউন্ট খুলুন'
    : pending
      ? 'কোড পাঠানো হচ্ছে…'
      : 'কোড নিন'

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && !state.field && <Alert>{state.error}</Alert>}

      {showCode && (
        <p className="text-ink-soft">
          <span className="font-semibold text-ink break-all">{state?.sentTo}</span>{' '}
          ঠিকানায় একটি ভেরিফিকেশন কোড পাঠানো হয়েছে। কোডটি না এলে স্প্যাম ফোল্ডারটাও
          একবার দেখে নিন।
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
          label="ইমেইল"
          hint="এই ইমেইলে কোড যাবে, এবং এই ইমেইল দিয়েই লগইন করবেন"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          placeholder="name@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required={!showCode}
          error={state?.field === 'email' ? state.error : undefined}
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
          label="ইমেইলে আসা কোড"
          name="code"
          type="text"
          inputMode="numeric"
          // Some mail clients fill this from the message itself, which saves the
          // visitor reading digits off a notification and typing them back.
          autoComplete="one-time-code"
          // The platform decides how many digits the code is — the input must
          // never be the thing that truncates it.
          maxLength={EMAIL_CODE_MAX}
          placeholder="••••••"
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
            ইমেইল বদলান
          </Button>
        </div>
      )}

      {!showCode && (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-2.5 text-sm text-ink-soft">
            <input
              type="checkbox"
              name="agree"
              value="on"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              // A required control the visitor cannot see is a submit that fails with a
              // message no browser will show — the same rule the three fields above
              // follow. The server refuses an untick either way; this is the sentence
              // landing next to the box instead of on the next render.
              required
              aria-invalid={state?.field === 'agree' ? true : undefined}
              className="mt-0.5 size-4 shrink-0 accent-brand-600"
            />
            <span>
              আমি{' '}
              <Link
                href={terms.href}
                target="_blank"
                className="font-semibold text-brand-700 underline"
              >
                {terms.label}
              </Link>{' '}
              ও{' '}
              <Link
                href={privacy.href}
                target="_blank"
                className="font-semibold text-brand-700 underline"
              >
                {privacy.label}
              </Link>{' '}
              পড়েছি এবং সম্মতি দিচ্ছি।
            </span>
          </label>

          {state?.field === 'agree' && (
            <span role="alert" className="text-sm font-medium text-absent">
              {state.error}
            </span>
          )}
        </div>
      )}

      {showCode && (
        // The tick travels with the code as a hidden field rather than being re-asked.
        // The box has already been answered on this form; asking twice would be a second
        // tick for the same act, and the record is one row per person per version.
        <input type="hidden" name="agree" value={agreed ? 'on' : ''} />
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
