'use client'

/**
 * The register itself.
 *
 * Everyone starts present. In a Bangladeshi coaching batch nearly everyone
 * turns up, so the fast path has to be marking the exceptions — a teacher taps
 * three absentees and submits, not thirty confirmations. That single default is
 * the difference between beating the paper register and losing to it.
 */
import { useActionState, useEffect, useState } from 'react'

import { Alert, Button } from '@/components/ui'
import type { T } from '@/lib/i18n'
import type { AttendanceStatus } from '@/lib/supabase/types'
import { saveAttendance, type SaveState } from './actions'

export type RosterStudent = {
  enrollmentId: string
  name: string
  studentCode: string | null
  /** "<name> — হাজিরা", written by the page. See its comment. */
  rowLabel: string
  status: AttendanceStatus
}

/**
 * Glyph and colour together, never colour alone: red-green colour blindness is
 * around 8% of men, and a register that reads as "all the same" to them is
 * worse than no register. Excused is not offered here — it is a decision made
 * after the fact, from the batch history, not while standing in front of a class.
 *
 * The label is a key into the shared `attendance` group rather than a string, so
 * this table stays one table in both languages.
 */
const CHOICES: { status: 'present' | 'late' | 'absent'; glyph: string }[] = [
  { status: 'present', glyph: '✓' },
  { status: 'late', glyph: '⏱' },
  { status: 'absent', glyph: '✕' },
]

const CHOICE_ON: Record<string, string> = {
  present: 'bg-present text-white border-present',
  late: 'bg-late text-white border-late',
  absent: 'bg-absent text-white border-absent',
}

export function AttendanceRoster({
  batchId,
  saveLabel,
  sessionDate,
  students,
  note,
  alreadyTaken,
  t,
  statusLabels,
  common,
}: {
  batchId: string
  /**
   * The submit button's whole label, batch name included, rather than the name to
   * put in it: the sentence takes an argument and so belongs on the server side of
   * the boundary. Same reason `students` arrive with their row labels written.
   */
  saveLabel: string
  sessionDate: string
  students: RosterStudent[]
  note: string
  alreadyTaken: boolean
  /**
   * Three groups, handed down by the server parent. Not the locale and not the
   * dictionary: either one would put both languages in this bundle, and this is
   * the screen a teacher opens on 3G with a class waiting.
   */
  t: T<'roster'>
  statusLabels: T<'attendance'>
  common: T<'common'>
}) {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    saveAttendance,
    null,
  )

  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>(() =>
    Object.fromEntries(students.map((s) => [s.enrollmentId, s.status])),
  )

  // A draft in localStorage, keyed by batch and date. Teachers lose this screen
  // to a phone call, a locked screen, or Chrome discarding a background tab —
  // and re-marking thirty students because the OS reclaimed memory is exactly
  // the kind of thing that sends someone back to paper. Written on every change
  // rather than on an interval, because the tab may never get another frame.
  const draftKey = `coachdesk:attendance:${batchId}:${sessionDate}`

  useEffect(() => {
    // In an effect, not in the initial state: localStorage does not exist during
    // the server render, and reading it in useState would break hydration.
    try {
      const raw = window.localStorage.getItem(draftKey)
      if (!raw) return
      const draft = JSON.parse(raw) as Record<string, unknown>
      // Only ids still on the roster, and only real statuses. A stale draft
      // must never resurrect a student who has since left the batch.
      setMarks((current) => {
        const merged = { ...current }
        for (const key of Object.keys(current)) {
          const value = draft[key]
          if (
            value === 'present' ||
            value === 'absent' ||
            value === 'late' ||
            value === 'excused'
          ) {
            merged[key] = value
          }
        }
        return merged
      })
    } catch {
      // A corrupt or unavailable draft is not worth a broken screen.
    }
  }, [draftKey])

  useEffect(() => {
    if (state?.ok) {
      // Saved — the draft's job is done, and keeping it would override a later
      // correction made from another device.
      try {
        window.localStorage.removeItem(draftKey)
      } catch {
        /* private mode; nothing to clean up */
      }
    }
  }, [state, draftKey])

  function setStatus(enrollmentId: string, status: AttendanceStatus) {
    setMarks((current) => {
      const next = { ...current, [enrollmentId]: status }
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(next))
      } catch {
        /* storage full or blocked — the save still works, just no draft */
      }
      return next
    })
  }

  const counts = { present: 0, late: 0, absent: 0, excused: 0 }
  for (const s of students) counts[marks[s.enrollmentId] ?? 'present']++

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="sessionDate" value={sessionDate} />

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

      {alreadyTaken && !state && (
        <p className="rounded-xl bg-surface-alt px-4 py-3 text-sm text-ink-soft">
          {t.alreadyTaken}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {students.map((student, index) => {
          const current = marks[student.enrollmentId] ?? 'present'
          return (
            <li
              key={student.enrollmentId}
              className="flex items-center gap-3 rounded-xl border border-line
                bg-white py-2 pl-3 pr-2"
            >
              {/* Roll number, not a name-only list: teachers call the register
                  in order and lose their place otherwise. */}
              <span className="num w-6 shrink-0 text-sm text-ink-faint">
                {index + 1}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{student.name}</p>
                {student.studentCode && (
                  <p className="num truncate text-xs text-ink-faint">
                    {student.studentCode}
                  </p>
                )}
              </div>

              <input
                type="hidden"
                name={`status:${student.enrollmentId}`}
                value={current}
              />

              <div
                role="radiogroup"
                aria-label={student.rowLabel}
                className="flex shrink-0 gap-1"
              >
                {CHOICES.map((choice) => {
                  const on = current === choice.status
                  return (
                    <button
                      key={choice.status}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={statusLabels[choice.status]}
                      onClick={() => setStatus(student.enrollmentId, choice.status)}
                      className={`grid h-11 w-11 place-items-center rounded-lg border-2
                        text-lg transition-colors ${
                          on
                            ? CHOICE_ON[choice.status]
                            : 'border-line bg-white text-ink-faint'
                        }`}
                    >
                      <span aria-hidden>{choice.glyph}</span>
                    </button>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>

      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">
          {t.note} ({common.optional})
        </span>
        <textarea
          name="note"
          defaultValue={note}
          rows={2}
          placeholder={t.notePlaceholder}
          className="rounded-xl border-2 border-line bg-white px-4 py-3 text-base
            outline-none placeholder:text-ink-faint focus:border-brand-500"
        />
      </label>

      {/* Sticky, above the bottom nav. The submit button has to be reachable
          without scrolling back up past thirty names. */}
      <div
        className="sticky bottom-20 -mx-4 mt-1 border-t border-line bg-white/95
          px-4 py-3 backdrop-blur"
      >
        <div className="mb-2 flex items-center justify-center gap-4 text-sm">
          <span className="font-medium text-present">
            {statusLabels.present}{' '}
            <span className="num">{counts.present + counts.late}</span>
          </span>
          {counts.late > 0 && (
            <span className="font-medium text-late">
              {statusLabels.late} <span className="num">{counts.late}</span>
            </span>
          )}
          <span className="font-medium text-absent">
            {statusLabels.absent} <span className="num">{counts.absent}</span>
          </span>
        </div>
        <Button type="submit" full disabled={pending}>
          {pending ? common.saving : saveLabel}
        </Button>
      </div>
    </form>
  )
}
