'use client'

/**
 * Entering marks for a whole batch.
 *
 * Nothing is pre-filled. Attendance can default to present because absence is
 * the exception; a mark has no defensible default, and a sheet that arrives
 * pre-filled with zeros would let a teacher submit a batch of zeros by tapping
 * save. Blank means "not entered yet", and the SMS gate downstream counts those
 * separately so nobody messages parents about half a class.
 */
import { useActionState, useEffect, useMemo, useRef, useState } from 'react'

import { Alert, Button } from '@/components/ui'
import { clearDraft, useSavedDraft, writeDraft } from '@/lib/drafts'
import { fill } from '@/lib/i18n/fill'
import type { T } from '@/lib/i18n'
import { saveMarks, type SaveMarksState } from '../actions'

export type MarksRow = {
  enrollmentId: string
  name: string
  studentCode: string | null
  /** '' for not entered, 'absent', or a number as typed. */
  value: string
  note: string
}

/** What gets written to localStorage. Both halves, so one write covers a row. */
type MarksDraft = {
  marks?: Record<string, unknown>
  notes?: Record<string, unknown>
}

/** Guards a value read back out of localStorage — see the roster's own note. */
function isText(value: unknown): value is string {
  return typeof value === 'string'
}

export function MarksSheet({
  examId,
  totalMarks,
  passMarks,
  rows,
  locked,
  t,
  common,
}: {
  examId: string
  totalMarks: number
  passMarks: number | null
  rows: MarksRow[]
  locked: boolean
  t: T<'marksSheet'>
  common: T<'common'>
}) {
  const [state, formAction, pending] = useActionState<SaveMarksState, FormData>(
    saveMarks,
    null,
  )

  // Same draft strategy as the register, and the same module: a teacher entering
  // thirty marks on a mid-range phone loses the tab to a phone call often enough
  // that re-typing the sheet is a genuine reason to go back to paper. See
  // lib/drafts for why the read is a store subscription rather than an effect.
  const draftKey = `coachdesk:marks:${examId}`
  const draft = useSavedDraft<MarksDraft>(draftKey)

  /** Only what has been typed since the page opened. Empty on arrival. */
  const [typed, setTyped] = useState<{
    marks: Record<string, string>
    notes: Record<string, string>
  }>({ marks: {}, notes: {} })

  const [openNote, setOpenNote] = useState<string | null>(null)

  // Built from the roster the server sent, so a stale draft cannot resurrect a
  // student who has since left the batch — an id nobody is enrolled under never
  // gets looked up.
  const sheet = useMemo(() => {
    const marks: Record<string, string> = {}
    const notes: Record<string, string> = {}
    for (const row of rows) {
      const savedMark = draft?.marks?.[row.enrollmentId]
      const savedNote = draft?.notes?.[row.enrollmentId]
      marks[row.enrollmentId] =
        typed.marks[row.enrollmentId] ?? (isText(savedMark) ? savedMark : row.value)
      notes[row.enrollmentId] =
        typed.notes[row.enrollmentId] ?? (isText(savedNote) ? savedNote : row.note)
    }
    return { marks, notes }
  }, [rows, draft, typed])

  useEffect(() => {
    if (state?.ok) clearDraft(draftKey)
  }, [state, draftKey])

  /**
   * The sheet as of the last keystroke, which is not the same thing as `sheet`.
   *
   * Two edits inside one frame — tapping absent for two students in a row, or a
   * fast typist on the last two fields — would both read the `sheet` the last
   * render produced, and the second would silently undo the first. This is the
   * value React has not caught up to yet; it is written synchronously, so it
   * cannot be behind. Null until the first edit, when the render-time sheet is
   * still the right place to start.
   */
  const latest = useRef<{
    marks: Record<string, string>
    notes: Record<string, string>
  } | null>(null)

  /**
   * One write per keystroke, straight to storage rather than from an effect on
   * `sheet`. The tab may never get another frame — and an effect would also fire
   * once on mount, before the draft had been read, overwriting the very thing it
   * was about to restore. That is what the old `loaded` ref was guarding.
   */
  function edit(next: { marks: Record<string, string>; notes: Record<string, string> }) {
    latest.current = next
    setTyped(next)
    writeDraft(draftKey, next)
  }

  function setMark(enrollmentId: string, value: string) {
    const from = latest.current ?? sheet
    edit({ marks: { ...from.marks, [enrollmentId]: value }, notes: from.notes })
  }

  function setNote(enrollmentId: string, value: string) {
    const from = latest.current ?? sheet
    edit({ marks: from.marks, notes: { ...from.notes, [enrollmentId]: value } })
  }

  const entered = rows.filter((r) => sheet.marks[r.enrollmentId] !== '').length

  const remaining = rows.length - entered

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="examId" value={examId} />

      {state?.ok === false && <Alert>{state.error}</Alert>}

      {state?.ok && (
        <div
          role="status"
          className="num rounded-xl border-2 border-brand-200 bg-brand-50 px-4 py-3
            font-medium text-brand-800"
        >
          {state.message}
        </div>
      )}

      {locked && (
        <p className="rounded-xl bg-surface-alt px-4 py-3 text-sm text-ink-soft">
          {t.locked}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const value = sheet.marks[row.enrollmentId] ?? ''
          const note = sheet.notes[row.enrollmentId] ?? ''
          const isAbsent = value === 'absent'
          const numeric = Number(value)
          const failed =
            passMarks !== null &&
            value !== '' &&
            !isAbsent &&
            Number.isFinite(numeric) &&
            numeric < passMarks

          return (
            <li
              key={row.enrollmentId}
              className="rounded-xl border border-line bg-white px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="num w-6 shrink-0 text-sm text-ink-faint">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{row.name}</p>
                  {row.studentCode && (
                    <p className="num truncate text-xs text-ink-faint">
                      {row.studentCode}
                    </p>
                  )}
                </div>

                <input type="hidden" name={`mark:${row.enrollmentId}`} value={value} />
                <input
                  type="hidden"
                  name={`note:${row.enrollmentId}`}
                  value={note}
                />

                {/* inputMode="decimal" brings up the numeric keypad on Android
                    without blocking a half mark. */}
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={fill(t.markLabel, { name: row.name })}
                  value={isAbsent ? '' : value}
                  disabled={isAbsent}
                  placeholder="—"
                  onChange={(e) =>
                    setMark(row.enrollmentId, e.target.value.replace(/[^\d.]/g, ''))
                  }
                  className={`num h-11 w-16 shrink-0 rounded-lg border-2 bg-white
                    text-center text-base outline-none focus:border-brand-500
                    disabled:bg-surface-alt ${
                      failed ? 'border-absent text-absent' : 'border-line text-ink'
                    }`}
                />

                <button
                  type="button"
                  aria-pressed={isAbsent}
                  aria-label={fill(t.absentLabel, { name: row.name })}
                  onClick={() => setMark(row.enrollmentId, isAbsent ? '' : 'absent')}
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg
                    border-2 text-lg ${
                      isAbsent
                        ? 'border-absent bg-absent text-white'
                        : 'border-line bg-white text-ink-faint'
                    }`}
                >
                  <span aria-hidden>✕</span>
                </button>

                <button
                  type="button"
                  aria-label={fill(t.noteLabel, { name: row.name })}
                  aria-expanded={openNote === row.enrollmentId}
                  onClick={() =>
                    setOpenNote(openNote === row.enrollmentId ? null : row.enrollmentId)
                  }
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg
                    border-2 text-lg ${
                      note
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-line bg-white text-ink-faint'
                    }`}
                >
                  <span aria-hidden>✎</span>
                </button>
              </div>

              {openNote === row.enrollmentId && (
                <input
                  type="text"
                  autoFocus
                  maxLength={60}
                  value={note}
                  placeholder={t.notePlaceholder}
                  onChange={(e) => setNote(row.enrollmentId, e.target.value)}
                  className="mt-2 min-h-tap w-full rounded-lg border-2 border-line
                    bg-white px-3 text-base outline-none focus:border-brand-500"
                />
              )}
            </li>
          )
        })}
      </ul>

      <div
        className="sticky bottom-20 -mx-4 mt-1 border-t border-line bg-white/95
          px-4 py-3 backdrop-blur"
      >
        <div className="mb-2 text-center text-sm text-ink-soft">
          <span className="num font-medium text-ink">{entered}</span>/
          <span className="num">{rows.length}</span> {t.marked}
          {remaining > 0 && (
            <span className="text-ink-faint">
              {' '}
              · {t.fullMarks} <span className="num">{totalMarks}</span>
            </span>
          )}
        </div>
        <Button type="submit" full disabled={pending}>
          {pending ? common.saving : t.save}
        </Button>
      </div>
    </form>
  )
}
