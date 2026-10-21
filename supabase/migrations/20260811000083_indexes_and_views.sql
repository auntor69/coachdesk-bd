-- CoachDesk BD — Missing composite/FK indexes, view CTE pushdown (`not materialized`),
-- and ledger timestamp monotonicity (PERF-02, PERF-03).

-- ---------------------------------------------------------------------------
-- 1. Missing composite and foreign-key indexes (PERF-02)
-- ---------------------------------------------------------------------------

-- Fee board, month-close, and branch/centre finance views filter fee_invoices by
-- (coaching_center_id, period_month) where voided_at is null.
create index if not exists fee_invoices_center_month_idx
  on public.fee_invoices (coaching_center_id, period_month)
  where voided_at is null;

-- fee_invoice_balances and fee_charges_category_month group fee_payments by
-- (invoice_id, coaching_center_id) and sum amount_bdt; covering amount_bdt turns
-- that aggregation into an index-only scan per tenant.
create index if not exists fee_payments_center_invoice_idx
  on public.fee_payments (coaching_center_id, invoice_id)
  include (amount_bdt);

-- Student profile (/students/[studentId]) and self-portal (/me) list payments for
-- one student newest first.
create index if not exists fee_payments_student_idx
  on public.fee_payments (student_id, paid_at desc);

-- batch_attendance_monthly, student_risk, and student_progress_week join
-- attendance_records on (session_id, coaching_center_id) and read enrollment_id
-- and status.
create index if not exists attendance_records_center_session_idx
  on public.attendance_records (coaching_center_id, session_id, enrollment_id)
  include (status);

-- student_risk and student_progress_week join exam_results on
-- (exam_id, coaching_center_id) and read enrollment_id, obtained_marks, is_absent.
create index if not exists exam_results_center_exam_idx
  on public.exam_results (coaching_center_id, exam_id, enrollment_id)
  include (obtained_marks, is_absent);

-- Tenant-scoped enrollment joins in views and roster lookups.
create index if not exists enrollments_center_student_idx
  on public.enrollments (coaching_center_id, student_id);

-- Roster and student export queries order by (name, id) within a centre.
create index if not exists students_center_name_idx
  on public.students (coaching_center_id, name, id);

-- Subject and exam-type usage checks (readSubjectUses, readExamTypeUses) and
-- ON DELETE RESTRICT / SET NULL foreign key checks.
create index if not exists batches_center_subject_idx
  on public.batches (coaching_center_id, subject_id)
  where subject_id is not null;

create index if not exists enrollments_center_subject_idx
  on public.enrollments (coaching_center_id, subject_id)
  where subject_id is not null;

create index if not exists exams_center_subject_idx
  on public.exams (coaching_center_id, subject_id);

create index if not exists exams_center_exam_type_idx
  on public.exams (coaching_center_id, exam_type_id)
  where exam_type_id is not null;

create index if not exists teacher_subjects_center_subject_idx
  on public.teacher_subjects (coaching_center_id, subject_id);

create index if not exists teacher_permissions_center_teacher_idx
  on public.teacher_permissions (coaching_center_id, teacher_id);

create index if not exists batch_schedules_center_batch_idx
  on public.batch_schedules (coaching_center_id, batch_id);

-- Branch-scoped tenant lookups across staff, teaching, and notices.
create index if not exists teachers_center_branch_idx
  on public.teachers (coaching_center_id, branch_id)
  where active;

create index if not exists employees_center_branch_idx
  on public.employees (coaching_center_id, branch_id)
  where active;

create index if not exists batches_center_branch_idx
  on public.batches (coaching_center_id, branch_id)
  where active;

create index if not exists notices_center_branch_idx
  on public.notices (coaching_center_id, branch_id, published_at desc);

-- Align both trailing sort directions on billing_ledger_center_idx so forward scans
-- (created_at desc, id desc) and backward scans (created_at asc, id asc in
-- platform_reconciliation) both walk the index without a sort step.
drop index if exists public.billing_ledger_center_idx;

