import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

import {
  bonusPoisha,
  daysOfCredit,
  nextTier,
  reachedBonusBps,
  rechargeQuote,
  rechargeSuggestions,
  readBonusTiers,
  type BonusTier,
} from '../src/lib/billing/recharge.ts'

/**
 * MASTERPLAN §11.6's ladder, twice: once in TypeScript and once in SQL.
 *
 * THE DUPLICATION IS THE SUBJECT OF THIS FILE, not an accident in it. §11.11 explains why
 * the bonus has to exist in two engines — the screen quotes it in TypeScript, the founder's
 * approval credits it in `app.bonus_poisha`, and the row it comes from is written by a
 * migration. `tests/price-versions.test.ts` closes the same problem for the price card by
 * parsing the seed statement out of the `.sql` file, and this is that test again over the
 * founding promotion: the tiers are read from the migration, so a ladder edited in one
 * place and not the other fails here rather than in a customer's balance.
 *
 * The worked figures are §11.6's own table — ৳2,600 a month, ৳7,800 for three months and
 * ৳8,190 of credit, "about 94 days at your current size" — and they are asserted as
 * literals for the reason every other money test in this repo does: a suite that computes
 * its expectations with the code under test agrees with an off-by-one.
 */

const FOUNDING: BonusTier[] = [
  { minMonths: 3, bonusBps: 500 },
  { minMonths: 6, bonusBps: 1000 },
  { minMonths: 12, bonusBps: 2000 },
]

/** ৳2,600 a month is 8,666 poisha a day — the masterplan's own worked rate. */
const DAILY = 8_666

test('the founding ladder is the founder\'s month-anchored three tiers', () => {
  assert.deepEqual(FOUNDING, [
    { minMonths: 3, bonusBps: 500 },
    { minMonths: 6, bonusBps: 1000 },
    { minMonths: 12, bonusBps: 2000 },
  ])
})

test('§11.6\'s four suggested amounts, priced', () => {
  const month = 260_000
  const suggestions = rechargeSuggestions(month, FOUNDING, DAILY)

  assert.deepEqual(
    suggestions.map((s) => [s.months, s.payPoisha, s.bonusPoisha, s.creditPoisha, s.days]),
    [
      // One month carries no bonus, and the table says so with a dash where the others
      // have a percentage.
      [1, 260_000, 0, 260_000, 30],
      [3, 780_000, 39_000, 819_000, 94],
      [6, 1_560_000, 156_000, 1_716_000, 198],
      [12, 3_120_000, 624_000, 3_744_000, 432],
    ],
  )
})

test('the ladder is the centre\'s own months, not the worked example\'s taka', () => {
  // THE CASE THE FOUNDER FOUND. The absolute ladder floored at ৳7,800 — the worked
  // example's three months — so a centre paying ৳2,099 a month pressed a button that
  // said three months and was answered 0%. Month-anchored, the same button is true
  // on every tier: 3 × 2,099 = 5% and 1 × 2,099 is nothing.
  const month = 209_900
  const suggestions = rechargeSuggestions(month, FOUNDING, Math.floor(month / 30))

  assert.deepEqual(
    suggestions.map((s) => [s.months, s.bonusPoisha]),
    [
      [1, 0],
      [3, 31_485],
      [6, 125_940],
      [12, 503_760],
    ],
  )
})

test('and a Teacher Pro month is priced by the same ladder', () => {
  // The absolute ladder could never have served this tier at all: 12 × ৳499 =
  // ৳5,988 never reached the first ৳7,800 floor. Months make the offer real.
  const month = 49_900
  const suggestions = rechargeSuggestions(month, FOUNDING, Math.floor(month / 30))

  assert.deepEqual(
    suggestions.map((s) => [s.months, s.bonusPoisha]),
    [
      [1, 0],
      [3, 7_485],
      [6, 29_940],
      [12, 119_760],
    ],
  )
})

