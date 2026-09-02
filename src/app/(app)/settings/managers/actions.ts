'use server'

/**
 * Who else administers this centre: appointing a manager, moving one, narrowing what one
 * may do, and removing one.
 *
 * THE OWNER'S SIGNATURE, three times over. 20260811000061 wrote the rule into the
 * database — `members_owner_write` is the only policy that can reach a row whose role is
 * `owner` or `manager`, and `members_staff_write` excludes both sides of that column, so
 * a manager cannot appoint a colleague or promote themselves. The page draws no forms for
 * anybody else, and `owner()` below refuses them in words. The database copy is the one
 * that matters; this one exists because a policy failure arrives as an empty result and
 * the only sentence a screen can make of that is "not found".
 *
 * AND A CENTRE PLAN, re-checked here for the reason the staff actions give about theirs:
 * nothing in the database knows what a centre bought, so `staffManagement` is checked in
 * this file or it is not checked at all. A Server Action is a public HTTP endpoint and the
 * locked card on the page is a courtesy to the reader, not a fence.
 *
 * `role: 'manager'` IS THE ONLY ROLE THIS FILE WRITES, and every read and write below
 * carries `.eq('role', 'manager')` as well. An owner may hand their centre to a co-owner
 * as far as the policies are concerned — `members_owner_write` allows it — and this screen
 * does not offer it. There is no product reason to yet, and the failure it would enable is
 * the worst one available on this page: a second owner cannot be removed by the first, so
 * a mistap would be permanent from inside the app. The filters are what keep a crafted
 * post from reaching an owner row through a form about managers.
 *
 * A BRANCH PIN IS THE WHOLE OF §6.2's TWO NEW ROLES. "Branch Admin and HQ Admin do not
 * need new enum values. A `manager` with a `branch_id` is a branch admin; a `manager` with
 * no `branch_id` is centre-wide." So this file writes one column to tell them apart, and
 * 20260811000053's `app.branch_ok` is what makes the distinction mean anything.
 *
 * AND A CAPABILITY LIST IS THE WHOLE OF THE REST OF §6.2 — "Deputy Owner, Accountant,
 * Receptionist, Coordinator, Observer" are not enum values either, but one `text[]` on the
 * same row. Which means the two questions this screen asks a manager are both columns of
 * `center_members`, and neither is a role: what they may read, and what they may touch.
 * `app.member_allows` enforces the second one and `lib/staff/capabilities.ts` is the app's
 * word for it.
 *
 * AN ACCOUNT IS MADE WHERE THERE IS NONE, which is why `giveTeacherLogin` is this file's
 * closest relative rather than the branches actions. The two halves are one errand on
 * purpose: a login with no membership behind it lands its holder on /onboarding, where
 * they are invited to create a coaching centre of their own, so an appointment that
 * stopped after the account would be worse than no appointment at all.
 *
 * NOTHING HERE WRITES A `teachers` ROW. §6.2 is explicit about why: putting a
 * non-teaching administrator in `teachers` "would corrupt the teacher seat count that
 * Center billing depends on". An office manager is an employee (§9.4) with a membership,
 * and both of those already exist.
 */
import { revalidatePath } from 'next/cache'

import {
  requireRole,
  requireWritable,
  authRefusal,
  AuthError,
  type CenterSession,
} from '@/lib/auth/session'
import { MIN_PASSWORD } from '@/lib/auth/password'
import { createUsernameLogin } from '@/lib/auth/username-login'
import { phoneToLoginEmail } from '@/lib/bd/phone'
import { usernameBaseFor } from '@/lib/bd/username'
import { postedBranchId } from '@/lib/branches'
import { dict } from '@/lib/i18n'
import { passwordTooShort } from '@/lib/i18n/messages'
import { hasStaff } from '@/lib/plans'
import { parsePerson } from '@/lib/staff/admins'
import { parseCapabilities } from '@/lib/staff/capabilities'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * `confirm` and `username` are `giveTeacherLogin`'s own two extra fields, and they are
 * here for the same two moments: a number that already belongs to somebody, and a login
 * an owner has to read out because there was no number to use.
 */
export type ManagerState = {
  error?: string
  ok?: string
  confirm?: string
  username?: string
} | null

