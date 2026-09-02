/**
 * A fee split into parts that add back up to it.
 *
 * WHAT THIS FILE IS ACTUALLY GUARDING. The parts become separate rows in `fee_invoices`, and
 * nothing in the schema can notice that they were meant to total ৳5,000 — there is no plan
 * row holding the agreed figure to check them against. If the split loses a poisha the family
 * is billed ৳4,999.99 for a ৳5,000 fee, the owner has no screen that says so, and the
 * difference surfaces months later as an arrear nobody can explain.
 *
 * So the sums below are asserted as sums: every case adds its parts back up and compares
 * against the total, in poisha, the way Postgres would.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_INSTALMENTS,
  MIN_INSTALMENTS,
  instalmentPlan,
  instalmentVerdict,
  readInstalmentCount,
  splitInstalments,
} from '../src/lib/fees/instalments.ts'

/** Poisha, so a comparison of two totals is a comparison of two integers. */
const whole = (amounts: readonly number[]) =>
  amounts.reduce((sum, a) => sum + Math.round(a * 100), 0)

test('the parts add back up to the fee, whatever the split', () => {
  for (const total of [6000, 5000, 1500, 999.99, 1234.56, 0.05, 33.33, 2]) {
    for (let count = MIN_INSTALMENTS; count <= MAX_INSTALMENTS; count++) {
      const parts = splitInstalments(total, count)
      if (parts.length === 0) continue
      assert.equal(
        whole(parts),
        Math.round(total * 100),
        `${total} over ${count} parts should still be ${total}`,
      )
    }
  }
})

test('a fee that divides evenly divides evenly', () => {
  assert.deepEqual(splitInstalments(6000, 3), [2000, 2000, 2000])
  assert.deepEqual(splitInstalments(1500, 2), [750, 750])
})

test('the odd poisha goes to the earliest parts', () => {
  // 500000 poisha over three is 166666 each with two left over, so the first two carry it.
  assert.deepEqual(splitInstalments(5000, 3), [1666.67, 1666.67, 1666.66])
  assert.deepEqual(splitInstalments(1000, 3), [333.34, 333.33, 333.33])
})

test('a fee of two poisha over two parts is a poisha each', () => {
  // The smallest plan the verdict allows. One poisha further down is refused below.
  assert.deepEqual(splitInstalments(0.02, 2), [0.01, 0.01])
})

test('a plan with an empty part is refused rather than billed', () => {
  assert.equal(instalmentVerdict(3, 0.02), 'tooSmall')
  assert.deepEqual(splitInstalments(0.02, 3), [])
})

test('one part is not a plan and neither is thirteen', () => {
  assert.equal(instalmentVerdict(1, 6000), 'outOfRange')
  assert.equal(instalmentVerdict(MAX_INSTALMENTS + 1, 6000), 'outOfRange')
  assert.equal(instalmentVerdict(MIN_INSTALMENTS, 6000), 'ok')
  assert.equal(instalmentVerdict(MAX_INSTALMENTS, 6000), 'ok')
})

test('a fee of nothing cannot be spread', () => {
  assert.equal(instalmentVerdict(3, 0), 'unreadable')
  assert.equal(instalmentVerdict(3, -6000), 'unreadable')
  assert.equal(instalmentVerdict(3, Number.NaN), 'unreadable')
})

test('a count that is not a whole number is named unreadable, not out of range', () => {
  assert.equal(instalmentVerdict(2.5, 6000), 'unreadable')
  assert.equal(instalmentVerdict(Number.NaN, 6000), 'unreadable')
})

test('a missing count means pay in full, so a replayed offline charge still bills', () => {
  // The load-bearing one, matching readBasis in ./scholarship.ts: useOffline replays a
  // queued Server Action, and a request queued before this field existed carries no count.
  assert.equal(readInstalmentCount(null), 1)
  assert.equal(readInstalmentCount(undefined), 1)
  assert.equal(readInstalmentCount(''), 1)
  assert.equal(readInstalmentCount(42), 1)
})

test('a count the form could not have produced is refused rather than guessed at', () => {
  assert.equal(readInstalmentCount('three'), null)
  assert.equal(readInstalmentCount('2.5'), null)
  assert.equal(readInstalmentCount('0'), null)
  assert.equal(readInstalmentCount('-3'), null)
  assert.equal(readInstalmentCount(String(MAX_INSTALMENTS + 1)), null)
})

test('a count the form did produce is read', () => {
  assert.equal(readInstalmentCount('1'), 1)
  assert.equal(readInstalmentCount('3'), 3)
  assert.equal(readInstalmentCount(' 3 '), 3)
  assert.equal(readInstalmentCount(String(MAX_INSTALMENTS)), MAX_INSTALMENTS)
})

test('each part is billed in its own month, on the day that was chosen', () => {
  assert.deepEqual(
    instalmentPlan({ total: 6000, count: 3, firstMonth: '2026-08-01', dueDay: 10 }),
    [
      { no: 1, of: 3, amountBdt: 2000, periodMonth: '2026-08-01', dueDate: '2026-08-10' },
      { no: 2, of: 3, amountBdt: 2000, periodMonth: '2026-09-01', dueDate: '2026-09-10' },
      { no: 3, of: 3, amountBdt: 2000, periodMonth: '2026-10-01', dueDate: '2026-10-10' },
    ],
  )
})

test('a plan that runs into the next year crosses December', () => {
  const plan = instalmentPlan({
    total: 3000,
    count: 3,
    firstMonth: '2026-11-01',
    dueDay: 5,
  })
  assert.deepEqual(
    plan.map((part) => part.dueDate),
    ['2026-11-05', '2026-12-05', '2027-01-05'],
  )
})

test('a due day past the 28th is the 28th, so February is not a special case', () => {
  const plan = instalmentPlan({
    total: 2000,
    count: 2,
    firstMonth: '2027-01-01',
    dueDay: 31,
  })
  assert.deepEqual(
    plan.map((part) => part.dueDate),
    ['2027-01-28', '2027-02-28'],
  )
})

test('a plan nobody could be billed is empty rather than nearly right', () => {
  assert.deepEqual(
    instalmentPlan({ total: 6000, count: 1, firstMonth: '2026-08-01', dueDay: 10 }),
    [],
  )
  assert.deepEqual(
    instalmentPlan({ total: 0, count: 3, firstMonth: '2026-08-01', dueDay: 10 }),
    [],
  )
})

test('every part of a plan carries the same count, which is what the label reads from', () => {
  const plan = instalmentPlan({ total: 5000, count: 4, firstMonth: '2026-08-01', dueDay: 1 })
  assert.equal(plan.length, 4)
  for (const part of plan) assert.equal(part.of, 4)
  assert.deepEqual(
    plan.map((part) => part.no),
    [1, 2, 3, 4],
  )
  assert.equal(whole(plan.map((part) => part.amountBdt)), 500000)
})
