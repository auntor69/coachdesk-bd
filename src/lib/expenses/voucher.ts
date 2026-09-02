/**
 * What one expense voucher says about the category it belongs to.
 *
 * IT LIVES HERE AND NOT IN THE PAGE for ./tally.ts's reason: the figure below goes onto a
 * piece of paper somebody signs, and a sum nobody has run against a fixture is a sum nobody
 * has checked. The page renders; this file adds up.
 *
 * WHAT IT IS FOR is the duplicate the spending screen already tries to catch — "the list
 * underneath is what turns a form into a record: it is how they check that the rent is not on
 * there twice". A voucher is printed at the moment the money leaves, in front of whoever is
 * taking it, and a line reading "rent this month, up to this voucher — 2 entries" is that
 * check on the paper rather than on a screen the owner has to think to open.
 *
 * AS OF THIS VOUCHER, NEVER AS OF NOW, which is ../payroll/slip.ts's decision and matters
 * for the same reason: a voucher reprinted in December has to say what it said in March, or
 * the person holding the original is right and the paper is wrong.
 *
 * ORDERED BY VOUCHER NUMBER ALONE, which is where this parts company with a payslip.
 * `salary_payments` carries `paid_at timestamptz` and has to be ordered by it, because two
 * salaries can be handed over in the same second. An expense carries `spent_on date`, which
 * an owner may backdate — last month's electricity bill entered in January is ordinary, and
 * 20260811000045's floor on `spent_on` exists to allow it. Ordering by a date somebody can
 * choose would let a row entered afterwards change what an earlier voucher's paper says. The
 * voucher series cannot be chosen: it is assigned by a trigger under an advisory lock and is
 * unique per centre, so `voucher_no <= mine` is a total order with no tie to break, and it
 * means what the freeze needs it to mean — everything that had been written down when this
 * slip was printed.
 *
 * It can be frozen at all only because `expenses` is append-only: that migration revokes
 * DELETE and grants UPDATE on `(reference, note, recurring)` alone, so no amount behind this
 * total can change afterwards.
 *
 * Relative imports with the extension, like every other unit-tested module here: these tests
 * run under `node --test`, which resolves neither tsconfig paths nor extensionless specifiers.
 */
import { sumTaka } from '../money.ts'

/**
 * An `expenses` row as the voucher queries its siblings.
 *
 * `amount_bdt` admits null although the column is `not null`, for ../payroll/slip.ts's
 * reason: PostgREST serialises numeric as a string, and the cost of the guard is one
 * comparison against the cost of printing ৳0 for money that did leave the drawer.
 */
export type VoucherSourceRow = {
  voucher_no: number
  amount_bdt: string | number | null
}

/** The category's month up to and including this voucher. */
export type VoucherCategoryMonth = {
  /** Net for the category: corrections written against it already taken off. */
  spent: number
  /**
   * How many rows that is, this one included.
   *
   * The page draws the line only past one, which is what makes the ordinary case safe
   * rather than fudged: a category with one entry would print the voucher's own figure
   * twice under two labels, and that reads as a rendering fault.
   */
  entries: number
}

/**
 * The category's spending up to this voucher, or null when the siblings could not be read.
 *
 * Null rather than a total over an empty list, matching ../payroll/slip.ts: nought would
 * print "৳12,000 of ৳12,000 of rent this month" on the second rent voucher of a month, which
 * is the exact figure this line exists to contradict.
 *
 * A row whose amount will not parse is dropped rather than counted as nothing, and dropped
 * from the count as well as from the sum — "3 entries" over a total of two is a line an owner
 * would have to explain. Same rule as ./tally.ts, which it has to be: a voucher that
 * disagreed with the register it was printed from would be worse than one that said less.
 */
export function categoryUpTo(
  voucherNo: number,
  siblings: readonly VoucherSourceRow[] | null | undefined,
): VoucherCategoryMonth | null {
  if (siblings === null || siblings === undefined) return null

  const amounts: number[] = []
  for (const row of siblings) {
    if (row.voucher_no > voucherNo) continue
    const parsed = Number(row.amount_bdt)
    if (row.amount_bdt !== null && Number.isFinite(parsed)) amounts.push(parsed)
  }

  return { spent: sumTaka(amounts), entries: amounts.length }
}
