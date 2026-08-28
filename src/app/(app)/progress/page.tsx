import Link from 'next/link'

import { Card } from '@/components/ui'
import { SearchBox, SearchEmpty } from '@/components/search-box'
import { pageRole, getSession } from '@/lib/auth/session'
import { has, planName, PLANS } from '@/lib/plans'
import { createClient } from '@/lib/supabase/server'
import { pageAll } from '@/lib/supabase/page'
import { formatDate, todayInDhaka, digits } from '@/lib/bd/time'
import { normalizeBdMobile } from '@/lib/bd/phone'
import { searchTerms, matchesSearch, MAX_QUERY } from '@/lib/search'
import {
  weeklyProgress,
  progressTotals,
  progressEmptyReason,
  PROGRESS_COLUMNS,
  type ProgressStudent,
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
 * AND ONE CHILD CAN BE FOUND WITHOUT WORKING THE LIST, which is a second use of this
 * screen and not a filter on the first. A guardian rings and asks how their son did
 * this week; the owner has one name and a list two hundred rows long ordered by
 * something else entirely. The box answers that in one screen.
 *
 * The search reaches all four kinds of row, and that is the part worth keeping. Over
 * the worklist alone it would tell an owner searching a child who was messaged on
 * Monday that nothing matched — a false sentence about a student who is enrolled, had
 * a week recorded and was told two days ago. So the matches that cannot be sent are
 * listed under the worklist with the reason under each name, which is a different
 * thing from the hundred and fifty dead rows the paragraph above refuses to draw:
 * a search returns one or two names, and about those the owner asked.
 *
 * Nothing sendable moves. The count card keeps reporting every family still to tell,
 * because that figure is the centre's and not the query's — the same rule the fee
 * board's search follows, and the reason `SearchBox` prints "showing 3 of 187"
 * instead.
 *
 * STAFF-ADMIN AND PLAN-GATED, which is two different fences. The role gate is the
 * view's own: read by a teacher the aggregate would describe their batches while
 * wearing the whole week's name, and a parent would be told that as fact. The plan
 * gate is `parentSummary`, which is what ৳499 buys — and the Server Action behind
 * the chips checks it again, because a paywall on a page stops nobody who can type
 * a fetch.
 */
export default async function ProgressPage({
  searchParams,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  searchParams: Promise<{ q?: string }>
}) {
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

  // Read after the gate, because a locked screen has no list to narrow. Capped like
  // every other box here: the query arrives in a URL a person can edit.
  const query = ((await searchParams).q ?? '').slice(0, MAX_QUERY)
  const terms = searchTerms(query)

  // Paged. One row per student in the centre, so a 1,200-enrolment centre on the
  // tier that unlocks this screen is exactly who crosses PostgREST's silent
  // thousand — and this is a worklist, not a report: a student cut off the end is a
  // family the week's summary never reaches, with nothing on the screen to show
  // they were dropped. `.order('student_id')` because the view has no id of its own
  // and that column is its key.
  const data = await pageAll((from, to) =>
    supabase
      .from('student_progress_week')
      .select(PROGRESS_COLUMNS)
      .eq('coaching_center_id', session.active.centerId)
      .order('student_id')
      .range(from, to),
  )

  /*
   * And a read that did not arrive is not a centre with nobody in it, which is what
   * the null this replaces became. `weeklyProgress(null)` is an empty list,
   * `progressTotals` of that is every figure at nought, and `progressEmptyReason`
   * answers `noStudents` — "nobody is enrolled yet" — on the one screen ৳499 buys, to
   * a centre whose three hundred families are all still in the table.
   *
   * The gate above returns early for the same shape of reason: a screen with no
   * worklist to draw draws none of it, rather than drawing a hollow version. The way
   * back to the dashboard stays, because none of this is on the reader.
   */
  if (!('rows' in data)) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">
            {data.failed === 'tooLarge' ? t.tooLarge : t.unreadable}
          </p>
        </Card>
      </div>
    )
  }

  const students = weeklyProgress(data.rows, t.noName)
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

  /*
   * The two lists a query produces, and the same three fields the roster searches —
   * the child's name, the code on last month's slip, and the number that rang the
   * owner. Kept identical to `settings/students` on purpose: a box that matches one
   * set of fields there and another set here is a box an owner stops trusting the
   * second time it finds nothing.
   */
  const searching = terms.length > 0
  const hit = (s: ProgressStudent) => matchesSearch([s.name, s.code, s.guardianPhone], terms)

  // The worklist, narrowed. Order untouched: `weeklyProgress` already sorted it, and
  // a filter that also re-sorted would hand back a worse list than the one asked for.
  const listed = searching ? toTell.filter(hit) : toTell

  // And the matches with nothing to send. Empty unless somebody typed — this is a
  // search result, not a section of the screen.
  const alsoMatched = searching ? students.filter((s) => s.status !== 'send' && hit(s)) : []

  const rows: ProgressRowView[] = listed.map((s) => {
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
      preferredChannel: s.preferredChannel,
      facts,
      // Converted to a Dhaka calendar day, not sliced off the ISO string:
      // created_at comes back in UTC, so a note sent at 1am Dhaka would read as
      // yesterday's date on the owner's own screen.
      told: s.lastSentAt
        ? t.told(formatDate(todayInDhaka(new Date(s.lastSentAt)), locale))
        : null,
    }
  })

  /**
   * The one line under a matched name that has nothing to send.
   *
   * A `switch` and not a ternary chain, and `send` is written out rather than left to
   * a default: that is what makes a fifth `ProgressStatus` a type error here instead
   * of a row that renders an empty line. See the union's own note.
   */
  function heldReason(s: ProgressStudent): string {
    switch (s.status) {
      case 'sent':
        // Converted to a Dhaka calendar day for the same reason the sendable row's
        // own `told` line converts it. `whyTold` is the fallback and says less rather
        // than naming a day it does not have.
        return s.lastSentAt
          ? t.told(formatDate(todayInDhaka(new Date(s.lastSentAt)), locale))
          : t.whyTold
      case 'nothing':
        return t.whyNothing
      case 'noNumber':
        return t.whyNoNumber
      case 'send':
        return ''
    }
  }

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

      {/* The headline figure, and it counts every family still to tell whatever is in
          the box. A search asks which of these rows is Ali's; it does not ask for the
          week's work to become Ali's — see the note on lib/search.ts. The box below
          says out loud that the list under it is a part of itself. */}
      {toTell.length > 0 && (
        <Card className="border-brand-200 bg-brand-50">
          <p className="text-sm font-medium text-brand-800">{t.dueTitle}</p>
          {/* Two nodes rather than one filled sentence: the count is the largest
              thing on the screen and the word beside it is not. Both languages
              read number-then-word. */}
          <p className="mt-1 text-brand-900">
            <span className="num text-4xl font-bold">{toTell.length}</span>
            <span className="ml-2 font-semibold">{t.people(toTell.length)}</span>
          </p>
        </Card>
      )}

      {/* Only once there is a week to search. A box over a centre with no students is
          a control that can only ever fail, and its count would read "0 of 0".

          The default placeholder, because this screen's three fields are the usual
          three: the child's name, their code, the guardian's number. `total` is every
          student the view returned rather than the rows drawn, since the search reads
          all four kinds — so "3 of 187" is the honest denominator even though the
          list above it is forty long. */}
      {students.length > 0 && (
        <SearchBox
          q={query}
          t={d.search}
          count={{ shown: rows.length + alsoMatched.length, total: students.length }}
        />
      )}

      {rows.length > 0 && (
        <ProgressList
          rows={rows}
          centerName={session.active.centerName}
          words={{ t: d.chaseList, chase: d.chase, channels: d.channels }}
        />
      )}

      {/* Nothing matched at all — not one sendable row and not one held one. Said in
          the search's own words, never in this screen's: "নতুন করে কাউকে জানানোর নেই"
          under a mistyped name would have an owner close the page believing the week
          was done. */}
      {searching && rows.length === 0 && alsoMatched.length === 0 && (
        <SearchEmpty t={d.search} />
      )}

      {/* The matches that cannot be messaged, with the reason under each name.
          Search-only, and that is the whole design: as a permanent section it would be
          the hundred and fifty dead rows the doc above refuses to draw, and as a
          search result it is the answer to the name the owner typed.

          No chips on these rows, deliberately. A family told on Monday is held by the
          six-day cooldown in `progressDecision`, and a way around it drawn here would
          be a second, quieter answer to a question this product has already decided. */}
      {alsoMatched.length > 0 && (
        <Card>
          <p className="font-medium text-ink">{t.matchedHeld}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.matchedHeldHint}</p>
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {alsoMatched.map((s) => (
              <li key={s.studentId} className="py-2 first:pt-0 last:pb-0">
                <p className="font-medium text-ink">
                  {s.name}
                  {s.code && <span className="num ml-2 text-sm text-ink-faint">{s.code}</span>}
                </p>
                <p className="text-sm text-ink-soft">{heldReason(s)}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Two separate blocks rather than one ternary, like the fee worklist: the
          list is drawn from the rows and the card from the reason, and neither
          decides for the other. `emptyReason` is null exactly when there are rows,
          so they cannot both appear.

          Held while a search is open, along with the two blocks below it. All three
          describe the centre's whole week, and under a query they read as answers to
          it — "nobody new to tell" beside one found name is a sentence about the wrong
          thing. Clearing the box brings them back. */}
      {!searching && emptyReason && (
        <Card>
          <p className="font-medium text-ink">{t.noneTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.noneBecause[emptyReason]}</p>
        </Card>
      )}

      {/* Counted, not listed. Rows the owner has already dealt with, and rows whose
          fix is a register rather than a message — the names would be a hundred and
          fifty lines each saying the same thing. */}
      {!searching && (totals.sent > 0 || totals.nothing > 0) && (
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

      {!searching && unreachable.length > 0 && (
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
