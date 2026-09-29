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
 *
 * WHAT THIS FILE NO LONGER CHECKS is the ceiling the app resolved from those two —
 * `studentCeiling`, `studentRoom`, `capacityPressure` and the seat quote (§16.1 step
 * 28). The seeded allowances are still checked against `includedStudents`, because the
 * database column and the plan table are still two copies of the same numbers and the
 * migration that archives `student_capacity` does not touch either.
 *
 * WHAT IT ASKS OF 20260811000087 is the other half of that: the ceiling no longer reads
 * what was bought (§16.1 step 28), a per-student tier answers uncapped rather than with
 * the floor's own 79 or 238 (§3.3), and the guard that enforces the teacher tiers' plan
 * allowance came through the rewrite with its lock, its tenant check and its bypass
 * intact. Those are the assertions that would have caught the defect this cut could have
 * shipped — capping a centre at its floor on the day it stopped selling seats.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  PLANS,
  PLAN_RANK,
  includedStudents,
  monthlyBillBdt,
  monthlyFloorBdt,
  roomFor,
  seatsCoveredByFloor,
  studentChargeBdt,
  CENTER_MONTHLY_FLOOR_BDT,
  INSTITUTION_MONTHLY_FLOOR_BDT,
  type PlanId,
} from '../src/lib/plans.ts'
import { PLAN_CEILING_EXCEEDED } from '../src/lib/capacity.ts'

const ROOT = path.join(import.meta.dirname, '..')
const migration = (file: string) =>
  readFileSync(path.join(ROOT, 'supabase', 'migrations', file), 'utf8')

const MIGRATION = migration('20260811000036_student_capacity.sql')
const TRIAL_CEILING = migration('20260811000060_trial_ceiling.sql')
const RETIRED = migration('20260811000087_capacity_retired.sql')
const CEILINGS = migration('20260811000075_plan_ceilings.sql')
const INIT = migration('20260811000001_init_schema.sql')

/** The four other ceilings, read out of the UPDATE that seeds them. Null stays null. */
function seededCeilings(): Map<string, (number | null)[]> {
  const statement = /update\s+public\.plan_allowances\s+set[^;]*;/i.exec(CEILINGS)
  assert.ok(statement, 'migration 75 no longer seeds the plan ceilings')

  const rows = [
    ...statement[0].matchAll(
      /\(\s*'([a-z_]+)'::public\.plan_type\s*,\s*(\d+|null)\s*,\s*(\d+|null)\s*,\s*(\d+|null)\s*,\s*(\d+|null)\s*\)/gi,
    ),
  ]
  assert.ok(rows.length > 0, 'the ceiling seed parsed to nothing')

  return new Map(
    rows.map((row) => [
      row[1],
      row.slice(2, 6).map((cell) => (cell.toLowerCase() === 'null' ? null : Number(cell))),
    ]),
  )
}


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

test('room to add students comes from the plan table, and null is no limit', () => {
  // `roomFor` is what the paste box and `limitRefusal` ask now (§16.1 step 28), and it
  // reads the plan table and nothing else. A per-student tier answers null rather than
  // a number, and null is "nothing to run out of" — never "no room". The two are
  // opposite answers, and a paste is where confusing them loses an afternoon's typing.
  assert.equal(roomFor(PLANS.center, 'maxStudents', 3000), null)
  assert.equal(roomFor(PLANS.institution, 'maxStudents', 3000), null)

  assert.equal(roomFor(PLANS.teacher_plus, 'maxStudents', 0), 150)
  assert.equal(roomFor(PLANS.teacher_free, 'maxStudents', 23), 7)

  // Never negative: a teacher downgraded below their own roster is a real state —
  // nothing deletes students when a plan moves — and "you may add -70 students" is
  // not a sentence.
  assert.equal(roomFor(PLANS.teacher_free, 'maxStudents', 300), 0)
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
  assert.doesNotMatch(guard[0], /current_user in \([^)]*service_role\)/)

  // AND THE VERSION THAT RUNS NOW IS 87's. Migration 60's text is history; what has to be
  // true is that the rewrite kept every part that makes this a guard, and that the refusal
  // it raises stopped promising a purchase the product no longer makes.
  const retired =
    /create or replace function app\.guard_student_capacity\(\)[\s\S]*?\n\$\$;/i.exec(
      RETIRED,
    )
  assert.ok(retired, 'migration 87 no longer replaces the capacity guard')
  assert.match(retired[0], /ceiling := app\.admitted_ceiling\(new\.coaching_center_id\)/)
  assert.match(retired[0], /pg_catalog\.pg_advisory_xact_lock\(/)
  assert.match(retired[0], /if ceiling is null then/)
  assert.match(retired[0], /current_user in \('postgres', 'supabase_admin'\)/)
  assert.doesNotMatch(retired[0], /current_user in \([^)]*service_role\)/)
  assert.doesNotMatch(retired[0], /buy more student places/i)
})

