import Link from 'next/link'

import { Card } from '@/components/ui'
import { SearchBox, SearchEmpty } from '@/components/search-box'
import { pageCapability, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { pageAll, worstFailure } from '@/lib/supabase/page'
import { has, planName, PLANS } from '@/lib/plans'
import {
  currentPeriodMonth,
  addMonths,
  formatDate,
  formatMonth,
} from '@/lib/bd/time'
import { formatTaka } from '@/lib/money'
import { searchTerms, matchesSearch, MAX_QUERY } from '@/lib/search'
import { registerRows, tallyRegister } from '@/lib/fees/register'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { PrintButton } from '../print-button'

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).register.title} — CoachDesk` }
}

/**
 * One line, not a concatenation — see the note on the fee board's own COLUMNS for
 * what splitting this across two lines does to type inference.
 */
const COLUMNS = 'id, receipt_no, amount_bdt, method, reference, paid_at, students (name, student_code)'

/** First day of a month, and nothing that merely looks like one. */
const MONTH_RE = /^\d{4}-\d{2}-01$/

/**
 * The month's collection register: every taka that came in, in the order it came,
 * with a running total and a breakdown by method.
 *
 * This is the reconciliation screen, and it exists because the fee board cannot be
 * one. The board answers "who owes what", which is a question about invoices; this
 * answers "what came in", which is a question about money — a parent clearing
 * June's bill in August is August's collection, and the two views disagree by
 * design.
 *
 * THE RUNNING TOTAL IS A COLUMN, not a footer. An owner holding a bKash statement
 * against this page works down both until they stop agreeing, and that is only
 * possible if every row carries the total up to it. A single figure at the bottom
 * tells them the answer is wrong and nothing about where.
 *
 * THE BREAKDOWN BY METHOD is the other half of the same job. A bKash statement does
 * not know about the cash in the drawer, so "৳48,000 collected" cannot be checked
 * against anything; "৳31,500 through bKash" can be checked against exactly one
 * thing, and what is left has to be in the box.
 *
 * A REFUND IS A ROW THAT SAYS SO. It reaches this page as a negative payment, which
 * is the product's only way of handing money back, and the arithmetic needs no
 * special case for it — but the sheet does. The row is labelled in words, and the
 * foot of the page carries what came in and what went back out above the total, so a
 * collection smaller than the reader was expecting has its subtraction printed next
 * to it instead of looking like a fault in the software. The sums are in
 * lib/fees/register.ts, where they are tested; this file draws them.
 *
 * STAFF ADMIN ONLY, AND `fees` (§6.2). A teacher with `can_view_fees` reads their own
 * students' arrears on the board; the centre's takings for the month are not that. And
 * 20260811000063 narrows `fee_payments` on the read, so a manager whose owner unticked the
 * word would get this sheet with no rows and a month's takings of ৳0 — a statement about
 * the centre's business rather than about their own permissions.
 *
 * THE SEARCH BOX FILTERS THE SHEET AND NOTHING ELSE — not the running column, not
 * the foot, not the breakdown. That is the opposite of what a filter usually means
 * and it is the only version that is any use here: an owner searching a
 * transaction ID is trying to find one line in a statement they are working down,
 * and a running total that restarted at their query would answer a question about
 * a month that does not exist. So every figure stays the month's, the running
 * column still says what the month had taken by that row, and the count above the
 * table — which prints, unlike the box — says the sheet is a part of itself.
 *
 * AND A PAID PLAN ONLY, which it did not used to be. The argument for leaving it
 * open was that a solo owner reconciles a month the same way an institution does,
 * and that is still true — but a paid teacher tier has to sell something, and the
 * free tier is one batch of thirty, where the fee board already answers who paid
 * what. Reconciling thirty students against a bKash statement is an afternoon's
 * scrolling rather than an impossibility. The screen stays reachable and says so
 * rather than 404ing, for the reason every other locked screen here does.
 */
export default async function RegisterPage({
  searchParams,
}: {
  // A Promise in Next 16, and awaiting it is not optional.
  searchParams: Promise<{ month?: string; q?: string }>
}) {
  const session = await pageCapability('fees')

  const locale = session.locale
  const d = dict(locale)
  const t = d.register

  // Before the queries, not after: this branch draws none of the register, so
  // reading a month of payments to throw them away would be work done for a
  // screen that cannot show them.
  if (!has(session.plan, 'printedReceipts')) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/fees"
          className="inline-flex min-h-tap items-center font-medium text-brand-700"
        >
          ← {t.backToFees}
        </Link>
        <Card>
          <h1 className="font-semibold text-ink">{t.paperTitle}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {t.paperBody(
              planName(session.plan, locale),
              planName(PLANS.teacher_plus, locale),
            )}
          </p>
        </Card>
      </div>
    )
  }

  const { month: rawMonth, q: rawQuery } = await searchParams
  // An unparseable month is this month rather than an error. The parameter is in a
  // URL an owner may have edited or a link somebody shared, and a register that
  // refuses to draw is less useful than one that draws the obvious month.
  const month = MONTH_RE.test(rawMonth ?? '') ? (rawMonth as string) : currentPeriodMonth()
  const nextMonth = addMonths(month, 1)
  const query = (rawQuery ?? '').slice(0, MAX_QUERY)
  const terms = searchTerms(query)

  const supabase = await createClient()

  // The +06:00 offsets are load-bearing, exactly as on the fee board. paid_at is a
  // timestamptz and these are Dhaka calendar boundaries; compared against bare
  // dates the cutoff lands at 6am Dhaka, and every payment taken before breakfast
  // on the 1st is counted in the wrong month — in a figure whose entire purpose is
  // to be reconciled against a statement that got it right.
  //
  // Half-open on purpose: >= the first instant of this month, < the first instant of
  // the next. A `lte` on the last day would drop or double whatever was taken in
  // the final second of the month depending on how the boundary was written.
  const [payments, { data: center }] = await Promise.all([
    // Paged, and on this page the ceiling is not a rounding error but a false
    // reconciliation. A register is read line by line against a bKash statement; one
    // that stops at a thousand receipts looks complete, foots correctly, and is short
    // by however many payments came after — and the owner's conclusion is that money
    // is missing from the wallet rather than from the page. `.order('id')` last, so
    // the offset walk is deterministic without disturbing the printed order.
    //
    // pageAll rather than pageOrNull for the same reason stated one step further: a
    // null read as an empty month is a register that foots to zero, which is not a
    // short sheet but a blank one, printed and filed under this month's name.
    pageAll((from, to) =>
      supabase
        .from('fee_payments')
        .select(COLUMNS)
        .eq('coaching_center_id', session.active.centerId)
        .gte('paid_at', `${month}T00:00:00+06:00`)
        .lt('paid_at', `${nextMonth}T00:00:00+06:00`)
        .order('paid_at', { ascending: true })
        .order('receipt_no', { ascending: true })
        .order('id')
        .range(from, to),
    ),
    // The letterhead, for the same reason the receipt needs one: the shell's header
    // is print:hidden, and a filed register that does not say whose it is will be
    // found in a drawer next year by somebody who has to guess.
    supabase
      .from('coaching_centers')
      .select('name')
      .eq('id', session.active.centerId)
      .maybeSingle(),
  ])

  const registerProblem = worstFailure(payments)

  // The running total is accumulated row by row rather than asked of Postgres. A
  // window function would be the better answer over thousands of rows; over one
  // centre's month it is at most a few hundred, they are in memory already, and
  // sumTaka is the same rounding the rest of the product uses. What must not happen
  // is two different roundings on one page — the last running total and the grand
  // total are the same number, and a reader who finds them a taka apart stops
  // believing the page.
  const rows = registerRows('rows' in payments ? payments.rows : null, d.common.unknown)
  const tally = tallyRegister(rows)

  // Which rows the sheet draws, and the only thing the query touches. `tally` is
  // already fixed above against the whole month, and each row's `running` was
  // accumulated over the whole month too — so a filtered sheet shows the real
  // running total at each of the lines it kept, which is exactly what somebody
  // matching a wallet statement needs. The four fields are the identifiers the row
  // actually prints: the name, the student's code, the receipt number a parent
  // quotes, and the transaction ID on the statement.
  const shown = terms.length === 0
    ? rows
    : rows.filter((r) =>
        matchesSearch([r.name, r.code, String(r.receiptNo), r.reference], terms),
      )

  // This month and the eleven before it. Backwards only: a register is a record of
  // what happened, and there is nothing to record in a month that has not started.
  const months = Array.from({ length: 12 }, (_, i) => {
    const value = addMonths(currentPeriodMonth(), -i)
    return { value, label: formatMonth(value, locale) }
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 print:hidden">
        <Link
          href="/fees"
          className="inline-flex min-h-tap items-center font-medium text-brand-700"
        >
          ← {t.backToFees}
        </Link>
        <PrintButton label={t.print} />
      </div>

      {/* A plain GET form: no client component, no JavaScript, and the chosen month
          ends up in the URL where it can be bookmarked, shared, or printed from
          again next year. The submit button is not decoration — Android Chrome does
          not fire a navigation on a bare <select> change, so a form that relied on
          onChange would need JavaScript to do what a button does for free. */}
      <form method="get" className="flex items-end gap-2 print:hidden">
        {/* Carries the search across a change of month, because "the same family,
            last month" is the commonest second question an owner asks here. */}
        {query && <input type="hidden" name="q" value={query} />}
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="font-medium text-ink">{t.month}</span>
          <select
            name="month"
            defaultValue={month}
            className="min-h-tap w-full rounded-xl border-2 border-line bg-white px-3
              font-medium text-ink"
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex min-h-tap shrink-0 items-center rounded-xl border-2
            border-brand-500 bg-brand-50 px-4 font-medium text-brand-800"
        >
          {t.show}
        </button>
      </form>

      <header>
        <h1 className="text-xl font-bold text-ink">
          {center?.name ?? session.active.centerName}
        </h1>
        <p className="font-medium text-ink-soft">
          {t.title} · {formatMonth(month, locale)}
        </p>
      </header>

      {registerProblem !== null ? (
        /* No lines and no breakdown, unlike the search-miss case below which keeps
           both. There the month's total is still true and only the visible lines were
           narrowed; here nothing was read, so every figure on the sheet would be a
           statement about the centre that we have no basis for. This one is worth
           printing badly rather than printing wrong. */
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">
            {registerProblem === 'tooLarge' ? t.tooLarge : t.unreadable}
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-ink-soft">{t.empty}</p>
        </Card>
      ) : (
        <>
          {/* Between the letterhead and the table, so the printed sheet reads
              "CENTRE / register / August / showing 5 of 120" in that order — the
              caveat lands before the rows it applies to rather than after them. */}
          <SearchBox
            q={query}
            t={d.search}
            placeholder={d.search.placeholderPayments}
            // The month, or clearing the box would silently throw the reader back
            // to the current one — from a sheet they had chosen deliberately.
            keep={{ month }}
            count={{ shown: shown.length, total: rows.length }}
          />

          {shown.length === 0 ? (
            /* Not `t.empty` — "no money was recorded this month" is a statement
               about the centre, and printing it because somebody mistyped a
               transaction ID would be the sheet contradicting its own total. The
               breakdown below stays: it is still the month's, and still true. */
            <SearchEmpty t={d.search} />
          ) : (
          /* overflow-x-auto on a phone, and nothing on paper — A4 is wider than
              the widest of these columns needs, so the print sheet has no scroll
              container to strand a column inside. */
          <div className="-mx-4 overflow-x-auto px-4 print:mx-0 print:overflow-visible print:px-0">
            <table className="w-full min-w-[42rem] border-collapse text-sm">
              <thead>
                {/* The header repeats at the top of every printed sheet — a
                    three-page register whose second page is unlabelled columns is
                    a register nobody can read. */}
                <tr className="border-b-2 border-line text-left align-bottom">
                  <Th>{t.colDate}</Th>
                  <Th num>{t.colReceipt}</Th>
                  <Th>{t.colStudent}</Th>
                  <Th>{t.colMethod}</Th>
                  <Th>{t.colReference}</Th>
                  <Th num right>{t.colAmount}</Th>
                  <Th num right>{t.colRunning}</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-line break-inside-avoid align-top"
                  >
                    <Td num>{formatDate(r.date, locale)}</Td>
                    <Td num>
                      {/* Every row links to its own slip, which is what makes a
                          parent walking in with "I paid in July" a thirty-second
                          job: find the month, find the name, tap the number. */}
                      <Link
                        href={`/fees/receipt/${r.id}`}
                        className="font-medium text-brand-700 underline print:text-ink
                          print:no-underline"
                      >
                        {r.receiptNo}
                      </Link>
                    </Td>
                    <Td>
                      {r.name}
                      {r.code && (
                        <span className="num ml-1.5 text-ink-faint">{r.code}</span>
                      )}
                    </Td>
                    <Td>{d.feeRow.methods[r.method]}</Td>
                    <Td num>{r.reference ?? '—'}</Td>
                    <Td num right>
                      {/* The word above the figure and not beside it, so it cannot be
                          pushed off the end of a narrow column, and above rather than
                          below so the eye meets it on the way to the number it
                          qualifies. Words and not a colour: these sheets are printed
                          on the cheapest black-and-white laser in the building. The
                          figure keeps its sign, unlike the receipt's — the column next
                          to it is a running total somebody works down by hand. */}
                      {r.refund && (
                        <span className="block font-medium text-ink-soft">
                          {t.refundLabel}
                        </span>
                      )}
                      {formatTaka(r.amount)}
                    </Td>
                    <Td num right>{formatTaka(r.running)}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {/* Still the month's, on a filtered sheet as much as on a whole
                    one. `tally` was taken before the query was applied — see the
                    note at the head of this file for why a running total that
                    restarted at somebody's search would be worse than useless. */}
                <tr className="bg-brand-50 font-bold text-brand-900">
                  <td className="px-2 py-2" colSpan={5}>
                    {t.total} · {t.entries(tally.entries)}
                  </td>
                  <td className="num px-2 py-2 text-right" colSpan={2}>
                    {formatTaka(tally.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          )}
          {/* The half that can actually be checked against something. Kept out of
              the table's foot so it survives the table breaking across sheets. */}
          <section className="break-inside-avoid rounded-xl border border-line bg-white p-4">
            <h2 className="font-medium text-ink">{t.byMethod}</h2>
            <dl className="mt-2 flex flex-col gap-1.5">
              {tally.byMethod.map((m) => (
                <div key={m.method} className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-soft">{d.feeRow.methods[m.method]}</dt>
                  <dd className="num font-semibold text-ink">{formatTaka(m.amount)}</dd>
                </div>
              ))}
              {/* What came in and what went back, above the total and only in a month
                  that had a refund in it. Two addends and their sum, in that order, so
                  a total smaller than the reader expected explains itself where it is
                  read. A month with no refunds gets neither line: "ফেরত ৳০" is a figure
                  an owner would stop and check, and there is no month in which that is
                  time well spent. */}
              {tally.refunded !== 0 && (
                <>
                  <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line pt-2">
                    <dt className="text-ink-soft">{t.grossIn}</dt>
                    <dd className="num font-semibold text-ink">{formatTaka(tally.grossIn)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-ink-soft">{t.refunded}</dt>
                    <dd className="num font-semibold text-ink">{formatTaka(tally.refunded)}</dd>
                  </div>
                </>
              )}
              <div
                className="mt-1 flex items-baseline justify-between gap-4 border-t
                  border-line pt-2"
              >
                <dt className="font-medium text-ink">{t.total}</dt>
                <dd className="num font-bold text-ink">{formatTaka(tally.total)}</dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </div>
  )
}

function Th({
  children,
  num = false,
  right = false,
}: {
  children: React.ReactNode
  num?: boolean
  right?: boolean
}) {
  return (
    <th
      scope="col"
      className={`px-2 pb-2 font-medium text-ink-soft ${num ? 'num' : ''} ${
        right ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  num = false,
  right = false,
}: {
  children: React.ReactNode
  num?: boolean
  right?: boolean
}) {
  return (
    <td
      className={`px-2 py-2 text-ink ${num ? 'num' : ''} ${right ? 'text-right' : ''}`}
    >
      {children}
    </td>
  )
}
