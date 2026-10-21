import { createClient } from '@/lib/supabase/server'
import { pageOrNull } from '@/lib/supabase/page'
import { RISK_COLUMNS, studentsAtRisk } from '@/lib/students/risk'
import type { Dictionary } from '@/lib/i18n'

import { AtRiskCard } from './at-risk-card'

/**
 * Who is drifting away, fetched behind the boundary that draws it.
 *
 * THE SLOWEST READ ON THE DASHBOARD, and the reason §5.7 exists. `student_risk` measured
 * 2.24 s at 250 students — a full pass over the centre's attendance and a fee arm that
 * compared every student against every invoice (audit §2.2b, §4.1) — and the page was
 * awaiting it before it could paint the outstanding figure, which costs a tenth of that.
 * The card is a *worklist*: the reader finds out somebody is drifting, then opens /at-risk.
 * It has no business holding the arrears number hostage.
 *
 * STILL PAGED, and still every row. The heading's count has to be the real one — "3
 * students" over the three that fit, when eleven are flagged, is the card lying about the
 * size of the problem — so `pageOrNull` stays exactly as it was. What changed is *when*
 * that read is allowed to cost something.
 *
 * NULL WHEN NOBODY IS FLAGGED, which is the ordinary state of a healthy centre, and the
 * page's wrapper hides itself rather than leaving a gap (see `[&:empty]:hidden` there).
 * A failed read is the same answer here, deliberately: this card is drawn only when
 * somebody is drifting, so a read that did not arrive takes the card off the page instead
 * of putting a wrong number on it, and the claim itself is made on /at-risk, in a
 * sentence, on a screen that refuses rather than guessing.
 */
export async function RiskBlock({
  centerId,
  noName,
  view,
  t,
}: {
  centerId: string
  /** `risk.noName`, in the reader's language — a row with no name still gets a link. */
  noName: string
  /** `common.view`, borrowed by `AtRiskCard` for its own door. */
  view: string
  /** `Dictionary['risk']`. */
  t: Dictionary['risk']
}) {
  const supabase = await createClient()

  const risky = await pageOrNull((from, to) =>
    supabase
      .from('student_risk')
      .select(RISK_COLUMNS)
      .eq('coaching_center_id', centerId)
      .order('student_id')
      .range(from, to),
  )

  const atRisk = studentsAtRisk(risky, noName)

  if (atRisk.length === 0) return null

  return <AtRiskCard students={atRisk} view={view} t={t} />
}
