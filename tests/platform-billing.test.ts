import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  coverageEnd,
  coverageStart,
  isMonthsCovered,
  isPeriodChoice,
  periodChoices,
  DEFAULT_MONTHS_COVERED,
  MAX_CENTER_PAYMENT_BDT,
  MONTHS_COVERED,
  PERIODS_AHEAD,
  PERIODS_BACK,
} from '../src/lib/platform/billing.ts'
import { addMonths } from '../src/lib/bd/time.ts'
import { CENTER_MONTHLY_FLOOR_BDT, PLANS, monthlyBillBdt } from '../src/lib/plans.ts'

/**
 * What one payment from a coaching centre covers.
 *
 * The reason this file exists rather than trusting the two helpers underneath it: a
 * `payments` row is money and nothing in the app rewrites one. `covers_period_end` is
 * what the founder reads in eight months when a centre says "I paid you in August",
 * and if it is a day out on the wrong month it is a day out forever. Everything below
 * is a case where a plain `new Date()` and `setMonth` would have produced something
 * plausible and wrong.
 */

/** 25 August 2026, 3pm in Dhaka. Mid-month and mid-afternoon, so nothing is on an edge. */
const NOW = new Date('2026-08-25T09:00:00.000Z')

/* -------------------------------------------------------------------------- */
/* The window a payment covers                                                */
/* -------------------------------------------------------------------------- */

test('one month ends on the last day of that month, whatever its length', () => {
  assert.equal(coverageEnd('2026-08-01', 1), '2026-08-31')
  assert.equal(coverageEnd('2026-09-01', 1), '2026-09-30')
  // February, which is where every hand-rolled version of this goes wrong.
  assert.equal(coverageEnd('2026-02-01', 1), '2026-02-28')
  assert.equal(coverageEnd('2028-02-01', 1), '2028-02-29', 'a leap February has 29 days')
  assert.equal(coverageEnd('2026-12-01', 1), '2026-12-31')
})

test('twelve months ends the day before the anniversary', () => {
  // The receipt a founder writes for a centre paying a year up front, which is the
  // one they will be quoted back at them. Not 2027-08-01 and not 2027-07-30.
  assert.equal(coverageEnd('2026-08-01', 12), '2027-07-31')
  assert.equal(coverageEnd('2026-01-01', 12), '2026-12-31')
  // Twelve months from a leap February. Ends on the 28th, because 2027 has no 29th.
  assert.equal(coverageEnd('2028-02-01', 12), '2029-01-31')
})

test('a window that crosses the year boundary lands in the right year', () => {
  // December + 3 is February, and the year has to move with it. An off-by-one here
  // would file a payment against a month twelve months from where it belongs.
  assert.equal(coverageEnd('2026-12-01', 3), '2027-02-28')
  assert.equal(coverageEnd('2026-11-01', 3), '2027-01-31')
  assert.equal(coverageEnd('2026-08-01', 6), '2027-01-31')
  assert.equal(coverageEnd('2026-08-01', 3), '2026-10-31')
})

test('consecutive windows touch without a gap and without an overlap', () => {
  // The property that matters more than any single date: a centre that pays for
  // August and then for September must not be recorded as unpaid on the 1st of
  // September, and must not be paid twice for the 31st of August. Checked across
  // every month count and a year of start months, including both February cases.
  for (const months of MONTHS_COVERED) {
    for (let i = 0; i < 18; i += 1) {
      const from = addMonths('2027-11-01', i)
      const next = addMonths(from, months)
      const end = coverageEnd(from, months)

      const dayAfterEnd = new Date(`${end}T12:00:00Z`)
      dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1)

      assert.equal(
        dayAfterEnd.toISOString().slice(0, 10),
        next,
        `${from} + ${months} ended at ${end}, which does not meet ${next}`,
      )
    }
  }
})

/* -------------------------------------------------------------------------- */
/* The months on offer                                                        */
/* -------------------------------------------------------------------------- */

