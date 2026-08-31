import Link from 'next/link'

import { Card } from '@/components/ui'
import { greetingFor } from '@/components/app-shell'
import { pageRole, getSession, isStaffAdmin, canReadFees, myTeacherIds } from '@/lib/auth/session'
import { isHqMember } from '@/lib/branches'
import { createClient } from '@/lib/supabase/server'
import { pageAll, pageOrNull, type Paged, worstFailure } from '@/lib/supabase/page'
import {
  todayInDhaka,
  currentPeriodMonth,
  addMonths,
  formatDate,
} from '@/lib/bd/time'
import { has, studentRoom } from '@/lib/plans'
import { setupSteps } from '@/lib/setup'
import { countChasesDue } from '@/lib/fees/reminder-schedule'
import { monthBills, monthMoney, payrollState } from '@/lib/finance/profit'
import { ratesForDashboard } from '@/lib/attendance/rates'
import { studentsAtRisk, RISK_COLUMNS } from '@/lib/students/risk'
import {
  progressToTell,
  PROGRESS_COUNT_COLUMNS,
  type ProgressCountRow,
} from '@/lib/students/progress'
import { tallyOutstanding, formatTaka as taka } from '@/lib/money'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { ReminderEntry } from '@/app/(app)/fees/reminder-entry'
import { ProfitCard } from './profit-card'
import { AttendanceRates } from './attendance-rates'
import { AtRiskCard } from './at-risk-card'
import { ProgressEntry } from './progress-entry'
import { NoticeEntry } from './notice-entry'
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
  const scope = isAdmin ? null : await myTeacherIds()

  /*
   * WHICH IS ONE VALUE ANSWERING TWO QUESTIONS, SO THE FAILURE IS SPLIT OFF HERE.
   *
   * A staff-admin is not filtered, and that is what `null` means on the line above.
   * A staff list that did not arrive would have reached the filter below as the same
   * `null` and dropped it — putting the centre's nine batches behind a teacher's two
   * numbers, which is precisely the pair of figures the note above describes: 9
   * batches beside a student count of 2, "1 of 9 batches marked today" over a teacher
   * who had marked both of theirs.
   *
   * So the query is not sent. `batchRows` stays null, and the two numbers it feeds are
   * already withheld on a null rather than drawn as zero — see `activeBatchIds` below.
   * Nothing else on this page is narrowed by hand, so nothing else is affected.
   */
  const scopeUnreadable = scope !== null && 'unreadable' in scope
  const mine = scope !== null && 'ids' in scope ? scope.ids : null

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

  // Resolved, not queried, when the door is not being drawn. `{ rows: [] }` rather
  // than a failure, because nothing was asked for and nothing went wrong — and the
  // door this counts for is not drawn either way, since `seeProgress` gates both.
  // Typed so the destructured `weekly` below is the view's rows or the reason there
  // are none, rather than `any`.
  const noProgress: Paged<ProgressCountRow> = { rows: [] }

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

  /**
   * Whether this reader gets §9.8's profit line at all.
   *
   * The same gate as /expenses and /payroll, and it has to be, because the profit line
   * is those two screens subtracted from the fee board: a reader who cannot open the
   * spending ledger must not be handed its total on the home screen under a different
   * heading. `center_profit_month` carries the role half of it in SQL as well, in
   * `app.is_staff_admin` — that is the gate that counts, and this one only decides
   * whether five queries are sent.
   *
   * NO LOCKED TEASER on FREE or PRO, unlike the plan-gated doors elsewhere. A paywall
   * card on the screen an owner opens six times a day is furniture inside a week, and
   * /settings/plan already lists what the centre tiers add. The three tiles above stay
   * on every plan either way, so nobody loses a figure they had.
   */
  const showMoney = isAdmin && has(session.plan, 'centerWideReporting')

  const [
    { count: studentCount },
    { data: batchRows },
    owing,
    { data: collectedRow, error: collectedError },
    { data: todaySessions },
    chased,
    { data: rates },
    risky,
    weekly,
    { count: enrolmentCount },
    { count: sessionCount },
    { data: profitRow, error: profitError },
    { data: chargesRow, error: chargesError },
    { count: termsCount },
    { count: salaryPayCount },
    { count: salaryExpenseCount },
  ] = await Promise.all([
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('status', 'active'),
    // Resolved rather than sent when the staff list could not be read — see the note
    // on `scopeUnreadable` for why an unfiltered answer is the wrong one here.
    scopeUnreadable ? { data: null } : batchQuery,
    // Unvoided and still owed. A voided invoice is a correction and counting it
    // would show the owner money they are not owed; a settled one is not owed at
    // all. Every balance here was subtracted by Postgres in numeric(10, 2).
    //
    // Paged, because PostgREST stops at 1000 rows without saying so and this is one
    // row per unpaid invoice across every month the centre has billed. The figure it
    // adds up to is the first number on the owner's home screen; read short, it
    // reports less owed than the centre is owed, and nothing on the page could hint
    // that it had. `.order('id')` is for the paging, not the reader — an offset walk
    // over an unordered query can repeat a row, and a repeated invoice would be
    // counted twice into what is outstanding.
    pageAll((from, to) =>
      supabase
        .from('fee_invoice_balances')
        .select(COLUMNS)
        .eq('coaching_center_id', session.active.centerId)
        .is('voided_at', null)
        .gt('remaining_bdt', 0)
        .order('id')
        .range(from, to),
    ),
    // Collected this month, by payment date rather than by invoice period — the
    // owner is asking "what came in", not "what was billed".
    //
    // One row, summed by Postgres, and the Dhaka month boundary is the view's
    // problem now. It used to be a `+06:00` string built on this line and again on
    // the fee board, because paid_at is a timestamptz that PostgREST hands back in
    // UTC: a payment at 1am Dhaka on the 1st is 19:00 UTC on the last of the
    // previous month, and would be counted against a month the owner has already
    // closed and reported. Two screens each holding that fact is one screen away
    // from getting it wrong.
    //
    // maybeSingle, because a month nobody has paid in has no row at all.
    supabase
      .from('fee_collections_month')
      .select('collected_bdt')
      .eq('coaching_center_id', session.active.centerId)
      .eq('period_month', period)
      .maybeSingle(),
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
    //
    // Paged, and not for the sake of the card's wording: `countChasesDue` below is
    // what turns this into "three need a message today", and a reminder lost past
    // the row ceiling reads as a family never contacted. The number on the door
    // would then send an owner to re-chase somebody they chased this morning.
    pageAll((from, to) =>
      supabase
        .from('fee_reminders')
        .select('invoice_id, created_at')
        .eq('coaching_center_id', session.active.centerId)
        .gte('created_at', `${addMonths(period, -1)}T00:00:00+06:00`)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to),
    ),
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
    //
    // Which is also why it is paged. The ceiling would cap that count at a thousand
    // on a large enough roll, and a count that has been quietly capped is the same
    // lie this comment already refuses.
    //
    // Still pageOrNull, unlike the three reads around it. This card is drawn only
    // when somebody is flagged, so a read that did not arrive takes it off the page
    // instead of putting a wrong number on it — and an absent card is the ordinary
    // state of a centre where nobody is drifting. The claim itself is made on
    // /at-risk, in a sentence, and that screen refuses rather than making it.
    pageOrNull((from, to) =>
      supabase
        .from('student_risk')
        .select(RISK_COLUMNS)
        .eq('coaching_center_id', session.active.centerId)
        .order('student_id')
        .range(from, to),
    ),
    // How many guardians can be told how their child's week went. Six columns of
    // the twenty the /progress screen reads — the door needs a number, not names —
    // and counted by the same function that screen lists with, so the two cannot
    // disagree. Conditional; see `seeProgress` above for why this one query is.
    seeProgress
      ? pageAll((from, to) =>
          supabase
            .from('student_progress_week')
            .select(PROGRESS_COUNT_COLUMNS)
            .eq('coaching_center_id', session.active.centerId)
            .order('student_id')
            .range(from, to),
        )
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
    /*
     * §9.8's four figures, already subtracted by Postgres in numeric(12, 2).
     *
     * Read and never recomputed here — see the note on `MonthMoney.profit`. The view is
     * the one place in this product allowed to sum expenses toward a profit figure, and
     * a second subtraction in JavaScript floats would disagree with it in the paisa on
     * some months, which is the one thing §9.1 forbids a finance screen outright.
     *
     * maybeSingle, like the collection figure above, and with the same trap: a month
     * with no row and a read that failed both arrive as `data: null`, and they are
     * opposite claims. `error` is what tells them apart, which is why `monthMoney` takes
     * it as an argument instead of guessing from the row.
     */
    showMoney
      ? supabase
          .from('center_profit_month')
          .select('collected_bdt, expenses_bdt, payroll_bdt, profit_bdt')
          .eq('coaching_center_id', session.active.centerId)
          .eq('period_month', period)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    /*
     * What the month BILLED, which is not one of the four above and is not drawn as one.
     *
     * A separate view and a separate question: `collected_bdt` up there is cash that
     * arrived in the month whatever it was for, and `paid_bdt` here is money against the
     * month's own bills whenever it arrived. A March bill paid in April is in one and
     * not the other. Separate read, too, so it can fail on its own without taking the
     * profit line with it — which is why it is not a second column on the query above.
     */
    showMoney
      ? supabase
          .from('fee_charges_month')
          .select('charged_bdt, paid_bdt, outstanding_bdt')
          .eq('coaching_center_id', session.active.centerId)
          .eq('period_month', period)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    /*
     * AND THE TWO COUNTS THAT DECIDE WHETHER THE PAYROLL TERM ABOVE IS A LIE.
     *
     * 20260811000049's own header asks for these: "A month with no payroll row reads as
     * a month with no staff, and nothing in the schema can tell those apart… §9.10's
     * dashboard has to say which months have a payroll row rather than leaving an owner
     * to notice." A centre that has not written December's salaries down yet is reading
     * a profit too high by the largest single number in its business, and the view has
     * no column that can say so.
     *
     * Live agreements, then payments filed for the month. Head counts because the
     * question is "is there at least one", both off an index — `salary_terms` has a
     * partial unique index on the payee and `salary_payments_center_month_idx` covers
     * the second. Neither is a sum: the figures are already in the view.
     */
    showMoney
      ? supabase
          .from('salary_terms')
          .select('id', { count: 'exact', head: true })
          .eq('coaching_center_id', session.active.centerId)
          .eq('active', true)
      : noCount,
    showMoney
      ? supabase
          .from('salary_payments')
          .select('id', { count: 'exact', head: true })
          .eq('coaching_center_id', session.active.centerId)
          .eq('for_month', period)
      : noCount,
    /*
     * The money that is in neither term of the sum.
     *
     * 20260811000045 kept `salary` in the expense categories on purpose and
     * 20260811000049 then had to exclude it, so that a centre keeping both books is not
     * subtracted twice. Both decisions are right and the cost of them lands on this
     * screen: a centre paying staff only through the expense category has that money in
     * neither the spending term nor the payroll term, and the profit reads high by all
     * of it.
     *
     * The bucket is the view's own — `date_trunc('month', spent_on)` — expressed as a
     * half-open range so it can use `expenses_center_spent_idx` rather than a function
     * on the column. Both bounds are Dhaka calendar dates already; `spent_on` is a plain
     * date, so no timezone enters this.
     */
    showMoney
      ? supabase
          .from('expenses')
          .select('id', { count: 'exact', head: true })
          .eq('coaching_center_id', session.active.centerId)
          .eq('category', 'salary')
          .gte('spent_on', period)
          .lt('spent_on', addMonths(period, 1))
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
  //
  // Which the `?? []` this replaces made anyway, from the other side. A day with no
  // registers comes back as an empty array and a read that failed comes back as null,
  // so telling them apart costs nothing — and not telling them apart put “0 of 9
  // batches marked today” on the screen at four in the afternoon.
  const markedToday =
    activeBatchIds && todaySessions
      ? todaySessions.filter((s) => activeBatchIds.has(s.batch_id)).length
      : null

  /*
   * The invoices, or the fact that there are none to be had — and that difference is
   * the first number on this screen.
   *
   * `owing ?? []` erased it. An empty list has nothing to add up, `tallyOutstanding`
   * of nothing is nothing owed, and the card below drew that in 4xl bold with “nobody
   * is overdue” underneath: the most reassuring pair of sentences on the owner's home
   * screen, off a read that never arrived. The note further down this file says a
   * number that is missing is not a number that is zero. It was written about a
   * teacher reading a page RLS had emptied, and it is just as true of a dropped query.
   */
  const invoices = 'rows' in owing ? owing.rows : null
  const moneyProblem = worstFailure(owing)

  // Same rule as the fee board, so the two screens cannot drift: only positive
  // remainders, never netted against a family in credit. The credit itself is
  // not shown here — it is a detail to act on, and it belongs on the board next
  // to the child's name rather than diluting the one number this card is for.
  const remainders = (invoices ?? []).map((r) => Number(r.remaining_bdt ?? 0))
  const { outstanding } = tallyOutstanding(remainders)

  // Number(), not sumTaka: one row, already added up in SQL, arriving as a string
  // because numeric always does.
  //
  // `error` and not `data` decides whether it is known, because maybeSingle answers
  // null both for a month nobody has paid in and for a read that failed — and ৳0
  // collected is a sentence about how the month is going. Unknown is drawn as a dash.
  const collected = collectedError ? null : Number(collectedRow?.collected_bdt ?? 0)

  // Biggest debt first: the call an owner makes before the others.
  const overdue = (invoices ?? [])
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
  for (const r of 'rows' in chased ? chased.rows : []) {
    if (!r.invoice_id || lastChase.has(r.invoice_id)) continue
    lastChase.set(r.invoice_id, todayInDhaka(new Date(r.created_at)))
  }

  /*
   * The same figure the fee board shows, from the same function, so the owner's home
   * screen and the board never advertise two different amounts of work — or null, when
   * either read behind it did not arrive.
   *
   * Both are load-bearing, and they fail in opposite directions. With no invoices
   * there is nothing to count and the door reads “nobody needs chasing today”. With no
   * reminders every family inside a stage looks like one who has never been contacted,
   * so the count comes out too high and sends an owner to chase somebody they chased
   * this morning — which is the harm the reminder query's own note names, and counting
   * anyway is what would cause it.
   */
  const dueToday =
    invoices !== null && 'rows' in chased
      ? countChasesDue(
          invoices.map((r) => ({
            dueDate: r.due_date ?? today,
            lastRemindedOn: (r.id && lastChase.get(r.id)) || null,
            reachable: Boolean(r.guardian_phone),
          })),
          today,
        )
      : null

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
  // rather than a reason to hide the door — see the note on ProgressEntry — which is
  // exactly why a failed read must not arrive as one: the door would say “nobody new
  // to tell today” about a week nobody has been told anything about.
  const toTell = 'rows' in weekly ? progressToTell(weekly.rows) : null

  // How far this centre is from the product doing anything at all, or null once it is
  // doing it. Null for a teacher too, because their two counts were never asked for —
  // see `noCount`.
  const setup = setupSteps({
    students: studentCount,
    batches: batchCount,
    enrolments: enrolmentCount,
    sessions: sessionCount,
  })

  /*
   * §9.8's profit line, and the three separate ways it can decline to speak.
   *
   * Each read answers for itself. The profit figures failing takes the whole card off
   * the page — four noughts and a profit of ৳0 is a sentence about how the month went,
   * and a query that did not arrive has not earned it — while the bills line and the
   * salary-expense warning simply do not draw. The payroll counts are the interesting
   * one: their failure has to be SAID, because the missing warning is what would let a
   * profit figure with no wages in it pass for a good month.
   */
  const money = monthMoney(profitRow, Boolean(profitError))
  const bills = monthBills(chargesRow, Boolean(chargesError))
  const payroll = payrollState(termsCount, salaryPayCount)

  /*
   * Places remaining — §9.10's last item, and the only one on this page that costs
   * nothing: the ceiling is on the session and the count is the tile it sits under.
   *
   * Drawn on every plan rather than behind `showMoney`. Capacity is not a centre
   * feature — the ceiling is nearest on free, where it is thirty — and an owner who
   * finds out about it by being refused at student thirty-one has already had the
   * afternoon this line exists to prevent.
   */
  const placesLeft =
    studentCount === null ? null : studentRoom(session.ceiling, studentCount)

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

      {/* The money could not be read, so the money is not drawn. Two blocks rather
          than one ternary, like the fee worklist's own pair: the figure comes off the
          rows and the card off the reason, and neither decides for the other.

          Amber and not the brand card, because the brand card is where good news
          lives on this screen. An owner glancing at a green panel takes the number in
          it as the state of their centre, and this one is not a number. */}
      {seeFees && moneyProblem !== null && (
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">
            {moneyProblem === 'tooLarge'
              ? t.outstandingTooLarge
              : t.outstandingUnreadable}
          </p>
        </Card>
      )}

      {seeFees && moneyProblem === null && (
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
      {isAdmin && (invoices === null || remainders.length > 0) && (
        // The worklist's own words, borrowed rather than restated — a door and the
        // room behind it disagreeing about what is in there is how an owner stops
        // believing the number.
        //
        // Drawn when the invoices did not arrive as well as when money is owed. The
        // count is what usually decides, and a day's chasing that loses its door
        // because a query dropped loses the one errand on this screen that brings
        // money in — so the door stays and carries no number, which is what
        // `dueToday` being null means to it.
        <ReminderEntry dueToday={dueToday} t={d.reminders} />
      )}

      {/* Two or three, and the column count follows, because a two-item row in a
          three-column grid leaves a gap that reads as a stat that failed to load.
          Both class names are written out rather than interpolated from a number,
          so Tailwind's scanner can still see them.

          Wrapped with the places line below, so the two are one item in the page's
          `gap-5` column: that line is counted off the student tile beside it, and a
          full gap between them would read as an unrelated sentence. */}
      <div>
        <div className={`grid gap-3 ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {/* Staff-admin, and not merely `seeFees`. What came in this month is the
              centre's revenue; a teacher's copy of it would be the takings of their
              own batches under a label that says the centre's, and unlike arrears it
              is not a number they can do anything with. Their share of the money is
              on the fee board, next to the names.

              Kept on the centre tiers as well, beside the profit card that repeats
              it. Dropping it there would take the figure off the screen entirely the
              first time the profit read failed, and both come out of the same view,
              so they cannot disagree: the tile is the glance and the card is the sum. */}
          {/* A dash, not a nought, for whichever of the three could not be counted.
              `?? 0` put “0” under Students on a centre of three hundred and ৳0 under
              Collected over a month that took eighty thousand — small type, but the
              same false claim as the card above, and these are the three figures an
              owner takes in at a glance rather than reads. */}
          {isAdmin && (
            <Stat
              label={t.collected}
              value={collected === null ? '—' : taka(collected)}
            />
          )}
          <Stat
            label={t.students}
            value={studentCount === null ? '—' : String(studentCount)}
          />
          <Stat
            label={t.batches}
            value={batchCount === null ? '—' : String(batchCount)}
          />
        </div>

        {/* Places remaining, on every plan — see the note on `placesLeft`. One faint
            line and a door, because it is a fact an owner needs to have seen rather
            than one they act on today, and the day they do act on it the door is the
            only thing on this line that matters. */}
        {isAdmin && placesLeft !== null && (
          <p className="num mt-2 text-sm text-ink-soft">
            {placesLeft > 0
              ? t.placesLeft(placesLeft, session.ceiling.ceiling)
              : t.placesFull}{' '}
            <Link
              href="/settings/plan"
              className="font-medium text-brand-800 underline"
            >
              {t.placesLink} →
            </Link>
          </p>
        )}
      </div>

      {/* THE PROFIT LINE — §9.8's box, here because §9.10 puts it on this screen and
          not on one of its own. A separate finance page would print "collected this
          month" twice in two places, which is the discrepancy this file's own header
          refuses; the tiles above are the glance and this is the working.

          Under the tiles rather than over them: the outstanding card at the top is what
          the product is sold on and what an owner opens the app to check, and the sum
          below is what they read once a month with the shutter down. Above today's
          attendance, though — everything past that card is about the teaching. */}
      {showMoney && money === null && (
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.money.title}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.money.unreadable}</p>
        </Card>
      )}

      {showMoney && money !== null && (
        <ProfitCard
          month={period}
          locale={locale}
          money={money}
          bills={bills}
          payroll={payroll}
          salaryEntries={salaryExpenseCount}
          t={t.money}
        />
      )}

      {/* §8.3's comparison table, and the only way anybody finds it — it has no nav tab,
          because `NAV` in the shell is explicitly not a plan gate. Under the profit
          figure it breaks down, and only for the head office: a pinned manager would be
          shown a comparison of the one building they already read above. */}
      {showMoney && has(session.plan, 'multipleBranches') && isHqMember(session.active) && (
        <Link
          href="/hq"
          className="inline-flex min-h-tap items-center font-medium text-brand-700"
        >
          {t.money.branchLink} →
        </Link>
      )}

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

      {/* Directly under the weekly note, because they are the same errand seen from two
          sides: that one is the message the product writes about one child, this one is
          the message the centre writes to everybody. An owner who has just told forty
          families how their week went is the one who remembers that Thursday is a
          holiday.

          `isAdmin` and no plan gate. `manualMessaging` is true on every tier — the
          centre's own thumb on the centre's own phone is not ours to sell — so unlike
          the door above it, this one is there on the free plan too. */}
      {isAdmin && <NoticeEntry t={d.notices} />}

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
