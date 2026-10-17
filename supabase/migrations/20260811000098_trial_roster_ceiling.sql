-- CoachDesk BD — the last dimension a free account can grow, and it needs a number rather
-- than a price, which is why it is the one the two migrations before it had to leave open.
--
-- WHAT IS DIFFERENT ABOUT THE ROSTER. 20260811000096 fenced buildings and 20260811000097
-- fenced teacher seats, both with the same sentence: what a tier includes is the tier's,
-- and every one past it is a monthly line — so money on the balance is what turns it on. The
-- roster cannot be fenced that way. A per-student tier's price IS the student (§3.2, §3.3):
-- `plan_allowances.included_students` is not the number anybody pays from any more, there is
-- no "included" band, and a money rule read literally would refuse the first admission to a
-- signup that holds nothing — a trial of a product that can never hold a roster, which is
-- every screen in it. So the roster is not fenced by money. It is bounded by a NUMBER, and
-- that number is a trial: how much of somebody else's database we are willing to carry for
-- an account that has never paid us anything.
--
-- AND UNBOUNDED IT WAS. `students` has held INSERT for `authenticated` since
-- 20260811000002, `app.guard_student_capacity` returns before it counts on both per-student
-- tiers (20260811000087 retired their ceiling on purpose), and a center-or-institution
-- signup is given granted DAYS and not money (§4.3). So a free account could write fifty
-- thousand rows in an afternoon — every one of them a student with a guardian row, and as
-- many enrollments, invoices, attendance records and marks behind it as the account cared
-- to add. The trial is what the product gives away; that is not what it gives away.
--
-- THE RULE, ONE SENTENCE: **an organisation that has never put money on its balance holds
-- up to `platform_settings.trial_roster_ceiling` active students, and any money at all lifts
-- the bound entirely.** Not "a student's worth of money", which is ৳25 a month and no bar
-- anybody could reason about — the same judgement 096 and 097 both record. The bound is not
-- a price the customer runs into; it is the size of what we are willing to carry for nothing.
--
-- WHY THAT NUMBER IS A SETTING AND NOT A PRICE. §11.10 keeps prices in `price_versions`,
-- where a change is a reviewed migration and a new card. This is not a price: nothing about
-- it appears on a bill, and moving it changes what a *trial* is allowed to hold rather than
-- what anybody is charged. It belongs with the trial lengths in `platform_settings`, which
-- 20260811000091 already made the home of exactly that kind of decision — one row, read by
-- every signed-in session, written only by `public.founder_set_trial_days`. That function
-- gains a fourth argument here, so the founder moves this number from the panel on the same
-- screen as the days. **Zero switches the bound off**, which is the escape hatch if it ever
-- refuses a customer the founder would rather keep.
--
-- FIVE HUNDRED, AND THE ANCHOR IS ONE PASTE. `MAX_IMPORT_ROWS` in src/lib/bd/roster.ts is
-- 500 — the most a centre can add to its roster in one go, which is what an owner evaluating
-- the product actually does on the first afternoon — so a real evaluation can never meet
-- this wall, and an account farming rows can write five hundred and no more. The number is
-- the founder's; the shape is what matters here.
--
-- WHO IT CANNOT REFUSE. A teacher tier keeps the ceiling it already had
-- (`app.guard_student_capacity`, `CD001`) and returns before this rule, exactly as it does
-- for the seat fence in 097 — a 150-student Teacher Pro trial is bounded by its own places
-- and never reaches the money test. A funded organisation is past the first line of the
-- test and may grow as far as its money carries, as it always could, because the day's rate
-- prices each student. And an organisation whose balance has run dry is refused at exactly
-- the moment the app has already taken its writes away (§4.4, `billingStanding`), so no
-- paying customer meets a new refusal here that they did not already have.
--
-- WHAT IT DOES NOT CHANGE. Existing rows are untouched: limits apply to new actions (§4.5),
-- so a centre over the bound keeps every student it has and cannot admit another until it
-- funds. A name, a phone number or a class level is not in the trigger's column list, so a
-- correction never reaches the rule. A student set to any status other than `active` gives
-- their place back, which is how a centre stays under the bound without deleting anybody's
-- history — and a row switched back to `active` is a new claim, asked on the same terms as
-- a new admission. The founder's own sales trial meets this too, and that is intended for
-- the reason 097 records: a prospect carried on granted days is an organisation that has
-- not paid us, and the answer is the same one §11.7 gives everywhere — fund the balance
-- first, from the founder's own money screen.
--
-- `CD006`, AND IT HAS TO BE ITS OWN CODE. A screen reading this one has to say a number and
-- then say that money is the way past it; `CD001` means "buy more student places", which is
-- a thing this product no longer sells (§16.1 step 28), and `CD003` means a plan ceiling,
-- which is answered by retiring a row or moving tier. `scripts/check-sql.mjs` also holds one
-- rule per code, traced to the migration that first declared the function raising it.
-- src/lib/capacity.ts names it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The number, beside the trial lengths it belongs with.
--
-- NOT NULL with a default, because every path that reads it must get a number: a null here
-- would be a policy nobody set, and the guard below refuses rather than reading one as
-- unlimited. The check allows zero — zero is the founder switching the bound off — and caps
-- the top at a hundred thousand, which is far past any roster in the country and stops a
-- mistyped digit from becoming a policy nobody can explain.
-- ---------------------------------------------------------------------------

