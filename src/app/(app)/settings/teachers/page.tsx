import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { wouldExceed } from '@/lib/plans'
import { TeacherList, type TeacherRow } from './teacher-list'

export const metadata = { title: 'শিক্ষক — CoachDesk' }

/**
 * Who teaches here and what each of them may do.
 *
 * The permission defaults matter more than they look: a teacher row with no
 * permissions row at all reads as unrestricted downstream, because the SMS gate
 * only closes on an explicit `can_send_sms === false`. bootstrap_center creates
 * the owner's own teacher row that way on purpose — they made the centre — but
 * every teacher added through the form gets a real row.
 */
export default async function TeachersPage() {
  const session = await requireRole('manager')
  const supabase = await createClient()

  const { data: teachers } = await supabase
    .from('teachers')
    .select(
      `id, name, phone, active, user_id,
       teacher_permissions (
         can_manage_students, can_manage_exams, can_send_sms,
         can_view_fees, can_manage_batches
       ),
       teacher_subjects (subjects (name, name_bn)),
       batches (id, active)`,
    )
    .order('name', { ascending: true })

  const rows: TeacherRow[] = (teachers ?? []).map((teacher) => {
    // PostgREST returns a to-one embed as an object and a to-many as an array,
    // and which one you get depends on whether it can see the unique constraint.
    // Handling both is cheaper than depending on that.
    const perms = Array.isArray(teacher.teacher_permissions)
      ? teacher.teacher_permissions[0]
      : teacher.teacher_permissions

    const subjects = (teacher.teacher_subjects ?? [])
      .map((ts) => {
        const subject = Array.isArray(ts.subjects) ? ts.subjects[0] : ts.subjects
        return subject?.name_bn || subject?.name || ''
      })
      .filter(Boolean)

    return {
      id: teacher.id,
      name: teacher.name,
      phone: teacher.phone,
      active: teacher.active,
      // No linked account means they cannot sign in yet — worth surfacing,
      // because an owner who added a teacher expects them to be able to log in.
      hasLogin: Boolean(teacher.user_id),
      subjects,
      batchCount: (teacher.batches ?? []).filter((b) => b.active).length,
      permissions: {
        can_manage_exams: perms?.can_manage_exams ?? true,
        can_send_sms: perms?.can_send_sms ?? true,
        can_manage_students: perms?.can_manage_students ?? false,
        can_manage_batches: perms?.can_manage_batches ?? false,
        can_view_fees: perms?.can_view_fees ?? false,
      },
    }
  })

  const activeCount = rows.filter((r) => r.active).length
  const limit = session.plan.maxTeachers
  const atLimit = wouldExceed(session.plan, 'maxTeachers', activeCount)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← সেটিংস
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">শিক্ষক ও অনুমতি</h1>
        <p className="mt-1 text-ink-soft">
          {limit === null ? (
            <>
              <span className="num">{activeCount}</span> জন শিক্ষক
            </>
          ) : (
            <>
              <span className="num">{activeCount}</span>/
              <span className="num">{limit}</span> জন শিক্ষক
            </>
          )}
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">এখনও কোনো শিক্ষক যোগ হয়নি</h2>
          <p className="mt-1 text-sm text-ink-soft">
            একা পড়ালে শিক্ষক যোগ করার দরকার নেই — আপনি নিজেই শিক্ষক হিসেবে আছেন।
          </p>
        </Card>
      ) : (
        <TeacherList teachers={rows} />
      )}

      {atLimit ? (
        <Card>
          <p className="font-medium text-ink">আরও শিক্ষক যোগ করতে</p>
          <p className="mt-1 text-sm text-ink-soft">
            {session.plan.nameBn} প্ল্যানে{' '}
            <span className="num">{limit}</span> জন শিক্ষক। সেন্টার প্ল্যানে গেলে যত
            জন দরকার তত জন — সব ফিচার একই থাকবে।
          </p>
        </Card>
      ) : (
        <Link
          href="/settings/teachers/new"
          className="flex min-h-tap items-center justify-center rounded-xl border-2
            border-dashed border-brand-300 bg-brand-50/50 px-4 font-medium
            text-brand-700 hover:bg-brand-50"
        >
          + নতুন শিক্ষক যোগ করুন
        </Link>
      )}
    </div>
  )
}
