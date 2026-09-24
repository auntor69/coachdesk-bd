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
import { forbidden, notFound, redirect } from 'next/navigation'
import type { Route } from 'next'

import { createClient } from '@/lib/supabase/server'
import { loginEmailToPhone } from '@/lib/bd/phone'
import { loginEmailToUsername } from '@/lib/bd/username'
import { asLocale, dict, DEFAULT_LOCALE, type Dictionary, type Locale } from '@/lib/i18n'
import type { PermissionKey } from '@/lib/permissions'
import {
  billingStanding,
  dailyBurn,
  effectiveEntitlement,
  type Access,
  type BillingStanding,
  type OrgBilling,
} from '@/lib/entitlement'
import { settleDay } from '@/lib/billing/settlement'
import { hasStaff, type PlanLimits, type StudentCeiling } from '@/lib/plans'
import { ACTIVE_CENTER_COOKIE, pickActive, strongestPerCenter } from '@/lib/auth/active-center'
import { can, narrowingOf, type Capability } from '@/lib/staff/capabilities'
import type { CenterStatus, MemberRole, PlanType } from '@/lib/supabase/types'

export type Membership = {
  centerId: string
  centerName: string
  role: MemberRole
  branchId: string | null
  plan: PlanType
  /**
   * The centre's standing: trialling, paying, suspended, cancelled.
   *
   * Beside the plan because entitlement is derived from both — a suspended centre is
   * still *on* the Coaching Center plan, and the two columns answer different
   * questions ("what did they buy" and "are they in good standing"). See
   * `effectiveEntitlement`.
   */
  status: CenterStatus
  smsCreditBalance: number
  /**
   * The tier being trialled and the instant it stops granting it, or null twice.
   *
   * Both or neither: `coaching_centers_trial_pair` says so in the database, and
   * `effectiveEntitlement` re-checks it anyway rather than trusting the constraint —
   * a plan with no end date would be a permanent free upgrade, and an end date with
   * no plan is a timer attached to nothing.
   *
   * Carried per membership and not only for the active centre, because a trial is a
   * fact about a centre and not about which one somebody is looking at. Anything that
   * resolves entitlement for a list of centres wants all of them.
   */
  trialPlan: PlanType | null
  trialEndsAt: string | null
  /**
   * The money available to settle days that are not yet paid for (MASTERPLAN.md §11.7's
   * first lever), in poisha.
   *
   * A cache of `sum(billing_ledger.amount_poisha)` — the ledger is the truth and this is
   * the column a session can read without a scan — maintained by the trigger in
   * 20260811000078 and unwritable from a browser. `effectiveEntitlement` compares it
   * against what is owed; the rail in the app shell divides it by the day's rate.
   *
   * IT IS REPLACED, NOT RE-READ, when this session settles the day: the row as the query
   * saw it is the record of what the balance was *before* the burn, and using it after
   * would be the disagreement §4.4 forbids — a screen that says a centre is paid up
   * while the write that follows is refused.
   */
  balancePoisha: number
  /**
   * The last Dhaka day that is paid for, as YYYY-MM-DD (§11.7's second lever).
   *
   * Advanced by the ledger's own trigger when a daily charge lands, and by a founder
   * granting days. Never hand-set by a customer, and it only ever moves forward, because
   * backwards would mean charging a day that has already been paid for.
   */
  chargedThrough: string
  /**
   * Places bought on top of what the plan allows (MASTERPLAN.md §4.5's per-student
   * top-up), which is why the ceiling is derived from the plan *and* this rather than
   * from the plan alone.
   *
   * Zero for every centre until something can write it, and it stays a number the
   * browser is shown rather than one it is believed: the enforcement is
   * `limitRefusal` counting rows server-side, per §4.5.
   */
  studentCapacity: number
  /**
   * The furthest date the centre's payments cover, as YYYY-MM-DD, or null when no
   * payment has said what period it bought.
   *
   * WHY IT IS ON THE MEMBERSHIP AND NOT READ FROM `payments`. It is the same date
   * `platform_centers()` returns as `paid_through`, but that table is owner-scoped and
   * SELECT-only (20260811000024), so a teacher's session cannot see it — and
   * entitlement is resolved for every member, not only for owners. A resolver reading
   * the ledger would hand the teacher full access and the owner read-only on the same
   * centre in the same minute. Denormalised onto the centre row by the trigger in
   * 20260811000059 so that every member reads one answer.
   *
   * NOT READ BY THE RESOLVER ANY MORE (§11.14): coverage stopped gating anything the
   * day the balance did, and the two derivations must never both be live. It stays on
   * the row as history — a receipt still records what period it was for — and stays on
   * this type because the plan screen and the buy-subscription flow still write and
   * read it, until step 25 replaces that flow with a recharge.
   */
  paidThrough: string | null
  /**
   * What this person may do at this centre, narrowed one capability at a time
   * (MASTERPLAN.md §6.2), or null for the whole of the role.
   *
   * Null for every owner, every teacher and every manager an owner has not narrowed —
   * which is every row that existed before 20260811000063 — so nothing about the product
   * changes by this field appearing. `can` in lib/staff/capabilities reads it.
   *
   * THE INTERSECTION OF EVERY MEMBERSHIP AT THE CENTRE, not this row's own column, which
   * is the one subtle thing about it. `app.member_allows` is a `not exists` over all
   * active rows, so a second unnarrowed membership cannot lift a veto — and a person who
   * teaches and administers holds two. `narrowingOf` folds them, so what this field says
   * is what the policies will actually do.
   *
   * A COURTESY, LIKE `studentCapacity`. The fence is the restrictive policies; this is
   * what lets a screen hide a card instead of drawing an empty one. See §6.2's own note
   * about the two service-role paths, where the check in the action is the only fence
   * there is.
   */
  capabilities: string[] | null
}

