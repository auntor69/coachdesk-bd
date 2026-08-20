import { Card } from '@/components/ui'
import { greetingFor } from '@/components/app-shell'
import { pageCenter, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatDate, todayInDhaka } from '@/lib/bd/time'
import { formatTaka, tallyOutstanding } from '@/lib/money'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'

/** getSession, not pageCenter — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).me.title} — CoachDesk` }
}

/**
 * What a student or guardian sees.
 *
 * RLS already restricts every table below to this person's own records — a
 * student sees themselves, a guardian sees their children — so there is no
 * student_id filter here. If a filter were the only thing separating one
 * family's data from another's, a typo would be a breach.
 *
 * The coaching_center_id filters are not that, and they are not defence in depth
 * either. A guardian with a child at two centres is a member of both, so RLS
 * answers for both — correctly — and this screen is showing one of them, named at
 * the top. Without the filter it would list the other centre's child under this
 * centre's name and add both bills into one total.
 */
export default async function MePage() {
  const session = await pageCenter()
  const supabase = await createClient()
  const today = todayInDhaka()
  const locale = session.locale
  const d = dict(locale)
  const t = d.me

  const [{ data: students }, { data: balances }, { data: results }] =
    await Promise.all([
      supabase
        .from('students')
        .select('id, name, class_level, institution')
        .eq('coaching_center_id', session.active.centerId),
      /*
       * The balance comes from the view, not from invoices minus payments here.
       * Two reasons, and the second is the one that bites: numeric(10,2) arriving
       * as a JS float cannot represent 0.10, so a paid-in-full invoice can leave a
       * remainder of about 2e-13 — which is greater than zero. This screen would
       * then tell a parent they owe ৳0 *and* withhold the "all paid" card. The
       * subtraction belongs where the numerics are exact. See lib/money's header.
       */
      supabase
        .from('fee_invoice_balances')
        .select('student_id, due_date, remaining_bdt')
        .eq('coaching_center_id', session.active.centerId)
        .is('voided_at', null),
      supabase
        .from('exam_results')
        .select('id, obtained_marks, is_absent, exams (title, total_marks, exam_date)')
        .eq('coaching_center_id', session.active.centerId)
        .order('created_at', { ascending: false })
        .limit(5),
    ])

  /*
   * Unpaid *and* overpaid, unlike the old version which dropped everything at or
   * below zero. A family that handed over 1600 against a 1500 bill has a credit
   * sitting on the invoice, and the only screen they can see it on is this one.
   */
  const rows = (balances ?? []).map((row) => ({
    studentId: row.student_id,
    dueDate: row.due_date,
    remaining: row.remaining_bdt ?? 0,
  }))

  // Grand total across every child, for the all-paid card. tallyOutstanding, not
  // a sum: a credit on one child must not pay off a debt on another.
  const { outstanding: totalDue } = tallyOutstanding(rows.map((r) => r.remaining))

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">{greetingFor(session)}</h1>
        <p className="mt-1 text-ink-soft">{session.active.centerName}</p>
      </div>

      {(students ?? []).map((student) => {
        const mine = rows.filter((r) => r.studentId === student.id)
        const { outstanding, credit } = tallyOutstanding(mine.map((r) => r.remaining))
        // Only a row still owing money can be late. A credited invoice whose due
        // date has passed is settled, and saying otherwise would send a parent to
        // the centre over a bill they already paid.
        const late = mine.some((r) => r.remaining > 0 && r.dueDate !== null && r.dueDate < today)

        return (
          <Card key={student.id}>
            <p className="font-semibold text-ink">{student.name}</p>
            {(student.class_level || student.institution) && (
              <p className="mt-0.5 text-sm text-ink-soft">
                {[student.class_level, student.institution].filter(Boolean).join(' · ')}
              </p>
            )}
            {outstanding > 0 && (
              <p className="mt-3 text-sm">
                <span className="font-medium text-absent">
                  {t.due} <span className="num">{formatTaka(outstanding)}</span>
                </span>
                {late && <span className="text-ink-soft"> · {t.overdue}</span>}
              </p>
            )}
            {credit > 0 && (
              <p className="mt-3 text-sm text-brand-800">
                <span className="num font-semibold">{formatTaka(credit)}</span>{' '}
                {d.fees.inCredit}
              </p>
            )}
          </Card>
        )
      })}

      {totalDue === 0 && (students ?? []).length > 0 && (
        <Card className="border-brand-200 bg-brand-50">
          <p className="font-medium text-brand-800">{t.allPaid}</p>
        </Card>
      )}

      {(results ?? []).length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold text-ink">{t.recentResults}</h2>
          <ul className="flex flex-col gap-2">
            {(results ?? []).map((result) => {
              const exam = Array.isArray(result.exams) ? result.exams[0] : result.exams
              if (!exam) return null
              return (
                <li
                  key={result.id}
                  className="flex items-center justify-between gap-3 rounded-xl
                    border border-line bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{exam.title}</p>
                    <p className="text-sm text-ink-faint">
                      {formatDate(exam.exam_date, locale)}
                    </p>
                  </div>
                  <span className="num shrink-0 font-semibold text-ink">
                    {result.is_absent ? (
                      <span className="text-absent">{d.attendance.absent}</span>
                    ) : (
                      <>
                        {result.obtained_marks ?? '—'}/{exam.total_marks}
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {(students ?? []).length === 0 && (
        <Card>
          <p className="text-ink-soft">{t.noRecords}</p>
        </Card>
      )}
    </div>
  )
}
