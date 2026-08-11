-- CoachDesk BD — core multi-tenant schema
-- Every tenant-owned table carries coaching_center_id. RLS lives in the next
-- migration; this file is structure only.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- Enums
-- Anything a center owner must be able to customise (exam types, subjects,
-- batches) is a table instead, so it can be edited from a phone.
-- ---------------------------------------------------------------------------

create type member_role as enum ('owner', 'manager', 'teacher', 'student', 'guardian');
create type center_status as enum ('trial', 'active', 'suspended', 'cancelled');
create type plan_type as enum ('teacher_free', 'teacher_plus', 'center', 'institution');
create type subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled');
create type subject_kind as enum ('academic', 'coaching');
create type batch_slot as enum ('morning', 'noon', 'afternoon', 'evening', 'night');
create type enrollment_status as enum ('active', 'paused', 'completed', 'dropped');
create type student_status as enum ('active', 'inactive', 'graduated', 'dropped');
create type attendance_status as enum ('present', 'absent', 'late', 'excused');
create type sms_kind as enum ('exam_result', 'attendance_alert', 'fee_reminder', 'notice', 'custom');
create type sms_status as enum ('queued', 'sent', 'delivered', 'failed', 'cancelled');
create type payment_method as enum ('cash', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'other');
create type notice_audience as enum ('all', 'students', 'guardians', 'teachers');

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Identity
-- profiles mirrors auth.users so we can store a phone-first display name.
-- ---------------------------------------------------------------------------

create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text,
  phone        text,
  locale       text not null default 'bn' check (locale in ('bn', 'en')),
  is_platform_admin boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Tenant root
-- ---------------------------------------------------------------------------

create table coaching_centers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  phone        text,
  address      text,
  bd_area      text,
  status       center_status not null default 'trial',
  plan         plan_type not null default 'teacher_free',
  -- Denormalised so the SMS sender never needs a second query before a send.
  sms_credit_balance integer not null default 0,
  timezone     text not null default 'Asia/Dhaka',
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger coaching_centers_updated_at
  before update on coaching_centers
  for each row execute function set_updated_at();

create table branches (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  name         text not null,
  address      text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (coaching_center_id, name)
);

create trigger branches_updated_at
  before update on branches
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership — the single source of truth for "who belongs to which center".
-- Every RLS policy in the next migration resolves through this table, so a
-- user can hold different roles at different centers (teachers commonly do).
-- ---------------------------------------------------------------------------

create table center_members (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         member_role not null,
  branch_id    uuid references branches (id) on delete set null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (coaching_center_id, user_id, role)
);

create index center_members_user_idx on center_members (user_id) where active;
create index center_members_center_idx on center_members (coaching_center_id) where active;

create trigger center_members_updated_at
  before update on center_members
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Staff, subjects, batches
-- A teacher row can exist before that person ever signs in (the owner adds
-- them by name and phone), so user_id is nullable and linked on first login.
-- ---------------------------------------------------------------------------

