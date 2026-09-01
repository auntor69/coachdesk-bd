-- ---------------------------------------------------------------------------
-- A trial grants its tier's student places, and the database agrees.
--
-- MASTERPLAN.md 4.5. 20260811000036 resolves the ceiling from the PAID plan
-- column, and 20260811000039 stamps every signup with a fortnight of Teacher Pro.
-- So the two halves of the product disagreed about a trialling teacher: the app
-- resolves entitlement through the trial and shows 150 places, and the trigger
-- counted 30. The teacher reached their thirty-first student, was refused CD001,
-- and read a hint telling them to buy places they had just been given.
--
-- The decision this migration makes, since both readings were defensible: a trial
-- grants the trial tier's places. That is what the customer was told on screen, and
-- nothing is at risk when it ends — limits apply to new actions, so a teacher who
-- reached 90 during the fortnight keeps 90 and cannot add the ninety-first.
--
-- WHY A SECOND FUNCTION AND NOT A CHANGE TO app.student_ceiling. Two different
-- questions were being asked of one function. "What did this centre pay for" prices
-- a purchase: settle_payment_intent in 20260811000057 reads the ceiling, adds the
-- places it just sold, and refuses if the number did not move. "How many may be
-- admitted right now" decides a form. A trial must move the second and must never
-- move the first, or a top-up bought during a trial would look like it granted
-- nothing and the settlement would raise on a payment that had already been taken.
-- So student_ceiling keeps its meaning and its callers, and the trigger asks a new
-- one. This is the same line entitlement.ts draws between the paid plan and the
-- resolved plan.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Rank is the enum's own order, and this pins it.
--
-- `trial_plan > plan` below is native enum comparison, which is declaration order
-- from 20260811000001 — and it has to keep matching PLAN_RANK in src/lib/plans.ts,
-- because the rank guard is what stops a trial LOWERING a ceiling. A fifth tier
-- added in the wrong position would not error anywhere; it would quietly hand a
-- ৳1,999 centre the 150 places of the tier below it. Fails the push instead.
-- ---------------------------------------------------------------------------

do $$
begin
  if not ('teacher_free'::public.plan_type < 'teacher_plus'::public.plan_type
      and 'teacher_plus'::public.plan_type < 'center'::public.plan_type
      and 'center'::public.plan_type < 'institution'::public.plan_type) then
    raise exception 'plan_type no longer sorts cheapest first; see PLAN_RANK';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. How many students may be admitted right now.
--
-- `greatest`, so this can only raise a ceiling and never lower one. A stale
-- trial_plan left on a row after a payment therefore cannot take places away — the
-- same silence effectiveEntitlement keeps about one.
--
-- THE RANK GUARD IS LOAD-BEARING, not tidiness. Teacher Pro includes 150 and a
-- Coaching Center 79, so a centre row still carrying the signup's teacher_plus trial
-- would otherwise be admitted 150 students on a plan that includes 79 — under-billing
-- that no screen would show as wrong. `trial_plan > plan` is exactly the
-- `PLAN_RANK[trial] > PLAN_RANK[paid]` test in entitlement.ts, and section 1 pins the
-- two orders together.
--
-- STRICTLY GREATER on the clock, matching trialPlan(): the instant trial_ends_at
-- names is when the trial stops granting, not the last instant it grants.
--
-- Null for a centre that does not exist, because student_ceiling promises that and
-- the trigger reads a null as "this insert has no tenant" rather than as no room.
-- ---------------------------------------------------------------------------

create or replace function app.admitted_ceiling(center uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
           app.student_ceiling(c.id),
           coalesce(
             (select a.included_students
                from public.plan_allowances a
               where a.plan = c.trial_plan
                 and c.trial_ends_at > pg_catalog.now()
                 and c.trial_plan > c.plan),
             0
           )
         )
  from public.coaching_centers c
  where c.id = center;
$$;

comment on function app.admitted_ceiling(uuid) is
  'Student places available for a new admission: what was bought, or a live '
  'trial of a higher tier, whichever is greater. app.student_ceiling is what '
  'was bought and is what prices a purchase. MASTERPLAN.md 4.5.';

-- ---------------------------------------------------------------------------
-- 3. The guard, asking the new question.
--
-- Replaced whole, because `create or replace function` has no other form. One line
-- differs from 20260811000036 — the ceiling comes from app.admitted_ceiling — and
-- the trigger itself is untouched, so it is still BEFORE INSERT OR UPDATE OF
-- status, coaching_center_id and still FOR EACH ROW.
-- ---------------------------------------------------------------------------

create or replace function app.guard_student_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ceiling integer;
  in_use  integer;
begin
  -- Only an active student occupies a place. History is free, or a centre would have
  -- to delete last year's students to admit this year's — and deleting a student
  -- deletes their attendance and their marks.
  if new.status <> 'active' then
    return new;
  end if;

  -- Already holding a place at this centre, so nothing new is being claimed. Both
  -- halves matter: the status test lets a rename or a phone correction through
  -- without a count, and the centre test means moving an active row to another
  -- organisation is still checked against that organisation's ceiling.
  if tg_op = 'UPDATE'
     and old.status = 'active'
     and old.coaching_center_id = new.coaching_center_id
  then
    return new;
  end if;

  -- Migrations and the SQL editor, and nothing else. `service_role` is absent on
  -- purpose: it is the app's own admin client, and the whole point of putting this in
  -- the database is that a Server Action cannot wave it through.
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  -- Held until commit, scoped to this organisation. Two managers adding the last
  -- student both arrive here; without the lock both count 119, both pass, and the
  -- centre quietly runs 121 students on 120 paid places.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('students.capacity'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  -- The one changed line. A live trial of a higher tier is part of what may be
  -- admitted; a purchase is priced against app.student_ceiling and is not.
  ceiling := app.admitted_ceiling(new.coaching_center_id);

  -- No ceiling means no centre row, which means this insert has no tenant. Not a
  -- capacity problem and must not be reported as one, but certainly not an insert to
  -- allow: a failed read is not an empty answer.
  if ceiling is null then
    raise exception 'student % names no coaching centre', new.name
      using errcode = '23503';
  end if;

  in_use := app.active_students(new.coaching_center_id);

  if in_use >= ceiling then
    raise exception
      'this centre has % of % student places in use', in_use, ceiling
      using errcode  = 'CD001',
            detail   = 'coaching_center_id=' || new.coaching_center_id::text,
            hint     = 'Buy more student places, or set a student who has left to a status other than active.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Who may call it.
--
-- Postgres grants EXECUTE on a new function to PUBLIC and 20260811000002 gave `anon`
-- USAGE on this schema, so a definer function left alone answers "how many places
-- does centre X have" to a caller who is not signed in. Same two revokes and the same
-- grant as section 6 of 20260811000036; the guard keeps its revoke and gets no grant,
-- because a trigger function is called by the trigger and never by a session.
-- ---------------------------------------------------------------------------

revoke all on function app.admitted_ceiling(uuid) from public, anon;
revoke all on function app.guard_student_capacity() from public, anon;

grant execute on function app.admitted_ceiling(uuid) to authenticated, service_role;
