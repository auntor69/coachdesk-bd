-- ---------------------------------------------------------------------------
-- What a manager may do, narrowed one capability at a time (MASTERPLAN.md §6.2).
--
-- §6.2 asks for "capability-based, not role-based … a role becomes a named bundle of
-- capabilities rather than a branch in an `if`", and says the permission system "has to be
-- able to express them without a migration each time". Today `manager` is all-or-nothing:
-- the owner who appoints an accountant on /settings/managers hands over the fee book, the
-- expense book, the payroll and the roster in one tap, because every policy guarding those
-- reads `app.is_staff_admin`, which cannot tell an accountant from a deputy owner.
--
-- SO THIS FILE ADDS A VETO, NOT A GRANT. `center_members.capabilities` is null on every row
-- that exists today, and null keeps meaning "the whole of this role" forever — which is
-- consequence 1's requirement that existing Center accounts keep working unchanged. A
-- non-null array narrows one membership, and `app.member_allows` returns false for exactly
-- that person and that capability: true for an owner, a teacher, a signed-out request, a
-- platform admin, and every manager whose column is still null.
--
-- WHY RESTRICTIVE POLICIES AND NOT A CHECK IN THE SERVER ACTION. A narrowing enforced in
-- application code is a narrowing the owner did not get: Server Actions are public HTTP
-- endpoints, and the point of taking the fee book away from the receptionist is that it
-- stays taken when they post the form by hand. Same argument and same mechanism as
-- 20260811000053's branch scoping, so the shape is deliberately identical — one small
-- SECURITY DEFINER predicate, one restrictive policy per table, and a closing section naming
-- what is not narrowed.
--
-- TEXT AND NOT AN ENUM. §6.2's "without a migration each time" rules out both an enum type
-- and a check constraint listing the words: either would mean shipping SQL to invent a
-- capability. The vocabulary lives in src/lib/staff/capabilities.ts, and a misspelling here
-- fails closed — an unknown word narrows the manager further rather than widening them,
-- because the test is membership of the array, not absence from a list of denials.
--
-- WHO MAY WRITE THE COLUMN. Nobody who benefits from it. 20260811000061 gives
-- `members_staff_write` `role not in ('owner', 'manager')` on both sides, so a manager cannot
-- reach their own membership row at all; manager rows belong to `members_owner_write`, which
-- is `app.is_owner`. A narrowed manager widening themselves would have to be the owner first.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The column.
--
-- The constraint is a shape rule and not a vocabulary: a null element would make
-- `cap = any (capabilities)` return null rather than false, and a null in the middle of a
-- three-way boolean is how a veto turns into a grant. An empty array is allowed on purpose —
-- that is the read-only administrator, somebody the owner wants to see the centre and change
-- nothing.
-- ---------------------------------------------------------------------------

alter table center_members
  add column capabilities text[];

alter table center_members
  add constraint center_members_capabilities_clean
  check (capabilities is null or array_position(capabilities, null) is null);

comment on column center_members.capabilities is
  'Null means the whole of this role, and every row predating this column is null. '
  'A non-null array narrows the membership to the capabilities named in it; the words are '
  'defined in src/lib/staff/capabilities.ts and not in the schema, because MASTERPLAN.md '
  'section 6.2 rules out a migration per capability.';

