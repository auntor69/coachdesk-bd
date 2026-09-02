-- ---------------------------------------------------------------------------
-- The plan's other ceilings, moved into the database.
--
-- MASTERPLAN.md §16 step 20, and the sentence in settings/actions.ts that admits the
-- gap: "There is no trigger behind this cap either: these two calls are the limit."
-- Student places have had a trigger since 20260811000036. Batches, subjects, teachers
-- and students-per-batch have had a Server Action, which is server-side and is not the
-- server: `batches`, `subjects`, `teachers` and `enrollments` all still hold INSERT for
-- `authenticated`, so an owner's own token posted straight at PostgREST writes the
-- hundred-and-first batch without passing the action that would have refused it.
--
-- WHAT THIS DOES NOT CHANGE. The action-level checks stay exactly as they are. They
-- name the building that is full, or the batch, in the owner's own words, and a
-- SQLSTATE cannot do that. This is the floor under them: it holds for the form, for
-- the import, for a race between two managers, and for a request that never went
-- near a form.
--
-- THE CEILINGS BECOME DATA rather than four literals in plpgsql, on the same reasoning
-- as `plan_allowances.included_students`: src/lib/plans.ts is the other copy, and a
-- table can be diffed against it by a test. tests/plan-allowances.test.ts already does
-- exactly that for places.
--
-- NULL MEANS NO CEILING, and it is the common case on the tiers that pay us: a centre
-- buys students, so it is not also metered on teachers or on how many sit in one room.
-- Every guard returns before it counts anything when the ceiling is null, so the cost
-- on those tiers is one indexed read of a four-row table.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The ceilings, as data.
--
-- Mirrors PLANS in src/lib/plans.ts. The centre figures are the abuse ceilings §2.7
-- describes rather than product limits — a hundred batches is four a day for a month —
-- and the teacher figures are the wall between a solo plan and an organisation.
-- ---------------------------------------------------------------------------

alter table public.plan_allowances
  add column if not exists max_batches integer
    constraint plan_allowances_batches_positive
    check (max_batches is null or max_batches >= 1),
  add column if not exists max_subjects integer
    constraint plan_allowances_subjects_positive
    check (max_subjects is null or max_subjects >= 1),
  add column if not exists max_teachers integer
    constraint plan_allowances_teachers_positive
    check (max_teachers is null or max_teachers >= 1),
  add column if not exists max_students_per_batch integer
    constraint plan_allowances_seats_positive
    check (max_students_per_batch is null or max_students_per_batch >= 1);

comment on column public.plan_allowances.max_batches is
  'Active batches allowed. Per BRANCH on the institution tier and per centre '
  'below it, because rooms are physical and do not pool — MASTERPLAN.md 8.4. '
  'Null means no ceiling.';

comment on column public.plan_allowances.max_subjects is
  'Active subjects allowed for the whole organisation. Null means no ceiling.';

comment on column public.plan_allowances.max_teachers is
  'Active teacher records allowed. One on both teacher tiers at any price — the '
  'wall between a solo plan and a centre. Null means no ceiling.';

comment on column public.plan_allowances.max_students_per_batch is
  'Active enrolments allowed in one batch. 30 on the teacher tiers, where it is a '
  'real commercial cap; null on the centre tiers, where a 200-seat exam batch is '
  'an ordinary thing to run.';

update public.plan_allowances set
  max_batches            = v.batches,
  max_subjects           = v.subjects,
  max_teachers           = v.teachers,
  max_students_per_batch = v.seats
from (values
  ('teacher_free'::public.plan_type,   1,   1,    1,   30),
  ('teacher_plus'::public.plan_type,   5,   5,    1,   30),
  ('center'::public.plan_type,       100, 200, null, null),
  ('institution'::public.plan_type,  100, 200, null, null)
) as v (plan, batches, subjects, teachers, seats)
where plan_allowances.plan = v.plan;

-- Every plan seeded, or a tier added later inherits four nulls and is silently
-- uncapped. `included_students` is not null so it cannot carry this check itself.
do $$
declare
  missing integer;
begin
  select pg_catalog.count(*)::integer into missing
  from public.plan_allowances
  where max_batches is null or max_subjects is null;

  if missing > 0 then
    raise exception '% plan(s) have no batch or subject ceiling', missing;
  end if;
end;
$$;

-- A ceiling may never fall as the plan rises, because §2.2's trial grants the trialled
-- tier's ceilings and nothing re-checks the rows already written. A tier seeded out of
-- order would take a batch away from somebody who had already made it. Null is read as
-- no ceiling, so it sorts last — and `coalesce` is written bare for the reason `greatest`
-- is: it is SQL syntax, not a function an empty search_path can reach.
do $$
declare
  bad integer;