/**
 * The membership's billing columns, back in the shape entitlement reads them in.
 *
 * ONE MAPPING AND NOT TWO. The resolver takes snake_case on purpose — a rename is
 * where a typo becomes a silent `undefined` and a silently absent `trial_ends_at` is a
 * trial that never expires — so the rename has to happen somewhere, and it happens
 * once, here. The shell asks `trialStanding` the same question off the same six fields;
 * a second literal spelled out in a component is the one that goes stale.
 */
export function billingOf(m: Membership): OrgBilling {
  return {
    status: m.status,
    plan: m.plan,
    trial_plan: m.trialPlan,
    trial_ends_at: m.trialEndsAt,
    student_capacity: m.studentCapacity,
    balance_poisha: m.balancePoisha,
    charged_through: m.chargedThrough,
    // Nobody has read the day's rate at this point, and "not read" is exactly what
    // null means here. The session fills it in from the settlement when it makes one,
    // and where the centre is paid up it is never needed: `owed` is zero without it.
    daily_rate_poisha: null,
  }
}

export type Session = {
  userId: string
  /**
   * A real email, or null when this account signs in with a number or a username.
   *
   * Decided by the login domain and not by "does it parse as a number", because a
   * username address parses as neither: a check that only knew about the phone
   * domain would hand `rahim@user.coachdesk.invalid` to a screen as though a
   * teacher had an inbox.
   */
  email: string | null
  /**
   * Canonical E.164 (+8801712345678), from the profile or recovered from the
   * synthetic login address. Call formatBdMobile() to display it — never render
   * this raw, because Bangladeshis read their own numbers as 01712345678.
   */
  phone: string | null
  /**
   * What this account types into the login field when it has no number
   * (MASTERPLAN.md §5.2).
   *
   * Read off the login address rather than `profiles.username`: the address is what
   * actually signs them in and the column is a readable copy of it, so if the two
   * ever disagree this field agrees with the thing that works. It costs no query —
   * `getUser` above already returned it.
   *
   * Null for everybody who signs in with a number, which is every owner. A screen
   * needs this because the person who was told their username in a staffroom four
   * months ago is the person who will ask where to look it up.
   */
  username: string | null
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
   * Whether the list above is a list, or a read that did not arrive.
   *
   * `memberships` is empty in two situations that could not be further apart: an
   * account that has not made or joined a centre yet, and a `center_members` read
   * that failed. The first is the entire reason /onboarding exists. The second must
   * never be allowed to reach it — see requireCenter, which is where the two used to
   * become the same answer.
   */
  membershipsUnreadable: boolean
  /**
   * The center being acted on: the one they chose in the header, or the highest
   * authority they hold if they have not chosen. Most users have exactly one and
   * never see the choice. See lib/auth/active-center.
   */
  active: Membership | null
  /**
   * Whether this centre may be written to at all.
   *
   * `read_only` is a lapsed or cancelled subscription, and it is not a permission and
   * not a role: every screen still renders, every register and fee still reads, and
   * what stops is saving. MASTERPLAN.md §4.4 — holding a centre's own attendance and
   * fee book hostage turns a late-payment conversation into an angry one, so the
   * lever is discomfort rather than a locked door.
   *
   * IN FRONT OF THIS FIELD, NOT BEHIND IT: `requireWritable` is what refuses, and the
   * banner in the app shell is what explains. A field that only the shell read would
   * be decoration; a refusal nobody explained would read as the app being broken.
   *
   * `read_only` also for a reader with no active centre, because `effectiveEntitlement`
   * has no organisation to judge and fails closed. Nothing reaches a centre write that
   * way — `requireCenter` refuses first — but the banner has to check `active` before
   * it says a word about a subscription, or an account midway through onboarding is
   * told its centre has lapsed.
   */
  access: Access
  /**
   * The tier in force at the active centre — which is not always the tier they pay
   * for. A trial is a temporary better plan rather than a fifth tier, so it arrives
   * here as the plan itself and no gate downstream learns it was a trial. See
   * `effectiveEntitlement`.
   */
  plan: PlanLimits
  /**
   * How many active students this centre may hold.
   *
   * Beside `plan` rather than inside it, because on a centre tier the answer is not
   * in that table: `maxStudents` is null there, and null does not mean unlimited — it
   * means the tier bills per student, so the ceiling is what the centre has paid for
   * and no plan constant knows the figure. Every screen that read `plan.maxStudents`
   * and got null therefore drew a centre as having no limit at all, on the same day
   * migration 36 started refusing its student inserts.
   *
   * `kind` is what a refusal reads to choose its words: a teacher tier is full and
   * wants a plan change, a centre has run out of places and wants more places. See
   * `studentCeiling`.
   */
  ceiling: StudentCeiling
  /**
   * The prepaid balance as this session found it: what one day costs, what is owed,
   * and how many days the money still covers (MASTERPLAN.md §11.7, §4.4).
   *
   * THE SAME RESOLUTION `access` CAME FROM, and that is the whole reason it is here
   * rather than computed by the screen that draws it. `access` is one bit of this
   * answer; a rail that divided the balance by the rate a second time could disagree
   * with the refusal that same screen is about to hit. It is filled after the day has
   * been settled — see `settleDay` — so `daysLeft` counts from a line that is current
   * rather than from yesterday's.
   *
   * Total, never null: a reader with no centre gets a standing whose figures are absent
   * (`daysLeft: null`, nothing owed) rather than a second shape every caller has to
   * narrow before drawing anything.
   */
  billing: BillingStanding
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

  const [{ data: profile }, { data: rows, error: rowsError }] = await Promise.all([
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
      // One string literal and not three concatenated, however long it reads: the
      // generated types resolve a select at the type level from the literal itself, so
      // `'a' + 'b'` widens to `string` and every column on the row comes back as
      // `GenericStringError`. Wrapping this for width costs the whole embed's typing.
      .select(
        'coaching_center_id, role, branch_id, capabilities, coaching_centers (name, plan, status, sms_credit_balance, student_capacity, balance_poisha, charged_through, trial_plan, trial_ends_at, paid_through)',
      )
      .eq('user_id', user.id)
      .eq('active', true),
  ])

  /*
   * The narrowing per centre, worked out before the rows are folded to one membership each.
   *
   * It has to happen here rather than on the picked row, because `strongestPerCenter` keeps
   * the strongest role and throws the others away — and the veto belongs to all of them. A
   * teacher-manager's strongest row is the manager one, so reading the column off it would
   * be right by luck for that shape and wrong for an owner who was also written down as a
   * narrowed manager by mistake. §6.2's veto is refused by any row; so is this.
   */
  const narrowed = new Map<string, string[] | null>()
  for (const row of rows ?? []) {
    const id = row.coaching_center_id
    narrowed.set(
      id,
      narrowingOf([
        { capabilities: narrowed.get(id) ?? null },
        { capabilities: row.capabilities },
      ]),
    )
  }

  // `?? []` stays, and it is safe here only because of the flag returned beside it: a
  // failed read still produces an empty list, but the list is no longer the only thing
  // that says so. Every caller that acts on emptiness asks the flag first.
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
          status: center.status,
          smsCreditBalance: center.sms_credit_balance,
          trialPlan: center.trial_plan,
          trialEndsAt: center.trial_ends_at,
          studentCapacity: center.student_capacity,
          balancePoisha: center.balance_poisha,
          chargedThrough: center.charged_through,
          paidThrough: center.paid_through,
          capabilities: narrowed.get(row.coaching_center_id) ?? null,
        }
      })
      .filter((m): m is Membership => m !== null),
    (m) => ROLE_RANK[m.role],
  )

  const active = pickActive(
    memberships,
    (await cookies()).get(ACTIVE_CENTER_COOKIE)?.value,
  )

  // Neither synthetic address is a real email, and each one carries the identifier
  // it was built from — the number for an owner, the username for a teacher who
  // never gave one. Both are recovered here, so a screen can show somebody what
  // they type to sign in without a second query.
  const username = user.email ? loginEmailToUsername(user.email) : null
  const isSynthetic = user.email
    ? loginEmailToPhone(user.email) !== null || username !== null
    : false

  /*
   * ONE RESOLVER CALL, and the two fields below are both taken off its answer.
   *
   * `plan` and `ceiling` used to be derived here independently — `planFor(...)` and
   * then `studentCeiling(plan, 0)` — which worked only because nothing had yet been
   * able to make them disagree. A trial is exactly that thing: it changes which tier
   * is in force, so a ceiling derived from the *paid* tier would have given a teacher
   * trialling Pro thirty places while every feature on the screen said a hundred and
   * fifty. There is now one derivation and no way to half-apply it.
   *
   * WHAT THE THREE BILLING COLUMNS COST TODAY, now that they are actually read.
   * `trial_plan`, `trial_ends_at` and `student_capacity` were passed as null, null and
   * 0 from the day this resolver was written until migration 36 reached the live
   * database and `src/lib/supabase/types.ts` was regenerated, because a select cannot
   * ask for a column the generated types do not have. Those three literals were the
   * true state of every centre while nothing could write them, and they are the wrong
   * shape of correct: the moment a founder starts a trial, a stand-in that says "no
   * trial" is a downgrade applied by a screen. They are now read from the row.
   *
   * `student_capacity` will still be 0 everywhere for a while, and that is a fact
   * about the product rather than about this line: nothing writes it yet, because the
   * §4.5 top-up dialog and the payment path behind it are not built. The difference is
   * that when one of them writes it, every gate downstream is already asking the row
   * instead of a constant.
   *
   * `access` IS SURFACED AS OF THIS COMMIT, and only because the two things that had
   * to come with it came with it: `requireWritable` below, which every action module's
   * guard now runs, and the banner in the app shell. It was deliberately absent until
   * then — a field stored, typed and read by no gate is `can_manage_students` all over
   * again, a protection that exists only in the shape of the data.
   *
   * THE BALANCE REPLACED THE COVERAGE DATE IN THIS SELECT (§11.14), and it is here for
   * the same reason `paid_through` was: the ledger it is derived from is not readable by
   * every member, so a teacher's session gets the centre's money through this embed or
   * not at all. `paid_through` is still read — the plan screen and its buy flow are
   * still the old model until step 25 — and the resolver stops consulting it, because
   * two live derivations of access disagree on exactly the day it matters.
   */

  /*
   * SETTLE, THEN RESOLVE — in that order, and for every centre whose days cost anything.
   *
   * §16.1 step 24 puts the burn in front of the write guard, and the guarantee behind
   * that is the one being kept here: the day is charged from the size at the moment work
   * starts, which is what closes the only gaming vector daily billing has. Every action
   * reaches `requireWritable` through a session, so a charge taken here is still taken
   * before any write can land — and the read-only arms and the banner get the *same*
   * answer, which a refusal thrown at the write could never give them: a dry centre
   * whose screens all looked writable until the owner tapped something names the
   * problem one interaction too late (§4.4).
   *
   * IT IS ASKED ON EVERY REQUEST AND NOT ONLY ON THE ONE THAT OWES, because the call is
   * also the only thing that knows the day's rate — and the rail above the content, and
   * the banner that explains a dry balance, both need it on exactly the days when no
   * settlement happens. What that costs is a price card read, two head counts and a
   * balance sum on a page load; what it buys is that a centre's own screen can say what a
   * day costs it. `dailyBurn` refuses only the free tier, whose rate is zero forever.
   *
   * THE BURN DOES NOT WRITE ON EVERY CALL. It is idempotent per day: a centre that is
   * paid up with an unchanged roster inserts nothing, a repeated refusal is one row for
   * the day (`settlement_runs_one_note_per_day`), and the day's base charge is unique.
   * So the common path here is reads, a lock, and a return.
   *
   * A SETTLEMENT THAT DID NOT HAPPEN LEAVES THE RATE UNKNOWN, and unknown is not zero:
   * the resolver reads it as read-only wherever the rate is needed (§11.7). So a
   * database that refuses the call is a centre that cannot write when its line is behind
   * — the narrow direction, the same one every other fallback in this file takes.
   *
   * `billing` is recomputed from the settlement's answer rather than from the row, and
   * `org` is rebuilt with it: the embed is the record of what the balance was *before*
   * the burn, and a rail drawn from it would show one day more than the centre has.
   */
  const now = new Date()
  let org = active ? billingOf(active) : null
  let billing = billingStanding(org, now)

  if (active && org && dailyBurn(org)) {
    const { settlement: settled } = await settleDay(supabase, active.centerId)
    org = {
      ...org,
      balance_poisha: settled?.balanceAfter ?? org.balance_poisha,
      charged_through: settled?.chargedThrough ?? org.charged_through,
      daily_rate_poisha: settled?.dailyPoisha ?? null,
    }
    billing = billingStanding(org, now)
  }

  const entitlement = effectiveEntitlement(org, now)

  return {
    userId: user.id,
    email: isSynthetic ? null : (user.email ?? null),
    phone: profile?.phone ?? (user.email ? loginEmailToPhone(user.email) : null),
    username,
    fullName: profile?.full_name ?? null,
    locale: asLocale(profile?.locale),
    isPlatformAdmin: profile?.is_platform_admin ?? false,
    memberships,
    membershipsUnreadable: Boolean(rowsError),
    active,
    access: entitlement.access,
    plan: entitlement.plan,
    ceiling: entitlement.ceiling,
    billing,
  }
})

