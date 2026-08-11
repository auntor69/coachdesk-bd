/**
 * Money.
 *
 * Every amount in the database is numeric(10, 2), which Postgres adds exactly.
 * JavaScript has no exact decimal type, so the moment a taka value reaches this
 * process it becomes a float, and floats cannot represent 0.10 — 1500.10 is
 * stored in a double as 1500.0999999999999090505298227071762084960938.
 *
 * Add eight of those together and the total is visibly wrong. Show it on a
 * screen an owner uses to chase parents for money and the product is finished:
 * nobody who has been shown a wrong total ever trusts the next one.
 *
 * So per-invoice arithmetic happens in SQL (see fee_invoice_balances), and any
 * arithmetic that has to happen here goes through this module, which works in
 * integer poisha and converts back once at the end.
 *
 * Coaching fees in Bangladesh are whole taka in practice, and poisha have not
 * circulated for years — every one of these functions would behave identically
 * with plain floats today. That is the argument for writing them now rather than
 * later: the day a centre enters 1250.50, nothing needs to be found and fixed.
 */

/** Poisha per taka. Two decimal places, matching numeric(10, 2). */
const SUBUNIT = 100

/**
 * Taka to integer poisha.
 *
 * Rounds, because the input is already a float and may be a hair under the value
 * it was meant to be: 1500.10 arrives as 1500.0999…, and truncating that gives
 * 150009 poisha — one poisha lost per invoice, silently, forever.
 */
function toPoisha(taka: number): number {
  return Math.round(taka * SUBUNIT)
}

/**
 * Adds taka amounts exactly.
 *
 * Non-finite entries are skipped rather than poisoning the total with NaN. A
 * missing amount is a data problem worth its own error message somewhere else;
 * here it must not turn an entire fee board into "৳NaN".
 */
export function sumTaka(amounts: readonly number[]): number {
  let poisha = 0
  for (const amount of amounts) {
    if (!Number.isFinite(amount)) continue
    poisha += toPoisha(amount)
  }
  return poisha / SUBUNIT
}

/**
 * Splits a list of per-invoice remainders into what is owed and what is in credit.
 *
 * These are two different things and must never be added together. A parent who
 * hands over 1600 for a 1500 bill leaves a 100 credit on their child's invoice;
 * summing every remainder would subtract that 100 from what other families owe,
 * producing a total that does not match the rows it sits above. An owner who taps
 * through the unpaid rows and adds them up would get a different number, and that
 * is how they stop believing the board.
 *
 * It is also the wrong direction to be wrong in. Netting under-states the debt, so
 * the owner under-chases it, and the money they never collect is the money the
 * product was supposed to find for them.
 */
export function tallyOutstanding(remainders: readonly number[]): {
  outstanding: number
  credit: number
} {
  return {
    outstanding: sumTaka(remainders.filter((r) => r > 0)),
    credit: sumTaka(remainders.filter((r) => r < 0).map((r) => -r)),
  }
}

/**
 * Parses a taka amount typed by a human.
 *
 * Accepts Bangla digits, because a phone keyboard set to Bangla produces them
 * and telling an owner their own numerals are invalid is not an option. Also
 * tolerates thousands separators, currency signs, and stray whitespace.
 *
 * Returns null for anything it cannot read as a number, so a caller can tell
 * "they typed nonsense" from "they typed zero".
 */
export function parseTaka(input: string): number | null {
  const normalised = input
    .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
    .replace(/[,\s৳]/g, '')
    .trim()

  if (normalised === '' || !/^-?\d*\.?\d*$/.test(normalised)) return null

  const value = Number(normalised)
  if (!Number.isFinite(value)) return null

  // Round to the stored precision here rather than letting Postgres do it, so
  // what the owner is told they recorded is what the database holds.
  return toPoisha(value) / SUBUNIT
}

/**
 * Formats taka for display.
 *
 * ASCII digits on purpose. Money and marks stay in ASCII across this product
 * while dates and times go Bangla — a fee of ৳১,২৫০ is harder to check against
 * a bKash statement than ৳1,250, and every owner reads both.
 *
 * Whole amounts drop the decimals: ৳1,250, not ৳1,250.00. Fractional amounts
 * keep both places, because ৳1,250.5 looks like a typo.
 *
 * A negative amount — a refund, or a family in credit — puts the sign ahead of
 * the symbol: -৳200 rather than ৳-200, which reads like a broken template.
 */
export function formatTaka(amount: number): string {
  if (!Number.isFinite(amount)) return '৳0'
  const whole = Number.isInteger(amount)
  const magnitude = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${amount < 0 ? '-' : ''}৳${magnitude}`
}
