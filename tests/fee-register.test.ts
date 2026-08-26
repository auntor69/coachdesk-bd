/**
 * The collection register's arithmetic.
 *
 * This is the one screen in the product whose whole purpose is to be checked against
 * something else — a bKash statement, the cash in the box, an accountant's own column
 * of figures — and until now every sum on it lived inside a page component and had
 * never been run against a fixture. What is tested here is what an owner would find by
 * finding it wrong: a running total that disagrees with the figure at the foot, a
 * payment taken at 1am dated to the day before, a refund that vanishes into a total
 * without saying so, and a numeric column that arrives as a string and stops adding.
 *
 * Relative imports with extensions — `node --test` on TS, no tsconfig paths.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  registerRows,
  tallyRegister,
  REGISTER_METHODS,
  type RegisterPaymentRow,
} from '../src/lib/fees/register.ts'

const UNKNOWN = 'নাম জানা নেই'

/** A payment, with only the bits a given test cares about spelled out. */
function pay(
  id: string,
  amount: string | number,
  opts: {
    at?: string
    method?: RegisterPaymentRow['method']
    receipt?: number
    name?: string | null
    code?: string | null
    reference?: string | null
  } = {},
): RegisterPaymentRow {
  return {
    id,
    receipt_no: opts.receipt ?? 1,
    amount_bdt: amount,
    method: opts.method ?? 'cash',
    reference: opts.reference ?? null,
    // Midday UTC unless a test is about the boundary, so no ordinary fixture is
    // accidentally sitting on one.
    paid_at: opts.at ?? '2026-08-05T06:00:00Z',
    students:
      opts.name === null ? null : { name: opts.name ?? 'আলী', student_code: opts.code ?? 'S-01' },
  }
}

test('every row carries the total up to and including itself', () => {
  // The column exists so an owner can find the row where this page and a wallet
  // statement stopped agreeing. A single figure at the bottom says the answer is wrong
  // and nothing about where.
  const rows = registerRows([pay('p1', 1000), pay('p2', 500), pay('p3', 250)], UNKNOWN)

  assert.deepEqual(
    rows.map((r) => r.running),
    [1000, 1500, 1750],
  )
})

test('the figure at the foot is the last running total', () => {
  // Two sums over the same rows, and the page prints both. A reader who finds them a
  // taka apart stops believing the page.
  const rows = registerRows([pay('p1', '1200.50'), pay('p2', '399.50'), pay('p3', -100)], UNKNOWN)
  const tally = tallyRegister(rows)

  assert.equal(tally.total, rows[rows.length - 1].running)
  assert.equal(tally.total, 1500)
})

test('the rows are printed in the order they arrived, never re-sorted', () => {
  // The query orders by paid_at then receipt_no. A running total that disagreed with
  // the order the rows are drawn in would be arithmetic nobody could follow down a
  // printed page.
  const rows = registerRows(
    [pay('p1', 100, { at: '2026-08-09T06:00:00Z' }), pay('p2', 100, { at: '2026-08-02T06:00:00Z' })],
    UNKNOWN,
  )

  assert.deepEqual(
    rows.map((r) => r.id),
    ['p1', 'p2'],
  )
})

test('a refund is flagged, keeps its sign, and takes the running total down', () => {
  // The whole reason this file exists. A refund is a fee_payments row with a negative
  // amount, so on the sheet it is one minus sign at the left of a right-aligned figure
  // in a column of figures that all look like it.
  const rows = registerRows([pay('p1', 2000), pay('p2', -500)], UNKNOWN)

  assert.equal(rows[0].refund, false)
  assert.equal(rows[1].refund, true)
  assert.equal(rows[1].amount, -500)
  assert.deepEqual(
    rows.map((r) => r.running),
    [2000, 1500],
  )
})

test('a payment of nothing is not a refund', () => {
  // A correction that cancelled itself. Calling it a refund would print the word on a
  // row where nothing was handed back.
  const rows = registerRows([pay('p1', 0)], UNKNOWN)
  assert.equal(rows[0].refund, false)
})

test('what came in and what went back add up to the collection, exactly', () => {
  // Three figures on the page, and the third is the sum of the first two — the same
  // shape as a waived bill on the fee board. If they ever disagree, the sheet is
  // printing a subtraction that does not work, which is worse than printing no
  // subtraction at all.
  const rows = registerRows(
    [pay('p1', 2000), pay('p2', -500), pay('p3', '1499.50'), pay('p4', -0.5)],
    UNKNOWN,
  )
  const tally = tallyRegister(rows)

  assert.equal(tally.grossIn, 3499.5)
  assert.equal(tally.refunded, -500.5)
  assert.equal(tally.total, 2999)
  assert.equal(tally.grossIn + tally.refunded, tally.total)
})

test('a month with no refunds reports none, which is what hides the two extra lines', () => {
  const tally = tallyRegister(registerRows([pay('p1', 1000)], UNKNOWN))

  assert.equal(tally.refunded, 0)
  assert.equal(tally.grossIn, 1000)
  assert.equal(tally.total, 1000)
})

test('numeric over the wire is a string and still adds up as money', () => {
  // PostgREST serialises numeric as a string. '1200.50' + '399.50' has to be 1600.
  const rows = registerRows([pay('p1', '1200.50'), pay('p2', '399.50')], UNKNOWN)

  assert.equal(rows[0].amount, 1200.5)
  assert.equal(rows[1].running, 1600)
})

