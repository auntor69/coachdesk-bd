-- CoachDesk BD — loading a centre's register in one go.
--
-- The way a coaching centre becomes a customer is that somebody sits down with
-- their register — a notebook, or an Excel sheet a nephew made — and puts it in
-- the software. §4 of the masterplan is blunt about who: we do it, by hand,
-- before the owner ever logs in, because an empty account is homework and
-- homework dies in a drawer. Two hundred students through a one-at-a-time form
-- is an evening of typing, and it is an evening per centre.
--
-- So: one call that takes a parsed register and lands all of it.
--
-- WHY THIS IS A DATABASE FUNCTION and not three supabase-js inserts, which is
-- how every other write in this app is done:
--
-- 1. A student without their guardian row is a student whose parent hears
--    nothing. planResultSms falls back to students.guardian_phone, so it
--    degrades rather than breaks — but the guardian row is where the per-parent
--    SMS opt-out lives, and half a register missing it is a silent hole. Three
--    round trips can stop after the first one; one statement cannot.
-- 2. Teachers do this on mid-range Android on patchy data. Four requests is four
--    chances to lose the connection, and a retry after a partial import creates
--    the duplicates this function exists to skip.
-- 3. The "is this student already here?" test has to happen inside the same
--    transaction as the insert, or two taps of the button race each other and
--    the roster gets every name twice.
--
-- Deliberately NOT security definer. It runs as the caller, so every insert is
-- checked by the same policies as a hand-typed one: a teacher is refused by
-- students_staff_admin_write, and an owner cannot name another centre's id
-- because that policy's `with check` raises rather than filters. A definer
-- function here would be a hole straight through the tenant boundary, wearing
-- the name of a convenience.

create function public.import_students(
  p_center_id uuid,
  p_students  jsonb,
  p_batch_ids uuid[] default '{}'::uuid[]
)
returns table (added integer, already_there integer, enrolled integer)
language sql
security invoker
set search_path = ''
as $$
  with input as (
    -- with ordinality, so "the first spelling of this name wins" means the one
    -- highest up the register rather than whichever row Postgres reached first.
    select
      e.ord,
      nullif(btrim(e.item ->> 'name'), '')           as name,
      nullif(btrim(e.item ->> 'guardian_phone'), '') as phone,
      nullif(btrim(e.item ->> 'guardian_name'), '')  as guardian_name
    from jsonb_array_elements(p_students) with ordinality as e(item, ord)
  ),
  keyed as (
    select
      ord,
      regexp_replace(name, '\s+', ' ', 'g') as name,
      phone,
      guardian_name,
      -- The identity of a student, for the purpose of "do we have them already".
      --
      -- Name plus guardian number, and it has to be both: siblings share a
      -- parent's phone, which is completely ordinary and must not collapse into
      -- one row, while two unrelated boys called রাফিদ হাসান are ordinary too.
      -- lower() because a Latin-script name gets typed both ways and Bangla is
      -- caseless, so it costs nothing and catches "Rafid" against "rafid".
      lower(regexp_replace(name, '\s+', ' ', 'g')) as name_key
    from input
    -- A row missing either half is dropped rather than half-inserted. The caller
    -- has already shown these to the owner as problem lines; this is the floor.
    where name is not null and phone is not null
  ),
  deduped as (
    select distinct on (name_key, phone) *
    from keyed
    order by name_key, phone, ord
  ),
  fresh as (
    select d.*
    from deduped d
    where not exists (
      select 1
      from public.students s
      where s.coaching_center_id = p_center_id
        and s.guardian_phone = d.phone
        and lower(regexp_replace(s.name, '\s+', ' ', 'g')) = d.name_key
    )
  ),
  new_students as (
    insert into public.students
      (coaching_center_id, name, guardian_name, guardian_phone)
    select p_center_id, f.name, f.guardian_name, f.phone
    from fresh f
    returning id, name, guardian_name, guardian_phone
  ),
  new_guardians as (
    -- is_primary true because this is the number the register was keeping, and
    -- result-dispatch picks the primary. A second guardian gets added later, by
    -- hand, by someone who knows which one the parent prefers.
    insert into public.guardians
      (coaching_center_id, student_id, name, phone, is_primary)
    select p_center_id, ns.id, ns.guardian_name, ns.guardian_phone, true
    from new_students ns
    returning id
  ),
  new_enrollments as (
    -- The batch carries the subject, exactly as createStudent does it: choosing
    -- a subject separately is how a student ends up enrolled in the maths batch
    -- under physics, and then missing from the marks sheet.
    --
    -- coaching_center_id on the join is not redundant with RLS. An owner of two
    -- centres passes is_staff_admin for both, so the policy alone would happily
    -- enrol this centre's new students into the other one's batch.
    insert into public.enrollments
      (coaching_center_id, student_id, subject_id, batch_id)
    select p_center_id, ns.id, b.subject_id, b.id
    from new_students ns
    join public.batches b
      on b.id = any(p_batch_ids)
     and b.coaching_center_id = p_center_id
    returning id
  )
  select
    (select count(*) from new_students)::integer   as added,
    -- Already on the roster, so not touched. Reported rather than swallowed: an
    -- owner who pasted the same register twice needs to see that the second
    -- paste did nothing, or they will go looking for the missing hundred.
    ((select count(*) from deduped) - (select count(*) from fresh))::integer
      as already_there,
    (select count(*) from new_enrollments)::integer as enrolled;
$$;

comment on function public.import_students(uuid, jsonb, uuid[]) is
  'Bulk-loads a parsed register: students, their primary guardian, and their '
  'enrollments, in one transaction. Skips names already on the roster (matched '
  'on name + guardian phone). Runs as the caller, so RLS decides.';

-- PostgREST exposes every function in `public`, and Postgres grants EXECUTE to
-- PUBLIC by default — which would put this on the anon endpoint. It would refuse
-- to insert anything, RLS being what it is, but an endpoint that exists to write
-- rows has no business being reachable without a session.
revoke all on function public.import_students(uuid, jsonb, uuid[]) from public;
grant execute on function public.import_students(uuid, jsonb, uuid[])
  to authenticated;
