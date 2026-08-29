-- The people who work here and do not teach.
--
-- MASTERPLAN.md §9.4, quoted whole because the table is one argument:
--
--   "A centre employs an accountant, a receptionist, a coordinator, a cleaner, a
--   security guard. None of them teach, none of them hold a batch, and none of
--   them should occupy a teacher seat — which is a billable unit at ৳100/month.
--   Putting a cleaner in `teachers` to reuse its permission row would silently
--   raise the customer's bill and corrupt the seat count Center pricing depends
--   on."
--
-- The tempting shortcut is a `teaching boolean` on `teachers`, and it is worth
-- naming why it is wrong rather than merely inelegant. `teachers` is the table
-- that answers "how many staff seats is this centre paying for", it is the table
-- batches, exam permissions and the attendance roster all resolve through, and
-- every one of those would have to learn to skip rows. A cleaner would be one
-- forgotten `where teaching` away from appearing in a batch's teacher picker, in
-- the seat count on the invoice, and in `app.my_teacher_ids()` — which is the
-- function the teacher-side RLS policies are built on. A separate table cannot be
-- forgotten by a query that never mentions it.
--
-- A PERSON MAY HOLD BOTH RECORDS, on purpose. A coordinator who also takes a
-- Friday batch is one human with a `teachers` row and an `employees` row, and the
-- seat follows the teaching, which is the honest answer: they do teach, so the
-- centre is paying for a teacher. Nothing here tries to detect or prevent the
-- pair, because the two rows record two different facts about them.
--
-- ROLE IS AN ENUM PLUS A FREE-TEXT DESIGNATION, for the reason §9.6 gives about
-- expense categories: "a category somebody types is a category no report can
-- group". `role` is what the salary bill groups by; `designation` is the words
-- that print on the payslip, because a centre that calls its receptionist
-- "Front Desk Officer" should see that on the paper.
--
-- `employee_role` IS NOT `member_role`, and the overlap of the word "manager" is
-- the reason to say so. `member_role` says what a person may do in the app and is
-- what every RLS policy resolves through. `employee_role` says what the centre
-- pays them to do. A manager holds both; a cleaner holds only this one.
--
-- WHERE THE SALARY TERMS ARE. §9.4 lists them as part of this record, and they
-- are one join away instead — see 20260811000044. Teachers are paid too, and the
-- payroll screen that must not miss anybody is far safer reading one table of
-- terms than a union of two tables that each own half the payees.

-- ---------------------------------------------------------------------------
-- 1. What a centre employs somebody as.
--
-- Office roles first, support roles after, `other` last — the order a picker
-- should offer them and the order `order by role` gives a report. The list is
-- the one §9.4 names, widened to the jobs a Bangladeshi coaching centre actually
-- fills: a lab assistant, a driver for the branch van, a cook where students eat
-- in, an IT person for the projectors, and the admission-season marketing staff
-- who are hired every year and are the reason a payroll report needs a category
-- for them.
--
-- A brand-new enum type may be created and used in the same file, unlike a new
-- *value* on an existing one — see 20260811000015. This whole migration is one
-- transaction, and the table below uses the type immediately.
-- ---------------------------------------------------------------------------

create type public.employee_role as enum (
  'manager',
  'accountant',
  'receptionist',
  'coordinator',
  'office_assistant',
  'librarian',
  'lab_assistant',
  'it_support',
  'marketing',
  'driver',
  'cook',
  'cleaner',
  'security_guard',
  'other'
);

-- ---------------------------------------------------------------------------
-- 2. The record.
-- ---------------------------------------------------------------------------

