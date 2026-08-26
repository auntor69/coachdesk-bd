'use server'

/**
 * Saving attendance.
 *
 * One action, called once per batch with the whole roster. Not once per tap:
 * a teacher on 3G marking thirty students would fire thirty requests, and the
 * first one to fail leaves the register half-written with no indication which
 * half. Sending the complete picture makes a retry safe — it overwrites the
 * same rows with the same values.
 *
 * WHICH DAY, AND HOW MANY TIMES. Both rules arrived together and both are
 * enforced twice, here and in 20260811000031_attendance_window.sql. A register
 * for a class that has not happened is refused outright; a register for today or
 * the batch's last class may be corrected once per mark; anything older is
 * bookkeeping and only an owner or manager may touch it.
 *
 * The page and this action read the same date the opposite way round. A mangled
 * `?date=` on the page falls back to today, because a stale bookmark should show
 * a teacher something. A mangled date *here* is an error, because quietly
 * defaulting to today is precisely how a forged post overwrites a correct
 * register with a screen that starts everybody present — which is what the line
 * this replaced actually did, under a comment claiming it rejected the date.
 */
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { requireRole, getSession, isStaffAdmin, AuthError } from '@/lib/auth/session'
import { todayInDhaka } from '@/lib/bd/time'
import {
  ATTENDANCE_MAX_REVISION,
  attendanceVerdict,
  isDateString,
  lastClassDate,
} from '@/lib/attendance/window'
import { MAX_TEXT, clamp } from '@/lib/limits'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import type { AttendanceStatus } from '@/lib/supabase/types'

export type SaveState =
  | { ok: true; savedAt: string; message: string }
  | { ok: false; error: string }
  | null

const VALID_STATUSES = new Set<AttendanceStatus>([
  'present',
  'absent',
  'late',
  'excused',
])

