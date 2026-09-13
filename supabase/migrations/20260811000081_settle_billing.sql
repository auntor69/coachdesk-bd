-- CoachDesk BD — the burn: public.settle_billing, settlement_runs, and the
-- reconciliation the founder can read (MASTERPLAN §11.7, §11.12, §11.13;
-- build-order steps 22 and 22a).
--
-- WHAT LANDS HERE. The function that turns a day of use into a ledger entry,
-- the table that records every attempt, and the RPC that answers §11.13's
-- three questions on the founder panel. Nothing in src/ calls the function
-- yet — that is step 24, and the whole safety argument of the landing order:
-- until then the only way to invoke the burn is by hand, and a hand that
-- never runs it changes nobody's access.
--
-- SETTLEMENT IS A CONSEQUENCE OF USE, NOT A JOB (§11.7). The function is
-- idempotent per day and derives every figure itself: it takes a centre id,
-- accepts no amount, and prices the day from the same counting functions the
-- capacity trigger reads — app.active_students and app.active_teachers — so
-- there is one head count in this system and not a billing copy of it. A
-- nightly cron may call it so an owner who never logs in still sees a current
-- figure; if it never runs, access is still correct, because access (step 24)
-- is a comparison and not a row.
--
-- THE TOP-UP, AND WHY THIS MIGRATION REPLACES AN INDEX. 20260811000078 made
-- `billing_ledger_one_charge_per_day` unique over every daily_charge, which
-- cannot coexist with §11.7 step 4: "for today, tops the charge up to today's
-- rate if a smaller one was already taken". A top-up is a NEW row — the ledger
-- is append-only, so there is no other shape it could have — so more than one
-- daily_charge per centre per date has to be legal. What must stay unique is
-- the day's BASE charge, which is what §11.7's own threat table says ("a
-- unique index on (centre, charge date) for the day's base charge") and what
-- a double cron delivery would duplicate. So: a `top_up` flag on the row,
-- honest about which half of a day's cost it carries, and the unique index
-- narrowed to the base. The immutability trigger is untouched — a top-up is
-- an insert, never an edit, same as everything else in the table.
--
-- WHOLE DAYS OR NOTHING (§11.7). ৳50 against an ৳86.66 day buys no day: the
-- ৳50 stays theirs and the centre is read-only until they top up. Letting the
-- last day through at whatever was left would put an amount in the ledger
-- that matches no rate, and a ledger nobody can audit is not a ledger.
--
-- A DAY IS A DHAKA CALENDAR DAY. `(now() at time zone 'Asia/Dhaka')::date`
-- and never `current_date`: the database runs UTC, so between midnight and
-- 6am in Dhaka `current_date` is yesterday, and a billing bug that only
-- appears before dawn is the worst kind there is.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. settlement_runs — every attempt, including the ones that charged nothing.
--
-- In schema `app` rather than `public`, for the same reason
-- app.phone_verifications lived there until 20260811000079 retired it:
-- PostgREST does not serve `app`, so a table there is outside the browser's
-- reach by construction, and the one reader (the founder panel) reaches it
-- through platform_reconciliation below, which asks app.is_platform_admin
-- first. Belt and braces: RLS with no policy, and revokes by name.
--
-- `insufficient_balance` is the product working and must not read as an
-- alarm; `usage_unavailable` is the one incident; `error` is anything the
-- function itself raised. A settled day gets its row too — the ledger entry
-- is the money, the run is the audit of how it got there, and "charged by
-- hand at 3pm" vs "charged by the cron at 4am" is a question a support call
-- will eventually ask.
-- ---------------------------------------------------------------------------

create table app.settlement_runs (
  id uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null
    references public.coaching_centers (id) on delete cascade,

  -- The Dhaka day this attempt was about.
  charge_date date not null,

  status text not null check (status in
    ('settled', 'insufficient_balance', 'usage_unavailable', 'error')),

  -- 1 for a first attempt; a founder's manual retry is 2. Unique with the
  -- centre and the date, so the same attempt can never be recorded twice.
  attempt integer not null default 1 check (attempt >= 1),

  price_version_id uuid references public.price_versions (id),

  -- The counts the rate was computed from, when they could be read. Null on a
  -- usage_unavailable row by definition, and on an error row when the failure
  -- came before the count.
  usage_students integer,
  usage_teachers integer,
  usage_branches integer,

  -- What the attempt charged: the ledger-identical signed figure, negative
  -- when money moved and zero when it did not.
  amount_poisha bigint not null default 0,

  -- The SQLSTATE and message of a failure, truncated by the caller, never a
  -- student's name or a balance (§11.13's rule about what a log may hold).
  error_detail text,

  -- 'session' when a member's write triggered it, 'system' for the cron,
  -- 'founder' for a manual retry.
  ran_by text not null check (ran_by in ('session', 'system', 'founder')),

  created_at timestamptz not null default pg_catalog.now(),

  constraint settlement_runs_once unique (coaching_center_id, charge_date, attempt)
);

