/**
 * Who is asking, which center, and what may they do.
 *
 * Every server route, Server Action, and Route Handler starts here. Next 16's
 * own guidance is blunt about why: Server Actions are public HTTP endpoints, so
 * authorization must be re-checked *inside* each one. A layout check is a
 * convenience for the user, never the boundary.
 *
 * The real boundary is RLS in Postgres. This module decides what to *render*
 * and gives a clear error instead of an empty list; if it ever disagrees with
 * the database, the database wins and the user sees nothing.
 */
import { cache } from 'react'
import { cookies } from 'next/headers'
import { forbidden, redirect } from 'next/navigation'
import type { Route } from 'next'

import { createClient } from '@/lib/supabase/server'
import { loginEmailToPhone } from '@/lib/bd/phone'
import { asLocale, type Locale } from '@/lib/i18n'
import { planFor, type PlanLimits } from '@/lib/plans'
import { ACTIVE_CENTER_COOKIE, pickActive, strongestPerCenter } from '@/lib/auth/active-center'
import type { MemberRole, PlanType } from '@/lib/supabase/types'

export type Membership = {
  centerId: string
  centerName: string
  role: MemberRole
  branchId: string | null
  plan: PlanType
  smsCreditBalance: number
}

export type Session = {
  userId: string
  /** Real email for owners, null for phone-login staff and students. */
  email: string | null
  /**
   * Canonical E.164 (+8801712345678), from the profile or recovered from the
   * synthetic login address. Call formatBdMobile() to display it — never render
   * this raw, because Bangladeshis read their own numbers as 01712345678.
   */
  phone: string | null
  fullName: string | null
  /**
   * Which language every screen this session renders is written in. Read from
   * profiles.locale, defaulted rather than nullable — a screen must never have to
   * decide what to do with a reader who has no language.
   */
  locale: Locale
  isPlatformAdmin: boolean
  /**
   * The centres this person can work in — one entry each, carrying the strongest
   * role they hold there. Not one entry per `center_members` row: an owner who
   * also teaches a batch has two rows at one centre. See
   * `strongestPerCenter` in lib/auth/active-center.
   */
  memberships: Membership[]
  /**
   * The center being acted on: the one they chose in the header, or the highest
   * authority they hold if they have not chosen. Most users have exactly one and
   * never see the choice. See lib/auth/active-center.
   */
  active: Membership | null
  plan: PlanLimits
}

/**
 * Roles ordered by authority, so "at least a manager" is a comparison rather
 * than a list of enum members repeated at every call site.
 */
const ROLE_RANK: Record<MemberRole, number> = {
  owner: 40,
  manager: 30,
  teacher: 20,
  guardian: 10,
  student: 0,
}

export function atLeast(role: MemberRole, minimum: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum]
}

