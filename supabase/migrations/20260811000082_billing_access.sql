-- CoachDesk BD — access is the balance: the burn's return shape, and one note a
-- day (MASTERPLAN §4.4, §11.7, §11.13; build-order step 24).
--
-- WHY THIS MIGRATION EXISTS AT ALL, given 81 landed the burn. Step 24 is the
-- commit that makes `session.access` a *comparison* — `balance < owed` — and
-- that comparison needs two figures the burn already knows and did not say:
-- what the balance is now, and what the line (`charged_through`) now reads.
-- It needs them FROM THE SAME CALL, because between the settlement and a
-- second select the row can move, and a session that settles a day and then
-- reads a stale balance is exactly the disagreement §4.4 forbids. So the
-- function returns them, on every path it can return on.
--
-- AND IT FIXES A CRASH THAT WOULD HAVE BEEN A LOCKOUT. 81 recorded a refusal
-- with the `attempt` column's default of 1, while recording a settled day with
-- `max(attempt) + 1`. So the *second* refusal for a (centre, day) — the owner
-- of a dry centre tapping Save twice, which under step 24 is every second
-- request they make — collided with `settlement_runs_once` and raised. The
-- statement aborted, which means the whole settlement did: a day that *could*
-- have been paid for in the same call as a refusal was rolled back with it.
-- Every insert below now numbers its own attempt, so the constraint that
-- exists to stop one attempt being recorded twice can never fire on two
-- different ones.
--
-- AND A REFUSAL IS ONE FACT ABOUT A DAY, not one per tap. `settlement_runs`
-- records every attempt and that stays true — a founder's manual retry is a
-- new attempt, and a top-up after a mid-day refusal is another — but a day
-- that ran dry is a day that ran dry however many times its owner tried. The
-- partial index below says exactly that, and the refusals lean on
-- `on conflict do nothing` to make a repeat a no-op instead of a row. Without
-- it, a centre with ৳50 in the balance would write a `settlement_runs` row
-- every time a member opened a page, and the table §11.13 calls the audit
-- would become a log of page views.
--
-- WHAT IS NOT HERE: no grace, no credit, no second derivation. `owed` is
-- arithmetic over the two columns, computed where it is read (§4.4).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. One note a day: a day has at most one row saying why it did not settle.
--
-- `settled` rows are deliberately outside the index, because a day can
-- legitimately hold two — the base charge and the high-water top-up are two
-- entries and therefore two runs, and §11.7 step 4 is what makes the second
-- one a real event rather than a duplicate. Everything else is a statement
-- about the day: it could not be paid for, or the counts could not be read, or
-- the price card was missing. A second one of those an hour later is the same
-- statement.
-- ---------------------------------------------------------------------------

-- The index can only be built once the existing rows obey it, and 81's
-- refusal path could write a second one for a day the moment anybody invoked
-- the burn by hand — which, until step 24, was the only way it could be
-- invoked. Keeping the latest of a set is keeping the one that was written
-- against the most recent state of the world; the ones under it say the same
-- thing about an earlier minute of the same day, and the index is the
-- statement that they are not separate facts.

delete from app.settlement_runs r
using (
  select id,
         pg_catalog.row_number() over (
           partition by coaching_center_id, charge_date
           order by attempt desc, created_at desc
         ) as n
  from app.settlement_runs
  where status <> 'settled'
) dup
where r.id = dup.id
  and dup.n > 1;

create unique index settlement_runs_one_note_per_day
  on app.settlement_runs (coaching_center_id, charge_date)
  where status <> 'settled';

comment on index app.settlement_runs_one_note_per_day is
  'MASTERPLAN.md §11.13 — at most one non-settled row per centre per Dhaka day. '
  'Settled rows are excluded, because a base charge and its top-up are two '
  'genuine attempts on one day; a repeated refusal is not.';

