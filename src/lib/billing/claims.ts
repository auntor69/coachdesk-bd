import 'server-only'

/**
 * The recharge claim, read and written — MASTERPLAN §11.9, build-order step 25's plumbing
 * between the screen and `public.approve_recharge_claim`.
 *
 * WHAT THE CUSTOMER CAN DO AND WHAT THEY CANNOT. They can file one claim: "I sent this,
 * here is the transaction ID". They cannot credit anything, name an amount, or read the
 * promotion that priced their bonus — `recharge_claims` holds no INSERT grant for
 * `authenticated` and `promotions` holds no policy at all, so both of those are structural
 * rather than checked here. What this module adds to that is the one thing SQL cannot say:
 * that the quote was priced from columns the server read.
 *
 * THE PROMOTION IS READ WITH THE ADMIN KEY, which is why `livePromotion` takes a client
 * rather than building one. §11.11: "Nothing about a promotion is reachable from a
 * centre's own session, read or write" — so a signed-in owner cannot read the row that
 * decides their bonus, and the value is computed on the server and handed to the screen as
 * a finished figure. That is also the shape §11.4 wants: the browser is given a quote, not
 * the inputs to one.
 *
 * A CLAIM IS NOT A PAYMENT. Nothing here writes `payments` or `billing_ledger`; those
 * happen in one transaction inside the database when a founder has looked at their own
 * bKash app. This module's whole job is to put on the record what the customer said, with
 * the figures the server priced it from, so that the founder has something to check.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { UNIQUE_VIOLATION } from '@/lib/idempotency'
import type { RejectReason } from '@/lib/i18n/recharge'
import type { Database, Json, RechargeClaimState } from '@/lib/supabase/types'
import { readBonusTiers, type BonusTier } from './recharge'

/*
 * THE CASTS ARE GONE. `provisional-types.ts` held hand-written shapes for `promotions` and
 * `recharge_claims` until the generated types could see them; migrations 84–85 are pushed
 * and `npm run gen:types` has run, so every client below is typed as `Database` directly —
 * which is the point of the placeholder file's own rule: the shape that is checked against
 * the database is the one that wins.
 */

/** The card in force: the published price list a quote is pinned to (§11.10). */
export type CurrentPriceVersion = {
  id: string
  effectiveFrom: string
}

/**
 * The rate card in force today, or null if none could be read.
 *
 * The newest `effective_from` that is not in the future, which is the same reading
 * `app.settle_billing` takes and the same one `order by effective_from desc limit 1` gives
 * it. Both halves matter: a card published today with a future date is not in force yet,
 * and quoting from it would price a recharge at a rate nobody has agreed to.
 *
 * Null rather than the newest row regardless, because a wrong card is a wrong quote and a
 * quote is a figure somebody sends money against.
 */
export async function currentPriceVersion(
  supabase: SupabaseClient<Database>,
  today: string,
): Promise<CurrentPriceVersion | null> {
  const { data, error } = await supabase
    .from('price_versions')
    .select('id, effective_from')
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return { id: data.id, effectiveFrom: data.effective_from }
}

/** A promotion in force, as the quote and the footnote need it. */
export type LivePromotion = {
  id: string
  code: string
  name: string
  tiers: BonusTier[]
  /** When it stops being offered, or null for open-ended. */
  endsAt: string | null
}

/**
 * The promotion live right now on a given card, or null.
 *
 * BOTH HALVES, for the reason `approve_recharge_claim` checks both: a quote pinned to a
 * card and priced with a promotion from another card is a discount nobody agreed to, and
 * an ended promotion must not keep quoting. The approval re-checks these conditions at the
 * moment it credits, so this reading only decides what the screen *says* — but a screen
 * that quotes 20% and credits 0% is the bug §11.11 exists to prevent, so it reads the same
 * three conditions.
 *
 * `now` is passed rather than taken, so a test can put a clock in it — the same reason
 * `billingStanding` takes one.
 */
export async function livePromotion(
  admin: SupabaseClient<Database>,
  priceVersionId: string,
  now: Date,
): Promise<LivePromotion | null> {
  const at = now.toISOString()

  const { data, error } = await admin
    .from('promotions')
    .select('id, code, name, tiers, ends_at, starts_at')
    .eq('active', true)
    .eq('price_version_id', priceVersionId)
    .lte('starts_at', at)
    .order('created_at', { ascending: false })

  if (error || !data) return null

  // `ends_at is null` is open-ended, and the filter is done here rather than with a second
  // `or()` chain so the two halves of the window read as the one condition they are.
  const live = data.find((row) => row.ends_at === null || row.ends_at > at)
  if (!live) return null

  return {
    id: live.id,
    code: live.code,
    name: live.name,
    tiers: readBonusTiers(live.tiers),
    endsAt: live.ends_at,
  }
}

