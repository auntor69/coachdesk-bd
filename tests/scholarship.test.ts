/**
 * A waiver said as a share of the bill, and a named award that carries its own rule.
 *
 * WHAT THIS FILE IS ACTUALLY GUARDING. `fee_invoices_discount_percent_agrees` holds
 * `discount_bdt = round(amount_bdt * discount_percent / 100, 2)`, computed by Postgres in
 * exact decimal. The app computes the same figure from a float and sends both. A
 * disagreement of one poisha is not a rounding curiosity: it is an owner tapping Save,
 * getting a constraint violation, and having nothing on screen that explains it.
 *
 * So the triples below are hand-computed against what Postgres would round to, and
 * scripts/test-rls.mjs writes the same triples to a real invoice and lets the constraint
 * be the judge. Neither file computes the other's answer — that is the point of writing
 * the figures out twice.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_PERCENT,
  awardBasis,
  normalizePercent,
  percentHundredths,
  percentVerdict,
  percentWaiver,
  readAwardId,
  readBasis,
  ruleWaiver,
  scholarshipVerdict,
} from '../src/lib/fees/scholarship.ts'

/**
 * (bill, share, what Postgres rounds it to). Shared with scripts/test-rls.mjs.
 *
 * The three that earn their place: 333.33 at 50% is exactly 166.665, which a float
 * multiplication rounds *down* to 166.66 because the double nearest 166.665 is a hair
 * under it — Postgres rounds half away from zero and gives 166.67. 1999.99 at 50% is the
 * same tie one order of magnitude up. 999.99 at 33.33% is the case with a long tail, where
 * truncating instead of rounding loses a poisha.
 */
const TRIPLES: ReadonlyArray<readonly [number, number, number]> = [
  [2000, 50, 1000],
  [1500, 50, 750],
  [2200, 50, 1100],
  [1000, 100, 1000],
  [1500, 0.5, 7.5],
  [1250, 12.5, 156.25],
  [1500, 33.33, 499.95],
  [1234.56, 7.5, 92.59],
  [777.77, 25, 194.44],
  [333.33, 50, 166.67],
  [1999.99, 50, 1000],
  [999.99, 33.33, 333.3],
]

test('a share of a bill comes to what the constraint would compute', () => {
  for (const [billed, percent, figure] of TRIPLES) {
    assert.equal(
      percentWaiver(billed, percent),
      figure,
      `${percent}% of ${billed} should be ${figure}`,
    )
  }
})

test('a half poisha rounds away from zero, as round(numeric, 2) does', () => {
  // The one line that would break if this file ever multiplied floats: Math.round on
  // 333.33 * 50 / 100 * 100 gives 16666, a poisha short of the constraint's answer.
  assert.equal(percentWaiver(333.33, 50), 166.67)
})

test('a share of nothing is nothing', () => {
  assert.equal(percentWaiver(0, 50), 0)
  assert.equal(percentWaiver(-100, 50), 0)
  assert.equal(percentWaiver(Number.NaN, 50), 0)
})

test('a share outside the column is priced at nothing rather than guessed at', () => {
  assert.equal(percentWaiver(2000, 0), 0)
  assert.equal(percentWaiver(2000, 101), 0)
  assert.equal(percentWaiver(2000, Number.NaN), 0)
})

test('the whole fee is a legal share', () => {
  assert.equal(percentVerdict(MAX_PERCENT), 'ok')
  assert.equal(percentVerdict(100.01), 'outOfRange')
})

test('zero is out of range rather than a way of clearing a waiver', () => {
  // Unlike the taka figure, where zero is exactly how an owner takes one back. The column
  // itself checks `discount_percent > 0`, so a zero arriving here is a broken form.
  assert.equal(percentVerdict(0), 'outOfRange')
  assert.equal(percentVerdict(-5), 'outOfRange')
})

test('an unreadable share is named as unreadable, not as out of range', () => {
  assert.equal(percentVerdict(Number.NaN), 'unreadable')
  assert.equal(percentVerdict(Number.POSITIVE_INFINITY), 'unreadable')
})

test('a share is held to two places, because the column is', () => {
  // numeric(5, 2) rounds on the way in. Rounding here first means the percentage that is
  // stored is the percentage the figure was priced from — otherwise the row is refused.
  assert.equal(normalizePercent(33.333), 33.33)
  assert.equal(normalizePercent(12.5), 12.5)
  assert.equal(percentHundredths(33.333), 3333)
})

test('a share priced from a rounded percentage agrees with the stored one', () => {
  const typed = 33.333
  assert.equal(percentWaiver(1500, normalizePercent(typed)), percentWaiver(1500, typed))
})

test('an award that is a share prices like a share', () => {
  assert.equal(ruleWaiver({ percent: 50, amountBdt: null }, 2200), 1100)
})

test('an award that is a figure waives that figure', () => {
  assert.equal(ruleWaiver({ percent: null, amountBdt: 300 }, 2000), 300)
})

