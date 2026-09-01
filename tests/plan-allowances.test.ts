/**
 * The seeded plan allowances and `plans.ts` must agree.
 *
 * WHY THIS TEST EXISTS. `app.student_ceiling` reads its numbers from the
 * `plan_allowances` table because a trigger cannot import TypeScript, and the moment
 * a number lives in two places one of them is wrong. The failure is silent in the
 * worst direction: reprice the first band, forget the migration, and every centre's
 * included seats quietly stop matching what their floor paid for — no error, no
 * screen, just a bill and a ceiling that disagree.
 *
 * So the migration's INSERT is parsed out of the file rather than restated here. A
 * copy of the four numbers in this test would be a third source of truth and would
 * pass while both of the others drifted.
 *
 * The same argument brought in 20260811000060, which decides how many places a live
 * trial admits. Its rank test is native enum comparison, so `PLAN_RANK` and the enum's
 * declared order are one more pair of numbers living in two places.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  PLANS,
  PLAN_RANK,
  capacityPressure,
  includedStudents,
  monthlyBillBdt,
  monthlyFloorBdt,
  seatsCoveredByFloor,
  studentCeiling,
  studentChargeBdt,
  studentRoom,
  CAPACITY_NOTICE_SHARE,
  CAPACITY_URGENT_SHARE,
  CENTER_MONTHLY_FLOOR_BDT,
  INSTITUTION_MONTHLY_FLOOR_BDT,
  type PlanId,
} from '../src/lib/plans.ts'

const ROOT = path.join(import.meta.dirname, '..')
const migration = (file: string) =>
  readFileSync(path.join(ROOT, 'supabase', 'migrations', file), 'utf8')

const MIGRATION = migration('20260811000036_student_capacity.sql')
const TRIAL_CEILING = migration('20260811000060_trial_ceiling.sql')
const INIT = migration('20260811000001_init_schema.sql')

/** The allowances the database will hold, read out of the migration that seeds them. */
function seededAllowances(): Map<string, number> {
  const statement = /insert\s+into\s+public\.plan_allowances[^;]*;/i.exec(MIGRATION)
  assert.ok(statement, 'migration 36 no longer seeds plan_allowances')

  // The column list `(plan, included_students)` carries no quoted string, so it
  // cannot match this and does not need excluding.
  const rows = [...statement[0].matchAll(/\(\s*'([a-z_]+)'\s*,\s*(\d+)\s*\)/g)]
  assert.ok(rows.length > 0, 'the plan_allowances seed parsed to nothing')

  return new Map(rows.map((row) => [row[1], Number(row[2])]))
}

test('every plan has a seeded allowance', () => {
  // A missing row is not a smaller ceiling, it is no ceiling: student_ceiling inner
  // joins plan_allowances, so a plan with no row returns null and the capacity
  // trigger refuses every insert that centre attempts. Adding a fifth tier without
  // touching this table would take it offline on its first student.
  const seeded = [...seededAllowances().keys()].sort()
  const known = (Object.keys(PLANS) as PlanId[]).slice().sort()

  assert.deepEqual(seeded, known)
})

test('the teacher tiers allow exactly what their plan caps them at', () => {
  // These two numbers never move with anything a centre buys, so the allowance IS
  // the cap and the two must be the same figure.
  const seeded = seededAllowances()

  assert.equal(seeded.get('teacher_free'), PLANS.teacher_free.maxStudents)
  assert.equal(seeded.get('teacher_plus'), PLANS.teacher_plus.maxStudents)
})

test('the centre tiers allow what their floor has already paid for', () => {
  // Not a separate pricing decision and not a generosity: a centre that pays the
  // floor and is refused its first student has bought nothing. Derived from the
  // floor and the bands so a repricing moves both ends together.
  const seeded = seededAllowances()

  assert.equal(seeded.get('center'), seatsCoveredByFloor(monthlyFloorBdt(PLANS.center)))
  assert.equal(
    seeded.get('institution'),
    seatsCoveredByFloor(monthlyFloorBdt(PLANS.institution)),
  )
})

test('every seeded allowance is what includedStudents says', () => {
  // The assertion that actually matters, and the reason includedStudents exists: it
  // is the single function the app resolves an allowance through, so checking the
  // seed against it checks the seed against every screen at once. The two tests above
  // are the same claim spelled out per tier, kept because a failure in one of them
  // says which half moved.
  const seeded = seededAllowances()

  for (const plan of Object.values(PLANS)) {
    assert.equal(seeded.get(plan.id), includedStudents(plan), plan.id)
  }
})

