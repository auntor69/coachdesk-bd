import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  billingStanding,
  dailyBurn,
  effectiveEntitlement,
  TRIAL_NOTICE_DAYS,
  trialStanding,
  type OrgBilling,
} from '../src/lib/entitlement.ts'
import { PLANS, PLAN_RANK, type PlanId } from '../src/lib/plans.ts'

/**
 * The one place that answers "what is this organisation allowed to do right now".
 *
 * MASTERPLAN.md §4.2 is three lines long and every one of them has a direction that
 * is expensive to get wrong. A status misread hands a cancelled customer a working
 * product or freezes a paying one; a trial misread hands out a paid tier forever or
 * ends it a day early; a ceiling derived from the wrong tier promises room the
 * database refuses. None of those show up as a crash — each one is a screen that
 * quietly says the wrong number to somebody who is paying.
 *
 * §4.4's lapse is the fourth and the only one that acts on its own: nothing was
 * clicked, a day went by and the balance could not cover it. Both directions are
 * expensive — a centre that keeps writing on money it does not have is a customer who
 * never tops up, and a day of a miscounted debt is a centre frozen mid-register over
 * money that arrived this morning.
 *
 * The tests below are grouped that way: access, then the trial, then the balance, then
 * the ceiling, then the fallbacks that must all point the same way.
 */

const NOW = new Date('2026-08-29T12:00:00Z')

/**
 * A paying centre, paid up through today, with an empty purse and no rate read.
 *
 * THE ORDINARY STATE, and the right shape to vary one thing away from: nothing is owed,
 * so an unrelated test that never thinks about money cannot accidentally be asserting a
 * lapse. `charged_through` is TODAY — 29 August in Dhaka, which is what NOW is — and not
 * a date in the future, so each billing case below moves exactly one field.
 */
function org(over: Partial<OrgBilling> = {}): OrgBilling {
  return {
    status: 'active',
    plan: 'center',
    trial_plan: null,
    trial_ends_at: null,
    student_capacity: 0,
    balance_poisha: 0,
    charged_through: '2026-08-29',
    daily_rate_poisha: null,
    ...over,
  }
}

/* -------------------------------------------------------------------------- */
/* Access                                                                     */
/* -------------------------------------------------------------------------- */

test('the two statuses that have paid, and the two that have not', () => {
  // `trial` is the founder's 30-day sales trial: nobody has paid, and the entire
  // point is that the centre runs its real term on the product. Refusing writes
  // there would refuse the trial itself.
  assert.equal(effectiveEntitlement(org({ status: 'trial' }), NOW).access, 'full')
  assert.equal(effectiveEntitlement(org({ status: 'active' }), NOW).access, 'full')

  assert.equal(effectiveEntitlement(org({ status: 'suspended' }), NOW).access, 'read_only')
  assert.equal(effectiveEntitlement(org({ status: 'cancelled' }), NOW).access, 'read_only')
})

test('a status that is not a status may not write', () => {
  // Unreachable through the enum, which is the point: the fallback is what a column
  // that has gone wrong lands on, and the safe reading of a row nobody can explain is
  // that it does not get to write. A `||` chain would have defaulted the other way.
  for (const status of ['', 'Active', 'ACTIVE', 'paid', 'grace', 'deleted', null]) {
    assert.equal(effectiveEntitlement(org({ status }), NOW).access, 'read_only', String(status))
  }
})

test('read-only never touches the plan or the ceiling', () => {
  // §4.4 and §4.5 together: a suspended centre keeps its tier and its ceiling, and
  // stops writing. Dropping them to Teacher Free instead would take printed receipts
  // and exports off the fee book they are trying to settle, and would tell a centre
  // of four hundred that it is thirty over its limit.
  const suspended = effectiveEntitlement(org({ status: 'suspended' }), NOW)
  const active = effectiveEntitlement(org({ status: 'active' }), NOW)

  assert.equal(suspended.plan.id, active.plan.id)
  assert.deepEqual(suspended.ceiling, active.ceiling)
})

/* -------------------------------------------------------------------------- */
/* The trial                                                                  */
/* -------------------------------------------------------------------------- */

test('a trial in force is the plan, and nothing says it was a trial', () => {
  const e = effectiveEntitlement(
    org({
      plan: 'teacher_free',
      trial_plan: 'teacher_plus',
      trial_ends_at: '2026-09-05T12:00:00Z',
    }),
    NOW,
  )

  assert.equal(e.plan.id, 'teacher_plus')
  // The result is three fields wide on purpose. A fourth saying "this is a trial"
  // would be read by a gate within a week, and a gate that branches on it is the
  // fifth plan this design exists to avoid.
  assert.deepEqual(Object.keys(e).sort(), ['access', 'ceiling', 'plan'])
})

