-- CoachDesk BD — the last two teacher permissions that did nothing
--
-- `teacher_permissions.can_manage_students` and `can_manage_batches` are the
-- fourth and fifth checkboxes on the owner's teacher form. Like the three before
-- them they have been stored, defaulted and rendered since the init migration; no
-- policy mentioned either, and nothing in the app read them. `students` had one
-- write policy (`students_staff_admin_write`) and `batches` had one
-- (`batches_staff_admin_write`), both on app.is_staff_admin, and every screen that
-- could have used the grant asked `requireRole('manager')` — which a teacher, at
-- rank 20 against a manager's 30, never clears.
--
-- So an owner who ticked either box granted exactly nothing. Not a hole: a broken
-- promise, in copy that named real capabilities. That is worse in one specific way
-- — an owner who believes they have delegated admissions stops checking whether
-- admissions are happening.
--
-- This is the database half. The app half is `canManageStudents` and
-- `canManageBatches` in lib/auth/session, plus `requirePermission`, which the
-- three roster screens and the two batch screens now guard themselves with.
--
-- ---------------------------------------------------------------------------
-- Absent means no
-- ---------------------------------------------------------------------------
--
-- Both columns default false, so the helpers read like app.can_view_fees and not
-- like app.can_manage_exams: `exists` over a row with the column true, and no row
-- at all means no. That agrees with the column in both cases, which is the whole
-- rule — the owner's explicit tick or untick beats the default, and where there is
-- no tick the default speaks. `bootstrap_center` leaving an owner's own teacher row
-- without a permissions row costs nothing here, because an owner is staff-admin and
-- reaches all of this through the policies that were already there.
--
-- `app.is_member` is ANDed on for the same reason can_view_fees does it:
-- `teachers.active` is the off switch the staff screen flips, but an owner can also
-- revoke the center_members row, and either action has to be enough on its own.
--
-- ---------------------------------------------------------------------------
-- What is granted is what a screen can actually reach
-- ---------------------------------------------------------------------------
--
-- INSERT and SELECT. No UPDATE and no DELETE, on any table here, and that is a
-- decision rather than an oversight.
--
-- There is no edit-a-student screen and no edit-a-batch screen in this product —
-- not for a teacher, not for a manager, not for the owner. Granting UPDATE would
-- add a capability nothing can call, inside the boundary that decides whether this
-- business is safe to sell, and it would make this file the reason somebody later
-- believes editing is supported. DELETE is a stronger no: a student row cascades to
-- their attendance, their marks and their fee history, so removing one is the
-- owner's decision and the app expresses "gone" as `status`, never as a delete.
--
-- The copy on the teacher form moved to match, in the same commit. It used to
-- promise "Add & edit students / includes changing a guardian's mobile number" and
-- "Create & change batches / open a batch, move its time, enrol students into it".
-- It now says what the two boxes do: see the roster and admit students, open a
-- batch. When an edit screen is built, the policy grows with it.

create or replace function app.can_manage_students(center uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teacher_permissions tp
    join public.teachers t
      on t.id = tp.teacher_id
     and t.coaching_center_id = tp.coaching_center_id
    where t.user_id = auth.uid()
      and t.active
      and t.coaching_center_id = center
      and tp.can_manage_students
  )
  and app.is_member(center);
$$;

grant execute on function app.can_manage_students(uuid) to authenticated, service_role;

comment on function app.can_manage_students(uuid) is
  'True when the caller is an active teacher at `center` whose teacher_permissions '
  'row has can_manage_students. No row means no. Unlike every other teacher policy '
  'in this schema it is NOT paired with a batch or student scope: the grant is the '
  'whole centre roster, which is what admitting a student requires.';

create or replace function app.can_manage_batches(center uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teacher_permissions tp
    join public.teachers t
      on t.id = tp.teacher_id
     and t.coaching_center_id = tp.coaching_center_id
    where t.user_id = auth.uid()
      and t.active
      and t.coaching_center_id = center
      and tp.can_manage_batches
  )
  and app.is_member(center);
$$;

grant execute on function app.can_manage_batches(uuid) to authenticated, service_role;

comment on function app.can_manage_batches(uuid) is
  'True when the caller is an active teacher at `center` whose teacher_permissions '
  'row has can_manage_batches. No row means no. Grants opening a batch, which sets '
  'its monthly fee — a figure every member of the centre can already read.';