export async function saveAttendance(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  // A Server Action is a public endpoint. Re-derive the caller here even though
  // the page that renders the form already did — the form is not the boundary.
  let session
  try {
    session = await requireRole('teacher')
  } catch (err) {
    if (err instanceof AuthError) {
      // No session at all, or one whose role is wrong — either way there is no
      // `session.locale` to read. getSession is memoised per request and was
      // already called by requireRole above, so this is free.
      const caller = await getSession()
      const d = dict(caller?.locale ?? DEFAULT_LOCALE)
      return { ok: false, error: d.teach.errors.forbidden }
    }
    throw err
  }

  // The whole group, not just `errors`: the count in the success line is a plural
  // in English and a bare number in Bangla, so the sentence is written here and
  // travels finished. A function cannot cross into the register to write it there.
  const t = dict(session.locale).teach

  const batchId = String(formData.get('batchId') ?? '')
  const rawDate = String(formData.get('sessionDate') ?? '')
  // The roster's own box stops at MAX_TEXT, so a longer one did not come from
  // the roster. Clamped rather than refused: the note is an aside, and losing a
  // teacher's whole register of ticks over it would be the wrong trade.
  const note = clamp(String(formData.get('note') ?? '').trim(), MAX_TEXT)

  if (!batchId) return { ok: false, error: t.errors.noBatch }
  if (!isDateString(rawDate)) return { ok: false, error: t.errors.badDate }

  const today = todayInDhaka()
  const sessionDate = rawDate

  // Statuses arrive as status:<enrollmentId> so the form posts a flat body that
  // survives a page reload — no JSON blob, no client-side state to lose.
  const marks: { enrollmentId: string; status: AttendanceStatus }[] = []
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('status:')) continue
    const enrollmentId = key.slice('status:'.length)
    const status = String(value) as AttendanceStatus
    if (!enrollmentId || !VALID_STATUSES.has(status)) continue
    marks.push({ enrollmentId, status })
  }

  if (marks.length === 0) {
    return { ok: false, error: t.errors.noStudents }
  }

  const supabase = await createClient()

  // Five reads in one wave, because each one gates something different and none
  // of them depends on another: who is really in this batch, who is marking,
  // which days the batch meets, when it was last marked, and what this day's
  // register already says.
  const [
    { data: enrollments, error: rosterError },
    { data: teacher },
    { data: schedules },
    { data: recent },
    { data: existing },
  ] = await Promise.all([
    // RLS already limits the read to this centre, and this narrows it to this
    // batch — so a forged enrollment ID from another batch is dropped rather
    // than written.
    supabase
      .from('enrollments')
      .select('id')
      .eq('coaching_center_id', session.active.centerId)
      .eq('batch_id', batchId)
      .eq('status', 'active'),
    // The teacher row for this user in this centre, so the session records who
    // took it. Null is acceptable — an owner taking attendance in Center Mode has
    // no teacher row, and losing the register over that would be absurd.
    supabase
      .from('teachers')
      .select('id')
      .eq('coaching_center_id', session.active.centerId)
      .eq('user_id', session.userId)
      .maybeSingle(),
    supabase
      .from('batch_schedules')
      .select('day_of_week')
      .eq('coaching_center_id', session.active.centerId)
      .eq('batch_id', batchId),
    // The last day this batch actually has a register for, which reopens a class
    // the timetable never knew about. Strictly before today: today is open on its
    // own account.
    supabase
      .from('attendance_sessions')
      .select('session_date')
      .eq('coaching_center_id', session.active.centerId)
      .eq('batch_id', batchId)
      .lt('session_date', today)
      .order('session_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // What is on the register already, so a mark that has spent its one
    // correction is left alone instead of taking the other twenty-nine down with
    // it. One refused row rolls back the whole statement.
    supabase
      .from('attendance_sessions')
      .select('id, attendance_records (enrollment_id, status, revision)')
      .eq('coaching_center_id', session.active.centerId)
      .eq('batch_id', batchId)
      .eq('session_date', sessionDate)
      .maybeSingle(),
  ])

  if (rosterError) {
    return { ok: false, error: t.errors.rosterUnreadable }
  }

  // An unreadable timetable is treated as an absent one, which is what /teach
  // does with the same absence: it means yesterday, not "nothing is open".
  const lastClass = lastClassDate(
    today,
    (schedules ?? []).map((s) => s.day_of_week),
    recent?.session_date ?? null,
  )

  const verdict = attendanceVerdict(sessionDate, today, lastClass)

  if (verdict === 'future') {
    return { ok: false, error: t.errors.futureDate }
  }

  // Older than the last class is bookkeeping rather than attendance: a teacher is
  // refused, and an owner or manager fixing a register from last month is not.
  if (verdict === 'closed' && !isStaffAdmin(session)) {
    return { ok: false, error: t.errors.closedDate }
  }

  const validIds = new Set((enrollments ?? []).map((e) => e.id))
  const accepted = marks.filter((m) => validIds.has(m.enrollmentId))

  if (accepted.length === 0) {
    return { ok: false, error: t.errors.emptyBatch }
  }

  // What is worth sending, and what would be refused if it were sent.
  //
  // A mark whose status is already what the form says is dropped. That is not an
  // optimisation: `experimental.useOffline` replays this action when the signal
  // returns, and every save carries every student, so most rows in most saves are
  // unchanged. Dropping them is also what makes a half-failed save retryable —
  // the rows that landed now match, so a retry sends only the ones that did not.
  //
  // A mark that has already been corrected once is dropped and counted, because
  // the trigger would refuse it and take the whole upsert with it.
  const settled = new Map<string, { status: AttendanceStatus; revision: number }>()
  for (const record of existing?.attendance_records ?? []) {
    settled.set(record.enrollment_id, {
      status: record.status,
      revision: record.revision,
    })
  }

  let held = 0
  const toWrite = accepted.filter((m) => {
    const before = settled.get(m.enrollmentId)
    if (!before) return true
    if (before.status === m.status) return false
    if (before.revision >= ATTENDANCE_MAX_REVISION) {
      held += 1
      return false
    }
    return true
  })

  // Upsert on (batch_id, session_date) — the unique constraint that makes a
  // retry idempotent. A teacher who saves, loses signal, and saves again gets
  // one session, not two.
  const { data: attendanceSession, error: sessionError } = await supabase
    .from('attendance_sessions')
    .upsert(
      {
        coaching_center_id: session.active.centerId,
        batch_id: batchId,
        teacher_id: teacher?.id ?? null,
        session_date: sessionDate,
        note: note || null,
        taken_by: session.userId,
      },
      { onConflict: 'batch_id,session_date' },
    )
    .select('id')
    .single()

  if (sessionError || !attendanceSession) {
    return { ok: false, error: t.errors.saveFailed }
  }

  // Nothing to send is a real outcome, not a failure: a replayed save, or a
  // teacher who opened a settled register and pressed save without changing
  // anything. The session upsert above still ran, so an edited note is kept.
  if (toWrite.length > 0) {
    const { error: recordsError } = await supabase.from('attendance_records').upsert(
      toWrite.map((m) => ({
        coaching_center_id: session.active.centerId,
        session_id: attendanceSession.id,
        enrollment_id: m.enrollmentId,
        status: m.status,
        marked_by: session.userId,
      })),
      { onConflict: 'session_id,enrollment_id' },
    )

    if (recordsError) {
      return { ok: false, error: t.errors.saveFailed }
    }
  }

  // The teacher list shows a "taken" badge per batch, and the dashboard counts
  // today's sessions. Both are stale the instant this returns, and so is this
  // register's own page — which now draws a corrected mark as settled.
  revalidatePath('/teach')
  revalidatePath(`/teach/${batchId}`)
  revalidatePath('/dashboard')

  // The count is the register as it now stands, not the rows this call happened to
  // write: "0 students saved" after a replay reads like a failure when in fact
  // nothing needed doing. Marks that could not change are the one thing worth
  // interrupting for, because the screen is now showing something the database
  // disagrees with.
  return {
    ok: true,
    savedAt: sessionDate,
    message: held > 0 ? t.savedExcept(held) : t.saved(accepted.length),
  }
}