test('the trial ends by comparison, not by anybody running anything', () => {
  const trialling = {
    plan: 'teacher_free',
    trial_plan: 'teacher_plus',
    trial_ends_at: '2026-08-29T12:00:00Z',
  }

  // A second before the instant it names: still Pro.
  assert.equal(
    effectiveEntitlement(org(trialling), new Date('2026-08-29T11:59:59Z')).plan.id,
    'teacher_plus',
  )

  // The instant itself is when it stops granting, not the last instant it grants.
  assert.equal(effectiveEntitlement(org(trialling), NOW).plan.id, 'teacher_free')

  // And a year later, with no job having run in between. This is the whole reason
  // expiry is a comparison: a cron that fails to fire would hand out a paid tier
  // indefinitely, and nobody would notice because nothing would look broken.
  assert.equal(
    effectiveEntitlement(org(trialling), new Date('2027-08-29T12:00:00Z')).plan.id,
    'teacher_free',
  )
})

test('a trial is never a downgrade', () => {
  // The stale-row case §4.3 invites: the founder sets `plan = 'center'` when a
  // customer pays and forgets to clear the trial fields. Honouring the trial would
  // take staff management, branches and centre-wide reporting off a centre in the
  // week it bought them.
  const e = effectiveEntitlement(
    org({
      plan: 'center',
      trial_plan: 'teacher_plus',
      trial_ends_at: '2026-09-05T12:00:00Z',
    }),
    NOW,
  )

  assert.equal(e.plan.id, 'center')
  assert.equal(e.plan.features.staffManagement, true)

  // Equal ranks are not an upgrade either — the customer who paid for exactly what
  // they were trialling keeps it, and the row being stale changes nothing.
  assert.equal(
    effectiveEntitlement(
      org({
        plan: 'teacher_plus',
        trial_plan: 'teacher_plus',
        trial_ends_at: '2026-09-05T12:00:00Z',
      }),
      NOW,
    ).plan.id,
    'teacher_plus',
  )
})

test('half a trial is no trial', () => {
  // `coaching_centers_trial_pair` makes both-or-neither a check constraint, so these
  // are unreachable from the database — and the resolver still has to answer, because
  // a plan with no end date is a permanent free upgrade and an end date with no plan
  // is a timer attached to nothing.
  for (const half of [
    { trial_plan: 'institution', trial_ends_at: null },
    { trial_plan: null, trial_ends_at: '2027-01-01T00:00:00Z' },
  ]) {
    assert.equal(
      effectiveEntitlement(org({ plan: 'teacher_free', ...half }), NOW).plan.id,
      'teacher_free',
    )
  }
})

test('a date that is not a date grants nothing', () => {
  // The failure this closes is subtle and points the wrong way. Every comparison
  // against NaN is false, so `endsAt <= now` written on its own answers "not expired"
  // for a garbled column — and a garbled column would become a paid tier granted
  // forever, on the tier the row happens to name.
  for (const bad of ['', 'next Tuesday', '2026-13-45T00:00:00Z', 'null']) {
    assert.equal(
      effectiveEntitlement(
        org({ plan: 'teacher_free', trial_plan: 'institution', trial_ends_at: bad }),
        NOW,
      ).plan.id,
      'teacher_free',
      bad,
    )
  }

  // And the same hole from the other side: an unusable `now`.
  assert.equal(
    effectiveEntitlement(
      org({
        plan: 'teacher_free',
        trial_plan: 'institution',
        trial_ends_at: '2027-01-01T00:00:00Z',
      }),
      new Date('not a time'),
    ).plan.id,
    'teacher_free',
  )
})

test('a Date works as well as the string PostgREST sends', () => {
  // timestamptz arrives as an ISO string over the wire, but a caller that has already
  // parsed one — a test, a founder screen resolving a list — must not have to
  // re-serialise it to ask this.
  const both = ['2026-09-05T12:00:00Z', new Date('2026-09-05T12:00:00Z')]

  for (const trial_ends_at of both) {
    assert.equal(
      effectiveEntitlement(
        org({ plan: 'teacher_free', trial_plan: 'teacher_plus', trial_ends_at }),
        NOW,
      ).plan.id,
      'teacher_plus',
    )
  }
})

test('a trial naming a tier that does not exist is not a trial', () => {
  // `planFor` answers Teacher Free for anything it does not recognise, which is the
  // right fallback and would be a downgrade if it were honoured — so the rank check
  // catches this one too rather than each bad value needing its own arm.
  assert.equal(
    effectiveEntitlement(
      org({ plan: 'center', trial_plan: 'teacher_ultra', trial_ends_at: '2027-01-01T00:00:00Z' }),
      NOW,
    ).plan.id,
    'center',
  )
})

