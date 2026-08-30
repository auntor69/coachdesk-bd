/**
 * The month's spending, added up.
 *
 * The screen that reads this is one of two an owner uses to answer "did the centre make
 * money", and the trap in it is not arithmetic: it is that this month's spending and the
 * spending the profit line subtracts are two different figures whenever a `salary` row is
 * present, because `center_profit_month` excludes that category and reads payroll from
 * another table instead. What is tested here is what an owner would only find by finding it
 * wrong — a total that quietly includes money the profit figure never took off, a category
 * line missing from a breakdown that is printed under the total it is supposed to explain,
 * a correction that vanishes into a sum without saying so, and a numeric column that
 * arrives as a string and stops adding.
 *
 * Relative imports with extensions — `node --test` on TS, no tsconfig paths.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  expenseRows,
  tallyExpenses,
  type ExpenseSourceRow,
} from '../src/lib/expenses/tally.ts'
import { EXPENSE_CATEGORIES, PAYROLL_CATEGORY } from '../src/lib/expenses/categories.ts'
import { sumTaka } from '../src/lib/money.ts'

/** One expense, with only the bits a given test cares about spelled out. */
function spend(
  id: string,
  amount: string | number,
  opts: {
    on?: string
    category?: ExpenseSourceRow['category']
    method?: ExpenseSourceRow['method']
    voucher?: number
    note?: string | null
    reference?: string | null
    recurring?: boolean
  } = {},
): ExpenseSourceRow {
  return {
    id,
    voucher_no: opts.voucher ?? 1,
    category: opts.category ?? 'miscellaneous',
    amount_bdt: amount,
    spent_on: opts.on ?? '2026-08-05',
    method: opts.method ?? 'cash',
    reference: opts.reference ?? null,
    note: opts.note ?? null,
    recurring: opts.recurring ?? false,
  }
}

test('the rows come out in the order the query put them, newest first', () => {
  // `spent_on desc, voucher_no desc` out of the query. A module that re-sorted would be
  // disagreeing with the page about what it is describing.
  const rows = expenseRows([
    spend('e1', 100, { on: '2026-08-20' }),
    spend('e2', 100, { on: '2026-08-02' }),
  ])

  assert.deepEqual(
    rows.map((r) => r.id),
    ['e1', 'e2'],
  )
})

test('a row carries what the list prints, field for field', () => {
  // Cheap, and it catches the one bug this shape invites: `reference` reading the note, or
  // the voucher number arriving where the amount goes.
  const rows = expenseRows([
    spend('e1', 15000, {
      category: 'rent',
      method: 'bkash',
      voucher: 7,
      note: 'শ্রাবণ মাসের ভাড়া',
      reference: 'TRX9911',
      recurring: true,
      on: '2026-08-03',
    }),
  ])

  assert.deepEqual(rows[0], {
    id: 'e1',
    voucherNo: 7,
    category: 'rent',
    date: '2026-08-03',
    method: 'bkash',
    reference: 'TRX9911',
    note: 'শ্রাবণ মাসের ভাড়া',
    recurring: true,
    amount: 15000,
    correction: false,
    deferredToPayroll: false,
  })
})

test('the date is the day the column says, not a day either side of it', () => {
  // `spent_on` is a `date`, defaulted in Postgres from Asia/Dhaka. The register has to
  // convert its `paid_at timestamptz` or a payment taken at 1am is dated to the day
  // before; doing that again to a plain date treats it as a UTC midnight and hands back
  // the day before in any environment west of Greenwich. This pins the pass-through.
  const rows = expenseRows([spend('e1', 500, { on: '2026-08-01' })])
  assert.equal(rows[0].date, '2026-08-01')
})

test('numeric over the wire is a string and still adds up as money', () => {
  // PostgREST serialises numeric as a string. '1200.50' + '399.50' has to be 1600.
  const rows = expenseRows([spend('e1', '1200.50'), spend('e2', '399.50')])

  assert.equal(rows[0].amount, 1200.5)
  assert.equal(tallyExpenses(rows).total, 1600)
})

test('a row whose amount will not parse is dropped, not counted as nothing', () => {
  // A line reading ৳0 for money that did leave the drawer is a wrong figure where an
  // absent one would have been a question.
  const rows = expenseRows([spend('e1', 1000), spend('e2', 'oops'), spend('e3', 500)])

  assert.deepEqual(
    rows.map((r) => r.id),
    ['e1', 'e3'],
  )
  assert.equal(tallyExpenses(rows).total, 1500)
})

test('a correction is flagged and keeps its sign', () => {
  // The table revokes DELETE and admits a negative amount, so a negative row is the only
  // way to correct a figure entered wrong — the register's refund, on the other side of
  // the drawer.
  const rows = expenseRows([spend('e1', 2000, { category: 'printing' }), spend('e2', -2000, { category: 'printing' })])

  assert.equal(rows[0].correction, false)
  assert.equal(rows[1].correction, true)
  assert.equal(rows[1].amount, -2000)
  assert.equal(tallyExpenses(rows).total, 0)
})

test('an expense of nothing is not a correction', () => {
  // `check (amount_bdt <> 0)` means the table refuses this row, so the assertion is about
  // the boundary of the flag rather than about a row that can arrive: the sign test is
  // `< 0`, and a future `<= 0` would put the word "correction" on a row where nothing came
  // back.
  assert.equal(expenseRows([spend('e1', 0)])[0].correction, false)
})

test('a salary row is flagged as the profit line not reading it', () => {
  // The whole reason this module has a third figure. `center_profit_month` excludes this
  // category from its expense side and takes payroll from `salary_payments`, so this row is
  // subtracted by neither half of that view.
  const rows = expenseRows([
    spend('e1', 40000, { category: PAYROLL_CATEGORY }),
    spend('e2', 15000, { category: 'rent' }),
  ])

  assert.equal(rows[0].deferredToPayroll, true)
  assert.equal(rows[1].deferredToPayroll, false)
})

