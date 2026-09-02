'use client'

/**
 * Adding a student.
 *
 * The guardian's mobile number is required and validated, because it is the
 * entire delivery channel for results and fee reminders. A student added with a
 * mistyped number looks completely fine until a month later, when the parent
 * says they never heard anything — so the number is checked at the point of
 * entry, and echoed back in the format Bangladeshis actually read.
 *
 * EVERY FIELD IS CONTROLLED, AND THAT IS NOT A STYLE CHOICE. React 19 wraps a form
 * action as `requestFormReset(form); return action(formData)` — unconditionally, and
 * before the action runs — and the commit calls the native `form.reset()`. So each
 * refusal used to wipe the name, the guardian's name, the batch ticks and the four
 * optional fields, on the most-used write form in the product: a mistyped mobile number
 * cost an owner the whole record with a family standing at the desk. §20.5 asks for the
 * opposite ("the work in hand is not lost"), and the only way to have it is to hold the
 * values in React, where `updateInput` mirrors each one into the DOM's `defaultValue`
 * every commit — which is exactly what `reset()` restores.
 *
 * A TICK IS NOT A TEXT FIELD, though. React only writes `defaultChecked` at mount, so a
 * controlled checkbox is cleared by the same reset while React state still says it is
 * ticked — and it is the DOM that gets posted, so the next submit would quietly file the
 * student into no batch at all. Hence `attempt`: a refusal remounts the ticks and the
 * branch select, which re-writes their defaults from the values that were kept.
 */
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'

import { BranchPicker } from '@/components/branch-picker'
import { Alert, Button, Field } from '@/components/ui'
import { formatBdMobile, normalizeBdMobile } from '@/lib/bd/phone'
import type { BranchChoice } from '@/lib/branches'
import type { T } from '@/lib/i18n'
import { createStudent, type ActionState } from '../../actions'
import { MAX_NAME, MAX_LABEL } from '@/lib/limits'

type BatchOption = { id: string; label: string }

/** What the reader has typed. One object, so the setters are one line each. */
const EMPTY = {
  name: '',
  guardianPhone: '',
  guardianName: '',
  phone: '',
  institution: '',
  classLevel: '',
  studentCode: '',
}

export function StudentForm({
  t,
  common,
  batches,
  branchPick,
  branches,
}: {
  t: T<'studentForm'>
  common: T<'common'>
  /** `null` is the list that could not be read — see the aside below the ticks. */
  batches: BatchOption[] | null
  branchPick: T<'branchPick'>
  /** `null` draws no branch field at all — see branchChoicesFor. */
  branches: BranchChoice[] | null
}) {
  const router = useRouter()
  const [fields, setFields] = useState(EMPTY)
  const [batchIds, setBatchIds] = useState<string[]>([])
  const [branchId, setBranchId] = useState<string | null>(null)
  // Bumped on a refusal only, because it costs a remount: see the head of this file.
  const [attempt, setAttempt] = useState(0)

  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await createStudent(prev, formData)
      if (result?.ok) router.push('/settings/students')
      else setAttempt((n) => n + 1)
      return result
    },
    null,
  )

  const set = (key: keyof typeof EMPTY, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }))

  const normalized = normalizeBdMobile(fields.guardianPhone)
  const showEcho = fields.guardianPhone.trim().length > 0

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
        value={fields.name}
        onChange={(e) => set('name', e.target.value)}
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
          value={fields.guardianPhone}
          onChange={(e) => set('guardianPhone', e.target.value)}
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
        value={fields.guardianName}
        onChange={(e) => set('guardianName', e.target.value)}
      />

      {/* Before the batches and not after, because it is the wider question: a batch is
          a room in a building, so an owner who has decided the building has narrowed
          which classes make sense. Draws nothing for all but the head office of an
          institution. */}
      {/* `current={branchId}`, which starts null: a form that has no row yet has no
          building to keep, and null is head office, which is where a single-building
          centre files everything. After a refusal it is the choice that was made. */}
      <BranchPicker
        key={attempt}
        t={branchPick}
        branches={branches}
        current={branchId}
        onPick={setBranchId}
      />

      {/* A line where the ticks would be, when the list of batches could not be read.

          Said rather than left blank, and the form still submits: these ticks are
          optional even when they are drawn, and a student on the roster with no batch
          is a state the roster already names and filters for. But no batch is no
          attendance and no fee bill, so an owner who was never told the list was
          missing would meet this student's absence in September, on the fee board.

          Not a refusal, and not the current value carried through in a hidden field
          either — there is no current value on a form that is creating the row. */}
      {batches === null ? (
        <p className="text-sm text-ink-soft">{t.batchesUnreadable}</p>
      ) : (
        batches.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium text-ink">{t.whichBatch}</legend>
            <div key={attempt} className="flex flex-col gap-2">
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
                    checked={batchIds.includes(batch.id)}
                    onChange={(e) =>
                      setBatchIds((prev) =>
                        e.target.checked
                          ? [...prev, batch.id]
                          : prev.filter((id) => id !== batch.id),
                      )
                    }
                    className="h-5 w-5 shrink-0 accent-brand-600"
                  />
                  <span className="min-w-0 truncate text-ink">{batch.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )
      )}

      {/* No `open` prop: reset() leaves a details element alone, so a section the reader
          opened to type a student code is still open under the refusal that names it. */}
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
            value={fields.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
          <Field
            label={t.institution}
            name="institution"
            placeholder={t.institutionPlaceholder}
            maxLength={MAX_NAME}
            value={fields.institution}
            onChange={(e) => set('institution', e.target.value)}
          />
          <Field
            label={t.classLevel}
            name="classLevel"
            placeholder={t.classPlaceholder}
            maxLength={MAX_LABEL}
            value={fields.classLevel}
            onChange={(e) => set('classLevel', e.target.value)}
          />
          <Field
            label={t.code}
            hint={t.codeHint}
            name="studentCode"
            placeholder={t.codePlaceholder}
            maxLength={MAX_LABEL}
            value={fields.studentCode}
            onChange={(e) => set('studentCode', e.target.value)}
          />
        </div>
      </details>

      <Button type="submit" full disabled={pending}>
        {pending ? common.adding : t.submit}
      </Button>
    </form>
  )
}
