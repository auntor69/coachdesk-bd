-- ---------------------------------------------------------------------------
-- The recharge, and the bonus that rides on it (MASTERPLAN.md §11.9, §11.11 —
-- step 25). Money arrives at a bKash account nobody can query, a human verifies
-- it, and the verification is what credits the balance.
--
-- WHY A CLAIM AND NOT A PAYMENT. §11.3's provider is a person with a personal
-- bKash app and §11.1 holds it there deliberately, so there is no webhook to
-- trust and no `settle` call that could be forged. What the customer can do is
-- say "I sent this, here is the transaction ID", and what the founder can do is
-- look. Those are two different facts and they get two rows: the claim is the
-- customer's assertion, `payments` is the money the founder confirmed, and
-- `billing_ledger` is the credit granted. §11.9 is explicit that these are three
-- numbers and that the panel must not conflate them — ৳7,800 arrives, ৳8,190 is
-- credited, and revenue reads the middle one.
--
-- THE AMOUNT IS NEVER THE BROWSER'S. §11.4 lists a client-supplied amount
-- alongside a client-supplied balance, so `recharge_claims` carries no INSERT
-- grant for `authenticated` at all: the claim is written by a Server Action that
-- priced it, and the approval re-derives the bonus from what the founder says
-- actually arrived. A client that lies about its own claim only lies to a human
-- who is about to check the transfer anyway.
--
-- WHAT THIS FILE DOES NOT DO. It does not build the screen (§20.4's recharge,
-- step 27) or the founder's queue UI (step 26's panel). It is the schema, the
-- fences and the two functions those screens will call, so that the arithmetic
-- that credits a balance exists and is tested before anything paints it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The vocabulary.
--
-- `expired` has no writer yet and is declared anyway, for the reason
-- `billing_entry_kind` gives: adding a value to an enum is one statement and
-- removing one rewrites the type and every column that uses it. §11.9's window
-- is "verification is by hand", and a claim that sat unanswered for a month is
-- a real state a founder will want to close without calling it a rejection.
-- ---------------------------------------------------------------------------

create type public.recharge_claim_state as enum (
  'submitted',
  'approved',
  'rejected',
  'expired'
);

comment on type public.recharge_claim_state is
  'MASTERPLAN.md §11.9. A claim''s life: submitted by the centre, and closed by '
  'the founder as approved, rejected, or expired. Only `approved` ever credits '
  'anything, and only through public.approve_recharge_claim.';

-- ---------------------------------------------------------------------------
-- 2. The promotion, which is a row rather than a percentage in code.
--
-- §11.6's 0/5/10/20% is today's offer and not the definition of one. Written as
-- a constant it is a number nobody can change without a deploy, and — worse — a
-- number in two places, because the recharge screen quotes it and the approval
-- path credits it. So the tiers live here, the quote reads them, and
-- `app.bonus_poisha` is the single function both use.
--
-- BASIS POINTS AND NOT PERCENT, because 2.5% is not an integer and this product
-- has already decided that floats have no place in the money path. 500 bps is
-- five percent exactly, and the bonus is floored to whole poisha in the
-- customer's favour — the same rounding `dailyRatePoisha` takes and for the same
-- reason.
--
-- A TIER IS A FLOOR AND NOT A BAND. `{"min_poisha": 780000, "bonus_bps": 500}`
-- means "৳7,800 or more, five percent", and the highest floor reached wins,
-- which is what an owner who types ৳20,000 expects ("discounts based on how many
-- amount they want to recharge"). Read downwards, so a tier list is ordered by
-- nothing and a jumbled one still answers the same.
--
-- A PROMOTION IS EDITED BY SUPERSEDING IT. `active` and the window move what
-- future quotes say; nothing already credited is repriced, because the ledger
-- entries are immutable and `metadata.promotion_id` points at a row whose own
-- history says what it was on the day (§11.11).
--
-- READ: NOBODY WITH A BROWSER. §11.11: "Nothing about a promotion is reachable
-- from a centre's own session, read or write." So the table has RLS on and not
-- one policy on it, which is the same shape `plan_allowances` uses for the same
-- kind of row.
-- ---------------------------------------------------------------------------

create table public.promotions (
  id uuid primary key default gen_random_uuid(),

  -- A stable name for somebody's notes, and the thing a support conversation
  -- quotes. Short, uppercase, and unique.
  code text not null unique check (code = pg_catalog.upper(code)),

  name text not null,

  starts_at timestamptz not null default pg_catalog.now(),
  -- Null is open-ended, which is what today's offer is. A window with no end is
  -- a decision somebody can make; the alternative is a date invented on a
  -- Tuesday that silently stops crediting bonuses on a Friday.
  ends_at timestamptz,

  -- [{"min_poisha": 780000, "bonus_bps": 500}, ...] — floors in poisha, bonuses
  -- in basis points, highest floor reached wins.
  tiers jsonb not null check (
    pg_catalog.jsonb_typeof(tiers) = 'array'
    and pg_catalog.jsonb_array_length(tiers) > 0
  ),

  -- The card this offer is priced against (§11.10). A promotion is only
  -- meaningful relative to the money it is a percentage of, so it is pinned to
  -- the card in force when it was written and the approval path checks the claim
  -- was quoted from the same one.
  price_version_id uuid not null references public.price_versions (id),

  active boolean not null default true,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),

  constraint promotions_window check (ends_at is null or ends_at > starts_at)
);

