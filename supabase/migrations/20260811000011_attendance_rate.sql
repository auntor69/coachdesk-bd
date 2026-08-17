-- ---------------------------------------------------------------------------
-- Attendance rate per batch per month — the dashboard's third number.
--
-- The masterplan's owner dashboard is three figures: collected, outstanding,
-- attendance rate by batch. The first two are money and were built first,
-- because money is what gets a centre to buy. This one is what gets them to
-- renew: at the end of a month an owner can see that Bio Morning ran at 91%
-- and Chem Evening at 62% — a fact a paper register cannot produce at all, and
-- the reason the register was worth typing into a phone every day.
--
-- WHY THIS IS A VIEW AND NOT A LOOP IN JAVASCRIPT
--
-- Forty students taking class twenty times a month is eight hundred attendance
-- rows for one batch, and counting them in Node means fetching every one of
-- them for every batch. Postgres can count them where they already are and
-- return one row per batch. This is the screen an owner opens on a 3G phone
-- several times a day.
--
-- WHAT COUNTS AS PRESENT
--
--   rate = (present + late) / (present + late + absent)
--
-- 'late' counts as attendance because it is attendance: the student came.
-- Docking it would be a different measurement, and the honest place for that is
-- its own column — so every status is exposed as a count and a screen that
-- wants to say "four were late" can.
--
-- 'excused' is excluded from the denominator rather than counted as an absence.
-- A centre that marks a sick child excused and watches its own rate fall learns
-- to stop marking them excused, and then the register stops being true. The
-- measurement must not punish the honest note.
--
-- A month with no marks yields no row rather than a zero, and rate_pct is null
-- when every mark in the month was 'excused'. Zero and "nothing recorded" are
-- opposite facts — one means the students stopped coming, the other means the
-- teacher stopped marking — and a screen has to be able to tell them apart.
--
-- WHY THE MONTH NEEDS NO TIMEZONE REASONING
--
-- session_date is a plain `date`, written by the app from todayInDhaka(), so it
-- is already a Dhaka calendar day. date_trunc over it is a Dhaka month boundary
-- with no conversion — unlike everything hanging off a timestamptz in this
-- schema, where taking ten characters of the UTC string moves 1am Dhaka into
-- yesterday.
--
-- The `::timestamp` cast is load-bearing and not noise. `date_trunc('month',
-- some_date)` looks innocent and resolves to the timestamptz overload, because
-- timestamptz is the preferred type in that category — which makes the whole
-- expression STABLE rather than IMMUTABLE, dependent on the connection's
-- TimeZone, and illegal in the index below. Naming timestamp explicitly picks
-- the immutable overload and pins the month to the date as written.

--
-- WHY THE VIEW CHECKS is_staff_admin ITSELF
--
-- security_invoker means the caller's own RLS decides which rows reach the
-- aggregate, and for an aggregate that is a sharper edge than it is for a
-- per-row view. A student reading this view passes the self-read policy on their
-- own attendance records and gets back a row carrying a batch_name and a
-- rate_pct that describes nobody but themselves: a personal attendance rate
-- wearing a batch's name, wrong in a way that is invisible to whatever consumes
-- it. The same view read by a teacher would mean a third thing.
--
-- So this view answers exactly one question — how a batch attended, for the
-- people who run the centre — and the predicate is what keeps it to one. A
-- teacher-facing or student-facing rate is a different question and belongs in
-- its own view under its own name.
--
-- The predicate is not the tenant boundary. security_invoker plus the policies
-- on all three tables underneath is, and it stays for the reason spelled out at
-- length in 20260811000006 and enforced by check-migrations.mjs.
-- ---------------------------------------------------------------------------

create view batch_attendance_monthly with (security_invoker = true) as
select
  b.coaching_center_id,
  b.id                                        as batch_id,
  b.name                                      as batch_name,
  -- Exposed rather than filtered on, so a closed batch's history stays
  -- readable and the caller decides whether it belongs on today's screen.
  b.active                                    as batch_active,
  date_trunc('month', s.session_date::timestamp)::date as period_month,
  -- Sessions that actually have marks against them. An empty session is one a
  -- teacher opened and never filled, and counting it would put a day into the
  -- denominator of "how often did this batch run" that nobody was marked for.
  count(distinct s.id)::int                   as sessions,
  count(*) filter (where r.status = 'present')::int as present,
  count(*) filter (where r.status = 'late')::int    as late,
  count(*) filter (where r.status = 'absent')::int  as absent,
  count(*) filter (where r.status = 'excused')::int as excused,
  -- The denominator, exposed so a screen can say how many marks the percentage
  -- rests on. A 100% built from three marks is not the same claim as a 100%
  -- built from six hundred.
  count(*) filter (where r.status <> 'excused')::int as counted,
  round(
    100.0 * count(*) filter (where r.status in ('present', 'late'))
      / nullif(count(*) filter (where r.status <> 'excused'), 0)
  )::int as rate_pct
from attendance_records r
-- The tenant column travels with both joins, same as everywhere else in this
-- schema: joining on id alone would be a sideways reference.
join attendance_sessions s
  on s.id = r.session_id
 and s.coaching_center_id = r.coaching_center_id
join batches b
  on b.id = s.batch_id
 and b.coaching_center_id = s.coaching_center_id
where app.is_staff_admin(b.coaching_center_id)
group by
  b.coaching_center_id,
  b.id,
  b.name,
  b.active,
  date_trunc('month', s.session_date::timestamp)::date;

comment on view batch_attendance_monthly is
  'Per batch per Dhaka calendar month: attendance counted in Postgres as '
  '(present + late) over (present + late + absent), excused excluded. '
  'security_invoker, and staff-admin only — the aggregate would mean something '
  'else entirely read by a teacher or a student.';

grant select on batch_attendance_monthly to authenticated;

-- The dashboard asks for one month of one centre. Without this it is a scan of
-- every centre's attendance history to answer that, because date_trunc is not
-- something a plain index on session_date can serve.
--
-- The expression here is character-for-character the view's period_month, and
-- has to stay that way: the planner matches an expression index by the shape of
-- the expression, so `::date` moving into or out of either one silently costs
-- the index rather than breaking anything.
create index attendance_sessions_center_month_idx
  on attendance_sessions (coaching_center_id, (date_trunc('month', session_date::timestamp)::date));
