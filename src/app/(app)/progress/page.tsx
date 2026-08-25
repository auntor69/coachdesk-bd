import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { has, planName, PLANS } from '@/lib/plans'
import { createClient } from '@/lib/supabase/server'
import { formatDate, todayInDhaka, digits } from '@/lib/bd/time'
import { normalizeBdMobile } from '@/lib/bd/phone'
import {
  weeklyProgress,
  progressTotals,
  progressEmptyReason,
  PROGRESS_COLUMNS,
} from '@/lib/students/progress'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { ProgressList, type ProgressRowView } from './progress-list'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return {
    title: `${dict(session?.locale ?? DEFAULT_LOCALE).progress.title} — CoachDesk`,
  }
}

/**
 * The one message this product sends that is not asking for money.
 *
 * Every other outbound thing here is a fee: the board, the worklist, the receipt.
 * This screen turns a week of registers and marks into one sentence a guardian
 * actually wants — how many classes their child came to, and what they scored —
 * and hands it to the owner's own phone to send. No coaching centre in Bangladesh
 * does this today, which is why a parent finds out their child stopped attending
 * when the results come out.
 *
 * WHY THE FAMILIES TO MESSAGE ARE THE ONLY ONES LISTED. The view returns every
 * active student, and three kinds of row cannot be messaged: nothing was recorded,
 * the family was told two days ago, or there is no number. Listing those as rows
 * with dead chips is how a worklist stops being trusted — a hundred and fifty names
 * of which forty can be acted on is a list an owner scrolls rather than works. So
 * they are counted in one line at the bottom, with the link that fixes each one,
 * exactly as the fee worklist handles its own held and unreachable rows.
 *
 * WORST ATTENDANCE FIRST, decided in `weeklyProgress` and not here. An owner who
 * gets through forty of a hundred and fifty on a Thursday evening should have spent
 * those forty on the families where a message still changes something.
 *
 * STAFF-ADMIN AND PLAN-GATED, which is two different fences. The role gate is the
 * view's own: read by a teacher the aggregate would describe their batches while
 * wearing the whole week's name, and a parent would be told that as fact. The plan
 * gate is `parentSummary`, which is what ৳499 buys — and the Server Action behind
 * the chips checks it again, because a paywall on a page stops nobody who can type
 * a fetch.
 */
