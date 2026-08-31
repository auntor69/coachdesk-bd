/**
 * The profit line as a screen can read it — MASTERPLAN.md §9.8's three terms, and the
 * reason the third one may be a lie.
 *
 * `center_profit_month` (20260811000049) already does the arithmetic, in the one place
 * this product is allowed to sum expenses toward a profit figure, and nothing here
 * recomputes it. What is here is what the view cannot answer about its own output, and
 * there turns out to be more of that than there is arithmetic:
 *
 *   * A MONTH WITH NO ROW AND A READ THAT FAILED ARE THE SAME `null`. `maybeSingle`
 *     hands both back as `data: null`, and they are opposite claims: the first is a
 *     centre that took no money, spent nothing and paid nobody, which is a true and
 *     ordinary state for the 1st of a month; the second is a month nobody can speak
 *     for. Drawing the second as four noughts and a profit of ৳0 is the same class of
 *     lie the dashboard's outstanding card already refuses.
 *
 *   * A PAYROLL FIGURE OF ZERO HAS TWO MEANINGS AND THE SCHEMA CANNOT TELL THEM APART.
 *     20260811000049 says so in its own header — "A month with no payroll row reads as
 *     a month with no staff, and nothing in the schema can tell those apart… §9.10's
 *     dashboard has to say which months have a payroll row rather than leaving an owner
 *     to notice" — and this is where that instruction is carried out. A centre that has
 *     not written December's salaries down yet is reading a profit figure too high by
 *     the largest single number in its business.
 *
 * SO THE COUNTS COME FROM OUTSIDE THE VIEW, and `null` is the answer that matters most
 * in both of them: a count that did not arrive must never read as "no staff", because
 * that is the reading which takes the warning off a wrong figure.
 *
 * NO WORDS, NO ROUTES, NO FORMATTING — see the note on ./setup.ts. This decides what
 * state a month is in; the card decides what to say about it.
 */

/**
 * A `numeric` column as a number.
 *
 * PostgREST serialises `numeric` as a string whatever the generated types say, because
 * a string survives twenty significant digits and a double does not. Every figure here
 * is money under `MAX_TAKA`, which lands exactly in a double, so the coercion is safe —
 * and it is written once rather than at seven call sites, which is what it was on the
 * way to being.
 *
 * A null column reads as 0, and that is only correct because every column this touches
 * is `coalesce`d inside the view itself: a null arriving here would mean the view had
 * changed shape, and 0 is the same answer its own `coalesce` would have given. A string
 * that is not a number reads as 0 for the same reason — it cannot happen without the
 * view changing, and `NaN` propagating into a profit figure would print "৳0" from
 * `formatTaka` anyway, three subtractions later and further from the cause.
 *
 * Exported for ./branch-money.ts, which reads the same columns one grouping finer. A
 * second copy would be a second answer to what a numeric column is.
 */
