/**
 * What an organisation is actually allowed to do, right now — derived, in one place.
 *
 * MASTERPLAN.md §4 names six concepts that a single `plan` column used to do the job
 * of, and this file is the one that combines three of them into an answer:
 *
 *   plan          which features and caps does a tier have?   -> plans.ts, in code
 *   subscription  which tier, standing how, paid up to when?
 *   trial         is a temporary better plan in force, until when?
 *   capacity      how many student places have been paid for?
 *   ENTITLEMENT   what is allowed *right now*?                -> here
 *
 * ENTITLEMENT IS DERIVED AND NEVER STORED. The moment it is written to a column it
 * can disagree with the things it was derived from, and both directions of that
 * disagreement are worse than recomputing: a customer whose trial ended is either
 * still holding a paid tier or has lost the free one.
 *
 * AND NOTHING DOWNSTREAM LEARNS WHY. A feature gate, a cap check and a permission
 * helper all read the *result* — a plan, a ceiling, and whether writing is allowed.
 * None of them is told that the plan came from a trial, that a payment lapsed, or
 * which status produced the answer. That is the whole point of the indirection:
 * `isTrial` asked at one call site is a branch, asked at forty it is a second plan
 * model, and a fifth `PlanId` for "trialling" would fork every gate in the app.
 *
 * SO THERE IS NO TRIAL FLAG IN THE RESULT. A screen that legitimately needs one —
 * the day-10 "four days left" notice — is asking a different question ("when does
 * this trial end") of the row rather than of the entitlement, and it can read the
 * two columns itself. Anything that reaches for a trial flag to decide what is
 * *allowed* is about to reintroduce the fork.
 *
 * EXPIRY IS A COMPARISON, NOT A JOB. `trial_ends_at > now` is evaluated on every
 * session read, so a trial ends on time even if no scheduled task ever runs, the app
 * was closed for a week, or a cron failed silently. A job that "expires trials" is a
 * second source of truth and will eventually disagree with the clock; anything such
 * a job does here is cosmetic.
 *
 * A LAPSE IS THE SAME COMPARISON, and §4.4 asks for it in those words: the transition
 * to read-only is "computed from coverage, not from a flag somebody remembered to set".
 * That is the one part of the monthly bKash conversation that has to be automatic,
 * because it is the part a founder cannot be trusted to do consistently to a customer
 * they like. `paid_through` plus `GRACE_DAYS` is read on every session, so it happens
 * on the right day whether or not anybody is watching, and un-happens the moment a
 * receipt is recorded — no job to run, and none to forget to run backwards.
 *
 * NOT THE BOUNDARY. RLS in Postgres decides whose rows these are, and
 * `app.guard_center_billing` and `app.guard_student_capacity` are what a browser
 * cannot talk its way past. This is one layer in: narrower than the boundary, never
 * wider. If the two ever disagree in this direction, a screen draws and its queries
 * come back empty.
 */

import { daysBetween, todayInDhaka } from './bd/time.ts'
import {
  PLAN_RANK,
  planFor,
  studentCeiling,
  type PlanLimits,
  type StudentCeiling,
} from './plans.ts'
import type { CenterStatus } from './supabase/types.ts'

/**
 * Whether this organisation may write, or may only look.
 *
 * READ-ONLY MEANS READ-ONLY, NOT LOCKED OUT (MASTERPLAN.md §4.4). Attendance
 * history, marks, the fee board and the roster all stay visible; what stops is
 * writing — no new students, no attendance taken, no payments recorded, no messages
 * sent. Locking a lapsed customer out of their own term's registers and outstanding
 * fee book turns a late-payment conversation into an angry one, and they do not come
 * back. Read-only is uncomfortable enough, since they cannot run the centre on it,
 * without also being a threat.
 */
export type Access = 'full' | 'read_only'

/**
 * The four statuses, and what each one allows — total by construction, so a fifth
 * cannot be added to the enum without a decision about writing being made here.
 *
 * A lookup rather than `status === 'suspended' || status === 'cancelled'`, because
 * that expression's default is "everything else may write" and a new status would
 * take it silently. This one stops compiling.
 *
 * `trial` is full access on purpose: it is the founder's 30-day sales trial from
 * MASTERPLAN.md §9, where nobody has paid yet and the entire point is that the
 * centre runs its real term on the product. It is not the Teacher Pro trial below —
 * that one is a plan for a fortnight, this one is a standing with no plan of its own,
 * and merging the two clocks would put a fourteen-day timer on a customer the
 * founder is still selling to.
 *
 * THIS IS THE FLOOR AND NOT THE WHOLE ANSWER. `active` earns full access from the
 * status column and can still lose it to a lapse — see `coverageLapsed`. Nothing goes
 * the other way: no coverage can talk a `suspended` row into writing.
 */
const ACCESS_BY_STATUS: Record<CenterStatus, Access> = {
  trial: 'full',
  active: 'full',
  suspended: 'read_only',
  cancelled: 'read_only',
}

