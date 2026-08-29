/**
 * What an organisation is actually allowed to do, right now — derived, in one place.
 *
 * MASTERPLAN.md §4 names six concepts that a single `plan` column used to do the job
 * of, and this file is the one that combines three of them into an answer:
 *
 *   plan          which features and caps does a tier have?   -> plans.ts, in code
 *   subscription  which tier is this customer on, and how is that standing?
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
 * NOT THE BOUNDARY. RLS in Postgres decides whose rows these are, and
 * `app.guard_center_billing` and `app.guard_student_capacity` are what a browser
 * cannot talk its way past. This is one layer in: narrower than the boundary, never
 * wider. If the two ever disagree in this direction, a screen draws and its queries
 * come back empty.
 */

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
 */
const ACCESS_BY_STATUS: Record<CenterStatus, Access> = {
  trial: 'full',
  active: 'full',
  suspended: 'read_only',
  cancelled: 'read_only',
}

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
 * WHAT IS NOT HERE YET. §4.4 has `suspended` computed from payment coverage plus a
 * grace window rather than set by hand; that needs a ledger with the period each
 * payment covers, which does not exist. Until it does, this reads the status it is
 * given and the founder sets it — so the fence is here and correct, and what is
 * missing is the thing that should be leaning on it.
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

  return {
    // A status outside the enum is a row that has gone wrong, not a new kind of
    // customer, so it reads as read-only.
    access: ACCESS_BY_STATUS[org.status as CenterStatus] ?? 'read_only',
    plan,
    // The trial's plan, not the paid one, and that is the point of resolving the plan
    // first: a teacher trialling Pro gets Pro's 150 places for the fortnight, and
    // keeps every student they added when it ends. Limits apply to new actions,
    // never retroactively — §4.5.
    ceiling: studentCeiling(plan, org.student_capacity ?? 0),
  }
}
