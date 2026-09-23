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
 * Under the prepaid balance (§11.6) what is compared is *money*: `owed` is a day count
 * times the day's rate, and a centre whose balance cannot cover it is read-only until
 * it tops up. That is the one part of the money conversation that has to be automatic,
 * because it is the part a founder cannot be trusted to do consistently to a customer
 * they like — so `owed` grows by itself, with no job to run and none to forget to run
 * backwards, and a recharge un-lapses the centre the moment it is recorded because
 * there is no state to unset.
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
 * centre runs its real term on the product — and under §4.4 a sales trial is granted
 * *days*, so it ends when the balance cannot carry the next one rather than on a
 * status change. It is not the Teacher Pro trial below: that one is a plan for a
 * fortnight, this one is a standing with no plan of its own, and merging the two
 * clocks would put a fourteen-day timer on a customer the founder is still selling to.
 *
 * THIS IS THE FLOOR AND NOT THE WHOLE ANSWER. `active` earns full access from the
 * status column and can still lose it to a dry balance — see `billingStanding`.
 * Nothing goes the other way: no balance can talk a `suspended` row into writing.
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
  /**
   * `coaching_centers.balance_poisha` — the money available to settle days that are
   * not yet paid for. MASTERPLAN.md §11.7's first lever.
   *
   * A cache of `sum(billing_ledger.amount_poisha)`, maintained by the trigger in
   * 20260811000078 and unwritable from a browser: the ledger is the truth and this is
   * the one column a session guard can read without a scan. A test asserts the two
   * agree (§11.13's first reconciliation question).
   */
  balance_poisha: number | null
  /**
   * `coaching_centers.charged_through` — the last Dhaka date that *is* paid for, as
   * YYYY-MM-DD, or null when the centre has no line at all. §11.7's second lever.
   *
   * A `date` and therefore a string, unlike `trial_ends_at`: it names a calendar day
   * with no time of day, and letting a `Date` in would invite a UTC midnight to be
   * compared against a Dhaka morning. Advanced by the ledger's own trigger when a
   * daily charge lands, and by a founder granting days — never hand-set by a customer,
   * and it only ever moves forward, because backwards is charging a day twice.
   */
  charged_through: string | null
  /**
   * What one day costs this centre at today's size, in poisha, or null when nobody
   * has read it.
   *
   * NOT A COLUMN AND NOT DERIVED HERE, which is the one thing about this field worth
   * being careful with. It is `public.settle_billing`'s `dailyPoisha` (§11.7), handed
   * back by the settlement that has just run — so the resolver compares the balance
   * against the same rate the burn charged at, in the same transaction, rather than
   * recomputing a figure from head counts it does not have and cannot read.
   *
   * NULL MEANS "NOT READ", NEVER "ZERO". Zero is a rate that has been read and is
   * nothing, which is the free tier; null is a number that either was not needed
   * (the centre is paid up, so `owed` is zero without it) or could not be read (the
   * counts failed, and §4.4's answer where the rate *is* needed is read-only).
   */
  daily_rate_poisha: number | null
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
 * Where the prepaid balance stands, right now — the figures, and the answer they give.
 *
 * OWED IS ARITHMETIC OVER TWO COLUMNS AND NOT A ROW ANYWHERE. `greatest(0, today −
 * charged_through) × rate` — so a centre that never opens the app still lapses on
 * exactly the right day, and a recharge un-lapses it the moment the money is recorded,
 * because nothing was ever written to say otherwise.
 *
 * ONE ARITHMETIC AND THREE READERS. The resolver below uses `lapsed`; the app shell's
 * rail uses `daysLeft` and the pillars it is built from; the banner uses the whole
 * thing to say what happened and what to do about it. A second copy of this division
 * is how a screen and a refusal come to disagree about whether a centre may write.
 *
 * NULL IS NOT ZERO, in either column, and the two directions fail differently on
 * purpose. A `charged_through` that is absent or unreadable is *not* an accusation of
 * non-payment — `daysBetween` answers 0 for a date it cannot parse, and 0 days behind
 * is paid up, so a garbled line grants access rather than removing it. A missing
 * *rate* while the centre is behind is the other way round: the answer is read-only,
 * as §4.4 says everywhere the rate is needed and cannot be read. A bad date is
 * evidence of nothing; a count we could not take is evidence we cannot price the day.
 */
