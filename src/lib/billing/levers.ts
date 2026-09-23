/**
 * The two founder levers, as arithmetic — MASTERPLAN.md §11.7, build-order step 26.
 *
 * THE HALF OF THE LEVERS THAT CAN BE WRONG IN A TEST, and the half that has to agree with
 * the database. `public.founder_grant_days` computes the date it reaches inside Postgres,
 * from the line the row actually holds; this module computes the same date for the screen
 * that is about to grant, so the founder reads "to 14 October" before the tap and the row
 * says 14 October afterwards. Two engines, one answer — the arrangement
 * `tests/recharge-quote.test.ts` holds for the bonus ladder, and `tests/founder-levers.test.ts`
 * holds for this.
 *
 * WHY THE SCREEN IS ALLOWED TO PREVIEW IT AT ALL. It is a date, not an amount: the worst a
 * disagreement can do is tell a founder the wrong day, and the test below exists so it does
 * not. Nothing here decides money — the adjustment's figure is the founder's own, checked
 * against the balance in the database, and a grant moves no money by construction
 * (`billing_ledger_amount_sign` pins it to zero).
 *
 * NO `server-only`, because `node --test` imports this file. The module that talks to
 * PostgREST lives in the founder's own actions, where the session already is.
 */

/**
 * Relative, with the extension, for the reason `plans.ts` imports `./i18n/locale.ts` the
 * same way: this module is imported by `node --test`, which resolves neither the `@/`
 * alias nor an extensionless path.
 */
import { addDays } from '../bd/time.ts'

/**
 * How many days one grant may carry.
 *
 * A year, because every honest reason for this lever is bounded by one — a Ramadan closure
 * is a few weeks, an apology is a few days, a sales trial is thirty. Past a year it is no
 * longer a goodwill gesture but a different deal, and a deal should be a price and a
 * conversation rather than a zero-amount row. The number is also what stops a stray
 * keystroke from granting four thousand days: `p_days` arrives from a public endpoint in a
 * Server Action, and an unbounded one grants a free decade.
 */
export const MAX_GRANT_DAYS = 366

/**
 * The last day a grant of `days` reaches, given the line the centre holds.
 *
 * THE GRANT STARTS AT TODAY WHEN THE LINE IS BEHIND IT, which is the whole difference
 * between a lever and a gesture: a centre that ran dry last week is read-only, and three
 * days added to last week still leaves it read-only. `charged_through` is the last day paid
 * for, so a line of *today* grants today plus the days asked for — the day the grant is made
 * is one of the days it buys, exactly as §11.6 counts a day.
 *
 * `today` is passed rather than read, so a test can put a clock in it and so the caller can
 * pass the Dhaka day the session already resolved rather than the browser's. The database
 * uses `(now() at time zone 'Asia/Dhaka')::date` and never `current_date` (§11.7).
 */
export function grantReach(line: string, days: number, today: string): string {
  return addDays(line > today ? line : today, days)
}

/**
 * A number of days typed into the grant field, or null.
 *
 * Bangla digits are accepted because a phone keyboard set to Bangla produces them, and this
 * is read on a phone — the same reason `parseTaka` accepts them. What is refused is
 * anything that is not a whole number of days in range: a fraction, a zero, a negative
 * (a negative grant is a *pause*, which §11.8 deliberately does not build), and anything
 * past `MAX_GRANT_DAYS`. One null for all five, because the sentences that distinguish them
 * would each be a different mistake to explain on a screen the founder uses twice a year.
 */
export function parseDays(input: string): number | null {
  const normalised = input
    .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
    .replace(/[,\s]/g, '')
    .trim()

  if (normalised === '' || !/^\d+$/.test(normalised)) return null

  const value = Number(normalised)
  if (!Number.isInteger(value) || value <= 0 || value > MAX_GRANT_DAYS) return null

  return value
}
