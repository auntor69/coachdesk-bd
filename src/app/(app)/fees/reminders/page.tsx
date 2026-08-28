import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { pageAll, type PageFailure } from '@/lib/supabase/page'
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
const COLUMNS = 'id, student_name, student_code, remaining_bdt, due_date, period_month, guardian_phone, sms_opt_out, preferred_channel'

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

  const [owing, { data: centerRow, error: centerError }] = await Promise.all([
    // Paged, because this is the list the messages are sent from. PostgREST stops at
    // 1000 rows in silence, one row is one unpaid invoice across every month the
    // centre has billed, and a family past the cut is simply never chased — no gap on
    // the screen, no smaller count, nothing to notice. The board that leads here has
    // the same fix for the same query.
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
    // Where a parent should send the money. Read once for the whole list rather
    // than per row: it is one value for the centre, and every message on this
    // screen is going to name it.
    supabase
      .from('coaching_centers')
      .select('payment_wallet, payment_number')
      .eq('id', session.active.centerId)
      .maybeSingle(),
  ])

  /**
   * The screen when it could not work out today's list.
   *
   * A function because there are two ways to get here and one card to show, and
   * because both of them have to come *before* the arithmetic below rather than be
   * folded into it. Every figure on this page is a claim about who to message, and
   * there is no honest version of that claim built on a read that did not arrive.
   *
   * The back link stays: the fee board says who owes money without needing either of
   * these reads, so it is a real place to be sent rather than a dead end.
   */
  const refusal = (problem: PageFailure) => (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{t.subtitle}</p>
      </div>
      <Card className="border-late/30 bg-late/5">
        <p className="font-medium text-ink">
          {problem === 'tooLarge' ? t.tooLarge : t.unreadable}
        </p>
      </Card>
      <Link
        href="/fees"
        className="inline-flex min-h-tap items-center font-medium text-brand-700"
      >
        ← {t.backToBoard}
      </Link>
    </div>
  )

  /*
   * No invoices read, no worklist — and the reason to stop here rather than carry a
   * null down the page is `chaseEmptyReason`, which answers `nothingOwed` for an
   * empty list. That is the reassuring one of its four: "no unpaid invoice on the
   * board at all", printed on the screen a centre opens to chase its money, in a
   * month where forty families are late. The `?? []` this replaces produced exactly
   * that sentence.
   *
   * Returning before the reminders read below is deliberate too: its window is
   * derived from the oldest invoice, so with no invoices there is nothing to derive
   * it from and no list for its answer to serve.
   */
  if (!('rows' in owing)) return refusal(owing.failed)
  const invoices = owing.rows

  // The window worth reading reminders from: three days before the oldest unpaid
  // invoice's due date, which is the earliest day any stage on this page could
  // have opened. Bounded rather than "every reminder ever" because a centre in its
  // third year has thousands of them and none from last year can change today's
  // answer; ordered ascending above, so the first row is the oldest.
  const earliest = addDays(invoices[0]?.due_date ?? today, -3)

  // Paged for a reason the cooldown depends on. A chase lost past the row ceiling
  // reads as a family never contacted, and this screen's whole job is to decide who
  // may be messaged again today — so the missing row would not hide a reminder, it
  // would send a second one.
  const chases = await pageAll((from, to) =>
    supabase
      .from('fee_reminders')
      .select('invoice_id, created_at')
      .eq('coaching_center_id', session.active.centerId)
      .gte('created_at', `${earliest}T00:00:00+06:00`)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
  )

  /*
   * And this one is the reason the comment above it was written, now that it acts on
   * it. Every row on this screen is a decision not to leave a family alone, and this
   * read is the only thing that knows which families were already contacted. Handed
   * over as an empty list, it does not shorten the worklist — it says nobody has ever
   * been chased, so every family who is inside a stage gets a message today,
   * including the ones messaged this morning.
   *
   * That is the failure this whole feature exists to prevent. reminder-schedule.ts
   * opens by naming it: families who paid attention the first time get chased twice,
   * learn the messages are noise, and stop reading them. A screen that cannot tell
   * who has been contacted has to say so, because the alternative is not a shorter
   * list but a list that costs the centre the trust its messages run on.
   */
  if (!('rows' in chases)) return refusal(chases.failed)

  // Newest per invoice, which the descending order gives for free: the first row
  // seen for an invoice is its latest chase, so every later one is skipped.
  //
  // Converted to a Dhaka calendar day, not sliced off the ISO string. created_at
  // is a timestamptz handed back in UTC, so a reminder sent at 1am Dhaka would
  // otherwise read as yesterday — and yesterday is on the other side of the
  // cooldown, which would let the same family be messaged twice before breakfast.
  const lastChase = new Map<string, string>()
  for (const row of chases.rows) {
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
      // Null means nobody has said, which is the order the chips already have.
      preferredChannel: invoice.preferred_channel ?? null,
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

      {/* Above the list rather than under it, because it is a thing to know before
          the first tap and every tap sends a real message from the owner's own
          handset. Grey and not amber, on the rule the fee board's chase note
          follows: the worklist is right, the amounts are right, and this is the one
          part of what goes out that is missing. See chase.payUnreadable for why it
          does not say "set your number" — that may already be done. */}
      {centerError && groups.length > 0 && (
        <p className="text-sm text-ink-soft">{d.chase.payUnreadable}</p>
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
