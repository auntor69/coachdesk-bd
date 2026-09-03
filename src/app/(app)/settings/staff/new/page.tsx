import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageCapability, getSession } from '@/lib/auth/session'
import { todayInDhaka } from '@/lib/bd/time'
import { branchChoicesFor } from '@/lib/branches'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { has, planName, PLANS } from '@/lib/plans'
import { EMPLOYEE_ROLES } from '@/lib/staff/roles'
import { createClient } from '@/lib/supabase/server'
import { EmployeeForm } from './employee-form'

/** getSession, not pageCapability — see the note on teach/page.tsx's own. */
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
 * people as it actually employs. Nothing here is priced per head — which is also why this
 * letterhead carries no figure under it, where /settings/teachers/new carries a seat count.
 *
 * ONE COLUMN ON PURPOSE (§20.8.7). Six short fields and no second subject: there is no
 * login to decide and no salary to set, both being other screens' business, so there is
 * nothing to put in a rail and a rail holding nothing is worse than none. The width is
 * spent inside the form instead — see employee-form.tsx.
 *
 * `staff` (§6.2), like the list behind it. `employees_capability_write` would refuse the
 * insert on its own; this is so it is refused before the typing.
 */
export default async function NewStaffPage() {
  const session = await pageCapability('staff')
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.staff

  // Same card as the list behind it, for the same reason: reached by a bookmark or a
  // back button, never by a link this build renders. The action re-checks the plan
  // regardless — see caller() there for why the page cannot be the fence.
  if (!has(session.plan, 'staffManagement')) {
    return (
      // Capped, and carrying the heading this shape never had: a refusal is two sentences,
      // and a bookmark used to land a reader on a card about their plan with nothing above
      // it naming the screen that had refused them.
      <div className="flex max-w-2xl flex-col gap-5">
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.settings.hub.title}
        </Link>
        <h1 className="text-xl font-bold text-ink lg:text-2xl">{t.newTitle}</h1>
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

  /*
   * Which building they work in, for the head office of an organisation that has more
   * than one — and the first query this screen has ever needed.
   *
   * After the plan card above, so a centre without `staffManagement` still costs
   * nothing: `branchChoicesFor` returns early for every reader who cannot be asked, so
   * a client is built and no request is made. Worth the line here because §8.3's
   * comparison table reads salaries by branch through `app.payee_branch`, which is this
   * column — an unfiled cleaner is a wage in nobody's column.
   */
  const branches = await branchChoicesFor(await createClient(), session)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings/staff"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {t.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink lg:text-2xl">{t.newTitle}</h1>
      </div>

      <EmployeeForm
        t={d.staffForm}
        roles={roles}
        common={d.common}
        today={todayInDhaka()}
        branchPick={d.branchPick}
        branches={branches}
      />
    </div>
  )
}
