-- CoachDesk BD — the two founder levers: money, and days. MASTERPLAN.md §11.7, and
-- build-order step 26 of §16.1.
--
-- WHY THIS EXISTS AT ALL. Every scenario §11.8 could not fence ends in a phone call and
-- a human decision: a centre shut for three weeks around Eid and charged for all three, a
-- 200-row paste that was a mistake and is now a daily rate, a founder who was asleep when
-- a customer ran dry. The model deliberately has no self-serve answer to any of them — a
-- pause button would cut a fully-using customer's price by a third (§11.8) — so what the
-- founder needs is the ability to move the two numbers the whole model runs on, by hand,
-- quickly, and with the reason written down where the customer can read it.
--
-- §11.7 names them, and names why they are two and not one:
--
--   > `charged_through` moves forward two ways: by spending money, or by being granted. A
--   > trial, a goodwill extension or a closure allowance given forward is **days, not fake
--   > money** — it cannot be spent on anything else, it cannot be confused with taka a
--   > customer actually paid, and it costs nothing to represent. Money already burned that
--   > is being given back is a **money** adjustment. Both are founder-only, both require a
--   > written reason, both are audited.
--
-- ---------------------------------------------------------------------------
-- 1. A grant of days carries no money, and 78 said the opposite.
--
-- THIS IS A CORRECTION AND NOT A NEW RULE. 20260811000078 declared the kind with a comment
-- that read *"Days given rather than sold ... priced at the rate in force so that the
-- balance stays the only currency"* and pinned the sign to `amount_poisha > 0`. Both are
-- wrong against §11.7, and the mistake is worth spelling out because it would have looked
-- fine: a ৳3,000 grant of days is indistinguishable in the customer's own history from a
-- ৳3,000 recharge they never sent, it is spendable on anything rather than on the days it
-- was given for, and a founder reconciling the books cannot tell a gift from revenue. The
-- masterplan is the intent and the comment was the bug (§0), so the entry is zero and the
-- `charge_date` carries how far the days reach.
--
-- WHAT STAYS TRUE FROM 78: the entry is still appended, still chained, still immutable, and
-- still the reason a customer's history can show a grant with the words the founder typed.
-- What changes is only that it moves the line and not the balance.
-- ---------------------------------------------------------------------------

alter table public.billing_ledger
  drop constraint billing_ledger_amount_sign;

