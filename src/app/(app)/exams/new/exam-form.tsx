'use client'

/**
 * Creating an exam.
 *
 * Four fields, because a teacher does this standing in a classroom between two
 * batches. Everything else about an exam — which students, which subject — is
 * already known from the batch, so asking for it again would be asking a teacher
 * to re-enter what the app can look up.
 */
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'

import { Alert, Button, Field } from '@/components/ui'
import { createExam, type CreateExamState } from '../actions'

type Option = { id: string; label: string }

export function ExamForm({
  batches,
  examTypes,
  today,
}: {
  batches: Option[]
  examTypes: Option[]
  today: string
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<CreateExamState, FormData>(
    async (prev, formData) => {
      const result = await createExam(prev, formData)
      // Straight to the marks sheet. Creating an exam is never the goal; the
      // goal is entering marks, and a teacher who has to find the exam again
      // in a list has been made to do the app's work.
      if (result?.ok) router.push(`/exams/${result.examId}`)
      return result
    },
    null,
  )

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.ok === false && <Alert>{state.error}</Alert>}

      <Field
        label="পরীক্ষার নাম"
        name="title"
        placeholder="সাপ্তাহিক পরীক্ষা"
        required
        maxLength={80}
        autoComplete="off"
      />

      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">ব্যাচ</span>
        <select
          name="batchId"
          required
          defaultValue={batches.length === 1 ? batches[0].id : ''}
          className="min-h-tap rounded-xl border-2 border-line bg-white px-4
            text-base outline-none focus:border-brand-500"
        >
          <option value="" disabled>
            ব্যাচ বাছুন
          </option>
          {batches.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.label}
            </option>
          ))}
        </select>
      </label>

      {examTypes.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-ink">ধরন (ঐচ্ছিক)</span>
          <select
            name="examTypeId"
            defaultValue=""
            className="min-h-tap rounded-xl border-2 border-line bg-white px-4
              text-base outline-none focus:border-brand-500"
          >
            <option value="">—</option>
            {examTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="পূর্ণমান"
          name="totalMarks"
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          step="0.5"
          defaultValue={100}
          required
          className="num"
        />
        <Field
          label="পাস নম্বর"
          hint="ঐচ্ছিক"
          name="passMarks"
          type="number"
          inputMode="numeric"
          min={0}
          step="0.5"
          className="num"
        />
      </div>

      <Field
        label="পরীক্ষার তারিখ"
        name="examDate"
        type="date"
        defaultValue={today}
        required
        className="num"
      />

      <Button type="submit" full disabled={pending}>
        {pending ? 'তৈরি হচ্ছে…' : 'পরীক্ষা তৈরি করে নম্বর দিন'}
      </Button>
    </form>
  )
}
