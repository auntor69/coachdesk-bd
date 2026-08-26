import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, OutreachChannel } from '@/lib/supabase/types'
import { buildAbsenceSms, buildAbsenceText } from './templates'

/**
 * Whose parents should be told about one register, and what to say to them.
 *
 * The single source of truth for that answer, the same way `planResultSms` is for
 * marks: the roster screen calls it to draw the list, and if a second piece of
 * code ever built the message the two would drift and the first person to notice
 * would be a parent.
 *
 * READS THE SAVED REGISTER, never what is currently typed into the roster. A list
 * built from unsaved taps would put a parent's name beside a status that is not in
 * the database, and a teacher who then closed the tab would have told a family
 * about an absence the register never recorded.
 */

export type AbsenceRecipient = {
  studentId: string
  studentName: string
  guardianId: string | null
  phone: string
  body: string
  segments: number
  /**
   * The same absence written for WhatsApp, where nothing is metered — so it keeps
   * the batch name and the sentence that offers the family a reason.
   */
  chatBody: string
  /**
   * How this family is actually reachable, as the owner marked it on
   * /settings/sms. Orders the chips; it is a preference and never a permission —
   * `sms_opt_out` is the only thing that silences a channel, and a family filtered
   * out by it never reaches this list.
   */
  preferredChannel: OutreachChannel | null
}

type GuardianRow = {
  id: string
  phone: string | null
  is_primary: boolean
  sms_opt_out: boolean
}

export type AbsenceDispatchPlan = {
  sessionId: string
  sessionDate: string
  recipients: AbsenceRecipient[]
  /** Marked absent but no message possible, split by cause. */
  skippedOptedOut: number
  skippedNoPhone: number
  /** How many empty seats the register recorded, before either skip. */
  absentCount: number
}

/**
 * Named rather than positional, because four of these are strings and swapping
 * two of them would compile, plan against a centre id of "উত্তরা আইডিয়াল কোচিং",
 * find nothing, and report "nobody was absent" on a register with twelve empty
 * seats.
 */
export type AbsenceDispatchInput = {
  /** Which centre's data this plan may see. Not optional — see planResultSms. */
  centerId: string
  centerName: string
  sessionId: string
  /** The register's Dhaka date, and today's, so the wording can say `আজ`. */
  sessionDate: string
  today: string
  /** Named on WhatsApp only; may be blank. */
  batchName?: string | null
}

export async function planAbsenceNotices(
  supabase: SupabaseClient<Database>,
  { centerId, centerName, sessionId, sessionDate, today, batchName }: AbsenceDispatchInput,
): Promise<AbsenceDispatchPlan | null> {
  const { data: records } = await supabase
    .from('attendance_records')
    .select(
      `id, status,
       enrollments (
         id,
         students (
           id, name, guardian_phone, sms_opt_out, preferred_channel,
           guardians (id, phone, is_primary, sms_opt_out)
         )
       )`,
    )
    .eq('coaching_center_id', centerId)
    .eq('session_id', sessionId)
    // Absent only, decided here rather than by the caller. Late is not absent and
    // must never be messaged as though it were — see the migration's note.
    .eq('status', 'absent')

  if (!records) return null

  const recipients: AbsenceRecipient[] = []
  let skippedOptedOut = 0
  let skippedNoPhone = 0

  const isToday = sessionDate === today

  for (const record of records) {
    const enrollment = Array.isArray(record.enrollments)
      ? record.enrollments[0]
      : record.enrollments
    const student = Array.isArray(enrollment?.students)
      ? enrollment?.students[0]
      : enrollment?.students
    if (!student) continue

    // The student-level switch wins over everything, as it does for results: an
    // owner who turned messaging off for a child did it for a reason.
    if (student.sms_opt_out) {
      skippedOptedOut++
      continue
    }

    // Three levels of embed is past where PostgREST's generated types stay sharp,
    // so the guardian shape is named rather than inferred.
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

    const input = {
      studentName: student.name,
      batchName,
      sessionDate,
      isToday,
      centerName,
    }
    const sms = buildAbsenceSms(input)

    recipients.push({
      studentId: student.id,
      studentName: student.name,
      guardianId: primary?.id ?? null,
      phone,
      body: sms.body,
      segments: sms.segments,
      chatBody: buildAbsenceText(input),
      preferredChannel: student.preferred_channel,
    })
  }

  // Same Bangla collation as the roster above it, so a teacher reads the two lists
  // in one order and can go down them in parallel.
  recipients.sort((a, b) => a.studentName.localeCompare(b.studentName, 'bn-BD'))

  return {
    sessionId,
    sessionDate,
    recipients,
    skippedOptedOut,
    skippedNoPhone,
    absentCount: records.length,
  }
}