test('the window is five months wide with today in the middle', () => {
  const list = periodChoices(NOW)

  assert.equal(list.length, PERIODS_BACK + PERIODS_AHEAD + 1)
  assert.deepEqual(list, [
    '2026-06-01',
    '2026-07-01',
    '2026-08-01',
    '2026-09-01',
    '2026-10-01',
  ])
  // The form defaults to the middle entry — see the note in center-billing.tsx — so
  // if this stops being the current month the form quietly starts defaulting to the
  // wrong one, which is a wrong receipt nobody would look twice at.
  assert.equal(list[Math.floor(list.length / 2)], '2026-08-01')
})

test('every entry is a period month, oldest first', () => {
  const list = periodChoices(NOW)
  for (const m of list) {
    assert.match(m, /^\d{4}-\d{2}-01$/, 'fee_invoices.period_month shape, not a day')
  }
  assert.deepEqual(list, [...list].sort(), 'oldest first, so the dropdown reads forward')
})

test('the window crosses the year boundary in both directions', () => {
  assert.deepEqual(periodChoices(new Date('2026-01-15T06:00:00.000Z')), [
    '2025-11-01',
    '2025-12-01',
    '2026-01-01',
    '2026-02-01',
    '2026-03-01',
  ])
  assert.deepEqual(periodChoices(new Date('2026-12-15T06:00:00.000Z')), [
    '2026-10-01',
    '2026-11-01',
    '2026-12-01',
    '2027-01-01',
    '2027-02-01',
  ])
})

test('the current month is Dhaka’s, not UTC’s', () => {
  // 7pm UTC on the last day of August is 1am on the 1st of September in Dhaka. The
  // founder recording a payment at that moment is in September, and the month the
  // form opens on has to agree with the calendar on their wall.
  const list = periodChoices(new Date('2026-08-31T19:00:00.000Z'))
  assert.equal(list[2], '2026-09-01')

  // Two hours earlier it is still August there.
  assert.equal(periodChoices(new Date('2026-08-31T17:00:00.000Z'))[2], '2026-08-01')
})

/* -------------------------------------------------------------------------- */
/* Where the next window opens                                                */
/* -------------------------------------------------------------------------- */

test('a centre that has never paid is billed from this month', () => {
  assert.equal(coverageStart(null, NOW), '2026-08-01')
})

test('a centre already covered is billed from the month after its coverage', () => {
  // The double-charge this exists to stop: paid through November, so a payment made in
  // August covers December onwards and not August again.
  assert.equal(coverageStart('2026-11-30', NOW), '2026-12-01')
  assert.equal(coverageStart('2026-08-31', NOW), '2026-09-01')

  // Across the year boundary, where addMonths is doing the work.
  assert.equal(coverageStart('2026-12-31', NOW), '2027-01-01')
})

test('coverage that has already run out reopens this month, not where it stopped', () => {
  // A centre that lapsed in April and comes back in August is billed for August. The
  // alternative — resuming at May — bills them for four months they spent locked out,
  // which is the one thing a returning customer will not forgive.
  assert.equal(coverageStart('2026-04-30', NOW), '2026-08-01')
  assert.equal(coverageStart('2025-12-31', NOW), '2026-08-01')

  // The edge: coverage that ends this month. Next month, because today is inside it.
  assert.equal(coverageStart('2026-08-31', NOW), '2026-09-01')
  // And coverage that ended last month, which is the first month that is not still
  // running: this month, because that is the month now going unpaid.
  assert.equal(coverageStart('2026-07-31', NOW), '2026-08-01')
})

test('a coverage end mid-month rounds up, and so errs the customer’s way', () => {
  // Every window this product sells is whole months — `coverageEnd` subtracts a day
  // from a month boundary — so a `paid_through` on the 15th cannot be resumed from the
  // 16th. The next window opens on the 1st of the following month and the fortnight
  // between is not billed.
  assert.equal(coverageStart('2026-09-15', NOW), '2026-10-01')
  assert.equal(coverageStart('2026-08-15', NOW), '2026-09-01')
})

test('the month a purchase opens in is Dhaka’s', () => {
  // 1am on the 1st of September in Dhaka, which is still August in UTC. An owner
  // paying at that moment is paying for September.
  const midnightish = new Date('2026-08-31T19:00:00.000Z')
  assert.equal(coverageStart(null, midnightish), '2026-09-01')
  assert.equal(coverageStart(null, new Date('2026-08-31T17:00:00.000Z')), '2026-08-01')
})

