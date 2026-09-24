import { createHash, timingSafeEqual } from 'node:crypto'

import type { NextRequest } from 'next/server'

import { settleDay } from '@/lib/billing/settlement'
import { todayInDhaka } from '@/lib/bd/time'
import { burnsMoney } from '@/lib/entitlement'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The nightly settle: the second cron, and the one §11.7 and §11.13 asked for by name.
 *
 * WHAT IT IS FOR. `public.settle_billing` is called when a member opens a page, so a centre
 * nobody signs into keeps whatever figure it had the last time somebody did. This route
 * calls the same function for every centre, so an owner who has not logged in — and the
 * founder panel (§11.13) — still reads a current line.
 *
 * IT IS NOT LOAD-BEARING, AND THAT IS THE DESIGN RATHER THAN A HOPE. Access is a comparison
 * between `balance_poisha` and the days owed on `charged_through`, and not a row this route
 * writes. No `CRON_SECRET`, a missed delivery, a Vercel outage or a run killed at the wall
 * clock therefore changes no access decision anywhere: the next session, whenever it comes,
 * catches up every day it owes in one call (§11.7's catch-up, and `tests/billing`'s "the
 * series has no hole in it").
 *
 * IT MAY NOT HAVE A SECOND CALCULATION. §11.13's rule, in its own words: *"The one thing it
 * must never do is a different calculation from the session path — same function, one
 * implementation, or the nightly figure and the on-use figure are two billing engines."* So
 * the call goes through `settleDay`, which is the session's own helper and holds the one RPC
 * cast and the one parser in this product, and this file holds no arithmetic of its own and
 * never builds a call. The only thing it passes that a session does not is the caller:
 * `system`, which is `settlement_runs.ran_by`'s word for a machine and is what
 * `lib/supabase/admin.ts` means by leaving the actor off.
 *
 * THE FREE TIER IS SKIPPED, AND BY THE SAME RULE THE SESSION USES. `burnsMoney` is the
 * question `dailyBurn` asks before a page load settles anything, and the answer is the same
 * here for the same reason: a free centre's rate is zero for the rest of its life, so a
 * settlement is a round trip that returns `nothing_due` forever. What that costs is a read
 * of the plan column against a price card, two head counts and a balance sum — which is
 * exactly what the function's own early return would have cost anyway.
 *
 * NO STATUS FILTER, AND THAT IS DELIBERATE. A suspended or cancelled centre still owes for
 * the days it ran, and its access is decided by `status` before the balance is ever
 * consulted (§11.14's table). A filter here would be a second opinion about the money — the
 * same second opinion `dailyBurn`'s docblock refuses to hold in JavaScript — and the day it
 * drifted from the resolver would be the day a centre was charged for a life it had stopped
 * living, or not charged for one it had not.
 *
 * WHAT IS LOGGED, AND WHAT IS NOT. §11.13 names the four fields and this logs those four:
 * the centre id, the date, the status and the SQLSTATE. It never logs a student's name, a
 * guardian's phone number, a transaction id or a balance — a log is a place data leaks from,
 * and none of those four are needed to fix a settlement. The SQLSTATE is logged where it
 * exists and invented nowhere: a call that never reached the function carries PostgREST's
 * own code, and a failure *inside* the function logs `none`, because the same night's
 * `settlement_runs` row already holds `sqlerrm [sqlstate]` in `error_detail` and a second
 * copy in a log that gets rotated away is not a record. The response body is counts only,
 * for the same reason — Vercel keeps it.
 *
 * THE WALL CLOCK. Serverless functions are killed, not paused. One settlement is a single
 * RPC under that centre's own advisory lock — `hashtext('billing_ledger.balance')` with the
 * centre's id, so two centres never queue behind each other — and the run walks the list
 * until its budget is spent, so a small fleet finishes in a moment and a large one stops
 * politely instead of being killed mid-list. The list is ordered by the stalest line first,
 * which is the whole fairness argument: if a fleet ever outgrows one night, the centres
 * nobody has settled in longest are the ones that go first, and no centre can be starved
 * while another is served twice.
 *
 * `maxDuration` is deliberately not exported, for the reason `/api/cron/sms` records: it
 * would raise the ceiling on a plan that allows it and fail the deployment on a plan that
 * does not, and this has to deploy on Hobby today.
 *
 * THE SCHEDULE IN vercel.json IS `10 18 * * *`, and that file cannot hold a comment, so the
 * reasons are here. Vercel reads cron schedules as UTC; Dhaka is UTC+6, so 18:10 UTC is
 * 00:10 in the morning where the centres are — ten minutes after the Dhaka day flips, which
 * is the earliest a run can charge *today* and the latest it can be without an owner opening
 * the app first. Charging the day at its smallest size is safe rather than cheap: §11.7
 * makes the day's total the high-water rate, so the morning's first write tops the charge up
 * to whatever the roster has grown to, and a run that lands after somebody has already
 * worked simply finds nothing to do.
 *
 * HOW IT GETS CALLED. The same three ways as the SMS drainer, all of them an HTTP request
 * with a bearer token, which is why the token is what is checked and not the caller: Vercel
 * Cron (a GET with `Authorization: Bearer $CRON_SECRET`), a manual curl, or pg_net. Until
 * `CRON_SECRET` exists in the Vercel project the daily run is a visible 401 in the
 * dashboard, which is the intended behaviour — an actionable failure beats a job that only
 * appears to be working.
 *
 * No route segment config: GET handlers have defaulted to dynamic since Next 15.0.0-RC and
 * this one reads a request header, so `dynamic = 'force-dynamic'` would restate the default.
 */

/** How long one run may spend settling before it stops and leaves the rest for tomorrow. */
const BUDGET_MS = 6_000

/**
 * A ceiling on the rows one run may consider, whatever the clock says.
 *
 * The budget is the real guard and this is the belt beside it: a database that answers in a
 * millisecond would otherwise let one run walk an entire country's worth of centres inside
 * six seconds, and the point of the route is a figure that is a few hours fresh, not a load
 * test of the ledger on a nightly timer.
 */
const ROW_CEILING = 500

/** Vercel Cron issues GET, so GET is the real handler. */
export async function GET(request: NextRequest) {
  return handle(request)
}

/**
 * POST is the same run, for the callers that prefer a verb with a body: pg_net's `http_post`,
 * a manual curl while debugging. An alias and not a second implementation — §11.13's rule is
 * about implementations, and this is the same one.
 */
export async function POST(request: NextRequest) {
  return handle(request)
}

/**
 * Is this the cron?
 *
 * sha256 both sides before comparing, because `timingSafeEqual` throws on buffers of
 * different lengths — comparing raw secrets would leak the length through an exception and
 * force a try/catch around a security check. Hashing makes both sides 32 bytes, so the
 * comparison is always the constant-time one.
 *
 * An unset `CRON_SECRET` refuses everything. The other direction — no secret set, so allow
 * anyone — is the version of this function that ends up in a postmortem: the endpoint writes
 * ledger rows, and an unconfigured deployment is exactly when nobody is watching it.
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization')
  if (!header) return false

  const offered = header.startsWith('Bearer ') ? header.slice(7) : header

  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(offered), digest(secret))
}

/** Counts only. Never a balance, never a centre's name, never anybody's phone number. */
type Summary = {
  ok: boolean
  /** Rows the query returned, up to {@link ROW_CEILING}. */
  centres?: number
  /** Settlements actually asked for — the rows that were not the free tier. */
  asked?: number
  settled?: number
  nothingDue?: number
  /** A balance that could not cover a whole day, so nothing was charged (§11.7). */
  dry?: number
  /** A call that failed, or a function that answered `ok: false`. */
  failed?: number
  /** Rows the budget ran out before. The next night's run starts at the stalest. */
  left?: number
  ms?: number
  reason?: string
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    // Deliberately says nothing about which part was wrong, and offers no challenge header:
    // there is no interactive login to offer here.
    return json({ ok: false, reason: 'unauthorized' }, 401)
  }

  try {
    return json(await run())
  } catch (error) {
    // Reaching here means the worker itself broke — a missing service-role key, a Supabase
    // outage. Nothing this run did is half-done: every settlement is one call that either
    // charged a day or did not, so the next run asks again and gets the same answer.
    const reason = error instanceof Error ? error.message : 'worker failed'
    console.error(`[cron/settle] ${reason}`)
    return json({ ok: false, reason }, 500)
  }
}

async function run(): Promise<Summary> {
  const startedAt = performance.now()

  // actor-less: a machine write, and its honest record is `ran_by = 'system'` on the night's
  // `settlement_runs` row. Naming an owner whose line this charged would put a person's id
  // on a charge they were asleep for (§11.13, and the note over `createAdminClient`).
  const db = createAdminClient()
  const day = todayInDhaka()

  const { data: centres, error } = await db
    .from('coaching_centers')
    // scoped-by: no centre, deliberately — this is the worker, and it walks every centre the
    // way `claim_sms_batch` walks every queue. It runs as service_role, which is not a
    // tenant; what it takes out of the rows is an id, a plan and a date. The same reasoning
    // is written at greater length in `20260811000016`, over the other query in this product
    // with no `coaching_center_id` in it.
    .select('id, plan')
    // The stalest line first: the centres nobody logs into are the entire subject of this
    // route, and a run that stops short must have served the ones that needed it most.
    .order('charged_through', { ascending: true, nullsFirst: true })
    .limit(ROW_CEILING)

  if (error) throw new Error(`coaching_centers: ${error.message}`)

  const rows = centres ?? []
  const tally = { settled: 0, nothingDue: 0, dry: 0, failed: 0 }
  let asked = 0
  let scanned = 0

  for (const centre of rows) {
    // Checked before the call and not after: a run that has spent its budget must not spend
    // one more round trip on the way out of the loop.
    if (performance.now() - startedAt > BUDGET_MS) break
    scanned += 1

    if (!burnsMoney(centre.plan)) continue
    asked += 1

    const { settlement, sqlstate } = await settleDay(db, centre.id, 'system')

    if (!settlement || !settlement.ok) {
      // `ok: false` is the function's own flag for its two failure statuses — `error` (no
      // price card in force) and `usage_unavailable` (a head count that failed) — and both
      // of them charge nothing and leave `charged_through` where it was, so there is nothing
      // to undo here; the founder sees the run row and this line.
      tally.failed += 1
      logFailure(centre.id, day, settlement?.status ?? 'error', sqlstate)
      continue
    }

    if (settlement.status === 'settled') tally.settled += 1
    else if (settlement.status === 'nothing_due') tally.nothingDue += 1
    else if (settlement.status === 'insufficient_balance') tally.dry += 1
    // An `ok: true` answer in a shape this file has not met. Counted as a failure rather
    // than guessed at, because a status nobody recognises is not a settled day.
    else {
      tally.failed += 1
      logFailure(centre.id, day, settlement.status, null)
    }
  }

  return {
    ok: true,
    centres: rows.length,
    asked,
    ...tally,
    left: Math.max(0, rows.length - scanned),
    ms: Math.round(performance.now() - startedAt),
  }
}

/**
 * §11.13's four fields, and nothing that is a customer's.
 *
 * A free function rather than a line inside the loop because the same line is written from
 * two places — a call that failed and an answer that says it failed — and two hand-typed
 * copies of a log format is how a field goes missing from one of them.
 */
function logFailure(
  centreId: string,
  day: string,
  status: string,
  sqlstate: string | null,
): void {
  console.error(
    `[cron/settle] centre=${centreId} date=${day} status=${status} sqlstate=${sqlstate ?? 'none'}`,
  )
}

function json(body: Summary, status = 200) {
  return Response.json(body, {
    status,
    // Nothing here may be cached, by the host or by anything in front of it: a cached 200
    // would be a run that never happened, reported as a success.
    headers: { 'Cache-Control': 'no-store' },
  })
}