begin
  select pg_catalog.count(*)::integer into bad
  from public.plan_allowances a
  join public.plan_allowances b on b.plan > a.plan
  where coalesce(b.max_batches, 2147483647) < coalesce(a.max_batches, 2147483647)
     or coalesce(b.max_subjects, 2147483647) < coalesce(a.max_subjects, 2147483647)
     or coalesce(b.max_teachers, 2147483647) < coalesce(a.max_teachers, 2147483647)
     or coalesce(b.max_students_per_batch, 2147483647) < coalesce(a.max_students_per_batch, 2147483647);

  if bad > 0 then
    raise exception 'a higher plan has a lower ceiling in % pair(s)', bad;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Which plan's ceilings apply.
--
-- The same question `app.admitted_ceiling` answers for places, and the same answer: a
-- live trial of a HIGHER tier grants that tier's ceilings, because that is what the
-- screen told the customer. The rank test is load-bearing rather than tidy — a centre
-- row still carrying the signup's `teacher_plus` trial would otherwise be held to five
-- batches on a plan that allows a hundred. 20260811000060 §1 pins the enum's order to
-- PLAN_RANK in src/lib/plans.ts, which is what makes `>` mean "more expensive".
--
-- Null for a centre that does not exist. Each guard reads that as an insert with no
-- tenant rather than as no ceiling: a failed read is not an empty answer.
-- ---------------------------------------------------------------------------

create or replace function app.ceiling_plan(center uuid)
returns public.plan_type
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when c.trial_ends_at > pg_catalog.now() and c.trial_plan > c.plan
             then c.trial_plan
           else c.plan
         end
  from public.coaching_centers c
  where c.id = center;
$$;

comment on function app.ceiling_plan(uuid) is
  'The plan whose numeric ceilings apply right now: the paid one, or a live trial '
  'of a more expensive one. MASTERPLAN.md 4.5.';

