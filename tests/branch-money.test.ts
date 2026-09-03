import test from 'node:test'
import assert from 'node:assert/strict'

import {
  branchMoneyRows,
  payrollGap,
  tallyBranchMoney,
  type BranchChargesSourceRow,
  type BranchMoneyRow,
  type BranchProfitSourceRow,
} from '../src/lib/finance/branch-money.ts'

const MIRPUR = '11111111-1111-1111-1111-111111111111'
const UTTARA = '22222222-2222-2222-2222-222222222222'
const GONE = '33333333-3333-3333-3333-333333333333'

const HQ = 'Head office'
const UNNAMED = 'Another branch'

/**
 * A `branch_profit_month` row as PostgREST sends one.
 *
 * Every figure a string, because that is what a `numeric` column arrives as whatever the
 * generated types say, and a test that passed numbers would pass while the screen printed
 * "৳0" for a real month.
 */
function money(
  branchId: string | null,
  collected: number,
  expenses: number,
  payroll: number,
): BranchProfitSourceRow {
  return {
    branch_id: branchId,
    collected_bdt: collected.toFixed(2),
    expenses_bdt: expenses.toFixed(2),
    payroll_bdt: payroll.toFixed(2),
    profit_bdt: (collected - expenses - payroll).toFixed(2),
  }
}

function bills(
  branchId: string | null,
  charged: number,
  paid: number,
): BranchChargesSourceRow {
  return {
    branch_id: branchId,
    charged_bdt: charged.toFixed(2),
    paid_bdt: paid.toFixed(2),
    outstanding_bdt: (charged - paid).toFixed(2),
  }
}

const BRANCHES = [
  { id: UTTARA, name: 'Uttara', active: true },
  { id: MIRPUR, name: 'Mirpur', active: true },
  { id: GONE, name: 'Old Dhaka', active: false },
]

/** The whole call with the parts a test does not care about filled in. */
function rows(input: {
  profit?: BranchProfitSourceRow[]
  charges?: BranchChargesSourceRow[] | null
  branches?: typeof BRANCHES
  students?: { branchId: string | null; count: number | null }[]
  teachers?: { branchId: string | null; count: number | null }[]
}): BranchMoneyRow[] {
  return branchMoneyRows({
    profit: input.profit ?? [],
    charges: input.charges === undefined ? [] : input.charges,
    branches: input.branches ?? BRANCHES,
    students: input.students ?? [],
    teachers: input.teachers ?? [],
    headOffice: HQ,
    unnamed: UNNAMED,
  })
}

test('buildings come in reading order and head office comes last', () => {
  const table = rows({})

  // Open branches alphabetically, the closed one after them, head office at the bottom
  // next to the foot it is not part of. An owner scanning branches against each other
  // should not have a row that is not a branch in the middle of the list.
  assert.deepEqual(
    table.map((row) => row.name),
    ['Mirpur', 'Uttara', 'Old Dhaka', HQ],
  )
  assert.equal(table[3]?.branchId, null)
  assert.equal(table[2]?.active, false)
})

test('head office is a row even when it has nothing in it', () => {
  // Its absence would read as "there is no head office", which is never true of an
  // institution — only that head office took no money this month.
  const table = rows({ branches: [], profit: [], charges: [] })

  assert.equal(table.length, 1)
  assert.equal(table[0]?.name, HQ)
  assert.equal(table[0]?.collected, 0)
  assert.equal(table[0]?.profit, 0)
})

test('a branch with no money row this month is really all noughts', () => {
  const table = rows({ profit: [money(MIRPUR, 50_000, 12_000, 30_000)] })
  const uttara = table.find((row) => row.branchId === UTTARA)

  // Right here and nowhere else in this product: the view's spine is a union over
  // collections, expenses and payroll, so a branch-month missing from it is missing from
  // all three. Took nothing, spent nothing, paid nobody.
  assert.deepEqual(
    { collected: uttara?.collected, expenses: uttara?.expenses, profit: uttara?.profit },
    { collected: 0, expenses: 0, profit: 0 },
  )
})

test('money belonging to a branch the list did not carry is still on the table', () => {
  // THE ONE THAT PROTECTS THE FOOT. A branch row withheld by a policy, or filtered out of
  // the list, would take its takings off the screen if the list were the spine — and then
  // the table would total to less than the dashboard's profit card for the same month,
  // which is the disagreement 20260811000055 exists to make impossible.
  const orphan = '44444444-4444-4444-4444-444444444444'
  const table = rows({
    branches: [{ id: MIRPUR, name: 'Mirpur', active: true }],
    profit: [money(MIRPUR, 10_000, 0, 0), money(orphan, 7_000, 0, 0)],
  })

  assert.equal(table.length, 3)
  const row = table.find((r) => r.branchId === orphan)
  assert.equal(row?.name, UNNAMED)
  assert.equal(row?.collected, 7_000)
  assert.equal(tallyBranchMoney(table).collected, 17_000)
})

