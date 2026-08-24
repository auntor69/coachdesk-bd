import { test } from 'node:test'
import assert from 'node:assert/strict'

import { billableEnrollments, type EnrollmentRow } from '../src/lib/fees/billable.ts'

/** One row as PostgREST hands it over: numeric as a string, embed as an object. */
function row(
  id: string,
  fee: number | string | null,
  active: boolean | null = true,
): EnrollmentRow {
  return {
    id,
    student_id: `student-${id}`,
    batches: { monthly_fee_bdt: fee, active },
  }
}

test('bills one line per enrolment, carrying the batch price', () => {
  const out = billableEnrollments([row('a', '800'), row('b', 1200)])
  assert.deepEqual(out, [
    { enrollmentId: 'a', studentId: 'student-a', fee: 800 },
    { enrollmentId: 'b', studentId: 'student-b', fee: 1200 },
  ])
})

test('a batch that has stopped running stops billing', () => {
  // The whole reason this function exists. `active` is what the register and the
  // settings count read, and until it was read here too, closing a batch left the
  // parents of a class that no longer met getting a bill for it every month.
  assert.deepEqual(billableEnrollments([row('a', '800', false)]), [])

  // A closed batch does not take its classmates down with it.
  const mixed = billableEnrollments([row('open', '800'), row('shut', '800', false)])
  assert.deepEqual(
    mixed.map((b) => b.enrollmentId),
    ['open'],
  )
})

test('null active is treated as closed, not as running', () => {
  // The column is `not null default true`, so this cannot come from the table — it
  // can only come from a row that arrived without its embed filled in. Billing on a
  // maybe is the one direction this must not fail in.
  assert.deepEqual(billableEnrollments([row('a', '800', null)]), [])
})

test('a free batch is not billed for nothing', () => {
  for (const fee of [0, '0', '0.00', -50]) {
    assert.deepEqual(billableEnrollments([row('a', fee)]), [], `fee: ${String(fee)}`)
  }
})

test('a price that did not survive the wire is skipped, not billed as NaN', () => {
  for (const fee of [null, '', 'eight hundred']) {
    assert.deepEqual(billableEnrollments([row('a', fee)]), [], `fee: ${String(fee)}`)
  }
})

test('a missing batch is no price, so no bill', () => {
  assert.deepEqual(
    billableEnrollments([{ id: 'a', student_id: 'student-a', batches: null }]),
    [],
  )
  assert.deepEqual(billableEnrollments([{ id: 'a', student_id: 'student-a', batches: [] }]), [])
})

test('the embed is read whether it arrives as an object or an array', () => {
  const asArray: EnrollmentRow = {
    id: 'a',
    student_id: 'student-a',
    batches: [{ monthly_fee_bdt: '950', active: true }],
  }
  assert.deepEqual(billableEnrollments([asArray]), [
    { enrollmentId: 'a', studentId: 'student-a', fee: 950 },
  ])
})

test('a fee with paisa is carried through as it stands', () => {
  // Nothing here rounds. The invoice snapshots what the batch charged, and money
  // arithmetic on the board is money.ts's job, not this function's.
  assert.equal(billableEnrollments([row('a', '799.50')])[0].fee, 799.5)
})
