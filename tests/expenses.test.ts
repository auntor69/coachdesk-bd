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
 *
 * The last section reads the page's own source and guards the screen's shape; see the
 * comment above it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

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

/**
 * And the screen's own shape.
 *
 * §20.8 step 6, third screen. The sums above were already right; what was wrong was where
 * they were printed and how much of a laptop the page wasted getting to them. The
 * by-category breakdown — the only part of this page that answers a question an owner
 * arrives with — was under the table, so a month with sixty vouchers put two screens of
 * evidence in front of the summary of it. It is above the rows now, in even columns with
 * each category's voucher count, and the month's total is one figure drawn once rather
 * than one in a table foot and another in a list below it. The form moved into a rail
 * beside the month from `xl`.
 *
 * Read off the page's source because there is no renderer here. What these catch is the
 * drift a screenshot does not show: the summary sliding back under the table, the split
 * dropping to `lg` where the table does not fit, a category figure losing the count behind
 * it, and the three answers (a read that failed, a month with nothing in it, a month with
 * spending) collapsing into fewer.
 */
const PAGE = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'app', '(app)', 'expenses', 'page.tsx'),
  'utf8',
)

/**
 * The render begins at the grid root. Anchored on a newline-free substring that includes
 * `xl:grid`, which the plan wall's own `flex flex-col gap-4` root does not have — the
 * working tree is CRLF and a pattern spanning a line break would find nothing here and
 * everything on a Linux checkout.
 */
const SHEET = PAGE.slice(PAGE.indexOf('<div className="flex flex-col gap-4 xl:grid'))
const BAR = PAGE.slice(0, PAGE.indexOf('<div className="flex flex-col gap-4 xl:grid'))
const RAIL_AT = SHEET.indexOf('<div className="contents xl:order-3 xl:col-span-4')
const MAIN_AT = SHEET.indexOf('<div className="contents xl:order-2 xl:col-span-8')
const RAIL = SHEET.slice(RAIL_AT, MAIN_AT)
const MAIN = SHEET.slice(MAIN_AT)

