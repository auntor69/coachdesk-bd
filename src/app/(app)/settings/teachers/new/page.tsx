import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { wouldExceed, hasStaff, planName, PLANS } from '@/lib/plans'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { TeacherForm } from './teacher-form'

/** getSession, not requireRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.teachers.newTitle} — CoachDesk` }
}

export default async function NewTeacherPage() {
  const session = await requireRole('manager')
  const locale = session.locale
  const t = dict(locale).settings.teachers

  // Same card as the list behind it, for the same reason: on a one-teacher plan
  // there is nobody to add. Reached by a bookmark or a back button, never by a
  // link this build still renders.
  if (!hasStaff(session.plan)) {
    return (
      <div className="flex flex-col gap-5">
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {dict(locale).settings.hub.title}
        </Link>
        <Card>
          <h2 className="font-semibold text-ink">{t.soloTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {t.soloBody(
              planName(session.plan, locale),
              planName(PLANS.center, locale),
            )}
          </p>
        </Card>
      </div>
    )
  }

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
            label: localName(subject, locale),
          }))}
        />
      )}
    </div>
  )
}
