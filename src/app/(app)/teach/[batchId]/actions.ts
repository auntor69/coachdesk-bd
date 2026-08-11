'use server'

/**
 * Saving attendance.
 *
 * One action, called once per batch with the whole roster. Not once per tap:
 * a teacher on 3G marking thirty students would fire thirty requests, and the
 * first one to fail leaves the register half-written with no indication which
 * half. Sending the complete picture makes a retry safe — it overwrites the
 * same rows with the same values.
 */
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { requireRole, AuthError } from '@/lib/auth/session'
import { todayInDhaka } from '@/lib/bd/time'
import type { AttendanceStatus } from '@/lib/supabase/types'

export type SaveState =
  | { ok: true; savedAt: string; count: number }
  | { ok: false; error: string }
  | null

const VALID_STATUSES = new Set<AttendanceStatus>([
  'present',
  'absent',
  'late',
  'excused',
])

/** ISO date, and nothing that merely looks like one. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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
      return { ok: false, error: 'আপনার এই কাজের অনুমতি নেই।' }
    }
    throw err
  }

  const batchId = String(formData.get('batchId') ?? '')
  const rawDate = String(formData.get('sessionDate') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!batchId) return { ok: false, error: 'ব্যাচ পাওয়া যায়নি।' }

  // The date comes from the form so a teacher can backfill yesterday, which
  // means it cannot be trusted. Anything unparseable becomes today; a date in
  // the future is rejected outright, because attendance for a class that has
  // not happened is either a mistake or someone probing the endpoint.
  const today = todayInDhaka()
  const sessionDate = DATE_RE.test(rawDate) && rawDate <= today ? rawDate : today

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
    return { ok: false, error: 'কোনো শিক্ষার্থী পাওয়া যায়নি।' }
  }

  const supabase = await createClient()

  // Which of those enrollments actually belong to this batch. RLS already
  // limits the read to this centre, and this narrows it to this batch — so a
  // forged enrollment ID from another batch is dropped rather than written.
  const { data: enrollments, error: rosterError } = await supabase
    .from('enrollments')
    .select('id')
    .eq('batch_id', batchId)
    .eq('status', 'active')

  if (rosterError) {
    return { ok: false, error: 'শিক্ষার্থীর তালিকা পড়া যায়নি।' }
  }

  const validIds = new Set((enrollments ?? []).map((e) => e.id))
  const accepted = marks.filter((m) => validIds.has(m.enrollmentId))

  if (accepted.length === 0) {
    return { ok: false, error: 'এই ব্যাচে কোনো শিক্ষার্থী নেই।' }
  }

  // The teacher row for this user in this centre, so the session records who
  // took it. Null is acceptable — an owner taking attendance in Center Mode has
  // no teacher row, and losing the register over that would be absurd.
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('user_id', session.userId)
    .maybeSingle()

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
    return { ok: false, error: 'হাজিরা সেভ হয়নি। আবার চেষ্টা করুন।' }
  }

  const { error: recordsError } = await supabase.from('attendance_records').upsert(
    accepted.map((m) => ({
      coaching_center_id: session.active.centerId,
      session_id: attendanceSession.id,
      enrollment_id: m.enrollmentId,
      status: m.status,
      marked_by: session.userId,
    })),
    { onConflict: 'session_id,enrollment_id' },
  )

  if (recordsError) {
    return { ok: false, error: 'হাজিরা সেভ হয়নি। আবার চেষ্টা করুন।' }
  }

  // The teacher list shows a "taken" badge per batch, and the dashboard counts
  // today's sessions. Both are stale the instant this returns.
  revalidatePath('/teach')
  revalidatePath('/dashboard')

  return { ok: true, savedAt: sessionDate, count: accepted.length }
}
