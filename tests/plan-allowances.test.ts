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
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  PLANS,
  includedStudents,
  monthlyBillBdt,
  monthlyFloorBdt,
  seatsCoveredByFloor,
  studentCeiling,
  studentChargeBdt,
  studentRoom,
  CENTER_MONTHLY_FLOOR_BDT,
  INSTITUTION_MONTHLY_FLOOR_BDT,
  type PlanId,
} from '../src/lib/plans.ts'

const ROOT = path.join(import.meta.dirname, '..')
const MIGRATION = readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260811000036_student_capacity.sql'),
  'utf8',
)

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
