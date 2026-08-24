-- ---------------------------------------------------------------------------
-- The weekly guardian progress summary — the last unbuilt thing Pro is sold on.
--
-- MASTERPLAN Tier 2: "Weekly guardian progress summary, generated from real
-- attendance and marks data." `parentSummary: true` has been sitting in
-- PRO_FEATURES since the tiers were written and switching nothing on, which means
-- a teacher paying ৳499 has been paying for a line on a pricing page. This
-- migration is the data behind it.
--
-- WHAT A GUARDIAN ACTUALLY GETS, once a week: how many of their child's classes
-- they turned up to, and what they scored on anything tested. Nothing else. No
-- coaching centre in Bangladesh sends this today — a parent finds out their child
-- has stopped attending when the results come out — so the bar is not "impressive
-- report", it is "one true sentence a week that nobody else is sending".
--
-- WHY THERE IS NO FEE LINE IN IT, which is the first thing that suggests itself
-- given the rest of this product is about money. Fees already have a screen, a
-- schedule (due−3, due, due+7, then fortnightly), their own dedup table and their
-- own wording, and none of that knows about this table. A fee sentence here would
-- let two features chase the same family in the same week in two different tones,
-- each certain it was the first — and it would turn the one message a parent
-- receives that is not asking them for money into another one that is. The
-- masterplan names attendance and marks; that is exactly what this carries.
--
-- WHY SEVEN DAYS AND NOT A CALENDAR WEEK. A calendar week needs a boundary, and
-- Bangladesh does not have one boundary: the weekend is Friday–Saturday, coaching
-- batches run on whichever days the centre chose, and an owner who sends on
-- Monday would be sending a "week" two days long. Seven days back from today is
-- always seven days, whenever they get round to it. The window is returned as
-- `week_from`/`week_to` rather than left implicit, so the message, the screen and
-- the row recording the send all name the same fortnight-proof pair of dates.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The channel enum outgrew its name.
--
-- `fee_reminder_channel` was created in 20260811000007 for the only outreach that
-- existed then. Its three values — the owner's own SMS app, the owner's own
-- WhatsApp, the owner's own dialler — describe how a centre reaches a family
-- about anything, and the table below reaches them about a child's week. Cloning
-- it into a second enum with identical values would mean two types to keep in
-- step and a compiler that cannot tell when they have drifted; leaving it named
-- for fees would mean `progress_updates.channel fee_reminder_channel`, which is a
-- lie in the schema itself.
--
-- A rename rather than a new type, so there is exactly one list of the ways this
-- product can reach a parent. Every existing column, policy and index follows the
-- type automatically; only the generated TypeScript name changes, and the
-- compiler finds all five files that read it.
-- ---------------------------------------------------------------------------

alter type fee_reminder_channel rename to outreach_channel;

comment on type outreach_channel is
  'How the centre reached a family, from their own handset: a prefilled SMS, a '
  'prefilled WhatsApp message, or a phone call. Never a gateway send — see '
  'sms_logs for messages the platform owes a parent.';

-- ---------------------------------------------------------------------------
-- The record of having told a family how their child's week went.
--
-- The same argument fee_reminders makes, about a different message. An owner
-- working down a roster of 150 names on a Thursday evening needs to know which
-- families they already did on Tuesday, and the two failure modes are the ones
-- that matter: send twice and the message becomes noise the family stops reading,
-- skip one and the child whose attendance is sliding is exactly the one whose
-- parent heard nothing. Without this table the feature works for the first twenty
-- students and is unusable for the rest.
--
-- NOT fee_reminders, for the reason that table is not sms_logs: its rows are keyed
-- to an invoice and carry the taka owed at the moment of asking, and a progress
-- note is about a student and has no amount in it. A nullable invoice_id and a
-- nullable amount on that table would make every query against it start by asking
-- which kind of row it had found.
--
-- covers_from/covers_to are stored rather than derived, because "what did you tell
-- my child's parent last week" has to be answerable next month, when today - 7 is
-- a different fortnight. Same instinct as fee_reminders.amount_bdt: freeze what
-- was said, do not recompute it.
-- ---------------------------------------------------------------------------

