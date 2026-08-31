import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { priceIntent } from '../src/lib/billing/price.ts'
import {
  CENTER_TEACHER_SEAT_BDT,
  INSTITUTION_BRANCH_BDT,
  PLANS,
  includedStudents,
  monthlyBillBdt,
  studentChargeBdt,
} from '../src/lib/plans.ts'

/**
 * What the server says a purchase costs.
 *
 * MASTERPLAN §11.4 forbids five things arriving from a browser and four of them are
 * inputs to this arithmetic. The tests below are about the fifth consequence: that the
 * one figure a customer is asked to pay is derived from columns, matches the monthly
 * bill it produces, and is zero whenever there is nothing to sell.
 *
 * The provider layer cannot be imported — `server-only` throws outside a request — so
 * the constraints that layer carries are pinned by reading it, the way
 * tests/admin-actor.test.ts pins the actor rule.
 */

const ROOT = path.join(import.meta.dirname, '..')
const BILLING = path.join(ROOT, 'src', 'lib', 'billing')

function source(file: string): string {
  return readFileSync(path.join(BILLING, file), 'utf8')
}

/** Every quote's lines must add up to the amount charged. */
function linesAgree(quote: ReturnType<typeof priceIntent>, label: string): void {
  const summed = quote.lines.reduce((total, line) => total + line.costBdt, 0)
  assert.equal(summed, quote.amountBdt, `${label}: lines sum to ${summed}`)
  for (const line of quote.lines) {
    assert.ok(line.count > 0, `${label}: a line with no units in it`)
    assert.equal(line.costBdt, line.count * line.rateBdt, `${label}: ${line.what} rate`)
  }
}

test("§3.5's worked example, priced as a purchase", () => {
  // A ceiling of 120 raised to 320. The masterplan's own figures, and the same ones
  // tests/seats.test.ts holds capacityCostBdt to — asserted again here because this is
  // the function a screen will actually call.
  const quote = priceIntent({
    purpose: 'student_capacity',
    plan: PLANS.center,
    purchasedCapacity: 120,
    places: 200,
  })

  assert.equal(quote.amountBdt, 3480)
  assert.equal(quote.quantity, 200)
  assert.equal(quote.grantsCapacity, 200)
  assert.deepEqual(quote.lines, [
    { what: 'places', count: 180, rateBdt: 18, costBdt: 3240 },
    { what: 'places', count: 20, rateBdt: 12, costBdt: 240 },
  ])
  linesAgree(quote, 'worked example')
})

test('a fresh centre is charged from what its floor already paid for', () => {
  // THE TRAP THIS TEST EXISTS FOR. `student_capacity` is 0 on a new centre and its
  // ceiling is 79, because ৳1,999 bought those places. Pricing from the column would
  // sell them back at 25 taka each.
  const included = includedStudents(PLANS.center)
  const quote = priceIntent({
    purpose: 'student_capacity',
    plan: PLANS.center,
    purchasedCapacity: 0,
    places: 41,
  })

  assert.equal(included, 79)
  assert.equal(quote.amountBdt, studentChargeBdt(120) - studentChargeBdt(79))
  assert.equal(quote.amountBdt, 21 * 25 + 20 * 18)
  linesAgree(quote, 'fresh centre')
})

test('a purchase never disagrees with the monthly bill it produces', () => {
  // The same invariant seats.test.ts holds the bands to, asked through priceIntent so
  // that a quote and an invoice cannot drift apart by way of this file.
  for (const purchased of [0, 79, 100, 120, 299, 300, 600, 1200]) {
    for (const places of [1, 20, 41, 200, 700]) {
      const quote = priceIntent({
        purpose: 'student_capacity',
        plan: PLANS.center,
        purchasedCapacity: purchased,
        places,
      })
      const from = Math.max(purchased, includedStudents(PLANS.center))

      assert.equal(
        quote.amountBdt,
        studentChargeBdt(from + places) - studentChargeBdt(from),
        `${purchased} + ${places}`,
      )
      linesAgree(quote, `${purchased} + ${places}`)
    }
  }
})

test('an institution buys places above its own bigger floor', () => {
  const included = includedStudents(PLANS.institution)
  const quote = priceIntent({
    purpose: 'student_capacity',
    plan: PLANS.institution,
    purchasedCapacity: 0,
    places: 12,
  })

  assert.equal(included, 238)
  assert.equal(quote.amountBdt, 12 * 18)
  assert.equal(quote.grantsCapacity, 12)
})

