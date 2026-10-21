'use server'

/**
 * The people a centre pays who do not teach: adding one, correcting one, and
 * recording the day one of them left.
 *
 * STAFF-ADMIN AND A CENTRE PLAN, both re-checked here. The role half matches
 * `employees_staff_admin_all` exactly, so a teacher is refused by the policy even if
 * this file forgot. The plan half has nothing behind it — there is no trigger that
 * knows what a centre bought — so `staffManagement` is checked in this file or it is
 * not checked at all. A Server Action is a public HTTP endpoint; the locked card on
 * the page is a courtesy to the reader, not a fence.
 *
 * NOTHING HERE HANDS OUT ACCESS. `employees.user_id` is a link and not a grant, and no
 * action in this file writes it: a centre that wants its accountant to sign in creates
 * a membership row, which is the teachers screen's business and asks a different
 * question. So the phone number below reaches a person and opens nothing, and the form
 * says so in as many words.
 *
 * AND NOTHING HERE DELETES. `salary_payments`'s foreign key onto `employees`
 * (20260811000044) carries no `on delete` clause, so Postgres refuses to remove
 * anybody who has ever been paid — which is the right answer, not an obstacle. An
 * employment record is what a salary row means; delete the record and last year's
 * payroll is money paid to nobody. Somebody who has gone is switched off with the day
 * they went, and stays on the books.
 */
import { revalidatePath } from 'next/cache'

import {
  requireRole,
  requireWritable,
  requireCapability,
  authRefusal,
  AuthError,
  type CenterSession,
} from '@/lib/auth/session'
import { normalizeBdMobile } from '@/lib/bd/phone'
import { todayInDhaka } from '@/lib/bd/time'
import { postedBranchId } from '@/lib/branches'
import { dict } from '@/lib/i18n'
import { MAX_LABEL, MAX_NAME, MAX_TEXT, clamp } from '@/lib/limits'
import { has } from '@/lib/plans'
import { EMPLOYEE_ROLES } from '@/lib/staff/roles'
import { createClient } from '@/lib/supabase/server'
import type { EmployeeRole } from '@/lib/supabase/types'

export type StaffState = { error?: string; ok?: string } | null

/**
 * A membership test rather than a cast, built from the canonical list.
 *
 * A role cast from the form would reach Postgres as an invalid input value for the
 * enum — `22P02`, and "something went wrong" on the screen. The list carries a
 * compile-time check that it holds every value of `employee_role`, so a job added in a
 * migration fails the build in `lib/staff/roles.ts` rather than arriving here as a
 * value this file silently refuses.
 */
const ROLES = new Set<EmployeeRole>(EMPLOYEE_ROLES)

/** The shape a date input submits and a `date` column takes. See the expense action. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Nobody was employed by a coaching centre running this app before then. */
const EARLIEST_JOIN = '2000-01-01'

/**
 * The caller, or the sentence to show somebody who may not be one.
 *
 * Two refusals in one function, and they are different in kind. The role check is a
 * fence, and `authRefusal` writes its sentence — including the separate one a lapsed
 * subscription gets, because an owner whose plan ran out is not somebody who "cannot
 * open this". The plan check is an entitlement, and its sentence names what is missing:
 * `staffNeedsCenter` already exists for it, because the seats side of this line was
 * written first.
 *
 * AND `staff` (§6.2), which is the narrowing with the sharpest edge on it: this module
 * appoints teachers and ticks the boxes that say what a teacher may reach. A manager who
 * kept it could tick `can_view_fees` on a teacher account they hold themselves and read
 * back the fee book their owner took away from them. So the veto here is not tidiness.
 */
async function caller(): Promise<CenterSession | StaffState> {
  let session: CenterSession
  try {
    session = requireCapability('staff', requireWritable(await requireRole('manager')))
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: await authRefusal(err, (d) => d.settings.errors.forbidden) }
    }
    throw err
  }

  if (!has(session.plan, 'staffManagement')) {
    return { error: dict(session.locale).settings.errors.staffNeedsCenter }
  }
  return session
}

function isSession(value: CenterSession | StaffState): value is CenterSession {
  return value !== null && 'userId' in value
}

/**
 * The fields every write on this screen shares, read off the form and checked.
 *
 * Returns the refusal instead of the values when one of them is wrong, so both callers
 * get the same sentence for the same mistake — an add form and a row panel that
 * disagreed about whether a phone number was acceptable would be one bug wearing two
 * faces.
 *
 * `designation` is trimmed to nothing rather than kept as an empty string, because
 * `jobTitle` reads null as "use the role's own word" and "" would print a blank line
 * where a job title belongs.
 */
type Fields = {
  name: string
  role: EmployeeRole
  designation: string | null
  phone: string | null
  joinedOn: string
  note: string | null
}