alter table public.platform_settings
  add column if not exists trial_roster_ceiling integer not null default 500
    check (trial_roster_ceiling between 0 and 100000);

comment on column public.platform_settings.trial_roster_ceiling is
  'How many active students an organisation that has never funded its balance may hold. '
  '500 — one MAX_IMPORT_ROWS paste — and 0 switches the bound off. Enforced by '
  'app.guard_trial_roster (20260811000098, CD006); set from the founder panel. '
  'MASTERPLAN.md §3.3, §4.3, §11.7.';

-- ---------------------------------------------------------------------------
-- 2. The founder's lever, one argument wider.
--
-- DROPPED AND RECREATED rather than overloaded. A second `founder_set_trial_days` taking
-- three arguments would leave two writers on one row and a caller that could silently keep
-- the old ceiling while the screen showed a new one; the panel is part of this deployment,
-- so there is nobody to keep the old signature alive for. The authorisation is unchanged and
-- does not move: `app.is_platform_admin()` is asked inside the database (§11.4), so the anon
-- key cannot set its own bound.
-- ---------------------------------------------------------------------------

drop function if exists public.founder_set_trial_days(integer, integer, integer);

create or replace function public.founder_set_trial_days(
  p_teacher_trial_days integer,
  p_center_trial_days integer,
  p_institution_trial_days integer,
  p_trial_roster_ceiling integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'founder_set_trial_days requires the platform admin'
      using errcode = '42501';
  end if;

  if p_teacher_trial_days is null or p_teacher_trial_days not between 0 and 365
     or p_center_trial_days is null or p_center_trial_days not between 0 and 365
     or p_institution_trial_days is null or p_institution_trial_days not between 0 and 365
  then
    raise exception 'a trial is a whole number of days between 0 and 365'
      using errcode = '22023';
  end if;

  if p_trial_roster_ceiling is null
     or p_trial_roster_ceiling not between 0 and 100000
  then
    raise exception 'a trial roster holds between 0 and 100000 students, 0 for no bound'
      using errcode = '22023';
  end if;

  update public.platform_settings
     set teacher_trial_days = p_teacher_trial_days,
         center_trial_days = p_center_trial_days,
         institution_trial_days = p_institution_trial_days,
         trial_roster_ceiling = p_trial_roster_ceiling,
         updated_at = pg_catalog.now(),
         updated_by = auth.uid()
   where id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'teacherTrialDays', p_teacher_trial_days,
    'centerTrialDays', p_center_trial_days,
    'institutionTrialDays', p_institution_trial_days,
    'trialRosterCeiling', p_trial_roster_ceiling
  );
end;
$$;

comment on function public.founder_set_trial_days(integer, integer, integer, integer) is
  'MASTERPLAN.md §4.3 — the three trial lengths and the roster a trial may hold, platform '
  'admin only, asking the question inside the database. One row, so no centre or row is '
  'named by the caller.';

revoke all on function public.founder_set_trial_days(integer, integer, integer, integer)
  from public, anon;
