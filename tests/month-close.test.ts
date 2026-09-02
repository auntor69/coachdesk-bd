/**
 * The month-close arithmetic — the numbers a trial gets closed on.
 *
 * MASTERPLAN §4 step 4: on about day 28 the owner is shown what was outstanding when
 * the month started, what came in, and how many messages went out to parents, and then
 * the price. Every figure on that screen is one they can check against their own cash
 * box, so the failure that matters here is not a crash. It is a number that is quietly
 * two thousand taka out, said out loud, to somebody who knows what their month looked
 * like.
 *
 * What is guarded, in order of how badly it lies:
 *
 *   The opening balance, which no table holds. It is reconstructed by walking today's
 *   balance backwards through the payments taken since, and the whole feature rests on
 *   that walk — an invoice raised in June and settled on the 5th of July reads ৳0 now
 *   and was ৳2,000 of arrears on the 1st.
 *
 *   Money paid ahead. It is collection, and it is not this month's collection, and a
 *   screen that cannot tell the two apart reports 100% on a month with half its bills
 *   unpaid.
 *
 *   Credit never netting against another family's debt — tallyOutstanding's rule,
 *   applied here as everywhere.
 *
 *   `collected` matching what the dashboard and the register total for the same month:
 *   every taka in, whichever bill it settled, voided bills and all. Three screens
 *   showing three collection figures for one month is the "one derived answer" rule
 *   broken in the most expensive place.
 *
 *   The message tally counting all four kinds, apart from each other. This is the
 *   under-sell, not the over-sell: the card counted fee chases only, so a centre that
 *   also sent ninety absence messages read as having sent thirty-four things. Every
 *   count below is a different number on purpose — four copy-pasted lookups reading one
 *   key four times is exactly the bug a fixture of equal counts lets through.
 *
 * Relative imports with extensions — `node --test` on TS, no tsconfig paths.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  closeMonths,
  CLOSE_MONTHS_BACK,
  MESSAGE_KINDS,
  monthClose,
  monthMessages,
  type CloseBalanceRow,
  type ClosePaymentRow,
} from '../src/lib/fees/month-close.ts'

/** The month every test below closes. July 2026: starts Wednesday, ends on the 31st. */
const JULY = '2026-07-01'

const MAY = '2026-05-01'
const JUNE = '2026-06-01'
const AUGUST = '2026-08-01'

/** A row of fee_invoice_balances, numeric columns as PostgREST sends them. */
function balance(
  id: string,
  periodMonth: string | null,
  net: number | string,
  remaining: number | string,
): CloseBalanceRow {
  return { id, period_month: periodMonth, net_bdt: net, remaining_bdt: remaining }
}

/**
 * A payment, with the period of the invoice it settled.
 *
 * `paidAt` is written as a UTC instant because that is what the column returns — the
 * conversion to a Dhaka day is the thing under test, so nothing here is allowed to
 * short-circuit it.
 */
function payment(
  invoiceId: string,
  amount: number | string,
  paidAt: string,
  periodMonth: string | null,
  opts: { voidedAt?: string; asArray?: boolean } = {},
): ClosePaymentRow {
  const invoice = { period_month: periodMonth, voided_at: opts.voidedAt ?? null }
  return {
    invoice_id: invoiceId,
    amount_bdt: amount,
    paid_at: paidAt,
    fee_invoices: opts.asArray ? [invoice] : invoice,
  }
}

function close(balances: CloseBalanceRow[] | null, payments: ClosePaymentRow[] | null) {
  return monthClose({ month: JULY, balances, payments })
}

test('opening: an invoice settled mid-month was still arrears on the 1st', () => {
  // The figure the whole screen exists to produce, and the one no query can answer.
  // June's ৳2,000 was paid on the 5th, so fee_invoice_balances reads ৳0 today and the
  // invoice is not even in the balances set — the payment is the only trace left of it.
  const m = close([], [payment('i-jun', 2000, '2026-07-05T09:00:00Z', JUNE)])

  assert.equal(m.opening, 2000)
  assert.equal(m.collected, 2000)
  assert.equal(m.closing, 0)
  assert.equal(m.billed, 0)
})

