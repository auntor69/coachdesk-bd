import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/bd/time'

export const metadata = { title: 'পরীক্ষা — CoachDesk' }

/**
 * Exams a teacher can enter marks for, newest first.
 *
 * The SMS state is on the row rather than buried in a detail screen, because
 * "did the parents get told" is the question a teacher actually has, and the
 * answer costs the centre money if they guess wrong and send twice.
 */
export default async function ExamsPage() {
  await requireRole('teacher')
  const supabase = await createClient()

  const { data: exams } = await supabase
    .from('exams')
    .select(
      `id, title, total_marks, exam_date, sms_sent_at, sms_declined_at,
       batches (name), subjects (name, name_bn), exam_results (id)`,
    )
    .order('exam_date', { ascending: false })
    .limit(30)

  const rows = (exams ?? []).map((exam) => {
    const batch = Array.isArray(exam.batches) ? exam.batches[0] : exam.batches
    const subject = Array.isArray(exam.subjects) ? exam.subjects[0] : exam.subjects
    return {
      id: exam.id,
      title: exam.title,
      totalMarks: exam.total_marks,
      examDate: exam.exam_date,
      batchName: batch?.name ?? '',
      subjectName: subject?.name_bn || subject?.name || '',
      resultCount: (exam.exam_results ?? []).length,
      smsSent: Boolean(exam.sms_sent_at),
      smsDeclined: Boolean(exam.sms_declined_at),
    }
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">পরীক্ষা</h1>
          <p className="mt-1 text-ink-soft">নম্বর দিন, ফলাফল অভিভাবককে জানান</p>
        </div>
        <Link
          href="/exams/new"
          className="inline-flex min-h-tap shrink-0 items-center justify-center
            rounded-xl bg-brand-600 px-5 font-semibold text-white"
        >
          নতুন
        </Link>
      </div>

      {rows.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">এখনও কোনো পরীক্ষা নেই</h2>
          <p className="mt-1 text-sm text-ink-soft">
            পরীক্ষা তৈরি করলে ব্যাচের সব শিক্ষার্থীর নাম নম্বর দেওয়ার জন্য
            একসাথে চলে আসবে।
          </p>
          <Link
            href="/exams/new"
            className="mt-4 inline-flex min-h-tap items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            পরীক্ষা তৈরি করুন
          </Link>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/exams/${row.id}`}
                className="flex items-center gap-3 rounded-xl border border-line
                  bg-white px-4 py-3 transition-colors hover:border-brand-300"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{row.title}</p>
                  <p className="truncate text-sm text-ink-soft">
                    {[row.batchName, row.subjectName].filter(Boolean).join(' · ')}
                  </p>
                  <p className="text-sm text-ink-faint">
                    {formatDate(row.examDate)} · পূর্ণমান{' '}
                    <span className="num">{row.totalMarks}</span>
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="num text-sm font-semibold text-ink">
                    {row.resultCount}
                  </p>
                  <p className="text-xs text-ink-faint">নম্বর দেওয়া</p>
                  {row.smsSent && (
                    <p className="mt-1 text-xs font-medium text-brand-700">
                      SMS পাঠানো ✓
                    </p>
                  )}
                  {row.smsDeclined && !row.smsSent && (
                    <p className="mt-1 text-xs text-ink-faint">SMS পাঠানো হয়নি</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
