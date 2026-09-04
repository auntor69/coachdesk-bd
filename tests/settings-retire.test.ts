import test from 'node:test'
import assert from 'node:assert/strict'

import {
  examTypeDeleteVerdict,
  subjectDeleteVerdict,
  subjectOffVerdict,
  teacherDeleteVerdict,
  type SubjectUse,
  type TeacherUse,
} from '../src/lib/settings/retire.ts'

/** Nothing points at it — the duplicate an owner added twice and never used. */
function unused(over: Partial<SubjectUse> = {}): SubjectUse {
  return {
    batchCount: 0,
    liveBatchCount: 0,
    enrolmentCount: 0,
    examCount: 0,
    ...over,
  }
}

test('an unused subject can be removed', () => {
  assert.equal(subjectDeleteVerdict(unused()), 'ok')
})

test('a batch holds a subject, running or not', () => {
  // The foreign key is `restrict` either way, so a batch that stopped meeting
  // still blocks the removal — and the sentence has to say batch, not constraint.
  assert.equal(
    subjectDeleteVerdict(unused({ batchCount: 2, liveBatchCount: 2 })),
    'batches',
  )
  assert.equal(
    subjectDeleteVerdict(unused({ batchCount: 1, liveBatchCount: 0 })),
    'batches',
  )
})

test('the batch is named before the enrolment or the exam', () => {
  // All three would refuse. The owner recognises the timetable first.
  assert.equal(
    subjectDeleteVerdict(
      unused({ batchCount: 1, liveBatchCount: 1, enrolmentCount: 30, examCount: 4 }),
    ),
    'batches',
  )
})

test('an enrolment holds a subject on its own', () => {
  // Shouldn't happen — enrolments follow batches — which is exactly why it is
  // counted rather than assumed away.
  assert.equal(subjectDeleteVerdict(unused({ enrolmentCount: 1 })), 'enrolments')
})

test('an exam sat in the subject holds it', () => {
  assert.equal(subjectDeleteVerdict(unused({ examCount: 1 })), 'exams')
})

test('a subject with only history can be turned off', () => {
  // A closed batch and last year's exams: the centre stopped teaching it, and
  // that is precisely what the off switch is for.
  assert.equal(
    subjectOffVerdict(unused({ batchCount: 3, liveBatchCount: 0, examCount: 12 })),
    'ok',
  )
})

test('a running batch keeps its subject on', () => {
  // Otherwise a five-subject plan teaches eight: turn three off, add three more,
  // and the usage line still reads 5/5 while every class carries on.
  assert.equal(
    subjectOffVerdict(unused({ batchCount: 1, liveBatchCount: 1 })),
    'liveBatches',
  )
})

test('an unused subject can be turned off as well as removed', () => {
  // Both doors open at once is fine: one is the tidy end of a subject, the other
  // is for the duplicate. Neither is refused just because the other is offered.
  const use = unused()
  assert.equal(subjectOffVerdict(use), 'ok')
  assert.equal(subjectDeleteVerdict(use), 'ok')
})

test('an exam kind with no exams can be removed', () => {
  assert.equal(examTypeDeleteVerdict({ examCount: 0 }), 'ok')
})

test('one held exam keeps its kind', () => {
  // The database would allow it and null the column, leaving every model test
  // ever held with no kind on the exam page, in the SMS and in the report.
  assert.equal(examTypeDeleteVerdict({ examCount: 1 }), 'exams')
})

/* -------------------------------------------------------------------------- */
/* Teachers, where the ordering is the opposite of the subject rule            */
/* -------------------------------------------------------------------------- */

/** A record nothing points at: the name typed twice, the applicant who declined. */
function fresh(over: Partial<TeacherUse> = {}): TeacherUse {
  return { paidCount: 0, attendanceCount: 0, examCount: 0, batchCount: 0, ...over }
}

test('a teacher who never taught can be removed', () => {
  assert.equal(teacherDeleteVerdict(fresh()), 'ok')
})

test('each of the four holds the record on its own', () => {
  // Three of these four keys are `set null`, so the database would let all three
  // through and quietly leave the registers and the papers with nobody's name on
  // them. The refusal is the product's, which is why it is asserted rather than
  // left to a constraint.
  assert.equal(teacherDeleteVerdict(fresh({ paidCount: 1 })), 'paid')
  assert.equal(teacherDeleteVerdict(fresh({ attendanceCount: 1 })), 'attendance')
  assert.equal(teacherDeleteVerdict(fresh({ examCount: 1 })), 'exams')
  assert.equal(teacherDeleteVerdict(fresh({ batchCount: 1 })), 'batches')
})

test('the unrepairable reason is named before the repairable one', () => {
  /*
   * The whole of the ordering, and it is the opposite of subjectDeleteVerdict's:
   * that one names what the owner recognises first, this one names what they cannot
   * fix. A teacher with four batches and eleven months of attendance who was told
   * "reassign the batches" would reassign four batches and then be refused anyway.
   */
  const everything = fresh({
    paidCount: 3,
    attendanceCount: 210,
    examCount: 8,
    batchCount: 4,
  })
  assert.equal(teacherDeleteVerdict(everything), 'paid')

  // And each step down the list, so the order is pinned rather than only its head.
  assert.equal(
    teacherDeleteVerdict(fresh({ attendanceCount: 210, examCount: 8, batchCount: 4 })),
    'attendance',
  )
  assert.equal(teacherDeleteVerdict(fresh({ examCount: 8, batchCount: 4 })), 'exams')
})

test('a paid teacher is refused even with nothing else against them', () => {
  // `salary_payments.teacher_id` is the one NO ACTION key on the table, so this is
  // also the row the database itself would refuse — migration 44 wrote the rule
  // down: somebody who has been paid is marked as left, not deleted.
  assert.equal(teacherDeleteVerdict(fresh({ paidCount: 1 })), 'paid')
})
