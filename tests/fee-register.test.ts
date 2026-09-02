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
 *
 * The last section reads the page's own source and guards the sheet's shape; see the
 * comment above it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  registerRows,
  tallyRegister,
  REGISTER_METHODS,
  type RegisterPaymentRow,
} from '../src/lib/fees/register.ts'
import { PAYMENT_METHODS } from '../src/lib/fees/methods.ts'
import { sumTaka } from '../src/lib/money.ts'

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

test('the breakdown adds up to the total, whichever method the money came through', () => {
  // The invariant the page rests on, and the one nothing checked until a card payment
  // broke it. `card` reached the enum in 20260811000041 and never reached
  // REGISTER_METHODS, so it was counted in `total` and printed in no line of the
  // breakdown — a foot that no longer added up to the figure above it, on the sheet an
  // owner holds against a wallet statement.
  //
  // THE ROWS ARE BUILT FROM PAYMENT_METHODS AND THE LINES COUNTED AGAINST IT, not
  // against REGISTER_METHODS. That is the whole point: a test that took its payments from
  // the same list the breakdown iterates can never catch that list being short, because
  // the method it forgot is a payment the test never makes. PAYMENT_METHODS is checked
  // against the enum by the compiler (see ALL_METHODS_LISTED), so this fails on both
  // halves of the drift — a value added to the enum and not to the list, and a list that
  // stops agreeing with the canonical one.
  const rows = registerRows(
    PAYMENT_METHODS.map((method, i) => pay(`p${i}`, 100 * (i + 1), { method })),
    UNKNOWN,
  )
  const tally = tallyRegister(rows)

  assert.equal(tally.byMethod.length, PAYMENT_METHODS.length)
  assert.equal(sumTaka(tally.byMethod.map((m) => m.amount)), tally.total)
  assert.equal(tally.entries, PAYMENT_METHODS.length)
})

test('every method the enum has gets a line', () => {
  // The runtime half of ALL_METHODS_LISTED, which is a compile-time check and so proves
  // nothing about a `node --test` run. Belt and braces on the same drift: a register that
  // silently drops one method's line is a wrong document, not a missing feature.
  assert.deepEqual([...REGISTER_METHODS], [...PAYMENT_METHODS])
  assert.ok(REGISTER_METHODS.includes('card'))
})

test('entries counts payments and not students, refunds included', () => {
  // One family can pay twice in a month, and a refund is a line on the sheet like any
  // other — the count under the total is a count of lines.
  const tally = tallyRegister(
    registerRows([pay('p1', 500), pay('p2', 500), pay('p3', -200)], UNKNOWN),
  )
  assert.equal(tally.entries, 3)
})

/**
 * And the sheet's own shape.
 *
 * §20.8 step 6, second screen. The sums above were already right; what was wrong was
 * where they were printed. The breakdown by method — the only half of this page that can
 * be held against a wallet statement — was under the table, so on a month with two
 * hundred payments the reader met it after three sheets of paper and a laptop's worth of
 * scrolling. It is above the rows now, reading across the page rather than down it, and
 * the total is one figure rather than a line in a list.
 *
 * Read off the page's source because there is no renderer here. What these catch is the
 * drift a screenshot does not show: the summary sliding back under the table, the
 * per-method figures losing their counts, the three answers (a read that failed, a month
 * with nothing in it, a search that matched nothing) collapsing into one.
 */
const REGISTER_PAGE = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'app', '(app)', 'fees', 'register', 'page.tsx'),
  'utf8',
)

/**
 * The sheet begins at the last of the two `flex flex-col gap-4` roots — the first is the
 * plan wall, which returns before any of this. `lastIndexOf` on a string with no newline
 * in it, because the working tree is CRLF and a pattern spanning a line break would find
 * nothing here and everything on a Linux checkout.
 */
const SHEET = REGISTER_PAGE.slice(
  REGISTER_PAGE.lastIndexOf('<div className="flex flex-col gap-4">'),
)

test('sheet: the summary is above the rows, not under them', () => {
  assert.ok(SHEET.length > 500, 'the render is not where this test expects it')

  const summary = SHEET.indexOf('{t.byMethod}')
  const search = SHEET.indexOf('<SearchBox')
  const table = SHEET.indexOf('<table')
  assert.ok(summary > 0, 'the breakdown by method is gone')
  assert.ok(search > summary, 'the search box is above the summary it does not narrow')
  assert.ok(table > search, 'the table is above the caveat that applies to it')

  // One section, not two. The month's collection used to be printed twice — once in the
  // table's foot and once at the bottom of the page — and two renderings of one figure is
  // one that can disagree with itself.
  assert.equal((SHEET.match(/\{t\.byMethod\}/g) ?? []).length, 1)

  // Still out of the table, so it survives the table breaking across sheets, and still
  // whole on whichever sheet it lands on.
  const at = SHEET.indexOf('<section className="break-inside-avoid')
  assert.ok(at > 0 && at < table, 'the summary is inside the table or below it')
})

