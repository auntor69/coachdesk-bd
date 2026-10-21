import Link from 'next/link'

import { Card } from '@/components/ui'
import { RiskList } from '@/components/risk-list'
import type { RiskStudent } from '@/lib/students/risk'
import type { Dictionary } from '@/lib/i18n'

/** How many fit on a phone before the card becomes the page. */
const SHOWN = 3

/**
 * Who is drifting away — the masterplan's early warning, on the owner's home screen.
 *
 * The card exists rather than only the page because nobody opens a screen to find
 * out whether they need to open it. A student leaves over about six weeks and the
 * whole feature is worth nothing if the owner has to remember to go looking, so
 * the three loudest names are on the screen they open several times a day, and the
 * page behind it holds the rest.
 *
 * Rendered only when somebody is flagged. An empty version of this card would
 * appear on most days of most months, and a card that is usually empty is a card
 * an owner learns to skip — which is the one thing that would break it. The good
 * news lives on the /at-risk page, where somebody went looking for it.
 *
 * Staff-admin only, gated by the caller as well as by the view's own predicate.
 * Note that this is a role gate and not a plan gate: a solo teacher on the free
 * plan owns their centre, so they get this card exactly as a 300-student centre
 * does. See the migration's own note.
 */
export function AtRiskCard({
  students,
  view,
  t,
}: {
  /** Already worst-first from `studentsAtRisk`; this only takes the top few. */
  students: RiskStudent[]
  /**
   * `common.view`, for the case where the card is already showing everybody. A
   * plain string because it is one word borrowed from another group — the same way
   * this page borrows `fees.yoursOnly` and `common.seeAll` — and threading two
   * dictionary groups into a card for one label would be worse.
   */
  view: string
  /**
   * `Dictionary['risk']`, not `T<'risk'>` — a server component, and the group has
   * function leaves for the counts English inflects on.
   */
  t: Dictionary['risk']
}) {
  const hidden = students.length - SHOWN

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-ink">{t.title}</h2>
        {/* `.num` on the paragraph rather than a span around the count, the way
            the fee board carries its own count: it touches only the digit and
            leaves the Bangla words alone. */}
        <p className="num shrink-0 text-sm text-ink-soft">
          {students.length} {t.count(students.length)}
        </p>
      </div>

      <div className="mt-3">
        <RiskList students={students.slice(0, SHOWN)} t={t} />
      </div>

      {/* Always a way through to the page, and the label says which trip it is.
          "See everyone" over a list that was already everyone is a link an owner
          taps once and stops believing, so when nothing is hidden this is the same
          plain "View →" the attendance card uses. */}
      {/* The same 44px-that-costs-no-height trick as the overdue card's "see all": the
          padding is the target and the negative margin puts the card's foot back. */}
      <Link
        href="/at-risk"
        className="num -mb-3 mt-3 inline-flex items-center py-3 text-sm font-medium
          text-brand-700"
      >
        {hidden > 0 ? `${t.seeAll} (+${hidden})` : `${view} →`}
      </Link>
    </Card>
  )
}
