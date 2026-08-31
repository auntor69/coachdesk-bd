import { createHash, timingSafeEqual } from 'node:crypto'

import type { NextRequest } from 'next/server'

import { sendSms } from '@/lib/sms/send'
import { smsProviderConfigured } from '@/lib/sms/provider'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The SMS delivery worker: the thing that actually drains sms_logs.
 *
 * Everywhere else in this product, a "send" means writing a row with status
 * 'queued'. This endpoint is the only code that turns those rows into messages,
 * and it is deliberately thin. Every decision that involves money or a promise to
 * a parent is made in SQL by 20260811000016, where it holds whether or not this
 * file behaves:
 *
 *   claim_sms_batch       takes rows exactly once (for update skip locked), marks
 *                         them 'sending', and counts the attempt at claim time —
 *                         so a worker that dies mid-send still spent a try.
 *   finish_sms            settles one row: 'sent', or back to 'queued' with a
 *                         widening backoff, or 'failed' with the credits refunded
 *                         in the same transaction that gives up.
 *   cancel_opted_out_sms  drops anything queued for someone who opted out after
 *                         it was queued, and refunds it.
 *   reap_stranded_sms     settles rows left 'sending' by a worker that vanished.
 *
 * All four are granted to service_role alone; the browser cannot call any of
 * them. What is left for this file is: prove you are the cron, ask for a batch,
 * hand each message to the gateway, report what came back.
 *
 * ORDER MATTERS, and it is reap → cancel → claim → send → settle:
 *   reap first, so a row stranded by the previous run is back in the queue in time
 *   to be claimed by this one instead of waiting a full extra cycle;
 *   cancel before claim, so an opt-out that arrived since the last run is honoured
 *   before the message can be handed to the gateway — after the claim would be too
 *   late, the message would already be gone.
 *
 * WALL CLOCK. Serverless functions are killed, not paused. Batch 10 × 4s gateway
 * timeout ÷ 5 in flight ≈ 8s worst case, inside Vercel Hobby's ~10s ceiling with
 * room for the round trips at either end. `maxDuration` is deliberately not
 * exported: it would raise the ceiling on a plan that allows it and fail the
 * deployment on a plan that does not, and this has to deploy on Hobby today.
 * If the batch size is raised, raise the plan first.
 *
 * A run that is killed mid-batch is not a lost message. The rows it claimed sit
 * in 'sending' until reap_stranded_sms puts them back, which is what the reaper
 * is for. The cost of being killed is a ten-minute delay, not a silence.
 *
 * No route segment config. GET handlers have defaulted to dynamic since Next
 * 15.0.0-RC and this one reads a request header, so `dynamic = 'force-dynamic'`
 * would restate the default; `runtime = 'nodejs'` is also the default, and the
 * Next 16 docs ask that the export be dropped rather than set.
 *
 * HOW IT GETS CALLED. Three ways, all of them just an HTTP request with a bearer
 * token, which is why the token and not the caller is what is checked:
 *   1. Vercel Cron (vercel.json) — sends GET with Authorization: Bearer
 *      $CRON_SECRET automatically. Hobby allows daily; Pro allows per-minute.
 *   2. A GitHub Actions schedule — every 5 minutes, free, and the useful answer
 *      while the project is on Hobby. Not committed: it would go red every five
 *      minutes until somebody adds CRON_SECRET as a repo secret, and a repo full
 *      of red crosses is worse than a documented option.
 *   3. Supabase pg_cron + pg_net, if the queue should drain without depending on
 *      the web host at all.
 *
 * THE SCHEDULE IN vercel.json IS `0 4 * * *`, and that file cannot hold a comment,
 * so the reasons are here. Vercel reads cron schedules as UTC; Dhaka is UTC+6, so
 * 04:00 UTC is 10:00 in the morning where the parents are. That is the constraint
 * that picked the number — a queue drained at 03:00 local would ring in a
 * household at three in the morning, which is a real harm and not a rough edge.
 * Once a day, because Hobby permits nothing more frequent and a tighter schedule
 * fails the deployment outright rather than quietly running daily.
 *
 * Until CRON_SECRET exists in the Vercel project, Vercel sends no Authorization
 * header and the daily run is a 401 in the dashboard. That is the intended
 * behaviour: a visible, actionable failure beats a job that appears to be working.
 */

/** Vercel Cron issues GET, so GET is the real handler. */
export async function GET(request: NextRequest) {
  return handle(request)
}

/**
 * POST is the same run, for the callers that prefer a verb with a body: pg_net's
 * http_post, a manual curl while debugging, a GitHub Actions step. It is an alias
 * and not a second implementation — two ways to drain a queue is one way too many.
 */
export async function POST(request: NextRequest) {
  return handle(request)
}

/**
 * How many messages one run may take, and how many may be in flight.
 *
 * Env-tunable because the right numbers depend on the aggregator's rate limit and
 * the host's wall clock, neither of which is known yet, and both of which will be
 * discovered on a live account rather than reasoned out here. Clamped so a typo in
 * a dashboard cannot turn one run into a timeout: claim_sms_batch caps the batch
 * at 100 in SQL as well, because a limit that only exists in the caller is not a
 * limit.
 */
