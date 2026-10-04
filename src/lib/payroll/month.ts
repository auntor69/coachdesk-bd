/**
 * A month's payroll: who has had what, who is still owed, and the voucher register.
 *
 * IT LIVES HERE AND NOT IN THE PAGE for the reason ./bill.ts and ../expenses/tally.ts both
 * give about their own arithmetic — 20260811000049's `center_profit_month` subtracts the
 * sum of this table from a centre's collections, so every figure this file produces is one
 * an owner will read as profit, and a sum that has never been run against a fixture is a
 * sum nobody has checked. The page renders; this file adds up.
 *
 * THE MONTH IS `for_month` AND NEVER `paid_at`, which is 20260811000044's decision and the
 * whole reason a month picker belongs on this screen at all. December's salary handed over
 * in January is December's cost: `center_profit_month` groups by `for_month`, so a screen
 * that grouped by the day the money moved would show one figure and the profit line
 * another, and the January it drew would read as a disaster.
 *
 * "ALREADY PAID" IS A READ AND NOT A CONSTRAINT, and that is the single most important
 * thing about this file. 20260811000044 deliberately has no unique index on (payee,
 * for_month): a centre paying half a salary on the 5th and half on the 20th writes two rows
 * for one month and one person, both real, and a reversing correction is a third. So
 * nothing in the database will stop a second payment, and nothing should — which leaves
 * this file as the only thing that can tell an owner what is already on the record before
 * they hand over money again. `paid`, `payments` and `remaining` on every line exist for
 * that one sentence, and the screen prints all three.
 *
 * A LINE IS A PERSON, NOT AN AGREEMENT, which is the difference from ./bill.ts. The bill
 * lists live agreements; this lists everybody the month has anything to say about — the
 * union of the live agreements and anybody already paid for the month. Somebody paid in
 * August whose agreement was stood down on the 20th still has August money on the record,
 * and a list built from live agreements alone would hide it: the month's total would
 * include ৳13,000 that matches no row on the screen.
 *
 * WHAT CANNOT BE TOTALLED, said out loud in three separate figures rather than folded into
 * one. A per-class agreement has no monthly figure — 20260811000044 refuses to store one,
 * because it would go stale the next time the teacher taught — so `agreed` covers the
 * monthly rows only, `outstanding` can only be summed over those same rows, and
 * `perClassCount` is what says how many rows are in neither. One number over both kinds
 * would tell an owner their wage bill is smaller than it is, which is the direction that
 * costs them money.
 *
 * Relative imports with the extension, like every other unit-tested module here: these
 * tests run under `node --test`, which resolves neither tsconfig paths nor extensionless
 * specifiers.
 */
import { sumTaka } from '../money.ts'
import type { PaymentMethod, SalaryBasis } from '../supabase/types.ts'
import { PER_CLASS_BASIS } from './basis.ts'
import {
  billRows,
  payeeValue,
  type Payee,
  type PayeeKind,
  type TermsSourceRow,
} from './bill.ts'

/**
 * One `salary_payments` row, as the screen queries it.
 *
 * `amount_bdt` is `string | number | null` for two reasons at once: PostgREST serialises
 * numeric as a string, and a generated column is nullable in the generated types even
 * though the database will never produce a null in it. Read rather than re-derived from
 * the four parts, exactly as the bill reads `net_bdt` — the sum is the database's own and a
 * second implementation of it in TypeScript is a second answer that can disagree.
 *
 * The four parts are not queried at all. They are what the form submitted; what the screen
 * reports is what was settled, and nothing reads a past payment's composition until there
 * is a payslip to print.
 */
export type PaymentSourceRow = {
  id: string
  voucher_no: number
  employee_id: string | null
  teacher_id: string | null
  amount_bdt: string | number | null
  method: PaymentMethod
  reference: string | null
  note: string | null
  paid_at: string
}

/** The four columns a pay form writes, as the agreement has them. */
export type SalaryParts = {
  basic: number
  allowances: number
  other: number
  deductions: number
}

/**
 * The live agreement behind a line, with what the form should start out holding.
 *
 * `net` is the database's generated figure and `parts` is what the four columns say, and
 * they are both here on purpose: `net` is what the month is measured against, `parts` is
 * what gets typed into the boxes. The payment that results is generated from the parts the
 * form submits, so the parts are the ones that decide what is recorded — which is why they
 * are prefilled from the agreement rather than derived back out of the net.
 */
export type LineTerms = {
  termsId: string
  basis: SalaryBasis
  /** The monthly net, and zero on a per-class agreement. See ./bill.ts on why not null. */
  net: number
  /** The agreed rate for one class, on a per-class agreement only. */
  perClass: number | null
  parts: SalaryParts
}

