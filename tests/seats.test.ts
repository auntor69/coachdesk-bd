import { test } from 'node:test'
import assert from 'node:assert/strict'

import { STUDENT_BANDS, studentChargeBdt } from '../src/lib/plans.ts'

/**
 * The per-student bands — what the balance charges from.
 *
 * THIS FILE USED TO PRICE A PLACE. The top-up dialog sold one (§3.4) and the bulk import
 * sold two hundred (§3.5), through `capacityBands` and `capacityCostBdt` read over the gap
 * between two ceilings, and the arithmetic here is what caught an off-by-one band boundary
 * before a customer did. That sale is retired (§16.1 step 28): a per-student tier has no
 * ceiling, so there is nothing to buy past one and no gap to price.
 *
 * THE BANDS THEMSELVES ARE UNTOUCHED, because they were never about capacity. They price
 * a centre's students, which is the whole of what that tier sells, and `monthlyBillBdt`
 * walks them to produce the figure the daily rate is derived from. What is left below is
 * the part of the old file that was always about the bands: they are marginal, the bill
 * never falls as a centre grows, and a boundary is continuous.
 */

/** What the Nth student costs: the bill's increase, one student at a time. */
const marginal = (students: number) => studentChargeBdt(students) - studentChargeBdt(students - 1)

test("§3.5's worked example still comes out at 3,480 taka, band by band", () => {
  // Straight from the masterplan: a ceiling of 120 raised to 320 read on screen as "180
  // places at 18 taka = 3,240, plus 20 places at 12 = 240". There is no ceiling to raise
  // now, but the bands are the same bands and the example still has to add up: 180
  // students above the hundredth and 20 more above the three-hundredth.
  assert.equal(studentChargeBdt(320) - studentChargeBdt(120), 3480)
  assert.equal(180 * 18 + 20 * 12, 3480)
})

test('the next student costs what the band they land in charges', () => {
  // §3.4's figures, which the plan calculator still prints. A band is `(floor, upTo]`, so
  // the student who tips into the next one is the one an off-by-one gets wrong: the
  // hundredth is charged 25 and the hundred-and-first 18.
  assert.equal(marginal(99), 25)
  assert.equal(marginal(100), 25)
  assert.equal(marginal(101), 18)
  assert.equal(marginal(300), 18)
  assert.equal(marginal(301), 12)
  assert.equal(marginal(600), 12)
  assert.equal(marginal(601), 8)

  // And the first, which is the band nobody thinks about.
  assert.equal(marginal(1), 25)
})

test('a growing centre never sees its bill fall', () => {
  // THE INVARIANT THE SALE USED TO DEPEND ON and the balance depends on harder: a
  // marginal table is what makes the charge continuous, so a centre one student above a
  // boundary pays at least what the centre below it pays. A flat rate per band would make
  // 301 students cheaper than 300, and the founder look like they cannot count.
  let previous = studentChargeBdt(0)
  for (let students = 1; students <= 1200; students += 1) {
    const charged = studentChargeBdt(students)
    assert.ok(charged >= previous, `${students} students cost less than ${students - 1}`)
    assert.equal(charged - previous, marginal(students), `${students}`)
    previous = charged
  }
})

test('the bands come back cheapest last, which is the order they are read in', () => {
  // The list is walked from the first student to the last, so a rate out of order would
  // be charged in the wrong band and read on the plan screen in the wrong order. Both
  // halves are asserted because a sort added to the function would hide the second.
  const rates = STUDENT_BANDS.map((band) => band.rateBdt)

  assert.deepEqual(rates, [25, 18, 12, 8])
  assert.deepEqual([...rates].sort((a, b) => b - a), rates)
  assert.equal(STUDENT_BANDS.at(-1)?.upTo, null, 'the last band has no top')
})

test('a nonsense count is priced as nothing rather than as NaN', () => {
  // The count comes from a roster and a column, and a NaN that reaches the billing screen
  // reads as "NaN taka" beside the day's rate.
  for (const junk of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(studentChargeBdt(junk), 0, `${junk}`)
  }
  assert.equal(studentChargeBdt(-50), 0)

  // Fractions are floored, so half a student is never charged for.
  assert.equal(studentChargeBdt(120.9), studentChargeBdt(120))
})
