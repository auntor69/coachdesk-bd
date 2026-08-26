-- CoachDesk BD — which of the three ways to reach this family actually works.
--
-- Every chase in this product is a deep link the owner taps: SMS, WhatsApp, or a
-- call. The three chips have sat in one fixed order since they were built, which
-- is fine for the first family and wrong by the twentieth. Every centre has
-- parents who never open a text and answer WhatsApp within the minute, and
-- parents on a feature phone for whom WhatsApp is not a thing at all. The owner
-- learns this in week one and has had nowhere to write it down, so they have been
-- re-remembering it thirty times a month.
--
-- WHY THE OWNER TELLS US, AND WE DO NOT GUESS.
--
-- There is no legitimate API that answers "does this number have WhatsApp" — the
-- Business API will not say before you send, and the unofficial on-WhatsApp checks
-- get a number banned. So a "has WhatsApp" badge would be a guess, and a wrong
-- guess costs a parent a message they never got.
--
-- Inferring it from fee_reminders was the other candidate and it is worse than it
-- looks. The signal would be "sent WhatsApp, then sent SMS for the same invoice",
-- read as WhatsApp not landing. But the overwhelmingly commoner reason for a
-- second channel is that the family has not paid yet, which is exactly what a
-- diligent owner escalates through — so the product would learn to demote
-- WhatsApp for the families it works best on. A frequency count has the mirror
-- problem: it measures the owner's own habit, and if that is the signal then
-- asking them outright is both cheaper and honest.
--
-- NULL IS THE FOURTH ANSWER, and it is the default: nobody has said. Not a fourth
-- enum value, because "we have no information" is the absence of a preference
-- rather than a kind of preference, and every query wanting a real channel would
-- have had to special-case it anyway.
--
-- WHAT THIS DOES NOT DO: hide a chip. All three stay on every row for every
-- family, including one marked call-only — the number a parent gave the centre is
-- the number the centre may use, and a chip that vanished would read as the app
-- being broken. The mark moves one chip to the front and colours it. See
-- src/lib/students/channel.ts.
--
-- No new grant. The column-level UPDATE whitelist that 20260811000004 installed is
-- on coaching_centers, not on students, so this column is writable through the
-- students policies alone — owner and manager, and no teacher, which is correct:
-- how a centre talks to a family is the owner's relationship, not a batch's.

alter table students
  add column preferred_channel outreach_channel;

comment on column students.preferred_channel is
  'How this family prefers to be reached, as the owner has observed it. Null '
  'means nobody has said. Orders the chase chips; never hides one, and never '
  'silences anything — sms_opt_out is the only column that can do that.';

-- ---------------------------------------------------------------------------
-- The two views the chase chips read from, each gaining the one column.
--
-- Passengers, exactly like guardian_phone and sms_opt_out beside them: neither
-- view computes anything from this. It is carried so that the three screens
-- rendering chips do not each need a second round trip on a 3G phone.
--
-- Restated in full rather than altered, because Postgres has no "add a column to
-- a view". Both bodies below are byte-identical to the originals apart from the
-- one new line and "or replace" — composed by script from 20260811000006 and
-- 20260811000021 rather than retyped, and diffed against them afterwards.
--
-- THE NEW COLUMN GOES LAST in student_progress_week, not beside sms_opt_out where
-- it belongs. create or replace view may only append: it insists every existing
-- column keep its name, its type and its position. That is a constraint worth
-- obeying loudly rather than working around, since the way around it is dropping
-- a view the fee board is built on and recreating it with its grants.
--
-- security_invoker is restated on both. It is the difference between a view and a
-- data breach — check-migrations.mjs fails the build over it — so this migration
-- says it out loud rather than trusting a replace to carry it.
-- ---------------------------------------------------------------------------

create or replace view fee_invoice_balances with (security_invoker = true) as
select
  i.id,
  i.coaching_center_id,
  i.student_id,
  i.enrollment_id,
  i.period_month,
  i.due_date,
  i.amount_bdt,
  i.discount_bdt,
  -- What the family actually owes, after any discount the centre granted.
  (i.amount_bdt - i.discount_bdt) as net_bdt,
  coalesce(p.paid_bdt, 0) as paid_bdt,
  (i.amount_bdt - i.discount_bdt) - coalesce(p.paid_bdt, 0) as remaining_bdt,
  i.note,
  i.voided_at,
  s.name as student_name,
  s.student_code,
  s.guardian_phone,
  s.sms_opt_out,
  s.preferred_channel
