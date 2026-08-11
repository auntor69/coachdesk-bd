import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { slotLabel } from '@/lib/bd/schedule'
import { todayInDhaka } from '@/lib/bd/time'
import { ExamForm } from './exam-form'

export const metadata = { title: 'নতুন পরীক্ষা — CoachDesk' }

export default async function NewExamPage() {
  await requireRole('teacher')
  const supabase = await createClient()

  // RLS already narrows batches to the ones this teacher teaches, so a teacher
  // cannot create an exam on someone else's batch even by editing the select.
  const [{ data: batches }, { data: examTypes }] = await Promise.all([
    supabase
      .from('batches')
      .select('id, name, slot, subjects (name, name_bn)')
      .eq('active', true)
      .order('start_time', { ascending: true, nullsFirst: false }),
    supabase
      .from('exam_types')
      .select('id, name, name_bn')
      .eq('active', true)
      .order('sort_order', { ascending: true }),
  ])

  const batchOptions = (batches ?? []).map((batch) => {
    const subject = Array.isArray(batch.subjects) ? batch.subjects[0] : batch.subjects
    const parts = [batch.name, subject?.name_bn || subject?.name, slotLabel(batch.slot)]
    return { id: batch.id, label: parts.filter(Boolean).join(' · ') }
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/exams"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← পরীক্ষা
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">নতুন পরীক্ষা</h1>
      </div>

      {batchOptions.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">আগে একটি ব্যাচ দরকার</h2>
          <p className="mt-1 text-sm text-ink-soft">
            পরীক্ষা একটি ব্যাচের জন্য হয় — ব্যাচের শিক্ষার্থীরাই নম্বর দেওয়ার
            তালিকায় আসে।
          </p>
          <Link
            href="/settings/batches/new"
            className="mt-4 inline-flex min-h-tap items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            ব্যাচ তৈরি করুন
          </Link>
        </Card>
      ) : (
        <ExamForm
          batches={batchOptions}
          examTypes={(examTypes ?? []).map((type) => ({
            id: type.id,
            label: type.name_bn || type.name,
          }))}
          today={todayInDhaka()}
        />
      )}
    </div>
  )
}