/** One person, and what this month has to say about them. */
export type PayLine = {
  payeeKind: PayeeKind
  payeeId: string
  /** Null when the payee is in neither staff list. See ./bill.ts on why the row stays. */
  name: string | null
  job: string | null
  /** Somebody switched off who is still on the payroll for this month. */
  gone: boolean
  /**
   * Null for somebody with money on this month and no live agreement — paid and then stood
   * down, or a final settlement after they left. Their line carries no figure to measure
   * against, which is what `remaining: null` says further down.
   */
  terms: LineTerms | null
  /** Handed over for this month so far, every row summed, corrections included. */
  paid: number
  /** How many rows that is. Two is not an error — see the header. */
  payments: number
  /**
   * Agreed minus paid, and null where there is no agreed monthly figure to subtract from.
   *
   * The sign is left honest: somebody paid ৳500 over their agreement reads −৳500 here
   * rather than zero, because an overpayment is a thing an owner would want to see once and
   * a clamp would hide it for ever.
   */
  remaining: number | null
  /**
   * Whether this person still needs attention this month.
   *
   * True for a monthly agreement that is short, and for anybody — per-class or not — with
   * nothing at all recorded. False once a per-class teacher has been paid something,
   * because what their month costs is not knowable from here and pretending otherwise would
   * put a permanent prompt on their row.
   */
  pending: boolean
}

