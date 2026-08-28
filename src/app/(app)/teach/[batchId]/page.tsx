import Link from 'next/link'
import { forbidden, notFound } from 'next/navigation'

import { Card } from '@/components/ui'
import {
  pageRole,
  getSession,
  isStaffAdmin,
  canSendSms,
  canManageStudents,
  myTeacherIds,
} from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { BatchSlot } from '@/lib/bd/schedule'
import { todayInDhaka, formatDate } from '@/lib/bd/time'
import {
  ATTENDANCE_MAX_REVISION,
  attendanceVerdict,
  isDateString,
  lastClassDate,
} from '@/lib/attendance/window'
import { planAbsenceNotices } from '@/lib/sms/absence-dispatch'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import type { AttendanceStatus } from '@/lib/supabase/types'
import { AttendanceRoster, type RosterStudent } from './attendance-roster'
import { AbsenceNotices, type AbsenceRowView } from './absence-notices'

/** See /teach: a title needs the session, and a static export cannot read one. */
export async function generateMetadata() {
  const session = await getSession()
  return {
    title: `${dict(session?.locale ?? DEFAULT_LOCALE).teach.rosterTitle} — CoachDesk`,
  }
}

/**
 * Attendance entry for one batch on one day.
 *
 * ?date= lets a teacher fix the class they have just taught or the last one they
 * took. Which days those are is decided in src/lib/attendance/window.ts and again
 * in the action; a page check only decides what to render, and this one renders a
 * refusal as a sentence rather than as an empty form that fails on save.
 */
