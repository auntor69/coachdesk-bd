import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** Occurrences of a literal in a source file, for the shape tests at the bottom. */
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

/**
 * The seat fence, read off the migration that writes it.
 *
 * THE OTHER HALF OF tests/branch-ceiling.test.ts, and split from it for the reason the two
 * migrations are split: 20260811000096 is the building, 20260811000097 is the teacher seat,
 * and each has one `raise` — `CD004` and `CD005` — because `scripts/check-sql.mjs` traces a
 * code to the migration that first declared the function raising it and one code cannot have
 * two owners. The two rules are one sentence read twice ("every dimension past what a tier
 * includes is a monthly line, and a monthly line is paid from the balance"), and this file
 * holds the second reading to the same shape the first one has.
 *
 * WHY A SHAPE TEST AT ALL, WHEN THE RLS SUITE EXECUTES THE TRIGGER. `scripts/test-rls.mjs`
 * proves the rule against real Postgres: two seats on a trial, a third refused with `CD005`,
 * money on the balance and the third goes in, a switched-off seat giving its place back. What
 * it cannot prove is that the guard keeps the properties the rest of the product depends on —
 * that it takes the advisory lock *before* it counts, that it is SECURITY INVOKER so the
 * superuser exemption does not match every caller, that it never touches the teacher tiers'
 * one-seat wall, and that the number it counts against is the column the daily rate is priced
 * from. Each of those can be dropped in a later rewrite while every behavioural assertion still
 * passes on a quiet database: the lock only matters when two owners tap at once, and an
 * invoker guard turned definer would exempt the whole app rather than refuse it.
 *
 * THE SAME PATTERN THE OTHER MIGRATION TESTS USE — plan-allowances, price-versions and
 * branch-ceiling all read their `.sql` rather than restating the numbers, because a second
 * copy of a rule in a test agrees with itself. Comments are stripped before every match for
 * the reason onboarding.test.ts gives: a comment naming a rule is not the rule, and this
 * file's own prose names all of them.
 */

const raw = readFileSync('supabase/migrations/20260811000097_teacher_seat_funding.sql', 'utf8')
const sql = raw.replace(/^\s*--.*$/gm, '')

test('the guard counts what the bill counts, and takes the lock before it does', () => {
  // The count is 20260811000075's own function — the one `settle_billing` prices the seat
  // charge from — so the allowance the guard enforces and the line the burn writes are the
  // same count, taken the same way. A second count written here would be a guard and a bill
  // that disagree about whether the third record costs anything.
  assert.match(sql, /in_use := app\.active_teachers\(new\.coaching_center_id\);/)
  assert.doesNotMatch(
    sql,
    /from public\.teachers/,
    'no second count of its own, and no read of a table it does not own',
  )

  // The lock is taken before the count, and scoped to the organisation. Without it two owners
  // recording the second and third colleague at one desk both read two, both pass the money
  // test, and the organisation runs four seats on an allowance of two.
  const lock = sql.indexOf("hashtext('teachers.seats')")
  const count = sql.indexOf('app.active_teachers(new.coaching_center_id)')
  assert.ok(lock > 0, 'the lock is taken at all')
  assert.ok(count > lock, 'the lock is taken before the count, never after')

  // A different lock key from the branch guard's, so an organisation opening a building and
  // recording a teacher at the same instant does not serialize on one lock or, worse, read a
  // count taken before the other's write.
  assert.doesNotMatch(sql, /hashtext\('branches\.ceiling'\)/)
})

test('the teacher tiers keep their own wall, and this rule never overlaps it', () => {
  /*
   * ONE QUESTION DECIDES WHICH RULE AN INSERT MEETS. A tier whose seat cap is not null —
   * the teacher tiers, including a centre trialling one, since `ceiling_plan` resolves the
   * live trial — is refused by `app.guard_teacher_ceiling` from 20260811000075 with `CD003`,
   * and never reaches the money test below. Replacing that function to bolt this on would
   * have put two codes and two sentences in one body; a companion trigger is what keeps each
   * rule readable and each code owned by one migration.
   */
  assert.match(
    sql,
    /if app\.plan_ceiling\(target, 'teachers'\) is not null then\s+return new;\s+end if;/,
  )

  assert.doesNotMatch(sql, /errcode = 'CD003'/, "077's wall is not restated here")
})

