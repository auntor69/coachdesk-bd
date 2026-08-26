import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, OutreachChannel } from '@/lib/supabase/types'
import { buildResultSms, buildResultText } from './templates'
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
  /**
   * The marks themselves, unformatted, so a screen can put '45/50' beside the name
   * without fetching the sheet a second time or re-deriving it from `body`. Absent
   * is its own flag and never a zero — see buildResultText.
   */
  obtainedMarks: number | null
  isAbsent: boolean
  /**
   * The same result written for WhatsApp, where nothing is metered — so it keeps
   * the teacher's note that `body` drops rather than buy a second segment.
   *
   * Built here rather than in the browser, which is the opposite of the call
   * ProgressChips makes and right for the opposite reason. Its row already carries
   * every input, so rendering there costs nothing; these inputs are a three-level
   * embed and an exam's pass mark the page does not otherwise fetch, so building
   * in the browser would mean shipping the raw marks and re-deriving them — more
   * bytes, and two places that have to agree about what a parent is told.
   */
  chatBody: string
  /**
   * How this family is actually reachable, as the owner marked it on
   * /settings/sms. Orders the chips and colours one of them; it is a preference
   * and never a permission — `sms_opt_out` above is the only thing that silences
   * a channel, and a family filtered out by it never reaches this list.
   */
  preferredChannel: OutreachChannel | null
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

/**
 * Named rather than positional, because `centerId` and `centerName` are both
 * strings: swapping them at a call site would compile, plan a send against a
 * centre id of "উত্তরা আইডিয়াল কোচিং", find no rows, and report "no recipients"
 * on a screen listing forty students.
 */
export type ResultDispatchInput = {
  /** Which centre's data this plan may see. Not optional — see below. */
  centerId: string
  centerName: string
  examId: string
  rosterSize: number
}

/**
 * The centre id is a parameter and not something this function could look up
 * from the exam, deliberately. Reading it off the exam row would mean asking the
 * database "which centre is this?" and believing the answer — which is exactly
 * the check being made. The caller knows which centre's screen the request came
 * from, and that is the only trustworthy source.
 */
export async function planResultSms(
  supabase: SupabaseClient<Database>,
  { centerId, centerName, examId, rosterSize }: ResultDispatchInput,
): Promise<ResultDispatchPlan | null> {
  const { data: exam } = await supabase
    .from('exams')
    .select('id, title, total_marks, pass_marks')
    .eq('coaching_center_id', centerId)
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
           id, name, guardian_phone, sms_opt_out, preferred_channel,
           guardians (id, phone, is_primary, sms_opt_out)
         )
       )`,
    )
    .eq('coaching_center_id', centerId)
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
      obtainedMarks: result.obtained_marks === null ? null : Number(result.obtained_marks),
      isAbsent: result.is_absent,
      // The same facts, unclamped and with the note kept. Nothing is metered on
      // WhatsApp, so nothing has to be given up to fit.
      chatBody: buildResultText({
        studentName: student.name,
        examTitle: exam.title,
        obtainedMarks:
          result.obtained_marks === null ? null : Number(result.obtained_marks),
        totalMarks: Number(exam.total_marks),
        passMarks: exam.pass_marks === null ? null : Number(exam.pass_marks),
        isAbsent: result.is_absent,
        centerName,
        note: result.note,
      }),
      preferredChannel: student.preferred_channel,
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