/* -------------------------------------------------------------------------- */
/* What the trial notice says                                                 */
/* -------------------------------------------------------------------------- */

/** What migration 39 stamps on a self-serve signup: free tier, Pro for a fortnight. */
function trialling(trial_ends_at: string | Date): OrgBilling {
  return org({ plan: 'teacher_free', trial_plan: 'teacher_plus', trial_ends_at })
}

test('a running trial names the tier, the day it ends and the days left', () => {
  const s = trialStanding(trialling('2026-09-05T12:00:00Z'), NOW)

  assert.equal(s?.state, 'running')
  assert.equal(s?.plan.id, 'teacher_plus')
  assert.equal(s?.state === 'running' && s.endsOn, '2026-09-05')
  assert.equal(s?.state === 'running' && s.daysLeft, 7)
})

test('the last day counts zero days left, not one', () => {
  // 23:00 in Dhaka on the same day NOW falls on: still granting, and nothing left to
  // count. The banner says "today is the last day" off this, so a fencepost here is a
  // sentence promising a day that has already gone.
  const s = trialStanding(trialling('2026-08-29T17:00:00Z'), NOW)

  assert.equal(s?.state, 'running')
  assert.equal(s?.state === 'running' && s.daysLeft, 0)
  assert.equal(s?.state === 'running' && s.endsOn, '2026-08-29')
})

test('an ended trial says which tier stopped and when', () => {
  const s = trialStanding(trialling('2026-08-27T06:00:00Z'), NOW)

  // The tier that was lost, not the one left behind: the sentence is "your free Teacher
  // Pro trial has ended", and naming Teacher Free there would explain nothing.
  assert.equal(s?.plan.id, 'teacher_plus')
  assert.equal(s?.state === 'ended' && s.endedOn, '2026-08-27')
  assert.equal(s?.state === 'ended' && s.daysSince, 2)
})

test('a trial that ran out overnight in Dhaka ended today, and today is zero', () => {
  // 01:00 Dhaka on the 29th, which is the 28th in UTC. Read in UTC this would print
  // yesterday's date at a centre that lost Pro this morning, and a negative day count
  // is one bad subtraction away.
  const s = trialStanding(trialling('2026-08-28T19:00:00Z'), NOW)

  assert.equal(s?.state, 'ended')
  assert.equal(s?.state === 'ended' && s.endedOn, '2026-08-29')
  assert.equal(s?.state === 'ended' && s.daysSince, 0)
})

test('a Date works here too, as it does for the resolver', () => {
  // Same reason: a caller holding a parsed instant must not have to re-serialise it.
  assert.equal(trialStanding(trialling(new Date('2026-09-05T12:00:00Z')), NOW)?.state, 'running')
})

test('the notice never claims a tier the gates are refusing', () => {
  // The whole reason `trialStanding` delegates the running case to the same private
  // helper the resolver uses. Two expiry tests written twice is a banner promising a
  // fortnight of Pro while every feature on the screen says no, and the customer rings
  // about a bug that is really two clocks.
  const around = [
    '2026-08-20T12:00:00Z',
    '2026-08-29T11:59:59Z',
    '2026-08-29T12:00:00Z',
    '2026-08-29T12:00:01Z',
    '2026-09-30T12:00:00Z',
  ]

  for (const trial_ends_at of around) {
    const row = trialling(trial_ends_at)
    const s = trialStanding(row, NOW)
    const granted = effectiveEntitlement(row, NOW).plan.id

    assert.equal(s?.state === 'running' ? s.plan.id : 'teacher_free', granted, trial_ends_at)
  }
})

test('a stale trial that would be a downgrade is silent, before and after it ends', () => {
  // §4.3 has the founder clearing these two columns when a customer pays. A founder who
  // sets plan = 'center' and forgets leaves a teacher_plus row behind, and telling a
  // paying Coaching Center customer that their Teacher Pro trial ended is a support
  // call about nothing at all.
  for (const trial_ends_at of ['2026-09-30T12:00:00Z', '2026-08-01T12:00:00Z']) {
    assert.equal(
      trialStanding(org({ plan: 'center', trial_plan: 'teacher_plus', trial_ends_at }), NOW),
      null,
      trial_ends_at,
    )
  }

  // Same rule catching a tier nobody recognises, which `planFor` reads as Teacher Free.
  assert.equal(
    trialStanding(
      org({ plan: 'center', trial_plan: 'teacher_ultra', trial_ends_at: '2027-01-01T00:00:00Z' }),
      NOW,
    ),
    null,
  )
})