from fee_invoices i
-- The tenant column travels with this join for the same reason 20260811000005
-- put it in every foreign key: a join on id alone would be a sideways reference.
join students s
  on s.id = i.student_id
 and s.coaching_center_id = i.coaching_center_id
left join (
  -- Refunds are stored as negative payments (fee_payments allows any non-zero
  -- amount), so summing is all that is needed to net them off. A refund is not
  -- a deletion: the original payment stays on the record, and the board shows
  -- the family owing money again.
  select invoice_id, coaching_center_id, sum(amount_bdt) as paid_bdt
  from fee_payments
  group by invoice_id, coaching_center_id
) p
  on p.invoice_id = i.id
 and p.coaching_center_id = i.coaching_center_id;

create or replace view student_progress_week with (security_invoker = true) as
with bounds as (
  select
    (now() at time zone 'Asia/Dhaka')::date as week_to,
    -- Inclusive at both ends, so this is seven days and not eight.
    (now() at time zone 'Asia/Dhaka')::date - 6 as week_from
),

-- Attendance in the window. 'excused' is left out of the denominator rather than
-- counted as an absence: a centre that marked a child excused has already decided
-- the absence was legitimate, and telling their parent they missed a class is the
-- one sentence in this message that would get the feature switched off.
att as (
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
  -- Through the enrolment, because that is what an attendance record points at.
  -- Its status is deliberately unfiltered, exactly as in student_risk: a student
  -- dropped from a batch on Wednesday still attended it on Monday, and erasing
  -- that would make the week look worse than it was.
  join enrollments e
    on e.id = r.enrollment_id
   and e.coaching_center_id = r.coaching_center_id
  where s.session_date between b.week_from and b.week_to
  group by e.coaching_center_id, e.student_id
),

-- Every result in the window, once, for the two CTEs below.
exam_rows as (
  select
    e.coaching_center_id,
    e.student_id,
    er.is_absent,
    -- Percentage of that exam's own total: 34 out of 40 and 34 out of 100 are not
    -- the same week. total_marks is checked > 0 at insert, so no zero divide.
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

-- The one the message names, newest first, absences excluded from the ranking.
-- "What they scored" means the last score they actually got; ranking an absence
-- first would leave the marks line empty for a child who sat two tests and missed
-- the third. created_at breaks the tie, because two exams can share a date.
exam_ranked as (
  select
    coaching_center_id, student_id, obtained_marks, total_marks, title, exam_date,
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
    count(*) filter (where not is_absent)::int as taken,
    count(*) filter (where is_absent)::int as missed,
    -- Averaged across the week's tests, as a percentage of each one's own total.
    -- Absences are excluded rather than scored zero — an absent student has no
    -- mark by constraint, and a zero would be a claim about their ability.
    round(avg(pct) filter (where not is_absent))::int as avg_pct
  from exam_rows
  group by coaching_center_id, student_id
),

-- When this family was last told anything, by anybody at the centre. Left joined
-- below, so a student never messaged reads as null rather than dropping out.
told as (
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
  -- Spelled out rather than left as counted − present for the screen to subtract.
  -- Absences are the figure a parent argues about, and two screens arriving at it
  -- two ways is how they end up disagreeing by one.
  coalesce(a.counted, 0) - coalesce(a.present, 0) as sessions_absent,
  coalesce(a.late, 0) as sessions_late,
  coalesce(a.excused, 0) as sessions_excused,

  coalesce(m.taken, 0)  as exams_taken,
  coalesce(m.missed, 0) as exams_missed,
  m.avg_pct as marks_pct,

  -- The single result the message names, so the page does not have to pick one.
  r.title      as last_exam_title,
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
-- Active students only. A dropped student's guardian does not want a weekly note
-- about a seat their child left.
where st.status = 'active'
  and app.is_staff_admin(st.coaching_center_id);
