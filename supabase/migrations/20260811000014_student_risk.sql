-- ---------------------------------------------------------------------------
-- Which students are quietly leaving — the masterplan's early warning.
--
-- Tier 2 names it "at-risk student flags: attendance falling + marks falling +
-- fees late. The owner's early warning before a student quietly drops out."
-- That is a retention feature aimed at the centre's own retention: a student who
-- stops coming does not announce it, they just miss a Thursday, then a Sunday,
-- then a test, then the month's fee — and an owner running four batches finds out
-- when the seat has been empty for five weeks and the family has already paid
-- somebody else. Each of those three facts is already in this database. None of
-- them is on any screen next to the other two, which is the only place they mean
-- anything.
--
-- WHY ONE VIEW AND NOT THREE QUERIES IN THE PAGE
--
-- Because the answer is a join across attendance, exams and fees, and doing it in
-- JavaScript means fetching every attendance record, every mark and every invoice
-- of every student to throw almost all of them away. A centre with 200 students
-- taking class 20 times a month is 4,000 attendance rows for one signal on one
-- screen. Postgres can count them where they already are and hand back one row
-- per student who needs a conversation — which on a 3G phone is the difference
-- between a screen and a spinner.
--
-- WHY THE THRESHOLDS LIVE HERE AND NOWHERE ELSE
--
-- The flags are computed in SQL and the app only renders them. It would be
-- natural to expose the raw percentages and let the page decide what counts as
-- low, but then "below 70%" exists in two languages and drifts the first time one
-- is edited — and the drift is invisible, because both screens still render
-- perfectly, just disagreeing about who is at risk. So the numbers below are the
-- only copy of themselves. The app reads `attendance_flag` and reads the raw
-- figures purely to explain it in words ("55%, was 88%").
--
-- WHAT COUNTS AS A SIGNAL, AND WHY THESE NUMBERS
--
-- Attendance — the last 30 days against the 30 before them. Flagged when the
-- recent rate is under 70%, or when it fell 20 points or more from the previous
-- month. Both, because they catch different students: an absolute 55% is a
-- problem whether or not it fell, and a drop from 95% to 72% is a student
-- drifting even though 72% is not a bad number. The 20-point floor is what keeps
-- ordinary noise out — a batch running twice a week is 8 sessions a month, where
-- one extra absence moves the rate 12 points on its own.
--
-- Four marks minimum in the window, or the percentage is not a measurement. Two
-- sessions attended out of three is 67% and flags a student who has missed one
-- class in their life. The prior window carries its own minimum for the same
-- reason: comparing this month against a single mark from last month is comparing
-- against a coin toss.
--
-- Marks — the latest mark against the average of the earlier ones in the last 120
-- days, as a percentage of each exam's own total, because a 34 out of 40 and a 34
-- out of 100 are not the same fact. Flagged under 40%, which is a typical pass
-- mark here, or on a fall of 15 points from an average of at least two earlier
-- exams. One mark is enough for the absolute test and deliberately not enough for
-- the trend: a single earlier exam makes "falling" mean "did worse than that one
-- time", and half of all students do.
--
-- Missing two exams in the window is its own signal, counted separately and never
-- averaged in. An absent student has no mark by constraint, and treating the
-- absence as a zero would be a lie about their ability that lands in the same
-- column as a real result.
--
-- Fees — 7 days past a due date, which is `LATE_AFTER` in
-- src/lib/fees/reminder-schedule.ts, and the same number on purpose. The reminder
-- engine and this view must agree about what "late" means, or an owner gets a
-- student flagged as at-risk over a fee the worklist does not consider late yet.
-- Not one day past: a coaching centre collects through the first week of the
-- month, and flagging on day one would put every family on this list every month
-- and teach the owner to ignore it.
--
-- WHY ONLY STUDENTS WITH A SIGNAL
--
-- This is a worklist, not a report. A row per healthy student is a row an owner
-- scrolls past, and it is most of them — the screen is worth opening precisely
-- because it is usually short. "How many students are fine" is already answerable
-- from the student count on the dashboard.
--
-- WHY STAFF-ADMIN ONLY
--
-- The same edge as batch_attendance_monthly, and sharper. security_invoker means
-- the caller's own RLS decides which rows reach the aggregates, so this view read
-- by a teacher would silently answer a different question under the same name —
-- their batches' share of a student's attendance, their subject's marks — and
-- report it as the student's whole picture. A teacher-facing early warning is a
-- legitimate feature and a different view with a different name.
--
-- It is also a file on a child that combines three sensitive facts, so it stays
-- with the people who run the centre. Note that this is a role gate and not a
-- plan gate: a solo teacher on teacher_free owns their centre, so they are an
-- owner here and get the same screen a 300-student centre does.
--
-- WHY now() AND NOT A PARAMETER
--
-- A view cannot take one. Every other date in this schema that Postgres writes
-- for itself uses the same expression — students.admitted_on defaults to it — and
-- the alternative is a function, which would put a set-returning call in the
-- middle of the page's Promise.all for no gain. The windows are 30 and 120 days
-- wide; nothing here turns on which side of midnight the request landed.
-- ---------------------------------------------------------------------------