function readFields(session: CenterSession, formData: FormData): Fields | StaffState {
  const t = dict(session.locale).settings.staff.errors

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: t.nameRequired }

  const role = String(formData.get('role') ?? '') as EmployeeRole
  if (!ROLES.has(role)) return { error: t.roleRequired }

  const rawPhone = String(formData.get('phone') ?? '').trim()
  const phone = rawPhone ? normalizeBdMobile(rawPhone) : null
  // Only when they typed something. An empty box is a cleaner with no mobile, which
  // is ordinary; eleven digits that are not a Bangladeshi mobile is a typo, and
  // storing it would put an unreachable number on the one screen that has to reach
  // somebody.
  if (rawPhone && !phone) return { error: t.phoneInvalid }

  const joinedOn = String(formData.get('joinedOn') ?? '').trim()
  if (!DATE_RE.test(joinedOn) || joinedOn < EARLIEST_JOIN) {
    return { error: t.dateInvalid }
  }
  if (joinedOn > todayInDhaka()) return { error: t.dateFuture }

  const designation = String(formData.get('designation') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  return {
    // Clamped rather than refused, for the reason `clamp` gives: a name at the cap is
    // a long name, and the two optional boxes are not worth a refusal apiece.
    name: clamp(name, MAX_NAME),
    role,
    designation: designation ? clamp(designation, MAX_LABEL) : null,
    phone,
    joinedOn,
    note: note ? clamp(note, MAX_TEXT) : null,
  }
}

function isFields(value: Fields | StaffState): value is Fields {
  return value !== null && 'joinedOn' in value
}

/**
 * Puts one person on the centre's books.
 *
 * `branch_id` NOW COMES FROM THE FORM, WHERE THERE IS ONE. This docstring used to say
 * the column was left null because "nothing in `src/` reads `branches` yet", which was
 * true when 20260811000043 added it and stopped being true in three steps: the branches
 * screen let somebody type a building, 20260811000053 gave the column its meaning, and
 * 20260811000054 files a new row under the branch of whoever wrote it. So the null is
 * still the answer for almost everybody — it is what a single-building centre holds and
 * what the stamp fills for a pinned manager — and the one reader who is asked is the head
 * office of an organisation with more than one building, which is the one desk the stamp
 * cannot answer for.
 *
 * Passed through unchecked, per createStudent's own insert: the composite foreign key
 * and `employees_branch_scope` are the boundary, and a second copy of that rule in this
 * file would be the copy that goes stale — as the paragraph above just demonstrated.
 *
 * WHAT IT DECIDES IS THE WAGE BILL. `app.payee_branch` reads this column to file a
 * salary payment under a branch, so §8.3's comparison table asks it what each building
 * spends on people. An unfiled cleaner is a wage in nobody's column.
 */
export async function addEmployee(
  _prev: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const session = await caller()
  if (!isSession(session)) return session

  const fields = readFields(session, formData)
  if (!isFields(fields)) return fields

  const d = dict(session.locale).settings
  const supabase = await createClient()

  const { error } = await supabase.from('employees').insert({
    coaching_center_id: session.active.centerId,
    name: fields.name,
    role: fields.role,
    designation: fields.designation,
    phone: fields.phone,
    joined_on: fields.joinedOn,
    note: fields.note,
    branch_id: postedBranchId(formData),
  })

  if (error) return { error: d.errors.addFailed }

  revalidatePath('/settings/staff')
  return { ok: d.added }
}

/**
 * The employment dates of one person at this centre, or null if they are not one.
 *
 * Read before both writes below, and not out of caution: the table's own
 * `employees_left_after_joining` check is what stops a last day before a first one,
 * and a check violation arrives as a Postgres error code that this file would have to
 * match against a constraint name to say anything useful about. Reading the pair costs
 * one round trip on two rare actions and buys a sentence an owner can act on.
 *
 * Scoped on the centre as well as governed by RLS, for the reason the roster gives: an
 * owner of two centres passes `is_staff_admin` for both, so the policy alone would let
 * an id from the other centre through under a switcher that says this one.
 */
async function employmentDates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: CenterSession,
  employeeId: string,
): Promise<{ joined_on: string; left_on: string | null } | null> {
  const { data } = await supabase
    .from('employees')
    .select('joined_on, left_on')
    .eq('id', employeeId)
    .eq('coaching_center_id', session.active.centerId)
    .maybeSingle()

  return data ?? null
}