-- ---------------------------------------------------------------------------
-- 2. The predicate, and it is absolute.
--
-- False when any active membership of this centre narrows the caller and leaves this
-- capability out. Not "unless another membership grants it" — that alternative was written
-- first and it was wrong, badly enough to be worth recording: a person commonly holds
-- `teacher` and `manager` at the same centre, and deferring to the teacher membership would
-- have made a narrowed manager unnarrowed. `app.is_staff_admin` is satisfied by the manager
-- row, so the permissive staff-admin policies would then have handed over the entire fee
-- book — the exact thing the owner had just unticked. A veto that any second membership can
-- lift is not a veto.
--
-- WHAT THAT COSTS, PLAINLY. An owner who narrows somebody who also teaches narrows their
-- teaching too, on the capability in question: a teacher with `can_view_fees` appointed
-- without `fees` stops seeing their batch's bills, and one with `can_manage_students`
-- appointed without `students` stops admitting children. Both are the same authority read
-- twice, and the owner has said no to it more recently and more specifically. Fail closed,
-- and let the owner tick the box if they meant otherwise — the opposite mistake is silent.
-- Section 4 lists the capabilities NOT taken for exactly this reason.
--
-- STABLE, DEFINER, EMPTY search_path, AND EXECUTABLE BY `authenticated` — the four properties
-- `app.branch_ok` needs and for the same reasons. A policy expression is evaluated as the
-- querying role, so revoking EXECUTE would refuse every write below rather than protect
-- anything, and a caller who reached it learns one boolean about their own membership, which
-- their own row already tells them.
-- ---------------------------------------------------------------------------

create or replace function app.member_allows(center uuid, cap text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.center_members m
    where m.user_id = auth.uid()
      and m.active
      and m.coaching_center_id = center
      and m.capabilities is not null
      and not (cap = any (m.capabilities))
  );
$$;

comment on function app.member_allows(uuid, text) is
  'False when the caller holds an active membership of this centre whose capabilities column '
  'was narrowed to leave this capability out. True for owners, teachers, non-members and '
  'every membership whose column is null, which leaves the permissive policies deciding '
  'exactly what they decided before. Called from restrictive policies, so it must stay '
  'executable by authenticated.';

-- ---------------------------------------------------------------------------
-- 3. The money: taken away completely, reads included.
--
-- Three capabilities and six tables, and these are the ones where hiding is the point. "The
-- receptionist admits students and sends reminders and never sees what anybody paid" is the
-- request §6.2 is describing, and a receptionist who can read the fee book has not been
-- narrowed in any way they would notice. Same for what the centre spends and what it pays its
-- staff — a salary is the most private number in the database and the one an owner is least
-- willing to show an office manager.
--
-- `for all` with no WITH CHECK, so Postgres uses the USING expression for both and a write is
-- refused by the same sentence as a read. That matters for the update case: a narrowed
-- manager must not be able to edit a row they cannot see.
--
-- THE VIEWS FOLLOW WITHOUT BEING NAMED. Every summing view in the schema is
-- `security_invoker = true` — check-migrations.mjs fails the build otherwise — so
-- `center_profit_month`, the branch finance views and the fee boards all execute as the
-- caller and return nothing to somebody these policies refuse. A screen showing a total must
-- therefore ask whether the reader has the capability before it shows a zero, or it reports a
-- solvent centre as broke.
-- ---------------------------------------------------------------------------

create policy fee_invoices_capability on public.fee_invoices
  as restrictive for all to authenticated
  using (app.member_allows(coaching_center_id, 'fees'));

create policy fee_payments_capability on public.fee_payments
  as restrictive for all to authenticated
  using (app.member_allows(coaching_center_id, 'fees'));

create policy fee_reminders_capability on public.fee_reminders
  as restrictive for all to authenticated
  using (app.member_allows(coaching_center_id, 'fees'));

create policy expenses_capability on public.expenses
  as restrictive for all to authenticated
  using (app.member_allows(coaching_center_id, 'expenses'));

-- Both halves of payroll, because the agreement gives the number away as surely as the
-- payment does.
create policy salary_terms_capability on public.salary_terms
  as restrictive for all to authenticated
  using (app.member_allows(coaching_center_id, 'payroll'));

create policy salary_payments_capability on public.salary_payments
  as restrictive for all to authenticated
  using (app.member_allows(coaching_center_id, 'payroll'));

