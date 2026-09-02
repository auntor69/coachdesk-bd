/**
 * One payslip's arithmetic: what it freezes, and what it refuses to guess.
 *
 * THE FIGURE UNDER TEST GOES ONTO PAPER AND LEAVES THE BUILDING. Every other sum in this
 * app can be corrected by reloading a screen; this one is handed to the person it is about,
 * and the copy they keep is the copy that wins an argument. So the two rules below are
 * pinned rather than trusted: the total is as of this voucher and never as of now, and a
 * row that cannot be read is dropped rather than counted as nothing.
 *
 * THE TRAP THIS FILE EXISTS FOR: half a salary on the 5th and half on the 20th is two real
 * rows, because 20260811000044 deliberately has no unique index on (payee, for_month). A
 * slip for ৳6,500 handed to somebody who has had ৳13,000 that month is the shape of the
 * argument, and `monthUpTo` is the only thing that closes it.
 *
 * Relative imports with extensions — `node --test` on TS, no tsconfig paths.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  monthUpTo,
  slipBreakdown,
  type SlipSourceRow,
} from '../src/lib/payroll/slip.ts'

/** One sibling voucher, as PostgREST hands it back: numerics as strings. */
function voucher(
  voucherNo: number,
  amount: string | number | null,
  paidAt: string,
): SlipSourceRow {
  return { voucher_no: voucherNo, amount_bdt: amount, paid_at: paidAt }
}

/** The four copied columns of a payment. Zeroes are what the ordinary form writes. */
function parts(
  basic: string | number | null,
  allowances: string | number | null = 0,
  other: string | number | null = 0,
  deductions: string | number | null = 0,
) {
  return {
    basic_bdt: basic,
    allowances_bdt: allowances,
    other_bdt: other,
    deductions_bdt: deductions,
  }
}

/* -------------------------------------------------------------------------- */
/* The month, as of this voucher                                             */
/* -------------------------------------------------------------------------- */

test('a single-payment month reports the one voucher', () => {
  const month = monthUpTo(
    { voucherNo: 4, paidAt: '2026-03-05T09:00:00Z' },
    [voucher(4, '13000.00', '2026-03-05T09:00:00Z')],
  )

  assert.deepEqual(month, { paid: 13000, payments: 1 })
})

test('two instalments add up on the later slip', () => {
  const siblings = [
    voucher(4, '6500.00', '2026-03-05T09:00:00Z'),
    voucher(9, '6500.00', '2026-03-20T11:30:00Z'),
  ]

  assert.deepEqual(monthUpTo({ voucherNo: 9, paidAt: '2026-03-20T11:30:00Z' }, siblings), {
    paid: 13000,
    payments: 2,
  })
})

test('the earlier slip does not know about the later one', () => {
  const siblings = [
    voucher(4, '6500.00', '2026-03-05T09:00:00Z'),
    voucher(9, '6500.00', '2026-03-20T11:30:00Z'),
  ]

  // The whole point. Reprint the 5 March slip in December and it still says ৳6,500 in one
  // payment, because that is what the employee's copy says.
  assert.deepEqual(monthUpTo({ voucherNo: 4, paidAt: '2026-03-05T09:00:00Z' }, siblings), {
    paid: 6500,
    payments: 1,
  })
})

test('a voucher paid on the same second is settled by its number', () => {
  const siblings = [
    voucher(4, '5000.00', '2026-03-05T09:00:00Z'),
    voucher(5, '3000.00', '2026-03-05T09:00:00Z'),
  ]

  // Two salaries handed over in the same second: the lower voucher counts on the higher
  // slip, and not the other way round.
  assert.deepEqual(monthUpTo({ voucherNo: 5, paidAt: '2026-03-05T09:00:00Z' }, siblings), {
    paid: 8000,
    payments: 2,
  })
  assert.deepEqual(monthUpTo({ voucherNo: 4, paidAt: '2026-03-05T09:00:00Z' }, siblings), {
    paid: 5000,
    payments: 1,
  })
})

test('the list need not arrive in order', () => {
  const siblings = [
    voucher(9, '6500.00', '2026-03-20T11:30:00Z'),
    voucher(4, '6500.00', '2026-03-05T09:00:00Z'),
  ]

  assert.deepEqual(monthUpTo({ voucherNo: 9, paidAt: '2026-03-20T11:30:00Z' }, siblings), {
    paid: 13000,
    payments: 2,
  })
})

