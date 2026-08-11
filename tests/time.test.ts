import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addMonths,
  formatMonthBn,
  currentPeriodMonth,
  todayInDhaka,
} from '../src/lib/bd/time.ts'

test('a billing period is the first of a month', () => {
  // Fixed instants, because a test that reads the clock passes at 3pm and fails
  // at 3am. 2026-08-11T20:00:00Z is already the 12th in Dhaka (UTC+6).
  assert.equal(currentPeriodMonth(new Date('2026-08-11T04:00:00Z')), '2026-08-01')
  assert.equal(currentPeriodMonth(new Date('2026-08-11T20:00:00Z')), '2026-08-01')
  // The last hours of a Dhaka month belong to that month. Dhaka is UTC+6, so
  // the boundary sits at 18:00 UTC on the 31st — an hour either side of it is
  // the only interesting pair of instants here.
  assert.equal(todayInDhaka(new Date('2026-08-31T17:00:00Z')), '2026-08-31')
  assert.equal(currentPeriodMonth(new Date('2026-08-31T17:00:00Z')), '2026-08-01')
  assert.equal(todayInDhaka(new Date('2026-08-31T18:30:00Z')), '2026-09-01')
  assert.equal(currentPeriodMonth(new Date('2026-08-31T18:30:00Z')), '2026-09-01')
})

test('shifting a period by whole months crosses years correctly', () => {
  assert.equal(addMonths('2026-08-01', 1), '2026-09-01')
  assert.equal(addMonths('2026-08-01', -1), '2026-07-01')
  assert.equal(addMonths('2026-08-01', 0), '2026-08-01')
  // The two crossings a naive (m + delta) would get wrong.
  assert.equal(addMonths('2026-12-01', 1), '2027-01-01')
  assert.equal(addMonths('2026-01-01', -1), '2025-12-01')
  assert.equal(addMonths('2026-01-01', -13), '2024-12-01')
  assert.equal(addMonths('2026-08-01', 12), '2027-08-01')
})

test('a period renders as a month and a year, in Bangla numerals', () => {
  // Money stays ASCII across this product; a date does not.
  assert.equal(formatMonthBn('2026-08-01'), 'আগস্ট ২০২৬')
  assert.equal(formatMonthBn('2026-01-01'), 'জানুয়ারি ২০২৬')
  assert.equal(formatMonthBn('2026-12-01'), 'ডিসেম্বর ২০২৬')
})

test('a malformed period is shown as-is rather than as a wrong month', () => {
  // The fee board builds its month list from addMonths, so this should be
  // unreachable — but rendering "undefined ২০২৬" beside a bill is worse than
  // rendering the raw string, which is at least obviously a bug.
  assert.equal(formatMonthBn(''), '')
  assert.equal(formatMonthBn('2026-13-01'), '2026-13-01')
  assert.equal(addMonths('', 1), '')
})
