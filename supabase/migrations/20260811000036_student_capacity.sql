-- CoachDesk BD — student capacity: the places an organisation has paid for.
--
-- A PLAN and a NUMBER OF STUDENTS are two different things, and the product has
-- until now had only the first. `plans.ts` carries `maxStudents` per tier, which
-- works for the teacher tiers because those numbers never move: Free is thirty
-- students and Pro is a hundred and fifty, forever, for everybody.
--
-- It does not work for a coaching centre, because a centre's ceiling is something
-- they buy. Two centres on the same `center` plan can be entitled to 120 and 900
-- students, and the difference is what they have paid. That is why the centre
-- tiers currently carry `maxStudents: null` — "unlimited" — which is not generous,
-- it is a hole: the bill is computed from a student count that nothing bounds.
--
-- So: one integer on the organisation saying how many active students it may have
-- at once. Not a plan, not a subscription, not a payment — those live elsewhere and
-- each has one home. See MASTERPLAN.md §3.3 and §4.1.
--
-- WHY THIS IS ENFORCED IN THE DATABASE, when no other plan limit is.
--
-- Every numeric cap in this product is checked in a Server Action and nowhere
-- else. `limitRefusal` reads a count, compares it to the plan, and returns a
-- sentence a teacher can act on. That is the right *user experience* and it is not
-- enforcement, for two reasons:
--
--   1. Read-then-write is not atomic. Two managers at one desk both read 119 of
--      120 places used, both pass the check, and both insert. The centre now has
--      121 students on 120 paid places, and nothing anywhere will ever notice.
--      This is not a rare race — "add the students" is a job two people split.
--   2. A Server Action is a public HTTP endpoint, and a cap that lives only in
--      one is a cap that holds until somebody finds a second write path. There
--      are already two (the form and `import_students`), and each new one has to
--      remember.
--
-- The fix is the one this schema already uses for receipt numbers: take a
-- transaction-scoped advisory lock on the centre, then count, then decide. The
-- second writer waits a few milliseconds and is refused correctly. Because it is a
-- trigger, it holds for every path into the table — the form, the bulk import, a
-- future one nobody has written yet, and psql.
--
-- WHY A TABLE OF ALLOWANCES rather than the numbers inlined here. The trigger has
-- to know the ceiling, and the ceiling for a teacher tier is a plan figure that
-- lives in `plans.ts`. Copying `30` and `150` into a trigger body would create a
-- second source of truth that drifts silently the first time a tier is repriced.
-- A four-row table can at least be *compared* to `plans.ts` by a test, and
-- tests/plan-allowances.test.ts does exactly that.
--
-- ---------------------------------------------------------------------------
-- 1. What each plan includes before anything is bought.
-- ---------------------------------------------------------------------------

create table public.plan_allowances (
  plan              public.plan_type primary key,
  included_students integer not null check (included_students >= 0),
  updated_at        timestamptz not null default now()
);

comment on table public.plan_allowances is
  'Students each plan includes before any capacity is purchased. Mirrors '
  'src/lib/plans.ts — tests/plan-allowances.test.ts asserts the two agree.';

-- The centre figures are not arbitrary and are not a separate pricing decision:
-- they are what the monthly floor already pays for at the first band's rate.
-- ৳1,999 buys 79 students (79 x ৳25 = ৳1,975; the eightieth tips it to ৳2,000),
-- and ৳4,999 buys 238 (৳2,500 for the first hundred, then 138 at ৳18). A centre
-- that has paid the floor and cannot add a student would be a centre that has
-- bought nothing, so the floor's seats come with it.
insert into public.plan_allowances (plan, included_students) values
  ('teacher_free',   30),
  ('teacher_plus',  150),
  ('center',         79),
  ('institution',   238);

-- Reference data: readable by anyone signed in, and not writable from a browser at
-- all. It is not tenant-scoped because it is not a tenant's — every centre on
-- `center` has the same allowance. A migration changes it, which is the point: a
-- repricing should be a reviewed diff, not an UPDATE somebody ran once.
--
-- `service_role` keeps its grant, as it does everywhere, because it bypasses RLS by
-- definition and pretending otherwise would be theatre. Nothing in the app writes
-- this table, and nothing should.
alter table public.plan_allowances enable row level security;

create policy plan_allowances_read on public.plan_allowances
  for select to authenticated using (true);

revoke insert, update, delete, truncate on public.plan_allowances
  from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. What this organisation has bought, and what it is trialling.
-- ---------------------------------------------------------------------------

alter table public.coaching_centers
  add column if not exists student_capacity integer not null default 0
    constraint coaching_centers_capacity_non_negative
    check (student_capacity >= 0),
  add column if not exists trial_plan public.plan_type,
  add column if not exists trial_ends_at timestamptz;