-- Raises on a dimension nobody seeded, because returning null there would read as no
-- ceiling and a typo in a trigger would switch a cap off in silence.
create or replace function app.plan_ceiling(target public.plan_type, dimension text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ceiling integer;
begin
  select case dimension
           when 'batches'  then a.max_batches
           when 'subjects' then a.max_subjects
           when 'teachers' then a.max_teachers
           when 'seats'    then a.max_students_per_batch
         end
    into ceiling
  from public.plan_allowances a
  where a.plan = target;

  -- `found` is a plpgsql variable, not a function, so the empty search_path does not
  -- reach it — the same reason `greatest` is written bare in 20260811000036.
  if not found then
    raise exception 'plan % has no allowance row', target using errcode = '23503';
  end if;

  if dimension not in ('batches', 'subjects', 'teachers', 'seats') then
    raise exception 'no ceiling called %', dimension;
  end if;

  return ceiling;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The counts.
--
-- SECURITY DEFINER for the reason `app.active_students` is: a teacher may hold rows a
-- teacher cannot see all of, so an invoker-side count would return their handful and
-- pass every check. These return one integer about the caller's own organisation.
--
-- DELIBERATELY NOT `stable`, which is the subtle half. A STABLE function reads the
-- calling statement's snapshot and so cannot see rows that same statement has already
-- written — a paste of forty enrolments would pass forty times over. VOLATILE takes a
-- fresh snapshot per call, so row 30 sees rows 1..29.
--
-- Active rows only, matching `limitRefusal` exactly: a retired subject must not hold a
-- slot hostage, and a batch nobody teaches any more is not using a room.
-- ---------------------------------------------------------------------------

create or replace function app.active_subjects(center uuid)
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
  from public.subjects s
  where s.coaching_center_id = center and s.active;
  return n;
end;
$$;

create or replace function app.active_teachers(center uuid)
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
  from public.teachers t
  where t.coaching_center_id = center and t.active;
  return n;
end;
$$;

-- `branch` is a value and not a wildcard, exactly as `batchRoomRefusal` reads it: a
-- batch filed under no building belongs to head office, and head office has a room of
-- its own rather than a share of every branch's. `is not distinct from` is what makes
-- null one of the buckets instead of matching none.
create or replace function app.active_batches(center uuid, branch uuid, per_branch boolean)
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
  from public.batches b
  where b.coaching_center_id = center
    and b.active
    and (not per_branch or b.branch_id is not distinct from branch);
  return n;
end;
$$;

create or replace function app.active_seats(center uuid, batch uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  -- Scoped by centre as well as by batch, on the same reasoning the enrolment insert
  -- gives: an owner of two centres satisfies is_staff_admin for both.
  select pg_catalog.count(*)::integer into n
  from public.enrollments e
  where e.coaching_center_id = center
    and e.batch_id = batch
    and e.status = 'active';
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The refusals.
--
-- `CD003`, named once in src/lib/capacity.ts beside `CD001`. Not `CD002` — that is the
-- teacher clash in 20260811000071, and src/lib/settings/clash.ts reads it — so a shared
-- code would have told an owner their plan was full when a teacher was double-booked.
-- A separate code from `CD001` too, because it is a different sentence: `CD001` means buy
-- more places, and no amount of money buys a hundred-and-first batch on any tier — the
-- answer there is to retire a batch that finished, or on a teacher plan to move up. The
-- dimension rides in `detail` so one handler can say which.
--
-- SECURITY INVOKER, deliberately: inside a definer function `current_user` is the
-- owner, so the exemption below would match every caller and no ceiling would hold.
-- The counting that needs to see past RLS is in section 3, which is definer and does
-- nothing else.
--
-- `service_role` IS NOT EXEMPT, matching `app.guard_student_capacity`. It is the app's
-- own admin client, and the point of being here rather than in an action is that an
-- action cannot wave it through.
--
-- THE LOCK is scoped to the organisation and held to commit. Two managers adding the
-- hundredth batch both count 99 without it, both pass, and the centre runs 101.
-- ---------------------------------------------------------------------------

create or replace function app.guard_batch_ceiling()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target     public.plan_type;
  ceiling    integer;
  in_use     integer;
  per_branch boolean;
begin
  -- Only a running batch occupies a room. A retired one is history, and history is free.
  if not new.active then
    return new;
  end if;

  -- An update that claims nothing new: already running, same organisation, same
  -- building. This is what lets a rename or a fee change through without a count.
  if tg_op = 'UPDATE'
     and old.active
     and old.coaching_center_id = new.coaching_center_id
     and old.branch_id is not distinct from new.branch_id
  then
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  target := app.ceiling_plan(new.coaching_center_id);

  if target is null then
    raise exception 'batch % names no coaching centre', new.name
      using errcode = '23503';
  end if;

  ceiling := app.plan_ceiling(target, 'batches');

  if ceiling is null then
    return new;
  end if;

  -- Per building only where buildings are bought (§8.4). A centre moved down off the
  -- institution tier keeps every `branch_id` it ever wrote — nothing clears the column,
  -- and nothing should — so counting per branch without asking the plan would multiply
  -- the guardrail by the number of buildings it no longer pays for.
  per_branch := target = 'institution'::public.plan_type;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('batches.ceiling'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  in_use := app.active_batches(new.coaching_center_id, new.branch_id, per_branch);

  if in_use >= ceiling then
    raise exception 'this centre has % of % batches running', in_use, ceiling
      using errcode = 'CD003',
            detail  = 'limit=batches',
            hint    = 'Retire a batch that has finished, or move to a plan that allows more.';
  end if;

  return new;
end;
$$;

-- Centre-wide, with no branch dimension: a subject is a name on a syllabus and every
-- building teaches it, which is why §8.4 makes rooms per branch and subjects not.
create or replace function app.guard_subject_ceiling()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target  public.plan_type;
  ceiling integer;
  in_use  integer;
begin
  if not new.active then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.active and old.coaching_center_id = new.coaching_center_id then
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  target := app.ceiling_plan(new.coaching_center_id);

  if target is null then
    raise exception 'subject % names no coaching centre', new.name
      using errcode = '23503';
  end if;

  ceiling := app.plan_ceiling(target, 'subjects');

  if ceiling is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('subjects.ceiling'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  in_use := app.active_subjects(new.coaching_center_id);

  if in_use >= ceiling then
    raise exception 'this centre has % of % subjects active', in_use, ceiling
      using errcode = 'CD003',
            detail  = 'limit=subjects',
            hint    = 'Retire a subject nobody teaches, or move to a plan that allows more.';
  end if;

  return new;
end;
$$;

-- The one ceiling that is a wall rather than a guardrail: a teacher plan is one teacher
-- at any price (§2, §4), and the whole difference between it and a centre is that a
-- centre has staff. Nothing here counts accounts — a `teachers` row is the record of a
-- person, and §18 hangs the login off it, so the record is the thing to hold.
create or replace function app.guard_teacher_ceiling()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target  public.plan_type;
  ceiling integer;
  in_use  integer;
begin
  if not new.active then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.active and old.coaching_center_id = new.coaching_center_id then
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  target := app.ceiling_plan(new.coaching_center_id);

  if target is null then
    raise exception 'teacher % names no coaching centre', new.name
      using errcode = '23503';
  end if;

  ceiling := app.plan_ceiling(target, 'teachers');

  if ceiling is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('teachers.ceiling'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  in_use := app.active_teachers(new.coaching_center_id);

  if in_use >= ceiling then
    raise exception 'this plan allows % teacher record(s), and % are active', ceiling, in_use
      using errcode = 'CD003',
            detail  = 'limit=teachers',
            hint    = 'A coaching centre plan is what adds staff.';
  end if;

  return new;
end;
$$;

-- Per batch, so the lock is per batch too: two managers filling one room must queue, two
-- managers filling different rooms must not. `enrollments.batch_id` is not null, so there
-- is no head-office bucket to think about here.
create or replace function app.guard_batch_seats()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target  public.plan_type;
  ceiling integer;
  in_use  integer;
begin
  -- Only a live enrolment sits in a chair. A student who left, or whose place is on hold,
  -- has given the chair back — the same reading `fullBatches` takes.
  if new.status <> 'active'::public.enrollment_status then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'active'::public.enrollment_status
     and old.batch_id = new.batch_id
     and old.coaching_center_id = new.coaching_center_id
  then
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  target := app.ceiling_plan(new.coaching_center_id);

  if target is null then
    raise exception 'enrolment names no coaching centre'
      using errcode = '23503';
  end if;

  ceiling := app.plan_ceiling(target, 'seats');

  -- Null on both centre tiers, where a 200-seat exam batch is an ordinary thing to run,
  -- and this is the branch that costs a paying customer nothing.
  if ceiling is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('enrollments.seats'),
    pg_catalog.hashtext(new.batch_id::text)
  );

  in_use := app.active_seats(new.coaching_center_id, new.batch_id);

  if in_use >= ceiling then
    raise exception 'this batch holds % of % students', in_use, ceiling
      using errcode = 'CD003',
            detail  = 'limit=seats',
            hint    = 'Open a second batch, or move to a plan without a per-batch limit.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Where they fire.
--
-- `update of <columns>` rather than a bare `update`, copying the students trigger: a
-- rename, a fee change or a schedule edit does not touch these columns, so the trigger is
-- never entered at all and the early returns inside are the second line rather than the
-- first. `branch_id` is in the batches list because moving a batch between buildings
-- claims a room in the new one.
-- ---------------------------------------------------------------------------

drop trigger if exists batches_guard_ceiling on public.batches;
create trigger batches_guard_ceiling
  before insert or update of active, coaching_center_id, branch_id on public.batches
  for each row execute function app.guard_batch_ceiling();

drop trigger if exists subjects_guard_ceiling on public.subjects;
create trigger subjects_guard_ceiling
  before insert or update of active, coaching_center_id on public.subjects
  for each row execute function app.guard_subject_ceiling();

drop trigger if exists teachers_guard_ceiling on public.teachers;
create trigger teachers_guard_ceiling
  before insert or update of active, coaching_center_id on public.teachers
  for each row execute function app.guard_teacher_ceiling();

drop trigger if exists enrollments_guard_seats on public.enrollments;
create trigger enrollments_guard_seats
  before insert or update of status, batch_id, coaching_center_id on public.enrollments
  for each row execute function app.guard_batch_seats();

-- ---------------------------------------------------------------------------
-- 6. Who may call what.
--
-- The counts and the two lookups are granted to `authenticated` because they have to be:
-- the guards are SECURITY INVOKER, so they call these as the manager who is inserting,
-- and without the grant every ordinary insert would fail on permission instead of on the
-- ceiling. Each returns one integer or one enum about a centre named by uuid.
--
-- The guards themselves are granted to nobody. A trigger's execute right is checked when
-- the trigger is created, not when it fires.
-- ---------------------------------------------------------------------------

revoke all on function app.ceiling_plan(uuid) from public, anon;
revoke all on function app.plan_ceiling(public.plan_type, text) from public, anon;
revoke all on function app.active_subjects(uuid) from public, anon;
revoke all on function app.active_teachers(uuid) from public, anon;
revoke all on function app.active_batches(uuid, uuid, boolean) from public, anon;
revoke all on function app.active_seats(uuid, uuid) from public, anon;
revoke all on function app.guard_batch_ceiling() from public, anon;
revoke all on function app.guard_subject_ceiling() from public, anon;
revoke all on function app.guard_teacher_ceiling() from public, anon;
revoke all on function app.guard_batch_seats() from public, anon;

grant execute on function app.ceiling_plan(uuid) to authenticated, service_role;
grant execute on function app.plan_ceiling(public.plan_type, text) to authenticated, service_role;
grant execute on function app.active_subjects(uuid) to authenticated, service_role;
grant execute on function app.active_teachers(uuid) to authenticated, service_role;
grant execute on function app.active_batches(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function app.active_seats(uuid, uuid) to authenticated, service_role;








