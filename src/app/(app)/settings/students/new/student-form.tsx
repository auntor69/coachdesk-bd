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
import { createStudent, type ActionState } from '../../actions'
import { MAX_NAME } from '@/lib/limits'

type BatchOption = { id: string; label: string }

export function StudentForm({ batches }: { batches: BatchOption[] }) {
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
        label="শিক্ষার্থীর নাম"
        name="name"
        placeholder="রাফিদ হাসান"
        required
        maxLength={MAX_NAME}
        autoComplete="off"
      />

      <div>
        <Field
          label="অভিভাবকের মোবাইল"
          hint="ফলাফল আর ফির SMS এই নম্বরে যাবে"
          name="guardianPhone"
          type="tel"
          inputMode="numeric"
          placeholder="01712345678"
          required
          value={guardianPhone}
          onChange={(e) => setGuardianPhone(e.target.value)}
          error={showEcho && !normalized ? 'নম্বরটি ঠিক নেই' : undefined}
        />
        {showEcho && normalized && (
          <p className="num mt-1 text-sm font-medium text-brand-700">
            {formatBdMobile(normalized)} ✓
          </p>
        )}
      </div>

      <Field
        label="অভিভাবকের নাম (ঐচ্ছিক)"
        name="guardianName"
        placeholder="মোঃ কামাল হোসেন"
        maxLength={MAX_NAME}
        autoComplete="off"
      />

      {batches.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium text-ink">কোন ব্যাচে</legend>
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
          আরও তথ্য (ঐচ্ছিক)
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <Field
            label="শিক্ষার্থীর নিজের মোবাইল"
            name="phone"
            type="tel"
            inputMode="numeric"
            placeholder="01812345678"
          />
          <Field
            label="স্কুল / কলেজ"
            name="institution"
            placeholder="ঢাকা কলেজ"
            maxLength={MAX_NAME}
          />
          <Field label="শ্রেণি" name="classLevel" placeholder="HSC ২য় বর্ষ" maxLength={40} />
          <Field
            label="আইডি নম্বর"
            hint="সেন্টারের নিজের রোল বা আইডি, থাকলে"
            name="studentCode"
            placeholder="২০২৬-০৪১"
            maxLength={40}
          />
        </div>
      </details>

      <Button type="submit" full disabled={pending}>
        {pending ? 'যোগ হচ্ছে…' : 'শিক্ষার্থী যোগ করুন'}
      </Button>
    </form>
  )
}
