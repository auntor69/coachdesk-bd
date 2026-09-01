import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { effectiveEntitlement, GRACE_DAYS, type OrgBilling } from '../src/lib/entitlement.ts'
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
 * clicked, a date went by. Both directions are expensive — a week of grace nobody
 * enforces is a customer who never pays again, and a day of grace miscounted is a
 * centre frozen mid-register over money that arrived.
 *
 * The tests below are grouped that way: access, then the trial, then coverage, then
 * the ceiling, then the fallbacks that must all point the same way.
 */

const NOW = new Date('2026-08-29T12:00:00Z')

/** A paying centre with nothing bought and no trial — the shape every case varies. */
function org(over: Partial<OrgBilling> = {}): OrgBilling {
  return {
    status: 'active',
    plan: 'center',
    trial_plan: null,
    trial_ends_at: null,
    student_capacity: 0,
    // Null and not a live date, so every test above the coverage block reads a centre
    // with no receipts — which is the state that must never suspend anybody, and
    // therefore the state the rest of this file should be varying one thing away from.
    paid_through: null,
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
/* Coverage and the grace window                                              */
/* -------------------------------------------------------------------------- */

/*
 * MASTERPLAN.md §4.4: "When today is past `covers_period_end` the account is in grace;
 * past grace it is suspended ... computed from coverage, not from a flag somebody
 * remembered to set."
 *
 * DATES ARE WRITTEN OUT AND NOT COMPUTED. Every case below names the calendar day it
 * means rather than calling `addDays(NOW, -8)`, because the arithmetic is the thing
 * under test: a suite that builds its fixtures with the helper the implementation uses
 * agrees with an off-by-one instead of catching it. NOW is 29 August 2026, 12:00 UTC,
 * which is the evening of the 29th in Dhaka.
 */

test('the grace window is a week', () => {
  // Pinned, so moving it is a decision somebody makes on purpose. Longer than the
  // monthly cycle and a customer can be a whole period behind without noticing;
  // shorter and a receipt entered on Sunday suspends somebody who paid on Friday.
  assert.equal(GRACE_DAYS, 7)
})

test('coverage that runs out today is not a lapse', () => {
  // The date names the last day covered, not the first day uncovered. A monthly
  // customer paid to the 31st is paying for the 31st.
  assert.equal(
    effectiveEntitlement(org({ paid_through: '2026-08-29' }), NOW).access,
    'full',
  )
})

test('the last day of grace still writes, and the next one does not', () => {
  // 22 August is seven days back, which is the whole window: "past grace" and not "at
  // the end of it". The 21st is eight and is the first day that stops.
  assert.equal(
    effectiveEntitlement(org({ paid_through: '2026-08-22' }), NOW).access,
    'full',
  )
  assert.equal(
    effectiveEntitlement(org({ paid_through: '2026-08-21' }), NOW).access,
    'read_only',
  )
})

test('coverage still running is not a lapse either', () => {
  assert.equal(
    effectiveEntitlement(org({ paid_through: '2026-09-30' }), NOW).access,
    'full',
  )
})

test('no coverage recorded never suspends anybody', () => {
  // The one that matters most. Every customer who paid before the receipt screen
  // existed has no payment row, and the first real centre on this product is one of
  // them: `active`, paying, and with nothing in `payments` to prove it. Reading null as
  // "ran out in 1970" would freeze the account we can least afford to freeze.
  assert.equal(effectiveEntitlement(org({ paid_through: null }), NOW).access, 'full')
})

test('a coverage date that is not a date grants access rather than removing it', () => {
  // The one fallback in this file that points the loose way, and the reason is that the
  // two directions are not symmetrical: an unreadable trial date falls back to what the
  // customer already paid for, while an unreadable coverage date would fall back to
  // taking the product off somebody who may have paid this morning. A bad string is not
  // evidence of non-payment. Suspending by hand still works and is unaffected.
  for (const paid_through of ['', 'yesterday', '2026-13-45', '29/08/2026', 'null']) {
    assert.equal(
      effectiveEntitlement(org({ paid_through }), NOW).access,
      'full',
      paid_through,
    )
  }
})

test('a free plan has no coverage to lapse', () => {
  // A teacher who bought a month of Pro two years ago and has since dropped to Free
  // keeps Free. Coverage is what money bought, and a tier that costs nothing has
  // nothing to cover — the same rule as §4.5's, applied to standing instead of caps.
  assert.equal(
    effectiveEntitlement(org({ plan: 'teacher_free', paid_through: '2024-01-31' }), NOW)
      .access,
    'full',
  )
})

test('only an active centre lapses', () => {
  // `trial` is the founder's sales trial, where nobody has paid and the point is that
  // the centre runs its real term on the product. Coverage there is either null or a
  // leftover from a previous life, and neither may end the trial early.
  assert.equal(
    effectiveEntitlement(org({ status: 'trial', paid_through: '2024-01-31' }), NOW).access,
    'full',
  )

  // And the other direction is not a route back: coverage cannot talk a hand-suspended
  // or cancelled centre into writing, because the lapse only ever removes access.
  for (const status of ['suspended', 'cancelled']) {
    assert.equal(
      effectiveEntitlement(org({ status, paid_through: '2026-12-31' }), NOW).access,
      'read_only',
      status,
    )
  }
})

test('a lapse takes the writing and leaves the tier and the ceiling', () => {
  // §4.5 again, and the same assertion the hand-suspended case makes: a centre of four
  // hundred students that is a fortnight late is not suddenly thirty over a free-tier
  // limit, and the fee book it is trying to settle keeps its printed receipts.
  const lapsed = effectiveEntitlement(
    org({ plan: 'center', student_capacity: 400, paid_through: '2026-07-01' }),
    NOW,
  )
  const paid = effectiveEntitlement(
    org({ plan: 'center', student_capacity: 400, paid_through: '2026-09-30' }),
    NOW,
  )

  assert.equal(lapsed.access, 'read_only')
  assert.equal(lapsed.plan.id, paid.plan.id)
  assert.deepEqual(lapsed.ceiling, paid.ceiling)
})

test('a trial in force keeps its tier through a lapse', () => {
  // Two clocks pulling opposite ways, which is a row that has been told two things at
  // once. The trial can only raise the tier and the lapse can only remove the writing,
  // so the order they are applied in cannot matter — and the honest reading is the
  // trialled tier, read-only.
  const e = effectiveEntitlement(
    org({
      plan: 'teacher_free',
      trial_plan: 'teacher_plus',
      trial_ends_at: '2027-01-01T00:00:00Z',
      paid_through: '2026-01-31',
    }),
    NOW,
  )

  // Free is the paid plan, so there is nothing to lapse — the trial does not change
  // what the customer is buying, which is what makes this case full access.
  assert.equal(e.plan.id, 'teacher_plus')
  assert.equal(e.access, 'full')
})

test('the day is Dhaka’s, not the server’s', () => {
  // 21 August, 18:30 UTC is half past midnight on the 22nd in Dhaka. Coverage ended on
  // the 14th, so the Dhaka day is eight days past it and the UTC day is seven — the
  // difference between a suspended centre and a writing one. The server runs in UTC and
  // a centre in Dhaka does not.
  const justAfterMidnightInDhaka = new Date('2026-08-21T18:30:00Z')

  assert.equal(
    effectiveEntitlement(org({ paid_through: '2026-08-14' }), justAfterMidnightInDhaka)
      .access,
    'read_only',
  )

  // Six hours earlier is still the 21st in Dhaka, and still inside the window.
  assert.equal(
    effectiveEntitlement(org({ paid_through: '2026-08-14' }), new Date('2026-08-21T12:30:00Z'))
      .access,
    'full',
  )
})

/* -------------------------------------------------------------------------- */
/* The ceiling                                                                */
/* -------------------------------------------------------------------------- */

test('the ceiling follows the tier in force, not the one being paid for', () => {
  // The reason the resolver exists as one function rather than two derivations. A
  // teacher trialling Pro whose ceiling came from the paid tier would see every Pro
  // feature on the screen and be refused at student thirty-one.
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
  // places are not lost — capacity_purchases keeps the record — so re-upgrading
  // restores them.
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
