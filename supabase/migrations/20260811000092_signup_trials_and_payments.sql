-- CoachDesk BD — a signup gets the trial its kind deserves, and money the founder
-- records reaches the balance that actually grants days.
--
-- THIS IS THE SECOND HALF OF 20260811000091, which minted `account_kind`,
-- `platform_settings` and the `signup_trial` kind. This file uses all three.
--
-- THE SECOND BUG THIS CLOSES. `recordCenterPayment` writes a `payments` row with
-- `covers_period_start/end` — and nothing in the product reads a coverage window any
-- more. Since §16.1 step 24 access is `balance < owed` over the prepaid ledger, and step
-- 21 replaced coverage with the balance. So the founder's largest button took a customer's
-- money, wrote a receipt, moved no balance and moved no line: the centre stayed read-only
-- until somebody reached for a *different* control. That is the worst shape a bug can have
-- here — it looks like it worked, and the customer is the one who finds out.
--
-- WHAT REPLACES IT IS `founder_record_payment` (section 5), and the shape of the fix is
-- the point: money is recorded once, on the one table that buys days. For a centre that is
-- a recharge and the burn spends it a day at a time (§11.6). For a teacher it is a
-- subscription — the amount priced from the card in force rather than typed, and the plan
-- moved to Teacher Pro in the same transaction.
--
-- AND THE CENTRE TRIAL IS DAYS, NOT A `trial_plan`. §2.2's trial is *a temporary better
-- plan*, which is the right shape for a teacher: one column pair, expires by comparison,
-- and the paid plan underneath is genuinely Teacher Free. A centre's trial is the opposite
-- shape — the tier it is trialling is the tier it is going to buy, and what ends is the
-- *days*. Granting them is what §11.7's second lever already does (a zero-amount entry and
-- a line that moves), the `signup_trial` kind is that same entry written by the database at
-- signup, and the morning the line falls behind the centre is read-only on the tier it was
-- using until it tops up. No job, no column to clear, one comparison that already exists.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The sign-constraint learns the new kind.
--
-- A `signup_trial` carries no money, for the same reason a grant does not: the days are
-- the gift and fake money would be spendable on something else (§11.7).
-- ---------------------------------------------------------------------------

alter table public.billing_ledger
  drop constraint billing_ledger_amount_sign;

alter table public.billing_ledger
  add constraint billing_ledger_amount_sign check (
    case kind
      when 'recharge' then amount_poisha > 0
      when 'promotion_bonus' then amount_poisha > 0
      when 'founder_grant_days' then amount_poisha = 0
      when 'signup_trial' then amount_poisha = 0
      when 'daily_charge' then amount_poisha < 0
      when 'refund' then amount_poisha < 0
      when 'reversal' then amount_poisha <> 0
      when 'correction' then amount_poisha <> 0
      when 'founder_money_adjustment' then amount_poisha <> 0
      when 'settlement_failure' then amount_poisha = 0
      when 'settlement_retry' then amount_poisha = 0
      when 'migration_opening_balance' then amount_poisha = 0
    end
  );

-- ---------------------------------------------------------------------------
-- 2. And so does the column that carries a date.
--
-- `charge_date` is "the Dhaka date this entry is about". On a charge it is the day being
-- paid for; on a grant it is the last day the grant reached; on a signup trial it is the
-- last day of the trial. Three purposes, one column, and the same constraint that refused
-- a date on a recharge.
-- ---------------------------------------------------------------------------

alter table public.billing_ledger
  drop constraint billing_ledger_charge_date_purpose;

alter table public.billing_ledger
  add constraint billing_ledger_charge_date_purpose check (
    (charge_date is not null) = (
      kind in (
        'daily_charge', 'settlement_failure', 'settlement_retry',
        'founder_grant_days', 'signup_trial'
      )
    )
  );

