import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/types'
import { buildResultSms } from './templates'
import { measureSms } from './encoding'

/**
 * Who would receive a result SMS for one exam, and what it would cost.
 *
 * This is the single source of truth for that answer. The confirmation screen
 * calls it to show the owner a recipient count, a cost, and a real message; the
 * send action calls the same function to decide what to actually queue. If they
 * were two pieces of code, the preview would eventually stop matching the send —
 * and the first person to find out would be a parent receiving something the
 * centre never approved.
 */

export type ResultRecipient = {
  studentId: string
  studentName: string
  guardianId: string | null
  phone: string
  body: string
  segments: number
}

type GuardianRow = {
  id: string
  phone: string | null
  is_primary: boolean
  sms_opt_out: boolean
}

export type ResultDispatchPlan = {
  examTitle: string
  centerName: string
  recipients: ResultRecipient[]
  /** Marks entered but no message possible, split by cause. */
  skippedOptedOut: number
  skippedNoPhone: number
  /** Students on the roster with no mark entered yet. */
  withoutMarks: number
  /**
   * Whose note did not fit. Names rather than a count, because the only useful
   * response is to go back up the same page and shorten that student's note —
   * and "১ জনের মন্তব্য" leaves a teacher guessing which of eight it was. The
   * length that decides it depends on the student's own name, so the longest
   * note is not reliably the dropped one.
   */
  notesTrimmed: string[]
  creditCost: number
  /**
   * True when at least one message needed a second segment. Never caused by a
   * note — a note is dropped before it can add one — so this means the name,
   * the title and the centre's name are long enough between them.
   */
  anyMultiSegment: boolean
}

export async function planResultSms(
  supabase: SupabaseClient<Database>,
  examId: string,
  centerName: string,
  rosterSize: number,
): Promise<ResultDispatchPlan | null> {
  const { data: exam } = await supabase
    .from('exams')
    .select('id, title, total_marks')
    .eq('id', examId)
    .maybeSingle()

  if (!exam) return null

  const { data: results } = await supabase
    .from('exam_results')
    .select(
      `id, obtained_marks, is_absent, note,
       enrollments (
         id,
         students (
           id, name, guardian_phone, sms_opt_out,
           guardians (id, phone, is_primary, sms_opt_out)
         )
       )`,
    )
    .eq('exam_id', examId)

  const recipients: ResultRecipient[] = []
  const notesTrimmed: string[] = []
  let skippedOptedOut = 0
  let skippedNoPhone = 0

  for (const result of results ?? []) {
    const enrollment = Array.isArray(result.enrollments)
      ? result.enrollments[0]
      : result.enrollments
    const student = Array.isArray(enrollment?.students)
      ? enrollment?.students[0]
      : enrollment?.students
    if (!student) continue

    // The student-level switch wins over everything. An owner who turned SMS off
    // for a child did it for a reason — a wrong number, or a parent who asked —
    // and no exam should quietly override that.
    if (student.sms_opt_out) {
      skippedOptedOut++
      continue
    }

    // Three levels of embed is past where PostgREST's generated types stay
    // sharp, so the guardian shape is named here rather than inferred.
    const guardians: GuardianRow[] = student.guardians ?? []
    const primary = guardians.find((g) => g.is_primary) ?? guardians[0] ?? null

    if (primary?.sms_opt_out) {
      skippedOptedOut++
      continue
    }

    // The guardian row is authoritative; students.guardian_phone is the display
    // copy and the fallback for rows added before guardians existed.
    const phone = primary?.phone ?? student.guardian_phone
    if (!phone) {
      skippedNoPhone++
      continue
    }

    const sms = buildResultSms({
      studentName: student.name,
      examTitle: exam.title,
      obtainedMarks: result.obtained_marks === null ? null : Number(result.obtained_marks),
      totalMarks: Number(exam.total_marks),
      isAbsent: result.is_absent,
      centerName,
      note: result.note,
    })

    if (sms.trimmed) notesTrimmed.push(student.name)

    recipients.push({
      studentId: student.id,
      studentName: student.name,
      guardianId: primary?.id ?? null,
      phone,
      body: sms.body,
      segments: sms.segments,
    })
  }

  // Sorted so the preview list reads in the same order as the marks sheet, and
  // so does the list of notes that did not fit.
  recipients.sort((a, b) => a.studentName.localeCompare(b.studentName, 'bn-BD'))
  notesTrimmed.sort((a, b) => a.localeCompare(b, 'bn-BD'))

  return {
    examTitle: exam.title,
    centerName,
    recipients,
    skippedOptedOut,
    skippedNoPhone,
    withoutMarks: Math.max(0, rosterSize - (results ?? []).length),
    notesTrimmed,
    creditCost: recipients.reduce((sum, r) => sum + r.segments, 0),
    anyMultiSegment: recipients.some((r) => r.segments > 1),
  }
}

/** Cost of one body, for showing "১ SMS" next to a preview. */
export function segmentsOf(body: string): number {
  return measureSms(body).segments
}
