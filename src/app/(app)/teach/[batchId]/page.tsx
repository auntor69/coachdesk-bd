import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { BatchSlot } from '@/lib/bd/schedule'
import { todayInDhaka, formatDate } from '@/lib/bd/time'
import type { AttendanceStatus } from '@/lib/supabase/types'
import { AttendanceRoster, type RosterStudent } from './attendance-roster'

export const metadata = { title: 'হাজিরা — CoachDesk' }

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
  // get from RLS, just sooner and in Bangla.
  const session = await requireRole('teacher')
  const supabase = await createClient()

  const today = todayInDhaka()
  const sessionDate =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today

  // RLS decides whether this teacher may see this batch at all; a miss is a
  // 404 rather than a 403 so the URL cannot be used to probe which batch IDs
  // exist in other centres.
  const { data: batch } = await supabase
    .from('batches')
    .select('id, name, slot, start_time, end_time, subjects (name, name_bn)')
    .eq('id', batchId)
    .maybeSingle()

  if (!batch) notFound()

  const [{ data: enrollments }, { data: existingSession }] = await Promise.all([
    supabase
      .from('enrollments')
      .select('id, students (id, name, student_code)')
      .eq('batch_id', batchId)
      .eq('status', 'active'),
    supabase
      .from('attendance_sessions')
      .select('id, note, attendance_records (enrollment_id, status)')
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
          ← আজকের ক্লাস
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{batch.name}</h1>
        <p className="mt-0.5 text-ink-soft">
          {[
            subject?.name_bn || subject?.name,
            <BatchSlot
              key="slot"
              slot={batch.slot}
              start={batch.start_time}
              end={batch.end_time}
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
          {formatDate(sessionDate)}
          {sessionDate !== today && ' — পুরোনো তারিখ'}
        </p>
      </div>

      {students.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">এই ব্যাচে শিক্ষার্থী নেই</h2>
          <p className="mt-1 text-sm text-ink-soft">
            শিক্ষার্থী যোগ করলে এখানে হাজিরা নেওয়া যাবে।
          </p>
        </Card>
      ) : (
        <AttendanceRoster
          batchId={batch.id}
          batchName={batch.name}
          sessionDate={sessionDate}
          students={students}
          note={existingSession?.note ?? ''}
          alreadyTaken={Boolean(existingSession)}
        />
      )}
    </div>
  )
}
