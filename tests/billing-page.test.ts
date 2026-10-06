/**
 * The billing screen — MASTERPLAN §20.4's five questions and the day-by-day ledger
 * history, build-order step 27.
 *
 * TWO SUBJECTS, and they fail differently.
 *
 * The first is `src/lib/billing/history.ts`, the collapse that turns a `billing_ledger`
 * into what a customer reads. It is pure and the rows are handed in, so the arithmetic is
 * tested directly against the five shapes the ledger actually writes — a plain day, a day
 * topped up at noon, two months beside each other, a grant, and a settlement that charged
 * nothing. The one that matters most is the top-up: a day with a base row and a `top_up`
 * row is *one* day at the peak count, and a screen that showed two days would be charging
 * the reader twice for a single Dhaka day (§11.7).
 *
 * The second is the screen itself, which cannot be run here and so is read: the five
 * questions in §20.4's order, the history drawn from the collapse, the rate derived from
 * the same counts the burn prices from, and the balance read off the session rather than
 * recomputed. That last is the rule this file is really guarding — a second division of
 * the balance by the rate is how a screen comes to say a centre is paid up while the write
 * that follows is refused (§4.4).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  collapseHistory,
  coversToDay,
  daysOf,
  type LedgerEntry,
} from '../src/lib/billing/history.ts'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
function read(...parts: string[]): string {
  return readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')
}

const PAGE = read('src', 'app', '(app)', 'settings', 'billing', 'page.tsx')

/** The pricing calculator, which the billing screen draws behind its own disclosure. */
const CALC = read('src', 'app', '(app)', 'settings', 'billing', 'calculator.tsx')

/** What is left of `/settings/plan` — a route and nothing else. */
const REDIRECT = read('src', 'app', '(app)', 'settings', 'plan', 'page.tsx')

/** The recharge card, which this screen folds in and which the send block lives on. */
const PANEL = read('src', 'app', '(app)', 'settings', 'billing', 'recharge-panel.tsx')

/** A ledger entry with everything but the named fields defaulted away. */
let seq = 0
function entry(over: Partial<LedgerEntry> & Pick<LedgerEntry, 'kind' | 'amountPoisha'>): LedgerEntry {
  seq += 1
  return {
    id: `entry-${seq}`,
    balanceAfter: 0,
    chargeDate: null,
    students: null,
    teachers: null,
    branches: null,
    description: null,
    days: null,
    createdAt: `2026-09-01T00:00:${String(seq).padStart(2, '0')}Z`,
    topUp: false,
    paymentId: null,
    ...over,
  }
}

/* -------------------------------------------------------------------------- */
/* The last day the money reaches                                              */
/* -------------------------------------------------------------------------- */

test('coversToDay is the line plus the days the balance still buys', () => {
  // §20.4's own headline: the line is the last day *paid for*, so the money carries
  // `daysLeft` more days past it.
  assert.equal(coversToDay('2026-09-15', 10), '2026-09-25')
  // Across a month boundary, which is the case the arithmetic is here for.
  assert.equal(coversToDay('2026-09-28', 5), '2026-10-03')
  // Zero days left is the line itself, not a day past it.
  assert.equal(coversToDay('2026-09-15', 0), '2026-09-15')
})

test('no line or no rate means no date rather than today', () => {
  // Both are "not read", and a date invented here is a promise about somebody's money.
  assert.equal(coversToDay(null, 10), null)
  assert.equal(coversToDay('2026-09-15', null), null)
  assert.equal(coversToDay(null, null), null)
})

test('daysOf lifts metadata.days and refuses anything else', () => {
  assert.equal(daysOf({ days: 30 }), 30)
  assert.equal(daysOf({}), null)
  assert.equal(daysOf({ days: '30' }), null)
  assert.equal(daysOf({ days: Number.NaN }), null)
  assert.equal(daysOf(null), null)
  assert.equal(daysOf([{ days: 30 }]), null)
})

/* -------------------------------------------------------------------------- */
/* A day, and a day topped up                                                  */
/* -------------------------------------------------------------------------- */

