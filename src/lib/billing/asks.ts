import 'server-only'

/**
 * Who has asked for room, read two ways: this branch's own ask, and every open one.
 *
 * MASTERPLAN §3.7 forks the full-register screen on who is looking: an owner is offered
 * the price, a branch manager is offered a button that asks HQ. The asking is a Server
 * Action in `settings/plan/actions.ts`; this is the read that stops the same screen
 * offering the button to somebody who pressed it yesterday.
 *
 * THE BRANCH IS MATCHED HERE RATHER THAN IN THE QUERY, and not for tidiness. A manager
 * with no branch has asked for the organisation — `branch_id is null` — and PostgREST
 * needs `is.null` rather than `eq.null` for that, so a single chain would need its
 * operator chosen at runtime. Every open ask is one row per branch, so the list is
 * already small enough to pick from: an institution with forty branches all out of room
 * at once has a worse problem than this query.
 *
 * A FAILED READ IS TREATED AS "NOBODY HAS ASKED", which is the direction that costs
 * nothing: the screen offers the button, and `requestPlaces` meets the partial unique
 * index and reports the ask that was already there as success.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/types'

export type OpenAsk = {
  id: string
  places: number
  /** When it was filed, so the screen can say how long they have been waiting. */
  createdAt: string
}

export async function openAsk(
  supabase: SupabaseClient<Database>,
  centerId: string,
  branchId: string | null,
): Promise<OpenAsk | null> {
  const { data } = await supabase
    .from('capacity_requests')
    .select('id, places, created_at, branch_id')
    .eq('coaching_center_id', centerId)
    .is('handled_at', null)

  const mine = data?.find((row) => row.branch_id === branchId)
  if (!mine) return null

  return { id: mine.id, places: mine.places, createdAt: mine.created_at }
}

/**
 * The other side of the same table: every ask still waiting, for the reader who can end
 * the waiting.
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
export type BranchAsk = OpenAsk & {
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
