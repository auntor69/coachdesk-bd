import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import {
  todayInDhaka,
  currentPeriodMonth,
  addMonths,
  formatMonthBn,
  formatDateBn,
} from '@/lib/bd/time'
import { normalizeBdMobile } from '@/lib/bd/phone'
import { sumTaka, tallyOutstanding, formatTaka } from '@/lib/money'
import type { FeeReminderChannel } from '@/lib/supabase/types'
import { InvoiceGenerator } from './invoice-generator'
import { PaymentRow, type FeeRow } from './payment-row'

export const metadata = { title: 'ফি — CoachDesk' }

/**
 * One line, not a concatenation. supabase-js parses the select string at the
 * type level to work out the row shape, and it can only do that with a string
 * literal — split this across two lines with a `+` and TypeScript widens it to
 * `string`, the parse fails, and every column comes back as GenericStringError.
 */
const COLUMNS = 'id, student_name, student_code, amount_bdt, discount_bdt, net_bdt, paid_bdt, remaining_bdt, due_date, period_month, guardian_phone, sms_opt_out'

/**
 * The fee board — who has paid, who has not, by how many days, and the button
 * that takes the money.
 *
 * This is the screen the product is sold on, so it answers one question at the
 * top (how much is outstanding right now) and makes the next action reachable in
 * one tap. Staff-admin only; a teacher has no business seeing a family's fee
 * status.
 *
 * Every taka on this page is added up by Postgres, not here. amount_bdt is
 * numeric(10, 2), which JavaScript cannot represent exactly, so the per-invoice
 * arithmetic lives in the fee_invoice_balances view and the few cross-row totals
 * go through sumTaka. An owner checks this board against a bKash statement, and
 * a board that is off by a taka is a board they stop believing.
 *
 * What is shown: everything still outstanding, from any month, because old debt
 * is the debt worth chasing — plus this month's settled invoices, so the day's
 * collections stay visible and a payment just recorded does not vanish off the
 * screen along with its confirmation.
 */
