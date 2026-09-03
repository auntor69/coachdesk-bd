'use client'

/**
 * Creating a batch: the one setup form that has to be right.
 *
 * A batch is where a subject, a teacher, a time, and a fee meet, and everything
 * downstream — today's class list, attendance, marks, invoices — reads from it.
 * The form is long because the thing is genuinely compound; what it must not be
 * is ambiguous, so every field says what it affects.
 *
 * TWO COLUMNS FROM `xl`, CAPPED BELOW IT (§20.8.11). Nine fields down a 1,216px page is
 * a phone form stretched to fit — a name box a hand wide, a save button two screens
 * under it. What the batch *is* goes left (name, subject, teacher, building) and when
 * it meets and what it costs go right. The order is unchanged either way, so the phone
 * loses nothing and the edit form beside it still matches field for field.
 */
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'

import { BranchPicker } from '@/components/branch-picker'
import { Alert, Button, Field } from '@/components/ui'
import type { BranchChoice } from '@/lib/branches'
import type { T } from '@/lib/i18n'
import { createBatch, type ActionState } from '../../actions'
import { MAX_NAME } from '@/lib/limits'

type Option = { id: string; label: string }

export function BatchForm({
  t,
  common,
  subjects,
  teachers,
  slots,
  days: dayOptions,
  branchPick,
  branches,
}: {
  t: T<'batchForm'>
  common: T<'common'>
  subjects: Option[]
  teachers: Option[]
  /**
   * The parts of the day and the days of the week, already named by `lib/bd` on
   * the server. They arrive as labelled values rather than being looked up here
   * so that the picker and the row it creates cannot drift apart, and so that
   * `lib/bd/time`'s tables stay out of this bundle.
   *
   * Day values are Sunday-based to match Postgres `extract(dow)`; the order they
   * arrive in is Saturday-first, which is how a Bangladeshi week reads.
   */
  slots: { value: string; label: string }[]
  days: { value: number; label: string }[]
  branchPick: T<'branchPick'>
  /** `null` draws no branch field at all — see branchChoicesFor. */
  branches: BranchChoice[] | null
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
    <form action={formAction} className="flex max-w-xl flex-col gap-4 xl:max-w-none">
      {/* Capped where the form is not: a refusal is a sentence, and a sentence the
          width of a desktop is one nobody finds the end of. */}
      {state?.error && (
        <div className="max-w-2xl">
          <Alert>{state.error}</Alert>
        </div>
      )}

      <div
        className="flex flex-col gap-4 xl:grid xl:grid-cols-12 xl:items-start
          xl:gap-x-6 xl:gap-y-4"
      >
        <div className="flex flex-col gap-4 xl:col-span-6">
          <Field
            label={t.nameLabel}
            hint={t.nameHint}
            name="name"
            placeholder={t.nameHint}
            required
            maxLength={MAX_NAME}
          />

          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-ink">{t.subject}</span>
            <select
              name="subjectId"
              required
              defaultValue=""
              className="min-h-tap rounded-xl border-2 border-line bg-white px-4
                text-base outline-none focus:border-brand-500"
            >
              <option value="" disabled>
                {t.pickSubject}
              </option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.label}
                </option>
              ))}
            </select>
            {subjects.length === 0 && (
              <span className="text-sm text-absent">{t.needSubject}</span>
            )}
          </label>

          {teachers.length > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="font-medium text-ink">
                {t.teacher} ({common.optional})
              </span>
              <select
                name="teacherId"
                defaultValue=""
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
          )}

          {/* With the time and not with the subject, because it is the same kind of
              fact: §8.4's "rooms and timetables are physical and do not pool". Draws
              nothing for all but the head office of an institution. It stays in this
              column all the same — a building is what the batch is, not when. */}
          <BranchPicker t={branchPick} branches={branches} current={null} />
        </div>

        <div className="flex flex-col gap-4 xl:col-span-6">

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium text-ink">{t.whichSlot}</legend>
            <div className="flex flex-wrap gap-2">
              {slots.map((slot, index) => (
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
            <Field label={t.start} name="startTime" type="time" defaultValue="07:00" />
            <Field label={t.end} name="endTime" type="time" defaultValue="08:30" />
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
            defaultValue={0}
          />
        </div>
      </div>

      {/* Under both columns, not under one of them: it is the answer to the whole
          form. Its own size from `sm`, because a 1,216px button is a banner. */}
      <Button
        type="submit"
        full
        disabled={pending || subjects.length === 0}
        className="sm:w-auto sm:self-start"
      >
        {pending ? common.creating : t.submit}
      </Button>
    </form>
  )
}
