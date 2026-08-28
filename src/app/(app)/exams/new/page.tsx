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
  const scope = isAdmin ? null : await myTeacherIds()

  /*
   * A teacher who holds no teacher row teaches nothing, so the batch read below is
   * skipped rather than sent — and skipped has to be told apart from failed, which
   * is the whole of what this flag is for. Both used to arrive as the same `null`.
   */
  const mine = scope !== null && 'ids' in scope ? scope.ids : null
  const noBatchesOfMine = mine?.length === 0

  /*
   * And a staff list that did not arrive is a third thing, told apart from the other
   * two here rather than by the query.
   *
   * `null` from a staff-admin means "offer every batch in the centre". Read that way,
   * a failed read would have offered a teacher the whole centre's batches on a form
   * whose insert is checked against exams_teacher_insert — so they would pick one,
   * submit, and be told the exam could not be created, which is the exact failure the
   * comment above this was written to remove. Better to say nothing than to offer a
   * choice the boundary will refuse.
   */
  const scopeUnreadable = scope !== null && 'unreadable' in scope

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
    noBatchesOfMine || scopeUnreadable
      ? { data: null }
      : batchQuery.order('start_time', { ascending: true, nullsFirst: false }),
    supabase
      .from('exam_types')
      .select('id, name, name_bn')
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true)
      .order('sort_order', { ascending: true }),
  ])

  /*
   * THE EMPTY CARD BELOW IS A SENTENCE ABOUT THE CENTRE, SO A DROPPED READ MAY NOT
   * BE ALLOWED TO REACH IT.
   *
   * `(batches ?? [])` sent a failed read straight into it, and to an owner that card
   * reads “you need a batch first” under a button that makes one. A centre with nine
   * batches would be told it has none and handed the single control that produces a
   * tenth — so a read that did not arrive ends up as a duplicate batch, which is the
   * expensive kind of duplicate: the students are enrolled on one of them and the
   * exams are set on the other. To a teacher the same empty list says none of the
   * batches around them are theirs, which is a statement about the owner’s
   * permissions that they can do nothing about and would take to the owner.
   *
   * And there is nothing to draw instead. The batch is required, and it is the one
   * field on this form that cannot be typed, so an empty picker is a form that
   * submits nothing whatever the reader does with it.
   */
  const rows: NonNullable<typeof batches> | null = noBatchesOfMine ? [] : batches

  if (rows === null) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/exams"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="text-xl font-bold text-ink">{t.newTitle}</h1>
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.batchesUnreadable}</p>
        </Card>
      </div>
    )
  }

  const batchOptions = rows.map((batch) => {
    const subject = Array.isArray(batch.subjects) ? batch.subjects[0] : batch.subjects
    const parts = [batch.name, localName(subject, locale), slotLabel(batch.slot, locale)]
    return { id: batch.id, label: parts.filter(Boolean).join(' · ') }
  })

  /*
   * The kinds are left failing open, which is the opposite call to the one above and
   * made on the same grounds. Read as empty, this optional picker is not drawn and
   * the exam is created without a kind — a blank the edit screen fills in, on a field
   * that is blank anyway for every centre that has not set any kinds up. Refusing the
   * whole form over it would stop a teacher creating the exam they are standing in
   * front of a class to mark, which is by a wide margin the more expensive mistake.
   */
  const kindOptions = (examTypes ?? []).map((type) => ({
    id: type.id,
    label: localName(type, locale),
  }))

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
          examTypes={kindOptions}
          today={todayInDhaka()}
          t={d.examForm}
          common={d.common}
        />
      )}
    </div>
  )
}