-- The line moves on it, which is the whole point of the entry: `charged_through` is the
-- last day paid for, and a trial day is paid for by us.
create or replace function app.ledger_apply_to_center()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.coaching_centers c
     set balance_poisha = new.balance_after,
         charged_through = case
           when new.kind in ('daily_charge', 'founder_grant_days', 'signup_trial')
             then greatest(c.charged_through, new.charge_date)
           else c.charged_through
         end
   where c.id = new.coaching_center_id;

  return null;
end;
$$;

comment on function app.ledger_apply_to_center() is
  'AFTER INSERT on public.billing_ledger: carries the new balance onto '
  'coaching_centers.balance_poisha, and advances charged_through when the entry is a '
  'daily charge, a founder''s grant of days, or the days a signup was given. '
  'charged_through only ever moves forward — backwards would mean charging a day that has '
  'already been paid for.';

revoke all on function app.ledger_apply_to_center() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A line past today has one more explanation.
--
-- 20260811000086 narrowed the reconciliation so a founder's grant stopped reading as a
-- finding. A signup trial moves the line the same way for the same reason, so without
-- this arm every new centre would raise a finding on the morning after it signed up — and
-- a reconciliation that flags the product's own welcome is a screen that gets ignored,
-- which is how the real finding gets missed.
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

  -- 2. The chain: each row opens where the previous one closed, and the first opens at
  -- zero.
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

  -- 3. The line never lags a day that was paid for.
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

  -- And a line past today is explained by any one of four things: the days it was charged
  -- for, a `paid_through` from the old model, a founder's grant, or the days the account
  -- was given at signup.
  return query
  select 3, c.id, c.name,
         'charged_through is ' || c.charged_through
         || ', past today and past every payment, with nothing to explain it'
  from public.coaching_centers c
  where c.charged_through > (pg_catalog.now() at time zone 'Asia/Dhaka')::date
    and c.charged_through > coalesce(c.paid_through,
                                     (pg_catalog.now() at time zone 'Asia/Dhaka')::date)
    and not exists (
      select 1 from public.billing_ledger l
      where l.coaching_center_id = c.id
        and l.kind in ('founder_grant_days', 'signup_trial')
        and l.charge_date >= c.charged_through
    );
end;
$$;

comment on function public.platform_reconciliation() is
  'MASTERPLAN.md §11.13 — the three reconciliation questions, answered. No rows means the '
  'books hold. Platform admin only, asked inside the function. A granted line and a signup '
  'trial both count as explanations of a date past today (§11.7, §4.3).';

revoke all on function public.platform_reconciliation() from anon, authenticated, public;
grant execute on function public.platform_reconciliation() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The signup itself.
--
-- ONE FUNCTION, TWO SHAPES, and the kind decides which.
--
--   teacher      `plan` stays `teacher_free` (§4.3: `plan` is what has been paid for and a
--                signup has paid nothing), `trial_plan = teacher_plus`, `trial_ends_at =
--                now + teacher_trial_days`. The existing resolution reads the pair,
--                refuses a trial that ranks below the paid plan, and expires it by
--                comparison with no job to run.
--
--   center       `plan` is `center`, status is `trial`, and the account is given
--   institution  `center_trial_days`/`institution_trial_days` days on the line as a
--                `signup_trial` entry. The tier is the one it will buy, the days are what
--                ends, and the morning the line falls behind it is read-only on that tier
--                until it tops up (§4.4). No `trial_plan` is written, because a trial of
--                the plan it is already on is not a better plan — it is days.
--
-- `teacher_mode` IS GONE AND ITS JOB WENT WITH IT. It chose whether the owner also got a
-- `teachers` row so the teach screens could see them, and the three kinds answer it without
-- a second flag: a teacher is their own teacher row, because that is what makes the
-- register work; a centre's owner is its owner, and appears on the roster when the centre
-- adds them as staff on the teachers screen.
--
-- THE OLD FOUR-ARGUMENT FORM IS DROPPED, so there is exactly one `bootstrap_center` and a
-- caller written against the boolean fails loudly at the database instead of silently
-- signing a centre up as a teacher. A Server Action is a public endpoint; an overload left
-- lying around is a way past the new decision.
--
-- THE TRIAL LENGTHS ARE READ HERE AND NOT ACCEPTED. A caller that could name its own trial
-- length could grant itself a decade with the anon key — the same sentence §11.4 makes
-- about amounts, and the reason 91 puts them in a table this function reads with the
-- definer's own privileges.
-- ---------------------------------------------------------------------------

