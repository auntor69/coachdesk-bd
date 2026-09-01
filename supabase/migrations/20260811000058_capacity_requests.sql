-- A branch manager asks HQ for room, and HQ answers by paying.
--
-- MASTERPLAN.md §3.7 forks at the capacity ceiling by who is looking at it. An HQ admin gets
-- §3.4's pay-and-continue dialog, shipped at 20260811000057. A branch manager gets a sentence
-- and a button — "The organisation has used all 2,600 of its student places. Ask HQ to add
-- capacity." — and §3.7 says exactly what the button leaves behind:
--
--   > The request is a real record, not an email: who asked, which branch, how many places,
--   > when, and its resolution. It appears on the HQ dashboard and in the founder panel. HQ
--   > approves it by paying; approval is what raises capacity.
--
-- Five facts, and this table is those five. No note column: 20260811000027's upgrade_requests
-- carries free text because a founder reads it before ringing a customer, and there is nobody
-- to ring here — the reader is the owner two screens away, who needs a number and a place.
--
-- APPROVAL IS A FOREIGN KEY, NOT A BOOLEAN. "HQ approves it by paying" means the resolution of
-- a request is the purchase that answered it, so `intent_id` points at payment_intents and
-- "was this approved" is that intent's own state, joined. A second `approved` column could
-- disagree with the money, and the money is the one that is right. A decline is `handled_at`
-- with no intent — refused and dated, which is still an answer.
--
-- WHO MAY WRITE ONE IS THE DESIGN, not a restriction on top of it. Insert is granted to
-- managers alone. An owner loses nothing — they have the better path and it is already on
-- their screen — and what the narrow grant buys is that every row here was written by somebody
-- who cannot commit the money. That is what makes the table a request rather than a note to
-- self, and it is 20260811000027's argument about a founder-written upgrade request, one level
-- down.

-- ---------------------------------------------------------------------------
-- 1. The record.
-- ---------------------------------------------------------------------------

create table public.capacity_requests (
  id uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null
    references public.coaching_centers (id) on delete cascade,

  -- Which branch ran out, and null is head office — the reading every other branch_id in
  -- this schema has. 20260811000053 section 4 lists the tables that stay whole because there
  -- is one bill and one owner, and this one sits next to them and is scoped anyway: the bill
  -- is still the organisation's, but the shortage is a place's, and §3.7's sentence cannot be
  -- written without it. An owner reading "25 more places" needs to know it is Mirpur that is
  -- full and not Uttara.
  branch_id uuid,

  places integer not null,
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  -- The resolution, all three written together by the action that answers.
  handled_at timestamptz,
  handled_by uuid references auth.users (id) on delete set null,
  intent_id uuid,

  constraint capacity_requests_branch_fkey
    foreign key (branch_id, coaching_center_id)
    references public.branches (id, coaching_center_id)
    on delete set null (branch_id),

  constraint capacity_requests_intent_fkey
    foreign key (intent_id, coaching_center_id)
    references public.payment_intents (id, coaching_center_id)
    on delete set null (intent_id),

  -- MAX_PLACES in src/lib/limits.ts, held here too. payment_intents.quantity needs no bound
  -- because the server computes it; this number is typed into a form by a manager on a phone,
  -- and the column is the last thing between a stray keystroke and an owner reading that
  -- Mirpur wants twenty thousand seats.
  constraint capacity_requests_places_sane check (places > 0 and places <= 2000),

  -- An open request cannot own an intent: the intent is what closes it.
  constraint capacity_requests_intent_needs_handled
    check (intent_id is null or handled_at is not null)

  -- No `(handled_at is null) = (handled_by is null)` pair check, and that is a decision. A
  -- pair check would be re-evaluated by the UPDATE that `on delete set null` performs on
  -- handled_by, so deleting the account of whoever answered would fail and the account would
  -- become undeletable. payment_intents.settled_by is unpaired for the same reason.
);