test('the teacher tiers are quoted nothing, because nothing is for sale', () => {
  // Their ceiling comes from the plan and money does not move it.
  // `settle_payment_intent` refuses the same purchase from the other end, so this is
  // the polite half of a rule the database also holds.
  for (const plan of [PLANS.teacher_free, PLANS.teacher_plus]) {
    const quote = priceIntent({
      purpose: 'student_capacity',
      plan,
      purchasedCapacity: 0,
      places: 50,
    })

    assert.equal(quote.quantity, 0, plan.id)
    assert.equal(quote.amountBdt, 0, plan.id)
    assert.equal(quote.grantsCapacity, 0, plan.id)
    assert.deepEqual(quote.lines, [], plan.id)
  }
})

test('a paste of nothing, or of nonsense, is priced as nothing', () => {
  for (const places of [0, -1, -900, Number.NaN, Number.POSITIVE_INFINITY]) {
    const quote = priceIntent({
      purpose: 'student_capacity',
      plan: PLANS.center,
      purchasedCapacity: 120,
      places,
    })
    assert.equal(quote.quantity, 0, `${places}`)
    assert.equal(quote.amountBdt, 0, `${places}`)
  }
})

test('a subscription costs what this month costs, times the months bought', () => {
  const perMonth = monthlyBillBdt(PLANS.center, 120, 3, 1)
  const quote = priceIntent({
    purpose: 'subscription',
    plan: PLANS.center,
    activeStudents: 120,
    activeTeachers: 3,
    activeBranches: 1,
    months: 3,
    from: '2026-09-01',
  })

  assert.equal(perMonth, 2860 + CENTER_TEACHER_SEAT_BDT)
  assert.equal(quote.amountBdt, perMonth * 3)
  assert.equal(quote.quantity, 3)
  assert.equal(quote.grantsCapacity, 0)
  assert.equal(quote.coversPeriodStart, '2026-09-01')
  assert.equal(quote.coversPeriodEnd, '2026-11-30')
  linesAgree(quote, 'subscription')
})

test('the coverage window is whole months, wherever in one it starts', () => {
  // A `from` of the 14th would otherwise produce "covered through the 13th", which is
  // not a period anybody bills and not one the founder panel can produce either.
  const quote = priceIntent({
    purpose: 'subscription',
    plan: PLANS.center,
    activeStudents: 40,
    activeTeachers: 0,
    activeBranches: 1,
    months: 12,
    from: '2026-08-14',
  })

  assert.equal(quote.coversPeriodStart, '2026-08-01')
  assert.equal(quote.coversPeriodEnd, '2027-07-31')
})

test('a subscription nobody can be billed for is not quoted', () => {
  const base = {
    purpose: 'subscription',
    plan: PLANS.center,
    activeStudents: 40,
    activeTeachers: 0,
    activeBranches: 1,
    months: 1,
    from: '2026-09-01',
  } as const

  // Seven months is not a length any receipt can cover (§11.5's closed list), so it is
  // not a length an intent may claim either.
  assert.equal(priceIntent({ ...base, months: 7 }).quantity, 0)
  assert.equal(priceIntent({ ...base, months: 0 }).quantity, 0)
  assert.equal(priceIntent({ ...base, months: Number.NaN }).quantity, 0)

  // A month on the free tier is free, and a ৳0 intent would be a Pay button for
  // nothing. Both columns are `> 0`, so the database refuses one too.
  assert.equal(priceIntent({ ...base, plan: PLANS.teacher_free }).amountBdt, 0)

  // A date the column could not hold.
  for (const from of ['tomorrow', '2026-13-01', '', '2026-09']) {
    assert.equal(priceIntent({ ...base, from }).quantity, 0, from)
  }
})

test('teacher seats are charged beyond the two every paid tier includes', () => {
  const free = priceIntent({ purpose: 'teacher_seat', activeTeachers: 1, seats: 1 })
  assert.equal(free.quantity, 1)
  assert.equal(free.amountBdt, 0)
  assert.deepEqual(free.lines, [])

  const straddling = priceIntent({ purpose: 'teacher_seat', activeTeachers: 1, seats: 3 })
  assert.equal(straddling.quantity, 3)
  assert.equal(straddling.amountBdt, 2 * CENTER_TEACHER_SEAT_BDT)
  assert.deepEqual(straddling.lines, [
    { what: 'seats', count: 2, rateBdt: CENTER_TEACHER_SEAT_BDT, costBdt: 200 },
  ])

  const paid = priceIntent({ purpose: 'teacher_seat', activeTeachers: 6, seats: 2 })
  assert.equal(paid.amountBdt, 2 * CENTER_TEACHER_SEAT_BDT)
  linesAgree(paid, 'teacher seats')
})

