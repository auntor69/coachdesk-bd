-- ---------------------------------------------------------------------------
-- Tenant-consistent foreign keys.
--
-- Every table carries coaching_center_id, and every RLS policy checks it. What
-- nothing checked until now is whether a row's *siblings* live in the same
-- centre. `exams.subject_id references subjects (id)` says the subject must
-- exist. It does not say it must be this centre's subject.
--
-- So a write could carry a legitimate coaching_center_id — passing the RLS
-- WITH CHECK — alongside another centre's sibling id, and the database took it.
-- Verified against this schema before writing this migration; all four of these
-- succeeded, the last two as an ordinary authenticated owner through RLS:
--
--   insert into batches      (…, subject_id)    -- another centre's subject
--   insert into enrollments  (…, student_id)    -- another centre's student
--   insert into exams        (…, subject_id)    -- another centre's subject
--   insert into exam_results (…, enrollment_id) -- another centre's child
--
-- The damage is not "you can read across tenants" — the read policies still
-- filter by coaching_center_id. It is worse in a quieter way: it lets two
-- centres' records be stitched together, so a mark, an invoice, or an
-- attendance record can hang off a child who belongs to someone else. Every
-- dashboard that joins through one of these ids then reports a number that is
-- part someone else's, and the fee board can bill a student the centre has
-- never met. The read policies stop being a boundary the moment a query
-- reaches a row through a sideways id instead of through coaching_center_id.
--
-- The fix is a composite foreign key: each parent gets a unique key on
-- (id, coaching_center_id), and each child references *that* pair. The tenant
-- column travels with the reference, so "same centre" becomes the same fact as
-- "row exists" and Postgres checks both together.
--
-- Why declaratively and not in a policy or a trigger:
--
--   * An RLS WITH CHECK with an `exists (…)` subquery covers only requests that
--     go through RLS. service_role bypasses RLS entirely, and the SMS queue and
--     the invoice generator will run as service_role. A foreign key binds
--     everyone, including me.
--   * A trigger can be switched off — `alter table … disable trigger`, or
--     session_replication_role = replica during a restore — and a constraint
--     that can be switched off is not a guarantee.
--   * It is checked on UPDATE as well as INSERT, at no extra cost, with no
--     policy to keep in sync when a table is added.
--
-- Two details that matter:
--
--   * ON DELETE SET NULL (column) — the column list, added in PostgreSQL 15,
--     is essential. A bare SET NULL on a composite key would try to null
--     coaching_center_id too, and that column is NOT NULL, so deleting a
--     teacher would fail instead of releasing their batches. Naming the column
--     nulls only the sideways id and leaves the tenant intact.
--   * MATCH SIMPLE (the default) skips the check when any key column is null,
--     which is what a nullable sideways id needs: batches.teacher_id may be
--     null for an unassigned batch, and that stays legal. Since every
--     coaching_center_id below is NOT NULL, "any column null" can only mean the
--     sideways id, so nothing else slips through the gap.
--
-- ON UPDATE stays NO ACTION, so a parent's coaching_center_id can no longer be
-- changed while a child points at it. That is not a loss. Nothing in this
-- product moves a subject or a student to a different centre, and if anything
-- ever tries, being stopped is the correct outcome.
--
-- 14 parents, 36 child references. Generated from pg_constraint rather than
-- typed out, then grouped by area, so the delete actions below are exactly the
-- ones the original schema declared.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The pairs each child will reference. A plain unique constraint, not an index,
-- so it is visible to a foreign key without depending on how Postgres happens
-- to resolve one.
-- ---------------------------------------------------------------------------

alter table branches
  add constraint branches_id_center_key unique (id, coaching_center_id);
alter table teachers
  add constraint teachers_id_center_key unique (id, coaching_center_id);
alter table subjects
  add constraint subjects_id_center_key unique (id, coaching_center_id);
alter table batches
  add constraint batches_id_center_key unique (id, coaching_center_id);
alter table students
  add constraint students_id_center_key unique (id, coaching_center_id);
alter table guardians
  add constraint guardians_id_center_key unique (id, coaching_center_id);
alter table enrollments
  add constraint enrollments_id_center_key unique (id, coaching_center_id);
alter table attendance_sessions
  add constraint attendance_sessions_id_center_key unique (id, coaching_center_id);
alter table exam_types
  add constraint exam_types_id_center_key unique (id, coaching_center_id);
alter table exams
  add constraint exams_id_center_key unique (id, coaching_center_id);
alter table fee_invoices
  add constraint fee_invoices_id_center_key unique (id, coaching_center_id);
alter table sms_dispatches
  add constraint sms_dispatches_id_center_key unique (id, coaching_center_id);
alter table subscriptions
  add constraint subscriptions_id_center_key unique (id, coaching_center_id);
alter table payments
  add constraint payments_id_center_key unique (id, coaching_center_id);

-- ---------------------------------------------------------------------------
-- Staff, subjects, batches
-- ---------------------------------------------------------------------------

