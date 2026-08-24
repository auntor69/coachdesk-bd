import Link from 'next/link'
import { forbidden } from 'next/navigation'

import { Card } from '@/components/ui'
import { pageCenter, getSession, isStaffAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { has, planName, PLANS } from '@/lib/plans'
import {
  todayInDhaka,
  currentPeriodMonth,
  addMonths,
  formatDate,
  formatMonth,
} from '@/lib/bd/time'
import { sumTaka, formatTaka } from '@/lib/money'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import type { PaymentMethod } from '@/lib/supabase/types'
import { PrintButton } from '../print-button'

/** getSession, not pageCenter — see the note on teach/page.tsx's own. */
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
 * Cash first, then the wallets. The same order as the collection form, so the
 * breakdown at the foot of the register reads down in the order the owner is used
 * to choosing from.
 */
const METHODS: PaymentMethod[] = [
  'cash',
  'bkash',
  'nagad',
  'rocket',
  'bank_transfer',
  'other',
]

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
 * STAFF ADMIN ONLY. A teacher with `can_view_fees` reads their own students'
 * arrears on the board; the centre's takings for the month are not that.
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
  searchParams: Promise<{ month?: string }>
}) {
  const session = await pageCenter()
  if (!isStaffAdmin(session)) forbidden()

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

  const { month: rawMonth } = await searchParams
  // An unparseable month is this month rather than an error. The parameter is in a
  // URL an owner may have edited or a link somebody shared, and a register that
  // refuses to draw is less useful than one that draws the obvious month.
  const month = MONTH_RE.test(rawMonth ?? '') ? (rawMonth as string) : currentPeriodMonth()
  const nextMonth = addMonths(month, 1)

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
  const [{ data: payments }, { data: center }] = await Promise.all([
    supabase
      .from('fee_payments')
      .select(COLUMNS)
      .eq('coaching_center_id', session.active.centerId)
      .gte('paid_at', `${month}T00:00:00+06:00`)
      .lt('paid_at', `${nextMonth}T00:00:00+06:00`)
      .order('paid_at', { ascending: true })
      .order('receipt_no', { ascending: true }),
    // The letterhead, for the same reason the receipt needs one: the shell's header
    // is print:hidden, and a filed register that does not say whose it is will be
    // found in a drawer next year by somebody who has to guess.
    supabase
      .from('coaching_centers')
      .select('name')
      .eq('id', session.active.centerId)
      .maybeSingle(),
  ])

  // The running total is accumulated in toRows rather than asked of Postgres. A
  // window function would be the better answer over thousands of rows; over one
  // centre's month it is at most a few hundred, they are in memory already, and
  // sumTaka is the same rounding the rest of the product uses. What must not happen
  // is two different roundings on one page — the last running total and the grand
  // total are the same number, and a reader who finds them a taka apart stops
  // believing the page.
  const rows = toRows(payments ?? [], d.common.unknown)

  const total = rows.length === 0 ? 0 : rows[rows.length - 1].running
  const byMethod = METHODS.map((m) => ({
    method: m,
    label: d.feeRow.methods[m],
    amount: sumTaka(rows.filter((r) => r.method === m).map((r) => r.amount)),
  })).filter((m) => m.amount !== 0)

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

      {rows.length === 0 ? (
        <Card>
          <p className="text-ink-soft">{t.empty}</p>
        </Card>
      ) : (
        <>
          {/* overflow-x-auto on a phone, and nothing on paper — A4 is wider than
              the widest of these columns needs, so the print sheet has no scroll
              container to strand a column inside. */}
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
                {rows.map((r) => (
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
                    <Td num right>{formatTaka(r.amount)}</Td>
                    <Td num right>{formatTaka(r.running)}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-brand-50 font-bold text-brand-900">
                  <td className="px-2 py-2" colSpan={5}>
                    {t.total} · {t.entries(rows.length)}
                  </td>
                  <td className="num px-2 py-2 text-right" colSpan={2}>
                    {formatTaka(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* The half that can actually be checked against something. Kept out of
              the table's foot so it survives the table breaking across sheets. */}
          <section className="break-inside-avoid rounded-xl border border-line bg-white p-4">
            <h2 className="font-medium text-ink">{t.byMethod}</h2>
            <dl className="mt-2 flex flex-col gap-1.5">
              {byMethod.map((m) => (
                <div key={m.method} className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-soft">{m.label}</dt>
                  <dd className="num font-semibold text-ink">{formatTaka(m.amount)}</dd>
                </div>
              ))}
              <div
                className="mt-1 flex items-baseline justify-between gap-4 border-t
                  border-line pt-2"
              >
                <dt className="font-medium text-ink">{t.total}</dt>
                <dd className="num font-bold text-ink">{formatTaka(total)}</dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </div>
  )
}

type PaymentRow = {
  id: string
  receipt_no: number
  amount_bdt: number
  method: PaymentMethod
  reference: string | null
  paid_at: string
  /**
   * An object for a forward reference, an array when PostgREST cannot prove the
   * cardinality, null when the embed came back empty. All three are in the type
   * because all three are handled below, for the reason the invoice generator
   * handles both shapes: a register row that renders "undefined" where a child's
   * name goes is worse than one that says nothing.
   */
  students:
    | { name: string; student_code: string | null }
    | { name: string; student_code: string | null }[]
    | null
}

type RegisterRow = {
  id: string
  receiptNo: number
  date: string
  name: string
  code: string | null
  method: PaymentMethod
  reference: string | null
  amount: number
  /** The total of this row and every row above it. */
  running: number
}

/**
 * The month's payments as the register needs them, each carrying the total up to
 * and including itself.
 *
 * At module scope, not inlined in the page, and that is not a style preference:
 * accumulating a running total means reassigning something as the list is walked,
 * and the React compiler refuses that for any binding declared inside a component
 * — reassigning after render has completed is how a value ends up disagreeing with
 * what was drawn. Out here there is no render to complete, `running` is a local of
 * a plain function, and the page gets back a finished array it only reads.
 *
 * Every addition goes through sumTaka, so the last running total and the grand
 * total in the footer are the same number. A reader who finds them a taka apart
 * stops believing the page, and this is a page whose whole job is to be believed.
 */
function toRows(
  payments: PaymentRow[],
  /** `common.unknown`, in the reader's language. See the type above for why. */
  unknown: string,
): RegisterRow[] {
  const rows: RegisterRow[] = []
  let running = 0

  for (const p of payments) {
    const student = Array.isArray(p.students) ? p.students[0] : p.students
    const amount = Number(p.amount_bdt)
    running = sumTaka([running, amount])

    rows.push({
      id: p.id,
      receiptNo: p.receipt_no,
      // The Dhaka calendar day, not a slice of the UTC timestamp — a payment taken
      // at 1am would otherwise be dated to the day before on a page whose whole job
      // is to be checked against something else.
      date: todayInDhaka(new Date(p.paid_at)),
      name: student?.name ?? unknown,
      code: student?.student_code ?? null,
      method: p.method,
      reference: p.reference,
      amount,
      running,
    })
  }

  return rows
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
