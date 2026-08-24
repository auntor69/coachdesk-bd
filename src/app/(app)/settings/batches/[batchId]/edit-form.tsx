'use client'

/**
 * Changing a batch that already exists.
 *
 * The same fields in the same order as the create form, because it is the same batch
 * and an owner who has filled one in should not have to re-find anything in the
 * other. Two things are only here: the switch that closes a batch, and the line under
 * the subject saying what changing it does to marks already taken.
 */
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Alert, Button, Field } from '@/components/ui'
import type { T } from '@/lib/i18n'
import { updateBatch, type ActionState } from '../../actions'
import { MAX_NAME } from '@/lib/limits'

type Option = { id: string; label: string }

type BatchValues = {
  id: string
  name: string
  subjectId: string
  teacherId: string
  slot: string
  startTime: string
  endTime: string
  fee: number
  active: boolean
  days: number[]
}

export function BatchEditForm({
  t,
  common,
  batch,
  subjects,
  teachers,
  slots,
  days: dayOptions,
}: {
  t: T<'batchForm'>
  common: T<'common'>
  batch: BatchValues
  subjects: Option[]
  teachers: Option[]
  /** Labelled on the server, for the reason the create form's own note gives. */
  slots: { value: string; label: string }[]
  days: { value: number; label: string }[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await updateBatch(prev, formData)
      if (result?.ok) router.push('/settings/batches')
      return result
    },
    null,
  )

  const [days, setDays] = useState<number[]>(batch.days)

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

      <input type="hidden" name="batchId" value={batch.id} />

      <Field
        label={t.nameLabel}
        hint={t.nameHint}
        name="name"
        required
        defaultValue={batch.name}
        maxLength={MAX_NAME}
      />

      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">{t.subject}</span>
        <span className="text-sm text-ink-soft">{t.subjectHint}</span>
        <select
          name="subjectId"
          required
          defaultValue={batch.subjectId}
          className="min-h-tap rounded-xl border-2 border-line bg-white px-4
            text-base outline-none focus:border-brand-500"
        >
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.label}
            </option>
          ))}
        </select>
      </label>

      {teachers.length > 0 ? (
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-ink">
            {t.teacher} ({common.optional})
          </span>
          <select
            name="teacherId"
            defaultValue={batch.teacherId}
            className="min-h-tap rounded-xl border-2 border-line bg-white px-4
              text-base outline-none focus:border-brand-500"
          >
            <option value="">{t.teacherLater}</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        // No picker on a one-teacher plan, and therefore no answer to submit. The
        // current value rides along instead, because a save that quietly cleared
        // teacher_id would take the batch off its own teacher's list.
        <input type="hidden" name="teacherId" value={batch.teacherId} />
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium text-ink">{t.whichSlot}</legend>
        <div className="flex flex-wrap gap-2">
          {slots.map((slot) => (
            <label key={slot.value} className="cursor-pointer">
              <input
                type="radio"
                name="slot"
                value={slot.value}
                defaultChecked={slot.value === batch.slot}
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
        <Field
          label={t.start}
          name="startTime"
          type="time"
          defaultValue={batch.startTime}
        />
        <Field label={t.end} name="endTime" type="time" defaultValue={batch.endTime} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium text-ink">{t.whichDays}</legend>
        <p className="-mt-1 mb-1 text-sm text-ink-soft">{t.daysHint}</p>
        <div className="flex flex-wrap gap-2">
          {dayOptions.map((day) => {
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
        label={t.feeLabel}
        hint={t.feeHint}
        name="monthlyFee"
        type="number"
        inputMode="numeric"
        min={0}
        step={10}
        defaultValue={batch.fee}
      />

      {/* Last, because it is the one control here that changes what other screens
          show, and because an owner scrolling to the save button should pass it. */}
      <label
        className="flex min-h-tap cursor-pointer items-start gap-3 rounded-xl border-2
          border-line bg-white px-4 py-3 has-[:checked]:border-brand-600
          has-[:checked]:bg-brand-50"
      >
        <input
          type="checkbox"
          name="active"
          defaultChecked={batch.active}
          className="mt-1 h-5 w-5 shrink-0 accent-brand-600"
        />
        <span className="min-w-0">
          <span className="block font-medium text-ink">{t.runningLabel}</span>
          <span className="block text-sm text-ink-soft">{t.runningHint}</span>
        </span>
      </label>

      <Button type="submit" full disabled={pending}>
        {pending ? common.saving : common.save}
      </Button>
    </form>
  )
}