test('closing: a payment made after the month ended does not settle it early', () => {
  // Same June bill, paid on 2 September. It was owed on 1 July and still owed on
  // 1 August, and re-running July's close in October must not say otherwise.
  const m = close([], [payment('i-jun', 2000, '2026-09-02T09:00:00Z', JUNE)])

  assert.equal(m.opening, 2000)
  assert.equal(m.closing, 2000)
  assert.equal(m.collected, 0)
  assert.equal(m.collectionRatePct, 0)
})

test('billed: this month\'s invoice is billed and was not owed before the month began', () => {
  // A centre that raises July's invoices on 30 June has not thereby given itself
  // ৳1,500 of opening arrears. The month a bill is *for* is the month it lands in.
  const m = close([balance('i-jul', JULY, 1500, 1500)], [])

  assert.equal(m.billed, 1500)
  assert.equal(m.opening, 0)
  assert.equal(m.closing, 1500)
  assert.equal(m.collectionRatePct, 0)
})

test('advance: money paid ahead is collection but not this month\'s collection', () => {
  // The inversion worth the most: a family settles August on 20 July while July's own
  // bill sits unpaid. Counting the advance in the rate would read 100% collected over a
  // month that collected nothing, on the one screen an owner is being asked to trust.
  const m = close(
    [balance('i-jul', JULY, 1500, 1500)],
    [payment('i-aug', 1500, '2026-07-20T09:00:00Z', AUGUST)],
  )

  assert.equal(m.collected, 1500)
  assert.equal(m.advance, 1500)
  assert.equal(m.billed, 1500)
  assert.equal(m.closing, 1500)
  assert.equal(m.opening, 0)
  assert.equal(m.collectionRatePct, 0)
})

test('credit: an overpaid family does not settle another family\'s debt', () => {
  // ৳500 over on June, ৳2,000 unpaid on July. The centre is owed ৳2,000, not ৳1,500 —
  // see tallyOutstanding. The credit is reported beside it, never inside it.
  const m = close([balance('i-jun', JUNE, 2000, -500), balance('i-jul', JULY, 2000, 2000)], [])

  assert.equal(m.closing, 2000)
  assert.equal(m.credit, 500)
  assert.equal(m.billed, 2000)
})

test('credit: an opening credit is dropped rather than reported as arrears', () => {
  // Nothing was owed on 1 July: one family was ৳500 ahead and nobody was behind. The
  // opening figure is what to chase, and there is nothing to chase.
  const m = close([balance('i-jun', JUNE, 2000, -500)], [])

  assert.equal(m.opening, 0)
  assert.equal(m.closing, 0)
  assert.equal(m.credit, 500)
})

test('rate: nothing to collect leaves no rate, which is not the same as zero', () => {
  // A centre in its first week has billed nothing and is owed nothing. "0% collected"
  // would be the screen calling that a failure.
  const empty = close([], [])

  assert.equal(empty.collectionRatePct, null)
  assert.equal(empty.opening, 0)
  assert.equal(empty.billed, 0)
  assert.equal(empty.collected, 0)

  // Still null with money in the till, when all of it was for a later month.
  const advanceOnly = close([], [payment('i-aug', 1500, '2026-07-20T09:00:00Z', AUGUST)])

  assert.equal(advanceOnly.collected, 1500)
  assert.equal(advanceOnly.collectionRatePct, null)
})

test('rate: an overpayment can put it above 100, and the credit line says why', () => {
  // ৳2,500 handed over against a ৳2,000 bill. 125% is the truth about the cash, and a
  // clamp to 100 would hide the ৳500 the centre is now holding for that family.
  const m = close(
    [balance('i-jul', JULY, 2000, -500)],
    [payment('i-jul', 2500, '2026-07-10T09:00:00Z', JULY)],
  )

  assert.equal(m.collectionRatePct, 125)
  assert.equal(m.credit, 500)
  assert.equal(m.closing, 0)
})

