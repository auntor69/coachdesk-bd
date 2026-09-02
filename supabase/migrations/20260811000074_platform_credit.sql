-- ---------------------------------------------------------------------------
-- A platform payment can go the other way, so a credit has a row to live on.
--
-- MASTERPLAN.md §3.8 says a wrong figure is corrected by a counter-entry, and
-- 20260811000024 wrote that promise into the table comment on `payments` — while the
-- column's own `check (amount_bdt > 0)`, carried since 20260811000001, made it
-- impossible. §15 records the consequence twice over: a fee payment can be refunded
-- from the register and a *platform* payment cannot, and a move down a tier or a move
-- taken mid-way through paid coverage stays a phone call, because both owe the customer
-- money and no positive row can carry it.
--
-- WHAT A CREDIT IS. Money we owe back, on the row that says what we have been paid.
-- `sum(amount_bdt)` per centre is therefore net of credits, which is the honest answer
-- to "what has this customer actually given us" and the figure the founder panel
-- already draws. A credit handed back over bKash and a credit taken off the next
-- purchase are the same two rows in this table: the negative one now, and the next
-- purchase recorded at its full price when it comes. Nothing has to remember an unspent
-- balance, because the balance is the sum.
--
-- COVERAGE IS BOUGHT BY MONEY COMING IN, and section 2 is what makes that structural
-- rather than a habit. `paid_through` is `max(covers_period_end)` in two independent
-- places — app.refresh_paid_through and platform_centers() — and `max()` cannot tell a
-- refund from a purchase. A -৳1 row dated to 2099 would hand a centre permanent full
-- access with no money in it, which is the same hole as writing `status` by hand and
-- looks less like tampering in a log. So a negative row carries no window at all, both
-- derivations keep the aggregate they already agree on, and which period a credit
-- relates to is a sentence in its note.
--
-- WHO CAN WRITE ONE. Nobody with a browser. 20260811000024 revoked INSERT on this table
-- from `authenticated` and `anon` outright, so a credit is service_role only, which
-- today means src/app/founder/actions.ts behind requirePlatformAdmin(). The customer
-- does not ask for a credit through the purchase flow and `payment_intents.amount_bdt`
-- stays `> 0`: an intent is a quote the server priced, and a quote for negative money
-- is not a thing this product sells.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The check that made §3.8 undeliverable.
--
-- Dropped by name and not `if exists`: the name is Postgres's own for an inline column
-- check on `create table` and nothing has altered it since migration 1, so a rename
-- that made this a no-op would leave `> 0` in place under a passing migration — a
-- negative row refused by a constraint this file believes it removed.
--
-- `<> 0` and not merely a widening, because a ৳0 receipt is not a payment and a ৳0
-- credit is not a credit. Same rule `fee_payments` has held since 20260811000001.
-- ---------------------------------------------------------------------------

alter table public.payments
  drop constraint payments_amount_bdt_check;

alter table public.payments
  add constraint payments_amount_nonzero check (amount_bdt <> 0);

comment on column public.payments.amount_bdt is
  'Taka. Positive is money the centre paid us; negative is a credit we owe back, which '
  'MASTERPLAN.md §3.8 makes the only correction this table permits. Never zero. '
  'sum(amount_bdt) per centre is net of credits, and that is the intended reading.';

-- ---------------------------------------------------------------------------
-- 2. What a credit may not carry.
--
-- The coverage window, for the reason in the header — this is the constraint standing
-- between a negative row and free access forever.
--
-- The intent, because `payments.intent_id` means "this receipt settled that purchase",
-- and a credit settles nothing. It is also what src/lib/billing/receipt.ts heads the
-- printable by and reads the purpose and the priced bands off, so a credit pointing at
-- a purchase would print as a sheet selling 180 places at ৳18 with a minus in front of
-- the total. Which purchase a credit answers goes in its note, where a reader can tell
-- it is prose.
--
-- And a note, which is required here and optional on everything else in this table. A
-- positive row explains itself — money arrived, over this window, by this method. A
-- negative one is a decision somebody made, and the decision is the whole content of
-- the row; unexplained, it is indistinguishable from a typo a year later, and this
-- table has no UPDATE path to annotate it after the fact.
-- ---------------------------------------------------------------------------

