-- CoachDesk BD — a building beyond the three an institution includes is a line on the
-- bill, so it is bought the way everything else here is bought: from the balance.
--
-- WHAT WAS WRONG, AND IT WAS FOUND BY THE OWNER RATHER THAN BY A TEST. `branches` is the
-- one table a plan's *paid* dimension lives on, and it had no trigger at all. The tier's
-- allowance and the ৳750 a month lived in TypeScript — `INSTITUTION_INCLUDED_BRANCHES`,
-- `branchChargeBdt`, the `multipleBranches` flag — and in the Server Action that draws
-- the form. A Server Action is a public endpoint and `branches` has held INSERT for
-- `authenticated` since 20260811000002, so the whole rule was a courtesy: an owner's own
-- token posted straight at PostgREST writes the fortieth building, and a `center` plan —
-- one building, as §2.4 sells it — could have buildings at all.
--
-- THE HOLE THE OWNER ACTUALLY HIT IS SHARPER THAN THAT, and it is why this is worth a
-- migration rather than a note. A center or institution signup is given
-- `platform_settings.institution_trial_days` days on the line (§4.3), so its balance is
-- ZERO while its `charged_through` is in the future — which is a live, writable account
-- that owes nothing and burns nothing. Every add-on the daily rate prices was free during
-- those days, and the branch is the one with a headline: "3 included, then ৳750 each".
-- Somebody could open an institution account for nothing, name fifty buildings, and the
-- database grew for a customer who never sent a taka.
--
-- THE RULE, AND IT IS ONE SENTENCE: **the three included buildings are the tier's; every
-- building beyond them is paid for out of the balance, so there has to be money on the
-- balance.** That is not a new bargain — §11.6 already says the balance is the only
-- currency, the burn spends it a day at a time at the current size, and the branch fee is
-- already inside the daily rate (`settle_billing`, and `monthlyBillBdt` in plans.ts).
-- What was missing is the half a prepaid product needs: before the customer is given a
-- recurring line, the money that carries it has to be there. A trial has none, because
-- its days are granted rather than bought, so a trial runs the three buildings the tier
-- includes and no more.
--
-- NOT A CEILING, AND THIS IS WHY `plan_allowances` DID NOT GROW A COLUMN. The four
-- ceilings in 20260811000075 are numbers no amount of money moves — a hundred-and-first
-- batch is refused on every tier we sell. A fifty-first building is not refused, it is
-- ৳750 a month: a paying institution may have as many as it can carry, which is exactly
-- what the burn prices. So the allowance is read from the card in force
-- (`price_versions.included_branches`, the same column 20260811000081 bills from), and
-- the test of whether more may be opened is money.
--
-- `CD004`, AND NOT `CD003` WITH ANOTHER DIMENSION ON IT. The four guards in 75 share
-- CD003 because they are one rule — the plan's own allowance is used up, and the way out
-- is to move up a tier or retire a row. This is a different sentence with a different
-- remedy: the plan has room, the *balance* does not, and what the reader has to do is
-- send money rather than change plan. `scripts/check-sql.mjs` holds one rule per code and
-- would refuse a second owner of CD003 anyway. src/lib/capacity.ts names both codes.
--
-- WHAT THIS DOES NOT CHANGE. Existing rows are untouched: a downgrade keeps every
-- building, its students, registers, fees and payroll, exactly as §4.5 requires — the
-- guard fires on an insert or on a row being switched back on, never on a rename, an
-- address or a closure. Nothing is deleted, here or anywhere.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. How many buildings this organisation is running.
--
-- SECURITY DEFINER for the reason `app.active_teachers` is: what is being counted is the
-- organisation's, and a pinned branch manager's own session can see one row of it. The
-- count is one integer about a centre named by uuid, and it counts exactly what
-- `settle_billing` counts — active rows — so the number this guard refuses on is the
-- number the bill is computed from.
--
-- VOLATILE, not stable: the caller is a BEFORE trigger in the same statement's snapshot,
-- and a stable read would be answered from the snapshot taken before it.
-- ---------------------------------------------------------------------------