create table public.employees (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references public.coaching_centers (id) on delete cascade,

  -- Branch from birth, because §8.2 lists employees among the things that must be
  -- branch-scoped and a column added later is a column every existing row has to
  -- be guessed into. Nullable for a single-branch centre, which is most of them,
  -- and for the HQ accountant who belongs to no one branch.
  branch_id    uuid,

  -- The record-versus-account split of §5.1, exactly as `teachers` has it: the
  -- accountant gets a login, the cleaner does not, and both are on the payroll.
  -- This column is a LINK AND NOT A GRANT — nothing in the product resolves
  -- permission through it, because membership lives in `center_members` and every
  -- policy asks that table. Setting it therefore hands out nothing; a manager who
  -- wants to give the accountant access creates the membership row, which they
  -- could already do.
  user_id      uuid references auth.users (id) on delete set null,

  name         text not null,
  phone        text,

  role         public.employee_role not null default 'other',
  -- What prints on the payslip, when the centre's own word for the job is not the
  -- enum's. Null means the role's own label is the right one.
  designation  text,

  -- Dhaka's calendar, like `students.admitted_on`. A join date is a day, not an
  -- instant, and the day it is depends on where the centre is.
  joined_on    date not null default (now() at time zone 'Asia/Dhaka')::date,
  left_on      date,

  active       boolean not null default true,
  note         text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Composite, per 20260811000005, and declared inline because the table is new:
  -- a branch id and the centre travel together, so this centre's employee cannot
  -- be filed under another centre's branch. The column list on SET NULL matters —
  -- a bare one would try to null coaching_center_id, which is NOT NULL, and
  -- closing a branch would fail instead of releasing its staff.
  constraint employees_branch_id_center_fkey
    foreign key (branch_id, coaching_center_id)
    references public.branches (id, coaching_center_id) on delete set null (branch_id),

  -- One employee record per login account per centre — enforced by the partial
  -- index below rather than here, because a table constraint cannot be partial and
  -- the many accountless rows (the cleaner, the guard, the cook) would collide on
  -- null. An employee who has left keeps their record: a payroll history that
  -- disappears when somebody resigns is a payroll history that cannot be audited.
  constraint employees_left_is_inactive check (left_on is null or not active),
  constraint employees_left_after_joining check (left_on is null or left_on >= joined_on)
);

-- The pair 20260811000044's terms and payments will reference, so payroll cannot
-- be attached to another centre's employee.
alter table public.employees
  add constraint employees_id_center_key unique (id, coaching_center_id);

-- Not unique across centres: a person can be on two centres' payrolls, which is
-- ordinary for a coordinator working evenings elsewhere.
create unique index employees_center_user_idx
  on public.employees (coaching_center_id, user_id)
  where user_id is not null;

-- The payroll list: this centre's staff who are currently paid, which is the
-- query every screen in §16's step 15 opens with.
create index employees_center_idx
  on public.employees (coaching_center_id) where active;

-- "Which of these rows is me", for a future payslip screen and for the same
-- reason `teachers_user_idx` exists.
create index employees_user_idx on public.employees (user_id);

create trigger employees_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

comment on table public.employees is
  'MASTERPLAN.md §9.4 — non-teaching staff, kept out of `teachers` so a cleaner '
  'never occupies a billable teacher seat. Salary terms are in salary_terms and '
  'salary payments in salary_payments (20260811000044).';

comment on column public.employees.user_id is
  'The login account, once this person has one. A link and not a grant: '
  'permission is resolved through center_members, never through this column.';

comment on column public.employees.designation is
  'What the centre calls the job, for the payslip. `role` is what reports group '
  'by; this is what prints.';

-- ---------------------------------------------------------------------------
-- 3. Who may see the staff list.
--
-- Owners and managers, through the same `is_staff_admin` every administrative
-- table uses, and the founder on reads for the support conversation §10 predicts.
--
-- NOT TEACHERS, and this is a deliberate narrowing rather than an oversight. A
-- teacher's own row is in `teachers` and they can already read it; the employee
-- list is the shape of the salary bill — who was hired, when, at what
-- designation, and who has left — and §6.5 keeps a teacher to the students in
-- their own batches for exactly this kind of reason. There is nothing a teacher
-- does that needs the guard's join date.
--
-- No self-read policy yet, because there is no screen to serve one. An employee
-- with an account sees nothing here until §16's step 15 gives them a payslip, and
-- adding the policy then — in a migration, with the screen — is better than
-- shipping a read nothing exercises.
-- ---------------------------------------------------------------------------

alter table public.employees enable row level security;

create policy employees_staff_admin_read on public.employees
  for select to authenticated
  using (app.is_staff_admin(coaching_center_id) or app.is_platform_admin());

create policy employees_staff_admin_write on public.employees
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));
