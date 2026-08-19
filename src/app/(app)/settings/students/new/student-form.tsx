'use client'

/**
 * Adding a student.
 *
 * The guardian's mobile number is required and validated, because it is the
 * entire delivery channel for results and fee reminders. A student added with a
 * mistyped number looks completely fine until a month later, when the parent
 * says they never heard anything — so the number is checked at the point of
 * entry, and echoed back in the format Bangladeshis actually read.
 */
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Alert, Button, Field } from '@/components/ui'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import type { T } from '@/lib/i18n'
import { createStudent, type ActionState } from '../../actions'
import { MAX_NAME, MAX_LABEL } from '@/lib/limits'

type BatchOption = { id: string; label: string }

export function StudentForm({
  t,
  common,
  batches,
}: {
  t: T<'studentForm'>
  common: T<'common'>
  batches: BatchOption[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await createStudent(prev, formData)
      if (result?.ok) router.push('/settings/students')
      return result
    },
    null,
  )

  const [guardianPhone, setGuardianPhone] = useState('')
  const normalized = normalizeBdMobile(guardianPhone)
  const showEcho = guardianPhone.trim().length > 0

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && <Alert>{state.error}</Alert>}

      <Field
        label={t.nameLabel}
        name="name"
        placeholder={t.namePlaceholder}
        required
        maxLength={MAX_NAME}
        autoComplete="off"
      />

      <div>
        <Field
          label={t.guardianPhone}
          hint={t.guardianPhoneHint}
          name="guardianPhone"
          type="tel"
          inputMode="numeric"
          placeholder="01712345678"
          required
          value={guardianPhone}
          onChange={(e) => setGuardianPhone(e.target.value)}
          error={showEcho && !normalized ? t.phoneBad : undefined}
        />
        {showEcho && normalized && (
          <p className="num mt-1 text-sm font-medium text-brand-700">
            {formatBdMobile(normalized)} ✓
          </p>
        )}
      </div>

      <Field
        label={`${t.guardianName} (${common.optional})`}
        name="guardianName"
        placeholder={t.guardianNamePlaceholder}
        maxLength={MAX_NAME}
        autoComplete="off"
      />

      {batches.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium text-ink">{t.whichBatch}</legend>
          <div className="flex flex-col gap-2">
            {batches.map((batch) => (
              <label
                key={batch.id}
                className="flex min-h-tap cursor-pointer items-center gap-3
                  rounded-xl border-2 border-line bg-white px-4
                  has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
              >
                <input
                  type="checkbox"
                  name="batchIds"
                  value={batch.id}
                  className="h-5 w-5 shrink-0 accent-brand-600"
                />
                <span className="min-w-0 truncate text-ink">{batch.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <details className="rounded-2xl border border-line bg-white p-4">
        <summary className="min-h-tap cursor-pointer font-medium text-ink-soft">
          {t.moreInfo} ({common.optional})
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <Field
            label={t.studentPhone}
            name="phone"
            type="tel"
            inputMode="numeric"
            placeholder="01812345678"
          />
          <Field
            label={t.institution}
            name="institution"
            placeholder={t.institutionPlaceholder}
            maxLength={MAX_NAME}
          />
          <Field
            label={t.classLevel}
            name="classLevel"
            placeholder={t.classPlaceholder}
            maxLength={MAX_LABEL}
          />
          <Field
            label={t.code}
            hint={t.codeHint}
            name="studentCode"
            placeholder={t.codePlaceholder}
            maxLength={MAX_LABEL}
          />
        </div>
      </details>

      <Button type="submit" full disabled={pending}>
        {pending ? common.adding : t.submit}
      </Button>
    </form>
  )
}
