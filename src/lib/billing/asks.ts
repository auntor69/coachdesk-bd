import 'server-only'

/**
 * Whether this branch has already asked for room.
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
