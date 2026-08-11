-- CoachDesk BD — row-level security
--
-- Tenant isolation lives here. A center must never read another center's rows,
-- and a teacher must never read a colleague's students. This is the one bug
-- class that would end the business, so the rules are enforced in the database
-- rather than in the UI.
--
-- Helper functions are SECURITY DEFINER on purpose: a policy on center_members
-- that queries center_members would recurse forever. These run as the owner,
-- bypass RLS, and are the only place that is allowed to.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------

create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- Centers the signed-in user belongs to, in any active role.
create or replace function app.member_center_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.coaching_center_id
  from public.center_members m
  where m.user_id = auth.uid() and m.active;
$$;

create or replace function app.is_member(center uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.center_members m
    where m.user_id = auth.uid()
      and m.active
      and m.coaching_center_id = center
  );
$$;

-- True when the user holds any of `roles` at `center`.
create or replace function app.has_role(center uuid, roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.center_members m
    where m.user_id = auth.uid()
      and m.active
      and m.coaching_center_id = center
      and m.role = any(roles)
  );
$$;

-- Owner or manager: the two roles that administer a center.
create or replace function app.is_staff_admin(center uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_role(center, array['owner', 'manager']::public.member_role[]);
$$;

create or replace function app.is_owner(center uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_role(center, array['owner']::public.member_role[]);
$$;

-- ---------------------------------------------------------------------------
-- Scope helpers — what a teacher, student, or guardian may reach
-- ---------------------------------------------------------------------------

-- teachers rows belonging to the signed-in user (one per center they work at).
create or replace function app.my_teacher_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id from public.teachers t
  where t.user_id = auth.uid() and t.active;
$$;

-- Batches the signed-in teacher is assigned to. The spine of teacher scoping.
create or replace function app.my_batch_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id from public.batches b
  where b.teacher_id in (select app.my_teacher_ids());
$$;

create or replace function app.teaches_batch(batch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select batch in (select app.my_batch_ids());
$$;

-- Students the signed-in user may see as a student (self) or guardian (child).
create or replace function app.my_student_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.students s where s.user_id = auth.uid()
  union
  select g.student_id from public.guardians g where g.user_id = auth.uid();
$$;

-- Students in the signed-in teacher's batches.
create or replace function app.my_taught_student_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct e.student_id
  from public.enrollments e
  where e.batch_id in (select app.my_batch_ids());
$$;

grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. Deny-by-default: a table with RLS on and no matching
-- policy returns zero rows, so forgetting a policy fails closed, not open.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- profiles — a user reads and edits only their own.
-- ---------------------------------------------------------------------------

create policy profiles_self_read on profiles
  for select to authenticated
  using (id = auth.uid() or app.is_platform_admin());

create policy profiles_self_insert on profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_self_update on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- coaching_centers — members read their own; only the owner edits.
-- Any signed-in user may create a center (that is the signup path), and the
-- trigger below immediately makes them its owner.
-- ---------------------------------------------------------------------------

create policy centers_member_read on coaching_centers
  for select to authenticated
  using (id in (select app.member_center_ids()) or app.is_platform_admin());

create policy centers_create on coaching_centers
  for insert to authenticated
  with check (created_by = auth.uid());

create policy centers_owner_update on coaching_centers
  for update to authenticated
  using (app.is_owner(id))
  with check (app.is_owner(id));

-- Whoever creates a center becomes its owner in the same transaction, so a
-- center can never exist with nobody able to administer it.
--
-- Falls back to created_by because auth.uid() is NULL when the insert comes
-- from the service-role client (our signup path) rather than a browser session.
create or replace function app.claim_new_center()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimant uuid := coalesce(auth.uid(), new.created_by);
begin
  if claimant is null then
    return new;
  end if;

  insert into public.center_members (coaching_center_id, user_id, role)
  values (new.id, claimant, 'owner')
  on conflict do nothing;

  return new;
end;
$$;

create trigger coaching_centers_claim_owner
  after insert on coaching_centers
  for each row execute function app.claim_new_center();

-- ---------------------------------------------------------------------------
-- center_members — every user sees their own memberships; staff admins see
-- and manage the whole roster for their center.
-- ---------------------------------------------------------------------------

create policy members_read on center_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or app.is_staff_admin(coaching_center_id)
    or app.is_platform_admin()
  );

create policy members_admin_write on center_members
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

-- ---------------------------------------------------------------------------
-- Teachers & permissions
-- ---------------------------------------------------------------------------

create policy teachers_member_read on teachers
  for select to authenticated
  using (
    coaching_center_id in (select app.member_center_ids())
    or app.is_platform_admin()
  );

create policy teachers_staff_admin_write on teachers
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

-- A teacher updates their own row (e.g. their phone); they never create one.
create policy teachers_self_update on teachers
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy teacher_permissions_staff_admin on teacher_permissions
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

-- Teacher permissions are a checkbox set owned by the center; teachers read
-- their own row through the parent teacher, and managers read all rows.
create policy teacher_permissions_member_read on teacher_permissions
  for select to authenticated
  using (
    coaching_center_id in (select app.member_center_ids())
    or app.is_platform_admin()
  );

-- ---------------------------------------------------------------------------
-- Subjects, batches, schedules
-- ---------------------------------------------------------------------------

create policy subjects_member_read on subjects
  for select to authenticated
  using (
    coaching_center_id in (select app.member_center_ids())
    or app.is_platform_admin()
  );

create policy subjects_staff_admin_write on subjects
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy batches_member_read on batches
  for select to authenticated
  using (
    coaching_center_id in (select app.member_center_ids())
    or app.teaches_batch(id)
    or app.is_platform_admin()
  );

create policy batches_staff_admin_write on batches
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy batch_schedules_member_read on batch_schedules
  for select to authenticated
  using (
    coaching_center_id in (select app.member_center_ids())
    or app.is_platform_admin()
  );

create policy batch_schedules_staff_admin_write on batch_schedules
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy teacher_subjects_member_read on teacher_subjects
  for select to authenticated
  using (
    coaching_center_id in (select app.member_center_ids())
    or app.is_platform_admin()
  );

create policy teacher_subjects_staff_admin_write on teacher_subjects
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

-- ---------------------------------------------------------------------------
-- Branches
-- ---------------------------------------------------------------------------

create policy branches_member_read on branches
  for select to authenticated
  using (
    coaching_center_id in (select app.member_center_ids())
    or app.is_platform_admin()
  );

create policy branches_staff_admin_write on branches
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

-- ---------------------------------------------------------------------------
-- students — the sharpest edge in the whole schema.
--
-- Staff admins see the whole center. A teacher sees ONLY students enrolled in
-- a batch they are assigned to. Students see themselves; guardians see their
-- own children. Nobody else sees a minor's record.
-- ---------------------------------------------------------------------------

create policy students_staff_admin_read on students
  for select to authenticated
  using (app.is_staff_admin(coaching_center_id) or app.is_platform_admin());

create policy students_teacher_read on students
  for select to authenticated
  using (id in (select app.my_taught_student_ids()));

create policy students_self_or_guardian_read on students
  for select to authenticated
  using (id in (select app.my_student_ids()));

create policy students_staff_admin_write on students
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

-- ---------------------------------------------------------------------------
-- guardians — parent phone numbers. Same scoping as students, because this is
-- the table that makes SMS possible and the one most worth protecting.
-- ---------------------------------------------------------------------------

create policy guardians_staff_admin_read on guardians
  for select to authenticated
  using (app.is_staff_admin(coaching_center_id) or app.is_platform_admin());

create policy guardians_teacher_read on guardians
  for select to authenticated
  using (student_id in (select app.my_taught_student_ids()));

create policy guardians_self_read on guardians
  for select to authenticated
  using (user_id = auth.uid() or student_id in (select app.my_student_ids()));

create policy guardians_staff_admin_write on guardians
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

-- ---------------------------------------------------------------------------
-- enrollments — the join that everything else hangs off.
-- ---------------------------------------------------------------------------

create policy enrollments_staff_admin_read on enrollments
  for select to authenticated
  using (app.is_staff_admin(coaching_center_id) or app.is_platform_admin());

create policy enrollments_teacher_read on enrollments
  for select to authenticated
  using (app.teaches_batch(batch_id));

create policy enrollments_self_read on enrollments
  for select to authenticated
  using (student_id in (select app.my_student_ids()));

create policy enrollments_staff_admin_write on enrollments
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

-- ---------------------------------------------------------------------------
-- Attendance — teachers write here daily; this is the app's core loop.
-- ---------------------------------------------------------------------------

create policy attendance_sessions_staff_admin on attendance_sessions
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy attendance_sessions_teacher_write on attendance_sessions
  for all to authenticated
  using (app.teaches_batch(batch_id))
  with check (app.teaches_batch(batch_id));

create policy attendance_sessions_self_read on attendance_sessions
  for select to authenticated
  using (
    batch_id in (
      select e.batch_id from enrollments e
      where e.student_id in (select app.my_student_ids())
    )
  );

create policy attendance_records_staff_admin on attendance_records
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy attendance_records_teacher_write on attendance_records
  for all to authenticated
  using (
    session_id in (
      select s.id from attendance_sessions s where app.teaches_batch(s.batch_id)
    )
  )
  with check (
    session_id in (
      select s.id from attendance_sessions s where app.teaches_batch(s.batch_id)
    )
  );

create policy attendance_records_self_read on attendance_records
  for select to authenticated
  using (
    enrollment_id in (
      select e.id from enrollments e
      where e.student_id in (select app.my_student_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- Exams and marks
-- ---------------------------------------------------------------------------

create policy exam_types_member_read on exam_types
  for select to authenticated
  using (
    coaching_center_id in (select app.member_center_ids())
    or app.is_platform_admin()
  );

create policy exam_types_staff_admin_write on exam_types
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy exams_staff_admin on exams
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy exams_teacher_write on exams
  for all to authenticated
  using (app.teaches_batch(batch_id))
  with check (app.teaches_batch(batch_id));

create policy exams_self_read on exams
  for select to authenticated
  using (
    batch_id in (
      select e.batch_id from enrollments e
      where e.student_id in (select app.my_student_ids())
    )
  );

create policy exam_results_staff_admin on exam_results
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy exam_results_teacher_write on exam_results
  for all to authenticated
  using (
    exam_id in (select x.id from exams x where app.teaches_batch(x.batch_id))
  )
  with check (
    exam_id in (select x.id from exams x where app.teaches_batch(x.batch_id))
  );

-- A student sees only their own marks — never a classmate's.
create policy exam_results_self_read on exam_results
  for select to authenticated
  using (
    enrollment_id in (
      select e.id from enrollments e
      where e.student_id in (select app.my_student_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- Fees — deliberately NOT visible to teachers by default. The roles table
-- gives fee access to owners and managers only; a teacher who needs it gets
-- it through teacher_permissions.can_view_fees, which the app checks before
-- querying. Students and guardians see their own bills.
-- ---------------------------------------------------------------------------

create policy fee_invoices_staff_admin on fee_invoices
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy fee_invoices_self_read on fee_invoices
  for select to authenticated
  using (student_id in (select app.my_student_ids()));

create policy fee_payments_staff_admin on fee_payments
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy fee_payments_self_read on fee_payments
  for select to authenticated
  using (
    invoice_id in (
      select i.id from fee_invoices i
      where i.student_id in (select app.my_student_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- SMS — dispatches and per-message logs. Teachers may read what they sent so
-- they can see "already sent" on the two-button gate; only staff admins see
-- the whole center's send history and cost.
-- ---------------------------------------------------------------------------

create policy sms_templates_member_read on sms_templates
  for select to authenticated
  using (
    coaching_center_id in (select app.member_center_ids())
    or app.is_platform_admin()
  );

create policy sms_templates_staff_admin_write on sms_templates
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy sms_dispatches_staff_admin on sms_dispatches
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy sms_dispatches_teacher_read on sms_dispatches
  for select to authenticated
  using (
    coaching_center_id in (select app.member_center_ids())
    and triggered_by = auth.uid()
  );

create policy sms_logs_staff_admin_read on sms_logs
  for select to authenticated
  using (app.is_staff_admin(coaching_center_id) or app.is_platform_admin());

-- Sends are written by the server-side dispatcher (service_role), never by a
-- browser session, so there is no client INSERT policy here on purpose.

-- ---------------------------------------------------------------------------
-- Billing and credits — owner only. A branch manager runs their branch but
-- never sees or changes what the center pays us.
-- ---------------------------------------------------------------------------

create policy subscriptions_owner_read on subscriptions
  for select to authenticated
  using (app.is_owner(coaching_center_id) or app.is_platform_admin());

create policy payments_owner_read on payments
  for select to authenticated
  using (app.is_owner(coaching_center_id) or app.is_platform_admin());

create policy sms_credit_ledger_owner_read on sms_credit_ledger
  for select to authenticated
  using (app.is_owner(coaching_center_id) or app.is_platform_admin());

-- Plans, subscription changes, and credit top-ups are written by us
-- (service_role) after money moves, not by the center itself.

-- ---------------------------------------------------------------------------
-- Notices
-- ---------------------------------------------------------------------------

create policy notices_member_read on notices
  for select to authenticated
  using (
    coaching_center_id in (select app.member_center_ids())
    or app.is_platform_admin()
  );

create policy notices_staff_admin_write on notices
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy notices_audience_read on notices
  for select to authenticated
  using (
    published_at is not null
    and (
      audience = 'all'
      or (audience in ('students', 'guardians')
          and (batch_id is null or batch_id in (
            select e.batch_id from enrollments e
            where e.student_id in (select app.my_student_ids())
          )))
      or (audience = 'teachers' and exists (select 1 from app.my_teacher_ids()))
    )
  );