/**
 * The caller, or the sentence to show somebody who may not be one.
 *
 * Two refusals and they are different kinds. The role check is a fence and `authRefusal`
 * writes its wording, including the separate sentence a lapsed subscription gets. The plan
 * check is an entitlement, so its sentence names what is missing.
 */
async function owner(): Promise<CenterSession | ManagerState> {
  let session: CenterSession
  try {
    session = requireWritable(await requireRole('owner'))
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: await authRefusal(err, (d) => d.settings.managers.errors.ownerOnly) }
    }
    throw err
  }

  if (!hasStaff(session.plan)) {
    return { error: dict(session.locale).settings.errors.staffNeedsCenter }
  }

  return session
}

function isSession(value: CenterSession | ManagerState): value is CenterSession {
  return value !== null && 'userId' in value
}

/**
 * Makes somebody an administrator of this centre.
 *
 * THE PERSON IS RE-READ, NEVER TRUSTED. The form posts `teachers:<id>` or
 * `employees:<id>` and nothing else about them — no `user_id`, because a `user_id` from a
 * browser is a way to make any account in the platform a manager of this centre. So the id
 * is looked up in its own table with this centre's id beside it, and the account that
 * appears on the row is the one appointed.
 *
 * SWITCHED ON, which the candidate list already filters for and this asks again. Somebody
 * who has left had their teacher membership deleted on the way out (see
 * `toggleTeacherActive`); a manager row would be a second way back in, granted from a
 * screen about promotions rather than the one about staff.
 *
 * THE NUMBER IS NOT ASKED FOR HERE, unlike the teacher login form. It is already on the
 * person's own row, typed on the screen where it is editable, so the mistyped digit
 * `giveTeacherLogin` guards against with a confirm step cannot be introduced by this form
 * at all. The confirm step survives anyway, for the case that has nothing to do with
 * typing: the number belongs to somebody who already has an account, and linking to it
 * hands them a manager's reach over this centre.
 */
