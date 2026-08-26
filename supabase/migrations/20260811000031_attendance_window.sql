-- CoachDesk BD — a register is taken for a class that happened, corrected once, and
-- then it is the record.
--
-- WHAT THE PRODUCT DOES TODAY. `saveAttendance` upserts one `attendance_sessions` row
-- per (batch, day) and one `attendance_records` row per student, both keyed so a retry
-- is idempotent. That was written for a phone in a corridor and it is right. What it
-- also means is that the same call, sent again with different values, silently replaces
-- the register — for the tenth time, by anyone who may write it, for any day.
--
-- HOLE ONE: A CLASS THAT HAS NOT HAPPENED. The action reads the date out of the form
-- and, until the commit that carries this migration, wrote:
--
--     const sessionDate = DATE_RE.test(rawDate) && rawDate <= today ? rawDate : today
--
-- under a comment saying "a date in the future is rejected outright". It was not
-- rejected, it was replaced with today — so a teacher who reached tomorrow's URL and
-- tapped save overwrote *today's* register with tomorrow's screen, which starts every
-- student present. A morning's absences, gone, and the sheet still says "saved".
--
-- HOLE TWO: A REGISTER THAT NEVER SETTLES. Nothing counted rewrites. A mark could go
-- present, absent, present, absent for as long as somebody kept tapping, and the last
-- tap won. A register that can be rewritten at will is not a register; it is a draft of
-- one, and a parent asking "was my son in class on the 12th" is owed better than
-- whatever the app was last told.
--
-- WHY THE BUDGET IS ONE CHANGE PER MARK, and not one per register. The reason the owner
-- asked for a correction at all is that a student can be a few minutes late: the
-- register goes in at 4:05, a boy walks in at 4:10, his mark moves present → late. If
-- the budget were one per register, that single fix would spend it, and a second boy
-- arriving at 4:15 could not be recorded at all — leaving a register that is knowably
-- wrong and cannot be fixed. Per mark, each fact settles after one correction and
-- nobody else's is spent. The register as a whole is still correctable exactly once,
-- which is the rule as it was asked for.
--
-- WHY A TAP IS NOT AN EDIT, and neither is a save. `experimental.useOffline` replays a
-- Server Action when the signal comes back, so the same save arrives twice; and the
-- register's buttons write to React state and localStorage, never to the network, so a
-- teacher may tap present forty times before submitting. The budget is spent by a
-- *changed value* and by nothing else — `status is distinct from status` and no other
-- test. A replayed identical save is free, an unchanged mark inside a changed register
-- is free, and tapping is free.
--
-- WHAT IS NOT HERE, deliberately. "Today, or your last class" is the window the app
-- offers, and it stays in the action and the page: it needs the batch's timetable to
-- know which past day was a class, and a coaching centre correcting last month's book
-- is doing bookkeeping rather than taking attendance. What is never right for anybody
-- is a register for a day that has not arrived, so that is the line drawn here.

-- ---------------------------------------------------------------------------
-- 1. How many times this mark has been changed.
--
-- On the mark and not on the session, for the reason above. `smallint` because the
-- ceiling a browser can reach is one and the only writer that can go past it is a
-- support session straightening out a centre's book by hand.
--
-- Default 0 and not null, so every row that predates this migration is a mark that has
-- been taken and never corrected — which is exactly what it is. It also means the
-- product's own history is not retroactively locked: the centres using this today get
-- their one correction on every mark they have ever written, rather than discovering
-- that yesterday's register hardened while they slept.
--
-- The bound is a constraint as well as a trigger stamp, because they answer different
-- questions. The trigger decides what a browser is allowed to do; the constraint says
-- what the column means, and holds for the server role too.
-- ---------------------------------------------------------------------------

alter table public.attendance_records
  add column if not exists revision smallint not null default 0
    constraint attendance_records_revision_bound check (revision >= 0);

comment on column public.attendance_records.revision is
  'How many times this mark has been changed since it was first taken. 0 is a mark as '
  'the teacher called it; 1 is a mark corrected once, and is where a browser session '
  'stops — app.guard_attendance_mark() refuses a second change and stamps this column '
  'rather than accepting it from the client. Only a changed status counts: re-saving '
  'the same mark, which the offline replay does on its own, moves nothing.';