-- ---------------------------------------------------------------------------
-- students — and yes, this widens the sharpest edge in the schema
-- ---------------------------------------------------------------------------
--
-- 20260811000002 says of this table: "A teacher sees ONLY students enrolled in a
-- batch they are assigned to. Nobody else sees a minor's record." 20260811000012
-- then declined to widen it for a fee permission, in these words: "can_manage_students
-- is a separate checkbox an owner may well have left off; handing over every child's
-- guardian mobile number at the centre through a box labelled 'see fees' is not the
-- grant they think they are making."
--
-- This is that separate checkbox, and widening is the grant. A teacher handed
-- admissions cannot do the job through a keyhole: the roster screen is the list, and
-- the import deduplicates a pasted register against every name already on it — a
-- teacher who could only see their own batch would re-add half the centre. So the
-- read is centre-wide, it is off by default, and the hint under the checkbox now
-- says out loud that it includes the guardians' numbers.
--
-- SELECT is also load-bearing for the two INSERT paths, which is easy to miss:
-- `insert ... returning` needs read access to the new row, so createStudent's
-- `.select('id')` and import_students' `returning id` both fail on a with-check-only
-- grant. A refusal there looks like a broken form, not a missing policy.
--
-- And one correction, since it cannot be made where it was written: the header of
-- 20260811000009 says of import_students, "a teacher is refused by
-- students_staff_admin_write". That was true the day it was written and is now true
-- only of a teacher without this box ticked. The sentence around it still holds, and
-- is the reason that function is `security invoker` — it runs as the caller, so a
-- permitted teacher is allowed by the policy below and an unpermitted one is still
-- refused, without that function knowing either permission exists.

create policy students_roster_teacher_read on students
  for select to authenticated
  using (app.can_manage_students(coaching_center_id));

create policy students_roster_teacher_insert on students
  for insert to authenticated
  with check (app.can_manage_students(coaching_center_id));

-- ---------------------------------------------------------------------------
-- guardians — the parent phone numbers, same predicate
-- ---------------------------------------------------------------------------
--
-- createStudent writes one of these per student and import_students writes one per
-- new name, so INSERT is not optional if the box is to mean anything: a student
-- whose guardian row never arrived is a parent who never hears from the centre.
--
-- SELECT comes with it for the `returning` reason above, and it is a real widening
-- on top of `students`: the primary number is already on students.guardian_phone and
-- on the roster screen, but this table holds second guardians and the per-parent SMS
-- opt-out. Accepted, because it is the same grant to the same person for the same
-- job, and refusing it would leave the import failing on its last statement.

create policy guardians_roster_teacher_read on guardians
  for select to authenticated
  using (app.can_manage_students(coaching_center_id));

create policy guardians_roster_teacher_insert on guardians
  for insert to authenticated
  with check (app.can_manage_students(coaching_center_id));

-- ---------------------------------------------------------------------------
-- enrollments — admitting a student is choosing their batches
-- ---------------------------------------------------------------------------
--
-- Both admission paths write these: the form enrols into whatever batches were
-- ticked, and the import enrols every new name into the batches chosen for the
-- paste. Without INSERT the student lands with no batch, which is a row an owner has
-- to find and fix, and the teacher is told it worked.
--
-- SELECT because the roster screen embeds `enrollments (id, status, batches (name))`
-- to show which batches each student is in. Without it PostgREST returns an empty
-- array per row and the batch line silently disappears — the screen renders, so
-- nobody reads it as a permission problem.
--
-- Not scoped to batches the teacher teaches, deliberately. The admission form offers
-- every active batch in the centre, because a centre's admissions clerk enrols
-- students into other people's classes all day. That is the same reasoning as the
-- centre-wide read above, and it is the reason this permission is off by default.
--
-- No UPDATE: moving a student between batches, or ending an enrolment, is the
-- unenrol screen nobody has built. See the note at the top of this file.

create policy enrollments_roster_teacher_read on enrollments
  for select to authenticated
  using (app.can_manage_students(coaching_center_id));

create policy enrollments_roster_teacher_insert on enrollments
  for insert to authenticated
  with check (app.can_manage_students(coaching_center_id));

-- ---------------------------------------------------------------------------
-- batches and batch_schedules — the other box, and only INSERT
-- ---------------------------------------------------------------------------
--
-- No read policy for either, because `batches_member_read` and
-- `batch_schedules_member_read` already let every member of a centre read every
-- batch in it. That is what makes this the cheaper of the two permissions: it adds
-- the ability to create, and nothing to what the teacher can see.
--
-- batch_schedules travels with it. createBatch writes one row per day the batch
-- meets, in the same submit, and a batch created without them is a batch that meets
-- every day — which is what the register would then show a teacher standing in front
-- of an empty room.
--
-- Both are `with check` only, so an insert naming another centre raises instead of
-- being filtered away. The composite foreign keys from 20260811000005 already stop a
-- batch from borrowing another centre's subject or teacher.

create policy batches_roster_teacher_insert on batches
  for insert to authenticated
  with check (app.can_manage_batches(coaching_center_id));

create policy batch_schedules_roster_teacher_insert on batch_schedules
  for insert to authenticated
  with check (app.can_manage_batches(coaching_center_id));
