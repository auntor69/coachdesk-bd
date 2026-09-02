/**
 * What one payslip says about the month it belongs to.
 *
 * IT LIVES HERE AND NOT IN THE PAGE for ./month.ts's reason: the figure below goes onto a
 * piece of paper that leaves the building, and a sum nobody has run against a fixture is a
 * sum nobody has checked. The page renders; this file adds up.
 *
 * AS OF THIS VOUCHER, NEVER AS OF NOW, which is the fee receipt's decision about its own
 * balance line and matters for the same reason: a slip reprinted in December has to say what
 * it said in March, or the employee holding the original is right and the paper is wrong. So
 * the figure is every payment for that person and that month up to and including this
 * voucher, in the order the money actually moved.
 *
 * It can be frozen at all only because `salary_payments` is append-only — 20260811000044
 * revokes DELETE and grants UPDATE on `(reference, note)` alone — so the rows behind this
 * total cannot change afterwards. The agreed salary is deliberately not part of it: terms
 * change, which is why that migration copies the breakdown onto the payment row instead of
 * joining it.
 *
 * Relative imports with the extension, like every other unit-tested module here: these tests
 * run under `node --test`, which resolves neither tsconfig paths nor extensionless specifiers.
 */
import { sumTaka } from '../money.ts'

/**
 * A `salary_payments` row as the payslip queries its siblings.
 *
 * `amount_bdt` is `string | number | null` for ./month.ts's two reasons at once: PostgREST
 * serialises numeric as a string, and a generated column is nullable in the generated types
 * even though the database will never produce a null in it.
 */
export type SlipSourceRow = {
  voucher_no: number
  amount_bdt: string | number | null
  paid_at: string
}

/** The slip being printed, which is one of the rows it is measured against. */
export type SlipOwnRow = {
  voucherNo: number
  paidAt: string
}

export type SlipMonth = {
  /** Handed over for this month up to and including this voucher, corrections netted. */
  paid: number
  /**
   * How many rows that is, this one included.
   *
   * The page draws the total only past one, and that is what makes every degenerate case
   * safe rather than fudged: a single-payment month would otherwise print the slip's own
   * figure twice under two different labels, which reads as a rendering fault.
   */
  payments: number
}

/**
 * The month up to this voucher, or null when the siblings could not be read.
 *
 * Null rather than a total over an empty list, which is the same call ./month.ts makes about
 * a dropped payments read and for a sharper reason here: nought would print "৳6,500 of
 * ৳6,500 this month" on the slip of somebody who has had two instalments, on paper, in the
 * hand of the person it is wrong about.
 *
 * Ordered by `paid_at`, with the voucher number breaking a tie — the fee receipt's rule.
 * `paid_at` is when the money moved and is what somebody would reconstruct from memory;
 * `voucher_no` settles two salaries handed over in the same second and cannot be relied on
 * alone, because the register is ordered by the day the money left the drawer.
 *
 * A row whose amount will not parse is dropped rather than counted as nothing, matching
 * ./month.ts — it has to be the same rule in both places, or a slip would disagree with the
 * register it was printed from.
 */
export function monthUpTo(
  slip: SlipOwnRow,
  siblings: readonly SlipSourceRow[] | null | undefined,
): SlipMonth | null {
  if (siblings === null || siblings === undefined) return null

  const upToHere = siblings.filter(
    (row) =>
      row.paid_at < slip.paidAt
      || (row.paid_at === slip.paidAt && row.voucher_no <= slip.voucherNo),
  )

  const amounts: number[] = []
  for (const row of upToHere) {
    const parsed = Number(row.amount_bdt)
    if (row.amount_bdt !== null && Number.isFinite(parsed)) amounts.push(parsed)
  }

  return { paid: sumTaka(amounts), payments: amounts.length }
}

/** What the four copied columns come to, as the paper reads them. */
export type SlipBreakdown = {
  basic: number
  allowances: number
  other: number
  deductions: number
  /** basic + allowances + other, the database's own `gross_bdt`. */
  gross: number
  /**
   * Whether the breakdown is worth printing at all.
   *
   * False for a salary recorded in simple mode, where `basic` is the whole of it and a
   * breakdown block would be the same figure twice under two labels — and false for a
   * reversing row for the same arithmetic reason, which is the case that makes this a rule
   * rather than a nicety.
   */
  itemised: boolean
}

/**
 * The four columns of a payment, as figures.
 *
 * All four may be negative: `salary_payments` carries no sign check on purpose, because the
 * only honest way to undo a payment is a row that reverses it. The single thing the table
 * refuses is a net of nothing.
 */
export function slipBreakdown(row: {
  basic_bdt: string | number | null
  allowances_bdt: string | number | null
  other_bdt: string | number | null
  deductions_bdt: string | number | null
}): SlipBreakdown {
  const part = (value: string | number | null) => {
    const parsed = Number(value)
    return value !== null && Number.isFinite(parsed) ? parsed : 0
  }

  const basic = part(row.basic_bdt)
  const allowances = part(row.allowances_bdt)
  const other = part(row.other_bdt)
  const deductions = part(row.deductions_bdt)

  return {
    basic,
    allowances,
    other,
    deductions,
    gross: sumTaka([basic, allowances, other]),
    itemised: allowances !== 0 || other !== 0 || deductions !== 0,
  }
}