test('a centre with no trial columns, and no centre at all, say nothing', () => {
  assert.equal(trialStanding(org(), NOW), null)
  assert.equal(trialStanding(org({ trial_plan: 'institution' }), NOW), null)
  assert.equal(trialStanding(org({ trial_ends_at: '2026-09-30T12:00:00Z' }), NOW), null)
  assert.equal(trialStanding(null, NOW), null)
})

test('an unreadable clock on either side says nothing rather than throwing', () => {
  // Not the same failure mode as the resolver's: `todayInDhaka` hands an invalid Date
  // to Intl, which throws, so this cannot lean on NaN comparisons quietly answering
  // false. A garbled column has to be caught before the formatting.
  assert.equal(trialStanding(trialling('not a date'), NOW), null)
  assert.equal(trialStanding(trialling('2026-09-05T12:00:00Z'), new Date('not a time')), null)
})

test('an old trial still reports, and reports old', () => {
  // The window is the caller's decision, not this function's: it answers what the row
  // says, and the shell drops it past TRIAL_NOTICE_DAYS. A month-old trial must
  // therefore come back non-null with a day count far outside the window, because the
  // shell's whole test is that number.
  const s = trialStanding(trialling('2026-07-20T12:00:00Z'), NOW)

  assert.equal(s?.state, 'ended')
  assert.ok(s?.state === 'ended' && s.daysSince > TRIAL_NOTICE_DAYS, 'outside the notice window')
})

/* -------------------------------------------------------------------------- */
/* The balance, and what it takes away                                        */
/* -------------------------------------------------------------------------- */

/*
 * MASTERPLAN.md §4.4/§11.7: access is `balance < owed`, where `owed` is
 * `greatest(0, today − charged_through) × dailyRate`. There is no grace window and no
 * coverage date left — a charge allowed to sit unpaid is credit, and this is a prepaid
 * product — and the whole point of a comparison is that it needs nothing to have run: a
 * centre that never opens the app still lapses on exactly the right day.
 *
 * DATES AND RATES ARE WRITTEN OUT AND NOT COMPUTED. Every case below names the calendar
 * day and the poisha it means rather than calling `addDays(NOW, -8)` or `dailyRatePoisha`,
 * because the arithmetic is the thing under test: a suite that builds its fixtures with
 * the helper the implementation uses agrees with an off-by-one instead of catching it.
 * NOW is 29 August 2026, 12:00 UTC, which is the evening of the 29th in Dhaka.
 *
 * ONE DAY IS ONE TAKA HERE, AND ONLY FOR READING. The real figure is `plans.ts`'s,
 * `floor(monthly × 100 / 30)` — ৳86.66 a day at ৳2,600 a month — and a round number is
 * used below because a failure in a comparison is easier to see than one in a legend of
 * digits. `daily_rate_poisha` is a number handed back by the settlement (§11.7), never a
 * figure this file could derive, so nothing here is testing a rate calculation.
 */

const RATE = 100

test('a line at today owes nothing, whatever the balance and the rate say', () => {
  // THE COMMON PATH, and the reason an unreadable head count cannot lock a paying
  // centre out: with the line at today, `owed` is zero and the rate is never consulted,
  // so a rate nobody could read is a rate that did not matter. The empty balance is a
  // centre that has spent everything it had and is paid up to the end of the day.
  assert.equal(
    effectiveEntitlement(
      org({ charged_through: '2026-08-29', daily_rate_poisha: null, balance_poisha: 0 }),
      NOW,
    ).access,
    'full',
  )

  // A line past today is granted days — a sales trial, a goodwill extension — and it owes
  // nothing either. §4.4: a trial is days, not a status.
  assert.equal(
    effectiveEntitlement(org({ charged_through: '2026-09-30', balance_poisha: 0 }), NOW)
      .access,
    'full',
  )
})

test('a day the balance cannot cover takes the writing, and no more', () => {
  // One taka a day, one day owed, nothing to pay it with. The centre still reads
  // everything and cannot save anything, which is §4.4's whole lever.
  assert.equal(
    effectiveEntitlement(
      org({ charged_through: '2026-08-28', daily_rate_poisha: RATE, balance_poisha: 0 }),
      NOW,
    ).access,
    'read_only',
  )

  // One day's worth is enough, and the comparison is `balance < owed` rather than `<=`:
  // whole days or nothing means the day whose money is in the balance is bought rather
  // than nearly bought, and the balance lands at zero once it has been spent.
  assert.equal(
    effectiveEntitlement(
      org({ charged_through: '2026-08-28', daily_rate_poisha: RATE, balance_poisha: RATE }),
      NOW,
    ).access,
    'full',
  )
})

