'use client'

/**
 * Correcting an exam that already exists, and removing one that should not.
 *
 * Two components in one file because they are one errand — a teacher who opens this
 * screen has either mistyped something or created the exam twice, and finds out
 * which as they read it. Splitting them across files would put the answer to
 * "actually, delete it" a directory away from the form that failed to be the fix.
 *
 * The fields are `examForm`'s, label for label. The same four boxes under two
 * different names would be two things in a teacher's head instead of one.
 */
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Alert, Button, Field } from '@/components/ui'
import type { T } from '@/lib/i18n'
import { MAX_NAME } from '@/lib/limits'
import { updateExam, deleteExam, type ExamEditState } from '../../actions'

type Option = { id: string; label: string }

/** What the row holds now, ready for `defaultValue` — so `passMarks` is '' for null. */
export type ExamDefaults = {
  title: string
  examTypeId: string
  totalMarks: number
  passMarks: string
  examDate: string
}

export function EditExamForm({
  examId,
  examTypes,
  current,
  frozen,
  t,
  form,
  common,
}: {
  examId: string
  examTypes: Option[]
  current: ExamDefaults
  /** A metered send has happened, so the two figures may not move. */
  frozen: boolean
  t: T<'examEditForm'>
  form: T<'examForm'>
  common: T<'common'>
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ExamEditState, FormData>(
    async (prev, formData) => {
      const result = await updateExam(prev, formData)
      // Back to the exam and not to the list: the reader arrived from the exam, and
      // the thing they just corrected is the heading of it.
      if (result?.ok) router.push(`/exams/${examId}`)
      return result
    },
    null,
  )

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="examId" value={examId} />

      {state?.ok === false && <Alert>{state.error}</Alert>}

      <Field
        label={form.name}
        name="title"
        placeholder={form.namePlaceholder}
        defaultValue={current.title}
        required
        maxLength={MAX_NAME}
        autoComplete="off"
      />

      {/* Only when the centre has any. An exam created before the first type existed
          keeps its blank, and "—" is a legal answer either way. */}
      {examTypes.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-ink">
            {form.kind} ({common.optional})
          </span>
          <select
            name="examTypeId"
            defaultValue={current.examTypeId}
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

      {/* readOnly and not disabled, which is the whole trick of a frozen figure: a
          disabled input submits nothing, so the total would arrive as 0 and come back
          refused as "write the full marks as a number" — a sentence about a field the
          teacher was not allowed to touch. Read-only submits what it shows, so the
          unchanged number passes the same check on the server that let it through
          here. The sentence explaining why is on the card above, once. */}
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={form.fullMarks}
          name="totalMarks"
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          step="0.5"
          defaultValue={current.totalMarks}
          required
          readOnly={frozen}
          className="num"
        />
        <Field
          label={form.passMarks}
          hint={common.optional}
          name="passMarks"
          type="number"
          inputMode="numeric"
          min={0}
          step="0.5"
          defaultValue={current.passMarks}
          readOnly={frozen}
          className="num"
        />
      </div>

      <Field
        label={form.date}
        name="examDate"
        type="date"
        defaultValue={current.examDate}
        required
        className="num"
      />

      <Button type="submit" full disabled={pending}>
        {pending ? common.saving : t.submit}
      </Button>
    </form>
  )
}

/**
 * The way out for an exam that should never have existed.
 *
 * Shut by default and opened by a plain underlined word, not a button, for the reason
 * `CancelBill` gives: the wide button on this screen is "save changes", a teacher taps
 * it without reading, and the control that destroys a row must not be mistakable for
 * it at arm's length on a phone.
 *
 * `blockedReason` is computed on the server from the same `deleteVerdict` the action
 * calls, and it is the same sentence the action would answer with — so the panel
 * cannot offer a button that will be refused, and cannot explain the refusal in
 * different words from the refusal itself. Null means nothing depends on this exam.
 */
export function RemoveExam({
  examId,
  blockedReason,
  t,
}: {
  examId: string
  blockedReason: string | null
  t: T<'examEditForm'>
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<ExamEditState, FormData>(
    async (prev, formData) => {
      const result = await deleteExam(prev, formData)
      // The list, because this page is about a row that no longer exists. Nothing
      // reports success: the exam is missing from the list the reader lands on,
      // which is the only proof that matters.
      if (result?.ok) router.push('/exams')
      return result
    },
    null,
  )
  const [asking, setAsking] = useState(false)

  if (!asking) {
    return (
      <div className="border-t border-line pt-3">
        {/* An error survives here because nothing moved — a refused delete leaves the
            exam, this page, and this component exactly where they were. */}
        {state?.ok === false && <Alert>{state.error}</Alert>}
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="inline-flex min-h-tap items-center text-sm text-ink-faint
            underline"
        >
          {t.removeOpen}
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-line pt-3">
      {blockedReason ? (
        <>
          <p className="font-medium text-ink">{t.blockedTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{blockedReason}</p>
          <div className="mt-2">
            <Button type="button" variant="ghost" onClick={() => setAsking(false)}>
              {t.keep}
            </Button>
          </div>
        </>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="examId" value={examId} />

          <div>
            <p className="font-medium text-ink">{t.removeHeading}</p>
            <p className="mt-1 text-sm text-ink-soft">{t.removeWarning}</p>
          </div>

          {state?.ok === false && <Alert>{state.error}</Alert>}

          {/* Keep-it first and full width, remove second and narrow — the same order
              as the bill cancel step, and for the same reason: the habit this app
              builds is "the wide one at the bottom is the one you press", and a
              confirm step is the worst place to break it. */}
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAsking(false)}
              full
            >
              {t.keep}
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? t.removing : t.removeConfirm}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
