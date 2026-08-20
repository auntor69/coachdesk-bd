import Link from 'next/link'
import { forbidden } from 'next/navigation'

import { Card } from '@/components/ui'
import {
  pageRole,
  getSession,
  isStaffAdmin,
  myTeacherIds,
  canManageExams,
} from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { slotLabel } from '@/lib/bd/schedule'
import { todayInDhaka } from '@/lib/bd/time'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { ExamForm } from './exam-form'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).exams.newTitle} — CoachDesk` }
}

export default async function NewExamPage() {
  const session = await pageRole('teacher')

  // The owner's "Exams & marks" tick, and a 403 rather than a form that would fail
  // on submit. /exams no longer links here for a teacher without it, but a
  // bookmark, a back button and a typed URL all still arrive.
  //
  // Free for an owner on any plan: canManageExams answers from the role before it
  // reaches a query, so a solo teacher-plan owner — who has no staff, no
  // permissions row and no settings screen to tick anything on — is never asked.
  if (!(await canManageExams())) forbidden()

  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.exams

  // Which batches this reader may actually put an exam on.
  //
  // The comment that used to be here said RLS already narrowed this list, and it
  // was wrong in the same way /teach's was: batches_member_read admits every batch
  // in the centre, so the select offered a teacher all nine and the insert then
  // failed against exams_teacher_insert with "the exam could not be created" — a
  // message that reads like a bug in the product rather than a batch that was never
  // theirs. The boundary is real; this list simply has to agree with it beforehand.
  const isAdmin = isStaffAdmin(session)
  const mine = isAdmin ? null : await myTeacherIds()

  let batchQuery = supabase
    .from('batches')
    .select('id, name, slot, subjects (name, name_bn)')
    .eq('coaching_center_id', session.active.centerId)
    .eq('active', true)

  if (mine) batchQuery = batchQuery.in('teacher_id', mine)

  const [{ data: batches }, { data: examTypes }] = await Promise.all([
    // An empty `mine` would be `in.()`, which PostgREST accepts and answers with
    // nothing — but the ordering has to come last, so the filter cannot be applied
    // after `.order()` returns a transform builder that no longer has `.in()`.
    mine?.length === 0
      ? { data: null }
      : batchQuery.order('start_time', { ascending: true, nullsFirst: false }),
    supabase
      .from('exam_types')
      .select('id, name, name_bn')
      .eq('coaching_center_id', session.active.centerId)
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
        // Two different emptinesses. An owner has no batches at the centre yet and
        // one tap fixes it; a teacher has batches all around them and none of them
        // theirs, so the door to /settings/batches/new answers 403 and the words
        // "create a batch" are advice they cannot take. /teach's own pair of
        // sentences, borrowed rather than restated, because it is the same fact
        // about the same reader.
        <Card>
          <h2 className="font-semibold text-ink">
            {isAdmin ? t.needBatchTitle : d.teach.noBatchesTitle}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            {isAdmin ? t.needBatchBody : d.teach.noBatchesBody}
          </p>
          {isAdmin && (
            <Link
              href="/settings/batches/new"
              className="mt-4 inline-flex min-h-tap items-center justify-center
                rounded-xl bg-brand-600 px-5 font-semibold text-white"
            >
              {t.createBatch}
            </Link>
          )}
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
