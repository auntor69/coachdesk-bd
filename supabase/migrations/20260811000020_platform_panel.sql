-- ---------------------------------------------------------------------------
-- The founder's own screen: every centre, one row each, no student rows at all.
--
-- The masterplan calls this the SuperAdmin panel: "all paid customers, per-centre
-- teacher/student/SMS counts, feature-usage frequency, per-centre export". It is
-- read by exactly one account — the person who sells this product — and it answers
-- three questions no other screen in the app can:
--
--   Who is a customer, and what should they be billed this month?
--   Is that customer actually using it, or has the centre gone quiet?
--   Who do I ring about it?
--
-- WHY A FUNCTION AND NOT A VIEW
--
-- scripts/check-migrations.mjs already wrote this rule down: "If a view genuinely
-- must read past RLS — a platform-admin report, say — it does not belong in the
-- public schema where PostgREST will expose it." Every view in this schema is
-- security_invoker and the check fails the build on one that is not.
--
-- And a security_invoker view could not answer the question anyway. The platform
-- admin's own policies reach about eighteen tables — profiles, coaching_centers,
-- center_members, teachers, students, batches, subscriptions, payments, sms_logs
-- and the rest — but deliberately not attendance_sessions, attendance_records,
-- exams, exam_results, fee_invoices, fee_payments or sms_dispatches. Look at
-- 20260811000002: those seven carry `app.is_staff_admin(coaching_center_id)` with
-- no `or app.is_platform_admin()` beside it. That was the right line to draw — the
-- founder has no business reading a child's marks or a family's arrears — and this
-- migration does not move it.
--
-- What it does instead is compute the counts on the far side of that line and hand
-- back only the counts. security definer means the aggregate can be taken; the
-- return type means no row, name or figure belonging to a student can come with
-- it. The widest thing in the result is the owner's own name and mobile number,
-- which the founder already has, because the founder signed them up.
--
-- WHY IT RAISES INSTEAD OF RETURNING NOTHING
--
-- The obvious alternative is `language sql` with `where app.is_platform_admin()`,
-- which returns zero rows to everybody else. But zero rows is exactly what a
-- founder with no customers yet also sees, so the one bug this function could have
-- — the admin flag not being read the way it is here — would look identical to
-- success. 42501 (insufficient_privilege) is unmistakable in a log.
--
-- WHY THIRTY DAYS
--
-- The same window student_risk uses for attendance, and for the same reason: a
-- coaching centre's month is its unit of work. Anything shorter says "quiet" about
-- a centre mid-Ramadan; anything longer will not notice a customer who stopped
-- three weeks ago, which is the notice worth having while they can still be rung.
--
-- WHY MESSAGES ARE TWO COLUMNS
--
-- taps_30d counts fee_reminders — the tap-to-send chases that leave from the
-- owner's own handset. sms_30d counts sms_logs, which is the metered gateway path.
-- The second is structurally zero on every centre today because no BTRC sender ID
-- exists (see docs/PLANS-AND-MESSAGING.md §2), and the first is the number that is
-- actually large. Adding them together would be the one conflation this codebase
-- avoids everywhere else: one of them costs us money per send and the other is
-- free forever, and a single "messages" figure would hide which kind of customer
-- this is on the day a gateway does exist.
--
-- WHAT IS NOT COMPUTED HERE
--
-- The bill. src/lib/plans.ts owns the bands, the floor and the seat price, and it
-- is the only copy of them — the pricing calculator an owner reads and this panel
-- have to quote the same figure or one of them is lying to somebody. So this
-- returns `students` and `teachers` and the app multiplies. Same argument as
-- student_risk's thresholds, pointing the other way: a rule with one reader
-- belongs where its reader is.
--
-- paid_bdt and last_paid_at read `payments`, which nothing in the app writes yet
-- — there is no payment rail, and centres are signed up in person. They are here
-- because the column of zeros is itself the answer to "who has paid me", and
-- because the day a receipt is recorded by hand this panel shows it without
-- another migration.
-- ---------------------------------------------------------------------------

