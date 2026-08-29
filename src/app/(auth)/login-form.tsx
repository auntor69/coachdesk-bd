'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { signIn, type FormState } from './actions'
import { Alert, Button, Field } from '@/components/ui'

/**
 * One box for who you are, then a password. No email, no OTP.
 *
 * The box takes a mobile number *or* a username, because MASTERPLAN.md §5.3 will
 * not have a radio button or a second tab here — the server tells the two apart
 * by their shape (see loginEmailFor). What that costs is the numeric keypad:
 * `inputMode="numeric"` would hide the letters a teacher's username is made of,
 * so everybody gets the full keyboard. Owners pay for it, and they pay once per
 * device with a saved password; a teacher who could not type their username at
 * all would simply be locked out.
 *
 * OTP would be the better login, and it is where this goes once a BTRC sender
 * ID is registered — but it would have blocked every other screen behind an
 * external approval with an unknown timeline. The real number is stored on the
 * profile, so that switch is a migration and not a re-signup. Teachers stay
 * exempt from it either way: §5.2 exists because so many of them have no number
 * to send an OTP to.
 */
export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    signIn,
    null,
  )

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}

      {state?.error && !state.field && <Alert>{state.error}</Alert>}

      <Field
        label="মোবাইল নম্বর বা ইউজারনেম"
        // The example belongs in the hint, not the placeholder: a placeholder
        // showing only a number reads as "numbers only" to the one teacher on
        // this screen who does not have one.
        hint="যেমন ০১৭১২৩৪৫৬৭৮, বা rahim"
        name="identifier"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        autoFocus
        error={state?.field === 'identifier' ? state.error : undefined}
      />

      <Field
        label="পাসওয়ার্ড"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={state?.field === 'password' ? state.error : undefined}
      />

      <Button type="submit" full disabled={pending}>
        {pending ? 'অপেক্ষা করুন…' : 'লগইন করুন'}
      </Button>

      <p className="text-center text-ink-soft">
        অ্যাকাউন্ট নেই?{' '}
        <Link href="/signup" className="font-semibold text-brand-700 underline">
          নতুন অ্যাকাউন্ট খুলুন
        </Link>
      </p>

      <p className="text-center text-sm text-ink-faint">
        পাসওয়ার্ড ভুলে গেলে আপনার কোচিংয়ের মালিককে বলুন — তিনি নতুন পাসওয়ার্ড
        দিতে পারবেন।
      </p>
    </form>
  )
}
