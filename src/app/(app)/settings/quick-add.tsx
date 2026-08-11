'use client'

/**
 * The add-a-thing form that subjects and exam types share.
 *
 * Both are a name plus an optional Bangla name, and both are entered in bursts —
 * an owner setting up sits down and adds six subjects at once. So the form stays
 * on screen after a successful save and clears itself, rather than navigating
 * away and making them find it again.
 */
import { useActionState, useEffect, useRef } from 'react'

import { Alert, Button, Field } from '@/components/ui'
import type { ActionState } from './actions'

export function QuickAdd({
  action,
  label,
  hint,
  placeholder,
  placeholderBn,
  children,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>
  label: string
  hint?: string
  placeholder: string
  placeholderBn: string
  children?: React.ReactNode
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    null,
  )
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.ok) formRef.current?.reset()
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-5"
    >
      {state?.error && <Alert>{state.error}</Alert>}
      {state?.ok && (
        <p role="status" className="font-medium text-brand-700">
          {state.ok} ✓
        </p>
      )}

      <Field
        label={label}
        hint={hint}
        name="name"
        placeholder={placeholder}
        required
        maxLength={80}
      />
      <Field
        label="বাংলা নাম (ঐচ্ছিক)"
        name="nameBn"
        placeholder={placeholderBn}
        maxLength={80}
      />

      {children}

      <Button type="submit" disabled={pending} full>
        {pending ? 'যোগ হচ্ছে…' : 'যোগ করুন'}
      </Button>
    </form>
  )
}