test('the whole month reconciles when nobody is in credit', () => {
  // Six invoices across four months, four payments across three of them. Pinned in full
  // because the figures are only trustworthy together: any one of them can be made
  // right on its own by a change that breaks the other five.
  //
  //   i-may  ৳1,000 billed May, never paid
  //   i-jun  ৳2,000 billed June, ৳1,200 paid 8 July, ৳800 still owed
  //   i-old  ৳500  billed June, paid 2 September — arrears through all of July
  //   i-paid ৳3,000 billed July, settled 12 July
  //   i-open ৳3,000 billed July, unpaid
  //   i-aug  ৳3,000 billed August, paid 28 July
  const m = close(
    [
      balance('i-may', MAY, 1000, 1000),
      balance('i-jun', JUNE, 2000, 800),
      balance('i-paid', JULY, 3000, 0),
      balance('i-open', JULY, 3000, 3000),
    ],
    [
      payment('i-jun', 1200, '2026-07-08T10:00:00Z', JUNE),
      payment('i-paid', 3000, '2026-07-12T10:00:00Z', JULY),
      payment('i-aug', 3000, '2026-07-28T10:00:00Z', AUGUST),
      payment('i-old', 500, '2026-09-02T10:00:00Z', JUNE),
    ],
  )

  assert.deepEqual(m, {
    opening: 3500, // 1,000 May + 2,000 June + 500 the September payment proves was open
    billed: 6000, // both July invoices, settled or not
    collected: 7200, // 1,200 + 3,000 + 3,000 — September's 500 is September's
    advance: 3000, // the August bill
    closing: 5300,
    credit: 0,
    collectionRatePct: 44, // 4,200 of 9,500
  })

  // With no credit anywhere, the four figures do close — and this is the only
  // circumstance in which they do, which is why the screen never draws them as a sum.
  assert.equal(m.opening + m.billed - (m.collected - m.advance), m.closing)
})

test('Dhaka: the month starts at midnight in Dhaka, not in UTC', () => {
  // paid_at comes back in UTC, so a payment taken at 1:30am on 1 July reads
  // "2026-06-30T19:30" and slicing the string would file it under a month the owner
  // has already closed and reported on. The one at 00:30 on 1 August is August's.
  const m = close(
    [],
    [
      payment('i-a', 1000, '2026-06-30T19:30:00Z', JUNE),
      payment('i-b', 1000, '2026-07-31T18:30:00Z', JUNE),
    ],
  )

  assert.equal(m.collected, 1000)
  assert.equal(m.opening, 2000)
  assert.equal(m.closing, 1000)
})

test('Dhaka: a payment taken before the month began is not this month\'s', () => {
  // Cannot arrive from the query, which bounds on the same instant. If it ever does it
  // must not be counted twice — June's close already reported it.
  const m = close([], [payment('i-jun', 2000, '2026-06-30T12:00:00Z', JUNE)])

  assert.equal(m.collected, 0)
  assert.equal(m.opening, 0)
  assert.equal(m.closing, 0)
})

test('refunds: a refund inside the month nets off, because it is a negative payment', () => {
  // ৳2,500 taken on the 10th, ৳500 handed back on the 20th, against a ৳2,000 bill. The
  // centre collected ৳2,000 in July and the invoice is square.
  const m = close(
    [balance('i-jul', JULY, 2000, 0)],
    [
      payment('i-jul', 2500, '2026-07-10T09:00:00Z', JULY),
      payment('i-jul', -500, '2026-07-20T09:00:00Z', JULY),
    ],
  )

  assert.equal(m.collected, 2000)
  assert.equal(m.closing, 0)
  assert.equal(m.credit, 0)
  assert.equal(m.collectionRatePct, 100)
})

test('refunds: a refund in August does not reach back into July\'s closing balance', () => {
  // Paid in full on 10 July, ৳500 refunded on 15 August. On 1 August the invoice was
  // settled, and the walk backwards has to add the negative payment the same way
  // Postgres subtracted it.
  const m = close(
    [balance('i-jul', JULY, 2000, 500)],
    [
      payment('i-jul', 2000, '2026-07-10T09:00:00Z', JULY),
      payment('i-jul', -500, '2026-08-15T09:00:00Z', JULY),
    ],
  )

  assert.equal(m.collected, 2000)
  assert.equal(m.closing, 0)
  assert.equal(m.collectionRatePct, 100)
})

