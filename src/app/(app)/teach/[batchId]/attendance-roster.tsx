'use client'

/**
 * The register itself.
 *
 * Everyone starts present. In a Bangladeshi coaching batch nearly everyone
 * turns up, so the fast path has to be marking the exceptions — a teacher taps
 * three absentees and submits, not thirty confirmations. That single default is
 * the difference between beating the paper register and losing to it.
 */
import { memo, useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useOffline } from 'next/offline'

import { Alert, Button } from '@/components/ui'
import { CheckIcon, ClockIcon, XIcon, MinusIcon } from '@/components/icons'
import { clearDraft, useSavedDraft, writeDraft } from '@/lib/drafts'
import { MAX_TEXT } from '@/lib/limits'
import type { MarkHistory } from '@/lib/attendance/window'
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
  /**
   * This mark has already been changed once and the database will refuse another.
   * Drawn as what it is instead of as three buttons that would fail — the whole
   * reason ATTENDANCE_MAX_REVISION is mirrored on this side of the wire.
   */
  locked: boolean
  /**
   * Whether this mark is still as it was called, and if not, by whom — the teacher
   * who took it, or somebody else. Section 6.3 asks for an override to be visible,
   * and the row it happened to is the place it cannot be missed.
   *
   * A word rather than the two uuids the register actually holds: those stay on the
   * server. See the page's `previous` map.
   */
  history: MarkHistory
  /** When it was changed, already formatted. Null unless `history` says it was. */
  changedOn: string | null
}

/**
 * What each status looks like at a glance.
 *
 * Vector icon and colour together, never colour alone: red-green colour blindness is
 * around 8% of men, and a register that reads as "all the same" to them is worse
 * than no register.
 *
 * `excused` has an icon but no button. It is a decision made after the fact, from
 * the batch history, not while standing in front of a class — but a settled row
 * still has to draw whatever it happens to hold.
 */
function StatusIcon({
  status,
  className = 'size-5 shrink-0',
}: {
  status: AttendanceStatus
  className?: string
}) {
  switch (status) {
    case 'present':
      return <CheckIcon className={className} />
    case 'late':
      return <ClockIcon className={className} />
    case 'absent':
      return <XIcon className={className} />
    case 'excused':
      return <MinusIcon className={className} />
  }
}

/**
 * The three a teacher taps, in the order they tap them.
 *
 * The label is a key into the shared `attendance` group rather than a string, so
 * this table stays one table in both languages.
 */
const CHOICES: { status: 'present' | 'late' | 'absent' }[] = [
  { status: 'present' },
  { status: 'late' },
  { status: 'absent' },
]

const CHOICE_ON: Record<string, string> = {
  present: 'bg-present text-white border-present',
  late: 'bg-late text-white border-late',
  absent: 'bg-absent text-white border-absent',
}

/**
 * Guards a value read back out of localStorage. Anything can be in there — an
 * older version of this screen, another tab, a user with devtools open — and a
 * status the enum does not have would be rejected by Postgres after the teacher
 * had already tapped save.
 *
 * 'excused' is accepted even though the register does not offer it: it is set
 * later from the batch history, and a draft written before that edit should not
 * silently downgrade it to present.
 */
