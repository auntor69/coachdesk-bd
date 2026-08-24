'use client'

/**
 * Changing a student who is already on the roster.
 *
 * Deliberately the same fields in the same order as the add form, because it is the
 * same information and an owner who has typed one should not have to re-find
 * anything in the other. The differences are the two things only an edit can do:
 * the status, and batches that come off as well as on.
 *
 * The status drives the batch list's visibility rather than the server deciding
 * quietly. A student who has left is not in any batch, so offering the checkboxes
 * beside "left" would be offering a contradiction — and an owner who ticked one and
 * saved anyway would have to be told why it did not take. Hiding them says it first.
 */
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Alert, Button, Field } from '@/components/ui'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import type { T } from '@/lib/i18n'
import type { StudentStatus } from '@/lib/supabase/types'
import { updateStudent, STUDENT_STATUSES, type ActionState } from '../../actions'
import { MAX_NAME, MAX_LABEL } from '@/lib/limits'

type BatchOption = { id: string; label: string }

type StudentValues = {
  id: string
  name: string
  status: StudentStatus
  code: string
  phone: string
  guardianName: string
  guardianPhone: string
  institution: string
  classLevel: string
  batchIds: string[]
}

export function StudentEditForm({
  t,
  common,
  student,
  batches,
}: {
  t: T<'studentForm'>
  common: T<'common'>
  student: StudentValues
  batches: BatchOption[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await updateStudent(prev, formData)
      if (result?.ok) router.push('/settings/students')
      return result
    },
    null,
  )

  const [guardianPhone, setGuardianPhone] = useState(student.guardianPhone)
  const [status, setStatus] = useState<StudentStatus>(student.status)
  const normalized = normalizeBdMobile(guardianPhone)
  const showEcho = guardianPhone.trim().length > 0

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && <Alert>{state.error}</Alert>}

      <input type="hidden" name="studentId" value={student.id} />

      <Field
        label={t.nameLabel}
        name="name"
        placeholder={t.namePlaceholder}
        required
        defaultValue={student.name}
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
        defaultValue={student.guardianName}
        maxLength={MAX_NAME}
        autoComplete="off"
      />

      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">{t.statusLabel}</span>
        <span className="text-sm text-ink-soft">{t.statusHint}</span>
        <select
          name="status"
          value={status}
          onChange={(e) => setStatus(e.target.value as StudentStatus)}
          className="min-h-tap rounded-xl border-2 border-line bg-white px-4
            text-base outline-none focus:border-brand-500"
        >
          {STUDENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t.status[value]}
            </option>
          ))}
        </select>
      </label>

      {/* The boxes go with the student, so they are gone once the student is. The
          server ignores them at any non-active status anyway — this is the same
          decision said out loud, one step earlier. */}
      {status === 'active' && batches.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium text-ink">{t.whichBatch}</legend>
          <p className="mb-1 text-sm text-ink-soft">{t.batchHint}</p>
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
                  defaultChecked={student.batchIds.includes(batch.id)}
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
            defaultValue={student.phone}
          />
          <Field
            label={t.institution}
            name="institution"
            placeholder={t.institutionPlaceholder}
            defaultValue={student.institution}
            maxLength={MAX_NAME}
          />
          <Field
            label={t.classLevel}
            name="classLevel"
            placeholder={t.classPlaceholder}
            defaultValue={student.classLevel}
            maxLength={MAX_LABEL}
          />
          <Field
            label={t.code}
            hint={t.codeHint}
            name="studentCode"
            placeholder={t.codePlaceholder}
            defaultValue={student.code}
            maxLength={MAX_LABEL}
          />
        </div>
      </details>

      <Button type="submit" full disabled={pending}>
        {pending ? common.saving : common.save}
      </Button>
    </form>
  )
}
