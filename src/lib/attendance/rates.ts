/**
 * Turning the attendance-rate view's rows into the card the owner reads.
 *
 * Two decisions live here rather than in the page, because both are the kind
 * that invert silently and neither is visible in a screenshot: which month the
 * card describes, and what order the batches come in. A comparator that sorts
 * nulls to the top puts the one batch with nothing to measure above the one that
 * ran at 41%, and the page still renders perfectly.
 *
 * Relative import with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */
import { addMonths } from '../bd/time.ts'

/**
 * One row of batch_attendance_monthly as PostgREST hands it back. Every column
 * of a view is nullable in the generated types, so the nulls are real here even
 * though the view only ever writes null into rate_pct.
 */
export type RateRow = {
  batch_id: string | null
  batch_name: string | null
  period_month: string | null
  sessions: number | null
  counted: number | null
  rate_pct: number | null
}

/** One batch's month, ready to render. */
export type BatchRate = {
  batchId: string
  batchName: string
  /**
   * Null when every mark in the month was 'excused' — not 0. See the long note
   * in 20260811000011_attendance_rate.sql: a batch nobody attended and a batch
   * with nothing to measure are opposite pieces of news.
   */
  ratePct: number | null
  /**
   * The marks in the denominator. A 91% built from four marks and a 91% built
   * from six hundred are not the same claim, so the card prints this under every
   * rate.
   */
  counted: number
  sessions: number
}

export type DashboardRates = {
  /** The month the rows actually describe, YYYY-MM-01. */
  month: string
  /** Empty when neither month has a single mark in it. */
  rates: BatchRate[]
}

/**
 * The month to show and the batches in it, worst first.
 *
 * `rows` is expected to cover `period` and the month before it, and the current
 * month wins whenever it has anything at all in it. The fallback exists because
 * a month is not a report that arrives finished: on the 1st and 2nd there is
 * almost nothing marked yet, and a card that reads empty on those days is empty
 * exactly when an owner is thinking hardest about the month that just closed.
 * Mid-month it never fires, and the card silently becomes the running total of
 * the month in progress — the same thing "এ মাসে আদায়" already does two cards up.
 *
 * Worst first, which is not how batches are ordered anywhere else in the app. An
 * owner reads two rows of this card and stops, so those two rows have to be the
 * two batches worth a conversation. Batches with no rate sink to the bottom: an
 * unmeasured batch is not a failing one, and putting it above a real 41% would
 * cost the card the one job it has.
 *
 * Ties keep the order the view returned them in, which is unspecified — two
 * batches at the same rate are equally worth reading and inventing a second key
 * to separate them would be a decision pretending to be arithmetic.
 */
export function ratesForDashboard(
  rows: RateRow[] | null | undefined,
  period: string,
): DashboardRates {
  const all = rows ?? []
  const thisMonth = all.filter((r) => r.period_month === period)
  const month = thisMonth.length > 0 ? period : addMonths(period, -1)
  const chosen = thisMonth.length > 0 ? thisMonth : all.filter((r) => r.period_month === month)

  const rates = chosen
    .map((r) => ({
      batchId: r.batch_id ?? '',
      // Unreachable through the view — batches.name is not null — but the
      // generated type says otherwise and a card headed "undefined" is worse
      // than a card headed with a word.
      batchName: r.batch_name ?? 'অজানা ব্যাচ',
      ratePct: r.rate_pct,
      counted: r.counted ?? 0,
      sessions: r.sessions ?? 0,
    }))
    .sort((a, b) => {
      if (a.ratePct === null) return b.ratePct === null ? 0 : 1
      if (b.ratePct === null) return -1
      return a.ratePct - b.ratePct
    })

  return { month, rates }
}
