/**
 * What a recharge costs, what it is worth, and how many days it buys — MASTERPLAN §11.6
 * and §11.11, the arithmetic behind build-order step 25's screen.
 *
 * THE BONUS IS A ROW AND THIS FILE NEVER INVENTS ONE. §11.11: "written as a percentage in
 * code they become a number nobody can change without a deploy, and — worse — a number in
 * *two* places, because the recharge screen quotes it and the approval path credits it."
 * So the tiers arrive as an argument, read on the server from `public.promotions`, and
 * `bonusPoisha` below is the mirror of `app.bonus_poisha` — the same rule, in the second
 * engine that has to run it. `tests/recharge-quote.test.ts` holds the two together over
 * the founding ladder, which is the only thing that keeps a mirror honest.
 *
 * THE SUGGESTED AMOUNTS ARE MULTIPLES OF THE CENTRE'S OWN MONTHLY FIGURE. §11.6: owners
 * think in months, so one, three, six and twelve times what this centre pays. That is why
 * `monthlyPoisha` is a parameter and not a constant: a ৳2,600 centre is offered ৳7,800 and
 * an Institution at ৳4,999 is offered ৳14,997 for the same "three months", and both of
 * them are right.
 *
 * DAYS ARE DERIVED AND NEVER STORED. "About 94 days at your current size" is a division of
 * the credit by today's rate, and the screen re-derives it every day for exactly that
 * reason: a bonus is a percentage of money, not a grant of time (§11.6), so a centre that
 * triples in size has 20% more taka rather than 432 more days.
 *
 * Pure, and importable by `node --test`: relative imports with the extension, like every
 * other unit-tested module here.
 */

/**
 * One floor of a promotion: this many months reaches this many basis points (§11.6).
 *
 * Basis points and not percent, because 2.5% is not an integer and §11.6 has already
 * decided that floats have no place in the money path. 500 is five percent exactly.
 *
 * MONTHS, NOT TAKA, since the founder's decision of 2026-09-30 (migration
 * 20260811000088): `minMonths` is a count of the centre's OWN monthly figure, not an
 * absolute amount. The founding ladder floored at ৳7,800/৳15,600/৳31,200 — the worked
 * example's month — and a centre paying ৳2,099 a month pressed a button that said
 * "3 months" and was answered 0%; on Teacher Pro even twelve months missed the first
 * rung. A commitment to three months is three months whatever the tier charges for it,
 * so the ladder reads the months the money buys and not the taka it arrived in.
 */
export type BonusTier = {
  /** The whole months of the centre's own monthly figure this floor begins at. */
  minMonths: number
  bonusBps: number
}

/** One suggested amount, priced and explained for the screen. */
export type RechargeSuggestion = {
  /** What the label calls it — "3 months", derived rather than typed. */
  months: number
  payPoisha: number
  bonusPoisha: number
  creditPoisha: number
  /** Days at today's rate, or null where the rate is not a positive number. */
  days: number | null
}

/** A quote, whole: what is paid, what is gained, what it buys. */
export type RechargeQuote = {
  payPoisha: number
  bonusPoisha: number
  creditPoisha: number
  /** The bonus as a rate, for the words on the screen. Zero when no floor is reached. */
  bonusBps: number
  /** The next floor up and what it would pay, or null at the top. */
  nextTier: { extraPoisha: number; bonusBps: number } | null
  days: number | null
}