drop function if exists public.bootstrap_center(text, text, text, boolean);

create or replace function public.bootstrap_center(
  center_name text,
  owner_phone text,
  owner_name text,
  account_kind text default 'teacher'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_center uuid;
  claimant uuid := auth.uid();
  clean_name text := nullif(btrim(center_name), '');
  kind text := lower(btrim(coalesce(account_kind, 'teacher')));
  trial_days integer;
  dhaka_today date := (pg_catalog.now() at time zone 'Asia/Dhaka')::date;
begin
  if claimant is null then
    raise exception 'bootstrap_center requires an authenticated user'
      using errcode = '28000';
  end if;

  if clean_name is null then
    raise exception 'A center needs a name' using errcode = '22023';
  end if;

  if kind not in ('teacher', 'center', 'institution') then
    raise exception 'a signup is a teacher, a center or an institution; not %', kind
      using errcode = '22023';
  end if;

  -- A CENTRE-ISSUED LOGIN IS THE CENTRE'S KEY, NOT THIS PERSON'S (20260811000077,
  -- widened to both reserved domains by 20260811000079). Since §5.4's rewrite the only
  -- accounts left on `%.coachdesk.invalid` are the ones a centre minted for its staff, so
  -- either shape of evidence is enough: the address, or a username on the profile.
  -- RESTATED HERE RATHER THAN ASSUMED, because this function is replaced whole and a
  -- guard that lives only in a migration three files back is a guard the next rewrite
  -- drops — which is exactly what happened to the trial shape.
  if exists (
    select 1 from auth.users u
    where u.id = claimant and u.email like '%.coachdesk.invalid'
  ) or exists (
    select 1 from public.profiles p
    where p.id = claimant and p.username is not null
  ) then
    raise exception 'A center-issued login cannot create a center'
      using errcode = '42501';
  end if;

  -- One center per owner. Without this a single account could create unlimited centers and
  -- route around every plan limit by spreading batches across them.
  if exists (
    select 1 from public.center_members m
    where m.user_id = claimant and m.role = 'owner'
  ) then
    raise exception 'This account already owns a center' using errcode = '23505';
  end if;

  select case kind
           when 'teacher' then s.teacher_trial_days
           when 'institution' then s.institution_trial_days
           else s.center_trial_days
         end
    into trial_days
  from public.platform_settings s
  where s.id;

  -- A missing settings row is a deployment fault and not a customer's problem: no trial is
  -- the safe reading, because the alternative is inventing how long somebody gets the
  -- product for nothing.
  trial_days := coalesce(trial_days, 0);

  insert into public.coaching_centers (
    name, phone, created_by, plan, status, account_kind, trial_plan, trial_ends_at
  )
  values (
    clean_name,
    owner_phone,
    claimant,
    case kind when 'teacher' then 'teacher_free'::public.plan_type
              else kind::public.plan_type end,
    'trial',
    kind,
    case kind when 'teacher' then 'teacher_plus'::public.plan_type end,
    case kind when 'teacher'
              then pg_catalog.now() + pg_catalog.make_interval(days => trial_days)
         end
  )
  returning id into new_center;

  -- The coaching_centers_claim_owner trigger already added the owner membership.

  -- The centre's trial, as days on the line (§11.7). Written as a ledger entry rather than
  -- by setting `charged_through`, so the line has an explanation the customer can read in
  -- their own history and the reconciliation can find.
  if kind in ('center', 'institution') and trial_days > 0 then
    insert into public.billing_ledger (
      coaching_center_id, kind, amount_poisha, charge_date, description, metadata
    ) values (
      new_center,
      'signup_trial',
      0,
      dhaka_today + trial_days,
      'The days this account was given when it signed up.',
      pg_catalog.jsonb_build_object('days', trial_days, 'kind', kind, 'from', dhaka_today::text)
    );
  end if;

  if kind = 'teacher' then
    insert into public.center_members (coaching_center_id, user_id, role)
    values (new_center, claimant, 'teacher')
    on conflict do nothing;

    insert into public.teachers (coaching_center_id, user_id, name, phone)
    values (new_center, claimant, coalesce(nullif(btrim(owner_name), ''), 'শিক্ষক'), owner_phone);
  end if;

  return new_center;
end;
$$;

comment on function public.bootstrap_center(text, text, text, text) is
  'MASTERPLAN.md §4.3 — creates a centre and makes the caller its owner, in one '
  'transaction. A teacher signup is given a trial_plan of Teacher Pro for '
  'platform_settings.teacher_trial_days; a center or institution signup is put on its own '
  'tier and given platform_settings days on the line. The trial lengths are read here '
  'rather than accepted from the caller.';

revoke all on function public.bootstrap_center(text, text, text, text) from public, anon;
grant execute on function public.bootstrap_center(text, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The money, recorded once, where it counts.
--
-- TWO SHAPES AGAIN, BY ACCOUNT KIND, and the difference is what the customer is buying.
--
--   A coaching centre pays money in, full stop. The founder types what arrived — ৳5,000 on
--   a bKash statement — it becomes a `recharge` on the balance, and the burn spends it a
--   day at a time (§11.6). No window, no months, no second copy of what the money bought.
--
--   A teacher buys months, because that is what a subscription is. The amount is NOT the
--   founder's to type: it is `price_versions.teacher_plus_monthly_poisha × months`, read
--   from the card in force, so a slipped keystroke cannot sell a year of Pro for ৳49 and
--   the figure on the receipt is the figure on the price list (§11.4: the request may
--   carry a quantity and never an amount). The plan moves to `teacher_plus` and the trial
--   pair is cleared in the same transaction — §4.3's "the founder clears the trial fields
--   when a customer pays", done by the payment rather than remembered afterwards.
--
-- WHAT IT STILL DOES NOT DO, deliberately: it never names a date the customer is covered
-- to. The money is spent by the burn, so `charged_through` walks forward a day at a time
-- from the money itself. Writing a window here would be the coverage model again, and the
-- coverage model is what this migration is closing.
--
-- A REPLAYED SUBMIT IS NOT A SECOND PAYMENT. The form sends a uuid it minted once and
-- `payments_center_idempotency_key` refuses the second row; the handler reads the original
-- back and reports it as the payment it is, so a lost response cannot double a customer's
-- balance.
-- ---------------------------------------------------------------------------

create or replace function public.founder_record_payment(
  p_center uuid,
  p_amount_poisha bigint,
  p_months integer,
  p_reason text,
  p_method public.payment_method default 'bkash',
  p_reference text default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_plan public.plan_type;
  v_amount numeric(10, 2);
  v_note text;
  v_card public.price_versions%rowtype;
  v_payment uuid;
  v_balance bigint;
begin
  if not app.is_platform_admin() then
    raise exception 'founder_record_payment requires the platform admin'
      using errcode = '42501';
  end if;

  if p_reason is null or pg_catalog.btrim(p_reason) = '' then
    raise exception 'a payment needs a written reason' using errcode = '22023';
  end if;

  select c.account_kind, c.plan
    into v_kind, v_plan
  from public.coaching_centers c
  where c.id = p_center;

  if not found then
    raise exception 'founder_record_payment: no such centre' using errcode = '23503';
  end if;

  -- A teacher — by kind, or by the plan they are already on. Either is enough: a teacher
  -- whose subscription lapsed is still a teacher, and a row that has been put on Teacher
  -- Pro by an older path must not be sold a balance it would never spend.
  if v_kind = 'teacher' or v_plan = 'teacher_plus' then
    if p_months is null or p_months <= 0 then
      raise exception 'a teacher buys whole months, and % is not one', p_months
        using errcode = '22023';
    end if;

    select * into v_card
    from public.price_versions v
    where v.effective_from <= (pg_catalog.now() at time zone 'Asia/Dhaka')::date
    order by v.effective_from desc
    limit 1;

    if not found then
      raise exception 'no price version is in force' using errcode = '23503';
    end if;

    v_amount := (v_card.teacher_plus_monthly_poisha * p_months)::numeric / 100;
    v_note := pg_catalog.btrim(p_reason) || ' — Teacher Pro, ' || p_months || ' '
              || case when p_months = 1 then 'month' else 'months' end;

    update public.coaching_centers
       set plan = 'teacher_plus',
           trial_plan = null,
           trial_ends_at = null
     where id = p_center;
  else
    -- A centre's money. Typed by the founder and positive: a negative amount is what
    -- `creditCenterPayment` exists for, with its own form and its own words.
    if p_amount_poisha is null or p_amount_poisha <= 0 then
      raise exception 'a recorded payment is a positive amount' using errcode = '22023';
    end if;

    v_amount := p_amount_poisha::numeric / 100;
    v_note := pg_catalog.btrim(p_reason);
  end if;

  begin
    insert into public.payments (
      coaching_center_id, amount_bdt, method, reference, note, recorded_by, idempotency_key
    ) values (
      p_center, v_amount, p_method, nullif(pg_catalog.btrim(coalesce(p_reference, '')), ''),
      v_note, auth.uid(), p_idempotency_key
    )
    returning id into v_payment;
  exception when unique_violation then
    -- The replay. `payments_center_idempotency_key` refused the second row, and the money
    -- is already on the balance — reading the original back is what makes the retry safe
    -- instead of a second credit.
    if p_idempotency_key is null then
      raise;
    end if;

    select p.id into v_payment
    from public.payments p
    where p.coaching_center_id = p_center
      and p.idempotency_key = p_idempotency_key
    order by p.created_at
    limit 1;

    select coalesce(pg_catalog.sum(l.amount_poisha), 0)
      into v_balance
    from public.billing_ledger l
    where l.coaching_center_id = p_center;

    return pg_catalog.jsonb_build_object(
      'ok', true, 'already', true, 'paymentId', v_payment,
      'amountPoisha', (v_amount * 100)::bigint, 'balanceAfter', v_balance
    );
  end;

  insert into public.billing_ledger (
    coaching_center_id, kind, amount_poisha, description, payment_id, created_by, metadata
  ) values (
    p_center,
    'recharge',
    (v_amount * 100)::bigint,
    v_note,
    v_payment,
    auth.uid(),
    pg_catalog.jsonb_build_object('months', coalesce(p_months, 0), 'kind', v_kind)
  );

  select c.balance_poisha into v_balance
  from public.coaching_centers c where c.id = p_center;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'already', false, 'paymentId', v_payment,
    'amountPoisha', (v_amount * 100)::bigint, 'balanceAfter', v_balance
  );
end;
$$;

comment on function public.founder_record_payment(uuid, bigint, integer, text, public.payment_method, text, uuid) is
  'MASTERPLAN.md §11.5/§11.9 — money the founder has received, recorded once and credited '
  'to the balance, because the balance is the only thing that buys days. For a teacher the '
  'amount is priced from price_versions and the plan moves to Teacher Pro in the same '
  'transaction; for a centre the founder types what arrived. Platform admin only, asked '
  'inside the database.';

revoke all on function public.founder_record_payment(
  uuid, bigint, integer, text, public.payment_method, text, uuid
) from public, anon;
grant execute on function public.founder_record_payment(
  uuid, bigint, integer, text, public.payment_method, text, uuid
) to authenticated, service_role;
