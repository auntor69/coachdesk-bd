import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { branchChoicesFor } from '@/lib/branches'
import { createClient } from '@/lib/supabase/server'
import { hasStaff } from '@/lib/plans'
import { SLOT_ORDER, slotLabel } from '@/lib/bd/schedule'
import { WEEK_ORDER, dayNameShort } from '@/lib/bd/time'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { BatchEditForm } from './edit-form'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.batches.editTitle} — CoachDesk` }
}

/**
 * One batch, and everything about it an owner can change.
 *
 * `pageRole('manager')`, not `pagePermission('can_manage_batches')` — the guard on
 * the two screens either side of this one. That box grants INSERT on batches and
 * their schedules and deliberately no UPDATE (20260811000019): it says "open a new
 * batch", and repricing the class an owner already sells is not that. The list only
 * shows the link to the roles that have it.
 *
 * Every active subject and teacher in the centre is offered, plus this batch's own
 * even if either has since been switched off — the picker is the only way the field
 * changes, so an option missing from it is a field that can never be corrected, and
 * a batch whose teacher has left would silently reassign itself to whoever sorts
 * first the moment somebody saved a new fee.
 */
export default async function BatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>
}) {
  const { batchId } = await params
  const session = await pageRole('manager')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.batches

  const [batchRow, { data: subjects }, { data: teachers }, branches] = await Promise.all([
    supabase
      .from('batches')
      .select(
        `id, name, subject_id, teacher_id, slot, start_time, end_time,
         monthly_fee_bdt, active, branch_id,
         subjects (id, name, name_bn), teachers (id, name),
         batch_schedules (day_of_week)`,
      )
      // Scoped as well as governed by RLS: an owner of two centres satisfies
      // is_staff_admin for both, so the policy alone would open a batch belonging
      // to the other one.
      .eq('coaching_center_id', session.active.centerId)
      .eq('id', batchId)
      .maybeSingle(),
    supabase
      .from('subjects')
      .select('id, name, name_bn')
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true)
      .order('name'),
    supabase
      .from('teachers')
      .select('id, name')
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true)
      .order('name'),
    // Which building the class is in, for the head office of an organisation with more
    // than one. `null` for everybody else and no query for them — see branchChoicesFor.
    branchChoicesFor(supabase, session),
  ])

  // Destructured on its own line, because `error` decides one of the two answers
  // below and the array above has no room left for it.
  const { data: batch, error: batchError } = batchRow

  const back = (
    <Link
      href="/settings/batches"
      className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
    >
      ← {t.title}
    </Link>
  )

  /*
   * The read that failed, ahead of the row that is not there — see the same pair on
   * the student edit screen, which this follows exactly.
   *
   * `errors.notFound` is the sentence for a stale tab, and it was answering a dropped
   * read as well: "that batch could not be found", about a batch with forty students
   * enrolled on it. An owner who believes that makes the batch again, and then has two
   * — one with the enrolments, the register and the fee history on it, and one with
   * the timetable they just typed.
   */
  if (batchError) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{t.batchUnreadable}</p>
        </Card>
      </div>
    )
  }

  // notFound() would be the reflex, but a missing batch here is far more often a
  // stale tab than a wrong url. See the same note on the student screen.
  if (!batch) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <p className="text-ink">{t.errors.notFound}</p>
      </div>
    )
  }

  const ownSubject = Array.isArray(batch.subjects) ? batch.subjects[0] : batch.subjects
  const ownTeacher = Array.isArray(batch.teachers) ? batch.teachers[0] : batch.teachers

  /*
   * This batch's own subject first if the centre has since switched it off, so the
   * select has something to match and the field can still be changed away from it.
   *
   * The same line also makes this the one edit screen where `?? []` on the option
   * list is safe, which is worth saying out loud now that the screens around it have
   * been changed. A failed read leaves the list empty; the unshift below then puts
   * this batch's current subject into it, so the picker is still drawn, still
   * matches, and still submits the value it is showing. Narrowed, but never wrong —
   * and never able to write null over the column the way the exam edit form's kind
   * once could, because that field had nothing to fall back on.
   */
  const subjectOptions = (subjects ?? []).map((s) => ({
    id: s.id,
    label: localName(s, locale),
  }))
  if (ownSubject && !subjectOptions.some((s) => s.id === ownSubject.id)) {
    subjectOptions.unshift({ id: ownSubject.id, label: localName(ownSubject, locale) })
  }

  /*
   * Empty on a one-teacher plan, which hides the picker — see the note on the new
   * batch form. The form then carries the current teacher through unchanged rather
   * than submitting nothing and clearing the column, because a field the form chose
   * not to ask about is not a field the owner cleared.
   */
  const teacherOptions = hasStaff(session.plan)
    ? (teachers ?? []).map((teacher) => ({ id: teacher.id, label: teacher.name }))
    : []
  if (
    teacherOptions.length > 0
    && ownTeacher
    && !teacherOptions.some((teacher) => teacher.id === ownTeacher.id)
  ) {
    teacherOptions.unshift({ id: ownTeacher.id, label: ownTeacher.name })
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        {back}
        <h1 className="mt-1 truncate text-xl font-bold text-ink">{batch.name}</h1>
        <p className="mt-1 text-ink-soft">{t.editTitle}</p>
      </div>

      <BatchEditForm
        t={d.batchForm}
        common={d.common}
        branchPick={d.branchPick}
        branches={branches}
        batch={{
          id: batch.id,
          name: batch.name,
          subjectId: batch.subject_id,
          teacherId: batch.teacher_id ?? '',
          slot: batch.slot ?? '',
          // The columns are `time`, which arrives as "07:00:00" — an <input
          // type="time"> takes the first five characters of that and nothing longer.
          startTime: (batch.start_time ?? '').slice(0, 5),
          endTime: (batch.end_time ?? '').slice(0, 5),
          fee: Number(batch.monthly_fee_bdt),
          active: batch.active,
          branchId: batch.branch_id,
          days: (batch.batch_schedules ?? []).map((s) => s.day_of_week),
        }}
        subjects={subjectOptions}
        teachers={teacherOptions}
        slots={SLOT_ORDER.map((slot) => ({ value: slot, label: slotLabel(slot, locale) }))}
        days={WEEK_ORDER.map((day) => ({ value: day, label: dayNameShort(day, locale) }))}
      />
    </div>
  )
}
