import 'server-only'

/**
 * The manual provider: money arrives by transfer, and a human confirms it.
 *
 * MASTERPLAN §11.3 — "not a mock. It is a real provider whose verification step is a
 * human being, and it must satisfy the same interface so that switching to the API
 * changes one file." So all three functions do real work:
 *
 * - `createPayment` records that the customer has been sent to pay and hands back what
 *   to do. There is no redirect because there is no gateway; there is an amount the
 *   server computed and a reference to quote.
 * - `verifyPayment` asks the provider what happened to a reference. Here the provider's
 *   records ARE our records — the founder's confirmation is the source of truth, and it
 *   lives in `payment_intents` — so this reads the table rather than an API. That is not
 *   a shortcut; it is what "the verification step is a human being" means.
 * - `handleCallback` is the founder's Confirm. Its payload is the form's fields instead
 *   of a webhook body, it is untrusted the same way, and it settles through
 *   `settle_payment_intent` — the only door that writes a receipt and raises a ceiling
 *   together.
 *
 * NOTHING HERE DECIDES AN AMOUNT (§11.4). The intent owns it, this file reads it, and
 * `settle_payment_intent` charges what the row says regardless of what a payload
 * claims — a `handleCallback` that accepted an amount is exactly the hole the intents
 * table exists to close.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { normalizeBdMobile } from '@/lib/bd/phone'
import { PAYMENT_METHODS } from '@/lib/fees/methods'
import { MAX_LABEL, MAX_TEXT, clamp } from '@/lib/limits'
import type { Database, PaymentMethod } from '@/lib/supabase/types'
import type {
  CallbackOutcome,
  PayableIntent,
  PaymentInstruction,
  PaymentProviderImpl,
  PaymentVerdict,
} from './provider'
// The code the customer quotes, from the pure module three screens and a printable share.
import { transferReference } from './receipt'

const METHODS = new Set<PaymentMethod>(PAYMENT_METHODS)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Where to send the money, or null. One line of config, never a constant (§11.1). */
function salesContact(): string | null {
  return normalizeBdMobile(process.env.NEXT_PUBLIC_SALES_PHONE ?? '')
}

async function createPayment(
  supabase: SupabaseClient<Database>,
  intent: PayableIntent,
): Promise<PaymentInstruction> {
  if (intent.state !== 'pending' && intent.state !== 'initiated') {
    return { kind: 'blocked', reason: `this purchase is ${intent.state}` }
  }
  // Checked here as well as at settle time, so a customer is not sent to pay against a
  // quote that cannot be honoured when they come back with the reference.
  if (Date.parse(intent.expires_at) <= Date.now()) {
    return { kind: 'blocked', reason: 'this quote has expired' }
  }

  // Already initiated is not an error: a refreshed page, or a customer returning to
  // instructions they closed. The transition happens once and the instruction is the
  // same either way.
  if (intent.state === 'pending') {
    // scoped-by: coaching_center_id is filtered below alongside the id, so a caller
    // holding a service-role client still cannot initiate another centre's intent.
    const { error } = await supabase
      .from('payment_intents')
      .update({ state: 'initiated' })
      .eq('id', intent.id)
      .eq('coaching_center_id', intent.coaching_center_id)
      .eq('state', 'pending')

    if (error) return { kind: 'blocked', reason: 'could not open this purchase' }
  }

  return {
    kind: 'transfer',
    reference: transferReference(intent.id),
    amountBdt: Number(intent.amount_bdt),
    contact: salesContact(),
  }
}

/**
 * What the provider says about one reference.
 *
 * Scoped to the centre, because `provider_ref` is unique per centre and not globally:
 * two centres quoting the same TrxID is a support case, not a lookup that may pick
 * whichever row it finds first.
 */
async function verifyPayment(
  supabase: SupabaseClient<Database>,
  centerId: string,
  providerRef: string,
): Promise<PaymentVerdict> {
  const ref = providerRef.trim()
  if (!ref) {
    return {
      outcome: 'unknown',
      providerRef: null,
      intentId: null,
      intentState: null,
      reason: 'no reference',
    }
  }

  const { data } = await supabase
    .from('payment_intents')
    .select('id, state')
    .eq('coaching_center_id', centerId)
    .eq('provider', 'manual')
    .eq('provider_ref', ref)
    .maybeSingle()

  if (!data) {
    return {
      outcome: 'unknown',
      providerRef: ref,
      intentId: null,
      intentState: null,
      reason: 'no purchase carries this reference',
    }
  }

  const verdict: PaymentVerdict = {
    outcome: 'pending',
    providerRef: ref,
    intentId: data.id,
    intentState: data.state,
    reason: null,
  }

  switch (data.state) {
    case 'successful':
      return { ...verdict, outcome: 'successful' }
    case 'pending':
    case 'initiated':
      return { ...verdict, reason: 'waiting for a human to confirm the transfer' }
    default:
      // failed, cancelled, expired and refunded. The state is the reason: a refunded
      // payment did arrive and is no longer money we hold, and a caller reading
      // `intentState` can say which of those it is.
      return { ...verdict, outcome: 'failed', reason: data.state }
  }
}

/**
 * The founder confirming a transfer they can see in their own app.
 *
 * Everything that could be a lie is re-derived: the amount comes off the intent, the
 * capacity it grants comes off the intent, and whether this intent may settle at all is
 * the state machine's answer rather than this function's. What the payload genuinely
 * contributes is the provider's reference — the TrxID — which is the one fact only the
 * person looking at their phone has.
 */
async function handleCallback(
  supabase: SupabaseClient<Database>,
  payload: unknown,
): Promise<CallbackOutcome> {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, reason: 'bad_payload', detail: 'not an object' }
  }

  const body = payload as Record<string, unknown>

  const intentId = typeof body.intentId === 'string' ? body.intentId.trim() : ''
  if (!UUID.test(intentId)) {
    return { ok: false, reason: 'bad_payload', detail: 'no intent id' }
  }

  const providerRef = clamp(
    typeof body.providerRef === 'string' ? body.providerRef : '',
    MAX_LABEL,
  )
  if (!providerRef) {
    return { ok: false, reason: 'bad_payload', detail: 'no reference' }
  }

  const method =
    typeof body.method === 'string' && METHODS.has(body.method as PaymentMethod)
      ? (body.method as PaymentMethod)
      : 'bkash'

  const confirmedBy =
    typeof body.confirmedBy === 'string' && UUID.test(body.confirmedBy)
      ? body.confirmedBy
      : null

  const note = clamp(typeof body.note === 'string' ? body.note : '', MAX_TEXT)

  const { data, error } = await supabase.rpc('settle_payment_intent', {
    p_intent: intentId,
    p_provider_ref: providerRef,
    p_method: method,
    p_settled_by: confirmedBy,
    p_note: note || null,
  })

  // Every refusal in 20260811000057 raises 42501, including the read-back that rolls a
  // settlement over a plan-granted ceiling. The message is for a log; a screen shows
  // its own sentence.
  if (error) return { ok: false, reason: 'refused', detail: error.message }

  const settled = data?.[0]
  if (!settled) return { ok: false, reason: 'refused', detail: 'nothing settled' }

  return {
    ok: true,
    intentId: settled.intent_id,
    paymentId: settled.payment_id,
    chargedBdt: Number(settled.charged_bdt),
    already: settled.already,
  }
}

export const manualProvider: PaymentProviderImpl = {
  id: 'manual',
  createPayment,
  verifyPayment,
  handleCallback,
}
