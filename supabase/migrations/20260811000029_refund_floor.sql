-- ---------------------------------------------------------------------------
-- The floor under a refund: a bill cannot hand back more than it took in.
--
-- WHAT THIS IS FOR. 20260811000028 refuses to cancel a bill that has money on it and
-- tells the owner to refund it first. This is that refund, and in this schema it has
-- always been expressible: `fee_payments.amount_bdt` is `check (amount_bdt <> 0)`, so
-- a negative row is legal, and every total in the product nets rather than counts. So
-- nothing new is being permitted here. What is being added is the one bound that was
-- missing.
--
-- THE BOUND. Per invoice, the sum of every payment must stay at or above zero. Below
-- it, the centre has handed back money it never received: the family shows as owing
-- more than they were billed, `paid_bdt` goes negative on a screen that offers no
-- explanation for it, the month's collected figure is short by an amount that
-- corresponds to nothing, and the invoice becomes uncancellable for a reason the owner
-- cannot act on (void.ts refuses a non-zero balance in either direction).
--
-- WHY IT HAS TO BE HERE AND NOT ONLY IN THE FORM. A fee payment cannot be deleted by
-- anybody and cannot be rewritten even by the migration role (20260811000017). A
-- refund of ৳5,000 typed into a bill that took ৳500 is therefore permanent the instant
-- it commits, and the only correction is a third row that reads, forever, as if the
-- family paid ৳4,500 they never paid. There is no screen that can be built later to
-- fix that. It has to not land.
--
-- WHAT IS DELIBERATELY NOT BOUNDED. An overpayment is untouched: a parent who hands
-- over ৳2,500 on a ৳2,000 bill leaves ৳500 in credit, which the board shows at the
-- child's name and which this floor is above, not below. Refunding that credit is the
-- ordinary case and passes. Nor is a refund bounded by the number of payments or by
-- which one it points at — it is money out of a drawer against a bill, and the netted
-- total is the only thing that has to make sense.
--
-- NO SERVER-ROLE EXEMPTION, unlike every other guard in this schema. The others refuse
-- an edit that a support case or a later migration might legitimately need to make;
-- this one refuses arithmetic that is never right, and a migration that needed it
-- would be a migration with a bug. Dropping the trigger is still a deliberate act
-- available to whoever needs it, and it is a more honest one than an exemption nobody
-- reads.
-- ---------------------------------------------------------------------------

create or replace function app.guard_payment_floor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  netted numeric;
begin
  -- Positive payments cannot break the floor and are the hot path — a desk with a
  -- queue at it — so they leave without a second query. The lock below matters for
  -- the same reason.
  if new.amount_bdt >= 0 then
    return new;
  end if;

  -- Two refunds on one bill in the same second would each see a total without the
  -- other's row and both pass, landing a pair that breaks the floor together. The
  -- lock is transaction-scoped and released at commit or rollback, so the second
  -- waits a few milliseconds and reads the first.
  --
  -- Two keys, so the namespace is ours, exactly as in 20260811000017: a constant from
  -- this rule's name, then the invoice. Per invoice rather than per centre because
  -- that is the grain the sum is taken at, and a busy centre taking cash at the desk
  -- must not queue behind a refund on somebody else's bill.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('fee_payments.floor'),
    pg_catalog.hashtext(new.invoice_id::text)
  );

  -- AFTER INSERT, so the row being judged is already in the sum and there is nothing
  -- to add by hand. SECURITY INVOKER (stated by omission, as everywhere in this
  -- schema): the sum is filtered by the caller's own RLS, and that is the safe
  -- direction for the reason 20260811000028 spells out at length — only a staff admin
  -- may write this table, a staff admin reads every payment in their own centre, so
  -- the filtered sum is the true sum. A narrower future writer would see a shorter
  -- list, and a shorter list can only make this stricter.
  select pg_catalog.sum(p.amount_bdt)
    into netted
  from public.fee_payments p
  where p.invoice_id = new.invoice_id;

  if netted < 0 then
    raise exception
      'a refund of %৳ would leave invoice % holding %৳, which is more than it '
      'received; refund only what came in', - new.amount_bdt, new.invoice_id, netted
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists fee_payments_guard_floor on public.fee_payments;

-- AFTER, not BEFORE. A BEFORE trigger would have to add the pending row to the sum
-- itself, which is the same arithmetic written twice — once here and once in whatever
-- future path inserts two refunds in one statement. AFTER sees the table as it will
-- be, and a raise still rolls the statement back.
create trigger fee_payments_guard_floor
  after insert on public.fee_payments
  for each row execute function app.guard_payment_floor();

-- Per the convention in 20260811000010: a function nobody should call by name should
-- not be callable by name. In `app`, which PostgREST does not expose, and returning
-- `trigger`, which PostgREST would refuse anyway — and a trigger does not consult
-- EXECUTE when it fires.
revoke all on function app.guard_payment_floor() from anon, authenticated, public;

comment on function app.guard_payment_floor() is
  'Refuses a negative fee_payments row that would take an invoice''s netted total '
  'below zero. Mirrors refundVerdict in src/lib/fees/refund.ts, which the refund box '
  'and the Server Action read; this is the copy that cannot be talked out of it. No '
  'server-role exemption: a refund larger than the receipts is never correct, and a '
  'fee payment cannot be deleted afterwards by anybody.';