/**
 * Resolves the caller in one round trip, memoised per request by React's
 * `cache` so a page, its layout, and three components asking independently
 * cost one query rather than four.
 *
 * Returns null when nobody is signed in — callers decide whether that is a
 * redirect or a 401, because a page and a Route Handler want different things.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient()

  // getUser, not getSession: it verifies the JWT with the auth server instead
  // of trusting a cookie the browser could have written.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const [{ data: profile }, { data: rows }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, phone, locale, is_platform_admin')
      .eq('id', user.id)
      .maybeSingle(),
    // scoped-by: user_id — this query *is* the centre list, so nothing upstream
    // of it knows which centre to filter by. Every other query in the app is
    // scoped by the answer this one gives; see scripts/check-scoping.mjs.
    supabase
      .from('center_members')
      .select(
        'coaching_center_id, role, branch_id, coaching_centers (name, plan, sms_credit_balance)',
      )
      .eq('user_id', user.id)
      .eq('active', true),
  ])

  const memberships = strongestPerCenter(
    (rows ?? [])
      .map((row) => {
        // The embed is an object for a to-one relation, but PostgREST types it
        // loosely enough that a defensive unwrap costs nothing.
        const center = Array.isArray(row.coaching_centers)
          ? row.coaching_centers[0]
          : row.coaching_centers
        if (!center) return null
        return {
          centerId: row.coaching_center_id,
          centerName: center.name,
          role: row.role,
          branchId: row.branch_id,
          plan: center.plan,
          smsCreditBalance: center.sms_credit_balance,
        }
      })
      .filter((m): m is Membership => m !== null),
    (m) => ROLE_RANK[m.role],
  )

  const active = pickActive(
    memberships,
    (await cookies()).get(ACTIVE_CENTER_COOKIE)?.value,
  )

  // A phone-login account has no real email; recover the number from the
  // synthetic address so the UI can still greet them by number.
  const isSynthetic = user.email ? loginEmailToPhone(user.email) !== null : false

  return {
    userId: user.id,
    email: isSynthetic ? null : (user.email ?? null),
    phone: profile?.phone ?? (user.email ? loginEmailToPhone(user.email) : null),
    fullName: profile?.full_name ?? null,
    locale: asLocale(profile?.locale),
    isPlatformAdmin: profile?.is_platform_admin ?? false,
    memberships,
    active,
    plan: planFor(active?.plan),
  }
})

/**
 * Thrown by the require* helpers. Carries an HTTP-ish code so a Route Handler
 * can answer 401/403 while a page redirects, without either one parsing a
 * message string.
 */
