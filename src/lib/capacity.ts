/**
 * The line between a centre that has room for another student and one that has not.
 *
 * WHY THE DATABASE ANSWERS THIS AND NOT A SERVER ACTION. Every other numeric limit
 * in this product is checked by `limitRefusal`, which reads a count, compares it to
 * the plan, and hands back a sentence. That is the right thing to *show* somebody and
 * it is not enforcement: two managers at one desk both read 119 of 120 places used,
 * both pass the check, and both insert. Nothing afterwards notices, and the bill is
 * computed from the count. So 20260811000036 puts a trigger on `students` that takes
 * a transaction-scoped advisory lock, counts, and refuses — which holds for the form,
 * for the bulk import, and for a write path nobody has written yet.
 *
 * This file is the other end of that refusal: the codes the triggers raise, named once
 * so no `if` on an insert has a bare SQLSTATE in it. 20260811000075 did the same for the
 * other four ceilings — batches, subjects, teachers, students in one batch — which is
 * why there are two codes here and not one.
 *
 * No imports, deliberately. `isCapacityRefusal` is wanted wherever a student insert
 * is handled, including in a client component's error branch, and a file that pulls
 * in the dictionary or the plan table would ship all of it to a phone on 3G.
 */

/**
 * The SQLSTATE `app.guard_student_capacity()` raises when a plan's allowance is full.
 *
 * The teacher tiers are the only place it can still fire: since §16.1 step 28 the
 * per-student tiers have no student ceiling at all (§3.3), and the bought places this
 * used to count against are archived rather than read.
 *
 * Ours, not Postgres's, and that is the point. The standard codes all say something
 * else: `23514` claims a CHECK constraint fired, `P0001` is what every uncaught
 * `raise` in the schema returns and so identifies nothing, and `42501` — the code the
 * billing-column guard uses — means "you may not do this", which is wrong here. A
 * manager IS allowed to add a student. Their plan has run out of the students it
 * includes, which is a different sentence and a different screen.
 *
 * `CD` is not a class Postgres allocates, so nothing else can collide with it. The
 * migration names the same five characters in a comment next to the `raise`, and a
 * grep for the string finds both halves.
 */
export const CAPACITY_EXCEEDED = 'CD001'

/**
 * Whether a failed write failed because the centre is full.
 *
 * `unknown` rather than PostgrestError because the callers are catch blocks and
 * Supabase error objects, and neither hands over a type worth trusting. The shape
 * check is deliberately narrow — a `code` that is a string — because anything else
 * here would be guessing about a value that has already gone wrong once.
 *
 * FALSE ON ANYTHING UNRECOGNISED, and that is the safe direction for this particular
 * question: a true would tell somebody to go and buy student places to fix an error
 * that had nothing to do with capacity, and they would buy them, and it would still
 * be broken. An unknown error must stay an unknown error.
 */
export function isCapacityRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return code === CAPACITY_EXCEEDED
}

/**
 * The SQLSTATE the four ceilings in 20260811000075 raise: batches, subjects, teacher
 * records, and students in one batch.
 *
 * `CD003` and not `CD002`, which src/lib/settings/clash.ts already owns for a teacher
 * booked into two rooms at once. Sharing it would have a screen telling an owner their
 * plan was full when their physics teacher was double-booked.
 *
 * A second code rather than a second use of `CD001`, because the two mean opposite
 * things to the person reading them. `CD001` means buy more places, and the screen that
 * handles it opens the purchase. No amount of money buys a hundred-and-first batch on
 * any tier we sell — the answer is to retire one that finished, or on a teacher plan to
 * move up — so a handler that treats this as `CD001` would offer to sell something that
 * does not exist.
 *
 * Which ceiling it was rides in the error's `detail` as `limit=batches|subjects|
 * teachers|seats`. The Server Actions already name the batch or the building in the
 * owner's own words and keep doing so; this is the floor under them, for the import,
 * for a race between two managers, and for a request that never went near a form.
 */
export const PLAN_CEILING_EXCEEDED = 'CD003'

/** Whether a failed write failed because a plan ceiling is full. See `isCapacityRefusal`. */
export function isPlanCeilingRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return code === PLAN_CEILING_EXCEEDED
}