/**
 * Thrown by the require* helpers. Carries an HTTP-ish code so a Route Handler
 * can answer 401/403 while a page redirects, without either one parsing a
 * message string.
 *
 * `unreadable` is the odd one out and is not an authorization answer at all: it
 * means the question could not be put. It exists because the other three are all
 * statements about the caller — you are not signed in, you have no centre, you may
 * not do this — and a dropped read is a statement about us. Every one of those three
 * sends the reader somewhere to fix it, and there is nothing for them to fix.
 *
 * `read_only` is a fifth that is not about the caller either: it is about the centre's
 * standing, and the same owner who is refused today may write tomorrow having paid. It
 * is a separate code rather than a `forbidden` with different words because every
 * module's converter has to be able to reach for a different sentence — "you are not
 * allowed to do this" is wrong and insulting when the truth is "the subscription
 * lapsed", and the second one has a fix the reader can act on.
 *
 * `narrowed` is a sixth on the same argument. A refused manager IS allowed here in every
 * sense they can see — they have the screen, the nav item and the role — and what they
 * lack is one of the six words their owner ticked. `forbidden`'s sentence would send them
 * looking for the setting that would let them, and the setting is on somebody else's
 * screen. Having the code is what lets `authRefusal` say so once for all six modules.
 */
export class AuthError extends Error {
  constructor(
    readonly code:
      | 'unauthenticated'
      | 'no_center'
      | 'forbidden'
      | 'unreadable'
      | 'read_only'
      | 'narrowed',
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
 *
 * WHY THE EMPTY CENTRE LIST IS ASKED ABOUT TWICE. `no_center` is answered by
 * pageGuard with a redirect to /onboarding, which is right: an account with no centre
 * is an account that has not made one, and the form there makes it. But a
 * `center_members` read that did not arrive produced exactly the same empty list, so
 * it produced exactly the same redirect — and the owner of a centre with four hundred
 * students on it was handed the form that creates their second.
 *
 * That is the one failure in this family that cannot be undone by waiting. The others
 * mislead a reader for as long as the screen is up; this one takes a tap and leaves a
 * live account holding two centres, one of them empty, with `bootstrap_center` having
 * written a fresh owner row and the switcher in the header now offering a choice that
 * did not exist that morning. Their students, batches, fees and registers are all in
 * the first one, and nothing on the second says so.
 *
 * So the two are separated here, at the one place both used to pass through.
 */
export async function requireCenter(): Promise<CenterSession> {
  const session = await requireUser()
  if (!session.active) {
    if (session.membershipsUnreadable) {
      throw new AuthError(
        'unreadable',
        'The centres for this account could not be read just now.',
      )
    }
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

/**
 * The write check, applied to whatever authorization the caller has already done.
 *
 * Not a `requireX()` of its own, and that is the whole design: role, permission and
 * plan are questions about *who is asking*, and this one is a question about the
 * centre they are asking on behalf of, so it composes rather than replaces —
 * `requireWritable(await requireRole('manager'))`. Every action module's local guard
 * runs it in exactly one place, which is why one line per module covers every action
 * in it, and why an action added tomorrow is covered by having been added there.
 *
 * READ-ONLY IS NOT ENFORCED IN THE DATABASE, deliberately, and the note in
 * `entitlement.ts` says the same about the plan. RLS is about whose rows these are;
 * this is about whether a bill was paid, and wiring it into policies would mean the
 * founder correcting a status by hand could blank a working centre's screens as a side
 * effect — with the founder's own panel, which writes through the service role, the
 * one thing still able to move. So the fence is here, in front of the writes, and the
 * database keeps answering the question it can actually answer.
 *
 * Generic over the shape rather than typed to `CenterSession`, so the session it is
 * handed comes back narrowed exactly as it went in, and so a test can ask the question
 * with `{ access: 'read_only' }` instead of building a whole session to be refused.
 */
export function requireWritable<T extends { access: Access }>(session: T): T {
  if (session.access !== 'full') {
    throw new AuthError(
      'read_only',
      'This centre is read-only: its subscription has lapsed or was cancelled.',
    )
  }
  return session
}

/**
 * The capability check, composed onto whatever authorization the caller has already done.
 *
 * `requireCapability('fees', requireWritable(await requireRole('manager')))` — the same
 * shape as `requireWritable` and for the same reason: role, plan, standing and capability
 * are four different questions and each module asks the ones that apply to it in one place.
 *
 * THIS IS NOT THE FENCE for anything RLS can see. 20260811000063 puts restrictive policies
 * on sixteen tables, and those hold against a hand-posted form whether this line is here or
 * not. What this adds is a sentence instead of an empty result — a narrowed manager who
 * posts the fee form would otherwise get "could not be saved", which reads as a bug in the
 * product rather than as a decision their owner made.
 *
 * WHERE IT IS THE ONLY FENCE, and the reason it is exported rather than folded into each
 * module's local guard: `exams/actions.ts` and `settings/actions.ts` write through
 * `createAdminClient`, and the service role bypasses every policy in the schema. For those
 * two paths this function is the whole enforcement, which is why 20260811000063's closing
 * section names them.
 *
 * A CODE OF ITS OWN, for the reason `read_only` has one: the module that catches this has
 * no way to word it. Its fallback sentence is about rank — "owners and managers only" —
 * and the reader is a manager, so the one sentence that helps names the six boxes and
 * whose screen they are on. `authRefusal` reaches for it, once, for all six modules.
 */
export function requireCapability<T extends { active: Membership }>(
  capability: Capability,
  session: T,
): T {
  if (!can(session.active.capabilities, capability)) {
    throw new AuthError(
      'narrowed',
      `This membership was narrowed and does not include ${capability}.`,
    )
  }
  return session
}

/**
 * The sentence a refused guard shows, in the caller's own language.
 *
 * READ-ONLY OUTRANKS THE CALLER'S OWN MESSAGE, in one place rather than in seven. Every
 * module used to answer its failures with a single "you are not allowed" line, which is
 * the right words for a wrong role and the wrong words entirely for a lapsed
 * subscription: it tells an owner who has every permission in the product that they
 * personally are not permitted, so they look for the setting that would let them and
 * there is none. The fix is a different fact, not a softer one.
 *
 * SO DOES A NARROWED MEMBERSHIP, and it is the same trade in the other direction: the
 * module's fallback is a sentence about rank, and this reader has the rank. Both codes are
 * answered here so a module gets them right by having done nothing — `fees/actions.ts`
 * composes one guard and keeps one fallback, and the two sentences it never writes are the
 * two it would have got wrong.
 *
 * `fallback` is a function of the dictionary rather than a string, because the caller
 * cannot read its own group until this has resolved which language to read it in.
 *
 * getSession is memoised per request and the guard that just threw already called it,
 * so reading the locale back here costs nothing. A caller with no session at all has
 * no language either, hence the default.
 */
export async function authRefusal(
  err: AuthError,
  fallback: (d: Dictionary) => string,
): Promise<string> {
  const caller = await getSession()
  const d = dict(caller?.locale ?? DEFAULT_LOCALE)
  if (err.code === 'read_only') return d.readOnly.refused
  if (err.code === 'narrowed') return d.capabilities.refused
  return fallback(d)
}

/** Owners and managers — the two roles that may change a center's setup. */
export function isStaffAdmin(session: Session): boolean {
  return session.active ? atLeast(session.active.role, 'manager') : false
}

/**
 * The person who sells this product, reading their own founder panel.
 *
 * Not a role and not a permission: `is_platform_admin` is a column on `profiles`
 * that sits outside every centre, because the founder's authority is over the
 * platform rather than inside any one customer's data. So there is no
 * `requireCenter` in front of it — the panel lists centres and belongs to none of
 * them, and the founder's own demo centre being suspended must not lock them out
 * of the screen that says so.
 *
 * The database asks the same question again in `app.is_platform_admin()`, which is
 * what actually protects the rows. This is the cheap check that keeps a
 * non-founder from reaching the screen at all; the RPC is the one that would
 * refuse them if they did.
 */
export async function requirePlatformAdmin(): Promise<Session> {
  const session = await requireUser()
  if (!session.isPlatformAdmin) {
    throw new AuthError('forbidden', 'Platform administrators only.')
  }
  return session
}

/**
 * All five permission columns, keyed off the same list the settings form renders
 * from — so a sixth checkbox added to `PERMISSION_KEYS` stops compiling here until
 * the embed below selects it, rather than reading as silently absent.
 *
 * The alternative was five hand-written booleans, which is how this started and
 * which is exactly how two of the five ended up collected nowhere: the type said
 * three columns, the query asked for three columns, and `can_manage_students` was
 * never once read by the app that offered it.
 */
type TeacherPerms = Record<PermissionKey, boolean>

/**
 * The reader's own `teachers` rows at the active centre, with the permissions
 * that hang off them.
 *
 * One query behind six questions — which batches are mine, may I see fees, may I
 * enter marks, may I message a parent, may I admit a student, may I open a batch —
 * because several of them are asked on the same request by different files: the
 * shell asks for the nav, the page asks for its own guard, the action asks again
 * because it is a public endpoint. React's `cache` means they share this. Not
 * exported: the helpers below are the useful shapes, and a caller reaching for the
 * rows themselves would be about to re-derive one of them.
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
 *
 * AND THE WHOLE THING IS NULL WHEN THE READ DID NOT ARRIVE, which is a fourth
 * state and used to be the same as the first. `(data ?? [])` turned a dropped
 * query into an empty staff list, and an empty staff list is a person who teaches
 * nothing and may do nothing — so a teacher whose one row failed to load was told
 * by /teach that none of the batches were theirs, and by the roster screen that
 * their owner had taken their admissions box away. Every reader of this now has to
 * say which of the two it means.
 */
const myTeacherRows = cache(
  async (): Promise<{ id: string; perms: TeacherPerms | null }[] | null> => {
    // Not a failure: nobody signed in, or signed in and attached to no centre, holds
    // no teacher rows anywhere. An answer, and the same answer every time.
    const session = await getSession()
    if (!session?.active) return []

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('teachers')
      // Spelled out rather than joined from PERMISSION_KEYS, because PostgREST's
      // types are inferred from the literal: a computed select string types every
      // column as unknown and the unwrap below stops being checked at all. The type
      // above is what keeps the two lists in step.
      .select(
        `id, teacher_permissions (
          can_manage_exams,
          can_send_sms,
          can_manage_students,
          can_manage_batches,
          can_view_fees
        )`,
      )
      .eq('coaching_center_id', session.active.centerId)
      .eq('user_id', session.userId)
      .eq('active', true)

    // A non-head select answers `[]` for a member who holds no rows and `null` only
    // when the query failed, so `error` and the null say the same thing here and
    // either one is enough to refuse to answer.
    if (error || !data) return null

    return data.map((row) => {
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
 * Either the reader's `teachers.id` values, or the fact that they could not be read.
 *
 * A two-armed object rather than `string[] | null`, and the shape is the whole point:
 * four of the five callers below already use `null` to mean "this reader is a
 * staff-admin, do not filter the list at all". A nullable return would have been
 * absorbed straight into that — silently, with the compiler agreeing — and the
 * absorbed value is the widest possible answer. A teacher whose staff list did not
 * load would have been handed every batch in the centre instead of their two, on the
 * screen whose entire job is to know the difference.
 *
 * So the two cannot be assigned to one another. `'unreadable' in scope` is a
 * decision each caller has to write down, and the four that filter write it down
 * differently to the one that stores a column.
 */
export type TeacherScope = { ids: string[] } | { unreadable: true }

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
 * `{ ids: [] }` for a staff-admin who holds no teacher row, which is why callers
 * check `isStaffAdmin` first rather than filtering on this and finding nothing.
 */
export const myTeacherIds = cache(async (): Promise<TeacherScope> => {
  const rows = await myTeacherRows()
  return rows === null ? { unreadable: true } : { ids: rows.map((row) => row.id) }
})

/* -------------------------------------------------------------------------- */
/* What a teacher may do                                                      */
/*                                                                            */
/* The five helpers below answer for one person at one centre, and all five    */
/* open with the same three lines: a staff-admin always may, a plan with no    */
/* staff features always refuses, and a member whose role is not `teacher` is  */
/* not the question being asked.                                              */
/*                                                                            */
/* `hasStaff` is the line worth explaining. Every power here is an owner       */
/* delegating a job — reading the centre's money, spending its credits,        */
/* entering marks, admitting students, opening batches — and a one-seat plan   */
/* sells nobody to delegate to. It looks like dead code, because the one seat  */
/* a teacher tier does sell belongs to the owner, who left two lines earlier   */
/* as a staff-admin. The only caller that reaches it is a teacher row left     */
/* behind by a downgrade: `setCenterPlan` writes the new plan and only *warns* */
/* when the centre is over its seat count, so a centre that drops from six     */
/* teachers to one keeps five rows that its plan no longer covers. Without     */
/* this line those five would go on reading the fee board and spending SMS     */
/* credits indefinitely. /settings/teachers is where the owner switches them   */
/* off, and it draws a list on a one-seat plan for exactly that reason.        */
/*                                                                            */
/* Not in RLS, and not by omission. No policy anywhere reads                   */
/* coaching_centers.plan: the boundary is about whose rows these are, not      */
/* about what was paid for them, and a founder correcting a plan by hand must  */
/* not blank a working teacher's screens as a side effect. Entitlement lives   */
/* one layer in, here — narrower than the boundary, never wider.               */
/*                                                                            */
/* All five also answer false when the staff list could not be read at all,    */
/* and that is the same rule pointing at a different cause: the app may be     */
/* narrower than the boundary and must never be wider, so a permission that    */
/* could not be checked is not granted. It costs a teacher a marks field or a  */
/* column of figures for as long as the read keeps failing, which is a screen  */
/* that says less than it could rather than one that says something untrue.    */
/* requirePermission is where that false stops being enough — a whole screen   */
/* refused reads as an owner having taken something away, so it asks these     */
/* rows one more question before it says so.                                   */
/* -------------------------------------------------------------------------- */

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
  if (!hasStaff(session.plan)) return false
  if (session.active.role !== 'teacher') return false

  const rows = await myTeacherRows()
  // Unread, not unpermitted — see the block above. Ahead of the empty check because
  // the two are different facts and only one of them is about this person.
  if (rows === null) return false
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
 *
 * UNLESS THE MANAGER WAS NARROWED AWAY FROM `messages` (§6.2), and this is the one of
 * these five helpers where the veto is a fence rather than a courtesy: the send spends
 * credits through `createAdminClient`, which bypasses every policy 20260811000063 wrote.
 * There is no empty result to fall back on here — an unnarrowed check would let a
 * receptionist their owner silenced spend the centre's money on a send.
 */
export const canSendSms = cache(async (): Promise<boolean> => {
  const session = await getSession()
  if (!session?.active) return false
  if (isStaffAdmin(session)) return can(session.active.capabilities, 'messages')
  if (!hasStaff(session.plan)) return false
  if (session.active.role !== 'teacher') return false

  const rows = await myTeacherRows()
  // As above: a read that failed spends nothing rather than spending on a guess.
  if (rows === null) return false
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
 *
 * WHICH IS EXACTLY WHY A NARROWED MANAGER IS NO (§6.2). 20260811000063's fee policies
 * narrow reads as well as writes, so a manager whose owner unticked `fees` has a fee
 * board where every figure is zero and every list is empty — a centre that looks like it
 * has collected nothing and owes nothing. The sentence in that paragraph is about
 * teachers and applies here word for word.
 */
export const canReadFees = cache(async (): Promise<boolean> => {
  const session = await getSession()
  if (!session?.active) return false
  if (isStaffAdmin(session)) return can(session.active.capabilities, 'fees')
  if (!hasStaff(session.plan)) return false
  if (session.active.role !== 'teacher') return false

  const rows = await myTeacherRows()
  // The default is already no, so this line changes nothing about what renders — it
  // is here so the reason is written down rather than inferred from `.some()` of
  // nothing, which is how the other four used to answer this too.
  if (rows === null) return false
  return rows.some((row) => row.perms?.can_view_fees === true)
})

/**
 * May this reader see the centre's roster and admit students to it?
 *
 * The checkbox that did nothing until 20260811000019. It was stored, defaulted,
 * rendered with a label promising "add & edit students", and read by no policy and
 * no screen — so an owner who ticked it delegated admissions to a colleague who
 * then found the same three screens refusing them, and the owner had no way to tell
 * except by noticing that no students were being added.
 *
 * Absent means no, as with fees and for the same reason: the column defaults false
 * and the grant is the whole centre roster — every minor's record and every
 * guardian's mobile number at the centre. That is the widest read this app hands to
 * anybody below manager, and it is wide because the job needs it: the roster screen
 * *is* the list, and the paste-a-register import deduplicates against every name
 * already on it, so a teacher who could see only their own batch would re-add half
 * the centre.
 *
 * `hasStaff` as above, and this is the helper it was written for: delegating
 * admissions is a centre capability, and the screen where the box is ticked is
 * itself behind that flag. The leftover teacher rows do not disappear at the
 * moment a plan changes, so without the check a downgraded centre would keep
 * every grant it had made on a plan that sells one seat.
 *
 * app.can_manage_students is the boundary. This decides what to render, and if the
 * two ever disagree in this direction the screen draws and comes back empty.
 */
export const canManageStudents = cache(async (): Promise<boolean> => {
  const session = await getSession()
  if (!session?.active) return false
  if (isStaffAdmin(session)) return true
  if (!hasStaff(session.plan)) return false
  if (session.active.role !== 'teacher') return false

  const rows = await myTeacherRows()
  // See canReadFees. The screens behind this one throw rather than render, so the
  // false is picked up again by requirePermission, which has more to say about it.
  if (rows === null) return false
  return rows.some((row) => row.perms?.can_manage_students === true)
})

/**
 * May this reader open a batch at the centre?
 *
 * The cheaper of the two, because reading batches was never restricted:
 * `batches_member_read` already shows every member of a centre every batch in it,
 * so this adds the ability to create one and nothing to what the teacher can see.
 * What it does add is the monthly fee that comes with a new batch — a figure the
 * same reader could already read on every existing batch.
 *
 * Deliberately does not carry enrolment. Putting an existing student into a batch
 * is the batch checkbox set on /settings/students/[studentId], which `can_manage_students`
 * grants and this checkbox does not — and the split is not tidiness. A teacher
 * assigned to a batch reads its students through app.my_taught_student_ids, so
 * "enrol anyone into my own batch" is "read anyone": the grant would let its holder
 * walk the whole centre's roster one enrolment at a time. Admissions is the other
 * checkbox, and an owner who wants both ticks both.
 */
export const canManageBatches = cache(async (): Promise<boolean> => {
  const session = await getSession()
  if (!session?.active) return false
  if (isStaffAdmin(session)) return true
  if (!hasStaff(session.plan)) return false
  if (session.active.role !== 'teacher') return false

  const rows = await myTeacherRows()
  // See canManageStudents.
  if (rows === null) return false
  return rows.some((row) => row.perms?.can_manage_batches === true)
})

/**
 * The two permissions that stand in for a role, so a caller can ask for one the
 * way it asks for `requireRole('manager')`.
 *
 * Only these two. The other three permission columns gate a *part* of a screen — a
 * send button, a marks field, a column of figures — and their callers want the
 * boolean so they can render the rest. These two gate whole screens, which is what
 * makes a throwing guard the right shape.
 */
export type RosterPermission = Extract<
  PermissionKey,
  'can_manage_students' | 'can_manage_batches'
>

/**
 * Total by construction, so a third roster permission cannot be added to the type
 * above without a check to go with it — a lookup with a hole in it would refuse
 * every caller and read like a permission that was never granted.
 */
const ROSTER_CHECK: Record<RosterPermission, () => Promise<boolean>> = {
  can_manage_students: canManageStudents,
  can_manage_batches: canManageBatches,
}

/**
 * A member of the centre who either outranks the permission or holds it.
 *
 * No `requireRole` in front of it: both checks return true for a staff-admin
 * already, so the rank is folded into the question rather than asked twice — and
 * asking `requireRole('manager')` first is precisely the bug this replaces, since
 * a teacher never clears it however many boxes the owner ticked.
 *
 * Throws like the require* helpers, for the Server Actions that catch. Pages call
 * pagePermission below.
 *
 * WHY THE REFUSAL IS ASKED ABOUT TWICE. The check above answers false for a
 * permission it could not read, which is the right answer to give a *part* of a
 * screen — a marks field, a column of figures — and the wrong one to build a whole
 * screen out of. `forbidden` renders "you do not have access to this", and to a
 * teacher who opened the roster they were admitting students to yesterday that is
 * not a failure they can see: it is their owner having unticked a box overnight.
 * What follows is a message to the owner, who looks at the checkbox, finds it
 * ticked, and now has a product that lies to one of them.
 *
 * So a false that came from a read rather than from a decision is separated out
 * here, at the one place a permission closes a door. Only for a teacher on a plan
 * that sells the delegation: a staff-admin never reached this line, and a
 * downgraded centre is refused by its plan whatever the staff list says, so
 * neither is owed the extra question. `myTeacherRows` is cached and was already
 * asked by the check above, so for the reader this is about it costs nothing.
 */
export async function requirePermission(
  permission: RosterPermission,
): Promise<CenterSession> {
  const session = await requireCenter()
  if (await ROSTER_CHECK[permission]()) return session

  if (
    session.active.role === 'teacher' &&
    hasStaff(session.plan) &&
    (await myTeacherRows()) === null
  ) {
    throw new AuthError(
      'unreadable',
      'This account’s permissions could not be read just now.',
    )
  }

  throw new AuthError(
    'forbidden',
    `Needs manager or above, or ${permission}; this account is ${session.active.role}.`,
  )
}

/**
 * The same checks, for a page rather than a Server Action.
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
 *   narrowed        -> the same 403, for a capability their owner did not tick
 *   no_center       -> /onboarding, because they have an account and no centre yet
 *   unauthenticated -> /login, which the proxy usually catches first
 *   unreadable      -> app/error.tsx, by rethrowing
 *
 * The last one is a rethrow and not a fourth screen, because the screen already
 * exists and is the right one. error.tsx says "something went wrong, try again" in
 * both languages over a retry button, which is the whole of what there is to say: no
 * session to read a language from, nothing the reader did, and nothing for them to go
 * and fix. Every other answer this function can give is a door — a login form, a
 * create-your-centre form, a 403 naming somewhere else to be — and pointing a reader
 * at a door is the one thing a dropped read must not do.
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
      case 'unreadable':
        throw err
      // Unreachable by construction: read-only stops writes, and a page is a read —
      // no `pageX` helper runs `requireWritable`, because the screens are exactly
      // what a suspended centre keeps. Handled so the switch stays total, and
      // rethrown rather than turned into a 403, because if it ever does arrive it
      // means a guard was composed wrongly and that is a bug to see, not to render.
      case 'read_only':
        throw err
      // A 403 and not a rethrow, because this one IS reachable from a page:
      // pageCapability below exists for the screens a narrowed manager may not open.
      // forbidden.tsx names the reader's own home, which is where they should be.
      case 'narrowed':
        forbidden()
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
 * requirePermission for a page: the 403 screen, not a 500. See pageGuard.
 *
 * This is what the roster and batch screens now open with, in place of the
 * `pageRole('manager')` that made the two checkboxes decorative.
 */
export async function pagePermission(
  permission: RosterPermission,
): Promise<CenterSession> {
  return pageGuard(() => requirePermission(permission))
}

/**
 * A page a narrowed manager may not open at all: the role first, then the capability.
 *
 * `minimum` rather than a fixed `'manager'` because the money screens are owner-and-manager
 * and the roster screens are not, and a page that asked the capability without the rank
 * would open the fee board to a teacher — nothing narrows a teacher, so `can` says yes.
 *
 * A 403 IS THE SECOND-BEST ANSWER HERE and the nav is the first. A receptionist who never
 * sees a Fees item never types /fees, and this is for the bookmark, the back button and the
 * centre switcher — the three ways a reader arrives at a screen nobody offered them. So
 * hiding the item is not decoration and this is not the fence; between them the reader is
 * neither misled nor stopped at a door they were shown.
 */
export async function pageCapability(
  capability: Capability,
  minimum: MemberRole = 'manager',
): Promise<CenterSession> {
  return pageGuard(async () => requireCapability(capability, await requireRole(minimum)))
}

/**
 * requirePlatformAdmin for a page — and the one guard here that does not use
 * pageGuard, because a 403 is the wrong answer.
 *
 * `forbidden()` renders a screen that says "you do not have access to this", which
 * tells a paying customer who typed /founder that there is something at /founder
 * to be kept out of. There is no security in hiding it — the RPC behind the screen
 * refuses them on its own, and the grants refuse a signed-out request before that
 * — but the founder panel lists every customer by name, and a centre owner
 * learning it exists learns that their own numbers are on somebody's screen. That
 * is a conversation to have deliberately, not one to have because of a URL.
 *
 * So for anyone who is not the founder, this route simply does not exist. Same
 * reason it lives at /founder rather than inside the (app) group: no nav item, no
 * link, no 403 breadcrumb.
 *
 * notFound() throws its own interrupt, so — as with pageGuard — nothing may wrap
 * this in a try/catch that swallows.
 */
export async function pagePlatformAdmin(): Promise<Session> {
  const session = await getSession()
  if (!session?.isPlatformAdmin) notFound()
  return session
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
 * still names the centre they just left. It answers about memberships only — a
 * platform admin is not a role in any centre, so the founder panel never comes
 * from here.
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

/**
 * Where a session lands after login.
 *
 * A platform admin with no active membership belongs on the founder panel, not on
 * /onboarding — the founder account holds no centre and must not be handed the
 * form that creates one, because a centre founded by the platform account would
 * put customer data on the one login that can already see every centre (§11.5's
 * separation, and the reason the panel row sits outside every group in Settings).
 * The precedence is deliberate: a platform admin who *does* hold a membership is
 * working in that centre and lands where that role lands, reaching the panel
 * through the Settings row the way they always did.
 */
export function homePathFor(session: Session): Route {
  if (!session.active && session.isPlatformAdmin) return '/founder'
  return homePathForRole(session.active?.role ?? null)
}