test('a floor buys every seat it pays for and not one more', () => {
  // The property, rather than the two numbers. 79 and 238 are consequences.
  for (const floor of [CENTER_MONTHLY_FLOOR_BDT, INSTITUTION_MONTHLY_FLOOR_BDT]) {
    const seats = seatsCoveredByFloor(floor)

    assert.ok(studentChargeBdt(seats) <= floor, `${seats} students cost more than ৳${floor}`)
    assert.ok(
      studentChargeBdt(seats + 1) > floor,
      `৳${floor} covers ${seats + 1} students, so the allowance is short by at least one`,
    )
  }

  // Written out as well, so the diff on a repricing shows what the seats used to be
  // rather than only that the property still holds. These are inputs to the
  // function, not the floor constants restated.
  assert.equal(seatsCoveredByFloor(1999), 79)
  assert.equal(seatsCoveredByFloor(4999), 238)
})

test('nothing pays for a seat it did not buy', () => {
  // The guards, and every one of these has a caller: a plan whose floor has not been
  // decided yet is 0, and a NaN out of a form field must not become Infinity seats.
  assert.equal(seatsCoveredByFloor(0), 0)
  assert.equal(seatsCoveredByFloor(-1), 0)
  assert.equal(seatsCoveredByFloor(Number.NaN), 0)
  assert.equal(seatsCoveredByFloor(Number.POSITIVE_INFINITY), 0)

  // Under the first student's price is still no students.
  assert.equal(seatsCoveredByFloor(24), 0)
  assert.equal(seatsCoveredByFloor(25), 1)

  // More money never buys fewer seats. A band boundary is where that could break.
  let previous = 0
  for (const floor of [25, 100, 1999, 2500, 2501, 4999, 7300, 7301, 20000]) {
    const seats = seatsCoveredByFloor(floor)
    assert.ok(seats >= previous, `৳${floor} bought ${seats}, fewer than the floor below it`)
    previous = seats
  }
})

test('an institution pays its own floor, not a centre’s', () => {
  // The bug this catches: monthlyBillBdt read CENTER_MONTHLY_FLOOR_BDT for every
  // per-student tier, which billed an institution ৳1,999 — a ৳3,000 discount that
  // nobody decided on and that no screen would have shown as wrong.
  assert.equal(monthlyBillBdt(PLANS.institution, 1), INSTITUTION_MONTHLY_FLOOR_BDT)
  assert.equal(monthlyBillBdt(PLANS.center, 1), CENTER_MONTHLY_FLOOR_BDT)

  // Above both floors the bands are identical, so the tiers cost the same for the
  // same students. Institution buys branches, not a different rate card.
  assert.equal(monthlyBillBdt(PLANS.institution, 400), monthlyBillBdt(PLANS.center, 400))

  // The teacher tiers must not reach the floor at all.
  assert.equal(monthlyBillBdt(PLANS.teacher_free, 900), 0)
  assert.equal(monthlyBillBdt(PLANS.teacher_plus, 900), PLANS.teacher_plus.priceBdt)
})

test('a teacher tier ignores purchased capacity entirely', () => {
  // The downgrade case, and the one worth getting wrong quietly: a centre that bought
  // 900 places and moved to Teacher Pro lands on 150. Limits apply to new actions and
  // the new action is priced by the new plan. Nothing is lost — the purchase record
  // outlives the plan — but the ceiling is the plan's.
  for (const plan of [PLANS.teacher_free, PLANS.teacher_plus]) {
    for (const bought of [0, 120, 900]) {
      const ceiling = studentCeiling(plan, bought)
      assert.equal(ceiling.kind, 'plan', plan.id)
      assert.equal(ceiling.ceiling, plan.maxStudents, `${plan.id} @ ${bought}`)
    }
  }
})

