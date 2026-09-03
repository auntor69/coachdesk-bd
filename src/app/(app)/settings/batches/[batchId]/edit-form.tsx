'use client'

/**
 * Changing a batch that already exists.
 *
 * The same fields in the same order as the create form, because it is the same batch
 * and an owner who has filled one in should not have to re-find anything in the
 * other. Two things are only here: the switch that closes a batch, and the line under
 * the subject saying what changing it does to marks already taken.
 *
 * MOVING A BATCH TO ANOTHER BUILDING IS THE THIRD, and the branch field rides along in a
 * hidden input for the readers it does not ask — the same shape as `teacherId` below and
 * a stricter reason: a manager pinned to one building cannot write "no building" at all,
 * so a form that submitted nothing would fail their ordinary corrections outright. See
 * BranchPicker.
 *
 * TWO COLUMNS FROM `xl` (§20.8.11), the same two as the create form: what the batch is
 * on the left, when it meets and what it costs on the right. Field for field the same
 * order as well, which is the promise the first paragraph makes.
 */
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'

import { BranchPicker } from '@/components/branch-picker'
import { Alert, Button, Field } from '@/components/ui'
import type { BranchChoice } from '@/lib/branches'
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
  /** Null is head office, and a real answer — see the student form's own note. */
  branchId: string | null
  days: number[]
}

export function BatchEditForm({
  t,
  common,
  branchPick,
  branches,
  batch,
  subjects,
  teachers,
  slots,
  days: dayOptions,
}: {
  t: T<'batchForm'>
  common: T<'common'>
  branchPick: T<'branchPick'>
  /** `null` draws no branch field — see branchChoicesFor. */
  branches: BranchChoice[] | null
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
    <form action={formAction} className="flex max-w-xl flex-col gap-4 xl:max-w-none">
      {/* Capped where the form is not — see the create form's own. */}
      {state?.error && (
        <div className="max-w-2xl">
          <Alert>{state.error}</Alert>
        </div>
      )}

      <input type="hidden" name="batchId" value={batch.id} />

      <div
        className="flex flex-col gap-4 xl:grid xl:grid-cols-12 xl:items-start
          xl:gap-x-6 xl:gap-y-4"
      >
        <div className="flex flex-col gap-4 xl:col-span-6">
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

          {/* Where the create form puts it, with the time rather than the subject:
              §8.4's "rooms and timetables are physical and do not pool". Moving a batch
              takes its register, its marks and its enrolments with it, because none of
              those carry a building of their own — see `updateBatch`. */}
          <BranchPicker t={branchPick} branches={branches} current={batch.branchId} />
        </div>

        <div className="flex flex-col gap-4 xl:col-span-6">

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
            <Field
              label={t.end}
              name="endTime"
              type="time"
              defaultValue={batch.endTime}
            />
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

          {/* Last in its column, because it is the one control here that changes what
              other screens show — on a phone an owner reaching the save button has
              scrolled past it, and on a desktop it is the last thing above it. */}
          <label
            className="flex min-h-tap cursor-pointer items-start gap-3 rounded-xl
              border-2 border-line bg-white px-4 py-3 has-[:checked]:border-brand-600
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
        </div>
      </div>

      {/* Under both columns — see the create form's own. */}
      <Button
        type="submit"
        full
        disabled={pending}
        className="sm:w-auto sm:self-start"
      >
        {pending ? common.saving : common.save}
      </Button>
    </form>
  )
}
