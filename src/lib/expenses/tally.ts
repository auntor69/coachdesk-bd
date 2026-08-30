/**
 * The month's spending: the rows as the screen lists them, and the figures at the foot.
 *
 * IT LIVES HERE AND NOT IN THE PAGE for the reason ../fees/register.ts gives about its
 * own arithmetic — every figure on this screen is a sum, and a sum that has never been
 * run against a fixture is a sum nobody has checked. The page renders; this file adds up.
 *
 * THE ONE THING THIS SCREEN MUST SAY THAT THE FEE SCREENS NEED NOT is that its own total
 * is not what the profit line subtracts. `center_profit_month` (20260811000049) takes its
 * expense side as `sum(amount_bdt) where category <> 'salary'`, so a row in the `salary`
 * category is subtracted by neither side of that view: not as an expense, because it is
 * excluded there, and not as payroll, because payroll is read from `salary_payments` and a
 * category chosen on this screen writes nothing into that table. 20260811000045 argues at
 * length for keeping the category anyway — a centre that has not set up terms per person
 * still knows it paid the staff ৳40,000 last month, and refusing the row sends that figure
 * to `miscellaneous`, where it is invisible instead of merely awkward. What follows is a
 * screen that has to say out loud which of its own rows the profit line will not read,
 * which is why `deferredToPayroll` is a figure here rather than a filter the page happens
 * to apply on its way to a heading.
 *
 * NO RUNNING TOTAL, unlike the register. That column exists there because a register is
 * read down a printed page against a wallet statement, line by line, to find the row where
 * the two stopped agreeing. This list is newest first — 20260811000045 indexes
 * `(coaching_center_id, spent_on desc)` and the screen opens on a month's latest spending
 * — and a running total down a newest-first list is a column of figures that add up to
 * nothing a reader wants.
 *
 * NO BY-METHOD BREAKDOWN either, which is a scope decision and not an oversight: what an
 * owner checks a month's spending against is a drawer of receipts, and receipts group by
 * what the money was for. The method is on every row for the day somebody wants to total
 * the cash that left the box; until somebody does, a second breakdown is a second thing
 * that has to keep adding up.
 *
 * Relative imports with the extension, like every other unit-tested module here: these
 * tests run under `node --test`, which resolves neither tsconfig paths nor extensionless
 * specifiers.
 */
import { sumTaka } from '../money.ts'
import type { ExpenseCategory, PaymentMethod } from '../supabase/types.ts'
import { EXPENSE_CATEGORIES, PAYROLL_CATEGORY } from './categories.ts'

/** One `expenses` row, as the screen queries it. */
export type ExpenseSourceRow = {
  id: string
  voucher_no: number
  category: ExpenseCategory
  /**
   * PostgREST serialises numeric as a string, so this is one — typed honestly rather than
   * as the number it is about to become, because a `Number()` that everybody remembers is
   * a `Number()` somebody eventually leaves out.
   */
  amount_bdt: string | number
  /** A `date` column, so already a Dhaka calendar day. See below for why that matters. */
  spent_on: string
  method: PaymentMethod
  reference: string | null
  note: string | null
  recurring: boolean
}

/** One line of the list. */
export type ExpenseRow = {
  id: string
  voucherNo: number
  category: ExpenseCategory
  /**
   * The day the money left, as it is stored.
   *
   * NOT PUT THROUGH `todayInDhaka`, and that is the difference between this screen and the
   * register. A payment carries `paid_at timestamptz`, so the register has to convert or a
   * payment taken at 1am is dated to the day before. `spent_on` is a `date` whose default
   * is `(now() at time zone 'Asia/Dhaka')::date` — the conversion already happened, in
   * Postgres, once. Converting it again here would treat a plain date as a UTC midnight
   * and hand back a day that is sometimes the one before.
   */
  date: string
  method: PaymentMethod
  reference: string | null
  note: string | null
  recurring: boolean
  /** Signed: negative on a correction, because the column has to add up by hand. */
  amount: number
  /**
   * Money that came back, or a figure entered wrong and cancelled.
   *
   * `expenses` admits a negative amount (`check (amount_bdt <> 0)`) and revokes DELETE, so
   * a negative row is the only way to correct a mistake — the same shape as a refund on
   * the register, and flagged here for the same reason: on a printed page a minus sign is
   * one character at the left of a right-aligned figure in a column that all look like it.
   */
  correction: boolean
  /**
   * In the category the profit line does not read. See the header.
   *
   * Carried on the row and not left to the page to compare against a string, so the one
   * place that decides what counts as payroll-side money is the one place that is tested.
   */
  deferredToPayroll: boolean
}

