-- ---------------------------------------------------------------------------
-- CoachDesk BD — a register is taken while the class is happening, and a class
-- nobody marked says so (the owner's request of 2026-10-09).
-- ---------------------------------------------------------------------------
--
-- WHAT THE PRODUCT DID UNTIL THIS MIGRATION. 20260811000031 closed the two holes
-- that were visible from the register itself: a class that has not happened, and a
-- register that never settles. It drew its line at the *day* — "today, or your last
-- class" — and left the hour alone. So a teacher could open tomorrow's batch at
-- eleven in the morning, tap every name present, save, and the product would file a
-- register for a class four hours away with a straight face. Nothing about that
-- register is a lie about a child yet, which is exactly why it is the dangerous
-- kind of wrong: it is a register for a class that nobody has taught, written by
-- the one person with a reason to want it to look full.
--
-- WHAT THE OWNER ASKED FOR, in their words: "we have to lock it until the class
-- time starts, it will unlock automatically at class time … suppose teacher is
-- busy tomorrow so he want to take the class tomorrow which is not supposed to be,
-- so the teacher can unlock it but he have to sign that he wanted it and confirm,
-- and the centre will get notification … suppose today class time ended but teacher
-- didnt took a single attendance then it will count as a cancelled class, or
-- suppose he forgot to took attendance at class time then he will again sign that
-- confirms he legit forgot thats why he taking attendance now."
--
-- THE THREE STATES OF A CLASS, and this is the whole design. A class on a batch's
-- timetable has a start and an end, from `batch_schedules` for that day of the week
-- (falling back to the batch's own times, and no times at all means no gate).
--
--   open    — the clock is inside [start, end + grace]. The ordinary path: the
--             register is taken while the room is full, and nothing is asked.
--   early   — before the start. Refused, unless the teacher has signed an unlock
--             for this batch and this day. The signature is a row, and the centre's
--             owners and managers can read it: "Rahim filed the 4pm class at 11:20am".
--   late    — after end + grace, with no register on the day. That is the class the
--             owner asked to count as *cancelled*, and it keeps that name until
--             somebody files it — and filing it then needs the second signature,
--             the one that says the class was held and the register is late.
--
-- So the day is one of four facts, and each has a name a person would use: taken on
-- time, taken early (signed), taken late (signed), or cancelled. There is no fifth.
--
-- WHY THE CLOCK IS A TRIGGER AND NOT A PAGE. The register screen can decide what to
-- draw, and it does — a teacher discovering this rule from a red error after tapping
-- forty names has been told too late, and that lesson is 20260811000031's. But a
-- Server Action is a public HTTP endpoint that a form is only the politest way to
-- reach, and "a register for a class that has not started" is wrong for every
-- caller. `app.class_window` and both guards below therefore live in the database,
-- and `src/lib/attendance/clock.ts` is the mirror the screens read — the same
-- arrangement `ATTENDANCE_MAX_REVISION` already has with `max_revision`.
--
-- WHAT IS NOT HERE, deliberately. The clock only exists on the day the class is on:
-- `session_date = today in Dhaka`, or the register is late for a day that has gone.
-- Yesterday's class stays the date window's business — a teacher filing last
-- Tuesday's register today is correcting history, not filing a class early, and the
-- price of widening this rule would be a signature demanded of a manager filling a
-- gap in last month's book. Nothing here reads a holiday calendar either: a class
-- that genuinely did not run stays 'cancelled' until the owner marks it, which is
-- the honest state and not a defect to be papered over with a guess.
--
-- AND ONE THING THE DATABASE CANNOT COUNT. "It will count as a cancelled class" is a
-- fact about a day — a timetable slot that ended with no register — and the count of
-- them belongs on a report rather than on a row. The state is derived here and drawn
-- on /teach and on the batch's own screen today; the month-level roll-up is the next
-- step and is deliberately not pretended at, because a count of cancelled classes
-- without a holiday calendar behind it would be a number nobody could trust.

-- ---------------------------------------------------------------------------
-- 1. Two reasons, and they are not the same act.
--
-- A type rather than free text, for the reason every vocabulary in this schema is
-- one: a misspelt reason is not a refused write, it is a third signature nobody
-- asked for sitting in the one table that exists to say what somebody agreed to.
--
-- 'early'  — taken before the class started. The owner's "he have to sign that he
--            wanted it".
-- 'forgot' — taken after the class ended, with nothing filed at the time. The
--            owner's "he will again sign that confirms he legit forgot".
-- ---------------------------------------------------------------------------

create type public.attendance_unlock_reason as enum ('early', 'forgot');

comment on type public.attendance_unlock_reason is
  'Why a register was filed outside its class time. ''early'' is before the class '
  'started and ''forgot'' is after it ended with nothing filed at the time — the two '
  'sentences a teacher signs, and the two the centre is notified of.';

-- ---------------------------------------------------------------------------
-- 2. The grace, and why thirty minutes is the number.
--
-- A class that ends at 5:30 is very often filed at 5:32: the last ten minutes are
-- spent on the room rather than the phone, and a save that lands two minutes after
-- the hour is the ordinary day, not a late filing. So the end of the class is not
-- the end of the register's window.
--
-- Tighter and the rule refuses the ordinary save, which teaches a centre that the
-- app is wrong rather than that its teacher is late. Looser and yesterday's silence
-- passes as today's diligence — and the whole point of the state is that a class
-- nobody marked is visible on the day, not the week after.
--
-- A function and not a constant in each guard, because there are two guards below
-- that must agree with each other and with `ATTENDANCE_GRACE_MINUTES` in
-- src/lib/attendance/clock.ts. Three copies of one number is how a screen comes to
-- offer a button the database refuses.
-- ---------------------------------------------------------------------------

create or replace function app.attendance_grace_minutes()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 30
$$;

comment on function app.attendance_grace_minutes() is
  'How long after a class ends its register may still be taken without a signed '
  'late-filing unlock. Mirrored by ATTENDANCE_GRACE_MINUTES in '
  'src/lib/attendance/clock.ts; the number here is the one that holds.';

-- ---------------------------------------------------------------------------
-- 3. When the class was, on one day.
--
-- Two sources, and the timetable wins where it speaks. `batch_schedules` is what the
-- routine screen writes and it is per day of the week, so Tuesday's batch can meet at
-- nine and Thursday's at four; `batches.start_time` is the batch's own single pair of
-- times, which is what a centre that has not filled in a routine yet is holding. A
-- batch with neither has no clock at all, and its register is always open — the same
-- direction /teach already takes with an empty timetable ("centres set schedules up
-- late, and hiding their batches until they do would look like data loss").
--
-- THE WHOLE DAY, NOT ONE SITTING. `batch_schedules` is unique on (batch, day, start),
-- so a batch may legitimately meet twice on a Tuesday — the morning sitting and the
-- evening one. The window is therefore min(start) to max(end): the register for the
-- whole day is open once the day's *first* class has begun and closes when its *last*
-- one has. A teacher marking the evening sitting at eleven in the morning would be
-- filing a register for a class that has not happened, and *that* is refused by the
-- order the register is written in rather than by this window — the two comparisons
-- below are about the day, and the day is what the register is keyed to.
--
-- `security invoker`, like every other guard here, and the read is safe to be: the
-- register is taken by somebody who may write it, and `batch_schedules_member_read`
-- and `batches_member_read` admit every member of the centre. A window that could not
-- be read comes back null — and a null window is no gate, which is the same
-- fail-open direction the batch's own times already take. The alternative is worse:
-- a timetable read that failed would lock a teacher out of their own 4pm class, and
-- RLS cannot fail for a reason the teacher could do anything about.
-- ---------------------------------------------------------------------------

create or replace function app.class_window(p_batch uuid, p_date date)
returns table (starts_at time, ends_at time)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(
      (
        select min(s.start_time)
        from public.batch_schedules s
        where s.batch_id = p_batch
          and s.day_of_week = extract(dow from p_date)::smallint
      ),
      b.start_time
    ),
    coalesce(
      (
        select max(s.end_time)
        from public.batch_schedules s
        where s.batch_id = p_batch
          and s.day_of_week = extract(dow from p_date)::smallint
      ),
      b.end_time
    )
  from public.batches b
  where b.id = p_batch
$$;

comment on function app.class_window(p_batch uuid, p_date date) is
  'The hours a batch''s class occupies on one calendar day: the earliest start and '
  'the latest end of that day''s schedule rows, falling back to the batch''s own '
  'times, and null where neither exists — a batch with no timetable has no clock and '
  'its register is always open.';

-- ---------------------------------------------------------------------------
-- 4. The signature.
--
-- A row per (batch, day, reason) and never an update: what it records is a person
-- agreeing, at a moment, to a sentence. The same posture `policy_acceptances` takes,
-- for the same reason — a consent that can be edited afterwards is not a record of
-- consent, and this one exists to answer "who decided to file this class's register
-- before it happened" the first time an owner asks.
--
-- `batch_name`, `starts_at` and `ends_at` ARE SNAPSHOTS, and they are the point of
-- the table being more than four columns. A timetable edited in December must not
-- silently rewrite what a teacher was told in March, and a signature read back later
-- has to explain itself without a join to a batch that may have been renamed. What
-- was agreed to is what is stored.
--
-- `signature_version` IS THE WORDING'S DATE, exactly as `policy_version` is the
-- page's: the two sentences a teacher signs live in the dictionaries, so the row
-- names the wording rather than copying it, and a copy of Bangla prose frozen into a
-- row would be the one string on an English screen that never translates. Compared
-- for equality and never ordered — a version is a label, not a date.
--
-- WHY ONE ROW PER REASON AND NOT ONE PER CLASS. A register filed early and then
-- refiled late in the same evening is two different agreements, and a single row
-- would have to be rewritten to say so — which is the one thing this table cannot
-- do. The unique index is also what makes the write idempotent: the action inserts
-- and treats a duplicate as already-signed, so a double tap on a 3G connection signs
-- once rather than twice.
--
-- `on delete cascade` on the centre and on the batch, both. A signed unlock is not a
-- fact about money and not a fact about a child's record: the batch going away takes
-- the signatures about its classes with it, and a centre closing takes all of them.
-- ---------------------------------------------------------------------------

create table public.attendance_unlocks (
  id                 uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references public.coaching_centers (id) on delete cascade,
  -- Composite, so a batch from another centre cannot be named here — the same
  -- tenant-consistent reference every other child table carries.
  batch_id           uuid not null,
  session_date       date not null,
  reason             public.attendance_unlock_reason not null,
  -- What the class's own timetable said, frozen. See the header above, and the guard
  -- below: the guard stamps these two rather than accepting them from the caller, for
  -- the reason it stamps the signer — a snapshot a client can choose is a snapshot that
  -- can disagree with the class it describes.
  batch_name         text not null,
  starts_at          time,
  ends_at            time,
  signature_version  text not null check (signature_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  -- Stamped by the guard, never accepted from the client. @generated so the type
  -- generator does not demand a value the caller is specifically not allowed to
  -- choose — the same treatment fee_payments.receipt_no gets.
  --
  -- Nullable and `on delete set null`, which is `attendance_records.marked_by`'s own
  -- shape rather than an oversight: a signature is a fact about a class that the
  -- centre keeps, so a departed teacher's account going away must not take the record
  -- with it. The guard refuses a signature with no signer in the first place, so a
  -- null here can only ever mean "that account no longer exists".
  claimed_by         uuid default auth.uid() references auth.users (id) on delete set null,
  claimed_at         timestamptz not null default now(),
  constraint attendance_unlocks_batch_center_fkey
    foreign key (batch_id, coaching_center_id)
    references public.batches (id, coaching_center_id)
    on delete cascade
);

comment on table public.attendance_unlocks is
  'One row per signature that let a register be filed outside its class time: '
  'before the class started (''early'') or after it ended with nothing filed at the '
  'time (''forgot''). Append-only, readable by the centre, and the notification the '
  'owner asked for — the row IS the notice.';

comment on column public.attendance_unlocks.batch_name is
  'The batch''s name as it read when the teacher signed. A copy rather than a join: '
  'a batch renamed in December must not rewrite what somebody agreed to in March.';

comment on column public.attendance_unlocks.starts_at is
  'The class''s start for that day, from app.class_window() at the moment of signing, '
  'or null where the batch had no timetable and the clock gate did not apply. Stamped '
  'by app.guard_attendance_unlock() rather than sent by the caller, so a signature '
  'cannot come to describe a class time that never existed. @generated';

comment on column public.attendance_unlocks.ends_at is
  'The class''s end for that day, stamped with starts_at and for the same reason. '
  '@generated';

comment on column public.attendance_unlocks.signature_version is
  'The date the sentence the teacher signed was last written, as YYYY-MM-DD — the '
  'counterpart of policy_acceptances.policy_version. The words themselves live in '
  'the dictionaries, in both languages; the row names the wording rather than '
  'freezing one language''s copy of it.';

comment on column public.attendance_unlocks.claimed_by is
  'Who signed. Stamped from auth.uid() by app.guard_attendance_unlock() and never '
  'taken from the client, because a signature somebody can name themselves as is '
  'not a signature. @generated';

comment on column public.attendance_unlocks.claimed_at is
  'When they signed, from the server clock rather than from the form. @generated';

create unique index attendance_unlocks_once
  on public.attendance_unlocks (batch_id, session_date, reason);

-- What the register and /teach read: today's signatures for this centre, and the
-- batch's own history of them.
create index attendance_unlocks_center_idx
  on public.attendance_unlocks (coaching_center_id, claimed_at desc);

-- ---------------------------------------------------------------------------
-- 5. The guard on the signature itself.
--
-- A signature is worth exactly as much as the check that it was needed. Without this
-- the two reasons are free text with a nicer name: a teacher could sign 'forgot' at
-- eleven in the morning and then file the four o'clock class with an honest-looking
-- signature that says the class had already ended. So the sentence has to match the
-- clock —
--
--   'early'  is refused once the class has begun: at that point they are not early,
--            they are on time, and they did not need anybody's permission.
--   'forgot' is refused until the class has ended and the grace has run out: before
--            that there is a register to take and no excuse to sign.
--
-- and it has to be for today. The clock only exists on the day the class is on, so a
-- signature for another day is a signature for a rule that does not apply to it.
--
-- `claimed_by` AND `claimed_at` ARE STAMPED HERE, not read from the payload, for the
-- reason 20260811000031 stamps the mark's three columns: a client that could name its
-- own signer could sign with a colleague's name, and one that could name the moment
-- could date a signature to before the class. The server role keeps what it was given,
-- so a support session can record a signature taken over the phone.
-- ---------------------------------------------------------------------------

create or replace function app.guard_attendance_unlock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  server_role  boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
  dhaka_today  date := (now() at time zone 'Asia/Dhaka')::date;
  dhaka_now    time := (now() at time zone 'Asia/Dhaka')::time;
  win_start    time;
  win_end      time;
  grace        interval := make_interval(mins => app.attendance_grace_minutes());
begin
  if not server_role then
    -- Nobody signs anonymously. `auth.uid()` is null for a request with no session at
    -- all, and a signature row that could be written without one would be the one line
    -- in this table that says nothing about who agreed to what.
    if auth.uid() is null then
      raise exception
        'a signature has to carry somebody''s name, and this session has none'
        using errcode = '42501';
    end if;

    new.claimed_by := auth.uid();
    new.claimed_at := now();
  end if;

  if new.session_date > dhaka_today then
    raise exception
      'a signature cannot be given for %, which has not arrived yet in Dhaka; '
      'a class that has not happened has nothing to unlock', new.session_date
      using errcode = '23514';
  end if;

  if new.session_date < dhaka_today then
    raise exception
      'the clock gate is about today''s class, and % is not today in Dhaka; '
      'an earlier register is a correction and not a lock to be lifted',
      new.session_date
      using errcode = '23514';
  end if;

  select w.starts_at, w.ends_at
    into win_start, win_end
    from app.class_window(new.batch_id, new.session_date) w;

  -- The window is stamped and never accepted, exactly as `claimed_by` is and for the
  -- same reason: what the row says the class's hours were has to be the class's own
  -- timetable rather than whatever the form was carrying. The client sends neither
  -- column, so the only caller this costs anything is a hand-made one.
  if not server_role then
    new.starts_at := win_start;
    new.ends_at := win_end;
  end if;

  if new.reason = 'early' then
    if win_start is not null and dhaka_now >= win_start then
      raise exception
        'this class has already started, so there is nothing early about this '
        'register and no early signature to give; take it'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- 'forgot': the class has to be over, by the same grace the register itself is
  -- measured with. Both tests matter — a window with no end cannot be late, and a
  -- class still running has a register to take.
  if win_end is null or dhaka_now <= win_end + grace then
    raise exception
      'this class has not finished yet, so a register filed now is not late; '
      'take it while the room is full'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_unlocks_guard on public.attendance_unlocks;

create trigger attendance_unlocks_guard
  before insert on public.attendance_unlocks
  for each row execute function app.guard_attendance_unlock();

-- ---------------------------------------------------------------------------
-- 6. The register guard learns the hour.
--
-- 20260811000031's body, re-emitted whole rather than patched, because a trigger
-- function has no smaller unit than itself — and both halves of its argument are
-- kept exactly as they were: the future refusal is still here, and the register is
-- still frozen to one batch on one day.
--
-- THE CLOCK IS CHECKED ON INSERT ONLY, and that is a decision rather than an
-- omission. `tg_op = 'UPDATE'` on a register that exists is a correction, and
-- corrections are 20260811000031's business — one change per mark, the date frozen,
-- the batch frozen. A teacher fixing a mark at nine at night is not filing a class
-- early or late, and asking them to sign for a correction would spend the signature
-- on the wrong act. What the clock protects is the *first* writing of a register:
-- the act that says a class happened and these children were in it.
--
-- `win_end + grace` and not `dhaka_now > win_end` — see the grace's own comment.
-- The comparison is also what makes 'late' and 'cancelled' the same instant: at
-- end + grace a class with no register is counted as cancelled on every screen, and
-- filing it from then on carries the second signature.
-- ---------------------------------------------------------------------------

create or replace function app.guard_attendance_session()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  server_role boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
  dhaka_today date := (now() at time zone 'Asia/Dhaka')::date;
  dhaka_now   time := (now() at time zone 'Asia/Dhaka')::time;
  win_start   time;
  win_end     time;
  grace       interval := make_interval(mins => app.attendance_grace_minutes());
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
     and new.session_date > dhaka_today
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

  -- The clock, on the first writing of the day's register and on nothing else.
  if tg_op = 'INSERT' and not server_role and new.session_date = dhaka_today then
    select w.starts_at, w.ends_at
      into win_start, win_end
      from app.class_window(new.batch_id, new.session_date) w;

    if win_start is not null and dhaka_now < win_start then
      if not exists (
        select 1 from public.attendance_unlocks u
        where u.batch_id = new.batch_id
          and u.session_date = new.session_date
          and u.reason = 'early'
      ) then
        raise exception
          'this class has not started yet: it begins at %, and it is % in Dhaka. '
          'A register for a class nobody has taught is not a register — if the '
          'class is genuinely being taken early, sign that on the register and the '
          'centre will be told',
          to_char(win_start, 'HH24:MI'), to_char(dhaka_now, 'HH24:MI')
          using errcode = '23514';
      end if;

    elsif win_end is not null and dhaka_now > win_end + grace then
      if not exists (
        select 1 from public.attendance_unlocks u
        where u.batch_id = new.batch_id
          and u.session_date = new.session_date
          and u.reason = 'forgot'
      ) then
        raise exception
          'the class ended at %, and a register filed now counts as a cancelled '
          'class. If the class was held and this is the register for it, sign that '
          'on the register and the centre will be told',
          to_char(win_end, 'HH24:MI')
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function app.guard_attendance_session() is
  'Keeps a register to the class it records. Refuses attendance for a date that has '
  'not arrived yet in Dhaka, refuses a first register taken before its class started '
  'or after it ended (each unless a signed attendance_unlocks row says otherwise), '
  'refuses moving a register to another batch or another day once it exists, and '
  'refuses deleting one from a browser session. The server role is exempt so a '
  'support session can repair a date somebody typed wrong.';

-- The trigger itself is unchanged — 20260811000031 created it and it still points at
-- the function above. Re-created anyway, so this migration can be read as the whole
-- truth about what guards a register without opening the older file. `drop` and
-- `create` rather than `create or replace`, because a trigger has no replace form.
drop trigger if exists attendance_sessions_guard on public.attendance_sessions;

create trigger attendance_sessions_guard
  before insert or update or delete on public.attendance_sessions
  for each row execute function app.guard_attendance_session();

-- ---------------------------------------------------------------------------
-- 7. Who may sign, and who may read what was signed.
--
-- THE ROW IS THE NOTIFICATION, so it is read by the centre and not only by the person
-- who wrote it. `attendance_unlocks_member_read` is the whole centre — every member,
-- which on this table is owners, managers and teachers — because the owner's request
-- ends "the centre will get notification", and a notice only one person can read is
-- not one. Nothing here names a child: a row says which teacher signed which sentence
-- about which batch at which minute, which is exactly the shape of every other review
-- line /teach already draws (§6.3's "not submitted").
--
-- THE WRITE IS ONE POLICY WITH TWO BRANCHES, copied from attendance_sessions itself:
-- the teacher whose batch it is, or a staff-admin. It is the same pair the register
-- uses, and it has to be — a signature that could be given by somebody who may not
-- take the register is a signature attached to nothing.
--
-- NO UPDATE AND NO DELETE, for `policy_acceptances`' reason: a consent that can be
-- edited is not a record of consent. The revokes state it as a privilege as well as
-- the absence of a policy states it as a rule, because they fail differently.
--
-- AND `app.guard_attendance_unlock()` IS NOT AN API. Revoked from anon, authenticated
-- and public like every other guard here, even though a trigger does not consult
-- EXECUTE when it fires — a function nobody should ever call by name should not be
-- callable by name.
-- ---------------------------------------------------------------------------

alter table public.attendance_unlocks enable row level security;

create policy attendance_unlocks_member_read on public.attendance_unlocks
  for select to authenticated
  using (app.is_member(coaching_center_id) or app.is_platform_admin());

create policy attendance_unlocks_staff_admin on public.attendance_unlocks
  for insert to authenticated
  with check (app.is_staff_admin(coaching_center_id));

create policy attendance_unlocks_teacher_write on public.attendance_unlocks
  for insert to authenticated
  with check (app.teaches_batch(batch_id));

revoke all on public.attendance_unlocks from anon, public;
revoke update, delete, truncate on public.attendance_unlocks from authenticated;
grant select, insert on public.attendance_unlocks to authenticated, service_role;

revoke all on function app.guard_attendance_unlock() from anon, authenticated, public;

-- `class_window` is called from inside the guards, which run as the caller, so
-- EXECUTE has to survive here where it is revoked on the guards themselves — a
-- trigger never consults EXECUTE, a function called from plpgsql does. It stays
-- invisible to the internet all the same: PostgREST exposes `public` and this is `app`.

revoke all on function app.class_window(uuid, date) from anon, public;
grant execute on function app.class_window(uuid, date) to authenticated, service_role;
grant execute on function app.attendance_grace_minutes() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. The centre's notification, permanently.
--
-- A signature is one of the acts §10's log exists for: it says a class was filed
-- outside its hours by a named person, which is a question an owner asks about money
-- and about a teacher's honesty. `attendance_records` is already on this list for the
-- override; this is the other half — not a mark changed, but a register written when
-- the room was empty.
--
-- The log line and the row are not two copies of one thing. The row is what the centre
-- reads on the screen; the log is what survives the batch being closed and the teacher
-- leaving, and what the owner's filter can be pointed at. That is the arrangement every
-- other audited table already has.
--
-- `src/lib/audit.ts` names this table as of this migration — check-migrations.mjs
-- fails the build if a trigger exists that the app cannot name.
-- ---------------------------------------------------------------------------

create trigger attendance_unlocks_audit
  after insert on public.attendance_unlocks
  for each row execute function app.log_audit_entry();