alter table public.payments
  add constraint payments_credit_no_coverage
    check (
      amount_bdt > 0
      or (covers_period_start is null and covers_period_end is null)
    );

alter table public.payments
  add constraint payments_credit_no_intent
    check (amount_bdt > 0 or intent_id is null);

alter table public.payments
  add constraint payments_credit_explained
    check (amount_bdt > 0 or pg_catalog.btrim(coalesce(note, '')) <> '');

-- ---------------------------------------------------------------------------
-- 3. A credit cannot exceed what the centre has paid.
--
-- 20260811000029's floor, on our own books instead of a parent's bill, and the same
-- argument for having it: this table revokes UPDATE and DELETE, so a ৳50,000 credit
-- typed against ৳1,999 of receipts is permanent the moment it commits, and the only
-- correction is a third row that reads forever as if the centre paid us money it never
-- paid. There is no screen that can be built later to fix that.
--
-- Per centre rather than per purchase, because that is the grain `sum(amount_bdt)` is
-- taken at everywhere it is read — the founder panel's `paid`, and any statement of
-- what a customer has given us.
--
-- NO SERVICE-ROLE EXEMPTION, as in 20260811000029: the other guards in this schema
-- refuse edits a support case might legitimately need, and this one refuses arithmetic
-- that is never right. service_role is in fact the *only* role that reaches this
-- trigger, which is exactly why it must not be exempt from it.
-- ---------------------------------------------------------------------------

create or replace function app.guard_platform_credit_floor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  netted numeric;
begin
  -- Every real purchase leaves without a second query. Credits are the rare row.
  if new.amount_bdt >= 0 then
    return new;
  end if;

  -- Two credits for one centre in the same instant would each read a total without the
  -- other and both pass, landing a pair that breaks the floor together. Transaction
  -- scoped, so the second waits and reads the first. Two keys, this rule's name then
  -- the centre, per the convention in 20260811000017.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('payments.credit_floor'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  -- AFTER INSERT, so the row being judged is already in the sum. SECURITY INVOKER by
  -- omission: the sum is filtered by the caller's own RLS, and 20260811000029's
  -- reasoning holds unchanged — a narrower future writer sees a shorter list, and a
  -- shorter list can only make this stricter.
  select pg_catalog.sum(y.amount_bdt)
    into netted
    from public.payments y
   where y.coaching_center_id = new.coaching_center_id;

  if netted < 0 then
    raise exception
      'a credit of %BDT would leave centre % having paid us %BDT; credit only what came in',
      - new.amount_bdt, new.coaching_center_id, netted
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists payments_guard_credit_floor on public.payments;

create trigger payments_guard_credit_floor
  after insert on public.payments
  for each row execute function app.guard_platform_credit_floor();

revoke all on function app.guard_platform_credit_floor() from anon, authenticated, public;

comment on function app.guard_platform_credit_floor() is
  'Refuses a negative payments row that would take a centre''s netted total below zero. '
  'The platform-side twin of app.guard_payment_floor, and deliberately without a '
  'service_role exemption: service_role is the only role that can write this table at '
  'all, so an exemption would be the whole rule.';

-- ---------------------------------------------------------------------------
-- 4. The table comment, which has described this mechanism since 20260811000024 and
--    until now described one the column check refused.
-- ---------------------------------------------------------------------------

comment on table public.payments is
  'Money a coaching centre paid us, and credits we owe back. Read-only from a browser '
  'session: SELECT is policy-gated to the centre''s own owners and platform admins, and '
  'the write grants are revoked, so a row can only be written by service_role — which '
  'today means src/app/founder/actions.ts behind requirePlatformAdmin(). Never edited '
  'and never deleted; a wrong figure is corrected by a negative counter-entry that keeps '
  'both facts, bounded by app.guard_platform_credit_floor and carrying no coverage '
  'window, because coverage is bought by money coming in.';