export type BillingStanding = {
  /**
   * The Dhaka day this was resolved against, as YYYY-MM-DD, or null when the instant it
   * was given is not one — see the guard in `billingStanding`.
   */
  today: string | null
  /** The last day paid for, as YYYY-MM-DD, or null when the row has no line. */
  chargedThrough: string | null
  /** Whole Dhaka days owed right now. Zero for a centre that is paid up. */
  daysOwed: number
  /** What one day costs at today's size, in poisha, or null when it was not read. */
  dailyRatePoisha: number | null
  /** Money available, in poisha, or null when the column could not be read. */
  balancePoisha: number | null
  /**
   * Whole days the balance still covers *after* the line, or null when there is no
   * rate to divide by — which is a free tier (nothing to spend, no day to run out of)
   * or a rate nobody read (and then the rail has nothing to draw, rather than a zero).
   */
  daysLeft: number | null
  /** Whether the balance alone takes the writing away. The status floor is separate. */
  lapsed: boolean
}

/**
 * A `date` column, normalised to the `YYYY-MM-DD` every comparison in here assumes.
 *
 * A `Date` only ever arrives from a test: PostgREST hands a `date` back as a string,
 * and the generated row types say so. It is accepted rather than banned because a
 * fixture written with `new Date(...)` should not need to know which half of the wire
 * it is standing in for, and because `toISOString` throws on an invalid `Date` where
 * every other path in this file answers with a number.
 */
function dayOf(value: string | Date | null): string | null {
  if (value === null) return null
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null
  }
  return value.slice(0, 10)
}

/**
 * The standing, resolved. §11.7's comparison and §11.6's arithmetic, once.
 *
 * A FREE PLAN OWES NOTHING, and not as a special case: a tier with no price has a rate
 * that is zero by construction, so `owed` is zero however far behind the line has
 * fallen — a teacher who once bought a month of Pro and has since dropped to Free keeps
 * Free forever. Read off the *stored* plan and never the trialled one, the same rule the
 * old coverage derivation used: a trial in force does not change what is being bought,
 * and the days it grants are granted by moving the line, not by changing the rate here.
 */
