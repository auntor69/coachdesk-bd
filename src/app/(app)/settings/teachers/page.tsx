import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { formatBdMobile } from '@/lib/bd/phone'

export const metadata = { title: 'শিক্ষক — CoachDesk' }

/**
 * Who teaches here and what each of them may do.
 *
 * Permissions are per-teacher rather than per-role because real centres are not
 * tidy: one senior teacher collects fees and edits the roster, another only
 * marks attendance. A single "teacher" role would force every centre into the
 * most permissive version of itself.
 */
export default async function TeachersPage() {
  const session = await requireRole('manager')
  const supabase = await createClient()

  const { data: teachers } = await supabase
    .from('teachers')
    .select(
      `id, name, phone, active, user_id,
       teacher_permissions (can_manage_students, can_view_fees, can_send_sms),
       teacher_subjects (subjects (name, name_bn)),
       batches (id, active)`,
    )
    .order('name', { ascending: true })

  const rows = (teachers ?? []).map((teacher) => {
    const perms = Array.isArray(teacher.teacher_permissions)
      ? teacher.teacher_permissions[0]
      : teacher.teacher_permissions
    const subjects = (teacher.teacher_subjects ?? [])
      .map((ts) => {
        const subject = Array.isArray(ts.subjects) ? ts.subjects[0] : ts.subjects
        return subject?.name_bn || subject?.name || ''
      })
      .filter(Boolean)

    const granted = [
      perms?.can_manage_students && 'শিক্ষার্থী',
      perms?.can_view_fees && 'ফি',
      perms?.can_send_sms && 'SMS',
    ].filter(Boolean) as string[]

    return {
      id: teacher.id,
      name: teacher.name,
      phone: teacher.phone,
      active: teacher.active,
      // No linked account means they cannot sign in yet — worth surfacing,
      // because an owner who added a teacher expects them to be able to log in.
      hasLogin: Boolean(teacher.user_id),
      subjects,
      granted,
      batchCount: (teacher.batches ?? []).filter((b) => b.active).length,
    }
  })

  const activeCount = rows.filter((r) => r.active).length
  const limit = session.plan.maxTeachers

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
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-line bg-white px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {row.name}
                    {!row.active && (
                      <span className="ml-2 text-sm text-ink-faint">বন্ধ</span>
                    )}
                  </p>
                  {row.subjects.length > 0 && (
                    <p className="truncate text-sm text-ink-soft">
                      {row.subjects.join(' · ')}
                    </p>
                  )}
                  <p className="text-sm text-ink-faint">
                    <span className="num">{row.batchCount}</span> ব্যাচ
                    {row.granted.length > 0 && ` · ${row.granted.join(', ')}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {row.phone && (
                    <p className="num text-sm text-ink-soft">
                      {formatBdMobile(row.phone)}
                    </p>
                  )}
                  {!row.hasLogin && (
                    <p className="text-xs text-late">লগইন নেই</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <p className="font-medium text-ink">শিক্ষক যোগ করা</p>
        <p className="mt-1 text-sm text-ink-soft">
          শিক্ষক নিজে অ্যাকাউন্ট খুলে আপনার সেন্টারে যুক্ত হবেন — এই অংশটা এখনও
          তৈরি হচ্ছে। এখন পর্যন্ত আপনি নিজেই সব ব্যাচের হাজিরা ও নম্বর দিতে পারবেন।
        </p>
      </Card>
    </div>
  )
}
