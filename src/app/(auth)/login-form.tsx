'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { signIn, type FormState } from './actions'
import { Alert, Button, Field } from '@/components/ui'

/**
 * One box for who you are, then a password. No OTP at login.
 *
 * The box takes an email, a mobile number *or* a username, because
 * MASTERPLAN.md §5.3 will not have a radio button or a second tab here — the
 * server tells the three apart by their shape (see loginEmailFor). What that
 * costs is the full keyboard: an `inputMode` narrow enough to hide letters
 * would hide a username, and everybody gets the same box. Owners pay for it
 * once per device with a saved password; a teacher who could not type their
 * username at all would simply be locked out.
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
        label="ইমেইল, মোবাইল নম্বর বা ইউজারনেম"
        // The examples belong in the hint, not the placeholder: one example
        // alone reads as "this kind only" to whoever is holding the other two.
        hint="যেমন name@gmail.com, ০১৭১২৩৪৫৬৭৮, বা rahim"
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