export async function appointManager(
  _prev: ManagerState,
  formData: FormData,
): Promise<ManagerState> {
  const session = await owner()
  if (!isSession(session)) return session

  const d = dict(session.locale).settings
  const t = d.managers
  const centerId = session.active.centerId

  const chosen = parsePerson(String(formData.get('person') ?? ''))
  if (chosen === null) return { error: t.errors.pickSomebody }

  const password = String(formData.get('password') ?? '')
  const confirmedLink = formData.get('confirmLink') !== null
  const branchId = postedBranchId(formData)

  const supabase = await createClient()

  /*
   * Spelled out twice rather than through a `.from(chosen.from)`, because a `.from` given
   * a variable is a query check-scoping.mjs cannot read: the gate matches a quoted table
   * name and refuses what it cannot prove is centre-scoped. Both reads carry the same
   * columns and the same `.eq`, so the branches rejoin immediately below.
   */
  const found =
    chosen.from === 'teachers'
      ? await supabase
          .from('teachers')
          .select('id, name, phone, user_id, active, branch_id')
          .eq('id', chosen.id)
          .eq('coaching_center_id', centerId)
          .maybeSingle()
      : await supabase
          .from('employees')
          .select('id, name, phone, user_id, active, branch_id')
          .eq('id', chosen.id)
          .eq('coaching_center_id', centerId)
          .maybeSingle()

  // Read before an account is created, so a dropped read is worth a sentence of its own:
  // an owner told the person is not on the list writes them down a second time and
  // appoints the copy, leaving a duplicate on the payroll.
  if (found.error) return { error: d.errors.readFailed }
  if (!found.data) return { error: t.errors.notFound }

  const person = found.data
  if (!person.active) return { error: t.errors.notActive }

  let userId = person.user_id
  let username: string | null = null

  if (userId === null) {
    if (password.length < MIN_PASSWORD) return { error: passwordTooShort(session.locale) }

    const admin = createAdminClient(session.userId)

    if (person.phone !== null) {
      const loginEmail = phoneToLoginEmail(person.phone)
      // A number on the row that will not make a login id. Nothing normalises the column
      // on the way in from an import, so this is reachable, and the repair is on the
      // person's own screen rather than here.
      if (!loginEmail) return { error: t.errors.phoneInvalid }

      const { data: existing, error: existingError } = await admin
        .from('profiles')
        .select('id, full_name')
        .eq('phone', person.phone)
        .maybeSingle()

      // Guessing "no account" here is guessing wrong about the likeliest reader: an owner
      // appointing somebody who already works elsewhere in the app is exactly the case
      // this lookup is for.
      if (existingError) return { error: t.errors.numberUnreadable }

      // Never on the first submit. The owner has to read the name back and agree to it —
      // a number recorded against the wrong person would hand a stranger a manager's
      // reach over this centre's money and roster.
      if (existing && !confirmedLink) {
        return { confirm: t.confirmLink(existing.full_name || t.noName) }
      }

      if (existing) {
        userId = existing.id
      } else {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email: loginEmail,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: person.name,
            phone: person.phone,
            locale: session.locale,
          },
        })

        if (createError || !created.user) return { error: t.errors.loginFailed }
        userId = created.user.id
      }
    } else {
      // §5.2's fallback, for somebody whose number was never written down. The name is
      // the row's, not the form's: this screen has no name field, and the row is what the
      // owner is looking at while they read the username out.
      const login = await createUsernameLogin(
        admin,
        usernameBaseFor(person.name, session.active.centerName),
        person.name,
        password,
        session.locale,
      )

      if ('refused' in login) {
        return {
          error:
            login.refused === 'taken' ? t.errors.usernameTaken : t.errors.loginFailed,
        }
      }

      userId = login.userId
      username = login.username
    }

    /*
     * The link back onto the person's own row, so the next visit finds the account rather
     * than minting a second one. Written before the membership on purpose: a failure here
     * leaves an account nobody points at, which submitting again recovers through the
     * lookup above, while a membership written against a row that does not carry the
     * account would be a manager with no name on this screen.
     */
    const linked =
      chosen.from === 'teachers'
        ? await supabase
            .from('teachers')
            .update({ user_id: userId })
            .eq('id', person.id)
            .eq('coaching_center_id', centerId)
        : await supabase
            .from('employees')
            .update({ user_id: userId })
            .eq('id', person.id)
            .eq('coaching_center_id', centerId)

    if (linked.error) return { error: t.errors.loginFailed }
  }

  const { error } = await supabase.from('center_members').insert({
    coaching_center_id: centerId,
    user_id: userId,
    role: 'manager',
    // Typed rather than inherited from the person's own row, which is the opposite of
    // what `giveTeacherLogin` does with its teacher membership and deliberately so.
    // 20260811000054 argues it: a guess either confines a new colleague with nothing on
    // the screen saying so, or hands them the whole organisation.
    branch_id: branchId,
    // And what parts of the job they were given (§6.2). All six boxes collapse to null in
    // `parseCapabilities`, which is the un-narrowed manager this form made before the
    // boxes existed, and the picker ticks all six by default — so an owner who does not
    // touch the control gets exactly what they used to get.
    capabilities: parseCapabilities(formData.getAll('capability').map(String)),
  })

  if (error) {
    // `unique (coaching_center_id, user_id, role)`. Reachable from a stale list: two tabs,
    // or a candidate appointed on a phone five minutes ago.
    if (error.code === '23505') return { error: t.errors.alreadyAdmin }
    return { error: d.errors.addFailed }
  }

  revalidatePath('/settings/managers')

  if (username) return { ok: t.appointedUsername(person.name, username), username }
  return { ok: t.appointed(person.name) }
}

/**
 * Moves a manager between the head office and one building, or the other way.
 *
 * The one column §6.2's two roles are told apart by, so this is how a branch admin becomes
 * an HQ admin. Nothing else about them moves: their employment row keeps the building they
 * work in, because where somebody sits and what they may read are different questions —
 * `branchAccess` in the dictionary is the second one and says so.
 */