test('the allowance comes off the card in force, and a missing card refuses', () => {
  // One number, two answers: `price_versions.free_teacher_seats` is the column the day's rate
  // is priced from, so the guard cannot disagree with the bill about the third seat — and the
  // founder who wants a trial to carry more staff changes one figure, which moves the charge
  // with it.
  assert.match(
    sql,
    /select v\.free_teacher_seats into included\s+from public\.price_versions v\s+where v\.effective_from <= \(pg_catalog\.now\(\) at time zone 'Asia\/Dhaka'\)::date/,
  )

  assert.match(
    sql,
    /if included is null then\s+raise exception 'no price version is in force' using errcode = '23503'/,
  )
})

test('money is the test, once the included seats are used up', () => {
  // Inside the allowance nothing is asked about money at all: the seats a tier includes change
  // no line on any bill, which is why a three-day trial with an empty balance may record them.
  assert.match(sql, /if in_use < included then\s+return new;\s+end if;/)

  // Past it, the organisation has to be a paying one. NULL IS NOT MONEY — an unreadable
  // balance is a refusal, the direction every failed read in this schema takes.
  assert.match(sql, /if balance is null or balance <= 0 then/)
  assert.match(sql, /select c\.balance_poisha into balance\s+from public\.coaching_centers c/)

  // And the refusal carries the code and the dimension a screen can act on: `CD005` is named
  // in src/lib/capacity.ts, which is where `scripts/check-sql.mjs` looks for it, and
  // `limit=teachers` is the same shape `CD003` carries its four dimensions in.
  assert.match(sql, /using errcode = 'CD005',\s+detail {2}= 'limit=teachers'/)
  assert.ok(
    readFileSync('src/lib/capacity.ts', 'utf8').includes("'CD005'"),
    'the code this migration raises is named in src/lib',
  )
})

test('what it fires on, and who it binds', () => {
  // A companion trigger rather than a replaced function: Postgres fires both in name order and
  // only one of them can ever refuse an insert, because the tiers with a ceiling never reach
  // section 1's money test and the tiers without one are not refused by `CD003` at all.
  assert.match(
    sql,
    /create trigger teachers_guard_seat_funding\s+before insert or update of active, coaching_center_id on public\.teachers\s+for each row execute function app\.guard_teacher_seat_funding\(\);/,
  )

  /*
   * The three early returns, in order, and each is a decision rather than a guard rail.
   *
   * A switched-off record is not a seat anybody pays for, and switching one off has to succeed
   * on every tier — refusing a closure would be charging a customer for leaving.
   *
   * A record switched back on is a claim, on exactly the terms a new appointment is: the
   * teacher who left in March and returns in June returns the same way. A row that is already
   * open is a correction — the seat is on the bill already, so a rename or a branch move is not
   * held to the rule that admitted it.
   */
  assert.match(sql, /if not new\.active then\s+return new;\s+end if;/)
  assert.match(
    sql,
    /if tg_op = 'UPDATE' and old\.active and old\.coaching_center_id = new\.coaching_center_id then\s+return new;\s+end if;/,
  )

  // SECURITY INVOKER, deliberately: inside a definer function `current_user` is the function
  // owner and the exemption below would match every caller, so no seat would ever be refused.
  assert.match(
    sql,
    /create or replace function app\.guard_teacher_seat_funding\(\)\s+returns trigger\s+language plpgsql\s+security invoker/,
  )
  assert.match(sql, /if current_user in \('postgres', 'supabase_admin'\) then/)

  // `service_role` is not exempt, exactly as the four ceilings in 20260811000075 and the
  // branch guard in 096 are not: it is the app's own admin client, and the app has no teacher
  // write path through it — `createTeacher` and `toggleTeacherActive` both run as the owner,
  // which is what makes every assertion in the RLS suite about this rule a real session's.
  assert.doesNotMatch(sql, /current_user in \([^)]*service_role[^)]*\)/)

  // The guard is granted to nobody, like every other trigger function here: a trigger's
  // EXECUTE right is checked when the trigger is created, not when it fires.
  assert.doesNotMatch(sql, /grant execute on function app\.guard_teacher_seat_funding/)
  assert.match(
    sql,
    /revoke all on function app\.guard_teacher_seat_funding\(\) from public, anon, authenticated;/,
  )
})