create table progress_updates (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  student_id   uuid not null,
  channel      outreach_channel not null,
  -- The window the message described, inclusive at both ends.
  covers_from  date not null,
  covers_to    date not null,
  -- The number it was aimed at, E.164, because a guardian's number gets corrected
  -- and "we messaged the old one" is the answer for a family that says nobody
  -- told them anything.
  to_phone     text,
  -- The exact text put in front of the owner, so a complaint about wording can be
  -- answered from a record instead of a recollection. Null for a call.
  body         text,
  sent_by      uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint progress_updates_window_check check (covers_to >= covers_from),

  -- Composite, per the invariant 20260811000005 established and
  -- check-migrations.mjs enforces: a reference from one tenant table to another
  -- carries coaching_center_id, so a row cannot cite another centre's student
  -- while still passing its own RLS check.
  constraint progress_updates_student_id_center_fkey
    foreign key (student_id, coaching_center_id)
    references students (id, coaching_center_id) on delete cascade
);

-- The screen's question, asked once for every student on the roster: when was
-- this family last told anything. Descending, so the answer is the first tuple
-- the index yields.
create index progress_updates_student_idx
  on progress_updates (student_id, created_at desc);
create index progress_updates_center_idx
  on progress_updates (coaching_center_id, created_at desc);

comment on table progress_updates is
  'Weekly progress notes the centre sent from their own phone (prefilled '
  'SMS/WhatsApp deep link, or a call). One row per family per send, with the '
  'window it described frozen on it. Not a send queue — see sms_logs.';

alter table progress_updates enable row level security;

-- ---------------------------------------------------------------------------
-- Owners and managers, and nobody else.
--
-- No self-read policy for the family, the same call fee_reminders made and for a
-- sharper reason: a tally of how often a centre remembered to message you is a
-- working note about the centre's own diligence, and a parent reading "you were
-- updated twice in eleven weeks" learns something true that helps nobody.
--
-- Teachers are excluded because the view below is, and the two must agree. A
-- teacher-facing version of this — their own batch, their own subject's marks —
-- is a legitimate feature and a different view with a different name.
-- ---------------------------------------------------------------------------

create policy progress_updates_staff_admin on progress_updates
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

-- ---------------------------------------------------------------------------
-- One row per active student: their last seven days, and when we last said so.
--
-- WHY A VIEW AND NOT QUERIES IN THE PAGE, the same arithmetic student_risk did:
-- 150 students × 6 sessions a week is 900 attendance rows to fetch and throw away
-- for a screen that needs two integers per child. Postgres counts them where they
-- already are.
--
-- WHY NO THRESHOLD ANYWHERE IN IT. Unlike student_risk, this view judges nothing —
-- there is no "low attendance" here, because the message goes to every parent
-- whatever the number says, and a parent whose child attended all six classes is
-- exactly the one most worth telling. So the view returns counts and the app
-- writes sentences. The one number the app does own is how long to wait before
-- offering the same family again, and that has exactly one reader; see
-- SUMMARY_AGAIN_AFTER_DAYS in src/lib/students/progress.ts.
--
-- WHY EVERY ACTIVE STUDENT AND NOT ONLY THE ONES WITH SOMETHING TO REPORT. A
-- student with zero counted sessions this week is not a student with nothing to
-- say about them — it usually means nobody took the register, which is a fact the
-- owner needs and would never learn from a list that quietly omitted them. The
-- screen groups them; the view does not decide for it.
--
-- WHY security_invoker AND STAFF-ADMIN. Same edge as student_risk: the caller's
-- own RLS decides which rows reach the aggregates, so read by a teacher this view
-- would answer a narrower question — their batches' share of a child's week —
-- under a name that claims to be the whole of it, and hand it to a parent as
-- fact.
-- ---------------------------------------------------------------------------

create view student_progress_week with (security_invoker = true) as
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

  t.last_sent_at

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

comment on view student_progress_week is
  'One row per active student: attendance and marks over the last seven Dhaka '
  'days, the window as week_from/week_to, and when their guardian was last sent '
  'a progress note. Judges nothing — no thresholds here, because the message '
  'goes to every family whatever the numbers say. security_invoker, staff-admin '
  'only: read by a teacher the aggregate would describe their batches rather '
  'than the child.';

grant select on student_progress_week to authenticated;
