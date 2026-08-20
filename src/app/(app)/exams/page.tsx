import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/bd/time'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  return { title: `${dict(session?.locale ?? DEFAULT_LOCALE).exams.title} — CoachDesk` }
}

/**
 * Exams a teacher can enter marks for, newest first.
 *
 * The SMS state is on the row rather than buried in a detail screen, because
 * "did the parents get told" is the question a teacher actually has, and the
 * answer costs the centre money if they guess wrong and send twice.
 */
export default async function ExamsPage() {
  const session = await pageRole('teacher')
  const supabase = await createClient()
  const locale = session.locale
  const t = dict(locale).exams

  const { data: exams } = await supabase
    .from('exams')
    .select(
      `id, title, total_marks, exam_date, sms_sent_at, sms_declined_at,
       batches (name), subjects (name, name_bn), exam_results (id)`,
    )
    .eq('coaching_center_id', session.active.centerId)
    .order('exam_date', { ascending: false })
    .limit(30)

  const rows = (exams ?? []).map((exam) => {
    const batch = Array.isArray(exam.batches) ? exam.batches[0] : exam.batches
    const subject = Array.isArray(exam.subjects) ? exam.subjects[0] : exam.subjects
    return {
      id: exam.id,
      title: exam.title,
      // Number(), like the marks sheet: total_marks is numeric, so it arrives as
      // "100.00" and rendering it raw showed a full mark nobody typed.
      totalMarks: Number(exam.total_marks),
      examDate: exam.exam_date,
      batchName: batch?.name ?? '',
      subjectName: localName(subject, locale),
      resultCount: (exam.exam_results ?? []).length,
      smsSent: Boolean(exam.sms_sent_at),
      smsDeclined: Boolean(exam.sms_declined_at),
    }
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">{t.title}</h1>
          <p className="mt-1 text-ink-soft">{t.subtitle}</p>
        </div>
        <Link
          href="/exams/new"
          className="inline-flex min-h-tap shrink-0 items-center justify-center
            rounded-xl bg-brand-600 px-5 font-semibold text-white"
        >
          {t.new}
        </Link>
      </div>

      {rows.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.emptyBody}</p>
          <Link
            href="/exams/new"
            className="mt-4 inline-flex min-h-tap items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            {t.create}
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
                    {formatDate(row.examDate, locale)} · {t.fullMarks}{' '}
                    <span className="num">{row.totalMarks}</span>
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="num text-sm font-semibold text-ink">
                    {row.resultCount}
                  </p>
                  <p className="text-xs text-ink-faint">{t.marked}</p>
                  {row.smsSent && (
                    <p className="mt-1 text-xs font-medium text-brand-700">
                      {t.smsSent}
                    </p>
                  )}
                  {row.smsDeclined && !row.smsSent && (
                    <p className="mt-1 text-xs text-ink-faint">{t.smsNotSent}</p>
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