export async function setManagerBranch(
  _prev: ManagerState,
  formData: FormData,
): Promise<ManagerState> {
  const session = await owner()
  if (!isSession(session)) return session

  const d = dict(session.locale).settings
  const memberId = String(formData.get('memberId') ?? '')
  if (!memberId) return { error: d.managers.errors.notFound }

  const supabase = await createClient()

  const { data: saved, error } = await supabase
    .from('center_members')
    .update({ branch_id: postedBranchId(formData) })
    .eq('id', memberId)
    // The centre as well as the policy, for the reason the roster gives: an owner of two
    // organisations passes `is_owner` for both, so the policy alone would let an id from
    // the other one through under a switcher that says this one.
    .eq('coaching_center_id', session.active.centerId)
    // And the role, so a crafted post cannot move the owner's own row through a form
    // about managers. `members_owner_write` would allow it; this refuses it.
    .eq('role', 'manager')
    .select('id')

  if (error) return { error: d.errors.saveFailed }
  // An update matching no policy changes nothing and reports no error, so the rows
  // written are counted rather than assumed — the trap saveMarks documents.
  if (!saved || saved.length === 0) return { error: d.managers.errors.notFound }

  revalidatePath('/settings/managers')
  return { ok: d.managers.saved }
}

/**
 * Changes what parts of the job a manager was given (§6.2).
 *
 * `setManagerBranch`'s twin, one column along, and every filter on it is there for the
 * same reason: the centre because an owner of two passes `is_owner` for both, the role
 * because `members_owner_write` would let a crafted post narrow the owner's own row from a
 * form about managers, and the row count because an update no policy matches changes
 * nothing and reports no error.
 *
 * NARROWING TAKES EFFECT ON THE NEXT REQUEST AND NOT LATER. `getSession` reads
 * `center_members` per request with no cache of its own, so a manager mid-session loses the
 * fee board on their next tap — which is what an owner clicking Save on this panel means.
 *
 * ALL SIX BOXES IS `null` AND NOT A LIST OF SIX, which is `parseCapabilities`'s doing and
 * matters most here rather than on the appointment: an owner who ticks everything back on
 * is putting the row back to the un-narrowed state, so a capability added in a later
 * migration reaches them too. A stored list of today's six would silently withhold it.
 */
export async function setManagerCapabilities(
  _prev: ManagerState,
  formData: FormData,
): Promise<ManagerState> {
  const session = await owner()
  if (!isSession(session)) return session

  const d = dict(session.locale).settings
  const memberId = String(formData.get('memberId') ?? '')
  if (!memberId) return { error: d.managers.errors.notFound }

  const supabase = await createClient()

  const { data: saved, error } = await supabase
    .from('center_members')
    .update({ capabilities: parseCapabilities(formData.getAll('capability').map(String)) })
    .eq('id', memberId)
    .eq('coaching_center_id', session.active.centerId)
    .eq('role', 'manager')
    .select('id')

  if (error) return { error: d.errors.saveFailed }
  if (!saved || saved.length === 0) return { error: d.managers.errors.notFound }

  revalidatePath('/settings/managers')
  return { ok: d.managers.saved }
}

/**
 * Takes the appointment back.
 *
 * A DELETE AND NOT A SWITCH, matching what the app does everywhere else access is
 * withdrawn: `toggleTeacherActive` deletes the teacher's membership on the way out, and
 * `app.has_role` counts only active rows anyway, so a row switched off is a row that does
 * nothing but sit there. Removing it is the plainer record of what happened.
 *
 * WHAT SURVIVES IS THE PERSON. Their `teachers` or `employees` row is untouched, their
 * login still works, and a teacher who was also a manager goes back to being a teacher
 * with their teaching membership intact — which is the ordinary case here, and the reason
 * this does not touch anything but the one row.
 *
 * NO GUARD ABOUT THE LAST ADMINISTRATOR, because there is always one: the owner cannot be
 * removed here, and `app.keep_last_owner` from 20260811000062 is what stops them
 * disappearing anywhere else.
 */
export async function removeManager(
  _prev: ManagerState,
  formData: FormData,
): Promise<ManagerState> {
  const session = await owner()
  if (!isSession(session)) return session

  const d = dict(session.locale).settings
  const memberId = String(formData.get('memberId') ?? '')
  if (!memberId) return { error: d.managers.errors.notFound }

  const supabase = await createClient()

  const { data: gone, error } = await supabase
    .from('center_members')
    .delete()
    .eq('id', memberId)
    .eq('coaching_center_id', session.active.centerId)
    // See setManagerBranch: this is what keeps a form about managers away from an owner.
    .eq('role', 'manager')
    .select('id')

  if (error) return { error: d.errors.changeFailed }
  if (!gone || gone.length === 0) return { error: d.managers.errors.notFound }

  revalidatePath('/settings/managers')
  return { ok: d.managers.removed }
}