-- ---------------------------------------------------------------------------
-- 4. The roster, the staff list and the centre's voice: the writes, and only the writes.
--
-- Three capabilities over ten tables, and here the veto stops at the door rather than
-- covering the windows. A narrowed manager keeps reading the roster and the staff list and
-- cannot change either.
--
-- WHY READS STAY OPEN, WHICH IS THE ONE PLACE THIS DIFFERS FROM SECTION 3. Because these
-- tables are what every other screen joins to. A manager with `fees` and without `students`
-- still has to see whose bill they are taking — the fee list embeds the student, an invoice
-- carries the batch, a teacher's name sits on a timetable. Hiding those rows would not narrow
-- that manager, it would break the screens they are supposed to be using, and it would do it
-- as blank names and vanishing rows rather than as a refusal. The honest reading of "manage
-- students" is the verb: a receptionist may look up any child in the centre, and may not
-- admit, edit or remove one.
--
-- TWO POLICIES PER TABLE, AND THE PAIR IS FORCED BY POSTGRES. A restrictive `for all` with
-- `using (true)` and a real WITH CHECK covers INSERT and covers UPDATE — an update is refused
-- because the row it would leave behind fails the check — but DELETE consults only USING, so
-- it needs its own policy. There is no `for all except select`.
-- ---------------------------------------------------------------------------

-- The roster. Admitting a student is what fills the seats an owner pays for, and §7.2's
-- capacity ceiling is counted from these rows.
create policy students_capability_write on public.students
  as restrictive for all to authenticated
  using (true)
  with check (app.member_allows(coaching_center_id, 'students'));

create policy students_capability_delete on public.students
  as restrictive for delete to authenticated
  using (app.member_allows(coaching_center_id, 'students'));

create policy enrollments_capability_write on public.enrollments
  as restrictive for all to authenticated
  using (true)
  with check (app.member_allows(coaching_center_id, 'students'));

create policy enrollments_capability_delete on public.enrollments
  as restrictive for delete to authenticated
  using (app.member_allows(coaching_center_id, 'students'));

create policy guardians_capability_write on public.guardians
  as restrictive for all to authenticated
  using (true)
  with check (app.member_allows(coaching_center_id, 'students'));

create policy guardians_capability_delete on public.guardians
  as restrictive for delete to authenticated
  using (app.member_allows(coaching_center_id, 'students'));

-- A transfer moves a child between branches, which is a roster decision and an audit line at
-- once. 20260811000042's trigger writes the row and a trigger runs as its definer, so what
-- this refuses is somebody posting a transfer directly.
create policy student_transfers_capability_write on public.student_transfers
  as restrictive for all to authenticated
  using (true)
  with check (app.member_allows(coaching_center_id, 'students'));

create policy student_transfers_capability_delete on public.student_transfers
  as restrictive for delete to authenticated
  using (app.member_allows(coaching_center_id, 'students'));

-- The people who work here, and what the teachers among them are allowed to do.
-- `teacher_permissions` is the sharp one: without it a narrowed manager could tick
-- `can_view_fees` on a teacher and read the fee book through them.
--
-- THE SELF EXEMPTION IS `teachers_self_update`, not a loophole. A teacher edits their own name
-- and phone on their own profile screen, and a narrowed manager who also teaches would
-- otherwise be locked out of it. It grants nothing: `user_id = auth.uid()` reaches one row,
-- the row that already had a permissive policy of its own.
create policy teachers_capability_write on public.teachers
  as restrictive for all to authenticated
  using (true)
  with check (
    app.member_allows(coaching_center_id, 'staff')
    or teachers.user_id = auth.uid()
  );

create policy teachers_capability_delete on public.teachers
  as restrictive for delete to authenticated
  using (app.member_allows(coaching_center_id, 'staff'));

create policy teacher_permissions_capability_write on public.teacher_permissions
  as restrictive for all to authenticated
  using (true)
  with check (app.member_allows(coaching_center_id, 'staff'));

create policy teacher_permissions_capability_delete on public.teacher_permissions
  as restrictive for delete to authenticated
  using (app.member_allows(coaching_center_id, 'staff'));

create policy teacher_subjects_capability_write on public.teacher_subjects
  as restrictive for all to authenticated
  using (true)
  with check (app.member_allows(coaching_center_id, 'staff'));

create policy teacher_subjects_capability_delete on public.teacher_subjects
  as restrictive for delete to authenticated
  using (app.member_allows(coaching_center_id, 'staff'));