test('a centre gets the greater of what it was included and what it bought', () => {
  // The same rule as app.student_ceiling, which is the half that enforces it. If
  // these two ever disagree the app promises room the database refuses.
  const included = includedStudents(PLANS.center)

  // Zero capacity is what every centre looks like before its first top-up, and it
  // must not mean "no students" — that would refuse the first student of a customer
  // who has just paid the floor.
  assert.deepEqual(studentCeiling(PLANS.center, 0), {
    kind: 'purchased',
    ceiling: included,
    included,
    purchased: 0,
  })

  // Bought less than the floor already gave: the floor still wins.
  assert.equal(studentCeiling(PLANS.center, included - 10).ceiling, included)

  // Bought more: the purchase wins, and that is the whole point of the column.
  assert.equal(studentCeiling(PLANS.center, 900).ceiling, 900)

  // A column that has gone wrong reads as nothing bought, not as a ceiling under
  // the floor's own.
  for (const broken of [-1, -900, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(studentCeiling(PLANS.center, broken).ceiling, included, `${broken}`)
  }

  // Institution resolves the same way, off its own larger floor.
  const inst = studentCeiling(PLANS.institution, 0)
  assert.equal(inst.kind, 'purchased')
  assert.equal(inst.ceiling, includedStudents(PLANS.institution))
})

test('room to add students is never negative', () => {
  // A centre downgraded below its own roster is a real state — nothing deletes
  // students when a plan moves — and "you may add -70 students" is not a sentence.
  const centre = studentCeiling(PLANS.center, 120)

  assert.equal(studentRoom(centre, 0), 120)
  assert.equal(studentRoom(centre, 119), 1)
  assert.equal(studentRoom(centre, 120), 0)
  assert.equal(studentRoom(centre, 900), 0)
  assert.equal(studentRoom(centre, Number.NaN), 0)
})

test('the warnings fire at a fifth and at a twentieth, and 0 is its own state', () => {
  // §3.7's thresholds, and the reason they are asserted rather than trusted: three
  // screens read them, and a fraction typed as 0.5 instead of 0.05 would put every
  // half-empty centre under an urgent banner — which is how a warning stops being read
  // at all. Both boundaries are inclusive, so a centre sitting exactly on one is warned
  // rather than left one student short of it.
  const centre = studentCeiling(PLANS.center, 200)
  const level = (used: number) => capacityPressure(centre, used).level

  // The boundaries below are 200's fifth and twentieth, so the ceiling has to be 200 —
  // it is `greatest(included, purchased)`, and a floor price that ever bought more than
  // 200 places would move every number in this test without changing a line of it.
  assert.equal(centre.ceiling, 200)
  assert.equal(CAPACITY_NOTICE_SHARE, 0.2)
  assert.equal(CAPACITY_URGENT_SHARE, 0.05)

  assert.equal(level(0), 'fine')
  assert.equal(level(159), 'fine') // 41 left, a fifth and one
  assert.equal(level(160), 'notice') // 40 left, exactly a fifth
  assert.equal(level(189), 'notice') // 11 left, a twentieth and one
  assert.equal(level(190), 'urgent') // 10 left, exactly a twentieth
  assert.equal(level(199), 'urgent')
  assert.equal(level(200), 'full')
  // Past the ceiling is still full and not something worse: a centre downgraded below
  // its roster is a real state, and the screens print `remaining` beside the word.
  assert.equal(level(900), 'full')
  assert.deepEqual(capacityPressure(centre, 900), {
    level: 'full',
    remaining: 0,
    ceiling: 200,
  })

  // The free tier's thirty, where the same shares land on much smaller counts — the
  // whole reason the thresholds are shares and not "warn at 20 left".
  const free = studentCeiling(PLANS.teacher_free, 0)
  assert.equal(capacityPressure(free, 23).level, 'fine')
  assert.equal(capacityPressure(free, 24).level, 'notice')
  assert.equal(capacityPressure(free, 29).level, 'urgent')
  assert.equal(capacityPressure(free, 30).level, 'full')
})

test('a ceiling of nought never reads as comfortable', () => {
  // The division guard, and it exists because Infinity is not <= 0.2: a share computed
  // against a ceiling of nought would have every screen reporting "fine" forever on a
  // centre that cannot add anybody. No plan produces such a ceiling — a plan_allowances
  // row edited to zero would — and both ways in land on a warning rather than silence.
  const broken = { kind: 'plan', ceiling: 0 } as const

  // Nothing fits, which is `full` on its own merits and never reaches the share.
  assert.equal(capacityPressure(broken, 0).level, 'full')
  assert.equal(capacityPressure(broken, Number.NaN).level, 'full')

  // And the one path that does reach it: a count below zero, which is a column gone
  // wrong rather than a roster. `remaining` comes out positive against a ceiling of
  // nought, so the share would be Infinity — urgent instead of fine.
  assert.equal(capacityPressure(broken, -5).level, 'urgent')
})

test('the capacity check fires per row, not per statement', () => {
  // FOR EACH STATEMENT would count once for a bulk import and let the other 499
  // names through — the exact hole the trigger exists to close, and a one-word edit
  // away. The column list matters too: dropping `status` from it would let a
  // reactivated student walk past the ceiling.
  assert.match(
    MIGRATION,
    /create trigger students_guard_capacity\s+before insert or update of status, coaching_center_id on public\.students\s+for each row execute function app\.guard_student_capacity\(\)/i,
  )

  // The lock, without which two managers at the last seat both succeed.
  assert.match(MIGRATION, /pg_catalog\.pg_advisory_xact_lock\(/)
})

test('the three new columns are locked against a browser session', () => {
  // Without this the migration is decoration: a centre that can UPDATE
  // student_capacity buys a thousand places for nothing, and one that can write
  // trial_plan grants itself another tier's whole feature set. The guard is replaced
  // wholesale by `create or replace`, so a future edit that rewrites it can drop a
  // column from the list without anything else noticing.
  const guard =
    /create or replace function app\.guard_center_billing\(\)[\s\S]*?\n\$\$;/i.exec(MIGRATION)
  assert.ok(guard, 'migration 36 no longer extends app.guard_center_billing')

  for (const column of ['student_capacity', 'trial_plan', 'trial_ends_at']) {
    assert.match(guard[0], new RegExp(`new\\.${column} is distinct from old\\.${column}`))
  }

  // The three it already protected have to still be there.
  for (const column of ['plan', 'status', 'sms_credit_balance']) {
    assert.match(guard[0], new RegExp(`new\\.${column} is distinct from old\\.${column}`))
  }

  // And the founder's own admin client is still allowed through, or no payment can
  // ever grant the capacity it was taken for.
  assert.match(guard[0], /current_user not in \('service_role', 'postgres', 'supabase_admin'\)/)
})

/* What a trial grants — 20260811000060 */

test('the capacity guard asks what may be admitted, not what was bought', () => {
  // The whole of the fix: one line of the trigger. `app.student_ceiling` still prices a
  // purchase (settle_payment_intent reads it and refuses when the number did not move),
  // so the two questions had to stop sharing one function.
  const guard =
    /create or replace function app\.guard_student_capacity\(\)[\s\S]*?\n\$\$;/i.exec(
      TRIAL_CEILING,
    )
  assert.ok(guard, 'migration 60 no longer replaces the capacity guard')
  assert.match(guard[0], /ceiling := app\.admitted_ceiling\(new\.coaching_center_id\)/)

  // Replaced wholesale, so the parts that make it a guard have to still be in it: a
  // rewrite that dropped any of these would read as a comment change.
  assert.match(guard[0], /pg_catalog\.pg_advisory_xact_lock\(/)
  assert.match(guard[0], /if ceiling is null then/)
  assert.match(guard[0], /current_user in \('postgres', 'supabase_admin'\)/)

  // The app's own admin client is NOT on that list and must never be added to it: the
  // point of the ceiling living in the database is that a Server Action cannot wave it
  // through. The comment beside the list says `service_role`, so this asks the list.
  assert.doesNotMatch(guard[0], /current_user in \([^)]*service_role/)
})

test('a trial raises the ceiling, and only when it outranks what was paid for', () => {
  const fn = /create or replace function app\.admitted_ceiling\(center uuid\)[\s\S]*?\n\$\$;/i
    .exec(TRIAL_CEILING)
  assert.ok(fn, 'migration 60 no longer defines app.admitted_ceiling')

  // `greatest`, so a stale trial_plan left on a row after a payment cannot take places
  // away — the same silence effectiveEntitlement keeps about one.
  assert.match(fn[0], /greatest\(/)

  // The rank guard, which is the under-billing one: Teacher Pro includes 150 and a
  // Coaching Center 79, so a centre still carrying its signup trial would be admitted
  // 150 students on a plan that includes 79.
  assert.match(fn[0], /c\.trial_plan > c\.plan/)

  // Strictly greater, matching trialPlan() in entitlement.ts: the instant trial_ends_at
  // names is when the trial stops granting, not the last instant it grants.
  assert.match(fn[0], /c\.trial_ends_at > pg_catalog\.now\(\)/)
})

test('the plan enum sorts cheapest first, which is what > means in SQL', () => {
  // `trial_plan > plan` is native enum comparison, so the declared order IS the rank.
  // A fifth tier added in the wrong position would not error anywhere — it would
  // quietly change which trials grant places. The migration asserts this too, at push
  // time; this is the half that fails in CI without a database.
  const declaration = /create type plan_type as enum \(([^)]*)\)/i.exec(INIT)
  assert.ok(declaration, 'migration 1 no longer declares plan_type')

  const declared = [...declaration[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  const ranked = (Object.keys(PLAN_RANK) as PlanId[]).sort(
    (a, b) => PLAN_RANK[a] - PLAN_RANK[b],
  )

  assert.deepEqual(declared, ranked)
})