test('branches are charged beyond the three an institution includes', () => {
  const straddling = priceIntent({
    purpose: 'branch',
    plan: PLANS.institution,
    activeBranches: 2,
    branches: 2,
  })
  assert.equal(straddling.quantity, 2)
  assert.equal(straddling.amountBdt, INSTITUTION_BRANCH_BDT)
  assert.deepEqual(straddling.lines, [
    { what: 'branches', count: 1, rateBdt: INSTITUTION_BRANCH_BDT, costBdt: 750 },
  ])

  const free = priceIntent({
    purpose: 'branch',
    plan: PLANS.institution,
    activeBranches: 1,
    branches: 2,
  })
  assert.equal(free.amountBdt, 0)

  const fourth = priceIntent({
    purpose: 'branch',
    plan: PLANS.institution,
    activeBranches: 3,
    branches: 1,
  })
  assert.equal(fourth.amountBdt, INSTITUTION_BRANCH_BDT)

  // No `multipleBranches`, so there is no second building to sell — not a refusal, a
  // tier with nothing on offer.
  for (const plan of [PLANS.center, PLANS.teacher_plus]) {
    const quote = priceIntent({ purpose: 'branch', plan, activeBranches: 1, branches: 1 })
    assert.equal(quote.amountBdt, 0, plan.id)
    assert.deepEqual(quote.lines, [], plan.id)
  }
})

test('only a capacity purchase grants places, and only a subscription covers a period', () => {
  // Both are check constraints in 20260811000057, and an intent that broke either would
  // be refused by the insert. Held here too, because a caller reading `grantsCapacity`
  // to decide what to say on screen must not be told a branch came with seats.
  const quotes = [
    priceIntent({
      purpose: 'subscription',
      plan: PLANS.center,
      activeStudents: 120,
      activeTeachers: 0,
      activeBranches: 1,
      months: 1,
      from: '2026-09-01',
    }),
    priceIntent({ purpose: 'teacher_seat', activeTeachers: 6, seats: 2 }),
    priceIntent({
      purpose: 'branch',
      plan: PLANS.institution,
      activeBranches: 3,
      branches: 1,
    }),
  ]

  for (const quote of quotes) {
    assert.equal(quote.grantsCapacity, 0, quote.purpose)
    if (quote.purpose !== 'subscription') {
      assert.equal(quote.coversPeriodStart, null, quote.purpose)
      assert.equal(quote.coversPeriodEnd, null, quote.purpose)
    }
  }

  const capacity = priceIntent({
    purpose: 'student_capacity',
    plan: PLANS.center,
    purchasedCapacity: 120,
    places: 40,
  })
  assert.equal(capacity.grantsCapacity, capacity.quantity)
  assert.equal(capacity.coversPeriodStart, null)
})

test('bKash is refused rather than guessed at', () => {
  // §11.1: no invented request bodies, no guessed endpoints, no credentials. The enum
  // has the value so a column can grow into it; there is no module behind it, and the
  // registry says so out loud instead of returning something that renders as "try
  // again later" forever.
  const provider = source('provider.ts')

  assert.match(provider, /id === 'manual'/)
  assert.match(provider, /is not implemented/)
  assert.doesNotMatch(provider, /bkash\.|checkout\.|tokenized|app_key|api_key/i)
  assert.doesNotMatch(provider, /https?:\/\//)
})

test('no wallet number is compiled into the manual provider', () => {
  // "Do not hard-code a personal bKash number as the payment mechanism." Where the
  // money goes is deployment config, and a screen with an empty variable behind it says
  // so rather than inventing a destination.
  const manual = source('manual.ts')

  assert.match(manual, /NEXT_PUBLIC_SALES_PHONE/)
  assert.doesNotMatch(manual, /01\d{9}/)
})

test('a confirmation cannot bring its own amount', () => {
  // The whole point of §11.2. `handleCallback` takes an untrusted payload, and the only
  // fact it lifts out of one is the provider's reference; everything that decides money
  // is read from the intent by settle_payment_intent.
  const manual = source('manual.ts')

  assert.match(manual, /payload: unknown/)
  assert.match(manual, /settle_payment_intent/)
  assert.doesNotMatch(manual, /body\.(amount|amountBdt|quantity|plan|capacity|centerId)/)

  // No state written by hand anywhere but the one transition createPayment owns.
  const updates = manual.match(/state: '[a-z]+'/g) ?? []
  assert.deepEqual(updates, ["state: 'initiated'"])
})

test('an amount is never a parameter of opening a purchase', () => {
  // openIntent takes a Quote and a centre, and there is nowhere in its input to put a
  // price. A caller that wanted to overcharge would have to edit price.ts.
  const intents = source('intents.ts')

  assert.match(intents, /quote: Quote/)
  assert.doesNotMatch(intents, /amountBdt\??: number/)
  assert.match(intents, /amount_bdt: quote\.amountBdt/)
  // The zero quote is refused before the insert, not by the check constraint.
  assert.match(intents, /nothing_to_buy/)
})
