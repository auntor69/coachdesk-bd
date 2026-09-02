-- CoachDesk BD — the rate a purchase was priced at, kept on the purchase.
--
-- THE LAST MISSING FIELD OF MASTERPLAN §3.8. That table lists what every payment must
-- record, and nine of the eleven rows are columns on `payment_intents` already. "Rate
-- applied — which band(s) priced them, at what rate" is the one that was never stored,
-- and §16 has it in "high priority, straight after" for a reason: it is the only field of
-- the record that cannot be reconstructed afterwards.
--
-- IT CANNOT BE RECOMPUTED, AND THAT IS WHY IT MUST BE STORED. src/lib/plans.ts prices
-- places marginally, from the ceiling a centre already has up to the one it is buying, so
-- the answer depends on where the centre was standing when it bought. By the time
-- anybody prints the receipt, `settle_payment_intent` has already raised
-- `student_capacity` — so asking `capacityBands` again prices the NEXT purchase, not this
-- one. Dividing the amount by the places is no better: a purchase that straddles two
-- bands averages to a rate that appears in no price list we ever published. Both answers
-- are confidently wrong, which is worse than the blank that has been there until now.
--
-- WHAT IT IS: the `lines` of the quote the server computed, exactly as ./price.ts built
-- them. One row per band, in ascending rate order, each with the units it covers, the
-- rate they were sold at, and the cost. Not a total — the total is `amount_bdt` and it
-- stays the one figure charged.
--
-- WHY A JSONB DOCUMENT AND NOT A CHILD TABLE. The lines are read exactly once, on paper,
-- with the intent they explain; nothing aggregates across them and nothing joins to them.
-- And the invariant that matters — that the lines add up to the amount they explain — is
-- a single-row check here, where in a child table it is a cross-row constraint needing a
-- deferred trigger. A breakdown that does not add up would be worse than none, so the
-- shape that can enforce it wins.
--
-- NOT NULL, WITH NOTHING TO BACKFILL. Both tables are empty in every environment: the
-- manual provider has never been through a real purchase. So this lands as a required
-- column rather than an optional one, which is also what makes the generated
-- `Insert` type refuse an intent opened without its breakdown — the fence sits in `tsc`
-- as well as in the schema.

-- ---------------------------------------------------------------------------
-- 1. What a breakdown has to be to be worth keeping.
--
-- IMMUTABLE AND IN A CHECK CONSTRAINT rather than in the guard trigger, because this is a
-- statement about what the column may contain and not about who may change it. The guard
-- owns the second question and §3 adds the column to it.
--
-- THE COUNT TEST IS HOW EVERY LINE IS CHECKED AT ONCE. The `where` keeps only lines that
-- are well formed, so `count(*) = jsonb_array_length` says every line survived it. One
-- malformed line and the count falls short and the whole document is refused — no
-- half-valid breakdown, and no need to name which line was wrong in a check constraint
-- that cannot say.
--
-- ROUNDED TO THE PAISA ON BOTH SIDES. `amount_bdt` is `numeric(10,2)` and these figures
-- arrive from JavaScript, where a fractional rate times a count can land a
-- ten-thousandth of a taka away from the product Postgres computes. Every price this
-- product publishes is whole taka, so today the rounding never fires; it is here so that
-- the day one is not, the constraint refuses a real disagreement and not a float.
--
-- `what` is ./price.ts's own vocabulary — the unit the customer counts in. It is checked
-- against the four names rather than left free text, because the receipt reads one of
-- four sentences off it and a fifth name would print nothing at all.
-- ---------------------------------------------------------------------------