alter table center_members drop constraint center_members_branch_id_fkey;
alter table center_members
  add constraint center_members_branch_id_center_fkey
  foreign key (branch_id, coaching_center_id)
  references branches (id, coaching_center_id) on delete set null (branch_id);

alter table teachers drop constraint teachers_branch_id_fkey;
alter table teachers
  add constraint teachers_branch_id_center_fkey
  foreign key (branch_id, coaching_center_id)
  references branches (id, coaching_center_id) on delete set null (branch_id);

-- The permissions row is keyed on the teacher, so this one also stops a
-- permissions row being attached to a teacher at another centre — which would
-- have handed out this centre's switches to someone else's staff.
alter table teacher_permissions drop constraint teacher_permissions_teacher_id_fkey;
alter table teacher_permissions
  add constraint teacher_permissions_teacher_id_center_fkey
  foreign key (teacher_id, coaching_center_id)
  references teachers (id, coaching_center_id) on delete cascade;

alter table teacher_subjects drop constraint teacher_subjects_teacher_id_fkey;
alter table teacher_subjects
  add constraint teacher_subjects_teacher_id_center_fkey
  foreign key (teacher_id, coaching_center_id)
  references teachers (id, coaching_center_id) on delete cascade;

alter table teacher_subjects drop constraint teacher_subjects_subject_id_fkey;
alter table teacher_subjects
  add constraint teacher_subjects_subject_id_center_fkey
  foreign key (subject_id, coaching_center_id)
  references subjects (id, coaching_center_id) on delete cascade;

alter table batches drop constraint batches_branch_id_fkey;
alter table batches
  add constraint batches_branch_id_center_fkey
  foreign key (branch_id, coaching_center_id)
  references branches (id, coaching_center_id) on delete set null (branch_id);

alter table batches drop constraint batches_subject_id_fkey;
alter table batches
  add constraint batches_subject_id_center_fkey
  foreign key (subject_id, coaching_center_id)
  references subjects (id, coaching_center_id) on delete restrict;

alter table batches drop constraint batches_teacher_id_fkey;
alter table batches
  add constraint batches_teacher_id_center_fkey
  foreign key (teacher_id, coaching_center_id)
  references teachers (id, coaching_center_id) on delete set null (teacher_id);

