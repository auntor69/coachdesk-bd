import Link from 'next/link'

import { pageRole, getSession } from '@/lib/auth/session'
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

  const [{ data: batch }, { data: subjects }, { data: teachers }] = await Promise.all([
    supabase
      .from('batches')
      .select(
        `id, name, subject_id, teacher_id, slot, start_time, end_time,
         monthly_fee_bdt, active,
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
  ])

  const back = (
    <Link
      href="/settings/batches"
      className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
    >
      ← {t.title}
    </Link>
  )

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

  // This batch's own subject first if the centre has since switched it off, so the
  // select has something to match and the field can still be changed away from it.
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