/** See plan-page.test.ts: the lookbehind keeps `border-2` and `xl:order-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s])order-(\d+|last)\b/g)].map((m) => m[1])
}

test('shape: one column on a phone, twelve from xl, and the month gets eight', () => {
  assert.ok(SHEET.length > 500, 'the render is not where this test expects it')
  assert.ok(RAIL_AT > 0 && MAIN_AT > RAIL_AT, 'the two columns are gone or swapped')

  assert.match(SHEET, /xl:grid xl:grid-cols-12 xl:items-start xl:gap-6/)

  // Both wrappers are `contents` below xl, so every block inside them is a direct child of
  // the phone's flex column and its own `order-N` is what places it.
  assert.match(RAIL, /^<div className="contents xl:order-3 xl:col-span-4 xl:flex/)
  assert.match(MAIN, /^<div className="contents xl:order-2 xl:col-span-8 xl:flex/)

  // `xl` and not `lg`, and this is the arithmetic: the table asks for 36rem = 576px, and
  // eight of twelve columns is 469px at `lg` against 640px at `xl`. A split at `lg` would
  // hand a laptop a horizontal scrollbar it does not have today.
  assert.match(MAIN, /min-w-\[36rem\]/)
  assert.doesNotMatch(SHEET, /lg:col-span-|lg:grid-cols-/, 'the split dropped to lg')
})

test('shape: every block has a place in the phone order, and no two share one', () => {
  // One block in each column now: the letterhead and the month picker were two full-width
  // rows above them, and both are the bar's. Per column the numbers must ascend in source
  // order or the phone and the laptop disagree about what follows what.
  assert.equal(ordersIn(RAIL).join(), '3')
  assert.equal(ordersIn(MAIN).join(), '4')
  assert.doesNotMatch(SHEET, /xl:col-span-12/)

  const all = ordersIn(SHEET)
  assert.equal(new Set(all).size, all.length, 'two blocks are fighting over one place')
  assert.deepEqual(
    all.map(Number),
    [...all.map(Number)].sort((a, b) => a - b),
  )
})

test('shape: the figures are above the rows, and the total is drawn once', () => {
  const summary = MAIN.indexOf('{t.byCategory}')
  const table = MAIN.indexOf('<table')
  assert.ok(summary > 0, 'the breakdown by category is gone')
  assert.ok(table > summary, 'the table is above the summary of it')

  // The headline, and the count of vouchers it is made of.
  assert.match(MAIN, /num text-3xl font-bold text-ink">\{formatTaka\(tally\.total\)\}/)
  assert.match(MAIN, /\{t\.entries\(tally\.entries\)\}/)

  // One rendering of one figure. It used to be printed in the table's foot and again in
  // the list below it, and two renderings of one sum is one that can disagree with itself.
  assert.equal((MAIN.match(/formatTaka\(tally\.total\)/g) ?? []).length, 1)
  assert.doesNotMatch(MAIN, /<tfoot/, 'the total came back to the table foot')
})

test('shape: every category carries its count, in even columns and not in tiles', () => {
  const band = MAIN.slice(MAIN.indexOf('{t.byCategory}'), MAIN.indexOf('<div className="-mx-4'))

  assert.match(band, /tally\.byCategory\.map\(\(c\) =>/)
  assert.match(band, /\{t\.categories\[c\.category\]\}/, 'the categories lost their names')
  assert.match(band, /\{formatTaka\(c\.amount\)\}/)
  assert.match(band, /\{t\.entries\(c\.entries\)\}/, 'a category figure with no count behind it')

  // A grid and not the register's wrapped band: twelve names as long as "printing and
  // photocopying" wrap into a ragged block, where a grid puts them in even columns.
  assert.match(band, /<dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3/)

  // And no boxes inside the box (§20.7). A bordered tile in a bordered section is the
  // nested container the directive names, and there would be up to twelve of them.
  const tile = band.slice(band.indexOf('tally.byCategory.map'))
  assert.doesNotMatch(tile, /rounded-|border-2|border border-/, 'the categories became tiles')
})

test('shape: the salary caveat appears once, beside the lines it explains', () => {
  // One guard around both the two addends and the sentence about them, so a month with no
  // salary row in it gets neither. "৳0 left to payroll" is a figure an owner would stop
  // and check for nothing.
  assert.equal((MAIN.match(/\{tally\.deferredToPayroll !== 0 && \(/g) ?? []).length, 1)

  const counted = MAIN.indexOf('formatTaka(tally.counted)')
  const deferred = MAIN.indexOf('formatTaka(tally.deferredToPayroll)')
  const note = MAIN.indexOf('t.deferredNote(')
  const categories = MAIN.indexOf('{t.byCategory}')
  assert.ok(counted > 0 && deferred > counted, 'what the profit line takes off comes first')
  assert.ok(note > deferred, 'the sentence is above the lines it is about')
  assert.ok(note < categories, 'the caveat drifted below the breakdown')
})

test('shape: the three answers are still three, and the form is still gated', () => {
  // A read that failed and a month with nothing in it are different sentences, and the
  // second one is a statement about the centre's business. Printing it because a query
  // failed would be the page claiming the centre spent nothing.
  assert.match(MAIN, /\{problem === 'tooLarge' \? t\.tooLarge : t\.unreadable\}/)
  assert.match(MAIN, /rows\.length === 0 \?[\s\S]{0,160}\{t\.empty\}/)

  // And no figures are drawn on either of the first two.
  const problem = MAIN.indexOf('problem !== null ?')
  assert.ok(problem > 0 && problem < MAIN.indexOf('{t.byCategory}'))

  // A read-only centre keeps the list and loses the form.
  assert.match(RAIL, /\{session\.access === 'full' && \(/)
  assert.match(RAIL, /<ExpenseForm/)
})

test('shape: the month picker is still a plain GET form, in the bar', () => {
  // In the bar's own `actions` slot now rather than a twelfth-column row of its own, so it
  // stays on screen while a month of vouchers scrolls past.
  assert.match(BAR, /actions=\{\s+<form method="get" className="flex items-center gap-2">/)
  assert.match(BAR, /name="month"\s+aria-label=\{t\.month\}\s+defaultValue=\{month\}/)

  // The submit button is load-bearing and looks like decoration: Android Chrome fires no
  // navigation on a bare <select> change.
  assert.match(BAR, /<button\r?\n\s+type="submit"/)

  // Label-less with an `aria-label`, because the bar is one line deep at `lg:min-h-14` and
  // every sticky rail in the app starts at `top-16` below it. The select is capped rather
  // than left to grow: a month name in Bangla beside a long centre title otherwise pushes
  // the crumb off a phone.
  assert.match(BAR, /min-h-tap max-w-44 rounded-xl border-2 border-line bg-white px-3/)
  assert.match(BAR, /sm:max-w-56/)

  // And the month is named once. The select already reads "August 2026" in the reader's
  // own script, so the sentence that used to sit under it was the same fact twice.
  assert.doesNotMatch(SHEET, /\{formatMonth\(month, locale\)\}/)

  // Both arms draw a bar, and it owns the h1 — so the locked arm's own title is an h2.
  assert.equal(PAGE.split('<PageHeader').length - 1, 2)
  assert.equal(PAGE.split('<h1').length - 1, 0)
  assert.doesNotMatch(PAGE, /text-xl font-bold text-ink lg:text-2xl/)
})

test('shape: nothing about who may read or write this has moved', () => {
  // §38. This was a layout change. Staff admin and `expenses`, a Center plan only, and the
  // plan wall still returns before the month is read.
  assert.match(PAGE, /const session = await pageCapability\('expenses'\)/)
  assert.match(PAGE, /if \(!has\(session\.plan, 'centerWideReporting'\)\) \{/)
  const wall = PAGE.indexOf("if (!has(session.plan, 'centerWideReporting'))")
  assert.ok(wall > 0 && wall < PAGE.indexOf('const supabase = await createClient()'))

  // One centre's month, half-open on plain dates, and paged so a long month cannot foot
  // correctly while being short.
  assert.match(PAGE, /\.eq\('coaching_center_id', session\.active\.centerId\)/)
  assert.match(PAGE, /\.gte\('spent_on', month\)/)
  assert.match(PAGE, /\.lt\('spent_on', nextMonth\)/)
  assert.match(PAGE, /pageAll\(\(from, to\) =>/)
  assert.match(PAGE, /const problem = worstFailure\(spending\)/)

  // The branch picker is asked for only where the form is drawn at all.
  assert.match(PAGE, /session\.access === 'full' \? branchChoicesFor\(supabase, session\) : null/)
})





