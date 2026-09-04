import Link from 'next/link'

import { Card } from '@/components/ui'
import { PageHeader } from '@/components/page-header'
import { pageCapability, getSession } from '@/lib/auth/session'
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

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
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
 * Staff-admin only, like the board — RLS enforces it again underneath — and `fees` rather
 * than `messages` (§6.2), which is the schema's own answer: `fee_reminders` is one of the
 * three tables 20260811000063 puts behind the fee word, because a chase says what a family
 * owes. Without it the list is empty, which reads as a centre where nobody is behind.
 *
 * When a sender ID finally exists, the same schedule runs in a cron worker with
 * the same functions and sends these messages without the owner opening anything.
 * Until then the messages go from the owner's own handset, which costs the centre
 * nothing and needs nobody's approval.
 */
export default async function RemindersPage() {
  const session = await pageCapability('fees')
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
   * The letterhead and the way out, written once for all three of this page's screens.
   *
   * The link is in the bar now, at the top. It was the last thing on the page, which on a
   * centre with forty families to chase put the only way back below forty rows — and the
   * fee board it returns to needs neither of the reads below, so it is a real place to be
   * sent from a screen that failed rather than a dead end.
   *
   * A fragment held in a const, and every one of the three uses puts it directly in the
   * screen's own tall column. It cannot be wrapped in a box of its own or dropped into the
   * grid as a cell: a sticky box only travels inside its containing block, and either of
   * those gives it one about 90px tall.
   */
  const bar = (
    <PageHeader
      title={t.title}
      back={{ href: '/fees', label: t.backToBoard }}
      subtitle={t.subtitle}
    />
  )

  /**
   * The screen when it could not work out today's list.
   *
   * A function because there are two ways to get here and one card to show, and
   * because both of them have to come *before* the arithmetic below rather than be
   * folded into it. Every figure on this page is a claim about who to message, and
   * there is no honest version of that claim built on a read that did not arrive.
   *
   * One column, and the cap is on the card rather than on the column: an 8/4 split with
   * an empty rail beside one sentence is most of a laptop screen saying nothing, and a bar
   * capped at 672px would stop short of the workspace edges the other two shapes reach.
   */
  const refusal = (problem: PageFailure) => (
    <div className="flex flex-col gap-5">
      {bar}
      <Card className="max-w-2xl border-late/30 bg-late/5">
        <p className="font-medium text-ink">
          {problem === 'tooLarge' ? t.tooLarge : t.unreadable}
        </p>
      </Card>
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

  /**
   * Counted, not listed. These are rows the owner has already dealt with or does not
   * have to yet, and the only thing worth saying about them is that they were not
   * forgotten — a count of families is what accounts for the rest of the register.
   */
  const counted = (held > 0 || waiting > 0) && (
    <p className="order-3 num text-sm text-ink-faint">
      {held > 0 && t.heldCount(held)}
      {held > 0 && waiting > 0 && ' · '}
      {waiting > 0 && t.waitingCount(waiting)}
    </p>
  )

  /** Owed, due, and impossible to message — a data problem, with the door to its fix. */
  const missing = unreachable.length > 0 && (
    <Card className="order-4">
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
  )

  /*
   * The day with nobody to remind, which is its own screen rather than a gap in the
   * one below: no worklist means no rail to put beside it, and `emptyReason` is null
   * exactly when `due` is, so reaching past here is reaching a list with rows in it.
   *
   * Both counted blocks keep the rail's `order-N` — in one column they sort to where
   * they were written anyway, and one definition cannot drift from the other.
   */
  if (emptyReason !== null) {
    return (
      <div className="flex flex-col gap-5">
        {bar}
        <Card className="max-w-2xl">
          <p className="font-medium text-ink">{t.noneTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.noneBecause[emptyReason]}</p>
        </Card>
        {counted}
        {missing}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {bar}

      {/*
       * TWO LAYOUTS OUT OF ONE DOM, the arrangement steps 2 to 5 of §20.8 use: each block
       * carries an `order-N` matching the sequence a phone draws it in, and the rail is
       * `display: contents` below `lg`, so on a phone it generates no box and every block
       * is a direct child of the one column again.
       *
       * Eight columns of work beside four of what is at stake, and the rail sticks. The
       * fault it fixes: an owner working down forty families had the count, the amount and
       * the families with no number on file scroll away above and below the list — and the
       * amount is the thing that decides whether the next twenty minutes are worth it.
       *
       * The rail is written FIRST and drawn second, which is not a contradiction: `order`
       * moves nothing for a keyboard or a screen reader. Written last, the way to reach
       * "add numbers" would be a hundred and twenty chips of tabbing.
       *
       * The grid is nested under the bar rather than holding it as a twelfth-column cell,
       * because a sticky box only travels inside its containing block and a cell's block is
       * one grid row. That is also why the phone sequence starts at one and not at two: the
       * letterhead was the first of five blocks, and the four left renumbered down.
       */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
        {/* `top-16` is the page bar's 56px plus 8px — see components/page-header.tsx. */}
        <div
          className="contents lg:sticky lg:top-16 lg:order-2 lg:col-span-4 lg:flex
            lg:flex-col lg:gap-5"
        >
          <Card className="order-1 border-brand-200 bg-brand-50">
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

          {counted}
          {missing}
        </div>

        {/* The list and the one sentence about what its messages will be missing, in one
            block so the note cannot end up in a column away from the rows it is about.
            Unconditional on `groups` now, because the return above took the empty case. */}
        <div className="order-2 flex flex-col gap-3 lg:order-1 lg:col-span-8">
          {/* Before the first tap, because every tap sends a real message from the owner's
              own handset. Grey and not amber, on the rule the fee board's chase note
              follows: the worklist is right, the amounts are right, and this is the one
              part of what goes out that is missing. */}
          {centerError && <p className="text-sm text-ink-soft">{d.chase.payUnreadable}</p>}

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
        </div>
      </div>
    </div>
  )
}
