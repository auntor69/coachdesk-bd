import { createClient } from '@/lib/supabase/server'
import { pageAll } from '@/lib/supabase/page'
import {
  PROGRESS_COUNT_COLUMNS,
  progressToTell,
  type ProgressCountRow,
} from '@/lib/students/progress'
import type { Dictionary } from '@/lib/i18n'

import { ProgressEntry } from './progress-entry'

/**
 * The door to the weekly notes, with the count it carries.
 *
 * WHY IT STREAMS TOO, when it is a small card. The read behind it is not small:
 * `student_progress_week` is a seven-day aggregate over the centre's attendance and exam
 * rows, measured at ~0.75 s at 150 students (audit §2.2) — which makes it the slowest thing
 * left in the page's own `Promise.all` once the rates and risk cards moved out. A route
 * flushes when its last blocking await returns, so leaving this one in would have kept
 * first paint at three-quarters of a second for a card that says a number.
 *
 * The alternative — asking for a count instead of the rows — was the audit's own #4 and it
 * is **wrong** (§5.1): `progressToTell` decides each row rather than counting it, reading
 * `sessions_counted`, `guardian_phone` and `last_sent_at` to work out which families are
 * actually ready to be told. So the rows stay, and the cost moves off the critical path
 * instead of being removed.
 *
 * ALWAYS DRAWS, unlike the other two streamed blocks: zero families to tell today is a real
 * answer and the door says so. `null` means the read did not arrive, and the card is written
 * to withhold the number rather than read it as nobody — see its own note.
 */
export async function ProgressBlock({
  centerId,
  t,
}: {
  centerId: string
  /** `Dictionary['progress']`, passed whole because the card takes the group. */
  t: Dictionary['progress']
}) {
  const supabase = await createClient()

  const weekly = await pageAll<ProgressCountRow>((from, to) =>
    supabase
      .from('student_progress_week')
      .select(PROGRESS_COUNT_COLUMNS)
      .eq('coaching_center_id', centerId)
      .order('student_id')
      .range(from, to),
  )

  const toTell = 'rows' in weekly ? progressToTell(weekly.rows) : null

  return <ProgressEntry toTell={toTell} t={t} />
}
