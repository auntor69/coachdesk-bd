-- Who moved this child, and when.
--
-- MASTERPLAN.md §7.2, on moving a student between branches of one institution: "one
-- row, `branch_id` updated, and a transfer history record saying which branch, which
-- direction, when, and who did it. The history is auditable because the first
-- question after a transfer goes wrong is always *who moved this child*."
--
-- That section spends most of its length on what not to do — copy the student to the
-- new branch and delete the old row — because it is the obvious implementation and it
-- destroys the thing the family argues with. The attendance, the marks, the invoices
-- and the payments all point at the old id, so a recreated student has no history and
-- their fee record silently becomes somebody else's. The `branch_id` write is what
-- keeps identity; this table is what keeps the story.
--
-- WRITTEN BY A TRIGGER, NOT BY THE APP, and that is the whole design. A history the
-- application writes is a history the next code path forgets: one screen moves a
-- student and logs it, a bulk reassignment does not, and the gap is invisible until
-- somebody needs the row that was never written. 20260811000003 makes the same
-- argument for profiles — "a trigger cannot be skipped" — and it is stronger here,
-- because the missing record is the record of an act somebody may want hidden.
--
-- So the browser cannot write this table at all: no insert, update or delete policy,
-- and the privileges revoked besides. Every row is a side effect of a `branch_id`
-- write that already had to pass the student's own policies.
--
-- DORMANT ON PURPOSE ON THE DAY THIS LANDED, and no longer dormant. Nothing in the app
-- wrote `students.branch_id` when this was written — branch management is §16's step 13 —
-- so the trigger could not fire until the screen that moves a student existed. It was
-- written first because §16's step 2 is "one migration wave, so the app is never
-- half-shaped": the table that records a move should not arrive in the same commit that
-- first performs one, or the first thing anybody tests is a feature whose audit trail is
-- a day old. The writer now exists — `updateStudent` in `src/app/(app)/settings/actions.ts`
-- writes `branch_id`, and the student's own screen reads this table back.

create table student_transfers (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  student_id   uuid not null,

  -- The two ends of the move, each kept twice: the id for joining while the branch
  -- still exists, the name for reading after it does not.
  --
  -- NO FOREIGN KEY ON EITHER ID, which is a deliberate exception to the composite
  -- rule 20260811000005 established, and safe here for a reason that does not
  -- generalise. A branch with students cannot be deleted otherwise: deleting one
  -- fires the ON DELETE SET NULL that 20260811000005 put on `students.branch_id`,
  -- that update fires the trigger below, and the row it writes would reference a
  -- branch Postgres has just removed — so the delete fails and a centre can never
  -- close a branch it once used. Tenancy is not lost by dropping the constraint: the
  -- only writer is the trigger, which copies `students.branch_id`, and that column
  -- does carry a composite key to this centre's own branches. A snapshot of a
  -- verified value cannot name another tenant's row.
  from_branch_id   uuid,
  from_branch_name text,
  to_branch_id     uuid,
  to_branch_name   text,

  moved_by     uuid references auth.users (id) on delete set null,

  -- The row is written by a trigger at the instant of the move, so when it was
  -- created is when the move happened. No second timestamp to disagree with it.
  created_at   timestamptz not null default now(),

  -- Composite, per 20260811000005 and enforced by check-migrations.mjs: a history
  -- row cannot cite another centre's student while passing its own RLS check.
  -- Cascading, like every other child of a student — a deleted student takes their
  -- record with them, the same trade absence_notices and result_notices make.
  constraint student_transfers_student_id_center_fkey
    foreign key (student_id, coaching_center_id)
    references students (id, coaching_center_id) on delete cascade,

  -- A move has to go somewhere. `is distinct from` rather than `<>` so that a row
  -- claiming a student went from no branch to no branch is refused too.
  constraint student_transfers_moved
    check (from_branch_id is distinct from to_branch_id)
);

-- One student's history, newest first, which is the question a family's file asks.
create index student_transfers_student_idx
  on student_transfers (student_id, created_at desc);

