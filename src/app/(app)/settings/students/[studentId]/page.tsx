import Link from 'next/link'

import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { slotLabel } from '@/lib/bd/schedule'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { StudentEditForm } from './edit-form'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.students.editTitle} — CoachDesk` }
}

/**
 * One student, and everything about them an owner can change.
 *
 * `pageRole('manager')` and not `pagePermission('can_manage_students')`, which is
 * the guard on the three screens either side of this one. That box grants SELECT and
 * INSERT — see 20260811000019 — and deliberately no UPDATE, because it is labelled
 * "admit students" and rewriting a guardian's mobile number is not admitting
 * anybody. A teacher who can add a student still cannot edit one, and the roster
 * only shows them the link when they can.
 *
 * Every batch in the centre is offered, not only the ones this student is in: the
 * checkbox list *is* the way batches change, so a batch missing from it is a batch
 * the student can never be moved into.
 */
export default async function StudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>
}) {
  const { studentId } = await params
  const session = await pageRole('manager')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.students

  const [{ data: student }, { data: batches }] = await Promise.all([
    supabase
      .from('students')
      .select(
        `id, name, student_code, phone, guardian_name, guardian_phone,
         institution, class_level, status,
         enrollments (batch_id, status)`,
      )
      // Scoped as well as governed by RLS: an owner of two centres passes
      // is_staff_admin for both, so the policy alone would open a student
      // belonging to the other one.
      .eq('coaching_center_id', session.active.centerId)
      .eq('id', studentId)
      .maybeSingle(),
    supabase
      .from('batches')
      .select('id, name, slot, subjects (name, name_bn)')
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true)
      .order('start_time', { ascending: true, nullsFirst: false }),
  ])

  const back = (
    <Link
      href="/settings/students"
      className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
    >
      ← {t.title}
    </Link>
  )

  // notFound() would be the reflex, but a missing student here is far more often
  // a stale tab than a wrong url — the row was open when somebody else changed it.
  // A 404 shell with no way back to the roster is the wrong end of that.
  if (!student) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <p className="text-ink">{t.errors.notFound}</p>
      </div>
    )
  }

  // Both, because a paused enrolment is one the form should show ticked: it is the
  // batch the student comes back to, and unticking it is how an owner says they are
  // not coming back to that one.
  const enrolled = (student.enrollments ?? [])
    .filter((e) => e.status === 'active' || e.status === 'paused')
    .map((e) => e.batch_id)

  return (
    <div className="flex flex-col gap-5">
      <div>
        {back}
        <h1 className="mt-1 truncate text-xl font-bold text-ink">{student.name}</h1>
        <p className="mt-1 text-ink-soft">{t.editTitle}</p>
      </div>

      <StudentEditForm
        t={d.studentForm}
        common={d.common}
        student={{
          id: student.id,
          name: student.name,
          status: student.status,
          code: student.student_code ?? '',
          phone: student.phone ?? '',
          guardianName: student.guardian_name ?? '',
          guardianPhone: student.guardian_phone ?? '',
          institution: student.institution ?? '',
          classLevel: student.class_level ?? '',
          batchIds: enrolled,
        }}
        batches={(batches ?? []).map((batch) => {
          const subject = Array.isArray(batch.subjects)
            ? batch.subjects[0]
            : batch.subjects
          const parts = [
            batch.name,
            // The reader's own language — see the note on the new-student form.
            subject ? localName(subject, locale) : '',
            slotLabel(batch.slot, locale),
          ].filter(Boolean)
          return { id: batch.id, label: parts.join(' · ') }
        })}
      />
    </div>
  )
}
