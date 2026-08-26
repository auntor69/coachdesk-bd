/**
 * How much of a bill may be handed back, and why a refund is refused.
 *
 * WHY THIS EXISTS. lib/fees/void.ts refuses to cancel a bill that has money on it and
 * sends the owner here: refund it first, then cancel. Until now there was nowhere to
 * go. `fee_payments` has allowed a negative row since migration 1 — `check (amount_bdt
 * <> 0)`, and every total in the product nets rather than counts — so the schema was
 * ready and the screen was not, which left the owner of a student who paid ৳500 and
 * then left with a bill they could neither collect nor cancel.
 *
 * A REFUND IS A ROW, NOT AN EDIT. Nothing deletes a payment and nothing rewrites one
 * (20260811000017 revokes both, and its trigger refuses even the migration role a new
 * receipt number). Money handed back is a second entry with a negative amount and its
 * own receipt, so the register still adds up to the cash in the drawer and a parent
 * holding the first slip can be shown the second.
 *
 * THE FLOOR IS WHAT CAME IN. A bill cannot be refunded past zero: the netted sum of
 * every payment against it must stay at or above nothing. Below that, the centre has
 * handed back money it never took, the family shows as owing more than they were
 * billed, and no screen in the product can explain the figure. It is also
 * unrecoverable in the direction that matters — a refund cannot be deleted — so the
 * check has to happen before the row lands, in all three places that can stop it.
 *
 * THE SAME RULE DECIDES THE FORM AND THE WRITE. The panel asks it to know whether to
 * draw the control and what to say when it will not work; the Server Action asks it
 * again because a Server Action is a public HTTP endpoint and a missing button is not
 * a check; app.guard_payment_floor() asks it a third time, in the only place that
 * cannot be talked out of it. All three read this module.
 *
 * Relative imports with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */

/**
 * Why money can or cannot be handed back.
 *
 * Five answers rather than a boolean, because each refusal is a different sentence the
 * owner needs. `unreadable` is a typo in the box. `zero` is an empty or nonsense
 * figure. `nothing` means the bill never took any money, so there is nothing to give
 * back and the owner is on the wrong row. `tooMuch` means they typed more than the
 * bill holds — the one that catches a slipped digit on the way out of the drawer.
 */
export type RefundVerdict = 'ok' | 'unreadable' | 'zero' | 'nothing' | 'tooMuch'

/** Taka to whole poisha, the way lib/money does it. */
function poisha(taka: number): number {
  return Math.round(taka * 100)
}

/**
 * Whether this much may be handed back from this bill.
 *
 * `received` is fee_invoice_balances.paid_bdt through `Number()`: the netted sum of
 * every payment on the invoice, refunds already subtracted. So a bill that took ৳2,000
 * and gave ৳500 back can be refunded another ৳1,500 and no more, without this having
 * to know how many rows that took.
 *
 * `amount` is the positive figure the owner typed for what they are handing over. A
 * negative one is not a small refund, it is a payment, and it has its own form — so it
 * is refused here rather than quietly flipped.
 *
 * Compared in poisha rather than taka. Both sides are floats by the time they reach
 * this process (see lib/money's header), and 1500.10 is held as 1500.0999…, so a
 * legitimate refund of exactly what came in can read as a hair too much and be
 * refused. Rounding both to whole poisha first is the same arithmetic Postgres will do
 * to the stored numeric(10, 2).
 */
export function refundVerdict({
  received,
  amount,
}: {
  received: number
  amount: number
}): RefundVerdict {
  if (!Number.isFinite(amount)) return 'unreadable'
  if (poisha(amount) <= 0) return 'zero'

  // A bill whose payments could not be added up is not a bill known to hold money,
  // and the same reading as cancelVerdict's: when the figure is unreadable, refuse.
  if (!Number.isFinite(received) || poisha(received) <= 0) return 'nothing'

  if (poisha(amount) > poisha(received)) return 'tooMuch'
  return 'ok'
}

/**
 * What is left to hand back on a bill, for the sentence above the box.
 *
 * Never negative, and never NaN: this figure is rendered, and a ceiling of "-৳200" or
 * "৳NaN" on a money form is worse than no ceiling at all.
 */
export function refundable(received: number): number {
  if (!Number.isFinite(received) || received <= 0) return 0
  return poisha(received) / 100
}
