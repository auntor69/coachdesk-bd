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
import type { Route } from 'next'

import { createClient } from '@/lib/supabase/server'
import { loginEmailToPhone } from '@/lib/bd/phone'
import { asLocale, type Locale } from '@/lib/i18n'
import { planFor, type PlanLimits } from '@/lib/plans'
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
  memberships: Membership[]
  /**
   * The center being acted on. Most users have exactly one; a teacher who works
   * at two centers has two, and we pick the first until they choose.
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
    supabase
      .from('center_members')
      .select(
        'coaching_center_id, role, branch_id, coaching_centers (name, plan, sms_credit_balance)',
      )
      .eq('user_id', user.id)
      .eq('active', true),
  ])

  const memberships: Membership[] = (rows ?? [])
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
    .filter((m): m is Membership => m !== null)
    // Highest authority first, so a user who owns one center and teaches at
    // another lands on the one they run.
    .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role])

  const active = memberships[0] ?? null

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

/**
 * Where a role lands after login. Students and guardians never see staff screens.
 *
 * Returns `Route` rather than string so `redirect(homePathFor(s))` typechecks
 * against Next 16's typed routes — which means deleting a route breaks the build
 * here instead of stranding a whole role on a 404.
 */
export function homePathFor(session: Session): Route {
  if (!session.active) return '/onboarding'
  switch (session.active.role) {
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
