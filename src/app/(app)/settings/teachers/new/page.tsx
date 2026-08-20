import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { wouldExceed, hasStaff, planName, PLANS } from '@/lib/plans'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { TeacherForm } from './teacher-form'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.teachers.newTitle} — CoachDesk` }
}

export default async function NewTeacherPage() {
  const session = await pageRole('manager')
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.teachers

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
          ← {d.settings.hub.title}
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
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true)
      .order('name'),
    // Scoped, like the list: an owner of two centres passes is_staff_admin for
    // both, so an unscoped count would spend one centre's headroom on the other's
    // staff and refuse a teacher this centre has room for.
    supabase
      .from('teachers')
      .select('id', { count: 'exact', head: true })
      .eq('coaching_center_id', session.active.centerId)
      .eq('active', true),
  ])

  const atLimit = wouldExceed(session.plan, 'maxTeachers', teacherCount ?? 0)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings/teachers"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.newTitle}</h1>
      </div>

      {atLimit ? (
        <Card>
          {/* The same refusal the list gives, in the same words. */}
          <p className="font-medium text-ink">{t.capTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {/* maxTeachers is non-null here: wouldExceed is false when uncapped. */}
            {t.cap(
              planName(session.plan, locale),
              session.plan.maxTeachers ?? 0,
              planName(PLANS.center, locale),
            )}
          </p>
        </Card>
      ) : (
        <TeacherForm
          t={d.teacherForm}
          permissions={d.teacherPermissions}
          common={d.common}
          subjects={(subjects ?? []).map((subject) => ({
            id: subject.id,
            label: localName(subject, locale),
          }))}
        />
      )}
    </div>
  )
}
