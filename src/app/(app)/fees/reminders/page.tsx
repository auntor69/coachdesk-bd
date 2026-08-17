import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { todayInDhaka, addDays, formatMonthBn } from '@/lib/bd/time'
import { normalizeBdMobile } from '@/lib/bd/phone'
import { sumTaka, formatTaka } from '@/lib/money'
import {
  chaseDecision,
  STAGE_LABEL_BN,
  STAGE_NOTE_BN,
  STAGE_ORDER,
  type ReminderStage,
} from '@/lib/fees/reminder-schedule'
import { ReminderList, type ChaseGroup, type ChaseRow } from '../reminder-list'
import type { ReminderCenter } from '../reminder-chips'

export const metadata = { title: 'আজকের রিমাইন্ডার — CoachDesk' }

/** One line — supabase-js parses this at the type level and only from a literal. */
const COLUMNS = 'id, student_name, student_code, remaining_bdt, due_date, period_month, guardian_phone, sms_opt_out'

/**
 * Today's chase list: the families to message now, and nobody else.
 *
 * The fee board answers "who owes money", which is a filter. This answers "who
 * should I message today", which is a schedule — three days before the deadline,
 * on it, a week after, and every fortnight while it stays unpaid — minus everyone
 * already contacted at their current stage. See reminder-schedule.ts for why the
 * stages are cumulative rather than exact days.
 *
 * The difference between the two screens is the whole feature. Forty outstanding
 * rows is a list an owner does not work through; six rows with a reason attached
 * is one they do. Everything else here follows from that: no filters, no bulk
 * select, nothing to configure, and the list gets shorter as they work.
 *
 * Staff-admin only, like the board — RLS enforces it again underneath.
 *
 * When a sender ID finally exists, the same schedule runs in a cron worker with
 * the same functions and sends these messages without the owner opening anything.
 * Until then the messages go from the owner's own handset, which costs the centre
 * nothing and needs nobody's approval.
 */