comment on table public.capacity_requests is
  'MASTERPLAN.md §3.7 — a branch manager''s ask for more student places, as a record rather '
  'than an email. Written by managers, who cannot buy; answered by an owner, whose purchase '
  'is the approval. One open ask per branch; resolved ones are kept.';

comment on column public.capacity_requests.intent_id is
  'The purchase HQ opened to answer this ask. Null on an open request and on a declined one; '
  'whether the answer stuck is that intent''s state, not a column here.';

-- ---------------------------------------------------------------------------
-- 2. One open ask per branch, and the list HQ reads.
--
-- The partial unique is what makes the form idempotent. `experimental.useOffline` replays a
-- Server Action, and a manager tapping twice on a slow phone must not queue two asks.
-- 20260811000027 got that free by keying the row on the centre, which this table cannot do: a
-- resolved ask is history worth keeping, and the same branch will fill up again next term. So
-- the uniqueness is over the open ones only.
--
-- NULLS NOT DISTINCT, so head office's own ask collides with itself. Without it the one row
-- whose branch is unknown is the one row that can be duplicated. Postgres 15 and later, and
-- the clause goes after the column list and before WHERE.
--
-- supabase-js `.upsert()` cannot name a predicate, so the insert is left to fail and the
-- Server Action re-reads the open row and reports it as success. "Your branch has already
-- asked" is true, and it is what the manager wanted to know.
-- ---------------------------------------------------------------------------

create unique index capacity_requests_one_open_per_branch
  on public.capacity_requests (coaching_center_id, branch_id)
  nulls not distinct
  where handled_at is null;

-- What /hq lists and what the founder panel counts: still waiting, oldest first.
create index capacity_requests_open_idx
  on public.capacity_requests (coaching_center_id, created_at)
  where handled_at is null;

-- ---------------------------------------------------------------------------
-- 3. The branch fills itself in.
--
-- 20260811000054's trigger, reused: a null branch_id becomes the writer's own, so a pinned
-- manager cannot file an ask under somebody else's location, and an HQ manager's ask stays
-- unfiled because it genuinely is the organisation's. A branch that is filled in wrongly on
-- purpose survives the trigger and is refused by the restrictive policy below instead.
-- ---------------------------------------------------------------------------

create trigger capacity_requests_stamp_writer_branch
  before insert on public.capacity_requests
  for each row execute function app.stamp_writer_branch();

-- ---------------------------------------------------------------------------
-- 4. Who reads it, who writes it, and who cannot.
--
-- Read: the centre's owner or manager, and the founder. Insert: managers, per the header.
-- Delete: a manager withdrawing an ask nobody has answered — impossible once handled_at is
-- set, declaratively, so this needs no guard trigger of its own.
--
-- UPDATE IS NOT GRANTED TO A BROWSER AT ALL. Resolving sets three columns at once and one of
-- them points at money, so §11.4 keeps it on the server: the answering action holds
-- createAdminClient(session.userId) and the trail it leaves is the intent's, which is audited.
-- The privilege is revoked rather than merely left unpolicied, so a `create policy … for
-- update` added in a hurry later still cannot open it.
--
-- NO updated_at AND NO AUDIT TRIGGER, following 20260811000027. Every column is written once
-- at insert or once at resolution, and each of those events already carries its own timestamp
-- and its own actor. A diff of this row would restate the row.
-- ---------------------------------------------------------------------------

alter table public.capacity_requests enable row level security;

create policy capacity_requests_staff_read on public.capacity_requests
  for select to authenticated
  using (app.is_staff_admin(coaching_center_id) or app.is_platform_admin());

create policy capacity_requests_manager_insert on public.capacity_requests
  for insert to authenticated
  with check (app.has_role(coaching_center_id, array['manager']::public.member_role[]));

create policy capacity_requests_manager_withdraw on public.capacity_requests
  for delete to authenticated
  using (
    app.has_role(coaching_center_id, array['manager']::public.member_role[])
    and handled_at is null
  );

