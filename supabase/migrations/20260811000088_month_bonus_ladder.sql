-- MASTERPLAN.md §11.6/§11.11 — the bonus ladder becomes month-anchored, and the
-- definition of "three months" moves from the masterplan's worked example to the
-- centre's own bill.
--
-- THE DEFECT THIS FIXES WAS VISIBLE TO THE FOUNDER. The founding ladder floors at
-- absolute taka — ৳7,800, ৳15,600, ৳31,200 — calibrated on a centre paying ৳2,600 a
-- month. But the recharge screen offers each centre multiples of ITS OWN monthly
-- figure, so a centre paying ৳2,099 (the RLS suite's own 100/3 worked example) is
-- shown a "3 months" button priced ৳6,297 — under the first floor — and a button
-- that says three months answers 0%. Worse on Teacher Pro: ৳499 a month means even
-- twelve months (৳5,988) never reaches the first rung. An absolute ladder cannot
-- serve tiers whose monthly figures differ by an order of magnitude, and the fix is
-- the founder's own reading of the offer: the bonus rewards COMMITMENT, not size.
--
-- THE LADDER (founder's decision, 2026-09-30): 1 month none, 3–5 months 5%,
-- 6–11 months 10%, 12+ months 20%. A typed amount derives its months the same way
-- the buttons do — amount ÷ this centre's monthly figure — so a typed ৳6,000 at
-- ৳2,099/month is "2.8 months" and carries no bonus, honestly.
--
-- THE TIERS CHANGE SHAPE, NOT JUST NUMBERS. `min_poisha` becomes `min_months` —
-- a number of the centre's own months, and therefore a floor that means the same
-- thing on every tier. The old two-argument `app.bonus_poisha` is REPLACED by a
-- three-argument one that takes the monthly figure the months are counted from:
-- a tier with no monthly figure cannot mean months, and answering 0 in that case
-- is the same fail-closed direction every other unreadable input in §11 resolves
-- to. Every caller is updated in the same commit (the panel's approval and the
-- screen's quote), so no window exists where the two engines disagree.
--
-- THE MONTHLY FIGURE, AND WHY THE APPROVAL RECOMPUTES IT FROM STORED COUNTS. The
-- claim row already carries usage_students/teachers/branches — the size the quote
-- was priced from (§11.12's snapshot rule: the quote explains itself). The
-- approval derives monthly from THOSE counts against the claim's OWN price card
-- (the one its price_version_id names), never today's roster and never the newest
-- card: a customer quoted at 58 students and approved tomorrow at 61 must not be
-- silently repriced by growth that happened between the two moments. This is the
-- same discipline the settlement already follows — the day is charged from the
-- size at the moment work starts.
--
-- THE WORKED FIGURES ARE UNCHANGED. The fixture centre is 100 students / 3
-- teachers / 1 branch = ৳2,600 a month, which is the masterplan's own example —
-- so ৳7,800 is 3 months, 5% = ৳39,000 poisha, exactly the literals the suites
-- already assert. What changes for a real centre is only that the rungs now sit
-- at multiples of THEIR month rather than a ৳2,600 month.
--
-- NOTHING IS DROPPED. Old claims keep their quoted figures; approved recharges
-- keep their credited bonuses; the ledger explains itself. Only the ladder
-- forward is re-anchored.

-- ---------------------------------------------------------------------------
-- 1. The reusable monthly figure, in SQL — the mirror of monthlyBillBdt in
--    src/lib/plans.ts, from the same card shape 20260811000081's settlement
--    already walks. The settlement's band loop and this are the same arithmetic;
--    making it a function means the approval does not grow a second copy.
--
--    IMMUTABLE because it is pure arithmetic over its arguments — no clock, no
--    table read — so the planner may inline it and a test may call it directly.
-- ---------------------------------------------------------------------------

create or replace function app.monthly_bill_poisha(
  p_card public.price_versions,
  p_plan public.plan_type,
  p_students integer,
  p_teachers integer,
  p_branches integer
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_band record;
  v_remaining integer;
  v_up_to integer;
  v_band_size integer;
  v_in_band integer;
  v_band_floor integer := 0;
  v_band_sum bigint := 0;
  v_monthly bigint;
begin
  if p_plan = 'teacher_free'::public.plan_type then
    return 0;
  end if;

  if p_plan = 'teacher_plus'::public.plan_type then
    return p_card.teacher_plus_monthly_poisha;
  end if;

  -- The marginal bands, walked exactly as 20260811000081's settlement walks them
  -- and as monthlyBillBdt walks them in plans.ts: the first hundred students at
  -- the first rate, the next two hundred at the second, and so on, and the floor
  -- beneath whatever the bands come to.
  v_remaining := greatest(0, coalesce(p_students, 0));
  for v_band in
    select v.value as b
      from jsonb_array_elements(p_card.student_bands) v
  loop
    exit when v_remaining <= 0;
    v_up_to := (v_band.b ->> 'upTo')::integer;
    v_band_size := case
      when v_up_to is null then v_remaining
      else v_up_to - v_band_floor end;
    v_in_band := least(v_remaining, v_band_size);
    v_band_sum := v_band_sum + v_in_band * (v_band.b ->> 'poishaEach')::bigint;
    v_remaining := v_remaining - v_in_band;
    v_band_floor := coalesce(v_up_to, v_band_floor);
  end loop;

  v_monthly := greatest(
    case when p_plan = 'institution'::public.plan_type
         then p_card.institution_monthly_floor_poisha
         else p_card.center_monthly_floor_poisha end,
    v_band_sum
  );

  -- Seats on both per-student tiers. Branches only where they are sold — a
  -- centre moved off institution keeps its branch rows, and branchChargeBdt's
  -- own rule is that we do not bill for something they were never sold.
  v_monthly := v_monthly
    + greatest(0, coalesce(p_teachers, 0) - p_card.free_teacher_seats)
      * p_card.teacher_seat_poisha;

  if p_plan = 'institution'::public.plan_type then
    v_monthly := v_monthly
      + greatest(0, coalesce(p_branches, 0) - p_card.included_branches)
        * p_card.branch_poisha;
  end if;

  return v_monthly;
end;
$$;

comment on function app.monthly_bill_poisha(public.price_versions, public.plan_type, integer, integer, integer) is
  'MASTERPLAN.md §11.6 — a centre''s monthly bill, in poisha, from a price card '
  'and a roster size. The SQL mirror of monthlyBillBdt in src/lib/plans.ts: the '
  'floor, the marginal student bands, the seats and (on the institution tier) the '
  'branches. The settlement and the recharge approval both price from this one '
  'function, so a card change reprices both together.';

-- ---------------------------------------------------------------------------
-- 2. The ladder, re-anchored to months.
-- ---------------------------------------------------------------------------

update public.promotions
   set tiers = jsonb_build_array(
         jsonb_build_object('min_months', 3,  'bonus_bps', 500),
         jsonb_build_object('min_months', 6,  'bonus_bps', 1000),
         jsonb_build_object('min_months', 12, 'bonus_bps', 2000)
       )
 where code = 'LAUNCH';

comment on table public.promotions is
  'MASTERPLAN.md §11.11 — recharge promotions. Tiers are month-anchored since '
  '20260811000088: min_months is a count of the centre''s own monthly figure, '
  'not absolute taka, so one ladder serves every tier (the founder''s decision '
  'of 2026-09-30: 1 month none, 3–5 months 5%, 6–11 months 10%, 12+ months 20%).';

-- ---------------------------------------------------------------------------
-- 3. The bonus, month-derived. Three arguments now: the tiers, the amount, and
--    the monthly figure the months are counted from.
--
--    p_monthly <= 0 answers 0 rather than dividing by it: a free tier has no
--    months to buy, and a monthly figure nobody could read is not evidence of a
--    discount (the same direction §11.12 takes an unreadable count).
--
--    Months are FLOORED, in the customer's disfavour and deliberately: 2.9
--    months of money is 2 months of commitment. A centre that sends ৳7,799
--    against a ৳7,800 quote did not buy the third month.
-- ---------------------------------------------------------------------------

create or replace function app.bonus_poisha(p_tiers jsonb, p_amount bigint, p_monthly bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_amount is null or p_monthly is null or p_amount <= 0 or p_monthly <= 0 then 0::bigint
    else floor(
      p_amount * (
        select max(greatest((tier ->> 'bonus_bps')::numeric, 0))
        from jsonb_array_elements(p_tiers) as tier
        where (tier ->> 'min_months') is not null
          and jsonb_typeof(tier -> 'min_months') = 'number'
          and floor(p_amount::numeric / p_monthly)
              >= (tier ->> 'min_months')::numeric
          and jsonb_typeof(tier -> 'bonus_bps') = 'number'
      ) / 10000
    )::bigint
  end;
$$;

comment on function app.bonus_poisha(jsonb, bigint, bigint) is
  'MASTERPLAN.md §11.6/§11.11 — the bonus for an amount, in poisha, floored in '
  'the customer''s favour. Months are derived as amount ÷ monthly, floored; the '
  'highest min_months floor the months reach wins. The one reader of '
  'promotions.tiers: the screen quotes with it and the approval credits with it, '
  'so the two cannot disagree.';

-- The old two-argument shape is gone, not deprecated: a caller still passing
-- two arguments must fail loudly at deploy time rather than silently read the
-- ladder as absolute taka again. 20260811000084's own body was its only caller,
-- and section 4 below replaces it.
drop function app.bonus_poisha(jsonb, bigint);

revoke all on function app.bonus_poisha(jsonb, bigint, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The approval, month-aware. The only change to the function's body is how
--    the bonus is derived: the monthly figure comes from the claim's own stored
--    counts against the claim's own card, and the ladder reads months. Everything
--    else — the lock, the replay fence, the two ledger rows, the audit — is
--    byte-identical to 20260811000084's, restated here because
--    create-or-replace of the function is the only way to change it.
-- ---------------------------------------------------------------------------

create or replace function public.approve_recharge_claim(
  p_claim uuid,
  p_arrived_poisha bigint default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_claim public.recharge_claims%rowtype;
  v_promotion public.promotions%rowtype;
  v_has_promotion boolean := false;
  v_card public.price_versions%rowtype;
  v_monthly bigint;
  v_arrived bigint;
  v_bonus bigint := 0;
  v_payment_id uuid;
  v_balance bigint;
begin
  if auth.uid() is not null then
    if not app.is_platform_admin() then
      raise exception 'only the platform can approve a recharge'
        using errcode = '42501';
    end if;
  elsif current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'only the platform can approve a recharge'
      using errcode = '42501';
  end if;

  -- Locked, so two founders reading the same queue cannot both approve it. The
  -- second one waits and then finds it is not submitted any more.
  select * into v_claim
    from public.recharge_claims c
   where c.id = p_claim
     for update;

  if not found then
    raise exception 'approve_recharge_claim: no such claim' using errcode = '23503';
  end if;

  if v_claim.state <> 'submitted' then
    raise exception 'this claim is already %', v_claim.state
      using errcode = '23514';
  end if;

  -- §11.9's "approval may override the amount", because customers send the wrong
  -- figure constantly. Null means "what they said they sent".
  v_arrived := coalesce(p_arrived_poisha, v_claim.quoted_poisha);

  if v_arrived <= 0 then
    raise exception 'an approval credits money that arrived, and % did not',
      v_arrived using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.recharge_claims c
     where c.state = 'approved'
       and c.id <> v_claim.id
       and lower(btrim(c.trx_id))
           = lower(btrim(v_claim.trx_id))
  ) then
    raise exception
      'transaction % has already been credited to another claim',
      v_claim.trx_id using errcode = '23505';
  end if;

  -- The promotion live now, on the card the claim was quoted from. Both halves
  -- matter: an ended promotion credits nothing on a claim filed today, and a
  -- card change is a repricing (§11.10) rather than an error.
  select * into v_promotion
    from public.promotions p
   where p.active
     and p.price_version_id = v_claim.price_version_id
     and p.starts_at <= now()
     and (p.ends_at is null or p.ends_at > now())
   order by p.created_at desc
   limit 1;

  v_has_promotion := found;

  -- The monthly figure the months are counted from: THE CLAIM'S OWN SNAPSHOT.
  -- The counts are the size the quote was priced from, and the card is the one
  -- the claim names — never the newest card and never today's roster, so a
  -- customer approved tomorrow is not repriced by growth that happened in
  -- between (§11.12's snapshot rule, applied to the approval). A claim whose
  -- counts or card cannot be read prices no bonus, rather than guessing one:
  -- the same fail-closed direction an unreadable count takes everywhere else.
  select * into v_card
    from public.price_versions pv
   where pv.id = v_claim.price_version_id;

  if found
     and v_claim.usage_students is not null
     and v_claim.usage_teachers is not null
     and v_claim.usage_branches is not null then
    select app.monthly_bill_poisha(
             v_card,
             (select c.plan
                from public.coaching_centers c
               where c.id = v_claim.coaching_center_id),
             v_claim.usage_students,
             v_claim.usage_teachers,
             v_claim.usage_branches
           )
      into v_monthly;
  end if;

  if v_has_promotion and v_monthly is not null then
    v_bonus := app.bonus_poisha(v_promotion.tiers, v_arrived, v_monthly);
  end if;

  -- 1. The money that actually arrived. This is revenue, and it is the row the
  -- founder's reporting reads. Whole taka are the ordinary case; `numeric(10,2)`
  -- carries the poisha when they are not.
  insert into public.payments (
    coaching_center_id, amount_bdt, method, reference, note, recorded_by
  )
  values (
    v_claim.coaching_center_id,
    (v_arrived::numeric / 100),
    'bkash',
    v_claim.trx_id,
    coalesce(
      p_note,
      'Recharge ' || v_claim.reference_code || ' (claim ' || v_claim.id || ')'
    ),
    auth.uid()
  )
  returning id into v_payment_id;

  -- 2. The credit. `price_version_id` is required on this kind by
  -- 20260811000080, and the claim is where it comes from — which is exactly the
  -- "why was March ৳86.66" question that column exists to answer.
  insert into public.billing_ledger (
    coaching_center_id, kind, amount_poisha, payment_id, price_version_id,
    description, created_by, metadata
  )
  values (
    v_claim.coaching_center_id,
    'recharge',
    v_arrived,
    v_payment_id,
    v_claim.price_version_id,
    'Recharge ' || v_claim.reference_code || ' — ৳'
      || to_char(v_arrived::numeric / 100, 'FM999999990.00'),
    auth.uid(),
    jsonb_build_object(
      'kind', 'recharge',
      'reference_code', v_claim.reference_code,
      'claim_id', v_claim.id,
      'promotion_id', case when v_has_promotion then v_promotion.id end,
      'source', 'claim'
    )
  );

  -- 3. The gift, on a row of its own — never merged into the cash. §11.11's
  -- table is the specification: revenue is what arrived, the bonus is a
  -- marketing cost, and one merged figure makes both unanswerable.
  if v_bonus > 0 then
    insert into public.billing_ledger (
      coaching_center_id, kind, amount_poisha, price_version_id, description,
      created_by, metadata
    )
    values (
      v_claim.coaching_center_id,
      'promotion_bonus',
      v_bonus,
      -- Deliberately null: 20260811000080 allows a price version on a
      -- `daily_charge` and a `recharge` only. A bonus is a gift, not a price.
      null,
      'Recharge bonus — ' || v_promotion.code,
      auth.uid(),
      jsonb_build_object(
        'claim_id', v_claim.id,
        'promotion_id', v_promotion.id
      )
    );
  end if;

  update public.recharge_claims
     set state = 'approved',
         arrived_poisha = v_arrived,
         granted_poisha = v_arrived,
         granted_bonus_poisha = v_bonus,
         granted_promotion_id = case when v_has_promotion then v_promotion.id end,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = v_claim.id;

  -- The new balance, read back under the ledger's own advisory lock (the trigger
  -- in 20260811000078 holds it for the inserts above; the read is last so the
  -- answer the screen shows is the row's, not a race).
  select coalesce(sum(l.amount_poisha), 0)
    into v_balance
    from public.billing_ledger l
   where l.coaching_center_id = v_claim.coaching_center_id;

  return jsonb_build_object(
    'ok', true,
    'arrivedPoisha', v_arrived,
    'bonusPoisha', v_bonus,
    'creditPoisha', v_arrived + v_bonus,
    'balanceAfter', v_balance,
    'monthlyPoisha', v_monthly
  );
end;
$$;

comment on function public.approve_recharge_claim(uuid, bigint, text) is
  'MASTERPLAN.md §11.9 — credit a recharge claim, month-aware since '
  '20260811000088: the bonus''s months are derived from the claim''s own stored '
  'counts against the claim''s own price card, never from today''s roster. '
  'Everything else is 20260811000084''s contract unchanged.';

-- ---------------------------------------------------------------------------
-- 5. The migration's own smoke test, run once here: the fixture centre (100/3/1
--    = ৳2,600 a month) at the masterplan's own literals, plus the boundary the
--    founder's complaint was about — a ৳2,099 centre whose three months now
--    carries the 5% the button promises.
-- ---------------------------------------------------------------------------

do $$
declare
  v_card public.price_versions;
  v_center bigint;
  v_pro uuid;
  v_plus bigint;
  v_small bigint;
begin
  select * into v_card from public.price_versions order by effective_from desc limit 1;

  -- The masterplan's worked example, unchanged: 100/3/1 = ৳2,600.
  v_center := app.monthly_bill_poisha(v_card, 'center', 100, 3, 1);
  if v_center <> 260000 then
    raise exception 'monthly_bill_poisha drift: center 100/3/1 answered %, expected 260000',
      v_center;
  end if;

  -- The mirror of the settlement's own figures: the free tier is 0, Teacher Pro
  -- is flat.
  if app.monthly_bill_poisha(v_card, 'teacher_free', 100, 3, 1) <> 0 then
    raise exception 'monthly_bill_poisha: teacher_free must be 0';
  end if;
  v_plus := app.monthly_bill_poisha(v_card, 'teacher_plus', 100, 3, 1);
  if v_plus <> v_card.teacher_plus_monthly_poisha then
    raise exception 'monthly_bill_poisha drift: teacher_plus answered %', v_plus;
  end if;

  -- The ladder through the new three-argument bonus, at ৳2,600 a month — the
  -- same literals the suites assert.
  select id into v_pro from public.promotions where code = 'LAUNCH';
  if app.bonus_poisha((select tiers from public.promotions where id = v_pro), 260000, 260000) <> 0
    or app.bonus_poisha((select tiers from public.promotions where id = v_pro), 780000, 260000) <> 39000
    or app.bonus_poisha((select tiers from public.promotions where id = v_pro), 1560000, 260000) <> 156000
    or app.bonus_poisha((select tiers from public.promotions where id = v_pro), 3120000, 260000) <> 624000
    or app.bonus_poisha((select tiers from public.promotions where id = v_pro), 2000000, 260000) <> 200000 then
    raise exception 'bonus ladder drift at the 2600-a-month worked example';
  end if;

  -- The case the founder found: ৳2,099 a month. Three months is now 5%.
  v_small := app.monthly_bill_poisha(v_card, 'center', 60, 3, 1);
  if v_small <> 209900 then
    raise exception 'monthly_bill_poisha drift: center 60/3/1 answered %, expected 209900',
      v_small;
  end if;
  if app.bonus_poisha((select tiers from public.promotions where id = v_pro), 629700, v_small) <> 31485
    or app.bonus_poisha((select tiers from public.promotions where id = v_pro), 419800, v_small) <> 0 then
    raise exception 'bonus ladder drift at the 2099-a-month centre';
  end if;
end;
$$;
