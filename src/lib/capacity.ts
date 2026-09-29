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

