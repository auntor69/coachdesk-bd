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
 * This file is the other end of that refusal: the code the trigger raises, named once
 * so no `if` on a student insert has a bare SQLSTATE in it.
 *
 * No imports, deliberately. `isCapacityRefusal` is wanted wherever a student insert
 * is handled, including in a client component's error branch, and a file that pulls
 * in the dictionary or the plan table would ship all of it to a phone on 3G.
 */

/**
 * The SQLSTATE `app.guard_student_capacity()` raises when the ceiling is reached.
 *
 * Ours, not Postgres's, and that is the point. The standard codes all say something
 * else: `23514` claims a CHECK constraint fired, `P0001` is what every uncaught
 * `raise` in the schema returns and so identifies nothing, and `42501` — the code the
 * billing-column guard uses — means "you may not do this", which is wrong here. A
 * manager IS allowed to add a student. They have run out of places, which is a
 * different sentence and a different screen.
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
