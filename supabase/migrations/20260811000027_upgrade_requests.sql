-- CoachDesk BD — a centre owner can say "I want to pay you" without a phone number.
--
-- /settings/plan already tells an owner exactly what they would be charged: the
-- usage rows, the tier comparison, and a live per-student calculator. Then the
-- screen ends. The one control that turns all of that into revenue is a contact
-- card gated on `NEXT_PUBLIC_SALES_PHONE`, and that variable is empty in every
-- deployment — .env.example ships it blank and nobody has filled it in. So an owner
-- who has just read the price and decided to buy reaches the bottom of the page and
-- finds nothing. There is no email address on the screen, no form, no address. The
-- sale ends there, silently, and we never learn it happened.
--
-- That gate was the right call for a dead WhatsApp chip — a button that opens a
-- chat with nobody is worse than no button. It was the wrong call for the whole
-- card, because the alternative was never "no way to get in touch", it was "no way
-- we bothered to build".
--
-- WHY A ROW AND NOT A MAILTO. We already know who they are. The founder panel
-- carries every centre's name, its owner's name, its owner's phone number as a
-- `tel:` link, its student and teacher counts, and the exact monthly bill those
-- counts produce. Everything needed to make the call is on that screen already.
-- The only fact missing from it is the one the owner is trying to tell us, so that
-- is the only fact this table holds: they asked, when, for which plan, and anything
-- they wanted to add. The founder rings the number that was always there.
--
-- A mailto: would also mean reading email to find sales, on a free tier, from a
-- phone, and would put the centre's name into an inbox instead of next to their
-- usage figures.
--
-- ONE ROW PER CENTRE, KEYED BY THE CENTRE, and that is load-bearing rather than
-- tidy. `experimental.useOffline` is on — see next.config.ts — which means every
-- Server Action in this product may be replayed by the framework when a request
-- goes out on a patchy connection and its response is lost. A table of appended
-- requests would turn one owner tapping once in a corridor with one bar into three
-- identical rows and a founder who calls them three times. With the centre as the
-- primary key the replay is an upsert onto the same row: tapping twice, or tapping
-- once through two lost responses, leaves exactly one request. Same reasoning as
-- 20260811000025 put idempotency keys on the payment tables, applied to a table
-- where the natural key was available and no extra column was needed.
--
-- It also happens to be what the domain wants. "Does this centre want to upgrade
-- right now" has one answer, and an owner who asks again after changing their mind
-- about which plan is correcting the request, not filing a second one.
--
-- NO FEATURE FLAG ON IT. Every other capability in this product is gated by
-- `has(plan, ...)`, and this one deliberately is not: a teacher on the free tier is
-- the single most valuable person who could tap it. FOUNDATION §9 has the whole
-- acquisition plan resting on free teachers converting, and gating the button that
-- converts them behind the plan they have not bought yet would be the most
-- expensive possible reading of the tier table. There is no plan on which "give us
-- money" is a paid feature.
--
-- WHAT THIS IS NOT: a subscription, an invoice, a payment, or a plan change. It
-- changes nothing about what the centre is allowed to do. `coaching_centers.plan`
-- stays writable only by us — 20260811000004 locked that column and
-- 20260811000024 made the billing tables read-only from a browser — so the worst a
-- forged request can achieve is a phone call the founder was glad to make.

create table upgrade_requests (
  -- The centre is the key. See the header: this is what makes a replayed Server
  -- Action idempotent, and there is only ever one live answer per centre anyway.
  coaching_center_id uuid primary key
    references coaching_centers (id) on delete cascade,

  -- Which plan they are asking for. The enum and not free text, so the panel can
  -- say "wants Center" in a badge and the founder knows what conversation to have
  -- before dialling. Nothing enforces that it is *above* their current plan: a
  -- centre asking to move down is telling us something more urgent than one asking
  -- to move up, and refusing to record it would not stop it being true.
  requested_plan plan_type not null,

  -- Anything they wanted to add — how many branches, when to call, which month
  -- they want to start. Optional, and the reason the card is a form rather than a
  -- single button: "call me after 8pm" is the difference between reaching an owner
  -- and interrupting a class.
  note text,

  -- Who tapped it, so the founder can ask for that person by name. Nullable and
  -- `on delete set null`, matching progress_updates.sent_by: a request outlives the
  -- account that filed it, and losing the whole request because a staff account was
  -- removed would lose a sale to a tidy-up.
  requested_by uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),

  -- When the founder dealt with it. Null means it is still on the call list, which
  -- is the only state the panel filters on.
  --
  -- A nullable timestamp rather than a status enum, because there are exactly two
  -- states and one of them wants a date anyway: "handled on the 3rd" is worth
  -- knowing and "handled = true" is not. Re-requesting later sets it back to null
  -- on the same row, which is correct — the centre is asking again.
  handled_at timestamptz
);

-- The panel's only question: who is waiting to hear from us, oldest first, because
-- the owner who asked on Tuesday has been waiting longest and knows it.
create index upgrade_requests_open_idx
  on upgrade_requests (created_at)
  where handled_at is null;

