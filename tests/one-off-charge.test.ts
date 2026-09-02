import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  byRegisterOrder,
  chargePlan,
  chargeRoster,
  CHARGE_CATEGORIES,
  isChargeCategory,
  type ChargeStudent,
} from '../src/lib/fees/charge.ts'
import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

/** A roster entry, coded unless the test is about the ones with no code. */
function student(id: string, name: string, code: string | null = id): ChargeStudent {
  return { id, name, code }
}

/** An enrolment row as PostgREST hands it over, embed and all. */
function enrolled(id: string, name: string, code: string | null = id) {
  return { students: { id, name, student_code: code } }
}

test('tuition is not a category this form can raise', () => {
  // The schema is what refuses it — `fee_invoices_category_enrollment_bound` allows a
  // non-tuition bill only when there is no enrolment, and a monthly fee is raised
  // against one — but the refusal arrives as a bare 400 an owner can do nothing with.
  assert.equal(isChargeCategory('tuition'), false)
  for (const category of CHARGE_CATEGORIES) {
    assert.equal(isChargeCategory(category), true, category)
  }
})

test('anything else off a form fails closed', () => {
  for (const raw of ['', ' ', 'Exam', 'salary', 'rent', 'admission ', 'null']) {
    assert.equal(isChargeCategory(raw), false, JSON.stringify(raw))
  }
})

test('every category the form offers has a label in both languages', () => {
  // `tsc` already fails on a missing key through the shared dictionary type; this is
  // about the label actually being there to read inside the select.
  for (const category of CHARGE_CATEGORIES) {
    for (const d of [bn, en]) {
      const label = d.fees.categories[category]
      assert.equal(typeof label, 'string', category)
      assert.ok(label.trim().length > 0, category)
    }
  }
})

test('tuition keeps a label too, because the breakdown has a row for it', () => {
  for (const d of [bn, en]) {
    assert.ok(d.fees.categories.tuition.trim().length > 0)
  }
})

test('the roster is one row per student, however many enrolments they hold', () => {
  // A child can sit two subjects in the same batch, and a re-enrolment after a break is
  // a second active row. Two boxes for one child is two rows in one insert carrying the
  // same idempotency key, which the unique index refuses — rolling back the whole run.
  const roster = chargeRoster([
    enrolled('s1', 'Fahmida', '01'),
    enrolled('s1', 'Fahmida', '01'),
    enrolled('s2', 'Rashed', '02'),
  ])

  assert.deepEqual(roster, [
    { id: 's1', name: 'Fahmida', code: '01' },
    { id: 's2', name: 'Rashed', code: '02' },
  ])
})

test('the embed arrives as a row or as a one-element array, and both read', () => {
  // PostgREST answers a to-one embed either way depending on how it resolves the
  // relationship, and the app has been bitten by assuming the object form before.
  const asRow = chargeRoster([enrolled('s1', 'Fahmida', '01')])
  const asArray = chargeRoster([{ students: [{ id: 's1', name: 'Fahmida', student_code: '01' }] }])

  assert.deepEqual(asRow, asArray)
})

test('an enrolment with no student behind it is skipped, not counted', () => {
  const roster = chargeRoster([
    { students: null },
    { students: [] },
    enrolled('s1', 'Fahmida', '01'),
  ])

  assert.deepEqual(roster, [{ id: 's1', name: 'Fahmida', code: '01' }])
})

test('the roster is in register order — code first, then name', () => {
  const roster = chargeRoster([
    enrolled('s3', 'Anika', '07'),
    enrolled('s1', 'Zubair', '02'),
    enrolled('s2', 'Bilkis', '02'),
  ])

  assert.deepEqual(
    roster.map((s) => s.id),
    ['s2', 's1', 's3'],
  )
})

test('a student with no code sorts after one who has it', () => {
  // A centre that numbers its register has numbered the students it wants to find
  // quickly, which is `nullsFirst: false` in the query this mirrors.
  const sorted = [
    student('s1', 'Anika', null),
    student('s2', 'Zubair', '99'),
  ].sort(byRegisterOrder)

  assert.deepEqual(
    sorted.map((s) => s.id),
    ['s2', 's1'],
  )

  // Both uncoded, so the name decides.
  const byName = [
    student('s1', 'Zubair', null),
    student('s2', 'Anika', null),
  ].sort(byRegisterOrder)

  assert.deepEqual(
    byName.map((s) => s.id),
    ['s2', 's1'],
  )
})

test('only students the caller could read for themselves are billed', () => {
  // The ticked ids arrive over HTTP, so they are a claim. The composite foreign key
  // would refuse another centre's student anyway, but as a 400 with no sentence on it.
  const roster = [student('s1', 'Fahmida'), student('s2', 'Rashed')]
  const plan = chargePlan(['s1', 'someone-elses-student', 's2'], roster)

  assert.deepEqual(plan.students, ['s1', 's2'])
  assert.equal(plan.unknown, 1)
})

test('a name that left the roster is counted, not billed', () => {
  // The window between rendering the list and pressing submit is long enough for a
  // student to be retired, and the count is what tells the owner the number of bills is
  // not the number of ticks.
  const plan = chargePlan(['s1', 'gone'], [student('s1', 'Fahmida')])

  assert.deepEqual(plan.students, ['s1'])
  assert.equal(plan.unknown, 1)
})

test('the same student ticked twice is billed once', () => {
  // Not reachable from the form — one checkbox per row — but a replayed or hand-made
  // submission can say it, and the index is (centre, key, student): a doubled student
  // collides with themselves and rolls the whole statement back.
  const plan = chargePlan(['s1', 's1', 's1'], [student('s1', 'Fahmida')])

  assert.deepEqual(plan.students, ['s1'])
  assert.equal(plan.unknown, 0)
})

test('blank and padded ids are dropped without becoming unknowns', () => {
  const roster = [student('s1', 'Fahmida')]
  const plan = chargePlan(['', '   ', ' s1 '], roster)

  assert.deepEqual(plan.students, ['s1'])
  assert.equal(plan.unknown, 0)
})

test('the roster decides the order, so a replay hits the same first row', () => {
  // What makes the retry deterministic: the same ticks in a different field order
  // produce the same insert, so the unique index refuses at the same place rather than
  // part-writing a batch on the second arrival.
  const roster = [student('s1', 'A', '01'), student('s2', 'B', '02'), student('s3', 'C', '03')]

  assert.deepEqual(chargePlan(['s3', 's1', 's2'], roster).students, ['s1', 's2', 's3'])
  assert.deepEqual(chargePlan(['s2', 's3', 's1'], roster).students, ['s1', 's2', 's3'])
})

test('nobody ticked is nobody billed, and nothing unknown', () => {
  const plan = chargePlan([], [student('s1', 'Fahmida')])

  assert.deepEqual(plan.students, [])
  assert.equal(plan.unknown, 0)
})

test('every tick unknown leaves an empty bill list the action can refuse', () => {
  const plan = chargePlan(['x', 'y'], [student('s1', 'Fahmida')])

  assert.deepEqual(plan.students, [])
  assert.equal(plan.unknown, 2)
})

test('the confirmation counts bills and names the fee, in both languages', () => {
  for (const d of [bn, en]) {
    for (const n of [1, 40]) {
      const line = d.fees.chargeCreated(d.fees.categories.exam, n, '৳4,000')
      assert.ok(line.includes(String(n)), line)
      assert.ok(line.includes(d.fees.categories.exam), line)
      assert.ok(line.includes('৳4,000'), line)
    }
    for (const n of [1, 3]) {
      assert.ok(d.fees.chargeUnknown(n).includes(String(n)))
    }
  }
})
