import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ratesForDashboard, type RateRow } from '../src/lib/attendance/rates.ts'

const AUG = '2026-08-01'
const JUL = '2026-07-01'

/** A view row with only the fields a case cares about spelled out. */
function row(over: Partial<RateRow> & { batch_name: string }): RateRow {
  return {
    batch_id: over.batch_name,
    period_month: AUG,
    sessions: 10,
    counted: 100,
    rate_pct: 90,
    ...over,
  }
}

test('the batch worth a conversation is the first one on the card', () => {
  // Not alphabetical and not the order the view returns. An owner reads two rows
  // and stops, so the two rows have to be the two that need them.
  const { rates } = ratesForDashboard(
    [
      row({ batch_name: 'Bio Morning', rate_pct: 91 }),
      row({ batch_name: 'Chem Evening', rate_pct: 62 }),
      row({ batch_name: 'Phy Night', rate_pct: 78 }),
    ],
    AUG,
  )
  assert.deepEqual(
    rates.map((r) => r.batchName),
    ['Chem Evening', 'Phy Night', 'Bio Morning'],
  )
})

test('a batch with nothing to measure sinks below one that is failing', () => {
  // The inversion this file exists for. A comparator treating null as 0 — or as
  // less than any number, which is what a subtraction does — would head the card
  // with the batch that has no news at all and bury the 41%.
  const { rates } = ratesForDashboard(
    [
      row({ batch_name: 'All excused', rate_pct: null, counted: 0 }),
      row({ batch_name: 'Failing', rate_pct: 41 }),
      row({ batch_name: 'Also nothing', rate_pct: null, counted: 0 }),
      row({ batch_name: 'Fine', rate_pct: 95 }),
    ],
    AUG,
  )
  assert.deepEqual(
    rates.map((r) => r.batchName),
    ['Failing', 'Fine', 'All excused', 'Also nothing'],
  )
})

test('0% is a rate and sorts as one', () => {
  // Nobody came, which is the worst news on the board and must not be confused
  // with the absence of news.
  const { rates } = ratesForDashboard(
    [
      row({ batch_name: 'Empty room', rate_pct: 0, counted: 8 }),
      row({ batch_name: 'Unmeasured', rate_pct: null, counted: 0 }),
      row({ batch_name: 'Fine', rate_pct: 88 }),
    ],
    AUG,
  )
  assert.deepEqual(
    rates.map((r) => r.batchName),
    ['Empty room', 'Fine', 'Unmeasured'],
  )
  assert.equal(rates[0].ratePct, 0)
  assert.equal(rates[2].ratePct, null)
})

test('the current month wins as soon as it has one mark in it', () => {
  const { month, rates } = ratesForDashboard(
    [
      row({ batch_name: 'July only', period_month: JUL, rate_pct: 99 }),
      row({ batch_name: 'August', period_month: AUG, rate_pct: 55, sessions: 1, counted: 3 }),
    ],
    AUG,
  )
  assert.equal(month, AUG)
  assert.deepEqual(rates.map((r) => r.batchName), ['August'])
  // Deliberately not blended with July's finished figure: an owner asking about
  // this month wants this month, however thin it is, and the sessions and marks
  // are printed on the row so the thinness is visible.
  assert.equal(rates[0].sessions, 1)
  assert.equal(rates[0].counted, 3)
})

test('on the first of the month it falls back to the month that just closed', () => {
  // The case the fallback exists for. Nothing is marked yet and the alternative
  // is an empty card on precisely the days an owner is closing a month.
  const { month, rates } = ratesForDashboard(
    [
      row({ batch_name: 'Bio Morning', period_month: JUL, rate_pct: 91 }),
      row({ batch_name: 'Chem Evening', period_month: JUL, rate_pct: 62 }),
    ],
    AUG,
  )
  assert.equal(month, JUL)
  assert.deepEqual(rates.map((r) => r.batchName), ['Chem Evening', 'Bio Morning'])
})

test('a centre that has never taken attendance gets no rows at all', () => {
  // The page renders no card in this case rather than a card explaining its own
  // emptiness — the month it names would be arbitrary either way.
  assert.deepEqual(ratesForDashboard([], AUG).rates, [])
  assert.deepEqual(ratesForDashboard(null, AUG).rates, [])
  assert.deepEqual(ratesForDashboard(undefined, AUG).rates, [])
  assert.equal(ratesForDashboard([], AUG).month, JUL)
})

test('a month older than the two asked for cannot leak onto the card', () => {
  // The query asks for two months; if it ever asked for more, or if a row
  // arrived with a month nobody expected, the card must not silently describe it
  // under this month's heading.
  const { month, rates } = ratesForDashboard(
    [row({ batch_name: 'Ancient', period_month: '2026-03-01', rate_pct: 50 })],
    AUG,
  )
  assert.equal(month, JUL)
  assert.deepEqual(rates, [])
})

test('a null column from the view cannot print as "undefined"', () => {
  // Every column of a view is nullable in the generated types. batch_name never
  // is in practice, and the card must not bet the owner's screen on that.
  const { rates } = ratesForDashboard(
    [{
      batch_id: null,
      batch_name: null,
      period_month: AUG,
      sessions: null,
      counted: null,
      rate_pct: null,
    }],
    AUG,
  )
  assert.equal(rates.length, 1)
  assert.match(rates[0].batchName, /[ঀ-৿]/)
  assert.equal(rates[0].sessions, 0)
  assert.equal(rates[0].counted, 0)
  assert.equal(rates[0].ratePct, null)
})

test('the fallback crosses a year boundary the way the rest of the app does', () => {
  assert.equal(ratesForDashboard([], '2027-01-01').month, '2026-12-01')
})