-- ---------------------------------------------------------------------------
-- 2. The session guard: no future register, and a register cannot be moved.
--
-- Dhaka's date and not the server's. Postgres runs in UTC on Supabase, so for the first
-- six hours of every Bangladeshi day `current_date` is yesterday — a teacher marking a
-- 7am batch would be told their own morning was in the future. `todayInDhaka()` in
-- src/lib/bd/time.ts is the same decision on the other side of the wire.
--
-- WHY THE DATE IS FROZEN ON UPDATE rather than re-bounded. If a register cannot change
-- its day, then a row that was inside the bound when it was inserted is inside it
-- forever, and the future check has one place to live instead of two. Freezing the
-- batch matters for its own reason: a register carries the marks of the students who
-- were enrolled in *that* batch, and moving it sideways would file thirty children's
-- attendance against a class they were never in.
--
-- `note` is left writable and is not counted. It is an aside a teacher types about the
-- class — "power cut, finished early" — not a fact about a child, and a centre that
-- wants to add "…and the fan was out" an hour later should not be spending a correction
-- on it.
--
-- The server role is exempt from all of it, as it is in 20260811000028 and
-- 20260811000030: a support session repairing a date somebody typed wrong is the one
-- caller with a reason to move a register, and it is not reachable from a browser.
-- ---------------------------------------------------------------------------

create or replace function app.guard_attendance_session()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  server_role boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
begin
  if tg_op = 'DELETE' then
    if not server_role then
      raise exception
        'the register for % cannot be deleted by %; a class that was held stays on '
        'the record, and a mark that was wrong is corrected instead',
        old.session_date, current_user
        using errcode = '42501';
    end if;
    return old;
  end if;

  if not server_role
     and new.session_date > (now() at time zone 'Asia/Dhaka')::date
  then
    raise exception
      'attendance cannot be taken for %, which has not arrived yet in Dhaka; '
      'a class that has not happened has nobody in it', new.session_date
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and not server_role
     and (new.id is distinct from old.id
          or new.coaching_center_id is distinct from old.coaching_center_id
          or new.batch_id is distinct from old.batch_id
          or new.session_date is distinct from old.session_date
          or new.created_at is distinct from old.created_at)
  then
    raise exception
      'a register belongs to one batch on one day and cannot be moved by %; '
      'take the right one instead', current_user
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_sessions_guard on public.attendance_sessions;

create trigger attendance_sessions_guard
  before insert or update or delete on public.attendance_sessions
  for each row execute function app.guard_attendance_session();

-- ---------------------------------------------------------------------------
-- 3. The mark guard: taken once, corrected once, and stamped rather than claimed.
--
-- `max_revision` is 1 and its twin is ATTENDANCE_MAX_REVISION in
-- src/lib/attendance/window.ts, which is what the register reads to draw a settled row
-- as a settled row instead of three buttons that would be refused. Two constants for
-- one number is the price of the screen knowing the rule before the teacher finds out
-- the hard way; this one is the one that holds.
--
-- THE TEST IS `status is distinct from status`. Not "was an update issued", which the
-- offline replay issues on its own; not "was the row in the payload", which it is for
-- every student in the batch on every save. A mark nobody changed has not been
-- corrected, so it costs nothing and its stamp does not move. That is also the answer
-- to a save that half-failed: the marks that landed are now equal to what is being
-- sent, so the retry writes only the ones that did not.
--
-- `revision`, `marked_at` and `marked_by` are stamped and never accepted — on the insert
-- as well as on the correction, because "who marked this child absent" is the first
-- question asked when a parent disputes a register and a value the client chose is not an
-- answer. A client that could name its own revision could arrive at -1 and correct a mark
-- forever; one that could name `marked_by` could put a colleague's name on its own change;
-- one that could name `marked_at` could date a correction to before the class. The
-- register already sends exactly what the trigger writes, so nothing in the product
-- notices; only a hand-made call does.
--
-- NOT DELETABLE, which closes the way round all of it. Without this a settled mark
-- could be deleted and inserted again at revision 0, and the budget would be a
-- formality. Nothing in the product deletes a mark — the register only ever upserts —
-- so this costs nothing that anyone uses.
-- ---------------------------------------------------------------------------

create or replace function app.guard_attendance_mark()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  server_role boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
  max_revision constant smallint := 1;
