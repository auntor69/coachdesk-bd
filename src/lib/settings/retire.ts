/**
 * When a subject or an exam kind may be turned off, and when it may be removed.
 *
 * Both lists were add-only for the product's whole life, which made every typo
 * permanent: "Physcis" went onto the batch, onto every exam sat in it, onto the
 * marks sheet and onto the printed report, and the only repair was a second
 * subject called "Physics" sitting next to it for ever. Renaming needs no rule —
 * everything joins by id, so the corrected name simply appears everywhere at
 * once. Turning one off and removing one do, and they are here rather than in the
 * action because the list on screen has to refuse in the same breath as the write
 * behind it. Same reason as `lib/exams/edit.ts` and `lib/fees/void.ts`.
 *
 * THE TWO VERBS ARE NOT THE SAME REPAIR, and the difference is worth stating
 * once. Turning a subject off is the ordinary end of a subject: the centre
 * stopped teaching Chemistry, so it should leave the pickers while every exam
 * ever sat in it keeps its name. Removing one is for the duplicate that was never
 * used at all. So "off" stays available long after "remove" has stopped being
 * honest, and the panel offers whichever of the two is still true.
 */

/** Everything in the centre that points at one subject. */
export type SubjectUse = {
  /**
   * Every batch, running or not. `batches.subject_id` is `on delete restrict`,
   * and the constraint does not care whether the class still meets — so this is
   * the count that decides whether a removal is possible at all.
   */
  batchCount: number
  /**
   * The running ones only, which is a different question: `maxSubjects` counts
   * active subjects, so turning one off while a live batch teaches it would let a
   * centre run six subjects on a plan that holds five. See subjectOffVerdict.
   */
  liveBatchCount: number
  /**
   * Enrolments carrying it. A copy taken from the batch when the student was
   * enrolled, so in practice a subject with enrolments has batches too — counted
   * separately anyway because the foreign key is `restrict` here as well, and a
   * refusal that names the wrong reason is worse than one that names none.
   *
   * Every status, not just active ones: a dropped enrolment is still a row, and
   * the constraint still reads it.
   */
  enrolmentCount: number
  /** Exams sat in it, also `restrict`. */
  examCount: number
}

/** Why a subject cannot be removed, or 'ok' when nothing points at it. */
export type SubjectDeleteVerdict = 'ok' | 'batches' | 'enrolments' | 'exams'

/**
 * Whether a subject can be removed outright.
 *
 * Ordered by what the owner recognises rather than by what the database would
 * complain about first: a batch is a thing on their timetable, an enrolment is a
 * child in it, an exam is a paper that was sat. All three would be refused by a
 * foreign key anyway; the point of answering here is that the sentence names the
 * batch instead of a constraint.
 *
 * `teacher_subjects` is deliberately not counted. It cascades — the row only
 * records which teacher may take the subject, so a tick against a subject nobody
 * teaches any more is not a reason to keep the subject.
 */
export function subjectDeleteVerdict(use: SubjectUse): SubjectDeleteVerdict {
  if (use.batchCount > 0) return 'batches'
  if (use.enrolmentCount > 0) return 'enrolments'
  if (use.examCount > 0) return 'exams'
  return 'ok'
}

/** Why a subject cannot be turned off, or 'ok'. */
export type SubjectOffVerdict = 'ok' | 'liveBatches'

/**
 * Whether a subject can be turned off.
 *
 * The one refusal is the plan cap, not tidiness. An inactive subject stops being
 * counted against `maxSubjects` but does not stop working: a batch keeps its
 * `subject_id` and every screen still reads the name through the join. So a
 * centre on a five-subject plan could turn three subjects off, add three more,
 * and teach eight — while the usage line on the plan screen read 5/5. History is
 * not the problem, live teaching is, which is why this counts only the batches
 * that are still running.
 */
export function subjectOffVerdict(use: SubjectUse): SubjectOffVerdict {
  return use.liveBatchCount > 0 ? 'liveBatches' : 'ok'
}

/** Everything in the centre that points at one exam kind. */
export type ExamTypeUse = {
  examCount: number
}

/** Why an exam kind cannot be removed, or 'ok'. */
export type ExamTypeDeleteVerdict = 'ok' | 'exams'

/**
 * Whether an exam kind can be removed.
 *
 * One comparison, and still a function, because the list on screen and the action
 * behind the button must not each decide it for themselves — the whole point of
 * this file.
 *
 * Note that the database would allow this one: `exams.exam_type_id` is `on delete
 * set null`, so removing "Model Test" would succeed and quietly leave every model
 * test ever held with no kind at all, on the exam page, in the parent's SMS and in
 * the printed report. That is a product decision to refuse, not a constraint —
 * turning the kind off keeps the history and takes it out of the picker, which is
 * what the owner meant.
 *
 * There is no `off` verdict to match the subject's: exam kinds have no plan cap,
 * so turning one off cannot buy anything.
 */
export function examTypeDeleteVerdict(use: ExamTypeUse): ExamTypeDeleteVerdict {
  return use.examCount > 0 ? 'exams' : 'ok'
}