create policy employees_capability_write on public.employees
  as restrictive for all to authenticated
  using (true)
  with check (app.member_allows(coaching_center_id, 'staff'));

create policy employees_capability_delete on public.employees
  as restrictive for delete to authenticated
  using (app.member_allows(coaching_center_id, 'staff'));

-- The centre's voice: the wording of every reminder it sends, and the notice board every
-- member reads. Both are staff-admin writes today and neither is a teacher's work, which is
-- what makes them safe to gate here.
create policy sms_templates_capability_write on public.sms_templates
  as restrictive for all to authenticated
  using (true)
  with check (app.member_allows(coaching_center_id, 'messages'));

create policy sms_templates_capability_delete on public.sms_templates
  as restrictive for delete to authenticated
  using (app.member_allows(coaching_center_id, 'messages'));

create policy notices_capability_write on public.notices
  as restrictive for all to authenticated
  using (true)
  with check (app.member_allows(coaching_center_id, 'messages'));

create policy notices_capability_delete on public.notices
  as restrictive for delete to authenticated
  using (app.member_allows(coaching_center_id, 'messages'));

-- ---------------------------------------------------------------------------
-- 5. What is not narrowed, and why each one is a decision.
--
-- ATTENDANCE, MARKS AND THE TAP-TO-SEND QUEUES, WHICH IS THE DECISION WORTH ARGUING ABOUT.
-- `attendance_sessions`, `attendance_records`, `exams`, `exam_results`, `batches`,
-- `batch_schedules`, `subjects`, `exam_types`, `absence_notices`, `progress_updates` and
-- `result_notices` get no capability, and it is section 2's absolute veto that decides it: a
-- restrictive policy cannot tell which permissive policy would have granted the row, so a
-- veto over these would land on the teacher-who-also-administers every bit as hard as on the
-- receptionist — and a senior teacher doing the centre's books is the ordinary case in a
-- coaching centre, not a corner one. Losing a fee view because the owner unticked `fees` is a
-- narrowing they asked for; losing the ability to mark your own batch present is a broken
-- product. So these stay whole until they can be gated per row against
-- `app.teaches_batch`, which is a bigger change than one column.
--
-- ALREADY THE OWNER'S ALONE. `subscriptions`, `payments`, `payment_intents`,
-- `plan_allowances`, `upgrade_requests`, `capacity_requests`, `audit_log`, `branches`, and the
-- manager rows in `center_members`. A capability cannot take away what no manager has:
-- 20260811000061 keeps a manager out of manager rows, 20260811000058 and 20260811000046 open
-- the asks and the log to `app.is_owner`, and the plan screen is owner-gated the same way.
-- A veto here would be a second lock on a bolted door, and would read as though a manager
-- could hold `plan` if only somebody ticked it.
--
-- THE SESSION HAS TO BE READABLE. `center_members`, `coaching_centers` and `profiles` are what
-- src/lib/auth/session.ts resolves on every request, and `branches` is what the shell names.
-- Narrowing any of them does not produce a narrowed manager, it produces a manager who cannot
-- sign in — and it would do it as a redirect to /onboarding, which is the hardest possible way
-- to diagnose a permission bug.
--
-- ONE POT OF CREDITS. `sms_credit_ledger` stays whole, as it does in 20260811000053. The
-- balance belongs to the organisation and is bought by its owner; a manager who may not write
-- the centre's templates can see how many sends are left and do nothing with the number.
--
-- AND TWO PATHS RLS CANNOT REACH, STATED PLAINLY RATHER THAN LEFT TO BE DISCOVERED.
-- exams/actions.ts writes `exams.sms_declined_at` and spends credits through
-- `createAdminClient`, and settings/actions.ts mints logins the same way; the service role
-- bypasses every policy above, by design. For those two the capability check in the Server
-- Action is the whole enforcement — which is the situation this file exists to avoid
-- everywhere else, so the guard there is not a convenience and must not be dropped as one.
-- ---------------------------------------------------------------------------