create table teachers (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  branch_id    uuid references branches (id) on delete set null,
  name         text not null,
  phone        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index teachers_center_idx on teachers (coaching_center_id) where active;
create index teachers_user_idx on teachers (user_id);

create trigger teachers_updated_at
  before update on teachers
  for each row execute function set_updated_at();

create table teacher_permissions (
  teacher_id   uuid primary key references teachers (id) on delete cascade,
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  can_manage_students boolean not null default false,
  can_manage_exams    boolean not null default true,
  can_send_sms        boolean not null default true,
  can_view_fees       boolean not null default false,
  can_manage_batches  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger teacher_permissions_updated_at
  before update on teacher_permissions
  for each row execute function set_updated_at();

create table subjects (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  name         text not null,
  name_bn      text,
  subject_kind subject_kind not null default 'academic',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (coaching_center_id, name)
);

create trigger subjects_updated_at
  before update on subjects
  for each row execute function set_updated_at();

create table batches (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  branch_id    uuid references branches (id) on delete set null,
  subject_id   uuid not null references subjects (id) on delete restrict,
  teacher_id   uuid references teachers (id) on delete set null,
  name         text not null,
  slot         batch_slot,
  start_time   time,
  end_time     time,
  -- Monthly fee for this batch. The invoice generator reads it, and each
  -- invoice snapshots the amount so a later price change never rewrites history.
  monthly_fee_bdt numeric(10, 2) not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (coaching_center_id, name),
  constraint batches_time_order check (
    start_time is null or end_time is null or end_time > start_time
  )
);

create index batches_center_idx on batches (coaching_center_id) where active;
create index batches_teacher_idx on batches (teacher_id) where active;

create trigger batches_updated_at
  before update on batches
  for each row execute function set_updated_at();

create table batch_schedules (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  batch_id     uuid not null references batches (id) on delete cascade,
  -- 0 = Sunday, matching Postgres extract(dow). BD week runs Sat-Thu.
  day_of_week  smallint not null check (day_of_week between 0 and 6),
  start_time   time not null,
  end_time     time not null,
  created_at   timestamptz not null default now(),
  unique (batch_id, day_of_week, start_time),
  constraint batch_schedules_time_order check (end_time > start_time)
);

create index batch_schedules_batch_idx on batch_schedules (batch_id);

-- A teacher may teach several subjects; this is that mapping.
create table teacher_subjects (
  teacher_id   uuid not null references teachers (id) on delete cascade,
  subject_id   uuid not null references subjects (id) on delete cascade,
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  primary key (teacher_id, subject_id)
);

-- ---------------------------------------------------------------------------
-- Students, guardians, enrollments
-- enrollments is the join that makes per-subject-enrollment billing and
-- per-subject workload tracking possible: a student in 5 subjects has 5 rows.
-- ---------------------------------------------------------------------------

create table students (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  branch_id    uuid references branches (id) on delete set null,
  user_id      uuid references auth.users (id) on delete set null,
  name         text not null,
  student_code text,
  phone        text,
  guardian_name  text,
  guardian_phone text,
  institution  text,
  class_level  text,
  bd_area      text,
  status       student_status not null default 'active',
  -- Owner-controlled kill switch: no SMS of any kind for this student.
  sms_opt_out  boolean not null default false,
  admitted_on  date not null default (now() at time zone 'Asia/Dhaka')::date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (coaching_center_id, student_code)
);

create index students_center_idx on students (coaching_center_id) where status = 'active';
create index students_user_idx on students (user_id);

create trigger students_updated_at
  before update on students
  for each row execute function set_updated_at();

create table guardians (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  student_id   uuid not null references students (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  name         text,
  phone        text not null,
  relationship text,
  -- The number that receives result and fee SMS. One primary per student.
  is_primary   boolean not null default true,
  sms_opt_out  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index guardians_student_idx on guardians (student_id);
create index guardians_center_idx on guardians (coaching_center_id);
create index guardians_user_idx on guardians (user_id);
create unique index guardians_one_primary_per_student
  on guardians (student_id) where is_primary;

create trigger guardians_updated_at
  before update on guardians
  for each row execute function set_updated_at();

create table enrollments (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  student_id   uuid not null references students (id) on delete cascade,
  subject_id   uuid not null references subjects (id) on delete restrict,
  batch_id     uuid not null references batches (id) on delete cascade,
  status       enrollment_status not null default 'active',
  enrolled_at  timestamptz not null default now(),
  ended_at     timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (student_id, batch_id)
);

create index enrollments_batch_idx on enrollments (batch_id) where status = 'active';
create index enrollments_student_idx on enrollments (student_id);
create index enrollments_center_billing_idx
  on enrollments (coaching_center_id) where status = 'active';

create trigger enrollments_updated_at
  before update on enrollments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Attendance — split so "who was in this batch today" stays one cheap query,
-- and a teacher who forgot can backfill an entire session later.
-- ---------------------------------------------------------------------------

create table attendance_sessions (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  batch_id     uuid not null references batches (id) on delete cascade,
  teacher_id   uuid references teachers (id) on delete set null,
  session_date date not null,
  note         text,
  taken_by     uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One session per batch per day. Makes the offline queue idempotent: a
  -- retried sync upserts the same session instead of duplicating it.
  unique (batch_id, session_date)
);

create index attendance_sessions_center_date_idx
  on attendance_sessions (coaching_center_id, session_date desc);

create trigger attendance_sessions_updated_at
  before update on attendance_sessions
  for each row execute function set_updated_at();

create table attendance_records (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  session_id   uuid not null references attendance_sessions (id) on delete cascade,
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  status       attendance_status not null,
  marked_at    timestamptz not null default now(),
  marked_by    uuid references auth.users (id) on delete set null,
  unique (session_id, enrollment_id)
);

create index attendance_records_enrollment_idx
  on attendance_records (enrollment_id);

-- ---------------------------------------------------------------------------
-- Exams and marks
-- exam_types is a per-center table, not an enum, so an owner can add
-- "Weekly Test" or "মডেল টেস্ট" from a phone without a migration.
-- ---------------------------------------------------------------------------

create table exam_types (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  name         text not null,
  name_bn      text,
  sort_order   smallint not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (coaching_center_id, name)
);

create table exams (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  subject_id   uuid not null references subjects (id) on delete restrict,
  batch_id     uuid not null references batches (id) on delete cascade,
  teacher_id   uuid references teachers (id) on delete set null,
  exam_type_id uuid references exam_types (id) on delete set null,
  title        text not null,
  total_marks  numeric(6, 2) not null check (total_marks > 0),
  pass_marks   numeric(6, 2) check (pass_marks is null or pass_marks <= total_marks),
  exam_date    date not null,
  -- Result SMS state. sms_sent_at is what makes the send idempotent: the
  -- confirmation screen reads it and shows "already sent" instead of
  -- offering a second charge to the center.
  sms_sent_at  timestamptz,
  sms_sent_by  uuid references auth.users (id) on delete set null,
  sms_declined_at timestamptz,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index exams_batch_idx on exams (batch_id, exam_date desc);
create index exams_center_idx on exams (coaching_center_id, exam_date desc);

create trigger exams_updated_at
  before update on exams
  for each row execute function set_updated_at();

create table exam_results (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  exam_id      uuid not null references exams (id) on delete cascade,
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  obtained_marks numeric(6, 2) check (obtained_marks >= 0),
  is_absent    boolean not null default false,
  note         text,
  entered_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (exam_id, enrollment_id),
  -- An absent student has no mark; a present one must have one.
  constraint exam_results_marks_present check (
    (is_absent and obtained_marks is null) or (not is_absent and obtained_marks is not null)
  )
);

create index exam_results_enrollment_idx on exam_results (enrollment_id);

create trigger exam_results_updated_at
  before update on exam_results
  for each row execute function set_updated_at();

-- Cross-table guard: a mark can never exceed the exam's total. A CHECK
-- constraint cannot reach another table, so this runs as a trigger.
create or replace function enforce_marks_within_total()
returns trigger
language plpgsql
as $$
declare
  max_marks numeric(6, 2);
begin
  if new.obtained_marks is null then
    return new;
  end if;

  select total_marks into max_marks from exams where id = new.exam_id;

  if new.obtained_marks > max_marks then
    raise exception 'obtained_marks (%) exceeds exam total_marks (%)',
      new.obtained_marks, max_marks;
  end if;

  return new;
end;
$$;

create trigger exam_results_within_total
  before insert or update on exam_results
  for each row execute function enforce_marks_within_total();

-- ---------------------------------------------------------------------------
-- Student fees — money the center collects from students.
-- Invoices snapshot the amount; payments are an append-only log. The
-- outstanding total is always derived, never stored, so a bad write can
-- never corrupt a balance.
-- ---------------------------------------------------------------------------

create table fee_invoices (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  student_id   uuid not null references students (id) on delete cascade,
  enrollment_id uuid references enrollments (id) on delete set null,
  -- First day of the month this invoice covers. Keeps one invoice per
  -- enrollment per cycle and makes the generator safe to re-run.
  period_month date not null,
  amount_bdt   numeric(10, 2) not null check (amount_bdt >= 0),
  discount_bdt numeric(10, 2) not null default 0 check (discount_bdt >= 0),
  due_date     date not null,
  note         text,
  voided_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (enrollment_id, period_month),
  constraint fee_invoices_discount_bound check (discount_bdt <= amount_bdt)
);

create index fee_invoices_center_due_idx
  on fee_invoices (coaching_center_id, due_date) where voided_at is null;
create index fee_invoices_student_idx on fee_invoices (student_id);

create trigger fee_invoices_updated_at
  before update on fee_invoices
  for each row execute function set_updated_at();

create table fee_payments (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  invoice_id   uuid not null references fee_invoices (id) on delete cascade,
  student_id   uuid not null references students (id) on delete cascade,
  amount_bdt   numeric(10, 2) not null check (amount_bdt <> 0),
  method       payment_method not null default 'cash',
  -- bKash/Nagad transaction id. Cash entries leave this null, which is why
  -- the field is optional: the tool must never force disclosure.
  reference    text,
  received_by  uuid references auth.users (id) on delete set null,
  paid_at      timestamptz not null default now(),
  note         text,
  created_at   timestamptz not null default now()
);

create index fee_payments_invoice_idx on fee_payments (invoice_id);
create index fee_payments_center_paid_idx
  on fee_payments (coaching_center_id, paid_at desc);

-- ---------------------------------------------------------------------------
-- SMS — metered, so every send is auditable and billable.
-- ---------------------------------------------------------------------------

create table sms_templates (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid references coaching_centers (id) on delete cascade,
  kind         sms_kind not null,
  name         text not null,
  body         text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- A null coaching_center_id marks a platform default template.
create unique index sms_templates_center_kind_name_idx
  on sms_templates (coalesce(coaching_center_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, name);

-- One dispatch per real-world trigger. The unique constraint below is what
-- makes "one exam sends once" a database guarantee rather than app logic,
-- so a double-tap or a retried request can never double-bill the center.
create table sms_dispatches (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  kind         sms_kind not null,
  ref_id       uuid,
  recipient_count integer not null default 0,
  segment_count   integer not null default 0,
  credit_cost  integer not null default 0,
  triggered_by uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (coaching_center_id, kind, ref_id)
);

create table sms_logs (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  dispatch_id  uuid references sms_dispatches (id) on delete set null,
  student_id   uuid references students (id) on delete set null,
  guardian_id  uuid references guardians (id) on delete set null,
  to_phone     text not null,
  kind         sms_kind not null,
  body         text not null,
  segments     smallint not null default 1,
  credit_cost  integer not null default 1,
  status       sms_status not null default 'queued',
  provider_ref text,
  error        text,
  queued_at    timestamptz not null default now(),
  sent_at      timestamptz,
  updated_at   timestamptz not null default now()
);

create index sms_logs_center_idx on sms_logs (coaching_center_id, queued_at desc);
create index sms_logs_dispatch_idx on sms_logs (dispatch_id);
create index sms_logs_pending_idx on sms_logs (status) where status = 'queued';

create trigger sms_logs_updated_at
  before update on sms_logs
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Platform billing — money the center pays US. Deliberately separate from
-- fee_invoices/fee_payments, which is money students pay the center.
-- ---------------------------------------------------------------------------

create table subscriptions (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  plan         plan_type not null,
  status       subscription_status not null default 'trialing',
  -- Snapshot of the billable unit count at the last cycle, so an invoice can
  -- be explained after enrollments have since changed.
  billed_enrollments integer not null default 0,
  unit_price_bdt numeric(10, 2) not null default 0,
  floor_price_bdt numeric(10, 2) not null default 0,
  started_at   timestamptz not null default now(),
  trial_ends_at timestamptz,
  renews_at    timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index subscriptions_center_idx on subscriptions (coaching_center_id);

create trigger subscriptions_updated_at
  before update on subscriptions
  for each row execute function set_updated_at();

create table payments (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  subscription_id uuid references subscriptions (id) on delete set null,
  amount_bdt   numeric(10, 2) not null check (amount_bdt > 0),
  method       payment_method not null default 'bkash',
  reference    text,
  covers_period_start date,
  covers_period_end   date,
  note         text,
  paid_at      timestamptz not null default now(),
  recorded_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index payments_center_idx on payments (coaching_center_id, paid_at desc);

-- SMS credits are prepaid and metered. Append-only: purchases are positive,
-- sends negative. coaching_centers.sms_credit_balance is the running cache,
-- and this ledger is the auditable truth behind it.
create table sms_credit_ledger (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  delta        integer not null check (delta <> 0),
  reason       text not null,
  dispatch_id  uuid references sms_dispatches (id) on delete set null,
  payment_id   uuid references payments (id) on delete set null,
  balance_after integer not null,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index sms_credit_ledger_center_idx
  on sms_credit_ledger (coaching_center_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Notices — center-wide announcements shown to students and guardians.
-- ---------------------------------------------------------------------------

create table notices (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  branch_id    uuid references branches (id) on delete cascade,
  batch_id     uuid references batches (id) on delete cascade,
  title        text not null,
  body         text not null,
  audience     notice_audience not null default 'all',
  published_at timestamptz not null default now(),
  expires_at   timestamptz,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index notices_center_idx on notices (coaching_center_id, published_at desc);

create trigger notices_updated_at
  before update on notices
  for each row execute function set_updated_at();





