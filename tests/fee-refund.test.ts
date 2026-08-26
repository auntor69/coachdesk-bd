/**
 * How much of a bill may be handed back.
 *
 * The rule under test is the one the refund box, the Server Action and
 * app.guard_payment_floor() all read, so a change here that is not also made in the
 * migration is a change that lets the browser offer something the database refuses.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { refundVerdict, refundable } from '../src/lib/fees/refund.ts'

test('handing back part of what came in is fine', () => {
  assert.equal(refundVerdict({ received: 2000, amount: 500 }), 'ok')
})

test('handing back all of what came in is fine', () => {
  // The case the whole feature exists for: the student left, the bill is being
  // cancelled, and the ৳2,000 goes home with the parent.
  assert.equal(refundVerdict({ received: 2000, amount: 2000 }), 'ok')
})

test('a taka more than came in is refused', () => {
  assert.equal(refundVerdict({ received: 2000, amount: 2001 }), 'tooMuch')
})

test('a slipped digit is what this catches', () => {
  // ৳5,000 out of a drawer that took ৳500. Unrecoverable if it lands — a payment
  // cannot be deleted by anybody, so the only correction is a second row.
  assert.equal(refundVerdict({ received: 500, amount: 5000 }), 'tooMuch')
})

test('a bill nobody paid has nothing to hand back', () => {
  assert.equal(refundVerdict({ received: 0, amount: 100 }), 'nothing')
})

test('a bill already refunded past zero also has nothing', () => {
  // Should not exist — the floor is what stops it — but if it does, the answer is
  // not "hand back more".
  assert.equal(refundVerdict({ received: -100, amount: 50 }), 'nothing')
})

test('what is left is what came in less what went back', () => {
  // ৳2,000 in and ৳500 out nets to ৳1,500 in paid_bdt, so ৳1,500 more may go and a
  // taka past that may not. This module never counts rows.
  assert.equal(refundVerdict({ received: 1500, amount: 1500 }), 'ok')
  assert.equal(refundVerdict({ received: 1500, amount: 1500.01 }), 'tooMuch')
})

test('an unreadable figure is a typo, not a refund', () => {
  assert.equal(refundVerdict({ received: 2000, amount: Number.NaN }), 'unreadable')
  assert.equal(refundVerdict({ received: 2000, amount: Number.POSITIVE_INFINITY }), 'unreadable')
})

test('zero is refused before the bill is even looked at', () => {
  // Ordered on purpose: an empty box on a bill nobody paid should say "type an
  // amount", not "this family paid nothing" — the second answer sends the owner
  // looking for a different row.
  assert.equal(refundVerdict({ received: 0, amount: 0 }), 'zero')
  assert.equal(refundVerdict({ received: 2000, amount: 0 }), 'zero')
})

test('a fraction of a poisha is zero', () => {
  // numeric(10, 2) cannot hold it, so recording it would store 0.00 and fail the
  // table's own `amount_bdt <> 0`. Refused here, in words.
  assert.equal(refundVerdict({ received: 2000, amount: 0.004 }), 'zero')
})

test('a negative amount is a payment, and has its own form', () => {
  assert.equal(refundVerdict({ received: 2000, amount: -500 }), 'zero')
})

test('an unreadable receipts total refuses rather than allowing', () => {
  assert.equal(refundVerdict({ received: Number.NaN, amount: 100 }), 'nothing')
})

test('exactly what came in passes, floats and all', () => {
  // 1500.10 is held in a double as 1500.0999…, so comparing in taka can make a full
  // refund read as a hair too much. Both sides go to whole poisha first.
  assert.equal(refundVerdict({ received: 1500.1, amount: 1500.1 }), 'ok')
  assert.equal(refundVerdict({ received: 0.1 + 0.2, amount: 0.3 }), 'ok')
})

/* -------------------------------------------------------------------------- */
/* The ceiling shown above the box                                            */
/* -------------------------------------------------------------------------- */

test('what is refundable is what the bill holds', () => {
  assert.equal(refundable(2000), 2000)
  assert.equal(refundable(1500.5), 1500.5)
})

test('nothing on the bill is nothing to hand back', () => {
  assert.equal(refundable(0), 0)
})

test('a figure that would render as a negative or a NaN comes out zero', () => {
  // This one is drawn on screen above a money field. "-৳200 available" is worse than
  // no ceiling at all.
  assert.equal(refundable(-200), 0)
  assert.equal(refundable(Number.NaN), 0)
  assert.equal(refundable(Number.POSITIVE_INFINITY), 0)
})
