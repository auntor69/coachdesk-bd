-- The server decides what a purchase costs, before the customer is sent anywhere.
--
-- MASTERPLAN §11.2. Every purchase — a subscription month, one student place, a
-- bulk-import block, an extra branch — creates an intent first, and the intent owns the
-- amount. §11.4's list of what a browser may never send is held here rather than argued
-- in a Server Action: INSERT and UPDATE are revoked from `authenticated`, so a session
-- cannot name a price, a plan, a quantity or a branch at all. It can read its own
-- intents and nothing else.
--
-- THIS IS NOT BKASH (§11.1). No endpoint, no credential, no guessed request body. The
-- provider on an intent is `manual` today: money arrives by transfer or in person and
-- the founder confirms it against their own app. §11.3 calls that a real provider whose
-- verification step is a human being, and the whole point of the interface is that
-- switching to the API changes one file rather than this schema.
--
-- A STATE MACHINE, NOT A STATUS LABEL. The transitions §11.2 draws are enforced by a
-- trigger, so `successful` is reachable only from `initiated` and only once. That
-- ordering is what makes "successful" mean something: a settled intent always has a
-- provider reference behind it, because the reference is what the `initiated` step is
-- for. Money that arrived with no intent at all is still recordable — that is
-- `recordCenterPayment` in the founder panel, untouched — so nothing here can lose a
-- payment by refusing it.
--
-- TWO IDEMPOTENCY KEYS, because there are two ways to pay twice for one thing. The
-- request key is the founder panel's existing pattern (20260811000025): a uuid minted
-- once per form, so a retried submit does not open a second intent. The provider
-- reference is §11.2's own: a webhook delivered twice, or a founder confirming the same
-- bKash TrxID against two intents, loses to a unique index. The request key is then
-- carried onto the `payments` row it writes, where the index from 20260811000025 makes
-- a second receipt for one intent impossible even if every check above were bypassed.
--
-- WHAT ATTACHES ONLY ON SUCCESS is one column, `grants_capacity`, and one function.
-- `settle_payment_intent` marks the intent, writes the receipt and raises the ceiling in
-- one transaction, because a payment recorded without its capacity is a customer who
-- paid for nothing and a capacity granted without its payment is a free seat.

-- ---------------------------------------------------------------------------
-- 1. What can be bought, and where a purchase can be.
--
-- Four purposes, and each has a price function in src/lib/plans.ts already:
-- monthlyBillBdt, capacityCostBdt, teacherChargeBdt, nextBranchCostBdt. SMS credits are
-- deliberately absent — §3.9 says no screen can top them up and every tier grants zero,
-- so a purpose for them would be a purchase with no price behind it.
--
-- The states are §11.2's diagram exactly. `expired` is reachable and nothing sweeps for
-- it: expiry is enforced as a comparison at settle time against `expires_at`, the same
-- way 20260811000036 resolves a trial, because a cron that fails to run must not be what
-- decides whether an old quote is still honoured.
-- ---------------------------------------------------------------------------

create type public.payment_purpose as enum (
  'subscription',
  'student_capacity',
  'teacher_seat',
  'branch'
);

create type public.payment_intent_state as enum (
  'pending',
  'initiated',
  'successful',
  'failed',
  'cancelled',
  'expired',
  'refunded'
);

create type public.payment_provider as enum ('manual', 'bkash');

comment on type public.payment_provider is
  'Which implementation of MASTERPLAN.md §11.3''s interface handles this intent. '
  '`manual` is the founder confirming a transfer they can see, which is how the first '
  'fifty customers pay; `bkash` is reserved and not implemented (§11.1). Adding one is '
  'an `alter type ... add value` and a file in src/lib/billing.';

-- ---------------------------------------------------------------------------
-- 2. The intent.
--
-- `quantity` and `grants_capacity` are two different numbers and the check ties them:
-- for a capacity purchase they agree, and for everything else the grant is zero. That
-- makes "a capacity purchase that grants nothing" and "a branch purchase that grants
-- seats" both unrepresentable, rather than left to whichever Server Action fills the row.
--
-- `branch_id` records which branch asked. It does NOT scope the capacity: §3.6 keeps one
-- shared pool at the organisation and §17 forbids per-branch quotas, so a place bought
-- from Dhanmondi is a place the whole centre can use. The column is here because §3.8
-- wants a receipt to say where the money came from.
--
-- No `payment_id` here. The reverse column — `payments.intent_id`, added in §3 — points
-- the permanent money record at the explanation of it, which is the direction support
-- reads in: a payment is found first and then asked what it bought.
-- ---------------------------------------------------------------------------

