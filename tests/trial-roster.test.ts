import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The roster a trial may hold, read off the migration that writes it.
 *
 * THE THIRD OF THE THREE, and the only one whose answer is not purely money: a seat
 * (20260811000097) and a building (20260811000096) are add-ons the tier sells, so "what is
 * included is the tier's and the rest is a monthly line" is the whole rule. The roster is the
 * product — a per-student tier's price IS the student (§3.2, §3.3) — so fencing it by money
 * would refuse the first admission to an account holding nothing, and a three-day trial would
 * buy a product that cannot hold a roster. What bounds it is a number in `platform_settings`,
 * and any money lifts the bound entirely.
 *
 * WHY A SHAPE TEST WHEN THE RLS SUITE EXECUTES THE TRIGGER. `scripts/test-rls.mjs` proves the
 * rule against real Postgres: a dry trial takes its whole allowance, the next admission is
 * refused with `CD006`, money on the balance lets it through, a leaver gives a place back and a
 * teacher tier is never asked at all. What it cannot prove is that the guard keeps the
 * properties the rest of the product depends on: that the lock is taken before the count, that
 * it is SECURITY INVOKER so the superuser exemption does not match every caller, that zero is
 * the founder's own switch and a missing row is not, and that the number the founder edits is
 * the number the guard reads. Each of those can be dropped in a later rewrite while every
 * behavioural assertion above still passes on a quiet database.
 *
 * THE SAME PATTERN AS THE OTHER MIGRATION TESTS — comments stripped before every match, because
 * a comment naming a rule is not the rule and this file's prose names all of them.
 */