-- ---------------------------------------------------------------------------
-- 2. The burn, re-stated: same arithmetic, same lock, same refusals — with an
--    attempt number of its own on every row it writes, and the two figures the
--    access comparison reads on every return.
--
-- NOTHING ABOUT THE PRICING CHANGED. The rate is still computed from the card
-- in force and the same `app.active_students` / `app.active_teachers` the
-- capacity trigger reads, whole past days are still charged oldest first for
-- as long as the balance affords each one, and today is still topped up to its
-- high-water rate rather than charged twice. A day nobody can afford still
-- buys nothing.
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
  -- The line as it stands at the end, read back from the row: every insert
  -- above moves it through the ledger's own trigger, and the value the caller
  -- must compare against is the one on the row rather than the one this
  -- function believed when it started.
  v_line date;
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
    select coalesce(pg_catalog.sum(l.amount_poisha), 0)
      into v_balance
    from public.billing_ledger l
    where l.coaching_center_id = p_center;

    select coalesce(max(r.attempt), 0) + 1 into v_attempt
    from app.settlement_runs r
    where r.coaching_center_id = p_center
      and r.charge_date = v_today;

    insert into app.settlement_runs (
      coaching_center_id, charge_date, status, attempt, error_detail, ran_by
    ) values (
      p_center, v_today, 'error', v_attempt,
      'no price version in force', p_ran_by
    )
    on conflict do nothing;

    return jsonb_build_object('ok', false, 'status', 'error',
                              'error', 'no price version in force',
                              'dailyPoisha', null,
                              'balanceAfter', v_balance,
                              'chargedThrough', v_charged_through);
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
    select coalesce(pg_catalog.sum(l.amount_poisha), 0)
      into v_balance
    from public.billing_ledger l
    where l.coaching_center_id = p_center;

    select coalesce(max(r.attempt), 0) + 1 into v_attempt
    from app.settlement_runs r
    where r.coaching_center_id = p_center
      and r.charge_date = v_today;

    insert into app.settlement_runs (
      coaching_center_id, charge_date, status, attempt, error_detail, ran_by
    ) values (
      p_center, v_today, 'usage_unavailable', v_attempt,
      left(sqlerrm || ' [' || sqlstate || ']', 300), p_ran_by
    )
    on conflict do nothing;

    -- `dailyPoisha` IS NULL AND NOT ZERO, and the difference is the whole of
    -- §11.7's fallback: zero is a rate that has been read and is nothing,
    -- which is the free tier; null is a rate that could not be read, which is
    -- a read-only answer wherever the rate is needed.
    return jsonb_build_object('ok', false, 'status', 'usage_unavailable',
                              'error', left(sqlerrm, 200),
                              'dailyPoisha', null,
                              'balanceAfter', v_balance,
                              'chargedThrough', v_charged_through);
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

  select coalesce(pg_catalog.sum(l.amount_poisha), 0)
    into v_balance
  from public.billing_ledger l
  where l.coaching_center_id = p_center;

  -- Nothing to burn: a free tier, or coverage already carried past today by a
  -- grant or a founder's hand. charged_through = TODAY is deliberately not
  -- here — that is the ordinary state after the morning's charge, and the
  -- top-up below is what a noon roster growth must still be able to reach.
  -- No rows, no runs on the way out: a run a day for every free centre in the
  -- country would be a table nobody reads.
  if v_daily <= 0 or v_charged_through > v_today then
    return jsonb_build_object('ok', true, 'status', 'nothing_due',
                              'dailyPoisha', v_daily, 'chargedPoisha', 0,
                              'days', 0, 'balanceAfter', v_balance,
                              'chargedThrough', v_charged_through);
  end if;

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
        select coalesce(max(r.attempt), 0) + 1 into v_attempt
        from app.settlement_runs r
        where r.coaching_center_id = p_center
          and r.charge_date = v_today;

        insert into app.settlement_runs (
          coaching_center_id, charge_date, status, attempt, price_version_id,
          usage_students, usage_teachers, usage_branches, amount_poisha, ran_by
        ) values (
          p_center, v_today, 'insufficient_balance', v_attempt, card.id,
          v_students, v_teachers, v_branches, 0, p_ran_by
        )
        on conflict do nothing;

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
      select coalesce(max(r.attempt), 0) + 1 into v_attempt
      from app.settlement_runs r
      where r.coaching_center_id = p_center
        and r.charge_date = v_today;

      insert into app.settlement_runs (
        coaching_center_id, charge_date, status, attempt, price_version_id,
        usage_students, usage_teachers, usage_branches, amount_poisha, ran_by
      ) values (
        p_center, v_today, 'insufficient_balance', v_attempt, card.id,
        v_students, v_teachers, v_branches, 0, p_ran_by
      )
      on conflict do nothing;

      v_outcome := 'insufficient_balance';
    end if;
  end if;

  -- The line as the row now holds it, after this call's inserts went through
  -- the ledger's trigger. Read rather than assumed: a settlement that charged
  -- three catch-up days and then ran dry has a line three days further on than
  -- the one this function read at the top, and a caller comparing against the
  -- stale value would put a paid centre into read-only.
  select c.charged_through into v_line
  from public.coaching_centers c
  where c.id = p_center;

  return jsonb_build_object(
    'ok', true, 'status', v_outcome,
    'dailyPoisha', v_daily, 'chargedPoisha', v_charged,
    'days', v_days, 'balanceAfter', v_balance,
    'chargedThrough', v_line
  );
end;
$$;

comment on function public.settle_billing(uuid, text) is
  'MASTERPLAN.md §11.7 — the burn. Charges every unsettled whole past day and '
  'today at the current size, whole days only, under the ledger balance lock, '
  'with the head counts and the price card recorded on every row. Idempotent '
  'per day: the base charge is unique per (centre, date) and the top-up '
  'inserts only the difference. Accepts no amount from anybody. Returns the '
  'balance and the line the access comparison reads (§4.4), and null '
  'dailyPoisha when the rate could not be read — which is the read-only answer, '
  'not a zero.';

revoke all on function public.settle_billing(uuid, text) from public, anon;
grant execute on function public.settle_billing(uuid, text) to authenticated, service_role;