test('voids: a voided bill has no balance, but its payment was still money', () => {
  // The balances query excludes voided invoices, so this one must too — adding the
  // payment back into the opening arrears would resurrect a bill the centre cancelled.
  // The cash still crossed the desk, and if it was handed back the refund is a negative
  // payment in the same window.
  const m = close(
    [],
    [payment('i-void', 2000, '2026-07-10T09:00:00Z', JUNE, { voidedAt: '2026-07-11T00:00:00Z' })],
  )

  assert.equal(m.collected, 2000)
  assert.equal(m.opening, 0)
  assert.equal(m.closing, 0)
  assert.equal(m.collectionRatePct, null)
})

test('the invoice row decides which month a payment belongs to, not the embed', () => {
  // They agree. When they cannot — a stale read, a period corrected between the two
  // queries — the invoice's own row wins, because otherwise the ৳500 shows up as
  // ৳2,500 of June arrears that the balances set has no row for.
  const m = close(
    [balance('i-x', JULY, 2000, 2000)],
    [payment('i-x', 500, '2026-07-10T09:00:00Z', JUNE)],
  )

  assert.equal(m.opening, 0)
  assert.equal(m.billed, 2000)
  assert.equal(m.closing, 2000)
  assert.equal(m.collected, 500)
  assert.equal(m.collectionRatePct, 25)
})

test('numeric over the wire is a string and still adds up as money', () => {
  // PostgREST serialises numeric as a string. '1500.50' + '499.50' has to be 2000.
  const m = close(
    [balance('i-jul', JULY, '1500.50', '1500.50')],
    [payment('i-jun', '499.50', '2026-07-05T09:00:00Z', JUNE)],
  )

  assert.equal(m.billed, 1500.5)
  assert.equal(m.collected, 499.5)
  assert.equal(m.opening, 499.5)
  assert.equal(m.closing, 1500.5)
  assert.equal(m.collectionRatePct, 25) // 499.50 of 2,000
})

test('a payment with no invoice behind it is money in and nothing else', () => {
  // The query joins with !inner so it cannot arrive, but the register and the dashboard
  // would both count it, and three screens disagreeing about one month's takings is
  // worse than a figure with no bill attached.
  const orphan: ClosePaymentRow = {
    invoice_id: 'i-gone',
    amount_bdt: 2000,
    paid_at: '2026-07-10T09:00:00Z',
    fee_invoices: null,
  }
  const m = close([], [orphan])

  assert.equal(m.collected, 2000)
  assert.equal(m.opening, 0)
  assert.equal(m.closing, 0)
})

test('an embed arriving as a one-element array is read the same way', () => {
  const m = close([], [payment('i-jun', 2000, '2026-07-05T09:00:00Z', JUNE, { asArray: true })])

  assert.equal(m.opening, 2000)
  assert.equal(m.collected, 2000)
})

test('rows with no id are dropped rather than defaulted', () => {
  // The view types every column nullable. Without an id a balance cannot be matched to
  // its payments, so counting it would be counting a number twice.
  const m = monthClose({
    month: JULY,
    balances: [{ ...balance('x', JULY, 2000, 2000), id: null }, balance('i-jul', JULY, 1500, 1500)],
    payments: [{ ...payment('x', 500, '2026-07-05T09:00:00Z', JUNE), invoice_id: null }],
  })

  assert.equal(m.billed, 1500)
  assert.equal(m.closing, 1500)
  assert.equal(m.collected, 0)
})

test('an invoice with no period month is dropped, not filed under this one', () => {
  // Would inflate `billed` by a bill for a month nobody can name.
  const m = close([balance('i-jul', null, 2000, 2000), balance('i-ok', JULY, 1500, 1500)], [])

  assert.equal(m.billed, 1500)
  assert.equal(m.closing, 1500)
})

