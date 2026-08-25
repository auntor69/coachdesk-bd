/**
 * What one payment from a coaching centre covers, and how much of one is plausible.
 *
 * Small on purpose, and separate from the panel's arithmetic in ./centers.ts, because
 * these three answers are the ones a receipt is wrong forever if they are wrong once.
 * A payment row is money: `covers_period_start` and `covers_period_end` are what the
 * founder will read in eight months when a centre says "I paid you in August", and
 * nothing in the app rewrites them. So the window is computed from two helpers that
 * are already tested rather than by adding a month to a Date, and the choice of which
 * months may be entered is a closed list rather than a free text field.
 *
 * Relative imports with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */

import { addDays, addMonths, currentPeriodMonth } from '../bd/time.ts'

/**
 * How many months one payment may cover.
 *
 * A closed list and not a number field, because the two things a founder actually
 * sells are a month at a time and a year up front — the discount conversation with a
 * centre owner is "pay for twelve and I will not raise it", not "pay for seven". Four
 * options fit on a phone as a row of buttons; a free number field would fit a 7 and a
 * 70 equally well and one of those is a wrong receipt.
 */
export const MONTHS_COVERED = [1, 3, 6, 12] as const

export type MonthsCovered = (typeof MONTHS_COVERED)[number]

/** What the form defaults to. Monthly is how nearly every centre will pay. */
export const DEFAULT_MONTHS_COVERED: MonthsCovered = 1

export function isMonthsCovered(value: unknown): value is MonthsCovered {
  return (MONTHS_COVERED as readonly unknown[]).includes(value)
}

/**
 * The largest single receipt this form will accept, in taka.
 *
 * HONEST ABOUT WHAT IT CANNOT DO. It does not catch a slipped zero on a five-figure
 * sum, and no single number can: ৳19,990 typed as ৳1,99,900 is inside any cap that
 * also admits a year up front from a large institution, because both of those are
 * real payments. A cap set tight enough to catch that typo would start refusing money
 * a centre had actually handed over, and a founder who cannot record a payment simply
 * does not record it — which loses the whole feature to protect one column.
 *
 * WHAT IT DOES CATCH is the class of mistake that has no upper bound: a pasted figure
 * that landed in the wrong box, a stray keypress on a repeat, or a mobile number typed
 * into the amount field — 01711000111 reads as ৳1,71,10,00,111 and would put the
 * founder's own "we have received" total, the one figure they would quote to decide
 * whether this business works, four orders of magnitude out with nothing on screen to
 * suggest it.
 *
 * FIVE LAKH, which is above twelve months of the largest centre this pricing model
 * describes — see the assertion in tests/platform-billing.test.ts, which is tied to
 * monthlyBillBdt so widening the bands says so. A payment genuinely larger than this
 * is a negotiated institution contract, and the error names the cap: it gets recorded
 * as two receipts, or this constant gets raised on purpose rather than by accident.
 */
export const MAX_CENTER_PAYMENT_BDT = 500_000

/**
 * The last day covered by a payment starting at `from` and running `months` months.
 *
 * `addMonths` lands on the first of the month *after* the covered range and `addDays`
 * steps back one day, so August + 1 is 2026-08-31 and August + 12 is 2027-07-31. Both
 * helpers are the ones the fee board uses and both are already tested against month
 * lengths, leap years and the year boundary; doing this with a Date and setMonth is
 * where "paid through 31 February" comes from.
 */
export function coverageEnd(from: string, months: MonthsCovered): string {
  return addDays(addMonths(from, months), -1)
}

/** Months back from today the form offers. Two catches a centre paying late. */
export const PERIODS_BACK = 2

/** Months forward. Two catches pay-first-at-signup and a renewal paid early. */
export const PERIODS_AHEAD = 2

/**
 * The months a payment may be recorded against, oldest first.
 *
 * A five-month window around today rather than a date picker, and the narrowness is
 * the feature: the two mistakes worth designing against are a founder recording
 * August's money against 2025 because the year defaulted wrong, and recording it
 * against 2027 because a keyboard was in the way. Neither is possible if the only
 * months on offer are the ones a payment could sanely be for.
 *
 * `now` is a parameter so the action, the form and the test all agree on a window
 * without freezing a clock — and so the server can re-derive the list rather than
 * trusting the one the browser posted back.
 */
export function periodChoices(now: Date = new Date()): string[] {
  const current = currentPeriodMonth(now)
  const out: string[] = []
  for (let delta = -PERIODS_BACK; delta <= PERIODS_AHEAD; delta += 1) {
    out.push(addMonths(current, delta))
  }
  return out
}

/**
 * Whether a posted month is one this form offers.
 *
 * The whole reason `periodChoices` takes `now`: a Server Action is a public HTTP
 * endpoint and the month in the form data is whatever the caller sent, so the server
 * rebuilds the list and checks membership rather than parsing the string it was
 * handed. A `<select>` is not a validation.
 */
export function isPeriodChoice(value: unknown, now: Date = new Date()): boolean {
  return typeof value === 'string' && periodChoices(now).includes(value)
}