comment on column public.coaching_centers.student_capacity is
  'Active students this organisation has PURCHASED room for, beyond the plan '
  'allowance. Only meaningful on the per-student tiers. Written by the server '
  'after payment; locked against browser sessions by app.guard_center_billing.';

comment on column public.coaching_centers.trial_plan is
  'The plan being trialled, or null. A trial is a STATE, not a fifth tier — see '
  'MASTERPLAN.md §2.2. Entitlement is resolved from this plus trial_ends_at.';

comment on column public.coaching_centers.trial_ends_at is
  'When the trial stops granting its plan. Expiry is a comparison at read time, '
  'not a job: a cron that fails to run would hand out a paid tier forever.';

-- Both or neither. A trial_plan with no end date is a permanent free upgrade, and
-- an end date with no plan is a timer attached to nothing — each is a state the
-- resolver would have to invent an answer for, so neither is representable.
alter table public.coaching_centers
  add constraint coaching_centers_trial_pair
  check ((trial_plan is null) = (trial_ends_at is null));

-- ---------------------------------------------------------------------------
-- 3. The ceiling, in one place.
--
-- Purchased capacity applies only to the per-student tiers, and that `case` is
-- doing real work rather than being defensive. A centre that bought 900 places
-- and then downgraded to Teacher Pro must land on 150, not keep 900 — limits
-- apply to new actions, and the new action is priced by the new plan. The places
-- they paid for are not lost: capacity_purchases (a later migration) keeps the
-- record, so re-upgrading restores them.
--
-- `greatest` rather than plain capacity, so a centre is never below its own
-- floor's allowance. A capacity of zero on a paid centre is what a fresh signup
-- looks like before any top-up, and it must not mean "no students".
-- ---------------------------------------------------------------------------

