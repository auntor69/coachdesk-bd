/**
 * When a bill may be cancelled, and what a cancelled one looks like on the board.
 *
 * WHY THIS EXISTS. `fee_invoices.voided_at` has been in the schema since migration 1
 * and every read path in the product honours it — the board, the dashboard, the chase
 * worklist, /me, the student profile, the exports, the month-close report. Until
 * 20260811000028 nothing could set it, so a bill raised by mistake was permanent: a
 * student who left in June kept owing ৳2,000 in the headline figure on the screen the
 * product is sold on, and on the worklist telling the owner to message their parent.
 *
 * THE RULE IS ABOUT MONEY, and it is the whole of this module. A cancelled invoice
 * leaves the balances entirely, so cancelling one that has been paid would take a
 * family's payment off their own record while leaving it in the centre's takings —
 * the exact discrepancy an owner rings about, produced by the button meant to tidy
 * their books. So a bill with money on it cannot be cancelled. Refund it first, which
 * in this schema is a negative payment, and then it can be.
 *
 * Netted, not counted: a payment handed back in full leaves nothing on the bill, and
 * such a bill is as cancellable as one nobody ever paid. The sum arrives already
 * computed in numeric by fee_invoice_balances, so the comparison here is against a
 * figure Postgres decided — see lib/money's header for why that matters.
 *
 * THE SAME VERDICT DECIDES THE BUTTON AND THE WRITE. The board asks it to know
 * whether to draw the control; the Server Action asks it again to know whether to
 * honour the request, because a Server Action is a public HTTP endpoint and the
 * absence of a button is not a check. The database asks a third time in
 * app.guard_invoice_void(), which is the only one of the three that cannot be talked
 * out of it. All three read the same rule from here so they cannot drift apart.
 *
 * Relative imports with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */

/**
 * Why a bill can or cannot be cancelled.
 *
 * Three answers rather than a boolean, because the two refusals are different events.
 * `paid` is a rule the owner has to do something about. `already` is not a refusal at
 * all — it is the second arrival of a request that already succeeded, and the screen
 * must answer it with the same confirmation as the first, for the reason
 * lib/idempotency.ts gives at length: `useOffline` replays Server Actions when a phone
 * comes back on the network, so every write in this app has to survive being asked
 * twice.
 */
export type CancelVerdict = 'ok' | 'already' | 'paid'

/**
 * Whether this bill may be cancelled.
 *
 * `paid` is fee_invoice_balances.paid_bdt through `Number()` — the netted sum of every
 * payment against the invoice, refunds included. Non-zero in either direction refuses:
 * a positive sum is money the family handed over, and a negative one is money the
 * centre owes them back, and neither belongs on a bill that is about to stop existing.
 */
export function cancelVerdict({
  paid,
  voidedAt,
}: {
  paid: number
  voidedAt: string | null
}): CancelVerdict {
  if (voidedAt) return 'already'
  // NaN is not zero, so an unreadable figure refuses rather than cancelling a bill
  // whose payments could not be added up.
  if (paid !== 0) return 'paid'
  return 'ok'
}

/**
 * A row of fee_invoice_balances as the cancelled list needs it.
 *
 * Every column is nullable because Postgres cannot prove otherwise through a view.
 */
export type CancelledInvoiceRow = {
  id: string | null
  student_name: string | null
  student_code: string | null
  period_month: string | null
  net_bdt: number | string | null
  voided_at: string | null
  void_reason: string | null
}

/** One cancelled bill, as the board draws it. */
export type CancelledBill = {
  id: string
  name: string
  studentCode: string | null
  /** The month it was raised for, YYYY-MM-01. */
  periodMonth: string
  /** What it was for, after any discount — the figure that is no longer owed. */
  net: number
  /** The owner's own words, or null when they did not leave any. */
  reason: string | null
}

/**
 * The cancelled bills, newest cancellation first.
 *
 * Sorted here rather than in the query, so a caller cannot get a random order by
 * forgetting an `.order()`. Newest first because this list is read for two reasons and
 * both want the same end of it: the bill just cancelled has to still be on screen when
 * the owner looks up, and a cancellation made by mistake is noticed within minutes.
 *
 * A row with no id is dropped. It cannot be restored — there is nothing to name in the
 * request — so drawing a restore button beside it would be offering an action that
 * cannot happen.
 */
export function cancelledBills(
  rows: CancelledInvoiceRow[] | null | undefined,
  /** `common.unknown`, in the reader's language. A view cannot prove a name is there. */
  unknown: string,
): CancelledBill[] {
  return (rows ?? [])
    .filter((r): r is CancelledInvoiceRow & { id: string } => Boolean(r.id))
    // Sorted on the source row and then mapped away, because `voided_at` is a UTC
    // timestamp and nothing on the screen shows it — a field carried only to be sorted
    // by is one somebody eventually renders in the wrong timezone. A missing or
    // unparseable stamp sorts last rather than throwing.
    .sort((a, b) => stamp(b.voided_at) - stamp(a.voided_at))
    .map((r) => ({
      id: r.id,
      name: r.student_name ?? unknown,
      studentCode: r.student_code,
      periodMonth: r.period_month ?? '',
      net: Number(r.net_bdt ?? 0),
      // Empty is the same as absent to everything downstream, and a blank line under a
      // name reads as a rendering fault rather than as "they left no reason".
      reason: r.void_reason?.trim() || null,
    }))
}

function stamp(at: string | null): number {
  if (!at) return 0
  const ms = Date.parse(at)
  return Number.isFinite(ms) ? ms : 0
}
