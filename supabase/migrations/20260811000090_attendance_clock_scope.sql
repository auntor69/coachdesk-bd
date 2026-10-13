-- ---------------------------------------------------------------------------
-- CoachDesk BD — the clock gate belongs to the plans that have colleagues, and a
-- solo teacher takes attendance when they want (the owner's rule, 2026-10-09).
-- ---------------------------------------------------------------------------
--
-- WHAT 20260811000089 BUILT, AND WHO IT WAS ASKED FOR. That migration put every
-- timetable class on the clock: locked before it started, counted as cancelled
-- after it ended with nothing filed, each lifted by a signature the centre can
-- read. That was the owner of a *centre* asking — several teachers, registers
-- filed by people other than the person asking for them — and the rule reads the
-- same way for a Centre tier and an Institution tier.
--
-- THE TWO TEACHER TIERS ARE A DIFFERENT SHAPE OF BUSINESS. Teacher (Free) and
-- Teacher Pro are one person: `maxTeachers` is 1 and `staffManagement` is false,
-- so there is no colleague to hold the register and nobody looking over the
-- shoulder who is not the same person holding the phone. On that plan a
-- signature would be a teacher signing for themselves, the notification would be
-- the app telling them what they just did, and "Counted as cancelled" would be
-- the product scolding its only user for teaching an evening class against a
-- morning timetable. The owner's rule, in their words from the same request that
-- produced the gate: the centre and institution model needs it — a solo teacher
-- can do it when he wants.
--
-- ONE FUNCTION HOLDS THE RULE. `app.clock_enforced(center)` is asked by both
-- guards below, so they cannot drift apart, and it is mirrored by
-- `clockEnforced(plan)` in src/lib/attendance/clock.ts — the four call sites that
-- draw the signature card and refuse the save ask that one. attendance-clock.test.ts
-- holds the two lists to each other, the same way capacity.test.ts holds a
-- migration and a TypeScript ceiling to one string.
--
-- THE PLAN IS READ FROM THE ROW AT WRITE TIME, never cached: a centre upgraded
-- mid-morning is on the clock from its next write, and a centre moved down
-- mid-evening is off it from its next write. SECURITY DEFINER because the answer
-- is a fact about whose rows these are and must not depend on a policy that could
-- hide it; `search_path` pinned and the table named in full, and execute is
-- granted only where the guards can be reached from.
--
-- WHAT DOES NOT MOVE, AND IS STATED BECAUSE IT IS HALF THE POINT. The day rules
-- of 20260811000031 stand on every plan: a register for a day that has not
-- arrived is still refused, a register is still one batch's one day, corrections
-- still cost what §6.3 charges, and a signature still has to be for today (a
-- day rule, so it stays universal below). What is scoped here is the *hour* —
-- before class, after class, and the two signatures that lift those — and with
-- it the screens that draw them: on a solo plan no card is drawn, no chip says
-- "Opens 4:00 pm", and no day is counted cancelled.
-- ---------------------------------------------------------------------------

create or replace function app.clock_enforced(p_center uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select c.plan in ('center', 'institution')
      from public.coaching_centers c
      where c.id = p_center
    ),
    false
  )
$$;

comment on function app.clock_enforced(p_center uuid) is
  'Whether this centre''s plan enforces the clock gate (20260811000090). Centre and '
  'Institution are on the clock; Teacher (Free) and Teacher Pro are not, because a '
  'solo teacher answers to nobody and the signature exists so a centre can see who '
  'filed outside class time. False for a centre that cannot be read — no gate is the '
  'fail-open direction every window read in this product already takes. Mirrored by '
  'clockEnforced(plan) in src/lib/attendance/clock.ts.';

-- EXECUTE follows the same shape as `class_window`'s in 20260811000089: the guards
-- run as the caller, so a function they call from plpgsql needs EXECUTE to survive
-- there — and PostgREST exposes `public`, while this is `app`.