create or replace function app.student_ceiling(center uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when c.plan in ('center', 'institution')
             -- Bare, not pg_catalog-qualified: `greatest` is SQL syntax rather than
             -- a function, exactly like `coalesce`, so an empty search_path cannot
             -- reach it and `pg_catalog.greatest` does not exist.
             then greatest(a.included_students, c.student_capacity)
           else a.included_students
         end
  from public.coaching_centers c
  join public.plan_allowances a on a.plan = c.plan
  where c.id = center;
$$;

-- ---------------------------------------------------------------------------
-- 4. How many places are in use.
--
-- SECURITY DEFINER, and that is not a convenience. A teacher with
-- can_manage_students may insert a student, and the students policy shows a
-- teacher only the students in batches they are assigned to — so an invoker-side
-- `count(*)` would return that teacher's handful rather than the centre's total,
-- and a full centre would pass the check every time. The count has to be the true
-- one, so it reads past RLS. It returns a single integer about the caller's own
-- centre and leaks nothing they cannot already ask for.
--
-- DELIBERATELY NOT `stable`, and this is the subtle one. A STABLE function uses
-- the calling statement's snapshot, so during a multi-row insert it cannot see the
-- rows that statement has already written — which would let a paste of 500 names
-- past a ceiling with one place left, five hundred times over. A VOLATILE function
-- takes a fresh snapshot per call, so row 200 of an import sees rows 1..199. The
-- word `stable` here would look like an optimisation and would be a hole.
-- ---------------------------------------------------------------------------

create or replace function app.active_students(center uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  select pg_catalog.count(*)::integer
    into n
  from public.students s
  where s.coaching_center_id = center
    and s.status = 'active';

  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The refusal itself.
--
-- WHY A NEW SQLSTATE. A Server Action has to turn this into a sentence a manager
-- can act on ("you have 120 of 120 places — buy more"), which means recognising
-- it, which means a code that means only this. None of the standard ones do:
--
--   23514 check_violation  would be a lie; there is no CHECK here, and the code
--                          is already how the app spots a real one.
--   P0001 raise_exception  is what *every* uncaught `raise` in this schema
--                          returns, so it identifies nothing.
--   42501 insufficient_privilege  is the billing guard's code and means "you are
--                          not allowed to do this" — but a manager IS allowed to
--                          add a student, they have simply run out of places.
--                          Telling them it is a permission problem sends them
--                          looking in the wrong screen.
--
-- So: `CD001`. `CD` is not a class Postgres uses, the app names it once in
-- src/lib/capacity.ts the way src/lib/idempotency.ts names 23505, and a grep for
-- the string finds both ends of it.
--
-- SECURITY INVOKER, deliberately, for the same reason guard_center_billing is:
-- inside a SECURITY DEFINER function `current_user` is the function's owner, so
-- the exemption below would match every caller and the ceiling would never hold.
-- The counting that DOES need to see past RLS is in app.active_students, which is
-- definer for exactly that reason and does nothing else.
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
  -- Only an active student occupies a place. Every other status is a student who
  -- has stopped, left or finished, and history is free — otherwise a centre would
  -- have to delete last year's students to admit this year's, and deleting a
  -- student deletes their attendance and their marks.
  if new.status <> 'active' then
    return new;
  end if;

  -- Already holding a place at this centre, so nothing new is being claimed.
  -- Both halves matter: the status test lets a plain rename or phone correction
  -- through without a count, and the centre test means moving an active row to
  -- another organisation is still checked against that organisation's ceiling.
  if tg_op = 'UPDATE'
     and old.status = 'active'
     and old.coaching_center_id = new.coaching_center_id
  then
    return new;
  end if;

  -- Migrations and the SQL editor, and nothing else. `service_role` is absent on
  -- purpose: it is the app's own admin client, and the whole point of putting this
  -- in the database is that a Server Action cannot wave it through. If the founder
  -- needs to seat a centre above its ceiling, the fix is to raise the ceiling —
  -- which is a row anyone can later read and explain.
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  -- The lock, and the reason this is worth a trigger at all. Held until commit,
  -- scoped to this organisation, in the same two-key namespace app.assign_receipt_no
  -- uses for receipt numbers. Two managers adding the last student both arrive
  -- here; one waits a few milliseconds and then counts a number that includes the
  -- other's row. Without it they both count 119, both pass, and the centre quietly
  -- runs 121 students on 120 paid places.
  --
  -- A hashtext collision between two centres costs one of them a brief wait and
  -- nothing else, which is the same trade the receipt series already makes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('students.capacity'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  ceiling := app.student_ceiling(new.coaching_center_id);

  -- No ceiling means no centre row, which means this insert has no tenant. That is
  -- not a capacity problem and must not be reported as one, but it is certainly not
  -- an insert to allow: a failed read is not an empty answer.
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

drop trigger if exists students_guard_capacity on public.students;

-- BEFORE INSERT so the row never lands, and BEFORE UPDATE OF the two columns that
-- can turn an idle row into a paid one. Naming the columns keeps every other edit
-- — a corrected phone number, a new guardian name, an area — off the lock.
create trigger students_guard_capacity
  before insert or update of status, coaching_center_id on public.students
  for each row execute function app.guard_student_capacity();

-- ---------------------------------------------------------------------------
-- 6. Who may call the two helpers.
--
-- Postgres grants EXECUTE on a new function to PUBLIC, and 20260811000002 gave
-- `anon` USAGE on this schema. app.active_students is SECURITY DEFINER and reads
-- past RLS by design, so left alone it would answer "how many students does centre
-- X have" to a caller who is not signed in at all. Nobody can guess a uuid, but
-- "the id is secret" is not an access control.
--
-- scripts/check-migrations.mjs enforces this for functions in `public` and not for
-- `app`, so it is on the migration to get right. Two independent grants means two
-- revokes, the same as there.
-- ---------------------------------------------------------------------------

revoke all on function app.student_ceiling(uuid) from public, anon;
revoke all on function app.active_students(uuid) from public, anon;
revoke all on function app.guard_student_capacity() from public, anon;

grant execute on function app.student_ceiling(uuid) to authenticated, service_role;
grant execute on function app.active_students(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The three new columns are the server's, not the browser's.
--
-- Without this the whole migration is decoration. `student_capacity` is the number
-- the ceiling is computed from, so a centre that can UPDATE it can buy a thousand
-- places for nothing — and `trial_plan` is worse, because it hands out a different
-- plan's entire feature set, not just seats.
--
-- The column-privilege half is already done and did not need touching:
-- 20260811000004 revoked table-level UPDATE and re-granted exactly
-- (name, phone, address, bd_area, timezone), so a column added afterwards is
-- unwritable by `authenticated` the moment it exists. This extends the trigger,
-- which is the half that survives somebody pasting `grant all on all tables in
-- schema public to authenticated` out of a setup snippet.
--
-- Same body, same roles, three more columns. Repeating the whole function rather
-- than patching it is the only option `create or replace` gives, and it keeps the
-- guard readable in one place instead of spread across two migrations.
-- ---------------------------------------------------------------------------

create or replace function app.guard_center_billing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.plan is distinct from old.plan
     or new.status is distinct from old.status
     or new.sms_credit_balance is distinct from old.sms_credit_balance
     or new.student_capacity is distinct from old.student_capacity
     or new.trial_plan is distinct from old.trial_plan
     or new.trial_ends_at is distinct from old.trial_ends_at
  then
    -- The server, and only the server. `service_role` is our admin client (the
    -- credit debit and refund in sendResultSms, and the capacity write after a
    -- payment is confirmed); `postgres`/`supabase_admin` are migrations and the
    -- Supabase SQL editor. A browser session is neither.
    if current_user not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception
        'plan, status, credits, capacity and trial are set by the server after payment, not by %',
        current_user
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
