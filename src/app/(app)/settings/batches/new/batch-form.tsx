'use client'

/**
 * Creating a batch: the one setup form that has to be right.
 *
 * A batch is where a subject, a teacher, a time, and a fee meet, and everything
 * downstream — today's class list, attendance, marks, invoices — reads from it.
 * The form is long because the thing is genuinely compound; what it must not be
 * is ambiguous, so every field says what it affects.
 */
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Alert, Button, Field } from '@/components/ui'
import { createBatch, type ActionState } from '../../actions'

type Option = { id: string; label: string }

/**
 * 0=Sunday to match Postgres extract(dow) and dhakaDayOfWeek(). Ordered
 * Saturday-first because that is how a Bangladeshi week reads — Friday and
 * Saturday are the weekend, and Saturday is the first working day.
 */
const DAYS = [
  { value: 6, label: 'শনি' },
  { value: 0, label: 'রবি' },
  { value: 1, label: 'সোম' },
  { value: 2, label: 'মঙ্গল' },
  { value: 3, label: 'বুধ' },
  { value: 4, label: 'বৃহঃ' },
  { value: 5, label: 'শুক্র' },
]

const SLOTS = [
  { value: 'morning', label: 'সকাল' },
  { value: 'noon', label: 'দুপুর' },
  { value: 'afternoon', label: 'বিকাল' },
  { value: 'evening', label: 'সন্ধ্যা' },
  { value: 'night', label: 'রাত' },
]

export function BatchForm({
  subjects,
  teachers,
}: {
  subjects: Option[]
  teachers: Option[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await createBatch(prev, formData)
      // Navigating on success rather than redirecting inside the action: the
      // action's error path has to be able to return a message to this form,
      // and a redirect throws.
      if (result?.ok) router.push('/settings/batches')
      return result
    },
    null,
  )

  const [days, setDays] = useState<number[]>([])

  function toggleDay(value: number) {
    setDays((current) =>
      current.includes(value)
        ? current.filter((d) => d !== value)
        : [...current, value],
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && <Alert>{state.error}</Alert>}

      <Field
        label="ব্যাচের নাম"
        hint="যেমন: সকাল ৭টা — HSC গণিত"
        name="name"
        placeholder="সকাল ৭টা — HSC গণিত"
        required
        maxLength={80}
      />

      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">বিষয়</span>
        <select
          name="subjectId"
          required
          defaultValue=""
          className="min-h-tap rounded-xl border-2 border-line bg-white px-4
            text-base outline-none focus:border-brand-500"
        >
          <option value="" disabled>
            বিষয় বাছুন
          </option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.label}
            </option>
          ))}
        </select>
        {subjects.length === 0 && (
          <span className="text-sm text-absent">
            আগে অন্তত একটি বিষয় যোগ করুন।
          </span>
        )}
      </label>

      {teachers.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-ink">শিক্ষক (ঐচ্ছিক)</span>
          <select
            name="teacherId"
            defaultValue=""
            className="min-h-tap rounded-xl border-2 border-line bg-white px-4
              text-base outline-none focus:border-brand-500"
          >
            <option value="">পরে ঠিক করব</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium text-ink">কোন বেলা</legend>
        <div className="flex flex-wrap gap-2">
          {SLOTS.map((slot, index) => (
            <label key={slot.value} className="cursor-pointer">
              <input
                type="radio"
                name="slot"
                value={slot.value}
                defaultChecked={index === 0}
                className="peer sr-only"
              />
              <span
                className="inline-flex min-h-tap items-center rounded-xl border-2
                  border-line bg-white px-4 font-medium text-ink-soft
                  peer-checked:border-brand-600 peer-checked:bg-brand-50
                  peer-checked:text-brand-800"
              >
                {slot.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Field label="শুরু" name="startTime" type="time" defaultValue="07:00" />
        <Field label="শেষ" name="endTime" type="time" defaultValue="08:30" />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium text-ink">কোন দিন ক্লাস</legend>
        <p className="-mt-1 mb-1 text-sm text-ink-soft">
          কিছু না বাছলে প্রতিদিনের ক্লাস ধরা হবে
        </p>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((day) => {
            const on = days.includes(day.value)
            return (
              <button
                key={day.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(day.value)}
                className={`min-h-tap rounded-xl border-2 px-4 font-medium
                  transition-colors ${
                    on
                      ? 'border-brand-600 bg-brand-50 text-brand-800'
                      : 'border-line bg-white text-ink-soft'
                  }`}
              >
                {day.label}
              </button>
            )
          })}
        </div>
        {days.map((day) => (
          <input key={day} type="hidden" name="days" value={day} />
        ))}
      </fieldset>

      <Field
        label="মাসিক ফি (৳)"
        hint="এই ব্যাচের প্রতি মাসের ফি। পরে বদলালে পুরোনো বিল বদলাবে না।"
        name="monthlyFee"
        type="number"
        inputMode="numeric"
        min={0}
        step={10}
        defaultValue={0}
      />

      <Button type="submit" full disabled={pending || subjects.length === 0}>
        {pending ? 'তৈরি হচ্ছে…' : 'ব্যাচ তৈরি করুন'}
      </Button>
    </form>
  )
}