create index billing_ledger_center_idx
  on public.billing_ledger (coaching_center_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 2. Strict per-centre timestamp monotonicity on billing_ledger
--
-- When two ledger rows are inserted in the same sub-microsecond window inside a
-- single transaction (e.g. settle_billing catching up multiple days), clock_timestamp()
-- can tie on fast clocks, and random v4 UUIDs do not preserve insertion order.
-- Under the per-centre advisory lock already held by app.ledger_open_balance(),
-- bumping created_at by at least 1 microsecond past the centre's previous max(created_at)
-- guarantees that (created_at, id) always matches exact insertion order.
-- ---------------------------------------------------------------------------

create or replace function app.ledger_open_balance()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  running bigint;
  last_at timestamptz;
begin
  if new.balance_before is not null or new.balance_after is not null then
    raise exception
      'balance_before and balance_after are computed from the ledger and cannot be '
      'supplied by %', current_user
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('billing_ledger.balance'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  select coalesce(pg_catalog.sum(l.amount_poisha), 0),
         pg_catalog.max(l.created_at)
    into running, last_at
    from public.billing_ledger l
   where l.coaching_center_id = new.coaching_center_id;

  if last_at is not null and new.created_at <= last_at then
    new.created_at := last_at + '1 microsecond'::interval;
  end if;

  new.balance_before := running;
  new.balance_after := running + new.amount_poisha;

  return new;
end;
$$;

revoke all on function app.ledger_open_balance() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Inline multi-reference CTEs in student_risk and student_progress_week (PERF-03)
--
-- In PostgreSQL 12+, a CTE referenced more than once (such as `exam_rows`, read by
-- both `exam_ranked` and `missed`/`marks`) is materialized by default before outer
-- query predicates are pushed down. Marking `exam_rows` as `not materialized`
-- allows the planner to inline it and push the caller's `coaching_center_id` filter
-- into the index scan on `exams_center_idx`.
-- ---------------------------------------------------------------------------

create or replace view public.student_risk with (security_invoker = true) as
with bounds as not materialized (
  select
    (now() at time zone 'Asia/Dhaka')::date as today,
    (now() at time zone 'Asia/Dhaka')::date - 30  as recent_from,
    (now() at time zone 'Asia/Dhaka')::date - 60  as prior_from,
    (now() at time zone 'Asia/Dhaka')::date - 120 as exam_from
),
att as not materialized (
  select
    e.coaching_center_id,
    e.student_id,
    count(*) filter (
      where s.session_date > b.recent_from and r.status <> 'excused'
    )::int as recent_counted,
    count(*) filter (
      where s.session_date > b.recent_from and r.status in ('present', 'late')
    )::int as recent_here,
    count(*) filter (
      where s.session_date <= b.recent_from and r.status <> 'excused'
    )::int as prior_counted,
    count(*) filter (
      where s.session_date <= b.recent_from and r.status in ('present', 'late')
    )::int as prior_here
  from attendance_records r
  cross join bounds b
  join attendance_sessions s
    on s.id = r.session_id
   and s.coaching_center_id = r.coaching_center_id
  join enrollments e
    on e.id = r.enrollment_id
   and e.coaching_center_id = r.coaching_center_id
  where s.session_date > b.prior_from
  group by e.coaching_center_id, e.student_id
),
exam_rows as not materialized (
  select
    e.coaching_center_id,
    e.student_id,
    er.is_absent,
    case
      when er.is_absent then null
      else 100.0 * er.obtained_marks / x.total_marks
    end as pct,
    x.exam_date,
    x.created_at
  from exam_results er
  cross join bounds b
  join exams x
    on x.id = er.exam_id
   and x.coaching_center_id = er.coaching_center_id
  join enrollments e
    on e.id = er.enrollment_id
   and e.coaching_center_id = er.coaching_center_id
  where x.exam_date > b.exam_from
),
exam_ranked as not materialized (
  select
    coaching_center_id,
    student_id,
    pct,
    row_number() over (
      partition by coaching_center_id, student_id
      order by exam_date desc, created_at desc
    ) as rn
  from exam_rows
  where not is_absent
),
marks as not materialized (
  select
    coaching_center_id,
    student_id,
    max(pct) filter (where rn = 1) as latest_pct,
    avg(pct) filter (where rn > 1) as earlier_pct,
    count(*) filter (where rn > 1)::int as earlier_n
  from exam_ranked
  group by coaching_center_id, student_id
),
missed as not materialized (
  select
    coaching_center_id,
    student_id,
    count(*)::int as n
  from exam_rows
  where is_absent
  group by coaching_center_id, student_id
),
fees as not materialized (
  select
    fb.coaching_center_id,
    fb.student_id,
    max(b.today - fb.due_date)::int as days_late,
    sum(fb.remaining_bdt) as owed_bdt
  from fee_invoice_balances fb
  cross join bounds b
  where fb.voided_at is null
    and fb.remaining_bdt > 0
    and fb.due_date < b.today
  group by fb.coaching_center_id, fb.student_id
),
flagged as not materialized (
  select
    st.coaching_center_id,
    st.id   as student_id,
    st.name as student_name,
    st.student_code,
    st.guardian_phone,
    st.sms_opt_out,

    coalesce(a.recent_counted, 0) as att_marks,
    round(100.0 * a.recent_here / nullif(a.recent_counted, 0))::int as att_pct,
    coalesce(a.prior_counted, 0) as att_prev_marks,
    round(100.0 * a.prior_here / nullif(a.prior_counted, 0))::int as att_prev_pct,

    round(m.latest_pct)::int  as marks_pct,
    round(m.earlier_pct)::int as marks_prev_pct,
    coalesce(m.earlier_n, 0)  as marks_prev_n,
    coalesce(x.n, 0)          as exams_missed,

    coalesce(f.days_late, 0) as fee_days_late,
    coalesce(f.owed_bdt, 0)  as fee_owed_bdt,

    coalesce(
      a.recent_counted >= 4
      and 100.0 * a.recent_here / a.recent_counted < 70,
      false
    ) as att_low,

    coalesce(
      a.recent_counted >= 4
      and a.prior_counted >= 4
      and 100.0 * a.recent_here / a.recent_counted
          <= 100.0 * a.prior_here / a.prior_counted - 20,
      false
    ) as att_fell,

    coalesce(m.latest_pct < 40, false) as marks_low,

    coalesce(
      m.earlier_n >= 2 and m.latest_pct <= m.earlier_pct - 15,
      false
    ) as marks_fell,

    coalesce(x.n >= 2, false) as marks_missed,

    coalesce(f.days_late >= 7, false) as fee_flag

  from students st
  left join att   a on a.student_id = st.id and a.coaching_center_id = st.coaching_center_id
  left join marks m on m.student_id = st.id and m.coaching_center_id = st.coaching_center_id
  left join missed x on x.student_id = st.id and x.coaching_center_id = st.coaching_center_id
  left join fees  f on f.student_id = st.id and f.coaching_center_id = st.coaching_center_id
  where st.status = 'active'
    and app.is_staff_admin(st.coaching_center_id)
)
select
  coaching_center_id,
  student_id,
  student_name,
  student_code,
  guardian_phone,
  sms_opt_out,
  att_marks,
  att_pct,
  att_prev_marks,
  att_prev_pct,
  marks_pct,
  marks_prev_pct,
  marks_prev_n,
  exams_missed,
  fee_days_late,
  fee_owed_bdt,
  att_low,
  att_fell,
  marks_low,
  marks_fell,
  marks_missed,
  (att_low or att_fell) as attendance_flag,
  (marks_low or marks_fell or marks_missed) as marks_flag,
  fee_flag,
  (
    (att_low or att_fell)::int
    + (marks_low or marks_fell or marks_missed)::int
    + fee_flag::int
  ) as signals
from flagged
where att_low or att_fell or marks_low or marks_fell or marks_missed or fee_flag;

grant select on public.student_risk to authenticated;

create or replace view public.student_progress_week with (security_invoker = true) as
with bounds as not materialized (
  select
    (now() at time zone 'Asia/Dhaka')::date as week_to,
    (now() at time zone 'Asia/Dhaka')::date - 6 as week_from
),
att as not materialized (
  select
    e.coaching_center_id,
    e.student_id,
    count(*) filter (where r.status <> 'excused')::int as counted,
    count(*) filter (where r.status in ('present', 'late'))::int as present,
    count(*) filter (where r.status = 'late')::int as late,
    count(*) filter (where r.status = 'excused')::int as excused
  from attendance_records r
  cross join bounds b
  join attendance_sessions s
    on s.id = r.session_id
   and s.coaching_center_id = r.coaching_center_id
  join enrollments e
    on e.id = r.enrollment_id
   and e.coaching_center_id = r.coaching_center_id
  where s.session_date between b.week_from and b.week_to
  group by e.coaching_center_id, e.student_id
),
exam_rows as not materialized (
  select
    e.coaching_center_id,
    e.student_id,
    er.is_absent,
    case when er.is_absent then null
         else 100.0 * er.obtained_marks / x.total_marks
    end as pct,
    er.obtained_marks,
    x.total_marks,
    x.title,
    x.exam_date,
    x.created_at
  from exam_results er
  cross join bounds b
  join exams x
    on x.id = er.exam_id
   and x.coaching_center_id = er.coaching_center_id
  join enrollments e
    on e.id = er.enrollment_id
   and e.coaching_center_id = er.coaching_center_id
  where x.exam_date between b.week_from and b.week_to
),
exam_ranked as not materialized (
  select
    coaching_center_id, student_id, obtained_marks, total_marks, title, exam_date,
    row_number() over (
      partition by coaching_center_id, student_id
      order by exam_date desc, created_at desc
    ) as rn
  from exam_rows
  where not is_absent
),
marks as not materialized (
  select
    coaching_center_id,
    student_id,
    count(*) filter (where not is_absent)::int as taken,
    count(*) filter (where is_absent)::int as missed,
    round(avg(pct) filter (where not is_absent))::int as avg_pct
  from exam_rows
  group by coaching_center_id, student_id
),
told as not materialized (
  select
    coaching_center_id,
    student_id,
    max(created_at) as last_sent_at
  from progress_updates
  group by coaching_center_id, student_id
)
select
  st.coaching_center_id,
  st.id   as student_id,
  st.name as student_name,
  st.student_code,
  st.guardian_phone,
  st.sms_opt_out,

  b.week_from,
  b.week_to,

  coalesce(a.counted, 0) as sessions_counted,
  coalesce(a.present, 0) as sessions_present,
  coalesce(a.counted, 0) - coalesce(a.present, 0) as sessions_absent,
  coalesce(a.late, 0) as sessions_late,
  coalesce(a.excused, 0) as sessions_excused,

  coalesce(m.taken, 0)  as exams_taken,
  coalesce(m.missed, 0) as exams_missed,
  m.avg_pct as marks_pct,

  r.title          as last_exam_title,
  r.obtained_marks as last_exam_obtained,
  r.total_marks    as last_exam_total,
  r.exam_date      as last_exam_date,

  t.last_sent_at,

  st.preferred_channel

from students st
cross join bounds b
left join att   a on a.student_id = st.id and a.coaching_center_id = st.coaching_center_id
left join marks m on m.student_id = st.id and m.coaching_center_id = st.coaching_center_id
left join exam_ranked r
       on r.student_id = st.id
      and r.coaching_center_id = st.coaching_center_id
      and r.rn = 1
left join told  t on t.student_id = st.id and t.coaching_center_id = st.coaching_center_id
where st.status = 'active'
  and app.is_staff_admin(st.coaching_center_id);

grant select on public.student_progress_week to authenticated;
