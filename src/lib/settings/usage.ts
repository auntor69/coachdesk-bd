import type { createClient } from '../supabase/server.ts'
import type { ExamTypeUse, SubjectUse } from './retire.ts'

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * What is pointing at a centre's subjects and exam kinds.
 *
 * Read here rather than in either caller so that the settings list and the two
 * actions behind its buttons count the same things by the same names — the
 * `planResultSms` argument, which is that a screen disagreeing with the write
 * behind it teaches people to distrust the screen. The verdicts themselves are in
 * `retire.ts`; this file only fetches the numbers they read.
 *
 * NULL MEANS A COUNT DID NOT RUN, and never zero. A `?? 0` here would turn a
 * dropped connection into permission to delete a subject that half the timetable
 * teaches, so every caller treats null as "not established" and refuses.
 *
 * There are two shapes of every read, and the reason is the caller: a list screen
 * needs every row's counts and would otherwise fire four queries per subject,
 * while an action needs one subject's counts exactly and should not drag the
 * centre's whole enrolment table over the wire to get them. The list reads a
 * single column and groups it; the action asks Postgres to count. They agree,
 * because they count the same rows under the same policies — and where a very
 * large centre could see a list read truncated by PostgREST's row ceiling, the
 * only consequence is a panel offering a removal that the action then refuses in
 * exact words. The action's count is the authority, and it runs on every write.
 */

/** The counts for one subject, or null if any of them failed. */
export async function readSubjectUse(
  supabase: Supabase,
  centerId: string,
  subjectId: string,
): Promise<SubjectUse | null> {
  const head = { count: 'exact' as const, head: true }

  const [batches, live, enrolments, exams] = await Promise.all([
    supabase
      .from('batches')
      .select('id', head)
      .eq('coaching_center_id', centerId)
      .eq('subject_id', subjectId),
    supabase
      .from('batches')
      .select('id', head)
      .eq('coaching_center_id', centerId)
      .eq('subject_id', subjectId)
      .eq('active', true),
    supabase
      .from('enrollments')
      .select('id', head)
      .eq('coaching_center_id', centerId)
      .eq('subject_id', subjectId),
    supabase
      .from('exams')
      .select('id', head)
      .eq('coaching_center_id', centerId)
      .eq('subject_id', subjectId),
  ])

  if (
    batches.count === null ||
    live.count === null ||
    enrolments.count === null ||
    exams.count === null
  ) {
    return null
  }

  return {
    batchCount: batches.count,
    liveBatchCount: live.count,
    enrolmentCount: enrolments.count,
    examCount: exams.count,
  }
}

/**
 * A tally of nothing, for a subject the map below has no entry for.
 *
 * Exported so the one definition of "nothing points at this" is shared: a caller
 * writing its own `{ batchCount: 0, … }` would be a second place to forget a field
 * the day this type grows one.
 */
export function emptySubjectUse(): SubjectUse {
  return { batchCount: 0, liveBatchCount: 0, enrolmentCount: 0, examCount: 0 }
}

/**
 * Every subject's counts in one pass, keyed by subject id, or null if a read
 * failed.
 *
 * A subject nothing points at has no entry at all, so callers read it as
 * `uses.get(id) ?? emptySubjectUse()`.
 */
export async function readSubjectUses(
  supabase: Supabase,
  centerId: string,
): Promise<Map<string, SubjectUse> | null> {
  const [batches, enrolments, exams] = await Promise.all([
    supabase
      .from('batches')
      .select('subject_id, active')
      .eq('coaching_center_id', centerId),
    supabase
      .from('enrollments')
      .select('subject_id')
      .eq('coaching_center_id', centerId),
    supabase.from('exams').select('subject_id').eq('coaching_center_id', centerId),
  ])

  if (!batches.data || !enrolments.data || !exams.data) return null

  const uses = new Map<string, SubjectUse>()
  const at = (id: string): SubjectUse => {
    const found = uses.get(id)
    if (found) return found
    const fresh = emptySubjectUse()
    uses.set(id, fresh)
    return fresh
  }

  for (const batch of batches.data) {
    const use = at(batch.subject_id)
    use.batchCount += 1
    if (batch.active) use.liveBatchCount += 1
  }
  for (const enrolment of enrolments.data) at(enrolment.subject_id).enrolmentCount += 1
  for (const exam of exams.data) at(exam.subject_id).examCount += 1

  return uses
}

/** The counts for one exam kind, or null if the count failed. */
export async function readExamTypeUse(
  supabase: Supabase,
  centerId: string,
  examTypeId: string,
): Promise<ExamTypeUse | null> {
  const { count } = await supabase
    .from('exams')
    .select('id', { count: 'exact', head: true })
    .eq('coaching_center_id', centerId)
    .eq('exam_type_id', examTypeId)

  return count === null ? null : { examCount: count }
}

/**
 * Every exam kind's count in one pass, keyed by exam type id, or null if the read
 * failed.
 *
 * `exam_type_id` is nullable — "—" is a legal answer on the exam form — so the
 * nulls are skipped rather than counted under some empty key.
 */
export async function readExamTypeUses(
  supabase: Supabase,
  centerId: string,
): Promise<Map<string, ExamTypeUse> | null> {
  const { data } = await supabase
    .from('exams')
    .select('exam_type_id')
    .eq('coaching_center_id', centerId)

  if (!data) return null

  const uses = new Map<string, ExamTypeUse>()
  for (const exam of data) {
    if (!exam.exam_type_id) continue
    const found = uses.get(exam.exam_type_id)
    if (found) found.examCount += 1
    else uses.set(exam.exam_type_id, { examCount: 1 })
  }

  return uses
}
