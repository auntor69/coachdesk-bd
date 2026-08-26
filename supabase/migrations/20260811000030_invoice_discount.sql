-- CoachDesk BD — an owner can write down a fee they waived, instead of billing a
-- number that was never the fee.
--
-- THE HOLE THIS CLOSES HAS BEEN OPEN SINCE MIGRATION 1, and it is the same shape as
-- the one 20260811000028 closed. `fee_invoices.discount_bdt` has existed from the
-- first schema, with both its bounds as table checks. The balances view computes
-- `net_bdt` from it. The fee board renders "(৳২০০ ছাড়)" under a student's name. The
-- CSV export has a column for it. lib/fees/month-close.ts nets it out of the month's
-- billed figure. The receipt page fetches it.
--
-- Nothing in the product can set it. `generateInvoices` is an insert-what-is-missing
-- upsert, and 20260811000028 then revoked UPDATE on this table down to two columns,
-- neither of them this one — with a line in its own header saying what would have to
-- happen next: "Widening this later is a deliberate act. A discount screen adds
-- `discount_bdt` here, in a migration, with a sentence saying why." This is that
-- migration, and the sentence is below.
--
-- WHY A WAIVER IS NOT AN EDGE CASE HERE. A coaching centre in Bangladesh discounts
-- constantly and for reasons it is proud of: the second child of a family already
-- paying, a student the owner decided to carry through a bad year, a topper kept on
-- half fee because the board results are the centre's advertising. Ask an owner for
-- their outstanding book and the waivers are pencilled in the margin.
--
-- WHAT AN OWNER DOES TODAY INSTEAD, since the product gives them nowhere to put it.
-- Either they raise the bill at the discounted figure — and then `amount_bdt` is not
-- the fee, the register no longer shows what the centre charges, and next month's
-- generator quietly bills the full amount again with nobody remembering why last
-- month was different — or they record a payment the family never made. The second is
-- worse than untidy: a fee payment is undeletable (20260811000017) and, since
-- 20260811000029, cannot even be netted back out beyond what really came in. A ৳500
-- phantom payment is permanent, it lands in the day's takings, and it makes the
-- drawer stop reconciling. The product should not be pushing an owner toward that.
--
-- WHY THE ARITHMETIC BOUND IS NOT RESTATED IN THE TRIGGER BELOW. Migration 1 already
-- carries `check (discount_bdt >= 0)` and `constraint fee_invoices_discount_bound
-- check (discount_bdt <= amount_bdt)`, which is exactly the rule — a waiver is not
-- negative, and a waiver larger than the bill would make the centre owe the family
-- money for attending. Writing it a second time here would be two answers to one
-- question, which is the thing docs §4 forbids. The screen's own message is friendlier
-- than a constraint name; the constraint is what holds when the screen is bypassed.
--
-- WHAT IS NOT BOUNDED, deliberately: a waiver granted after the family already paid.
-- ৳2,000 paid in full, then ৳500 waived, leaves the bill at ৳1,500 net with ৳2,000 on
-- it — the family is ৳500 in credit, which is true and is what the board should say.
-- The refund path added in 20260811000029 is how that credit goes home. Refusing this
-- would refuse the most sympathetic case there is: an owner who took the money, then
-- heard what the year had been like.

-- ---------------------------------------------------------------------------
-- 1. Why, who, and when.
--
-- All three nullable, for the reason the void columns are: every existing row
-- predates them, and a waiver typed into the SQL editor during a support call has no
-- auth.uid() to record.
--
-- `discount_reason` is on the invoice rather than in a log, and the argument is the
-- one 20260811000028 made for `void_reason` word for word: it is read in one place
-- and by one person — the owner, on the board, months later, working out why this
-- family's bill is smaller than that family's. An audit table would answer a question
-- nobody in a coaching centre asks. It matters more here than for a cancellation,
-- because a cancelled bill leaves the board and a discounted one stays on it,
-- unexplained, for as long as the centre exists.
--
-- `discounted_by` is never named by the browser — the trigger in step 4 stamps it —
-- so it cannot be a claim, only a record. `discounted_at` is stamped for the same
-- reason `voided_at` is: a client-supplied date could put a waiver into a month the
-- owner has already closed and shown somebody.
-- ---------------------------------------------------------------------------

alter table public.fee_invoices
  add column if not exists discount_reason text;

alter table public.fee_invoices
  add column if not exists discounted_by uuid references auth.users (id) on delete set null;

alter table public.fee_invoices
  add column if not exists discounted_at timestamptz;

comment on column public.fee_invoices.discount_bdt is
  'What the centre waived on this bill, in taka. Bounded to the bill itself by '
  'fee_invoices_discount_bound, so net_bdt can never go negative. Zero means no '
  'waiver, and setting it back to zero clears the three columns beside it — the '
  'reason, who granted it and when — so they never describe a bill at full price.';

comment on column public.fee_invoices.discount_reason is
  'Why the fee was waived, in the owner''s own words, up to 200 characters. Optional '
  'for the reason void_reason is: a required field here would be answered with a full '
  'stop. It is the one thing that survives the owner forgetting, which is why the '
  'screen asks for it even though the column does not insist.';