test('owed counts every day behind, not the first one', () => {
  // Three days behind is three days' money. An implementation that charged for today
  // alone would hand a fortnight of free product to a centre nobody billed, and it would
  // look right in every single-day test in this file.
  const three = org({
    charged_through: '2026-08-26',
    daily_rate_poisha: RATE,
    balance_poisha: RATE * 2,
  })
  assert.equal(effectiveEntitlement(three, NOW).access, 'read_only')

  assert.equal(
    effectiveEntitlement(org({ ...three, balance_poisha: RATE * 3 }), NOW).access,
    'full',
  )
})

test('a rate that could not be read is read-only, and only where it is needed', () => {
  // §11.7: "Where the rate *is* needed and cannot be read, the answer is `read_only`."
  // Needed means behind, so the same unreadable rate on a centre that is paid up grants
  // full access — that is the case above, and it is asserted again here as the pair,
  // because the two are one decision and a change to either must move both. An empty
  // rate read as zero would hand the product away; an empty rate read as an accusation
  // would freeze a customer over a failed head count.
  const behind = org({ charged_through: '2026-08-28', daily_rate_poisha: null })
  assert.equal(effectiveEntitlement(behind, NOW).access, 'read_only')
  assert.equal(
    effectiveEntitlement({ ...behind, charged_through: '2026-08-29' }, NOW).access,
    'full',
  )
})

test('a balance nobody could read is read-only while the day is owed', () => {
  // The other half of the same fallback, and it fails the same way: behind, with a rate
  // and nothing to compare it against, is read-only. A null read as zero would be the
  // one shape that hands the product out.
  assert.equal(
    effectiveEntitlement(
      org({ charged_through: '2026-08-28', daily_rate_poisha: RATE, balance_poisha: null }),
      NOW,
    ).access,
    'read_only',
  )
})

test('a line that is not a date, and a line never drawn at all, are not debts', () => {
  // `daysBetween` answers zero for a date it cannot parse, and zero days behind is paid
  // up. That is the loose direction on purpose, and it is the one this file has always
  // taken for an unreadable date: a bad string is evidence of nothing, the founder can
  // still suspend by hand, and a customer mid-transfer must not lose the product to a
  // mangled column. A count we could not take is a different thing entirely — see the
  // unreadable rate above, which fails the other way.
  for (const charged_through of ['', 'yesterday', '2026-13-45', '29/08/2026', 'null']) {
    assert.equal(
      effectiveEntitlement(org({ charged_through, daily_rate_poisha: RATE }), NOW).access,
      'full',
      charged_through,
    )
  }

  // Null is a centre whose ledger holds no line at all, and it owes nothing by
  // construction — there is no day that could have been charged and then not paid for.
  // Reading it as "behind since 1970" would bill a customer for a past they were not on
  // this model for, which is the one mistake §11.14's back-fill exists to prevent.
  assert.equal(
    effectiveEntitlement(org({ charged_through: null, daily_rate_poisha: RATE }), NOW)
      .access,
    'full',
  )
})

test('a free plan burns nothing and never lapses', () => {
  // §11.6: the free tier's rate is zero, so `owed` is zero however far behind the line
  // has fallen — "the arithmetic returns zero", not a branch somebody remembered. A
  // teacher who once bought a month of Pro and has since dropped to Free keeps Free
  // forever, which is §4.5's rule applied to standing instead of caps.
  assert.equal(
    effectiveEntitlement(
      org({ plan: 'teacher_free', charged_through: '2024-01-31', daily_rate_poisha: null }),
      NOW,
    ).access,
    'full',
  )
})

test('only a status that may write can lose the writing to money', () => {
  // The floor and the balance are answered separately and combined in one direction.
  // `trial` is the founder's sales trial, where nobody has paid — and §4.4 grants a
  // trial as *days*, so the balance can take the writing from a trial that has run out
  // of them. That is the mechanism the status stopped being.
  const dry = { charged_through: '2026-08-28', daily_rate_poisha: RATE, balance_poisha: 0 }
  assert.equal(
    effectiveEntitlement(org({ ...dry, status: 'trial' }), NOW).access,
    'read_only',
  )

  // And nothing goes the other direction: a full purse is not a route back into a centre
  // a human suspended or cancelled. Those two switches are not about money.
  for (const status of ['suspended', 'cancelled']) {
    assert.equal(
      effectiveEntitlement(org({ status, balance_poisha: 10_000_000 }), NOW).access,
      'read_only',
      status,
    )
  }
})

