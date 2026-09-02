/**
 * What a purchase costs, computed from facts the server read rather than numbers a
 * browser sent.
 *
 * MASTERPLAN §11.4 is a table of five things a request may never carry, and four of
 * them are inputs to this file: the amount, the plan, the student capacity and the
 * entitlement. So none of them are parameters a caller can invent — the plan arrives
 * as a `PlanLimits` looked up from `coaching_centers.plan`, the capacity as the
 * `student_capacity` column, and the amount is the return value. What a request MAY
 * carry is a quantity: "forty places", "twelve months". That is a wish, not a price.
 *
 * Every figure here comes out of ../plans.ts, which is where the price list lives and
 * what the monthly bill already reads. A second copy of ৳18 in this file would be a
 * quote that drifts from the invoice, and the customer would be the one to notice.
 *
 * Pure, and importable by `node --test`: nothing here reaches a database. Relative
 * imports with the extension, like every other unit-tested module.
 */

import { coverageEnd, isMonthsCovered, type MonthsCovered } from '../platform/billing.ts'
import {
  CENTER_TEACHER_SEAT_BDT,
  INSTITUTION_BRANCH_BDT,
  branchChargeBdt,
  capacityBands,
  capacityCostBdt,
  monthlyBillBdt,
  studentCeiling,
  teacherChargeBdt,
  type PlanLimits,
} from '../plans.ts'
import type { PaymentPurpose } from '../supabase/types.ts'

/**
 * One line of the breakdown, in the units the customer thinks in.
 *
 * `count` is what is BILLABLE and not what was asked for, which is the same
 * distinction `quoteSeats` draws: a centre buying its second branch is buying one
 * branch and paying for none of it, and a line saying "1 branch at ৳0" is a clearer
 * answer than a total of zero with nothing above it.
 */
/** The four units a line may count in, as one list so the reader and the labels agree. */
export const QUOTE_UNITS = ['places', 'seats', 'branches', 'months'] as const

export type QuoteUnit = (typeof QUOTE_UNITS)[number]

export type QuoteLine = {
  what: QuoteUnit
  count: number
  rateBdt: number
  costBdt: number
}

export type Quote = {
  purpose: PaymentPurpose
  /** What was bought, in whole units. Zero means there is nothing to sell. */
  quantity: number
  amountBdt: number
  /** Places this adds to the ceiling, and only ever on a capacity purchase. */
  grantsCapacity: number
  coversPeriodStart: string | null
  coversPeriodEnd: string | null
  lines: QuoteLine[]
}

export type PurchaseRequest =
  | {
      purpose: 'subscription'
      plan: PlanLimits
      activeStudents: number
      activeTeachers: number
      activeBranches: number
      months: number
      /** First day of the first month covered, `YYYY-MM-DD`. */
      from: string
    }
  | {
      purpose: 'student_capacity'
      plan: PlanLimits
      /** `coaching_centers.student_capacity`, which is an absolute ceiling. */
      purchasedCapacity: number
      places: number
    }
  | {
      purpose: 'teacher_seat'
      activeTeachers: number
      seats: number
    }
  | {
      purpose: 'branch'
      plan: PlanLimits
      activeBranches: number
      branches: number
    }

/** Nothing to sell. Never an error: a dialog opened on a centre with room lands here. */
function none(purpose: PaymentPurpose): Quote {
  return {
    purpose,
    quantity: 0,
    amountBdt: 0,
    grantsCapacity: 0,
    coversPeriodStart: null,
    coversPeriodEnd: null,
    lines: [],
  }
}

