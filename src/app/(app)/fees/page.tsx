import { forbidden } from 'next/navigation'
import Link from 'next/link'

import { Card } from '@/components/ui'
import { SearchBox, SearchEmpty } from '@/components/search-box'
import { pageCenter, getSession, isStaffAdmin, canReadFees } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { pageAll, pageOrNull, type Paged, worstFailure } from '@/lib/supabase/page'
import {
  todayInDhaka,
  currentPeriodMonth,
  addMonths,
  daysBetween,
  formatMonth,
  formatDate,
} from '@/lib/bd/time'
import { normalizeBdMobile } from '@/lib/bd/phone'
import { tallyOutstanding, formatTaka } from '@/lib/money'
import { searchTerms, matchesSearch, MAX_QUERY } from '@/lib/search'
import { countChasesDue } from '@/lib/fees/reminder-schedule'
import type { Award } from '@/lib/fees/scholarship'
import { cancelledBills } from '@/lib/fees/void'
import { dict, DEFAULT_LOCALE, type Locale } from '@/lib/i18n'
import type { OutreachChannel } from '@/lib/supabase/types'
import { InvoiceGenerator } from './invoice-generator'
import { CancelledRow } from './cancel-bill'
import { PaymentRow, type FeeRow, type ReminderCenter } from './payment-row'
import { ReminderEntry } from './reminder-entry'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).fees.title} — CoachDesk` }
}

/**
 * One line, not a concatenation. supabase-js parses the select string at the
 * type level to work out the row shape, and it can only do that with a string
 * literal — split this across two lines with a `+` and TypeScript widens it to
 * `string`, the parse fails, and every column comes back as GenericStringError.
 */
const COLUMNS = 'id, student_name, student_code, amount_bdt, discount_bdt, discount_reason, discount_percent, scholarship_id, scholarship_name, net_bdt, paid_bdt, remaining_bdt, due_date, period_month, guardian_phone, sms_opt_out, preferred_channel, instalment_no, instalment_of'

/**
 * The cancelled list needs a name, a month, what is no longer owed, and the owner's
 * own note. One line, for the reason above.
 */
const CANCELLED_COLUMNS = 'id, student_name, student_code, period_month, net_bdt, voided_at, void_reason'

/**
 * Show the cancelled list open rather than folded away up to this many rows.
 *
 * Cancelling is a correction, so the normal number is one or two and the outcome of the
 * tap has to be visible — the row leaves the board above and appears here, which is the
 * only confirmation the action gets (see cancel-bill.tsx). Past a handful it is a batch
 * that closed, nobody is checking each name, and an open list that long would bury the
 * board it belongs under.
 */
const CANCELLED_OPEN_UP_TO = 5

/**
 * The fee board — who has paid, who has not, by how many days, and the button
 * that takes the money.
 *
 * This is the screen the product is sold on, so it answers one question at the
 * top (how much is outstanding right now) and makes the next action reachable in
 * one tap.
 *
 * Two readers, not one. A staff-admin gets the board above, with the generator,
 * the chase worklist and a form on every row. A teacher whose owner has ticked
 * `can_view_fees` gets the same rows for their own batches and nothing that moves
 * money — see the migration for why the grant stops at their own students, and
 * `canReadFees` for why an absent permissions row means no.
 *
 * The guard is `pageCenter` plus a `forbidden()`, not `pageRole('manager')`: the
 * role ladder cannot express "manager, or a teacher holding one specific
 * permission", and stretching it to would let the permission open every other
 * manager screen too.
 *
 * Every taka on this page is added up by Postgres, not here. amount_bdt is
 * numeric(10, 2), which JavaScript cannot represent exactly, so the per-invoice
 * arithmetic lives in the fee_invoice_balances view, the month's collection in
 * fee_collections_month, and what remains — one addition over the rows already on
 * the screen — goes through tallyOutstanding. An owner checks this board against a
 * bKash statement, and a board that is off by a taka is a board they stop
 * believing.
 *
 * What is shown: everything still outstanding, from any month, because old debt
 * is the debt worth chasing — plus this month's settled invoices, so the day's
 * collections stay visible and a payment just recorded does not vanish off the
 * screen along with its confirmation.
 *
 * AND A SEARCH BOX, because three hundred students is the whole product working.
 * It filters the list and nothing else: the outstanding total, the two counts, the
 * month's collection and the chase count are all computed from the unfiltered rows
 * and do not move when somebody types. An owner searching for "আলী" is asking
 * which of these rows is Ali's; they are not asking for the centre's outstanding
 * to become Ali's outstanding, and a board whose headline figure changed as they
 * typed would be a board they could not read a total off at all. The count under
 * the box says how much of the list is in view, which is what keeps the short list
 * from reading as a short board. Matching is in lib/search.ts, where it is tested.
 */
export default async function FeesPage({
  searchParams,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  searchParams: Promise<{ q?: string }>
}) {
  const session = await pageCenter()
  if (!(await canReadFees())) forbidden()

  // What separates the two boards. Read from the role rather than from
  // `canReadFees`, because the question here is not "may they look" — they may,
  // or we would not have got this far — but "may they collect", and that is
  // staff-admin work in both feeAdmin() and RLS.
  const canWrite = isStaffAdmin(session)

  const supabase = await createClient()
  const today = todayInDhaka()
  const thisMonth = currentPeriodMonth()
  const locale = session.locale
  const d = dict(locale)
  const t = d.fees

  // The query as typed, kept for the box's own value, and as words for matching.
  // Awaited here rather than beside the fetches because nothing in the queries
  // depends on it — the search happens over rows the board was going to read
  // anyway, which is the point of doing it in memory. See lib/search.ts.
  const { q: rawQuery } = await searchParams
  const query = (rawQuery ?? '').slice(0, MAX_QUERY)
  const terms = searchTerms(query)

  // READ IN FULL, NOT IN THE FIRST THOUSAND ROWS. PostgREST answers at most 1000
  // rows per request and says nothing about having stopped, and every list here is
  // counted per invoice: 250 students taking four subjects is a thousand invoices a
  // month, which is the middle of the tier this product charges ৳1,999 for. Left
  // unpaged, the board silently drops the families past the cut off the list and out
  // of the outstanding total — a shorter list and a smaller number, both of which
  // look exactly like a centre doing well.
  //
  // Each paged query carries `.order('id')` as its last sort key, and it is there for
  // the paging rather than for the reader: offset paging over a non-unique order can
  // hand back the same row twice and skip another, and a duplicated invoice here
  // would be double-counted in what the centre is owed. The display orders in front
  // of it are untouched.
  const [
    owing,
    settled,
    { data: collectedRow, error: collectedError },
    chased,
    cancelled,
    awardRows,
    { data: center, error: centerError },
  ] =
    await Promise.all([
      pageAll((from, to) =>
        supabase
          .from('fee_invoice_balances')
          .select(COLUMNS)
          .eq('coaching_center_id', session.active.centerId)
          .is('voided_at', null)
          .gt('remaining_bdt', 0)
          .order('due_date', { ascending: true })
          .order('id')
          .range(from, to),
      ),
      pageAll((from, to) =>
        supabase
          .from('fee_invoice_balances')
          .select(COLUMNS)
          .eq('coaching_center_id', session.active.centerId)
          .is('voided_at', null)
          .lte('remaining_bdt', 0)
          .eq('period_month', thisMonth)
          .order('due_date', { ascending: true })
          .order('id')
          .range(from, to),
      ),
      // What actually came in this month, regardless of which month's invoice it
      // settled — a parent clearing June's bill in August is money collected in
      // August, and that is the number the owner is measuring themselves by.
      //
      // One row, summed by Postgres. This read used to be one row per payment
      // added up here, which crosses the thousand-row ceiling at a centre being
      // paid in instalments against a thousand invoices — and paging it, the
      // interim fix, dragged all of them over the wire to produce a single figure.
      // The Dhaka month boundary that used to be a `+06:00` string built on this
      // line now lives in the view, where a third screen cannot forget it.
      //
      // No row at all is a month with no payments in it, which is why this is
      // maybeSingle and not single — and why `error` and not `data` decides below
      // whether the figure is known. maybeSingle answers `data: null` for both of the
      // two things that can happen here, a month nobody has paid in and a read that
      // did not arrive, and only one of them is worth printing as a number.
      supabase
        .from('fee_collections_month')
        .select('collected_bdt')
        .eq('coaching_center_id', session.active.centerId)
        .eq('period_month', thisMonth)
        .maybeSingle(),
      // Reminders since the start of last month, newest first, so each row can
      // say when this family was last chased.
      //
      // Bounded by time rather than by the invoice ids on the board, and the
      // bound is the point rather than an optimisation: the question a row is
      // answering is "have I already dealt with this one recently", and a chase
      // from four months ago is not a reason to hold off today. Two billing
      // cycles is the window in which the answer still changes a decision.
      //
      // Paged as well, and this one is not only about a label. `countChasesDue`
      // below reads the same map to decide who is due a message, so a reminder lost
      // to the row ceiling reads as a family never contacted — and the worklist
      // would offer to message somebody who was messaged an hour ago.
      //
      // Not asked at all on the read-only board. There is no policy that would
      // answer it for a teacher — who has been chased is the owner's record of
      // their own dunning — so the query would spend a round trip to be handed an
      // empty list, and every row would then draw its family as never-contacted.
      // Skipping it makes the absence deliberate instead of a silent zero.
      //
      // `{ rows: [] }` for that skip and not a failure, because nothing was asked for
      // and nothing went wrong — the stand-in the dashboard uses for a door it is not
      // drawing. `Paged<never>` because there is no row type to name and an empty list
      // of nothing narrows to the real rows wherever the two meet.
      canWrite
        ? pageAll((from, to) =>
            supabase
              .from('fee_reminders')
              .select('invoice_id, channel, created_at')
              .eq('coaching_center_id', session.active.centerId)
              .gte('created_at', `${addMonths(thisMonth, -1)}T00:00:00+06:00`)
              .order('created_at', { ascending: false })
              .order('id')
              .range(from, to),
          )
        : Promise.resolve<Paged<never>>({ rows: [] }),
      // The bills cancelled recently, so a mistaken tap has a way back and a
      // deliberate one has visible evidence. Everything else on this board reads
      // `voided_at is null`; this is the one query that asks for the other side of it.
      //
      // Bounded by the same window as the reminders above and for a related reason: a
      // cancellation made in error is noticed within minutes, not months, and a list
      // that grew forever would end up longer than the board and quietly stop being
      // read. What falls off the end is not lost — a cancelled bill is out of every
      // total, which is what the owner asked for — it simply stops being offered back.
      //
      // Staff-admin only, like the generator and the chase list. A teacher with
      // can_view_fees reads what their own students owe; who cancelled what is the
      // owner's record of correcting their own books, and there is no restore button on
      // a read-only board for the list to lead to.
      //
      // Still pageOrNull, unlike the two reads at the head of this wave and the one
      // above. This block is drawn only when something is in it, so a read that did not
      // arrive takes a fold-out off the page rather than putting a wrong figure on it,
      // and an absent fold-out is the ordinary state of a centre that has cancelled
      // nothing this month. What it costs is the way back to one mistaken tap, on a
      // board where the bill is already out of every total — which is what the tap
      // asked for. Nothing here claims that nothing was cancelled.
      canWrite
        ? pageOrNull((from, to) =>
            supabase
              .from('fee_invoice_balances')
              .select(CANCELLED_COLUMNS)
              .eq('coaching_center_id', session.active.centerId)
              .not('voided_at', 'is', null)
              .gte('voided_at', `${addMonths(thisMonth, -1)}T00:00:00+06:00`)
              .order('id')
              .range(from, to),
          )
        : Promise.resolve(null),
      // The awards this centre grants by name, for the waiver panel's select. One list
      // for the whole board, handed to every row as the same array — a per-row read of a
      // table with four rows in it would be a thousand round trips to draw one select.
      //
      // Active only: a retired award is still on the bills it waived, whose labels come
      // off the invoice, but it must not be offered again. Staff-admin only, because the
      // read-only board has no waiver panel to put a select in.
      //
      // A failed read comes back as no awards rather than as a broken page. What is lost
      // is the shortcut, not the ability to waive a fee — the two plain ways are always
      // in the select — and nothing here claims the centre has named none.
      canWrite
        ? pageOrNull((from, to) =>
            supabase
              .from('fee_scholarships')
              .select('id, name, percent, amount_bdt')
              .eq('coaching_center_id', session.active.centerId)
              .eq('active', true)
              .order('name', { ascending: true })
              .order('id')
              .range(from, to),
          )
        : Promise.resolve(null),
      // Where a parent should send the money. Read once for the whole board
      // rather than per row: it is one value for the centre, and every reminder
      // on the page is going to name it. Also skipped when read-only, for the
      // same reason — nothing on that board writes a message.
      canWrite
        ? supabase
            .from('coaching_centers')
            .select('payment_wallet, payment_number')
            .eq('id', session.active.centerId)
            .maybeSingle()
        : // `error: null` so the note below can be read off one shape. A board with
          // nothing to send is not a board whose payment details failed to load.
          Promise.resolve({ data: null, error: null }),
    ])

  // Newest wins, which is what the descending order above buys: the first row
  // seen for an invoice is its latest reminder, so every later one is skipped.
  //
  // Two things come out of the same map. The row wants a label a person would say
  // ("আজ", "yesterday"); the reminder schedule wants the Dhaka calendar day,
  // because whether a family may be messaged again turns on which day it was —
  // and the month-bounded query above is wide enough for that: a stage window is
  // never more than a fortnight long, so any reminder recent enough to close one
  // is well inside it.
  const lastChase = new Map<
    string,
    { on: string; day: string; via: OutreachChannel }
  >()
  for (const r of 'rows' in chased ? chased.rows : []) {
    if (!r.invoice_id || lastChase.has(r.invoice_id)) continue
    const on = todayInDhaka(new Date(r.created_at))
    lastChase.set(r.invoice_id, {
      on,
      day: dayLabel(on, today, locale, t),
      via: r.channel,
    })
  }

  // Longest overdue first, then largest amount — the order an owner works down
  // a list in. Settled rows sink to the bottom rather than into a separate list,
  // so a row that has just been paid keeps its React state and its confirmation
  // message instead of being unmounted by the revalidation that follows.
  const rows = [...('rows' in owing ? owing.rows : []), ...('rows' in settled ? settled.rows : [])]
    .map(toRow(today, lastChase, d.common.unknown))
    .sort(
      (a, b) =>
        Number(b.remaining > 0) - Number(a.remaining > 0)
        || b.daysLate - a.daysLate
        || b.remaining - a.remaining,
    )

  const unpaid = rows.filter((r) => r.remaining > 0)
  const overdue = unpaid.filter((r) => r.daysLate > 0)
  // Number(), not sumTaka: there is one row and Postgres has already added it up.
  // numeric arrives as a string, and a missing row is a month nobody has paid in —
  // unless the read failed, in which case the missing row means nothing at all, so the
  // error decides and the line below shows a dash rather than the ৳0 it used to.
  const collected = collectedError ? null : Number(collectedRow?.collected_bdt ?? 0)

  /*
   * Whether the chase history arrived, which is a question about the rows as much as
   * about this figure. `lastChase` is what puts "chased today" under a family's name
   * and what `countChasesDue` reads to decide who is owed a message — the same point
   * the note on that query makes about a short read, reached by the other road. Empty,
   * every family on the board reads as never contacted, the count on the chase-list
   * link comes out inflated, and an owner works down a list re-messaging the thirty
   * they messaged this morning.
   *
   * Null on the read-only board, where nothing was asked and no chase list is drawn.
   */
  const chaseProblem = worstFailure(chased)

  // How many of those are due a message today. Counted through the shared
  // function rather than filtered here, so the number on this link cannot drift
  // from the list it opens — and computed on this page rather than fetched from
  // that one, so the board stays a single round trip. Withheld, not guessed, when
  // the cooldowns behind it did not arrive: `ReminderEntry` keeps its link and drops
  // its number.
  const dueToday = chaseProblem !== null ? null : countChasesDue(
    unpaid.map((r) => ({
      dueDate: r.dueDate,
      lastRemindedOn: lastChase.get(r.id)?.on ?? null,
      reachable: Boolean(r.guardianPhone),
    })),
    today,
  )

  // Only what is actually owed, never netted against an overpayment — see
  // tallyOutstanding for why those two totals have to stay apart. The credit is
  // scoped to the rows on the board, same as everything else here, so an overpaid
  // invoice from an earlier month is out of view along with the rest of that
  // month's settled bills.
  const { outstanding, credit } = tallyOutstanding(rows.map((r) => r.remaining))

  // This month, last month, and next — an owner bills the month they are in or
  // catches up on the one before. Built here rather than in the browser so the
  // list is the same on both sides of hydration.
  const months = [-1, 0, 1].map((delta) => {
    const value = addMonths(thisMonth, delta)
    return { value, label: formatMonth(value, locale) }
  })

  const centerPay: ReminderCenter = {
    name: session.active.centerName,
    paymentWallet: center?.payment_wallet ?? null,
    paymentNumber: center?.payment_number ?? null,
  }

  // The awards as the waiver panel needs them: both figures through `Number()`, because
  // PostgREST hands numerics over as strings whatever the generated type says, and a
  // percentage that arrives as "50" would render as a share and price as nothing.
  const awards: Award[] = (awardRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    percent: row.percent === null ? null : Number(row.percent),
    amountBdt: row.amount_bdt === null ? null : Number(row.amount_bdt),
  }))

  // Newest cancellation first, sorted in the shared function rather than in the query
  // above — see lib/fees/void.ts for why `voided_at` is sorted on and then dropped
  // instead of travelling to the browser.
  const cancelledList = cancelledBills(cancelled, d.common.unknown)

  // The two lists as the board will actually draw them, and the last thing computed
  // on purpose: every figure above is already fixed against the full set, so there is
  // no way for a filtered list to reach a total. A student's name, their code and
  // their guardian's number, which is exactly what the box says it searches — and the
  // number is in there because two children of the same name are told apart by it.
  const shown = terms.length === 0
    ? rows
    : rows.filter((r) => matchesSearch([r.name, r.studentCode, r.guardianPhone], terms))

  // The cancelled list narrows with the board rather than sitting under it unfiltered.
  // A search is a question about one family, and a fold-out list still naming thirty
  // others would answer a question nobody asked.
  const shownCancelled = terms.length === 0
    ? cancelledList
    : cancelledList.filter((b) => matchesSearch([b.name, b.studentCode], terms))

  /*
   * A board that could not be read is not a board with nothing on it.
   *
   * These two queries were paged for the reason at the head of the wave above — a
   * silently short read is a shorter list and a smaller number, both of which look
   * exactly like a centre doing well. Their failure had the same shape: the null came
   * back, `?? []` turned it into no invoices, and the screen drew ৳0 outstanding over
   * "No invoices yet". The dictionary note on `emptyBodyReadOnly` already says an
   * empty board must not look like a screen that failed to load; this is that rule
   * pointing the other way.
   *
   * Everything goes, rather than the total being blanked over a list that stays. The
   * generator goes with it, deliberately: inviting somebody to raise this month's
   * invoices on a screen that cannot say which ones already exist is asking them to
   * bill blind. It is idempotent and would come to no harm, and asking anyway is
   * still wrong.
   *
   * The settled half counts as much as the owing half, which is less obvious. It
   * carries the credit line and the bills paid minutes ago, and a payment that
   * vanishes from the board it was just taken on reads as a payment that did not
   * save — which is the one thing an owner will act on twice.
   */
  const boardProblem = worstFailure(owing, settled)

  if (boardProblem !== null) {
    return (
      // Capped and one column: a 7/5 split with an empty rail beside one sentence is
      // most of a laptop screen saying nothing.
      <div className="flex max-w-2xl flex-col gap-5">
        <div>
          <h1 className="text-xl font-bold text-ink lg:text-2xl">{t.title}</h1>
          <p className="mt-1 text-ink-soft">{t.subtitle}</p>
        </div>
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">
            {boardProblem === 'tooLarge' ? t.tooLarge : t.unreadable}
          </p>
        </Card>
      </div>
    )
  }

  return (
    /*
     * TWO LAYOUTS OUT OF ONE DOM, the arrangement steps 2 to 5 of §20.8 use: every block
     * carries an `order-N` matching the sequence a phone draws it in, and the two column
     * wrappers are `display: contents` below `lg`, so on a phone they generate no box and
     * each block is a direct child of the one column again. From `lg` the wrappers become
     * columns and each child's order still ascends inside its own, so one number does both
     * jobs and there is no second ordering to keep in step.
     *
     * Seven columns of the work — the chase door, the board, the search over it — beside
     * five of what the money is: the outstanding total, the once-a-month generator and the
     * three doors that raise a bill the generator never will. Seven and five and not eight
     * and four because the rail holds a 4xl figure and a form, and a figure that wraps is
     * a figure nobody can read at a glance.
     *
     * The rail is written FIRST, and that is not the same as ordering it first: `order`
     * moves nothing for a keyboard or a screen reader. Written last, a phone would tab
     * through three hundred payment forms to reach the generator.
     *
     * What did change on the phone: the three setup doors were three bare links between
     * the generator and the board, so every reader scrolled past a hundred and fifty
     * pixels of monthly errands to reach the list they came for. They are one card below
     * the board now.
     */
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
      <div className="order-1 lg:col-span-12">
        <h1 className="text-xl font-bold text-ink lg:text-2xl">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{t.subtitle}</p>
      </div>

      <div className="contents lg:order-3 lg:col-span-5 lg:flex lg:flex-col lg:gap-5">
        <Card className="order-2 border-brand-200 bg-brand-50">
          <p className="text-sm font-medium text-brand-800">{t.outstanding}</p>
          <p className="num mt-1 text-4xl font-bold text-brand-900">
            {formatTaka(outstanding)}
          </p>
          {/* Directly under the figure, not at the foot of the card. This total is
              a subset — the view inner-joins students and runs security_invoker, so
              a teacher's board carries their own batches and nothing else — and a
              fee number that is quietly short is worse than no number. Whoever
              reads it has to see the boundary in the same glance as the amount. */}
          {!canWrite && (
            <p className="mt-1 text-sm font-medium text-brand-700">{t.yoursOnly}</p>
          )}
          {/* Two counts of people, so both stay in ASCII in either language — the
              owner reads them next to money they will reconcile against a wallet
              statement, and a figure that changes script between screens is a
              figure they have to translate before they can trust it. `.num` on the
              paragraph does the alignment for both. */}
          <p className="num mt-2 text-sm text-brand-800">
            {t.unpaidCount(unpaid.length)} · {t.overdueCount(overdue.length)}
          </p>
          {/* A dash, not a nought, when that one-row sum did not arrive — and the line
              still drawn, because an owner who took ৳40,000 this month and finds the line
              gone will read the absence as the figure. A month genuinely without takings
              keeps no line at all: nought collected on the first of the month is the
              ordinary state, and a ৳0 beside it says nothing the empty space does not. */}
          {(collected === null || collected > 0) && (
            <p className="mt-1 text-sm text-brand-800">
              {t.collectedThisMonth}{' '}
              <span className="num font-semibold">
                {collected === null ? '—' : formatTaka(collected)}
              </span>
            </p>
          )}
          {credit > 0 && (
            <p className="mt-1 text-sm text-brand-800">
              <span className="num font-semibold">{formatTaka(credit)}</span>{' '}
              {t.inCredit}
            </p>
          )}
          {/* The way out of this card and into the month's takings. Inside it rather
              than beside it, because the register is what explains the figure above —
              an owner who wants to know where "collected this month" came from is
              already looking here. Staff-admin only, like the collecting half of the
              board: a teacher reads what their own students owe, not the centre's
              month. The month is named in the URL so the link is bookmarkable and
              still means this month when it is followed next week. */}
          {canWrite && (
            <p className="mt-3 flex flex-col gap-1">
              <Link
                href={`/fees/register?month=${thisMonth}`}
                className="inline-flex min-h-tap items-center font-medium
                  text-brand-800 underline"
              >
                {t.registerLink} →
              </Link>
              {/* And the month as a whole, which is the other question this card
                  provokes. The register says where the money came from; this says
                  whether it was enough — what was owed when the month started, what
                  is left, and what share of the book came in. Not plan-gated, unlike
                  the register: see the note at the head of that page. */}
              <Link
                href={`/fees/close?month=${thisMonth}`}
                className="inline-flex min-h-tap items-center font-medium
                  text-brand-800 underline"
              >
                {t.closeLink} →
              </Link>
              {/* And the money that went the other way, which is the half of the month
                  this card cannot see. Third and last of the three, because the two
                  above answer questions about the figure printed above them and this
                  one changes what that figure means: ৳40,000 collected is a good month
                  or a bad one depending on what the rent was. Here rather than in the
                  bottom bar because five staff-admin tabs already fill that at 320px,
                  and ungated like the register's own link — see the head of the
                  spending page for why a plan that cannot open it is told so there
                  rather than shown a dead end here. */}
              <Link
                href={`/expenses?month=${thisMonth}`}
                className="inline-flex min-h-tap items-center font-medium
                  text-brand-800 underline"
              >
                {t.spendingLink} →
              </Link>
              {/* And the third term of the same subtraction. Spending and salaries are
                  both money going out, but a centre's wage bill is not a bill it pays
                  once — it is an agreement standing behind every month, which is why it
                  has a screen rather than a category on the one above. Last of the four,
                  because it is the only one that is not about this month at all. No
                  `month` in the URL for the same reason: an agreement is not a month. */}
              <Link
                href="/payroll"
                className="inline-flex min-h-tap items-center font-medium
                  text-brand-800 underline"
              >
                {t.payrollLink} →
              </Link>
            </p>
          )}
        </Card>

        {/* Both of these move money or send messages, so both are staff-admin
            only — and absent rather than disabled, because a control a teacher can
            see and never use is a support question every month. */}
        {canWrite && (
          <InvoiceGenerator
            months={months}
            defaultMonth={thisMonth}
            openByDefault={rows.length === 0}
            locale={locale}
            t={d.invoices}
            common={d.common}
            className="order-3"
          />
        )}

        {/* The three ways a bill gets raised that the generator never will, in one card
            rather than three bare links stacked between the generator and the board.
            Underlined text and no borders, like the four links in the total card — a
            bordered row inside a card is the nested container §20.7 says to avoid, and
            three of them would out-shout the board.

            Order 6, so on a phone these come after the list: old dues are loaded once,
            a season's exam fee a few times a year, and an award named when it is agreed.
            None of the three is why anyone opened this screen today. */}
        {canWrite && (
          <Card className="order-6 flex flex-col gap-1">
            <p className="text-sm font-medium text-ink-soft">{t.otherBillsTitle}</p>
            {/* What was already owed before any of this existed. A centre that loads
                three batches this week and two more next month needs it the second
                time as well, so it never hides once the board has rows. */}
            <Link
              href="/fees/arrears"
              className="inline-flex min-h-tap items-center font-medium
                text-brand-800 underline"
            >
              {t.arrearsLink} →
            </Link>
            {/* Admission, registration, exam and form fees (§9.7) — the one that is not
                about monthly tuition at all, and used every season rather than once. */}
            <Link
              href="/fees/charge"
              className="inline-flex min-h-tap items-center font-medium
                text-brand-800 underline"
            >
              {t.chargeLink} →
            </Link>
            {/* Not a way a bill gets raised — a way one gets smaller. Named waivers are
                maintained here and then picked on any row's waiver panel, so the door is
                beside the other two rather than inside a row nobody has opened yet.
                Unconditional: a centre with no awards named is exactly the centre that
                has not found this screen. */}
            <Link
              href="/fees/scholarships"
              className="inline-flex min-h-tap items-center font-medium
                text-brand-800 underline"
            >
              {t.scholarshipsLink} →
            </Link>
          </Card>
        )}
      </div>

      <div className="contents lg:order-2 lg:col-span-7 lg:flex lg:flex-col lg:gap-5">
        {/* Only once something is owed. On an all-paid board it would be a link to
            a screen that can only say "nothing to do", which the empty board
            already says. */}
        {canWrite && unpaid.length > 0 && (
          <ReminderEntry dueToday={dueToday} t={d.reminders} className="order-4" />
        )}

        {/* The board and the two sentences about what is missing from it, in one block
            so the notes cannot end up in a different column from the rows they are
            about. `gap-3` and not the column's `gap-5`: a note explaining the list is
            not a separate panel. */}
        <div className="order-5 flex flex-col gap-3">
          {/* Said once here rather than on two hundred rows. What is missing from each of
              them is the "last chased" line, and a row with no such line is exactly a row
              for a family nobody has contacted — so the one thing an owner cannot see is
              the thirty they saw to this morning. Grey and not amber: the board above it is
              right, every figure on it is real, and this is the one part that is absent. */}
          {canWrite && chaseProblem !== null && (
            <p className="text-sm text-ink-soft">
              {chaseProblem === 'tooLarge' ? t.chaseHistoryTooLarge : t.chaseHistoryUnreadable}
            </p>
          )}

          {/* And the other half of what a reminder says. The chips below still open the
              message, still record the chase, and still name the amount and the deadline
              — what a dropped read takes out is the line telling a parent where to send
              it, which `walletText` blanks for a centre that never set one up as well.
              Said here, once, because the chips cannot say it: the owner is the only
              person who can tell those two apart, and only if somebody tells them. */}
          {canWrite && centerError && unpaid.length > 0 && (
            <p className="text-sm text-ink-soft">{d.chase.payUnreadable}</p>
          )}

          {rows.length === 0 ? (
            <Card>
              <p className="font-medium text-ink">{t.emptyTitle}</p>
              <p className="mt-1 text-sm text-ink-soft">
                {canWrite ? t.emptyBody : t.emptyBodyReadOnly}
              </p>
            </Card>
          ) : (
            <>
              {/* Directly above the list it filters, and below every figure it does
                  not. Nothing is preserved through it because this page has no other
                  search param — the month on the register's links is built fresh from
                  `thisMonth`, not read from the URL. */}
              <SearchBox
                q={query}
                t={d.search}
                count={{ shown: shown.length, total: rows.length }}
              />

              {shown.length === 0 ? (
                /* Not `t.emptyTitle`. "No fees are outstanding" under a filtered list
                   is the app telling an owner the centre is settled up because they
                   mistyped a name — see SearchEmpty. */
                <SearchEmpty t={d.search} />
              ) : (
                <ul className="flex flex-col gap-2">
                  {shown.map((row) => (
                    <PaymentRow
                      key={row.id}
                      row={row}
                      center={centerPay}
                      awards={awards}
                      locale={locale}
                      readOnly={!canWrite}
                      // One object built once for the whole board. Seven groups of words
                      // reach every row, and React sends each distinct value down once
                      // however many rows share it.
                      words={{
                        t: d.feeRow,
                        chase: d.chase,
                        channels: d.channels,
                        cancel: d.cancel,
                        refund: d.refund,
                        discount: d.discount,
                        common: d.common,
                      }}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* Under the board, never above it. These are bills that are already off every
            total — nothing here is owed and nothing here is to be chased — so they must
            not compete with the list of families who do owe money.

            Open for the first handful, folded past that. A cancelled bill leaves the
            board the instant the revalidation lands, so this list appearing is the only
            confirmation the tap gets; on the day an owner closes a batch and cancels
            thirty, that stops being true and burying the board would be the worse
            failure. The count is in the summary either way, so nothing is hidden. */}
        {shownCancelled.length > 0 && (
          <details
            open={shownCancelled.length <= CANCELLED_OPEN_UP_TO}
            className="order-7"
          >
            <summary
              className="flex min-h-tap cursor-pointer list-none items-center
                font-medium text-ink-soft"
            >
              {t.cancelledCount(shownCancelled.length)}
            </summary>
            <p className="mb-2 text-sm text-ink-faint">{t.cancelledBody}</p>
            <ul className="flex flex-col gap-2">
              {shownCancelled.map((bill) => (
                <CancelledRow key={bill.id} bill={bill} locale={locale} t={d.cancel} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}

type ViewRow = {
  id: string | null
  student_name: string | null
  student_code: string | null
  amount_bdt: number | null
  discount_bdt: number | null
  discount_reason: string | null
  discount_percent: number | null
  scholarship_id: string | null
  scholarship_name: string | null
  net_bdt: number | null
  paid_bdt: number | null
  remaining_bdt: number | null
  due_date: string | null
  period_month: string | null
  guardian_phone: string | null
  sms_opt_out: boolean | null
  preferred_channel: OutreachChannel | null
  instalment_no: number | null
  instalment_of: number | null
}

/**
 * A view row as the board needs it.
 *
 * Every column comes back nullable because Postgres cannot prove otherwise
 * through a view, and defaulting a missing amount to 0 is the safe direction: an
 * invoice that renders as ৳0 owed is visibly wrong and gets asked about, whereas
 * ৳NaN takes the whole page down.
 */
function toRow(
  today: string,
  lastChase: Map<string, { on: string; day: string; via: OutreachChannel }>,
  /** `common.unknown`, in the reader's language. See below for why not ''. */
  unknown: string,
) {
  return (v: ViewRow): FeeRow => {
    const chase = v.id ? lastChase.get(v.id) : undefined
    return {
      id: v.id ?? '',
      name: v.student_name ?? unknown,
      studentCode: v.student_code,
      billed: Number(v.amount_bdt ?? 0),
      discount: Number(v.discount_bdt ?? 0),
      // Passed through untouched, including the null. The row renders it only when the
      // owner left words, so an empty string and a null would draw differently for no
      // reason an owner could explain.
      discountReason: v.discount_reason,
      // How the waiver was said, when it was not a figure somebody typed. The share
      // through `Number()` like every other numeric; the id and the name straight
      // through, including their nulls, because the row draws each only when set.
      discountPercent: v.discount_percent === null ? null : Number(v.discount_percent),
      scholarshipId: v.scholarship_id,
      scholarshipName: v.scholarship_name,
      // Which part of an agreed plan this bill is, or nulls on the bills that are not
      // part of one — which is nearly all of them. Through `Number()` because the view
      // hands smallints back as numbers already but a view column is nullable either
      // way, and the row draws the label only when both are set.
      instalmentNo: v.instalment_no === null ? null : Number(v.instalment_no),
      instalmentOf: v.instalment_of === null ? null : Number(v.instalment_of),
      net: Number(v.net_bdt ?? 0),
      paid: Number(v.paid_bdt ?? 0),
      remaining: Number(v.remaining_bdt ?? 0),
      dueDate: v.due_date ?? today,
      // Negative until the due date passes, so a single subtraction tells the row
      // whether to shout.
      daysLate: daysBetween(v.due_date ?? today, today),
      // The invoice's own month, falling back to the due date's. A reminder that
      // named the wrong month would be worse than one that named none.
      periodMonth: v.period_month ?? `${(v.due_date ?? today).slice(0, 7)}-01`,
      // Normalised here rather than trusted from the column, because the deep
      // links need E.164 and a number entered before the validator existed —
      // or edited in the dashboard — may not be in it. Null means no button.
      guardianPhone: normalizeBdMobile(v.guardian_phone),
      // Null defaults to opted-in, matching the column's own default. The row
      // still cannot message a family with no number at all.
      smsOptOut: v.sms_opt_out ?? false,
      // Null is the common case and means nobody has said, which the chips read
      // as "keep the order you have always had". Passed through untouched: the
      // view carries the enum, and inventing a default here would be the product
      // guessing at exactly the thing the owner is being asked to tell it.
      preferredChannel: v.preferred_channel ?? null,
      remindedDay: chase?.day ?? null,
      remindedVia: chase?.via ?? null,
    }
  }
}

/**
 * When a reminder went out, as a person would say it.
 *
 * Takes a Dhaka calendar day, not the raw timestamp: created_at is a timestamptz
 * handed back in UTC, and slicing ten characters off it gives a UTC date, so a
 * reminder sent at 1am Dhaka would read as yesterday. The caller has already made
 * that conversion once for the schedule, and doing it twice invites the two
 * answers to differ.
 *
 * Two words and a date formatter rather than a lookup at the point of use, because
 * the answer travels into a client component as a finished string — the row shows
 * it under "last chased" and has no way to re-derive it.
 */
function dayLabel(
  date: string,
  today: string,
  locale: Locale,
  t: { today: string; yesterday: string },
): string {
  if (!date) return ''
  const gap = daysBetween(date, today)
  // Future is clock skew between the browser, the server and Postgres, and the
  // useful answer for a row stamped a few seconds ahead is still "today".
  if (gap <= 0) return t.today
  if (gap === 1) return t.yesterday
  return formatDate(date, locale)
}
