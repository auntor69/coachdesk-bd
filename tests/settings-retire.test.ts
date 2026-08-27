import test from 'node:test'
import assert from 'node:assert/strict'

import {
  examTypeDeleteVerdict,
  subjectDeleteVerdict,
  subjectOffVerdict,
  type SubjectUse,
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