/**
 * Corrects what was written down about somebody.
 *
 * A name, a number, a job title or a start date typed wrong, and the building they work
 * in — nothing else. The money is one screen along and the login is not this screen's to
 * give. `active` and `left_on` are not touched here either: a correction and a
 * resignation are different things and share no submit button.
 *
 * THE BUILDING IS WRITTEN ON EVERY SAVE, and that is BranchPicker's doing rather than
 * this action's: a form that submitted the field for the head office and not for a
 * pinned manager would leave this update unable to tell "head office" from "not asked",
 * and 20260811000053's restrictive policy has no `with check`, so a manager posting null
 * would have their corrected phone number refused. The panel hands back the branch the
 * row already holds when it has nothing to offer, so the write below is a no-op for
 * everybody it was not asked of.
 *
 * WHAT MOVES IS NEXT MONTH'S WAGE. `app.payee_branch` reads this column when a salary
 * payment is filed, and 20260811000052 snapshots the answer onto the voucher — so June's
 * payslip stays in the building that paid it and July's follows them across. Anything
 * already agreed on the payroll screen moves with them too: `salary_terms` carries no
 * branch of its own, because what somebody is paid is not a fact about a room.
 */
export async function saveEmployee(
  _prev: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const session = await caller()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings
  const employeeId = String(formData.get('employeeId') ?? '')
  if (!employeeId) return { error: t.staff.errors.notFound }

  const fields = readFields(session, formData)
  if (!isFields(fields)) return fields

  const supabase = await createClient()

  const dates = await employmentDates(supabase, session, employeeId)
  if (!dates) return { error: t.staff.errors.notFound }
  // Moving the start date past a recorded last day. The check would refuse the write
  // anyway; this is the same refusal in words that name what to do about it.
  if (dates.left_on && fields.joinedOn > dates.left_on) {
    return { error: t.staff.errors.leftBeforeJoined }
  }

  const { data: saved, error } = await supabase
    .from('employees')
    .update({
      name: fields.name,
      role: fields.role,
      designation: fields.designation,
      phone: fields.phone,
      joined_on: fields.joinedOn,
      note: fields.note,
      // The building, from the panel on every save. See the head of this function.
      branch_id: postedBranchId(formData),
    })
    .eq('id', employeeId)
    .eq('coaching_center_id', session.active.centerId)
    .select('id')

  if (error || !saved || saved.length === 0) return { error: t.errors.saveFailed }

  revalidatePath('/settings/staff')
  revalidatePath('/payroll')
  return { ok: t.saved }
}

/**
 * Somebody left, or somebody who left is back.
 *
 * TWO COLUMNS AND ONE BUTTON, because the table will not have them apart:
 * `employees_left_is_inactive` says a row with a last day on it cannot be active, so
 * switching somebody off without a date and dating their departure without switching
 * them off are both refused. Putting them back therefore has to clear the date — a
 * returning employee with last October still on their record would read as gone the
 * next time anybody looked.
 *
 * The row stays, with everything ever paid to it. See the head of this file.
 */
export async function setEmployeeActive(
  _prev: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const session = await caller()
  if (!isSession(session)) return session

  const t = dict(session.locale).settings
  const employeeId = String(formData.get('employeeId') ?? '')
  if (!employeeId) return { error: t.staff.errors.notFound }

  const next = String(formData.get('next') ?? '')
  const supabase = await createClient()

  if (next === 'on') {
    const { data: saved, error } = await supabase
      .from('employees')
      .update({ active: true, left_on: null })
      .eq('id', employeeId)
      .eq('coaching_center_id', session.active.centerId)
      .select('id')

    if (error || !saved || saved.length === 0) return { error: t.errors.changeFailed }
    revalidatePath('/settings/staff')
    revalidatePath('/payroll')
    return { ok: t.saved }
  }

  const dates = await employmentDates(supabase, session, employeeId)
  if (!dates) return { error: t.staff.errors.notFound }

  // Blank means today, which is what an owner switching somebody off this afternoon
  // means. A date is offered at all because the news usually arrives late: the cook
  // stopped coming last week and nobody wrote it down.
  const raw = String(formData.get('leftOn') ?? '').trim()
  const leftOn = raw || todayInDhaka()
  if (!DATE_RE.test(leftOn) || leftOn < EARLIEST_JOIN) {
    return { error: t.staff.errors.dateInvalid }
  }
  if (leftOn > todayInDhaka()) return { error: t.staff.errors.dateFuture }
  if (leftOn < dates.joined_on) return { error: t.staff.errors.leftBeforeJoined }

  const { data: saved, error } = await supabase
    .from('employees')
    .update({
      active: false,
      left_on: leftOn,
    })
    .eq('id', employeeId)
    .eq('coaching_center_id', session.active.centerId)
    .select('id')

  if (error || !saved || saved.length === 0) return { error: t.errors.changeFailed }

  revalidatePath('/settings/staff')
  revalidatePath('/payroll')
  return { ok: t.saved }
}