-- And the centre-wide list, for the audit reading of §7.2: what has been moved
-- lately, by whom.
create index student_transfers_center_idx
  on student_transfers (coaching_center_id, created_at desc);

comment on table student_transfers is
  'MASTERPLAN.md §7.2 — one row per branch move of a student, written by a trigger '
  'on students.branch_id and unwritable from a browser. Branch names are frozen on '
  'the row so the record still reads after a branch is renamed or closed.';

alter table student_transfers enable row level security;

-- ---------------------------------------------------------------------------
-- Readable by whoever runs the place, and by nobody else.
--
-- Owners and managers, through the same `is_staff_admin` every other administrative
-- table uses. Not teachers: §6.5 limits a teacher to the students in the batches
-- they are assigned, and a transfer log is the one shape of roster data where even
-- their own students' rows would be revealing — it says which branch a child came
-- from and who signed off on the move, which is management's business and sometimes
-- a complaint about a colleague.
--
-- SELECT only. There is no insert policy, no update policy and no delete policy,
-- because the only legitimate writer is the trigger below and it runs as the owner.
-- The revoke is belt and braces for the day somebody pastes a `grant all on all
-- tables in schema public to authenticated` out of a setup snippet — the same
-- reasoning 20260811000036 gives for extending the billing guard.
-- ---------------------------------------------------------------------------

create policy student_transfers_staff_admin_read on student_transfers
  for select to authenticated
  using (app.is_staff_admin(coaching_center_id));

revoke insert, update, delete, truncate on student_transfers
  from authenticated, anon;

-- ---------------------------------------------------------------------------
-- The trigger that writes it.
--
-- SECURITY DEFINER, which is the only way a row can land in a table the caller has
-- no INSERT privilege on. That is not a hole: it takes no argument, reads nothing the
-- caller supplied, and copies two values off a row that has already passed the
-- student policies. There is nothing here to aim.
--
-- `auth.uid()` still answers correctly under SECURITY DEFINER — it reads the request's
-- JWT claim out of a transaction-local setting, not the current role, which is why
-- bootstrap_center can rely on it too. Null for a migration or a founder working in
-- the SQL editor, and null is the honest answer there.
--
-- Branch names are read from `branches` as the move happens, so a real transfer
-- freezes both. One case cannot: when a branch is deleted, the ON DELETE SET NULL on
-- `students.branch_id` fires this trigger after the branch row is already gone, so
-- `from_branch_name` comes back null and only the id survives. That is a worse record
-- than a real transfer leaves, and it is still the truthful one — the row says this
-- student stopped being at a branch, on this date, and the branch it names no longer
-- exists. Closing a branch properly means moving its students first, which is what
-- the screens in §16's step 13 should make the easy path.
-- ---------------------------------------------------------------------------

create or replace function app.log_student_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- `is not distinct from`, so a student edited for any other reason writes nothing,
  -- and so a move from no branch into one is still recorded as a move.
  if new.branch_id is not distinct from old.branch_id then
    return null;
  end if;

  insert into public.student_transfers (
    coaching_center_id,
    student_id,
    from_branch_id,
    from_branch_name,
    to_branch_id,
    to_branch_name,
    moved_by
  )
  values (
    new.coaching_center_id,
    new.id,
    old.branch_id,
    (select b.name from public.branches b where b.id = old.branch_id),
    new.branch_id,
    (select b.name from public.branches b where b.id = new.branch_id),
    auth.uid()
  );

  -- AFTER trigger: the return value is discarded, and null says so plainly.
  return null;
end;
$$;

drop trigger if exists students_log_transfer on public.students;

-- AFTER, not BEFORE: the history should record a move that actually happened, so it
-- is written once the row has survived the capacity guard and its own policies.
-- OF branch_id, so a phone correction or a status change does not even enter the
-- function.
create trigger students_log_transfer
  after update of branch_id on public.students
  for each row execute function app.log_student_transfer();

revoke all on function app.log_student_transfer() from public, anon;