comment on table app.settlement_runs is
  'MASTERPLAN.md §11.13 — one row per settlement attempt, including the ones '
  'that charged nothing. The ledger holds the money; this holds how the '
  'decision to move it (or not) was reached. Read by the founder panel through '
  'platform_reconciliation(); no browser role may touch it.';

create index settlement_runs_center_idx
  on app.settlement_runs (coaching_center_id, charge_date desc);

alter table app.settlement_runs enable row level security;
revoke all on app.settlement_runs from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 2. The top-up flag, and the index narrowed to the day's base charge.
-- ---------------------------------------------------------------------------

alter table public.billing_ledger
  add column top_up boolean not null default false;

comment on column public.billing_ledger.top_up is
  'True on the part of a day''s charge that was added later, when the roster '
  'grew past the size the day was first charged at (§11.7 step 4). The day''s '
  'BASE charge — one per centre per date, still held unique — is the row this '
  'is false on.';

alter table public.billing_ledger
  add constraint billing_ledger_top_up_shape check (
    not top_up or kind = 'daily_charge'
  );

-- Replaced, not merely added beside: leaving the old one in place would make
-- the first top-up of any day raise 23505 and take the write that asked for
-- it down with it. The new fence is the same idea, correctly scoped.
drop index public.billing_ledger_one_charge_per_day;

create unique index billing_ledger_one_base_charge_per_day
  on public.billing_ledger (coaching_center_id, charge_date)
  where kind = 'daily_charge' and not top_up;

-- The day's whole charge, base and top-ups together, for the history screen
-- and the reconciliation's gap question.
create index billing_ledger_day_idx
  on public.billing_ledger (coaching_center_id, charge_date)
  where kind = 'daily_charge';

-- ---------------------------------------------------------------------------
-- 2a. `created_at` must order same-transaction inserts.
--
-- The column's default was `now()`, which is frozen at the start of a
-- transaction — so the two back-dated charges a catch-up writes, or a recharge
-- and its bonus, all share one timestamp and (created_at, id) cannot put them
-- in the order they were inserted. The chain itself is still right (each row's
-- before/after are computed at its own insert), but the reconciliation's walk
-- and the history screen's order read them in a random sequence order and find
-- breaks that are not there.
--
-- `clock_timestamp()` is the actual wall clock, read per statement, so two
-- inserts in one transaction get distinct, increasing stamps. Existing rows
-- keep what they have — they were written one transaction at a time.
-- ---------------------------------------------------------------------------

alter table public.billing_ledger
  alter column created_at set default pg_catalog.clock_timestamp();

-- ---------------------------------------------------------------------------
-- 3. The burn itself.
--
-- SECURITY DEFINER because it writes rows no browser role may write, and
-- because the counting functions are definer already. It takes a centre id
-- and NOTHING ELSE: no amount, no rate, no date, no head count — every figure
-- is derived inside, under the same per-centre advisory lock the ledger's
-- insert trigger takes, so the affordability read and the insert are one
-- serialised sequence and the lock is re-entrant when the trigger re-acquires
-- it.
--
-- VOLATILE, like every counter in this schema: a stable function would read
-- the calling statement's snapshot and the balance check would race the rows
-- this same call is inserting.
-- ---------------------------------------------------------------------------

