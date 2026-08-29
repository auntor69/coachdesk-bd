/**
 * The collection register's arithmetic: the month's payments in the order they came,
 * each carrying the total up to it, and the figures at the foot of the sheet.
 *
 * IT LIVES HERE AND NOT IN THE PAGE because this is the one screen in the product
 * whose entire purpose is to be checked against something else — a bKash statement,
 * a cash box, an accountant's own column of figures. Everything on it is a sum, and
 * a sum that has never been run against a fixture is a sum nobody has checked. The
 * page renders; this file adds up.
 *
 * A REFUND IS A NEGATIVE PAYMENT, not a deletion — the rule for the whole product,
 * written down in refund.ts and relied on by month-close.ts, which reconstructs a
 * past balance by walking payments backwards and gets refunds right for free because
 * of it. So this file nets by arithmetic and never by a special case: `sumTaka` over
 * a list containing -500 is the whole of the handling.
 *
 * WHAT IT WILL NOT DO IS LET THE SHEET STAY SILENT ABOUT IT. A refund arrives here
 * as a row like any other and leaves as a row that says so, because on the printed
 * page a minus sign is one character at the left of a right-aligned number in a
 * column of numbers that all look like it, and these sheets come off the cheapest
 * black-and-white laser in the building. `refund` on the row is that flag, and the
 * three figures on the tally — what came in, what went back, what is left — are the
 * same shape: two addends and their sum, so the reader can see where the third came
 * from instead of taking it on faith.
 *
 * GROSS AND NET ARE NOT TWO ANSWERS TO ONE QUESTION (docs §4). `total` is the
 * month's collection and it is the only figure that answers that; `grossIn` and
 * `refunded` are its two addends, summed once, here, from the same rows. They add up
 * exactly — there is a test that says so — and `total` is also the last row's
 * running total, which is the identity the whole page rests on.
 *
 * Relative imports with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */
import { todayInDhaka } from '../bd/time.ts'
import { sumTaka } from '../money.ts'
import type { PaymentMethod } from '../supabase/types.ts'
import { PAYMENT_METHODS } from './methods.ts'

/**
 * Cash first, then the wallets. The collection form's own order, so the breakdown at
 * the foot of the sheet reads down in the order the owner is used to choosing from —
 * and a fixed order rather than whatever the month happened to contain, so two months
 * printed side by side have their lines in the same places.
 *
 * ALIASED RATHER THAN LISTED, and the difference is not cosmetic. This was a hand-typed
 * copy of the same seven values, and it was six of them: `card` reached the enum in
 * 20260811000041 and never reached here, so a card payment counted in `total` below and
 * appeared in no line of `byMethod` — a breakdown that no longer added up to the figure
 * printed above it, on the sheet an owner holds against a wallet statement. See
 * ./methods.ts for why the list now lives somewhere a compiler can check it.
 *
 * The name stays because the tests and the page read it, and because "the methods the
 * register prints lines for" is still a meaningful thing to say — it just no longer gets
 * to be a different list.
 */
export const REGISTER_METHODS: readonly PaymentMethod[] = PAYMENT_METHODS

/** One `fee_payments` row, as the register queries it. */
export type RegisterPaymentRow = {
  id: string
  receipt_no: number
  /**
   * PostgREST serialises numeric as a string, so this is one — typed honestly rather
   * than as the number it is about to become, because a `Number()` that everybody
   * remembers is a `Number()` somebody eventually leaves out.
   */
  amount_bdt: string | number
  method: PaymentMethod
  reference: string | null
  paid_at: string
  /**
   * An object for a forward reference, an array when PostgREST cannot prove the
   * cardinality, null when the embed came back empty. All three are in the type
   * because all three are handled below, for the reason the invoice generator handles
   * both shapes: a register row that renders "undefined" where a child's name goes is
   * worse than one that says nothing.
   */
  students:
    | { name: string; student_code: string | null }
    | { name: string; student_code: string | null }[]
    | null
}

/** One line of the sheet. */
export type RegisterRow = {
  id: string
  receiptNo: number
  date: string
  name: string
  code: string | null
  method: PaymentMethod
  reference: string | null
  /** Signed: negative on a refund, because the column has to add up by hand. */
  amount: number
  /**
   * Money that went back out.
   *
   * Carried as a flag and not left to the renderer to work out from the sign, so the
   * one place that decides what counts as a refund is the one place that is tested.
   * Zero is not a refund: it is a correction that cancelled itself, and calling it a
   * refund would put the word on a row where nothing was handed back.
   */
  refund: boolean
  /** The total of this row and every row above it. */
  running: number
}