export class AuthError extends Error {
  constructor(
    readonly code: 'unauthenticated' | 'no_center' | 'forbidden',
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

/** A signed-in user, or an AuthError. Says nothing about center membership. */
export async function requireUser(): Promise<Session> {
  const session = await getSession()
  if (!session) throw new AuthError('unauthenticated', 'Sign in first.')
  return session
}

export type CenterSession = Session & { active: Membership }

/**
 * A signed-in user who belongs to a center. This is the normal case for every
 * screen in the app, and the narrowed type means callers never null-check
 * `active` again.
 */
export async function requireCenter(): Promise<CenterSession> {
  const session = await requireUser()
  if (!session.active) {
    throw new AuthError('no_center', 'This account is not attached to a center yet.')
  }
  return session as CenterSession
}

/**
 * As requireCenter, but also that the caller's role in that center clears
 * `minimum`. Use in every Server Action that writes — the action is reachable
 * by anyone who can guess its ID, so the check has to live in the action.
 */
export async function requireRole(minimum: MemberRole): Promise<CenterSession> {
  const session = await requireCenter()
  if (!atLeast(session.active.role, minimum)) {
    throw new AuthError(
      'forbidden',
      `Needs ${minimum} or above; this account is ${session.active.role}.`,
    )
  }
  return session
}

/** Owners and managers — the two roles that may change a center's setup. */
export function isStaffAdmin(session: Session): boolean {
  return session.active ? atLeast(session.active.role, 'manager') : false
}

/** The three permission columns anything outside the settings screens reads. */
type TeacherPerms = {
  can_manage_exams: boolean
  can_send_sms: boolean
  can_view_fees: boolean
}

/**
 * The reader's own `teachers` rows at the active centre, with the permissions
 * that hang off them.
 *
 * One query behind four questions — which batches are mine, may I see fees, may I
 * enter marks, may I message a parent — because several of them are asked on the
 * same request by different files: the shell asks for the nav, the page asks for
 * its own guard, the action asks again because it is a public endpoint. React's
 * `cache` means they share this. Not exported: the helpers below are the useful
 * shapes, and a caller reaching for the rows themselves would be about to
 * re-derive one of them.
 *
 * A list rather than a row, and this is not defensiveness. `teachers` has no
 * unique key on (coaching_center_id, user_id), so a centre that entered the same
 * person twice has two rows and `maybeSingle()` would fail the whole query. Every
 * question asked of this is "any of them", which is also what the app.* helpers do.
 *
 * `perms` is null when a teacher row has no permissions row at all, which is a
 * third state and not a row of falses: `bootstrap_center` leaves the owner's own
 * teacher row that way, and the two defaults read that absence in opposite
 * directions. See canManageExams and canReadFees.
 */
const myTeacherRows = cache(
  async (): Promise<{ id: string; perms: TeacherPerms | null }[]> => {
    const session = await getSession()
    if (!session?.active) return []

    const supabase = await createClient()
    const { data } = await supabase
      .from('teachers')
      .select(
        'id, teacher_permissions (can_manage_exams, can_send_sms, can_view_fees)',
      )
      .eq('coaching_center_id', session.active.centerId)
      .eq('user_id', session.userId)
      .eq('active', true)

    return (data ?? []).map((row) => {
      // The embed is an object for a to-one relation; PostgREST types it loosely
      // enough that the unwrap costs nothing. Same shape as center_members above.
      const perms = Array.isArray(row.teacher_permissions)
        ? row.teacher_permissions[0]
        : row.teacher_permissions
      return { id: row.id, perms: perms ?? null }
    })
  },
)

/**
 * The `teachers.id` values the reader holds at the active centre — the app-side
 * twin of app.my_teacher_ids, for the screens that have to *filter* rather than
 * be allowed or refused.
 *
 * /teach is why this exists. batches_member_read lets any member of a centre read
 * any of its batches, which is right for an owner and for the student whose
 * enrolment names one, and quite wrong as the definition of "my classes today":
 * the register itself is scoped by app.teaches_batch, so a teacher was shown every
 * batch in the centre with "0 students" beside it and a button into an empty
 * roster. RLS was not the thing that was broken, so this is not the layer that
 * fixes it — the screen simply has to ask for what it means.
 *
 * Empty for a staff-admin who holds no teacher row, which is why callers check
 * `isStaffAdmin` first rather than filtering on this and finding nothing.
 */
export const myTeacherIds = cache(async (): Promise<string[]> => {
  return (await myTeacherRows()).map((row) => row.id)
})

/**
 * May this reader create exams and enter marks?
 *
 * Absent means allowed, which is the opposite of how fees read the same absence
 * and the same rule app.can_manage_exams applies: the column defaults to true, and
 * `bootstrap_center` gives an owner's own teacher row no permissions row at all —
 * reading that as "may do nothing" would lock an owner out of their own marks sheet
 * on the day they signed up. So only an explicit false refuses.
 *
 * Stricter than the policy in one place, deliberately. A member whose role reads
 * teacher but who holds no active `teachers` row gets false here and true from
 * app.can_manage_exams, because the policy is ANDed with app.teaches_batch and this
 * is not: there is no batch they could be entering marks for, so the honest thing
 * to render is nothing. The app may be narrower than the boundary; it must never be
 * wider.
 */
export const canManageExams = cache(async (): Promise<boolean> => {
  const session = await getSession()
  if (!session?.active) return false
  if (isStaffAdmin(session)) return true
  if (session.active.role !== 'teacher') return false

  const rows = await myTeacherRows()
  if (rows.length === 0) return false
  return !rows.some((row) => row.perms?.can_manage_exams === false)
})

/**
 * May this reader spend the centre's SMS credits?
 *
 * Absent means allowed, as above — and unlike the other two, this one was already
 * enforced before it was ever collected here. It lived twice: once as a query on
 * the exam screen deciding whether to draw the gate, once inline in the send
 * action, which is the copy that matters because the action is a public endpoint.
 * Both now ask this.
 *
 * Owners and managers always may. They are the ones who bought the credits, and
 * the send screen shows the balance and the exact cost before it spends any.
 */
export const canSendSms = cache(async (): Promise<boolean> => {
  const session = await getSession()
  if (!session?.active) return false
  if (isStaffAdmin(session)) return true
  if (session.active.role !== 'teacher') return false

  const rows = await myTeacherRows()
  if (rows.length === 0) return false
  return !rows.some((row) => row.perms?.can_send_sms === false)
})

/**
 * May this reader see fee figures at the active centre?
 *
 * Free for every role but one. A staff-admin always may — it is their money. A
 * student or guardian never reaches a fee *board*: they see their own bill on /me
 * through a different policy, and asking this question about them would answer the
 * wrong one. So `teacher` is the only role that costs a query, and only on the two
 * screens that ask.
 *
 * Absent means no, which is the opposite of how the two above read the same
 * absence: this column defaults to false, an owner opting in is the entire point,
 * and an owner does not need a row anyway because they are staff-admin. Between
 * them the rule is one rule — the owner's explicit tick or untick beats the default
 * — and app.can_view_fees and app.can_manage_exams split the same way.
 *
 * `some` over every matching teacher row, because app.can_view_fees uses `exists`
 * and the one thing worse than disagreeing with the boundary is disagreeing with
 * it quietly. See myTeacherRows for why there can be more than one.
 *
 * This decides what to *render*. app.can_view_fees in 20260811000012 is the
 * boundary and the thing with tests — if this ever says yes where the policy says
 * no, the screen draws and every query on it comes back empty.
 */
export const canReadFees = cache(async (): Promise<boolean> => {
  const session = await getSession()
  if (!session?.active) return false
  if (isStaffAdmin(session)) return true
  if (session.active.role !== 'teacher') return false

  return (await myTeacherRows()).some((row) => row.perms?.can_view_fees === true)
})

/**
 * The same three checks, for a page rather than a Server Action.
 *
 * A page and an action want opposite things from a failed authorization. An
 * action has a form in front of it, so it catches `AuthError` and returns a
 * sentence the form can print next to the button that did not work. A page has
 * nothing to return to — throwing there is an unhandled error, which Next renders
 * as a 500. That was live on /fees and every /settings screen: a teacher who
 * tapped a bookmark, or switched to the centre they teach at with an owner screen
 * still in history, got a white error page.
 *
 * So the require* helpers above stay as they are — the primitive that throws, for
 * callers that catch — and pages call these, which turn each code into the answer
 * that suits it:
 *
 *   forbidden       -> a 403 screen naming the reader's own home (forbidden.tsx)
 *   no_center       -> /onboarding, because they have an account and no centre yet
 *   unauthenticated -> /login, which the proxy usually catches first
 *
 * Both interrupts work by throwing, so neither may be wrapped in a try/catch that
 * swallows: `forbidden()` caught is a page that renders nothing, and `redirect()`
 * caught is a page that carries on as if it were authorized. Nothing here catches
 * anything, and that is the point — this function's whole job is to convert one
 * throw into another.
 */
async function pageGuard<T>(check: () => Promise<T>): Promise<T> {
  try {
    return await check()
  } catch (err) {
    if (!(err instanceof AuthError)) throw err
    switch (err.code) {
      case 'forbidden':
        forbidden()
      case 'no_center':
        redirect('/onboarding')
      case 'unauthenticated':
        redirect('/login')
    }
  }
}

/** requireRole for a page: a 403 screen instead of a 500. See pageGuard. */
export async function pageRole(minimum: MemberRole): Promise<CenterSession> {
  return pageGuard(() => requireRole(minimum))
}

/** requireCenter for a page. See pageGuard. */
export async function pageCenter(): Promise<CenterSession> {
  return pageGuard(() => requireCenter())
}

/**
 * Where a role lands after login. Students and guardians never see staff screens.
 *
 * Returns `Route` rather than string so `redirect(homePathFor(s))` typechecks
 * against Next 16's typed routes — which means deleting a route breaks the build
 * here instead of stranding a whole role on a 404.
 *
 * Split from `homePathFor` for the centre switcher, which needs the landing page
 * of the role the reader is switching *into*. It cannot ask for a fresh session to
 * find out: `getSession` is memoised per request, so the copy it would get back
 * still names the centre they just left.
 */
export function homePathForRole(role: MemberRole | null): Route {
  if (!role) return '/onboarding'
  switch (role) {
    case 'owner':
    case 'manager':
      return '/dashboard'
    case 'teacher':
      return '/teach'
    case 'student':
    case 'guardian':
      return '/me'
  }
}

export function homePathFor(session: Session): Route {
  return homePathForRole(session.active?.role ?? null)
}