create or replace function public.settle_billing(
  p_center uuid,
  p_ran_by text default 'session'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'Asia/Dhaka')::date;
  v_plan public.plan_type;
  v_charged_through date;
  card public.price_versions%rowtype;
  v_students integer;
  v_teachers integer;
  v_branches integer;
  band record;
  v_up_to integer;
  v_band_size integer;
  v_in_band integer;
  v_remaining integer;
  v_band_floor integer := 0;
  v_band_sum bigint := 0;
  v_monthly bigint;
  v_daily bigint;
  v_balance bigint;
  v_charged bigint := 0;
  v_days integer := 0;
  v_day date;
  v_today_so_far bigint;
  v_diff bigint;
  v_attempt integer;
  v_outcome text := 'settled';
begin
  if p_ran_by not in ('session', 'system', 'founder') then
    raise exception 'settle_billing: ran_by must say who asked'
      using errcode = '22023';
  end if;

  -- Who may call it: an active member of the centre, or the platform itself
  -- (the cron holds the service key and no user). A member of another centre
  -- is refused here, and the worst a hostile direct call can ever do is
  -- charge the caller's own centre for a day it already owed (§11.7).
  if auth.uid() is not null then
    if not exists (
      select 1 from public.center_members m
      where m.coaching_center_id = p_center
        and m.user_id = auth.uid()
        and m.active
    ) then
      raise exception 'settle_billing requires an active membership at the centre'
        using errcode = '42501';
    end if;
  elsif current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'settle_billing requires a member or the platform'
      using errcode = '42501';
  end if;

  select c.plan, c.charged_through
    into v_plan, v_charged_through
  from public.coaching_centers c
  where c.id = p_center;

  if not found then
    raise exception 'settle_billing: no such centre' using errcode = '23503';
  end if;

  -- The same lock, in the same namespace, as app.ledger_open_balance: the
  -- affordability read below and the inserts above it are one sequence, and
  -- the trigger's own acquisition of the same lock is a no-op inside this
  -- transaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('billing_ledger.balance'),
    pg_catalog.hashtext(p_center::text)
  );

  -- The card in force today. There is one from the day the ledger opened; a
  -- missing card is a deployment error, charged as nothing and recorded as
  -- one, rather than a guess.
  select * into card
  from public.price_versions v
  where v.effective_from <= v_today
  order by v.effective_from desc
  limit 1;

  if not found then
    insert into app.settlement_runs (
      coaching_center_id, charge_date, status, error_detail, ran_by
    ) values (
      p_center, v_today, 'error',
      'no price version in force', p_ran_by
    );
    return jsonb_build_object('ok', false, 'status', 'error',
                              'error', 'no price version in force');
  end if;

  -- The head counts, from the same functions the capacity trigger reads. A
  -- read that fails charges nothing and leaves charged_through where it was:
  -- guessing here would be the one bug that charges a customer for a number
  -- nobody can explain (§11.12).
  begin
    v_students := app.active_students(p_center);
    v_teachers := app.active_teachers(p_center);
    select greatest(1, pg_catalog.count(*))::integer
      into v_branches
    from public.branches b
    where b.coaching_center_id = p_center
      and b.active;
  exception when others then
    insert into app.settlement_runs (
      coaching_center_id, charge_date, status, error_detail, ran_by
    ) values (
      p_center, v_today, 'usage_unavailable',
      left(sqlerrm || ' [' || sqlstate || ']', 300), p_ran_by
    );
    return jsonb_build_object('ok', false, 'status', 'usage_unavailable',
                              'error', left(sqlerrm, 200));
  end;

  -- The rate, per plan, in poisha. teacher_free burns nothing (§11.6) and is
  -- not a price; teacher_plus is flat; the per-student tiers are the floor,
  -- the bands, the seats and the branches, exactly as monthlyBillBdt computes
  -- them in plans.ts — the reconciliation test holds the two together.
  if v_plan = 'teacher_free'::public.plan_type then
    v_daily := 0;
  elsif v_plan = 'teacher_plus'::public.plan_type then
    v_daily := card.teacher_plus_monthly_poisha / 30;
  else
    v_remaining := v_students;
    for band in
      select v.value as b
      from pg_catalog.jsonb_array_elements(card.student_bands) v
    loop
      exit when v_remaining <= 0;
      v_up_to := (band.b->>'upTo')::integer;
      v_band_size := case when v_up_to is null then v_remaining
                          else v_up_to - v_band_floor end;
      v_in_band := least(v_remaining, v_band_size);
      v_band_sum := v_band_sum + v_in_band * (band.b->>'poishaEach')::bigint;
      v_remaining := v_remaining - v_in_band;
      v_band_floor := coalesce(v_up_to, v_band_floor);
    end loop;

    v_monthly := greatest(
      case when v_plan = 'institution'::public.plan_type
             then card.institution_monthly_floor_poisha
             else card.center_monthly_floor_poisha end,
      v_band_sum
    );

    -- Seats on both per-student tiers. Branches only where they are sold —
    -- a centre moved off institution keeps its branch rows, and branchChargeBdt's
    -- own rule is that we do not bill for something they were never sold.
    v_monthly := v_monthly
      + greatest(0, v_teachers - card.free_teacher_seats) * card.teacher_seat_poisha;

    if v_plan = 'institution'::public.plan_type then
      v_monthly := v_monthly
        + greatest(0, v_branches - card.included_branches) * card.branch_poisha;
    end if;

    -- Integer division floors, which is the customer's favour and §11.6's rule.
    v_daily := v_monthly / 30;
  end if;

  -- Nothing to burn: a free tier, or coverage already carried past today by a
  -- grant or a founder's hand. charged_through = TODAY is deliberately not
  -- here — that is the ordinary state after the morning's charge, and the
  -- top-up below is what a noon roster growth must still be able to reach.
  -- No rows, no runs on the way out: a run a day for every free centre in the
  -- country would be a table nobody reads.
  if v_daily <= 0 or v_charged_through > v_today then
    return jsonb_build_object('ok', true, 'status', 'nothing_due',
                              'dailyPoisha', v_daily, 'chargedPoisha', 0,
                              'days', 0);
  end if;

  select coalesce(pg_catalog.sum(l.amount_poisha), 0)
    into v_balance
  from public.billing_ledger l
  where l.coaching_center_id = p_center;

  -- Whole past days first, oldest first, for as long as the balance affords
  -- each one. Past days are charged at today's rate: the size is only knowable
  -- now, and the cron exists so these are rare rather than routine.
  v_day := v_charged_through + 1;
  while v_day < v_today loop
    exit when v_balance < v_daily;

    insert into public.billing_ledger (
      coaching_center_id, kind, amount_poisha, charge_date,
      usage_students, usage_teachers, usage_branches,
      description, price_version_id, top_up
    ) values (
      p_center, 'daily_charge', -v_daily, v_day,
      v_students, v_teachers, v_branches,
      'One day''s use.', card.id, false
    );

    select coalesce(max(r.attempt), 0) into v_attempt
    from app.settlement_runs r
    where r.coaching_center_id = p_center
      and r.charge_date = v_day;

    insert into app.settlement_runs (
      coaching_center_id, charge_date, status, attempt, price_version_id,
      usage_students, usage_teachers, usage_branches, amount_poisha, ran_by
    ) values (
      p_center, v_day, 'settled', v_attempt + 1, card.id,
      v_students, v_teachers, v_branches, -v_daily, p_ran_by
    );

    v_balance := v_balance - v_daily;
    v_charged := v_charged + v_daily;
    v_days := v_days + 1;
    v_day := v_day + 1;
  end loop;

  -- Today. Three shapes, decided by what the day already holds rather than by
  -- what charged_through says about it:
  --   * a base charge exists — the day was charged at a smaller size, and only
  --     the difference is inserted (§11.7 step 4). Convergent: a second call
  --     with the same size inserts nothing.
  --   * no base and charged_through < today — the first write of the day.
  --   * no base and charged_through >= today — the day is covered by the
  --     migration's seeding or a grant, and owes nothing: charging it would
  --     bill a day twice (§11.14's whole safety argument).
  if exists (
    select 1 from public.billing_ledger l
    where l.coaching_center_id = p_center
      and l.charge_date = v_today
      and l.kind = 'daily_charge'
      and not l.top_up
  ) then
    select coalesce(-pg_catalog.sum(l.amount_poisha), 0)
      into v_today_so_far
    from public.billing_ledger l
    where l.coaching_center_id = p_center
      and l.charge_date = v_today
      and l.kind = 'daily_charge';

    v_diff := v_daily - v_today_so_far;
    if v_diff > 0 then
      if v_balance >= v_diff then
        insert into public.billing_ledger (
          coaching_center_id, kind, amount_poisha, charge_date,
          usage_students, usage_teachers, usage_branches,
          description, price_version_id, top_up
        ) values (
          p_center, 'daily_charge', -v_diff, v_today,
          v_students, v_teachers, v_branches,
          'Same day, larger roster.', card.id, true
        );

        select coalesce(max(r.attempt), 0) into v_attempt
        from app.settlement_runs r
        where r.coaching_center_id = p_center
          and r.charge_date = v_today;

        insert into app.settlement_runs (
          coaching_center_id, charge_date, status, attempt, price_version_id,
          usage_students, usage_teachers, usage_branches, amount_poisha, ran_by
        ) values (
          p_center, v_today, 'settled', v_attempt + 1, card.id,
          v_students, v_teachers, v_branches, -v_diff, p_ran_by
        );

        v_balance := v_balance - v_diff;
        v_charged := v_charged + v_diff;
        v_days := v_days + 1;
      else
        insert into app.settlement_runs (
          coaching_center_id, charge_date, status, price_version_id,
          usage_students, usage_teachers, usage_branches, amount_poisha, ran_by
        ) values (
          p_center, v_today, 'insufficient_balance', card.id,
          v_students, v_teachers, v_branches, 0, p_ran_by
        );
        v_outcome := 'insufficient_balance';
      end if;
    end if;

    -- THE LINE NEVER LAGS A PAID DAY. The apply trigger advances
    -- charged_through on every insert, so in the natural course this is already
    -- true — but a charged_through moved by hand past days that were already
    -- charged (the one thing only the platform can do) would leave the line
    -- behind a paid day, and every comparison built on it would then read a
    -- centre that is paid up as owing a day it has already bought. One update,
    -- no history rewritten: the day has its base charge, and the line says so.
    update public.coaching_centers
       set charged_through = v_today
     where id = p_center
       and charged_through < v_today;
  elsif v_charged_through < v_today then
    if v_balance >= v_daily then
      insert into public.billing_ledger (
        coaching_center_id, kind, amount_poisha, charge_date,
        usage_students, usage_teachers, usage_branches,
        description, price_version_id, top_up
      ) values (
        p_center, 'daily_charge', -v_daily, v_today,
        v_students, v_teachers, v_branches,
        'One day''s use.', card.id, false
      );

      select coalesce(max(r.attempt), 0) into v_attempt
      from app.settlement_runs r
      where r.coaching_center_id = p_center
        and r.charge_date = v_today;

      insert into app.settlement_runs (
        coaching_center_id, charge_date, status, attempt, price_version_id,
        usage_students, usage_teachers, usage_branches, amount_poisha, ran_by
      ) values (
        p_center, v_today, 'settled', v_attempt + 1, card.id,
        v_students, v_teachers, v_branches, -v_daily, p_ran_by
      );

      v_balance := v_balance - v_daily;
      v_charged := v_charged + v_daily;
      v_days := v_days + 1;
    else
      -- Whole days or nothing: the money stays theirs, the day stays unpaid,
      -- and the run says which of the two it was.
      insert into app.settlement_runs (
        coaching_center_id, charge_date, status, price_version_id,
        usage_students, usage_teachers, usage_branches, amount_poisha, ran_by
      ) values (
        p_center, v_today, 'insufficient_balance', card.id,
        v_students, v_teachers, v_branches, 0, p_ran_by
      );
      v_outcome := 'insufficient_balance';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'status', v_outcome,
    'dailyPoisha', v_daily, 'chargedPoisha', v_charged,
    'days', v_days, 'balanceAfter', v_balance
  );
