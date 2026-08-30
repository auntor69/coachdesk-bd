import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { formatDate, todayInDhaka } from '@/lib/bd/time'
import { branchChoicesFor } from '@/lib/branches'
import { dict, DEFAULT_LOCALE } from '@/lib/i18n'
import { has, planName, PLANS } from '@/lib/plans'
import { EMPLOYEE_ROLES, jobTitle } from '@/lib/staff/roles'
import { createClient } from '@/lib/supabase/server'
import { StaffRow, type StaffMember } from './staff-row'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.staff.title} — CoachDesk` }
}

/**
 * Who else works here.
 *
 * THE OTHER HALF OF THE PAYROLL, and the reason this screen exists before the payroll
 * one does: `salary_terms` and `salary_payments` (20260811000044) can name an employee
 * or a teacher, and until a centre can write down that it employs an accountant there
 * is nobody but the teachers to pay. A payroll screen built first would have looked
 * complete while quietly covering half the wage bill.
 *
 * NOT THE TEACHER LIST, and not because employees are lesser. That screen is about
 * permission — who may mark attendance, who may see what a family owes — and its
 * currency is seats. This one is about employment: when somebody started, what the job
 * is called, what number to ring. Merged, the permission ticks would be offered to a
 * night guard and the seat count would be spent on a cook.
 *
 * STAFF-ADMIN ONLY, matching `employees_staff_admin_all`. There is deliberately no
 * teacher read policy on that table: what a colleague is paid, and when they were
 * hired, is not something a teacher needs from us.
 */
export default async function StaffPage() {
  const session = await pageRole('manager')
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.staff

  /*
   * Reachable and refused, in the register's own style. A 404 would be the tidier
   * answer and the wrong one: a plan can change under a bookmark, an owner who read
   * about staff on the plan screen arrives here on purpose, and a dead end teaches
   * them the app is broken rather than that the feature is bought. The hub does not
   * draw this row on a plan without it, so nobody reaches this card by following a
   * link this build renders.
   *
   * Before the query and not after: nothing on a free plan should cost a read of a
   * table it may not use.
   */
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

  const supabase = await createClient()

  const [{ data: employees }, branches] = await Promise.all([
    supabase
      .from('employees')
      .select(
        `id, name, role, designation, phone, joined_on, left_on, active, note,
         user_id, branch_id`,
      )
      // Scoped as well as governed by RLS, for the reason the roster gives: an owner of
      // two centres passes is_staff_admin for both, so the policy alone would list the
      // other centre's staff — and their phone numbers — under a switcher saying this one.
      .eq('coaching_center_id', session.active.centerId)
      // People who have left sink to the bottom. A centre five years old has more
      // ex-employees than employees, and mixing them by name alone would bury the cook
      // who is here today under three who are not.
      .order('active', { ascending: false })
      .order('name', { ascending: true }),
    // Which building each of them works in, for the head office of an organisation with
    // more than one. `null` for everybody else and no query for them — see
    // branchChoicesFor. Read alongside the list rather than after it: the panel needs it
    // to draw, and neither read depends on the other.
    branchChoicesFor(supabase, session),
  ])

  /*
   * FAILING CLOSED, and the empty card is why. A dropped read hands back `null`, and
   * `null` drawn as a list is "No staff added yet" on the screen of a centre with
   * fourteen of them — under an add button, so the owner's next move is to type in
   * somebody who is already there. The row cannot be deleted afterwards. One sentence
   * saying the list did not arrive costs a refresh; the alternative costs a duplicate
   * on the payroll.
   */
  if (employees === null) {
    return (
      <div className="flex flex-col gap-5">
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.settings.hub.title}
        </Link>
        <h1 className="text-xl font-bold text-ink">{t.title}</h1>
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{d.settings.listUnreadable}</p>
        </Card>
      </div>
    )
  }

  const roles = EMPLOYEE_ROLES.map((role) => ({ value: role, label: t.roles[role] }))

  const rows: StaffMember[] = employees.map((employee) => {
    /*
     * Which date matters depends on whether they are still here. For somebody who has
     * gone the last day is the fact an owner came looking for; for everybody else it is
     * how long they have been here. Switched off with no last day recorded falls back to
     * the start date rather than printing nothing — the "Off" badge beside the name has
     * already said the important part.
     */
    const dateLine =
      !employee.active && employee.left_on
        ? t.left(formatDate(employee.left_on, locale))
        : t.joined(formatDate(employee.joined_on, locale))

    return {
      id: employee.id,
      name: employee.name,
      role: employee.role,
      designation: employee.designation,
      phone: employee.phone,
      joinedOn: employee.joined_on,
      active: employee.active,
      note: employee.note,
      // Filed as it stands, so the panel can hand it back when there is nothing to
      // choose from. Null is head office and a real answer.
      branchId: employee.branch_id,
      // The centre's own word for the job, or the role's. One place decides, because
      // this row prints it and the payslip will.
      title: jobTitle(employee.role, employee.designation, t.roles),
      meta: [
        // Only where the centre renamed the job. Reading "Front Desk Officer" on the
        // row and "Receptionist" in a payroll report otherwise looks like the report
        // lost somebody; `role` is what a report groups by, and the name above it is
        // not. Where the two agree this would be the same word twice.
        employee.designation?.trim() ? t.roleUnder(t.roles[employee.role]) : null,
        dateLine,
        // A fact about signing in and not a permission: `user_id` is a link, not a
        // grant. Printed because "why can Karim sign in?" is a question an owner will
        // bring to this list.
        employee.user_id ? t.hasLogin : null,
      ]
        .filter(Boolean)
        .join(' · '),
    }
  })

  const activeCount = rows.filter((row) => row.active).length

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.settings.hub.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">
          {rows.length === 0 ? t.subtitle : t.count(activeCount)}
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <h2 className="font-semibold text-ink">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.emptyBody}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <StaffRow
              key={row.id}
              employee={row}
              roles={roles}
              offLabel={t.inactive}
              today={todayInDhaka()}
              t={d.staffForm}
              branchPick={d.branchPick}
              branches={branches}
              common={d.common}
            />
          ))}
        </ul>
      )}

      <Link
        href="/settings/staff/new"
        className="flex min-h-tap items-center justify-center rounded-xl border-2
          border-dashed border-brand-300 bg-brand-50/50 px-4 font-medium
          text-brand-700 hover:bg-brand-50"
      >
        <span aria-hidden>+&nbsp;</span>
        {t.new}
      </Link>

      {/* And on to what they are paid. Under the add button rather than above the list,
          because the sequence runs that way: a centre writes its people down first and
          agrees their salaries afterwards, and until it does, their wages are missing
          from every profit figure it reads. A plain underlined link and not a second
          dashed panel — there is one thing to do on this screen, and adding somebody
          is it. */}
      <Link
        href="/payroll"
        className="inline-flex min-h-tap items-center font-medium text-brand-800
          underline"
      >
        {t.payrollLink} →
      </Link>
    </div>
  )
}