export function billingStanding(org: OrgBilling | null, now: Date): BillingStanding {
  /*
   * A CLOCK THAT IS NOT A CLOCK IS NOT A DEBT.
   *
   * `todayInDhaka` formats, so it throws on an invalid `Date` rather than answering
   * `NaN` the way the arithmetic in here does — and this file's promise is that an
   * unreadable clock says nothing rather than throwing, because the alternative is a
   * crash on every screen rather than a wrong number on one. The reading taken is the
   * trial's, in the other direction: a clock nobody can read is not evidence of a debt,
   * so nothing is owed and the status floor stands on its own.
   *
   * Sessions pass `new Date()`, so a bad instant here is a caller's bug — and a bug must
   * not freeze a customer's register. A hidden test asserts it, and it broke the first
   * time this function formatted the clock unconditionally.
   */
  const today = Number.isFinite(now.getTime()) ? todayInDhaka(now) : null

  // NO ORGANISATION IN VIEW: all three figures are absent and nothing is owed, which is
  // the same total answer the resolver's own floor gives — a reader with no centre is
  // read-only because there is nothing to write to, not because of money. A banner or a
  // rail drawn from this draws nothing, which is what it should do on a screen that
  // belongs to no centre yet.
  if (!org) {
    return {
      today,
      chargedThrough: null,
      daysOwed: 0,
      dailyRatePoisha: null,
      balancePoisha: null,
      daysLeft: null,
      lapsed: false,
    }
  }

  const chargedThrough = dayOf(org.charged_through)
  const dailyRatePoisha = org.daily_rate_poisha
  const balancePoisha = org.balance_poisha

  // Zero behind is the ordinary state of a paying centre, and negative is a line that
  // has run past today — granted days, or a payment recorded forward — which owes
  // nothing either. Only a positive gap is a debt.
  const behind = today && chargedThrough ? daysBetween(chargedThrough, today) : 0

  const free = planFor(org.plan).pricing === 'free'

  // A FREE TIER OWES NOTHING IN DAYS EITHER, not just in money. Its line never moves and
  // there is no rate that could ever pay these days down, so a count of them would be a
  // figure with no arithmetic behind it — the kind a rail prints because it was there.
  // Zero is the true answer to "how many days does this centre owe".
  const daysOwed = free || behind <= 0 ? 0 : behind

  // Floored, and floored in the customer's favour: ৳86.66 of rate against ৳86.66 of
  // balance is one day, and 3.4 days' worth is three, because the fourth day cannot be
  // bought whole and §11.7's rule is that a partial day buys nothing.
  const daysLeft =
    free || dailyRatePoisha === null || dailyRatePoisha <= 0 || balancePoisha === null
      ? null
      : Math.floor(balancePoisha / dailyRatePoisha)

  // `daysOwed` IS ZERO FOR A FREE TIER, which is why the rate is not consulted to get
  // here: a plan with no price has nothing to be short of. Behind, with a rate that
  // could not be read or a balance nobody could read, is read-only — the same
  // narrow direction every other fallback in this file takes.
  const lapsed =
    daysOwed > 0 &&
    (dailyRatePoisha === null ||
      balancePoisha === null ||
      balancePoisha < daysOwed * dailyRatePoisha)

  return {
    today,
    chargedThrough,
    daysOwed,
    dailyRatePoisha,
    balancePoisha,
    daysLeft,
    lapsed,
  }
}

/**
 * Whether this centre's days cost money at all — the one condition under which the burn
 * is worth asking for (MASTERPLAN.md §11.6, §11.7).
 *
 * THE FREE TIER IS THE ONLY THING THAT SAYS NO, and it says it because its rate is zero:
 * a free centre's line never moves, nothing it does can move it, and a settlement would
 * be a round trip that returns `nothing_due` for the rest of that centre's life. Every
 * other centre burns something, so every other centre is worth asking.
 *
 * IT DELIBERATELY DOES *NOT* PREDICT WHETHER ANYTHING IS OWED, and the first draft did:
 * "behind today, and holding money" — which was the right filter when a repeated refusal
 * threw a unique violation and every extra call was a crash. 20260811000082 took that
 * away at the database (`settlement_runs_one_note_per_day` and `on conflict do nothing`),
 * so what is left is the cost of a call that charges nothing: a price card read, the same
 * two head counts the capacity trigger reads, and a balance sum. In exchange, every
 * request knows the day's rate and the current balance, which is what the rail above the
 * content and the read-only banner are drawn from — and neither of them could draw a
 * figure on a day when no settlement happened.
 *
 * PREDICTING IT HERE WOULD ALSO BE A SECOND OPINION ABOUT THE MONEY. Whether the balance
 * covers a day is answered by the burn itself, under the ledger's own advisory lock; a
 * test in JavaScript that guessed at it first would be one more rule to keep in step, and
 * the day it drifted would be the day it let a centre write on an empty purse.
 */
export function dailyBurn(org: OrgBilling): boolean {
  return planFor(org.plan).pricing !== 'free'
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
 * a dry balance can only lower it, so the order they are applied in cannot matter —
 * which is why the plan is resolved from the trial and the access from the balance,
 * with neither consulting the other's answer. A centre whose trial is live and whose
 * balance cannot cover the day reads the trial's tier in read-only, and that is the
 * correct reading of a row that has been told two things at once.
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

  // Resolved even when the status already forbids writing, because the caller may be
  // the rail rather than this function: one call answers "may they write" and "how long
  // has the money got" off the same read. The verdict below is the only place the two
  // are combined.
  const billing = billingStanding(org, now)

  return {
    // THE BALANCE CAN ONLY TAKE ACCESS AWAY, NEVER GRANT IT, which is the same
    // one-directional rule the coverage date carried and is why the comparison is
    // guarded by the floor rather than OR-ed with it: a row has to be both in good
    // standing *and* paid up to write. A suspended centre with a healthy balance is
    // still suspended — a human threw that switch for a reason that is not money —
    // and an unrecognised status cannot borrow access from a full purse either.
    access: standing === 'full' && billing.lapsed ? 'read_only' : standing,
    plan,
    // The trial's plan, not the paid one, and that is the point of resolving the plan
    // first: a teacher trialling Pro gets Pro's 150 places for the fortnight, and
    // keeps every student they added when it ends. Limits apply to new actions,
    // never retroactively — §4.5.
    ceiling: studentCeiling(plan, org.student_capacity ?? 0),
  }
}