test('sheet: the total is one figure and the addends sit under it', () => {
  const section = SHEET.slice(
    SHEET.indexOf('<section className="break-inside-avoid'),
    SHEET.indexOf('<SearchBox'),
  )

  // The headline, and the count of lines it is made of.
  assert.match(section, /text-3xl font-bold text-ink">\{formatTaka\(tally\.total\)\}/)
  assert.match(section, /\{t\.entries\(tally\.entries\)\}/)

  // Two addends, in a month that had a refund, below the sum they make.
  const total = section.indexOf('formatTaka(tally.total)')
  const gross = section.indexOf('formatTaka(tally.grossIn)')
  assert.match(section, /\{tally\.refunded !== 0 && \(/, 'the refund lines are unconditional')
  assert.ok(gross > total, 'the addends are printed above their own sum')
  assert.ok(section.indexOf('formatTaka(tally.refunded)') > gross)

  // The grand total is not also printed at the foot of the section — see the test above
  // for why one figure is drawn once.
  assert.equal((section.match(/formatTaka\(tally\.total\)/g) ?? []).length, 1)
})

test('sheet: every method carries its count as well as its figure', () => {
  const band = SHEET.slice(SHEET.indexOf('{t.byMethod}'), SHEET.indexOf('<SearchBox'))

  assert.match(band, /tally\.byMethod\.map\(\(m\) =>/)
  assert.match(band, /\{d\.feeRow\.methods\[m\.method\]\}/, 'the methods lost their names')
  assert.match(band, /\{formatTaka\(m\.amount\)\}/)
  assert.match(band, /\{t\.entries\(m\.entries\)\}/, 'a method figure with no count behind it')

  // Across the page and not down it: `flex-wrap`, so seven methods cost one band of
  // height on a laptop and two on a phone rather than seven rows of either.
  assert.match(band, /<dl className="mt-2 flex flex-wrap/)

  // And no boxes inside the box (§20.7). A bordered tile in a bordered section is the
  // nested container the directive names, and there would be up to seven of them.
  const tile = band.slice(band.indexOf('tally.byMethod.map'))
  assert.doesNotMatch(tile, /rounded-|border-2|border border-/, 'the methods became tiles')
})

test('sheet: the three empty answers are still three', () => {
  // A read that failed, a month with nothing in it, and a search that matched nothing are
  // different sentences, and the middle one is a statement about the centre's business.
  // Printing it because somebody mistyped a transaction ID would be the sheet
  // contradicting its own total.
  assert.match(SHEET, /\{registerProblem === 'tooLarge' \? t\.tooLarge : t\.unreadable\}/)
  assert.match(SHEET, /rows\.length === 0 \?[\s\S]{0,120}\{t\.empty\}/)
  assert.match(SHEET, /shown\.length === 0 \?[\s\S]{0,400}<SearchEmpty/)

  // The summary is drawn on none of the first two: nothing was read, or nothing came in.
  const problem = SHEET.indexOf('registerProblem !== null ?')
  assert.ok(problem > 0 && problem < SHEET.indexOf('<section className="break-inside-avoid'))
})

test('sheet: one row of furniture, and the month still ends up in the URL', () => {
  const bar = SHEET.slice(0, SHEET.indexOf('<header>'))

  // Back, the month, Show and Print on one row from `sm`, and none of it on paper.
  assert.match(bar, /print:hidden/)
  assert.match(bar, /<form method="get"/, 'the month picker is no longer a plain GET form')
  assert.match(bar, /<PrintButton label=\{t\.print\}/)
  assert.match(bar, /sm:w-auto sm:flex-1/, 'the controls no longer wrap on a phone')

  // Both of these are load-bearing and neither is visible: the hidden field is what keeps
  // a search alive across a change of month, and the submit button is what makes the
  // select work on Android Chrome, which fires no navigation on a bare change.
  assert.match(bar, /\{query && <input type="hidden" name="q" value=\{query\} \/>\}/)
  assert.match(bar, /<button\s+type="submit"/)
})

test('sheet: nothing about who may read this has moved', () => {
  // §38. This was a layout change. Staff admin and `fees`, a paid plan only, and the
  // plan wall still returns before the month is read.
  assert.match(REGISTER_PAGE, /const session = await pageCapability\('fees'\)/)
  assert.match(REGISTER_PAGE, /if \(!has\(session\.plan, 'printedReceipts'\)\) \{/)
  const wall = REGISTER_PAGE.indexOf("if (!has(session.plan, 'printedReceipts'))")
  assert.ok(wall > 0 && wall < REGISTER_PAGE.indexOf('const supabase = await createClient()'))

  // One centre's month, half-open on Dhaka boundaries, and paged so a long month cannot
  // foot correctly while being short.
  assert.match(REGISTER_PAGE, /\.eq\('coaching_center_id', session\.active\.centerId\)/)
  assert.match(REGISTER_PAGE, /\.gte\('paid_at', `\$\{month\}T00:00:00\+06:00`\)/)
  assert.match(REGISTER_PAGE, /\.lt\('paid_at', `\$\{nextMonth\}T00:00:00\+06:00`\)/)
  assert.match(REGISTER_PAGE, /pageAll\(\(from, to\) =>/)

  // And every figure is still the month's, not the search's.
  assert.match(REGISTER_PAGE, /const tally = tallyRegister\(rows\)/)
  assert.match(REGISTER_PAGE, /const shown = terms\.length === 0/)
})