test('a dry balance takes the writing and leaves the tier and the ceiling', () => {
  // §4.5 again, and the same assertion the hand-suspended case makes: a centre of four
  // hundred students whose balance ran out is not suddenly thirty over a free-tier
  // limit, and the fee book it is trying to settle keeps its printed receipts.
  const dry = effectiveEntitlement(
    org({
      plan: 'center',
      student_capacity: 400,
      charged_through: '2026-08-28',
      daily_rate_poisha: RATE,
      balance_poisha: 0,
    }),
    NOW,
  )
  const paid = effectiveEntitlement(
    org({ plan: 'center', student_capacity: 400, balance_poisha: RATE * 30 }),
    NOW,
  )

  assert.equal(dry.access, 'read_only')
  assert.equal(paid.access, 'full')
  assert.equal(dry.plan.id, paid.plan.id)
  assert.deepEqual(dry.ceiling, paid.ceiling)
})

test('a trial lifts the tier, and the balance only takes the writing', () => {
  // Two clocks pulling opposite ways, which is a row that has been told two things at
  // once. The trial can only raise the tier and the balance can only remove the writing,
  // so the order they are applied in cannot matter — and the honest reading is the
  // trialled tier, read-only.
  const e = effectiveEntitlement(
    org({
      plan: 'center',
      trial_plan: 'institution',
      trial_ends_at: '2027-01-01T00:00:00Z',
      charged_through: '2026-08-28',
      daily_rate_poisha: RATE,
      balance_poisha: 0,
    }),
    NOW,
  )

  assert.equal(e.plan.id, 'institution')
  assert.equal(e.access, 'read_only')

  // A free plan is the exception, and it is the same rule rather than a second one: Free
  // has no rate, so there is nothing owed and nothing can take the writing away. A
  // Teacher Pro trial on a free centre therefore ends as a full-access free centre —
  // which is §4.5's promise that nobody's data is taken away on a downgrade.
  const free = effectiveEntitlement(
    org({
      plan: 'teacher_free',
      trial_plan: 'teacher_plus',
      trial_ends_at: '2027-01-01T00:00:00Z',
      charged_through: '2026-01-31',
      balance_poisha: 0,
    }),
    NOW,
  )

  assert.equal(free.plan.id, 'teacher_plus')
  assert.equal(free.access, 'full')
})

test('the day is Dhaka’s, not the server’s', () => {
  // 21 August, 18:30 UTC is half past midnight on the 22nd in Dhaka, and the line is at
  // the 21st — so the Dhaka day is one day owed where the UTC day is none. The server
  // runs in UTC and a centre in Dhaka does not, and the difference is a register that
  // refuses to save for six hours every night.
  const behind = org({ charged_through: '2026-08-21', daily_rate_poisha: RATE })

  assert.equal(
    effectiveEntitlement(behind, new Date('2026-08-21T18:30:00Z')).access,
    'read_only',
  )

  // Six hours earlier it is still the 21st in Dhaka: the line is at today, and the
  // balance is never consulted because there is nothing owed against it.
  assert.equal(
    effectiveEntitlement(behind, new Date('2026-08-21T12:30:00Z')).access,
    'full',
  )
})

/* -------------------------------------------------------------------------- */
/* The figures the rail and the banner are drawn from                         */
/* -------------------------------------------------------------------------- */

test('the standing says what is owed, what a day costs, and what is left', () => {
  // `billingStanding` is the one arithmetic three readers share: the resolver above,
  // the shell's rail, and the banner. A second division of the balance by the rate is
  // how a screen and the refusal behind it come to disagree about the same centre.
  const s = billingStanding(
    org({ charged_through: '2026-08-26', daily_rate_poisha: RATE, balance_poisha: RATE * 5 }),
    NOW,
  )

  assert.equal(s.today, '2026-08-29')
  assert.equal(s.chargedThrough, '2026-08-26')
  assert.equal(s.daysOwed, 3)
  assert.equal(s.daysLeft, 5)
  assert.equal(s.lapsed, false)
})

test('days left are whole days, because part of a day buys nothing', () => {
  // §11.7's rule, in the figure the owner reads: ৳3.40 buys three days at ৳1.00 and the
  // fourth is not nearly bought. A rail that rounded up would promise the day the burn
  // is about to refuse.
  const s = billingStanding(
    org({ balance_poisha: 340, daily_rate_poisha: RATE }),
    NOW,
  )

  assert.equal(s.daysOwed, 0)
  assert.equal(s.daysLeft, 3)
  assert.equal(s.lapsed, false)
})

test('a free tier has no days to count and none to run out of', () => {
  // Null rather than a large number or an infinity: the rail draws nothing on a free
  // centre, and a figure nobody can divide is not a figure.
  const s = billingStanding(
    org({ plan: 'teacher_free', charged_through: '2024-01-31', balance_poisha: 500 }),
    NOW,
  )

  assert.equal(s.daysLeft, null)
  assert.equal(s.daysOwed, 0)
  assert.equal(s.lapsed, false)
})