test('an unreadable amount is skipped rather than turning the month into NaN', () => {
  const m = close(
    [balance('i-jul', JULY, 1500, 1500)],
    [payment('i-jul', 'not a number', '2026-07-05T09:00:00Z', JULY)],
  )

  assert.equal(m.collected, 0)
  assert.equal(m.billed, 1500)
  assert.equal(m.collectionRatePct, 0)
})

test('null rows from a failed query are survivable', () => {
  // Both queries can come back null, and this screen is shown to a customer being asked
  // for money. An empty month is a defensible thing to draw; a crash is not.
  assert.deepEqual(monthClose({ month: JULY, balances: null, payments: undefined }), {
    opening: 0,
    billed: 0,
    collected: 0,
    advance: 0,
    closing: 0,
    credit: 0,
    collectionRatePct: null,
  })
})

test('the selector offers this month and the eleven before it', () => {
  // The same twelve as the collection register, because the two screens link to each
  // other and a month that exists on one and not the other is a dead end.
  const months = closeMonths(AUGUST)

  assert.equal(months.length, CLOSE_MONTHS_BACK)
  assert.equal(months.length, 12)
  assert.equal(months[0], AUGUST)
  assert.equal(months[1], JULY)
  assert.equal(months[11], '2025-09-01')
  // Descending, and never into a month that has not happened yet.
  assert.deepEqual([...months].sort().reverse(), months)
})

test('every kind of message is counted, and counted apart from the others', () => {
  // Four different numbers, none of them a multiple of another. A card that reads one
  // count four times, or adds one of them twice, cannot come out right by luck.
  const sent = monthMessages({ reminders: 34, notes: 9, results: 26, absences: 90 })

  assert.equal(sent.total, 159)
  assert.deepEqual(sent.lines, [
    { kind: 'reminders', n: 34 },
    { kind: 'notes', n: 9 },
    { kind: 'results', n: 26 },
    { kind: 'absences', n: 90 },
  ])
})

test('the kinds are listed in a fixed order, not biggest first', () => {
  // This screen is read out loud across a table, often for two months in a row. A list
  // that reorders itself between June and July is one the owner has to find their place
  // in again every time — so the order is the constant's, whatever the sizes are.
  const sent = monthMessages({ reminders: 1, notes: 2, results: 3, absences: 400 })

  assert.deepEqual(
    sent.lines.map((line) => line.kind),
    [...MESSAGE_KINDS],
  )
  // And the constant itself is the four kinds, once each. A duplicate would double a
  // count into the total; a missing one would drop a whole feature off the screen.
  assert.equal(MESSAGE_KINDS.length, 4)
  assert.equal(new Set(MESSAGE_KINDS).size, MESSAGE_KINDS.length)
})

test('a kind nobody used is left off rather than drawn as a nought', () => {
  // Four rows of zero on the screen that is meant to show an owner what their month was
  // worth reads as a broken product. The total still says what happened.
  const sent = monthMessages({ reminders: 0, notes: 0, results: 0, absences: 90 })

  assert.equal(sent.total, 90)
  assert.deepEqual(sent.lines, [{ kind: 'absences', n: 90 }])
})

test('a month of nothing but absence messages still has something to show', () => {
  // The commonest shape of a trial that has not put its fees in yet: a teacher taking
  // the register every day and telling the parents the same evening, with no money in
  // the app at all. This is the centre the close screen most needs to have a number for,
  // and counting fee chases only gave it a zero.
  const sent = monthMessages({ reminders: null, notes: 0, results: undefined, absences: 62 })

  assert.equal(sent.total, 62)
  assert.equal(sent.lines.length, 1)
})

test('a head count that came back null is nothing sent, not a NaN', () => {
  // `count: 'exact', head: true` yields null when the query failed or the reader may not
  // see the table. There is no reading of that null except "none that we can see", and
  // the alternative is the string "NaN messages sent" read out to a paying customer.
  const nothing = monthMessages({
    reminders: null,
    notes: undefined,
    results: null,
    absences: undefined,
  })

  assert.deepEqual(nothing, { total: 0, lines: [] })

  // And a null beside a real count neither poisons the total nor takes a row.
  const some = monthMessages({ reminders: null, notes: 4, results: null, absences: 7 })
  assert.equal(some.total, 11)
  assert.deepEqual(some.lines, [
    { kind: 'notes', n: 4 },
    { kind: 'absences', n: 7 },
  ])
})