test('the bonus is a percentage of money and never a grant of days', () => {
  // The 12-month figure re-derived at a rate three times higher: 20% of the taka is
  // still 20% of the taka, and the days are what moved. §11.6 names this as the soft spot
  // it accepts — a centre that grows keeps its bonus and loses its days, never the reverse.
  const grown = rechargeQuote({
    amountPoisha: 3_120_000,
    tiers: FOUNDING,
    monthlyPoisha: 260_000,
    dailyRatePoisha: DAILY * 3,
  })
  assert.equal(grown.bonusPoisha, 624_000)
  assert.equal(grown.days, 144)
})

test('a typed amount takes the highest floor it reaches, in any order', () => {
  // ৳2,000,000 at ৳260,000 a month is 7 whole months — the 6-month floor, 10%.
  assert.equal(bonusPoisha(FOUNDING, 2_000_000, 260_000), 200_000)
  assert.equal(reachedBonusBps(FOUNDING, 2_000_000, 260_000), 1000)

  const jumbled = [FOUNDING[2], FOUNDING[0], FOUNDING[1]]
  assert.equal(bonusPoisha(jumbled, 2_000_000, 260_000), 200_000)
  assert.equal(bonusPoisha(jumbled, 3_120_000, 260_000), 624_000)
})

test('the poisha a fraction of a percent would lose are the customer\'s', () => {
  // ৳7,800.01 at 5% is 39,000.05 poisha. §11.6 floors it, so the credited figure is an
  // integer — which the ledger's `bigint` demands — and the fraction goes to the customer.
  assert.equal(bonusPoisha(FOUNDING, 780_001, 260_000), 39_000)
  // And the MONTHS are floored in the founder's favour: ৳779,999 is 2.99 months of
  // ৳260,000 — two whole months, no bonus. A centre 1 poisha short of the third
  // month did not buy the third month.
  assert.equal(bonusPoisha(FOUNDING, 779_999, 260_000), 0)
})

test('nothing about a malformed promotion or an unreadable monthly can stop a quote', () => {
  assert.equal(bonusPoisha([], 780_000, 260_000), 0)
  assert.equal(bonusPoisha([{ minMonths: 0, bonusBps: 2000 }], 780_000, 260_000), 0)
  assert.equal(bonusPoisha([{ minMonths: 3, bonusBps: 0 }], 780_000, 260_000), 0)
  assert.equal(bonusPoisha([{ minMonths: 3, bonusBps: -500 }], 780_000, 260_000), 0)
  assert.equal(bonusPoisha([{ minMonths: NaN, bonusBps: 500 }], 780_000, 260_000), 0)
  assert.equal(bonusPoisha(FOUNDING, -100, 260_000), 0)
  assert.equal(bonusPoisha(FOUNDING, Number.NaN, 260_000), 0)

  // NO MONTHLY FIGURE, NO MONTHS, NO BONUS — the fail-closed direction §11.12 takes
  // every unreadable count. Zero, negative and NaN all divide by nothing.
  assert.equal(bonusPoisha(FOUNDING, 780_000, 0), 0)
  assert.equal(bonusPoisha(FOUNDING, 780_000, -1), 0)
  assert.equal(bonusPoisha(FOUNDING, 780_000, Number.NaN), 0)
})

test('the next rung says what reaching it costs, in the centre\'s own money', () => {
  // ৳500,000 typed at ৳260,000 a month is 1.9 months — 1 whole month — so the 3-month
  // rung sits at ৳780,000: ৳280,000 more. Quoted from the floor itself so a reader
  // doing the arithmetic against the monthly figure lands on the number on screen.
  assert.deepEqual(nextTier(FOUNDING, 500_000, 260_000), { extraPoisha: 280_000, bonusBps: 500 })
  // Already at 5% (3 whole months): the rung above is 10%, at 6 months — 3 months more.
  assert.deepEqual(nextTier(FOUNDING, 780_000, 260_000), { extraPoisha: 780_000, bonusBps: 1000 })
  // Nothing above the top.
  assert.equal(nextTier(FOUNDING, 3_120_000, 260_000), null)
  assert.equal(nextTier(FOUNDING, 4_000_000, 260_000), null)
  // No monthly figure, no months to climb towards.
  assert.equal(nextTier(FOUNDING, 500_000, 0), null)
})