comment on table public.promotions is
  'MASTERPLAN.md §11.11 — the recharge bonus, as a row rather than a constant. '
  'Basis points, floored to whole poisha in the customer''s favour. Nothing '
  'reachable from a centre''s session, read or write: RLS is on with no policies.';

comment on column public.promotions.tiers is
  'A descending-by-nothing list of {"min_poisha", "bonus_bps"} floors. The '
  'highest floor the amount reaches wins (§11.6). app.bonus_poisha is the only '
  'reader, so a tier that cannot be parsed bonuses as nothing rather than '
  'raising inside an approval.';

-- ---------------------------------------------------------------------------
-- 3. The arithmetic, in one function.
--
-- CALLED BY BOTH SIDES. The recharge screen quotes a bonus with it and the
-- approval path credits one with it, so the figure a customer was shown and the
-- figure they were given cannot be two different sums — which is the bug
-- §11.11 names when it says the bonus must not live in two places.
--
-- A MALFORMED TIER IS NOT AN ERROR, IT IS NO BONUS. This runs inside a founder's
-- approval, and a promotion somebody typed wrong must not be able to stop money
-- being credited — the customer sent the transfer either way. A tier whose
-- `min_poisha` is not a number simply never matches, and a `bonus_bps` that is
-- not one contributes nothing, which floors to no bonus at all.
--
-- Negatives are clamped rather than trusted: a negative basis point would be a
-- bonus that takes money off a paid-in balance, and
-- `billing_ledger_amount_sign` would refuse the row it produced — inside a
-- founder's approval, at the one moment a customer is watching the screen.
-- ---------------------------------------------------------------------------

create or replace function app.bonus_poisha(p_tiers jsonb, p_amount bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.floor(
      p_amount * (
        select pg_catalog.max(greatest((tier ->> 'bonus_bps')::numeric, 0))
        from pg_catalog.jsonb_array_elements(p_tiers) as tier
        where (tier ->> 'min_poisha') is not null
          and pg_catalog.jsonb_typeof(tier -> 'min_poisha') = 'number'
          and p_amount >= (tier ->> 'min_poisha')::numeric
          and pg_catalog.jsonb_typeof(tier -> 'bonus_bps') = 'number'
      ) / 10000
    ),
    0
  )::bigint;
$$;

comment on function app.bonus_poisha(jsonb, bigint) is
  'MASTERPLAN.md §11.11 — the bonus for an amount, in poisha, floored in the '
  'customer''s favour. The highest `min_poisha` floor the amount reaches wins. '
  'The one reader of promotions.tiers: the screen quotes with it and the '
  'approval credits with it, so the two cannot disagree.';