/** A count out of a form: floored, never negative, never NaN. */
function whole(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

/**
 * The price of one purchase, and the lines that explain it.
 *
 * A zero `quantity` is the answer to every request that has nothing behind it — a
 * teacher tier asking for places, a paste that fits, a month on the free plan. The
 * caller refuses it; `payment_intents` would refuse it too, since both columns are
 * `> 0`, but a check constraint is a stack trace and this is a sentence.
 */
export function priceIntent(request: PurchaseRequest): Quote {
  switch (request.purpose) {
    case 'subscription':
      return subscription(request)
    case 'student_capacity':
      return capacity(request)
    case 'teacher_seat':
      return seats(request)
    case 'branch':
      return branches(request)
  }
}

/**
 * Months of the plan the centre is already on.
 *
 * The bill is recomputed here rather than read off a stored figure, because it moves
 * with the roster: a centre that grew between two payments owes more than it did, and
 * a price quoted from last month's snapshot is a discount nobody granted.
 *
 * `MONTHS_COVERED` is the same closed list the founder panel offers (§11.5), so a
 * subscription intent cannot cover seven months when no receipt can.
 */
function subscription(
  request: Extract<PurchaseRequest, { purpose: 'subscription' }>,
): Quote {
  const months = whole(request.months)
  if (!isMonthsCovered(months)) return none('subscription')

  const perMonth = monthlyBillBdt(
    request.plan,
    request.activeStudents,
    request.activeTeachers,
    request.activeBranches,
  )
  if (perMonth <= 0) return none('subscription')

  // Rejected here rather than by the date column: `covers_period_start` is a date and
  // 'tomorrow' would land as null, which is a subscription intent covering nothing.
  const from = firstOfMonth(request.from)
  if (!from) return none('subscription')

  return {
    purpose: 'subscription',
    quantity: months,
    amountBdt: perMonth * months,
    grantsCapacity: 0,
    coversPeriodStart: from,
    coversPeriodEnd: coverageEnd(from, months as MonthsCovered),
    lines: [{ what: 'months', count: months, rateBdt: perMonth, costBdt: perMonth * months }],
  }
}

/**
 * `YYYY-MM-01`, or null if the string is not a date.
 *
 * Snapped to the first rather than refused, because every coverage window this product
 * sells is whole months — `coverageEnd` subtracts a day from a month boundary, so a
 * `from` of the 14th would produce "covered through the 13th", which is not a period
 * anybody bills.
 */
function firstOfMonth(isoDate: string): string | null {
  const parts = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(isoDate)
  return parts ? `${parts[1]}-${parts[2]}-01` : null
}

/**
 * Places above the ceiling the centre already has.
 *
 * Measured from `studentCeiling`, which is `greatest(what the floor included, what has
 * been bought)` — the same reading `app.student_ceiling` gives a purchase, and
 * deliberately not the trial-aware one the capacity trigger admits by. Measuring
 * from `student_capacity` alone would sell a fresh centre the 79 places its ৳1,999
 * already paid for.
 *
 * A teacher tier gets a zero quote. Its ceiling comes from the plan and no amount of
 * money moves it, so a price here would be a Pay button that cannot be honoured —
 * `settle_payment_intent` refuses the same purchase from the other end.
 */
function capacity(
  request: Extract<PurchaseRequest, { purpose: 'student_capacity' }>,
): Quote {
  const places = whole(request.places)
  if (places === 0) return none('student_capacity')

  const ceiling = studentCeiling(request.plan, request.purchasedCapacity)
  if (ceiling.kind === 'plan') return none('student_capacity')

  const to = ceiling.ceiling + places
  return {
    purpose: 'student_capacity',
    quantity: places,
    amountBdt: capacityCostBdt(ceiling.ceiling, to),
    grantsCapacity: places,
    coversPeriodStart: null,
    coversPeriodEnd: null,
    lines: capacityBands(ceiling.ceiling, to).map((band) => ({
      what: 'places' as const,
      count: band.seats,
      rateBdt: band.rateBdt,
      costBdt: band.costBdt,
    })),
  }
}

/**
 * Teacher seats beyond the two every paid tier includes.
 *
 * A difference of `teacherChargeBdt` and not `seats × ৳100`, so a centre with one
 * teacher hiring a second is charged nothing and the included seats are stated in one
 * place.
 */
function seats(request: Extract<PurchaseRequest, { purpose: 'teacher_seat' }>): Quote {
  const wanted = whole(request.seats)
  if (wanted === 0) return none('teacher_seat')

  const now = whole(request.activeTeachers)
  const cost = teacherChargeBdt(now + wanted) - teacherChargeBdt(now)
  const billable = cost / CENTER_TEACHER_SEAT_BDT

  return {
    purpose: 'teacher_seat',
    quantity: wanted,
    amountBdt: cost,
    grantsCapacity: 0,
    coversPeriodStart: null,
    coversPeriodEnd: null,
    lines:
      billable > 0
        ? [
            {
              what: 'seats',
              count: billable,
              rateBdt: CENTER_TEACHER_SEAT_BDT,
              costBdt: cost,
            },
          ]
        : [],
  }
}

/**
 * Branches beyond the three an Institution includes.
 *
 * Zero on any tier without `multipleBranches`, inherited from `branchChargeBdt`: those
 * tiers cannot create a second branch at all, so there is nothing to sell rather than
 * something to refuse.
 */
function branches(request: Extract<PurchaseRequest, { purpose: 'branch' }>): Quote {
  const wanted = whole(request.branches)
  if (wanted === 0) return none('branch')

  const now = whole(request.activeBranches)
  const cost =
    branchChargeBdt(request.plan, now + wanted) - branchChargeBdt(request.plan, now)
  const billable = cost / INSTITUTION_BRANCH_BDT

  return {
    purpose: 'branch',
    quantity: wanted,
    amountBdt: cost,
    grantsCapacity: 0,
    coversPeriodStart: null,
    coversPeriodEnd: null,
    lines:
      billable > 0
        ? [
            {
              what: 'branches',
              count: billable,
              rateBdt: INSTITUTION_BRANCH_BDT,
              costBdt: cost,
            },
          ]
        : [],
  }
}

/**
 * The same lines as `payment_intents.priced_lines` holds them — MASTERPLAN §3.8's "rate
 * applied", which 20260811000068 made a column because it cannot be recomputed later.
 *
 * SNAKE_CASE BECAUSE A CHECK CONSTRAINT READS THESE NAMES. `app.priced_lines_explain`
 * looks for `cost_bdt` in SQL, so the keys are part of the schema and follow the schema's
 * spelling. That costs the two functions below and buys a document whose field names mean
 * the same thing in a psql session as in the generated types.
 */
export type PricedLine = {
  what: QuoteUnit
  count: number
  rate_bdt: number
  cost_bdt: number
}

/** A quote's breakdown, ready to store. */
export function pricedLines(lines: readonly QuoteLine[]): PricedLine[] {
  return lines.map((line) => ({
    what: line.what,
    count: line.count,
    rate_bdt: line.rateBdt,
    cost_bdt: line.costBdt,
  }))
}

/**
 * A stored breakdown, read back. `unknown` in, because a `jsonb` column is `Json` in the
 * generated types and that is not the same promise as this shape.
 *
 * ALL OR NOTHING, like the constraint: one malformed line refuses the document. A receipt
 * printing three of four bands would total less than the amount beside it, and a customer
 * doing that subtraction gets a wrong answer about their own money.
 *
 * THE ARITHMETIC IS NOT RE-CHECKED HERE, only the shape. That the lines add up is
 * `payment_intents_priced_lines_explain`'s promise, enforced on the way in against the
 * amount the constraint could see; re-testing it here in floats against the amount on the
 * `payments` row would eventually hide a true breakdown behind a paisa. What this does
 * guard is what SQL cannot: that no field arrives as a string or a `NaN` and reaches
 * `formatTaka`, which prints those as "৳0" and is three call sites from the cause.
 */
export function readPricedLines(value: unknown): QuoteLine[] {
  if (!Array.isArray(value) || value.length === 0) return []

  const lines: QuoteLine[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return []
    const line = raw as Record<string, unknown>

    const what = line.what
    const count = line.count
    const rateBdt = line.rate_bdt
    const costBdt = line.cost_bdt
    if (!QUOTE_UNITS.some((unit) => unit === what)) return []
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return []
    if (typeof rateBdt !== 'number' || !Number.isFinite(rateBdt) || rateBdt < 0) return []
    if (typeof costBdt !== 'number' || !Number.isFinite(costBdt) || costBdt < 0) return []

    lines.push({ what: what as QuoteUnit, count, rateBdt, costBdt })
  }

  return lines
}
