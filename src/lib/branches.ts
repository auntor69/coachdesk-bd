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
 *
 * AND WHAT TO ASK, which is the half added for the add forms. 20260811000054 files a new
 * row under the branch of whoever wrote it, so a pinned manager is never asked — there is
 * one answer and the database already knows it. The head office is the reader with a real
 * question, because head office is the one desk that is not in any building.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { has, type PlanLimits } from './plans.ts'
import type { Database } from './supabase/types.ts'

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

/**
 * Whether an add form should ask which building the new row belongs to.
 *
 * BOTH HALVES ARE NECESSARY AND NEITHER IS THE BOUNDARY. The plan half is obvious —
 * a centre that is one building has nothing to ask, and `multipleBranches` is the
 * feature that says so. The membership half is the interesting one: a pinned manager
 * must not be asked, because 20260811000054 already fills the column from their own
 * membership and the only answer they are permitted to give is the one it fills. A
 * select with one option in it is a form asking a question it knows the answer to,
 * and a select with two would be a control whose second option the policies refuse.
 *
 * Drawn or not, the database decides. A browser that posts a branch it may not name
 * is refused by `<table>_branch_scope` and by the composite foreign key onto
 * (branch_id, coaching_center_id) — see the note on `branchChoicesFor`.
 */
export function mayChooseBranch(session: {
  plan: PlanLimits
  active: { branchId: string | null }
}): boolean {
  return has(session.plan, 'multipleBranches') && isHqMember(session.active)
}

/** One building, as an add form's select needs it. */
export type BranchChoice = { id: string; name: string }

/**
 * The buildings this reader may file a new row under, or `null` for "do not ask".
 *
 * ONE CALL PER ADD FORM, so the two-part decision above is not spelled out on six
 * pages. `null` covers every reason there is nothing to ask, deliberately including
 * the read that failed:
 *
 *   * the plan is not an institution, or the reader is pinned (`mayChooseBranch`);
 *   * the organisation has no open branch — an institution that has bought the tier
 *     and not yet typed a building is every institution on its first day;
 *   * the query did not come back.
 *
 * The last one is a judgement and the branches screen made the opposite one, so it is
 * worth saying why they differ. There, a dropped read draws an empty list over an add
 * form, and the owner's next move is to type in a building that already exists — a
 * duplicate that cannot be deleted, with rows filed under both. Here, a missing select
 * files the row at head office, which is where every row in every centre in the country
 * is filed today and what this form did last week. It is a value left blank, not a
 * wrong one, and the one reader who can see it is the one who can put it right.
 *
 * CLOSED BUILDINGS ARE NOT OFFERED, matching what closing one means: "nothing new is
 * filed under it". Nothing stops a stale form posting a branch that was closed while
 * it sat open, and nothing needs to — a row filed under a building that shut this
 * morning is a true statement about where it happened.
 *
 * NOT A BOUNDARY, per §8.2, and the caller must not treat it as one. What bounds a
 * posted branch is the database: the composite foreign key refuses another centre's,
 * the restrictive policy from 20260811000053 refuses one this reader cannot reach, and
 * a pinned member cannot name a branch at all. So an action's job is to pass the value
 * through, not to check it against this list — a second copy of the rule in
 * application code is the copy that goes stale.
 *
 * Takes the client as an argument rather than importing one, like `readAudienceRows`:
 * this module is imported by `node --test`, which has no `next/headers` to give it.
 */
export async function branchChoicesFor(
  supabase: SupabaseClient<Database>,
  session: {
    plan: PlanLimits
    active: { centerId: string; branchId: string | null }
  },
): Promise<BranchChoice[] | null> {
  if (!mayChooseBranch(session)) return null

  const { data } = await supabase
    .from('branches')
    .select('id, name')
    .eq('coaching_center_id', session.active.centerId)
    .eq('active', true)
    .order('name', { ascending: true })

  if (!data || data.length === 0) return null
  return data
}

/**
 * The branch an add form posted, or null for the head office.
 *
 * The empty string is what the select's first option carries, and it means the same
 * thing a missing field does: file this under no branch. Both arrive as `null`, which
 * is the value the column already holds and the value 20260811000054's stamp fills.
 *
 * A malformed value is passed on rather than swallowed, and that is the point of
 * returning the string unexamined. Postgres refuses it — a uuid column is a uuid
 * column — and the action's own "could not save" is the honest answer. Turning it into
 * `null` here would file the row at head office instead, which is quiet and wrong where
 * the alternative is loud and missing.
 */
export function postedBranchId(formData: FormData): string | null {
  const value = formData.get('branchId')
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Which of these rows are filed under a different building, by name.
 *
 * 20260811000053 asks for this in so many words: a student enrolled in another branch's
 * batch makes `app.student_branch` and `app.batch_branch` disagree, "which is a thing the
 * picker should refuse rather than a thing a policy should adjudicate". A policy cannot —
 * both rows are legal on their own, and the pair is what is wrong. So the refusal is here,
 * and both sides of it (a student joining a batch, a batch moving away from its students)
 * ask the same question of the same function.
 *
 * Head office is a value and not a wildcard: null matches null and nothing else. A child
 * filed at head office in a Mirpur batch is the same broken pair the other way round —
 * Mirpur's manager would mark a register they cannot see the enrolment behind.
 */
export function elsewhere(
  branchId: string | null,
  rows: { name: string; branchId: string | null }[],
): string[] {
  return rows.filter((row) => row.branchId !== branchId).map((row) => row.name)
}
