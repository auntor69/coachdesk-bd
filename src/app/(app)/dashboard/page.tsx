import Link from 'next/link'

import { Card } from '@/components/ui'
import { greetingFor } from '@/components/app-shell'
import { pageRole, getSession, isStaffAdmin, canReadFees, myTeacherIds } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import {
  todayInDhaka,
  currentPeriodMonth,
  addMonths,
  formatDate,
} from '@/lib/bd/time'
import { has } from '@/lib/plans'
import { setupSteps } from '@/lib/setup'
import { countChasesDue } from '@/lib/fees/reminder-schedule'
import { ratesForDashboard } from '@/lib/attendance/rates'
import { studentsAtRisk, RISK_COLUMNS } from '@/lib/students/risk'
import {
  progressToTell,
  PROGRESS_COUNT_COLUMNS,
  type ProgressCountRow,
} from '@/lib/students/progress'
import { sumTaka, tallyOutstanding, formatTaka as taka } from '@/lib/money'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { ReminderEntry } from '@/app/(app)/fees/reminder-entry'
import { AttendanceRates } from './attendance-rates'
import { AtRiskCard } from './at-risk-card'
import { ProgressEntry } from './progress-entry'
import { SetupCard } from './setup-card'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).dashboard.title} — CoachDesk` }
}

/** One line, not a concatenation — see the same note on the fee board. */
const COLUMNS = 'id, student_name, remaining_bdt, due_date, guardian_phone'

/**
 * The owner's screen. Four numbers, two ways into the day's work, and a list.
 *
 * The number that sells the product is outstanding fees, so it is largest and
 * first. Everything else on this page exists to make that number trustworthy —
 * or, in the case of the reminder link directly beneath it, to make it smaller.
 * The exception is the batch attendance card near the bottom, which is not about
 * money at all: it is the figure that makes a centre renew, because it is the one
 * thing on the screen a paper register could never have produced.
 *
 * Which is why it reads the same view and uses the same arithmetic as the fee
 * board rather than recomputing. This page used to fetch every invoice and every
 * payment and reduce them in JavaScript floats; both screens showed ৳900 while
 * the fees were whole taka, and would have started disagreeing the first time a
 * centre entered 1250.50. Two screens showing the same number two different ways
 * is how an owner finds a discrepancy and stops trusting both. The same rule now
 * covers the reminder count: countChasesDue, not a filter written twice.
 */
export default async function DashboardPage() {
  // `teacher`, not `manager`: a teacher with fee visibility is meant to read the
  // numbers here — see the note on `isAdmin` below, which gates the parts that
  // are staff-admin. But not `pageCenter` either, which let a *student* load it:
  // they have /me, this screen is not for them, and the nav bar has never
  // offered it to them. Reachable-but-unlinked is still reachable.
  const session = await pageRole('teacher')
  const supabase = await createClient()
  const today = todayInDhaka()
  const period = currentPeriodMonth()
  const locale = session.locale
  const d = dict(locale)
  const t = d.dashboard

  // Owners and managers only. A teacher granted fee visibility can see the
  // numbers on this page, but the worklist itself is staff-admin — offering them
  // a door that answers 403 is worse than not offering it. The same boolean gates
  // the batch-rate card, which the view returns nothing to a teacher for.
  const isAdmin = isStaffAdmin(session)

  // And which batches count as this reader's, for the one figure on this page that
  // RLS does not narrow on its own.
  //
  // Everything else here already answers per reader: students, invoices, payments
  // and today's registers are all scoped to a teacher's own batches by policy. A
  // batch *row* is not — batches_member_read admits every member of the centre, for
  // the reasons in the note on /teach — so the count sat there reading 9 beside a
  // student count of 2, and "1 of 9 batches marked today" over a teacher who had
  // marked both of theirs. Two numbers from the same screen describing two
  // different centres.
  const mine = isAdmin ? null : await myTeacherIds()

  /*
   * The ids, not a count — and that is the fix for a fraction that could exceed its
   * own denominator.
   *
   * This was a head count, and the register line below counted today's sessions
   * separately with no batch filter on them at all. Two queries describing two
   * populations: a batch marked this morning and then deactivated at lunchtime left
   * "1/0 batches marked today" on the owner's home screen. The same shape as every
   * other honesty bug in this product — a numerator and a denominator that were never
   * made to agree.
   *
   * So the set is fetched once and both numbers come out of it. A count cannot filter
   * anything, an id can, and there are at most a few hundred of these against a page
   * that already reads every outstanding invoice and every flagged student unbounded.
   *
   * It also collapses the teacher dimension into the same set. Today `.in('teacher_id',
   * mine)` and the policy behind today's registers pick the same batches, because
   * `app.my_batch_ids()` is that same predicate — but they are two definitions of one
   * population, and this makes RLS the backstop rather than the second opinion.
   *
   * Built out here rather than inline below because the filter is conditional and a
   * builder has nowhere to hang an `if`. Nothing runs until the Promise.all awaits it.
   */
  let batchQuery = supabase
    .from('batches')
    .select('id')
    .eq('coaching_center_id', session.active.centerId)
    .eq('active', true)

  if (mine) batchQuery = batchQuery.in('teacher_id', mine)

  /**
   * Whether to ask for the week's progress aggregate at all.
   *
   * The only conditional query on this page, and it earns it twice. The view is
   * staff-admin, so a teacher would pay for a round trip that returns nothing — but
   * so would the risk and rate queries below, and those are left unconditional for
   * exactly that reason. What is different here is the plan: a free teacher cannot
   * open the screen this counts for, and running a seven-day aggregate over every
   * student to render a door they will be shown a paywall behind is work done for
   * nobody. Everything else on this page is available on every plan.
   */
  const seeProgress = isAdmin && has(session.plan, 'parentSummary')

  // Resolved, not queried, when the door is not being drawn. Typed so the
  // destructured `weekly` below is the view's rows or nothing, rather than `any`.
  const noProgress: { data: ProgressCountRow[] | null } = { data: null }

  /**
   * Stand-in for a head count that was not asked for.
   *
   * `null` rather than 0, and that is the whole safety of it: `setupSteps` treats an
   * unknown count as "say nothing", so a reader who is not staff-admin gets no setup
   * card without a second branch anywhere. Which is what we want — every step on that
   * card is a screen a teacher cannot open, and RLS would hand them their own batches'
   * numbers under a label claiming the centre's.
   */
  const noCount: { count: number | null } = { count: null }

  const [
    { count: studentCount },
    { data: batchRows },
    { data: owing },
    { data: payments },
    { data: todaySessions },
    { data: chased },
    { data: rates },
    { data: risky },
    { data: weekly },
    { count: enrolmentCount },
    { count: sessionCount },
  ] = await Promise.all([
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('status', 'active'),
    batchQuery,
    // Unvoided and still owed. A voided invoice is a correction and counting it
    // would show the owner money they are not owed; a settled one is not owed at
    // all. Every balance here was subtracted by Postgres in numeric(10, 2).
    supabase
      .from('fee_invoice_balances')
      .select(COLUMNS)
      .eq('coaching_center_id', session.active.centerId)
      .is('voided_at', null)
      .gt('remaining_bdt', 0),
    // Collected this month, by payment date rather than by invoice period — the
    // owner is asking "what came in", not "what was billed".
    //
    // The +06:00 offset is the whole point of doing this in the query. paid_at is
    // a timestamptz and PostgREST hands it back in UTC, so taking the first ten
    // characters of the string gives a UTC date: a payment at 1am Dhaka on the
    // 1st is 19:00 UTC on the last of the previous month, and would be counted
    // against a month the owner has already closed and reported.
    supabase
      .from('fee_payments')
      .select('amount_bdt')
      .eq('coaching_center_id', session.active.centerId)
      .gte('paid_at', `${period}T00:00:00+06:00`),
    // Today's registers, one row per batch that has one — `unique (batch_id,
    // session_date)` is what makes a row count a batch count.
    //
    // Not narrowed to active batches here, and not by an embed either: an `!inner`
    // join filter degrades every column on the query to unknown, for the reason
    // written out at fees/actions.ts. The narrowing happens against `activeBatchIds`
    // below, which is the same set the denominator is counted from.
    supabase
      .from('attendance_sessions')
      .select('batch_id')
      .eq('coaching_center_id', session.active.centerId)
      .eq('session_date', today),
    // Reminders since the start of last month, newest first — enough to tell
    // which of the outstanding rows have already been chased at their current
    // stage, which is what turns "twelve people owe money" into "three people
    // need a message today".
    //
    // Run for every role rather than only for the two that can open the
    // worklist. RLS returns nothing to a teacher, so the query costs one round
    // trip inside a Promise.all that is already waiting on five others, and
    // making it conditional would buy nothing but a branch.
    supabase
      .from('fee_reminders')
      .select('invoice_id, created_at')
      .eq('coaching_center_id', session.active.centerId)
      .gte('created_at', `${addMonths(period, -1)}T00:00:00+06:00`)
      .order('created_at', { ascending: false }),
    // Attendance rate per batch, counted by Postgres — forty students taking
    // class twenty times is eight hundred rows per batch, and this screen is
    // opened several times a day on a 3G phone.
    //
    // Two months, not one. A card that reads "no attendance yet" for the first
    // days of every month is empty exactly when an owner is thinking hardest
    // about the month that just closed, so the current month is used when it has
    // anything in it and last month is the fallback. The view's index is on
    // (coaching_center_id, period_month), which is what makes asking for two
    // months no more work than asking for one.
    //
    // Active batches only: a closed batch's history stays readable through the
    // view — that is why batch_active is exposed rather than filtered there — but
    // it does not belong on today's dashboard.
    //
    // Unconditional, like the reminder query above. The view is staff-admin only,
    // so a teacher gets an empty array from a round trip that was already
    // happening inside this Promise.all.
    supabase
      .from('batch_attendance_monthly')
      .select('batch_id, batch_name, period_month, sessions, counted, rate_pct')
      .eq('coaching_center_id', session.active.centerId)
      .eq('batch_active', true)
      .in('period_month', [period, addMonths(period, -1)]),
    // Who is drifting away. Unconditional for the same reason as the two queries
    // above — the view is staff-admin only, so a teacher gets an empty array out
    // of a round trip that was already in flight.
    //
    // No `.limit()`, though the card shows three. The count under the heading has
    // to be the real one: "3 students" over the three that fit, when eleven are
    // flagged, is the card lying about the size of the problem. Every row is one
    // student with at least one signal, so the worst case is a fraction of the
    // centre's roll and the ordering has to happen over all of them anyway.
    supabase
      .from('student_risk')
      .select(RISK_COLUMNS)
      .eq('coaching_center_id', session.active.centerId),
    // How many guardians can be told how their child's week went. Six columns of
    // the twenty the /progress screen reads — the door needs a number, not names —
    // and counted by the same function that screen lists with, so the two cannot
    // disagree. Conditional; see `seeProgress` above for why this one query is.
    seeProgress
      ? supabase
          .from('student_progress_week')
          .select(PROGRESS_COUNT_COLUMNS)
          .eq('coaching_center_id', session.active.centerId)
      : noProgress,
    /*
     * The two counts behind the setup card, and the reason they are counts rather than
     * rows: both questions are "is there at least one", over tables that hold one row
     * per student per batch and one per class per day. A centre in its second year has
     * tens of thousands of each, and Postgres answers both off an index without
     * sending anything back.
     *
     * Conditional like the progress aggregate above, and for a stronger reason than
     * cost: `null` is what tells `setupSteps` the answer is unknown, which is how a
     * teacher gets no card at all. See `noCount`.
     *
     * Active enrolments only. A student whose enrolment ended is not enrolled, and a
     * centre whose whole first batch has finished needs the same instruction a new one
     * does. Attendance, by contrast, is counted for all time — taking a register is
     * something you have either done or not, and last April still counts.
     */
    isAdmin
      ? supabase
          .from('enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('coaching_center_id', session.active.centerId)
          .eq('status', 'active')
      : noCount,
    isAdmin
      ? supabase
          .from('attendance_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('coaching_center_id', session.active.centerId)
      : noCount,
  ])

  /*
   * The batches this reader's home screen is about, and the two numbers drawn from
   * them.
   *
   * `null`, not an empty set, when the read did not come back — because `setupSteps`
   * reads the count and treats an unknown as "say nothing", which is the whole reason
   * a teacher gets no setup card. An empty set here would put "create your first
   * batch" on the screen of a centre that has nine, the first time the query failed.
   */
  const activeBatchIds = batchRows ? new Set(batchRows.map((b) => b.id)) : null
  const batchCount = activeBatchIds ? activeBatchIds.size : null

  // Registers taken today, counted only over batches that still exist to be marked.
  // A session on a batch retired this afternoon was real work and is still in the
  // register; it is not part of "how much of today is done", because today's list
  // does not offer that batch.
  //
  // `null` travels with the set for the same reason the count does: a numerator with
  // no denominator to sit over is not a fraction, and 0 would be the claim that no
  // register was taken.
  const markedToday = activeBatchIds
    ? (todaySessions ?? []).filter((s) => activeBatchIds.has(s.batch_id)).length
    : null

  // Same rule as the fee board, so the two screens cannot drift: only positive
  // remainders, never netted against a family in credit. The credit itself is
  // not shown here — it is a detail to act on, and it belongs on the board next
  // to the child's name rather than diluting the one number this card is for.
  const remainders = (owing ?? []).map((r) => Number(r.remaining_bdt ?? 0))
  const { outstanding } = tallyOutstanding(remainders)
  const collected = sumTaka((payments ?? []).map((p) => Number(p.amount_bdt)))

  // Biggest debt first: the call an owner makes before the others.
  const overdue = (owing ?? [])
    .filter((r) => (r.due_date ?? today) < today)
    .map((r) => ({
      name: r.student_name ?? d.common.unknown,
      amount: Number(r.remaining_bdt ?? 0),
      dueDate: r.due_date ?? today,
    }))
    .sort((a, b) => b.amount - a.amount)

  // Newest reminder per invoice, as a Dhaka calendar day.
  //
  // The conversion is load-bearing and not a slice of the ISO string: created_at
  // is a timestamptz handed back in UTC, so a reminder sent at 1am Dhaka would
  // read as yesterday — and yesterday is on the other side of the cooldown, which
  // is the difference between this number and the one on the worklist.
  const lastChase = new Map<string, string>()
  for (const r of chased ?? []) {
    if (!r.invoice_id || lastChase.has(r.invoice_id)) continue
    lastChase.set(r.invoice_id, todayInDhaka(new Date(r.created_at)))
  }

  // The same figure the fee board shows, from the same function, so the owner's
  // home screen and the board never advertise two different amounts of work.
  const dueToday = countChasesDue(
    (owing ?? []).map((r) => ({
      dueDate: r.due_date ?? today,
      lastRemindedOn: (r.id && lastChase.get(r.id)) || null,
      reachable: Boolean(r.guardian_phone),
    })),
    today,
  )

  // Whether the fee figures on this page mean anything to whoever is reading it.
  //
  // Without this, a teacher landing here from a bookmark got the centre's
  // outstanding as ৳0 and "nobody is overdue" — RLS had returned them nothing, and
  // the card reported that absence as good news in the same 4xl type an owner
  // reads their real arrears in. A number that is missing is not a number that is
  // zero, and this card is the one the whole product is sold on.
  //
  // Free for an owner or a manager: canReadFees answers from the role without a
  // query, and it is memoised, so this and the fee tab in the shell share one — and
  // for a teacher it shares `mine`'s query above rather than adding its own.
  const seeFees = await canReadFees()

  // The month the rate card describes and the batches in it, worst first — both
  // decided in one tested place, because both invert without leaving a mark on
  // the screen. See the note on the query for why two months are fetched.
  const { month: rateMonth, rates: batchRates } = ratesForDashboard(
    rates,
    period,
    t.unknownBatch,
  )

  // And the students behind those rates who are on their way out. Worst first,
  // with the reason for each one already chosen — every threshold is in the view
  // and the ordering is in one tested function, so this page decides neither.
  const atRisk = studentsAtRisk(risky, d.risk.noName)

  // And the families who can be told how that week went. Zero is a real answer here
  // rather than a reason to hide the door — see the note on ProgressEntry.
  const toTell = progressToTell(weekly)

  // How far this centre is from the product doing anything at all, or null once it is
  // doing it. Null for a teacher too, because their two counts were never asked for —
  // see `noCount`.
  const setup = setupSteps({
    students: studentCount,
    batches: batchCount,
    enrolments: enrolmentCount,
    sessions: sessionCount,
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">{greetingFor(session)}</h1>
        <p className="mt-1 text-ink-soft">{session.active.centerName}</p>
      </div>

      {/* ABOVE THE MONEY, and only ever for a centre that is not running yet. Every
          figure below this is honestly zero for such a centre — ৳0 outstanding, no
          batches marked, nobody at risk — and a screen full of true zeros with no
          explanation is how an owner concludes the app is broken rather than empty.
          So while there is a step left, the instruction sits on top of the numbers it
          explains; the moment the four are done this returns null and the outstanding
          card is the first thing on the page again, for good. */}
      {setup && <SetupCard steps={setup} t={t.setup} />}

      {seeFees && (
        <Card className="border-brand-200 bg-brand-50">
          <p className="text-sm font-medium text-brand-800">{t.outstanding}</p>
          <p className="num mt-1 text-4xl font-bold text-brand-900">
            {taka(outstanding)}
          </p>
          {/* The fee board's own caption, borrowed rather than restated. A
              teacher's copy of this figure covers their own batches and no others,
              because fee_invoice_balances inner-joins students under
              security_invoker — and the two screens must describe that same
              boundary in the same words. */}
          {!isAdmin && (
            <p className="mt-1 text-sm font-medium text-brand-700">
              {d.fees.yoursOnly}
            </p>
          )}
          {/* `.num` on the paragraph rather than a span around the count, the same
              way the fee board carries this sentence. It is only tabular figures,
              so it does nothing to the Bangla words and everything to the digit. */}
          <p className="num mt-2 text-sm text-brand-800">
            {overdue.length > 0
              ? d.fees.overdueCount(overdue.length)
              : t.nobodyOverdue}
          </p>
        </Card>
      )}

      {/* Directly under the number it exists to reduce, and above everything
          else on the page. This is the one action on the owner's home screen that
          brings money in rather than reporting on it, and on a 375px phone that
          means it has to be reachable without a scroll. */}
      {isAdmin && remainders.length > 0 && (
        // The worklist's own words, borrowed rather than restated — a door and the
        // room behind it disagreeing about what is in there is how an owner stops
        // believing the number.
        <ReminderEntry dueToday={dueToday} t={d.reminders} />
      )}

      {/* Two or three, and the column count follows, because a two-item row in a
          three-column grid leaves a gap that reads as a stat that failed to load.
          Both class names are written out rather than interpolated from a number,
          so Tailwind's scanner can still see them. */}
      <div className={`grid gap-3 ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {/* Staff-admin, and not merely `seeFees`. What came in this month is the
            centre's revenue; a teacher's copy of it would be the takings of their
            own batches under a label that says the centre's, and unlike arrears it
            is not a number they can do anything with. Their share of the money is
            on the fee board, next to the names. */}
        {isAdmin && <Stat label={t.collected} value={taka(collected)} />}
        <Stat label={t.students} value={String(studentCount ?? 0)} />
        <Stat label={t.batches} value={String(batchCount ?? 0)} />
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-ink">{t.todayAttendance}</p>
            {/* Left off rather than guessed when the batch list did not arrive. The
                heading and the door below still work, and a card that says one true
                thing beats one that adds a fraction it cannot stand behind. */}
            {batchCount !== null && markedToday !== null && (
              <p className="num mt-0.5 text-sm text-ink-soft">
                {t.batchesTaken(markedToday, batchCount)}
              </p>
            )}
          </div>
          <Link
            href="/teach"
            className="shrink-0 rounded-lg px-3 py-2 font-medium text-brand-700
              hover:bg-brand-50"
          >
            {d.common.view} →
          </Link>
        </div>
      </Card>

      {/* Directly under the card that counts today's registers, because this is
          what they add up to. A centre that has never taken attendance gets no
          card at all rather than one explaining its own emptiness — the line
          above already says nothing has been taken. */}
      {isAdmin && batchRates.length > 0 && (
        <AttendanceRates
          month={rateMonth}
          rows={batchRates}
          isCurrentMonth={rateMonth === period}
          locale={locale}
          t={t}
        />
      )}

      {/* Under the rate card, because that one is the aggregate and this one is the
          individuals inside it — the same reading order as the outstanding figure
          above the list of who owes it. Only when somebody is flagged; see the note
          on the card for why an empty version of it would be worse than none. */}
      {atRisk.length > 0 && (
        <AtRiskCard students={atRisk} view={d.common.view} t={d.risk} />
      )}

      {/* Directly under the two cards about how the term is going, because it is
          what an owner does with them: the rates and the drifting names are what
          the centre knows, and this is the door to telling the families. Below the
          fee worklist rather than beside it — the money is what keeps the centre
          open, and one screen cannot have two most-important errands. */}
      {seeProgress && <ProgressEntry toTell={toTell} t={d.progress} />}

      {overdue.length > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="font-semibold text-ink">{t.overdueTitle}</h2>
            <Link href="/fees" className="text-sm font-medium text-brand-700">
              {d.common.seeAll}
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {overdue.slice(0, 5).map((row, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 rounded-xl
                  border border-line bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{row.name}</p>
                  <p className="text-sm text-ink-faint">
                    {formatDate(row.dueDate, locale)}
                  </p>
                </div>
                <span className="num shrink-0 font-semibold text-absent">
                  {taka(row.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The empty-roster card that used to live here is gone: SetupCard at the top of
          the page covers it, and covers the three states after it that nothing covered
          — students with no batch, a batch with nobody in it, and a centre that has
          never taken a register. One card that ends, rather than one that only ever
          spoke to a centre with literally nothing in it. */}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-3 text-center">
      <p className="num text-lg font-bold text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink-soft">{label}</p>
    </div>
  )
}
