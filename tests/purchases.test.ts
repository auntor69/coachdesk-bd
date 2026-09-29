import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { priceIntent, pricedLines, readPricedLines } from '../src/lib/billing/price.ts'
import {
  CENTER_TEACHER_SEAT_BDT,
  INSTITUTION_BRANCH_BDT,
  PLANS,
  monthlyBillBdt,
} from '../src/lib/plans.ts'

/**
 * What the server says a purchase costs.
 *
 * MASTERPLAN §11.4 forbids five things arriving from a browser and three of them are
 * inputs to this arithmetic. The tests below are about the fifth consequence: that the
 * one figure a customer is asked to pay is derived from columns and is zero whenever
 * there is nothing to sell.
 *
 * THE STUDENT PLACE WENT WITH CAPACITY (§16.1 step 28), and so did the seven tests
 * that priced one — the worked example, the fresh centre, the band-boundary sweep, the
 * two-screens-agree sweep and the two zero-quote cases. `priceIntent`'s union no longer
 * has the arm, so there is nothing to call; what survives is the rule those tests were
 * really about, asserted in one line below: a quote grants places only by granting
 * them, which nothing does any more.
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

test('nothing for sale grants student places any more', () => {
  // The one line the seven retired tests were really about. Every quote the union can
  // produce now grants exactly zero places, and `grantsCapacity` stays on the shape
  // because the column it feeds is dropped by the migration rather than by this cut.
  const quotes = [
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

test('only a subscription covers a period', () => {
  // A check constraint in 20260811000057, and an intent that broke it would be refused
  // by the insert. Held here too, because a caller reading `coversPeriodStart` to decide
  // what to say on screen must not be told a branch came with a month.
  //
  // The other half — "only a capacity purchase grants places" — has nothing left to
  // assert: every arm of the union grants zero (§16.1 step 28).
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

})

test('a tier move is priced at the tier being bought, and carries it', () => {
  // The move an owner makes from /settings/billing: Centre to Institution, priced from the
  // tier they are moving onto rather than the one they are leaving.
  const months = 3
  const quote = priceIntent({
    purpose: 'subscription',
    plan: PLANS.institution,
    activeStudents: 300,
    activeTeachers: 4,
    activeBranches: 4,
    months,
    from: '2026-09-01',
    targetPlan: 'institution',
  })

  assert.equal(quote.targetPlan, 'institution')
  assert.equal(quote.amountBdt, monthlyBillBdt(PLANS.institution, 300, 4, 4) * months)
  // Not the tier they are on: four branches and a bigger floor make it a different bill.
  assert.notEqual(quote.amountBdt, monthlyBillBdt(PLANS.center, 300, 4, 4) * months)
  linesAgree(quote, 'tier move')

  // And a renewal carries no tier, which is what keeps `target_plan` null on the row.
  const renewal = priceIntent({
    purpose: 'subscription',
    plan: PLANS.center,
    activeStudents: 300,
    activeTeachers: 4,
    activeBranches: 1,
    months,
    from: '2026-09-01',
  })
  assert.equal(renewal.targetPlan, null)
})

test('a target that disagrees with the plan that priced it is not quoted', () => {
  // THE MISPRICING THIS REFUSES. `plan` is what the bill is computed from, so a caller
  // quoting the current tier and asking for a better one is a customer paying Centre
  // money for Institution product. The column checks the same thing; here it is a zero
  // quantity rather than a failed insert.
  const cheap = priceIntent({
    purpose: 'subscription',
    plan: PLANS.center,
    activeStudents: 400,
    activeTeachers: 0,
    activeBranches: 1,
    months: 3,
    from: '2026-09-01',
    targetPlan: 'institution',
  })

  assert.equal(cheap.quantity, 0)
  assert.equal(cheap.amountBdt, 0)
  assert.equal(cheap.targetPlan, null)

  // And why intents.ts compares the tier on a replayed key instead of trusting purpose,
  // quantity and amount: at 400 students on one branch these two bills are the same
  // number, so those three columns cannot tell the purchases apart.
  assert.equal(
    monthlyBillBdt(PLANS.center, 400, 0, 1),
    monthlyBillBdt(PLANS.institution, 400, 0, 1),
  )
})

test('nobody is sold a move onto the free tier', () => {
  // A downgrade is not a purchase — there is no amount to charge and nothing to settle —
  // so the free tier is not a target even when it is the tier that priced the quote.
  const quote = priceIntent({
    purpose: 'subscription',
    plan: PLANS.teacher_free,
    activeStudents: 20,
    activeTeachers: 0,
    activeBranches: 1,
    months: 1,
    from: '2026-09-01',
    targetPlan: 'teacher_free',
  })

  assert.equal(quote.quantity, 0)
  assert.equal(quote.targetPlan, null)
})

test('only months of coverage can carry a tier', () => {
  // 20260811000073 says so as a check constraint, because a tier arriving on a purchase
  // of seats or branches would move the plan without anybody having paid a month for it.
  const others = [
    priceIntent({ purpose: 'teacher_seat', activeTeachers: 6, seats: 2 }),
    priceIntent({
      purpose: 'branch',
      plan: PLANS.institution,
      activeBranches: 3,
      branches: 1,
    }),
  ]

  for (const quote of others) {
    assert.equal(quote.targetPlan, null, quote.purpose)
  }
})

test('the tier is written from the quote, and read back before a key is reused', () => {
  // Two halves of the same rule, neither visible in the generated types: the column is
  // filled from the quote's own field, and the replay comparison includes it. Drop the
  // second and a request key reused across the two identically-billed tiers hands back
  // the cheaper intent, which then settles onto the dearer tier's row.
  const intents = source('intents.ts')

  assert.match(intents, /target_plan: quote\.targetPlan/)
  assert.match(intents, /existing\.target_plan !== quote\.targetPlan/)
  assert.match(intents, /REPLAY_COLUMNS = `\$\{INTENT_COLUMNS\}, target_plan`/)
  assert.match(intents, /\.select\(REPLAY_COLUMNS\)/)
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

test('a quote survives the trip through the jsonb column unchanged', () => {
  // MASTERPLAN §3.8's "rate applied", stored by 20260811000068 because it cannot be
  // recomputed: `settle_payment_intent` raises the ceiling the places were priced from
  // before anybody prints the receipt. So the document has to come back exactly as it
  // went in — a lossy round trip here is a receipt quoting a rate nobody charged.
  const quotes = [
    priceIntent({
      purpose: 'subscription',
      plan: PLANS.center,
      activeStudents: 120,
      activeTeachers: 3,
      activeBranches: 1,
      months: 6,
      from: '2026-09-01',
    }),
    priceIntent({ purpose: 'teacher_seat', activeTeachers: 2, seats: 3 }),
    priceIntent({
      purpose: 'branch',
      plan: PLANS.institution,
      activeBranches: 3,
      branches: 2,
    }),
  ]

  for (const quote of quotes) {
    assert.ok(quote.lines.length > 0, quote.purpose)
    linesAgree(quote, quote.purpose)

    // What Postgres does to it: serialised on the way in, parsed on the way out.
    const stored = JSON.parse(JSON.stringify(pricedLines(quote.lines)))
    assert.deepEqual(readPricedLines(stored), quote.lines, quote.purpose)

    // And the shape the check constraint reads, in the constraint's own spelling. A
    // camelCase key would pass `tsc` and fail every insert.
    for (const line of stored) {
      assert.deepEqual(Object.keys(line).sort(), ['cost_bdt', 'count', 'rate_bdt', 'what'])
    }
  }
})

test('a document the column would refuse is a breakdown the reader drops', () => {
  // The TypeScript twin of `app.priced_lines_explain`. Not the same code, deliberately —
  // the constraint is what decides — but the same answer, so a bad document never
  // reaches paper looking like a good one.
  for (const bad of [
    undefined,
    [{ what: 'places', count: 1, rate_bdt: 1, cost_bdt: Number.NaN }],
    [{ what: 'places', count: Number.POSITIVE_INFINITY, rate_bdt: 1, cost_bdt: 1 }],
    [{ what: 'Places', count: 1, rate_bdt: 1, cost_bdt: 1 }],
  ]) {
    assert.deepEqual(readPricedLines(bad), [], JSON.stringify(bad ?? null))
  }
})

test('the breakdown is written from the quote and nowhere else', () => {
  // The column is `not null`, so the generated Insert type already refuses an intent
  // opened without one. What that cannot say is where the value came from: this pins it
  // to the quote's own lines rather than anything assembled at the call site.
  const intents = source('intents.ts')

  assert.match(intents, /priced_lines: pricedLines\(quote\.lines\)/)
  assert.doesNotMatch(intents, /rate_bdt/)
})