test('a count that could not be a count is treated as none', () => {
  // Not defensive for its own sake: this number is read out loud in a sales conversation,
  // and "-1 messages" or "3.5 messages" on that screen is worse than a zero. A row count
  // cannot be either, so neither is trusted.
  const sent = monthMessages({
    reminders: -5,
    notes: Number.NaN,
    results: 2.7,
    absences: Number.POSITIVE_INFINITY,
  })

  assert.equal(sent.total, 2)
  assert.deepEqual(sent.lines, [{ kind: 'results', n: 2 }])
})

/**
 * And the screen's own shape.
 *
 * §20.8 step 6, sixth screen — and the one the business is built on: it is read out loud
 * across a table on about day 28 and screenshotted afterwards. What was wrong was the
 * shape, not the sums. Four cards stacked in a 700px column meant the figure and the three
 * that make it mean something could not be seen in one glance on the laptop it is shown
 * on, with half the screen empty beside them.
 *
 * Read off the source because there is no renderer here. What these catch is the drift a
 * screenshot does not show: the ledger sliding back under the collected figure, the
 * message tally being lost on a month whose money could not be added up (those four counts
 * are their own reads and did not fail), and — the one that would cost real money — a plan
 * gate appearing on the one screen that deliberately has none.
 */
const PAGE = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'app', '(app)', 'fees', 'close', 'page.tsx'),
  'utf8',
)

/**
 * The render begins at the grid root, anchored on a newline-free substring: the working
 * tree may be CRLF and a pattern spanning a line break would find nothing here.
 */
const SHEET = PAGE.slice(PAGE.indexOf('<div className="flex flex-col gap-4 lg:grid'))

