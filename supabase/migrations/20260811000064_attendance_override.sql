-- CoachDesk BD — a corrected mark says who called it and who changed it.
--
-- §6.3 asks for one thing this table cannot answer today: "Manager edits a record —
-- allowed, and recorded as an override, with who and when." 20260811000031 already
-- counts corrections and signs the last one, and that is precisely the problem. On a
-- correction `marked_by` moves to whoever made it, so the teacher who took the register
-- is gone: a row that said "Rahim marked this boy absent" becomes, after a manager's
-- edit, a row that says the manager did. The single fact §6.3 wants recorded is the one
-- the existing stamp erases.
--
-- WHAT IS ADDED, and why it is the caller rather than the corrector. `called_by` and
-- `called_at` hold the first writer and are frozen for ever; `marked_by` and `marked_at`
-- keep the meaning 20260811000031 gave them, which is the latest writer. An override is
-- then a comparison instead of a fourth column — `revision > 0 and marked_by is distinct
-- from called_by` — and every row that already exists keeps meaning what it meant.
-- Freezing `marked_by` and adding `corrected_by` would have stored the same two names
-- while contradicting that migration's own comment about what `marked_by` answers.
--
-- WHOEVER IS NOT THE CALLER, and not whoever is a manager. A teacher moving their own
-- mark from present to late is the correction the owner asked for and is not an override;
-- the same edit made to somebody else's register is. Neither test reads a role — §6.2
-- forbids that anyway — because the rule was never about rank. It is about the two names
-- on the row.
--
-- NO POLICY CHANGES HERE, deliberately. §6.3: "The manager's access is not removed. An
-- override that is impossible is an override a centre works around by sharing the
-- teacher's password, and then nobody knows who marked what. Better that it exists, is
-- logged, and is visibly not the default."

-- ---------------------------------------------------------------------------
-- 1. Who called it.
--
-- Nullable, and that is the honest shape rather than a missing `not null`. The backfill
-- below can name the caller of every mark that has never been corrected, because for
-- those two rows `marked_*` IS the call. A row already sitting at revision 1 was
-- corrected before this column existed and its original caller was never written down
-- anywhere — so `revision > 0 and called_by is null` reads as exactly that, and filling
-- it from `marked_by` would print the corrector's name as the person who took the
-- register.
--
-- `on delete set null` mirrors `marked_by`: a centre closing a login does not unmake the
-- register it took.
-- ---------------------------------------------------------------------------

alter table public.attendance_records
  add column if not exists called_by uuid references auth.users (id) on delete set null,
  add column if not exists called_at timestamptz;

update public.attendance_records
   set called_by = marked_by,
       called_at = marked_at
 where revision = 0
   and called_at is null;

comment on column public.attendance_records.called_by is
  'Who first wrote this mark, frozen at the insert and unchangeable afterwards by any '
  'browser session — including the one correcting it. Compare with marked_by, which is '
  'the latest writer: the two differ exactly when somebody other than the teacher who '
  'took the register changed the mark, which is the override §6.3 asks to be recorded. '
  'Null on a mark that was already corrected before this column existed.';

comment on column public.attendance_records.called_at is
  'When this mark was first written, frozen like called_by. marked_at moves to the '
  'correction; this stays on the register, so a fix made five minutes later and one made '
  'two weeks later are told apart.';

-- ---------------------------------------------------------------------------
-- 2. The guard, with the new pair stamped and then frozen.
--
-- The trigger itself is untouched — 20260811000031 created it and only this body has
-- moved. Two additions to it, both in the shape everything else here is already in:
-- stamped on the insert and never accepted from a client, and restored rather than
-- refused on an update, because the offline replay re-sends whole rows and a save that
-- carries an unchanged value has not asked for anything.
--
-- The restore sits ahead of the status branch on purpose, so it holds on every update
-- and not only on a correction. Who took the register is the fact an override is
-- measured against, which makes the corrector the one writer who must not be able to
-- move it.
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
  -- was given, so an import can carry the hour a register was actually taken — and a
  -- support insert that names `marked_by` and leaves `called_by` empty is describing a
  -- mark whose first writer it does not know, which is a thing worth being able to say.
  if tg_op = 'INSERT' then
    if not server_role then
      new.revision := 0;
      new.marked_at := now();
      new.marked_by := auth.uid();
      -- The same two values on the way in. They part company at the first correction,
      -- and that parting is the whole of what an override is.
      new.called_at := new.marked_at;
      new.called_by := new.marked_by;
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

  if not server_role then
    new.called_at := old.called_at;
    new.called_by := old.called_by;
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

comment on function app.guard_attendance_mark() is
  'The one correction, and the two names it is measured by. A mark is inserted at '
  'revision 0, signed and dated by the trigger rather than by the client, and its '
  'called_by/called_at are set to that same signature and frozen. A status change '
  'stamps revision, marked_at and marked_by again — so marked_by is the latest writer '
  'and called_by is still the teacher who took the register, and the two differing is '
  'the override §6.3 asks to be recorded. Re-saving the same status costs nothing, '
  'which is what makes the offline replay safe, and a mark cannot be moved to another '
  'student or deleted to buy a second try.';

-- ---------------------------------------------------------------------------
-- 3. Finding them.
--
-- "What has been corrected here lately" is the review screen's whole query, and without
-- this it is a scan of every mark the centre has ever taken. Partial on `revision > 0`,
-- which is a fraction of a percent of the table — corrections are rare and each mark
-- may only have one.
--
-- Both kinds of correction, not just overrides. A teacher fixing their own register is
-- the sanctioned act and still worth a manager being able to see.
-- ---------------------------------------------------------------------------

create index if not exists attendance_records_corrected_idx
  on public.attendance_records (coaching_center_id, marked_at desc)
  where revision > 0;

-- ---------------------------------------------------------------------------
-- 4. The log line §10 has been waiting for.
--
-- 20260811000046 left attendance out and said why: "there is no override marker to log
-- until §16's step 10 adds one, and a trigger on `attendance_records` today would log
-- every student on every day — the one shape of noise that makes a log go unread." The
-- marker now exists, so the trigger can be attached with the noise excluded by the
-- condition rather than by leaving the table out.
--
-- WHAT THE WHEN CLAUSE BUYS. `after update` alone would already drop every insert, which
-- is the six thousand rows a month a three-hundred-student centre writes. The two tests
-- narrow it further to the line §10 actually asks for: a changed status, by somebody who
-- is not the teacher who called it. A teacher correcting their own mark is recorded on
-- the row itself — revision, marked_at — and not here, which keeps this log readable as
-- what it is, a list of overrides.
--
-- Evaluated after the guard above has run, so `new.marked_by` is the stamp and not
-- whatever the client sent. That also puts the server role mostly outside this: a support
-- session repairing a status leaves `marked_by` alone, so on a mark whose caller is known
-- the two names still agree and no line is written — it is straightening out a record
-- rather than overruling a colleague, and the request that asked for it is the trail. On
-- a mark imported without a caller the comparison is against null and a line is written,
-- which is the safe direction for the one table this log is about children in.
-- ---------------------------------------------------------------------------

drop trigger if exists attendance_records_audit on public.attendance_records;

create trigger attendance_records_audit
  after update on public.attendance_records
  for each row
  when (new.status is distinct from old.status
        and new.marked_by is distinct from new.called_by)
  execute function app.log_audit_entry();
