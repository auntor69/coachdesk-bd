/**
 * What a receipt for money the centre paid *us* says.
 *
 * THE ONE SHEET WHERE WE ARE THE ISSUER. The fee receipt, the refund slip, the payslip and
 * the expense voucher all come off the centre's letterhead because the centre issues them.
 * Here the customer is the coaching centre and the seller is CoachDesk, so the header
 * inverts and the centre becomes the billed-to block. §9.9's last missing printable.
 *
 * IT LIVES HERE AND NOT IN THE PAGE for ../expenses/voucher.ts's reason: what goes onto a
 * sheet somebody files against a bank statement should be run against fixtures. The page
 * renders; this file decides.
 *
 * WHAT IT MOSTLY DECIDES IS WHICH NUMBER THE SHEET IS CALLED BY, because `payments` has
 * none. Only `fee_payments` got a gapless counter (20260811000017); the platform-billing
 * table has an id, an optional `reference` and an optional `intent_id`, and no series. So
 * the number is chosen rather than read:
 *
 *   - a purchase code, `transferReference(intent_id)`, whenever there is an intent. This is
 *     the code the owner was shown on /settings/plan and quoted in the bKash reference when
 *     they sent the money, and it is what the founder panel lists open purchases by — so
 *     the paper closes the loop it opened rather than opening a second one.
 *   - failing that the provider's own `reference`, the TrxID, which is the only identifier
 *     both sides already hold.
 *   - failing both, no number at all. A `CD-` code minted off the payment id would look
 *     searchable to the founder and match nothing; the date and the amount are then what
 *     identifies the row, and the sheet says so instead of inventing a series.
 *
 * AND WHICH NOTE IS FIT TO PRINT. `settle_payment_intent` writes `payments.note` itself as
 * `purpose::text || ' x' || quantity` — `student_capacity x40`, a column name and a
 * multiplication sign — because it is a fallback description for the founder's own list, not
 * a sentence. When the intent is there the sheet has the enum and the quantity and can say it
 * in the reader's language, so that string is dropped. A note somebody typed by hand is kept.
 *
 * WHAT IT DELIBERATELY DOES NOT COMPUTE is the rate the places were sold at. §3.8 wants
 * "which band(s) priced them, at what rate" on the record, and recomputing it here would be
 * wrong twice over: `student_capacity` has already risen by the time this sheet is printed,
 * so `capacityBands` would price the *next* purchase, and a per-place average matches no
 * published band whenever a purchase straddles two. The rate applied is not stored on
 * `payment_intents` — that is a gap in the schema, recorded as one, and not something paper
 * should paper over.
 *
 * Pure, and importable by `node --test`: nothing here reaches a database. Relative imports
 * with the extension, like every other unit-tested module.
 */

import type { PaymentMethod, PaymentPurpose } from '../supabase/types.ts'

/**
 * Every purpose a platform payment can have, in the order 20260811000057 declares them.
 *
 * Here rather than beside the price list because this is the file that has to name one on
 * paper. `as const satisfies` catches a value that is not a purpose; `ALL_PURPOSES_LISTED`
 * below catches the other direction, the way ../fees/methods.ts does for wallets — a
 * migration that adds a fifth purpose fails `tsc` here, one line from the list to extend
 * and one file from the dictionary that must gain a label for it.
 */
export const PAYMENT_PURPOSES = [
  'subscription',
  'student_capacity',
  'teacher_seat',
  'branch',
] as const satisfies readonly PaymentPurpose[]

/** Whatever the list above left out. `never` while it is complete. */
type Unlisted = Exclude<PaymentPurpose, (typeof PAYMENT_PURPOSES)[number]>

/** Nothing at runtime, and a compile error the moment `Unlisted` stops being `never`. */
export const ALL_PURPOSES_LISTED: Unlisted extends never ? true : Unlisted = true

/**
 * What the customer quotes when they tell us they have paid.
 *
 * The intent's own id, shortened. Not a counter: a sequence would need a table and a lock,
 * and this only has to be unique enough for a founder to find one row among the handful open
 * at once — the full uuid is what actually settles it.
 *
 * It lives in this file rather than in the manual provider that mints it because three
 * screens read it and one of them is a printable. `manual.ts` is `server-only`, so a sheet
 * or a test importing it from there would either drag a request-scoped module onto a page
 * that has no business with the provider, or be untestable outside one.
 */