function isStatus(value: unknown): value is AttendanceStatus {
  return (
    value === 'present' ||
    value === 'absent' ||
    value === 'late' ||
    value === 'excused'
  )
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

  /**
   * Whether the phone has lost the network, for the save button's label alone.
   *
   * `experimental.useOffline` means the save does not fail when there is no signal — it
   * sits pending and replays itself when the connection comes back. Which is the right
   * behaviour and completely invisible: the button reads "সেভ হচ্ছে…" and keeps reading
   * it, for a minute, for ten minutes, for as long as the corridor is out of range. A
   * teacher watching that concludes the app has hung, and the thing they do about it —
   * force-quit — is the one action that loses the sheet localStorage was holding for
   * them. So this exists to keep them from defeating their own safety net.
   *
   * Only the label. Nothing here retries, queues or reconciles anything; see the note
   * on the flag in next.config.ts.
   */
  const offline = useOffline()

  // A draft in localStorage, keyed by batch and date. See lib/drafts for why the
  // read is a store subscription and not an effect, and why what the teacher has
  // tapped is the only thing held in state.
  const draftKey = `coachdesk:attendance:${batchId}:${sessionDate}`
  const draft = useSavedDraft<Record<string, unknown>>(draftKey)

  /** Only what has been tapped since the page opened. Empty on arrival. */
  const [tapped, setTapped] = useState<Record<string, AttendanceStatus>>({})
  const [typedNote, setTypedNote] = useState<string | null>(null)
  const latestNote = useRef<string | null>(null)
  const savedNote = typeof draft?.__note === 'string' ? draft.__note : null
  const currentNote = typedNote ?? savedNote ?? note

  // Built from the roster the server sent, so a stale draft cannot resurrect a
  // student who has since left the batch: an id nobody is enrolled under never
  // gets looked up. `??` and not `||` — every status is a non-empty string, but
  // the next person to add one should not have to know that.
  //
  // A settled mark is the server's value and nothing else. A draft written before
  // it settled would otherwise draw a status the database has already refused to
  // accept, which is a screen quietly disagreeing with the record.
  const marks = useMemo(() => {
    const merged: Record<string, AttendanceStatus> = {}
    for (const s of students) {
      if (s.locked) {
        merged[s.enrollmentId] = s.status
        continue
      }
      const saved = draft?.[s.enrollmentId]
      merged[s.enrollmentId] =
        tapped[s.enrollmentId] ?? (isStatus(saved) ? saved : s.status)
    }
    return merged
  }, [students, draft, tapped])

  useEffect(() => {
    if (state?.ok) clearDraft(draftKey)
  }, [state, draftKey])

  /** Rows with nothing left to spend. No buttons are drawn for them; see setStatus. */
  const locked = useMemo(
    () => new Set(students.filter((s) => s.locked).map((s) => s.enrollmentId)),
    [students],
  )

  /**
   * The map as of the last tap, which is not the same thing as `marks`.
   *
   * A teacher marking three absentees taps fast, and two taps inside one frame
   * both read the `marks` that the last render produced — so the second would
   * silently undo the first. This is the value React has not caught up to yet;
   * it is written synchronously, so it cannot be behind. Null until the first
   * tap, when the render-time map is still the right place to start.
   */
  const latest = useRef<Record<string, AttendanceStatus> | null>(null)

  function setStatus(enrollmentId: string, status: AttendanceStatus) {
    // Belt and braces. A settled row renders no buttons, so nothing here should be
    // reachable — but the draft in localStorage is written from this function, and
    // a draft holding a status the database will refuse is a red error on the next
    // save for something the teacher cannot see or undo.
    if (locked.has(enrollmentId)) return
    const next = { ...(latest.current ?? marks), [enrollmentId]: status }
    latest.current = next
    setTapped(next)
    // Written here rather than in an effect on `marks`: the tab may never get
    // another frame, and an effect would also fire once on mount — before the
    // draft had been read — and overwrite the thing it was about to restore.
    const noteToSave = latestNote.current ?? savedNote
    writeDraft(draftKey, noteToSave !== null ? { ...next, __note: noteToSave } : next)
  }

  function setNoteValue(value: string) {
    latestNote.current = value
    setTypedNote(value)
    writeDraft(draftKey, { ...(latest.current ?? marks), __note: value })
  }

  const counts = { present: 0, late: 0, absent: 0, excused: 0 }
  for (const s of students) counts[marks[s.enrollmentId] ?? 'present']++

  /*
   * THE HANDLER THE ROWS SEE NEVER CHANGES IDENTITY.
   *
   * `setStatus` is rebuilt every tap (its closure reads the updated `marks`), so
   * handing it straight to a memoised row would defeat the memo and re-render
   * every row per tap — the whole class again, thirty-four times a register.
   * The ref keeps the fresh closure under a stable function, so a tap re-renders
   * exactly the row that changed and the bar beneath the list.
   *
   * The assignment is in an effect rather than at render: the compiler's ref
   * rules refuse a write during render, and there is no gap to lose — actions
   * only run after the user can tap a row, which is after the effect has run.
   */
  const setStatusRef = useRef(setStatus)
  useEffect(() => {
    setStatusRef.current = setStatus
  })
  const onSetStatus = useCallback(
    (enrollmentId: string, status: AttendanceStatus) =>
      setStatusRef.current(enrollmentId, status),
    [],
  )

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="sessionDate" value={sessionDate} />

      {/* Two things a teacher has no way to know from looking at the screen: that
          tapping costs nothing, and that a taken register has one change left per
          mark. Both go away once there is a result to read instead. */}
      {!state && (
        <div className="rounded-xl bg-surface-alt px-4 py-3 text-sm text-ink-soft">
          {alreadyTaken && (
            <p className="font-medium text-ink">
              {t.alreadyTaken} {t.finalEdit}
            </p>
          )}
          <p className={alreadyTaken ? 'mt-1' : undefined}>{t.tapFreely}</p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {students.map((student, index) => (
          <RosterRow
            key={student.enrollmentId}
            student={student}
            index={index}
            current={marks[student.enrollmentId] ?? 'present'}
            onSet={onSetStatus}
            t={t}
            statusLabels={statusLabels}
          />
        ))}
      </ul>

      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">
          {t.note} ({common.optional})
        </span>
        <textarea
          name="note"
          value={currentNote}
          onChange={(e) => setNoteValue(e.target.value)}
          rows={2}
          maxLength={MAX_TEXT}
          placeholder={t.notePlaceholder}
          className="rounded-xl border-2 border-line bg-white px-4 py-3 text-base
            outline-none placeholder:text-ink-faint focus:border-brand-500"
        />
      </label>

      {/* Sticky, above the bottom nav. The submit button has to be reachable
          without scrolling back up past thirty names — and so does the answer.
          The save and its outcome used to sit at the top of this list, which is
          exactly where a teacher is not after pressing the button at the bottom
          of forty rows: a refusal scrolled out of sight reads as a save that
          did nothing, and a success nobody saw is a save retyped. */}
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
          {/* Three states, not two. Idle is the batch name; saving is saving; and
              saving with no signal is a promise, because that is the one case where
              the wait has no end a teacher can predict. */}
          {pending ? (offline ? common.willSend : common.saving) : saveLabel}
        </Button>
      </div>
    </form>
  )
}

/**
 * ONE ROW, RENDERED ON ITS OWN.
 *
 * A register is `students.map` inside a form, and without this every tap run
 * the whole map again: a 30-student register re-rendered ~1,300 nodes to change
 * one `aria-checked`, on the screen a teacher holds while tapping fast. Wrapped
 * in `memo`, a tap re-renders the row whose mark changed and nothing else —
 * `student`, `index`, `t` and `statusLabels` are stable between renders (`onSet`
 * is stable by construction; see the ref above), and `current` moves only for
 * the row that was tapped.
 *
 * The markup is byte-for-byte what was inlined; nothing about a row changed.
 */
const RosterRow = memo(function RosterRow({
  student,
  index,
  current,
  onSet,
  t,
  statusLabels,
}: {
  student: RosterStudent
  index: number
  current: AttendanceStatus
  onSet: (enrollmentId: string, status: AttendanceStatus) => void
  t: T<'roster'>
  statusLabels: T<'attendance'>
}) {
  return (
    <li
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
        {/* Under the name and not beside the status, because it is a fact
            about this child's mark rather than about the mark's value — and
            the right-hand side of a settled row is already spoken for. */}
        {student.history !== 'asCalled' && (
          <p
            className={`truncate text-xs ${
              student.history === 'overridden' ? 'text-late' : 'text-ink-faint'
            }`}
          >
            {student.history === 'overridden' ? t.wasOverridden : t.wasCorrected}
            {student.changedOn && (
              <span className="num"> · {student.changedOn}</span>
            )}
          </p>
        )}
      </div>

      <input
        type="hidden"
        name={`status:${student.enrollmentId}`}
        value={current}
      />

      {student.locked ? (
        /* A mark that is now the record. Same height as a live row so a
           register with one settled name in it does not look broken, and
           the status is spelled out rather than left as a colour — this is
           the one row a teacher cannot re-read by tapping it. */
        <div
          className="grid h-11 shrink-0 place-items-center rounded-lg border-2
            border-line bg-surface-alt px-3"
        >
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft">
            <StatusIcon status={current} className="size-4 shrink-0" />
            {statusLabels[current]}
            <span className="sr-only"> — {t.lockedRow}</span>
          </span>
        </div>
      ) : (
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
                onClick={() => onSet(student.enrollmentId, choice.status)}
                className={`grid h-11 w-11 place-items-center rounded-lg border-2
                  text-lg transition-colors ${
                    on
                      ? CHOICE_ON[choice.status]
                      : 'border-line bg-white text-ink-soft hover:border-ink hover:text-ink'
                  }`}
              >
                <StatusIcon status={choice.status} className="size-5 shrink-0" />
              </button>
            )
          })}
        </div>
      )}
    </li>
  )
})
