/**
 * The profit line's three nulls.
 *
 * There is no arithmetic under test in this file, which is the point of the file. §9.8's
 * subtraction lives in `center_profit_month` and is done by Postgres in numeric(12, 2);
 * what ../src/lib/finance/profit.ts adds is a set of decisions about ABSENCE, and every
 * one of them has a wrong answer that looks completely normal on screen:
 *
 *   * a read that failed drawn as ৳0 collected, ৳0 spent, ৳0 profit — four true-looking
 *     noughts on the screen a centre judges the month by;
 *   * a salary count that failed read as "this centre has no staff", which takes the
 *     warning off a profit figure missing the entire wage bill;
 *   * and the reverse, a centre that genuinely has no staff warned every month about
 *     salaries it does not owe, until the warning is furniture and nobody reads the one
 *     that matters.
 *
 * So the tests below are almost all about `null`, and the two that are about numbers are
 * about numbers arriving as strings — which is what PostgREST does to `numeric`, whatever
 * the generated types say.
 *
 * Relative imports with extensions — `node --test` on TS, no tsconfig paths.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  categoryBills,
  monthBills,
  monthMoney,
  payrollState,
  type CategoryChargesRow,
  type ChargesRow,
  type ProfitRow,
} from '../src/lib/finance/profit.ts'

/** A row as PostgREST hands it over: every numeric column a string. */
function row(collected: string, expenses: string, payroll: string, profit: string): ProfitRow {
  return {
    collected_bdt: collected,
    expenses_bdt: expenses,
    payroll_bdt: payroll,
    profit_bdt: profit,
  }
}

test('a read that failed is nobody speaking for the month, not a month of noughts', () => {
  // Both arguments say "no row" and the answers are opposites. This is the whole reason
  // the function takes a second argument at all.
  assert.equal(monthMoney(null, true), null)
  assert.deepEqual(monthMoney(null, false), {
    collected: 0,
    expenses: 0,
    payroll: 0,
    profit: 0,
  })

  // And a row that did arrive is not discarded because the flag was passed wrongly — the
  // flag decides only when there is nothing to read.
  assert.equal(monthMoney(row('1', '1', '1', '1'), true), null)
})

test('numeric columns arrive as strings and come out as numbers', () => {
  const money = monthMoney(row('82000.00', '21000.50', '38000.00', '22999.50'), false)

  assert.deepEqual(money, {
    collected: 82000,
    expenses: 21000.5,
    payroll: 38000,
    profit: 22999.5,
  })
})

test('profit is the views own column and is never recomputed here', () => {
  /*
   * A row whose profit disagrees with its three terms cannot come out of the view — the
   * column is computed from them in the same select. It is passed here to pin WHICH of the
   * two figures this module reports, because the moment it starts subtracting in
   * JavaScript the paisa on some months will differ from what Postgres calculated, and the
   * same month will read two ways depending on which screen an owner opens.
   */
  const money = monthMoney(row('100', '10', '10', '999'), false)

  assert.equal(money?.profit, 999)
})

test('a loss survives, because a loss is the figure worth reading', () => {
  const money = monthMoney(row('10000', '14000', '9000', '-13000'), false)

  assert.equal(money?.profit, -13000)
})

test('a column the view could not have sent reads as nothing rather than NaN', () => {
  // Unreachable while the view keeps its `coalesce`s. It is here because NaN would
  // propagate silently — formatTaka prints "৳0" for it — and the nought would then be
  // three subtractions away from the shape change that caused it. Three ways for a
  // string to not be a finite number: absent, unparseable, and larger than a double.
  const money = monthMoney(
    { collected_bdt: null, expenses_bdt: '1e999', payroll_bdt: 'x', profit_bdt: '' },
    false,
  )

  assert.deepEqual(money, { collected: 0, expenses: 0, payroll: 0, profit: 0 })
})

test('the month billed is a separate read and fails on its own', () => {
  const charges: ChargesRow = {
    charged_bdt: '95000.00',
    paid_bdt: '82000.00',
    outstanding_bdt: '13000.00',
  }

  assert.deepEqual(monthBills(charges, false), {
    charged: 95000,
    paid: 82000,
    outstanding: 13000,
  })
  assert.equal(monthBills(charges, true), null)
  // A month nobody has billed for. Not the same state as no profit row — a centre can
  // bill in March and take no cash until April — which is why these are two reads.
  assert.deepEqual(monthBills(null, false), { charged: 0, paid: 0, outstanding: 0 })
})

test('a family that paid ahead leaves the month owing less than nothing', () => {
  // Kept signed rather than floored at zero. The screen decides what to print for it;
  // this decides only that it is not hidden, because "৳0 still owed" and "৳500 paid
  // ahead" are different sentences and the second one is the true one.
  const bills = monthBills(
    { charged_bdt: '5000', paid_bdt: '5500', outstanding_bdt: '-500' },
    false,
  )

  assert.equal(bills?.outstanding, -500)
})

test('nobody on a salary is silence, not a monthly warning', () => {
  // The common case in Bangladesh: an owner who teaches. A profit line with no payroll
  // term in it is correct for them, and a warning every month would train them past the
  // one they need the month they hire somebody.
  assert.deepEqual(payrollState(0, 0), { kind: 'noTerms' })
})

