import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PLANS,
  STUDENT_BANDS,
  capacityBands,
  capacityCostBdt,
  includedStudents,
  nextSeatCostBdt,
  quoteSeats,
  studentCeiling,
  studentChargeBdt,
} from '../src/lib/plans.ts'

/**
 * What a student place costs, and the arithmetic two screens must agree on.
 *
 * The top-up dialog (§3.4) sells one place; the bulk import (§3.5) sells two hundred.
 * Both price them here, and the number they show is the number a centre is asked to pay,
 * so an off-by-one band boundary is not a rendering bug — it is an overcharge, noticed by
 * the customer rather than by us.
 */

test("§3.5's worked example comes out at 3,480 taka, band by band", () => {
  // Straight from the masterplan: a ceiling of 120 raised to 320, which reads on screen as
  // "180 places at 18 taka = 3,240, plus 20 places at 12 = 240". The bands are shown for
  // exactly that reason — a bare 3,480 invites the suspicion it was invented.
  const bands = capacityBands(120, 320)

  assert.deepEqual(bands, [
    { seats: 180, rateBdt: 18, costBdt: 3240 },
    { seats: 20, rateBdt: 12, costBdt: 240 },
  ])
  assert.equal(capacityCostBdt(120, 320), 3480)
})

test('the next place costs what the band it lands in charges', () => {
  // §3.4's three figures, which are the only prices most owners will ever see quoted.
  assert.equal(nextSeatCostBdt(120), 18)
  assert.equal(nextSeatCostBdt(300), 12)
  assert.equal(nextSeatCostBdt(700), 8)

  // The boundaries themselves, because a band is `(floor, upTo]` and the seat that tips
  // into the next one is the seat an off-by-one gets wrong. Place 100 is the last at 25;
  // place 101 is the first at 18.
  assert.equal(nextSeatCostBdt(99), 25)
  assert.equal(nextSeatCostBdt(100), 18)
  assert.equal(nextSeatCostBdt(299), 18)
  assert.equal(nextSeatCostBdt(599), 12)
  assert.equal(nextSeatCostBdt(600), 8)
})

test('a purchase never disagrees with the monthly bill it produces', () => {
  // THE INVARIANT THIS FILE EXISTS FOR. `studentChargeBdt` walks the bands upward from
  // zero and `capacityBands` walks the gap between two ceilings; they are two readings of
  // one table, so a rate edited into one and not the other is a centre billed monthly for
  // something it was sold at a different price. Spread across every boundary and both
  // sides of it, plus the open last band.
  const points = [0, 1, 50, 79, 80, 99, 100, 101, 120, 238, 299, 300, 301, 599, 600, 601, 900, 1500]

  for (const from of points) {
    for (const to of points) {
      if (to <= from) continue
      assert.equal(
        capacityCostBdt(from, to),
        studentChargeBdt(to) - studentChargeBdt(from),
        `${from} -> ${to}`,
      )
    }
  }
})

test('buying nothing costs nothing, and buying backwards is buying nothing', () => {
  // A dialog opened and closed, and the state the import lands in when the paste turns
  // out to fit. Neither is an error and neither may produce a price.
  assert.deepEqual(capacityBands(120, 120), [])
  assert.equal(capacityCostBdt(120, 120), 0)

  // Downward is not a refund. A ceiling only falls by downgrading, which migration 36
  // handles by ignoring purchased capacity on the teacher tiers — there is no negative
  // taka anywhere in this product.
  assert.deepEqual(capacityBands(320, 120), [])
  assert.equal(capacityCostBdt(320, 120), 0)
})

test('a nonsense ceiling is priced as nothing rather than as NaN', () => {
  // `student_capacity` comes out of a column and `wanted` out of a paste, and a NaN that
  // reaches a screen reads as "NaN taka" beside a Pay button.
  for (const junk of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(capacityCostBdt(junk, 320), capacityCostBdt(0, 320), `from ${junk}`)
    assert.equal(capacityCostBdt(120, junk), 0, `to ${junk}`)
  }

  // Fractions are floored on both sides, so half a place is never charged for.
  assert.equal(capacityCostBdt(120.9, 121.9), 18)
  assert.equal(capacityCostBdt(-50, 10), 250)
})

test('the bands a purchase reports add up to the price it charges', () => {
  // The breakdown is not decoration: it is the same numbers, and a total computed
  // separately from the lines is how a screen ends up showing rows that do not sum.
  for (const [from, to] of [
    [0, 79],
    [79, 80],
    [0, 1000],
    [100, 300],
    [250, 650],
    [700, 900],
  ]) {
    const bands = capacityBands(from, to)
    const summed = bands.reduce((total, band) => total + band.costBdt, 0)

    assert.equal(summed, capacityCostBdt(from, to), `${from} -> ${to}`)
    assert.equal(
      bands.reduce((total, band) => total + band.seats, 0),
      to - from,
      `seats ${from} -> ${to}`,
    )
    for (const band of bands) {
      assert.ok(band.seats > 0, `empty band in ${from} -> ${to}`)
      assert.equal(band.costBdt, band.seats * band.rateBdt)
    }
  }
})