test('a day topped up at noon is one day, summed, at the peak count', () => {
  // §11.7 step 4: the base charge is the morning's size, the top-up the larger one, and
  // the customer paid for the *day*. Two lines would charge it twice.
  const history = collapseHistory([
    entry({
      // The top-up is the *difference* to the larger rate, as `settle_billing` writes it:
      // ৳86.66 − ৳69.96. The day's own cost is the two rows added up.
      kind: 'daily_charge',
      amountPoisha: -1670,
      chargeDate: '2026-09-12',
      students: 100,
      teachers: 3,
      branches: 1,
      topUp: true,
    }),
    entry({
      kind: 'daily_charge',
      amountPoisha: -6996,
      chargeDate: '2026-09-12',
      students: 60,
      teachers: 3,
      branches: 1,
    }),
  ])

  assert.equal(history.months.length, 1)
  assert.equal(history.months[0].days, 1)
  assert.equal(history.months[0].costPoisha, 8666) // the two rows summed, never −8666
  assert.equal(history.months[0].rows[0].students, 100) // the high-water
  assert.equal(history.totals.chargedPoisha, 8666)
  // And the day is marked as topped up, because a cost higher than the count suggests is
  // otherwise a figure the customer reads as one we got wrong.
  assert.equal(history.months[0].rows[0].toppedUp, true)
})

test('an ordinary day is not marked as topped up', () => {
  const history = collapseHistory([
    entry({ kind: 'daily_charge', amountPoisha: -6996, chargeDate: '2026-09-12' }),
  ])
  assert.equal(history.months[0].rows[0].toppedUp, false)
})

test('a day whose count could not be read keeps null rather than a zero', () => {
  const history = collapseHistory([
    entry({ kind: 'daily_charge', amountPoisha: -6996, chargeDate: '2026-09-12' }),
  ])

  const day = history.months[0].rows[0]
  assert.equal(day.students, null)
  assert.equal(day.teachers, null)
  assert.equal(day.branches, null)
  // The money is still known, and it is the figure the customer can check.
  assert.equal(day.costPoisha, 6996)
})

/* -------------------------------------------------------------------------- */
/* Months                                                                       */
/* -------------------------------------------------------------------------- */

test('days are grouped by month, newest month first, newest day first inside it', () => {
  const history = collapseHistory([
    entry({ kind: 'daily_charge', amountPoisha: -100, chargeDate: '2026-08-31' }),
    entry({ kind: 'daily_charge', amountPoisha: -200, chargeDate: '2026-09-01' }),
    entry({ kind: 'daily_charge', amountPoisha: -300, chargeDate: '2026-09-02' }),
  ])

  assert.deepEqual(
    history.months.map((m) => m.month),
    ['2026-09', '2026-08'],
  )
  assert.equal(history.months[0].days, 2)
  assert.equal(history.months[0].costPoisha, 500)
  assert.deepEqual(
    history.months[0].rows.map((r) => r.date),
    ['2026-09-02', '2026-09-01'],
  )
  assert.equal(history.months[1].days, 1)
  assert.equal(history.totals.chargedPoisha, 600)
})

/* -------------------------------------------------------------------------- */
/* The money, the grants, the failures, the opening row                        */
/* -------------------------------------------------------------------------- */

test('money, grants and failures are separated, and the opening row is not drawn', () => {
  const history = collapseHistory([
    entry({ kind: 'recharge', amountPoisha: 780_000, paymentId: 'pay-1' }),
    entry({ kind: 'promotion_bonus', amountPoisha: 39_000 }),
    entry({
      kind: 'founder_grant_days',
      amountPoisha: 0,
      days: 3,
      description: 'Ramadan closure',
    }),
    entry({
      kind: 'settlement_failure',
      amountPoisha: 0,
      chargeDate: '2026-09-10',
    }),
    entry({ kind: 'migration_opening_balance', amountPoisha: 0 }),
    entry({ kind: 'founder_money_adjustment', amountPoisha: -50_000 }),
    entry({ kind: 'correction', amountPoisha: 1_000 }),
  ])

  assert.deepEqual(
    history.money.map((m) => m.kind).sort(),
    ['correction', 'founder_money_adjustment', 'promotion_bonus', 'recharge'],
  )
  assert.equal(history.grants.length, 1)
  assert.equal(history.grants[0].days, 3)
  assert.equal(history.failures.length, 1)
  // A settlement that charged nothing is not a month with a day in it.
  assert.equal(history.months.length, 0)
  assert.equal(history.ignored, 1)

  // The totals: money in, the bonus that is not revenue, the adjustment signed, the days
  // given rather than sold.
  assert.equal(history.totals.rechargedPoisha, 780_000)
  assert.equal(history.totals.bonusPoisha, 39_000)
  assert.equal(history.totals.adjustedPoisha, -50_000)
  assert.equal(history.totals.grantedDays, 3)
  assert.equal(history.totals.chargedPoisha, 0)
})