export default async function FeesPage() {
  const session = await requireRole('manager')
  const supabase = await createClient()
  const today = todayInDhaka()
  const thisMonth = currentPeriodMonth()

  const [{ data: owing }, { data: settled }, { data: monthPayments }, { data: chased }] =
    await Promise.all([
      supabase
        .from('fee_invoice_balances')
        .select(COLUMNS)
        .is('voided_at', null)
        .gt('remaining_bdt', 0)
        .order('due_date', { ascending: true }),
      supabase
        .from('fee_invoice_balances')
        .select(COLUMNS)
        .is('voided_at', null)
        .lte('remaining_bdt', 0)
        .eq('period_month', thisMonth)
        .order('due_date', { ascending: true }),
      // What actually came in this month, regardless of which month's invoice it
      // settled — a parent clearing June's bill in August is money collected in
      // August, and that is the number the owner is measuring themselves by.
      //
      // The +06:00 offset is load-bearing. paid_at is a timestamptz and the
      // boundary is a Dhaka calendar boundary; comparing against a bare date
      // would place the cutoff at 6am Dhaka and drop the early-morning payments
      // on the 1st into the previous month.
      supabase
        .from('fee_payments')
        .select('amount_bdt')
        .gte('paid_at', `${thisMonth}T00:00:00+06:00`),
      // Reminders since the start of last month, newest first, so each row can
      // say when this family was last chased.
      //
      // Bounded by time rather than by the invoice ids on the board, and the
      // bound is the point rather than an optimisation: the question a row is
      // answering is "have I already dealt with this one recently", and a chase
      // from four months ago is not a reason to hold off today. Two billing
      // cycles is the window in which the answer still changes a decision.
      supabase
        .from('fee_reminders')
        .select('invoice_id, channel, created_at')
        .gte('created_at', `${addMonths(thisMonth, -1)}T00:00:00+06:00`)
        .order('created_at', { ascending: false }),
    ])

  // Newest wins, which is what the descending order above buys: the first row
  // seen for an invoice is its latest reminder, so every later one is skipped.
  const lastChase = new Map<string, { day: string; via: FeeReminderChannel }>()
  for (const r of chased ?? []) {
    if (!r.invoice_id || lastChase.has(r.invoice_id)) continue
    lastChase.set(r.invoice_id, { day: dayLabel(r.created_at, today), via: r.channel })
  }

  // Longest overdue first, then largest amount — the order an owner works down
  // a list in. Settled rows sink to the bottom rather than into a separate list,
  // so a row that has just been paid keeps its React state and its confirmation
  // message instead of being unmounted by the revalidation that follows.
  const rows = [...(owing ?? []), ...(settled ?? [])]
    .map(toRow(today, lastChase))
    .sort(
      (a, b) =>
        Number(b.remaining > 0) - Number(a.remaining > 0)
        || b.daysLate - a.daysLate
        || b.remaining - a.remaining,
    )

  const unpaid = rows.filter((r) => r.remaining > 0)
  const overdue = unpaid.filter((r) => r.daysLate > 0)
  const collected = sumTaka((monthPayments ?? []).map((p) => Number(p.amount_bdt)))

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
    return { value, label: formatMonthBn(value) }
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">ফি</h1>
        <p className="mt-1 text-ink-soft">কে দিয়েছে, কার বাকি</p>
      </div>

      <Card className="border-brand-200 bg-brand-50">
        <p className="text-sm font-medium text-brand-800">মোট বকেয়া</p>
        <p className="num mt-1 text-4xl font-bold text-brand-900">
          {formatTaka(outstanding)}
        </p>
        <p className="mt-2 text-sm text-brand-800">
          <span className="num">{unpaid.length}</span> জনের বাকি ·{' '}
          <span className="num">{overdue.length}</span> জনের সময় পেরিয়ে গেছে
        </p>
        {collected > 0 && (
          <p className="mt-1 text-sm text-brand-800">
            এই মাসে জমা হয়েছে{' '}
            <span className="num font-semibold">{formatTaka(collected)}</span>
          </p>
        )}
        {credit > 0 && (
          <p className="mt-1 text-sm text-brand-800">
            <span className="num font-semibold">{formatTaka(credit)}</span> বেশি
            জমা আছে
          </p>
        )}
      </Card>

      <InvoiceGenerator
        months={months}
        defaultMonth={thisMonth}
        openByDefault={rows.length === 0}
      />

      {rows.length === 0 ? (
        <Card>
          <p className="font-medium text-ink">এখনো কোনো ইনভয়েস নেই</p>
          <p className="mt-1 text-sm text-ink-soft">
            উপরের বোতাম দিয়ে এই মাসের ইনভয়েস তৈরি করুন। প্রতিটি চালু ভর্তির জন্য
            একটি ইনভয়েস তৈরি হবে, ব্যাচের মাসিক ফি অনুযায়ী।
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <PaymentRow
              key={row.id}
              row={row}
              centerName={session.active.centerName}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

type ViewRow = {
  id: string | null
  student_name: string | null
  student_code: string | null
  amount_bdt: number | null
  discount_bdt: number | null
  net_bdt: number | null
  paid_bdt: number | null
  remaining_bdt: number | null
  due_date: string | null
  period_month: string | null
  guardian_phone: string | null
  sms_opt_out: boolean | null
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
  lastChase: Map<string, { day: string; via: FeeReminderChannel }>,
) {
  return (v: ViewRow): FeeRow => {
    const chase = v.id ? lastChase.get(v.id) : undefined
    return {
      id: v.id ?? '',
      name: v.student_name ?? 'অজানা',
      studentCode: v.student_code,
      billed: Number(v.amount_bdt ?? 0),
      discount: Number(v.discount_bdt ?? 0),
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
      remindedDay: chase?.day ?? null,
      remindedVia: chase?.via ?? null,
    }
  }
}

/**
 * When a reminder went out, as a person would say it.
 *
 * The Dhaka conversion is the same trap as paid_at on the collections query:
 * created_at is a timestamptz handed back in UTC, so slicing ten characters off
 * it gives a UTC date, and a reminder sent at 1am Dhaka would read as yesterday.
 * todayInDhaka takes the instant and answers with the Dhaka calendar day.
 */
function dayLabel(iso: string, today: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const date = todayInDhaka(at)
  const gap = daysBetween(date, today)
  // Future is clock skew between the browser, the server and Postgres, and the
  // useful answer for a row stamped a few seconds ahead is still "today".
  if (gap <= 0) return 'আজ'
  if (gap === 1) return 'গতকাল'
  return formatDateBn(date)
}

/**
 * Whole days from `from` to `to`, both YYYY-MM-DD.
 *
 * Parsed as UTC noon rather than midnight: both dates shift by the same amount,
 * so the difference is exact, and noon leaves 12 hours of slack in either
 * direction — enough that no DST or offset quirk can ever round a day away.
 */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`)
  const b = Date.parse(`${to}T12:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}
