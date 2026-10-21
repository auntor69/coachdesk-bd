import 'server-only'

/**
 * One interface, several implementations — MASTERPLAN §11.3.
 *
 * ```
 * createPayment(intent)   -> a redirect or an instruction for the customer
 * verifyPayment(ref)      -> the provider's own answer, fetched by us
 * handleCallback(payload) -> verified, then reconciled against the intent
 * ```
 *
 * `manual` is the only implementation and it is not a mock: the founder confirms a
 * transfer they can see in their own app, which is how the first fifty customers pay.
 * Its verification step is a human being. bKash is deliberately absent (§11.1) — a
 * guessed request body is a rewrite, not a head start — and `paymentProvider` throws
 * for it rather than pretending, so the day credentials exist the change is one new
 * module and one line here.
 *
 * WHAT THIS LAYER IS NOT. None of these three functions is an authorization gate. Each
 * takes the client its caller already built, and a caller holding a service-role client
 * has already passed `requirePlatformAdmin()`; a caller holding a session client is
 * refused by RLS and the revoked grants in 20260811000057. Putting the gate here would
 * mean two places to check and one of them eventually not checking.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  Database,
  PaymentIntentState,
  PaymentProvider,
} from '@/lib/supabase/types'
import { manualProvider } from './manual'

type IntentRow = Database['public']['Tables']['payment_intents']['Row']

/**
 * The columns a provider is allowed to see.
 *
 * Narrow on purpose: `settled_by` and `requested_by` are §10's audit trail and none of
 * a provider's business, and a `Pick` off the generated row means a column renamed in
 * a migration breaks the build here rather than at runtime.
 */
export type PayableIntent = Pick<
  IntentRow,
  | 'id'
  | 'coaching_center_id'
  | 'purpose'
  | 'quantity'
  | 'amount_bdt'
  | 'provider'
  | 'provider_ref'
  | 'state'
  | 'expires_at'
>

/**
 * What the customer is shown next.
 *
 * `transfer` carries no account number of its own. Where the money goes is one line of
 * deployment config and never a constant in this repo — a personal wallet compiled into
 * the source is the mechanism §11.1 forbids, and a screen that renders one from an
 * empty variable would tell a paying customer to send money to nowhere.
 */
export type PaymentInstruction =
  | { kind: 'redirect'; url: string; reference: string }
  | { kind: 'transfer'; reference: string; amountBdt: number; contact: string | null }
  | { kind: 'blocked'; reason: string }

/**
 * The provider's answer about one reference, flat so a caller can be as precise as it
 * needs to be.
 *
 * `unknown` is not `failed`. A reference nobody has recorded is a customer who has not
 * paid yet, or a typo in a TrxID; a failed one is money that did not arrive. Collapsing
 * them would have the founder telling the first customer their payment bounced.
 */
export type PaymentVerdict = {
  outcome: 'successful' | 'pending' | 'failed' | 'unknown'
  providerRef: string | null
  intentId: string | null
  intentState: PaymentIntentState | null
  reason: string | null
}

/**
 * What reconciliation produced.
 *
 * `already: true` is a success. A webhook delivered twice, or a founder tapping Confirm
 * on a slow connection, reads back the first answer rather than erroring — §11.2's own
 * rule, and what makes the retry safe.
 */
export type CallbackOutcome =
  | {
      ok: true
      intentId: string
      paymentId: string
      chargedBdt: number
      already: boolean
    }
  | { ok: false; reason: 'bad_payload' | 'refused'; detail: string | null }

export type PaymentProviderImpl = {
  id: PaymentProvider

  /** Records that the customer has been sent to pay, and says where they are going. */
  createPayment(
    supabase: SupabaseClient<Database>,
    intent: PayableIntent,
  ): Promise<PaymentInstruction>

  /** Asks the provider what happened to a reference. Never asks the browser. */
  verifyPayment(
    supabase: SupabaseClient<Database>,
    centerId: string,
    providerRef: string,
  ): Promise<PaymentVerdict>

  /**
   * Takes an untrusted payload and, if it verifies, settles the intent behind it.
   *
   * `unknown` rather than a shape: a callback body is the least trustworthy input in
   * the product, and a typed parameter here would be a promise the sender never made.
   */
  handleCallback(
    supabase: SupabaseClient<Database>,
    payload: unknown,
  ): Promise<CallbackOutcome>
}

/**
 * The implementation for one provider.
 *
 * Throws for `bkash`, and that is the honest answer: the enum has the value because a
 * column needs somewhere to grow into, and there is no module behind it. A provider
 * with no implementation is a deployment mistake, not a customer-facing state, so it
 * fails loudly here instead of returning a `blocked` instruction that would render as
 * "try again later" forever.
 */
export function paymentProvider(id: PaymentProvider): PaymentProviderImpl {
  if (id === 'manual') return manualProvider
  throw new Error(
    `payment provider '${id}' is not implemented — see MASTERPLAN.md 11.1 before adding one`,
  )
}
