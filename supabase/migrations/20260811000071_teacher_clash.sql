-- CoachDesk BD — one teacher cannot be in two rooms at four o'clock. §7.3.
--
-- WHAT §7.3 ASKS FOR, in its own words: "nothing stops one teacher being scheduled in two
-- places", and "clash detection is the one worth doing first, and it is cheap: the data to
-- detect it is already in the table". Both halves are true. `batch_schedules` has held the
-- day, the start and the end since 20260811000001, and `batches.teacher_id` has held who
-- teaches it — so the question has always been answerable and has never been asked.
--
-- WHAT IT COSTS TO NOT ASK. A centre with four teachers and eleven batches builds its
-- routine over a fortnight, one batch at a time, and nobody holds the whole grid in their
-- head. Rahim sir ends up teaching Physics 1 and Chemistry 2 at Monday four o'clock, and
-- the clash is not found by an owner reading a screen — it is found by thirty students
-- sitting in a room with no teacher, and the owner hears about it from a guardian. Nothing
-- in the product could have caught it, and every fact needed to catch it was already
-- stored.
--
-- WHY A TRIGGER AND NOT AN EXCLUSION CONSTRAINT. `exclude using gist (teacher with =,
-- tsrange(...) with &&)` is the textbook answer and it needs `btree_gist`. The local RLS
-- harness (scripts/lib/pg-harness.mjs) boots PGlite with `pgcrypto` and `citext` and
-- nothing else, so an exclusion constraint would put the whole schema out of reach of the
-- assertions that guard it — a rule enforced in production and untestable locally is the
-- worse trade. It also could not express this rule: the teacher is on `batches`, the hours
-- are on `batch_schedules`, and no single-table constraint spans the two.
--
-- WHERE THE CHECK GOES, and this is the one decision in the file worth arguing about. A
-- batch's routine is written in three statements — insert the batch, clear its days, write
-- its days — and each of them is its own transaction, because that is what supabase-js can
-- do. Any check on `batches` therefore reads a torn routine: at the moment the teacher
-- changes, the day rows still say what they said this morning, and a batch moving from
-- Monday to Sunday under a new teacher would be refused for a Monday clash that is being
-- deleted two statements later.
--
-- The day rows are the last thing written, in both paths, and by then `batches` holds the
-- final teacher and the final hours. So the day row is where the picture is whole, and the
-- trigger fires there and nowhere else. Every clash between two *scheduled* batches is
-- caught, with no false refusal anywhere.
--
-- WHAT THAT LEAVES TO THE FORM. A batch with no chosen days meets every day — the form
-- says so and the teacher panel reads it that way — and such a batch writes no day row, so
-- nothing fires. src/lib/settings/clash.ts asks the same question over the whole proposal
-- before any of it is written, which is the only place that knows the days that are coming,
-- and it is also what produces the sentence an owner reads. The trigger behind it is the
-- backstop for the race, the second tab and the write that never went near the form.

-- ---------------------------------------------------------------------------
-- 1. When a batch occupies its teacher.
--
-- One batch, one to seven bookings. The chosen days are the rows in `batch_schedules`; a
-- batch with none of them, but with its own hours on `batches`, is one booking with a null
-- day meaning every day.
--
-- A batch with no hours at all is no booking. `batches.start_time` and `end_time` are
-- nullable and plenty of rows carry only a `slot` — "evening" is not a time and cannot be
-- overlapped with anything. Those batches are invisible here, which is right: a routine
-- nobody wrote down cannot be contradicted.
--
-- SECURITY DEFINER because a teacher is one person across the whole organisation. Read as
-- the caller this would be filtered by `batch_schedules_branch_scope`, so a Uttara manager
-- booking a teacher who also teaches in Mirpur would be told there is no clash — because
-- they cannot see the batch they are clashing with. The finding sees past RLS exactly as
-- app.active_students does for the student ceiling, and it never returns a row from a
-- centre it was not asked about.
-- ---------------------------------------------------------------------------

create or replace function app.batch_bookings(p_batch uuid)
returns table (day_of_week smallint, start_time time, end_time time)
language sql
stable
security definer
set search_path = ''
as $$
  select s.day_of_week, s.start_time, s.end_time
    from public.batch_schedules s
   where s.batch_id = p_batch

  union all

  select null::smallint, b.start_time, b.end_time
    from public.batches b
   where b.id = p_batch
     and b.start_time is not null
     and b.end_time is not null
     and not exists (
       select 1 from public.batch_schedules s2 where s2.batch_id = b.id
     );
$$;

-- ---------------------------------------------------------------------------
-- 2. The clash itself.
--
-- Given a batch and one hour of its week, the first other batch of the same teacher whose
-- hours run into it. First and not all of them: the answer is a refusal, and one collision
-- an owner can go and look at beats a list of five.
--
-- WHAT COUNTS AS OVERLAP: `start < other.end and other.start < end`. Half-open, so a class
-- ending at 16:00 and one starting at 16:00 do not clash — back-to-back batches are how a
-- coaching centre actually runs, and a rule that refused them would be switched off inside
-- a week. Identical times do clash, being the same hour twice.
--
-- WHAT COUNTS AS THE SAME DAY: the same number, or either side meeting every day.
--
-- ONLY ACTIVE BATCHES, both sides. A switched-off batch is a record of a class that used to
-- run; it occupies nobody and cannot be occupied. Reopening one is still checked, because
-- reopening a batch rewrites its day rows and that is what fires the trigger.
--
-- THE BATCH IS NEVER ITS OWN CLASH. `other.id <> p_batch` is what makes updateBatch's
-- clear-and-rewrite of the day rows work at all: every save replaces the same batch's own
-- timetable, and a rule comparing it with itself would refuse every edit. It also means the
-- three day rows of one batch do not collide with each other.
--
-- `p_day` may be null, meaning every day, so the same function answers for a batch whose
-- days were never chosen.
-- ---------------------------------------------------------------------------