/**
 * The SQLSTATE `app.guard_branch_ceiling()` raises when a building may not be opened.
 *
 * `CD004` and not `CD003`, and the difference is the sentence the reader gets. A ceiling
 * that is used up is answered by moving up a tier or retiring a row that has finished; a
 * plan that HAS room and a balance that does not is answered by sending money. Two
 * different errands, and a handler that confused them would offer a plan change to
 * somebody whose building is ৳750 a month. `scripts/check-sql.mjs` also holds one rule
 * per code, so a second dimension borrowing this code would fail the build rather than
 * quietly acquiring the wrong refusal.
 *
 * It covers the two halves of one rule and nothing else: this tier does not sell buildings
 * at all, or the organisation is past the three its tier includes and holds no balance to
 * pay for the next one. Both are `limit=branches` in `detail`.
 */
export const BRANCH_UNFUNDED = 'CD004'

/** Whether a failed write failed because a building may not be opened. See `isCapacityRefusal`. */
export function isBranchRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return code === BRANCH_UNFUNDED
}

/**
 * The SQLSTATE `app.guard_teacher_seat_funding()` raises when a seat may not be taken.
 *
 * THE OTHER ADD-ON, and the last dimension a trial could still grow for nothing. The daily rate
 * prices exactly two things past what a tier includes — a teacher seat at ৳100 and a building at
 * ৳750 — and both are bought the same way: out of the balance, before the line starts. `CD005`
 * is the seat half of `CD004`, kept a separate code for a reason that is structural rather than
 * editorial: `scripts/check-sql.mjs` traces a code to the migration that first declared the
 * function raising it, and the branch raise lives in 20260811000096 while the seat raise lives
 * in 20260811000097 — one owner per code, so a handler can never be written against the wrong
 * one of them by accident. Which dimension it was rides in `detail` as `limit=teachers`, the
 * same way `CD003` carries its four.
 *
 * LIKE CD004 AND UNLIKE CD001, the remedy is money rather than a bigger plan: the seat is not
 * something a tier refuses, it is something a balance carries — so the sentence a screen writes
 * for this is "add money", and `isPlanCeilingRefusal` would send the reader shopping for a plan
 * that does not exist.
 */
export const TEACHER_SEAT_UNFUNDED = 'CD005'

/** Whether a failed write failed because a teacher seat may not be taken. See `isCapacityRefusal`. */
export function isSeatRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return code === TEACHER_SEAT_UNFUNDED
}

/**
 * The SQLSTATE `app.guard_trial_roster()` raises when a trial's roster is full.
 *
 * THE ONE DIMENSION MONEY CANNOT BE THE ONLY ANSWER FOR, which is why it is a code of its
 * own rather than a third use of `CD005`. A seat and a building are add-ons: the tier
 * includes some, the rest are a monthly line, and there is nothing else to say. The roster
 * is the product — a per-student tier's price *is* the student (§3.2, §3.3) — so fencing it
 * by money would refuse the first admission to an account holding nothing, and a signup
 * would buy three days of a product that cannot hold a roster. What bounds it instead is a
 * number: how much of our database we carry for an account that has never paid us, and the
 * fact that ANY MONEY LIFTS THE BOUND ENTIRELY is the second half of the sentence a screen
 * writes from this code (20260811000098).
 *
 * `CD006` and not `CD001`, `CD003` or `CD005`, and each of those is a different errand: `CD001`
 * is "buy more student places", a purchase this product no longer sells (§16.1 step 28);
 * `CD003` is a plan ceiling, answered by retiring a row or moving tier; `CD005` is a price off
 * the balance. This one is neither a plan nor a purchase — it is a bound on a trial, and the
 * way past it is money on the balance like every other paid dimension. `scripts/check-sql.mjs`
 * also holds one rule per code, traced to the migration that declared the function raising it.
 *
 * Which dimension it was rides in `detail` as `limit=students`.
 */
export const TRIAL_ROSTER_FULL = 'CD006'

/** Whether a failed write failed because a trial's roster is full. See `isCapacityRefusal`. */
export function isTrialRosterRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return code === TRIAL_ROSTER_FULL
}

/** Which ceiling refused, when one did. Null when the error is not `CD003` or says nothing. */
export function refusedCeiling(
  error: unknown,
): 'batches' | 'subjects' | 'teachers' | 'seats' | null {
  if (!isPlanCeilingRefusal(error)) return null
  // `details` is what the supabase-js client calls it and `detail` is what node-postgres
  // does; the RLS suite reads the second, every Server Action the first.
  const detail = (error as { details?: unknown; detail?: unknown }).details
    ?? (error as { detail?: unknown }).detail
  if (typeof detail !== 'string' || !detail.startsWith('limit=')) return null
  const named = detail.slice('limit='.length)
  return named === 'batches' || named === 'subjects' || named === 'teachers' || named === 'seats'
    ? named
    : null
}

