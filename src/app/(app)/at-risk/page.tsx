import Link from 'next/link'

import { Card } from '@/components/ui'
import { RiskList } from '@/components/risk-list'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { pageOrNull } from '@/lib/supabase/page'
import { studentsAtRisk, blindArms, RISK_COLUMNS } from '@/lib/students/risk'
import { addDays, todayInDhaka } from '@/lib/bd/time'
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
 * AND AN EMPTY LIST SAYS WHICH OF THE TWO EMPTINESSES IT IS. Each of the three
 * signals is built out of something the centre had to record, so a centre that has
 * not taken a register in a month produces no attendance signal for anybody — and
 * this screen used to answer that with "no student is showing a bad sign in any of
 * the three", which is a confident sentence about three things it did not look at.
 * The counts below say which of the three had anything in it, and the wording
 * follows. Kept on the screen even when the list is not empty, for the same reason
 * the invoice run reports who it skipped: a worklist of three names built from fees
 * alone is real, and so is the fact that nobody's attendance was read.
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

  /*
   * The windows the view reads in, restated here because these counts have to look
   * at the same span it does. Restated and not imported: they are prose in
   * `t.windows` already, on this very screen, and a footnote promising 30 days over
   * a count taken across 90 would be worse than either alone.
   */
  const today = todayInDhaka()
  const attendanceFrom = addDays(today, -30)
  const examsFrom = addDays(today, -120)

  const [data, sessions, exams, invoices] = await Promise.all([
    // Paged. One row per student with at least one signal, which stays under the
    // ceiling for a single centre and does not for a chain — and the students it would
    // drop are the ones this screen exists to name. `.order('student_id')` because the
    // view has no id of its own and that column is its key.
    pageOrNull((from, to) =>
      supabase
        .from('student_risk')
        .select(RISK_COLUMNS)
        .eq('coaching_center_id', session.active.centerId)
        .order('student_id')
        .range(from, to),
    ),
    // head: true, so none of the three brings a row back — the question is only
    // whether the centre has recorded anything for that signal to be built from.
    supabase
      .from('attendance_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .gt('session_date', attendanceFrom),
    supabase
      .from('exams')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .gt('exam_date', examsFrom),
    // Ever, and not inside a window: an unpaid bill from March is still unpaid
    // today, which is exactly what the fee signal fires on.
    supabase
      .from('fee_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId),
  ])

  const students = studentsAtRisk(data, t.noName)

  const blind = blindArms({
    sessions: sessions.count,
    exams: exams.count,
    invoices: invoices.count,
  })

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
        blind.length === 0 ? (
          // The good news, and the only screen it appears on. The dashboard card is
          // absent on a healthy month rather than showing this, because a card that
          // is usually empty is one an owner learns to skip past — but somebody who
          // navigated here deliberately is owed an answer rather than a blank page.
          //
          // Only reachable now when all three signals had something to read, which
          // is what makes "no bad sign in any of the three" a sentence this screen
          // is entitled to write.
          <Card>
            <p className="font-medium text-ink">{t.empty}</p>
            <p className="mt-1 text-sm text-ink-soft">{t.emptyHint}</p>
          </Card>
        ) : (
          // The same blank list, told the truth about. Not an error and not amber:
          // a centre in its first fortnight is meant to be here, and the three
          // lines below are the ordinary work that turns this screen on.
          <Card>
            <p className="font-medium text-ink">{t.notWatchingYet}</p>
            <p className="mt-1 text-sm text-ink-soft">{t.notWatchingYetHint}</p>
            <ul className="mt-3 flex flex-col gap-1.5 text-sm text-ink-soft">
              {blind.map((arm) => (
                <li key={arm}>· {t.blind[arm]}</li>
              ))}
            </ul>
          </Card>
        )
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

      {/* And what the list could not see, in the same footnote voice, under a list
          that does have names on it. The empty state above says this at full volume
          because there it is the whole message; here the names are the message and
          this is the asterisk on them. The same sentences either way — two wordings
          for one fact is two things to keep true. */}
      {students.length > 0 && blind.length > 0 && (
        <p className="text-xs text-ink-faint">
          {blind.map((arm) => t.blind[arm]).join(' ')}
        </p>
      )}
    </div>
  )
}
