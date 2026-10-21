import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The buildings fence, read off the migration that writes it.
 *
 * WHY THIS FILE EXISTS AT ALL, WHEN THE RLS SUITE EXECUTES THE TRIGGER. `scripts/test-rls.mjs`
 * proves the rule against real Postgres: three buildings on a trial, a fourth refused with
 * `CD004`, money on the balance and the fourth goes in. What it cannot prove is that the
 * *shape* of the guard is the one the rest of the product relies on — that it takes the
 * advisory lock before it counts, that it is SECURITY INVOKER so the superuser exemption
 * does not match every caller, that it fires on `active` as well as on an insert, and that
 * the number it counts against is the one the bill prices from. Each of those has a way of
 * being dropped in a later rewrite while every behavioural assertion above still passes on
 * a quiet database: the lock only matters when two owners tap at once, and an invoker guard
 * turned definer would exempt the whole app rather than refuse it.
 *
 * THE SAME PATTERN THE OTHER MIGRATION TESTS USE — `tests/plan-allowances.test.ts` and
 * `tests/price-versions.test.ts` both read their `.sql` rather than restating the numbers,
 * because a second copy of a rule in a test agrees with itself. Comments are stripped
 * before every match for the reason onboarding.test.ts gives: a comment naming a rule is not
 * the rule, and this file's own prose names all of them.
 */

const raw = readFileSync('supabase/migrations/20260811000096_branch_ceiling.sql', 'utf8')
const sql = raw.replace(/^\s*--.*$/gm, '')

test('the guard counts what the bill counts, and takes the lock before it does', () => {
  // Active rows only: a closed building is not a building anybody teaches in, and billing
  // for one would be charging a customer for shutting it down. `settle_billing` counts the
  // same rows the same way, so the allowance and the charge cannot disagree.
  assert.match(
    sql,
    /create or replace function app\.active_branches\(center uuid\)[\s\S]*?where b\.coaching_center_id = center\s+and b\.active;/,
  )

  // The lock is taken before the count, and scoped to the organisation. Without it two
  // owners at one desk both read two buildings, both pass, and the organisation runs four
  // on a funded allowance of three.
  const lock = sql.indexOf("hashtext('branches.ceiling')")
  const count = sql.indexOf('app.active_branches(new.coaching_center_id)')
  assert.ok(lock > 0 && count > lock, 'the lock is taken before the count, never after')
  assert.match(sql, /pg_advisory_xact_lock\(\s*pg_catalog\.hashtext\('branches\.ceiling'\)/)
})

test('the tier is asked, and the answer is the one settle_billing bills with', () => {
  // One tier sells buildings, and the sentence is 20260811000081's — the burn charges for
  // branches on `institution` and nowhere else. tests/plans.test.ts pins the feature flag
  // side of the same fact, which is the copy src/lib/plans.ts answers screens from.
  assert.match(sql, /if target <> 'institution'::public\.plan_type then[\s\S]*?errcode = 'CD004'/)

  // The allowance comes off the card in force rather than a second number written here:
  // `price_versions.included_branches` is the column the day's rate is priced from.
  assert.match(
    sql,
    /select v\.included_branches into included\s+from public\.price_versions v\s+where v\.effective_from <= \(pg_catalog\.now\(\) at time zone 'Asia\/Dhaka'\)::date/,
  )

  // A missing card refuses rather than reading as no allowance — the narrow direction every
  // failed read in this schema takes.
  assert.match(sql, /if included is null then\s+raise exception 'no price version is in force' using errcode = '23503'/)
})

test('money is the test, once the included three are used up', () => {
  // Inside the allowance nothing is asked about money at all: those buildings change no line
  // on any bill, which is why a three-day trial with an empty balance may open them.
  assert.match(sql, /if in_use < included then\s+return new;\s+end if;/)

  // Past it, the organisation has to be a paying one. Null is not money.
  assert.match(sql, /if balance is null or balance <= 0 then/)

  // And the refusal carries the code and the dimension a screen can act on: `CD004` is named
  // in src/lib/capacity.ts, which is where `scripts/check-sql.mjs` looks for it.
  assert.match(sql, /errcode = 'CD004',\s+detail {2}= 'limit=branches'/)
  assert.ok(
    readFileSync('src/lib/capacity.ts', 'utf8').includes("'CD004'"),
    'the code this migration raises is named in src/lib',
  )
})

test('what it fires on, and who it binds', () => {
  // `update of active, coaching_center_id`: a rename or an address correction never enters
  // the trigger, which is what lets a centre past its allowance fix a spelling. The centre
  // column is in the list because a row moved to another organisation is a building that
  // organisation did not have a moment ago.
  assert.match(
    sql,
    /create trigger branches_guard_ceiling\s+before insert or update of active, coaching_center_id on public\.branches\s+for each row execute function app\.guard_branch_ceiling\(\);/,
  )

  // Closing one stops a line, so it is never refused; a row that is already open is a
  // correction rather than a claim; a row being switched back on is a claim, and is asked
  // on the same terms as a new one.
  assert.match(sql, /if tg_op = 'UPDATE' then\s+if not new\.active then\s+return new;\s+end if;\s+if old\.active then\s+return new;\s+end if;\s+end if;/)

  // SECURITY INVOKER, deliberately: inside a definer function `current_user` is the owner
  // and the exemption below would match every caller, so no building would ever be refused.
  assert.match(sql, /create or replace function app\.guard_branch_ceiling\(\)\s+returns trigger\s+language plpgsql\s+security invoker/)
  assert.match(sql, /if current_user in \('postgres', 'supabase_admin'\) then/)

  // `service_role` is not exempt, exactly as the four ceilings in 20260811000075 are not:
  // it is the app's own admin client, and the app has no branch write path through it.
  assert.doesNotMatch(sql, /current_user in \([^)]*service_role[^)]*\)/)

  // The count is callable by the session running the insert (the guard is invoker); the
  // guard itself is granted to nobody, because a trigger's EXECUTE is checked when the
  // trigger is created rather than when it fires.
  assert.match(sql, /grant execute on function app\.active_branches\(uuid\) to authenticated, service_role;/)
  assert.doesNotMatch(sql, /grant execute on function app\.guard_branch_ceiling/)
})
