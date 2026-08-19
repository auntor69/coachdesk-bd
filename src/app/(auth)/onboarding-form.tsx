'use client'

import { useActionState, useState } from 'react'

import { createCenter, type FormState } from './actions'
import { Alert, Button, Field } from '@/components/ui'
import { MAX_NAME } from '@/lib/limits'

/**
 * The one irreversible-feeling choice in the product, so it is asked plainly
 * and framed by who the person is rather than by what the software does.
 *
 * Both modes create the same center row. The difference is only whether the
 * signup also becomes a teacher of it — but "am I alone or do I have staff" is
 * a question anyone can answer instantly, and "should you be in the teachers
 * table" is not.
 */
const MODES = [
  {
    id: 'teacher',
    title: 'আমি একা পড়াই',
    body: 'নিজের ব্যাচ, নিজের শিক্ষার্থী। হাজিরা আর ফলাফল আপনিই নেবেন।',
    nameLabel: 'আপনার কোচিং/ব্যাচের নাম',
    namePlaceholder: 'রফিক স্যারের গণিত',
  },
  {
    id: 'center',
    title: 'আমার কোচিং সেন্টার আছে',
    body: 'একাধিক শিক্ষক ও ব্যাচ। আপনি মালিক হিসেবে সব দেখবেন।',
    nameLabel: 'কোচিং সেন্টারের নাম',
    namePlaceholder: 'উত্তরা আইডিয়াল কোচিং',
  },
] as const

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createCenter,
    null,
  )
  const [mode, setMode] = useState<'teacher' | 'center'>('teacher')

  const selected = MODES.find((m) => m.id === mode)!

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="mode" value={mode} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-semibold text-ink">
          আপনি কোনটি?
        </legend>

        {MODES.map((option) => {
          const active = option.id === mode
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer gap-3 rounded-2xl border-2 p-4
                transition-colors ${
                  active
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-line bg-white hover:border-brand-200'
                }`}
            >
              <input
                type="radio"
                name="modeChoice"
                value={option.id}
                checked={active}
                onChange={() => setMode(option.id)}
                className="mt-1.5 h-5 w-5 shrink-0 accent-brand-600"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold text-ink">{option.title}</span>
                <span className="text-sm text-ink-soft">{option.body}</span>
              </span>
            </label>
          )
        })}
      </fieldset>

      <Field
        label={selected.nameLabel}
        name="centerName"
        placeholder={selected.namePlaceholder}
        maxLength={MAX_NAME}
        required
        error={state?.field === 'center' ? state.error : undefined}
      />

      {state?.error && !state.field && <Alert>{state.error}</Alert>}

      <Button type="submit" full disabled={pending}>
        {pending ? 'তৈরি হচ্ছে…' : 'শুরু করুন'}
      </Button>

      <p className="text-center text-sm text-ink-faint">
        পরে নাম বদলাতে পারবেন। শিক্ষক যোগ করলে এটি সেন্টার হয়ে যাবে।
      </p>
    </form>
  )
}