create view student_risk with (security_invoker = true) as
with bounds as (
  select
    (now() at time zone 'Asia/Dhaka')::date as today,
    (now() at time zone 'Asia/Dhaka')::date - 30  as recent_from,
    (now() at time zone 'Asia/Dhaka')::date - 60  as prior_from,
    (now() at time zone 'Asia/Dhaka')::date - 120 as exam_from
),

-- Attendance in both windows in one pass. `filter` on the same set rather than
-- two scans: the rows for days 1–30 and 31–60 come off the same index range.
att as (
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
  -- The tenant column travels with every join here, same as everywhere else in
  -- this schema: a join on id alone would be a sideways reference.
  join attendance_sessions s
    on s.id = r.session_id
   and s.coaching_center_id = r.coaching_center_id
  -- Through the enrolment, because that is what an attendance record points at.
  -- Its status is deliberately not filtered: a student who was dropped from a
  -- batch last week still attended it the week before, and erasing that history
  -- would make their rate improve at the moment they stopped coming.
  join enrollments e
    on e.id = r.enrollment_id
   and e.coaching_center_id = r.coaching_center_id
  where s.session_date > b.prior_from
  group by e.coaching_center_id, e.student_id
),

-- Every mark and every exam absence in the window, once, for the two CTEs below.
-- 'late' and 'excused' have no meaning here; an exam row is a mark or an absence.
exam_rows as (
  select
    e.coaching_center_id,
    e.student_id,
    er.is_absent,
    -- Percentage of that exam's own total. total_marks is checked > 0 at insert,
    -- so this cannot divide by zero.
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

-- Newest mark first, absences excluded from the ranking. "Their latest mark"
-- means the last score they actually got: if the most recent exam was one they
-- missed, the mark before it is still the last thing known about them, and
-- ranking the absence first would leave latest_pct null and silence the signal.
--
-- created_at breaks the tie, because two exams can share a date and one of them
-- has to be the later one.
exam_ranked as (
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

marks as (
  select
    coaching_center_id,
    student_id,
    -- max() over a single row, because rn = 1 matches exactly one.
    max(pct) filter (where rn = 1) as latest_pct,
    avg(pct) filter (where rn > 1) as earlier_pct,
    count(*) filter (where rn > 1)::int as earlier_n
  from exam_ranked
  group by coaching_center_id, student_id
),

missed as (
  select
    coaching_center_id,
    student_id,
    count(*)::int as n
  from exam_rows
  where is_absent
  group by coaching_center_id, student_id
),

-- Read through fee_invoice_balances rather than recomputing, for the reason
-- spelled out in 20260811000006 and repeated on the dashboard: two screens
-- arriving at the same taka figure two different ways is how an owner finds a
-- discrepancy and stops trusting both. It is security_invoker too, so the
-- caller's policies on invoices, payments and students all still apply.
fees as (
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

flagged as (
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

    -- coalesce around each one, because a student with no attendance at all
    -- leaves the whole comparison null and null is not false in a WHERE.
    -- No marks in the window is not a signal: it means the batch has not been
    -- tested, which is a fact about the centre and not about the child.
    --
    -- One boolean per arm rather than one per signal, because the screen has to
    -- say *why*. "55%, was 88%" and "55% attendance" are different sentences, and
    -- a page deciding between them from the percentages would be a second copy of
    -- the 70 and the 20 living in TypeScript — the exact drift this view exists
    -- to prevent. The arms are ORed back together as `attendance_flag` and
    -- `marks_flag` below, so a signal is still a signal however many ways it fired.
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
  -- Active students only. A dropped student is not at risk of leaving; they have
  -- left, and putting them on the worklist is asking the owner to make a call
  -- they already made.
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

  -- The arms, for the sentence the screen writes.
  att_low,
  att_fell,
  marks_low,
  marks_fell,
  marks_missed,

  -- And the signals, for the count and the colour. A student can be flagged twice
  -- over on attendance — under 70% *and* twenty points down — and that is still one
  -- thing wrong, so the arms are ORed rather than added. Otherwise a single drifting
  -- student would outrank one whose attendance, marks and fees are all going at
  -- once, which is backwards.
  (att_low or att_fell) as attendance_flag,
  (marks_low or marks_fell or marks_missed) as marks_flag,
  fee_flag,
  -- How many of the three fired. The app turns this into a word and a colour;
  -- keeping the count here rather than a text level means adding a fourth signal
  -- later does not have to rename the three that exist.
  (
    (att_low or att_fell)::int
    + (marks_low or marks_fell or marks_missed)::int
    + fee_flag::int
  ) as signals
from flagged
where att_low or att_fell or marks_low or marks_fell or marks_missed or fee_flag;

comment on view student_risk is
  'One row per active student showing at least one of three drift signals: '
  'attendance in the last 30 days, marks in the last 120, and a fee 7+ days '
  'past due. Thresholds live in this view and nowhere else, so no screen can '
  'disagree about who is at risk. security_invoker, and staff-admin only — the '
  'aggregate would mean something else entirely read by a teacher.';

grant select on student_risk to authenticated;
