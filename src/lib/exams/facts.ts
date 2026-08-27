/**
 * What already depends on one exam, counted once for everybody who has to know.
 *
 * The edit screen and the two Server Actions behind it ask the same question — how
 * many marks are on this sheet, how high is the highest, how many families were
 * told, has a metered send happened — and they must not answer it differently. If
 * the screen counted for itself, the delete button would appear for an exam the
 * action refuses, and the frozen-figure note would be missing from a form whose
 * numbers cannot move. Same reason `planResultSms` is one function: a screen that
 * disagrees with the write behind it teaches people to distrust the screen.
 *
 * The rules built on these facts are in ./edit.ts, which is pure and unit-tested.
 * This module is the read, so it lives apart from them.
 *
 * Relative imports with extensions, like every module under src/lib; `createClient`
 * is a type-only import, so nothing in src/lib/supabase/server — `next/headers`
 * included — is loaded by anything that only wants the rules.
 */
import type { createClient } from '../supabase/server.ts'
import type { ExamEditFacts } from './edit.ts'

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * Counts the three dependencies, or answers null when it could not.
 *
 * Null for a count that did not run, never a zero. Both verdicts in ./edit.ts decide
 * whether history may be overwritten, and PostgREST answers a `head` count with
 * `null` when the request itself failed — so a `?? 0` anywhere in here would turn a
 * dropped connection into permission to delete a marked exam.
 *
 * `smsSent` is passed in rather than read again: every caller has already fetched the
 * exam row to know it exists, and `sms_sent_at` is on it.
 */
export async function readExamFacts(
  supabase: Supabase,
  centerId: string,
  examId: string,
  smsSent: boolean,
): Promise<ExamEditFacts | null> {
  const [marks, notices] = await Promise.all([
    // The rows and not a count, because the highest mark is the figure that
    // constrains a new total and this client has no `max()`. One row per student on
    // one exam — a roster, not a table scan.
    supabase
      .from('exam_results')
      .select('obtained_marks')
      .eq('coaching_center_id', centerId)
      .eq('exam_id', examId),
    supabase
      .from('result_notices')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', centerId)
      .eq('exam_id', examId),
  ])

  if (marks.error || !marks.data || notices.count === null) return null

  // A loop rather than Math.max(...marks), which answers -Infinity for a sheet of
  // nothing but absences: an absence carries no mark at all, and null there means
  // "no number for a new total to contradict" rather than zero.
  let highestMark: number | null = null
  for (const row of marks.data) {
    if (row.obtained_marks === null) continue
    const mark = Number(row.obtained_marks)
    if (!Number.isFinite(mark)) continue
    if (highestMark === null || mark > highestMark) highestMark = mark
  }

  return {
    markCount: marks.data.length,
    highestMark,
    noticeCount: notices.count,
    smsSent,
  }
}