create or replace function public.platform_centers()
returns table (
  center_id          uuid,
  center_name        text,
  center_phone       text,
  bd_area            text,
  status             public.center_status,
  plan               public.plan_type,
  created_at         timestamptz,
  owner_name         text,
  owner_phone        text,
  students           integer,
  teachers           integer,
  batches            integer,
  sms_credit_balance integer,
  attendance_30d     integer,
  exams_30d          integer,
  fee_payments_30d   integer,
  collected_30d      numeric,
  taps_30d           integer,
  sms_30d            integer,
  last_active_at     timestamptz,
  paid_bdt           numeric,
  last_paid_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
-- Every reference below is qualified with a table alias, so nothing here is
-- ambiguous today. The directive is insurance for the next column added to the
-- return type: `returns table` makes each of these names a variable in scope, so
-- an unqualified `status` or `plan` in a future edit would fail at call time
-- rather than at create time. Resolving toward the column is always right here —
-- the function reads none of its own output parameters.
#variable_conflict use_column
begin
  if not app.is_platform_admin() then
    raise exception 'platform_centers is for platform administrators'
      using errcode = '42501';
  end if;

  return query
  with cutoff as (
    select (now() - interval '30 days') as ts
  ),

  -- Who to ring. The founding owner, which is the earliest active owner
  -- membership rather than coaching_centers.created_by: that column is
  -- `on delete set null`, and a centre whose first owner account was removed
  -- still has an owner to call.
  owners as (
    select
      m.coaching_center_id,
      (array_agg(p.full_name order by m.created_at))[1] as full_name,
      (array_agg(p.phone     order by m.created_at))[1] as phone
    from public.center_members m
    join public.profiles p on p.id = m.user_id
    where m.role = 'owner' and m.active
    group by m.coaching_center_id
  ),

  -- The three counts the bill is computed from. Distinct students and not
  -- enrollments, matching monthlyBillBdt — a student taking three subjects is one
  -- child and is charged once. `students` is one row per child in this schema, so
  -- counting it is already distinct.
  roster as (
    select s.coaching_center_id, count(*)::int as n
    from public.students s
    where s.status = 'active'
    group by s.coaching_center_id
  ),
  staff as (
    select t.coaching_center_id, count(*)::int as n
    from public.teachers t
    where t.active
    group by t.coaching_center_id
  ),
  classes as (
    select b.coaching_center_id, count(*)::int as n
    from public.batches b
    where b.active
    group by b.coaching_center_id
  ),

  -- Usage. created_at and not session_date or exam_date: the question is when
  -- somebody last opened the app and did the work, not which day the work was
  -- about. A centre backfilling last month's register on Tuesday is a centre that
  -- is very much alive.
  att as (
    select s.coaching_center_id, count(*)::int as n, max(s.created_at) as at
    from public.attendance_sessions s
    cross join cutoff k
    where s.created_at >= k.ts
    group by s.coaching_center_id
  ),
  ex as (
    select x.coaching_center_id, count(*)::int as n, max(x.created_at) as at
    from public.exams x
    cross join cutoff k
    where x.created_at >= k.ts
    group by x.coaching_center_id
  ),

  -- What the centre collected from parents through this product, which is the
  -- honest measure of what it is worth to them. Netted rather than positive-only:
  -- a refund is a negative row, the collection register on /fees adds the same
  -- column the same way, and two screens reaching different totals from one table
  -- is how a founder stops trusting both.
  money as (
    select
      p.coaching_center_id,
      count(*)::int as n,
      sum(p.amount_bdt) as collected,
      max(p.paid_at) as at
    from public.fee_payments p
    cross join cutoff k
    where p.paid_at >= k.ts
    group by p.coaching_center_id
  ),

  taps as (
    select r.coaching_center_id, count(*)::int as n, max(r.created_at) as at
    from public.fee_reminders r
    cross join cutoff k
    where r.created_at >= k.ts
    group by r.coaching_center_id
  ),
  gateway as (
    select l.coaching_center_id, count(*)::int as n, max(l.queued_at) as at
    from public.sms_logs l
    cross join cutoff k
    where l.queued_at >= k.ts
    group by l.coaching_center_id
  ),

  -- What they have paid us, all time. No window: "this customer has never paid"
  -- and "this customer paid once in March" are different facts and both matter.
  billed as (
    select
      y.coaching_center_id,
      sum(y.amount_bdt) as paid,
      max(y.paid_at) as at
    from public.payments y
    group by y.coaching_center_id
  )

  select
    c.id,
    c.name,
    c.phone,
    c.bd_area,
    c.status,
    c.plan,
    c.created_at,
    o.full_name,
    o.phone,
    coalesce(r.n, 0),
    coalesce(t.n, 0),
    coalesce(b.n, 0),
    c.sms_credit_balance,
    coalesce(a.n, 0),
    coalesce(e.n, 0),
    coalesce(mo.n, 0),
    coalesce(mo.collected, 0),
    coalesce(tp.n, 0),
    coalesce(g.n, 0),
    -- greatest() ignores nulls in Postgres, so a centre that has taken attendance
    -- and nothing else still reports the day it did. All five null — a centre that
    -- signed up and never came back — leaves this null, and the screen says so in
    -- words rather than printing an epoch.
    greatest(a.at, e.at, mo.at, tp.at, g.at),
    coalesce(bi.paid, 0),
    bi.at
  from public.coaching_centers c
  left join owners  o  on o.coaching_center_id = c.id
  left join roster  r  on r.coaching_center_id = c.id
  left join staff   t  on t.coaching_center_id = c.id
  left join classes b  on b.coaching_center_id = c.id
  left join att     a  on a.coaching_center_id = c.id
  left join ex      e  on e.coaching_center_id = c.id
  left join money   mo on mo.coaching_center_id = c.id
  left join taps    tp on tp.coaching_center_id = c.id
  left join gateway g  on g.coaching_center_id = c.id
  left join billed  bi on bi.coaching_center_id = c.id
  -- Newest signup first. The centre onboarded this week is the one being
  -- onboarded, and with fewer than a hundred customers any order is scannable.
  -- The app keeps this order rather than re-sorting, so the CSV and the screen
  -- list the same rows in the same sequence.
  order by c.created_at desc;
end;
$$;

comment on function public.platform_centers() is
  'One aggregate row per coaching centre for the founder panel: size, thirty-day '
  'usage, credit balance and what has been paid. security definer because five of '
  'the tables it counts are deliberately unreadable to a platform admin, and it '
  'returns counts only — no student, guardian, mark, attendance or invoice row '
  'can leave through it. Raises 42501 for anyone who is not a platform admin.';

-- The fence, for the reason 20260811000010 spells out at length: Supabase's own
-- default privileges hand `anon` EXECUTE at the moment a function is created, and
-- revoking PUBLIC does not touch that grant. Both revokes are needed. This one
-- also checks auth.uid() through app.is_platform_admin(), which is false for a
-- session-less request — the grant is the fence, the check is what stands behind
-- it.
revoke all on function public.platform_centers() from public;
revoke execute on function public.platform_centers() from anon;
grant execute on function public.platform_centers() to authenticated;
