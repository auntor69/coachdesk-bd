import { Card } from '@/components/ui'
import { greetingFor } from '@/components/app-shell'
import { requireCenter } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatDateBn, todayInDhaka } from '@/lib/bd/time'

export const metadata = { title: 'আমার — CoachDesk' }

function taka(amount: number): string {
  return `৳${amount.toLocaleString('en-US')}`
}

/**
 * What a student or guardian sees.
 *
 * RLS already restricts every table below to this person's own records — a
 * student sees themselves, a guardian sees their children — so there is no
 * student_id filter here. If a filter were the only thing separating one
 * family's data from another's, a typo would be a breach.
 */
export default async function MePage() {
  const session = await requireCenter()
  const supabase = await createClient()
  const today = todayInDhaka()

  const [{ data: students }, { data: invoices }, { data: payments }, { data: results }] =
    await Promise.all([
      supabase.from('students').select('id, name, class_level, institution'),
      supabase
        .from('fee_invoices')
        .select('id, student_id, amount_bdt, discount_bdt, due_date')
        .is('voided_at', null),
      supabase.from('fee_payments').select('invoice_id, amount_bdt'),
      supabase
        .from('exam_results')
        .select('id, obtained_marks, is_absent, exams (title, total_marks, exam_date)')
        .order('created_at', { ascending: false })
        .limit(5),
    ])

  const paidByInvoice = new Map<string, number>()
  for (const p of payments ?? []) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + p.amount_bdt)
  }

  const dues = (invoices ?? [])
    .map((inv) => ({
      studentId: inv.student_id,
      dueDate: inv.due_date,
      remaining: inv.amount_bdt - inv.discount_bdt - (paidByInvoice.get(inv.id) ?? 0),
    }))
    .filter((d) => d.remaining > 0)

  const totalDue = dues.reduce((sum, d) => sum + d.remaining, 0)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">{greetingFor(session)}</h1>
        <p className="mt-1 text-ink-soft">{session.active.centerName}</p>
      </div>

      {(students ?? []).map((student) => {
        const studentDues = dues.filter((d) => d.studentId === student.id)
        return (
          <Card key={student.id}>
            <p className="font-semibold text-ink">{student.name}</p>
            {(student.class_level || student.institution) && (
              <p className="mt-0.5 text-sm text-ink-soft">
                {[student.class_level, student.institution].filter(Boolean).join(' · ')}
              </p>
            )}
            {studentDues.length > 0 && (
              <p className="mt-3 text-sm">
                <span className="font-medium text-absent">
                  বকেয়া{' '}
                  <span className="num">
                    {taka(studentDues.reduce((s, d) => s + d.remaining, 0))}
                  </span>
                </span>
                {studentDues.some((d) => d.dueDate < today) && (
                  <span className="text-ink-soft"> · সময় পেরিয়ে গেছে</span>
                )}
              </p>
            )}
          </Card>
        )
      })}

      {totalDue === 0 && (students ?? []).length > 0 && (
        <Card className="border-brand-200 bg-brand-50">
          <p className="font-medium text-brand-800">সব ফি পরিশোধ করা আছে ✓</p>
        </Card>
      )}

      {(results ?? []).length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold text-ink">সাম্প্রতিক ফলাফল</h2>
          <ul className="flex flex-col gap-2">
            {(results ?? []).map((result) => {
              const exam = Array.isArray(result.exams) ? result.exams[0] : result.exams
              if (!exam) return null
              return (
                <li
                  key={result.id}
                  className="flex items-center justify-between gap-3 rounded-xl
                    border border-line bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{exam.title}</p>
                    <p className="text-sm text-ink-faint">
                      {formatDateBn(exam.exam_date)}
                    </p>
                  </div>
                  <span className="num shrink-0 font-semibold text-ink">
                    {result.is_absent ? (
                      <span className="text-absent">অনুপস্থিত</span>
                    ) : (
                      <>
                        {result.obtained_marks ?? '—'}/{exam.total_marks}
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {(students ?? []).length === 0 && (
        <Card>
          <p className="text-ink-soft">
            আপনার তথ্য এখনও যোগ করা হয়নি। কোচিং সেন্টারে যোগাযোগ করুন।
          </p>
        </Card>
      )}
    </div>
  )
}