const raw = readFileSync('supabase/migrations/20260811000098_trial_roster_ceiling.sql', 'utf8')
// Both comment styles: the prose above the function is a `--` block and the explanation inside
// it is a `/* */` one, and either can name a rule that is not in the code.
const sql = raw.replace(/^\s*--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

test('the number is a setting, and the guard reads the row the founder writes', () => {
  // `platform_settings` and not `price_versions`: nothing about this figure appears on a bill,
  // and §11.10 keeps that table for reviewed prices. 20260811000091 put the trial lengths here
  // for the same reason, and this column sits beside them with a default so a failed read is
  // never a policy of nothing.
  assert.match(
    sql,
    /alter table public\.platform_settings\s+add column if not exists trial_roster_ceiling integer not null default 500\s+check \(trial_roster_ceiling between 0 and 100000\);/,
  )

  // The guard reads that row and nothing else — no second copy of the number in SQL, so the
  // figure the founder types is the figure enforced.
  assert.match(sql, /select s\.trial_roster_ceiling into allowed\s+from public\.platform_settings s\s+where s\.id;/)
  assert.doesNotMatch(sql, /trial_roster_ceiling = 500/)
})

test('the founder’s lever is one argument wider, and the old one is gone', () => {
  // Dropped, not overloaded: two writers on one row is a caller that can keep the old ceiling
  // while the screen shows a new one.
  assert.match(sql, /drop function if exists public\.founder_set_trial_days\(integer, integer, integer\);/)
  assert.match(
    sql,
    /create or replace function public\.founder_set_trial_days\(\s+p_teacher_trial_days integer,\s+p_center_trial_days integer,\s+p_institution_trial_days integer,\s+p_trial_roster_ceiling integer\s+\)/,
  )

  // The authorisation does not move: asked inside the database (§11.4), so the anon key cannot
  // set its own bound, and the value is range-checked twice — here and by the column's check.
  assert.match(sql, /if not app\.is_platform_admin\(\) then/)
  assert.match(sql, /p_trial_roster_ceiling not between 0 and 100000/)
  assert.doesNotMatch(sql, /service_role[^\n]*is_platform_admin/)
})

test('money lifts the bound, and only a dry organisation is asked', () => {
  // A teacher tier is bounded by its own ceiling and never reaches this rule — the one-question
  // shape 097 uses for the seat fence. The question is asked by naming the two per-student tiers,
  // because `app.plan_ceiling` calls its fourth dimension 'seats' and not 'students' and raised
  // `no ceiling called students` on the very tiers this rule exists for. The list has to be the
  // one `app.student_ceiling` writes: two statements of the same set, or this guard and the
  // teacher guard stop meeting on the same rows.
  assert.match(
    sql,
    /if target not in \('center', 'institution'\) then\s+return new;\s+end if;/,
  )
  assert.doesNotMatch(sql, /plan_ceiling\(target, 'students'\)/)
  assert.match(
    readFileSync('supabase/migrations/20260811000087_capacity_retired.sql', 'utf8'),
    /when c\.plan in \('center', 'institution'\) then 2147483647/,
  )

  // Zero is the founder's own "no bound", and it is the only value that opens the rule.
  assert.match(sql, /if allowed = 0 then\s+return new;\s+end if;/)

  // Inside the allowance nothing is asked about money at all, so a live trial pays for no read
  // of the balance; past it, the organisation has to be a paying one.
  assert.match(sql, /if in_use < allowed then\s+return new;\s+end if;/)
  assert.match(sql, /if balance is null or balance <= 0 then/)
  assert.match(sql, /using errcode = 'CD006',\s+detail {2}= 'limit=students'/)

  // And the code is named in src/lib, which is where `scripts/check-sql.mjs` looks for it.
  assert.ok(readFileSync('src/lib/capacity.ts', 'utf8').includes("'CD006'"))
})

test('what it fires on, and who it binds', () => {
  // `update of status, coaching_center_id`, copying the capacity guard beside it: a name, a
  // phone or a class level never enters the trigger, and a leaver gives a place back.
  assert.match(
    sql,
    /create trigger students_guard_trial_roster\s+before insert or update of status, coaching_center_id on public\.students\s+for each row execute function app\.guard_trial_roster\(\);/,
  )
  assert.match(sql, /if new\.status <> 'active' then\s+return new;\s+end if;/)
  assert.match(
    sql,
    /if tg_op = 'UPDATE'\s+and old\.status = 'active'\s+and old\.coaching_center_id = new\.coaching_center_id\s+then\s+return new;\s+end if;/,
  )

  // The lock is taken before the count and under its own key — not `students.capacity`, which is
  // the other rule on this table: sharing it would serialize a teacher tier's insert against a
  // per-student tier's for no reason at all.
  const lock = sql.indexOf("hashtext('students.trial_roster')")
  const count = sql.indexOf('app.active_students(new.coaching_center_id)')
  assert.ok(lock > 0 && count > lock, 'the lock is taken before the count')
  assert.doesNotMatch(sql, /hashtext\('students\.capacity'\)/)

  // SECURITY INVOKER, deliberately: inside a definer function `current_user` is the function's
  // owner and the exemption below would match every caller, so no admission would be refused.
  assert.match(
    sql,
    /create or replace function app\.guard_trial_roster\(\)\s+returns trigger\s+language plpgsql\s+security invoker/,
  )
  assert.match(sql, /if current_user in \('postgres', 'supabase_admin'\) then/)
  assert.doesNotMatch(sql, /current_user in \([^)]*service_role[^)]*\)/)

  // Granted to nobody: a trigger's EXECUTE right is checked when the trigger is created.
  assert.doesNotMatch(sql, /grant execute on function app\.guard_trial_roster/)
  assert.match(sql, /revoke all on function app\.guard_trial_roster\(\) from public, anon, authenticated;/)
})