create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null
    references public.coaching_centers (id) on delete cascade,

  purpose public.payment_purpose not null,
  quantity integer not null check (quantity > 0),
  amount_bdt numeric(10,2) not null check (amount_bdt > 0),
  grants_capacity integer not null default 0 check (grants_capacity >= 0),

  covers_period_start date,
  covers_period_end date,

  branch_id uuid,

  state public.payment_intent_state not null default 'pending',
  provider public.payment_provider not null default 'manual',
  provider_ref text,
  failure_reason text,

  idempotency_key uuid,
  requested_by uuid references auth.users (id) on delete set null,
  settled_by uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  initiated_at timestamptz,
  settled_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  updated_at timestamptz not null default now(),

  -- Composite, so a branch cannot be borrowed from another centre.
  constraint payment_intents_branch_fkey
    foreign key (branch_id, coaching_center_id)
    references public.branches (id, coaching_center_id)
    on delete set null (branch_id),

  -- What `payments.intent_id` points at, and the same rule in reverse.
  constraint payment_intents_id_center_key unique (id, coaching_center_id),

  constraint payment_intents_grant_matches_purpose check (
    case purpose
      when 'student_capacity' then grants_capacity = quantity
      else grants_capacity = 0
    end
  ),
  constraint payment_intents_coverage_pair
    check ((covers_period_start is null) = (covers_period_end is null)),
  constraint payment_intents_coverage_order
    check (covers_period_end >= covers_period_start),
  constraint payment_intents_coverage_purpose
    check (purpose = 'subscription' or covers_period_start is null),
  constraint payment_intents_expires_after_created check (expires_at > created_at)
);

-- ---------------------------------------------------------------------------
-- 3. The two duplicates, and the receipt's pointer back.
--
-- The partial unique on the request key repeats 20260811000025's shape, including the
-- `where ... is not null` — an intent opened by a script with no form behind it should not
-- collide with the next one.
--
-- The provider reference is scoped by provider as well as centre, because `manual` refs
-- are typed by a human and a bKash TrxID is only unique within bKash.
-- ---------------------------------------------------------------------------

create unique index payment_intents_request_key
  on public.payment_intents (coaching_center_id, idempotency_key)
  where idempotency_key is not null;

create unique index payment_intents_provider_ref_key
  on public.payment_intents (coaching_center_id, provider, provider_ref)
  where provider_ref is not null;

-- What the founder panel and §3.8's history read: newest first, per centre.
create index payment_intents_center_idx
  on public.payment_intents (coaching_center_id, created_at desc);

-- The settle path and any "what is still outstanding" screen.
create index payment_intents_open_idx
  on public.payment_intents (coaching_center_id, state, expires_at)
  where state in ('pending', 'initiated');

alter table public.payments
  add column intent_id uuid,
  add constraint payments_intent_fkey
    foreign key (intent_id, coaching_center_id)
    references public.payment_intents (id, coaching_center_id)
    on delete set null (intent_id);

create index payments_intent_idx on public.payments (intent_id)
  where intent_id is not null;

comment on column public.payments.intent_id is
  'The intent this receipt settled, or null for money recorded directly by the founder '
  'panel. A payment with an intent knows what it bought — purpose, quantity, the branch '
  'that asked — which is most of what MASTERPLAN.md §3.8 wants on a receipt.';

comment on column public.payment_intents.grants_capacity is
  'Student places this purchase adds to coaching_centers.student_capacity, and only when '
  'it reaches `successful`. Zero for every other purpose.';

comment on column public.payment_intents.expires_at is
  'After this, settle_payment_intent refuses the intent rather than honouring an old '
  'quote. Compared at settle time; no job sweeps for it.';

-- ---------------------------------------------------------------------------
-- 4. The transitions, held at Layer 1.
--
-- This is what lets everything except settling be a plain service_role update instead of
-- four more RPCs: the legal moves are §11.2's diagram and the database owns them, so a
-- Server Action that gets one wrong fails loudly rather than inventing an eighth state.
--
-- `pending -> successful` is absent on purpose. A settled intent must have a provider
-- reference behind it, the reference arrives with `initiated`, and reconciliation is the
-- reason both are true. Money that never had an intent — cash at the desk — is recorded
-- by the founder panel's own path and does not come through here.
--
-- THE UNCONDITIONAL LIST IS THE PRICE, following 20260811000025's split: `receipt_no` is
-- refused to everybody because no version of changing it is a fix, and an amount is the
-- same kind of fact. A wrong quote is cancelled and re-quoted, which costs one row and
-- leaves both of them readable. Softer columns — the reference, the failure reason, the
-- expiry — stay writable by the server, because a mistyped TrxID is a support case.
--
-- No SQLSTATE of its own: every refusal here is 20260811000036's `42501` case, "you are
-- not allowed to do this", which is what every other guard in this schema raises.
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
     or new.grants_capacity is distinct from old.grants_capacity
     or new.covers_period_start is distinct from old.covers_period_start
     or new.covers_period_end is distinct from old.covers_period_end
     or new.created_at is distinct from old.created_at
  then
    raise exception
      'payment intent % is already quoted at %; cancel it and quote again',
      old.id, old.amount_bdt
      using errcode = '42501',
            hint = 'The amount, purpose, quantity and coverage of an intent are fixed when it is created (MASTERPLAN.md 11.4).';
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