function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/**
 * Is this the cron?
 *
 * sha256 both sides before comparing, because timingSafeEqual throws on buffers
 * of different lengths — comparing raw secrets would leak the length through an
 * exception and force a try/catch around the security check. Hashing makes both
 * sides 32 bytes, so the comparison is always the constant-time one.
 *
 * An unset CRON_SECRET refuses everything. The other direction — no secret set,
 * so allow anyone — is the version of this function that ends up in a postmortem:
 * the endpoint spends a centre's credits, and an unconfigured deployment is
 * exactly when nobody is watching it.
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

/** Counts only. Never a phone number, never a message body. */
type Summary = {
  ok: boolean
  reaped?: number
  cancelled?: number
  claimed?: number
  sent?: number
  requeued?: number
  failed?: number
  unsettled?: number
  queued?: number
  ms?: number
  reason?: string
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    // Deliberately says nothing about which part was wrong, and no WWW-Authenticate
    // header: there is no interactive login to offer here.
    return json({ ok: false, reason: 'unauthorized' }, 401)
  }

  try {
    return json(await run())
  } catch (error) {
    // Reaching here means the worker itself broke — a missing service-role key, a
    // Supabase outage. Any row already claimed is in 'sending' and the next run's
    // reaper will settle it, so the queue recovers on its own.
    const reason = error instanceof Error ? error.message : 'worker failed'
    console.error(`[cron/sms] ${reason}`)
    return json({ ok: false, reason }, 500)
  }
}

async function run(): Promise<Summary> {
  const startedAt = performance.now()
  // actor-less: a machine write, and its honest record is `actor_role = 'service_role'`
  // with no actor. Naming the owner whose queue this drained would put a person's id on
  // a send they were asleep for.
  const db = createAdminClient()

  const backlog = async () => {
    const { count } = await db
      .from('sms_logs')
      // scoped-by: no centre, deliberately — this is the worker, and it drains
      // every centre's queue. It runs as service_role, which is not a tenant, and
      // the only thing it takes out of the rows is how many there are. The same
      // reasoning is written at greater length over claim_sms_batch in
      // 20260811000016, which is the other query in this product with no
      // coaching_center_id in it.
      .select('id', { count: 'exact', head: true })
      .eq('status', 'queued')
    return count ?? 0
  }

  if (!smsProviderConfigured()) {
    /**
     * The expected state until BTRC approves a sender ID, so it answers 200 with
     * the backlog rather than an error: a job that reports failure every day for
     * something that is not broken is a job whose alerts get muted, and then the
     * one day it means something nobody looks.
     *
     * Nothing is skipped by stopping here. Nothing can be stranded in 'sending'
     * when no send has ever happened, so the reaper has no work; and the opt-out
     * cancel runs before the claim in every real run, so a message queued for
     * someone who has since opted out is caught the first time this endpoint has a
     * gateway to hand it to — never sent, just cancelled later than it could have
     * been. Credits are the thing that must not be spent wrongly, and none are.
     */
    return {
      ok: true,
      reason: 'gateway not configured',
      queued: await backlog(),
      ms: Math.round(performance.now() - startedAt),
    }
  }

  const batchSize = intFromEnv('SMS_BATCH_SIZE', 10, 1, 100)
  const concurrency = intFromEnv('SMS_CONCURRENCY', 5, 1, 10)

  const { data: reaped, error: reapError } = await db.rpc('reap_stranded_sms')
  if (reapError) throw new Error(`reap_stranded_sms: ${reapError.message}`)

  const { data: cancelled, error: cancelError } = await db.rpc('cancel_opted_out_sms')
  if (cancelError) throw new Error(`cancel_opted_out_sms: ${cancelError.message}`)

  const { data: claimed, error: claimError } = await db.rpc('claim_sms_batch', {
    p_limit: batchSize,
  })
  if (claimError) throw new Error(`claim_sms_batch: ${claimError.message}`)

  const batch = claimed ?? []
  const tally = { sent: 0, requeued: 0, failed: 0, unsettled: 0 }

  await inParallel(batch, concurrency, async (message) => {
    const result = await sendSms(message.to_phone, message.body)

    const { data: outcome, error: finishError } = await db.rpc('finish_sms', {
      p_id: message.id,
      p_ok: result.ok,
      p_ref: result.ok ? result.ref : null,
      p_error: result.ok ? null : result.error,
    })

    if (finishError) {
      /**
       * The message may well have gone out and this is only the bookkeeping
       * failing. The row stays 'sending' and the next run's reaper settles it as a
       * failure — which refunds the credit and puts it back for one more try. That
       * can send a second copy, and that is the side of at-least-once this product
       * chose: a parent seeing a result twice is a smaller harm than a parent never
       * hearing it, and the centre is never charged for the duplicate.
       */
      tally.unsettled++
      console.error(`[cron/sms] finish_sms failed: ${finishError.message}`)
      return
    }

    if (outcome === 'sent') tally.sent++
    else if (outcome === 'queued') tally.requeued++
    else if (outcome === 'failed') tally.failed++
    else tally.unsettled++ // 'missing', or a status something else moved it to
  })

  return {
    ok: true,
    reaped: reaped ?? 0,
    cancelled: cancelled ?? 0,
    claimed: batch.length,
    ...tally,
    queued: await backlog(),
    ms: Math.round(performance.now() - startedAt),
  }
}

/**
 * Run `worker` over `items`, at most `limit` at a time.
 *
 * Not Promise.all over the whole batch: ten simultaneous requests is how an
 * aggregator's rate limiter starts refusing, and every refusal costs an attempt.
 * Not a sequential loop either — ten messages at four seconds each is forty
 * seconds, four times the host's ceiling.
 *
 * The shared cursor is safe without a lock because there is no await between
 * reading and incrementing it: JavaScript cannot interleave those two lines.
 */
async function inParallel<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await worker(items[index])
    }
  })

  await Promise.all(runners)
}

function json(body: Summary, status = 200) {
  return Response.json(body, {
    status,
    // Nothing here may be cached, by the host or by anything in front of it: a
    // cached 200 would be a run that never happened, reported as a success.
    headers: { 'Cache-Control': 'no-store' },
  })
}