revoke all on function app.bonus_poisha(jsonb, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The claim.
--
-- TWO AMOUNTS ON THE ROW AND A THIRD ON APPROVAL, because a quote and a credit
-- are not the same fact and a customer who sent the wrong figure is the ordinary
-- case. `quoted_*` is what the server priced when the claim was filed and is
-- what the founder is shown beside the money that actually arrived; `arrived_*`
-- and `granted_*` are written once, at approval, and never moved. §11.9's
-- approval "may override the amount" and the panel shows both numbers side by
-- side — that comparison needs both stored, and deriving one from the other
-- would make the screen incapable of showing the disagreement it exists to
-- surface.
--
-- THE USAGE SNAPSHOT IS HERE FOR THE SAME REASON IT IS ON THE LEDGER (§11.12).
-- §11.6's soft spot is that the bands are measured in days at *today's* rate, so
-- a centre that emptied its roster before recharging would reach the top tier
-- for less money. The fence is that the approval screen shows the size the quote
-- was priced from beside the amount, and by then the roster has moved — so the
-- count travels with the claim rather than being looked up when somebody looks.
--
-- `trx_id` IS THE KEY AND THE REFERENCE CODE IS THE CONVENIENCE, which is
-- §11.9's own reading: a personal Send Money may not offer a free-text reference
-- field at all, so the provider-side identifier is what makes a claim unique and
-- the code is what makes it findable in a bKash statement.
-- ---------------------------------------------------------------------------

create table public.recharge_claims (
  id uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null
    references public.coaching_centers (id) on delete cascade,

  -- `CD-7K2M`. The alphabet below has no 0/O/1/I/L in it, because this string is
  -- read off a phone screen and typed into another app by somebody who is
  -- standing up.
  reference_code text not null unique,

  -- What the server priced, and the card and promotion it priced against
  -- (§11.10). `price_version_id` is not null because a claim outlives the card
  -- it was quoted from: the approval writes a `recharge` ledger entry, and
  -- `billing_ledger_price_version_purpose` requires one on exactly that kind.
  quoted_poisha bigint not null check (quoted_poisha > 0),
  quoted_bonus_poisha bigint not null default 0 check (quoted_bonus_poisha >= 0),
  price_version_id uuid not null references public.price_versions (id),
  promotion_id uuid references public.promotions (id) on delete set null,

  usage_students integer check (usage_students >= 0),
  usage_teachers integer check (usage_teachers >= 0),
  usage_branches integer check (usage_branches >= 0),

  -- Required at submission, both of them, and required together: §11.9's six
  -- additions name the transaction ID as the anti-replay key and the sender's
  -- number as what tells two ৳1,999 transfers in the same minute apart.
  trx_id text not null check (pg_catalog.btrim(trx_id) <> ''),
  sender_msisdn text check (sender_msisdn is null or pg_catalog.btrim(sender_msisdn) <> ''),

  state public.recharge_claim_state not null default 'submitted',

  -- Written once, at approval. Never on a rejected claim: a rejection credits
  -- nothing, and a figure on a rejected row would be a number a later screen
  -- could sum by mistake.
  arrived_poisha bigint check (arrived_poisha is null or arrived_poisha > 0),
  granted_poisha bigint check (granted_poisha is null or granted_poisha > 0),
  granted_bonus_poisha bigint check (granted_bonus_poisha is null or granted_bonus_poisha >= 0),
  granted_promotion_id uuid references public.promotions (id) on delete set null,

  -- Rejection carries a reason, from a short list, because a rejection without
  -- one becomes a phone call (§11.9).
  reject_reason text check (
    reject_reason is null
    or reject_reason in ('not_received', 'wrong_amount', 'duplicate', 'other')
  ),

  submitted_by uuid references auth.users (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  submitted_at timestamptz not null default pg_catalog.now(),
  reviewed_at timestamptz,
  review_note text,

  constraint recharge_claims_usage_pair check (
    (usage_students is null) = (usage_teachers is null)
    and (usage_students is null) = (usage_branches is null)
  ),

  -- An approved claim has all three figures and a time; nothing else has any of
  -- them. This is the constraint that keeps "credited" and "the numbers it was
  -- credited from" from ever being able to disagree, and it is what makes a
  -- half-written approval impossible rather than merely unlikely.
  --
  -- `reviewed_by` IS NOT REQUIRED, AND `reviewed_at` IS. The panel approves
  -- through a signed-in founder and names them; the platform can also approve
  -- through its own key — the back-office path §11.9 anticipates when the queue
  -- grows — and under that key `auth.uid()` is null and there is no person to
  -- name. Requiring a name would mean inventing one, and the same absence is
  -- already honest on the ledger, where a settlement's `created_by` is null
  -- because no person triggered it.
  constraint recharge_claims_decision_complete check (
    case state
      when 'approved' then granted_poisha is not null
        and arrived_poisha is not null
        and granted_bonus_poisha is not null
        and reviewed_at is not null
        and reject_reason is null
      when 'rejected' then reject_reason is not null
        and reviewed_at is not null
        and arrived_poisha is null
        and granted_poisha is null
        and granted_bonus_poisha is null
        and granted_promotion_id is null
      else arrived_poisha is null
        and granted_poisha is null
        and granted_bonus_poisha is null
        and granted_promotion_id is null
        and reviewed_at is null
        and reject_reason is null
    end
  ),

  constraint recharge_claims_id_center_key unique (id, coaching_center_id)
);

comment on table public.recharge_claims is
  'MASTERPLAN.md §11.9 — a customer saying "I sent this", waiting for a human to '
  'check the bKash account. The claim asserts; public.approve_recharge_claim is '
  'what credits. Written only by a Server Action that priced it, never by the '
  'browser that filled the form.';

comment on column public.recharge_claims.quoted_bonus_poisha is
  'What the screen showed, kept so the founder''s approval can show the quote '
  'beside what arrived — §11.9''s "two numbers side by side". The credited '
  'bonus is re-derived at approval and is a different column.';

-- The customer's own claim, and the founder's queue. `submitted` first, because
-- that is the order both readers want and the only order that matters.
create index recharge_claims_center_idx
  on public.recharge_claims (coaching_center_id, submitted_at desc);

create index recharge_claims_queue_idx
  on public.recharge_claims (submitted_at)
  where state = 'submitted';

-- ---------------------------------------------------------------------------
-- 5. The anti-replay fence, over approved claims (§11.9, §11.7).
--
-- One bKash transaction ID buys one credit, however many times it is typed into
-- a claim form. Partial, because two *submitted* claims quoting the same
-- transfer are two things a customer can say — the second one is answered the
-- day a human looks, and the fence bites there rather than at the door.
--
-- Case-folded and trimmed, because 9H7K2M and 9h7k2m are one transfer in every
-- bKash statement ever printed. The function below checks this itself before
-- inserting, so the founder gets "that transaction ID has already been
-- credited" rather than a raw constraint name.
-- ---------------------------------------------------------------------------

create unique index recharge_claims_trx_once
  on public.recharge_claims (
    pg_catalog.lower(pg_catalog.btrim(trx_id))
  )
  where state = 'approved';

comment on index public.recharge_claims_trx_once is
  'MASTERPLAN.md §11.9/§11.7 — one provider transaction ID credits one balance, '
  'case-folded. Partial over approved claims: a duplicate is refused at the '
  'moment a founder would catch it, and a rejected claim does not burn the '
  'identifier for ever.';

-- ---------------------------------------------------------------------------
-- 6. What may not be rewritten.
--
-- `quoted_*`, the identifiers and the timestamps are frozen the moment the row
-- exists, and the reasoning is 20260811000025's: a mutable identity is not an
-- identity, and an amount that can be edited after the customer read it is a
-- claim that can be made to say anything. Everything the reviewer writes goes in
-- the `arrived_*`, `granted_*` and `review_*` columns, which is why they exist as
-- separate columns at all.
--
-- service_role is allowed through, because the claim row IS written by our own
-- service-role Server Action — this is a table our code types, unlike
-- `billing_ledger`, which only arithmetic writes. `authenticated` is refused
-- outright, and holds no grant either way.
-- ---------------------------------------------------------------------------

create or replace function app.guard_recharge_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.state = 'approved' or old.state = 'rejected' or old.state = 'expired' then
    raise exception
      'a closed recharge claim cannot be reopened or rewritten (%)', old.state
      using errcode = '42501';
  end if;

  if new.coaching_center_id is distinct from old.coaching_center_id
     or new.reference_code is distinct from old.reference_code
     or new.quoted_poisha is distinct from old.quoted_poisha
     or new.quoted_bonus_poisha is distinct from old.quoted_bonus_poisha
     or new.trx_id is distinct from old.trx_id
     or new.sender_msisdn is distinct from old.sender_msisdn
     or new.price_version_id is distinct from old.price_version_id
     or new.submitted_at is distinct from old.submitted_at
  then
    raise exception
      'what the customer said they sent cannot be rewritten; file a new claim'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function app.guard_recharge_claim() is
  'BEFORE UPDATE on public.recharge_claims: a claim''s identity and its quoted '
  'figures are fixed once filed, and a closed claim is closed. The reviewer '
  'writes arrived_*, granted_* and review_*, which are the only columns a '
  'decision touches.';

create trigger recharge_claims_guard
  before update on public.recharge_claims
  for each row execute function app.guard_recharge_claim();

revoke all on function app.guard_recharge_claim() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. At most three open claims per centre.
--
-- §11.9: "A centre with fifty is confused or is filling the queue, and both want
-- stopping at the door." A count is not something a unique index can express, so
-- this is the one fence in the file that is a trigger rather than a constraint.
--
-- Advisory-locked on the centre before the count, for the reason every other
-- counting guard in this schema is: two taps arriving together would both read
-- two and both insert a third and a fourth.
--
-- SECURITY DEFINER is not needed and is deliberately absent: the counting read
-- is on a table whose RLS policy lets an owner see their own centre's rows, and
-- the insert underneath is already granted to the caller. A definer here would
-- widen the read for no reason.
-- ---------------------------------------------------------------------------

create or replace function app.guard_open_recharge_claims()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_open integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('recharge_claims.open'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  select pg_catalog.count(*)::integer
    into v_open
    from public.recharge_claims c
   where c.coaching_center_id = new.coaching_center_id
     and c.state = 'submitted';

  if v_open >= 3 then
    raise exception
      'this centre already has three claims waiting to be checked'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function app.guard_open_recharge_claims() is
  'BEFORE INSERT on public.recharge_claims: at most three submitted claims per '
  'centre (§11.9). Under a per-centre advisory lock, so two taps arriving '
  'together cannot both count two.';

create trigger recharge_claims_open_cap
  before insert on public.recharge_claims
  for each row execute function app.guard_open_recharge_claims();

revoke all on function app.guard_open_recharge_claims() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. The reference code, minted by the database.
--
-- A default rather than something a Server Action computes, because the only
-- interesting property is that no two live claims share one and the unique index
-- is the only place that can be guaranteed. The action retries on a collision;
-- at four characters from a thirty-one letter alphabet there are 923,521 of
-- them, and a business with enough open claims to make that a coin toss has a
-- different problem.
--
-- The alphabet drops 0, 1, I, L and O. This string is read off one phone and
-- typed into another by somebody standing in a queue, and a zero that reads as
-- an O costs a phone call every time.
-- ---------------------------------------------------------------------------

create or replace function app.mint_reference_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'CD-' || pg_catalog.string_agg(
    pg_catalog.substr(
      '23456789ABCDEFGHJKMNPQRSTUVWXYZ',
      1 + pg_catalog.floor(pg_catalog.random() * 31)::integer,
      1
    ),
    ''
  )
  from pg_catalog.generate_series(1, 4);
$$;

comment on function app.mint_reference_code() is
  'MASTERPLAN.md §11.9 — the `CD-7K2M` a customer types into bKash''s reference '
  'field. Four characters from a 31-letter alphabet with no 0/O/1/I/L in it, '
  'because it is read off one screen and typed into another.';

alter table public.recharge_claims
  alter column reference_code set default app.mint_reference_code();

-- `service_role` HOLDS EXECUTE AND NOBODY ELSE DOES. A column default runs as the role
-- doing the inserting, and the only role that ever inserts here is the Server Action's
-- service key — so revoking from `public` alone would take the code away from the one
-- caller that needs it and leave it with the ones that must not have it.
revoke all on function app.mint_reference_code() from public, anon, authenticated;
grant execute on function app.mint_reference_code() to service_role;

-- ---------------------------------------------------------------------------
-- 9. Who may read a claim, and who may write one.
--
-- Read: the owner, and the platform admin. The same pair `billing_ledger` carries
-- and for the same reason — a claim names what the centre pays *us*, and §2.4
-- keeps that out of a manager's screens.
--
-- Write: nobody with a browser. `authenticated` holds no INSERT, UPDATE or
-- DELETE at all, because §11.4's list starts with a client-supplied amount and
-- the claim carries two of them. The insert is a service-role Server Action and
-- the decision is `approve_recharge_claim` below.
-- ---------------------------------------------------------------------------

alter table public.recharge_claims enable row level security;

create policy recharge_claims_owner_read on public.recharge_claims
  for select to authenticated
  using (app.is_owner(coaching_center_id) or app.is_platform_admin());

revoke insert, update, delete, truncate
  on public.recharge_claims from authenticated, anon;

alter table public.promotions enable row level security;

revoke insert, update, delete, truncate on public.promotions from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 10. Approval, which is the only thing in the product that credits money.
--
-- ONE TRANSACTION, FOUR WRITES: a `payments` row for the money that actually
-- arrived, a ledger `recharge` entry for the money, a ledger `promotion_bonus`
-- entry for the gift, and the claim closed as approved. §11.11's table is the
-- specification — ৳7,800 sent, ৳7,800 of revenue, ৳390 given away, ৳8,190 of
-- balance — and the reason there are two ledger entries rather than one is that
-- a single ৳8,190 row makes the founder's own accounts unanswerable. Cash
-- received, credit granted and deferred revenue are three numbers, and "how much
-- have we given away this quarter" has to be a `sum` rather than a
-- reconstruction.
--
-- THE BONUS IS RE-DERIVED HERE AND THE CLAIM'S QUOTE IS NOT TRUSTED. §11.11: the
-- screen displays a quote the server priced; the approval re-derives the bonus
-- from the amount that actually arrived and the promotion live at that moment.
-- A customer who sent ৳8,000 against a ৳7,800 quote gets the ৳8,000 band — the
-- quote was never a promise about a transfer nobody had seen yet.
--
-- WHO MAY CALL IT: a platform admin, or the server. `service_role` is allowed
-- because a future back-office job will approve in bulk, and refusing it here
-- would only move the founder check into a Server Action where it is one
-- forgotten `requirePlatformAdmin()` away from being no check at all. `auth.uid()`
-- is what the audit line records, so an approval through the panel names the
-- person who made it.
--
-- WHAT IT DOES NOT DO: it does not touch `paid_through`. A recharge covers no
-- period (§11.9) and under §11.6 there is no period to cover — the money is a
-- balance and the days come off it one at a time. Nor does it move
-- `charged_through`: settling is what does that, and it is already idempotent.
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
       and pg_catalog.lower(pg_catalog.btrim(c.trx_id))
           = pg_catalog.lower(pg_catalog.btrim(v_claim.trx_id))
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
     and p.starts_at <= pg_catalog.now()
     and (p.ends_at is null or p.ends_at > pg_catalog.now())
   order by p.created_at desc
   limit 1;

  v_has_promotion := found;

  if v_has_promotion then
    v_bonus := app.bonus_poisha(v_promotion.tiers, v_arrived);
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
      || pg_catalog.to_char(v_arrived::numeric / 100, 'FM999999990.00'),
    auth.uid(),
    pg_catalog.jsonb_build_object(
      'claim_id', v_claim.id,
      'trx_id', v_claim.trx_id
    )
  );

  -- 3. The gift, on its own row, because it is not revenue (§11.11).
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
      pg_catalog.jsonb_build_object(
        'claim_id', v_claim.id,
        'promotion_id', v_promotion.id
      )
    );
  end if;

  -- 4. The claim, closed. `granted_poisha` is the money and never the bonus:
  -- `balance_after` of the recharge entry is the credit and the bonus is a
  -- second row on top of it, so a `granted_poisha` that included the gift would
  -- be a figure no row in the ledger agrees with.
  update public.recharge_claims c
     set state = 'approved',
         arrived_poisha = v_arrived,
         granted_poisha = v_arrived,
         granted_bonus_poisha = v_bonus,
         granted_promotion_id = case when v_has_promotion then v_promotion.id end,
         reviewed_by = auth.uid(),
         reviewed_at = pg_catalog.now(),
         review_note = p_note
   where c.id = v_claim.id;

  select c.balance_poisha into v_balance
    from public.coaching_centers c
   where c.id = v_claim.coaching_center_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'claimId', v_claim.id,
    'arrivedPoisha', v_arrived,
    'bonusPoisha', v_bonus,
    'creditPoisha', v_arrived + v_bonus,
    'balanceAfter', v_balance
  );