create or replace function app.priced_lines_explain(p_lines jsonb, p_total numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_lines is not null
     and pg_catalog.jsonb_typeof(p_lines) = 'array'
     and pg_catalog.jsonb_array_length(p_lines) > 0
     and (
       select pg_catalog.count(*) = pg_catalog.jsonb_array_length(p_lines)
              and pg_catalog.round(pg_catalog.sum((line->>'cost_bdt')::numeric), 2)
                  = pg_catalog.round(p_total, 2)
         from pg_catalog.jsonb_array_elements(p_lines) as line
        where pg_catalog.jsonb_typeof(line) = 'object'
          and line->>'what' in ('places', 'seats', 'branches', 'months')
          and pg_catalog.jsonb_typeof(line->'count') = 'number'
          and pg_catalog.jsonb_typeof(line->'rate_bdt') = 'number'
          and pg_catalog.jsonb_typeof(line->'cost_bdt') = 'number'
          and (line->>'count')::numeric > 0
          and (line->>'rate_bdt')::numeric >= 0
          and (line->>'cost_bdt')::numeric >= 0
          and pg_catalog.round((line->>'count')::numeric * (line->>'rate_bdt')::numeric, 2)
              = pg_catalog.round((line->>'cost_bdt')::numeric, 2)
     );
$$;

-- Nothing with a browser can insert into `payment_intents` at all, so the only roles that
-- ever evaluate this are ours. Granted to `service_role` explicitly all the same, because
-- revoking from `public` takes the default grant away from it too and a purchase failing
-- on a permission nobody meant to remove is a customer who cannot pay us.
revoke all on function app.priced_lines_explain(jsonb, numeric) from anon, authenticated, public;

grant execute on function app.priced_lines_explain(jsonb, numeric) to service_role;

comment on function app.priced_lines_explain(jsonb, numeric) is
  'Whether a `priced_lines` document is a breakdown of the amount beside it: a non-empty '
  'array of {what, count, rate_bdt, cost_bdt} lines, each naming one of price.ts''s four '
  'units, each with count x rate = cost, and together summing to the amount charged. '
  'MASTERPLAN.md §3.8''s "rate applied", made checkable.';

-- ---------------------------------------------------------------------------
-- 2. The column.
-- ---------------------------------------------------------------------------

alter table public.payment_intents
  add column priced_lines jsonb not null;

alter table public.payment_intents
  add constraint payment_intents_priced_lines_explain
    check (app.priced_lines_explain(priced_lines, amount_bdt));

comment on column public.payment_intents.priced_lines is
  'MASTERPLAN.md §3.8''s "rate applied": the quote''s own lines, one per band, as '
  'src/lib/billing/price.ts computed them — [{"what":"places","count":180,'
  '"rate_bdt":18,"cost_bdt":3240}, ...]. Stored because it cannot be recomputed: places '
  'are priced marginally from the ceiling the centre had at the time, and '
  'settle_payment_intent has already raised that ceiling before anybody prints the '
  'receipt. Checked against amount_bdt, so a breakdown on a row is a breakdown that adds '
  'up.';

-- ---------------------------------------------------------------------------
-- 3. It is as fixed as the amount it explains.
--
-- In the unconditional list beside `amount_bdt`, `quantity` and `purpose`, and for the
-- same reason 20260811000057 put them there: a wrong quote is cancelled and re-quoted,
-- which costs one row and leaves both readable. A breakdown that could be edited after
-- the fact is a receipt that can be made to say a rate the customer never paid — the one
-- thing storing it was supposed to make impossible.
--
-- Everything else is 20260811000057's body unchanged; `create or replace` takes the whole
-- function, and the trigger is rebound by name so that a reader looking for what fires on
-- a payment intent finds it in the file that last changed it.
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
     or new.covers_period_start is distinct from old.covers_period_start
     or new.covers_period_end is distinct from old.covers_period_end
     or new.created_at is distinct from old.created_at
  then
    raise exception
      'payment intent % is already quoted at %; cancel it and quote again',
      old.id, old.amount_bdt
      using errcode = '42501',
            hint = 'The amount, purpose, quantity, breakdown and coverage of an intent are fixed when it is created (MASTERPLAN.md 11.4).';
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
  'what it is for, how many, the breakdown that prices it and the period it covers are '
  'fixed the moment the intent exists. A wrong quote is cancelled and re-quoted.';
