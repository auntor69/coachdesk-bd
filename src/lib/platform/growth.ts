/**
 * Six months of the business, in one pure function.
 *
 * WHY THIS IS NOT COMPUTED IN THE PAGE. The first version was, and it was wrong in a way that
 * renders perfectly: the month list is period months (`YYYY-MM-01`) and `created_at` is a
 * timestamptz, so the comparison `created_at.slice(0, 7) === month` matched nothing and every
 * month drew as a row of zeros. A screen of zeros looks like a business that stopped, not like
 * a bug — which is the same reason `collapseHistory` in lib/billing/history.ts is a module with
 * tests rather than a `.map` inside a component.
 *
 * THE SECOND THING THIS FILE GETS RIGHT IS THE MONTH ITSELF. Every date in this product is a
 * Dhaka date, and the burn is charged on Dhaka days, so a row at 1am on the first of the month
 * is the *previous* month in UTC. Grouping by `created_at.slice(0, 7)` would move six hours of
 * every month into the month before, which is a small error in a big number — the kind that
 * survives review. The grouping key is `todayInDhaka(created_at).slice(0, 7)`.
 *
 * WHAT COUNTS AS MONEY, and why only two kinds are in each column. Money in is a `recharge` and
 * the `promotion_bonus` it earned; money out is a `daily_charge` (§11.6 — the ledger is the only
 * table that holds both directions of every taka). A granted day carries no money, an
 * adjustment, a refund and a reversal are corrections to a month whose recharges are already
 * counted, and a failed settlement is a refusal. Counting a correction as income would make a
 * mistake look like growth.
 *
 * Relative imports with the extension, like every other unit-tested module here: these tests run
 * under `node --test`, which resolves neither tsconfig paths nor extensionless specifiers.
 */

import { addMonths, currentPeriodMonth, todayInDhaka } from '../bd/time.ts'
import type { BillingEntryKind } from '../supabase/types.ts'

/** One month of the growth table. Poisha, signed the way the table reads rather than the row. */
export type GrowthMonth = {
  /** `YYYY-MM-01`, the shape `formatMonth` renders and `period_month` uses. */
  month: string
  /** Customers whose centre was created in this Dhaka month. */
  signups: number
  /** Recharges plus their bonuses, positive. */
  rechargedPoisha: number
  /** Days charged, positive — the ledger stores them negative. */
  burnedPoisha: number
}

/**
 * The months to draw, oldest first, this one last.
 *
 * `count` months back from `thisMonth`, inclusive of it: six means the current month and the
 * five before it. Built from the clock rather than from the rows, so a month with no money in
 * it is a row of zeros instead of a gap — a missing row in a growth table reads as a month that
 * was never billed.
 */
export function monthKeys(thisMonth = currentPeriodMonth(), count = 6): string[] {
  if (count <= 0) return []
  const first = addMonths(thisMonth, -(count - 1))
  return Array.from({ length: count }, (_, i) => addMonths(first, i))
}

/** What counts as money in. The bonus rides along because it is credit on the same purchase. */
const MONEY_IN: readonly BillingEntryKind[] = ['recharge', 'promotion_bonus']

/**
 * The table's six rows, from the rows that make them up.
 *
 * `entries` is expected to be one read of the last few months of `billing_ledger`, in any
 * order; anything outside the window in `months` is ignored rather than refused, so the caller
 * can pass a slightly wider read than it needs.
 */
export function growthByMonth(input: {
  months: readonly string[]
  /** Every customer's `created_at`, ISO. Nulls are rows a partial read could not date. */
  signedUpAt: readonly (string | null)[]
  entries: readonly {
    kind: BillingEntryKind
    amount_poisha: number
    created_at: string
  }[]
}): GrowthMonth[] {
  const keys = input.months.map((month) => month.slice(0, 7))
  const index = new Map(keys.map((key, i) => [key, i]))

  const rows: GrowthMonth[] = input.months.map((month) => ({
    month,
    signups: 0,
    rechargedPoisha: 0,
    burnedPoisha: 0,
  }))

  for (const iso of input.signedUpAt) {
    if (iso === null) continue
    const at = new Date(iso)
    // An unparseable timestamp is not a signup in January 1970; it is a row nobody can place,
    // and counting it anywhere would be inventing a month.
    if (Number.isNaN(at.getTime())) continue
    const i = index.get(todayInDhaka(at).slice(0, 7))
    if (i !== undefined) rows[i]!.signups += 1
  }

  for (const entry of input.entries) {
    const at = new Date(entry.created_at)
    if (Number.isNaN(at.getTime())) continue
    const i = index.get(todayInDhaka(at).slice(0, 7))
    if (i === undefined) continue

    const row = rows[i]!
    if (MONEY_IN.includes(entry.kind)) {
      row.rechargedPoisha += entry.amount_poisha
    } else if (entry.kind === 'daily_charge') {
      // Stored negative — a day costs the customer money — and drawn positive, because it is
      // an amount spent rather than a balance that went down.
      row.burnedPoisha += -entry.amount_poisha
    }
  }

  return rows
}