test('the window a form draws is the window the action bills', () => {
  // The pair /settings/plan shows and `buySubscription` charges for. Both call these
  // two functions, and the point of the test is that the answer is one window: twelve
  // months from the end of existing coverage, ending the day before the anniversary.
  const from = coverageStart('2026-11-30', NOW)
  assert.equal(from, '2026-12-01')
  assert.equal(coverageEnd(from, 12), '2027-11-30')

  // And that consecutive purchases touch: paying again once that lands leaves no gap.
  assert.equal(coverageStart(coverageEnd(from, 12), NOW), '2027-12-01')
})

/* -------------------------------------------------------------------------- */
/* What the server will accept                                                */
/* -------------------------------------------------------------------------- */

test('a posted month is checked against the list, not parsed', () => {
  for (const m of periodChoices(NOW)) {
    assert.equal(isPeriodChoice(m, NOW), true, m)
  }

  // Outside the window. Both of these are real months and neither is a payment any
  // centre could sanely be making today.
  assert.equal(isPeriodChoice('2026-03-01', NOW), false)
  assert.equal(isPeriodChoice('2027-01-01', NOW), false)
  assert.equal(isPeriodChoice('2025-08-01', NOW), false, 'the year defaulting wrong')

  // The right month with a day on it. `covers_period_start` is a period label and the
  // list holds first-of-months only, so this is not the same value even though a
  // human reading it would call it August.
  assert.equal(isPeriodChoice('2026-08-25', NOW), false)
  assert.equal(isPeriodChoice('2026-08', NOW), false)
})

test('anything that is not one of the strings on offer is refused', () => {
  // A Server Action is a public HTTP endpoint: the form data is whatever the caller
  // sent, and it does not have to be a string at all.
  for (const junk of [null, undefined, 0, 1, {}, [], '', 'august', true, NaN]) {
    assert.equal(isPeriodChoice(junk, NOW), false, String(junk))
  }
})

test('the month count is one of four, and 2 is not one of them', () => {
  for (const n of MONTHS_COVERED) {
    assert.equal(isMonthsCovered(n), true, String(n))
  }
  assert.ok(isMonthsCovered(DEFAULT_MONTHS_COVERED), 'the form default must be valid')

  // 2 and 7 are the honest cases: they are not absurd, they are simply not sold, and
  // a receipt for a window nobody agreed to is a bill nobody can check.
  for (const n of [0, 2, 4, 7, 13, 24, -1, -12]) {
    assert.equal(isMonthsCovered(n), false, String(n))
  }
  // A form posts strings. `Number(...)` in the action is what makes this hold, and
  // this is the assertion that catches its removal.
  for (const junk of ['1', '12', null, undefined, NaN, 1.5, {}, []]) {
    assert.equal(isMonthsCovered(junk), false, String(junk))
  }
})

test('the cap admits a real annual payment and stops a pasted phone number', () => {
  // The cap has to sit above twelve months of the largest centre this pricing model
  // describes, because a cap that refuses real money is worse than no cap — the
  // founder works around it by not recording the payment.
  //
  // Two thousand students and sixty teachers: bigger than any single coaching centre
  // this is sold to, and tied to monthlyBillBdt rather than to a literal, so widening
  // the bands or raising the seat price says here that the cap needs revisiting.
  const biggest = monthlyBillBdt(PLANS.center, 2_000, 60)
  assert.ok(
    MAX_CENTER_PAYMENT_BDT > biggest * 12,
    `a year at ${biggest}/month must be recordable, cap is ${MAX_CENTER_PAYMENT_BDT}`,
  )
  // And the floor case, which is what nearly every receipt will be.
  assert.ok(MAX_CENTER_PAYMENT_BDT > CENTER_MONTHLY_FLOOR_BDT * 12)

  // The mistake it exists for: a mobile number in the amount box. No cap that admits
  // the line above can also catch ৳19,990 typed as ৳1,99,900 — see the note on the
  // constant for why that is the right way round.
  assert.ok(MAX_CENTER_PAYMENT_BDT < 1_711_000_111)
})