test('an empty ledger is an empty history and not a crash', () => {
  const history = collapseHistory([])
  assert.deepEqual(history.months, [])
  assert.deepEqual(history.money, [])
  assert.deepEqual(history.grants, [])
  assert.deepEqual(history.failures, [])
  assert.equal(history.totals.chargedPoisha, 0)
  assert.equal(history.totals.grantedDays, 0)
  assert.equal(history.ignored, 0)
})

/* -------------------------------------------------------------------------- */
/* The screen: §20.4's five questions, in order                                */
/* -------------------------------------------------------------------------- */

/** Where a needle first appears, with a readable failure when it does not. */
function at(needle: string): number {
  const index = PAGE.indexOf(needle)
  assert.ok(index >= 0, `the page never draws ${needle}`)
  return index
}

test('the five questions are drawn, in §20.4\'s order', () => {
  const order = [
    '{words.leftTitle}', // 1. how long have I got
    '{words.moneyTitle}', // 2. how much is left
    '{words.whyTitle}', // 3. why is it that much
    '{words.addTitle}', // 4. how do I add more
    '{words.historyTitle}', // 5. what has happened to my money
  ].map(at)

  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the questions are out of order')
})

test('the headline is the days left and the date the money reaches', () => {
  // The figure most visits are for, in the reader's own numerals, and the date under it.
  assert.ok(PAGE.includes('words.leftDays(digits(daysLeft, locale))'))
  assert.ok(PAGE.includes('const coversTo = coversToDay(session.billing.chargedThrough, daysLeft)'))
  assert.ok(PAGE.includes('words.leftCovers(formatDate(coversTo, locale))'))
})

test('the balance and the days come off the session, and only the size is re-derived', () => {
  // §4.4: `billing` is the resolution `access` came from, so the screen cannot disagree
  // with the refusal its next write would hit.
  assert.ok(PAGE.includes('session.billing.balancePoisha'))
  assert.ok(PAGE.includes('const daysLeft = session.billing.daysLeft'))

  // The rate is what the session does not carry — the counts behind it — so it is priced
  // from the same function the burn prices from, the way `RechargePanel` does.
  assert.ok(
    PAGE.includes('dailyRatePoisha(plan, counts.students, counts.teachers, counts.branches)'),
  )
  assert.ok(PAGE.includes('monthlyBillBdt(plan, counts.students, counts.teachers, counts.branches)'))
})

test('the rate bands are behind the calculator, not printed on the screen', () => {
  // §33 and §20.4: the bands are how we compute, not how a customer thinks. The one
  // engine is the plan page's own component, so neither can be a stale copy.
  assert.ok(PAGE.includes('<PriceCalculator t={dict(locale).planCalc} locale={locale} />'))
  const detailsAt = PAGE.indexOf('<details')
  assert.ok(detailsAt > 0)
  assert.ok(PAGE.indexOf('<PriceCalculator') > detailsAt, 'the bands are outside the disclosure')
})

test('the recharge card is folded in, so there is one recharge screen and not two', () => {
  assert.ok(PAGE.includes('<RechargePanel />'))
})