test('agreements with nothing paid for the month is the loud state', () => {
  // The figure above this warning is missing the whole wage bill, which is the largest
  // single number in the business.
  assert.deepEqual(payrollState(9, 0), { kind: 'unpaid', people: 9 })
})

test('one payment is enough to make the payroll term real', () => {
  // `recorded` and not `complete`: two payments can belong to one person, so no pair of
  // counts can say whether everybody has been paid. What it can say is that the figure
  // is not empty and that anybody still unpaid is outside it.
  assert.deepEqual(payrollState(9, 4), { kind: 'recorded', payments: 4 })
  assert.deepEqual(payrollState(9, 14), { kind: 'recorded', payments: 14 })
})

test('a payment against a retired agreement still counts as paid', () => {
  // Everybody's terms stopped and a salary still went out for the month. Rare, and the
  // honest reading is that the money left the centre — `salary_payments` revokes DELETE,
  // so it did.
  assert.deepEqual(payrollState(0, 2), { kind: 'recorded', payments: 2 })
})

test('a salary count that did not arrive is never read as having no staff', () => {
  // The bug this module exists to prevent. Either null takes the warning off a profit
  // figure that may be missing the wage bill, so neither may resolve to `noTerms`.
  assert.deepEqual(payrollState(null, 0), { kind: 'unknown' })
  assert.deepEqual(payrollState(null, null), { kind: 'unknown' })
  assert.deepEqual(payrollState(0, null), { kind: 'unknown' })
  assert.deepEqual(payrollState(9, null), { kind: 'unknown' })
})

test('an unknown agreement count does not silence a known payment count', () => {
  /*
   * The two nulls are not interchangeable, and collapsing them into one guard at the top
   * was the first way this was written. "Four payments are recorded for August" needs no
   * agreement count to be true, and withholding it would put "we cannot tell" on a month
   * whose payroll is demonstrably in the figure.
   */
  assert.deepEqual(payrollState(null, 4), { kind: 'recorded', payments: 4 })
})

/*
 * ---------------------------------------------------------------------------
 * §9.7's split, which is the same three figures one grouping finer.
 *
 * Still no arithmetic under test, and that is the invariant these guard: the six lines
 * sum to `fee_charges_month` in Postgres, so summing them again in JavaScript floats
 * would put a different total on the same card. Every figure below is carried, never
 * added.
 * ---------------------------------------------------------------------------
 */

/** One line of the view, numerics as strings, the way PostgREST sends them. */
function line(
  category: string | null,
  charged: string,
  paid: string,
  outstanding: string,
): CategoryChargesRow {
  return {
    revenue_category: category,
    charged_bdt: charged,
    paid_bdt: paid,
    outstanding_bdt: outstanding,
  }
}

test('the split is in the enum order, whatever order the rows arrive in', () => {
  // The same order every month is what makes March comparable against September at a
  // glance. Sorted by size, the biggest line would move and the comparison would have to
  // be read rather than seen.
  const lines = categoryBills([
    line('other', '500', '0', '500'),
    line('exam', '4000', '4000', '0'),
    line('tuition', '90000', '60000', '30000'),
    line('admission', '15000', '15000', '0'),
  ])

  assert.deepEqual(
    lines.map((l) => l.category),
    ['tuition', 'admission', 'exam', 'other'],
  )
})

test('every figure is the view\u2019s own, read and not recomputed', () => {
  // `outstanding` is deliberately not `charged - paid` here: Postgres did that in
  // numeric(12, 2), and a second subtraction in floats would disagree in the paisa on
  // some months — which is the one thing a finance screen may never do.
  const [only] = categoryBills([line('exam', '4000.50', '1000.25', '3000.25')])

  assert.deepEqual(only, {
    category: 'exam',
    charged: 4000.5,
    paid: 1000.25,
    outstanding: 3000.25,
  })
})

test('a read that did not arrive is no breakdown, not a tuition-only month', () => {
  // The same class of lie as a failed profit read drawn as four noughts: this one would
  // tell an owner their admission season raised nothing.
  assert.deepEqual(categoryBills(null), [])
  assert.deepEqual(categoryBills([]), [])
})

test('a category with nothing in it is not a line', () => {
  // The view emits no row at all for a category nobody billed, and emits one reading zero
  // for a month whose bills were entirely waived. "Exam fee \u09F30" is furniture in both
  // readings — in the second the nought is true and says less than its own absence.
  const lines = categoryBills([
    line('tuition', '90000', '60000', '30000'),
    line('exam', '0', '0', '0'),
  ])

  assert.deepEqual(
    lines.map((l) => l.category),
    ['tuition'],
  )
})

test('a waived category that somebody has paid into still shows', () => {
  // Charged nought and money against it: a bill waived after it was paid, which nets to a
  // credit the family is owed. Dropping the line would take that off the screen entirely.
  const lines = categoryBills([line('form', '0', '300', '-300')])

  assert.deepEqual(lines, [
    { category: 'form', charged: 0, paid: 300, outstanding: -300 },
  ])
})

test('a category the six names do not cover is left off rather than drawn unlabelled', () => {
  // Unreachable — the column is a `not null` enum and a group-by key — but the generated
  // view types make it nullable, and a row with no name has no label to print either.
  const lines = categoryBills([
    line(null, '999', '0', '999'),
    line('hall_rent', '999', '0', '999'),
    line('tuition', '90000', '60000', '30000'),
  ])

  assert.deepEqual(lines.map((l) => l.category), ['tuition'])
})