test('no centre draws no figures rather than a full purse', () => {
  // The floor, and the same total answer the resolver gives for the same reason: a reader
  // with no centre is read-only because there is nothing to write to. The banner has to
  // check `active` before it says a word, or an account midway through onboarding is told
  // its centre has lapsed — this is what stops the rail saying anything at all.
  assert.deepEqual(billingStanding(null, NOW), {
    today: '2026-08-29',
    chargedThrough: null,
    daysOwed: 0,
    dailyRatePoisha: null,
    balancePoisha: null,
    daysLeft: null,
    lapsed: false,
  })
})

test('the burn is asked for by every centre whose days cost anything', () => {
  // `dailyBurn` decides whether a page load asks the burn for the day's figures, and it
  // deliberately does NOT try to predict whether anything is owed. That guess was the
  // first draft and it was wrong twice over: it hid the rate from the rail on exactly the
  // days the rail is for, and it was a second opinion about money that the burn answers
  // itself, under the ledger's lock.
  //
  // What is left is the one plan with no rate at all. A free centre's line never moves,
  // so a call would return `nothing_due` every day for the rest of its life — and there
  // is no figure for the rail to draw either.
  assert.equal(dailyBurn(org({ plan: 'teacher_free' })), false)
  assert.equal(dailyBurn(org({ plan: 'teacher_plus' })), true)
  assert.equal(dailyBurn(org({ plan: 'center' })), true)
  assert.equal(dailyBurn(org({ plan: 'institution' })), true)

  // A plan nobody can name reads as Teacher Free, which is `planFor`'s fallback and the
  // narrow direction for every gate in the product (§4.2) — a row that has gone wrong is
  // granted the fewest features, and a tier with no price burns nothing. It is worth
  // being explicit that this is the same rule rather than a second one: the alternative
  // would be charging a centre at a rate derived from a plan name that does not exist.
  assert.equal(dailyBurn(org({ plan: null })), false)
  assert.equal(dailyBurn(org({ plan: 'nonsense' })), false)
})

/* -------------------------------------------------------------------------- */
/* The ceiling                                                                */
/* -------------------------------------------------------------------------- */

test('the ceiling follows the tier in force, not the one being paid for', () => {
  // The reason the resolver exists as one function rather than two derivations. A
  // teacher trialling Pro whose ceiling came from the paid tier would see every Pro
  // feature on the screen and be refused at student thirty-one — which is what the
  // database did until 20260811000060 taught the trigger this same rule.
  const e = effectiveEntitlement(
    org({
      plan: 'teacher_free',
      trial_plan: 'teacher_plus',
      trial_ends_at: '2026-09-05T12:00:00Z',
    }),
    NOW,
  )

  assert.deepEqual(e.ceiling, { kind: 'plan', ceiling: PLANS.teacher_plus.maxStudents })
})

test('a centre ceiling is the greater of what the floor gave and what was bought', () => {
  // `kind` is what a refusal reads to choose its words: a centre is told to buy
  // places, never to change plan. See studentCeiling.
  const included = effectiveEntitlement(org({ student_capacity: 0 }), NOW).ceiling
  assert.equal(included.kind, 'purchased')

  const floor = included.ceiling
  assert.ok(floor > 0, 'the floor includes students')

  // Bought less than the floor already gave: the floor still holds. A capacity of
  // zero is what every fresh centre looks like, and it must not mean "no students".
  assert.equal(effectiveEntitlement(org({ student_capacity: 1 }), NOW).ceiling.ceiling, floor)

  // Bought more: the purchase holds.
  assert.equal(
    effectiveEntitlement(org({ student_capacity: floor + 250 }), NOW).ceiling.ceiling,
    floor + 250,
  )
})

test('purchased places are ignored on a teacher tier', () => {
  // A centre that bought 900 places and dropped to Teacher Pro lands on 150, because
  // limits apply to new actions and the new action is priced by the new plan. The
  // places are not lost: `student_capacity` still holds the number and this is the
  // function ignoring it, not the column being cleared. So re-upgrading restores them.
  const e = effectiveEntitlement(org({ plan: 'teacher_plus', student_capacity: 900 }), NOW)

  assert.deepEqual(e.ceiling, { kind: 'plan', ceiling: PLANS.teacher_plus.maxStudents })
})

test('a capacity column that has gone wrong reads as nothing bought', () => {
  const floor = effectiveEntitlement(org(), NOW).ceiling.ceiling

  for (const student_capacity of [null, -1, -900, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      effectiveEntitlement(org({ student_capacity }), NOW).ceiling.ceiling,
      floor,
      String(student_capacity),
    )
  }
})

/* -------------------------------------------------------------------------- */
/* Fallbacks, all pointing the same way                                       */
/* -------------------------------------------------------------------------- */

