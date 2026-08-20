import Link from 'next/link'
import { forbidden, notFound } from 'next/navigation'

import { Card } from '@/components/ui'
import {
  pageRole,
  getSession,
  isStaffAdmin,
  myTeacherIds,
} from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { BatchSlot } from '@/lib/bd/schedule'
import { todayInDhaka, formatDate } from '@/lib/bd/time'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import type { AttendanceStatus } from '@/lib/supabase/types'
import { AttendanceRoster, type RosterStudent } from './attendance-roster'

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
 * ?date= lets a teacher backfill a class they forgot. It is validated here and
 * again in the action — a page check only decides what to render.
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
  const sessionDate =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today

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
  const mine = isStaffAdmin(session) ? null : await myTeacherIds()
  if (mine && (!batch.teacher_id || !mine.includes(batch.teacher_id))) forbidden()

  const [{ data: enrollments }, { data: existingSession }] = await Promise.all([
    supabase
      .from('enrollments')
      .select('id, students (id, name, student_code)')
      .eq('coaching_center_id', session.active.centerId)
      .eq('batch_id', batchId)
      .eq('status', 'active'),
    supabase
      .from('attendance_sessions')
      .select('id, note, attendance_records (enrollment_id, status)')
      .eq('coaching_center_id', session.active.centerId)
      .eq('batch_id', batchId)
      .eq('session_date', sessionDate)
      .maybeSingle(),
  ])

  const previous = new Map<string, AttendanceStatus>()
  for (const record of existingSession?.attendance_records ?? []) {
    previous.set(record.enrollment_id, record.status)
  }

  const students: RosterStudent[] = (enrollments ?? [])
    .map((enrollment) => {
      const student = Array.isArray(enrollment.students)
        ? enrollment.students[0]
        : enrollment.students
      if (!student) return null
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
        status: previous.get(enrollment.id) ?? ('present' as AttendanceStatus),
      }
    })
    .filter((s): s is RosterStudent => s !== null)
    // Bangla collation, so the list is in the order a teacher expects to read it.
    .sort((a, b) => a.name.localeCompare(b.name, 'bn-BD'))

  const subject = Array.isArray(batch.subjects) ? batch.subjects[0] : batch.subjects

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

      {students.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">{t.noStudentsTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.noStudentsBody}</p>
        </Card>
      ) : (
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
      )}
    </div>
  )
}