export default async function AttendancePage({
  params,
  searchParams,
}: {
  // Both are Promises in Next 16 and must be awaited before use.
  params: Promise<{ batchId: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const [{ batchId }, { date }] = await Promise.all([params, searchParams])

  // Teacher or above. Students hitting this URL get the same 403 they would
  // get from RLS, just sooner and in their own language.
  const session = await pageRole('teacher')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.teach

  const today = todayInDhaka()
  // Forgiving where the action is strict. A mangled bookmark should show a teacher
  // today's register rather than an error — but a date that is a real day and
  // simply not writable is kept, so the screen can say which day it is and why,
  // instead of silently swapping in a different one.
  const sessionDate = date && isDateString(date) ? date : today

  // Which centre this batch is in is RLS's question, and a miss is a 404 rather
  // than a 403 so the URL cannot be used to probe which batch IDs exist in other
  // centres.
  const { data: batch } = await supabase
    .from('batches')
    .select('id, name, slot, start_time, end_time, teacher_id, subjects (name, name_bn)')
    .eq('coaching_center_id', session.active.centerId)
    .eq('id', batchId)
    .maybeSingle()

  if (!batch) notFound()

  // Whose register this is is a different question, and nothing was asking it.
  // batches_member_read admits every member of the centre, so a teacher could open
  // any batch in it — and what they got was this screen with an empty roster,
  // because enrollments_teacher_read is scoped by app.teaches_batch. "No students
  // in this batch" is a sentence about the batch; the truth was about the reader.
  // Marking it would then have failed at the write policy, after they had tapped
  // through forty names.
  //
  // 403 and not 404, unlike the miss above. This batch is at their own centre and
  // /teach may well have listed it to them last month, so there is nothing left to
  // hide — and the 403 screen says the one useful thing, which is that the owner
  // decides who teaches what.
  const scope = isStaffAdmin(session) ? null : await myTeacherIds()

  /*
   * AND A CHECK THAT COULD NOT BE MADE IS NOT A CHECK THAT PASSED.
   *
   * `null` below is a staff-admin, for whom there is nothing to check. A staff list
   * that did not arrive was the same `null`, so the guard under this simply did not
   * run: a teacher reached any batch at their centre, and what they got was the screen
   * the 403 exists to prevent — an empty roster under "no students in this batch",
   * because the enrolment read behind it is scoped by app.teaches_batch and answers
   * honestly. Two wrong sentences from one dropped read, and the milder of them is a
   * teacher being told a full batch is empty.
   *
   * So the register is not drawn. Not the 403 either, which would say the owner
   * decides who teaches what — true, and not what happened.
   */
  if (scope !== null && 'unreadable' in scope) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/teach"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="text-xl font-bold text-ink">{batch.name}</h1>
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.unreadable}</p>
        </Card>
      </div>
    )
  }

  const mine = scope !== null && 'ids' in scope ? scope.ids : null
  if (mine && (!batch.teacher_id || !mine.includes(batch.teacher_id))) forbidden()

  const [
    { data: enrollments },
    { data: existingSession, error: existingError },
    { data: schedules },
    { data: recent },
  ] = await Promise.all([
      supabase
        .from('enrollments')
        .select('id, students (id, name, student_code)')
        .eq('coaching_center_id', session.active.centerId)
        .eq('batch_id', batchId)
        .eq('status', 'active'),
      supabase
        .from('attendance_sessions')
        .select('id, note, attendance_records (enrollment_id, status, revision)')
        .eq('coaching_center_id', session.active.centerId)
        .eq('batch_id', batchId)
        .eq('session_date', sessionDate)
        .maybeSingle(),
      supabase
        .from('batch_schedules')
        .select('day_of_week')
        .eq('coaching_center_id', session.active.centerId)
        .eq('batch_id', batchId),
      // The last day this batch has a register for, which reopens an extra class
      // the timetable never knew about.
      supabase
        .from('attendance_sessions')
        .select('session_date')
        .eq('coaching_center_id', session.active.centerId)
        .eq('batch_id', batchId)
        .lt('session_date', today)
        .order('session_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  /*
   * TWO OF THESE FOUR READS DECIDE WHAT A TEACHER IS TOLD, AND BOTH USED TO FAIL IN
   * THE FLATTERING DIRECTION.
   *
   * The roster, because an empty one has a sentence of its own on this screen: "no
   * students in this batch", with a door to the roster for whoever may use it. Read as
   * empty when it had not arrived, that was said to a teacher with forty children in
   * front of them, on the screen they open every single afternoon — and the door sent
   * an owner to a list filtered to students in no batch, which is a list of nobody in a
   * centre whose batches are all fine. Two false answers and an errand, where the true
   * one is "try again".
   *
   * Today's marks, because `maybeSingle` answers `null` both for a day nobody has
   * marked yet and for a read that failed, and only `error` tells them apart. Taken as
   * an unmarked day, every name in the register is drawn unmarked and present, and the
   * banner that says this day is already taken is not drawn either. A teacher who has
   * marked twelve absent this morning would be shown a clean sheet, save it, and
   * `saveAttendance` would do exactly as asked: twelve corrections to present, each
   * spending the one revision the trigger allows, and the twelve families who would
   * have been told never appear on the notice list. The action's own guard cannot help
   * here — it refuses when *its* read of the register fails, and this one succeeds.
   *
   * Not the timetable and not the last register. Both only decide which earlier day is
   * still open, an absent timetable already means "yesterday" by documented design, and
   * neither can close today: `attendanceVerdict` answers 'open' for today on its own
   * account. A teacher can always take today's register, which is the point of the
   * screen.
   *
   * And not the sent-notices read further down, deliberately. Unread, it says nobody
   * has been told yet, so a family already messaged may be messaged twice — annoying,
   * free, and recoverable in a sentence. Withholding the section instead would stop the
   * first message, which is the thing this half of the screen exists to send.
   */
  if (enrollments === null || existingError) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/teach"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        {/* Named, because the batch read did arrive and a teacher who tapped one of
            four batches needs to know this is about that one. */}
        <h1 className="text-xl font-bold text-ink">{batch.name}</h1>
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.unreadable}</p>
        </Card>
      </div>
    )
  }

  const lastClass = lastClassDate(
    today,
    (schedules ?? []).map((s) => s.day_of_week),
    recent?.session_date ?? null,
  )
  const verdict = attendanceVerdict(sessionDate, today, lastClass)
  // An owner or manager may still write into a closed day, and is told that is
  // what they are doing. A teacher gets the card below instead of a form.
  const writable = verdict === 'open' || (verdict === 'closed' && isStaffAdmin(session))

  const previous = new Map<string, { status: AttendanceStatus; revision: number }>()
  for (const record of existingSession?.attendance_records ?? []) {
    previous.set(record.enrollment_id, {
      status: record.status,
      revision: record.revision,
    })
  }

  const students: RosterStudent[] = enrollments
    .map((enrollment) => {
      const student = Array.isArray(enrollment.students)
        ? enrollment.students[0]
        : enrollment.students
      if (!student) return null
      const before = previous.get(enrollment.id)
      return {
        enrollmentId: enrollment.id,
        name: student.name,
        studentCode: student.student_code,
        // Written here rather than in the register, because it takes the name and
        // a function cannot cross into a client component. It costs the name twice
        // in the payload — a fair price for a screen reader being able to say
        // which row it is on.
        rowLabel: t.rowLabel(student.name),
        // Present is the default for an unmarked student — see the roster.
        status: before?.status ?? ('present' as AttendanceStatus),
        // This mark has spent its one correction and the trigger will refuse
        // another. Drawn as a settled row rather than as three buttons that would
        // fail, which is the whole reason the constant is mirrored in TypeScript.
        locked: (before?.revision ?? 0) >= ATTENDANCE_MAX_REVISION,
      }
    })
    .filter((s): s is RosterStudent => s !== null)
    // Bangla collation, so the list is in the order a teacher expects to read it.
    .sort((a, b) => a.name.localeCompare(b.name, 'bn-BD'))

  const subject = Array.isArray(batch.subjects) ? batch.subjects[0] : batch.subjects

  /*
   * The register's other half: whose parent still does not know.
   *
   * Marking twelve children absent used to end here. The register was correct and
   * nothing left the building — the twelve families found out weeks later from an
   * attendance percentage, if they saw one, and a guardian who learns at six that
   * their child never reached the four o'clock class can do something about it that
   * evening. That is the most valuable message this product can carry, and it is
   * the one the screen that produces the fact did not send. See absence_notices.
   *
   * Asked in this order on purpose. The permission first, because everything under
   * it feeds a section a teacher without it never sees; then the plan, which needs
   * the saved register's id and so cannot run before one exists; then who has
   * already been told, and only if there is anybody left to tell.
   */
  const canSend = await canSendSms()

  // The saved register's own id, or null if this day has never been marked. Lifted
  // out because three things below want it and `existingSession?.id` inside a
  // narrowing ternary tells the compiler nothing.
  const savedSessionId = existingSession?.id ?? null

  // Reads the stored register, never what is currently typed into the roster. A
  // name beside an unsaved tap is how a family gets told about an absence the
  // database never recorded — and the teacher who then closed the tab would have
  // no way of knowing they had.
  const plan =
    canSend && savedSessionId
      ? await planAbsenceNotices(supabase, {
          centerId: session.active.centerId,
          centerName: session.active.centerName,
          sessionId: savedSessionId,
          sessionDate,
          today,
          batchName: batch.name,
        })
      : null

  // Who has already been told, from anybody's phone, on any visit. Newest first,
  // which is the order absence_notices_session_idx already yields, so the sort is
  // free — and the first row per student is therefore the latest send.
  const { data: notices } =
    savedSessionId && plan && plan.recipients.length > 0
      ? await supabase
          .from('absence_notices')
          .select('student_id, created_at')
          .eq('coaching_center_id', session.active.centerId)
          .eq('session_id', savedSessionId)
          .order('created_at', { ascending: false })
      : { data: null }

  // student_code by student id, for the notice rows. `planAbsenceNotices` answers
  // who may be told and what to say — not what the register calls them.
  const codes = new Map<string, string | null>()
  for (const enrollment of enrollments) {
    const student = Array.isArray(enrollment.students)
      ? enrollment.students[0]
      : enrollment.students
    if (student) codes.set(student.id, student.student_code)
  }

  const toldAt = new Map<string, string>()
  for (const notice of notices ?? []) {
    if (!toldAt.has(notice.student_id)) {
      toldAt.set(notice.student_id, notice.created_at)
    }
  }

  const noticeRows: AbsenceRowView[] = (plan?.recipients ?? []).map((r) => {
    const told = toldAt.get(r.studentId)
    return {
      studentId: r.studentId,
      name: r.studentName,
      // A student who left the batch last week was still absent from the register
      // taken while they were on it, so `planAbsenceNotices` keeps them and the
      // active-only roster query above has no row to give a code from.
      studentCode: codes.get(r.studentId) ?? null,
      phone: r.phone,
      smsBody: r.body,
      chatBody: r.chatBody,
      preferredChannel: r.preferredChannel,
      told: told ? t.toldOn(formatDate(todayInDhaka(new Date(told)), locale)) : null,
    }
  })

  // Where the other empty seats went, so a teacher looking at four names on a
  // register with seven absences does not assume the screen is broken.
  const noticeNotes = [
    plan && plan.skippedNoPhone > 0 ? t.noPhoneCount(plan.skippedNoPhone) : null,
    plan && plan.skippedOptedOut > 0 ? t.optedOutCount(plan.skippedOptedOut) : null,
  ].filter((line): line is string => line !== null)


  /**
   * Whether the reader looking at an empty batch is allowed to do anything about it.
   *
   * Asked only when the batch is empty, because that is the only screen that uses the
   * answer and every other view would be paying for a query it throws away.
   *
   * The gate is the same trap /teach's own first-batch card fell into: the fix lives
   * on the roster, the roster is `can_manage_students`, and most people who reach this
   * screen are teachers who do not have it. Offering them the door would be sending
   * them to a 403 and telling them to fix something that is not theirs to fix.
   */
  const mayEnrol = students.length === 0 ? await canManageStudents() : false

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/teach"
          className="inline-flex min-h-tap items-center text-ink-soft
            hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{batch.name}</h1>
        <p className="mt-0.5 text-ink-soft">
          {[
            localName(subject, locale),
            <BatchSlot
              key="slot"
              slot={batch.slot}
              start={batch.start_time}
              end={batch.end_time}
              locale={locale}
            />,
          ]
            .filter(Boolean)
            .map((part, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {part}
              </span>
            ))}
        </p>
        <p className="mt-0.5 text-sm text-ink-faint">
          {formatDate(sessionDate, locale)}
          {sessionDate !== today && ` — ${t.pastDate}`}
        </p>
      </div>

      {verdict === 'future' ? (
        <Card>
          <h2 className="font-semibold text-ink">{t.futureTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.futureBody}</p>
          <Link
            href={`/teach/${batch.id}`}
            className="mt-3 inline-flex min-h-tap items-center text-sm font-medium
              text-brand-700"
          >
            {t.takeToday} →
          </Link>
        </Card>
      ) : !writable ? (
        <Card>
          <h2 className="font-semibold text-ink">{t.closedTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.closedBody}</p>
          <div className="flex flex-col">
            {lastClass && (
              <Link
                href={`/teach/${batch.id}?date=${lastClass}`}
                className="mt-3 inline-flex min-h-tap items-center text-sm font-medium
                  text-brand-700"
              >
                {t.lastClass(formatDate(lastClass, locale))} →
              </Link>
            )}
            <Link
              href={`/teach/${batch.id}`}
              className="inline-flex min-h-tap items-center text-sm font-medium
                text-brand-700"
            >
              {t.takeToday} →
            </Link>
          </div>
        </Card>
      ) : students.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">{t.noStudentsTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.noStudentsBody}</p>
          {/* The door, for the reader who can walk through it. Without it this card
              was a dead end on the one screen where somebody has just discovered the
              problem — and the roster is two taps away through a menu, which is two
              taps most people do not take. It also filters straight to the students
              who are in no batch at all, since a batch this empty in a centre that
              has just pasted its register is nearly always the same fact seen from
              the other end. */}
          {mayEnrol && (
            <Link
              href="/settings/students?show=no-batch"
              className="mt-4 inline-flex min-h-tap items-center justify-center
                rounded-xl bg-brand-600 px-5 font-semibold text-white"
            >
              {t.noStudentsAction}
            </Link>
          )}
        </Card>
      ) : (
        <>
          {verdict === 'closed' && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm text-amber-900">{t.closedAdmin}</p>
            </div>
          )}

          <AttendanceRoster
            batchId={batch.id}
            saveLabel={t.saveFor(batch.name)}
            sessionDate={sessionDate}
            students={students}
            note={existingSession?.note ?? ''}
            alreadyTaken={Boolean(existingSession)}
            t={d.roster}
            statusLabels={d.attendance}
            common={d.common}
          />

          {/* Directly under the register, because it is the same errand. A teacher
              who has just saved twelve absences wants the next thing under their
              thumb to be the first parent — one task in their head, two writes in
              the database. */}
          {canSend &&
            (!savedSessionId ? (
              <Card>
                <h2 className="font-semibold text-ink">{d.absenceNotices.title}</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {d.absenceNotices.saveFirst}
                </p>
              </Card>
            ) : noticeRows.length > 0 ? (
              <AbsenceNotices
                sessionId={savedSessionId}
                rows={noticeRows}
                notes={noticeNotes}
                words={{
                  t: d.absenceNotices,
                  list: d.chaseList,
                  chase: d.chase,
                  channels: d.channels,
                }}
              />
            ) : (
              <Card>
                <h2 className="font-semibold text-ink">{d.absenceNotices.title}</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {(plan?.absentCount ?? 0) === 0
                    ? d.absenceNotices.nobodyAbsent
                    : d.absenceNotices.noNumbers}
                </p>
                {noticeNotes.length > 0 && (
                  <ul className="num mt-2 flex flex-col gap-1 text-sm text-ink-faint">
                    {noticeNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}

          {/* The other register a teacher may still fix, from the one they are on.
              Without it the only way to reach yesterday is to know that ?date=
              exists, which no teacher does. */}
          {sessionDate === today && lastClass && (
            <Link
              href={`/teach/${batch.id}?date=${lastClass}`}
              className="inline-flex min-h-tap items-center text-sm font-medium
                text-brand-700"
            >
              {t.lastClass(formatDate(lastClass, locale))} →
            </Link>
          )}
        </>
      )}
    </div>
  )
}
