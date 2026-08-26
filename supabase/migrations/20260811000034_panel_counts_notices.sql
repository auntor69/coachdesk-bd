-- ---------------------------------------------------------------------------
-- The founder panel counts the marks message and the absence message too.
--
-- THIS IS THE THIRD TIME. 20260811000020 built the panel and counted
-- fee_reminders as `taps_30d`, because on that day the fee chase was the only
-- thing a centre could tap. 20260811000022 added `notes_30d` when /progress
-- shipped, and its own header says why: until it did, "the most likely Pro
-- feature to be used every week was invisible on the screen that decides what
-- to build next". Then result_notices shipped at 20260811000032 and
-- absence_notices at 20260811000033, and neither remembered this function. So a
-- centre whose teachers messaged forty parents about marks and empty seats last
-- month reads on this panel as a centre that sent nothing.
--
-- WHY THAT IS WORSE THAN AN UNDERCOUNT. This screen is the only evidence the
-- roadmap has. A founder reading it decides which feature earned its keep, which
-- centre is alive, and what the next tier is allowed to charge for. A zero that
-- means "not built into the panel" is indistinguishable from a zero that means
-- "nobody used it", and the second is a reason to delete a feature. The
-- same-evening absence message is very likely the most-tapped thing in the whole
-- product — attendance is the daily habit — and it was reporting zero.
--
-- FOUR COUNTS AND NOT ONE. A summed "messages sent" cannot be un-summed, and
-- the four are four different businesses: a chase means a centre using this to
-- get paid, a week note means a teacher using it to keep parents, a marks
-- message is the marketing hook, and an absence message is the daily habit
-- leaving the building. Which of the four a customer actually does is the most
-- useful thing on this screen, and it is exactly what a total would hide. The
-- argument is 20260811000022's, applied twice more rather than abandoned.
--
-- LAST_ACTIVE_AT GAINS BOTH. Not a formality: a teacher who opens Tuesday's
-- register on Friday and taps the guardians of the children who missed it has
-- left a notice dated Friday against a session dated Tuesday. Counting only the
-- session would age that centre toward the quiet threshold on a day somebody
-- was working in it.
--
-- WHAT IS STILL NOT COUNTED, deliberately: nothing. That is now checkable rather
-- than remembered — check-migrations.mjs looks for every table carrying the
-- outreach receipt shape (coaching_center_id, channel, to_phone, body, sent_by)
-- and fails the build if this function's body does not name it. A fifth message
-- table cannot ship without either being counted here or being argued with.
--
-- DROP AND CREATE, NOT REPLACE, and the whole body restated for the reasons
-- 20260811000023 gives: `create or replace` cannot change the columns of a
-- `returns table`, the drop takes the grants with it, and a security definer
-- function reading sixteen tables its caller cannot see has to be readable whole
-- to be trusted. The body restated here is **20260811000027's** — the newest of
-- the four definitions, not the newest one that changed a count. Restating an
-- older body is how the three upgrade-request columns would silently disappear
-- from a working screen, which is a worse bug than the one this migration fixes:
-- it was written that way first, applied, and caught only by reading. The
-- tripwire for the next person is PANEL_COLUMNS in scripts/test-rls.mjs, which
-- lists every column this function returns and compares it exactly, so a
-- redefinition that drops one fails `npm test` rather than blanking a chip.
-- Everything below except the two new CTEs, the two new output columns, the two
-- new select items, the two new joins and the two names added to greatest() is
-- 20260811000027's function, unchanged.
-- ---------------------------------------------------------------------------

