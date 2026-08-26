/**
 * How much of a fee a centre may waive, and why that is a number on the bill rather
 * than a smaller bill.
 *
 * WHY THIS EXISTS. `fee_invoices.discount_bdt` has been in the schema since migration 1
 * with both its bounds as table checks, `fee_invoice_balances.net_bdt` is computed from
 * it, the board renders it under a student's name, the CSV export has a column for it
 * and lib/fees/month-close.ts nets it out of the month's billed figure. Until
 * 20260811000030 nothing in the product could set it, so an owner who waived a fee —
 * which a coaching centre does constantly, for a second child or a family having a bad
 * year — had two places to put it and both were wrong.
 *
 * THE TWO WRONG PLACES, because they are what this module is measured against. Raise the
 * bill at the discounted figure, and `amount_bdt` stops being the fee: the register no
 * longer says what the centre charges, and next month's generator bills the full amount
 * again with nobody remembering why last month was different. Or record a payment the
 * family never made — which is worse, because a fee payment cannot be deleted
 * (20260811000017) and since 20260811000029 cannot be netted back out beyond what really
 * came in. A ৳500 phantom payment is permanent and it stops the drawer reconciling.
 *
 * WHAT THE RULE ACTUALLY IS. A waiver is not negative, and it is not larger than the
 * bill — a waiver larger than the bill would mean the centre owes the family money for
 * attending. Both bounds are already `check` constraints on the table, so this module is
 * not the enforcement; it is the same rule said early enough to be a sentence the owner
 * can read instead of a constraint name.
 *
 * WHAT IS DELIBERATELY NOT BOUNDED: a waiver granted after the family has already paid.
 * ৳2,000 paid in full and then ৳500 waived leaves the bill at ৳1,500 net with ৳2,000 on
 * it, and the family is ৳500 in credit — which is true, is what the board should say,
 * and is what the refund path is for. Refusing it would refuse the most sympathetic case
 * there is: an owner who took the money and then heard what the year had been like.
 *
 * WHY THERE IS NO IDEMPOTENCY KEY ANYWHERE NEAR THIS. Recording a payment is an INSERT
 * and a replay writes a second row, which is why lib/idempotency.ts exists. A waiver is
 * a SET to an absolute figure, so the second arrival of the same request stores the same
 * number and the trigger's `is distinct from` does not even re-stamp who granted it. It
 * is idempotent by shape, which is exactly what `useOffline` replaying a Server Action
 * needs.
 *
 * THE SAME VERDICT DECIDES THE CONTROL AND THE WRITE, as in the void and refund rules
 * beside it. The board asks it to know what to draw; the Server Action asks it again
 * because a Server Action is a public HTTP endpoint and a missing button is not a check;
 * the table's own constraints and app.guard_invoice_void() answer a third time, in the
 * only place that cannot be talked out of it.
 *
 * Relative imports with the extension, like every other unit-tested module here: these
 * tests run under `node --test`, which resolves neither tsconfig paths nor extensionless
 * specifiers.
 */

/**
 * Why a fee can or cannot be waived by this much.
 *
 * `zero` is not in the list, and its absence is the point: setting a waiver to nothing is
 * how an owner takes one back, so it has to succeed. The trigger clears the reason, the
 * person and the date alongside it, because a bill at full price that still reads
 * "second child, half fee" is worse than one that says nothing at all.
 */
export type DiscountVerdict = 'ok' | 'unreadable' | 'negative' | 'tooMuch' | 'cancelled'

/** Taka to whole poisha, so two figures Postgres stored as numeric compare exactly. */
function poisha(taka: number): number {
  return Math.round(taka * 100)
}

/**
 * Whether this waiver may be written against this bill.
 *
 * `billed` is fee_invoice_balances.amount_bdt through `Number()` — what the centre
 * charges, before any waiver. Not `net_bdt`: netting the existing waiver out first would
 * make each edit measure against the last one, so raising a ৳500 waiver to ৳800 would be
 * read as ৳800 against a ৳1,500 remainder. The figure the owner types is the whole
 * waiver, replacing whatever was there.
 *
 * `cancelled` comes first because it is a fact about the bill rather than about the
 * number. Told "that is more than the fee", an owner would go and retype the number;
 * the thing to do is restore the bill.
 */
export function discountVerdict({
  billed,
  discount,
  voidedAt,
}: {
  billed: number
  discount: number
  voidedAt: string | null
}): DiscountVerdict {
  if (voidedAt) return 'cancelled'
  if (!Number.isFinite(discount)) return 'unreadable'
  if (poisha(discount) < 0) return 'negative'
  // An unreadable bill cannot bound anything, so it refuses rather than letting a
  // waiver through against a fee that could not be added up.
  if (!Number.isFinite(billed)) return 'unreadable'
  if (poisha(discount) > poisha(billed)) return 'tooMuch'
  return 'ok'
}

/**
 * The largest waiver this bill can carry: the whole fee.
 *
 * Exported so the screen can name the ceiling in the same sentence that asks for the
 * figure, rather than waiting for the owner to guess wrong and be corrected. Rounded
 * through poisha for the reason lib/money's header gives — the value arrives as a string
 * from PostgREST and a float sum of it is not a figure to print.
 */
export function maxDiscount(billed: number): number {
  if (!Number.isFinite(billed) || billed <= 0) return 0
  return poisha(billed) / 100
}

/**
 * What a waiver leaves the family owing, before anything they have already paid.
 *
 * Used only to show the consequence beside the input while the owner is still typing —
 * "৳২,০০০ এর বিল, ৳৫০০ ছাড়, বাকি ৳১,৫০০" — so the number they are about to store is one
 * they have already seen the effect of. The stored answer is Postgres's own `net_bdt`;
 * this never becomes a written figure, which is why computing it here does not break the
 * one-derived-answer rule in docs §4.
 */
export function netAfterDiscount(billed: number, discount: number): number {
  if (!Number.isFinite(billed) || !Number.isFinite(discount)) return 0
  const left = poisha(billed) - poisha(discount)
  return left <= 0 ? 0 : left / 100
}