create or replace function app.teacher_clash(
  p_batch uuid,
  p_day   smallint,
  p_start time,
  p_end   time
)
returns table (batch_id uuid, batch_name text, day_of_week smallint,
               start_time time, end_time time)
language sql
stable
security definer
set search_path = ''
as $$
  select other.id, other.name, theirs.day_of_week, theirs.start_time, theirs.end_time
    from public.batches mine
    join public.batches other
      on other.coaching_center_id = mine.coaching_center_id
     and other.teacher_id = mine.teacher_id
     and other.id <> mine.id
     and other.active
    cross join lateral app.batch_bookings(other.id) as theirs
   where mine.id = p_batch
     and mine.active
     and mine.teacher_id is not null
     and (p_day is null
          or theirs.day_of_week is null
          or theirs.day_of_week = p_day)
     and p_start < theirs.end_time
     and theirs.start_time < p_end
   order by theirs.day_of_week nulls first, theirs.start_time, other.name
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. The refusal.
--
-- WHY A NEW SQLSTATE, the same argument 20260811000036 makes for CD001 reaching a different
-- sentence: a manager IS allowed to save this batch, and the clock is what is wrong.
-- `23514` would claim a CHECK fired, `P0001` is what every uncaught raise in this schema
-- returns and so identifies nothing, and `42501` would send them looking at permissions. So
-- `CD002`, named once in src/lib/settings/clash.ts, where a grep for the five characters
-- finds both ends of it.
--
-- The message is English and is for a log. The sentence an owner reads is built by the
-- Server Action, which asked the same question before it wrote and can name the batch, the
-- day and the hour in their own language.
--
-- SECURITY INVOKER, so `current_user` is the caller and the exemption below means what it
-- says. The reading past RLS is in the two helpers and nowhere else.
--
-- MIGRATIONS AND THE SQL EDITOR ARE EXEMPT. `service_role` is not: it is the app's own
-- admin client, and the point of putting this in the database is that a Server Action
-- cannot wave it through. A founder who needs an impossible routine has a SQL editor.
-- ---------------------------------------------------------------------------

create or replace function app.guard_teacher_clash()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  hit record;
begin
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  select * into hit
    from app.teacher_clash(new.batch_id, new.day_of_week, new.start_time, new.end_time);

  if found then
    raise exception
      'this teacher already teaches % at that time', hit.batch_name
      using errcode = 'CD002',
            detail  = 'batch_id=' || hit.batch_id::text
                      || ' day_of_week=' || coalesce(hit.day_of_week::text, 'every')
                      || ' ' || hit.start_time::text || '-' || hit.end_time::text,
            hint    = 'Move one of the two classes, or give one of them a different teacher.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Where it fires.
--
-- BEFORE, so a refused row never lands, and on both writes because a day row can be moved
-- as well as added. No column list: every column in this table is part of when the class
-- meets. No DELETE — removing a booking cannot create one.
--
-- Nothing on `batches`, for the reason the header gives at length.
-- ---------------------------------------------------------------------------

drop trigger if exists batch_schedules_guard_teacher_clash on public.batch_schedules;

create trigger batch_schedules_guard_teacher_clash
  before insert or update on public.batch_schedules
  for each row execute function app.guard_teacher_clash();

-- ---------------------------------------------------------------------------
-- 5. Who may call the helpers.
--
-- Both are SECURITY DEFINER and read past RLS, and 20260811000002 gave `anon` USAGE on this
-- schema, so left alone app.teacher_clash would answer "what else does this teacher teach"
-- to a request that is not signed in. Two independent grants means two revokes, the same as
-- 20260811000036 §6. check-migrations.mjs enforces this for `public` and not for `app`, so
-- it is on the migration to get right.
--
-- `authenticated` keeps EXECUTE because the trigger runs as the caller and would otherwise
-- refuse every batch save with a permission error.
-- ---------------------------------------------------------------------------

revoke all on function app.batch_bookings(uuid) from public, anon;
revoke all on function app.teacher_clash(uuid, smallint, time, time) from public, anon;
revoke all on function app.guard_teacher_clash() from public, anon;

grant execute on function app.batch_bookings(uuid) to authenticated, service_role;
grant execute on function app.teacher_clash(uuid, smallint, time, time)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The index the check reads through.
--
-- `batches_teacher_idx` is already `(teacher_id) where active`, which is most of it, but the
-- join also filters on the centre and every query in this schema is centre-scoped. One
-- partial index on the pair keeps a day row's save at an index lookup rather than a scan of
-- every batch in the table once a centre has two hundred of them.
--
-- `batch_schedules_batch_idx` already covers app.batch_bookings.
-- ---------------------------------------------------------------------------

create index if not exists batches_center_teacher_idx
  on public.batches (coaching_center_id, teacher_id)
  where active and teacher_id is not null;

comment on function app.teacher_clash(uuid, smallint, time, time) is
  'The first other active batch of this batch''s teacher whose hours run into the given hour, or no row. §7.3.';