/**
 * See plan-page.test.ts: the lookbehind keeps `border-2` and `lg:col-span-N` out. The
 * backtick is in the class because the message card's span depends on whether there is a
 * ledger beside it, so its `order-5` opens a template literal rather than a quoted string.
 */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s`])order-(\d+|last)\b/g)].map((m) => m[1])
}

test('shape: the month takes seven columns and the figures beside it five', () => {
  assert.ok(SHEET.length > 500, 'the render is not where this test expects it')
  assert.match(SHEET, /lg:grid lg:grid-cols-12 lg:items-start lg:gap-6/)

  // The collected figure and the ledger, side by side from lg and stacked below it. Seven
  // and five rather than six and six: the big number is the one in the largest type.
  assert.match(SHEET, /<Card className="order-3 border-brand-200 bg-brand-50 lg:col-span-7">/)
  assert.match(SHEET, /<Card className="order-4 lg:col-span-5">/)

  // And the two next questions sit beside the message tally on the row under them, rather
  // than at the bottom of a column of their own.
  assert.match(SHEET, /<nav className="order-6 flex flex-col gap-1 lg:col-span-5">/)
})

test('shape: every block has a place in the phone order', () => {
  // Three 3s and they are one place: the failed read, the quiet month and the collected
  // figure are three exclusive drawings of the same block, so they share a number on
  // purpose. Everything after them ascends.
  assert.deepEqual(ordersIn(SHEET), ['1', '2', '3', '3', '3', '4', '5', '6'])
})

test('shape: the figure and the ledger are drawn once each, from the tested function', () => {
  // One derived answer. Nothing in the page does arithmetic — every figure comes from
  // `monthClose`, and a second rendering of one of them is one that can disagree.
  assert.equal(SHEET.split('formatTaka(m.collected)').length - 1, 1)
  assert.match(SHEET, /<Figure label=\{t\.opening\} amount=\{m\.opening\} \/>/)
  assert.match(SHEET, /<Figure label=\{t\.billed\} amount=\{m\.billed\} \/>/)
  assert.match(SHEET, /<Figure label=\{t\.closing\} amount=\{m\.closing\} strong \/>/)

  // The credit line and its explanation only when there is credit, because it is the one
  // reason the four figures above will not add up.
  assert.match(SHEET, /\{m\.credit > 0 && \(/)
  assert.match(SHEET, /\{t\.creditNote\}/)

  // Money paid ahead, under the figure it is part of rather than at the foot of the card.
  assert.match(SHEET, /\{m\.advance > 0 && \(/)
})

test('shape: the message tally survives a month whose money could not be added up', () => {
  // The four counts are their own reads and did not fail. On the screen whose job is to say
  // what the product did, ninety messages sent is still true on a day when the ledger
  // cannot be. And it is drawn once now, not copied into three branches.
  assert.match(PAGE, /const showLedger = ledgerProblem === null && !nothingHappened/)
  assert.match(PAGE, /const showMessages = sent\.total > 0 \|\| showLedger/)
  assert.equal(SHEET.split('t.messagesSent(sent.total)').length - 1, 1)

  // A quiet month says one thing, not two: "nothing was billed" followed by "no messages
  // went out" is the same sentence twice, which is what `sent.total > 0` keeps out.
  assert.match(SHEET, /\{showMessages && \(/)
  assert.match(SHEET, /\{sent\.lines\.length > 1 && \(/)

  // The two next questions belong to a month that added up. Pointing an owner at the
  // register for a month this screen has just refused to total is pointing them at a
  // second screen to be confused by.
  assert.match(SHEET, /\{showLedger && \(/)
})

test('shape: the letterhead says whose month it is, and what the screen is', () => {
  // It gets screenshotted and sent to somebody who was not in the conversation. The centre
  // name is the heading; the fallback is the session's own copy of it.
  assert.match(SHEET, /\{center\?\.name \?\? session\.active\.centerName\}/)
  assert.match(SHEET, /\{t\.title\} · \{formatMonth\(month, locale\)\}/)
  assert.match(SHEET, /\{t\.subtitle\}/, 'the line that says what the figures are went')

  // A plain GET form, so the month is in a URL that can be shared. The submit button is
  // load-bearing: Android Chrome fires no navigation on a bare <select> change.
  assert.match(SHEET, /<form\r?\n\s+method="get"/)
  assert.match(SHEET, /name="month"\r?\n\s+defaultValue=\{month\}/)
  assert.match(SHEET, /<button\r?\n\s+type="submit"/)
})

test('shape: nothing about who may read this has moved', () => {
  // §38. This was a layout change.
  assert.match(PAGE, /const session = await pageCapability\('fees'\)/)

  // NO PLAN GATE, and this is the assertion that would cost the most if it failed: the
  // screen is the pitch, not the work. A free teacher reading ৳47,000 collected against a
  // ৳499 price is the most valuable person in the product, and locking it would be
  // charging admission to our own sales conversation.
  assert.doesNotMatch(PAGE, /has\(session\.plan/, 'a plan gate appeared on the pitch screen')

  // Six reads, every one scoped on the centre as well as on RLS, plus the letterhead by id.
  assert.equal(PAGE.split(".eq('coaching_center_id', session.active.centerId)").length - 1, 6)
  assert.match(PAGE, /\.eq\('id', session\.active\.centerId\)/)

  // Dhaka calendar boundaries on every one of them. Compared against a bare date the
  // cutoff lands at 6am Dhaka, and every payment taken before breakfast on the 1st is
  // counted into a month the owner has already been shown and has already agreed with.
  assert.equal(PAGE.split('T00:00:00+06:00').length - 1, 9)

  // Both ledger reads paged: a month read one page deep balances perfectly and is short by
  // two hundred invoices, which is a wrong total in a screenshot that adds up.
  assert.equal(PAGE.split('pageAll((from, to) =>').length - 1, 2)
  assert.match(PAGE, /const ledgerProblem = worstFailure\(balances, payments\)/)

  // And the figures come from the tested module, both of them.
  assert.match(PAGE, /const m = monthClose\(\{/)
  assert.match(PAGE, /const sent = monthMessages\(\{ reminders, notes, results, absences \}\)/)
})