grant execute on function public.founder_set_trial_days(integer, integer, integer, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The refusal.
--
-- SECURITY INVOKER, like every guard in this schema and for the reason 096 records: inside a
-- definer function `current_user` is the function's owner and the superuser exemption below
-- would match every caller. It reads `platform_settings` as the writer, which works because
-- that table carries a SELECT policy for `authenticated` (20260811000091) — a signed-in
-- member may read the trial lengths the signup screen quotes, and this is the same row.
--
-- THE LOCK IS TAKEN BEFORE THE COUNT, as in the four ceilings of 75 and in both fences
-- before this one, and under its own key: two managers admitting the last student at one
-- desk would both count 499 without it, and the organisation would run past its bound on
-- two taps. Not the same key as `students.capacity`, which is a different rule on the same
-- table — sharing it would make a teacher tier's insert and a per-student tier's insert
-- serialize against each other for no reason at all.
--
-- A MISSING OR UNREADABLE ROW REFUSES, the narrow direction every failed read in this schema
-- takes. `allowed` cannot be null in practice — the column is NOT NULL — but a select that
-- somehow returned nothing must not be read as "no bound", or the one guard on this
-- dimension would open on the day the settings row went missing.
-- ---------------------------------------------------------------------------

create or replace function app.guard_trial_roster()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target  public.plan_type;
  allowed integer;
  in_use  integer;
  balance bigint;
begin
  /* Only an active student occupies a place, so a leaver gives theirs back — which is how a
     centre stays under the bound without deleting a child's marks and attendance. */
  if new.status <> 'active' then
    return new;
  end if;

  /* Already on the roster at this centre, so nothing new is being claimed: a rename, a phone
     correction or a class level never reaches the count, and a row moved to another
     organisation is checked against that organisation's bound. Copied from
     app.guard_student_capacity, which asks the same question one row over. */
  if tg_op = 'UPDATE'
     and old.status = 'active'
     and old.coaching_center_id = new.coaching_center_id
  then
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  target := app.ceiling_plan(new.coaching_center_id);

  if target is null then
    raise exception 'student % names no coaching centre', new.name
      using errcode = '23503';
  end if;

  /*
   * WHICH TIERS THIS RULE IS FOR, and it is the tier's own question rather than a count's.
   * These are the two per-student tiers and no others: §3.3 retired their student ceiling on
   * purpose, `app.student_ceiling` answers the sentinel for both, and `app.guard_student_capacity`
   * therefore counts nothing there — which is exactly why the rows could grow unbounded. The two
   * teacher tiers carry a finite ceiling (30 and 150, §2.7's engineering limits), every admission
   * on them is already answered by `app.guard_student_capacity` with `CD001`, and this migration
   * adds nothing to that sentence.
   *
   * A LIST AND NOT `app.plan_ceiling(target, 'students')`, which is what this line said first and
   * which raised `no ceiling called students` on the very tiers the rule is for: that function's
   * four dimensions are batches, subjects, teachers and seats, and 'students' was never one of
   * them — the student ceiling lives in its own function. The list is the same one 20260811000087
   * §1 writes inside `app.student_ceiling` and the same pair 20260811000090 §1 asks, so the two
   * statements of "which tiers these are" are the migration that retired the ceiling and this
   * one. A fifth tier added to the enum is not silently let through: it lands on the branch that
   * has no ceiling to answer with, and the founder's number governs it.
   */
  if target not in ('center', 'institution') then
    return new;
  end if;

  select s.trial_roster_ceiling into allowed
  from public.platform_settings s
  where s.id;

  if allowed is null then
    raise exception 'no trial policy is in force' using errcode = '23503';
  end if;

  /* Zero is the founder's own decision to carry as many rows as a trial asks for, and it is
     the only value that opens this rule — not a missing row, not a failed read. */
  if allowed = 0 then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('students.trial_roster'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  in_use := app.active_students(new.coaching_center_id);

  -- Inside the bound: this admission changes nothing about how much we are carrying, so
  -- there is nothing to fund and no read of the balance at all.
  if in_use < allowed then
    return new;
  end if;

  /*
   * Past it, and the organisation has to be a paying one. ANY MONEY LIFTS THE BOUND — not a
   * student's worth of it, which is ৳25 a month and no bar anyone could reason about, for the
   * reason 096 and 097 both record. NULL IS NOT MONEY: an unreadable balance is a refusal.
   */
  select c.balance_poisha into balance
  from public.coaching_centers c
  where c.id = new.coaching_center_id;

  if balance is null or balance <= 0 then
    raise exception
      'a trial holds % active students, and this organisation has % with nothing on the balance',
      allowed, in_use
      using errcode = 'CD006',
            detail  = 'limit=students',
            hint    = 'Add money to the balance to run the whole roster.';
  end if;

  return new;
end;
$$;

comment on function app.guard_trial_roster() is
  'BEFORE INSERT (or a status switched back to active) on public.students: an organisation '
  'that has never funded its balance holds platform_settings.trial_roster_ceiling active '
  'students, and any money lifts the bound. The teacher tiers keep app.guard_student_capacity '
  'and CD001. MASTERPLAN.md §3.3, §4.3, §11.7. CD006, named in src/lib/capacity.ts.';

-- ---------------------------------------------------------------------------
-- 4. Where it fires.
--
-- `update of status, coaching_center_id`, copying the capacity guard beside it: a name, a
-- guardian phone or a class level does not enter the trigger at all, and a row switched back
-- to `active` is a claim rather than a correction. A second trigger on `students` rather than
-- a rewritten `app.guard_student_capacity`, for the reason 097 records about the seat fence:
-- that function is the teacher tiers' wall and keeps its meaning and its code, and only one of
-- the two can ever refuse an insert — a tier with a ceiling never reaches the bound below.
-- ---------------------------------------------------------------------------

drop trigger if exists students_guard_trial_roster on public.students;
create trigger students_guard_trial_roster
  before insert or update of status, coaching_center_id on public.students
  for each row execute function app.guard_trial_roster();

-- ---------------------------------------------------------------------------
-- 5. Who may call what.
--
-- The guard is granted to nobody, like every other trigger function here: a trigger's execute
-- right is checked when the trigger is created, not when it fires. It calls two functions
-- already granted to `authenticated` — `app.ceiling_plan` and `app.active_students` (75) — and
-- reads `platform_settings`, which a signed-in member may read.
-- ---------------------------------------------------------------------------

revoke all on function app.guard_trial_roster() from public, anon, authenticated;