test('the number money is sent to is the card\'s largest figure, not a footnote', () => {
  // The complaint this guards. The wallet number used to sit inside the form's own grey
  // instruction sentence — "send exactly the amount above to 017…" — which made the one
  // thing on this card a reader must find *without* reading read as the smallest text on
  // it, and named an amount nobody had chosen yet at that point on the page. It is now
  // drawn on its own, at `text-3xl`, in a bordered block of its own.
  assert.match(
    PANEL,
    /text-3xl font-bold[\s\S]{0,200}formatBdMobile\(paymentPhone as string\)/,
    'the number is small or is no longer the block\'s own figure',
  )
  // Selected as text rather than left to a long-press: an owner reads this off one phone
  // and types it into another, which is the whole reason the block exists.
  assert.ok(PANEL.includes('select-all'), 'the number cannot be copied by selection')

  // BOTH WALLETS BY NAME, because the sentence this replaced said bKash and a Nagad
  // customer reads that as "not for me". The words module carries the two names in the
  // reader's own script — বিকাশ and নগদ — for the same reason.
  assert.ok(PANEL.includes('{words.walletBkash}'), 'only bKash is named')
  assert.ok(PANEL.includes('{words.walletNagad}'), 'Nagad is never named')
  // And the amount line points *below*, where the amount actually is.
  assert.ok(PANEL.includes('{words.sendAmount}'), 'the send block names no amount')

  // THE TWO CAUSES OF AN UNOPENABLE CARD STAY DISTINCT. An empty balance is not a read
  // that failed ("reload" over a balance of zero changes nothing), and a deployment with
  // no number configured is not a reload problem either.
  assert.ok(PANEL.includes('{words.dried}'), 'a lapsed centre is told to reload')
  assert.ok(
    PANEL.includes('{paymentPhone ? words.unreadable : words.unavailable}'),
    'the two reasons a card cannot take money are told apart',
  )
})

test('the history draws each day with its count and its rate', () => {
  // §11.12: a charge a customer cannot reconstruct is a charge they have to trust us
  // about. The month line is the collapse's, and the day line carries the count.
  assert.ok(PAGE.includes('words.monthLine('))
  assert.ok(PAGE.includes('words.dayLine(dayCount(day), formatTaka(day.costPoisha / 100))'))
  assert.ok(PAGE.includes('const history = collapseHistory(entries)'))
  // And the count is the day's own, in the reader's numerals, or a dash.
  assert.ok(PAGE.includes('digits(value, locale)'))
})

test('a day charged again as the roster grew says so on its own line', () => {
  // §11.7: the top-up is real and invisible in the arithmetic, so the row names it rather
  // than leaving a cost the customer cannot explain.
  assert.ok(PAGE.includes('{day.toppedUp && ('))
  assert.ok(PAGE.includes('{words.topUpNote}'))
})

test('a recharge links to its receipt, and only for an owner', () => {
  assert.ok(PAGE.includes('/settings/billing/receipt/${entry.paymentId}'))
  assert.ok(PAGE.includes('{entry.paymentId && isOwner && ('))
})

test('the ledger is read for an owner only and always scoped to the centre', () => {
  // `billing_ledger_owner_read` answers the owner; a manager's query would come back
  // empty, so it is skipped rather than sent (the plan page makes the same call).
  assert.ok(PAGE.includes("from('billing_ledger')"))
  assert.ok(PAGE.includes(".eq('coaching_center_id', session.active.centerId)"))
  assert.match(PAGE, /isOwner\s*\n\s*\?\s*supabase/)
  assert.ok(PAGE.includes('Promise.resolve({ data: null, error: null })'))

  // And the manager is told it is the owner's rather than shown an empty list.
  assert.ok(PAGE.includes('{words.historyOwnerOnly}'))
})

test('the screen draws the page bar, not a heading of its own', () => {
  assert.ok(PAGE.includes('<PageHeader'))
  assert.equal(PAGE.split('<h1').length - 1, 0, 'the bar owns the h1')
  assert.ok(PAGE.includes('back={{ href: \'/settings\', label: dict(locale).settings.hub.title }}'))
  assert.ok(PAGE.includes('const session = await pageRole(\'manager\')'))
})

/* -------------------------------------------------------------------------- */
/* The plan route is a redirect, and the blocks that moved with the screen      */
/* -------------------------------------------------------------------------- */

test('the plan route redirects to billing and renders nothing', () => {
  // §16.1 step 27, the demolition. The URL is shipped, so it stays as a route — and a
  // route with no view is the only shape that may carry no heading (page-header.test.ts
  // holds it to that, and to being a redirect rather than a screen).
  assert.match(REDIRECT, /^\s*redirect\('\/settings\/billing'\)/m)
  assert.doesNotMatch(REDIRECT, /<\/?[A-Za-z]/, 'the redirect draws something')
  // The page's thousand lines are gone rather than commented out beside it.
  assert.ok(REDIRECT.split('\n').length < 40, 'the demolished page is still in the file')
})

