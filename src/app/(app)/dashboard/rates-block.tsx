import { createClient } from '@/lib/supabase/server'
import { addMonths } from '@/lib/bd/time'
import { ratesForDashboard } from '@/lib/attendance/rates'
import type { Dictionary } from '@/lib/i18n'
import type { Locale } from '@/lib/i18n/locale'

import { AttendanceRates } from './attendance-rates'

/**
 * The rate card, with the aggregate it draws, fetched where it is drawn.
 *
 * WHY THIS IS A SEPARATE COMPONENT AND NOT A QUERY IN `page.tsx`. The dashboard used to
 * await seventeen reads before it returned its first byte, and three of them are
 * aggregates over the centre's whole history: `batch_attendance_monthly` measured 0.7–1.2 s
 * at 250 students against ~150 ms for everything around it. A page that waits for its
 * slowest read to draw its fastest one is a page that feels slow for a reason nobody can
 * see — which is what `docs/PERFORMANCE-AUDIT.md` §4.1 measured and §5.7 is about.
 *
 * Behind a `<Suspense>` boundary the arrangement inverts: the page's own figures — what is
 * owed, who to chase, whether the registers are in — stream on the first flush, and this
 * card arrives when its aggregate does. Nothing is fetched twice and nothing is cached;
 * React simply stops blocking the shell on it.
 *
 * THE QUERY IS COPIED, NOT RE-DERIVED. Same columns, same two months, same `batch_active`
 * filter, same reason: a card that asked its own question would be a second definition of
 * "the attendance rate this month" and the two would eventually disagree (the argument
 * `PROGRESS_COUNT_COLUMNS` and `RISK_COLUMNS` both make). Moving it here is the whole
 * change — if the card ever needs a different slice, `ratesForDashboard` is where that
 * decision belongs, and it is already the tested one.
 *
 * NULL, NOT AN EMPTY CARD. The page's own gate used to be `batchRates.length > 0`, and a
 * centre that has never taken a register gets no card rather than one explaining its own
 * emptiness — the "today's attendance" line directly above it already says nothing has
 * been taken. The wrapper in `page.tsx` carries `[&:empty]:hidden` for exactly this case,
 * so a centre with no rates keeps the page it had rather than a gap where a card is not.
 */
export async function RatesBlock({
  centerId,
  period,
  locale,
  t,
}: {
  /** The reader's active centre. Passed rather than re-read: the page already has it, and
   *  `getSession` is memoised per request, so this costs nothing either way. */
  centerId: string
  /** The current period month, `YYYY-MM-01` — the month the page is about. */
  period: string
  locale: Locale
  /** `Dictionary['dashboard']`, because `AttendanceRates` takes the group itself. */
  t: Dictionary['dashboard']
}) {
  const supabase = await createClient()

  const { data: rates } = await supabase
    .from('batch_attendance_monthly')
    .select('batch_id, batch_name, period_month, sessions, counted, rate_pct')
    .eq('coaching_center_id', centerId)
    .eq('batch_active', true)
    .in('period_month', [period, addMonths(period, -1)])

  const { month, rates: batchRates } = ratesForDashboard(rates, period, t.unknownBatch)

  if (batchRates.length === 0) return null

  return (
    <AttendanceRates
      month={month}
      rows={batchRates}
      isCurrentMonth={month === period}
      locale={locale}
      t={t}
    />
  )
}