alter table batch_schedules drop constraint batch_schedules_batch_id_fkey;
alter table batch_schedules
  add constraint batch_schedules_batch_id_center_fkey
  foreign key (batch_id, coaching_center_id)
  references batches (id, coaching_center_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Students, guardians, enrollments
-- These are the ones that carry a child's name and a parent's phone number.
-- ---------------------------------------------------------------------------

alter table students drop constraint students_branch_id_fkey;
alter table students
  add constraint students_branch_id_center_fkey
  foreign key (branch_id, coaching_center_id)
  references branches (id, coaching_center_id) on delete set null (branch_id);

alter table guardians drop constraint guardians_student_id_fkey;
alter table guardians
  add constraint guardians_student_id_center_fkey
  foreign key (student_id, coaching_center_id)
  references students (id, coaching_center_id) on delete cascade;

alter table enrollments drop constraint enrollments_student_id_fkey;
alter table enrollments
  add constraint enrollments_student_id_center_fkey
  foreign key (student_id, coaching_center_id)
  references students (id, coaching_center_id) on delete cascade;

alter table enrollments drop constraint enrollments_subject_id_fkey;
alter table enrollments
  add constraint enrollments_subject_id_center_fkey
  foreign key (subject_id, coaching_center_id)
  references subjects (id, coaching_center_id) on delete restrict;

alter table enrollments drop constraint enrollments_batch_id_fkey;
alter table enrollments
  add constraint enrollments_batch_id_center_fkey
  foreign key (batch_id, coaching_center_id)
  references batches (id, coaching_center_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------

alter table attendance_sessions drop constraint attendance_sessions_batch_id_fkey;
alter table attendance_sessions
  add constraint attendance_sessions_batch_id_center_fkey
  foreign key (batch_id, coaching_center_id)
  references batches (id, coaching_center_id) on delete cascade;

alter table attendance_sessions drop constraint attendance_sessions_teacher_id_fkey;
alter table attendance_sessions
  add constraint attendance_sessions_teacher_id_center_fkey
  foreign key (teacher_id, coaching_center_id)
  references teachers (id, coaching_center_id) on delete set null (teacher_id);

alter table attendance_records drop constraint attendance_records_session_id_fkey;
alter table attendance_records
  add constraint attendance_records_session_id_center_fkey
  foreign key (session_id, coaching_center_id)
  references attendance_sessions (id, coaching_center_id) on delete cascade;

alter table attendance_records drop constraint attendance_records_enrollment_id_fkey;
alter table attendance_records
  add constraint attendance_records_enrollment_id_center_fkey
  foreign key (enrollment_id, coaching_center_id)
  references enrollments (id, coaching_center_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Exams and marks
-- ---------------------------------------------------------------------------

alter table exams drop constraint exams_subject_id_fkey;
alter table exams
  add constraint exams_subject_id_center_fkey
  foreign key (subject_id, coaching_center_id)
  references subjects (id, coaching_center_id) on delete restrict;

alter table exams drop constraint exams_batch_id_fkey;
alter table exams
  add constraint exams_batch_id_center_fkey
  foreign key (batch_id, coaching_center_id)
  references batches (id, coaching_center_id) on delete cascade;

alter table exams drop constraint exams_teacher_id_fkey;
alter table exams
  add constraint exams_teacher_id_center_fkey
  foreign key (teacher_id, coaching_center_id)
  references teachers (id, coaching_center_id) on delete set null (teacher_id);

alter table exams drop constraint exams_exam_type_id_fkey;
alter table exams
  add constraint exams_exam_type_id_center_fkey
  foreign key (exam_type_id, coaching_center_id)
  references exam_types (id, coaching_center_id) on delete set null (exam_type_id);

alter table exam_results drop constraint exam_results_exam_id_fkey;
alter table exam_results
  add constraint exam_results_exam_id_center_fkey
  foreign key (exam_id, coaching_center_id)
  references exams (id, coaching_center_id) on delete cascade;

alter table exam_results drop constraint exam_results_enrollment_id_fkey;
alter table exam_results
  add constraint exam_results_enrollment_id_center_fkey
  foreign key (enrollment_id, coaching_center_id)
  references enrollments (id, coaching_center_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Student fees — money students pay the centre.
-- ---------------------------------------------------------------------------

alter table fee_invoices drop constraint fee_invoices_student_id_fkey;
alter table fee_invoices
  add constraint fee_invoices_student_id_center_fkey
  foreign key (student_id, coaching_center_id)
  references students (id, coaching_center_id) on delete cascade;

alter table fee_invoices drop constraint fee_invoices_enrollment_id_fkey;
alter table fee_invoices
  add constraint fee_invoices_enrollment_id_center_fkey
  foreign key (enrollment_id, coaching_center_id)
  references enrollments (id, coaching_center_id) on delete set null (enrollment_id);

alter table fee_payments drop constraint fee_payments_invoice_id_fkey;
alter table fee_payments
  add constraint fee_payments_invoice_id_center_fkey
  foreign key (invoice_id, coaching_center_id)
  references fee_invoices (id, coaching_center_id) on delete cascade;

alter table fee_payments drop constraint fee_payments_student_id_fkey;
alter table fee_payments
  add constraint fee_payments_student_id_center_fkey
  foreign key (student_id, coaching_center_id)
  references students (id, coaching_center_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Notices
-- ---------------------------------------------------------------------------

alter table notices drop constraint notices_branch_id_fkey;
alter table notices
  add constraint notices_branch_id_center_fkey
  foreign key (branch_id, coaching_center_id)
  references branches (id, coaching_center_id) on delete cascade;

alter table notices drop constraint notices_batch_id_fkey;
alter table notices
  add constraint notices_batch_id_center_fkey
  foreign key (batch_id, coaching_center_id)
  references batches (id, coaching_center_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- SMS. These run as service_role from a scheduled worker, with no RLS in the
-- path at all, so a foreign key is the only thing that will be checking.
-- ---------------------------------------------------------------------------

alter table sms_logs drop constraint sms_logs_dispatch_id_fkey;
alter table sms_logs
  add constraint sms_logs_dispatch_id_center_fkey
  foreign key (dispatch_id, coaching_center_id)
  references sms_dispatches (id, coaching_center_id) on delete set null (dispatch_id);

alter table sms_logs drop constraint sms_logs_student_id_fkey;
alter table sms_logs
  add constraint sms_logs_student_id_center_fkey
  foreign key (student_id, coaching_center_id)
  references students (id, coaching_center_id) on delete set null (student_id);

-- The one that would send a result SMS to the wrong family.
alter table sms_logs drop constraint sms_logs_guardian_id_fkey;
alter table sms_logs
  add constraint sms_logs_guardian_id_center_fkey
  foreign key (guardian_id, coaching_center_id)
  references guardians (id, coaching_center_id) on delete set null (guardian_id);

-- ---------------------------------------------------------------------------
-- Platform billing — money the centre pays us.
-- ---------------------------------------------------------------------------

alter table payments drop constraint payments_subscription_id_fkey;
alter table payments
  add constraint payments_subscription_id_center_fkey
  foreign key (subscription_id, coaching_center_id)
  references subscriptions (id, coaching_center_id) on delete set null (subscription_id);

alter table sms_credit_ledger drop constraint sms_credit_ledger_dispatch_id_fkey;
alter table sms_credit_ledger
  add constraint sms_credit_ledger_dispatch_id_center_fkey
  foreign key (dispatch_id, coaching_center_id)
  references sms_dispatches (id, coaching_center_id) on delete set null (dispatch_id);

alter table sms_credit_ledger drop constraint sms_credit_ledger_payment_id_fkey;
alter table sms_credit_ledger
  add constraint sms_credit_ledger_payment_id_center_fkey
  foreign key (payment_id, coaching_center_id)
  references payments (id, coaching_center_id) on delete set null (payment_id);
