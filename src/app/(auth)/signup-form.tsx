'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { signUp, type FormState } from './actions'
import { Alert, Button, Field } from '@/components/ui'

export function SignupForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    signUp,
    null,
  )

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && !state.field && <Alert>{state.error}</Alert>}

      <Field
        label="আপনার নাম"
        name="name"
        autoComplete="name"
        placeholder="মোঃ রফিকুল ইসলাম"
        required
        autoFocus
        error={state?.field === 'name' ? state.error : undefined}
      />

      <Field
        label="মোবাইল নম্বর"
        hint="এই নম্বর দিয়েই লগইন করবেন"
        name="phone"
        type="tel"
        inputMode="numeric"
        autoComplete="username"
        placeholder="০১৭১২৩৪৫৬৭৮"
        required
        error={state?.field === 'phone' ? state.error : undefined}
      />

      <Field
        label="পাসওয়ার্ড"
        hint="কমপক্ষে ৬ অক্ষর"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={6}
        required
        error={state?.field === 'password' ? state.error : undefined}
      />

      <Button type="submit" full disabled={pending}>
        {pending ? 'তৈরি হচ্ছে…' : 'অ্যাকাউন্ট খুলুন'}
      </Button>

      <p className="text-center text-ink-soft">
        আগে থেকেই অ্যাকাউন্ট আছে?{' '}
        <Link href="/login" className="font-semibold text-brand-700 underline">
          লগইন করুন
        </Link>
      </p>
    </form>
  )
}