/**
 * The month's rows, parsed and flagged, in the order they arrived.
 *
 * Nothing is sorted here: the query orders by `spent_on desc, voucher_no desc` and the
 * screen prints them in that order, so re-sorting would be this module disagreeing with
 * the page about which month it is describing.
 */
export function expenseRows(
  rows: readonly ExpenseSourceRow[] | null | undefined,
): ExpenseRow[] {
  const out: ExpenseRow[] = []

  for (const e of rows ?? []) {
    const amount = Number(e.amount_bdt)
    // A row whose amount will not parse is dropped rather than counted as nothing, for
    // the reason the register drops one: a line reading "৳০" for money that did leave the
    // drawer is a wrong figure where an absent one would have been a question.
    if (!Number.isFinite(amount)) continue

    out.push({
      id: e.id,
      voucherNo: e.voucher_no,
      category: e.category,
      date: e.spent_on,
      method: e.method,
      reference: e.reference,
      note: e.note,
      recurring: e.recurring,
      amount,
      correction: amount < 0,
      deferredToPayroll: e.category === PAYROLL_CATEGORY,
    })
  }

  return out
}

/** One line of the breakdown at the foot. */
export type ExpenseCategoryTotal = {
  category: ExpenseCategory
  /** Net for this category: corrections written against it already taken off. */
  amount: number
  /** How many rows, corrections included. */
  entries: number
}

/** The figures at the foot. */
export type ExpenseTally = {
  /** Everything that left the drawer this month. Zero on an empty month. */
  total: number
  /**
   * The part `center_profit_month` subtracts as expenses: everything except the `salary`
   * category.
   */
  counted: number
  /**
   * The `salary`-category part, which that view leaves to the payroll side.
   *
   * Zero in most months, and shown only when it is not — the register's treatment of a
   * month with no refunds. When it is not zero it is the sentence this screen exists to be
   * able to say: this much of the month's spending is not in the profit figure as an
   * expense, and it is only in it at all if the same money was entered on the payroll
   * screen.
   */
  deferredToPayroll: number
  /** How many rows, corrections included. */
  entries: number
  /** In EXPENSE_CATEGORIES order, and only the categories the month actually used. */
  byCategory: ExpenseCategoryTotal[]
}

/**
 * The month added up two ways that have to agree.
 *
 * `counted` and `deferredToPayroll` are the two halves of `total`, summed once, here, from
 * the same rows — so the page can print three figures where the third is visibly the sum
 * of the first two, rather than three figures a reader has to take on faith. There is a
 * test that says they add up exactly.
 *
 * A CATEGORY THAT NETTED TO NOTHING STILL GETS ITS LINE, as on the register: ৳2,000 of
 * printing entered and the same ৳2,000 corrected away is not a month with no printing in
 * it, and an owner looking for that pair wants to find the line reading ৳0 rather than not
 * find it at all. Only a category with no rows whatever is left off.
 */
export function tallyExpenses(rows: readonly ExpenseRow[]): ExpenseTally {
  const counted = sumTaka(rows.filter((r) => !r.deferredToPayroll).map((r) => r.amount))
  const deferredToPayroll = sumTaka(
    rows.filter((r) => r.deferredToPayroll).map((r) => r.amount),
  )

  return {
    // Added from the two halves and not from the rows a third time: one of these three
    // figures is the sum of the other two on the page, so it is the sum of the other two
    // here.
    total: sumTaka([counted, deferredToPayroll]),
    counted,
    deferredToPayroll,
    entries: rows.length,
    byCategory: EXPENSE_CATEGORIES.map((category) => {
      const mine = rows.filter((r) => r.category === category)
      return { category, amount: sumTaka(mine.map((r) => r.amount)), entries: mine.length }
    }).filter((c) => c.entries > 0),
  }
}


