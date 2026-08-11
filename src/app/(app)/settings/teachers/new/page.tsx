import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { wouldExceed } from '@/lib/plans'
import { TeacherForm } from './teacher-form'

export const metadata = { title: 'নতুন শিক্ষক — CoachDesk' }

export default async function NewTeacherPage() {
  const session = await requireRole('manager')
  const supabase = await createClient()

  const [{ data: subjects }, { count: teacherCount }] = await Promise.all([
    supabase
      .from('subjects')
      .select('id, name, name_bn')
      .eq('active', true)
      .order('name'),
    supabase.from('teachers').select('id', { count: 'exact', head: true }).eq('active', true),
  ])

  const atLimit = wouldExceed(session.plan, 'maxTeachers', teacherCount ?? 0)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings/teachers"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← শিক্ষক
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">নতুন শিক্ষক</h1>
      </div>

      {atLimit ? (
        <Card>
          <p className="font-medium text-ink">এই প্ল্যানে আর শিক্ষক যোগ করা যাবে না</p>
          <p className="mt-1 text-sm text-ink-soft">
            {session.plan.nameBn} প্ল্যানে{' '}
            <span className="num">{session.plan.maxTeachers}</span> জন শিক্ষক। সেন্টার
            প্ল্যানে গেলে যত জন দরকার তত জন যোগ করা যাবে — সব ফিচার একই থাকবে।
          </p>
        </Card>
      ) : (
        <TeacherForm
          subjects={(subjects ?? []).map((subject) => ({
            id: subject.id,
            label: subject.name_bn || subject.name,
          }))}
        />
      )}
    </div>
  )
}