end;
$$;

comment on function public.settle_billing(uuid, text) is
  'MASTERPLAN.md §11.7 — the burn. Charges every unsettled whole past day and '
  'today at the current size, whole days only, under the ledger balance lock, '
  'with the head counts and the price card recorded on every row. Idempotent '
  'per day: the base charge is unique per (centre, date) and the top-up '
  'inserts only the difference. Accepts no amount from anybody.';

revoke all on function public.settle_billing(uuid, text) from public, anon;
grant execute on function public.settle_billing(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The reconciliation, on the founder panel (§11.13).
--
-- Three questions, each a query, each returning only the rows that are wrong:
--   1. does the cache column equal the ledger's sum for every centre?
--   2. does every chain open where the one before it closed, and at zero?
--   3. is there a gap in a centre's charged days, or a charged_through
--      past today with nothing to explain it?
-- A healthy database returns no rows. The panel is where it lives rather than
-- an email, because an email nobody reads is worse than a figure on a screen
-- the founder opens daily anyway.
--
-- The gating and grants follow platform_centers exactly: definer, revoked
-- from public, granted to authenticated, and app.is_platform_admin() asked
-- inside — so the anon key and every centre's own session are both refused at
-- the function, not at a screen.
-- ---------------------------------------------------------------------------

create or replace function public.platform_reconciliation()
returns table (
  question integer,
  coaching_center_id uuid,
  coaching_center_name text,
  detail text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'platform_reconciliation requires the platform admin'
      using errcode = '42501';
  end if;

  -- 1. The cache column against the entries it claims to summarise.
  return query
  select 1, c.id, c.name,
         'balance_poisha is ' || c.balance_poisha
         || ' but the ledger sums to ' || coalesce(s.total, 0)
  from public.coaching_centers c
  left join (
    select l.coaching_center_id, pg_catalog.sum(l.amount_poisha) as total
    from public.billing_ledger l
    group by l.coaching_center_id
  ) s on s.coaching_center_id = c.id
  where c.balance_poisha is distinct from coalesce(s.total, 0);

  -- 2. The chain: each row opens where the previous one closed, and the first
  -- opens at zero. The CHECK constraint already refuses a row that disagrees
  -- with itself; this is the walk that finds a row disagreeing with its
  -- neighbour, which no constraint can express.
  return query
  with ordered as (
    select l.coaching_center_id, l.balance_before, l.balance_after,
           pg_catalog.row_number() over (
             partition by l.coaching_center_id
             order by l.created_at, l.id) as n
    from public.billing_ledger l
  )
  select 2, c.id, c.name,
         'entry ' || o.n || ' opens at ' || o.balance_before
         || ' where ' || coalesce(p.balance_after::text, 'nothing') || ' closed'
  from ordered o
  join public.coaching_centers c on c.id = o.coaching_center_id
  left join ordered p
    on p.coaching_center_id = o.coaching_center_id and p.n = o.n - 1
  where o.balance_before is distinct from coalesce(p.balance_after, 0);

  -- 3. The line and the payments it claims to summarise.
  --
  -- "A gap in the charged days" as written in §11.13 cannot be asked literally:
  -- a centre that ran dry for three days has three quite legitimate uncharged
  -- days between two charged ones, and flagging them would cry wolf on the
  -- product working. The checkable half — the invariant the whole access
  -- comparison rests on — is that the line never lags a day that was paid for:
  -- `charged_through` sits at or past every daily charge the centre holds. The
  -- apply trigger holds this on every insert; this is the query that proves it.
  --
  -- charged_through past today is only an alert when nothing explains it: a
  -- centre still carrying a `paid_through` from the old model keeps those days
  -- by design (§11.14 — "a centre that has paid past today keeps its date"), so
  -- the payments are the explanation and the question is only asked past them.
  -- When the founder levers land (step 26) a grant with its audit line becomes
  -- the third explanation, and this half narrows again.
  return query
  select 3, c.id, c.name,
         'charged_through is ' || c.charged_through
         || ' but ' || paid.last_day || ' was charged for'
  from public.coaching_centers c
  join (
    select l.coaching_center_id, max(l.charge_date) as last_day
    from public.billing_ledger l
    where l.kind = 'daily_charge'
    group by l.coaching_center_id
  ) paid on paid.coaching_center_id = c.id
  where c.charged_through < paid.last_day;

  return query
  select 3, c.id, c.name,
         'charged_through is ' || c.charged_through
         || ', past today and past every payment, with nothing to explain it'
  from public.coaching_centers c
  where c.charged_through > (pg_catalog.now() at time zone 'Asia/Dhaka')::date
    and c.charged_through > coalesce(c.paid_through,
                                     (pg_catalog.now() at time zone 'Asia/Dhaka')::date);
end;
$$;

comment on function public.platform_reconciliation() is
  'MASTERPLAN.md §11.13 — the three reconciliation questions, answered. No '
  'rows means the books hold. Platform admin only, asked inside the function.';

revoke all on function public.platform_reconciliation() from anon, authenticated, public;
grant execute on function public.platform_reconciliation() to authenticated;