test('a bill nobody has a branch row for lands at its own row too', () => {
  // Same argument on the charges side, which has its own month spine: a branch can bill
  // in March and take no cash until April, so it can appear in one view and not the other.
  const table = rows({ branches: [], profit: [], charges: [bills(MIRPUR, 9_000, 3_000)] })

  const row = table.find((r) => r.branchId === MIRPUR)
  assert.equal(row?.name, UNNAMED)
  assert.equal(row?.outstanding, 6_000)
  assert.equal(row?.collected, 0)
})

test('a branch that billed nothing has no collection rate', () => {
  const table = rows({
    branches: [{ id: MIRPUR, name: 'Mirpur', active: true }],
    charges: [bills(MIRPUR, 0, 0)],
  })

  // Not 0%. Zero percent is a sentence about a branch that billed and collected none of
  // it; this branch billed nothing, and the honest answer is a dash. 20260811000055 left
  // the rate out of SQL for exactly this division.
  assert.equal(table.find((r) => r.branchId === MIRPUR)?.ratePct, null)
  assert.equal(table.find((r) => r.branchId === MIRPUR)?.charged, 0)
})

test('the rate is whole percent, and a family paying ahead pushes it over a hundred', () => {
  const table = rows({
    branches: [
      { id: MIRPUR, name: 'Mirpur', active: true },
      { id: UTTARA, name: 'Uttara', active: true },
    ],
    charges: [bills(MIRPUR, 30_000, 20_000), bills(UTTARA, 10_000, 11_200)],
  })

  // 66.67% rounds. Two decimals would invite an owner to rank two branches on a
  // difference that is one late fee.
  assert.equal(table.find((r) => r.branchId === MIRPUR)?.ratePct, 67)

  // Deliberately not clamped to 100. Advance payment against the month's bills is a real
  // thing in this business and 112% is what happened.
  assert.equal(table.find((r) => r.branchId === UTTARA)?.ratePct, 112)
})

test('a charges read that failed draws no bills column at all', () => {
  const table = rows({ charges: null, profit: [money(MIRPUR, 40_000, 5_000, 20_000)] })
  const mirpur = table.find((r) => r.branchId === MIRPUR)

  // Zero here would say Mirpur billed nothing, on a month it collected ৳40,000. The
  // money columns are unaffected: half a table honestly labelled beats no table.
  assert.deepEqual(
    {
      charged: mirpur?.charged,
      paid: mirpur?.paid,
      outstanding: mirpur?.outstanding,
      ratePct: mirpur?.ratePct,
    },
    { charged: null, paid: null, outstanding: null, ratePct: null },
  )
  assert.equal(mirpur?.collected, 40_000)

  const total = tallyBranchMoney(table)
  assert.equal(total.charged, null)
  assert.equal(total.ratePct, null)
  assert.equal(total.collected, 40_000)
})

test('a head count that did not arrive is nobody, not zero students', () => {
  const table = rows({
    students: [
      { branchId: MIRPUR, count: 120 },
      { branchId: UTTARA, count: null },
      { branchId: null, count: 0 },
    ],
  })

  assert.equal(table.find((r) => r.branchId === MIRPUR)?.students, 120)
  assert.equal(table.find((r) => r.branchId === UTTARA)?.students, null)

  // Head office keys on the null, and a real zero there survives: the desk that is not in
  // any building usually has no students of its own.
  assert.equal(table.find((r) => r.branchId === null)?.students, 0)

  // Never counted for, never claimed.
  assert.equal(table.find((r) => r.branchId === GONE)?.students, null)
})

test('teachers are counted per branch on the same terms as students', () => {
  // §20.6 asks for both columns, and for a reason: two branches with the same profit and
  // half the staff between them are not the same branch, and profit alone cannot say so.
  const table = rows({
    students: [{ branchId: MIRPUR, count: 120 }],
    teachers: [
      { branchId: MIRPUR, count: 7 },
      { branchId: UTTARA, count: null },
      { branchId: null, count: 0 },
    ],
  })

  assert.equal(table.find((r) => r.branchId === MIRPUR)?.teachers, 7)
  assert.equal(table.find((r) => r.branchId === UTTARA)?.teachers, null)
  assert.equal(table.find((r) => r.branchId === null)?.teachers, 0)
  assert.equal(table.find((r) => r.branchId === GONE)?.teachers, null)

  // The two counts are separate reads and one may arrive without the other. A branch
  // with students and no teacher figure must not borrow the figure beside it.
  assert.equal(table.find((r) => r.branchId === MIRPUR)?.students, 120)
  assert.equal(table.find((r) => r.branchId === UTTARA)?.students, null)
})