test('the rule the screens read is the rule the database enforces', () => {
  const plans = readFileSync('src/lib/plans.ts', 'utf8')

  // One copy of the rule in TypeScript, and the two halves that make it safe: a tier with a
  // ceiling is somebody else's sentence, and the two nulls mean opposite things.
  assert.match(plans, /export function trialRosterRefusal\(/)
  assert.match(plans, /if \(plan\.maxStudents !== null\) return null/)
  assert.match(plans, /if \(opening\.ceiling === null\) return 'needs_money'/)
  assert.match(plans, /if \(opening\.ceiling === 0\) return null/)
  assert.match(
    plans,
    /return opening\.balancePoisha !== null && opening\.balancePoisha > 0 \? null : 'needs_money'/,
  )
})

test('the reader and the guard agree about every number, including the two nulls', async () => {
  const { trialRosterRefusal, PLANS } = await import('../src/lib/plans.ts')

  /*
   * The default is written twice — `default 500` in the migration, and the mirror in
   * lib/platform/settings.ts that the founder's own box opens on — and this is the one place the
   * two are compared. A drift would be invisible: the card would open on a number the database
   * would not enforce until somebody saved it.
   *
   * Read off the file rather than imported, because that module is `server-only` and this suite
   * is neither a server nor a bundler — the same reason lib/students/headcount.ts takes its
   * client as an argument.
   */
  const platform = readFileSync('src/lib/platform/settings.ts', 'utf8')
  const mirror = Number(
    platform.match(/DEFAULT_TRIAL_ROSTER_CEILING = (\d+)/)?.[1] ?? Number.NaN,
  )
  assert.ok(Number.isFinite(mirror), 'the mirrored default is gone')
  assert.match(raw, new RegExp(`default ${mirror}\\b`))

  // The teacher tiers are not this rule, at any count and any balance.
  for (const plan of [PLANS.teacher_free, PLANS.teacher_plus]) {
    assert.equal(
      trialRosterRefusal(plan, { activeStudents: 900, balancePoisha: 0, ceiling: 500 }),
      null,
      plan.id,
    )
  }

  // Money lifts the bound entirely — the equivalence the action's own early return rests on,
  // asserted rather than assumed.
  for (const plan of [PLANS.center, PLANS.institution]) {
    for (const count of [0, 1, 499, 500, 5_000]) {
      for (const ceiling of [0, 1, 500, 100_000]) {
        assert.equal(
          trialRosterRefusal(plan, { activeStudents: count, balancePoisha: 1, ceiling }),
          null,
          `${plan.id}/${count}/${ceiling}`,
        )
      }
    }

    // A dry organisation is allowed up to the bound and refused at it, which is the trigger's
    // own `in_use < allowed`.
    assert.equal(
      trialRosterRefusal(plan, { activeStudents: 499, balancePoisha: 0, ceiling: 500 }),
      null,
    )
    assert.equal(
      trialRosterRefusal(plan, { activeStudents: 500, balancePoisha: 0, ceiling: 500 }),
      'needs_money',
    )

    // Zero is the founder's switch, and a null is a read that failed — the two must not be
    // read as one another, or the fence opens on the day the settings row cannot be read.
    assert.equal(trialRosterRefusal(plan, { activeStudents: 5_000, balancePoisha: 0, ceiling: 0 }), null)
    assert.equal(
      trialRosterRefusal(plan, { activeStudents: 0, balancePoisha: 0, ceiling: null }),
      'needs_money',
    )

    // And a debt is not money, nor is an unreadable balance.
    for (const balance of [null, -1]) {
      assert.equal(
        trialRosterRefusal(plan, { activeStudents: 500, balancePoisha: balance, ceiling: 500 }),
        'needs_money',
        `${plan.id}/${balance}`,
      )
    }
  }
})

test('every screen that draws a door asks the same question', () => {
  const door = readFileSync('src/lib/students/roster-door.ts', 'utf8')
  const roster = readFileSync('src/app/(app)/settings/students/page.tsx', 'utf8')
  const add = readFileSync('src/app/(app)/settings/students/new/page.tsx', 'utf8')
  const paste = readFileSync('src/app/(app)/settings/students/import/page.tsx', 'utf8')
  const actions = readFileSync('src/app/(app)/settings/actions.ts', 'utf8')

  // One reader, three screens — and it is the same count the rule is written against: the
  // organisation's, through 20260811000076, not the branch's list the roster happens to hold.
  assert.match(door, /const verdict = await trialRosterVerdict\(supabase, \{/)
  assert.match(door, /centerId: session\.active\.centerId,/)
  assert.match(door, /ceiling: policy\.trialRosterCeiling,/)

  for (const [name, page] of [['roster', roster], ['add', add], ['import', paste]] as const) {
    assert.match(page, /rosterDoor\(supabase, session\)/, `${name} does not ask the door`)
  }

  // Both Server Actions ask it too, and both answer the trigger's own refusal with the same
  // sentence: a hidden button is not a permission (§20.4), and a race is not a pass.
  assert.equal(actions.split('await rosterFence(session').length - 1, 3)
  assert.equal(actions.split('if (isTrialRosterRefusal(').length - 1, 3)
})
