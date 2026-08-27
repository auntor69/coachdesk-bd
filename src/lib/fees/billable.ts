/**
 * Which enrolments a month's invoices are actually raised against.
 *
 * Pulled out of generateInvoices and left pure, because this is the one decision on
 * the fee board that a person cannot check afterwards. A bill that should not have
 * gone out has already reached a parent by the time anybody reads the board, and the
 * owner's version of "undo" is a phone call apologising for it.
 *
 * Three reasons an active enrolment is not billed:
 *
 *   * the batch is priced at zero — a trial week or a scholarship, and ৳0 landing on
 *     a family's phone is worse than nothing landing;
 *   * the batch has stopped running — every other read of `batches` in the product
 *     filters `active`, so a closed batch is already gone from the register and the
 *     settings count, and billing is the last place that had not caught up;
 *   * the fee is unreadable. `numeric` arrives as a string over the wire, so a null
 *     or a malformed value becomes NaN here rather than at the arithmetic.
 *
 * The embed is typed loosely on purpose: supabase-js hands back an object for a
 * to-one relationship and an array for the same shape in other positions, and the
 * caller should not have to care which it got this time.
 *
 * ONE OF THE THREE IS AN ACCIDENT, AND IT IS COUNTED SEPARATELY. A closed batch is a
 * decision somebody made and a missing embed is a race; neither is worth a word on
 * screen. A batch left at no price is different — it is the one silent way a month's
 * billing can come out a third short. The owner taps Generate, reads "42 invoices
 * created", and the thirty students in the batch nobody priced are simply not on the
 * board: no error, no empty row, nothing to notice until a parent says they were
 * never billed. `unpricedStudents` is the number that sentence needs, and it shares
 * `verdictFor` with the billing itself so the two can never disagree about which
 * enrolments were left out.
 */

/** One row as the enrolment query returns it, batch embed and all. */
export type EnrollmentRow = {
  id: string
  student_id: string
  batches:
    | { monthly_fee_bdt: number | string | null; active: boolean | null }
    | { monthly_fee_bdt: number | string | null; active: boolean | null }[]
    | null
}

/** One line of the upsert: what to bill, for whom, and for how much. */
export type Billable = {
  enrollmentId: string
  studentId: string
  fee: number
}

/**
 * Whether one enrolment can be billed this month, and if not, which of the three
 * reasons it was.
 *
 * The single place the decision is made. Both exports below read it rather than
 * re-testing the fee themselves, because a count of what was left out that disagreed
 * with what was left out is worse than no count at all.
 */
function verdictFor(
  row: EnrollmentRow,
):
  | { billable: true; fee: number }
  | { billable: false; reason: 'no-batch' | 'closed' | 'unpriced' } {
  const batch = Array.isArray(row.batches) ? row.batches[0] : row.batches
  // A missing embed means the batch was deleted between the read and here, or RLS
  // hid it. Either way there is no price, so there is no bill.
  if (!batch) return { billable: false, reason: 'no-batch' }
  if (batch.active !== true) return { billable: false, reason: 'closed' }

  const fee = Number(batch.monthly_fee_bdt ?? 0)
  if (!Number.isFinite(fee) || fee <= 0) return { billable: false, reason: 'unpriced' }

  return { billable: true, fee }
}

export function billableEnrollments(rows: readonly EnrollmentRow[]): Billable[] {
  const out: Billable[] = []

  for (const row of rows) {
    const verdict = verdictFor(row)
    if (!verdict.billable) continue
    out.push({ enrollmentId: row.id, studentId: row.student_id, fee: verdict.fee })
  }

  return out
}

/**
 * How many students this month's billing could not bill because nobody set a price.
 *
 * Students, not enrolments, and only students who got nothing at all: somebody in a
 * priced batch and an unpriced one has been billed, and putting them in a warning
 * would send an owner looking for a bill that exists. The set subtraction at the end
 * is what says that.
 *
 * Only `unpriced` counts. A closed batch is not an oversight and a vanished embed is
 * not something an owner can act on — see the note at the top of this file.
 */
export function unpricedStudents(rows: readonly EnrollmentRow[]): number {
  const billed = new Set<string>()
  const unpriced = new Set<string>()

  for (const row of rows) {
    const verdict = verdictFor(row)
    if (verdict.billable) billed.add(row.student_id)
    else if (verdict.reason === 'unpriced') unpriced.add(row.student_id)
  }

  for (const id of billed) unpriced.delete(id)

  return unpriced.size
}
