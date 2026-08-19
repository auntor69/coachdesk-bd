import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { slotLabel } from '@/lib/bd/schedule'
import { todayInDhaka } from '@/lib/bd/time'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { ExamForm } from './exam-form'

/** getSession, not requireRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).exams.newTitle} — CoachDesk` }
}

export default async function NewExamPage() {
  const session = await requireRole('teacher')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.exams

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
    const parts = [batch.name, localName(subject, locale), slotLabel(batch.slot, locale)]
    return { id: batch.id, label: parts.filter(Boolean).join(' · ') }
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/exams"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.newTitle}</h1>
      </div>

      {batchOptions.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">{t.needBatchTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.needBatchBody}</p>
          <Link
            href="/settings/batches/new"
            className="mt-4 inline-flex min-h-tap items-center justify-center
              rounded-xl bg-brand-600 px-5 font-semibold text-white"
          >
            {t.createBatch}
          </Link>
        </Card>
      ) : (
        <ExamForm
          batches={batchOptions}
          examTypes={(examTypes ?? []).map((type) => ({
            id: type.id,
            label: localName(type, locale),
          }))}
          today={todayInDhaka()}
          t={d.examForm}
          common={d.common}
        />
      )}
    </div>
  )
}
