/**
 * One expense voucher's arithmetic: the freeze, and what it refuses to guess.
 *
 * The figure under test goes onto paper and is signed. The two rules pinned here are that
 * the category total is as of this voucher and never as of now, and that a row which cannot
 * be read is dropped rather than counted as nothing.
 *
 * THE TRAP THIS FILE EXISTS FOR is a backdated entry. `spent_on` is a date an owner chooses
 * and 20260811000045 deliberately lets them choose one in the past, so a rent row entered on
 * the 20th can be dated the 2nd. Order by that date and the voucher printed on the 5th
 * changes what it says. Order by `voucher_no` and it cannot.
 *
 * Relative imports with extensions — `node --test` on TS, no tsconfig paths.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { categoryUpTo, type VoucherSourceRow } from '../src/lib/expenses/voucher.ts'

/** One sibling expense, as PostgREST hands it back: numerics as strings. */
function row(voucherNo: number, amount: string | number | null): VoucherSourceRow {
  return { voucher_no: voucherNo, amount_bdt: amount }
}

test('a category with one entry reports the one voucher', () => {
  assert.deepEqual(categoryUpTo(5, [row(5, '12000.00')]), { spent: 12000, entries: 1 })
})

test('two entries add up on the later voucher', () => {
  const siblings = [row(5, '12000.00'), row(9, '12000.00')]

  assert.deepEqual(categoryUpTo(9, siblings), { spent: 24000, entries: 2 })
})

test('the earlier voucher does not know about the later one', () => {
  const siblings = [row(5, '12000.00'), row(9, '12000.00')]

  // The whole point. Reprint voucher 5 in December and it still says ৳12,000 in one entry,
  // because that is what the copy in the file says.
  assert.deepEqual(categoryUpTo(5, siblings), { spent: 12000, entries: 1 })
})

test('a row entered later cannot change an earlier voucher, whatever it is dated', () => {
  // Rent paid on the 2nd, voucher 5. On the 20th somebody writes down a second rent
  // payment and backdates it to the 3rd — voucher 9, an earlier `spent_on`. Ordering by
  // the date would make voucher 5's paper read ৳24,000 for money that had not been
  // written down when it was printed.
  const siblings = [row(5, '12000.00'), row(9, '12000.00')]

  assert.equal(categoryUpTo(5, siblings)?.spent, 12000)
  assert.equal(categoryUpTo(9, siblings)?.spent, 24000)
})

test('the list need not arrive in order', () => {
  const siblings = [row(9, '12000.00'), row(5, '12000.00')]

  assert.deepEqual(categoryUpTo(9, siblings), { spent: 24000, entries: 2 })
})

test('a correction nets against the entry it reverses', () => {
  const siblings = [row(5, '12000.00'), row(7, '-2000.00')]

  // The correcting row's own voucher says what the category came to after it, which is the
  // figure the month's spending agrees with.
  assert.deepEqual(categoryUpTo(7, siblings), { spent: 10000, entries: 2 })
})

test('poisha do not drift', () => {
  const siblings = [row(1, '1200.10'), row(2, '1200.20')]

  assert.equal(categoryUpTo(2, siblings)?.spent, 2400.3)
})

test('a dropped read is null, never a total over nothing', () => {
  // Nought here would print "৳12,000 of ৳12,000 of rent this month" on the second rent
  // voucher of a month, which is the figure this line exists to contradict.
  assert.equal(categoryUpTo(5, null), null)
  assert.equal(categoryUpTo(5, undefined), null)
})

test('an amount that will not parse is dropped, not counted as nothing', () => {
  const siblings = [row(5, '12000.00'), row(6, null), row(7, 'not a number')]

  // Dropped from the count as well as from the sum, which is what keeps the two agreeing:
  // "in 3 entries" over a total of one is the line an owner would have to explain.
  assert.deepEqual(categoryUpTo(7, siblings), { spent: 12000, entries: 1 })
})

test('an empty category is zero rather than null', () => {
  // Not reachable from the page — the voucher is always one of its own siblings — but the
  // two answers mean different things and only one of them may come from an empty list.
  assert.deepEqual(categoryUpTo(5, []), { spent: 0, entries: 0 })
})

test('a voucher number the list does not contain still totals what came before it', () => {
  // Reachable: the voucher is read from `expenses` by id and the siblings by category, so a
  // row whose category was somehow not the one queried would be absent from its own total.
  // Counting what precedes it is the honest answer — the line is labelled by its count, so
  // "2 entries" over the two rows that are there says exactly what was read.
  assert.deepEqual(categoryUpTo(9, [row(5, '1000.00'), row(6, '500.00')]), {
    spent: 1500,
    entries: 2,
  })
})