/**
 * The month's payments as the sheet needs them, each carrying the total up to and
 * including itself.
 *
 * At module scope rather than inside the page, and that was never a style preference:
 * accumulating a running total means reassigning something as the list is walked, and
 * the React compiler refuses that for a binding declared inside a component —
 * reassigning after render has completed is how a value ends up disagreeing with what
 * was drawn. Out here there is no render to complete, `running` is a local of a plain
 * function, and the page gets back a finished array it only reads.
 *
 * Every addition goes through sumTaka, so the last running total and the grand total
 * are the same number. A reader who finds them a taka apart stops believing the page,
 * and this is a page whose whole job is to be believed.
 *
 * The order is the caller's — `paid_at` then `receipt_no`, ascending, out of the
 * query. Nothing is sorted here: a running total that disagreed with the order the
 * rows are printed in would be a column of arithmetic nobody could follow.
 */
export function registerRows(
  payments: readonly RegisterPaymentRow[] | null | undefined,
  /** `common.unknown`, in the reader's language. See the type above for why. */
  unknown: string,
): RegisterRow[] {
  const rows: RegisterRow[] = []
  let running = 0

  for (const p of payments ?? []) {
    const student = Array.isArray(p.students) ? p.students[0] : p.students
    const amount = Number(p.amount_bdt)
    // A row whose amount will not parse is dropped rather than counted as nothing: a
    // register is a document, and a line in it reading "৳০" for money that did cross
    // the desk is a wrong figure where an absent one would have been a question.
    if (!Number.isFinite(amount)) continue
    running = sumTaka([running, amount])

    rows.push({
      id: p.id,
      receiptNo: p.receipt_no,
      // The Dhaka calendar day, not a slice of the UTC timestamp — a payment taken at
      // 1am would otherwise be dated to the day before on a page whose whole job is to
      // be checked against something else.
      date: todayInDhaka(new Date(p.paid_at)),
      name: student?.name ?? unknown,
      code: student?.student_code ?? null,
      method: p.method,
      reference: p.reference,
      amount,
      refund: amount < 0,
      running,
    })
  }

  return rows
}

/** One line of the breakdown at the foot of the sheet. */
export type RegisterMethodTotal = {
  method: PaymentMethod
  /** Net through this method: refunds paid back out through it already taken off. */
  amount: number
  /** How many rows went through it, refunds included. */
  entries: number
}

/** The figures at the foot of the sheet. */
export type RegisterTally = {
  /** What came in, before anything was handed back. Zero on an empty month. */
  grossIn: number
  /**
   * What went back out, as the negative figure it is.
   *
   * Negative so it reads as a subtraction wherever it is printed and so the three
   * figures add rather than needing a reader to know which way to take one of them.
   */
  refunded: number
  /** grossIn + refunded. The month's collection, and the last row's running total. */
  total: number
  /** How many payments, refunds included. Payments and not students: a family can pay twice. */
  entries: number
  /** In REGISTER_METHODS order, and only the methods the month actually used. */
  byMethod: RegisterMethodTotal[]
}

/**
 * The month added up three ways that have to agree.
 *
 * `total` is the collection: every taka that came in with everything handed back
 * taken off, which is the figure month-close.ts calls `collected` and the one an owner
 * reconciles. It is also, necessarily, the running total on the last row — same rows,
 * same sumTaka, and a test that pins the two together.
 *
 * THE PER-METHOD FIGURES ARE NET, and that is the point of them rather than a
 * compromise. "৳48,000 collected" cannot be checked against anything; "৳31,500 through
 * bKash" can be checked against exactly one thing, and the wallet statement that gets
 * held against it has the refund on it too — so netting the refund into its method is
 * what makes the two columns agree.
 *
 * A METHOD THAT NETTED TO NOTHING STILL GETS ITS LINE. ৳500 in by bKash and the same
 * ৳500 back out is not a month with no bKash in it; it is two lines on the wallet
 * statement, and an owner looking for them wants to find bKash on this sheet reading
 * ৳0 rather than not find it at all. Only a method with no rows whatever is left off.
 */
export function tallyRegister(rows: readonly RegisterRow[]): RegisterTally {
  const grossIn = sumTaka(rows.filter((r) => !r.refund).map((r) => r.amount))
  const refunded = sumTaka(rows.filter((r) => r.refund).map((r) => r.amount))

  return {
    grossIn,
    refunded,
    // Added from the two halves and not from the rows a third time: one of these three
    // figures has to be the sum of the other two on the page, so it is the sum of the
    // other two here.
    total: sumTaka([grossIn, refunded]),
    entries: rows.length,
    byMethod: REGISTER_METHODS.map((method) => {
      const mine = rows.filter((r) => r.method === method)
      return { method, amount: sumTaka(mine.map((r) => r.amount)), entries: mine.length }
    }).filter((m) => m.entries > 0),
  }
}
