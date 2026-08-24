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

export function billableEnrollments(rows: readonly EnrollmentRow[]): Billable[] {
  const out: Billable[] = []

  for (const row of rows) {
    const batch = Array.isArray(row.batches) ? row.batches[0] : row.batches
    // A missing embed means the batch was deleted between the read and here, or RLS
    // hid it. Either way there is no price, so there is no bill.
    if (!batch) continue
    if (batch.active !== true) continue

    const fee = Number(batch.monthly_fee_bdt ?? 0)
    if (!Number.isFinite(fee) || fee <= 0) continue

    out.push({ enrollmentId: row.id, studentId: row.student_id, fee })
  }

  return out
}
