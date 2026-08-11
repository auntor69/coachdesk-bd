import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { todayInDhaka, formatDateBn } from '@/lib/bd/time'

export const metadata = { title: 'ফি — CoachDesk' }

function taka(amount: number): string {
  return `৳${amount.toLocaleString('en-US')}`
}

/**
 * The fee board — who has paid, who has not, and by how many days.
 *
 * This is the screen that sells the product, so it answers exactly one question
 * and puts the answer at the top: how much money is outstanding right now.
 * Staff-admin only; a teacher has no business seeing a family's fee status.
 */
export default async function FeesPage() {
  await requireRole('manager')
  const supabase = await createClient()
  const today = todayInDhaka()

  const [{ data: invoices }, { data: payments }] = await Promise.all([
    supabase
      .from('fee_invoices')
      .select(
        'id, amount_bdt, discount_bdt, due_date, period_month, students (name, guardian_phone)',
      )
      .is('voided_at', null)
      .order('due_date', { ascending: true }),
    supabase.from('fee_payments').select('invoice_id, amount_bdt'),
  ])

  const paidByInvoice = new Map<string, number>()
  for (const p of payments ?? []) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + p.amount_bdt)
  }

  const rows = (invoices ?? [])
    .map((inv) => {
      const student = Array.isArray(inv.students) ? inv.students[0] : inv.students
      const due = inv.amount_bdt - inv.discount_bdt
      const paid = paidByInvoice.get(inv.id) ?? 0
      return {
        id: inv.id,
        name: student?.name ?? 'অজানা',
        due,
        paid,
        remaining: due - paid,
        dueDate: inv.due_date,
        // Negative until the due date passes, which is how the sort puts the
        // longest-overdue first without a second comparison.
        daysLate: daysBetween(inv.due_date, today),
      }
    })
    .filter((r) => r.remaining > 0)
    .sort((a, b) => b.daysLate - a.daysLate || b.remaining - a.remaining)

  const outstanding = rows.reduce((sum, r) => sum + r.remaining, 0)
  const overdue = rows.filter((r) => r.daysLate > 0)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">ফি</h1>
        <p className="mt-1 text-ink-soft">যাদের ফি বাকি আছে</p>
      </div>

      <Card className="border-brand-200 bg-brand-50">
        <p className="text-sm font-medium text-brand-800">মোট বকেয়া</p>
        <p className="num mt-1 text-4xl font-bold text-brand-900">{taka(outstanding)}</p>
        <p className="mt-2 text-sm text-brand-800">
          <span className="num">{rows.length}</span> জনের বাকি ·{' '}
          <span className="num">{overdue.length}</span> জনের সময় পেরিয়ে গেছে
        </p>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <p className="font-medium text-ink">সব ফি পরিশোধ করা আছে ✓</p>
          <p className="mt-1 text-sm text-ink-soft">
            নতুন মাসের ইনভয়েস তৈরি হলে এখানে দেখা যাবে।
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-xl
                border border-line bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{row.name}</p>
                <p className="text-sm text-ink-faint">
                  {formatDateBn(row.dueDate)}
                  {row.daysLate > 0 && (
                    <span className="font-medium text-absent">
                      {' '}
                      · <span className="num">{row.daysLate}</span> দিন দেরি
                    </span>
                  )}
                </p>
                {row.paid > 0 && (
                  <p className="num text-sm text-ink-soft">
                    {taka(row.paid)} / {taka(row.due)} দেওয়া হয়েছে
                  </p>
                )}
              </div>
              <span
                className={`num shrink-0 font-semibold ${
                  row.daysLate > 0 ? 'text-absent' : 'text-ink'
                }`}
              >
                {taka(row.remaining)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
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