/** A claim as the owner's own card shows it. */
export type OwnClaim = {
  id: string
  referenceCode: string
  quotedPoisha: number
  quotedBonusPoisha: number
  state: RechargeClaimState
  trxId: string
  submittedAt: string
  arrivedPoisha: number | null
  grantedPoisha: number | null
  grantedBonusPoisha: number | null
  rejectReason: string | null
}

/**
 * This centre's claims, newest first.
 *
 * The whole list rather than only the open ones, because a customer whose transfer was
 * rejected needs to see that it was and why — §11.9's "nothing is lost while it is
 * pending" is only credible if the row is still there afterwards. Read through the
 * caller's own session: `recharge_claims_owner_read` lets an owner read their centre's
 * rows, so nothing here reaches past RLS.
 *
 * A FAILED READ IS AN EMPTY LIST here and not a null, unlike `openAsks`: this card is a
 * status board and not a warning system, and the screen has nothing useful to say about a
 * claim it could not read. The one place a missing list would matter — the cap in
 * `fileRechargeClaim` — is enforced by the database rather than by this reading.
 */
export async function ownClaims(
  supabase: SupabaseClient<Database>,
  centerId: string,
): Promise<OwnClaim[]> {
  const { data, error } = await supabase
    .from('recharge_claims')
    .select(
      'id, reference_code, quoted_poisha, quoted_bonus_poisha, state, trx_id, submitted_at, arrived_poisha, granted_poisha, granted_bonus_poisha, reject_reason',
    )
    .eq('coaching_center_id', centerId)
    .order('submitted_at', { ascending: false })
    .limit(10)

  if (error || !data) return []

  return data.map((row) => ({
    id: row.id,
    referenceCode: row.reference_code,
    quotedPoisha: Number(row.quoted_poisha),
    quotedBonusPoisha: Number(row.quoted_bonus_poisha),
    state: row.state,
    trxId: row.trx_id,
    submittedAt: row.submitted_at,
    arrivedPoisha: row.arrived_poisha === null ? null : Number(row.arrived_poisha),
    grantedPoisha: row.granted_poisha === null ? null : Number(row.granted_poisha),
    grantedBonusPoisha:
      row.granted_bonus_poisha === null ? null : Number(row.granted_bonus_poisha),
    rejectReason: row.reject_reason,
  }))
}

/** What filing one needs, in the shape the action has already validated. */
export type FileClaimInput = {
  centerId: string
  quotedPoisha: number
  quotedBonusPoisha: number
  priceVersionId: string
  promotionId: string | null
  counts: { students: number; teachers: number; branches: number }
  trxId: string
  senderMsisdn: string
  submittedBy: string
}

export type FileClaimResult =
  | { ok: true; id: string; referenceCode: string }
  | { ok: false; reason: 'too_many_open' | 'duplicate_trx' | 'failed' }

/**
 * File the claim, and mint a reference code the customer can type into bKash.
 *
 * THE ADMIN CLIENT, because `authenticated` holds no INSERT here at all — which is §11.4
 * and not an oversight. The rows this writes are the two amounts a customer is not allowed
 * to name, so the write has to happen where the amount was computed. The caller is
 * responsible for having checked membership first; `submitRechargeClaim` in the plan
 * screen's actions is the only caller and it goes through `requireWritable`.
 *
 * THE REFERENCE CODE IS RETRIED RATHER THAN CHECKED, because a collision can only be
 * decided by the unique index — 923,521 codes and a business that will not exhaust them,
 * so one retry answers the case that will never happen and a second failure is a real
 * fault rather than a coincidence.
 *
 * `too_many_open` IS THE DATABASE'S ANSWER, not a count taken here. §11.9 caps a centre at
 * three open claims, `app.guard_open_recharge_claims` enforces it under an advisory lock,
 * and a count read a moment earlier would be a second opinion about the same question that
 * two taps could both win.
 */
