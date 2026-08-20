import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { wouldExceed, hasStaff, planName, PLANS } from '@/lib/plans'
import { PERMISSION_DEFAULTS } from '@/lib/permissions'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { TeacherList, type TeacherRow } from './teacher-list'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.teachers.title} — CoachDesk` }
}

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
  const session = await pageRole('manager')
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.teachers

  // A one-teacher plan has no staff to manage, so there is no list to show: the
  // only row would be the reader's own, under a button the action refuses. The
  // route stays reachable rather than 404ing, because a bookmark or a stale link
  // should explain itself.
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
    // Scoped as well as governed by RLS, for the reason the roster gives: an
    // owner of two centres passes is_staff_admin for both, so the policy alone
    // would list the other centre's teachers here — and their permissions, under
    // a switcher that says this centre.
    .eq('coaching_center_id', session.active.centerId)
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
        return localName(subject, locale)
      })
      .filter(Boolean)

    const batchCount = (teacher.batches ?? []).filter((b) => b.active).length

    return {
      id: teacher.id,
      name: teacher.name,
      phone: teacher.phone,
      active: teacher.active,
      // No linked account means they cannot sign in yet — worth surfacing,
      // because an owner who added a teacher expects them to be able to log in.
      hasLogin: Boolean(teacher.user_id),
      subjects,
      // A finished sentence rather than the number, because the row is a client
      // component and a plural cannot cross that boundary. See the note on
      // settings.teachers.batches.
      batchLabel: t.batches(batchCount),
      permissions: {
        can_manage_exams: perms?.can_manage_exams ?? PERMISSION_DEFAULTS.can_manage_exams,
        can_send_sms: perms?.can_send_sms ?? PERMISSION_DEFAULTS.can_send_sms,
        can_manage_students:
          perms?.can_manage_students ?? PERMISSION_DEFAULTS.can_manage_students,
        can_manage_batches:
          perms?.can_manage_batches ?? PERMISSION_DEFAULTS.can_manage_batches,
        can_view_fees: perms?.can_view_fees ?? PERMISSION_DEFAULTS.can_view_fees,
      },
    }
  })

  const activeCount = rows.filter((r) => r.active).length
  const limit = session.plan.maxTeachers

  /*
   * Only ever true for a capped multi-teacher tier, and no tier sold today is
   * one: hasStaff let us past the return above, and every plan that passes it
   * has maxTeachers null. So this and the x/y counter below are both unreachable
   * right now, and kept rather than deleted because the day a mid tier caps staff
   * at, say, twelve, the screen has to stop offering a thirteenth. plans.test.ts
   * holds the other half of that bargain — a tier claiming staff must have room
   * for a second teacher, or this page would refuse the first colleague.
   */
  const atLimit = wouldExceed(session.plan, 'maxTeachers', activeCount)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {dict(locale).settings.hub.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">
          {limit === null ? t.count(activeCount) : t.used(activeCount, limit)}
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.emptyBody}</p>
        </Card>
      ) : (
        <TeacherList
          teachers={rows}
          t={d.teacherList}
          permissions={d.teacherPermissions}
          common={d.common}
        />
      )}

      {atLimit ? (
        <Card>
          {/* The same refusal the add form gives, in the same words. */}
          <p className="font-medium text-ink">{t.capTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {/* limit is non-null here: wouldExceed is false on an uncapped plan. */}
            {t.cap(
              planName(session.plan, locale),
              limit ?? 0,
              planName(PLANS.center, locale),
            )}
          </p>
        </Card>
      ) : (
        <Link
          href="/settings/teachers/new"
          className="flex min-h-tap items-center justify-center rounded-xl border-2
            border-dashed border-brand-300 bg-brand-50/50 px-4 font-medium
            text-brand-700 hover:bg-brand-50"
        >
          <span aria-hidden>+&nbsp;</span>
          {t.new}
        </Link>
      )}
    </div>
  )
}