begin
  if tg_op = 'DELETE' then
    if not server_role then
      raise exception
        'a mark that was called cannot be deleted by %; correct it instead',
        current_user
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- A mark arrives as it was called: never pre-corrected, never pre-dated, and never
  -- signed by somebody who was not the one calling it. The server role keeps what it
  -- was given, so an import can carry the hour a register was actually taken.
  if tg_op = 'INSERT' then
    if not server_role then
      new.revision := 0;
      new.marked_at := now();
      new.marked_by := auth.uid();
    end if;
    return new;
  end if;

  if not server_role
     and (new.id is distinct from old.id
          or new.coaching_center_id is distinct from old.coaching_center_id
          or new.session_id is distinct from old.session_id
          or new.enrollment_id is distinct from old.enrollment_id)
  then
    raise exception
      'a mark belongs to one student in one register and cannot be moved by %',
      current_user
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not server_role and old.revision >= max_revision then
      raise exception
        'this mark has already been corrected once and is now the record; '
        'changing it again is not something any screen can do'
        using errcode = '42501';
    end if;

    if not server_role then
      new.revision := (old.revision + 1)::smallint;
      new.marked_at := now();
      new.marked_by := auth.uid();
    end if;

  elsif not server_role then
    -- Nothing changed, so nothing was re-made.
    new.revision := old.revision;
    new.marked_at := old.marked_at;
    new.marked_by := old.marked_by;
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_records_guard on public.attendance_records;

create trigger attendance_records_guard
  before insert or update or delete on public.attendance_records
  for each row execute function app.guard_attendance_mark();

-- ---------------------------------------------------------------------------
-- 4. A fence, and not the one the house style usually builds.
--
-- 20260811000028 and 20260811000030 fenced fee_invoices the tidy way: revoke UPDATE
-- outright, then grant it back column by column, so a hand-made PostgREST call cannot
-- reach a column the product never writes. That does not work here, for a reason worth
-- writing down before somebody "fixes" it.
--
-- PostgREST compiles `.upsert(rows, { onConflict })` into `insert … on conflict (…) do
-- update set` naming every column in the payload — including `session_id` and
-- `enrollment_id`, the conflict target itself. Column privileges are checked against
-- that SET list and never against the values, so `grant update (status)` would refuse
-- the ordinary save that re-sets `session_id` to the value it already holds. The fence
-- would not narrow the register; it would break it.
--
-- The deploy order makes it worse. This migration has to be applied before the code
-- that knows about `revision` ships, so for the length of one deploy the fence would be
-- facing the *current* save, which sends exactly that payload. A centre would spend
-- that window unable to take attendance at all.
--
-- So the whole rule is in the two triggers above, which compare values instead of
-- column names — stricter than a grant in the way that matters here, because a grant
-- cannot tell a re-sent value from a changed one and the triggers are built on nothing
-- else.
--
-- DELETE and TRUNCATE are revoked all the same. A row trigger never sees a TRUNCATE,
-- and there is nothing to weigh on DELETE either: no path in the product deletes a
-- register or a mark, and a settled mark that could be deleted and inserted again would
-- come back at revision 0 with its correction spent on nobody.
--
-- Which leaves the one thing that must keep working: deleting a batch, or a centre,
-- takes its registers with it. Referential actions do not run as the caller — Postgres
-- runs them as the owner of the referencing table, `postgres` here — so a cascade
-- reaches the guard as a server role and passes, and reaches the revoke with privileges
-- it never needed. An owner closing a batch still closes it.
-- ---------------------------------------------------------------------------

revoke delete, truncate on public.attendance_sessions from authenticated;
revoke delete, truncate on public.attendance_records from authenticated;

-- ---------------------------------------------------------------------------
-- 5. The guards are not an API.
--
-- Per the convention in 20260811000010, and for the same reason as 20260811000030:
-- both of these live in `app`, which PostgREST does not expose, and both return
-- `trigger`, which PostgREST would refuse anyway — and a trigger does not consult
-- EXECUTE when it fires. Revoked regardless, because a function nobody should ever call
-- by name should not be callable by name.
-- ---------------------------------------------------------------------------

revoke all on function app.guard_attendance_session() from anon, authenticated, public;
revoke all on function app.guard_attendance_mark() from anon, authenticated, public;

comment on function app.guard_attendance_session() is
  'Keeps a register to the class it records. Refuses attendance for a date that has not '
  'arrived yet in Dhaka, refuses moving a register to another batch or another day once '
  'it exists, and refuses deleting one from a browser session. The server role is '
  'exempt so a support session can repair a date somebody typed wrong.';

comment on function app.guard_attendance_mark() is
  'The one correction. A mark is inserted at revision 0, signed and dated by the trigger '
  'rather than by the client, may have its status changed once — which stamps revision, '
  'marked_at and marked_by again — and is the record after that. Re-saving the same '
  'status costs nothing, which is what makes the offline replay safe, and a mark cannot '
  'be moved to another student or deleted to buy a second try.';
