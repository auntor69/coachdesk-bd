import Link from 'next/link'

import { Card } from '@/components/ui'
import { PageHeader } from '@/components/page-header'
import { greetingFor } from '@/components/app-shell'
import { pageRole, getSession, isStaffAdmin, canReadFees, myTeacherIds } from '@/lib/auth/session'
import { isHqMember } from '@/lib/branches'
import { Suspense } from 'react'

import { createClient } from '@/lib/supabase/server'
import { pageAll } from '@/lib/supabase/page'
import {
  todayInDhaka,
  currentPeriodMonth,
  addMonths,
  addDays,
  formatDate,
} from '@/lib/bd/time'
import { has } from '@/lib/plans'
import { can, canReadMoney } from '@/lib/staff/capabilities'
import { setupSteps } from '@/lib/setup'
import { countChasesDue } from '@/lib/fees/reminder-schedule'
import { categoryBills, monthBills, monthMoney, payrollState } from '@/lib/finance/profit'
import { formatTaka as taka } from '@/lib/money'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { ReminderEntry } from '@/app/(app)/fees/reminder-entry'
import { ProfitCard } from './profit-card'
import { RatesBlock } from './rates-block'
import { RiskBlock } from './risk-block'
import { LoadingCard } from './loading-card'
import { ProgressBlock } from './progress-block'
import { NoticeEntry } from './notice-entry'
import { SetupCard } from './setup-card'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).dashboard.title} — CoachDesk` }
}

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
   * Whether this reader is one the centre's voice belongs to (§6.2).
   *
   * Two doors on this page write in the centre's name — the weekly note to one family and
   * the notice to all of them — and a manager whose owner unticked `messages` is refused by
   * both actions. Answered off the session rather than through `canSendSms`, because that
   * helper is async and this decides a query above the ones it gates.
   */
  const seeMessages = isAdmin && can(session.active.capabilities, 'messages')

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
  const seeProgress = seeMessages && has(session.plan, 'parentSummary')

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
   * card on the screen an owner opens six times a day is furniture inside a week, and    * /settings/billing already lists what the centre tiers add. The three tiles above stay
   * on every plan either way, so nobody loses a figure they had.
   *
   * AND EVERY TERM OF THE SUBTRACTION HAS TO BE READABLE (§6.2). `center_profit_month` is
   * `security_invoker`, so a manager whose owner unticked `fees` gets a month that collected
   * nothing and a profit that is the wage bill in the negative, and one who lost `expenses`
   * or `payroll` gets a profit higher than it was. All three are confident, printed in the
   * largest type on the page, and wrong — so the card asks for all three words rather than
   * any of them. `canReadMoney` is the list, and it is answered off the session, which is
   * why this can stay a synchronous line ahead of the queries it gates.
   */
  const showMoney =
    isAdmin &&
    has(session.plan, 'centerWideReporting') &&
    canReadMoney(session.active.capabilities)

  const [
    { count: studentCount },
    { data: batchRows },
    { data: outstandingRow, error: outstandingError },
    { data: overdueRows, count: overdueCountRaw, error: overdueError },
    { data: chaseCandidates },
    { data: collectedRow, error: collectedError },
    { data: todaySessions },
    chased,
    { count: enrolmentCount },
    { count: sessionCount },
    { data: profitRow, error: profitError },
    { data: chargesRow, error: chargesError },
    { data: categoryRows },
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
    // Outstanding total, summed directly in SQL by view fee_outstanding_summary.
    // Replaces unbounded pageAll over fee_invoice_balances.
    supabase
      .from('fee_outstanding_summary')
      .select('outstanding_bdt, invoice_count')
      .eq('coaching_center_id', session.active.centerId)
      .maybeSingle(),
    // Up to 8 largest overdue balances for the dashboard table, with exact total overdue count.
    supabase
      .from('fee_invoice_balances')
      .select('id, student_name, remaining_bdt, due_date', { count: 'exact' })
      .eq('coaching_center_id', session.active.centerId)
      .is('voided_at', null)
      .gt('remaining_bdt', 0)
      .lt('due_date', today)
      .order('remaining_bdt', { ascending: false })
      .limit(8),
    // Chase candidates for today's worklist door, limited to active balances due within 3 days.
    isAdmin
      ? supabase
          .from('fee_invoice_balances')
          .select('id, due_date, guardian_phone')
          .eq('coaching_center_id', session.active.centerId)
          .is('voided_at', null)
          .gt('remaining_bdt', 0)
          .lte('due_date', addDays(today, 3))
          .limit(1000)
      : Promise.resolve({ data: null, error: null }),
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
     * AND WHAT IT WAS BILLED FOR (§9.7), which is the line above split six ways.
     *
     * The same three columns one grouping finer, off the view the total one is selected
     * FROM — so charged is `amount_bdt - discount_bdt` in exactly one place in the
     * database and the split cannot drift from the figure it sums to. Nothing adds these
     * up here; see `categoryBills`.
     *
     * No paging and no `.order()`. The group is (centre, month, category) against a
     * six-value enum, so this is at most six rows, and the order they are drawn in is the
     * enum's rather than the planner's.
     *
     * No `error` branch, unlike the read above it: a breakdown that did not arrive is a
     * card without a breakdown, and the billed line it sits under is already the honest
     * headline. There is no wrong figure to warn about.
     */
    showMoney
      ? supabase
          .from('fee_charges_category_month')
          .select('revenue_category, charged_bdt, paid_bdt, outstanding_bdt')
          .eq('coaching_center_id', session.active.centerId)
          .eq('period_month', period)
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
   */
  const invoicesMissing = Boolean(outstandingError || overdueError)
  const moneyProblem: 'unreadable' | 'tooLarge' | null = outstandingError ? 'unreadable' : null
  const outstanding = outstandingError ? 0 : Number(outstandingRow?.outstanding_bdt ?? 0)
  const invoiceCount = outstandingError ? 0 : Number(outstandingRow?.invoice_count ?? 0)

  // Number(), not sumTaka: one row, already added up in SQL, arriving as a string
  // because numeric always does.
  //
  // `error` and not `data` decides whether it is known, because maybeSingle answers
  // null both for a month nobody has paid in and for a read that failed — and ৳0
  // collected is a sentence about how the month is going. Unknown is drawn as a dash.
  const collected = collectedError ? null : Number(collectedRow?.collected_bdt ?? 0)

  // Biggest debt first: the call an owner makes before the others.
  const overdueCount = overdueCountRaw ?? (overdueRows ? overdueRows.length : 0)
  const overdue = (overdueRows ?? []).map((r) => ({
    name: r.student_name ?? d.common.unknown,
    amount: Number(r.remaining_bdt ?? 0),
    dueDate: r.due_date ?? today,
  }))

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
    isAdmin && chaseCandidates !== null && 'rows' in chased
      ? countChasesDue(
          chaseCandidates.map((r) => ({
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

  // And whether the revenue tile is one of the three. Named because the grid's own column
  // count has to agree with it — two tiles in a three-column grid is a gap where a figure
  // was, which reads as a figure that failed rather than as one nobody is owed.
  const seeCollected = isAdmin && seeFees

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
  const billedFor = categoryBills(categoryRows)
  const payroll = payrollState(termsCount, salaryPayCount)

  /*
   * §9.10'S LAST ITEM IS GONE (§16.1 step 28), and with it the one figure on this screen
   * that was not this reader's own. It was a places-remaining line fed the organisation's
   * pooled headcount against `session.ceiling`, loud past §3.7's thresholds — and a
   * per-student tier has no student limit, so there is no remaining to report and no door
   * to a purchase. The pooled read went with it: it existed only to pair with a ceiling,
   * and the students tile below is the reader's own branch on purpose.
   */

  return (
    <div className="flex flex-col gap-5">
      {/* The greeting is the page bar (§20.1), sticky to the top of the workspace from `lg`:
          an owner who has scrolled to the bottom of a long dashboard can still see which
          centre they are looking at. No crumb — this is the screen everything comes back
          to. */}
      <PageHeader title={greetingFor(session)} subtitle={session.active.centerName} />

      {/*
       * ONE COLUMN ON A PHONE, TWO ON A LAPTOP, AND THE PHONE'S ORDER IS UNCHANGED.
       *
       * Until the shell grew a sidebar this page was a single column at every width, which
       * at `lg:max-w-7xl` became a 1,280px-wide stack of cards: a ৳ figure set at 4xl with
       * nine hundred pixels of white beside it, and the month's profit two screens below
       * the thing it explains. §20.8 step 2, and §20.7's "two columns of white space around
       * one column of content".
       *
       * The split is by errand, not by size. The wide column is the day: what is owed, the
       * door that chases it, whether today's registers are in, and who is drifting. The
       * narrow one is the state of the centre — its counts, its month, its branches, and
       * the two doors that tell families about it. That is also §20.7's one primary action:
       * chasing money is in the main column, and everything quieter is beside it.
       *
       * HOW THE ORDER SURVIVES THE SPLIT. Each block carries an `order-N` matching the
       * order this page has always drawn them in, and the two wrappers are `contents` below
       * `lg` — no box, so on a phone all thirteen blocks are flex items of this one column
       * in exactly the sequence they were before, tiles above the profit and both above
       * today's attendance. From `lg` the wrappers become the two columns and each child's
       * order still ascends inside its own, so one number does both jobs and there is no
       * second list to keep in step. The comments below say "under" where the phone still
       * reads it that way and "beside" where the laptop does not. The numbers start at 2
       * because the greeting's own cell is gone: the bar is not a grid cell, because a
       * sticky box only travels inside its containing block and a cell's block is one grid
       * row. They were left where they were rather than shifted down — only their relative
       * order matters, and renumbering eleven blocks to reclaim a 1 is eleven chances to
       * swap two of them.
       */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
        {/* ABOVE THE MONEY AND ACROSS BOTH COLUMNS, and only ever for a centre that is not
            running yet. Every figure below this is honestly zero for such a centre — ৳0
            outstanding, no batches marked, nobody at risk — and a screen full of true zeros
            with no explanation is how an owner concludes the app is broken rather than
            empty. So while there is a step left, the instruction sits on top of the numbers
            it explains; the moment the four are done this returns null and the outstanding
            card is the first thing on the page again, for good. */}
        {setup && (
          <div className="order-2 lg:col-span-12">
            <SetupCard steps={setup} t={t.setup} />
          </div>
        )}

        {/* THE DAY'S WORK. `contents` on a phone, the left column from `lg` — see the note
            at the top of this return. */}
        <div className="contents lg:order-3 lg:col-span-8 lg:flex lg:flex-col lg:gap-5">
          {/* The money could not be read, so the money is not drawn. Two blocks rather
              than one ternary, like the fee worklist's own pair: the figure comes off the
              rows and the card off the reason, and neither decides for the other.

              Amber and not the brand card, because the brand card is where good news
              lives on this screen. An owner glancing at a green panel takes the number in
              it as the state of their centre, and this one is not a number. */}
          {seeFees && moneyProblem !== null && (
            <Card className="order-3 border-late/30 bg-late/5">
              <p className="font-medium text-ink">
                {(moneyProblem as string) === 'tooLarge'
                  ? t.outstandingTooLarge
                  : t.outstandingUnreadable}
              </p>
            </Card>
          )}

          {seeFees && moneyProblem === null && (
            <Card className="order-3 border-brand-200 bg-brand-50
              bg-[radial-gradient(48rem_14rem_at_0%_-120%,rgb(255_255_255/0.45),transparent_75%)]">
              <p className="text-sm font-semibold text-brand-700">{t.outstanding}</p>
              <p className="num mt-1 text-[2.5rem] font-bold leading-tight
                text-brand-900 lg:text-5xl">
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
                {overdueCount > 0
                  ? d.fees.overdueCount(overdueCount)
                  : t.nobodyOverdue}
              </p>
            </Card>
          )}

          {/* Directly under the number it exists to reduce, and above everything
              else in this column. This is the one action on the owner's home screen that
              brings money in rather than reporting on it, and on a 375px phone that
              means it has to be reachable without a scroll. */}
          {seeFees && isAdmin && (invoicesMissing || invoiceCount > 0) && (
            // The worklist's own words, borrowed rather than restated — a door and the
            // room behind it disagreeing about what is in there is how an owner stops
            // believing the number.
            //
            // Drawn when the invoices did not arrive as well as when money is owed. The
            // count is what usually decides, and a day's chasing that loses its door
            // because a query dropped loses the one errand on this screen that brings
            // money in — so the door stays and carries no number, which is what
            // `dueToday` being null means to it.
            <div className="order-4">
              <ReminderEntry dueToday={dueToday} t={d.reminders} />
            </div>
          )}

          <Card className="order-8">
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
                className="inline-flex min-h-tap shrink-0 items-center rounded-lg px-3
                  font-medium text-brand-700 hover:bg-brand-50"
              >
                {d.common.view} →
              </Link>
            </div>
          </Card>

          {/* THE TWO CARDS THAT ARE ALLOWED TO ARRIVE LATE, and the reason this page can
              paint at all. Both are aggregates over the centre's whole history — the
              rates view scans every register it has, and `student_risk` was measured at
              2.24 s at 250 students (audit §2.2b). Awaiting them here meant the arrears
              figure, the chase door and today's registers all waited for the slowest of
              the three, which is what made this screen feel slow for no visible reason.

              Each block now fetches its own data inside its own `<Suspense>`, so the
              page's own figures stream on the first flush and these two land when they
              land, worst-first below the thing they explain. Nothing is cached and
              nothing is fetched twice: `RatesBlock` and `RiskBlock` own exactly the query
              that used to sit in the `Promise.all` above.

              `[&:empty]:hidden` IS LOAD-BEARING, not tidiness. Both blocks render null
              for the ordinary empty case — a centre that has never taken a register, a
              roll where nobody is drifting — and an empty box in this column still
              contributes a `gap-5`, which is twenty pixels of nothing where a card
              should not be. The arbitrary variant is used rather than Tailwind's `empty:`
              because it is the one form that means the same thing in this version and
              the next.

              Directly under the card that counts today's registers, because this is what
              they add up to. A centre that has never taken attendance gets no card at all
              rather than one explaining its own emptiness — the line above already says
              nothing has been taken. */}
          {isAdmin && (
            <div className="order-9 [&:empty]:hidden">
              <Suspense fallback={<LoadingCard rows={2} />}>
                <RatesBlock
                  centerId={session.active.centerId}
                  period={period}
                  locale={locale}
                  t={t}
                />
              </Suspense>
            </div>
          )}

          {/* Under the rate card, because that one is the aggregate and this one is the
              individuals inside it — the same reading order as the outstanding figure
              above the list of who owes it.

              `isAdmin` and not merely the rows' own absence: `student_risk` is
              staff-admin only in SQL, which is the gate that counts, so a teacher's read
              came back empty from a round trip that was already in flight. It is not in
              flight any more — this is its own request now — so the role check that the
              view enforces anyway is the cheap way not to send it. */}
          {isAdmin && (
            <div className="order-10 [&:empty]:hidden">
              <Suspense fallback={<LoadingCard />}>
                <RiskBlock
                  centerId={session.active.centerId}
                  noName={d.risk.noName}
                  view={d.common.view}
                  t={d.risk}
                />
              </Suspense>
            </div>
          )}

          {/* WHO OWES, AND SINCE WHEN — the names behind the figure at the top of this
              column, and the last block in it because it is the only one an owner reads
              row by row rather than at a glance.

              A table from `sm` up and stacked rows below it. Eight names rather than the
              five it showed while this page was a phone layout at every width: the laptop
              has the height for them beside a four-block rail, and eight is the difference
              between a sample and a morning's work. `/fees` is still where the rest are —
              this is the top of a list, not the list. */}
          {overdue.length > 0 && (
            <div className="order-last">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="font-semibold text-ink">{t.overdueTitle}</h2>
                {/* A 44px target on one line: the py is what a thumb aims at and the
                    -my puts the row back where it was. */}
                <Link href="/fees" className="-my-3 py-3 text-sm font-medium text-brand-700">
                  {d.common.seeAll}
                </Link>
              </div>

              {/* One `<table>` at both widths rather than a list on a phone and a table on
                  a laptop: two renderings of the same eight rows is two things to keep in
                  step, and this is three columns, which fits 375px once the date is the
                  short form `formatDate` already returns.

                  `hidden sm:table-header-group` on the head, not no head at all: three
                  stacked rows of name/date/৳ explain themselves at a phone's width and the
                  header would cost a line of chrome, but a screen reader gets the labels
                  either way. */}
              <table className="w-full border-separate border-spacing-y-2">
                <thead className="hidden sm:table-header-group">
                  <tr className="text-left text-xs font-medium uppercase
                    tracking-wide text-ink-faint">
                    <th scope="col" className="px-4 pb-1">{t.overdueName}</th>
                    <th scope="col" className="px-4 pb-1">{t.overdueDue}</th>
                    <th scope="col" className="px-4 pb-1 text-right">
                      {t.overdueAmount}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.slice(0, 8).map((row, i) => (
                    <tr key={i} className="bg-white">
                      {/* The borders go on the cells, not the row: a `<tr>` cannot carry
                          one in any browser we ship to, so the rounding sits on the first
                          and last cell of each row and the middle cell keeps only the
                          rules above and below. */}
                      <th
                        scope="row"
                        className="max-w-[12rem] truncate rounded-l-xl border border-r-0
                          border-line px-4 py-3 text-left font-medium text-ink"
                      >
                        {row.name}
                      </th>
                      <td className="num whitespace-nowrap border-y border-line px-4 py-3
                        text-sm text-ink-faint">
                        {formatDate(row.dueDate, locale)}
                      </td>
                      <td className="num rounded-r-xl border border-l-0 border-line px-4
                        py-3 text-right font-semibold text-absent">
                        {taka(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* THE STATE OF THE CENTRE. `contents` on a phone, the right-hand column from
            `lg` — see the note at the top of this return. Nothing in here is today's
            errand: it is the counts, the month, the other branches, and the two doors
            that tell families how the term is going. */}
        <div className="contents lg:order-4 lg:col-span-4 lg:flex lg:flex-col lg:gap-5">
          {/* Two or three, and the column count follows, because a two-item row in a
              three-column grid leaves a gap that reads as a stat that failed to load.
              Both class names are written out rather than interpolated from a number,
              so Tailwind's scanner can still see them.

              Three tiles across on a phone, one card of three ruled rows in the rail:
              at a quarter of the width three boxes would put "৳1,24,000" on two lines,
              and a stacked figure beside its label is the denser read anyway. Same
              markup, different arrangement — the borders move from each tile to the
              container at `lg`, which is also §20.7's typography over boxes.

              Wrapped with the places line below, so the two are one item in the column's
              `gap-5`: that line is counted off the student tile beside it, and a full gap
              between them would read as an unrelated sentence. */}
          <div className="order-5">
            <div
              className={`grid gap-3 ${seeCollected ? 'grid-cols-3' : 'grid-cols-2'}
                lg:grid-cols-1 lg:gap-0 lg:divide-y lg:divide-line lg:rounded-xl
                lg:border lg:border-line lg:bg-white`}
            >
              {/* Staff-admin AND `seeFees`, which is not the same as either alone. What came
                  in this month is the centre's revenue; a teacher's copy of it would be the
                  takings of their own batches under a label that says the centre's, and
                  unlike arrears it is not a number they can do anything with. Their share of
                  the money is on the fee board, next to the names. And §6.2's manager without
                  `fees` is filtered out of `center_collection_month` the same way a teacher
                  is, so the tile they would get is ৳0 over a month that took eighty thousand.

                  Kept on the centre tiers as well, above the profit card that repeats
                  it. Dropping it there would take the figure off the screen entirely the
                  first time the profit read failed, and both come out of the same view,
                  so they cannot disagree: the tile is the glance and the card is the sum. */}
              {/* A dash, not a nought, for whichever of the three could not be counted.
                  `?? 0` put “0” under Students on a centre of three hundred and ৳0 under
                  Collected over a month that took eighty thousand — small type, but the
                  same false claim as the card above, and these are the three figures an
                  owner takes in at a glance rather than reads. */}
              {seeCollected && (
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

          </div>

          {/* THE PROFIT LINE — §9.8's box, here because §9.10 puts it on this screen and
              not on one of its own. A separate finance page would print "collected this
              month" twice in two places, which is the discrepancy this file's own header
              refuses; the tiles above are the glance and this is the working.

              In the rail and not under the outstanding card: this is the figure an owner
              reads once a month with the shutter down, and the wide column is for the
              money that is still out there. Under the tiles either way, whichever shape
              the page is in — it is their working. */}
          {showMoney && money === null && (
            <Card className="order-6 border-late/30 bg-late/5">
              <p className="font-medium text-ink">{t.money.title}</p>
              <p className="mt-1 text-sm text-ink-soft">{t.money.unreadable}</p>
            </Card>
          )}

          {showMoney && money !== null && (
            <div className="order-6">
              <ProfitCard
                month={period}
                locale={locale}
                money={money}
                bills={bills}
                billedFor={billedFor}
                categories={d.fees.categories}
                payroll={payroll}
                salaryEntries={salaryExpenseCount}
                t={t.money}
              />
            </div>
          )}

          {/* §8.3's comparison table. Under the profit figure it breaks down, and only for
              the head office: a pinned manager would be shown a comparison of the one
              building they already read above.

              No longer the only way anybody finds it — the shell now carries an
              Organisation group with a /hq row in it, greyed with an Upgrade badge on the
              tiers that do not include branches. This link is the one a reader arrives at
              with the month's profit in front of them, which is when the comparison is
              worth opening, so it stays. */}
          {showMoney && has(session.plan, 'multipleBranches') && isHqMember(session.active) && (
            <Link
              href="/hq"
              className="order-7 inline-flex min-h-tap items-center font-medium
                text-brand-700"
            >
              {t.money.branchLink} →
            </Link>
          )}

          {/* Under the two cards about how the term is going on a phone, beside them on a
              laptop, because it is what an owner does with them: the rates and the drifting
              names are what the centre knows, and this is the door to telling the families.
              In the rail rather than the wide column — the money is what keeps the centre
              open, and one screen cannot have two most-important errands. */}
          {seeProgress && (
            <div className="order-11">
              <Suspense fallback={<LoadingCard rows={1} />}>
                <ProgressBlock centerId={session.active.centerId} t={d.progress} />
              </Suspense>
            </div>
          )}

          {/* Directly under the weekly note, because they are the same errand seen from two
              sides: that one is the message the product writes about one child, this one is
              the message the centre writes to everybody. An owner who has just told forty
              families how their week went is the one who remembers that Thursday is a
              holiday.

              `isAdmin` and no plan gate. `manualMessaging` is true on every tier — the
              centre's own thumb on the centre's own phone is not ours to sell — so unlike
              the door above it, this one is there on the free plan too. What it does need is
              §6.2's `messages`, because postNotice refuses a manager who was not given it. */}
          {seeMessages && (
            <div className="order-12">
              <NoticeEntry t={d.notices} />
            </div>
          )}
        </div>

        {/* The empty-roster card that used to live here is gone: SetupCard at the top of
            the page covers it, and covers the three states after it that nothing covered
            — students with no batch, a batch with nobody in it, and a centre that has
            never taken a register. One card that ends, rather than one that only ever
            spoke to a centre with literally nothing in it. */}
      </div>
    </div>
  )
}

/**
 * One of the three glance figures: a bordered box on a phone, a ruled row in the rail.
 *
 * Same markup either way, with the border and the background moving to the container at
 * `lg` (see the grid above). The figure is written first because it is the point and
 * because on a phone it is on top; `lg:order-*` swaps it to the right of its label, where
 * three of them stack into a column of figures that can be scanned down.
 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-3 py-3 text-center
        lg:flex lg:items-baseline lg:justify-between lg:gap-3 lg:rounded-none
        lg:px-4 lg:text-left"
    >
      <p className="num text-xl font-bold text-ink lg:order-2">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-ink-soft lg:order-1 lg:mt-0 lg:text-sm">
        {label}
      </p>
    </div>
  )
}
