/**
 * What may still be changed about an exam already created, and what may not.
 *
 * A teacher creates these standing between two batches, on a phone, from four
 * fields — so they create them wrong. The total typed as 50 for a test out of 100,
 * "Model Test 1" when it was the second, next Friday's date on today's paper, or
 * the whole exam twice because the first tap did not look like it worked. Until
 * this file existed none of that could be undone: an exam had one write path, the
 * insert, and a wrong one sat on the list for ever showing "0/28 marked" and an
 * amber line telling a teacher to mark a test that never happened.
 *
 * THE RULES ARE HERE AND NOT IN THE ACTION because three places have to agree
 * about them: the form, which must say no before a round trip while the teacher is
 * still looking at the figure; the Server Action, which must say no again because
 * it is a public HTTP endpoint; and the delete panel, which must not offer a
 * button that will be refused. Same reason lib/fees/void.ts holds `cancelVerdict`.
 *
 * WHAT IS DELIBERATELY NOT EDITABLE: the batch, and so the subject. Marks are
 * keyed by enrolment, and an enrolment belongs to a batch — move the exam and
 * every mark on it describes a child who was never in the room. There is no
 * honest repair for that, so the fence is that the exam is created again on the
 * right batch. The form does not draw the field.
 *
 * Relative imports with the extension, like every other unit-tested module here.
 */

/**
 * What already depends on this exam.
 *
 * Counted by the caller from the three tables that reference it, because the rules
 * below are the same whether the numbers came from PostgREST, a test, or a form
 * that has not been submitted yet.
 */
export type ExamEditFacts = {
  /** Rows on the marks sheet: a mark written, or an absence recorded. */
  markCount: number
  /**
   * The highest mark entered, or null when none is.
   *
   * The one figure that constrains the total. Absences carry no mark, so a sheet of
   * nothing but absences leaves this null with `markCount` above zero — which is
   * correct: there is no number for a new total to contradict.
   */
  highestMark: number | null
  /** Families told by hand, from result_notices — one per family, not per message. */
  noticeCount: number
  /** A metered send went out. The marks sheet is already locked by it. */
  smsSent: boolean
}

/**
 * Whether this exam can be removed outright, and what is holding it if not.
 *
 * Ordered by how deep the dependency goes, because the answer is the sentence the
 * teacher reads and only the strongest reason is worth their time. A metered send
 * spent the centre's money on this exam's figures; a tap-through told families by
 * hand; marks are a sheet somebody filled in. All three are real history, and none
 * of the three should quietly disappear because a row was tidied away.
 *
 * 'marked' is the common one and it is a fence rather than a wall: the way through
 * is to clear the marks on the sheet, which is a thing the sheet already does, and
 * the message says so. An exam nobody has marked and nobody was told about holds no
 * fact about any child, which is what makes deleting it honest — nothing is lost,
 * and the amber line it was putting on a teacher's list every day is.
 */
export type DeleteVerdict = 'ok' | 'sent' | 'told' | 'marked'

export function deleteVerdict(facts: ExamEditFacts): DeleteVerdict {
  if (facts.smsSent) return 'sent'
  if (facts.noticeCount > 0) return 'told'
  if (facts.markCount > 0) return 'marked'
  return 'ok'
}

/**
 * Whether the two numbers on an exam may still move.
 *
 * 'belowMark' is the check that has to exist. Nothing in the database stops a total
 * being lowered under a mark already entered — the trigger guards writes to
 * exam_results and fires on nothing when the exam itself changes — so a total moved
 * from 100 to 50 leaves a 78 sitting on the sheet, and every percentage built from
 * it (the marks sheet, the weekly note to a parent, the at-risk signal, the printed
 * report) reads 156%.
 *
 * 'sent' freezes both numbers once a metered send has happened, for the same reason
 * the marks sheet locks itself then: forty guardians are holding "34/40" on their
 * phones and the app has no way to tell them a denominator changed. The title and
 * the date stay editable in that state, which is why this asks about the figures
 * and not about the exam.
 *
 * An unchanged figure is always 'ok'. A teacher fixing a spelling on a sent exam
 * re-submits the same total, and refusing that would make the typo permanent.
 */
export type FiguresVerdict = 'ok' | 'sent' | 'belowMark'

export function figuresVerdict(
  facts: ExamEditFacts,
  before: { total: number; pass: number | null },
  after: { total: number; pass: number | null },
): FiguresVerdict {
  if (after.total !== before.total) {
    if (facts.smsSent) return 'sent'
    if (facts.highestMark !== null && after.total < facts.highestMark) {
      return 'belowMark'
    }
  }

  if (after.pass !== before.pass && facts.smsSent) return 'sent'

  return 'ok'
}