/** A money column as a number, or null if it will not parse. See ./bill.ts. */
function taka(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Zero for a column that will not parse, used only where a null would be a wrong box. */
function part(value: string | number | null | undefined): number {
  return taka(value) ?? 0
}

/**
 * What each payee has had for this month, and in how many rows.
 *
 * Keyed by `payeeValue` rather than by the bare id, for the reason that function exists at
 * all: two tables can hand out the same uuid in principle, and a map that ignored the kind
 * would be a teacher's salary landing on an employee's line.
 *
 * A row whose amount will not parse is dropped rather than counted as nothing, matching
 * ../expenses/tally.ts: a line reading "paid ৳0" for money that did leave the drawer is a
 * wrong figure where an absent one would have been a question. The amounts are collected
 * into a list and summed once at the end, because `sumTaka` works in integer poisha over
 * a whole array and folding it pairwise re-introduces the rounding it exists to avoid.
 */
function amountsByPayee(
  payments: readonly PaymentSourceRow[] | null | undefined,
): Map<string, number[]> {
  const out = new Map<string, number[]>()

  for (const p of payments ?? []) {
    // The exactly-one constraint says one of these is set; see ./bill.ts on why reading the
    // employee column first is not a guess about which.
    const kind: PayeeKind = p.employee_id ? 'employee' : 'teacher'
    const id = p.employee_id ?? p.teacher_id
    if (!id) continue

    const amount = taka(p.amount_bdt)
    if (amount === null) continue

    const key = payeeValue(kind, id)
    const list = out.get(key)
    if (list) list.push(amount)
    else out.set(key, [amount])
  }

  return out
}

/**
 * Everybody this month has anything to say about, live agreements first.
 *
 * NOTHING IS SORTED HERE, forced by the same fact that stops ./bill.ts sorting: the payee's
 * name is not known until the map has been consulted, and ordering by it in the query would
 * mean an embed the composite foreign keys make ambiguous. What the order does carry is the
 * shape of the list — every live agreement in query order, then anybody paid for the month
 * without one — so the page can sort it and the tests can tell the two groups apart.
 *
 * The agreements come through `billRows`, which is what makes this list agree with /payroll
 * line for line: the same join, the same rule about a payee who cannot be named, and the
 * same rule about a net that will not parse. The four parts are zipped back on afterwards by
 * `termsId`, because the bill has no use for them and a second join would be a second thing
 * to keep correct.
 */
export function payLines(
  terms: readonly TermsSourceRow[] | null | undefined,
  payments: readonly PaymentSourceRow[] | null | undefined,
  people: readonly Payee[],
): PayLine[] {
  const amounts = amountsByPayee(payments)
  const byKey = new Map(people.map((p) => [payeeValue(p.kind, p.id), p]))
  const partsById = new Map(
    (terms ?? []).map((t) => [
      t.id,
      {
        basic: part(t.basic_bdt),
        allowances: part(t.allowances_bdt),
        other: part(t.other_bdt),
        deductions: part(t.deductions_bdt),
      },
    ]),
  )

  const out: PayLine[] = []
  const covered = new Set<string>()

  for (const row of billRows(terms, people)) {
    const key = payeeValue(row.payeeKind, row.payeeId)
    covered.add(key)

    const list = amounts.get(key) ?? []
    const paid = sumTaka(list)
    // Null on a per-class agreement, because the month has no agreed figure to measure
    // against. Not zero: zero is what a settled monthly agreement reads, and the two must
    // never look the same on a screen an owner pays people from.
    const remaining =
      row.basis === PER_CLASS_BASIS ? null : sumTaka([row.net, -paid])

    out.push({
      payeeKind: row.payeeKind,
      payeeId: row.payeeId,
      name: row.name,
      job: row.job,
      gone: row.gone,
      terms: {
        termsId: row.termsId,
        basis: row.basis,
        net: row.net,
        perClass: row.perClass,
        parts: partsById.get(row.termsId) ?? {
          basic: 0,
          allowances: 0,
          other: 0,
          deductions: 0,
        },
      },
      paid,
      payments: list.length,
      remaining,
      pending: remaining === null ? list.length === 0 : remaining > 0,
    })
  }

  // Money on this month with no live agreement behind it. Insertion order, which is the
  // order the payments arrived in from the query.
  for (const [key, list] of amounts) {
    if (covered.has(key)) continue

    const at = key.indexOf(':')
    const kind = key.slice(0, at) as PayeeKind
    const person = byKey.get(key)

    out.push({
      payeeKind: kind,
      payeeId: key.slice(at + 1),
      name: person?.name ?? null,
      job: person?.job ?? null,
      gone: person ? !person.active : false,
      terms: null,
      paid: sumTaka(list),
      payments: list.length,
      remaining: null,
      // Paid already, and nothing says how much they were due. Chasing this row would be
      // the screen inventing an obligation out of an absent agreement.
      pending: false,
    })
  }

  return out
}

/** The figures at the foot of the month. */
export type MonthTally = {
  /**
   * What the centre has paid out for this month, every row, corrections included.
   *
   * The one figure here that leaves this screen: `center_profit_month` sums the same rows
   * for the same month, so this is what the profit line will subtract. If it disagrees with
   * the dashboard, one of the two is reading the wrong month.
   */
  paid: number
  /** How many payment rows that is. Not how many people — see the header. */
  payments: number
  /** What the live monthly agreements say the month should cost. */
  agreed: number
  /** How many agreements carry that figure. */
  monthlyCount: number
  /** How many live agreements are per-class, and therefore in none of it. */
  perClassCount: number
  /**
   * What is still owed on the monthly agreements, shortfalls only.
   *
   * Summed over each line's own positive remainder rather than as `agreed − paid`, and the
   * difference is not pedantic: a teacher overpaid by ৳2,000 would otherwise cancel a cook
   * who has had nothing, and the screen would say the month is settled while somebody is
   * still waiting for their salary.
   */
  outstanding: number
  /** How many people still need something doing. See `PayLine.pending`. */
  pendingCount: number
  /** Live agreements belonging to somebody switched off. See ./bill.ts. */
  goneCount: number
  /** People with money on this month and no live agreement behind it. */
  unagreedCount: number
}

/**
 * The month added up, with everything the total does not cover said out loud.
 *
 * `paid` and `outstanding` are deliberately not two halves of one number. A month can be
 * over its agreed figure and still have somebody unpaid; a month of nothing but per-class
 * teachers has a real `paid` and an `outstanding` of zero that means "not known" rather
 * than "settled". That is what `perClassCount` and `pendingCount` are for, and it is why
 * this returns nine figures instead of one.
 */
export function tallyMonth(lines: readonly PayLine[]): MonthTally {
  const monthly = lines.filter((l) => l.terms !== null && l.terms.basis !== PER_CLASS_BASIS)

  return {
    paid: sumTaka(lines.map((l) => l.paid)),
    payments: lines.reduce((n, l) => n + l.payments, 0),
    agreed: sumTaka(monthly.map((l) => l.terms?.net ?? 0)),
    monthlyCount: monthly.length,
    perClassCount: lines.filter((l) => l.terms?.basis === PER_CLASS_BASIS).length,
    outstanding: sumTaka(
      lines.map((l) => (l.remaining !== null && l.remaining > 0 ? l.remaining : 0)),
    ),
    pendingCount: lines.filter((l) => l.pending).length,
    goneCount: lines.filter((l) => l.gone && l.terms !== null).length,
    unagreedCount: lines.filter((l) => l.terms === null).length,
  }
}

/** One line of the month's voucher register. */
export type VoucherLine = {
  id: string
  voucherNo: number
  /** Null when the payee is in neither staff list, and the row still shows. */
  name: string | null
  job: string | null
  amount: number
  method: PaymentMethod
  reference: string | null
  note: string | null
  /** When the money moved, as a timestamp — not the month it settles. */
  paidAt: string
  /** A reversing row, flagged in words on the screen rather than by one minus sign. */
  correction: boolean
}

/**
 * Whether a further positive payment for one person's month needs the form to confirm it
 * was meant.
 *
 * THE GUARD 20260811000051 LEFT TO THE SCREEN, AND WHY IT COULD NOT STAY THERE. That
 * migration says it in its own words — "nothing at all in the columns to tell two arrivals
 * of one tap apart from two genuine instalments" — and 20260811000044 has no unique index
 * on (payee, for_month) on purpose, because a centre paying half a salary on the 5th and
 * half on the 20th writes two rows both of which are real. What the product offered instead
 * was a screen that prints paid, agreed and left above every form, and that is a guard only
 * for a reader who stops to read it. The form itself re-prefills the whole agreed figure
 * after a payment, so the next tap pays a second full salary — and `salary_payments`
 * revokes DELETE, so the duplicate is permanent: the month's profit drops by a salary and
 * two vouchers exist for one payment. That is exactly the ৳13,000 of wrong August profit
 * 20260811000051's header prices.
 *
 * SO THE RULE IS OVERPAYMENT, NOT REPETITION. A payment that takes the month past what the
 * agreement says is due waits for an explicit tick — which keeps the advance, the Eid bonus
 * and the late settlement available to an owner who means them — while the second half of a
 * salary, ৳7,000 after ৳6,000, is under the agreed figure and goes through as the ordinary
 * thing it is. `alreadyPaid` is what the month already holds for this payee, a replay's own
 * row excluded, and the comparison runs through `sumTaka` so it is decided in the same
 * integer poisha every other figure on this screen is.
 *
 * A CORRECTION IS NEVER REFUSED. A negative amount cannot be the accident this guards
 * against; it is the only correction `salary_payments` permits.
 *
 * NOTHING IS MEASURABLE WITHOUT A MONTHLY AGREEMENT, and `agreedNet` null says so: a
 * per-class rate has no monthly figure to exceed — 20260811000044 refuses to store one —
 * and a payee with no live agreement is a final settlement with nothing to measure against.
 * Refusing those would be inventing an obligation out of an absent agreement, which is the
 * reading `payLines` refuses for the same row.
 */
export function needsRepeatConfirmation({
  agreedNet,
  alreadyPaid,
  amount,
  confirmed,
}: {
  /** The live monthly agreement's net, or null where there is nothing to measure against. */
  agreedNet: number | null
  /** What this month already holds for this payee, this submit's own row excluded. */
  alreadyPaid: number
  /** The net this submit would add — the generated column's arithmetic, done once to check. */
  amount: number
  /** The form's own "yes, a further payment", submitted only by an explicit tick. */
  confirmed: boolean
}): boolean {
  if (confirmed) return false
  // A correction, or an empty figure the caller has already refused elsewhere. Neither is
  // the accident this guard exists for, and refusing a reversing row would leave a wrong
  // figure with no way out.
  if (!Number.isFinite(amount) || amount <= 0) return false
  // No monthly agreement: nothing to be over. See the header.
  if (agreedNet === null || !Number.isFinite(agreedNet) || agreedNet <= 0) return false
  // The first payment for the month. A large one is visible in the form's own total before
  // it is submitted, and this guard is about the second arrival.
  if (!Number.isFinite(alreadyPaid) || alreadyPaid <= 0) return false

  return sumTaka([alreadyPaid, amount]) > agreedNet
}

/**
 * The month's payments, named, in the order they arrived.
 *
 * Nothing is sorted here: the query orders by `paid_at desc, voucher_no desc` and the screen
 * prints them in that order, so re-sorting would be this module disagreeing with the page
 * about which register it is describing. Same call as ../expenses/tally.ts.
 *
 * A row whose amount will not parse is dropped, for the reason `amountsByPayee` gives — and
 * it has to be the same rule in both places, or the register would show a row the month's
 * total does not include.
 */
export function voucherLines(
  payments: readonly PaymentSourceRow[] | null | undefined,
  people: readonly Payee[],
): VoucherLine[] {
  const byKey = new Map(people.map((p) => [payeeValue(p.kind, p.id), p]))
  const out: VoucherLine[] = []

  for (const p of payments ?? []) {
    const kind: PayeeKind = p.employee_id ? 'employee' : 'teacher'
    const id = p.employee_id ?? p.teacher_id
    if (!id) continue

    const amount = taka(p.amount_bdt)
    if (amount === null) continue

    const person = byKey.get(payeeValue(kind, id))

    out.push({
      id: p.id,
      voucherNo: p.voucher_no,
      name: person?.name ?? null,
      job: person?.job ?? null,
      amount,
      method: p.method,
      reference: p.reference,
      note: p.note,
      paidAt: p.paid_at,
      correction: amount < 0,
    })
  }

  return out
}