test('a row whose amount will not parse is dropped, not counted as nothing', () => {
  // A line reading ৳0 for money that did cross the desk is a wrong figure where an
  // absent one would have been a question.
  const rows = registerRows([pay('p1', 1000), pay('p2', 'oops'), pay('p3', 500)], UNKNOWN)

  assert.deepEqual(
    rows.map((r) => r.id),
    ['p1', 'p3'],
  )
  assert.equal(tallyRegister(rows).total, 1500)
})

test('the date is the Dhaka day, not a slice of the UTC timestamp', () => {
  // 1am on the 5th in Dhaka is still the 4th in UTC. On a page whose whole job is to be
  // checked against a statement that got it right, that payment belongs on the 5th.
  const rows = registerRows([pay('p1', 500, { at: '2026-08-04T19:00:00Z' })], UNKNOWN)
  assert.equal(rows[0].date, '2026-08-05')
})

test('the last payment of a month stays inside it', () => {
  // 11pm Dhaka on the 31st: 17:00 UTC the same day. A register that pushed it into
  // September would leave the owner reconciling two months against one statement.
  const rows = registerRows([pay('p1', 500, { at: '2026-08-31T17:00:00Z' })], UNKNOWN)
  assert.equal(rows[0].date, '2026-08-31')
})

test('a student embed arriving as a one-element array is read the same way', () => {
  const row: RegisterPaymentRow = {
    ...pay('p1', 500),
    students: [{ name: 'মিম', student_code: 'S-09' }],
  }
  const rows = registerRows([row], UNKNOWN)

  assert.equal(rows[0].name, 'মিম')
  assert.equal(rows[0].code, 'S-09')
})

test('a payment whose student is gone is still a row, under a name that says so', () => {
  // The money crossed the desk. A register that dropped the row would stop matching the
  // drawer, and one that rendered "undefined" would be worse than one that says nothing.
  const rows = registerRows([pay('p1', 500, { name: null })], UNKNOWN)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, UNKNOWN)
  assert.equal(rows[0].code, null)
  assert.equal(rows[0].amount, 500)
})

test('nothing collected is an empty sheet and a set of zeroes, not a crash', () => {
  for (const payments of [[], null, undefined]) {
    const tally = tallyRegister(registerRows(payments, UNKNOWN))
    assert.deepEqual(tally.byMethod, [])
    assert.equal(tally.entries, 0)
    assert.equal(tally.grossIn, 0)
    assert.equal(tally.refunded, 0)
    assert.equal(tally.total, 0)
  }
})

test('the breakdown is netted per method, because that is what a wallet statement is', () => {
  // "৳48,000 collected" cannot be checked against anything. "৳1,500 through bKash" can be
  // checked against exactly one thing — and the statement held against it has the refund
  // on it too, so netting the refund into its own method is what makes them agree.
  const tally = tallyRegister(
    registerRows(
      [
        pay('p1', 2000, { method: 'bkash' }),
        pay('p2', -500, { method: 'bkash' }),
        pay('p3', 1000, { method: 'cash' }),
      ],
      UNKNOWN,
    ),
  )

  assert.deepEqual(tally.byMethod, [
    { method: 'cash', amount: 1000, entries: 1 },
    { method: 'bkash', amount: 1500, entries: 2 },
  ])
})

test('the breakdown is in a fixed order, whatever order the month came in', () => {
  // Two months printed side by side have their lines in the same places, and the order is
  // the one the collection form offers.
  const tally = tallyRegister(
    registerRows(
      [pay('p1', 100, { method: 'other' }), pay('p2', 100, { method: 'nagad' }), pay('p3', 100, { method: 'cash' })],
      UNKNOWN,
    ),
  )

  assert.deepEqual(
    tally.byMethod.map((m) => m.method),
    ['cash', 'nagad', 'other'],
  )
  // And the fixed order is the collection form's, cash first.
  assert.equal(REGISTER_METHODS[0], 'cash')
})

test('a method that netted to nothing still gets its line', () => {
  // ৳500 in by bKash and the same ৳500 back out is not a month with no bKash in it; it is
  // two lines on the wallet statement. An owner looking for them wants to find bKash here
  // reading ৳0 rather than not find it at all.
  const tally = tallyRegister(
    registerRows([pay('p1', 500, { method: 'bkash' }), pay('p2', -500, { method: 'bkash' })], UNKNOWN),
  )

  assert.deepEqual(tally.byMethod, [{ method: 'bkash', amount: 0, entries: 2 }])
  assert.equal(tally.total, 0)
})

test('a method the month never used is left off', () => {
  const tally = tallyRegister(registerRows([pay('p1', 500, { method: 'cash' })], UNKNOWN))
  assert.deepEqual(
    tally.byMethod.map((m) => m.method),
    ['cash'],
  )
})

test('entries counts payments and not students, refunds included', () => {
  // One family can pay twice in a month, and a refund is a line on the sheet like any
  // other — the count under the total is a count of lines.
  const tally = tallyRegister(
    registerRows([pay('p1', 500), pay('p2', 500), pay('p3', -200)], UNKNOWN),
  )
  assert.equal(tally.entries, 3)
})
