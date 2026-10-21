import 'server-only'

/**
 * Who has asked for room — the rows a branch manager filed before the seats they asked
 * for were retired, still on the record and still waiting.
 *
 * MASTERPLAN §3.7 named this screen for the asks, and §16.1 step 28 removed the writing
 * side (`requestPlaces` went with the priced batch of student places it asked for), so
 * what is left is the read: an owner sees which building ran out and how long ago, from
 * rows nobody can file any more.
 *
 * WHO CAN FILE ONE: nobody, since §16.1 step 28 removed `requestPlaces` with the seats
 * it asked for. This is the read side only — /hq shows the rows that already exist as
 * history, which is §18's own words for what the table becomes, and when the last one
 * is answered the card disappears with it.
 *
 * THE BRANCH IS MATCHED IN THE CALLER RATHER THAN IN THE QUERY, and not for tidiness.
 *
 * NULL RATHER THAN AN EMPTY LIST WHEN THE READ FAILS. /hq is silent about a failed read
 * — the card above it is a warning about the pool and the table beside it is the month's
 * money, and a line about a read that did not work belongs to neither — but a failure
 * hidden here would show a branch that has been waiting a week a card that says nothing
 * is wrong.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/types'

/**
 * Every ask still waiting, for the reader who can end the waiting.
 *
 * WHICH BRANCH, NOT WHO. The name of the manager who asked is in the row and is not on
 * this list, because a browser cannot read it: `profiles` shows an owner their own row
 * and nobody else's, so putting a name here would mean an admin client on a page. The
 * fact the owner needs is which building ran out — 20260811000058's own note — and the
 * name stays in the record for the founder panel and the audit trail.
 *
 * NULL RATHER THAN AN EMPTY LIST WHEN THE READ FAILS, unlike `openAsk` above, and the
 * asymmetry is the point. There, "nobody has asked" costs nothing: the button is offered
 * and the insert is idempotent. Here it would hide a branch that has been waiting a
 * week behind a card that says nothing is wrong.
 */
export type BranchAsk = {
  id: string
  places: number
  /** When it was filed, so the screen can say how long they have been waiting. */
  createdAt: string
  /** Null is head office, the reading every other `branch_id` in this schema has. */
  branchId: string | null
  /** Null when the branch row is gone or unnamed — the screen has words for both. */
  branchName: string | null
}

export async function openAsks(
  supabase: SupabaseClient<Database>,
  centerId: string,
): Promise<BranchAsk[] | null> {
  const { data, error } = await supabase
    .from('capacity_requests')
    .select('id, places, created_at, branch_id, branches (name)')
    .eq('coaching_center_id', centerId)
    .is('handled_at', null)
    // Oldest first, which is `capacity_requests_open_idx`. The branch that has been
    // turning families away longest is the one to answer.
    .order('created_at', { ascending: true })

  if (error || !data) return null

  return data.map((row) => ({
    id: row.id,
    places: row.places,
    createdAt: row.created_at,
    branchId: row.branch_id,
    branchName: row.branches?.name ?? null,
  }))
}