/**
 * How long after a trial ends the app keeps saying so, in days.
 *
 * A LOOK-BACK AND NOT A LEAD-IN: the running notice shows for the whole fortnight,
 * because §2.2's trial sells nothing to somebody who never knew they had it. What this
 * bounds is the other end — the week in which "printed receipts stopped because your
 * trial ended on the 16th" is still the explanation for what somebody just hit. A
 * month later it is history, and a banner that never leaves is furniture.
 */
export const TRIAL_NOTICE_DAYS = 7

/**
 * Where a Teacher Pro trial stands, for the one screen that says so out loud.
 *
 * THE DIFFERENT QUESTION THIS FILE'S HEADER PROMISES. `Entitlement` deliberately
 * cannot say a plan came from a trial, because forty gates branching on `isTrial` is a
 * second plan model. This asks the row instead — when does the trial end, and did it —
 * and hands back no opinion about what is *allowed*. Anything reaching for this to
 * decide a permission wants `effectiveEntitlement`.
 *
 * THE RUNNING CASE IS `trialPlan`'S OWN ANSWER and not a second expiry test. A banner
 * that claimed a fortnight of Pro while the gates refused it would be worse than no
 * banner: the customer rings about a bug, and the bug is that two clocks were written
 * twice. So this delegates, and the two cannot drift.
 *
 * A STALE DOWNGRADE ROW IS SILENT IN BOTH STATES. Same rank rule as `trialPlan`: a
 * `trial_plan` no better than what the centre already pays for is a data error, and
 * telling a paying Coaching Center customer that their Teacher Pro trial ended is a
 * support call about nothing.
 *
 * DATES ARE DHAKA CALENDAR DAYS, converted from the instant, because "ends on the
 * 16th" is what a customer can hold against their own calendar. The instant decides
 * *whether* it is running; the day is only ever printed.
 */
export type TrialStanding =
  | { state: 'running'; plan: PlanLimits; endsOn: string; daysLeft: number }
  | { state: 'ended'; plan: PlanLimits; endedOn: string; daysSince: number }

export function trialStanding(
  org: OrgBilling | null,
  // Defaulted, unlike `effectiveEntitlement`'s: the caller is a server component, and
  // the React compiler refuses a clock read in a render body (`react-hooks/purity`).
  // Reading it in here is the same move `todayInDhaka()` already makes. Tests pass one.
  now: Date = new Date(),
): TrialStanding | null {
  if (!org?.trial_plan || !org.trial_ends_at) return null

  const endsAt =
    org.trial_ends_at instanceof Date ? org.trial_ends_at : new Date(org.trial_ends_at)
  // Guarded before `todayInDhaka`, which throws on an invalid Date rather than
  // returning NaN like the arithmetic elsewhere in this file does.
  if (!Number.isFinite(endsAt.getTime()) || !Number.isFinite(now.getTime())) return null

  const paid = planFor(org.plan)
  const trial = planFor(org.trial_plan)
  if (PLAN_RANK[trial.id] <= PLAN_RANK[paid.id]) return null

  const today = todayInDhaka(now)
  const day = todayInDhaka(endsAt)

  const running = trialPlan(org, paid, now)
  return running
    ? { state: 'running', plan: running, endsOn: day, daysLeft: daysBetween(today, day) }
    : { state: 'ended', plan: trial, endedOn: day, daysSince: daysBetween(day, today) }
}