/** A money figure off a form or a column: floored, never negative, never NaN. */
function whole(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

/**
 * The bonus for an amount, in poisha, floored in the customer's favour.
 *
 * THE MIRROR OF `app.bonus_poisha`, and the two are the point of §11.11: the screen quotes
 * with this one and the founder's approval credits with the other, so a customer shown
 * ৳390 and given ৳3.90 would be a bug the second engine introduced. The test that holds
 * them together runs the same ladder through both.
 *
 * MONTHS ARE DERIVED FROM THE CENTRE'S OWN MONTHLY FIGURE, the third argument. `amount ÷
 * monthly`, FLOORED — in the customer's disfavour, deliberately: 2.9 months of money is
 * 2 months of commitment, and a centre that sends ৳7,799 against a ৳7,800 quote did not
 * buy the third month. The same flooring the SQL twin applies.
 *
 * A MONTHLY FIGURE THAT IS NOT A POSITIVE NUMBER BONUSES NOTHING rather than dividing by
 * it: a free tier has no months to buy, and a monthly figure nobody could read is not
 * evidence of a discount — the same fail-closed direction an unreadable count takes
 * everywhere else in §11.
 *
 * THE HIGHEST FLOOR THE MONTHS REACH WINS, whatever order the tiers were written in.
 * §11.6: "a typed amount gets the highest band it reaches, which is what the owner asked
 * for", so the list is read and never indexed.
 *
 * FLOORED AND NOT ROUNDED, the same direction `dailyRatePoisha` rounds: ৳7,800 × 5% is
 * ৳390 to the poisha, and ৳7,800.01 × 5% is 39,000.05 poisha, of which the customer keeps
 * the poisha. It also guarantees the credited bonus is an integer, which the ledger
 * demands.
 *
 * A NEGATIVE OR MALFORMED TIER CONTRIBUTES NOTHING rather than throwing: this runs inside
 * a screen an owner is looking at, and a promotion somebody typed wrong must not be able
 * to stop a recharge being quoted.
 */
export function bonusPoisha(
  tiers: readonly BonusTier[],
  amountPoisha: number,
  monthlyPoisha: number,
): number {
  const amount = whole(amountPoisha)
  const monthly = whole(monthlyPoisha)
  if (amount <= 0 || monthly <= 0) return 0

  const months = Math.floor(amount / monthly)

  let best = 0
  for (const tier of tiers) {
    if (!Number.isFinite(tier.minMonths) || !Number.isFinite(tier.bonusBps)) continue
    if (tier.minMonths <= 0 || tier.bonusBps <= 0) continue
    if (months < Math.floor(tier.minMonths)) continue
    best = Math.max(best, tier.bonusBps)
  }

  return Math.floor((amount * best) / 10000)
}

/** The rate the amount reached, which is what the screen prints beside the gift. */
export function reachedBonusBps(
  tiers: readonly BonusTier[],
  amountPoisha: number,
  monthlyPoisha: number,
): number {
  const amount = whole(amountPoisha)
  const monthly = whole(monthlyPoisha)
  if (amount <= 0 || monthly <= 0) return 0

  const months = Math.floor(amount / monthly)

  let best = 0
  for (const tier of tiers) {
    if (!Number.isFinite(tier.minMonths) || !Number.isFinite(tier.bonusBps)) continue
    if (tier.minMonths <= 0 || tier.bonusBps <= 0) continue
    if (months < Math.floor(tier.minMonths)) continue
    best = Math.max(best, tier.bonusBps)
  }

  return best
}

/**
 * The floor above the amount, and what reaching it costs.
 *
 * §11.6 sells a discount ladder, and a ladder has a next rung: "৳2,000 more and this
 * becomes 10%" is the sentence that makes a typed ৳5,000 into a sent ৳7,800. Null at the
 * top, where there is nothing left to climb.
 *
 * The difference is quoted from the floor itself rather than from a rounded figure, so
 * "add ৳2,800" is exactly what it takes — a reader who does that arithmetic against the
 * amount they typed gets the number on the screen.
 */
export function nextTier(
  tiers: readonly BonusTier[],
  amountPoisha: number,
  monthlyPoisha: number,
): { extraPoisha: number; bonusBps: number } | null {
  const amount = whole(amountPoisha)
  const monthly = whole(monthlyPoisha)
  if (monthly <= 0) return null

  const months = Math.floor(amount / monthly)
  const current = reachedBonusBps(tiers, amount, monthly)

  const ahead = tiers
    .filter(
      (tier) =>
        Number.isFinite(tier.minMonths)
        && Number.isFinite(tier.bonusBps)
        && tier.minMonths > 0
        && tier.bonusBps > current
        && Math.floor(tier.minMonths) > months,
    )
    .sort((a, b) => a.minMonths - b.minMonths)[0]

  if (!ahead) return null

  return {
    // Quoted from the floor itself: the money that reaches `minMonths` whole
    // months, less what was typed. A reader doing the arithmetic against the
    // monthly figure lands on the number on the screen.
    extraPoisha: Math.max(0, Math.floor(ahead.minMonths) * monthly - amount),
    bonusBps: ahead.bonusBps,
  }
}

/**
 * Days at today's rate, floored, or null when there is no rate to divide by.
 *
 * NULL AND NOT ZERO, and the distinction is the one `dailyRatePoisha` already draws: the
 * free tier's rate is zero by construction and buys no days at all, while a rate that
 * could not be read is a number nobody has. Zero would print "0 days" to a centre that
 * just sent us money.
 */
export function daysOfCredit(creditPoisha: number, dailyRatePoisha: number | null): number | null {
  if (dailyRatePoisha === null || !Number.isFinite(dailyRatePoisha) || dailyRatePoisha <= 0) {
    return null
  }
  return Math.floor(whole(creditPoisha) / dailyRatePoisha)
}

/** The quote for one amount, at one size. */
export function rechargeQuote(input: {
  amountPoisha: number
  tiers: readonly BonusTier[]
  /** The centre's own monthly figure, in poisha — what the months are counted from. */
  monthlyPoisha: number
  dailyRatePoisha: number | null
}): RechargeQuote {
  const payPoisha = whole(input.amountPoisha)
  const monthly = whole(input.monthlyPoisha)
  const bonus = bonusPoisha(input.tiers, payPoisha, monthly)
  const creditPoisha = payPoisha + bonus

  return {
    payPoisha,
    bonusPoisha: bonus,
    creditPoisha,
    bonusBps: reachedBonusBps(input.tiers, payPoisha, monthly),
    nextTier: nextTier(input.tiers, payPoisha, monthly),
    days: daysOfCredit(creditPoisha, input.dailyRatePoisha),
  }
}

/**
 * The four amounts to offer: one, three, six and twelve times this centre's month.
 *
 * §11.6's own ladder, and the months are the label rather than the unit being sold — the
 * customer buys taka and the days are a division of it. A centre whose monthly figure
 * cannot be read gets an empty list, because a suggestion derived from a missing number
 * is a wrong amount to send somebody's money for.
 *
 * THE OFFER IS NEVER EMPTY OF THE LADDER ITSELF: what is missing when the bonus tiers do
 * not read is the discount, not the amounts, and an owner with no promotion live still
 * needs to be told what a month costs.
 */
export function rechargeSuggestions(
  monthlyPoisha: number,
  tiers: readonly BonusTier[],
  dailyRatePoisha: number | null,
): RechargeSuggestion[] {
  const monthly = whole(monthlyPoisha)
  if (monthly <= 0) return []

  return [1, 3, 6, 12].map((months) => {
    const quote = rechargeQuote({
      amountPoisha: monthly * months,
      tiers,
      monthlyPoisha: monthly,
      dailyRatePoisha,
    })
    return {
      months,
      payPoisha: quote.payPoisha,
      bonusPoisha: quote.bonusPoisha,
      creditPoisha: quote.creditPoisha,
      days: quote.days,
    }
  })
}

/**
 * The tier list off a `promotions.tiers` column, as this module wants it.
 *
 * `unknown` in, because a `jsonb` column is `Json` in the generated types and that is not
 * the same promise as this shape — the same asymmetry `readPricedLines` documents. A
 * malformed entry is dropped rather than refused: the row is only ever written by a
 * migration, so a bad one is a deployment error, and the correct response to it on a
 * customer's screen is to quote no bonus rather than to show them a stack trace.
 */
export function readBonusTiers(value: unknown): BonusTier[] {
  if (!Array.isArray(value)) return []

  const tiers: BonusTier[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const tier = raw as Record<string, unknown>
    const minMonths = tier.min_months
    const bonusBps = tier.bonus_bps
    if (typeof minMonths !== 'number' || !Number.isFinite(minMonths)) continue
    if (typeof bonusBps !== 'number' || !Number.isFinite(bonusBps)) continue
    tiers.push({ minMonths, bonusBps })
  }

  return tiers
}
