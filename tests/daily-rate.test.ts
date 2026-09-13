/**
 * The daily rate — §11.6's burn, in poisha, derived and never typed in.
 *
 * WHY THIS TEST EXISTS. `dailyRatePoisha` is the figure every days-left
 * calculation, every recharge suggestion and every balance screen will divide
 * by, and `public.settle_billing` computes the same thing in SQL from the same
 * card. The worked figures below are the SAME ONES the RLS suite asserts of
 * the SQL half (scripts/test-rls.mjs's burn section), so the two doors into
 * the one engine answer alike or one of the two files fails.
 *
 * The properties, from §19: floored and never rounded up, an integer and never
 * a float, zero on the free tier, and thirty days of it never exceeding the
 * month it came from.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PLANS,
  dailyRatePoisha,
  monthlyBillBdt,
  planFor,
} from '../src/lib/plans.ts'

const centre = PLANS.center
const institution = PLANS.institution

test('the masterplan\'s own worked figures, which the SQL half also asserts', () => {
  // §11.6: 100 students, 3 teachers → ৳2,600/month → ৳86.66/day.
  assert.equal(dailyRatePoisha(centre, 100, 3), 8666)
  // The morning of the same day at 60 students: max(1999, 1500) + 100 = ৳2,099.
  assert.equal(dailyRatePoisha(centre, 60, 3), 6996)
  // The floor alone, for a centre with nobody on the books yet.
  assert.equal(dailyRatePoisha(centre, 0, 0), Math.floor(199900 / 30))
  // Teacher Pro is flat: ৳499 over thirty, floored in the customer's favour.
  assert.equal(dailyRatePoisha(PLANS.teacher_plus, 0), Math.floor(49900 / 30))
  assert.equal(dailyRatePoisha(PLANS.teacher_plus, 900), Math.floor(49900 / 30))
})

test('floored, never rounded up, at every band boundary and floor edge', () => {
  // §19's list: the band boundaries (100, 101, 300, 301, 600, 601) and the
  // floor at 1, 50, 79, 80 — plus the teacher seats at 0, 2, 3.
  const sizes = [0, 1, 50, 79, 80, 100, 101, 300, 301, 600, 601, 1200]

  for (const students of sizes) {
    for (const teachers of [0, 2, 3]) {
      const monthly = monthlyBillBdt(centre, students, teachers)
      const daily = dailyRatePoisha(centre, students, teachers)

      assert.ok(Number.isInteger(daily), `${students}/${teachers} is not an integer`)
      // Never rounded up, and never more than a thirtieth of the month.
      assert.ok(daily <= (monthly * 100) / 30, `${students}/${teachers} rounded up`)
      // Never so floored that thirty days undercharge by a whole day: the
      // floor loses at most 29 poisha against the month, never 30.
      assert.ok(daily * 30 > monthly * 100 - 30, `${students}/${teachers} floors too far`)
    }
  }
})

test('thirty days of it never exceeds the month it came from', () => {
  // The property, stated as §19 states it. Holds at every size on every tier,
  // because floor() only ever takes.
  for (const plan of Object.values(PLANS)) {
    for (const students of [0, 1, 79, 80, 100, 101, 300, 301, 600, 601, 2000]) {
      for (const teachers of [0, 2, 3]) {
        const monthly = monthlyBillBdt(plan, students, teachers)
        const thirty = dailyRatePoisha(plan, students, teachers) * 30

        assert.ok(
          thirty <= monthly * 100,
          `${plan.id} ${students}/${teachers}: thirty days costs more than the month`,
        )
      }
    }
  }

  // And at a boundary the floor is exactly the fraction: ৳1,999 over thirty is
  // 6,663.33 poisha, so the day is 6,663 and the month keeps the third of a
  // poisha — the customer's favour, every month, by construction.
  assert.equal(dailyRatePoisha(centre, 0, 0), 6663)
  assert.equal(dailyRatePoisha(centre, 0, 0) * 30, 199890)
})

test('zero on the free tier, with no special case to forget', () => {
  // §11.6: "the arithmetic returns zero" — a free plan burns nothing, and the
  // resolver's own fallback plan (an unreadable row) is the same free tier.
  assert.equal(dailyRatePoisha(PLANS.teacher_free, 0), 0)
  assert.equal(dailyRatePoisha(PLANS.teacher_free, 900, 9, 9), 0)
  assert.equal(dailyRatePoisha(planFor(null), 900), 0)
})

test('the rate never falls as the roster rises, on either per-student tier', () => {
  // Monotonicity, the same property the monthly figure is held to: a centre
  // adding students never sees a cheaper day, or the pricing page makes the
  // founder look like they cannot count.
  for (const plan of [centre, institution]) {
    let previous = -1
    for (let students = 0; students <= 700; students += 1) {
      const daily = dailyRatePoisha(plan, students, 2, 3)
      assert.ok(daily >= previous, `${plan.id}: day ${students} is cheaper than the one before`)
      previous = daily
    }
  }
})

test('an institution pays its own floor and buys its branches', () => {
  // The floor difference at small sizes…
  assert.equal(
    dailyRatePoisha(institution, 0, 0, 1),
    Math.floor(499900 / 30),
  )
  // …the same bands above both floors, so the tiers agree at 400 students…
  assert.equal(
    dailyRatePoisha(institution, 400, 0, 3),
    dailyRatePoisha(centre, 400, 0),
  )
  // …and the fourth branch is the first that costs anything.
  assert.equal(
    dailyRatePoisha(institution, 400, 0, 4) - dailyRatePoisha(institution, 400, 0, 3),
    Math.floor(75000 / 30),
  )

  // A centre does not buy branches at all: the feature gates the charge, so a
  // centre somehow holding four rows is not billed for something unsold.
  assert.equal(
    dailyRatePoisha(centre, 400, 0, 4),
    dailyRatePoisha(centre, 400, 0, 1),
  )
})