export function transferReference(intentId: string): string {
  return `CD-${intentId.slice(0, 8).toUpperCase()}`
}

/** The intent behind a payment, as embedded. Null where a founder recorded money directly. */
export type ReceiptIntentRow = {
  purpose: PaymentPurpose
  quantity: number
  grants_capacity: number
  branch_id: string | null
} | null

/**
 * A `payments` row as read, with its intent embedded.
 *
 * `payments_intent_fkey` is composite and generated as `isOneToOne: false`, so postgrest-js
 * may hand back either shape and the house style unwraps both. Widened to `string` on the
 * amount as well: `numeric` arrives as a string down some paths.
 */
export type ReceiptPaymentRow = {
  intent_id: string | null
  amount_bdt: number | string
  method: PaymentMethod
  reference: string | null
  covers_period_start: string | null
  covers_period_end: string | null
  note: string | null
  paid_at: string
  payment_intents?: ReceiptIntentRow | ReceiptIntentRow[]
}

/** Which of the two real identifiers the sheet is headed by. Labelled differently for each. */
export type ReceiptNumber = { kind: 'purchase' | 'transfer'; value: string }

export type PurchaseReceipt = {
  /** Null when the row carries neither an intent nor a provider reference. */
  number: ReceiptNumber | null
  /** `paid_at` as stored — a timestamptz, so the page must put it through `todayInDhaka`. */
  paidAt: string
  amount: number
  method: PaymentMethod
  /** The provider's TrxID, and only when it is not already the number above. */
  reference: string | null
  /** A note worth printing, or null. See the header on the machine-written one. */
  note: string | null
  /** Null where there is no intent: the sheet then names no purpose rather than guessing. */
  purpose: PaymentPurpose | null
  /** Months, places, seats or branches, by purpose. Zero when there is no intent. */
  quantity: number
  /** Places this purchase added to the ceiling. Zero on every other purpose, by check. */
  placesAdded: number
  branchId: string | null
  /** Both ends or neither: half a period is not a period. */
  coverage: { from: string; to: string } | null
}

/** The embed, either shape, or null. */
function intentOf(row: ReceiptPaymentRow): ReceiptIntentRow {
  const embedded = row.payment_intents
  if (Array.isArray(embedded)) return embedded[0] ?? null
  return embedded ?? null
}

/** What `settle_payment_intent` writes when nobody typed anything. */
function isMachineNote(note: string, intent: NonNullable<ReceiptIntentRow>): boolean {
  return note.trim() === `${intent.purpose} x${intent.quantity}`
}

export function purchaseReceipt(row: ReceiptPaymentRow): PurchaseReceipt {
  const intent = intentOf(row)
  const reference = row.reference?.trim() || null

  // The purchase code wins where there is one, and then the TrxID is still worth printing
  // underneath: one is what we called the sale, the other is what the bank called it, and
  // somebody reconciling a statement needs the second.
  const number: ReceiptNumber | null =
    row.intent_id !== null
      ? { kind: 'purchase', value: transferReference(row.intent_id) }
      : reference !== null
        ? { kind: 'transfer', value: reference }
        : null

  const note = row.note?.trim() || null

  return {
    number,
    paidAt: row.paid_at,
    amount: Number(row.amount_bdt),
    method: row.method,
    // Suppressed only when it is already the heading, never merged into it.
    reference: number?.kind === 'transfer' ? null : reference,
    note: note !== null && intent !== null && isMachineNote(note, intent) ? null : note,
    purpose: intent?.purpose ?? null,
    quantity: intent?.quantity ?? 0,
    placesAdded: intent?.grants_capacity ?? 0,
    branchId: intent?.branch_id ?? null,
    coverage:
      row.covers_period_start !== null && row.covers_period_end !== null
        ? { from: row.covers_period_start, to: row.covers_period_end }
        : null,
  }
}