comment on table upgrade_requests is
  'A centre owner asking to be moved onto a paid plan, or to talk about the one '
  'they are on. One row per centre, keyed by it, so a Server Action replayed by '
  'experimental.useOffline cannot file the same request twice. Grants nothing and '
  'changes no entitlement — coaching_centers.plan stays writable only by us.';

alter table upgrade_requests enable row level security;

-- ---------------------------------------------------------------------------
-- The owner, about their own centre, and the platform admin about all of them.
--
-- OWNER AND NOT STAFF-ADMIN, so a manager is excluded. This is the same line
-- payments and sms_credit_ledger draw and it is drawn from FOUNDATION §4: a branch
-- manager runs a branch and does not touch billing. Asking to be put on a
-- ৳12,100-a-month plan is a commitment of somebody else's money, and the founder
-- ringing back to confirm it would be an awkward call for both of them.
--
-- Teachers are excluded for a reason worth separating from that one: on the paid
-- centre tiers a teacher is an employee, and on the teacher tiers there are no
-- other seats, so `is_owner` already covers every person who could legitimately be
-- buying. A free-tier teacher upgrading themselves is an owner — bootstrap_center
-- makes them one at signup — and the most important caller this table has.
--
-- SEPARATE POLICIES PER COMMAND rather than one `for all`, because the two readers
-- are not the two writers. A platform admin must be able to read every request and
-- tick it off, and must not be able to file one: a request the founder wrote on the
-- customer's behalf would be a note to self sitting in the column that means "the
-- customer asked", and the whole value of this table is that the distinction holds.
-- ---------------------------------------------------------------------------

create policy upgrade_requests_owner_read on upgrade_requests
  for select to authenticated
  using (app.is_owner(coaching_center_id) or app.is_platform_admin());

create policy upgrade_requests_owner_insert on upgrade_requests
  for insert to authenticated
  with check (app.is_owner(coaching_center_id));

-- Both clauses name the owner: `using` is which row they may reach, `with check`
-- is what it may become. Without the second, an owner could reach their own
-- request and rewrite coaching_center_id to a centre they do not belong to.
create policy upgrade_requests_owner_update on upgrade_requests
  for update to authenticated
  using (app.is_owner(coaching_center_id))
  with check (app.is_owner(coaching_center_id));

-- Withdrawal. An owner who changes their mind should not have to take the phone
-- call to say so, and a pending card with no way out is a screen that lies about
-- what the reader controls.
create policy upgrade_requests_owner_delete on upgrade_requests
  for delete to authenticated
  using (app.is_owner(coaching_center_id));

-- Ticking it off. UPDATE only: the founder may mark a request handled and may not
-- create or delete one, so the record of what a customer asked for survives the
-- founder having answered it.
create policy upgrade_requests_platform_update on upgrade_requests
  for update to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin());

-- ---------------------------------------------------------------------------
-- The founder panel learns who is asking.
--
-- Three columns onto the existing row rather than a second screen or a second
-- query. The panel's own header says what it does not have — filters, sorting, a
-- search box — and an inbox would be all three: the founder would read the request
-- list, then look the centre up in the customer list to find out whether it is
-- worth ringing. Everything that decides that answer is already on the card. The
-- request belongs on the card.
--
-- OPEN REQUESTS ONLY. `handled_at is null` is applied in the join, so a ticked-off
-- request leaves the panel completely rather than lingering as a badge the founder
-- learns to ignore. The row stays in the table; this function simply stops being
-- the thing that reads it.
--
-- WHY THE NOTE COMES THROUGH. It is the one field here written by a customer, and
-- the temptation is to leave it out of an aggregate function and fetch it when
-- needed. But "call me after 8pm" is worthless on a second screen the founder
-- opens after deciding to call, and the panel is already the place where the phone
-- number lives.
--
-- DROP AND CREATE, NOT REPLACE, and the whole body restated — the same reason
-- 20260811000023 spells out: `create or replace function` cannot change the output
-- columns of a `returns table`, the drop takes the grants with it, and a security
-- definer function reading nine tables its caller cannot see has to be readable as
-- a whole to be trusted. Everything below except the `asked` CTE, the three new
-- output columns, the three new select items and the new left join is
-- 20260811000023's function, unchanged.
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
    coalesce(g.n, 0),
    -- greatest() ignores nulls in Postgres, so a centre that has taken attendance
    -- and nothing else still reports the day it did. All six null — a centre that
    -- signed up and never came back — leaves this null, and the screen says so in
    -- words rather than printing an epoch.
    greatest(a.at, e.at, mo.at, tp.at, nt.at, g.at),
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
  left join asked   aq on aq.coaching_center_id = c.id
  -- Newest signup first. The centre onboarded this week is the one being
  -- onboarded, and with fewer than a hundred customers any order is scannable.
  -- The app keeps this order rather than re-sorting, so the CSV and the screen
  -- list the same rows in the same sequence.
  order by c.created_at desc;
end;
$$;

comment on function public.platform_centers() is
  'One aggregate row per coaching centre for the founder panel: size, thirty-day '
  'usage, credit balance, what has been paid, how far that payment covers, and '
  'whether the owner has asked to change plan. security definer because six of '
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