test('the bands are behind a disclosure, and the total is not', () => {
  // §33 and §20.4, carried over from the plan screen's own test when the calculator moved
  // (§20.4: "Both rules carry over to the rebuild and the test moves with them"). The rate
  // card was the tallest thing on the screen where somebody decides to start paying us;
  // one tap and it is all still there, from one engine.
  const detailsAt = CALC.indexOf('<details')
  const bandsAt = CALC.indexOf('STUDENT_BANDS.map')
  const totalAt = CALC.indexOf('t.monthly')

  assert.ok(detailsAt > 0, 'the calculator has no disclosure')
  assert.ok(bandsAt > detailsAt, 'the rate bands are printed outside the disclosure')
  assert.ok(CALC.indexOf('t.breakdown') > detailsAt, 'the working is outside it')
  assert.ok(totalAt < detailsAt, 'the total is inside the disclosure')

  // The seat rate is part of the rate card, and it is the one line that used to sit
  // below the bands rather than among them.
  assert.ok(CALC.indexOf('t.seatRate') > detailsAt, 't.seatRate is outside it')
})

test('a per-student tier advertises no ceiling this product would enforce', async () => {
  // §8 and §6: 100 batches and 200 subjects are abuse ceilings, not headroom. A centre
  // sold ninety-nine more batches has been sold a number we would refuse them at.
  //
  // THE COMPARISON BLOCK WENT AT STEP 28, and the string this test used to read went with
  // it. The four-tier difference table was the transition's own furniture — it compared a
  // tier against the next one up, which is a question §11.6 answers with a rate — so what
  // survives is the rule it enforced, asserted against the plan table rather than against
  // the markup that used to state it: no student cap, no teacher cap, no cap on one batch.
  // A tier gaining a finite cap fails here.
  const { PLANS } = await import('../src/lib/plans.ts')
  for (const id of ['center', 'institution'] as const) {
    const tier = PLANS[id]
    assert.equal(tier.maxStudents, null, `${id} would advertise a student ceiling`)
    assert.equal(tier.maxTeachers, null, `${id} would advertise a teacher ceiling`)
    assert.equal(tier.maxStudentsPerBatch, null, `${id} would advertise a batch size`)
    assert.ok(
      tier.maxBatches !== null && tier.pricing === 'per_student',
      `${id} is no longer the shape this rule was written for`,
    )
  }
})

test('the coverage-based cards are gone, and the way to reach us is what survives', () => {
  // §16.1 step 28. Four of the blocks that outlived the plan page retire here: the places
  // card with its pending purchase, the branch asks and their two answers, the subscription
  // window, and the four-tier ladder. Each sold coverage or a ceiling, and §11.6 sells a
  // balance instead — so what step 27 could only re-home, step 28 deletes. Asserted as an
  // absence, because a re-import is how a deleted card comes back.
  assert.ok(!PAGE.includes('<PlanCards'), 'the transition cards are back on the screen')

  for (const gone of ['plan-cards.tsx', 'ask-row.tsx', 'buy-subscription.tsx']) {
    assert.ok(
      !existsSync(path.join(ROOT, 'src', 'app', '(app)', 'settings', 'billing', gone)),
      `${gone} survived step 28`,
    )
  }

  // AND THE FIFTH BLOCK DID NOT RETIRE. §20.4 keeps "the request form and the way to reach
  // us", for `read-only.test.ts`'s reason: asking to pay is the way out. A free teacher who
  // wants Pro has no self-serve path, and a centre with no balance has no other door — so
  // the container was deleted and its one survivor was given a file of its own.
  const BILLING = ['src', 'app', '(app)', 'settings', 'billing']
  assert.ok(
    existsSync(path.join(ROOT, ...BILLING, 'upgrade-request.tsx')),
    'the request form went with the cards it lived in',
  )
  assert.ok(PAGE.includes('<ContactCard'), 'the way to reach us is no longer drawn')
  assert.ok(read(...BILLING, 'contact-card.tsx').includes('<UpgradeRequest'))

  // §3.6 and §11.12 hold these cards to one fact that survives them: the count a bill is
  // priced from is the organisation's, not the reader's building. That is the screen's own
  // `centerStudentCount` now, which is where the rate's `students` figure comes from.
  assert.ok(PAGE.includes('centerStudentCount(supabase, session.active.centerId)'))
})