export async function fileRechargeClaim(
  admin: SupabaseClient<Database>,
  input: FileClaimInput,
): Promise<FileClaimResult> {
  const db = admin

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await db
      .from('recharge_claims')
      .insert({
        coaching_center_id: input.centerId,
        quoted_poisha: input.quotedPoisha,
        quoted_bonus_poisha: input.quotedBonusPoisha,
        price_version_id: input.priceVersionId,
        promotion_id: input.promotionId,
        usage_students: input.counts.students,
        usage_teachers: input.counts.teachers,
        usage_branches: input.counts.branches,
        trx_id: input.trxId,
        sender_msisdn: input.senderMsisdn,
        submitted_by: input.submittedBy,
      })
      .select('id, reference_code')
      .single()

    if (!error && data) {
      return { ok: true, id: data.id, referenceCode: data.reference_code }
    }

    // The two refusals worth naming. The cap's message is raised by the trigger and
    // arrives as a check violation; a repeated reference code is a unique violation of
    // the code index rather than of the transaction index, and both are answered by
    // retrying once with a new code.
    if (error?.code === UNIQUE_VIOLATION && attempt === 0) continue
    if (error?.code === '23514') return { ok: false, reason: 'too_many_open' }
    if (error?.code === UNIQUE_VIOLATION) return { ok: false, reason: 'duplicate_trx' }
    return { ok: false, reason: 'failed' }
  }

  return { ok: false, reason: 'failed' }
}

/**
 * The Postgres code a CHECK constraint or a trigger raising with it answers.
 *
 * Local, for the reason `CHECK_VIOLATION` in src/app/founder/actions.ts is local: this
 * file's one reader of it is the already-decided arm below, which is about a claim's
 * state rather than about idempotency — see UNIQUE_VIOLATION, which is not the same
 * question.
 */
const CHECK_VIOLATION = '23514'

/**
 * The two decisions, as PostgREST sees them, cast the way `settleDay` casts its own.
 *
 * `src/lib/supabase/types.ts` is older than migration 84, so neither function is in
 * `Database['public']['Functions']` yet and the cast is what stands in for it. The next
 * `npm run gen:types` produces both entries and this becomes a no-op.
 *
 * BOUND, NOT DETACHED — see settleDay for the longer story. `rpc` is a prototype method
 * that reads `this.rest`, so pulling it off the client and calling it free set `this` to
 * undefined and threw on the call; the arrow below keeps the narrow cast and keeps `this`.
 */
type DecideRpc = (
  fn: 'approve_recharge_claim' | 'reject_recharge_claim',
  args: Record<string, unknown>,
) => PromiseLike<{ data: Json | null; error: { code?: string; message: string } | null }>

/** The bound, cast wrapper every RPC call in this module goes through. */
function decideRpc(
  supabase: SupabaseClient<Database>,
): DecideRpc {
  return (fn, args) =>
    supabase.rpc(fn, args as never) as unknown as ReturnType<DecideRpc>
}

/** A number off the wire, or null for anything that is not one. */
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** One claim waiting for a human, with the size it was quoted at. */
export type FounderClaim = {
  id: string
  centerId: string
  referenceCode: string
  quotedPoisha: number
  quotedBonusPoisha: number
  /**
   * The counts the quote was priced from, or null.
   *
   * All three or none, by `recharge_claims_usage_pair`: a half-read trio would describe a
   * size nobody quoted, and a founder reading "180 students" beside "no teachers" would
   * have to work out which half to believe.
   */
  usage: { students: number; teachers: number; branches: number } | null
  trxId: string
  senderMsisdn: string | null
  submittedAt: string
}

/** How many waiting claims a founder's queue draws. A queue, not an archive. */
const QUEUE_LIMIT = 50

/**
 * Every claim waiting for a human, oldest first.
 *
 * THE ONE READ IN THE PRODUCT THAT SPANS CENTRES ON PURPOSE, and it is not a hole: the
 * policy `recharge_claims_owner_read` (20260811000084) answers `app.is_platform_admin()`
 * as well as an owner, so this is the founder reading their own queue through their own
 * session. It carries no `coaching_center_id` filter because a queue with one centre in
 * it is not a queue, and there is no centre to scope it to — the panel is every centre by
 * definition, exactly as `platform_centers()` and the open purchases are.
 *
 * OLDEST FIRST, because a claim is somebody's money already sent, and the one that has
 * been waiting longest is the one to check first. `recharge_claims_queue_idx` is a partial
 * index on exactly this order, so the read is the index.
 *
 * NULL IS THE FAILED READ AND `[]` THE HONEST EMPTY ONE, the distinction every screen here
 * draws: `queueEmpty` says nothing is waiting, and a queue that could not be read must
 * never say that. The card draws `queueUnreadable` instead.
 */