alter table public.billing_ledger
  add constraint billing_ledger_amount_sign check (
    case kind
      when 'recharge' then amount_poisha > 0
      when 'promotion_bonus' then amount_poisha > 0
      -- Days, and not fake money (§11.7). Zero, and the CHECK is what makes it so rather
      -- than a convention the next writer has to know about.
      when 'founder_grant_days' then amount_poisha = 0
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

comment on type public.billing_entry_kind is
  'MASTERPLAN.md §11.7. What a billing_ledger row is. The sign of amount_poisha is '
  'pinned per kind by billing_ledger_amount_sign, so the kind alone tells a reader '
  'whether money went on or off the balance — and a founder_grant_days carries none, '
  'because a grant is days and not fake money.';

-- A granted day is a date, so the entry may name one. The constraint is widened rather
-- than replaced: the three charge kinds keep theirs, and this adds the fourth purpose a
-- `charge_date` can serve — the last day a grant reaches.
alter table public.billing_ledger
  drop constraint billing_ledger_charge_date_purpose;

alter table public.billing_ledger
  add constraint billing_ledger_charge_date_purpose check (
    (charge_date is not null) = (
      kind in (
        'daily_charge', 'settlement_failure', 'settlement_retry', 'founder_grant_days'
      )
    )
  );

comment on column public.billing_ledger.charge_date is
  'The Dhaka date this entry is about, which is not created_at: a day is charged after '
  'it has finished. Unique per centre for a daily_charge, which is what makes settling '
  'the same day twice impossible however many times the settlement runs. On a '
  'founder_grant_days it is the last day the grant reached.';

-- ---------------------------------------------------------------------------
-- 2. The line moves on a grant, which is the half the trigger did not have.
--
-- The function below is 20260811000078's, with the grant arm added. It is the only writer
-- of `charged_through`, and it stays `greatest(what it was, new.charge_date)` for the
-- reason 78 gives: the column never moves backwards, because backwards would charge a day
-- that has already been paid for.
-- ---------------------------------------------------------------------------

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
           when new.kind in ('daily_charge', 'founder_grant_days')
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
  'daily charge or a founder''s grant of days. charged_through only ever moves forward — '
  'backwards would mean charging a day that has already been paid for.';

-- ---------------------------------------------------------------------------
-- 3. The two levers, as functions rather than as forms.
--
-- WHY DEFINER FUNCTIONS AND NOT THE ADMIN KEY, which is the opposite choice
-- `recordCenterPayment` makes and the same one 20260811000084 made for approving a claim.
-- The ledger holds no INSERT grant for `authenticated`, so the founder's session cannot
-- write it directly and something has to reach past that. Reaching past it from a Server
-- Action means the only thing standing between a customer and a free balance is a JS check
-- at the top of a file — and a Server Action is a public HTTP endpoint. Asking
-- `app.is_platform_admin()` *inside* the database means the anon key, a centre's own owner
-- and a hand-posted form are all refused by Postgres, and the Server Action's check becomes
-- the second one rather than the only one.
--
-- NO AMOUNT IS COMPUTED FROM A CALLER'S ARITHMETIC EITHER. The adjustment takes money the
-- founder typed and nothing else — no date, no rate. The grant takes a number of days and
-- works out the date itself, from the line the row actually holds, so a browser cannot
-- name the day it is buying. `created_by` is `auth.uid()`: the person, not the key.
--
-- AND NEITHER ONE CAN OVERDRAW THE BALANCE. §11.7's threat table says a correcting
-- adjustment may take a balance below zero "deliberately" while the table's own
-- `billing_ledger_no_overdraft` CHECK refuses it outright. The CHECK is the stricter of
-- the two and it stands — an adjustment stops at zero, which is also the state the
-- read-only arm already handles — and the disagreement is named here rather than quietly
-- resolved: if a negative balance is ever genuinely wanted, the constraint is what has to
-- move, and that is a masterplan decision and not a migration's.
-- ---------------------------------------------------------------------------

create or replace function public.founder_adjust_balance(
  p_center uuid,
  p_amount_poisha bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_after bigint;
begin
  if not app.is_platform_admin() then
    raise exception 'founder_adjust_balance requires the platform admin'
      using errcode = '42501';
  end if;

  -- The two sentences this must not write a row without. A zero adjustment adjusts
  -- nothing and a reason nobody wrote is a decision nobody can review — §11.7 says both,
  -- and a constraint on a free-text column could hold neither.
  if p_amount_poisha is null or p_amount_poisha = 0 then
    raise exception 'a money adjustment of nothing adjusts nothing'
      using errcode = '22023';
  end if;

  if p_reason is null or pg_catalog.btrim(p_reason) = '' then
    raise exception 'a money adjustment needs a written reason'
      using errcode = '22023';
  end if;

  -- The same lock, in the same namespace, as app.ledger_open_balance: the affordability
  -- read and the insert below are one sequence, and the trigger's own acquisition of the
  -- same lock is a no-op inside this transaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('billing_ledger.balance'),
    pg_catalog.hashtext(p_center::text)
  );

  select coalesce(pg_catalog.sum(l.amount_poisha), 0)
    into v_balance
  from public.billing_ledger l
  where l.coaching_center_id = p_center;

  if not exists (select 1 from public.coaching_centers c where c.id = p_center) then
    raise exception 'founder_adjust_balance: no such centre' using errcode = '23503';
  end if;

  v_after := v_balance + p_amount_poisha;
  if v_after < 0 then
    raise exception
      'that would leave the balance at %, and a balance cannot go below nothing',
      v_after
      using errcode = '23514';
  end if;

  insert into public.billing_ledger (
    coaching_center_id, kind, amount_poisha, description, created_by
  ) values (
    p_center, 'founder_money_adjustment', p_amount_poisha,
    pg_catalog.btrim(p_reason), auth.uid()
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'amountPoisha', p_amount_poisha,
    'balanceAfter', v_after
  );
end;
$$;

comment on function public.founder_adjust_balance(uuid, bigint, text) is
  'MASTERPLAN.md §11.7 — money on or off a balance, with a written reason, by the '
  'platform admin. No price version, because this is a decision and not a price; no '
  'charge date, because it buys no particular day. Refuses zero, refuses a blank '
  'reason, and refuses to take a balance below nothing.';

create or replace function public.founder_grant_days(
  p_center uuid,
  p_days integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line date;
  v_from date;
  v_to date;
  v_balance bigint;
begin
  if not app.is_platform_admin() then
    raise exception 'founder_grant_days requires the platform admin'
      using errcode = '42501';
  end if;

  if p_days is null or p_days <= 0 then
    raise exception 'a grant of % days grants nothing', p_days
      using errcode = '22023';
  end if;

  if p_reason is null or pg_catalog.btrim(p_reason) = '' then
    raise exception 'a grant of days needs a written reason'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('billing_ledger.balance'),
    pg_catalog.hashtext(p_center::text)
  );

  select c.charged_through into v_line
  from public.coaching_centers c
  where c.id = p_center;

  if not found then
    raise exception 'founder_grant_days: no such centre' using errcode = '23503';
  end if;

  -- THE GRANT STARTS AT TODAY WHEN THE LINE IS BEHIND IT, and that is the whole
  -- difference between a lever and a gesture. §4.4: a centre that ran dry is read-only
  -- from the day `balance < owed`, and `owed` counts from the line. Adding three days to
  -- a line that lapsed a fortnight ago adds them to a fortnight ago — the customer stays
  -- read-only and the founder has to ring back. A goodwill grant is days from now.
  --
  -- The day is the Dhaka calendar day and never the database clock (§11.7): the server
  -- runs UTC, and between midnight and 6am a `current_date` here would grant a day that
  -- had not started yet in Dhaka.
  v_from := greatest(v_line, (pg_catalog.now() at time zone 'Asia/Dhaka')::date);
  v_to := v_from + p_days;

  select coalesce(pg_catalog.sum(l.amount_poisha), 0)
    into v_balance
  from public.billing_ledger l
  where l.coaching_center_id = p_center;

  insert into public.billing_ledger (
    coaching_center_id, kind, amount_poisha, charge_date, description, created_by,
    metadata
  ) values (
    p_center, 'founder_grant_days', 0, v_to, pg_catalog.btrim(p_reason), auth.uid(),
    pg_catalog.jsonb_build_object('days', p_days, 'from', v_from::text)
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'days', p_days,
    'from', v_from::text,
    'chargedThrough', v_to::text,
    'balancePoisha', v_balance
  );
end;
$$;

comment on function public.founder_grant_days(uuid, integer, text) is
  'MASTERPLAN.md §11.7 — days granted rather than sold, with a written reason, by the '
  'platform admin. Writes a zero-amount ledger entry that carries the reason and the '
  'count, and advances charged_through. Starts at today when the line is behind it, so '
  'a grant to a lapsed centre is days from now rather than days from a fortnight ago.';

revoke all on function public.founder_adjust_balance(uuid, bigint, text)
  from public, anon;
revoke all on function public.founder_grant_days(uuid, integer, text)
  from public, anon;
grant execute on function public.founder_adjust_balance(uuid, bigint, text)
  to authenticated, service_role;
grant execute on function public.founder_grant_days(uuid, integer, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The reconciliation stops crying wolf on a grant.
--
-- 20260811000081's third question asks whether a `charged_through` past today has anything
-- to explain it, and at the time there were two explanations: a daily charge, and a
-- `paid_through` carried over from the old model (§11.14). Its own comment says what to do
-- when this step landed — *"When the founder levers land (step 26) a grant with its audit
-- line becomes the third explanation, and this half narrows again"* — and this is that
-- narrowing. Without it, every grant the founder makes comes back on the same screen
-- tomorrow as a finding, and a reconciliation that flags a lever working is a screen that
-- gets ignored.
--
-- The rest of the function is unchanged, down to the ordering of the three returns: the
-- cache against the entries, the chain against itself, and the line against the days that
-- were paid for. A grant is checked by all three like any other entry — it is chained and
-- it moves no money — so nothing about the first two questions narrows.
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
  -- opens at zero.
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

  -- And a line past today is explained by any one of three things: the days it was
  -- charged for, a `paid_through` from the old model, or a grant. The grant arm is
  -- `>= the line` rather than `= the line`, because a later grant sets a further date
  -- and an earlier one is still a true explanation of how the centre came to be ahead.
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
        and l.kind = 'founder_grant_days'
        and l.charge_date >= c.charged_through
    );
end;
$$;

comment on function public.platform_reconciliation() is
  'MASTERPLAN.md §11.13 — the three reconciliation questions, answered. No '
  'rows means the books hold. Platform admin only, asked inside the function. '
  'A granted line counts as an explanation of a date past today (§11.7).';

revoke all on function public.platform_reconciliation() from anon, authenticated, public;
grant execute on function public.platform_reconciliation() to authenticated;
