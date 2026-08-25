import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { todayInDhaka, addDays, formatMonth } from '@/lib/bd/time'
import { normalizeBdMobile } from '@/lib/bd/phone'
import { sumTaka, formatTaka } from '@/lib/money'
import {
  chaseDecision,
  chaseEmptyReason,
  STAGE_ORDER,
  type ReminderStage,
} from '@/lib/fees/reminder-schedule'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { ReminderList, type ChaseGroup, type ChaseRow } from '../reminder-list'
import type { ReminderCenter } from '../reminder-chips'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return {
    title: `${dict(session?.locale ?? DEFAULT_LOCALE).reminders.title} — CoachDesk`,
  }
}

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
  const session = await pageRole('manager')
  const supabase = await createClient()
  const today = todayInDhaka()
  const locale = session.locale
  const d = dict(locale)
  const t = d.reminders

  const [{ data: owing }, { data: centerRow }] = await Promise.all([
    supabase
      .from('fee_invoice_balances')
      .select(COLUMNS)
      .eq('coaching_center_id', session.active.centerId)
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
    .eq('coaching_center_id', session.active.centerId)
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
      name: invoice.student_name ?? d.common.unknown,
      studentCode: invoice.student_code,
      remaining: Number(invoice.remaining_bdt ?? 0),
      dueDate,
      daysLate: decision.daysLate,
      periodMonth: invoice.period_month ?? `${dueDate.slice(0, 7)}-01`,
      monthLabel: formatMonth(
        invoice.period_month ?? `${dueDate.slice(0, 7)}-01`,
        locale,
      ),
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
        label: t.stages[stage],
        note: t.stageNotes[stage],
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

  /**
   * Whether to say "nothing to do", and which of the four things that means.
   *
   * One value for both, so the card and its sentence can never disagree — the last
   * version asked `due === 0` for the card and a separate ternary for the text, and
   * the ternary had a case the card did not. See chaseEmptyReason for the ordering.
   */
  const emptyReason = chaseEmptyReason({
    owing: invoices.length,
    due,
    held,
    waiting,
    unreachable: unreachable.length,
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{t.subtitle}</p>
      </div>

      {due > 0 && (
        <Card className="border-brand-200 bg-brand-50">
          <p className="text-sm font-medium text-brand-800">{t.dueTitle}</p>
          {/* Still two nodes: the count is the largest thing on the screen and the
              word beside it is not, so this one sentence keeps its markup where
              the rest of the page gave it up. Both languages read
              number-then-word. */}
          <p className="mt-1 text-brand-900">
            <span className="num text-4xl font-bold">{due}</span>
            <span className="ml-2 font-semibold">{t.people(due)}</span>
          </p>
          <p className="num mt-2 text-sm text-brand-800">
            {formatTaka(atStake)} {t.atStake}
          </p>
        </Card>
      )}

      {emptyReason && (
        <Card>
          <p className="font-medium text-ink">{t.noneTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.noneBecause[emptyReason]}</p>
        </Card>
      )}

      {groups.length > 0 && (
        <ReminderList
          groups={groups}
          center={center}
          locale={locale}
          words={{
            t: d.chaseList,
            chase: d.chase,
            channels: d.channels,
            common: d.common,
          }}
        />
      )}

      {/* Counted, not listed. These are rows the owner has already dealt with, and
          the only thing worth saying about them is that they were not forgotten. */}
      {(held > 0 || waiting > 0) && (
        <p className="num text-sm text-ink-faint">
          {held > 0 && t.heldCount(held)}
          {held > 0 && waiting > 0 && ' · '}
          {waiting > 0 && t.waitingCount(waiting)}
        </p>
      )}

      {unreachable.length > 0 && (
        <Card>
          <p className="num font-medium text-ink">
            {t.unreachableTitle(unreachable.length)}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {t.unreachableBody(unreachable.map((r) => r.name).join(', '))}
          </p>
          <Link
            href="/settings/students"
            className="mt-3 inline-flex min-h-tap items-center font-medium text-brand-700"
          >
            {t.addNumbers} →
          </Link>
        </Card>
      )}

      <Link
        href="/fees"
        className="inline-flex min-h-tap items-center font-medium text-brand-700"
      >
        ← {t.backToBoard}
      </Link>
    </div>
  )
}
