/**
 * How much of a fee a centre may waive.
 *
 * The rule under test is the one the discount box, the Server Action and the table's own
 * `fee_invoices_discount_bound` all read, so a change here that is not also made in the
 * migration is a change that lets the browser offer something the database refuses.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  discountVerdict,
  maxDiscount,
  netAfterDiscount,
} from '../src/lib/fees/discount.ts'

const live = { billed: 2000, voidedAt: null }

test('waiving part of a fee is fine', () => {
  assert.equal(discountVerdict({ ...live, discount: 500 }), 'ok')
})

test('waiving the whole fee is fine', () => {
  // The scholarship case: a topper kept on the roll at no charge because the board
  // results are the centre's advertising.
  assert.equal(discountVerdict({ ...live, discount: 2000 }), 'ok')
})

test('a taka more than the fee is refused', () => {
  // Past this the centre would owe the family money for attending, and net_bdt would
  // go negative on every screen that reads it.
  assert.equal(discountVerdict({ ...live, discount: 2001 }), 'tooMuch')
})

test('taking a waiver back is not a refusal', () => {
  // Zero is how an owner undoes one, so it has to succeed. The trigger clears the
  // reason and the stamp alongside it.
  assert.equal(discountVerdict({ ...live, discount: 0 }), 'ok')
})

test('a negative waiver is refused rather than read as a surcharge', () => {
  // There is no such thing as billing extra through this field. A centre that wants to
  // charge more raises a bill for more.
  assert.equal(discountVerdict({ ...live, discount: -100 }), 'negative')
})

test('an unreadable figure is refused', () => {
  assert.equal(discountVerdict({ ...live, discount: Number.NaN }), 'unreadable')
})

test('an unreadable fee cannot bound anything, so nothing is allowed through', () => {
  assert.equal(
    discountVerdict({ billed: Number.NaN, discount: 100, voidedAt: null }),
    'unreadable',
  )
})

test('a cancelled bill is refused, and named as cancelled rather than as too much', () => {
  // Told "that is more than the fee" an owner retypes the number. The thing to do is
  // restore the bill, so the verdict has to say so.
  assert.equal(
    discountVerdict({ billed: 2000, discount: 5000, voidedAt: '2026-07-02T04:00:00Z' }),
    'cancelled',
  )
})

test('a paid bill may still be discounted, which becomes a credit', () => {
  // The most sympathetic case there is, and the one an over-careful rule would break:
  // the owner took the money, then heard what the year had been like. The refund path
  // is how the ৳500 goes home.
  assert.equal(discountVerdict({ ...live, discount: 500 }), 'ok')
})

test('poisha compare exactly, so a waiver equal to the fee is not off by a float', () => {
  // 0.1 + 0.2 territory. fee_invoice_balances hands these over as strings and the
  // difference between 1999.9999999 and 2000 is a refusal the owner cannot explain.
  assert.equal(discountVerdict({ billed: 1999.99, discount: 1999.99, voidedAt: null }), 'ok')
})

test('the ceiling a screen names is the whole fee', () => {
  assert.equal(maxDiscount(2000), 2000)
})

test('there is nothing to waive on a bill of nothing', () => {
  assert.equal(maxDiscount(0), 0)
  assert.equal(maxDiscount(-50), 0)
  assert.equal(maxDiscount(Number.NaN), 0)
})

test('the ceiling is rounded to poisha, not to a float', () => {
  assert.equal(maxDiscount(1999.994), 1999.99)
})

test('what is left after a waiver is the fee less the waiver', () => {
  assert.equal(netAfterDiscount(2000, 500), 1500)
})

test('waiving everything leaves nothing owed', () => {
  assert.equal(netAfterDiscount(2000, 2000), 0)
})

test('an over-large waiver never previews a negative figure', () => {
  // The verdict refuses this, but the preview is drawn while the owner is still typing
  // and "বাকি -৳৩,০০০" beside the box would read as a bug rather than as a refusal.
  assert.equal(netAfterDiscount(2000, 5000), 0)
})

test('an unreadable figure previews nothing rather than NaN', () => {
  assert.equal(netAfterDiscount(Number.NaN, 500), 0)
  assert.equal(netAfterDiscount(2000, Number.NaN), 0)
})