test('a correction nets against the payment it reverses', () => {
  const siblings = [
    voucher(4, '13000.00', '2026-03-05T09:00:00Z'),
    voucher(7, '-3000.00', '2026-03-06T10:00:00Z'),
  ]

  // The reversing row's own slip says what the month came to after it, which is the figure
  // the employee needs and the one the register agrees with.
  assert.deepEqual(monthUpTo({ voucherNo: 7, paidAt: '2026-03-06T10:00:00Z' }, siblings), {
    paid: 10000,
    payments: 2,
  })
})

test('poisha do not drift', () => {
  const siblings = [
    voucher(1, '6500.10', '2026-03-05T09:00:00Z'),
    voucher(2, '6500.20', '2026-03-06T09:00:00Z'),
  ]

  assert.equal(
    monthUpTo({ voucherNo: 2, paidAt: '2026-03-06T09:00:00Z' }, siblings)?.paid,
    13000.3,
  )
})

test('a dropped read is null, never a total over nothing', () => {
  const slip = { voucherNo: 4, paidAt: '2026-03-05T09:00:00Z' }

  // Nought here would print "৳6,500 of ৳6,500 this month" on the slip of somebody who has
  // had two instalments — on paper, in the hand of the person it is wrong about.
  assert.equal(monthUpTo(slip, null), null)
  assert.equal(monthUpTo(slip, undefined), null)
})

test('an amount that will not parse is dropped, not counted as nothing', () => {
  const siblings = [
    voucher(4, '6500.00', '2026-03-05T09:00:00Z'),
    voucher(5, null, '2026-03-06T09:00:00Z'),
    voucher(6, 'not a number', '2026-03-07T09:00:00Z'),
  ]

  // Dropped from the count as well as from the sum, which is what keeps the two agreeing:
  // "in 3 payments" over a total of two is the line an owner would have to explain.
  assert.deepEqual(monthUpTo({ voucherNo: 6, paidAt: '2026-03-07T09:00:00Z' }, siblings), {
    paid: 6500,
    payments: 1,
  })
})

test('an empty month is zero rather than null', () => {
  // Not reachable from the page — the slip is always one of its own siblings — but the two
  // answers mean different things and only one of them may come from an empty list.
  assert.deepEqual(monthUpTo({ voucherNo: 4, paidAt: '2026-03-05T09:00:00Z' }, []), {
    paid: 0,
    payments: 0,
  })
})

/* -------------------------------------------------------------------------- */
/* What the salary was made of                                               */
/* -------------------------------------------------------------------------- */

test('a plain salary is not itemised', () => {
  const b = slipBreakdown(parts('13000.00'))

  // The breakdown block is suppressed: basic is the whole of it, and printing it would put
  // the same figure on the paper twice under two different labels.
  assert.equal(b.itemised, false)
  assert.equal(b.basic, 13000)
  assert.equal(b.gross, 13000)
})

test('an allowance makes the breakdown worth printing', () => {
  const b = slipBreakdown(parts('13000.00', '2000.00'))

  assert.equal(b.itemised, true)
  assert.equal(b.gross, 15000)
})

test('gross is basic plus allowances plus other, and nothing else', () => {
  const b = slipBreakdown(parts('13000.00', '2000.00', '500.00', '1500.00'))

  // The database's own `gross_bdt`. The deduction is reported beside it and never inside
  // it — `amount_bdt` is what is left after it, and that is the figure on the paper.
  assert.equal(b.gross, 15500)
  assert.equal(b.deductions, 1500)
})

test('a deduction alone itemises the slip', () => {
  const b = slipBreakdown(parts('13000.00', 0, 0, '1500.00'))

  // Otherwise the sheet would print ৳11,500 against an agreed ৳13,000 with nothing to say
  // where the difference went, which is the month an employee asks about.
  assert.equal(b.itemised, true)
  assert.equal(b.gross, 13000)
})

test('a reversal is one negative figure and is not itemised', () => {
  // ../src/app/(app)/payroll/pay/actions.ts: "A reversal is a single negative figure, not a
  // mirror of the original's composition." So the breakdown block would be the reversed
  // amount printed twice.
  const b = slipBreakdown(parts('-3000.00'))

  assert.equal(b.itemised, false)
  assert.equal(b.basic, -3000)
  assert.equal(b.gross, -3000)
})

test('poisha do not drift in the gross either', () => {
  assert.equal(slipBreakdown(parts('13000.10', '2000.20', '500.30')).gross, 15500.6)
})

test('a part that will not parse is zero', () => {
  // Generated types call these non-null, PostgREST can still hand back something Number()
  // refuses, and a NaN on the paper is worse than a missing line.
  const b = slipBreakdown(parts('13000.00', null, 'nonsense'))

  assert.equal(b.allowances, 0)
  assert.equal(b.other, 0)
  assert.equal(b.gross, 13000)
  assert.equal(b.itemised, false)
})