comment on column public.fee_invoices.discounted_by is
  'The staff admin who granted the waiver, from auth.uid() at the moment of the '
  'update. Null on one granted outside a browser session.';

comment on column public.fee_invoices.discounted_at is
  'When the waiver was granted, stamped by app.guard_invoice_void() rather than taken '
  'from the client. Not the same as the bill''s own month: a fee waived in September '
  'against a July bill changes what July was worth, and this column is the only thing '
  'that says so afterwards.';

-- ---------------------------------------------------------------------------
-- 2. The balances view gains the reason, and nothing else changes.
--
-- A passenger, exactly like void_reason ahead of it: the view computes nothing from
-- it. It is carried so the board can draw a discounted row with its reason on it
-- without a second round trip on a 3G phone.
--
-- `discounted_by` and `discounted_at` are deliberately NOT carried, for the reason
-- 20260811000028 gave for `voided_by`: the only useful rendering of a uuid is a name,
-- which would mean joining auth.users, and this schema never exposes that table to a
-- view. The date is not on the board because the board is about money owed now.
--
-- Restated in full because Postgres has no "add a column to a view", and the new
-- column goes last because `create or replace view` may only append: every existing
-- column must keep its name, its type and its position. Composed from
-- 20260811000028's body with one line added.
--
-- security_invoker is restated rather than trusted to survive the replace. It is the
-- difference between a view and a data breach, and check-migrations.mjs fails the
-- build without it.
-- ---------------------------------------------------------------------------

create or replace view fee_invoice_balances with (security_invoker = true) as
select
  i.id,
  i.coaching_center_id,
  i.student_id,
  i.enrollment_id,
  i.period_month,
  i.due_date,
  i.amount_bdt,
  i.discount_bdt,
  -- What the family actually owes, after any discount the centre granted.
  (i.amount_bdt - i.discount_bdt) as net_bdt,
  coalesce(p.paid_bdt, 0) as paid_bdt,
  (i.amount_bdt - i.discount_bdt) - coalesce(p.paid_bdt, 0) as remaining_bdt,
  i.note,
  i.voided_at,
  s.name as student_name,
  s.student_code,
  s.guardian_phone,
  s.sms_opt_out,
  s.preferred_channel,
  i.void_reason,
  i.discount_reason
from fee_invoices i
-- The tenant column travels with this join for the same reason 20260811000005
-- put it in every foreign key: a join on id alone would be a sideways reference.
join students s
  on s.id = i.student_id
 and s.coaching_center_id = i.coaching_center_id
left join (
  -- Refunds are stored as negative payments (fee_payments allows any non-zero
  -- amount), so summing is all that is needed to net them off. A refund is not
  -- a deletion: the original payment stays on the record, and the board shows
  -- the family owing money again.
  select invoice_id, coaching_center_id, sum(amount_bdt) as paid_bdt
  from fee_payments
  group by invoice_id, coaching_center_id
) p
  on p.invoice_id = i.id
 and p.coaching_center_id = i.coaching_center_id;

-- ---------------------------------------------------------------------------
-- 3. The fence widens by two columns, and no others.
--
-- 20260811000028 narrowed UPDATE on this table to (voided_at, void_reason). The whole
-- grant is restated rather than added to, because `grant update (a)` after
-- `grant update (b)` leaves privileges on both and a reader of one line would not
-- know it. Four columns is now the complete list of what a browser session may write
-- on a bill that has already been raised.
--
-- `discounted_by` and `discounted_at` are NOT in the grant, exactly as `voided_by` is
-- not: the trigger stamps them, so a browser cannot name the person who granted a
-- waiver even to name themselves, and cannot date one into a closed month.
--
-- INSERT stays untouched. `generateInvoices` raises the month's bills with
-- ON CONFLICT DO NOTHING, which needs no UPDATE privilege at all — which is also why
-- a waiver cannot be granted at the moment of billing, and has to be a second act on
-- a bill that exists. That is the right shape anyway: the fee is what the centre
-- charges, and the waiver is a decision about one family taken separately from it.
-- ---------------------------------------------------------------------------

revoke update, delete, truncate on public.fee_invoices from authenticated;

grant update (voided_at, void_reason, discount_bdt, discount_reason)
  on public.fee_invoices to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The guard, which now has two jobs.
--
-- Same function, same SECURITY INVOKER, same reasoning as 20260811000028 — restated
-- whole because Postgres has no way to amend a function body. Three things changed:
--
-- `discount_bdt` and `discount_reason` leave the frozen list. Everything else about a
-- raised bill is still what the month's reports are made of, and still cannot move.
--
-- A CANCELLED BILL'S WAIVER CANNOT CHANGE, which the table checks cannot express and
-- so is here. A cancelled bill is excluded from the balances entirely; a waiver
-- granted on one is a decision about a number that is in no total on any screen, so
-- the only thing it can do is confuse the person who reads it later. The restore path
-- is how a cancelled bill comes back, and it can be discounted once it has.
--
-- THE THREE COLUMNS BESIDE THE FIGURE ARE STAMPED AND NORMALISED, in the same shape
-- the void columns already are. A change to `discount_bdt` stamps who and when. A
-- waiver set back to zero clears the reason, the person and the date, because a bill
-- at full price that still says "second child, half fee" is worse than one that says
-- nothing. Editing only the wording of an existing reason does not re-stamp: the
-- waiver was granted when it was granted, and a corrected typo is not a new decision.
-- ---------------------------------------------------------------------------

