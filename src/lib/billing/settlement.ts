import 'server-only'

/**
 * The burn, called where a session begins (MASTERPLAN §11.7, §4.4).
 *
 * SETTLEMENT IS A CONSEQUENCE OF USE, NOT A JOB. `public.settle_billing` charges every
 * unsettled whole past day and today at the current size, under the ledger's own
 * per-centre advisory lock, and it accepts no amount from anybody. The cron exists so a
 * centre nobody logs into still shows a current figure to its owner and to the founder
 * panel, and since 2026-09-23 it is really there — `/api/cron/settle` — after §11.7 and
 * §11.13 described it in the present tense for two days of build order. It is not
 * load-bearing, because access is a comparison over two columns and not a row this
 * function writes.
 *
 * TWO CALLERS, ONE CALL. The session asks as `session` and the cron asks as `system`, and
 * that is the only difference between them: §11.13's rule is that a nightly figure and an
 * on-use figure that came out of two implementations would be two billing engines, so the
 * RPC cast, the call and the parse all live here and neither caller may write its own.
 * `SettleCaller` is `settlement_runs.ran_by`'s own check constraint, restated in TypeScript
 * so a third caller cannot invent a fourth word for who asked.
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
 * its types. Migrations 81–86 are pushed and `npm run gen:types` has run; the function is
 * in `Database['public']['Functions']` with the same argument names, so this keeps the
 * narrow argument type (`'session' | 'system' | 'founder'` rather than `string | null`)
 * while delegating the rest to the generated entry.
 */
/**
 * Who asked for the charge, in `settlement_runs.ran_by`'s own vocabulary.
 *
 * `session` is a member opening a page, `system` is the nightly cron, and `founder` is the
 * panel's by-hand retry with a written reason (§11.13). The database checks the same three
 * words; this is that check, stated where a caller can be refused at compile time.
 */
export type SettleCaller = 'session' | 'system' | 'founder'

type SettleBillingRpc = (
  fn: 'settle_billing',
  args: { p_center: string; p_ran_by: SettleCaller },
) => PromiseLike<{ data: Json | null; error: { code?: string; message: string } | null }>

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
 * One attempt, in the shape both callers can read it.
 *
 * `settlement` IS NULL AND THAT IS THE FAILURE — not an exception, because the session has
 * a defined answer for a settlement that did not happen: the rate stays unknown, and an
 * unknown rate against a day that is owed is read-only (§11.7). Returning a zero instead
 * would be the same shape of mistake as reading a missing count as an empty roster.
 *
 * `sqlstate` AND `message` EXIST FOR THE CRON'S LOG LINE AND NOTHING ELSE. §11.13 says a
 * settlement failure logs the centre id, the date, the status and the SQLSTATE, and the
 * SQLSTATE is the one thing a caller cannot reconstruct: the function catches its own
 * exceptions and writes `sqlerrm [sqlstate]` into `settlement_runs.error_detail`, but a call
 * that never reached the function — a PostgREST refusal, a dropped connection — has no run
 * row to read it from. Nothing here is ever shown to a reader, and neither field is a
 * figure: a failure that carried a balance would be a log a customer's money leaks from.
 */
export type SettlementAttempt = {
  settlement: Settlement | null
  sqlstate: string | null
  message: string | null
}

/**
 * Settle this centre's day, or say that it could not be settled.
 *
 * The RPC raises for a caller with no membership at the centre and for a centre that does
 * not exist. For the session path neither is reachable — the membership is the session's
 * own active centre — so a raise there is a real fault; for the cron, a centre deleted
 * between the list and the call is an ordinary race, which is why the caller is told rather
 * than the answer being swallowed. `status` is what the founder panel and `settlement_runs`
 * read, and it is never inferred here from the absence of a figure.
 */
export async function settleDay(
  supabase: SupabaseClient<Database>,
  centerId: string,
  ranBy: SettleCaller = 'session',
): Promise<SettlementAttempt> {
  // BOUND, NOT DETACHED. `rpc` is a prototype method of the client and reads
  // `this.rest` inside — pulling it off the object and calling it as a free
  // function set `this` to undefined and threw "Cannot read properties of
  // undefined (reading 'rest')" on every signed-in page, which is the failure
  // Vercel logged as ERROR 2938108482. The narrow cast lives on the bound
  // signature instead, so the call keeps its types and keeps its `this`.
  const settle: SettleBillingRpc = (...args) => supabase.rpc(...args)
  const { data, error } = await settle('settle_billing', {
    p_center: centerId,
    p_ran_by: ranBy,
  })

  if (error) {
    return { settlement: null, sqlstate: error.code ?? null, message: error.message }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    // A 200 the parser cannot read. There is no SQLSTATE to report and saying
    // "unavailable" is not the same as inventing one.
    return { settlement: null, sqlstate: null, message: 'unreadable answer' }
  }

  const out = data as Record<string, unknown>
  const status = typeof out.status === 'string' ? out.status : 'error'

  return {
    settlement: {
      ok: out.ok === true,
      status: status as Settlement['status'],
      dailyPoisha: numberOrNull(out.dailyPoisha),
      balanceAfter: numberOrNull(out.balanceAfter),
      chargedThrough:
        typeof out.chargedThrough === 'string' ? out.chargedThrough.slice(0, 10) : null,
    },
    sqlstate: null,
    message: null,
  }
}
