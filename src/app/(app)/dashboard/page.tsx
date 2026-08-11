import Link from 'next/link'

import { Card } from '@/components/ui'
import { greetingFor } from '@/components/app-shell'
import { requireCenter } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { todayInDhaka, currentPeriodMonth, formatDateBn } from '@/lib/bd/time'
import { sumTaka, tallyOutstanding, formatTaka as taka } from '@/lib/money'

export const metadata = { title: 'ড্যাশবোর্ড — CoachDesk' }

/** One line, not a concatenation — see the same note on the fee board. */
const COLUMNS = 'id, student_name, remaining_bdt, due_date'

/**
 * The owner's screen. Four numbers and a list.
 *
 * The number that sells the product is outstanding fees, so it is largest and
 * first. Everything else on this page exists to make that number trustworthy.
 *
 * Which is why it reads the same view and uses the same arithmetic as the fee
 * board rather than recomputing. This page used to fetch every invoice and every
 * payment and reduce them in JavaScript floats; both screens showed ৳900 while
 * the fees were whole taka, and would have started disagreeing the first time a
 * centre entered 1250.50. Two screens showing the same number two different ways
 * is how an owner finds a discrepancy and stops trusting both.
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
                    {formatDateBn(row.dueDate)}
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
