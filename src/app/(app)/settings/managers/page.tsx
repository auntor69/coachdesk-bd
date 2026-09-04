import Link from 'next/link'

import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { branchChoicesFor } from '@/lib/branches'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { hasStaff, planName, PLANS } from '@/lib/plans'
import {
  administratorsFrom,
  candidatesFrom,
  type Person,
} from '@/lib/staff/admins'
import { jobTitle } from '@/lib/staff/roles'
import { createClient } from '@/lib/supabase/server'
import { AppointManager } from './appoint-manager'
import { ManagerRow } from './manager-row'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.managers.title} — CoachDesk` }
}

/**
 * Who else administers this centre.
 *
 * THE OWNER'S SCREEN AND NOBODY ELSE'S. 20260811000061 made an `owner` or `manager` row
 * in `center_members` writable only by `app.is_owner`, so a manager reading this page
 * would be reading a list of forms the database refuses. `pageRole('owner')` answers with
 * the 403 the activity log answers with, and for the same reason: a screen that can only
 * fail is worse than a screen that is not there.
 *
 * NAMES COME FROM `teachers` AND `employees`, not from `profiles`. That table is self-read
 * (20260811000002), so an owner looking a colleague up in it is handed nothing —
 * `center_members` carries a `user_id` and no name, and those two tables are the only
 * name-bearing rows a staff admin may read. So the roster is joined in application code
 * and somebody in neither list has no name to show. See lib/staff/admins.ts.
 *
 * WHICH IS ALSO WHY THE APPOINTMENT STARTS FROM A PERSON. A form that took a phone number
 * would make administrators nobody can name a week later; a form that offers the people
 * the centre has already written down has their name, their number and their building
 * already recorded, on the screen where each is editable.
 *
 * THE ROSTER AND THE APPOINTMENT SIDE BY SIDE FROM `xl` (§20.8.7), which is where this
 * screen's width was going wrong: the appoint form is a select, a building, six boxes with
 * a line of explanation each and a submit, and it was being handed 1,184px for a job that
 * wants 400. `xl` and not `lg` for the reason /expenses gives — five of twelve columns is
 * 279px at `lg`, and a rail that narrow is a squeeze rather than a rail.
 */
export default async function ManagersPage() {
  const session = await pageRole('owner')
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.managers

  /*
   * Reachable and refused, in the branches screen's style and for its reasons: a plan can
   * change under a bookmark. Before the queries, so nothing on a plan without colleagues
   * costs a read of the tables it may not use.
   */
  if (!hasStaff(session.plan)) {
    return (
      // Capped on the card and not on the column, so the bar still reaches the workspace
      // edges while the sentence stays a sentence wide — §26's defect turned inside out
      // is one line of prose set across 1,216px.
      <div className="flex flex-col gap-5">
        <PageHeader
          title={t.title}
          back={{ href: '/settings', label: d.settings.hub.title }}
        />
        <Card className="max-w-2xl">
          <h2 className="font-semibold text-ink">{t.lockedTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {t.lockedBody(planName(session.plan, locale), planName(PLANS.center, locale))}
          </p>
        </Card>
      </div>
    )
  }

  const supabase = await createClient()
  const centerId = session.active.centerId

  const [memberRead, teacherRead, employeeRead, branches] = await Promise.all([
    supabase
      .from('center_members')
      .select('id, user_id, role, branch_id, capabilities')
      .eq('coaching_center_id', centerId)
      // Switched-off memberships are not appointments any more: `app.has_role` counts
      // only active rows, so one drawn here would be an administrator with no powers.
      .eq('active', true)
      .in('role', ['owner', 'manager']),
    supabase
      .from('teachers')
      .select('id, name, phone, user_id, branch_id, active')
      .eq('coaching_center_id', centerId),
    supabase
      .from('employees')
      .select('id, name, phone, user_id, branch_id, active, role, designation')
      .eq('coaching_center_id', centerId),
    branchChoicesFor(supabase, session),
  ])

  /*
   * One bar for all three shapes of the screen. Every use puts it directly in the page's
   * own tall column, never in a box of its own and never in the grid as a cell: a sticky
   * box only travels inside its containing block, and either of those gives it one about
   * 90px tall. See components/page-header.tsx.
   */
  const bar = (
    <PageHeader
      title={t.title}
      back={{ href: '/settings', label: d.settings.hub.title }}
      subtitle={t.subtitle}
    />
  )

  /*
   * FAILING CLOSED on the membership read, and the candidate list is why as much as the
   * roster is. A dropped read draws "nobody else administers this centre" over a form
   * offering every colleague — including the two who already do, because the exclusion is
   * computed from these very rows. The insert would be refused by `unique
   * (coaching_center_id, user_id, role)`, so nothing is corrupted; what is lost is the
   * owner's belief about who can reach their money, which is the whole subject of the page.
   */
  if (memberRead.error || memberRead.data === null) {
    return (
      <div className="flex flex-col gap-5">
        {bar}
        <Card className="max-w-2xl border-late/30 bg-late/5">
          <p className="font-medium text-ink">{d.settings.listUnreadable}</p>
        </Card>
      </div>
    )
  }

  const members = memberRead.data.map((row) => ({
    id: row.id,
    userId: row.user_id,
    role: row.role,
    branchId: row.branch_id,
    capabilities: row.capabilities,
  }))

  /*
   * Teachers before employees, which `administratorsFrom` relies on: somebody written down
   * in both lists is shown under the name their colleagues use.
   *
   * `null` for either read is the whole pair lost rather than half of it. A short candidate
   * list is the expensive kind of wrong here — an owner told there is nobody to appoint
   * writes the accountant down a second time, and nothing in the product merges the two
   * payroll rows afterwards. So the form is replaced by a sentence and the roster below
   * still draws, unnamed.
   */
  const people: Person[] | null =
    teacherRead.error || employeeRead.error
      ? null
      : [
          ...(teacherRead.data ?? []).map((row) => ({
            id: row.id,
            from: 'teachers' as const,
            userId: row.user_id,
            name: row.name,
            role: t.teacherJob,
            phone: row.phone,
            branchId: row.branch_id,
            active: row.active,
          })),
          ...(employeeRead.data ?? []).map((row) => ({
            id: row.id,
            from: 'employees' as const,
            userId: row.user_id,
            name: row.name,
            role: jobTitle(row.role, row.designation, d.settings.staff.roles),
            phone: row.phone,
            branchId: row.branch_id,
            active: row.active,
          })),
        ]

  const admins = administratorsFrom(members, people ?? [], session.userId)
  const candidates = people === null ? null : candidatesFrom(people, members)

  /*
   * The buildings by name, for the label on each row. Drawn from the same list the picker
   * offers, so a pin onto a branch that has since been closed reads as `branchClosed`
   * rather than silently as head office — the difference between somebody confined to a
   * shut building and somebody who reads the whole organisation.
   */
  const branchNames = new Map((branches ?? []).map((branch) => [branch.id, branch.name]))
  const branchLabel = (branchId: string | null): string =>
    branchId === null
      ? d.branchAccess.hq
      : (branchNames.get(branchId) ?? t.branchClosed)

  return (
    <div className="flex flex-col gap-5">
      {bar}

      {/*
       * THE ROSTER AND THE FORM SIDE BY SIDE, seven columns and five, and stacked below `xl`.
       * Source order is reading order here, so there is no `order-N` on this screen at all:
       * who administers the centre, then how to appoint somebody else.
       *
       * The list is short by nature — one owner and a manager or two — so it is not the
       * width that the roster needs; it is that the form below it was being set across the
       * whole page. Six checkboxes with a line of explanation each, stretched to 1,184px, is
       * the same defect as a 600px column on a monitor, from the other side.
       *
       * Nested under the bar rather than holding it as a twelfth-column cell, because a
       * cell's containing block is one grid row and the bar would stop sticking.
       */}
      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-12 xl:items-start xl:gap-6">
        {/* No strip of column heads over this list, unlike the teacher and staff rosters:
            those run to fourteen rows and reward a column that can be read down, and three
            words over three rows would be furniture. Each row says what it is instead. */}
        <ul className="flex flex-col gap-2 xl:col-span-7">
          {admins.map((admin) => (
            <ManagerRow
              key={admin.memberId}
              admin={admin}
              name={admin.isSelf ? t.you : (admin.name ?? t.noName)}
              roleLabel={admin.role === 'owner' ? t.owner : t.manager}
              branchLabel={branches === null ? null : branchLabel(admin.branchId)}
              branches={branches}
              t={d.managerForm}
              caps={d.capabilities}
              branchAccess={d.branchAccess}
              common={d.common}
            />
          ))}
        </ul>

        <div className="xl:col-span-5">
          {candidates === null ? (
            <Card>
              <h2 className="font-semibold text-ink">{t.appointTitle}</h2>
              <p className="mt-1 text-sm text-ink-soft">{t.staffUnreadable}</p>
            </Card>
          ) : candidates.length === 0 ? (
            /* Nobody left to offer, which on a centre with one owner and no staff yet is
               the ordinary first visit. Names the screen that fixes it rather than a form
               that cannot: an administrator has to be somebody already written down. */
            <Card>
              <h2 className="font-semibold text-ink">{t.nobodyTitle}</h2>
              <p className="mt-1 text-sm text-ink-soft">{t.nobodyBody}</p>
              <Link
                href="/settings/staff"
                className="mt-3 inline-flex min-h-tap items-center font-medium
                  text-brand-700"
              >
                {d.settings.hub.staff} →
              </Link>
            </Card>
          ) : (
            <AppointManager
              title={t.appointTitle}
              candidates={candidates}
              branches={branches}
              t={d.managerForm}
              caps={d.capabilities}
              branchAccess={d.branchAccess}
              common={d.common}
            />
          )}
        </div>
      </div>
    </div>
  )
}
