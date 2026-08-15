import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { wouldExceed } from '@/lib/plans'
import { slotLabel } from '@/lib/bd/schedule'
import { StudentForm } from './student-form'

export const metadata = { title: 'নতুন শিক্ষার্থী — CoachDesk' }

export default async function NewStudentPage() {
  const session = await requireRole('manager')
  const supabase = await createClient()

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

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings/students"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← শিক্ষার্থী
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">নতুন শিক্ষার্থী</h1>
      </div>

      {atLimit ? (
        <Card>
          <p className="font-medium text-ink">
            এই প্ল্যানে আর শিক্ষার্থী যোগ করা যাবে না
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {session.plan.nameBn} প্ল্যানে{' '}
            <span className="num">{session.plan.maxStudents}</span> জন শিক্ষার্থী।
          </p>
        </Card>
      ) : (
        <StudentForm
          batches={(batches ?? []).map((batch) => {
            const subject = Array.isArray(batch.subjects)
              ? batch.subjects[0]
              : batch.subjects
            const parts = [
              batch.name,
              subject?.name_bn || subject?.name,
              slotLabel(batch.slot),
            ].filter(Boolean)
            return { id: batch.id, label: parts.join(' · ') }
          })}
        />
      )}
    </div>
  )
}
