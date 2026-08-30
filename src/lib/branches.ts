/**
 * Which branch a reader belongs to.
 *
 * HQ IS A NULL BRANCH, and that is the whole of the rule. `center_members.branch_id`
 * has been nullable since 20260811000001; 20260811000053 gave the null a meaning —
 * `app.branch_ok` reads it as "the whole organisation" and a uuid as "one location" —
 * and every restrictive policy in that migration turns on it. This module is the app's
 * side of the same sentence, so a screen never has to spell it out again.
 *
 * WHAT IT IS NOT is the boundary. §8.2 is blunt about it — "Not in a query filter. A
 * branch-scoped `.eq('branch_id', …)` in application code is one forgotten call site
 * away from a cross-branch leak" — so nothing here filters a read. Reads are scoped by
 * the policies, which is why a pinned manager's `select` on `branches` returns exactly
 * one row without this file being consulted.
 *
 * What it decides is what to draw and what to refuse. The branches screen is the first
 * caller, and its question is the organisation's shape: who may add a building, rename
 * one, or close one. §3.7 answers it — "a branch manager is not the billing owner and
 * must not be able to increase the organisation's monthly cost on their own signature"
 * — and the policies agree, because a pinned manager's insert on `branches` fails the
 * restrictive check for a row whose id is not their branch. That refusal arrives as a
 * Postgres error a screen can only render as "could not save", which is the other half
 * of why this is asked here as well.
 */

/**
 * The head office reads and writes the whole organisation; everybody else is confined
 * to one branch.
 *
 * A function rather than `session.active.branchId === null` at each call site, because
 * the null is the load-bearing part and a bare comparison does not say so. Takes the
 * membership shape rather than a whole session so a test can ask the question with one
 * field, and so a caller holding a row from `center_members` can ask it too.
 */
export function isHqMember(member: { branchId: string | null }): boolean {
  return member.branchId === null
}
