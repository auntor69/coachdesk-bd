-- ---------------------------------------------------------------------------
-- The prepaid balance gets a ledger. Money in, a day's cost out, and a running
-- total that cannot disagree with the entries behind it.
--
-- MASTERPLAN.md §11.6 is the model in one sentence: money in → taka in the balance →
-- each day takes its own cost off → when the balance cannot cover the next day, saving
-- stops until they top up. §16.1 step 21 is this file, and it is deliberately the least
-- interesting step: nothing reads the balance yet. `app.settle_billing` (22) writes to
-- it, the access derivation (24) reads it, and the recharge screen (25) is what puts
-- real money in. Until then this table fills up with one row per centre and sits there.
--
-- THAT ORDER IS THE WHOLE SAFETY ARGUMENT. Today access comes from
-- `coaching_centers.paid_through` through src/lib/entitlement.ts, and it still will
-- tomorrow. So a mistake in this migration cannot lock a centre out of anything: the
-- worst it can do is record a wrong number nobody consults. Step 24 is the one that
-- hands the decision over, and by then this table has been carrying real daily charges
-- for a real customer long enough to be checked by hand against a bank statement.
--
-- POISHA, AND INTEGERS ONLY. ৳2,600 ÷ 30 is ৳86.666…, which is not a whole taka and
-- not a whole poisha either. `numeric` would hold it exactly and then the ledger would
-- carry a third of a poisha for ever, and `sum()` over three hundred such rows is a
-- figure no bank statement can be reconciled against. So the rate is floored to whole
-- poisha (§11.6, in the customer's favour) and every column here is `bigint`. The
-- existing money tables are `numeric(10,2)` taka and stay that way — `payments` is what
-- a customer handed over, which is always a whole number of taka, and rewriting a live
-- money table to change its units is not a thing to do in the same week as introducing
-- a second one. §11.14 records the conversion at the boundary.
--
-- bigint and not integer: ৳21 million is where integer poisha runs out, which is a
-- number this business would love to reach and a ceiling nobody should have to think
-- about again. Eight bytes against four, on a table with one row per centre per day.
--
-- WHAT IS NOT IN THIS FILE, ON PURPOSE. `price_version_id` belongs on every charge
-- (§11.10) and there is no `price_versions` table until step 21a — a uuid column with
-- nothing to reference is exactly the sort of thing that is added "for later" and then
-- carries garbage. 21a adds the column with its foreign key, in the migration that
-- creates the thing it points at. The usage snapshot columns are here now, because they
-- reference nothing and step 22 needs somewhere to write them.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The vocabulary.
--
-- Eleven kinds, from §11.7. An enum rather than free text because a `kind` this
-- arithmetic depends on must not be able to arrive misspelled: `sum(amount_poisha)
-- where kind = 'daily_charge'` silently omits a row that says `'daily-charge'`, and a
-- reconciliation query that quietly reads fewer rows than exist is worse than one that
-- errors.
--
-- The whole vocabulary is declared now even though four of the kinds have no writer
-- until later steps. Adding a value to an enum is one statement; removing one means
-- rewriting the type and every column that uses it, so the cost is asymmetric and the
-- list is settled in the masterplan. Two of them are money the founder decides
-- (`founder_money_adjustment`, `founder_grant_days` — step 26), and two record a
-- settlement that did not happen (step 22a).
--
-- WHY A FAILED SETTLEMENT IS A LEDGER ROW AND NOT ONLY A `settlement_runs` ROW. The
-- customer reads this table — §20.4 wants a day-by-day history — and a day with no row
-- at all is indistinguishable from a day we forgot. "12 Sep: nothing charged, we could
-- not read your roster" is a sentence an owner should find in their own history rather
-- than one they have to ring us to hear. It carries no money, and section 3's check is
-- what keeps it from pretending to.
-- ---------------------------------------------------------------------------

create type public.billing_entry_kind as enum (
  -- Money arrived and the founder confirmed it (§11.9).
  'recharge',
  -- The promotion on top of a recharge. A separate row from the cash, because
  -- ৳7,800 is revenue and the ৳390 bonus is not, and one merged ৳8,190 makes every
  -- revenue figure in the product wrong (§11.11).
  'promotion_bonus',
  -- One day's cost, charged after the day has finished (§11.6).
  'daily_charge',
  -- The founder moving money on or off a balance, with a written reason (§11.8).
  'founder_money_adjustment',
  -- Days given rather than sold — a Ramadan closure, an apology — priced at the rate
  -- in force so that the balance stays the only currency and access stays one
  -- comparison. `metadata.days` records what was actually asked for.
  'founder_grant_days',
  -- Money handed back out of the balance. Rare by design: §11.6 sells a
  -- non-refundable balance, and §14.1 is where that has to be written down before
  -- the first taka arrives.
  'refund',
  -- An entry undone in full, pointing at what it undoes.
  'reversal',
  -- An entry corrected by a difference rather than undone.
  'correction',
  -- A day that could not be charged, carrying no money (§11.13).
  'settlement_failure',
  -- A retried attempt at one, carrying no money; the charge itself is a
  -- `daily_charge` written by the same function.
  'settlement_retry',
  -- The one row per centre this migration writes, so that every centre's history
  -- starts somewhere and no balance appears out of nowhere (§11.14).
  'migration_opening_balance'
);

comment on type public.billing_entry_kind is
  'MASTERPLAN.md §11.7. What a billing_ledger row is. The sign of amount_poisha is '
  'pinned per kind by billing_ledger_amount_sign, so the kind alone tells a reader '
  'whether money went on or off the balance.';

-- ---------------------------------------------------------------------------
-- 2. The table.
--
-- APPEND-ONLY, WHICH SECTION 5 ENFORCES. There is no UPDATE path and no DELETE path,
-- for anybody, including our own service key. A wrong entry is answered by a
-- `reversal` or a `correction` — a new row, dated when the mistake was noticed, by
-- somebody named. That is the same rule `fee_payments` has held since 20260811000017
-- and the same one 20260811000074 gave `payments`; this table is stricter than both,
-- and section 5 says why.
--
-- `balance_before` AND `balance_after`, WHICH IS ONE MORE THAN THE PRECEDENT.
-- `sms_credit_ledger` (20260811000001) stores only `balance_after`, and that is enough
-- to see a jump but not enough to prove one: a row whose `balance_after` is wrong looks
-- exactly like a row whose `delta` is wrong. With both, `balance_before + amount =
-- balance_after` is a CHECK the database refuses to break, and the chain — each row's
-- `balance_before` equalling the previous row's `balance_after` — is a query that finds
-- a gap without knowing what the right answer was. §11.13's second reconciliation
-- query is exactly that walk.
--
-- Neither is the caller's to supply. Section 4's trigger computes both from the entries
-- already in the table, under a per-centre advisory lock, and refuses an insert that
-- tries to name them. A balance is arithmetic over this table, never a claim made by
-- whatever code happened to be writing.
--
-- THE USAGE SNAPSHOT IS ON THE ROW AND NOT LOOKED UP LATER. §11.12: the count that was
-- charged is a fact about the day it was charged on, and a student who left in October
-- must not change what September cost. A join to today's roster would answer a
-- different question every time it ran.
-- ---------------------------------------------------------------------------

create table public.billing_ledger (
  id uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null
    references public.coaching_centers (id) on delete cascade,

  kind public.billing_entry_kind not null,

  -- Signed. Positive puts money on the balance, negative takes it off, and section 3
  -- ties the sign to the kind so the two cannot disagree.
  amount_poisha bigint not null,
  balance_before bigint not null,
  balance_after bigint not null,

  -- The Dhaka date this entry is *about*, which is not `created_at`. A day is charged
  -- after it has finished, so a charge for the 11th is written on the 12th; and the
  -- unique index in section 3 is what makes settling twice for one day impossible.
  charge_date date,

  -- What the roster looked like when this was charged (§11.12). Null on every kind
  -- that is not a charge.
  usage_students integer check (usage_students >= 0),
  usage_teachers integer check (usage_teachers >= 0),
  usage_branches integer check (usage_branches >= 0),

  -- One line, in the reader's own terms, for the history screen §20.4 asks for. Not a
  -- place for a figure: section 3's arithmetic reads the columns and a number written
  -- in prose here would be a second, unchecked copy of it.
  description text,

  -- The money this entry came from, where there is any. Composite, per
  -- 20260811000005: a payment or an intent from another centre must not be namable.
  payment_id uuid,
  payment_intent_id uuid,
  -- What a reversal or correction is about. Self-referential and composite for the
  -- same reason.
  reverses_entry_id uuid,

  -- Who caused it. Null for a settlement, which no person triggers.
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  -- Anything the arithmetic does not read: `metadata.days` behind a granted-days
  -- entry, `metadata.promotion_id` behind a bonus, an attempt number behind a retry.
  -- NEVER a figure a screen or a query adds up — those are columns, and a number that
  -- lives only in here is a number no constraint can defend.
  metadata jsonb not null default '{}'::jsonb,

  -- What `reverses_entry_id` points at, and what a later table can point at.
  constraint billing_ledger_id_center_key unique (id, coaching_center_id),

  constraint billing_ledger_payment_fkey
    foreign key (payment_id, coaching_center_id)
    references public.payments (id, coaching_center_id)
    on delete set null (payment_id),

  constraint billing_ledger_intent_fkey
    foreign key (payment_intent_id, coaching_center_id)
    references public.payment_intents (id, coaching_center_id)
    on delete set null (payment_intent_id),

  constraint billing_ledger_reverses_fkey
    foreign key (reverses_entry_id, coaching_center_id)
    references public.billing_ledger (id, coaching_center_id)
    on delete set null (reverses_entry_id),

  -- The arithmetic, as a constraint rather than as a hope. Nothing can write a row
  -- whose own three numbers disagree, so a wrong balance is always a wrong *chain* and
  -- the walk in §11.13 finds where it starts.
  constraint billing_ledger_arithmetic
    check (balance_before + amount_poisha = balance_after),

  -- A balance cannot go below nothing. §11.6 stops the product rather than lending:
  -- when the balance cannot cover the next day, saving stops. So a charge that would
  -- overdraw is a charge that must not be written, and the guard is here rather than
  -- only inside `app.settle_billing` because that function is not the only thing that
  -- will ever write a debit.
  constraint billing_ledger_no_overdraft check (balance_after >= 0),

  -- A charge is about a day, and nothing else is.
  constraint billing_ledger_charge_date_purpose check (
    (charge_date is not null) = (kind in ('daily_charge', 'settlement_failure', 'settlement_retry'))
  ),

  -- The snapshot travels with the charge or not at all: a count with no charge behind
  -- it is a number nobody can check, and a charge with no count behind it cannot be
  -- explained to the customer who paid it.
  constraint billing_ledger_usage_pair check (
    (usage_students is null) = (usage_teachers is null)
    and (usage_students is null) = (usage_branches is null)
  ),
  constraint billing_ledger_usage_purpose check (
    usage_students is null or kind in ('daily_charge', 'settlement_failure')
  ),

  -- A reversal or a correction says what it is about; nothing else does.
  constraint billing_ledger_reverses_purpose check (
    (reverses_entry_id is null) or kind in ('reversal', 'correction')
  ),

  -- ---------------------------------------------------------------------------
  -- The sign is a property of the kind, not of the caller.
  --
  -- Without this, a `recharge` of -৳500 is a legal row: the arithmetic check passes,
  -- the balance falls, and the history reads as money arriving. Every kind that means
  -- "money on" is therefore positive, every kind that means "money off" is negative,
  -- and the three that carry no money are exactly zero.
  --
  -- `reversal`, `correction` and `founder_money_adjustment` are the three that may go
  -- either way, because that is what they are for — but never zero, because a zero
  -- correction corrects nothing and a zero adjustment adjusts nothing, and both are
  -- what a bug writes.
  -- ---------------------------------------------------------------------------
  constraint billing_ledger_amount_sign check (
    case kind
      when 'recharge' then amount_poisha > 0
      when 'promotion_bonus' then amount_poisha > 0
      when 'founder_grant_days' then amount_poisha > 0
      when 'daily_charge' then amount_poisha < 0
      when 'refund' then amount_poisha < 0
      when 'reversal' then amount_poisha <> 0
      when 'correction' then amount_poisha <> 0
      when 'founder_money_adjustment' then amount_poisha <> 0
      when 'settlement_failure' then amount_poisha = 0
      when 'settlement_retry' then amount_poisha = 0
      when 'migration_opening_balance' then amount_poisha = 0
    end
  )
);

comment on table public.billing_ledger is
  'MASTERPLAN.md §11.6–§11.7 — the prepaid balance, as the entries behind it rather '
  'than as a column. Append-only for everybody including service_role: a wrong entry '
  'is answered by a reversal or a correction, never by an UPDATE. Poisha, integers, '
  'and balance_before + amount_poisha = balance_after held by CHECK so a wrong total '
  'is always a wrong chain and can be found.';

comment on column public.billing_ledger.charge_date is
  'The Dhaka date this entry is about, which is not created_at: a day is charged after '
  'it has finished. Unique per centre for a daily_charge, which is what makes settling '
  'the same day twice impossible however many times the settlement runs.';

comment on column public.billing_ledger.metadata is
  'Anything the arithmetic does not read — days behind a grant, the promotion behind a '
  'bonus, the attempt behind a retry. Never a figure any screen or query adds up.';

-- ---------------------------------------------------------------------------
-- 3. Settling one day twice is impossible, and that is an index rather than a check.
--
-- `app.settle_billing` (step 22) will hold a per-centre advisory lock and charge whole
-- past days. The lock stops two concurrent runs; it does not stop a run today and
-- another run tomorrow both deciding the 11th is unpaid, which is what a bug in
-- `charged_through` looks like. This index is the fence under that: one `daily_charge`
-- per centre per day, decided by Postgres, with nothing to remember.
--
-- Partial, so the eleven other kinds are unaffected — a centre may perfectly well
-- recharge twice on one day, and two settlement retries for one date are the point of
-- retrying.
-- ---------------------------------------------------------------------------

create unique index billing_ledger_one_charge_per_day
  on public.billing_ledger (coaching_center_id, charge_date)
  where kind = 'daily_charge';

-- What the customer's history screen reads and what the chain walk follows. `created_at`
-- and then `id` so the order is total: two entries written in the same transaction — a
-- recharge and its bonus — share a timestamp, and a walk that cannot decide which came
-- first cannot check the chain.
create index billing_ledger_center_idx
  on public.billing_ledger (coaching_center_id, created_at desc, id);

-- The founder panel's reconciliation, and the settle path's "what has this centre been
-- charged for".
create index billing_ledger_charge_idx
  on public.billing_ledger (coaching_center_id, charge_date desc)
  where kind = 'daily_charge';

-- ---------------------------------------------------------------------------
-- 4. The balance is arithmetic over this table, computed at write time.
--
-- The trigger reads `sum(amount_poisha)` for the centre and sets both balance columns
-- from it. Not from `coaching_centers.balance_poisha`, which is the cache this same
-- trigger maintains: reading the cache would make the cache authoritative, and a cache
-- that is authoritative is not a cache, it is an unaudited copy that can drift and take
-- the ledger's word for it. Reading the entries means the column can be recomputed from
-- scratch at any time and always agree — §11.13's first reconciliation query is then a
-- belt-and-braces check rather than the only thing between us and a wrong number.
--
-- THE LOCK IS THE SAME ONE, IN THE SAME NAMESPACE. `app.assign_receipt_no` and
-- `app.guard_student_capacity` both take `pg_advisory_xact_lock(hashtext('<what>'),
-- hashtext(centre))`, held to commit. Two entries for one centre arriving together
-- would otherwise both read the same sum and both claim the same `balance_before`, and
-- the second's `balance_after` would quietly overwrite the first's money. A hashtext
-- collision between two centres costs one of them a few milliseconds, which is the
-- trade the receipt series has been making since migration 17.
--
-- VOLATILE, WHICH IS NOT AN OVERSIGHT. A trigger function is volatile by default and it
-- has to be: a STABLE function reads the calling statement's snapshot, so a multi-row
-- insert would have every row read the balance as it was before the statement began and
-- every row would claim the same `balance_before`. That is the same trap
-- 20260811000036 documents at length for `app.active_students`, in a place where the
-- consequence is money rather than a place count.
--
-- SECURITY DEFINER, for one narrow reason: section 5's guard refuses writes to
-- `coaching_centers.balance_poisha` from anybody but the server, and `current_user`
-- inside a definer function is its owner. Without it, the day a ledger entry is ever
-- written by something other than service_role — a support script signed in as a
-- person, a future settlement path — the insert would succeed and the cache update
-- behind it would raise 42501, leaving the entry written and the column stale. Same
-- choice `app.refresh_paid_through` makes, for the same reason.
-- ---------------------------------------------------------------------------

create or replace function app.ledger_open_balance()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  running bigint;
begin
  -- The two balance columns are the ledger's own arithmetic and not a claim any caller
  -- may make. Refused rather than overwritten: a caller that supplied a figure believed
  -- something, and silently replacing it leaves that belief unexamined somewhere in the
  -- code that wrote it.
  if new.balance_before is not null or new.balance_after is not null then
    raise exception
      'balance_before and balance_after are computed from the ledger and cannot be '
      'supplied by %', current_user
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('billing_ledger.balance'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  -- `coalesce` and `greatest` are unqualified throughout this file, unlike every real
  -- function call: they are SQL syntax the parser resolves, not entries in pg_catalog,
  -- so `pg_catalog.coalesce` is an error rather than a precaution. The empty
  -- search_path does not reach them.
  select coalesce(pg_catalog.sum(l.amount_poisha), 0)
    into running
    from public.billing_ledger l
   where l.coaching_center_id = new.coaching_center_id;

  new.balance_before := running;
  new.balance_after := running + new.amount_poisha;

  return new;
end;
$$;

comment on function app.ledger_open_balance() is
  'BEFORE INSERT on public.billing_ledger: fills balance_before and balance_after from '
  'sum(amount_poisha) for the centre, under a per-centre advisory lock held to commit. '
  'Refuses an insert that tries to supply either.';

-- ---------------------------------------------------------------------------
-- The cache, and the one column that accumulates rather than recomputing.
--
-- `balance_poisha` is recomputed from the row just written, which by section 4 is the
-- sum of every entry — so it cannot drift, and 20260811000059's "recompute, never
-- accumulate" rule is satisfied.
--
-- `charged_through` IS DIFFERENT, AND DELIBERATELY. It is `greatest(what it was,
-- max(charge_date))` rather than a plain recompute, because this migration seeds it to
-- today for every existing centre so that nobody is charged for a past they were on the
-- old model for (§11.14). A plain `max(charge_date)` would wipe that the moment the
-- first charge landed, and step 22 charges from `charged_through + 1` — so the recompute
-- would hand every centre a bill for every day since they signed up. It never moves
-- backwards for the same reason: backwards means charging a day twice.
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
           when new.kind = 'daily_charge'
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
  'daily charge. charged_through only ever moves forward — backwards would mean '
  'charging a day that has already been paid for.';

create trigger billing_ledger_open_balance
  before insert on public.billing_ledger
  for each row execute function app.ledger_open_balance();

create trigger billing_ledger_apply_to_center
  after insert on public.billing_ledger
  for each row execute function app.ledger_apply_to_center();

-- ---------------------------------------------------------------------------
-- 5. Nothing may be rewritten and nothing may be removed.
--
-- STRICTER THAN `payments`, ON PURPOSE. 20260811000025 lets `service_role` change a
-- payment's amount, because that table is a founder typing what arrived at a bank and a
-- typo has to be answerable. This table is not typed by anybody: every row is written by
-- our own code out of arithmetic, so there is no class of mistake that an UPDATE fixes
-- and cannot be expressed as a compensating entry. Allowing one would only create the
-- one failure mode the whole design exists to prevent — a balance that was edited, with
-- the edit invisible in the history the customer reads.
--
-- `postgres` AND `supabase_admin` ARE EXEMPT, and that is not a loophole left open by
-- accident. Those are migrations and the Supabase SQL editor: a future migration that
-- has to add a column and backfill it needs to be able to, and a support case that has
-- corrupted a chain has to be repairable by a human with a written reason. `service_role`
-- is absent from that list precisely because it is the key every Server Action holds —
-- exempting it would leave the fence guarding only the caller nobody uses, which is the
-- mistake 20260811000075 names.
--
-- THE TRIGGER IS THE FENCE, NOT THE REVOKE. Section 6 revokes the grants too, and it
-- should, but a REVOKE only removes grants the revoking role made — so one pasted
-- `grant all on all tables in schema public to authenticated` reopens it with no error
-- anywhere. A trigger cannot be granted away. 20260811000004 and 20260811000025 both
-- make this argument at length and it applies here with more force than on either.
--
-- SECURITY INVOKER (stated by omission, as everywhere in this schema). Inside a definer
-- function `current_user` would be the owner and the check below would pass for every
-- caller — the same trap `app.guard_center_billing` documents.
-- ---------------------------------------------------------------------------

create or replace function app.guard_ledger_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'a billing ledger entry is a record of money and cannot be deleted by %; '
      'write a reversal instead', current_user
      using errcode = '42501';
  end if;

  raise exception
    'a billing ledger entry cannot be rewritten by %; write a correction instead',
    current_user
    using errcode = '42501';
end;
$$;

comment on function app.guard_ledger_immutable() is
  'BEFORE UPDATE OR DELETE on public.billing_ledger: refuses both, for every role '
  'except migrations and the SQL editor. A wrong entry is answered by a reversal or a '
  'correction — a new row, dated when the mistake was found, by somebody named.';

create trigger billing_ledger_immutable
  before update or delete on public.billing_ledger
  for each row execute function app.guard_ledger_immutable();

revoke all on function app.ledger_open_balance() from public, anon, authenticated;
revoke all on function app.ledger_apply_to_center() from public, anon, authenticated;
revoke all on function app.guard_ledger_immutable() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Who may read a balance, and who may write one.
--
-- Read: the owner, and the platform admin. The same policy `payment_intents` carries
-- and for the same reason — §2.4 keeps what the centre pays *us* out of a manager's
-- screens, and this is the whole of that story now.
--
-- NOT BRANCH-SCOPED, unlike the 26 tables 20260811000053 narrows. A balance belongs to
-- the organisation and not to a building: §3.6's licences pool, `app.is_owner` is
-- already an organisation-level question, and a branch manager cannot read this table at
-- all. There is nothing for a branch policy to narrow.
--
-- Write: nobody with a browser, held as an absent grant. This is §11.4 — no
-- client-supplied amount, no client-supplied balance — and it is the reason a recharge
-- has to travel through a founder's approval rather than through a form.
-- ---------------------------------------------------------------------------

alter table public.billing_ledger enable row level security;

create policy billing_ledger_owner_read on public.billing_ledger
  for select to authenticated
  using (app.is_owner(coaching_center_id) or app.is_platform_admin());

revoke insert, update, delete, truncate on public.billing_ledger from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 7. The two columns on the centre, and the guard that covers them.
--
-- `balance_poisha` is `not null default 0`, because "no entries yet" and "a balance of
-- nothing" are the same fact here and a nullable money column invites a `?? 0` at every
-- read site. `charged_through` is nullable and section 8 fills it for every centre that
-- exists — null after that means a centre created between this migration and step 22,
-- which step 22 has to handle rather than guess at.
--
-- BOTH GO ON `app.guard_center_billing`'s LIST. The whitelist grant in 20260811000004
-- already means a browser cannot name them: `grant update (name, phone, address,
-- bd_area, timezone)` is the only UPDATE `authenticated` holds, and these two are not on
-- it. The trigger is the belt to that braces, and 20260811000059 gives the argument in
-- full for `paid_through` — a browser that could set its own balance to ৳90,000 would
-- buy itself a year of the product without a taka changing hands, and it would read less
-- like tampering in a log than editing `status` does. The function is restated whole
-- because `create or replace` takes the whole body; everything else in it is unchanged.
-- ---------------------------------------------------------------------------

-- `charged_through` defaults to today rather than to null, and that default is the whole
-- answer for every centre created from here on. A null would mean step 22 had to invent
-- a starting line for a centre that signed up last Tuesday, and "invent a date money is
-- charged from" is not a decision to leave to a function running at 3am. Section 8
-- backfills the centres that already exist; this covers the rest, for ever, with nothing
-- to remember. Dhaka and never `current_date`, which is UTC here and so is yesterday for
-- the six hours that matter most.
alter table public.coaching_centers
  add column balance_poisha bigint not null default 0,
  add column charged_through date not null
    default (pg_catalog.now() at time zone 'Asia/Dhaka')::date;

comment on column public.coaching_centers.balance_poisha is
  'The prepaid balance in poisha, maintained by app.ledger_apply_to_center from '
  'sum(billing_ledger.amount_poisha). A cache of the entries and never the authority: '
  'MASTERPLAN.md §11.13''s first reconciliation query compares the two, and the '
  'ledger wins. Unwritable from a browser by 20260811000004''s column grants and by '
  'app.guard_center_billing.';

comment on column public.coaching_centers.charged_through is
  'The last Dhaka date this centre has been charged for. app.settle_billing charges '
  'from the day after this one, so it only ever moves forward — backwards would charge '
  'a day twice. Seeded to today or later for every centre that existed when the ledger '
  'was introduced, so nobody is billed for a past spent on the old model (§11.14).';

create or replace function app.guard_center_billing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.plan is distinct from old.plan
     or new.status is distinct from old.status
     or new.sms_credit_balance is distinct from old.sms_credit_balance
     or new.student_capacity is distinct from old.student_capacity
     or new.trial_plan is distinct from old.trial_plan
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.paid_through is distinct from old.paid_through
     or new.balance_poisha is distinct from old.balance_poisha
     or new.charged_through is distinct from old.charged_through
  then
    -- The server, and only the server. `service_role` is our admin client;
    -- `postgres`/`supabase_admin` are migrations, the Supabase SQL editor, and the
    -- definer functions above. A browser session is neither.
    if current_user not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception
        'plan, status, credits, capacity, trial, coverage and balance are set by the server after payment, not by %',
        current_user
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Every centre gets a first row and a starting line.
--
-- ONE OPENING ENTRY PER CENTRE, OF ZERO. It buys nothing and it is not decoration:
-- §11.13's chain walk starts at a centre's first entry and checks that its
-- `balance_before` is zero, and a centre whose first ever entry is a ৳5,000 recharge is
-- indistinguishable from a centre whose real first entry was deleted. An explicit
-- opening row means every centre's history begins at a stated zero, and any balance
-- that appears without one is a balance that came from nowhere.
--
-- Inserted through the trigger rather than with the balance columns written directly,
-- so the arithmetic that will run for every real entry is exercised once, here, on
-- every centre in the database — including the live customer — while nothing reads the
-- answer. If section 4 is wrong, this migration is where it shows.
--
-- `CHARGED_THROUGH` IS TODAY, OR LATER. `greatest(coalesce(paid_through, today), today)`
-- and both halves earn their place. `coalesce` because a centre with no payment row has
-- a null `paid_through` — the first real customer is exactly that, since the money
-- arrived before the code that records receipts did — and null must not become 1970,
-- which would have step 22 charge them for every day since. `greatest(..., today)`
-- because a centre whose coverage lapsed last month must not be charged for the lapse
-- either: they were read-only or they were not, that argument is over, and the prepaid
-- model starts today for everybody. A centre that has *paid* past today keeps its date,
-- so the days they are owed are days they are not charged for — the honest direction to
-- round in, and cheap: at most a month of one customer.
--
-- Asia/Dhaka and never `current_date`, which is UTC on this platform and so is the day
-- before for the six hours that matter most (§11.6).
-- ---------------------------------------------------------------------------

insert into public.billing_ledger (coaching_center_id, kind, amount_poisha, description)
select c.id,
       'migration_opening_balance',
       0,
       'Prepaid balance opened. Nothing was charged for any day before this.'
  from public.coaching_centers c;

-- The column default already put today on every existing row; this is the `paid_through`
-- half. `greatest` against the column rather than against a second `now()` call so the
-- two halves cannot disagree by a midnight.
update public.coaching_centers c
   set charged_through = greatest(coalesce(c.paid_through, c.charged_through), c.charged_through)
 where c.paid_through is not null
   and c.paid_through > c.charged_through;

-- ---------------------------------------------------------------------------
-- 9. And every centre created from here on gets the same first row.
--
-- The backfill above is a one-off over rows that already existed, and on its own it makes
-- the opening entry a property of *when a centre signed up* rather than a property of
-- every centre — which is the shape of invariant that holds for a year and then quietly
-- does not. §11.13's chain walk starts at a centre's first entry and checks it opens at
-- zero, and it cannot tell "this centre's first entry is a ৳5,000 recharge because it is
-- new" from "because the row before it went missing".
--
-- SECURITY DEFINER because the browser session that founds a centre holds no INSERT on
-- `billing_ledger` — deliberately, that is section 6 — and this has to write one anyway.
-- Empty search_path, as every definer function in this schema does.
-- ---------------------------------------------------------------------------

create or replace function app.open_center_balance()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.billing_ledger (coaching_center_id, kind, amount_poisha, description)
  values (new.id, 'migration_opening_balance', 0,
          'Prepaid balance opened. Nothing was charged for any day before this.');

  return null;
end;
$$;

comment on function app.open_center_balance() is
  'AFTER INSERT on public.coaching_centers: writes the opening zero entry, so every '
  'centre''s history begins at a stated nought and a balance that appears without one '
  'is a balance that came from nowhere.';

create trigger coaching_centers_open_balance
  after insert on public.coaching_centers
  for each row execute function app.open_center_balance();

revoke all on function app.open_center_balance() from public, anon, authenticated;
