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

import { useOffline } from 'next/offline'

import { Alert, Button } from '@/components/ui'
import { clearDraft, useSavedDraft, writeDraft } from '@/lib/drafts'
import { fill } from '@/lib/i18n/fill'
import { MAX_NOTE } from '@/lib/limits'
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
  readOnly,
  t,
  common,
}: {
  examId: string
  totalMarks: number
  passMarks: number | null
  rows: MarksRow[]
  /**
   * The result SMS has gone out. A notice, not a lock — the name is older than
   * this comment and the behaviour it describes was never built. Kept as a notice
   * deliberately: a wrong mark that parents have already been told about is
   * exactly the mark most worth correcting, and the sheet's job is to warn that
   * the correction will not match the message they are holding.
   */
  locked: boolean
  /**
   * The owner has unticked "Exams & marks" for this teacher. Unlike `locked` this
   * one really does disable everything that writes, because the action behind the
   * button now refuses and a form that submits into a refusal is a worse answer
   * than a field that will not take a keystroke.
   *
   * Reading is untouched, which is the whole distinction the permission draws: the
   * marks, the absences and the notes all stay legible, because the person holding
   * the phone is still the one who taught the class.
   */
  readOnly: boolean
  t: T<'marksSheet'>
  common: T<'common'>
}) {
  const [state, formAction, pending] = useActionState<SaveMarksState, FormData>(
    saveMarks,
    null,
  )

  /**
   * Whether the phone has lost the network, for the save button's label alone —
   * the same three-state button as the register, for the same reason. See the
   * longer note in teach/[batchId]/attendance-roster.tsx: with
   * `experimental.useOffline` on, this save sits pending and replays itself when
   * the signal returns, and a button that reads "সেভ হচ্ছে…" for ten minutes reads
   * as a hang. The thing a teacher does about a hang is force-quit, which is the
   * one action that loses the sheet localStorage was holding for them.
   */
  const offline = useOffline()

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
      // No draft in read-only mode. A draft is unsaved typing, and showing it in a
      // sheet nothing can be submitted from would present a teacher's abandoned
      // keystrokes as the marks on record — with no way to either store or clear
      // them. What is in the database is the only thing worth showing.
      const savedMark = readOnly ? undefined : draft?.marks?.[row.enrollmentId]
      const savedNote = readOnly ? undefined : draft?.notes?.[row.enrollmentId]
      marks[row.enrollmentId] =
        typed.marks[row.enrollmentId] ?? (isText(savedMark) ? savedMark : row.value)
      notes[row.enrollmentId] =
        typed.notes[row.enrollmentId] ?? (isText(savedNote) ? savedNote : row.note)
    }
    return { marks, notes }
  }, [rows, draft, typed, readOnly])

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
    // No action at all in read-only mode, rather than an action that refuses. The
    // hidden fields below go with it: a form whose action is undefined submits to
    // the current URL as a GET, so leaving forty `mark:` inputs in place would turn
    // a stray Enter into a page-length query string.
    <form
      action={readOnly ? undefined : formAction}
      className="flex flex-col gap-4"
    >
      {!readOnly && <input type="hidden" name="examId" value={examId} />}

      {/* Neither the refusal nor the save's confirmation lives above the list any
          more: the sheet is forty rows long and the save button is sticky at the
          bottom, so a message at the top is a message the teacher never sees.
          Both moved onto the button's own bar with the register's — see the note
          in the sticky div below. */}

      {/* One notice, not two. Read-only outranks locked because it is the one that
          answers what the teacher can do about any of it: told that the SMS has
          gone and that the fields are theirs to fix, they would go looking for a
          way to fix them. */}
      {(readOnly || locked) && (
        <p className="rounded-xl bg-surface-alt px-4 py-3 text-sm text-ink-soft">
          {readOnly ? t.readOnly : t.locked}
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

                {!readOnly && (
                  <>
                    <input
                      type="hidden"
                      name={`mark:${row.enrollmentId}`}
                      value={value}
                    />
                    <input
                      type="hidden"
                      name={`note:${row.enrollmentId}`}
                      value={note}
                    />
                  </>
                )}

                {/* inputMode="decimal" brings up the numeric keypad on Android
                    without blocking a half mark. */}
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={fill(t.markLabel, { name: row.name })}
                  value={isAbsent ? '' : value}
                  disabled={isAbsent || readOnly}
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

                {/* Still says who is absent when it cannot be changed — the cross is
                    the only place that fact is written, so greying it out rather
                    than hiding it keeps the sheet readable. */}
                <button
                  type="button"
                  aria-pressed={isAbsent}
                  aria-label={fill(t.absentLabel, { name: row.name })}
                  disabled={readOnly}
                  onClick={() => setMark(row.enrollmentId, isAbsent ? '' : 'absent')}
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg
                    border-2 text-lg disabled:opacity-60 ${
                      isAbsent
                        ? 'border-absent bg-absent text-white'
                        : 'border-line bg-white text-ink-faint'
                    }`}
                >
                  <span aria-hidden>✕</span>
                </button>

                {/* Not disabled in read-only mode, and that is the point: this
                    button writes nothing, it only opens the row. A note is the one
                    thing on this sheet that cannot be seen without tapping
                    something, so disabling it would hide the teacher's own words
                    from them. The field it opens is where the read-only part is. */}
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
                  maxLength={MAX_NOTE}
                  readOnly={readOnly}
                  value={note}
                  placeholder={t.notePlaceholder}
                  onChange={(e) => setNote(row.enrollmentId, e.target.value)}
                  className="mt-2 min-h-tap w-full rounded-lg border-2 border-line
                    bg-white px-3 text-base outline-none read-only:bg-surface-alt
                    read-only:text-ink-soft focus:border-brand-500"
                />
              )}
            </li>
          )
        })}
      </ul>

      {/* The counter stays in read-only mode and the button goes. "12/40 marked" is
          the one thing on this bar that is information rather than an action, and it
          is what a teacher who cannot enter marks came to find out.

          The save's own answers sit here for the same reason — beside the button that
          produced them rather than above a list that puts them off screen. */}
      <div
        className="sticky bottom-20 -mx-4 mt-1 border-t border-line bg-white/95
          px-4 py-3 backdrop-blur"
      >
        {state?.ok === false && (
          <div className="mb-2">
            <Alert>{state.error}</Alert>
          </div>
        )}
        {state?.ok && (
          <p
            role="status"
            className="num mb-2 rounded-lg border-2 border-brand-200 bg-brand-50
              px-3 py-1.5 text-center text-sm font-medium text-brand-800"
          >
            {state.message}
          </p>
        )}
        <div
          className={`text-center text-sm text-ink-soft ${readOnly ? '' : 'mb-2'}`}
        >
          <span className="num font-medium text-ink">{entered}</span>/
          <span className="num">{rows.length}</span> {t.marked}
          {remaining > 0 && (
            <span className="text-ink-faint">
              {' '}
              · {t.fullMarks} <span className="num">{totalMarks}</span>
            </span>
          )}
        </div>
        {!readOnly && (
          <Button type="submit" full disabled={pending}>
            {/* Three states, not two — see the register's note. */}
            {pending ? (offline ? common.willSend : common.saving) : t.save}
          </Button>
        )}
      </div>
    </form>
  )
}
