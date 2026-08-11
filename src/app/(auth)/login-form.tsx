'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { signIn, type FormState } from './actions'
import { Alert, Button, Field } from '@/components/ui'

/**
 * Phone + password. No email, no OTP.
 *
 * OTP would be the better login, and it is where this goes once a BTRC sender
 * ID is registered — but it would have blocked every other screen behind an
 * external approval with an unknown timeline. The real number is stored on the
 * profile, so that switch is a migration and not a re-signup.
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
        label="মোবাইল নম্বর"
        name="phone"
        // tel, not number: number strips leading zeros and shows a spinner.
        type="tel"
        inputMode="numeric"
        autoComplete="username"
        placeholder="০১৭১২৩৪৫৬৭৮"
        required
        autoFocus
        error={state?.field === 'phone' ? state.error : undefined}
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