test('what the profit line reads and what it leaves to payroll add up to the month, exactly', () => {
  // Three figures on the page and the third is the sum of the first two — the register's
  // gross/refunded/collection, and a waived bill on the fee board. If they ever disagree,
  // the screen is printing a subtraction that does not work.
  const rows = expenseRows([
    spend('e1', '15000.50', { category: 'rent' }),
    spend('e2', 40000, { category: PAYROLL_CATEGORY }),
    spend('e3', -500, { category: 'printing' }),
    spend('e4', '-0.50', { category: PAYROLL_CATEGORY }),
  ])
  const tally = tallyExpenses(rows)

  assert.equal(tally.counted, 14500.5)
  assert.equal(tally.deferredToPayroll, 39999.5)
  assert.equal(tally.total, 54500)
  assert.equal(tally.counted + tally.deferredToPayroll, tally.total)
})

test('a month with no salary rows defers nothing, which is what hides the extra line', () => {
  const tally = tallyExpenses(expenseRows([spend('e1', 15000, { category: 'rent' })]))

  assert.equal(tally.deferredToPayroll, 0)
  assert.equal(tally.counted, 15000)
  assert.equal(tally.total, 15000)
})

test('the month total includes the salary rows, because that money did leave the drawer', () => {
  // The figure at the top of the screen answers "what did the centre spend", and a centre
  // that handed ৳40,000 to its teachers spent it. That the profit line reads it from
  // somewhere else is the next sentence, not a reason to leave it out of this one.
  const tally = tallyExpenses(expenseRows([spend('e1', 40000, { category: PAYROLL_CATEGORY })]))

  assert.equal(tally.total, 40000)
  assert.equal(tally.counted, 0)
  assert.equal(tally.deferredToPayroll, 40000)
})

test('the breakdown is in a fixed order, whatever order the month came in', () => {
  // Two months printed side by side have their lines in the same places, and the order is
  // the picker's rather than the month's.
  const tally = tallyExpenses(
    expenseRows([
      spend('e1', 100, { category: 'miscellaneous' }),
      spend('e2', 100, { category: 'internet' }),
      spend('e3', 100, { category: 'rent' }),
    ]),
  )

  assert.deepEqual(
    tally.byCategory.map((c) => c.category),
    ['rent', 'internet', 'miscellaneous'],
  )
  // And the fixed order is the enum's, rent first: it is the biggest thing most centres pay.
  assert.equal(EXPENSE_CATEGORIES[0], 'rent')
})

test('a category that netted to nothing still gets its line', () => {
  // ৳2,000 of printing and the same ৳2,000 corrected away is not a month with no printing
  // in it; it is a mistake and its correction, and an owner looking for that pair wants to
  // find the line reading ৳0 rather than not find it at all.
  const tally = tallyExpenses(
    expenseRows([
      spend('e1', 2000, { category: 'printing' }),
      spend('e2', -2000, { category: 'printing' }),
    ]),
  )

  assert.deepEqual(tally.byCategory, [{ category: 'printing', amount: 0, entries: 2 }])
})

test('a category the month never used is left off', () => {
  const tally = tallyExpenses(expenseRows([spend('e1', 500, { category: 'transport' })]))
  assert.deepEqual(
    tally.byCategory.map((c) => c.category),
    ['transport'],
  )
})

test('the breakdown adds up to the total, whichever category the money went to', () => {
  // The invariant the foot of the screen rests on. Built from EXPENSE_CATEGORIES and
  // counted against it, which is the lesson the payment-method list taught the register: a
  // test that took its rows from the same list the breakdown iterates can never catch that
  // list being short, because the category it forgot is a row the test never makes.
  // EXPENSE_CATEGORIES is checked against the enum by the compiler (ALL_CATEGORIES_LISTED),
  // so this fails on both halves of the drift — a value added to the enum and not to the
  // list, and a breakdown that stops iterating the whole list.
  const rows = expenseRows(
    EXPENSE_CATEGORIES.map((category, i) => spend(`e${i}`, 100 * (i + 1), { category })),
  )
  const tally = tallyExpenses(rows)

  assert.equal(tally.byCategory.length, EXPENSE_CATEGORIES.length)
  assert.equal(sumTaka(tally.byCategory.map((c) => c.amount)), tally.total)
  assert.equal(tally.entries, EXPENSE_CATEGORIES.length)
})

test('the category the profit line skips is one of the ones the picker offers', () => {
  // The runtime half of the pair in categories.ts. If `salary` ever left the list, the form
  // could not write it — but rows already in the table would still carry it, and a
  // `deferredToPayroll` that can never be true is a screen that has stopped mentioning
  // ৳40,000 of a month's spending.
  assert.ok(EXPENSE_CATEGORIES.includes(PAYROLL_CATEGORY))
})

test('entries counts rows, corrections included', () => {
  const tally = tallyExpenses(
    expenseRows([spend('e1', 500), spend('e2', 500), spend('e3', -200)]),
  )
  assert.equal(tally.entries, 3)
})

test('nothing spent is an empty list and a set of zeroes, not a crash', () => {
  for (const rows of [[], null, undefined]) {
    const tally = tallyExpenses(expenseRows(rows))
    assert.deepEqual(tally.byCategory, [])
    assert.equal(tally.entries, 0)
    assert.equal(tally.total, 0)
    assert.equal(tally.counted, 0)
    assert.equal(tally.deferredToPayroll, 0)
  }
})