test('the ceiling is what the plan allows, and nothing that was bought', () => {
  const fn =
    /create or replace function app\.student_ceiling\(center uuid\)[\s\S]*?\n\$\$;/i.exec(
      RETIRED,
    )
  assert.ok(fn, 'migration 87 no longer replaces app.student_ceiling')

  // The whole of purchased capacity's effect on the product, and the only lines that have
  // to be gone: the column, and the `greatest` that made a bought seat outrank the floor.
  assert.doesNotMatch(fn[0], /student_capacity/)
  assert.doesNotMatch(fn[0], /greatest\(/)

  // A per-student tier has no student ceiling at all (§3.3) — and the value is integer's
  // maximum rather than a null, because null is what this function returns for a centre
  // that does not exist and the guard reads that as "no tenant" rather than as "no room".
  // One value, one meaning, in the function every admission passes through.
  assert.match(fn[0], /when c\.plan in \('center', 'institution'\) then 2147483647/)

  // The teacher tiers keep the allowance §18 preserves by name as §2.7's engineering cap.
  assert.match(fn[0], /else a\.included_students/)
  assert.match(fn[0], /join public\.plan_allowances a on a\.plan = c\.plan/)
  assert.match(fn[0], /where c\.id = center/)
})

test('capacity is archived rather than dropped, and the enum keeps every value', () => {
  // §11.14, and it is a decision rather than an omission: the payments that bought these
  // places are still on the record, and a dropped number leaves those rows unable to
  // explain themselves. `covers_period_*` gets the same treatment, for the same reason.
  assert.match(RETIRED, /comment on column public\.coaching_centers\.student_capacity is/)
  assert.match(RETIRED, /comment on column public\.payment_intents\.grants_capacity is/)
  assert.doesNotMatch(RETIRED, /drop\s+column/i)
  assert.doesNotMatch(RETIRED, /drop\s+(type|table)/i)
  assert.doesNotMatch(RETIRED, /drop\s+value/i)
})

test('an intent that would grant places is refused rather than settled', () => {
  const fn =
    /create or replace function public\.settle_payment_intent\([\s\S]*?\n\$\$;/i.exec(RETIRED)
  assert.ok(fn, 'migration 87 no longer replaces settle_payment_intent')

  // The refusal, and it is a money rule rather than a capacity one: a pending intent priced
  // under the old model names a ceiling that can no longer be raised, so settling it would
  // take the customer's money and hand over nothing.
  assert.match(fn[0], /if it\.grants_capacity > 0 then/)

  // And the archived column is never read or written again — not in the settlement, and not
  // in the read-back a retry gets.
  assert.doesNotMatch(fn[0], /set student_capacity/)
  assert.doesNotMatch(fn[0], /select c\.student_capacity/)

  // The retry path has to survive the refusal, or a webhook delivered twice becomes a
  // second charge. It is checked before the grant test, and it returns the first answer.
  const readBack = /if it\.state = 'successful' then[\s\S]*?end if;/.exec(fn[0])
  assert.ok(readBack, 'the already-settled read-back is gone from settle_payment_intent')
  assert.doesNotMatch(readBack[0], /student_capacity/)
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

/* The other four ceilings — 20260811000075 */

test('every plan has all four of its other ceilings seeded', () => {
  // A missing row here is worse than a missing allowance, because it is silent in the
  // permissive direction: app.plan_ceiling raises on a plan with no row, so the tier
  // would be refused outright — but a tier added to the enum and to PLANS and not to
  // this UPDATE inherits four nulls, and null is read as no ceiling.
  const seeded = [...seededCeilings().keys()].sort()
  const known = (Object.keys(PLANS) as PlanId[]).slice().sort()

  assert.deepEqual(seeded, known)
})

test('the four ceilings in the database are the four in plans.ts', () => {
  // The point of the migration and the reason this test is the important one in the file
  // now: until 20260811000075 these numbers existed only in PLANS and were checked only
  // by a Server Action, so an owner's own token posted at PostgREST wrote the
  // hundred-and-first batch. There are two copies of each number now, which is the price
  // of a trigger that cannot import TypeScript, and this is what keeps them equal.
  const seeded = seededCeilings()

  for (const plan of Object.values(PLANS)) {
    assert.deepEqual(
      seeded.get(plan.id),
      [plan.maxBatches, plan.maxSubjects, plan.maxTeachers, plan.maxStudentsPerBatch],
      plan.id,
    )
  }
})

test('no ceiling falls as the plan rises', () => {
  // The migration asserts this at push time against the table; this is the same claim
  // against PLANS, which is where somebody would actually make the mistake. It matters
  // because §2.2's trial grants the trialled tier's ceilings and nothing re-checks rows
  // already written: a tier whose ceiling was lower than the one below it would take a
  // batch away from a centre that had already made it.
  const ranked = (Object.keys(PLANS) as PlanId[]).sort((a, b) => PLAN_RANK[a] - PLAN_RANK[b])
  const uncapped = Number.POSITIVE_INFINITY

  for (const dimension of ['maxBatches', 'maxSubjects', 'maxTeachers', 'maxStudentsPerBatch'] as const) {
    let previous = 0
    for (const id of ranked) {
      const ceiling = PLANS[id][dimension] ?? uncapped
      assert.ok(ceiling >= previous, `${id}.${dimension} is lower than the plan below it`)
      previous = ceiling
    }
  }
})

test('each ceiling fires per row, on exactly the columns that claim a slot', () => {
  // Two ways to get this wrong, both invisible: FOR EACH STATEMENT counts once for a
  // 500-row import and lets 499 through, and a column missing from the list means the
  // transition that claims the slot never enters the trigger. `active` is what
  // reactivates a retired batch; `branch_id` is a batch moving into another building,
  // which claims a room there; `status` is a paused enrolment coming back.
  const triggers: [string, string, string][] = [
    ['batches_guard_ceiling', 'batches', 'active, coaching_center_id, branch_id'],
    ['subjects_guard_ceiling', 'subjects', 'active, coaching_center_id'],
    ['teachers_guard_ceiling', 'teachers', 'active, coaching_center_id'],
    ['enrollments_guard_seats', 'enrollments', 'status, batch_id, coaching_center_id'],
  ]

  for (const [name, table, columns] of triggers) {
    assert.match(
      CEILINGS,
      new RegExp(
        `create trigger ${name}\\s+before insert or update of ${columns} on public\\.${table}\\s+for each row execute function app\\.\\w+\\(\\)`,
        'i',
      ),
      name,
    )
  }
})

test('every one of the four guards keeps the parts that make it a guard', () => {
  // `create or replace`, so a later edit rewrites each of these wholesale and can drop a
  // line without the diff looking like anything. The lock is the one that fails quietly:
  // without it two managers adding the hundredth batch both count 99 and both pass.
  const guards = [
    'guard_batch_ceiling',
    'guard_subject_ceiling',
    'guard_teacher_ceiling',
    'guard_batch_seats',
  ]

  for (const name of guards) {
    const fn = new RegExp(`create or replace function app\\.${name}\\(\\)[\\s\\S]*?\\n\\$\\$;`, 'i')
      .exec(CEILINGS)
    assert.ok(fn, `migration 75 no longer defines app.${name}`)

    assert.match(fn[0], /pg_catalog\.pg_advisory_xact_lock\(/, name)
    assert.match(fn[0], /if ceiling is null then\s+return new;/, name)
    assert.match(fn[0], /security invoker/, name)
    assert.match(fn[0], /current_user in \('postgres', 'supabase_admin'\)/, name)
    // The app's own admin client is deliberately not on that list: a Server Action must
    // not be able to wave a ceiling through, which is the whole reason this is in SQL.
    assert.doesNotMatch(fn[0], /current_user in \([^)]*service_role/, name)
    // And a centre that does not resolve is a failed read, not an absent ceiling.
    assert.match(fn[0], /errcode = '23503'/, name)
    assert.match(fn[0], new RegExp(`errcode = '${PLAN_CEILING_EXCEEDED}'`), name)
  }
})

test('the refusal says which ceiling it was', () => {
  // `detail` is the only machine-readable half — the message is a sentence for a log and
  // the hint is for a person — so a screen that wants to say "batches" rather than
  // "a limit" reads this. refusedCeiling() in capacity.ts parses exactly these.
  for (const dimension of ['batches', 'subjects', 'teachers', 'seats']) {
    assert.match(CEILINGS, new RegExp(`detail\\s+= 'limit=${dimension}'`), dimension)
  }
})

test('the ceilings are asked of the plan a live trial grants, not only the paid one', () => {
  // Same rule as app.admitted_ceiling and for the same reason: a centre row still
  // carrying the signup's teacher_plus trial would be held to five batches on a plan
  // that allows a hundred. The rank test is what stops it working the other way.
  const fn = /create or replace function app\.ceiling_plan\(center uuid\)[\s\S]*?\n\$\$;/i
    .exec(CEILINGS)
  assert.ok(fn, 'migration 75 no longer defines app.ceiling_plan')

  assert.match(fn[0], /c\.trial_ends_at > pg_catalog\.now\(\)/)
  assert.match(fn[0], /c\.trial_plan > c\.plan/)

  for (const guard of ['guard_batch_ceiling', 'guard_subject_ceiling', 'guard_teacher_ceiling', 'guard_batch_seats']) {
    assert.match(CEILINGS, new RegExp(`${guard}[\\s\\S]*?app\\.ceiling_plan\\(new\\.coaching_center_id\\)`), guard)
  }
})

test('the counts are volatile, or a bulk import passes the same ceiling every time', () => {
  // The subtlest line in the migration. A STABLE function reads the calling statement's
  // snapshot and cannot see rows that same statement has already written, so a paste of
  // forty enrolments would count the same thirty-nine chairs forty times. VOLATILE takes
  // a fresh snapshot per call, which is what makes row 30 see rows 1..29.
  for (const name of ['active_subjects', 'active_teachers', 'active_batches', 'active_seats']) {
    const fn = new RegExp(
      `create or replace function app\\.${name}\\([^)]*\\)[\\s\\S]*?\\n\\$\\$;`,
      'i',
    ).exec(CEILINGS)
    assert.ok(fn, `migration 75 no longer defines app.${name}`)

    assert.match(fn[0], /\nvolatile\n/, name)
    assert.doesNotMatch(fn[0], /\nstable\n/, name)
    // Definer, because a teacher may hold rows a teacher cannot see all of and an
    // invoker-side count would return their handful and pass every check.
    assert.match(fn[0], /security definer/, name)
    assert.match(fn[0], /set search_path = ''/, name)
  }
})

test('a branch is a bucket in the batch count, and only where branches are bought', () => {
  // Two claims that have to hold together, both copied from batchRoomRefusal. A batch
  // filed under no building belongs to head office, and head office has a room of its
  // own rather than a share of every branch's — `is not distinct from` is what makes null
  // one of the buckets instead of matching none. And the per-branch split is asked of the
  // plan, because a centre moved down off institution keeps every branch_id it wrote.
  const count = /create or replace function app\.active_batches\([^)]*\)[\s\S]*?\n\$\$;/i
    .exec(CEILINGS)
  assert.ok(count, 'migration 75 no longer defines app.active_batches')
  assert.match(count[0], /b\.branch_id is not distinct from branch/)

  const guard = /create or replace function app\.guard_batch_ceiling\(\)[\s\S]*?\n\$\$;/i
    .exec(CEILINGS)
  assert.ok(guard, 'migration 75 no longer defines app.guard_batch_ceiling')
  assert.match(guard[0], /per_branch := target = 'institution'::public\.plan_type/)
})

test('nothing anonymous may call any of it', () => {
  // Six helpers that count past RLS and four triggers. The helpers have to be granted to
  // `authenticated` — the guards are SECURITY INVOKER, so they call these as the manager
  // who is inserting, and without the grant an ordinary insert fails on permission
  // instead of on the ceiling — which is exactly why the revoke has to be there too.
  const helpers = [
    'app.ceiling_plan(uuid)',
    'app.plan_ceiling(public.plan_type, text)',
    'app.active_subjects(uuid)',
    'app.active_teachers(uuid)',
    'app.active_batches(uuid, uuid, boolean)',
    'app.active_seats(uuid, uuid)',
  ]

  for (const signature of helpers) {
    const fn = signature.replace(/[.()]/g, (c) => `\\${c}`)
    assert.match(CEILINGS, new RegExp(`revoke all on function ${fn} from public, anon;`), signature)
    assert.match(
      CEILINGS,
      new RegExp(`grant execute on function ${fn} to authenticated, service_role;`),
      signature,
    )
  }

  // The guards are granted to nobody: a trigger's execute right is checked when it is
  // created, not when it fires.
  for (const name of ['guard_batch_ceiling', 'guard_subject_ceiling', 'guard_teacher_ceiling', 'guard_batch_seats']) {
    assert.match(CEILINGS, new RegExp(`revoke all on function app\\.${name}\\(\\) from public, anon;`), name)
    assert.doesNotMatch(CEILINGS, new RegExp(`grant execute on function app\\.${name}\\(\\)`), name)
  }
})