-- 20260811000053's predicate, on the one money-adjacent table that carries a branch at all. A
-- pinned Mirpur manager reaches Mirpur's ask and no other; HQ reaches every one of them, which
-- is the screen §3.7 asks for. WITH CHECK is omitted so USING covers the writes too, and it is
-- evaluated on the row as the stamp above left it.
create policy capacity_requests_branch_scope on public.capacity_requests
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, branch_id));

revoke update, truncate on public.capacity_requests from authenticated;
revoke insert, update, delete, truncate on public.capacity_requests from anon;

-- ---------------------------------------------------------------------------
-- 5. The founder panel learns that a branch is asking.
--
-- §3.7: "It appears on the HQ dashboard and in the founder panel." The HQ half is a read
-- through the policies above. The panel half has to come through this function, because that
-- screen is one aggregate row per centre and a per-branch list is not what it is — and because
-- 20260811000027 set the precedent that a table and the panel column it earns ship together.
--
-- AN AGGREGATE, UNLIKE `asked`. upgrade_requests holds at most one row per centre, so its CTE
-- is a filter with no group by. This table holds one open row per branch, so a five-branch
-- institution can have five at once, and the founder's question is not which location asked —
-- it is how much room the organisation is short of, and how long it has been waiting. A count,
-- a sum, and the oldest.
--
-- THE OLDEST, AND IT STAYS OUT OF greatest(). `asks_since` is min() because the number worth
-- reading is how long the oldest unanswered ask has sat there. That is also why it cannot join
-- last_active_at: a min() in there would drag a busy centre's last-seen date backwards to the
-- day somebody asked, which is 20260811000034's undercount with the sign flipped.
--
-- DROP AND CREATE WITH THE WHOLE BODY RESTATED, for 20260811000023's reasons and under
-- 20260811000034's warning. The body below is 000034's — the newest of the five definitions —
-- so the three `wants_*` columns and the four message counts survive. PANEL_COLUMNS in
-- scripts/test-rls.mjs is the tripwire: it compares this return type exactly, so a
-- redefinition that drops a column fails `npm test` rather than blanking a chip. Everything
-- below except one CTE, three output columns, three select items and one join is 000034's,
-- unchanged.
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
  wants_note         text,
  asks_open          integer,
  asks_places        integer,
  asks_since         timestamptz
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

  -- Marks out to a parent after an exam. The marketing hook, and until 000034 the
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
  -- `through` is the furthest date any of those payments covers — see 000023 for
  -- why that and not `max(paid_at)` is what tells the founder who owes money.
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
  ),

  -- Branches that have run out of room and are waiting on HQ. A rollup and not a
  -- filter: one open ask per branch means a multi-branch institution can have
  -- several, and three locations wanting ten places each is a different sales
  -- conversation from one wanting thirty.
  asks as (
    select
      q.coaching_center_id,
      count(*)::int as n,
      sum(q.places)::int as places,
      min(q.created_at) as at
    from public.capacity_requests q
    where q.handled_at is null
    group by q.coaching_center_id
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
    -- words rather than printing an epoch. The capacity asks are deliberately not
    -- among them; see the header.
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
    aq.note,
    -- Counted, so zero and "none" are the same word on the screen. `asks_since` is
    -- left null, because "waiting since" has no honest value when nobody is.
    coalesce(qa.n, 0),
    coalesce(qa.places, 0),
    qa.at
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
  left join asks     qa on qa.coaching_center_id = c.id
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
  'credit balance, what has been paid, how far that payment covers, whether the '
  'owner has asked to change plan, and whether any branch is waiting on student '
  'places. security definer because most of the tables it counts are deliberately '
  'unreadable to a platform admin, and it returns counts only — no student, '
  'guardian, mark, attendance or invoice row can leave through it. Raises 42501 '
  'for anyone who is not a platform admin.';

-- The fence, restated because the drop above took the old one with it. Both
-- revokes are needed for the reason 20260811000010 spells out at length:
-- Supabase's own default privileges hand `anon` EXECUTE at the moment a function
-- is created, and revoking PUBLIC does not touch that grant.
revoke all on function public.platform_centers() from public;
revoke execute on function public.platform_centers() from anon;
grant execute on function public.platform_centers() to authenticated;