/*
 * AND THE OTHER END OF THE SAME RULE, which is the half a customer meets.
 *
 * The trigger is the fence and the only copy that holds for a request that never went near
 * a form; the Server Action and the two screens are what turn the refusal into a sentence
 * with a price in it and a way to fix it. `createTeacher` and `toggleTeacherActive` are
 * both public endpoints — a hidden button is not a permission (§20.4) — so the fence has to
 * be asked in the action as well, and asked on the same terms in both: the teacher who
 * left in March and returns in June is a new claim, which is what the DB trigger states and
 * what a reader pressing "turn on" is doing.
 *
 * AND A FORM THAT COULD ONLY REFUSE IS THE ONE THING THE SCREENS MUST NOT DRAW, which is
 * the branches screen's judgement (20260811000096) applied to the seat: the add button is
 * not offered and the add form is replaced by the card, in the words the action refuses
 * with.
 */
test('the action asks the same question the trigger does, on both writes', () => {
  const actions = readFileSync('src/app/(app)/settings/actions.ts', 'utf8')

  assert.match(actions, /async function seatFence\(session: CenterSession\): Promise<ActionState \| null> \{/)
  assert.ok(
    actions.includes('if (session.plan.maxTeachers !== null) return null'),
    'a tier with a seat ceiling is left to limitRefusal, which owns that sentence',
  )
  assert.ok(actions.includes('activeTeachers: count,'))
  assert.ok(actions.includes('balancePoisha: session.billing.balancePoisha,'))

  // Once at the moment a colleague is recorded, once at the moment one is switched back
  // on. A single call site would be the off-then-on hole the trigger closes.
  assert.equal(count(actions, 'await seatFence(session)'), 2)
  assert.equal(count(actions, 'if (isSeatRefusal(error)) return { error: seatNotFunded(session) }'), 2)
})

test('the screens offer the reason instead of a form that could only refuse', () => {
  const list = readFileSync('src/app/(app)/settings/teachers/page.tsx', 'utf8')
  const add = readFileSync('src/app/(app)/settings/teachers/new/page.tsx', 'utf8')

  // No extra query on the list: the count is off the rows it has already read and the
  // balance off the session, which is the difference between this screen and the branches
  // one — there the fence pays for a count it does not otherwise make.
  assert.ok(list.includes('const seatRefusal = teacherSeatOpeningRefusal(session.plan, {'))
  assert.ok(list.includes('{staff && seatRefusal === \'needs_money\' && ('))
  assert.ok(add.includes("seatRefusal === 'needs_money' ? ("), 'the form is replaced, not drawn')

  // Both draw the action's own sentence, so a refusal and a card can never disagree about
  // the price — and the way out is the one screen that takes money (§20.4).
  for (const page of [list, add]) {
    assert.ok(page.includes('{t.errors.seatNotFunded('), 'the refusal is the action\'s own words')
    assert.ok(page.includes("href=\"/settings/billing\""), 'and the way to fund it is beside it')
  }

  // A refusal that reached the trigger instead of the count says the same thing rather
  // than "could not save".
  assert.ok(
    readFileSync('src/lib/capacity.ts', 'utf8').includes("export const TEACHER_SEAT_UNFUNDED = 'CD005'"),
  )
})
