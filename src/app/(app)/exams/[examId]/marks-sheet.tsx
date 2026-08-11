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
import { useActionState, useEffect, useRef, useState } from 'react'

import { Alert, Button } from '@/components/ui'
import { saveMarks, type SaveMarksState } from '../actions'

export type MarksRow = {
  enrollmentId: string
  name: string
  studentCode: string | null
  /** '' for not entered, 'absent', or a number as typed. */
  value: string
  note: string
}

export function MarksSheet({
  examId,
  totalMarks,
  passMarks,
  rows,
  locked,
}: {
  examId: string
  totalMarks: number
  passMarks: number | null
  rows: MarksRow[]
  locked: boolean
}) {
  const [state, formAction, pending] = useActionState<SaveMarksState, FormData>(
    saveMarks,
    null,
  )

  const [marks, setMarks] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.enrollmentId, r.value])),
  )
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.enrollmentId, r.note])),
  )
  const [openNote, setOpenNote] = useState<string | null>(null)

  const draftKey = `coachdesk:marks:${examId}`
  const loaded = useRef(false)

  // Same draft strategy as attendance: a teacher entering thirty marks on a
  // mid-range phone loses the tab to a phone call often enough that re-typing
  // the sheet is a genuine reason to go back to paper.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey)
      if (raw) {
        const draft = JSON.parse(raw) as {
          marks?: Record<string, string>
          notes?: Record<string, string>
        }
        // Only ids still on the roster — a stale draft must not resurrect a
        // student who has since left the batch.
        setMarks((current) => {
          const merged = { ...current }
          for (const key of Object.keys(current)) {
            const value = draft.marks?.[key]
            if (typeof value === 'string') merged[key] = value
          }
          return merged
        })
        setNotes((current) => {
          const merged = { ...current }
          for (const key of Object.keys(current)) {
            const value = draft.notes?.[key]
            if (typeof value === 'string') merged[key] = value
          }
          return merged
        })
      }
    } catch {
      // A corrupt draft is not worth a broken screen.
    }
    loaded.current = true
  }, [draftKey])

  useEffect(() => {
    // Not before the draft has been read, or the first write would clobber it.
    if (!loaded.current) return
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({ marks, notes }))
    } catch {
      /* storage blocked — the save still works, just no draft */
    }
  }, [draftKey, marks, notes])

  useEffect(() => {
    if (state?.ok) {
      try {
        window.localStorage.removeItem(draftKey)
      } catch {
        /* nothing to clean up */
      }
    }
  }, [state, draftKey])

  const entered = rows.filter((r) => {
    const value = marks[r.enrollmentId]
    return value !== undefined && value !== ''
  }).length

  const remaining = rows.length - entered

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="examId" value={examId} />

      {state?.ok === false && <Alert>{state.error}</Alert>}

      {state?.ok && (
        <div
          role="status"
          className="rounded-xl border-2 border-brand-200 bg-brand-50 px-4 py-3
            font-medium text-brand-800"
        >
          নম্বর সেভ হয়েছে — <span className="num">{state.entered}</span> জন
          {state.absent > 0 && (
            <>
              , অনুপস্থিত <span className="num">{state.absent}</span>
            </>
          )}
        </div>
      )}

      {locked && (
        <p className="rounded-xl bg-surface-alt px-4 py-3 text-sm text-ink-soft">
          এই পরীক্ষার ফলাফল অভিভাবকদের কাছে পাঠানো হয়েছে। এখন নম্বর বদলালে
          অভিভাবকের কাছে থাকা SMS-এর সাথে মিলবে না।
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const value = marks[row.enrollmentId] ?? ''
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
                  value={notes[row.enrollmentId] ?? ''}
                />

                {/* inputMode="decimal" brings up the numeric keypad on Android
                    without blocking a half mark. */}
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`${row.name} — প্রাপ্ত নম্বর`}
                  value={isAbsent ? '' : value}
                  disabled={isAbsent}
                  placeholder="—"
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d.]/g, '')
                    setMarks((current) => ({ ...current, [row.enrollmentId]: next }))
                  }}
                  className={`num h-11 w-16 shrink-0 rounded-lg border-2 bg-white
                    text-center text-base outline-none focus:border-brand-500
                    disabled:bg-surface-alt ${
                      failed ? 'border-absent text-absent' : 'border-line text-ink'
                    }`}
                />

                <button
                  type="button"
                  aria-pressed={isAbsent}
                  aria-label={`${row.name} — অনুপস্থিত`}
                  onClick={() =>
                    setMarks((current) => ({
                      ...current,
                      [row.enrollmentId]: isAbsent ? '' : 'absent',
                    }))
                  }
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
                  aria-label={`${row.name} — মন্তব্য`}
                  aria-expanded={openNote === row.enrollmentId}
                  onClick={() =>
                    setOpenNote(openNote === row.enrollmentId ? null : row.enrollmentId)
                  }
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg
                    border-2 text-lg ${
                      notes[row.enrollmentId]
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
                  value={notes[row.enrollmentId] ?? ''}
                  placeholder="মন্তব্য — অভিভাবকের SMS-এ যাবে, যদি জায়গা থাকে"
                  onChange={(e) =>
                    setNotes((current) => ({
                      ...current,
                      [row.enrollmentId]: e.target.value,
                    }))
                  }
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
          <span className="num">{rows.length}</span> জনের নম্বর দেওয়া হয়েছে
          {remaining > 0 && (
            <span className="text-ink-faint">
              {' '}
              · পূর্ণমান <span className="num">{totalMarks}</span>
            </span>
          )}
        </div>
        <Button type="submit" full disabled={pending}>
          {pending ? 'সেভ হচ্ছে…' : 'নম্বর সেভ করুন'}
        </Button>
      </div>
    </form>
  )
}
