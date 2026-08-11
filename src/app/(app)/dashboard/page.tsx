import Link from 'next/link'

import { Card } from '@/components/ui'
import { greetingFor } from '@/components/app-shell'
import { requireCenter } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { todayInDhaka, currentPeriodMonth, formatDateBn } from '@/lib/bd/time'

export const metadata = { title: 'ড্যাশবোর্ড — CoachDesk' }

/** ৳ with grouped digits. ASCII numerals on purpose — see toBanglaDigits. */
function taka(amount: number): string {
  return `৳${amount.toLocaleString('en-US')}`
}

/**
 * The owner's screen. Four numbers and a list.
 *
 * The number that sells the product is outstanding fees, so it is largest and
 * first. Everything else on this page exists to make that number trustworthy.
 */
export default async function DashboardPage() {
  const session = await requireCenter()
  const supabase = await createClient()
  const today = todayInDhaka()
  const period = currentPeriodMonth()

  const [
    { count: studentCount },
    { count: batchCount },
    { data: invoices },
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
    // Unvoided invoices only: a voided invoice is a correction, and counting it
    // would show the owner money they are not owed.
    supabase
      .from('fee_invoices')
      .select('id, student_id, amount_bdt, discount_bdt, due_date, students (name)')
      .is('voided_at', null),
    supabase.from('fee_payments').select('invoice_id, amount_bdt, paid_at'),
    supabase
      .from('attendance_sessions')
      .select('batch_id')
      .eq('session_date', today),
  ])

  // Paid-per-invoice, computed here rather than in SQL. At free-tier scale the
  // whole invoice table is a few hundred rows; a view can come later when it
  // is not. Partial payments are normal here — parents pay in instalments —
  // so an invoice is settled only when payments meet the discounted amount.
  const paidByInvoice = new Map<string, number>()
  for (const p of payments ?? []) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + p.amount_bdt)
  }

  let outstanding = 0
  let overdueCount = 0
  const overdue: { name: string; amount: number; dueDate: string }[] = []

  for (const inv of invoices ?? []) {
    const due = inv.amount_bdt - inv.discount_bdt
    const paid = paidByInvoice.get(inv.id) ?? 0
    const remaining = due - paid
    if (remaining <= 0) continue

    outstanding += remaining
    if (inv.due_date < today) {
      overdueCount++
      const student = Array.isArray(inv.students) ? inv.students[0] : inv.students
      overdue.push({
        name: student?.name ?? 'অজানা',
        amount: remaining,
        dueDate: inv.due_date,
      })
    }
  }

  // Collected this month, by payment date rather than by invoice period — the
  // owner is asking "what came in", not "what was billed".
  const monthStart = period
  const collected = (payments ?? [])
    .filter((p) => p.paid_at.slice(0, 10) >= monthStart)
    .reduce((sum, p) => sum + p.amount_bdt, 0)

  overdue.sort((a, b) => b.amount - a.amount)

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
          {overdueCount > 0 ? (
            <>
              <span className="num">{overdueCount}</span> জনের সময় পেরিয়ে গেছে
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