export function figure(value: number | string | null): number {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** The four columns of `center_profit_month` this reads, as they arrive. */
export type ProfitRow = {
  collected_bdt: number | string | null
  expenses_bdt: number | string | null
  payroll_bdt: number | string | null
  profit_bdt: number | string | null
}

export type MonthMoney = {
  /** Cash through the door in the month, whatever it was billed for. */
  collected: number
  /**
   * Spending dated into the month — WITHOUT the salary category, which the view drops
   * so that a centre paying staff through both books is not subtracted twice. Which is
   * why the label on this figure has to say so: an owner comparing it against the
   * spending screen's own month total would otherwise find a discrepancy and stop
   * trusting both, and that money is accounted for in `payroll` instead.
   */
  expenses: number
  /** Salaries paid FOR the month, whenever they were handed over. §9.5. */
  payroll: number
  /**
   * The view's own subtraction, read rather than done again here.
   *
   * Deliberately not `collected - expenses - payroll` in TypeScript. Postgres did that
   * in `numeric(12, 2)` and this would do it in binary floating point, so the two would
   * disagree in the paisa on some months — and then the profit figure would depend on
   * which screen you read it from, which is the one thing §9.1 says a finance screen may
   * never do. The arithmetic lives in the view. This carries it.
   */
  profit: number
}

/**
 * The month's four figures, or `null` when nobody can say.
 *
 * `failed` rather than a truthiness test on the row, because the two cases this exists
 * to separate are indistinguishable from the row alone — see the header. The caller
 * passes `Boolean(error)`, which is the only thing that tells them apart.
 */
export function monthMoney(row: ProfitRow | null, failed: boolean): MonthMoney | null {
  if (failed) return null

  // No row at all: nothing collected, nothing spent, nobody paid. A real month, and the
  // ordinary state of a centre on the 1st. The view's month spine is a union of the
  // three sides, so a month absent from it is absent from all three.
  if (!row) return { collected: 0, expenses: 0, payroll: 0, profit: 0 }

  return {
    collected: figure(row.collected_bdt),
    expenses: figure(row.expenses_bdt),
    payroll: figure(row.payroll_bdt),
    profit: figure(row.profit_bdt),
  }
}

/** The three columns of `fee_charges_month` this reads. */
export type ChargesRow = {
  charged_bdt: number | string | null
  paid_bdt: number | string | null
  outstanding_bdt: number | string | null
}

/**
 * What the month BILLED, which is a different question from what it collected — §9.1's
 * two honest meanings, and the reason the two views have different column names.
 *
 * `collected` above is cash that arrived in the month whatever it was for. `paid` here
 * is money against the month's own bills whenever it arrived. A March bill paid in April
 * is in one and not the other, and a screen showing both has to label both.
 */
export type MonthBills = {
  charged: number
  paid: number
  /** `charged - paid`. Negative when a family has paid ahead on the month's bills. */
  outstanding: number
}

export function monthBills(row: ChargesRow | null, failed: boolean): MonthBills | null {
  if (failed) return null

  // A month nobody has billed for. Not the same as a month with no row in the profit
  // view — a centre can bill in March and take no cash until April — so the two reads
  // are separate and either can be absent on its own.
  if (!row) return { charged: 0, paid: 0, outstanding: 0 }

  return {
    charged: figure(row.charged_bdt),
    paid: figure(row.paid_bdt),
    outstanding: figure(row.outstanding_bdt),
  }
}

/**
 * How much of the month's payroll term is actually in the figure above it.
 *
 * FOUR STATES AND NOT A BOOLEAN, because "is the payroll side complete" has no
 * answerable form: nothing in the schema says how many people a centre employs, and two
 * payments can belong to one person, so no pair of counts can be compared into "3 of
 * 14 paid". What the counts CAN answer is which sentence is honest, and these are the
 * four:
 *
 *   noTerms   nobody has an agreed salary. A one-teacher centre, which in Bangladesh is
 *             most of them, and a profit line with no payroll term in it is correct. Say
 *             nothing — a monthly warning about staff they do not have is furniture.
 *   unpaid    people have agreed salaries and not one payment is recorded for the month.
 *             The profit figure is missing the wage bill entirely. The loud one.
 *   recorded  at least one payment is in. The figure is real, and anybody still unpaid
 *             is still outside it, which is the most this can honestly claim.
 *   unknown   a count did not arrive.
 *
 * The `people` on `unpaid` is live agreements, not employees: `salary_terms` has a
 * partial unique index on the payee, so one live row is one person.
 */
export type PayrollState =
  | { kind: 'noTerms' }
  | { kind: 'unpaid'; people: number }
  | { kind: 'recorded'; payments: number }
  | { kind: 'unknown' }

/**
 * @param terms live rows in `salary_terms`, or null if that count did not arrive.
 * @param payments rows in `salary_payments` for the month, or null likewise.
 *
 * THE TWO NULLS ARE NOT INTERCHANGEABLE, and collapsing them into one guard at the top
 * was the first way this was written. An unknown `terms` beside a known payment count of
 * four says "four payments are recorded", which is true and useful and needs no
 * agreement count to be said. It is only the *silence* — `noTerms` — that needs both,
 * because silence is the answer that removes the warning, and a failed count must never
 * be the reason a wrong profit figure goes unflagged.
 */
export function payrollState(terms: number | null, payments: number | null): PayrollState {
  if (payments === null) return { kind: 'unknown' }
  if (payments > 0) return { kind: 'recorded', payments }

  // Nothing paid for the month. Whether that is a fault or a fact is the agreement
  // count's answer, and there is no safe default for it.
  if (terms === null) return { kind: 'unknown' }
  if (terms > 0) return { kind: 'unpaid', people: terms }

  return { kind: 'noTerms' }
}