test('the bands come back cheapest last, which is the order they are read in', () => {
  // "180 places at 18, plus 20 at 12" — ascending seat number, so descending rate. A
  // reversed list would still sum correctly and still be wrong on screen.
  const rates = capacityBands(0, 1000).map((band) => band.rateBdt)

  assert.deepEqual(rates, [25, 18, 12, 8])
  assert.deepEqual(
    rates,
    STUDENT_BANDS.map((band) => band.rateBdt),
  )
})

test('a centre inside its floor is told the place is already paid for', () => {
  // §3.4's third figure: at 50 students it is 0 taka, because 1,999 already covers 79 and
  // charging again would be double billing. Zero seats and not zero price — the dialog
  // opens the admission form instead of asking for money.
  const centre = studentCeiling(PLANS.center, 0)
  const quote = quoteSeats(centre, 50, 1)

  assert.equal(quote.seats, 0)
  assert.equal(quote.costBdt, 0)
  assert.deepEqual(quote.bands, [])
  assert.equal(quote.newCeiling, includedStudents(PLANS.center))
  assert.equal(quote.ceiling, quote.newCeiling)
})

test('a full centre is charged for the shortfall, not for the whole intake', () => {
  // The case the import gets wrong if it prices what was pasted: 25 places free, 100
  // names arriving, so 75 places to buy. Charging for 100 would be a 25-place overcharge
  // on the one screen where nobody counts.
  const centre = studentCeiling(PLANS.center, 120)
  const quote = quoteSeats(centre, 95, 100)

  assert.equal(quote.seats, 75)
  assert.equal(quote.newCeiling, 195)
  assert.equal(quote.costBdt, capacityCostBdt(120, 195))
  assert.equal(quote.costBdt, 75 * 18)
  assert.deepEqual(quote.bands, [{ seats: 75, rateBdt: 18, costBdt: 1350 }])
})

test('the shortfall is measured from the ceiling, not from the roster', () => {
  // A centre over its own ceiling is a real state — a downgrade leaves one. The seats it
  // must buy are the ones above the CEILING, so admitting one student when 130 names sit
  // under a ceiling of 120 buys eleven places and not one.
  const centre = studentCeiling(PLANS.center, 120)
  const quote = quoteSeats(centre, 130, 1)

  assert.equal(quote.seats, 1)
  assert.equal(quote.newCeiling, 121)
  assert.equal(quote.costBdt, 18)
})

test('the teacher tiers are not sold places at all', () => {
  // A `plan` ceiling moves by changing plan. Quoting a price here would be quoting for
  // something we do not sell, and the caller would render a Pay button that cannot be
  // honoured — so the answer is zero seats, and the screen has to read `kind` to find
  // the sentence it should be showing instead.
  for (const plan of [PLANS.teacher_free, PLANS.teacher_plus]) {
    const ceiling = studentCeiling(plan, 900)
    const quote = quoteSeats(ceiling, ceiling.ceiling, 50)

    assert.equal(ceiling.kind, 'plan')
    assert.equal(quote.seats, 0, plan.id)
    assert.equal(quote.costBdt, 0, plan.id)
    assert.equal(quote.newCeiling, ceiling.ceiling, plan.id)
  }
})

test('an institution buys its places from the same bands, above a bigger floor', () => {
  // Two floors, one price list. The institution's 238 included places are worth more
  // taka than the centre's 79, but the 239th place costs what the band says and not a
  // premium for being on the dearer plan.
  const inst = studentCeiling(PLANS.institution, 0)
  const included = includedStudents(PLANS.institution)

  assert.equal(inst.ceiling, included)
  assert.equal(nextSeatCostBdt(included), 18)

  const quote = quoteSeats(inst, included, 12)
  assert.equal(quote.seats, 12)
  assert.equal(quote.costBdt, 12 * 18)
  assert.equal(quote.newCeiling, included + 12)
})

test('a paste of nothing, or of nonsense, prices nothing', () => {
  // `wanted` is a parsed row count and reaches this from a file. Zero is the honest
  // answer to all of it; a NaN shortfall would be a NaN price.
  const centre = studentCeiling(PLANS.center, 120)

  for (const wanted of [0, -1, -900, Number.NaN, Number.POSITIVE_INFINITY]) {
    const quote = quoteSeats(centre, 120, wanted)
    assert.equal(quote.seats, 0, `${wanted}`)
    assert.equal(quote.costBdt, 0, `${wanted}`)
  }

  // And a broken roster count is treated as no room rather than as infinite room, which
  // is `studentRoom`'s rule and the safe direction: it quotes a price instead of
  // silently admitting students nobody paid for.
  const unknownRoster = quoteSeats(centre, Number.NaN, 5)
  assert.equal(unknownRoster.seats, 5)
  assert.equal(unknownRoster.costBdt, 5 * 18)
})

test('a purchase that crosses a boundary is split, however it is reached', () => {
  // One seat at a time must cost what one purchase of many costs, or a centre that
  // admits students one by one pays a different total from one that pastes them.
  let oneByOne = 0
  for (let ceiling = 90; ceiling < 110; ceiling += 1) oneByOne += nextSeatCostBdt(ceiling)

  assert.equal(oneByOne, capacityCostBdt(90, 110))
  assert.equal(oneByOne, 10 * 25 + 10 * 18)
})