end;
$$;

comment on function public.approve_recharge_claim(uuid, bigint, text) is
  'MASTERPLAN.md §11.9/§11.11 — the only thing that credits money. One '
  'transaction: a payments row for what arrived, a ledger recharge entry for the '
  'money, a promotion_bonus entry for the gift, and the claim closed. Founder '
  'only, and the bonus is re-derived from the amount that actually arrived '
  'rather than trusted from the quote the customer saw.';

-- ---------------------------------------------------------------------------
-- 11. Rejection, which needs a reason.
--
-- A short list rather than free text, because §11.9's point is that a rejection
-- without a reason becomes a phone call and a reason nobody can group is barely
-- better. `other` is in the vocabulary and carries the note.
--
-- Nothing is credited, so nothing is deleted either: the claim stays, closed,
-- and the customer's screen can say what happened instead of going blank.
-- ---------------------------------------------------------------------------

create or replace function public.reject_recharge_claim(
  p_claim uuid,
  p_reason text,
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
begin
  if auth.uid() is not null then
    if not app.is_platform_admin() then
      raise exception 'only the platform can reject a recharge'
        using errcode = '42501';
    end if;
  elsif current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'only the platform can reject a recharge'
      using errcode = '42501';
  end if;

  select * into v_claim
    from public.recharge_claims c
   where c.id = p_claim
     for update;

  if not found then
    raise exception 'reject_recharge_claim: no such claim' using errcode = '23503';
  end if;

  if v_claim.state <> 'submitted' then
    raise exception 'this claim is already %', v_claim.state
      using errcode = '23514';
  end if;

  -- Refused by the column check as well, and refused here first so the panel
  -- gets a sentence in its own terms rather than a constraint name.
  if p_reason not in ('not_received', 'wrong_amount', 'duplicate', 'other') then
    raise exception 'a rejection needs a reason from the list, and % is not one',
      p_reason using errcode = '22023';
  end if;

  update public.recharge_claims c
     set state = 'rejected',
         reject_reason = p_reason,
         reviewed_by = auth.uid(),
         reviewed_at = pg_catalog.now(),
         review_note = p_note
   where c.id = v_claim.id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'claimId', v_claim.id,
    'reason', p_reason
  );