revoke all on function app.clock_enforced(uuid) from anon, public;
grant execute on function app.clock_enforced(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The signature guard, re-emitted whole with one change: on a plan without the
-- gate there is nothing to sign for, and the refusal says exactly that. Everything
-- else stands — nobody signs anonymously, a signature is for today (a day rule,
-- kept on every plan), and the window it records is stamped from the batch's own
-- timetable rather than accepted from the form.
--
-- A trigger function has no smaller unit than itself, so this is a full re-emit
-- rather than a patch — the same reason 20260811000089 re-emitted its parent.
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
    -- `format` rather than a raise with adjacent literals: Postgres parses a raise's
    -- first string as the format and the next one as a parameter, so a wrapped
    -- literal becomes "too many parameters specified for RAISE". Inside format's
    -- parentheses they are ordinary strings and concatenate.
    raise exception using
      message = format(
        'a signature cannot be given for %s, which has not arrived yet in Dhaka; '
        'a class that has not happened has nothing to unlock',
        new.session_date
      ),
      errcode = '23514';
  end if;

  if new.session_date < dhaka_today then
    raise exception using
      message = format(
        'the clock gate is about today''s class, and %s is not today in Dhaka; '
        'an earlier register is a correction and not a lock to be lifted',
        new.session_date
      ),
      errcode = '23514';
  end if;

  -- 20260811000090: no gate on this plan, so nothing to lift. The card that posts a
  -- signature does not draw on Teacher (Free) or Teacher Pro, so a row here would be
  -- a record of a rule that never applied — and if one is posted by hand anyway, the
  -- honest answer is the same one the save gets: the register is open, take it.
  if not app.clock_enforced(new.coaching_center_id) then
    raise exception using
      message = format(
        'this centre''s plan has no clock gate, so there is nothing to sign for; '
        'the register is open — take it'
      ),
      errcode = '23514';
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
      raise exception using
        message = format(
          'this class has already started, so there is nothing early about this '
          'register and no early signature to give; take it'
        ),
        errcode = '23514';
    end if;
    return new;
  end if;

  -- 'forgot': the class has to be over, by the same grace the register itself is
  -- measured with. Both tests matter — a window with no end cannot be late, and a
  -- class still running has a register to take.
  if win_end is null or dhaka_now <= win_end + grace then
    raise exception using
      message = format(
        'this class has not finished yet, so a register filed now is not late; '
        'take it while the room is full'
      ),
      errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function app.guard_attendance_unlock() is
  'Keeps a signature honest: anonymous sessions cannot give one, a signature is for '
  'today (a day rule, every plan), its reason has to match the clock, and its signer '
  'and moment are stamped by the database. On a plan without the clock gate '
  '(app.clock_enforced) there is nothing to sign for and it is refused by name.';

drop trigger if exists attendance_unlocks_guard on public.attendance_unlocks;

create trigger attendance_unlocks_guard
  before insert on public.attendance_unlocks
  for each row execute function app.guard_attendance_unlock();

-- ---------------------------------------------------------------------------
-- The register guard, re-emitted whole with one change: the clock block asks
-- `app.clock_enforced` before it refuses anything. Every other rule stands on
-- every plan and is unchanged — no register for a day that has not arrived, one
-- batch's one day frozen for the register's life, no delete from a browser
-- session, the server role outside it all. The clock block remains insert-only:
-- a correction is §6.3's business and never was this one's.
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
      raise exception using
        message = format(
          'the register for %s cannot be deleted by %s; a class that was held stays on '
          'the record, and a mark that was wrong is corrected instead',
          old.session_date, current_user
        ),
        errcode = '42501';
    end if;
    return old;
  end if;

  if not server_role
     and new.session_date > dhaka_today
  then
    raise exception using
      message = format(
        'attendance cannot be taken for %s, which has not arrived yet in Dhaka; '
        'a class that has not happened has nobody in it',
        new.session_date
      ),
      errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and not server_role
     and (new.id is distinct from old.id
          or new.coaching_center_id is distinct from old.coaching_center_id
          or new.batch_id is distinct from old.batch_id
          or new.session_date is distinct from old.session_date
          or new.created_at is distinct from old.created_at)
  then
    raise exception using
      message = format(
        'a register belongs to one batch on one day and cannot be moved by %s; '
        'take the right one instead',
        current_user
      ),
      errcode = '42501';
  end if;

  -- The clock, on the first writing of the day's register and on nothing else — and
  -- only where the plan has the gate at all (20260811000090). A teacher on Teacher
  -- (Free) or Teacher Pro files at whatever hour they taught; a centre's register for
  -- a class that has not started is still the fiction the owner asked to refuse.
  if tg_op = 'INSERT' and not server_role
     and new.session_date = dhaka_today
     and app.clock_enforced(new.coaching_center_id)
  then
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
        raise exception using
          message = format(
            'this class has not started yet: it begins at %s, and it is %s in Dhaka. '
            'A register for a class nobody has taught is not a register — if the '
            'class is genuinely being taken early, sign that on the register and the '
            'centre will be told',
            to_char(win_start, 'HH24:MI'), to_char(dhaka_now, 'HH24:MI')
          ),
          errcode = '23514';
      end if;

    elsif win_end is not null and dhaka_now > win_end + grace then
      if not exists (
        select 1 from public.attendance_unlocks u
        where u.batch_id = new.batch_id
          and u.session_date = new.session_date
          and u.reason = 'forgot'
      ) then
        raise exception using
          message = format(
            'the class ended at %s, and a register filed now counts as a cancelled '
            'class. If the class was held and this is the register for it, sign that '
            'on the register and the centre will be told',
            to_char(win_end, 'HH24:MI'), to_char(dhaka_now, 'HH24:MI')
          ),
          errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function app.guard_attendance_session() is
  'Keeps a register to the class it records. Refuses attendance for a date that has '
  'not arrived yet in Dhaka (every plan), refuses a first register taken before its '
  'class started or after it ended — each unless a signed attendance_unlocks row says '
  'otherwise — but only on plans where the clock gate exists (app.clock_enforced: '
  'Centre and Institution; the two teacher tiers file when they want), refuses '
  'moving a register to another batch or another day once it exists, and refuses '
  'deleting one from a browser session. The server role is exempt so a support '
  'session can repair a date somebody typed wrong.';

-- The trigger itself is unchanged — 20260811000031 created it and it still points
-- at the function above. Re-created anyway so this migration can be read as the
-- whole truth about what guards a register without opening the older files.
drop trigger if exists attendance_sessions_guard on public.attendance_sessions;

create trigger attendance_sessions_guard
  before insert or update or delete on public.attendance_sessions
  for each row execute function app.guard_attendance_session();
