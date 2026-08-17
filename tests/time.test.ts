import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addDays,
  addMonths,
  daysBetween,
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

test('days between two calendar dates is exact in both directions', () => {
  assert.equal(daysBetween('2026-08-10', '2026-08-15'), 5)
  assert.equal(daysBetween('2026-08-15', '2026-08-10'), -5)
  assert.equal(daysBetween('2026-08-15', '2026-08-15'), 0)
  // Month and year boundaries, and a leap day — the three places a naive
  // subtraction of the day-of-month components goes wrong.
  assert.equal(daysBetween('2026-08-31', '2026-09-01'), 1)
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1)
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2)
  assert.equal(daysBetween('2027-02-28', '2027-03-01'), 1)
  // A whole year, so nothing accumulates a rounding error across 365 additions.
  assert.equal(daysBetween('2026-01-01', '2027-01-01'), 365)
})

test('a due date shifted by whole days stays a calendar date', () => {
  assert.equal(addDays('2026-08-15', 3), '2026-08-18')
  assert.equal(addDays('2026-08-15', -3), '2026-08-12')
  assert.equal(addDays('2026-08-15', 0), '2026-08-15')
  assert.equal(addDays('2026-08-31', 1), '2026-09-01')
  assert.equal(addDays('2026-01-01', -1), '2025-12-31')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2027-02-28', 1), '2027-03-01')
})

test('the two are inverses, which is what the reminder stages rely on', () => {
  // A stage knows the day it began as due_date + n; the screen asks how long ago
  // that was. If these two disagree by a day, a family gets chased twice.
  for (const delta of [-30, -7, -3, -1, 0, 1, 3, 7, 30, 400]) {
    assert.equal(daysBetween('2026-08-15', addDays('2026-08-15', delta)), delta)
  }
})

test('an unparseable date is not silently turned into a real one', () => {
  // Both are fed values that came out of a nullable view column, so the failure
  // mode has to be inert: 0 days apart and the input handed back, never NaN
  // leaking into a comparison or "Invalid Date" reaching a screen.
  assert.equal(daysBetween('', '2026-08-15'), 0)
  assert.equal(daysBetween('2026-08-15', 'nonsense'), 0)
  assert.equal(addDays('', 3), '')
  assert.equal(addDays('nonsense', 3), 'nonsense')
})
