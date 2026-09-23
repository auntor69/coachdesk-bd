/**
 * The customer's own view of the ledger — MASTERPLAN §20.4's fifth question,
 * "what has happened to my money", and §11.12's "the billing history screen can show
 * the count each day was charged at".
 *
 * PURE, AND IMPORTABLE BY `node --test`. Nothing here reaches PostgREST: the rows are
 * read by the page and handed in, exactly as `recharge.ts` prices a quote it did not
 * fetch. That is what lets the collapse be tested against the five shapes the ledger
 * actually writes — a day, a day topped up, a month boundary, a grant, a failed
 * settlement — without a database.
 *
 * WHY A DAY IS COLLAPSED FROM ITS ROWS AND NOT READ. §11.7 tops a day up when the roster
 * grows at noon, so one Dhaka day can be a base `daily_charge` and a second
 * `daily_charge` flagged `top_up`. A screen that drew the rows would show an owner two
 * lines for one day and a count that disagreed between them; what they paid for is the
 * *day*, so the two are summed here and the day is shown once, at the high-water count
 * the top-up records.
 *
 * THE COUNT A DAY CARRIES IS ITS HIGH-WATER, and it is read off the row rather than
 * looking the roster up again. §11.12: the count that was charged is a fact about the
 * day it was charged on, and a student who left in October must not change what
 * September cost. `max` across the day's rows is that fact — the base carries the
 * morning's size and the top-up the larger one, so the day is priced from the peak.
 *
 * NULL IS NOT ZERO, once more. A charge whose usage columns could not be read keeps
 * `null`, and the screen prints a dash, because a day drawn as "0 students, ৳0" is a
 * day the customer cannot reconcile against the money that actually left.
 */

import { addDays } from '../bd/time.ts'
import type { BillingEntryKind } from '../supabase/types.ts'

/**
 * One `billing_ledger` row, normalised for a screen.
 *
 * `metadata` is dropped in favour of the one fact a customer reads out of it — the days
 * behind a grant — so no `jsonb` shape reaches a component. See `daysOf` for why that is
 * the only key worth lifting.
 */
export type LedgerEntry = {
  id: string
  kind: BillingEntryKind
  /** Signed, as the ledger stores it: positive in, negative out. */
  amountPoisha: number
  /** The running total after this entry, as the trigger chained it. */
  balanceAfter: number
  /** The Dhaka day a charge is *about*, or null on every other kind. */
  chargeDate: string | null
  students: number | null
  teachers: number | null
  branches: number | null
  /** The sentence a founder's lever or a migration wrote, or null. */
  description: string | null
  /** `metadata.days` — what a granted-days entry actually gave, or null. */
  days: number | null
  createdAt: string
  topUp: boolean
  /** The receipt behind a recharge, when there is one. */
  paymentId: string | null
}

/** One Dhaka day, its rows summed, its count taken at the peak. */
export type LedgerDay = {
  date: string
  /** Whole poisha spent on the day, positive. */
  costPoisha: number
  students: number | null
  teachers: number | null
  branches: number | null
  /**
   * Whether the day was charged again as the roster grew (§11.7).
   *
   * This is the one thing about a day a customer cannot work out from the numbers: a day
   * whose cost is higher than its count suggests is a day that was topped up, and without
   * the flag that reads as a miscalculation rather than as the rule working.
   */
  toppedUp: boolean
}

/** One month of days, which is the line §20.4 asks for: "September: 30 days, ৳2,600". */
export type LedgerMonth = {
  /** `YYYY-MM`, the grouping key. */
  month: string
  days: number
  costPoisha: number
  rows: LedgerDay[]
}

/** What the screen sums above the history, so an owner can check it against a statement. */
export type LedgerTotals = {
  /** Every day charged, positive. */
  chargedPoisha: number
  /** Money that actually arrived (`recharge`), positive. */
  rechargedPoisha: number
  /** The promotion gift on top of it (`promotion_bonus`), positive. Not revenue. */
  bonusPoisha: number
  /** Founder money adjustments, signed — negative when a balance was corrected down. */
  adjustedPoisha: number
  /** Money handed back out of the balance (`refund`), positive. */
  refundedPoisha: number
  /** Days given rather than sold (`founder_grant_days`). */
  grantedDays: number
}

/** The whole fifth question, split into the four things it can show. */
export type LedgerHistory = {
  months: LedgerMonth[]
  /** Recharges, bonuses, adjustments, refunds, reversals and corrections, newest first. */
  money: LedgerEntry[]
  /** Granted days, newest first, each with the founder's reason. */
  grants: LedgerEntry[]
  /** Days that could not be charged and the retries after them (§11.13). */
  failures: LedgerEntry[]
  /** The opening rows, which carry no money and are not shown. */
  ignored: number
  totals: LedgerTotals
}

