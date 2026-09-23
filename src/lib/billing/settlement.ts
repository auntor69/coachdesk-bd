import 'server-only'

/**
 * The burn, called where a session begins (MASTERPLAN §11.7, §4.4).
 *
 * SETTLEMENT IS A CONSEQUENCE OF USE, NOT A JOB. `public.settle_billing` charges every
 * unsettled whole past day and today at the current size, under the ledger's own
 * advisory lock, and it accepts no amount from anybody. The cron exists so a centre
 * nobody logs into still shows a current figure to its owner; it is not load-bearing,
 * because access is a comparison over two columns and not a row this function writes.
 *
 * WHY IT IS CALLED FROM THE SESSION AND NOT ONLY FROM A WRITE GUARD. §16.1 step 24
 * named `requireWritable` as the caller, and the guarantee it was reaching for is real
 * — the day must be charged from the size at the moment work starts, which is what
 * closes the only gaming vector daily billing has. Session resolution is the same
 * moment, one step earlier: every action reaches `requireWritable` through a session,
 * so the charge is still taken before any write can land, and the screens that draw the
 * read-only arms and the banner read the same answer. A refusal that only a write could
 * produce would leave a dry centre looking writable until its owner tapped something.
 *
 * IT IS CALLED ONLY WHEN IT CAN CHANGE THE ANSWER — the line is behind today and the
 * balance holds something to spend on it. Both halves matter. A settlement on a centre
 * that is paid up costs a round trip and returns `nothing_due`; a settlement on a
 * centre with an empty balance charges nothing by definition (§11.7's whole days or
 * nothing), and *not* calling it is what keeps a dry centre from writing a settlement
 * row every time a member opens a page.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/lib/supabase/types'

/**
 * `public.settle_billing` AS POSTGREST SEES IT, declared here until the generated
 * types catch up.
 *
 * THE CAST BELOW IS NOW A NO-OP. `settle_billing` was absent from the generated types
 * while migration 81 was unpushed, and the shape was written out so the call did not lose
 * its types. Migrations 81–85 are pushed and `npm run gen:types` has run; the function is
 * in `Database['public']['Functions']` with the same argument names, so this keeps the
 * narrow argument type (`'session' | 'system' | 'founder'` rather than `string | null`)
 * while delegating the rest to the generated entry.
 */
type SettleBillingRpc = (
  fn: 'settle_billing',
  args: { p_center: string; p_ran_by: 'session' | 'system' | 'founder' },
) => PromiseLike<{ data: Json | null; error: { message: string } | null }>

/**
 * What the function answers, in the shape the access comparison reads it.
 *
 * `dailyPoisha` IS NULL AND NOT ZERO where the rate could not be read — the counts
 * failed, or the price card is missing — and that distinction is load-bearing: zero is
 * a rate that has been read and is nothing, which is the free tier; null is a number
 * nobody has, which §4.4 resolves to read-only wherever the rate is needed.
 */
export type Settlement = {
  ok: boolean
  status: 'settled' | 'nothing_due' | 'insufficient_balance' | 'usage_unavailable' | 'error'
  /** What one day costs today, in poisha, or null where it could not be read. */
  dailyPoisha: number | null
  /** The balance after this attempt, or null where it could not be read. */
  balanceAfter: number | null
  /** The line as the row holds it now, in Dhaka days, or null. */
  chargedThrough: string | null
}

/** A number off the wire, or null for anything that is not one. */
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Settle this centre's day, or say that it could not be settled.
 *
 * NULL IS THE FAILURE AND IT IS NOT AN EXCEPTION, because the one caller has a defined
 * answer for a settlement that did not happen: the rate stays unknown, and an unknown
 * rate against a day that is owed is read-only (§11.7). Returning a zero instead would
 * be the same shape of mistake as reading a missing count as an empty roster.
 *
 * The RPC raises for a caller with no membership at the centre and for a centre that
 * does not exist, and neither is a state this path can reach: the membership is the
 * session's own active centre. A raise is therefore a real fault, and it is reported as
 * `false` rather than swallowed with the rest — `status` is what the founder panel and
 * `settlement_runs` will read.
 */
export async function settleDay(
  supabase: SupabaseClient<Database>,
  centerId: string,
): Promise<Settlement | null> {
  const settle = supabase.rpc as unknown as SettleBillingRpc
  const { data, error } = await settle('settle_billing', {
    p_center: centerId,
    p_ran_by: 'session',
  })

  if (error) return null
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null

  const out = data as Record<string, unknown>
  const status = typeof out.status === 'string' ? out.status : 'error'

  return {
    ok: out.ok === true,
    status: status as Settlement['status'],
    dailyPoisha: numberOrNull(out.dailyPoisha),
    balanceAfter: numberOrNull(out.balanceAfter),
    chargedThrough:
      typeof out.chargedThrough === 'string' ? out.chargedThrough.slice(0, 10) : null,
  }
}