create or replace function app.active_branches(center uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  select pg_catalog.count(*)::integer into n
  from public.branches b
  where b.coaching_center_id = center
    and b.active;

  return n;
end;
$$;

comment on function app.active_branches(uuid) is
  'Active branch rows for one organisation, counted the way the daily rate counts them. '
  'Read by app.guard_branch_ceiling, never by a policy.';

-- ---------------------------------------------------------------------------
-- 2. The refusal.
--
-- SECURITY INVOKER, deliberately, the same as the four ceilings in 75: inside a definer
-- function `current_user` is the owner and the exemption below would match every caller.
-- The one count that needs to see past RLS is across the road in section 1.
--
-- `service_role` IS NOT EXEMPT, matching app.guard_student_capacity and the four
-- ceilings. It is the app's own admin client, and the app has no branch write path
-- through it — a guard an admin client can wave through is not the guard this migration
-- is about.
--
-- THE LOCK IS TAKEN BEFORE THE COUNT, and it is what makes the arithmetic true. Two
-- managers opening a second and third building at one desk both count two without it,
-- both pass the money test, and the organisation runs four on a funded allowance of
-- three. Scoped to the organisation and held to commit, like the ceilings'.
-- ---------------------------------------------------------------------------

create or replace function app.guard_branch_ceiling()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target       public.plan_type;
  included     integer;
  in_use       integer;
  balance      bigint;
begin
  /*
   * A RENAME, AN ADDRESS, A CLOSURE: none of them adds a building to the bill.
   *
   * Closing one is always allowed — that is how a customer stops paying for a building
   * they no longer run, and refusing it would be charging them for a closure. A row that
   * is already open is a correction: the building is on the bill already and nothing
   * about this statement changes that.
   *
   * WHAT IS LEFT IS A ROW *BECOMING* ACTIVE — an insert, or a closed building switched
   * back on — and both are the moment a monthly line starts, which is why both are
   * asked. A branch that closed in March and reopens in June reopens on the same terms
   * as a new one; nothing here looks at how old the row is.
   */
  if tg_op = 'UPDATE' then
    if not new.active then
      return new;
    end if;

    if old.active then
      return new;
    end if;
  end if;

  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  target := app.ceiling_plan(new.coaching_center_id);

  if target is null then
    raise exception 'branch % names no coaching centre', new.name
      using errcode = '23503';
  end if;

  /*
   * ONE TIER SELLS BUILDINGS, and the sentence is already written in 20260811000081:
   * `settle_billing` charges for branches only on `institution`. This is the same
   * sentence as a refusal rather than as a price, and the two have to move together —
   * `tests/plans.test.ts` pins the feature flag on the one tier that has it, and
   * `PLANS` in src/lib/plans.ts is the list both halves are drawn from.
   *
   * A live trial of a higher tier counts, because `ceiling_plan` answers the same way it
   * answers for the batch and teacher ceilings: a centre trialling Institution is on
   * that tier for the length of the trial, which is what the screen told the customer.
   */
  if target <> 'institution'::public.plan_type then
    raise exception 'a % plan is one building', target
      using errcode = 'CD004',
            detail  = 'limit=branches',
            hint    = 'Running several buildings is the Institution plan.';
  end if;

  /*
   * How many are included comes off the card in force, which is the column the daily rate
   * is priced from — one number in one place, so this guard cannot disagree with the bill
   * about whether the fourth building costs anything.
   *
   * A MISSING CARD IS A DEPLOYMENT FAULT AND REFUSES, the narrow direction every failed
   * read in this schema takes. Reading it as "no included buildings" would have been the
   * looser answer and would also have been wrong in the other direction.
   */
  select v.included_branches into included
  from public.price_versions v
  where v.effective_from <= (pg_catalog.now() at time zone 'Asia/Dhaka')::date
  order by v.effective_from desc
  limit 1;

  if included is null then
    raise exception 'no price version is in force' using errcode = '23503';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('branches.ceiling'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  in_use := app.active_branches(new.coaching_center_id);

  -- Inside the allowance: this building changes no line on any bill, so there is nothing
  -- to fund and the count is not asked about money at all.
  if in_use < included then
    return new;
  end if;

  /*
   * Past it, and the organisation has to be a paying one.
   *
   * THE BAR IS MONEY ON THE BALANCE AND NOT "A DAY'S WORTH", which is the one judgement
   * in this file worth arguing about. A day's worth would refuse a nearly-dry institution
   * a building it could still be charged for tomorrow, and it would have to price the day
   * here — three head counts and the band arithmetic — to say so. Money on the balance is
   * the honest minimum: the burn prices the building the day it opens, a balance that
   * cannot carry the new rate takes the whole organisation read-only the next morning
   * (§4.4), and a customer who did that to themselves by adding eleven buildings on ৳200
   * is a customer to talk to. What this refuses is the account that has never paid us
   * anything at all, which is the trial.
   *
   * NULL IS NOT MONEY. A balance nobody could read is a refusal, the same reading
   * `billingStanding` takes of an unreadable rate.
   */
  select c.balance_poisha into balance
  from public.coaching_centers c
  where c.id = new.coaching_center_id;

  if balance is null or balance <= 0 then
    raise exception
      'this organisation runs its % included branches and holds nothing on the balance',
      included
      using errcode = 'CD004',
            detail  = 'limit=branches',
            hint    = 'Add money to the balance to open another building.';
  end if;

  return new;
end;
$$;

comment on function app.guard_branch_ceiling() is
  'BEFORE INSERT (or a row switched back on) on public.branches: the tier in force must '
  'sell branches at all, and a building past price_versions.included_branches needs money '
  'on the balance, because the daily rate is what pays for it. MASTERPLAN.md §2.5, §4.3 '
  'and §11.6. CD004, named in src/lib/capacity.ts.';

-- ---------------------------------------------------------------------------
-- 3. Where it fires.
--
-- `update of active, coaching_center_id` rather than a bare `update`, copying the four
-- ceilings: a rename or an address correction never enters the trigger at all, and the
-- early return above is the second line rather than the first. The centre column is in
-- the list because a row moved to another organisation is a building that organisation
-- did not have a moment ago.
-- ---------------------------------------------------------------------------

drop trigger if exists branches_guard_ceiling on public.branches;
create trigger branches_guard_ceiling
  before insert or update of active, coaching_center_id on public.branches
  for each row execute function app.guard_branch_ceiling();

-- ---------------------------------------------------------------------------
-- 4. Who may call what.
--
-- The count is granted to `authenticated` because it has to be: the guard is SECURITY
-- INVOKER, so it calls this as the owner who is opening the building, and without the
-- grant every ordinary insert would fail on permission instead of on the rule. It
-- returns one integer about a centre named by uuid.
--
-- The guard itself is granted to nobody, like every other trigger function here: a
-- trigger's execute right is checked when the trigger is created, not when it fires.
-- ---------------------------------------------------------------------------

revoke all on function app.active_branches(uuid) from public, anon;
revoke all on function app.guard_branch_ceiling() from public, anon;

grant execute on function app.active_branches(uuid) to authenticated, service_role;
