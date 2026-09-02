-- CoachDesk BD — a tier an owner can buy, instead of one a founder has to grant.
--
-- MASTERPLAN §16's "high priority, straight after" asks for "an owner moving their own
-- centre between tiers without a founder doing it for them". Every part of that already
-- exists except the last inch: `payment_intents` can quote a subscription,
-- `settle_payment_intent` can take the money and write the receipt, and
-- 20260811000059 turns coverage into access. What no path can do is move `plan`, because
-- 20260811000004 revoked that column from `authenticated` and put a trigger behind the
-- revoke. So today the money can arrive and the tier still waits on a person.
--
-- WHAT THIS ADDS: one nullable column saying which tier the purchase is for, and four
-- lines in the settle function that move the centre onto it once the money is real.
--
-- WHY A COLUMN AND NOT A NEW `payment_purpose`. A purchase that moves a tier IS a
-- subscription — it buys months of coverage, priced at that tier's monthly bill times the
-- months, and it must feed `paid_through` like any renewal. A separate purpose would need
-- its own arm in the coverage constraint, its own arm in the pricing, and its own arm
-- everywhere a receipt is read, all to describe the same transaction. It would also cost
-- two migrations before anything could rely on it: `alter type ... add value` is not
-- visible to a check constraint in the same transaction.
--
-- SO NULL IS A RENEWAL AND SET IS A MOVE. The default is null, every intent that exists
-- is a renewal, and nothing about the existing path changes.
--
-- THE TIER MOVES AT SETTLEMENT, NOT WHEN THE INTENT OPENS. An intent is a quote; a quote
-- is not money. This is the same reason `grants_capacity` waits: the row that says what
-- was bought is written first, the thing bought is handed over second, and both happen in
-- one transaction under one advisory lock. It is also the only place it CAN happen —
-- `settle_payment_intent` is granted to `service_role` alone, which is the one caller
-- 20260811000004's guard admits.
--
-- WHAT IT DELIBERATELY DOES NOT TOUCH: `status`. A centre in grace comes back because
-- `paid_through` moved and src/lib/entitlement.ts reads it; a centre a founder suspended
-- by hand stays suspended, because that was a person's decision and paying ৳1,999 is not
-- an appeal against it.