end;
$$;

comment on function public.reject_recharge_claim(uuid, text, text) is
  'MASTERPLAN.md §11.9 — closes a claim that will not be credited, with a reason '
  'from a short list. Credits nothing and deletes nothing: the customer''s screen '
  'can say what happened.';

-- ---------------------------------------------------------------------------
-- 12. Grants.
--
-- The two decisions are called by a signed-in founder, so `authenticated` needs
-- EXECUTE — the founder check inside each function is the fence, not the grant,
-- for the reason every grant in this schema carries: a grant is a list somebody
-- can paste over, and a `raise exception` is not.
-- ---------------------------------------------------------------------------

revoke all on function public.approve_recharge_claim(uuid, bigint, text)
  from public, anon;
revoke all on function public.reject_recharge_claim(uuid, text, text)
  from public, anon;

grant execute on function public.approve_recharge_claim(uuid, bigint, text)
  to authenticated, service_role;
grant execute on function public.reject_recharge_claim(uuid, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 13. The founding promotion, seeded here and not written by the app (§11.11).
--
-- §11.6's ladder: 5% at three months, 10% at six, 20% at twelve — expressed as
-- the *money* each of those is, which is why the floors are ৳7,800, ৳15,600 and
-- ৳31,200 rather than the month counts. The month counts belong to the screen,
-- which derives them from the centre's own monthly figure; the database prices
-- money, and a tier that could only be described in months would need the roster
-- to evaluate.
--
-- No row at ৳2,600: one month carries no bonus, and a tier of zero basis points
-- is the absence of a tier rather than one of its values — the same rule that
-- keeps Teacher Free out of `price_versions`.
--
-- `code` is `LAUNCH` and the window is open-ended, because today's offer has no
-- end date. Ending it is an `update` from a future migration, or a new promotion
-- and an `active = false` here — never a code change, which is the whole reason
-- this is a row.
-- ---------------------------------------------------------------------------

-- The three floors are §11.6's ladder in poisha — ৳7,800, ৳15,600, ৳31,200 — and
-- the rates are its 5%, 10% and 20%. `tests/promotions.test.ts` parses this
-- statement out of the file and holds it against the same ladder in
-- src/lib/plans.ts, the way tests/price-versions.test.ts holds the card: a third
-- copy of the numbers written into the test itself would pass while both of the
-- others drifted.

insert into public.promotions (code, name, tiers, price_version_id, active)
select 'LAUNCH',
       'Launch recharge bonus',
       pg_catalog.jsonb_build_array(
         pg_catalog.jsonb_build_object('min_poisha', 780000, 'bonus_bps', 500),
         pg_catalog.jsonb_build_object('min_poisha', 1560000, 'bonus_bps', 1000),
         pg_catalog.jsonb_build_object('min_poisha', 3120000, 'bonus_bps', 2000)
       ),
       v.id,
       true
  from (
    select pv.id
      from public.price_versions pv
     order by pv.effective_from desc
     limit 1
  ) v
 where not exists (select 1 from public.promotions);
