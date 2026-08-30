import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { todayInDhaka } from '@/lib/bd/time'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { has, planName, PLANS } from '@/lib/plans'
import { EMPLOYEE_ROLES } from '@/lib/staff/roles'
import { EmployeeForm } from './employee-form'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.staff.newTitle} — CoachDesk` }
}

/**
 * Adding one person to the payroll.
 *
 * A record and nothing else: no login, no permissions, no salary. Each of those is
 * somewhere else on purpose — a login is a membership row and the teachers screen's
 * business, and what somebody is paid is the payroll screen's, because a teacher is
 * paid too. This screen's whole job is to make the person exist so the other two have
 * somebody to talk about.
 *
 * No count and no cap, unlike the teacher form beside it. Seats are a teacher thing:
 * `staffManagement` is bought or it is not, and a centre that has it may employ as many
 * people as it actually employs. Nothing here is priced per head.
 */
export default async function NewStaffPage() {
  const session = await pageRole('manager')
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.staff

  // Same card as the list behind it, for the same reason: reached by a bookmark or a
  // back button, never by a link this build renders. The action re-checks the plan
  // regardless — see caller() there for why the page cannot be the fence.
  if (!has(session.plan, 'staffManagement')) {
    return (
      <div className="flex flex-col gap-5">
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.settings.hub.title}
        </Link>
        <Card>
          <h2 className="font-semibold text-ink">{t.lockedTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {t.lockedBody(planName(session.plan, locale), planName(PLANS.center, locale))}
          </p>
        </Card>
      </div>
    )
  }

  const roles = EMPLOYEE_ROLES.map((role) => ({ value: role, label: t.roles[role] }))

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings/staff"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.newTitle}</h1>
      </div>

      <EmployeeForm
        t={d.staffForm}
        roles={roles}
        common={d.common}
        today={todayInDhaka()}
      />
    </div>
  )
}
