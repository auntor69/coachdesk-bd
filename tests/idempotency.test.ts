import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readIdempotencyKey, UNIQUE_VIOLATION } from '../src/lib/idempotency.ts'

/**
 * The token that makes one tap on a money button record one payment.
 *
 * Every case below is one where the wrong answer costs a family money. Reading a
 * token that is not one would send a value Postgres refuses to cast, and the failed
 * cast lands on the screen where an owner is holding cash across a desk. Refusing a
 * token that is fine would drop that submit's retry protection silently — the payment
 * still records, so nothing looks broken until the day it records twice.
 *
 * `mintIdempotencyKey` is not tested here: it is one optional-chained call into
 * `crypto.randomUUID`, and a test for it would be a test of Node's crypto. What
 * matters about it is that its empty-string fallback is *readable* as "no token",
 * which is the first assertion below.
 */

/** A real v4 uuid, of the shape `crypto.randomUUID()` produces. */
const REAL = '3f5a9c11-7b2d-4e18-9a44-0c6e8b1d2f70'

test('a minted token reads back as itself', () => {
  assert.equal(readIdempotencyKey(REAL), REAL)
})

test('the empty string that a browser with no crypto sends is no token', () => {
  // mintIdempotencyKey's fallback, and the value of the hidden input before the
  // mounting effect has run. Null here means the action inserts a null key, which
  // means this payment has no retry protection — the deliberate, documented
  // degradation. What it must never mean is a refused payment.
  assert.equal(readIdempotencyKey(''), null)
})

test('a form field that was never filled in is no token', () => {
  // formData.get returns null for an absent field, and a File for a file input. A
  // Server Action is a public HTTP endpoint, so neither is hypothetical.
  for (const missing of [null, undefined]) {
    assert.equal(readIdempotencyKey(missing), null, String(missing))
  }
})

test('anything that is not a string is no token', () => {
  // The caller does not have to be a browser and the field does not have to be text.
  for (const junk of [0, 1, {}, [], true, NaN, Symbol('k'), () => REAL]) {
    assert.equal(readIdempotencyKey(junk), null, String(junk))
  }
})

test('surrounding whitespace is trimmed rather than refused', () => {
  // Not a case the form produces. It is here because the alternative — refusing it —
  // silently drops retry protection for a submit that carried a perfectly good token,
  // and losing protection quietly is the failure mode this whole file exists to
  // prevent.
  assert.equal(readIdempotencyKey(` ${REAL} `), REAL)
  assert.equal(readIdempotencyKey(`\n${REAL}\t`), REAL)
})

test('a value Postgres would refuse to cast is refused here first', () => {
  // Each of these would reach the database as `'…'::uuid` and raise 22P02, and the
  // owner would be shown a failed payment for money they are holding. Refused here so
  // the payment goes through with a null key instead.
  const notUuids = [
    'not-a-uuid',
    REAL.slice(0, -1), // one character short
    `${REAL}0`, // one too long
    REAL.replace('-', ''), // right characters, wrong grouping
    '3f5a9c11-7b2d-4e18-9a44-0c6e8b1d2f7g', // g is not hex
    '3f5a9c11_7b2d_4e18_9a44_0c6e8b1d2f70', // underscores
    '{3f5a9c11-7b2d-4e18-9a44-0c6e8b1d2f70}', // the braced form Postgres also accepts
    "'; drop table fee_payments; --",
    'a'.repeat(10_000),
  ]
  for (const value of notUuids) {
    assert.equal(readIdempotencyKey(value), null, value.slice(0, 60))
  }
})

test('the nil uuid is a token, because it is a value and not an absence', () => {
  // Nothing mints it, so this is not a case the form produces either. It is asserted
  // because the tempting shortcut — treating all-zeroes as "empty" — would mean two
  // different submits that both sent it were silently deduplicated into one payment.
  const nil = '00000000-0000-0000-0000-000000000000'
  assert.equal(readIdempotencyKey(nil), nil)
})

test('case is preserved, not normalised', () => {
  // Postgres stores uuids canonically lowercase, so `A…` and `a…` are the same row and
  // the unique index treats them as one — which is the behaviour we want. Nothing here
  // needs to change the string to get it, and changing it would mean the value written
  // is not the value the browser sent.
  const upper = REAL.toUpperCase()
  assert.equal(readIdempotencyKey(upper), upper)
})

test('the unique-violation code is the one Postgres actually raises', () => {
  // Both money actions branch on this string to tell "already recorded" apart from
  // "failed". A typo here would turn every absorbed retry into a payment the owner is
  // told did not go through — and then takes again.
  assert.equal(UNIQUE_VIOLATION, '23505')
})