/** The last Dhaka day the balance still covers, or null when there is no rate to divide by. */
export function coversToDay(
  chargedThrough: string | null,
  daysLeft: number | null,
): string | null {
  if (chargedThrough === null || daysLeft === null) return null
  return addDays(chargedThrough, daysLeft)
}

/** A number off a `jsonb` column, or null for anything that is not one. */
export function daysOf(metadata: unknown): number | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return null
  }
  const value = (metadata as Record<string, unknown>).days
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A number off a row, or null — an unreadable count is not a zero. */
function countOf(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The higher of two counts, where either may be missing.
 *
 * A day's peak, because the base row carries the morning's size and the top-up the one it
 * grew to. An absent figure never beats a present one — a day with a base count of 60 and
 * a top-up whose snapshot failed still shows 60 rather than a dash.
 */
function peak(current: number | null, value: number | null): number | null {
  if (value === null) return current
  if (current === null) return value
  return Math.max(current, value)
}

/**
 * The history, from the rows as read.
 *
 * Order is the screen's: months newest first, days newest first inside them, money and
 * grants newest first. The rows arrive newest-first from the page, but the sort is done
 * here anyway so a caller that read them in any other order still draws the same screen —
 * a history that reordered itself depending on how it was fetched is a history nobody can
 * diff.
 */
export function collapseHistory(entries: readonly LedgerEntry[]): LedgerHistory {
  const byDate = new Map<string, LedgerDay>()
  const money: LedgerEntry[] = []
  const grants: LedgerEntry[] = []
  const failures: LedgerEntry[] = []
  let ignored = 0

  let rechargedPoisha = 0
  let bonusPoisha = 0
  let adjustedPoisha = 0
  let refundedPoisha = 0
  let grantedDays = 0

  for (const entry of entries) {
    switch (entry.kind) {
      case 'daily_charge': {
        // A charge is about a day by constraint; a row without one cannot be placed in a
        // month, and placing it at today would invent the date it was for.
        if (entry.chargeDate === null) {
          ignored += 1
          break
        }
        const day = byDate.get(entry.chargeDate) ?? {
          date: entry.chargeDate,
          costPoisha: 0,
          students: null,
          teachers: null,
          branches: null,
          toppedUp: false,
        }
        if (entry.topUp) day.toppedUp = true
        // The magnitude: a charge is negative by `billing_ledger_amount_sign`, and a
        // history that printed the ledger's own sign would read as money we owe.
        day.costPoisha += Math.abs(entry.amountPoisha)
        day.students = peak(day.students, countOf(entry.students))
        day.teachers = peak(day.teachers, countOf(entry.teachers))
        day.branches = peak(day.branches, countOf(entry.branches))
        byDate.set(entry.chargeDate, day)
        break
      }
      case 'recharge':
        rechargedPoisha += entry.amountPoisha
        money.push(entry)
        break
      case 'promotion_bonus':
        bonusPoisha += entry.amountPoisha
        money.push(entry)
        break
      case 'founder_money_adjustment':
        adjustedPoisha += entry.amountPoisha
        money.push(entry)
        break
      case 'refund':
        refundedPoisha += Math.abs(entry.amountPoisha)
        money.push(entry)
        break
      case 'reversal':
      case 'correction':
        money.push(entry)
        break
      case 'founder_grant_days':
        grantedDays += entry.days ?? 0
        grants.push(entry)
        break
      case 'settlement_failure':
      case 'settlement_retry':
        failures.push(entry)
        break
      case 'migration_opening_balance':
        // §11.14's opening zero: real, and never a line a customer needs to read.
        ignored += 1
        break
    }
  }

  const months = new Map<string, LedgerDay[]>()
  let chargedPoisha = 0
  for (const day of byDate.values()) {
    chargedPoisha += day.costPoisha
    const month = day.date.slice(0, 7)
    const rows = months.get(month) ?? []
    rows.push(day)
    months.set(month, rows)
  }

  const newestFirst = (a: LedgerEntry, b: LedgerEntry) =>
    b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)

  return {
    months: [...months.entries()]
      .map(([month, rows]) => ({
        month,
        days: rows.length,
        costPoisha: rows.reduce((sum, row) => sum + row.costPoisha, 0),
        rows: [...rows].sort((a, b) => b.date.localeCompare(a.date)),
      }))
      // `localeCompare` on `YYYY-MM` is chronological, and on `YYYY-MM-DD` too, which is
      // why the keys are stored in that order rather than as dates.
      .sort((a, b) => b.month.localeCompare(a.month)),
    money: [...money].sort(newestFirst),
    grants: [...grants].sort(newestFirst),
    failures: [...failures].sort(newestFirst),
    ignored,
    totals: {
      chargedPoisha,
      rechargedPoisha,
      bonusPoisha,
      adjustedPoisha,
      refundedPoisha,
      grantedDays,
    },
  }
}