create or replace function app.guard_invoice_void()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  server_role boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
  on_it numeric;
begin
  if tg_op = 'DELETE' then
    if not server_role then
      raise exception
        'a fee invoice is a bill that was issued and cannot be deleted by %; '
        'cancel it instead, which keeps it off every total and out of every chase',
        current_user
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- The cancellation and the waiver, and nothing else. Everything else about a bill
  -- is what the month's reports are made of.
  if not server_role
     and (new.id is distinct from old.id
          or new.coaching_center_id is distinct from old.coaching_center_id
          or new.student_id is distinct from old.student_id
          or new.enrollment_id is distinct from old.enrollment_id
          or new.period_month is distinct from old.period_month
          or new.amount_bdt is distinct from old.amount_bdt
          or new.due_date is distinct from old.due_date
          or new.note is distinct from old.note
          or new.created_at is distinct from old.created_at)
  then
    raise exception
      'a fee invoice says what was billed and cannot be rewritten by %; '
      'cancel it and raise the right one', current_user
      using errcode = '42501';
  end if;

  -- Stamped, not accepted. A client-supplied voided_at could be backdated into a
  -- month the owner has already closed and been shown, and a client-supplied
  -- voided_by would be a claim about who did it rather than a record of it.
  if new.voided_at is not null and old.voided_at is null then
    if not server_role then
      new.voided_at := now();
      new.voided_by := auth.uid();
    end if;

    -- Money on the bill, netted. A payment handed back in full leaves nothing here
    -- and the bill may be cancelled; a bill somebody has actually paid may not,
    -- because a cancelled bill is excluded from the balances entirely and the
    -- family's payment would vanish from their own record while staying in the
    -- centre's takings. Refund it first — a negative payment, which is how this
    -- schema has always spelled a refund — and then this passes.
    select coalesce(sum(p.amount_bdt), 0) into on_it
    from public.fee_payments p
    where p.invoice_id = new.id;

    if on_it <> 0 then
      raise exception
        'invoice % has %৳ received against it and cannot be cancelled; '
        'refund it as a negative payment first', new.id, on_it
        using errcode = '42501';
    end if;
  end if;

  -- A live bill carries no cancellation. Normalised rather than refused: this is the
  -- restore path, and clearing the two columns beside voided_at is the whole of it.
  if new.voided_at is null then
    new.voided_by := null;
    new.void_reason := null;
  end if;

  -- A bill that is off every total is not a bill anybody should be waiving a fee on.
  -- Refused rather than normalised, because unlike the void columns there is no
  -- reading of it that is merely tidy: the owner meant to do something, and doing
  -- nothing quietly would leave them believing they had.
  --
  -- The server role is exempt, unlike in 20260811000029. That guard refuses arithmetic
  -- that is never right; this one refuses a screen letting an owner do something
  -- pointless, and a support case straightening out a centre's books may well need to
  -- correct the waiver on a bill that was cancelled afterwards.
  if new.discount_bdt is distinct from old.discount_bdt
     and not server_role
     and coalesce(new.voided_at, old.voided_at) is not null
  then
    raise exception
      'invoice % is cancelled, so waiving a fee on it changes no total anybody sees; '
      'restore it first', new.id
      using errcode = '42501';
  end if;

  if new.discount_bdt is distinct from old.discount_bdt and not server_role then
    new.discounted_at := now();
    new.discounted_by := auth.uid();
  end if;

  -- No waiver, nothing beside it. The mirror of the voided_at branch above, and the
  -- reason is the same: these columns exist to explain a figure, and once the figure
  -- is gone they can only misdescribe the bill.
  if new.discount_bdt = 0 then
    new.discount_reason := null;
    new.discounted_by := null;
    new.discounted_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists fee_invoices_guard_void on public.fee_invoices;

create trigger fee_invoices_guard_void
  before update or delete on public.fee_invoices
  for each row execute function app.guard_invoice_void();

-- Per the convention in 20260811000010. This one is in `app`, which PostgREST does
-- not expose, and it returns `trigger`, which PostgREST would refuse anyway — and a
-- trigger does not consult EXECUTE when it fires. Revoked regardless, for the reason
-- the other guards were: a function nobody should ever call by name should not be
-- callable by name.
revoke all on function app.guard_invoice_void() from anon, authenticated, public;

comment on function app.guard_invoice_void() is
  'Belt and braces over the column grant on fee_invoices. Refuses a DELETE, refuses '
  'any rewrite of what was billed, refuses cancelling a bill that holds money, '
  'refuses waiving a fee on a cancelled bill, and stamps who cancelled or discounted '
  'it and when rather than taking either from the client.';
