import Link from 'next/link'

import { Card } from '@/components/ui'
import { greetingFor } from '@/components/app-shell'
import { requireCenter, isStaffAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import {
  todayInDhaka,
  currentPeriodMonth,
  addMonths,
  formatDate,
} from '@/lib/bd/time'
import { countChasesDue } from '@/lib/fees/reminder-schedule'
import { ratesForDashboard } from '@/lib/attendance/rates'
import { sumTaka, tallyOutstanding, formatTaka as taka } from '@/lib/money'
import { dict } from '@/lib/i18n'
import { ReminderEntry } from '@/app/(app)/fees/reminder-entry'
import { AttendanceRates } from './attendance-rates'

export const metadata = { title: 'ড্যাশবোর্ড — CoachDesk' }

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
  const session = await requireCenter()
  const supabase = await createClient()
  const today = todayInDhaka()
  const period = currentPeriodMonth()

  const [
    { count: studentCount },
    { count: batchCount },
    { data: owing },
    { data: payments },
    { data: todaySessions },
    { data: chased },
    { data: rates },
  ] = await Promise.all([
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('batches')
      .select('id', { count: 'exact', head: true })
      .eq('active', true),
    // Unvoided and still owed. A voided invoice is a correction and counting it
    // would show the owner money they are not owed; a settled one is not owed at
    // all. Every balance here was subtracted by Postgres in numeric(10, 2).
    supabase
      .from('fee_invoice_balances')
      .select(COLUMNS)
      .is('voided_at', null)
      .gt('remaining_bdt', 0),
    // Collected this month, by payment date rather than by invoice period — the
    // owner is asking "what came in", not "what was billed".
    //
    // The +06:00 offset is the whole point of doing this in the query. paid_at is
    // a timestamptz and PostgREST hands it back in UTC, so taking the first ten
    // characters of the string gives a UTC date: a payment at 1am Dhaka on the
    // 1st is 19:00 UTC on the last of the previous month, and would be counted
    // against a month the owner has already closed and reported.
    supabase
      .from('fee_payments')
      .select('amount_bdt')
      .gte('paid_at', `${period}T00:00:00+06:00`),
    supabase
      .from('attendance_sessions')
      .select('batch_id')
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
    supabase
      .from('fee_reminders')
      .select('invoice_id, created_at')
      .gte('created_at', `${addMonths(period, -1)}T00:00:00+06:00`)
      .order('created_at', { ascending: false }),
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
      .eq('batch_active', true)
      .in('period_month', [period, addMonths(period, -1)]),
  ])

  // Same rule as the fee board, so the two screens cannot drift: only positive
  // remainders, never netted against a family in credit. The credit itself is
  // not shown here — it is a detail to act on, and it belongs on the board next
  // to the child's name rather than diluting the one number this card is for.
  const remainders = (owing ?? []).map((r) => Number(r.remaining_bdt ?? 0))
  const { outstanding } = tallyOutstanding(remainders)
  const collected = sumTaka((payments ?? []).map((p) => Number(p.amount_bdt)))

  // Biggest debt first: the call an owner makes before the others.
  const overdue = (owing ?? [])
    .filter((r) => (r.due_date ?? today) < today)
    .map((r) => ({
      name: r.student_name ?? 'অজানা',
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
  for (const r of chased ?? []) {
    if (!r.invoice_id || lastChase.has(r.invoice_id)) continue
    lastChase.set(r.invoice_id, todayInDhaka(new Date(r.created_at)))
  }

  // The same figure the fee board shows, from the same function, so the owner's
  // home screen and the board never advertise two different amounts of work.
  const dueToday = countChasesDue(
    (owing ?? []).map((r) => ({
      dueDate: r.due_date ?? today,
      lastRemindedOn: (r.id && lastChase.get(r.id)) || null,
      reachable: Boolean(r.guardian_phone),
    })),
    today,
  )

  // Owners and managers only. A teacher granted fee visibility can see the
  // numbers on this page, but the worklist itself is staff-admin — offering them
  // a door that answers 403 is worse than not offering it. The same boolean gates
  // the batch-rate card, which the view returns nothing to a teacher for.
  const isAdmin = isStaffAdmin(session)

  // The month the rate card describes and the batches in it, worst first — both
  // decided in one tested place, because both invert without leaving a mark on
  // the screen. See the note on the query for why two months are fetched.
  const { month: rateMonth, rates: batchRates } = ratesForDashboard(rates, period)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">{greetingFor(session)}</h1>
        <p className="mt-1 text-ink-soft">{session.active.centerName}</p>
      </div>

      <Card className="border-brand-200 bg-brand-50">
        <p className="text-sm font-medium text-brand-800">বকেয়া ফি</p>
        <p className="num mt-1 text-4xl font-bold text-brand-900">
          {taka(outstanding)}
        </p>
        <p className="mt-2 text-sm text-brand-800">
          {overdue.length > 0 ? (
            <>
              <span className="num">{overdue.length}</span> জনের সময় পেরিয়ে গেছে
            </>
          ) : (
            'কারও সময় পেরোয়নি'
          )}
        </p>
      </Card>

      {/* Directly under the number it exists to reduce, and above everything
          else on the page. This is the one action on the owner's home screen that
          brings money in rather than reporting on it, and on a 375px phone that
          means it has to be reachable without a scroll. */}
      {isAdmin && remainders.length > 0 && (
        // The rest of this page is still Bangla-only — see the next task. The link
        // is not: it is the fee worklist's own door, and a door that spoke a
        // different language from the room would be the first thing an English
        // reader distrusted.
        <ReminderEntry dueToday={dueToday} t={dict(session.locale).reminders} />
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="এ মাসে আদায়" value={taka(collected)} />
        <Stat label="শিক্ষার্থী" value={String(studentCount ?? 0)} />
        <Stat label="ব্যাচ" value={String(batchCount ?? 0)} />
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-ink">আজকের হাজিরা</p>
            <p className="mt-0.5 text-sm text-ink-soft">
              <span className="num">{todaySessions?.length ?? 0}</span>/
              <span className="num">{batchCount ?? 0}</span> ব্যাচ নেওয়া হয়েছে
            </p>
          </div>
          <Link
            href="/teach"
            className="shrink-0 rounded-lg px-3 py-2 font-medium text-brand-700
              hover:bg-brand-50"
          >
            দেখুন →
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
        />
      )}

      {overdue.length > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="font-semibold text-ink">সময় পেরোনো ফি</h2>
            <Link href="/fees" className="text-sm font-medium text-brand-700">
              সব দেখুন
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
                    {formatDate(row.dueDate)}
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

      {(studentCount ?? 0) === 0 && (
        <Card>
          <h2 className="font-semibold text-ink">শিক্ষার্থী যোগ করুন</h2>
          <p className="mt-1 text-sm text-ink-soft">
            ব্যাচ আর শিক্ষার্থী যোগ করলে হাজিরা, ফলাফল আর ফি — সব এখানে দেখাবে।
          </p>
          <Link
            href="/settings/students/new"
            className="mt-4 inline-flex min-h-tap items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            শিক্ষার্থী যোগ করুন
          </Link>
        </Card>
      )}
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
