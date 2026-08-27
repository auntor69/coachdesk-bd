/**
 * A month's fee ledger, as of the first instant of that month and the first instant
 * of the next.
 *
 * WHY THIS EXISTS. MASTERPLAN §4, "the trial-to-paid mechanics", step 4: on about
 * day 28 you sit with the owner and show them their own numbers — what was
 * outstanding when the month started, what came in, how many messages went out to
 * parents — and then say the price. The argument that closes the sale is arithmetic
 * the owner did not have before, so every figure on that screen has to be one they
 * could check by hand and one that agrees with the rest of the app.
 *
 * The tally of messages is at the foot of this file rather than in the page, for the
 * same reason the ledger is: the page's rule is that it does no arithmetic, so that
 * no number on it can be derived twice.
 *
 * THE HARD PART IS "AT THE START OF THE MONTH", and it is not a filter.
 * fee_invoice_balances answers what an invoice has on it *now*. An invoice raised in
 * June and settled on the 5th of July has remaining_bdt = 0 today and was ৳2,000 of
 * arrears on the 1st, which is precisely the figure being asked for. So the balance
 * is walked backwards instead:
 *
 *     remaining at instant T  =  remaining now  +  every payment since T
 *
 * That identity holds because the view defines remaining_bdt as net minus the sum of
 * payments and nothing else (see 20260811000026), and because a refund in this
 * product is a negative payment rather than a deletion — so "every payment since T"
 * nets refunds off in the same direction Postgres did.
 *
 * It is also what makes the queries cheap enough for a phone. The rows needed are
 * this month's invoices, the earlier invoices that still carry a balance, and the
 * payments taken since the month began — never the centre's whole payment history.
 *
 * THE SIX FIGURES DO NOT SUM, AND THE SCREEN MUST NOT PRETEND THEY DO.
 * opening + billed - collected is not closing, for two reasons that are both
 * deliberate. A family in credit is never netted against another family's debt —
 * tallyOutstanding, and the note on it, is the rule for the whole product — and
 * `collected` is every taka that came in, including any paid ahead against a later
 * month, because that is the number the register totals and the one an owner
 * reconciles against a bKash statement. `advance` is returned so that difference is
 * visible on the screen rather than a discrepancy the owner has to go and find; with
 * nobody in credit, opening + billed - (collected - advance) does close, and there is
 * a test that says so.
 *
 * The rate divides `collected - advance` and not `collected`, for the same reason
 * `advance` exists at all: a centre where one family settled next month's bill early
 * has not thereby collected this month's. Both halves of the subtraction are on the
 * screen, so an owner who checks the division arrives at the number that was printed.
 *
 * WHAT IT DELIBERATELY DOES NOT RECONSTRUCT is a void. A voided invoice is left out
 * of the balances entirely rather than counted as live on the days before it was
 * voided, so this report describes the book as it stands, corrections included — the
 * same way the fee board, the dashboard and the exports all read it. A number that
 * changes when you re-run the report for a closed month is worse than one that is a
 * day coarse about a correction. A payment against a voided bill still counts as
 * money collected, because it is: the cash crossed the desk, and if it was handed
 * back the refund is a negative payment inside the same window.
 *
 * Relative imports with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */
import { addMonths, todayInDhaka } from '../bd/time.ts'
import { sumTaka, tallyOutstanding } from '../money.ts'

/**
 * How many months back the selector offers, this one included.
 *
 * The same twelve as the collection register, and for the same reason: a month
 * further back than that is a question for the export, not for a screen. Backwards
 * only — there is nothing to close about a month that has not happened.
 */
export const CLOSE_MONTHS_BACK = 12

/**
 * A row of fee_invoice_balances, as this file needs it.
 *
 * Every column is nullable because Postgres cannot prove otherwise through a view.
 * A row with no id is dropped rather than defaulted: it cannot be matched to its
 * payments, so counting its balance would be counting a number twice.
 */
export type CloseBalanceRow = {
  id: string | null
  period_month: string | null
  net_bdt: number | string | null
  remaining_bdt: number | string | null
}

/**
 * A payment taken on or after the first day of the month being closed, with the
 * period of the invoice it settled.
 *
 * The embedded invoice is what makes the attribution possible. A payment against a
 * June bill and a payment against this month's bill both count as money collected,
 * but only the first one is an add-back to the opening arrears — and an invoice
 * settled during the month is missing from the balances query, so its period cannot
 * be looked up there.
 *
 * The embed arrives as an object when PostgREST can prove the cardinality and as a
 * one-element array when it cannot. Both are handled, like every other embed in this
 * app.
 */
export type ClosePaymentRow = {
  invoice_id: string | null
  amount_bdt: number | string | null
  paid_at: string
  fee_invoices:
    | ClosePaymentInvoice
    | ClosePaymentInvoice[]
    | null
}

type ClosePaymentInvoice = {
  period_month: string | null
  /**
   * Read so the two queries cannot disagree. The balances query excludes voided
   * invoices; if this one did not, a payment against a voided bill would be added
   * back into the opening arrears as if the bill were still live.
   */
  voided_at: string | null
}

