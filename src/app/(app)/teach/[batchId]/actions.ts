'use server'

/**
 * Saving attendance, and the receipt for having told a family about it.
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
 *
 * AND THE HOUR, as of 20260811000089: a register for a class that has not started, or
 * for one that ended with nothing filed, needs a signature before this action will
 * write it — and `unlockAttendance` below is the action that records one. The gate is
 * enforced here, in `src/lib/attendance/clock.ts` for the screens, and in the database
 * three times over; the database is the one that holds.
 */
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import {
  requireRole,
  requireWritable,
  authRefusal,
  isStaffAdmin,
  canSendSms,
  AuthError,
} from '@/lib/auth/session'
import { dhakaClock, dhakaDayOfWeek, todayInDhaka } from '@/lib/bd/time'
import { normalizeBdMobile } from '@/lib/bd/phone'
import {
  ATTENDANCE_MAX_REVISION,
  attendanceVerdict,
  isDateString,
  lastClassDate,
} from '@/lib/attendance/window'
import {
  ATTENDANCE_SIGNATURE_VERSION,
  classState,
  classWindow,
  clockEnforced,
  unlockFor,
} from '@/lib/attendance/clock'
import { MAX_TEXT, clamp } from '@/lib/limits'
import { dict } from '@/lib/i18n'
import type { AttendanceStatus, OutreachChannel } from '@/lib/supabase/types'

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
  //
  // `requireWritable` is the subscription check, and attendance is the write §4.4 names
  // first: a centre whose plan has lapsed keeps every register it has taken and stops
  // being able to take another. The roster still opens and still reads.
  let session
  try {
    session = requireWritable(await requireRole('teacher'))
  } catch (err) {
    if (err instanceof AuthError) {
      // No session at all, one whose role is wrong, or a centre that may no longer
      // write — either way there is no `session.locale` to read here. getSession is
      // memoised per request and was already called by requireRole above, so the read
      // inside authRefusal is free.
      return { ok: false, error: await authRefusal(err, (d) => d.teach.errors.forbidden) }
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
    { data: existing, error: existingError },
    { data: batch },
    { data: unlocks },
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
    // The whole day's timetable and not just its day numbers: the clock gate needs
    // the hours as well, and reading them here costs nothing on the ordinary save —
    // the same three columns decide the window the page drew (`classWindow`, which
    // mirrors app.class_window()).
    supabase
      .from('batch_schedules')
      .select('day_of_week, start_time, end_time')
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
    // The batch's own two times, which `classWindow` falls back on when the day has
    // no schedule rows — the same fallback the guard makes.
    supabase
      .from('batches')
      .select('start_time, end_time')
      .eq('coaching_center_id', session.active.centerId)
      .eq('id', batchId)
      .maybeSingle(),
    // Today's signatures for this batch, and only ever today's: the clock gate exists
    // on the day the class is on (see the migration), so a signature for another day
    // has nothing to do with this save.
    supabase
      .from('attendance_unlocks')
      .select('reason')
      .eq('coaching_center_id', session.active.centerId)
      .eq('batch_id', batchId)
      .eq('session_date', today),
  ])

  if (rosterError) {
    return { ok: false, error: t.errors.rosterUnreadable }
  }

  // What today's register already says has to have been read, for the reason it is
  // read at all. An answer that did not come back is not an empty register: every
  // mark would look new, so a student whose mark has already spent its one
  // correction would be sent again, the trigger would refuse that row, and one
  // refused row takes the other twenty-nine down with it — which is the failure
  // this query exists to prevent.
  //
  // Refused here rather than at the upsert below, so a save that stores nothing
  // does not leave an edited note behind as the only sign it happened.
  if (existingError) {
    return { ok: false, error: t.errors.saveFailed }
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

  /*
   * THE CLOCK, checked a second time (20260811000089). The register page draws the
   * signature card instead of the form, and the signature itself is what the guard in
   * the database reads — but this action is a public endpoint, and a form posted
   * straight at it is exactly the caller the page's own drawing cannot refuse.
   *
   * TODAY ONLY. A register for an earlier day is a correction of history and the date
   * window's business; the clock only exists on the day the class is on.
   *
   * `unlocks` unreadable fails OPEN, deliberately. A dropped read here cannot leave a
   * register unsaved: the database's own guard is the thing that holds, and it will
   * refuse honestly with its own sentence. Failing closed on a read we could not make
   * would refuse a legitimate save for a reason the teacher could do nothing about.
   */
  if (sessionDate === today) {
    const window = classWindow({
      dayOfWeek: dhakaDayOfWeek(),
      schedules: schedules ?? [],
      batch: batch ?? { start_time: null, end_time: null },
    })
    const state = classState({
      now: dhakaClock(),
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      taken: Boolean(existing),
      // A plan with no clock gate asks for nothing here: the state comes back 'open',
      // `unlockFor` is null, and a save for a solo teacher sails through — the same
      // answer `app.clock_enforced()` gives the guard on the other side of the wire.
      enforced: clockEnforced(session.plan),
    })
    const needed = unlockFor(state)

    if (needed !== null && !(unlocks ?? []).some((u) => u.reason === needed)) {
      return {
        ok: false,
        error: needed === 'early' ? t.errors.earlyLocked : t.errors.lateLocked,
      }
    }
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

/* -------------------------------------------------------------------------- */
/* Telling one family their child was not there                               */
/* -------------------------------------------------------------------------- */

/** The three ways somebody at the centre can reach a family from their handset. */
const NOTICE_CHANNELS = new Set<OutreachChannel>(['sms', 'whatsapp', 'call'])

const MAX_NOTICE_BODY = 1000

export type AbsenceNoticeLog = {
  sessionId: string
  studentId: string
  channel: OutreachChannel
  /** The guardian number the link was aimed at; null for anything unparseable. */
  toPhone?: string | null
  /** The exact text put in front of whoever tapped. Null for a call. */
  body?: string | null
}

/**
 * Record that a family was told about a missed class.
 *
 * Fired after the tap, never before it — the row is a receipt for a message that
 * has already been handed to the phone's own SMS or WhatsApp app, so a failure
 * here loses the tick and not the message. That is why it returns a flag rather
 * than an error string: there is nothing for the teacher to retry, and a red
 * banner over a message that did go out would send them to do it twice.
 *
 * A second tap on the same family writes a second row on purpose. A parent who did
 * not read the SMS gets rung, and both of those happened. The screen shows the
 * latest and the table keeps all of them.
 */
export async function logAbsenceNotice(
  input: AbsenceNoticeLog,
): Promise<{ logged: boolean }> {
  // A Server Action is a public endpoint, so the caller is re-derived here even
  // though the page that drew the chip already did. Refused for a read-only centre
  // like every other write, which loses the tick and not the message — see
  // `logProgressUpdate`, which makes the same trade for the same reason.
  let session
  try {
    session = requireWritable(await requireRole('teacher'))
  } catch (err) {
    if (err instanceof AuthError) return { logged: false }
    throw err
  }

  // The owner's "Send SMS" checkbox, checked here and not only by the policy —
  // absence_notices_teacher_insert would refuse this anyway, and this way the
  // refusal costs one memoised query instead of a round trip.
  if (!(await canSendSms())) return { logged: false }

  const sessionId = String(input?.sessionId ?? '')
  const studentId = String(input?.studentId ?? '')
  const channel = input?.channel
  if (!sessionId || !studentId || !NOTICE_CHANNELS.has(channel)) {
    return { logged: false }
  }

  const supabase = await createClient()

  const [{ data: register }, { data: student }] = await Promise.all([
    supabase
      .from('attendance_sessions')
      .select('id, batch_id')
      .eq('coaching_center_id', session.active.centerId)
      .eq('id', sessionId)
      .maybeSingle(),
    // No status filter. A student who left the centre last week was still absent
    // from the register that was taken while they were on it, and their guardian
    // is still owed the message — requiring `active` here would make the chip
    // open the message and silently record nothing.
    supabase
      .from('students')
      .select('id')
      .eq('coaching_center_id', session.active.centerId)
      .eq('id', studentId)
      .maybeSingle(),
  ])

  if (!register?.id || !student?.id) return { logged: false }

  const body = String(input?.body ?? '').slice(0, MAX_NOTICE_BODY)

  const { error } = await supabase.from('absence_notices').insert({
    coaching_center_id: session.active.centerId,
    session_id: register.id,
    student_id: student.id,
    channel,
    to_phone: normalizeBdMobile(input?.toPhone),
    body: body || null,
    sent_by: session.userId,
  })

  if (error) return { logged: false }

  revalidatePath(`/teach/${register.batch_id}`)

  return { logged: true }
}

/* -------------------------------------------------------------------------- */
/* Signing for a register taken outside its class time                        */
/* -------------------------------------------------------------------------- */

export type UnlockState = { ok: true } | { ok: false; error: string } | null

/**
 * Record that a teacher signed for a register their class's clock did not allow.
 *
 * THE SIGNATURE IS THE TICK, and the row is the record of it. There is no typed name
 * and no password: this is not a legal instrument, it is a named person saying "I
 * know the class has not started / has already ended, and I am filing it anyway", in
 * a product whose whole purpose is that the centre can see what its staff did. The
 * words they agreed to are named by `signature_version` and live in the dictionary;
 * who and when are stamped by the database and never sent from here.
 *
 * IT WRITES NOTHING ELSE. The register itself is saved by `saveAttendance`, which the
 * page re-renders for once this row exists — so a signature can never be a way to
 * write a register through a different door, and a teacher who signs and then walks
 * away has left a signature and no attendance, which is an honest account of what
 * happened.
 *
 * THE REASON IS CHECKED AGAINST THE CLOCK HERE, not only in the guard. The guard is
 * what holds, but it can only answer with its own sentence, and a teacher told "a
 * signature has to match the clock" has been told nothing they can act on. This one
 * catches the real case too: a class that started while the page was open, where the
 * sentence they were about to sign stopped being true between the render and the tap.
 *
 * A SECOND TAP IS SUCCESS, not a refusal. The unique index on (batch, day, reason) is
 * what makes it so, and 23505 is read as "already signed" for the same reason
 * `recordAcceptance` reads it that way: the row the screen needs is there, and
 * refusing would ask somebody to sign again for the sentence they just signed.
 */
export async function unlockAttendance(
  _prev: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  let session
  try {
    session = requireWritable(await requireRole('teacher'))
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: await authRefusal(err, (d) => d.teach.errors.forbidden) }
    }
    throw err
  }

  const t = dict(session.locale).teach

  const batchId = String(formData.get('batchId') ?? '')
  const sessionDate = String(formData.get('sessionDate') ?? '')
  const reason = String(formData.get('reason') ?? '')

  if (!batchId || !isDateString(sessionDate)) return { ok: false, error: t.errors.badDate }
  if (reason !== 'early' && reason !== 'forgot') {
    return { ok: false, error: t.errors.unlockFailed }
  }

  // The tick is the whole of the signature, and it is read before anything else can
  // fail — a form posted with no tick must not be able to reach the database at all.
  if (formData.get('signed') !== 'on') return { ok: false, error: t.errors.unsigned }

  const today = todayInDhaka()
  // The clock only exists on the day the class is on (see the migration), so a
  // signature for another day is refused with the sentence the page would have used
  // for a moved class time. This is the one case where the page and this action can
  // disagree without anybody having done anything wrong: a tab left open past
  // midnight.
  if (sessionDate !== today) return { ok: false, error: t.errors.clockChanged }

  const supabase = await createClient()

  const [{ data: batch, error: batchError }, { data: schedules }, { data: register }] =
    await Promise.all([
      supabase
        .from('batches')
        .select('id, name, start_time, end_time, teacher_id')
        .eq('coaching_center_id', session.active.centerId)
        .eq('id', batchId)
        .maybeSingle(),
      supabase
        .from('batch_schedules')
        .select('day_of_week, start_time, end_time')
        .eq('coaching_center_id', session.active.centerId)
        .eq('batch_id', batchId),
      supabase
        .from('attendance_sessions')
        .select('id')
        .eq('coaching_center_id', session.active.centerId)
        .eq('batch_id', batchId)
        .eq('session_date', sessionDate)
        .maybeSingle(),
    ])

  // The batch is RLS's question and a miss is refused rather than 404'd: this is a
  // form post, and the page it came from has already answered that question properly.
  if (batchError || !batch) return { ok: false, error: t.errors.noBatch }
  // An unreadable timetable is treated as no timetable — never as a reason to refuse,
  // for the reason `classWindow` gives. A batch whose routine could not be read has no
  // window, so no state, so nothing to sign for.
  if (schedules === null) return { ok: false, error: t.errors.unlockFailed }

  const window = classWindow({
    dayOfWeek: dhakaDayOfWeek(),
    schedules,
    batch,
  })
  const state = classState({
    now: dhakaClock(),
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    taken: Boolean(register),
    // Off the gate, every state is 'open' and `unlockFor(state)` is null, so this
    // action refuses below — the card that posts it never draws either (20260811000090).
    enforced: clockEnforced(session.plan),
  })

  if (unlockFor(state) !== reason) {
    // Either the class moved under the reader, or the form was posted by hand. Both
    // are the same sentence, and neither is a thing the teacher can fix by retrying
    // this page — hence the reload rather than a "try again".
    return { ok: false, error: t.errors.clockChanged }
  }

  const { error } = await supabase.from('attendance_unlocks').insert({
    coaching_center_id: session.active.centerId,
    batch_id: batchId,
    session_date: sessionDate,
    reason,
    // The batch's own name at the moment of signing. A timetable edited in December
    // must not rewrite what somebody agreed to in October (see the table's own note).
    batch_name: batch.name,
    // `starts_at` and `ends_at` are NOT sent, though the action has both in hand: the
    // guard stamps them from the batch's own timetable, exactly as it stamps the signer
    // and the moment. What the row says the class's hours were is therefore the
    // database's answer and not this form's, and a hand-made call cannot describe a
    // class time that never existed.
    signature_version: ATTENDANCE_SIGNATURE_VERSION,
  })

  if (error && error.code !== '23505') {
    return { ok: false, error: t.errors.unlockFailed }
  }

  // Both screens: this register now draws as signed, and /teach's review line and
  // the centre's notification list are one row longer.
  revalidatePath('/teach')
  revalidatePath(`/teach/${batchId}`)

  return { ok: true }
}