/**
 * How long after coverage runs out a centre keeps writing. MASTERPLAN.md §4.4's
 * proposed constant, and the whole of the grace window.
 *
 * SEVEN AND NOT THIRTY, because the bill is monthly: a grace window as long as the
 * cycle means a customer can be a full period behind and never notice, and the
 * conversation that catches churn never happens. Seven days is a week to get to a
 * bKash agent, which is the real-world obstacle.
 *
 * SEVEN AND NOT ZERO, because `covers_period_end` is a date somebody typed while
 * looking at a transfer, and the last day of a month is a Friday often enough. A
 * customer who paid on time should never see this banner because their receipt was
 * entered on Sunday.
 */
export const GRACE_DAYS = 7

/**
 * The columns entitlement is derived from. Exactly these, from
 * `public.coaching_centers`.
 *
 * SNAKE_CASE, MATCHING THE DATABASE, so a caller passes the row it read rather than
 * renaming five fields on the way in — a rename is a place a typo becomes a silent
 * `undefined`, and a silently absent `trial_ends_at` is a trial that never expires.
 *
 * EVERY KEY IS REQUIRED AND EVERY VALUE MAY BE NULL, which is deliberate and is not
 * the same as making the keys optional. Null is a real state for four of these —
 * no trial, no plan recorded, no capacity bought — but *forgetting* one is not a
 * state at all: it is a `select` that did not ask for the column, and with optional
 * keys that compiles into "no trial" for a centre that is trialling. So the compiler
 * makes the caller write each one down, including the ones it has nothing to say
 * about.
 */
export type OrgBilling = {
  /** `coaching_centers.status`. Anything outside the enum is treated as read-only. */
  status: string | null
  /** `coaching_centers.plan` — what the customer pays for, trial aside. */
  plan: string | null
  /** `coaching_centers.trial_plan` — the tier being trialled, or null. */
  trial_plan: string | null
  /** `coaching_centers.trial_ends_at` — timestamptz, so an ISO string over the wire. */
  trial_ends_at: string | Date | null
  /** `coaching_centers.student_capacity` — places bought beyond the plan allowance. */
  student_capacity: number | null
  /**
   * `coaching_centers.paid_through` — the furthest date any payment covers, as
   * YYYY-MM-DD, or null when no payment says what period it bought.
   *
   * A `date` and therefore a string, unlike `trial_ends_at`: it names a calendar day
   * with no time of day, and letting a `Date` in would invite a UTC midnight to be
   * compared against a Dhaka morning. Maintained by the trigger in
   * 20260811000059 — never hand-set, and unwritable from a browser.
   */
  paid_through: string | null
}

/** The answer. Three fields, and none of them says how it was arrived at. */
export type Entitlement = {
  access: Access
  /** The tier in force — the trial's while it lasts, otherwise the paid one. */
  plan: PlanLimits
  /** How many active students are allowed, and what to do when they run out. */
  ceiling: StudentCeiling
}

/**
 * The trial's plan if one is genuinely in force, otherwise null.
 *
 * THE TRIAL MUST NOT BE A DOWNGRADE. `trial_plan` is written as *a temporary better
 * plan*, and the rank comparison is what keeps a stale row from being a demotion:
 * §4.3 has the founder clearing the trial fields when a customer pays, and a founder
 * who sets `plan = 'center'` and forgets would otherwise hand that centre Teacher
 * Pro — taking staff management, branches and centre-wide reporting off a customer
 * in the week they bought them. A trial that is worse than what is already paid for
 * is a data error, and the safe reading of a data error is that the customer keeps
 * what they paid for.
 *
 * BOTH CLOCKS ARE CHECKED FOR BEING CLOCKS. An unparseable `trial_ends_at` and an
 * invalid `now` both produce `NaN`, and every comparison against `NaN` is false — so
 * an expiry test written the obvious way answers "not expired" for a date that is
 * not a date, and a garbled column becomes a paid tier granted forever. The finite
 * checks are what make the comparison below mean what it reads as.
 */
function trialPlan(org: OrgBilling, paid: PlanLimits, now: Date): PlanLimits | null {
  // Both or neither, matching the `coaching_centers_trial_pair` check constraint: a
  // plan with no end date is a permanent free upgrade, and an end date with no plan
  // is a timer attached to nothing.
  if (!org.trial_plan || !org.trial_ends_at) return null

  const endsAt =
    org.trial_ends_at instanceof Date ? org.trial_ends_at : new Date(org.trial_ends_at)
  const ends = endsAt.getTime()
  const at = now.getTime()
  if (!Number.isFinite(ends) || !Number.isFinite(at)) return null

  // Strictly greater: the instant it names is when the trial stops granting, not the
  // last instant it grants.
  if (ends <= at) return null

  const trial = planFor(org.trial_plan)
  return PLAN_RANK[trial.id] > PLAN_RANK[paid.id] ? trial : null
}