export default async function ProgressPage() {
  const session = await pageRole('manager')
  const locale = session.locale
  const d = dict(locale)
  const t = d.progress

  const back = (
    <Link
      href="/dashboard"
      className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
    >
      ← {d.dashboard.title}
    </Link>
  )

  // Before the query, not after. A locked screen has no use for a week of
  // aggregates, and running the view to throw the rows away is work done for a page
  // that cannot draw them. Same order as the export screen's own gate.
  if (!has(session.plan, 'parentSummary')) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Card>
          <h1 className="font-semibold text-ink">{t.lockedTitle}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {t.lockedBody(
              planName(session.plan, locale),
              planName(PLANS.teacher_plus, locale),
            )}
          </p>
          <Link
            href="/settings/plan"
            className="mt-4 inline-flex min-h-tap items-center font-medium text-brand-700"
          >
            {t.seePlans} →
          </Link>
        </Card>
      </div>
    )
  }

  const supabase = await createClient()

  const { data } = await supabase
    .from('student_progress_week')
    .select(PROGRESS_COLUMNS)
    .eq('coaching_center_id', session.active.centerId)

  const students = weeklyProgress(data, t.noName)
  const totals = progressTotals(students)

  // The window every figure on this screen was counted over, taken off the first
  // row rather than recomputed. The view decides it; a second `today - 6` here
  // would be a second answer to the same question, and the two would differ for
  // anyone loading the page across midnight in Dhaka.
  const weekFrom = students[0]?.weekFrom ?? ''
  const weekTo = students[0]?.weekTo ?? todayInDhaka()

  const toTell = students.filter((s) => s.status === 'send')
  const unreachable = students.filter((s) => s.status === 'noNumber')

  /**
   * Whether to say "nothing to do", and which of the four things that means.
   *
   * One value for both, so the card and its sentence can never disagree — see
   * progressEmptyReason, which is where the ordering and the reason for it live.
   */
  const emptyReason = progressEmptyReason(totals)

  const rows: ProgressRowView[] = toTell.map((s) => {
    const facts: string[] = []

    // Attendance first, because it is the figure a parent asks about. The ratio
    // stays ASCII in both languages: the guardian reads it back down the phone, so
    // the digits on this screen have to be the digits in the message.
    facts.push(
      s.attendancePct === null
        ? t.noRegister
        : `${t.attendance} ${s.sessionsPresent}/${s.sessionsCounted}`,
    )

    // Lateness and excused days only when there are any. A row that says "0 days
    // late" spends a line of a 375px screen saying nothing happened.
    if (s.sessionsLate > 0) {
      facts.push(`${digits(s.sessionsLate, locale)} ${t.late(s.sessionsLate)}`)
    }
    if (s.sessionsExcused > 0) {
      facts.push(`${digits(s.sessionsExcused, locale)} ${t.excused(s.sessionsExcused)}`)
    }

    // The exam the message will name, with its title when it has one.
    if (s.lastExamObtained !== null && s.lastExamTotal !== null) {
      const score = `${s.lastExamObtained}/${s.lastExamTotal}`
      facts.push(s.lastExamTitle ? `${s.lastExamTitle} ${score}` : score)
    } else if (s.examsMissed === 0) {
      facts.push(t.noExam)
    }

    if (s.examsMissed > 0) {
      facts.push(`${digits(s.examsMissed, locale)} ${t.examsMissed(s.examsMissed)}`)
    }

    return {
      studentId: s.studentId,
      name: s.name,
      studentCode: s.code,
      weekFrom: s.weekFrom,
      weekTo: s.weekTo,
      sessionsCounted: s.sessionsCounted,
      sessionsPresent: s.sessionsPresent,
      sessionsLate: s.sessionsLate,
      examTitle: s.lastExamTitle,
      examObtained: s.lastExamObtained,
      examTotal: s.lastExamTotal,
      examsMissed: s.examsMissed,
      // Normalised here rather than trusted from the column: the deep links need
      // E.164, and a number entered before the validator existed may not be in it.
      guardianPhone: normalizeBdMobile(s.guardianPhone),
      smsOptOut: s.smsOptOut,
      facts,
      // Converted to a Dhaka calendar day, not sliced off the ISO string:
      // created_at comes back in UTC, so a note sent at 1am Dhaka would read as
      // yesterday's date on the owner's own screen.
      told: s.lastSentAt
        ? t.told(formatDate(todayInDhaka(new Date(s.lastSentAt)), locale))
        : null,
    }
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        {back}
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{t.lead}</p>
        {weekFrom && (
          <p className="num mt-1 text-sm text-ink-faint">
            {t.covers(formatDate(weekFrom, locale), formatDate(weekTo, locale))}
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <>
          <Card className="border-brand-200 bg-brand-50">
            <p className="text-sm font-medium text-brand-800">{t.dueTitle}</p>
            {/* Two nodes rather than one filled sentence: the count is the largest
                thing on the screen and the word beside it is not. Both languages
                read number-then-word. */}
            <p className="mt-1 text-brand-900">
              <span className="num text-4xl font-bold">{rows.length}</span>
              <span className="ml-2 font-semibold">{t.people(rows.length)}</span>
            </p>
          </Card>

          <ProgressList
            rows={rows}
            centerName={session.active.centerName}
            words={{ t: d.chaseList, chase: d.chase, channels: d.channels }}
          />
        </>
      )}

      {/* Two separate blocks rather than one ternary, like the fee worklist: the
          list is drawn from the rows and the card from the reason, and neither
          decides for the other. `emptyReason` is null exactly when there are rows,
          so they cannot both appear. */}
      {emptyReason && (
        <Card>
          <p className="font-medium text-ink">{t.noneTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.noneBecause[emptyReason]}</p>
        </Card>
      )}

      {/* Counted, not listed. Rows the owner has already dealt with, and rows whose
          fix is a register rather than a message — the names would be a hundred and
          fifty lines each saying the same thing. */}
      {(totals.sent > 0 || totals.nothing > 0) && (
        <div className="flex flex-col gap-1 text-sm text-ink-faint">
          {totals.sent > 0 && <p className="num">{t.heldSent(totals.sent)}</p>}
          {totals.nothing > 0 && (
            <p className="num">
              {t.heldNothing(totals.nothing)}{' '}
              <Link href="/teach" className="font-medium text-brand-700">
                {t.takeRegister} →
              </Link>
            </p>
          )}
        </div>
      )}

      {unreachable.length > 0 && (
        <Card>
          <p className="num font-medium text-ink">
            {t.unreachableTitle(unreachable.length)}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {t.unreachableBody(unreachable.map((s) => s.name).join(', '))}
          </p>
          <Link
            href="/settings/students"
            className="mt-3 inline-flex min-h-tap items-center font-medium text-brand-700"
          >
            {t.addNumbers} →
          </Link>
        </Card>
      )}

      {/* The window and the promise, at the bottom and stated once. An owner about
          to send a hundred and fifty messages should be able to see, without
          tapping anything, that none of them mentions money. */}
      <p className="text-xs text-ink-faint">{t.windowNote}</p>
    </div>
  )
}