export default async function RemindersPage() {
  const session = await requireRole('manager')
  const supabase = await createClient()
  const today = todayInDhaka()

  const [{ data: owing }, { data: centerRow }] = await Promise.all([
    supabase
      .from('fee_invoice_balances')
      .select(COLUMNS)
      .is('voided_at', null)
      .gt('remaining_bdt', 0)
      .order('due_date', { ascending: true }),
    // Where a parent should send the money. Read once for the whole list rather
    // than per row: it is one value for the centre, and every message on this
    // screen is going to name it.
    supabase
      .from('coaching_centers')
      .select('payment_wallet, payment_number')
      .eq('id', session.active.centerId)
      .maybeSingle(),
  ])

  const invoices = owing ?? []

  // The window worth reading reminders from: three days before the oldest unpaid
  // invoice's due date, which is the earliest day any stage on this page could
  // have opened. Bounded rather than "every reminder ever" because a centre in its
  // third year has thousands of them and none from last year can change today's
  // answer; ordered ascending above, so the first row is the oldest.
  const earliest = addDays(invoices[0]?.due_date ?? today, -3)

  const { data: chases } = await supabase
    .from('fee_reminders')
    .select('invoice_id, created_at')
    .gte('created_at', `${earliest}T00:00:00+06:00`)
    .order('created_at', { ascending: false })

  // Newest per invoice, which the descending order gives for free: the first row
  // seen for an invoice is its latest chase, so every later one is skipped.
  //
  // Converted to a Dhaka calendar day, not sliced off the ISO string. created_at
  // is a timestamptz handed back in UTC, so a reminder sent at 1am Dhaka would
  // otherwise read as yesterday — and yesterday is on the other side of the
  // cooldown, which would let the same family be messaged twice before breakfast.
  const lastChase = new Map<string, string>()
  for (const row of chases ?? []) {
    if (!row.invoice_id || lastChase.has(row.invoice_id)) continue
    lastChase.set(row.invoice_id, todayInDhaka(new Date(row.created_at)))
  }

  const buckets = new Map<ReminderStage, ChaseRow[]>()
  /** Owed, due, and impossible to message: no guardian number on file. */
  const unreachable: ChaseRow[] = []
  /** Owed and due, but contacted recently enough that today would be too soon. */
  let held = 0
  /** Owed, and the deadline is not close enough to be worth a message yet. */
  let waiting = 0

  for (const invoice of invoices) {
    const id = invoice.id ?? ''
    if (!id) continue

    const dueDate = invoice.due_date ?? today
    const decision = chaseDecision(
      { dueDate, lastRemindedOn: lastChase.get(id) ?? null },
      today,
    )

    if (!decision.stage) {
      waiting++
      continue
    }
    if (!decision.chase) {
      held++
      continue
    }

    const row: ChaseRow = {
      id,
      name: invoice.student_name ?? 'অজানা',
      studentCode: invoice.student_code,
      remaining: Number(invoice.remaining_bdt ?? 0),
      dueDate,
      daysLate: decision.daysLate,
      periodMonth: invoice.period_month ?? `${dueDate.slice(0, 7)}-01`,
      monthLabel: formatMonthBn(invoice.period_month ?? `${dueDate.slice(0, 7)}-01`),
      cycle: decision.cycle,
      // Normalised here rather than trusted from the column: the deep links need
      // E.164, and a number entered before the validator existed may not be in it.
      guardianPhone: normalizeBdMobile(invoice.guardian_phone),
      smsOptOut: invoice.sms_opt_out ?? false,
    }

    // Pulled out of the schedule entirely rather than shown with a dead chip. A
    // list where four of nine rows cannot be acted on is a list that stops being
    // trusted; these get their own line at the bottom, which is a data problem
    // with a different fix.
    if (!row.guardianPhone) {
      unreachable.push(row)
      continue
    }

    const bucket = buckets.get(decision.stage)
    if (bucket) bucket.push(row)
    else buckets.set(decision.stage, [row])
  }

  // Longest overdue first, then largest amount — the same order the fee board
  // uses, so the two screens never disagree about who is most urgent.
  const bySeverity = (a: ChaseRow, b: ChaseRow) =>
    b.daysLate - a.daysLate || b.remaining - a.remaining

  const groups: ChaseGroup[] = STAGE_ORDER.flatMap((stage) => {
    const rows = buckets.get(stage)
    if (!rows?.length) return []
    return [
      {
        stage,
        label: STAGE_LABEL_BN[stage],
        note: STAGE_NOTE_BN[stage],
        rows: rows.sort(bySeverity),
      },
    ]
  })

  const due = groups.reduce((n, g) => n + g.rows.length, 0)
  const atStake = sumTaka(groups.flatMap((g) => g.rows.map((r) => r.remaining)))

  const center: ReminderCenter = {
    name: session.active.centerName,
    paymentWallet: centerRow?.payment_wallet ?? null,
    paymentNumber: centerRow?.payment_number ?? null,
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">আজকের রিমাইন্ডার</h1>
        <p className="mt-1 text-ink-soft">আজ কাদের মনে করিয়ে দেওয়ার কথা</p>
      </div>

      {due > 0 && (
        <Card className="border-brand-200 bg-brand-50">
          <p className="text-sm font-medium text-brand-800">আজ মনে করাতে হবে</p>
          <p className="mt-1 text-brand-900">
            <span className="num text-4xl font-bold">{due}</span>
            <span className="ml-2 font-semibold">জনকে</span>
          </p>
          <p className="num mt-2 text-sm text-brand-800">
            {formatTaka(atStake)} বাকি এই তালিকায়
          </p>
        </Card>
      )}

      {due === 0 && (
        <Card>
          <p className="font-medium text-ink">আজ কাউকে মনে করানোর দরকার নেই</p>
          <p className="mt-1 text-sm text-ink-soft">
            {/* Three different situations, and an owner deserves to know which one
                they are in. "Nothing to do" reads as a broken screen when they can
                see twelve unpaid rows on the fee board. */}
            {invoices.length === 0
              ? 'কোনো ফি বাকি নেই।'
              : held > 0
                ? 'যাদের বাকি আছে, সবাইকে সম্প্রতি বলা হয়েছে। কয়েক দিন সময় দিন।'
                : 'যে ফি বাকি আছে, তার শেষ তারিখ এখনো আসেনি।'}
          </p>
        </Card>
      )}

      {groups.length > 0 && <ReminderList groups={groups} center={center} />}

      {/* Counted, not listed. These are rows the owner has already dealt with, and
          the only thing worth saying about them is that they were not forgotten. */}
      {(held > 0 || waiting > 0) && (
        <p className="text-sm text-ink-faint">
          {held > 0 && (
            <>
              <span className="num">{held}</span> জনকে সম্প্রতি বলা হয়েছে
            </>
          )}
          {held > 0 && waiting > 0 && ' · '}
          {waiting > 0 && (
            <>
              <span className="num">{waiting}</span> জনের শেষ তারিখ এখনো আসেনি
            </>
          )}
        </p>
      )}

      {unreachable.length > 0 && (
        <Card>
          <p className="font-medium text-ink">
            <span className="num">{unreachable.length}</span> জনের অভিভাবকের নম্বর নেই
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            নম্বর ছাড়া মনে করিয়ে দেওয়ার উপায় নেই —{' '}
            {unreachable.map((r) => r.name).join(', ')}
          </p>
          <Link
            href="/settings/students"
            className="mt-3 inline-flex min-h-tap items-center font-medium text-brand-700"
          >
            নম্বর যোগ করুন →
          </Link>
        </Card>
      )}

      <Link
        href="/fees"
        className="inline-flex min-h-tap items-center font-medium text-brand-700"
      >
        ← ফি বোর্ডে ফিরুন
      </Link>
    </div>
  )
}
