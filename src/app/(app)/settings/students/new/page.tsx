import Link from 'next/link'

import { Card } from '@/components/ui'
import { pagePermission, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { wouldExceed, planName } from '@/lib/plans'
import { slotLabel } from '@/lib/bd/schedule'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { StudentForm } from './student-form'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.students.newTitle} — CoachDesk` }
}

export default async function NewStudentPage() {
  const session = await pagePermission('can_manage_students')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.students

  const [{ data: batches }, { count: studentCount }] = await Promise.all([
    supabase
      .from('batches')
      .select('id, name, slot, subjects (name, name_bn)')
      // Scoped as well as governed by RLS: an owner of two centres passes
      // is_staff_admin for both, so the policy alone would offer this centre's
      // student a batch belonging to the other one.
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true)
      .order('start_time', { ascending: true, nullsFirst: false }),
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('status', 'active'),
  ])

  const atLimit = wouldExceed(session.plan, 'maxStudents', studentCount ?? 0)

  /*
   * `null` is passed down as `null`, because the form has something to say about a
   * list that did not arrive and nothing to say about an empty one.
   *
   * Failing open here, unlike the batch form next door and unlike this student's own
   * edit screen. The ticks are optional even when they are drawn; nothing can be
   * overwritten, because the row does not exist yet; and a student admitted into no
   * batch is a state the roster already counts and has a filter for. Refusing would
   * mean turning a family away from the desk over a read that will probably work on
   * the next tap. What the form must not do is stay silent — no batch is no
   * attendance and no fee bill, so the aside there names the way to put it right.
   */
  const batchOptions =
    batches &&
    batches.map((batch) => {
      const subject = Array.isArray(batch.subjects)
        ? batch.subjects[0]
        : batch.subjects
      const parts = [
        batch.name,
        // The reader's own language, not always Bangla: this label is how an owner
        // tells two batches of the same subject apart.
        subject ? localName(subject, locale) : '',
        slotLabel(batch.slot, locale),
      ].filter(Boolean)
      return { id: batch.id, label: parts.join(' · ') }
    })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings/students"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.newTitle}</h1>
      </div>

      {atLimit ? (
        <Card>
          <p className="font-medium text-ink">{t.capTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {/* maxStudents is non-null here: wouldExceed only says yes when it is. */}
            {t.cap(planName(session.plan, locale), session.plan.maxStudents ?? 0)}
          </p>
        </Card>
      ) : (
        <StudentForm
          t={d.studentForm}
          common={d.common}
          batches={batchOptions}
        />
      )}
    </div>
  )
}
