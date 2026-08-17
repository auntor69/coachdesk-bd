import { Card } from '@/components/ui'
import { formatMonth } from '@/lib/bd/time'
import type { BatchRate } from '@/lib/attendance/rates'

/**
 * Bands for the judgement, and a word for each one.
 *
 * The word is not decoration. The house rule in globals.css is that present /
 * absent / late colour never travels alone, because red-green colour blindness
 * is about 8% of men, and the same applies to a green 91% next to a red 58%.
 * The number carries the fact and the word carries the reading of it.
 *
 * The thresholds are a judgement with no data behind them yet — 85 and 70 are
 * where a Dhaka centre owner's own language lands, and the honest place to
 * revisit them is after the first few centres are running. Nothing depends on
 * them being exactly right: the number is always on the row.
 */
const BANDS = [
  { min: 85, word: 'ভালো', text: 'text-present', bar: 'bg-present' },
  { min: 70, word: 'মাঝারি', text: 'text-late', bar: 'bg-late' },
  { min: 0, word: 'কম', text: 'text-absent', bar: 'bg-absent' },
] as const

function bandFor(ratePct: number) {
  return BANDS.find((b) => ratePct >= b.min) ?? BANDS[BANDS.length - 1]
}

/**
 * Attendance rate per batch — the third number on the owner's dashboard, and the
 * one that earns the renewal.
 *
 * Collected and outstanding are why a centre buys this; they are visible from day
 * one and a paper receipt book can almost produce them. This is what a paper
 * register cannot produce at all: at the end of a month, that Bio Morning ran at
 * 91% and Chem Evening at 62%. It is the answer to "why did I type the register
 * into a phone every day", and an owner who has seen it once has a reason to
 * still be here next month.
 *
 * Ordered worst first, which is not how the batches are listed anywhere else in
 * the app. An owner reads two rows of this card and stops; those two rows have to
 * be the two batches worth a conversation. Batches with no rate at all sink to
 * the bottom — an unmeasured batch is not a failing one.
 *
 * Staff-admin only, and gated by the caller as well as by the view's own
 * predicate. A teacher reading this aggregate would get a number assembled from
 * only the batches they teach under the same column name; see the migration.
 */
export function AttendanceRates({
  month,
  rows,
  isCurrentMonth,
}: {
  /** YYYY-MM-01, the month these rows actually describe. */
  month: string
  rows: BatchRate[]
  /**
   * False when the current month has no marks yet and last month's is being
   * shown instead. On the 1st of a month the card would otherwise be empty on
   * precisely the days an owner is thinking hardest about the month just closed.
   */
  isCurrentMonth: boolean
}) {
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-ink">ব্যাচভিত্তিক হাজিরা</h2>
        <p className="shrink-0 text-sm text-ink-faint">{formatMonth(month)}</p>
      </div>
      {!isCurrentMonth && (
        <p className="mt-0.5 text-sm text-ink-soft">
          এ মাসে এখনো হাজিরা নেওয়া হয়নি — গত মাসের হিসাব দেখানো হচ্ছে
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((row) => (
          <Rate key={row.batchId} {...row} />
        ))}
      </ul>
    </Card>
  )
}

/**
 * One batch's row: the name, the rate, the reading of it, and what it rests on.
 *
 * The bar is redundant with the number by design — it is the channel that works
 * while scrolling past at arm's length, and it is aria-hidden because a screen
 * reader already has the figure in words two elements earlier.
 */
function Rate({ batchName, ratePct, counted, sessions }: BatchRate) {
  // Unused when there is no rate, and computed unconditionally so the render
  // below stays free of non-null assertions.
  const band = bandFor(ratePct ?? 0)

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate font-medium text-ink">{batchName}</p>
        <p className="shrink-0">
          {ratePct === null ? (
            <span className="text-ink-faint">হিসাব নেই</span>
          ) : (
            <>
              <span className={`num font-bold ${band.text}`}>{ratePct}%</span>
              <span className="ml-2 text-sm text-ink-soft">{band.word}</span>
            </>
          )}
        </p>
      </div>

      {ratePct !== null && (
        // The empty track is what says a measurement exists, so a 0% is a full
        // track with no fill rather than nothing at all — the same distinction
        // the view draws between 0 and null, kept in the pixels.
        <div
          aria-hidden
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-alt"
        >
          <div
            className={`h-full rounded-full ${band.bar}`}
            style={{ width: `${ratePct}%` }}
          />
        </div>
      )}

      <p className="mt-1 text-xs text-ink-faint">
        <span className="num">{sessions}</span> দিন ক্লাস ·{' '}
        {ratePct === null ? (
          'সব ছুটি মঞ্জুর করা'
        ) : (
          <>
            <span className="num">{counted}</span> হাজিরার হিসাব
          </>
        )}
      </p>
    </li>
  )
}

