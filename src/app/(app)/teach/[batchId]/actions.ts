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
import { requireRole, getSession, AuthError } from '@/lib/auth/session'
import { todayInDhaka } from '@/lib/bd/time'
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
    return { ok: false, error: t.errors.noStudents }
  }

  const supabase = await createClient()

  // Which of those enrollments actually belong to this batch. RLS already
  // limits the read to this centre, and this narrows it to this batch — so a
  // forged enrollment ID from another batch is dropped rather than written.
  const { data: enrollments, error: rosterError } = await supabase
    .from('enrollments')
    .select('id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('batch_id', batchId)
    .eq('status', 'active')

  if (rosterError) {
    return { ok: false, error: t.errors.rosterUnreadable }
  }

  const validIds = new Set((enrollments ?? []).map((e) => e.id))
  const accepted = marks.filter((m) => validIds.has(m.enrollmentId))

  if (accepted.length === 0) {
    return { ok: false, error: t.errors.emptyBatch }
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
    return { ok: false, error: t.errors.saveFailed }
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
    return { ok: false, error: t.errors.saveFailed }
  }

  // The teacher list shows a "taken" badge per batch, and the dashboard counts
  // today's sessions. Both are stale the instant this returns.
  revalidatePath('/teach')
  revalidatePath('/dashboard')

  return { ok: true, savedAt: sessionDate, message: t.saved(accepted.length) }
}