export type MonthClose = {
  /** Owed at the first instant of the month, on invoices billed for earlier months. */
  opening: number
  /** Billed for this month, after discounts. */
  billed: number
  /** Every taka that came in during the month, whichever month's bill it settled. */
  collected: number
  /** How much of `collected` went against a bill for a month after this one. */
  advance: number
  /** Owed at the first instant of the next month, on invoices up to and including this one. */
  closing: number
  /** Families in credit at that same instant, kept apart from `closing` on purpose. */
  credit: number
  /**
   * How much of this month's book was settled during it, as a whole percent — or null
   * when there was nothing to collect, which is not the same as having collected none
   * of it.
   *
   * The numerator is `collected - advance`, not `collected`: money paid ahead against
   * next month's bill is not this month's collection, and counting it would let a
   * centre read 100% on a month it has not finished collecting. Both halves of that
   * subtraction are on the screen, so an owner checking the division gets this number
   * and not a different one. Above 100 is possible and honest — a family overpaid, and
   * the credit line says so.
   */
  collectionRatePct: number | null
}

/**
 * The month's ledger.
 *
 * `balances` must be every non-voided invoice billed for `month`, plus every
 * non-voided invoice billed earlier that still carries a balance either way.
 * `payments` must be every payment in the centre taken on or after the first Dhaka
 * day of `month`, with no upper bound — the ones taken after the month ended are
 * what walk the closing balance back to where it stood on the last day.
 *
 * Both are read straight off PostgREST, nulls and numeric-as-string included.
 */
export function monthClose({
  month,
  balances,
  payments,
}: {
  /** The period month being closed, as YYYY-MM-01. */
  month: string
  balances: CloseBalanceRow[] | null | undefined
  payments: ClosePaymentRow[] | null | undefined
}): MonthClose {
  const next = addMonths(month, 1)

  /** Invoice id -> the month it was billed for. */
  const periodOf = new Map<string, string>()
  /** Invoice id -> payments against it inside the month, and after it. */
  const during = new Map<string, number[]>()
  const after = new Map<string, number[]>()

  const collectedAmounts: number[] = []
  const advanceAmounts: number[] = []

  for (const p of payments ?? []) {
    if (!p.invoice_id || !p.paid_at) continue
    const amount = Number(p.amount_bdt ?? 0)
    if (!Number.isFinite(amount)) continue

    /*
     * The Dhaka calendar day, not ten characters off the timestamp. paid_at is a
     * timestamptz handed back in UTC, so a payment taken at 1am on the 1st is 19:00
     * on the last of the previous month in that string — and it would land in a
     * month the owner has already closed and reported on.
     */
    const day = todayInDhaka(new Date(p.paid_at))
    // Older than the window that was asked for. Cannot happen from the query below,
    // and if it ever does it must not be counted as this month's collection.
    if (day < month) continue

    const invoice = Array.isArray(p.fee_invoices) ? p.fee_invoices[0] : p.fee_invoices
    const inMonth = day < next
    // Money is money. It came in during the month whatever became of the bill it
    // settled, and this is the figure that reconciles against the register.
    if (inMonth) collectedAmounts.push(amount)

    // Past here it is only about reconstructing a balance, and a voided bill has no
    // balance to reconstruct — the balances query left it out, so this must too.
    const period = invoice && !invoice.voided_at ? invoice.period_month : null
    if (!period) continue
    periodOf.set(p.invoice_id, period)

    if (inMonth) {
      if (period > month) advanceAmounts.push(amount)
      push(during, p.invoice_id, amount)
    } else {
      push(after, p.invoice_id, amount)
    }
  }

  /** Invoice id -> what is on it now. */
  const remainingNow = new Map<string, number>()
  const billedAmounts: number[] = []

  for (const b of balances ?? []) {
    if (!b.id || !b.period_month) continue
    // The view wins over the payment embed. They agree, and when they cannot — a
    // stale read, a row that moved between the two queries — the invoice's own row
    // is the one that decides which month it belongs to.
    periodOf.set(b.id, b.period_month)
    remainingNow.set(b.id, Number(b.remaining_bdt ?? 0))
    if (b.period_month === month) billedAmounts.push(Number(b.net_bdt ?? 0))
  }

  const openingBalances: number[] = []
  const closingBalances: number[] = []

  for (const [id, period] of periodOf) {
    // A bill for a later month is not part of this month's book, however early it
    // was raised or paid.
    if (period > month) continue

    const now = remainingNow.get(id) ?? 0
    // Walked back one step at a time, so both instants go through the same rounding.
    const atMonthEnd = sumTaka([now, ...(after.get(id) ?? [])])
    closingBalances.push(atMonthEnd)

    // An invoice billed for this month was not owed before the month began, even if
    // the centre raised it on the last day of the previous one. The month it is for
    // is the month it belongs to — that is what `billed` counts it as.
    if (period < month) {
      openingBalances.push(sumTaka([atMonthEnd, ...(during.get(id) ?? [])]))
    }
  }

  // Only what was actually owed, never netted against a family in credit — see
  // tallyOutstanding. The opening credit is dropped rather than reported: it is a
  // detail to act on next to a child's name, and there is no name on this screen.
  const { outstanding: opening } = tallyOutstanding(openingBalances)
  const { outstanding: closing, credit } = tallyOutstanding(closingBalances)

  const billed = sumTaka(billedAmounts)
  const collected = sumTaka(collectedAmounts)
  const advance = sumTaka(advanceAmounts)
  const collectable = sumTaka([opening, billed])
  const againstThisBook = sumTaka([collected, -advance])

  return {
    opening,
    billed,
    collected,
    advance,
    closing,
    credit,
    // Null and not zero when nothing was collectable. A centre in its first week has
    // billed nothing and owes nothing, and "0% collected" would be the screen calling
    // that a failure.
    collectionRatePct:
      collectable > 0 ? Math.round((againstThisBook / collectable) * 100) : null,
  }
}