export async function founderQueue(
  supabase: SupabaseClient<Database>,
): Promise<FounderClaim[] | null> {
  const { data, error } = await supabase
    .from('recharge_claims')
    // scoped-by: every centre is the point — see the note above; recharge_claims_owner_read
    // answers app.is_platform_admin() in 20260811000084.
    .select(
      'id, coaching_center_id, reference_code, quoted_poisha, quoted_bonus_poisha, usage_students, usage_teachers, usage_branches, trx_id, sender_msisdn, submitted_at',
    )
    .eq('state', 'submitted')
    .order('submitted_at', { ascending: true })
    .limit(QUEUE_LIMIT)

  if (error || !data) return null

  return data.map((row) => ({
    id: row.id,
    centerId: row.coaching_center_id,
    referenceCode: row.reference_code,
    quotedPoisha: Number(row.quoted_poisha),
    quotedBonusPoisha: Number(row.quoted_bonus_poisha),
    usage:
      row.usage_students === null
      || row.usage_teachers === null
      || row.usage_branches === null
        ? null
        : {
            students: row.usage_students,
            teachers: row.usage_teachers,
            branches: row.usage_branches,
          },
    trxId: row.trx_id,
    senderMsisdn: row.sender_msisdn,
    submittedAt: row.submitted_at,
  }))
}

/**
 * What an approval did, or why it did not.
 *
 * `duplicate` IS THE ONE A FOUNDER MUST NOT PAPER OVER by trying again — the anti-replay
 * fence refusing a transaction ID that has already been credited to another claim (§11.9,
 * §11.7). `closed` is a claim somebody else decided while this form was open, which is a
 * race rather than an error and clears itself when the page re-renders. Everything else is
 * a real fault.
 */
export type ApprovalOutcome =
  | { ok: true; arrivedPoisha: number; bonusPoisha: number }
  | { ok: false; reason: 'duplicate' | 'closed' | 'failed' }

/**
 * Credit a claim — the only call in the product that moves money into a balance.
 *
 * THE CALLER'S OWN SESSION, which is the opposite choice from `fileRechargeClaim` and
 * deliberate: `approve_recharge_claim` checks `app.is_platform_admin()` inside itself and
 * writes `auth.uid()` into the claim's `reviewed_by` and the payment's `recorded_by`.
 * Approving with the admin key would credit the same money and leave nobody's name on it —
 * and §11.9's whole point is that a human checked their own bKash account, so the record of
 * *which* human is the part worth keeping.
 *
 * THE AMOUNT IS WHAT ACTUALLY ARRIVED, and null means "what they said they sent" — the
 * figure the screen showed them. §11.9 lets a founder override it because customers send
 * the wrong figure constantly; either way the bonus is re-derived inside the function from
 * the amount that arrived, so nothing here decides a gift.
 *
 * A BAD `arrivedPoisha` IS A `failed` AND NOT AN EXCEPTION. The RPC raises `22023` for a
 * credit of nothing, and the caller has already refused that in words; reaching here with
 * one is a bug in the caller rather than something a founder typed.
 */
export async function approveClaim(
  supabase: SupabaseClient<Database>,
  input: { claimId: string; arrivedPoisha: number | null; note: string | null },
): Promise<ApprovalOutcome> {
  const { data, error } = await decideRpc(supabase)('approve_recharge_claim', {
    p_claim: input.claimId,
    p_arrived_poisha: input.arrivedPoisha,
    p_note: input.note,
  })

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: 'duplicate' }
    if (error.code === CHECK_VIOLATION) return { ok: false, reason: 'closed' }
    return { ok: false, reason: 'failed' }
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'failed' }
  }

  const out = data as Record<string, unknown>
  const arrived = numberOrNull(out.arrivedPoisha)
  const bonus = numberOrNull(out.bonusPoisha)

  // Both are `not null` on the function's return, so a missing one is the wire disagreeing
  // with the database — and the sentence the founder is about to read is built from them,
  // so a guess here would be a made-up figure about somebody's money.
  if (arrived === null || bonus === null) return { ok: false, reason: 'failed' }

  return { ok: true, arrivedPoisha: arrived, bonusPoisha: bonus }
}

/**
 * Close a claim that will not be credited.
 *
 * A REASON FROM THE SHORT LIST, re-checked here because the `<select>` is only a
 * suggestion and a Server Action is a public endpoint. `app.guard_recharge_claim` and the
 * column check refuse anything else as well; what this buys is the founder reading
 * `queueFailed` instead of a constraint name.
 *
 * NOTHING IS CREDITED, DELETED OR RE-TIMED. The row stays with its reason, which is what
 * lets the customer's own card say what happened instead of going blank — and why there is
 * one boolean here rather than an outcome type: there is exactly one sentence this screen
 * can say about a rejection that did not happen, and `queueFailed` is it.
 */
export async function rejectClaim(
  supabase: SupabaseClient<Database>,
  input: { claimId: string; reason: RejectReason; note: string | null },
): Promise<boolean> {
  const { error } = await decideRpc(supabase)('reject_recharge_claim', {
    p_claim: input.claimId,
    p_reason: input.reason,
    p_note: input.note,
  })

  return !error
}