drop function if exists public.platform_centers();
create function public.platform_centers()
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
  notes_30d          integer,
  results_30d        integer,
  absences_30d       integer,
  sms_30d            integer,
  last_active_at     timestamptz,
  paid_bdt           numeric,
  last_paid_at       timestamptz,
  paid_through       date,
  wants_plan         public.plan_type,
  wants_since        timestamptz,
  wants_note         text
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

  -- The weekly progress note, counted apart from the fee chase. See 000022.
  notes as (
    select u.coaching_center_id, count(*)::int as n, max(u.created_at) as at
    from public.progress_updates u
    cross join cutoff k
    where u.created_at >= k.ts
    group by u.coaching_center_id
  ),

  -- Marks out to a parent after an exam. The marketing hook, and until now the
  -- only one of the four that could be demonstrated and not measured.
  results as (
    select rn.coaching_center_id, count(*)::int as n, max(rn.created_at) as at
    from public.result_notices rn
    cross join cutoff k
    where rn.created_at >= k.ts
    group by rn.coaching_center_id
  ),

  -- "Your child was not in class today", the same evening. Expected to be the
  -- largest of the four wherever teachers actually take the register.
  absences as (
    select ab.coaching_center_id, count(*)::int as n, max(ab.created_at) as at
    from public.absence_notices ab
    cross join cutoff k
    where ab.created_at >= k.ts
    group by ab.coaching_center_id
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
  --
  -- `through` is the furthest date any of those payments covers — see the header
  -- for why that and not `max(paid_at)` is what tells the founder who owes money.
  -- max() over a nullable column ignores the nulls, so a receipt entered without a
  -- coverage window neither sets this nor pulls it backwards.
  billed as (
    select
      y.coaching_center_id,
      sum(y.amount_bdt) as paid,
      max(y.paid_at) as at,
      max(y.covers_period_end) as through
    from public.payments y
    group by y.coaching_center_id
  ),

  -- Who has raised their hand and not yet been called back. No aggregate and no
  -- group by, unlike every CTE above it: upgrade_requests holds at most one row
  -- per centre by primary key, so this is a filter rather than a rollup.
  asked as (
    select
      u.coaching_center_id,
      u.requested_plan,
      u.created_at,
      u.note
    from public.upgrade_requests u
    where u.handled_at is null
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
    coalesce(nt.n, 0),
    coalesce(rs.n, 0),
    coalesce(ab.n, 0),
    coalesce(g.n, 0),
    -- greatest() ignores nulls in Postgres, so a centre that has taken attendance
    -- and nothing else still reports the day it did. All eight null — a centre that
    -- signed up and never came back — leaves this null, and the screen says so in
    -- words rather than printing an epoch.
    greatest(a.at, e.at, mo.at, tp.at, nt.at, rs.at, ab.at, g.at),
    coalesce(bi.paid, 0),
    bi.at,
    -- Not coalesced. Null is its own answer here: nothing has been paid, or what
    -- was paid did not say what it bought.
    bi.through,
    -- Not coalesced either, and all three null together: no open request. The panel
    -- tests one of them rather than counting rows.
    aq.requested_plan,
    aq.created_at,
    aq.note
  from public.coaching_centers c
  left join owners   o  on o.coaching_center_id = c.id
  left join roster   r  on r.coaching_center_id = c.id
  left join staff    t  on t.coaching_center_id = c.id
  left join classes  b  on b.coaching_center_id = c.id
  left join att      a  on a.coaching_center_id = c.id
  left join ex       e  on e.coaching_center_id = c.id
  left join money    mo on mo.coaching_center_id = c.id
  left join taps     tp on tp.coaching_center_id = c.id
  left join notes    nt on nt.coaching_center_id = c.id
  left join results  rs on rs.coaching_center_id = c.id
  left join absences ab on ab.coaching_center_id = c.id
  left join gateway  g  on g.coaching_center_id = c.id
  left join billed   bi on bi.coaching_center_id = c.id
  left join asked    aq on aq.coaching_center_id = c.id
  -- Newest signup first. The centre onboarded this week is the one being
  -- onboarded, and with fewer than a hundred customers any order is scannable.
  -- The app keeps this order rather than re-sorting, so the CSV and the screen
  -- list the same rows in the same sequence.
  order by c.created_at desc;
end;
$$;

comment on function public.platform_centers() is
  'One aggregate row per coaching centre for the founder panel: size, thirty-day '
  'usage of every feature including all four tap-to-send messages counted apart, '
  'credit balance, what has been paid, how far that payment covers, and whether '
  'the owner has asked to change plan. security definer because most of the '
  'tables it counts are deliberately unreadable to a platform admin, and it '
  'returns counts only — no student, guardian, mark, attendance or invoice row '
  'can leave through it. Raises 42501 for anyone who is not a platform admin.';

-- The fence, restated because the drop above took the old one with it. Both
-- revokes are needed for the reason 20260811000010 spells out at length:
-- Supabase's own default privileges hand `anon` EXECUTE at the moment a function
-- is created, and revoking PUBLIC does not touch that grant. The grant is the
-- fence, and app.is_platform_admin() inside the body is what stands behind it.
revoke all on function public.platform_centers() from public;
revoke execute on function public.platform_centers() from anon;
grant execute on function public.platform_centers() to authenticated;
