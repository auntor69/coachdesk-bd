import 'server-only'

/**
 * Opening a purchase, which is the only way an amount enters the system.
 *
 * MASTERPLAN §11.2: "Every purchase creates a payment intent on the server before the
 * customer is sent anywhere. The intent owns the amount. The browser never does." The
 * schema holds the second half of that — `authenticated` has no INSERT on
 * `payment_intents` at all — so this runs on a service-role client, and the caller is
 * responsible for having gated the request before it gets here.
 *
 * The amount is not a parameter. A `Quote` from ./price.ts is, and every figure in one
 * is derived from columns rather than from a form. That is the difference between "the
 * server checks the price" and "the server decides the price": there is nowhere in this
 * signature to put a wrong one.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { UNIQUE_VIOLATION, readIdempotencyKey } from '@/lib/idempotency'
import type { Database, PaymentProvider } from '@/lib/supabase/types'
import type { PayableIntent } from './provider'
import { pricedLines, type Quote } from './price'

/** Exactly `PayableIntent`, so a column added to that type fails to compile here. */
const INTENT_COLUMNS =
  'id, coaching_center_id, purpose, quantity, amount_bdt, provider, provider_ref, state, expires_at'

/**
 * The same list plus the tier, for the read-back that decides whether a reused request
 * key describes the same purchase.
 *
 * IT HAS TO BE COMPARED, and this is the one place it is not obvious why: at 400 students
 * on one branch, Centre and Institution bill the identical ৳7,300 a month — the student
 * bands clear both floors and the first three branches are free — so purpose, quantity and
 * amount cannot tell the two purchases apart. Without the tier here, a key reused across
 * them would hand back the wrong one, and it would be the cheaper tier's intent settling
 * onto the dearer tier's row.
 *
 * Built from `INTENT_COLUMNS` rather than typed out again, so the two lists cannot drift.
 * Not on `PayableIntent`: a provider is told what to charge, not what it buys.
 */
const REPLAY_COLUMNS = `${INTENT_COLUMNS}, target_plan` as const

export type OpenIntentInput = {
  centerId: string
  quote: Quote
  /** The user whose request this is. §10 wants a name on every capacity purchase. */
  requestedBy: string
  /**
   * Which branch asked, for §3.8's receipt. It does NOT scope what was bought: places
   * pool at the organisation (§3.6) and per-branch quotas are forbidden (§17).
   */
  branchId?: string | null
  /** The form's own uuid, so a double tap opens one purchase. */
  idempotencyKey?: unknown
  provider?: PaymentProvider
}

export type OpenIntentResult =
  | { ok: true; intent: PayableIntent; reused: boolean }
  | { ok: false; reason: 'nothing_to_buy' | 'failed' }

/**
 * Opens one, or hands back the one this request already opened.
 *
 * A zero quote is `nothing_to_buy` rather than a database error: a top-up dialog on a
 * centre that still has room, a paste that fits, a second branch on the tier that
 * includes three. All four are ordinary and none of them is a purchase.
 */
export async function openIntent(
  supabase: SupabaseClient<Database>,
  input: OpenIntentInput,
): Promise<OpenIntentResult> {
  const { quote } = input
  if (quote.quantity <= 0 || quote.amountBdt <= 0) {
    return { ok: false, reason: 'nothing_to_buy' }
  }

  const key = readIdempotencyKey(input.idempotencyKey)

  // scoped-by: coaching_center_id is written on the row below, and the composite key on
  // (branch_id, coaching_center_id) refuses a branch belonging to anyone else.
  const { data, error } = await supabase
    .from('payment_intents')
    .insert({
      coaching_center_id: input.centerId,
      purpose: quote.purpose,
      quantity: quote.quantity,
      amount_bdt: quote.amountBdt,
      // §3.8's "rate applied". Required by the column and so by the generated `Insert`
      // type, because it is the one field of the record that cannot be worked out again
      // once `settle_payment_intent` has raised the ceiling it was priced from.
      priced_lines: pricedLines(quote.lines),
      grants_capacity: quote.grantsCapacity,
      // Null for every renewal, and only ever a paid tier: the column's own checks refuse
      // anything else, and ./price.ts refuses to quote a tier it did not price.
      target_plan: quote.targetPlan,
      covers_period_start: quote.coversPeriodStart,
      covers_period_end: quote.coversPeriodEnd,
      branch_id: input.branchId ?? null,
      provider: input.provider ?? 'manual',
      requested_by: input.requestedBy,
      idempotency_key: key,
    })
    .select(INTENT_COLUMNS)
    .single()

  if (!error && data) return { ok: true, intent: data, reused: false }

  // The one error that is not a failure, and the same read-back `recordCenterPayment`
  // does: the partial unique index refusing a second intent for one form. Guarded on
  // `key`, because without one that index cannot be what fired.
  if (!key || error?.code !== UNIQUE_VIOLATION) return { ok: false, reason: 'failed' }

  const { data: existing } = await supabase
    .from('payment_intents')
    .select(REPLAY_COLUMNS)
    .eq('coaching_center_id', input.centerId)
    .eq('idempotency_key', key)
    .maybeSingle()

  // A stored intent that disagrees on any of these means the key was reused for a
  // different purchase, which is not a purchase to hand back.
  if (
    !existing
    || existing.purpose !== quote.purpose
    || existing.quantity !== quote.quantity
    || Number(existing.amount_bdt) !== quote.amountBdt
    || existing.target_plan !== quote.targetPlan
  ) {
    return { ok: false, reason: 'failed' }
  }

  return { ok: true, intent: existing, reused: true }
}

/**
 * One intent, as a provider is allowed to see it.
 *
 * Scoped to the centre as well as the id, so an id from one card cannot be confirmed
 * against another customer's row. The column list is `INTENT_COLUMNS` rather than a
 * second copy, which is why this lives beside `openIntent` instead of in the caller.
 *
 * `grants_capacity` is deliberately not read: `payment_intents_grant_matches_purpose`
 * makes it `quantity` on a capacity purchase and 0 on everything else, so a caller that
 * has the purpose already knows it.
 */
export async function readIntent(
  supabase: SupabaseClient<Database>,
  centerId: string,
  intentId: string,
): Promise<PayableIntent | null> {
  // scoped-by: coaching_center_id is filtered below, beside the id.
  const { data } = await supabase
    .from('payment_intents')
    .select(INTENT_COLUMNS)
    .eq('id', intentId)
    .eq('coaching_center_id', centerId)
    .maybeSingle()

  return data ?? null
}