function push(into: Map<string, number[]>, key: string, amount: number): void {
  const list = into.get(key)
  if (list) list.push(amount)
  else into.set(key, [amount])
}

/**
 * The months the selector offers: this one and the eleven before it.
 *
 * Here rather than in the page because the register builds the same list for the
 * same reason, and the two screens are linked to each other — a month that exists on
 * one and not the other is a dead end.
 */
export function closeMonths(currentMonth: string): string[] {
  return Array.from({ length: CLOSE_MONTHS_BACK }, (_, i) => addMonths(currentMonth, -i))
}

/**
 * The four kinds of message this product puts in front of a guardian, in the order
 * the close screen lists them.
 *
 * FIXED, AND NOT SORTED BY SIZE. This screen is read out loud across a table, often
 * for two months in a row, with somebody pointing at lines. A list that reorders
 * itself between June and July is one the owner has to find their place in again
 * every time, and the largest figure is not automatically the interesting one. It is
 * also the order the founder panel and its spreadsheet use, so the two screens that
 * describe these same four things describe them the same way round.
 *
 * The money one first because this is the fee screen, then the three that are about
 * the teaching.
 */
export const MESSAGE_KINDS = ['reminders', 'notes', 'results', 'absences'] as const

export type MessageKind = (typeof MESSAGE_KINDS)[number]

/**
 * One head count per kind, as PostgREST hands them over.
 *
 * All four keys are required and every value is nullable, which is the wrong way
 * round from most types here and is deliberate. A fifth kind added to MESSAGE_KINDS
 * then stops the page compiling until somebody queries for it — and reading zero
 * forever because nobody remembered to count a new table is the exact bug the
 * founder panel shipped three times before a test was written to catch it. The
 * nullability is the ordinary one: a head count comes back null when the query
 * failed.
 */
export type MonthMessageCounts = {
  [K in MessageKind]: number | null | undefined
}

export type MonthMessages = {
  /** Every message of every kind, added together. */
  total: number
  /**
   * The kinds that actually happened, in MESSAGE_KINDS order, never a zero row.
   *
   * Zeroes are dropped rather than listed for the same reason the credit line only
   * appears when somebody is in credit: four rows of nought on the screen that is
   * meant to show an owner what their month was worth reads as a broken product, and
   * "you have never sent a marks message" is a sales argument that belongs on the
   * plan page, not in the middle of their own numbers.
   */
  lines: { kind: MessageKind; n: number }[]
}

/**
 * How much of the talking to parents the product did during the month.
 *
 * FOUR COUNTS AND A TOTAL, because the total alone is the number that gets doubted.
 * "Ninety-one messages" said across a table invites "ninety-one of what?", and the
 * answer is four different businesses: a fee chase is the centre getting paid, a week
 * note is a teacher keeping a family, a marks message is what the parents show each
 * other, and an absence message is the one that happens every single day. An owner
 * who recognises one of the four believes the other three.
 *
 * It is also the honest fix for a screen that used to count fee chases only. A centre
 * that chased thirty-four fees and sent ninety absence messages read as "34 reminders
 * sent" on the one screen where its own work is quoted back to it against a price.
 *
 * Nothing here characterises the sending. Every one of these messages left the
 * owner's own handset when they tapped it, so the count is the whole claim — see the
 * note at the head of the close page.
 */
export function monthMessages(counts: MonthMessageCounts): MonthMessages {
  const lines = MESSAGE_KINDS
    .map((kind) => ({ kind, n: whole(counts[kind]) }))
    .filter((line) => line.n > 0)

  return {
    // Plain addition and not sumTaka: these are counts of rows, not money, so there
    // are no paisa to round and no negatives to net.
    total: lines.reduce((sum, line) => sum + line.n, 0),
    lines,
  }
}

/**
 * A head count, as a number this screen can print.
 *
 * `count: 'exact', head: true` returns null when the query failed, and there is no
 * reading of that null except "none that we can see" — the alternative is NaN in the
 * middle of a sentence being read to a customer. A count cannot be negative or
 * fractional, and both are folded into the same answer rather than trusted, because
 * this is the screen where a wrong number ends a sale.
 */
function whole(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