/**
 * Whether this centre's paid coverage ran out more than the grace window ago.
 *
 * NULL COVERAGE IS NOT A LAPSE, and it is the line in this file most worth getting the
 * right way round. A centre with no `paid_through` has no payment row saying what
 * period it bought — which is the state of every customer who paid before the receipt
 * screen existed, including the first real one on this product. Reading null as "ran
 * out in 1970" would put a paying customer into read-only for the crime of being early.
 *
 * ONLY `active` LAPSES. `trial` has nothing to lapse and is full access by design;
 * `suspended` and `cancelled` are already read-only and cannot be made more so. A
 * status outside the enum never reaches here.
 *
 * A FREE PLAN NEVER LAPSES. Coverage is what money bought, and a tier that costs
 * nothing has nothing to cover — so a teacher who once paid for a month of Pro and has
 * since dropped to Free keeps Free forever. Read from the PAID plan and not the
 * resolved one: a trial in force does not change what the customer is buying.
 *
 * AND IT FAILS OPEN, DELIBERATELY, WHICH THE REST OF THIS FILE DOES NOT. A date that
 * will not parse gives `daysBetween` zero, and zero is never past the window, so a
 * garbled column grants access rather than removing it. That is the opposite of the
 * trial's fallback, for a reason the trial does not share: an unreadable
 * `trial_ends_at` falls back to what the customer already paid for, while an
 * unreadable `paid_through` would fall back to taking the product away from somebody
 * who may have paid us this morning. A bad string is not evidence of non-payment. The
 * founder can still suspend by hand, and that path is untouched.
 */
function coverageLapsed(org: OrgBilling, paid: PlanLimits, now: Date): boolean {
  if (org.status !== 'active') return false
  if (!org.paid_through) return false
  if (paid.pricing === 'free') return false

  // Calendar days in Dhaka on both sides, because `paid_through` is a `date` with no
  // time of day to compare an instant against. Coverage runs to the end of the day it
  // names, so that day is zero days overdue and the window counts from the next one:
  // strictly greater, so the seventh day of grace is still a day of grace.
  return daysBetween(org.paid_through, todayInDhaka(now)) > GRACE_DAYS
}

/**
 * The resolver. MASTERPLAN.md §4.2, in the order it is written there: access from
 * the status, plan from the trial or the subscription, ceiling from the plan and
 * what has been bought.
 *
 * FAIL CLOSED, IN THE ESTABLISHED DIRECTION. Every fallback here is the narrow one:
 * an unrecognised status may not write, an unrecognised plan is Teacher Free, an
 * unparseable trial date grants nothing. That is the same rule `planFor` already
 * follows and the opposite of what a `||` chain would do by accident.
 *
 * ONE THING IS NOT FAILED CLOSED HERE, and it is on purpose: a *count* that could
 * not be read is refused by its caller rather than treated as zero. This function
 * never sees a count. One failed count would not let one extra student past a
 * ceiling, it would let eighty — so `limitRefusal` answers "we cannot tell just now"
 * and adds nobody, and this file has no opinion to offer it.
 *
 * `now` IS A PARAMETER rather than a `new Date()` inside, so a test can stand either
 * side of an expiry without touching the clock, and so a screen resolving a list of
 * centres resolves all of them against one instant instead of one per row.
 *
 * TWO CLOCKS, AND THEY PULL OPPOSITE WAYS. A trial can only raise what is allowed and
 * a lapse can only lower it, so the order they are applied in cannot matter — which is
 * why the plan is resolved from the trial and the access from the coverage, with
 * neither consulting the other's answer. A centre whose trial is live and whose
 * coverage has lapsed reads the trial's tier in read-only, and that is the correct
 * reading of a row that has been told two things at once.
 */
export function effectiveEntitlement(org: OrgBilling | null, now: Date): Entitlement {
  // NO ORGANISATION IN VIEW, which is two situations and needs no third answer: an
  // account that has not made a centre yet, and a `center_members` read that did not
  // arrive. Both land on the floor — Teacher Free, and no writing — because a value
  // that must never be the loosest one should not be the loosest one by default.
  //
  // Neither can reach a centre write anyway: `requireCenter` refuses an absent
  // membership before any action gets this far, and it tells those two causes apart
  // itself because one of them is a door and the other is not. The floor is here so
  // that nothing downstream has to special-case a reader with no centre, and so that
  // a future caller which forgets that guard fails closed instead of wide.
  if (!org) {
    const plan = planFor(null)
    return { access: 'read_only', plan, ceiling: studentCeiling(plan, 0) }
  }

  const paid = planFor(org.plan)
  const plan = trialPlan(org, paid, now) ?? paid

  // A status outside the enum is a row that has gone wrong, not a new kind of customer,
  // so it reads as read-only.
  const standing = ACCESS_BY_STATUS[org.status as CenterStatus] ?? 'read_only'

  return {
    // The lapse can only take access away, never grant it — see `coverageLapsed`, which
    // refuses to look at anything but an `active` centre for exactly that reason.
    access: coverageLapsed(org, paid, now) ? 'read_only' : standing,
    plan,
    // The trial's plan, not the paid one, and that is the point of resolving the plan
    // first: a teacher trialling Pro gets Pro's 150 places for the fortnight, and
    // keeps every student they added when it ends. Limits apply to new actions,
    // never retroactively — §4.5.
    ceiling: studentCeiling(plan, org.student_capacity ?? 0),
  }
}