test('a fixed award larger than the bill is capped at the bill', () => {
  // "Sibling waiver ৳300" against a ৳200 bill. Refusing it would be the wrong answer —
  // the family owes nothing, which is what the award was for — and 300 would break
  // fee_invoices_discount_bound.
  assert.equal(ruleWaiver({ percent: null, amountBdt: 300 }, 200), 200)
})

test('a fixed award against a bill of nothing waives nothing', () => {
  assert.equal(ruleWaiver({ percent: null, amountBdt: 300 }, 0), 0)
})

test('a malformed rule is null, not zero', () => {
  // So a caller cannot mistake "this award is broken" for "this award waives nothing".
  assert.equal(ruleWaiver({ percent: null, amountBdt: null }, 2000), null)
  assert.equal(ruleWaiver({ percent: 50, amountBdt: 300 }, 2000), null)
  assert.equal(ruleWaiver({ percent: 0, amountBdt: null }, 2000), null)
  assert.equal(ruleWaiver({ percent: 120, amountBdt: null }, 2000), null)
  assert.equal(ruleWaiver({ percent: null, amountBdt: -50 }, 2000), null)
})

test('an award needs a name and exactly one rule', () => {
  assert.equal(scholarshipVerdict({ name: 'Merit', percent: 50, amountBdt: null }), 'ok')
  assert.equal(scholarshipVerdict({ name: '  ', percent: 50, amountBdt: null }), 'noName')
  assert.equal(
    scholarshipVerdict({ name: 'Merit', percent: null, amountBdt: null }),
    'noRule',
  )
  assert.equal(
    scholarshipVerdict({ name: 'Merit', percent: 50, amountBdt: 300 }),
    'twoRules',
  )
})

test('the two opposite mistakes are named separately', () => {
  // An owner who filled in neither box and one who filled in both need different
  // sentences, so the verdicts cannot be collapsed.
  assert.notEqual(
    scholarshipVerdict({ name: 'Merit', percent: null, amountBdt: null }),
    scholarshipVerdict({ name: 'Merit', percent: 50, amountBdt: 300 }),
  )
})

test('a rule out of range is refused before the constraint sees it', () => {
  assert.equal(
    scholarshipVerdict({ name: 'Merit', percent: 101, amountBdt: null }),
    'percentRange',
  )
  assert.equal(
    scholarshipVerdict({ name: 'Sibling', percent: null, amountBdt: 0 }),
    'amountRange',
  )
})

test('a missing basis is taka, so a replayed offline request still waives', () => {
  // The load-bearing one. useOffline replays a queued Server Action, and a request queued
  // before this field existed carries no basis at all.
  assert.deepEqual(readBasis(null), { kind: 'taka' })
  assert.deepEqual(readBasis(''), { kind: 'taka' })
  assert.deepEqual(readBasis('taka'), { kind: 'taka' })
})

test('a share is read as a share', () => {
  assert.deepEqual(readBasis('percent'), { kind: 'percent' })
})

test('an award basis carries its id back', () => {
  const id = '2f2c8d1e-9a7b-4c3d-8e5f-1a2b3c4d5e6f'
  assert.deepEqual(readBasis(awardBasis(id)), { kind: 'scholarship', id })
})

test('an unrecognised basis is refused rather than guessed at', () => {
  // Three ways of spending the centre's money, so guessing between them is worse than
  // refusing. Only an absent field means taka.
  assert.equal(readBasis('percentage'), null)
  assert.equal(readBasis('sch:'), null)
  assert.equal(readBasis('sch:not-a-uuid'), null)
})

test('a field that is not text at all counts as absent', () => {
  // What FormData hands back for a field nobody filled in, or for one carrying a file.
  // Absent means taka, which is the default and is separately bounded by the amount box —
  // so this is the safe direction as well as the compatible one.
  assert.deepEqual(readBasis(42), { kind: 'taka' })
  assert.deepEqual(readBasis(undefined), { kind: 'taka' })
})

test('an id that merely looks like a uuid is not one', () => {
  // Shape-checked here so a malformed one never reaches Postgres, where it comes back as
  // "invalid input syntax for type uuid" rather than as "no such award".
  assert.equal(readAwardId('2f2c8d1e-9a7b-4c3d-8e5f-1a2b3c4d5e6f'), '2f2c8d1e-9a7b-4c3d-8e5f-1a2b3c4d5e6f')
  assert.equal(readAwardId(' 2f2c8d1e-9a7b-4c3d-8e5f-1a2b3c4d5e6f '), '2f2c8d1e-9a7b-4c3d-8e5f-1a2b3c4d5e6f')
  assert.equal(readAwardId('2f2c8d1e9a7b4c3d8e5f1a2b3c4d5e6f'), null)
  assert.equal(readAwardId('2f2c8d1e-9a7b-4c3d-8e5f-1a2b3c4d5e6'), null)
  assert.equal(readAwardId(null), null)
})