-- ---------------------------------------------------------------------------
-- 1. The column, and the three things it has to agree with.
--
-- Check constraints rather than trigger arms, because these are statements about what the
-- column may contain and not about who may change it (20260811000068's split).
--
--   * A tier is only ever bought by a subscription. The purpose constraint already ties
--     coverage to `subscription`; this ties the tier to the same place.
--   * A move has to cover a period. Without coverage the purchase buys a tier and no
--     months of it, which is a customer paying once and being suspended in seven days.
--   * A move is never onto the free tier. Leaving is a cancellation and §5 makes that a
--     conversation; a check here means no code path can express the opposite, so nobody
--     has to remember to refuse it.
-- ---------------------------------------------------------------------------

alter table public.payment_intents
  add column target_plan public.plan_type;

alter table public.payment_intents
  add constraint payment_intents_target_plan_purpose
    check (target_plan is null or purpose = 'subscription'),
  add constraint payment_intents_target_plan_covered
    check (target_plan is null or covers_period_start is not null),
  add constraint payment_intents_target_plan_paid
    check (target_plan is null or target_plan <> 'teacher_free');

comment on column public.payment_intents.target_plan is
  'The tier this subscription moves the centre onto when it settles, or null for a '
  'renewal on the tier it is already on. MASTERPLAN.md §5. Set only by the server, from '
  'the same quote that priced it: the amount is that tier''s monthly bill times the '
  'months, so a purchase priced at one tier cannot grant another.';

-- ---------------------------------------------------------------------------
-- 2. It is as fixed as the amount that priced it.
--
-- Into the unconditional immutable list, beside `amount_bdt` and `covers_period_end`, for
-- exactly the reason they are there: the tier is what the amount was computed from. An
-- editable `target_plan` would be a Centre quote that settles as Institution, which is the
-- one thing storing the tier on the intent was supposed to make impossible. A wrong quote
-- is cancelled and re-quoted.
--
-- Everything else is 20260811000068's body unchanged, and the trigger is rebound by name
-- so the file that last changed it is the file a reader finds.
-- ---------------------------------------------------------------------------

create or replace function app.guard_payment_intent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  server_role boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
  legal public.payment_intent_state[];
begin
  if tg_op = 'DELETE' then
    if old.state in ('successful', 'refunded') then
      raise exception
        'payment intent % settled money and cannot be deleted; a payment row explains '
        'itself through it', old.id
        using errcode = '42501';
    end if;
    if not server_role then
      raise exception 'a payment intent cannot be deleted by %', current_user
        using errcode = '42501';
    end if;
    return old;
  end if;

  if new.coaching_center_id is distinct from old.coaching_center_id
     or new.purpose is distinct from old.purpose
     or new.quantity is distinct from old.quantity
     or new.amount_bdt is distinct from old.amount_bdt
     or new.priced_lines is distinct from old.priced_lines
     or new.grants_capacity is distinct from old.grants_capacity
     or new.target_plan is distinct from old.target_plan
     or new.covers_period_start is distinct from old.covers_period_start
     or new.covers_period_end is distinct from old.covers_period_end
     or new.created_at is distinct from old.created_at
  then
    raise exception
      'payment intent % is already quoted at %; cancel it and quote again',
      old.id, old.amount_bdt
      using errcode = '42501',
            hint = 'The amount, purpose, quantity, breakdown, tier and coverage of an intent are fixed when it is created (MASTERPLAN.md 11.4).';
  end if;
  -- 20260811000025's reasoning, unchanged: a key names a request, and detaching one is
  -- answerable by somebody with the SQL editor open.
  if not server_role and new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'the request key on payment intent % cannot be changed by %',
      old.id, current_user
      using errcode = '42501';
  end if;

  -- You do not start a bKash payment and finish it as a transfer. Before anything is
  -- initiated the intent has told the customer nothing, so the choice is still open.
  if old.state <> 'pending' and new.provider is distinct from old.provider then
    raise exception 'payment intent % is already with the % provider', old.id, old.provider
      using errcode = '42501';
  end if;

  -- Once settled the reference is what reconciliation reads against the provider's own
  -- statement, so it stops being ours to edit.
  if old.state in ('successful', 'refunded')
     and new.provider_ref is distinct from old.provider_ref
  then
    raise exception 'the provider reference on settled intent % cannot be changed', old.id
      using errcode = '42501';
  end if;

  if new.state is distinct from old.state then
    legal := case old.state
      when 'pending'    then array['initiated', 'failed', 'cancelled', 'expired']
      when 'initiated'  then array['successful', 'failed', 'cancelled', 'expired']
      when 'successful' then array['refunded']
      else array[]::text[]
    end::public.payment_intent_state[];

    if not (new.state = any (legal)) then
      raise exception 'a payment intent cannot go from % to %', old.state, new.state
        using errcode = '42501',
              detail = 'payment_intent_id=' || old.id::text,
              hint = 'MASTERPLAN.md 11.2 draws the transitions: pending -> initiated -> successful, and any open state may fail, cancel or expire.';
    end if;

    -- The clock is stamped here rather than by each caller, so "when did this stick" is
    -- answerable for an intent moved by a route nobody remembers writing. `expired` has no
    -- column of its own: `expires_at` already says when the quote lapsed.
    if new.state = 'initiated' then
      new.initiated_at := pg_catalog.now();
    elsif new.state = 'successful' then
      new.settled_at := pg_catalog.now();
    elsif new.state = 'failed' then
      new.failed_at := pg_catalog.now();
    elsif new.state = 'cancelled' then
      new.cancelled_at := pg_catalog.now();
    elsif new.state = 'refunded' then
      new.refunded_at := pg_catalog.now();
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app.guard_payment_intent() from anon, authenticated, public;

drop trigger if exists payment_intents_guard on public.payment_intents;

create trigger payment_intents_guard
  before update or delete on public.payment_intents
  for each row execute function app.guard_payment_intent();

comment on function app.guard_payment_intent() is
  'MASTERPLAN.md §11.2''s transitions, and the columns a quote is made of: the amount, '
  'what it is for, how many, the tier it moves onto, the breakdown that prices it and the '
  'period it covers are fixed the moment the intent exists. A wrong quote is cancelled and '
  'quoted again.';
-- ---------------------------------------------------------------------------
-- 3. The move.
--
-- Four lines, placed between the receipt and the capacity block, and the placement is the
-- only interesting decision here: `app.student_ceiling` reads the plan, so a purchase that
-- moved the tier has to have moved it before the ceiling is asserted. The constraints mean
-- the two can never co-occur today — a subscription grants no capacity — but an ordering
-- that only works because of a constraint somewhere else is an ordering that breaks when
-- that constraint changes.
--
-- THE TRIAL PAIR IS CLEARED UNCONDITIONALLY, where src/app/founder/actions.ts clears it
-- only for a paid tier. It can afford to be unconditional because `target_plan` can never
-- be `teacher_free`: every settlement through here is a customer who has now paid, and a
-- trial left standing over a paid tier ends one day with access dropping for somebody
-- whose money we are holding.
--
-- THE NOTE NAMES THE TIER. `payments` is what the founder reconciles against a bank
-- statement, and "subscription x3" reads the same for a renewal and for a move.
--
-- Everything else is 20260811000057's body unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.settle_payment_intent(
  p_intent uuid,
  p_provider_ref text default null,
  p_method public.payment_method default 'bkash',
  p_settled_by uuid default null,
  p_note text default null
)
returns table (
  intent_id uuid,
  payment_id uuid,
  intent_state public.payment_intent_state,
  charged_bdt numeric(10,2),
  capacity_after integer,
  already boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  it public.payment_intents;
  paid uuid;
  ceiling_now integer;
  capacity_now integer;
begin
  select i.* into it from public.payment_intents i where i.id = p_intent for update;

  if not found then
    raise exception 'payment intent % does not exist', p_intent
      using errcode = '42501';
  end if;

  -- The duplicate path. Reading the original result back is what lets a caller retry
  -- without deciding whether its own timeout meant failure.
  if it.state = 'successful' then
    select p.id into paid
      from public.payments p
     where p.intent_id = it.id
     order by p.created_at
     limit 1;

    select c.student_capacity into capacity_now
      from public.coaching_centers c
     where c.id = it.coaching_center_id;

    return query select it.id, paid, it.state, it.amount_bdt, capacity_now, true;
    return;
  end if;

  if it.state <> 'initiated' then
    raise exception 'payment intent % is % and cannot be settled', it.id, it.state
      using errcode = '42501',
            hint = 'Only an initiated intent settles; the provider reference arrives with that step.';
  end if;

  if it.expires_at <= pg_catalog.now() then
    raise exception 'payment intent % expired at %', it.id, it.expires_at
      using errcode = '42501',
            hint = 'Quote the purchase again at today''s price rather than honouring an old one.';
  end if;
  -- No settlement without something to reconcile against. For the manual provider this is
  -- the TrxID or the deposit slip the founder is looking at.
  if coalesce(p_provider_ref, it.provider_ref) is null then
    raise exception 'settling payment intent % needs the reference the money arrived with', it.id
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('students.capacity'),
    pg_catalog.hashtext(it.coaching_center_id::text)
  );

  insert into public.payments (
    coaching_center_id,
    intent_id,
    amount_bdt,
    method,
    reference,
    covers_period_start,
    covers_period_end,
    note,
    recorded_by,
    idempotency_key
  )
  values (
    it.coaching_center_id,
    it.id,
    it.amount_bdt,
    p_method,
    coalesce(p_provider_ref, it.provider_ref),
    it.covers_period_start,
    it.covers_period_end,
    coalesce(
      p_note,
      it.purpose::text || ' x' || it.quantity
        || case when it.target_plan is null then '' else ' -> ' || it.target_plan::text end
    ),
    p_settled_by,
    it.idempotency_key
  )
  returning id into paid;

  update public.payment_intents
     set state = 'successful',
         provider_ref = coalesce(p_provider_ref, provider_ref),
         settled_by = coalesce(p_settled_by, settled_by)
   where id = it.id;

  -- §5's tier, moved by the money rather than by a person. Admitted by
  -- 20260811000004's guard because this function is granted to `service_role` alone.
  if it.target_plan is not null then
    update public.coaching_centers
       set plan = it.target_plan,
           trial_plan = null,
           trial_ends_at = null
     where id = it.coaching_center_id;
  end if;
  -- Only student places are a stored ceiling. A teacher seat and a branch are counted from
  -- the rows themselves and billed monthly, so their intents grant nothing here and the
  -- check constraint on the table says so. A tier move grants nothing either: the ceiling
  -- follows the plan, and `app.student_ceiling` has just been told the new one.
  if it.grants_capacity > 0 then
    ceiling_now := app.student_ceiling(it.coaching_center_id);

    update public.coaching_centers
       set student_capacity = ceiling_now + it.grants_capacity
     where id = it.coaching_center_id
     returning student_capacity into capacity_now;

    -- Read back rather than assumed, because the ceiling is a function of the plan too:
    -- 20260811000036 ignores purchased capacity on the teacher tiers, so selling places to
    -- one would take the money and hand over nothing. Asking the same function that
    -- decides admissions is also how this survives a change to that rule.
    if app.student_ceiling(it.coaching_center_id) is distinct from ceiling_now + it.grants_capacity then
      raise exception
        'settling % would leave centre % with the ceiling it already had',
        it.id, it.coaching_center_id
        using errcode = '42501',
              hint = 'This plan''s ceiling comes from the plan; change the plan instead of buying places (MASTERPLAN.md 3.4).';
    end if;
  else
    select c.student_capacity into capacity_now
      from public.coaching_centers c
     where c.id = it.coaching_center_id;
  end if;

  return query
    select it.id,
           paid,
           'successful'::public.payment_intent_state,
           it.amount_bdt,
           capacity_now,
           false;
end;
$$;

revoke all on function public.settle_payment_intent(
  uuid, text, public.payment_method, uuid, text
) from anon, authenticated, public;

grant execute on function public.settle_payment_intent(
  uuid, text, public.payment_method, uuid, text
) to service_role;

comment on function public.settle_payment_intent(
  uuid, text, public.payment_method, uuid, text
) is
  'MASTERPLAN.md §11.2 — mark an initiated intent successful, write its receipt, move the '
  'centre onto the tier it bought and raise the student ceiling, or return the first '
  'settlement''s answer if it already happened. Server-only: the browser cannot reach it, '
  'and the intent owns both the amount and the tier.';
