import Link from 'next/link'

import { Card } from '@/components/ui'
import { RiskList } from '@/components/risk-list'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { studentsAtRisk, RISK_COLUMNS } from '@/lib/students/risk'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return {
    title: `${dict(session?.locale ?? DEFAULT_LOCALE).risk.title} — CoachDesk`,
  }
}

/**
 * Everyone who is drifting away, with the reason under each name.
 *
 * The dashboard card is the alarm and this is the room behind it: the same rows in
 * the same order and the same words, without the top-three cut. An owner comes
 * here after seeing "+7" and works down the list making calls, so the page is a
 * list and nothing else — no filters, no date range, no way to sort it differently.
 * The order is already the order to work in, and every control offered here would
 * be a way to arrive at a worse one.
 *
 * There is no dismiss button either, and that is a decision rather than an
 * omission. A student stops being on this list when their attendance, marks or fee
 * changes — which is the point — and a "resolved" tick would let a list go quiet
 * while the child kept missing class. The honest way to clear a name is to fix the
 * thing under it.
 *
 * Staff-admin only, as `student_risk` enforces underneath: the aggregate read by a
 * teacher would be their own batches' share of each student wearing the whole
 * picture's name. A role gate, not a plan gate — a solo teacher on the free plan
 * owns their centre and gets this screen exactly as a 300-student centre does.
 */
export default async function AtRiskPage() {
  const session = await pageRole('manager')
  const supabase = await createClient()
  const d = dict(session.locale)
  const t = d.risk

  const { data } = await supabase
    .from('student_risk')
    .select(RISK_COLUMNS)
    .eq('coaching_center_id', session.active.centerId)

  const students = studentsAtRisk(data, t.noName)

  return (
    <div className="flex flex-col gap-4">
      <div>
        {/* At the top and labelled with where it goes, like every other back link
            in the app. This page is only reachable from the dashboard card, so the
            destination is not a guess. */}
        <Link
          href="/dashboard"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.dashboard.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{t.lead}</p>
      </div>

      {students.length === 0 ? (
        // The good news, and the only screen it appears on. The dashboard card is
        // absent on a healthy month rather than showing this, because a card that
        // is usually empty is one an owner learns to skip past — but somebody who
        // navigated here deliberately is owed an answer rather than a blank page.
        <Card>
          <p className="font-medium text-ink">{t.empty}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.emptyHint}</p>
        </Card>
      ) : (
        <>
          <p className="num text-sm text-ink-soft">
            {students.length} {t.count(students.length)}
          </p>
          <Card>
            <RiskList students={students} t={t} />
          </Card>
        </>
      )}

      {/* The windows, stated once and at the bottom. An owner reading "Attendance
          dropped · 55%" needs to know what span that covers before they quote it to
          a guardian, and it is the same span on every row, so it is a footnote
          rather than a repetition. */}
      <p className="text-xs text-ink-faint">{t.windows}</p>
    </div>
  )
}
