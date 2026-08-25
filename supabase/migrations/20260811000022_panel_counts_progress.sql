-- ---------------------------------------------------------------------------
-- The founder panel learns about the weekly progress note.
--
-- 20260811000021 gave the product a second thing an owner taps to send, and the
-- panel that decides who to ring did not know it existed. Its `taps_30d` counts
-- fee_reminders and nothing else, so from the day /progress shipped the most
-- likely Pro customer there is — a single teacher who collects cash in the room
-- and whose entire use of this product is telling forty parents how the week went
-- — reads on the founder's own screen as a centre that sends nothing.
--
-- That is the worst class of bug this panel can have. Every other number being
-- wrong makes a founder confused; this one makes them ring the wrong customer, or
-- worse, not ring at all: a live account that looks dead gets written off, and a
-- feature that nobody appears to use gets dropped from the next version of the
-- pricing page while the people paying for it are using it weekly.
--
-- A SEVENTH USAGE COLUMN AND NOT A BIGGER SIXTH.
--
-- Folding progress notes into `taps_30d` would have been one line and would have
-- answered the smaller question — is this customer alive — while destroying the
-- larger one. The panel's own reason for keeping `taps_30d` and `sms_30d` apart is
-- that a single "messages" figure hides which kind of customer this is; the same
-- argument applies with more force here, because these two taps are two different
-- products. Fee chases mean a centre using this to get paid. Progress notes mean a
-- teacher using it to keep parents. Which of the two a customer does is the single
-- most useful thing on this screen when the question is what to build next, and a
-- sum of the two cannot be un-summed later.
--
-- So `notes_30d`, beside the taps, and `last_active_at` now counts a progress note
-- as a sign of life — which it plainly is, and which matters most for exactly the
-- customer described above.
--
-- DROP AND CREATE, NOT REPLACE. `create or replace function` cannot change a
-- function's output columns, and `returns table` makes every one of them an output
-- parameter. The drop takes the grants with it, so the fence at the bottom of
-- 20260811000020 is restated here rather than inherited — and that is the reason
-- this file is long: everything below the new CTE is 20260811000020's function,
-- unchanged, because a security definer function that reads five tables its caller
-- cannot see has to be read as a whole to be trusted.
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

  -- The weekly progress note, counted apart from the fee chase. See the header.
  notes as (
    select u.coaching_center_id, count(*)::int as n, max(u.created_at) as at
    from public.progress_updates u
    cross join cutoff k
    where u.created_at >= k.ts
    group by u.coaching_center_id
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
    coalesce(nt.n, 0),
    coalesce(g.n, 0),
    -- greatest() ignores nulls in Postgres, so a centre that has taken attendance
    -- and nothing else still reports the day it did. All six null — a centre that
    -- signed up and never came back — leaves this null, and the screen says so in
    -- words rather than printing an epoch.
    greatest(a.at, e.at, mo.at, tp.at, nt.at, g.at),
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
  left join notes   nt on nt.coaching_center_id = c.id
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
  'usage, credit balance and what has been paid. security definer because six of '
  'the tables it counts are deliberately unreadable to a platform admin, and it '
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
