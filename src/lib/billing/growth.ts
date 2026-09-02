/**
 * Which branch is filling up, for the owner deciding whether to buy more places.
 *
 * MASTERPLAN §3.7's urgent row: "persistent banner, HQ told which branches are growing".
 * The other half of §3.7 is `asks.ts` next door — a branch manager pressing the button and
 * the head office reading that they pressed it. This is the fact the owner needs before
 * they answer: not that the organisation is nearly full, which they can already see, but
 * where the places went.
 *
 * NOT A QUOTA AND NOT A BUDGET. §17 keeps the pool at the organisation, and nothing here
 * refuses anything or divides anything up. Two branches growing at the same rate is a fine
 * answer and gets both names.
 *
 * THE WINDOW IS THE CALLER'S. "Growing" is a rate and this file cannot know over what, so
 * the two month bounds arrive as arguments — which also keeps every value import out of
 * this file, so `node --test` can load it. Same rule as finance/branch-money.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/types'

/** One branch's recent intake. `branchId` null is head office, as everywhere else. */
export type BranchIntake = { branchId: string | null; admitted: number }

/** A named branch that grew, ready to print. */
export type GrowingBranch = { branchId: string | null; name: string; admitted: number }

/**
 * The branches that took places recently, biggest first.
 *
 * A BRANCH THAT TOOK NONE IS NOT ON THE LIST. "Sylhet is growing (0 new students)" is a
 * sentence that makes a reader distrust the whole box, and an owner scanning for somewhere
 * to send the next block of places does not need the buildings that did not move.
 *
 * TIES BREAK ON NAME, so two readings of the same figures name the branches in the same
 * order. Unordered, an owner refreshing the screen would see the list reshuffle and read
 * that as something having changed.
 *
 * `limit` keeps the sentence to a sentence. An institution with eleven branches all
 * growing is a good problem, and naming eleven in a warning box is how a warning stops
 * being read; the count of the rest comes back too, so the screen can say "and three
 * others" rather than silently dropping them.
 */
export function growingBranches(
  intake: BranchIntake[],
  name: (branchId: string | null) => string,
  limit = 3,
): { top: GrowingBranch[]; others: number } {
  const grew = intake
    .filter((row) => row.admitted > 0)
    .map((row) => ({ branchId: row.branchId, name: name(row.branchId), admitted: row.admitted }))
    .sort((a, b) => b.admitted - a.admitted || a.name.localeCompare(b.name))

  return { top: grew.slice(0, limit), others: Math.max(0, grew.length - limit) }
}

/**
 * Intake per branch between two months, both ends included.
 *
 * ADDED UP ACROSS THE WINDOW, not one row per month. The question is which building is
 * filling up, and a month-by-month table does not belong in a warning box. The screen asks
 * for three months, because one is noise in a centre that admits in cohorts and a year is
 * not "growing".
 *
 * NULL WHEN THE READ FAILS, like `openAsks` and for the same reason: the warning this
 * decorates is the point of the screen, and an empty list would tell an owner that nothing
 * is growing while the register fills up.
 */
export async function recentIntake(
  supabase: SupabaseClient<Database>,
  centerId: string,
  since: string,
  until: string,
): Promise<BranchIntake[] | null> {
  const { data, error } = await supabase
    .from('branch_admissions_month')
    .select('branch_id, admitted')
    .eq('coaching_center_id', centerId)
    .gte('period_month', since)
    .lte('period_month', until)

  if (error || !data) return null

  const byBranch = new Map<string | null, number>()
  for (const row of data) {
    byBranch.set(row.branch_id, (byBranch.get(row.branch_id) ?? 0) + (row.admitted ?? 0))
  }

  return [...byBranch].map(([branchId, admitted]) => ({ branchId, admitted }))
}
