import { test } from 'node:test'
import assert from 'node:assert/strict'

import { growthByMonth, monthKeys } from '../src/lib/platform/growth.ts'

/**
 * Six months of money, and the one bug that made this a module.
 *
 * The first version of the growth table lived in the page and compared `created_at.slice(0, 7)`
 * against a period month (`YYYY-MM-01`), so nothing matched and every row drew a zero. That
 * renders perfectly — a screen of zeros reads as a business that stopped rather than as a bug —
 * which is why the arithmetic is here and tested rather than inside a `.map`.
 *
 * The other half is the Dhaka month. Every date in this product is a Dhaka date and the burn is
 * charged on Dhaka days, so a charge at 1am on the first of October is the *previous* month in
 * UTC; grouping by the UTC month would move six hours of every month into the month before.
 */

/** The six months ending with September 2026, the fixture's own period. */
const MONTHS = monthKeys('2026-09-01', 6)

test('the window is six months, oldest first, this one last', () => {
  assert.deepEqual(MONTHS, [
    '2026-04-01',
    '2026-05-01',
    '2026-06-01',
    '2026-07-01',
    '2026-08-01',
    '2026-09-01',
  ])
  assert.deepEqual(monthKeys('2026-01-01', 2), ['2025-12-01', '2026-01-01'])
  assert.deepEqual(monthKeys('2026-09-01', 0), [])
})

test('a charge at one in the morning is that Dhaka day, not the day before in UTC', () => {
  // 2026-10-01T01:00 in Dhaka is 2026-09-30T19:00Z. It belongs to October, and the month list
  // is built to include it.
  const months = monthKeys('2026-10-01', 2)
  const rows = growthByMonth({
    months,
    signedUpAt: ['2026-10-01T01:00:00+06:00'],
    entries: [
      { kind: 'daily_charge', amount_poisha: -6996, created_at: '2026-10-01T01:00:00+06:00' },
    ],
  })

  const october = rows.find((r) => r.month === '2026-10-01')
  assert.ok(october)
  assert.equal(october.signups, 1)
  assert.equal(october.burnedPoisha, 6996)
  // And September, where the UTC month would have put it, is untouched.
  assert.equal(rows.find((r) => r.month === '2026-09-01')?.burnedPoisha, 0)
})

test('a month with no money in it is a row of zeros, not a missing row', () => {
  const rows = growthByMonth({
    months: MONTHS,
    signedUpAt: ['2026-06-15T10:00:00+06:00'],
    entries: [{ kind: 'recharge', amount_poisha: 250_000, created_at: '2026-06-15T10:00:00+06:00' }],
  })

  assert.equal(rows.length, MONTHS.length)
  assert.deepEqual(rows.map((r) => r.month), MONTHS)
  // One month has the money; the other five are drawn empty rather than skipped.
  assert.deepEqual(
    rows.map((r) => r.rechargedPoisha),
    [0, 0, 250_000, 0, 0, 0],
  )
})

test('a recharge and its bonus are money in; a day charged is money out', () => {
  const rows = growthByMonth({
    months: monthKeys('2026-09-01', 1),
    signedUpAt: [],
    entries: [
      { kind: 'recharge', amount_poisha: 250_000, created_at: '2026-09-03T12:00:00+06:00' },
      { kind: 'promotion_bonus', amount_poisha: 25_000, created_at: '2026-09-03T12:00:00+06:00' },
      { kind: 'daily_charge', amount_poisha: -6996, created_at: '2026-09-04T12:00:00+06:00' },
      { kind: 'daily_charge', amount_poisha: -1670, created_at: '2026-09-04T18:00:00+06:00' },
    ],
  })

  assert.equal(rows[0]?.rechargedPoisha, 275_000)
  assert.equal(rows[0]?.burnedPoisha, 8666)
})

test('a correction is in neither column, because it is not income', () => {
  // §11.7 and §9.1: a granted day carries no money, and an adjustment, a refund, a reversal and
  // a failed settlement are corrections to a month whose recharges are already counted. A screen
  // that added them up would show a mistake as growth.
  const rows = growthByMonth({
    months: monthKeys('2026-09-01', 1),
    signedUpAt: [],
    entries: [
      { kind: 'founder_grant_days', amount_poisha: 0, created_at: '2026-09-05T12:00:00+06:00' },
      { kind: 'signup_trial', amount_poisha: 0, created_at: '2026-09-05T12:00:00+06:00' },
      { kind: 'founder_money_adjustment', amount_poisha: 50_000, created_at: '2026-09-06T12:00:00+06:00' },
      { kind: 'refund', amount_poisha: -100_000, created_at: '2026-09-07T12:00:00+06:00' },
      { kind: 'reversal', amount_poisha: -5000, created_at: '2026-09-08T12:00:00+06:00' },
      { kind: 'correction', amount_poisha: 5000, created_at: '2026-09-09T12:00:00+06:00' },
      { kind: 'settlement_failure', amount_poisha: 0, created_at: '2026-09-10T12:00:00+06:00' },
      { kind: 'settlement_retry', amount_poisha: 0, created_at: '2026-09-11T12:00:00+06:00' },
    ],
  })

  assert.equal(rows[0]?.rechargedPoisha, 0)
  assert.equal(rows[0]?.burnedPoisha, 0)
})

test('only customers inside the window are counted, and an undateable row is nobody', () => {
  const rows = growthByMonth({
    months: monthKeys('2026-09-01', 3),
    signedUpAt: [
      '2026-07-02T12:00:00+06:00',
      '2026-09-30T12:00:00+06:00',
      '2026-01-01T12:00:00+06:00', // before the window
      '2026-12-01T12:00:00+06:00', // after it
      null, // a partial read could not date it
      'not a date', // and this one is not a month either
    ],
    entries: [],
  })

  // July holds the first, August has nobody, September holds the last two — the January and
  // December rows are outside the window and the null and unparseable ones are placed nowhere.
  assert.deepEqual(
    rows.map((r) => r.signups),
    [1, 0, 1],
  )
})