create trigger payment_intents_guard
  before update or delete on public.payment_intents
  for each row execute function app.guard_payment_intent();

create trigger payment_intents_updated_at
  before update on public.payment_intents
  for each row execute function public.set_updated_at();

create trigger payment_intents_audit
  after insert or update or delete on public.payment_intents
  for each row execute function app.log_audit_entry();

-- ---------------------------------------------------------------------------
-- 5. Who may see an intent, and who may write one.
--
-- Read: the owner, because this is money the centre pays us and §2.4 keeps platform
-- billing out of a manager's screens. Write: nobody with a browser. That is the whole of
-- §11.4 — no client-supplied amount, plan, quantity, capacity or branch — held as an
-- absent grant rather than as a validation somebody can forget to call.
-- ---------------------------------------------------------------------------

alter table public.payment_intents enable row level security;

create policy payment_intents_owner_read on public.payment_intents
  for select to authenticated
  using (app.is_owner(coaching_center_id) or app.is_platform_admin());

revoke insert, update, delete, truncate on public.payment_intents from authenticated, anon;

comment on table public.payment_intents is
  'MASTERPLAN.md §11.2 — what a centre is buying from us, priced by the server before the '
  'customer is sent anywhere. The row is created by our own server with the service key; '
  'a session can read its own and nothing else.';

-- ---------------------------------------------------------------------------
-- 6. Settling, which is three writes or none.
--
-- The intent is marked, the receipt is written and the ceiling is raised in one
-- transaction, because a payment with no capacity behind it is a customer who paid for
-- nothing and a capacity with no payment behind it is a free seat.
--
-- SETTLING TWICE READS BACK THE FIRST ANSWER rather than raising, which is §11.2's own
-- rule and what makes a retried Confirm or a webhook delivered twice harmless. Below that
-- sit two more fences: the row is locked `for update`, and the intent's request key is
-- carried onto the `payments` row where 20260811000025's unique index makes a second
-- receipt for one intent impossible even if this function were bypassed entirely.
--
-- SECURITY INVOKER, and this is load-bearing. `app.guard_center_billing` exempts
-- `service_role` from the lock on `student_capacity`; inside a SECURITY DEFINER function
-- `current_user` would be the function's owner, which would exempt every caller instead
-- and leave the ceiling unguarded for the whole schema. 20260811000036 makes the same
-- choice for the same reason.
--
-- THE CEILING IS RAISED FROM THE CEILING, not by adding to the column. `student_capacity`
-- is an absolute number that `app.student_ceiling` reads as
-- `greatest(plan_included, purchased)`, so a centre with 79 included places and a fresh
-- 41-seat purchase must end up at 120 — adding 41 to a zero column would leave the plan's
-- 79 winning the greatest() and the customer with nothing for their money. Reading the
-- effective ceiling at settle time also means a plan upgrade between quote and settlement
-- adds to the bigger number, which is what "41 more places" was sold as.
--
-- The advisory lock is 20260811000036's, in the same two-key namespace on purpose: two
-- settlements for one centre would otherwise both read the old ceiling and the second
-- would overwrite the first's seats, and an admission racing a settlement should see the
-- ceiling it is about to be measured against.
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
    coalesce(p_note, it.purpose::text || ' x' || it.quantity),
    p_settled_by,
    it.idempotency_key
  )
  returning id into paid;

  update public.payment_intents
     set state = 'successful',
         provider_ref = coalesce(p_provider_ref, provider_ref),
         settled_by = coalesce(p_settled_by, settled_by)
   where id = it.id;

  -- Only student places are a stored ceiling. A teacher seat and a branch are counted from
  -- the rows themselves and billed monthly, so their intents grant nothing here and the
  -- check constraint on the table says so.
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
  'MASTERPLAN.md §11.2 — mark an initiated intent successful, write its receipt and raise '
  'the student ceiling, or return the first settlement''s answer if it already happened. '
  'Server-only: the browser cannot reach it, and the intent owns the amount.';