test('the foot adds up in paisa and not in floating point', () => {
  const table = rows({
    profit: [
      money(MIRPUR, 10.1, 0.2, 0.1),
      money(UTTARA, 20.2, 0.1, 0.1),
      money(null, 0.1, 0.1, 0),
    ],
    charges: [bills(MIRPUR, 10.1, 0.2), bills(UTTARA, 20.2, 0.1)],
  })

  const total = tallyBranchMoney(table)

  // 10.1 + 20.2 + 0.1 in binary floating point is 30.400000000000002, and the table's
  // total has to be the same number center_profit_month reports. sumTaka works in
  // integer poisha for this reason.
  assert.equal(total.collected, 30.4)
  assert.equal(total.expenses, 0.4)
  assert.equal(total.payroll, 0.2)
  assert.equal(total.profit, 29.8)
  assert.equal(total.charged, 30.3)
  assert.equal(total.paid, 0.3)
})

test('the foot rate comes from the totals and is not an average of the rows', () => {
  const table = rows({
    branches: [
      { id: MIRPUR, name: 'Mirpur', active: true },
      { id: UTTARA, name: 'Uttara', active: true },
    ],
    charges: [bills(MIRPUR, 500, 500), bills(UTTARA, 500_000, 250_000)],
  })

  // Averaging the two rows' rates gives 75%, which says the organisation collected three
  // quarters of what it billed. It collected just over half. A branch that billed ৳500
  // does not get an equal vote.
  assert.equal(tallyBranchMoney(table).ratePct, 50)
})

/** A row with only the fields payrollGap looks at. */
function activity(name: string, collected: number, expenses: number, payroll: number) {
  return { name, collected, expenses, payroll } as BranchMoneyRow
}

test('a quiet month is not a payroll warning', () => {
  // No collections, no spending, no salaries anywhere: the 1st of a month, and an
  // ordinary state. A warning here trains an owner to ignore it in the month it is true.
  assert.deepEqual(payrollGap([activity('Mirpur', 0, 0, 0), activity(HQ, 0, 0, 0)]), {
    kind: 'none',
  })
  assert.deepEqual(payrollGap([]), { kind: 'none' })
})

test('salaries everywhere they should be is nothing to say', () => {
  assert.deepEqual(
    payrollGap([activity('Mirpur', 50_000, 0, 30_000), activity(HQ, 0, 8_000, 12_000)]),
    { kind: 'none' },
  )
})

test('a trading month with no salaries anywhere is the loud one', () => {
  // Every profit figure on the screen is too high by the largest number in the business,
  // in the direction that flatters.
  assert.deepEqual(
    payrollGap([activity('Mirpur', 50_000, 4_000, 0), activity('Uttara', 20_000, 0, 0)]),
    { kind: 'all' },
  )
})

test('payroll entered centrally names the buildings it left out', () => {
  // 20260811000055's own words: "entering payroll centrally leaves every branch but head
  // office looking free". This is the shape that catches it.
  assert.deepEqual(
    payrollGap([
      activity('Mirpur', 50_000, 4_000, 0),
      activity('Uttara', 20_000, 0, 0),
      activity(HQ, 0, 2_000, 90_000),
    ]),
    { kind: 'some', names: ['Mirpur', 'Uttara'] },
  )
})

test('a branch with nothing going on is never named as missing payroll', () => {
  // A branch that opened last week, or a closed one. It has no salaries because it has
  // no month, and naming it would bury the branch that really is missing its wage bill.
  assert.deepEqual(
    payrollGap([
      activity('Mirpur', 50_000, 4_000, 0),
      activity('Old Dhaka', 0, 0, 0),
      activity(HQ, 0, 2_000, 90_000),
    ]),
    { kind: 'some', names: ['Mirpur'] },
  )
})

test('spending alone is activity', () => {
  // A branch paying rent with an empty cash box is trading, and it has staff to pay.
  assert.deepEqual(payrollGap([activity('Mirpur', 0, 40_000, 0)]), { kind: 'all' })
})