test('days come from the rate and are absent when there is no rate', () => {
  assert.equal(daysOfCredit(819_000, DAILY), 94)
  // 3.4 days' worth is three: the fourth day cannot be bought whole (§11.7).
  assert.equal(daysOfCredit(30_000, 8_666), 3)
  // The free tier's rate is zero by construction, and a rate nobody could read is not a
  // zero — both print nothing rather than "0 days" to a centre that just sent money.
  assert.equal(daysOfCredit(819_000, 0), null)
  assert.equal(daysOfCredit(819_000, null), null)
})

test('a suggestion list is empty when the monthly figure could not be read', () => {
  // A wrong suggestion is somebody's money sent to the wrong place, so an unreadable
  // figure produces no offer at all rather than a ladder built on a guess.
  assert.deepEqual(rechargeSuggestions(0, FOUNDING, DAILY), [])
  assert.deepEqual(rechargeSuggestions(Number.NaN, FOUNDING, DAILY), [])
})

test('the tiers off the column are read defensively', () => {
  assert.deepEqual(
    readBonusTiers([{ min_months: 3, bonus_bps: 500 }, { min_months: 'lots' }]),
    [{ minMonths: 3, bonusBps: 500 }],
  )
  assert.deepEqual(readBonusTiers(null), [])
  assert.deepEqual(readBonusTiers({ min_months: 1 }), [])
})

/* -------------------------------------------------------------------------- */
/* The two engines, held together                                             */
/* -------------------------------------------------------------------------- */

/**
 * The founding promotion as the migration writes it.
 *
 * Read out of the `.sql` rather than restated, which is the whole point: a ladder that
 * changed in the database and not here — or here and not there — is the drift §11.11
 * describes, and it fails on this line instead of on somebody's balance.
 */
function seedFromMigration(): BonusTier[] {
  const dir = 'supabase/migrations'
  const file = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .reverse()
    .find((name) => readFileSync(`${dir}/${name}`, 'utf8').includes("'LAUNCH'"))

  assert.ok(file, 'the founding promotion has a home in a migration')

  const sql = readFileSync(`${dir}/${file}`, 'utf8')
  const tiers: BonusTier[] = []
  const tier = /'min_months',\s*(\d+),\s*'bonus_bps',\s*(\d+)/g

  for (const match of sql.matchAll(tier)) {
    tiers.push({ minMonths: Number(match[1]), bonusBps: Number(match[2]) })
  }

  assert.equal(tiers.length, 3, `${file} seeds three tiers`)
  return tiers
}

test('the seeded promotion is the ladder this module prices with', () => {
  assert.deepEqual(seedFromMigration(), FOUNDING)
})

test('and the same amounts answer the same through both engines', () => {
  // The SQL side of these four is asserted in scripts/test-recharge.mjs against the same
  // literals — `app.bonus_poisha` in PGlite, `bonusPoisha` here. Neither test can see the
  // other, and that is the arrangement: the numbers are the agreement between them.
  // ৳260,000 is the month both engines count months from here.
  const seeded = seedFromMigration()
  assert.equal(bonusPoisha(seeded, 260_000, 260_000), 0)
  assert.equal(bonusPoisha(seeded, 780_000, 260_000), 39_000)
  assert.equal(bonusPoisha(seeded, 1_560_000, 260_000), 156_000)
  assert.equal(bonusPoisha(seeded, 3_120_000, 260_000), 624_000)
  assert.equal(bonusPoisha(seeded, 2_000_000, 260_000), 200_000)
})