test('no organisation in view lands on the floor and may not write', () => {
  // Two causes, one answer: an account that has not made a centre yet, and a
  // `center_members` read that did not arrive. requireCenter tells those apart
  // upstream because one of them is a door and the other is not; here they are both
  // the narrowest thing this function can say.
  const e = effectiveEntitlement(null, NOW)

  assert.equal(e.access, 'read_only')
  assert.equal(e.plan.id, 'teacher_free')
  assert.deepEqual(e.ceiling, { kind: 'plan', ceiling: PLANS.teacher_free.maxStudents })
})

test('a plan nobody recognises is the free tier', () => {
  // Same direction as everything else here, and the same answer planFor already
  // gives: an unreadable tier grants the least, never the most.
  for (const plan of [null, '', 'center_plus', 'Center', 'institution ']) {
    assert.equal(effectiveEntitlement(org({ plan }), NOW).plan.id, 'teacher_free', String(plan))
  }
})

test('every tier resolves to itself when nothing else is going on', () => {
  // The boring case, asserted because it is the one every screen actually hits, and
  // because a rank comparison written the wrong way round would break all four of
  // these at once rather than only the trial tests.
  for (const id of Object.keys(PLANS) as PlanId[]) {
    const e = effectiveEntitlement(org({ plan: id }), NOW)
    assert.equal(e.plan.id, id)
    assert.equal(e.access, 'full')
  }
})

test('the rank is a strict order over every tier', () => {
  // What the no-downgrade rule rests on. Two tiers sharing a rank would make one of
  // them unable to be trialled from the other, silently.
  const ranks = (Object.keys(PLANS) as PlanId[]).map((id) => PLAN_RANK[id])

  assert.equal(new Set(ranks).size, ranks.length, 'no two tiers share a rank')
  assert.equal(PLAN_RANK.teacher_free, Math.min(...ranks), 'free grants the least')
  assert.equal(PLAN_RANK.institution, Math.max(...ranks), 'institution grants the most')
})

test('entitlement.ts stays importable from a client component', () => {
  // Same reason capacity.ts has no imports at all: a gate that reads the plan runs in
  // client components too, and pulling the dictionary or a Supabase client in behind
  // it would ship all of that to a phone on 3G. The generated types are a type-only
  // import and are erased.
  //
  // `bd/time.ts` is on the list as of §4.4's lapse, and it earns its place rather than
  // being waved through: it imports one type and calls Intl, which every browser that
  // can run this app already has. The alternative was adding six hours to a UTC date by
  // hand in here, which is the assumption that module exists to stop anybody making.
  const source = readFileSync(
    path.join(import.meta.dirname, '..', 'src', 'lib', 'entitlement.ts'),
    'utf8',
  )

  const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1])

  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ['./bd/time.ts', './plans.ts', './supabase/types.ts'],
  )
  assert.match(source, /import type \{ CenterStatus \} from '\.\/supabase\/types\.ts'/)
})

/*
 * The one write that ends a trial, checked where the reads of it are.
 *
 * Everything above resolves a trial that is *there*; §4.3 has the founder clearing the
 * pair when a customer pays, and `setCenterPlan` is the only code that does. Nothing
 * else in the repo would notice it stopping: a stale pair cannot demote anybody, so the
 * symptom is a centre quietly holding a tier nobody agreed for however long the old
 * `trial_ends_at` said — which is exactly the shape of failure no test catches by
 * accident.
 */
test('the founder’s plan form ends a trial the customer has just answered', () => {
  const source = readFileSync(
    path.join(import.meta.dirname, '..', 'src', 'app', 'founder', 'actions.ts'),
    'utf8',
  )
  const body = source.slice(source.indexOf('export async function setCenterPlan'))
  const update = body.slice(body.indexOf('.update('), body.indexOf(".eq('id', centerId)"))

  // Keyed on what the tier costs, not on which tier it is, so a paid teacher tier added
  // tomorrow clears the pair by being paid for rather than by being listed here.
  assert.match(update, /limits\.pricing === 'free'/)

  const arms = [...update.matchAll(/\{[^{}]*\}/g)].map((m) => m[0])
  assert.equal(arms.length, 2, 'setCenterPlan no longer writes two shapes of row')
  const [free, paid] = arms

  // The free arm touches neither column. `bootstrap_center` starts every signup on a
  // fortnight of Plus, so an unconditional clear would take it off a three-day-old
  // centre whose status the founder was correcting.
  assert.doesNotMatch(free, /trial_/)

  // Both halves on the paid arm, because coaching_centers_trial_pair refuses one
  // without the other — clearing only the plan is a constraint violation, and clearing
  // only the date is a permanent grant.
  assert.match(paid, /trial_plan: null/)
  assert.match(paid, /trial_ends_at: null/)
})
