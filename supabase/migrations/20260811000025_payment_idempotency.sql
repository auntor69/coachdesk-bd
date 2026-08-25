-- CoachDesk BD — one tap, one payment, however many times the request arrives.
--
-- THE BUG THIS CLOSES IS ALREADY LIVE. An owner on a Grameenphone connection in a
-- tin-roofed room taps "টাকা নিন". The insert reaches Postgres, the row is written,
-- the receipt number is assigned — and the response never makes it back. The button
-- unsticks with an error, or with nothing at all. The parent is still standing there.
-- So they tap it again, and now two rows say the family paid ৳1500 this month, the
-- register prints ৳3000 collected, and 20260811000017 has made both rows permanent:
-- a fee payment cannot be deleted, by anybody, from a browser session. The correction
-- is a negative counter-entry, which means the mistake is on the record forever and
-- the owner has to notice it first.
--
-- Nothing in the current code stops this. `recordPayment` inserts unconditionally,
-- and there is no column in `fee_payments` that says "these two rows are the same
-- tap". A double-click does it too, on any connection, and so does a browser's own
-- retry of a POST it thinks failed.
--
-- THE FIX IS THE ONE ALREADY IN THIS SCHEMA. 20260811000001 gave `sms_dispatches` a
-- `unique (coaching_center_id, kind, ref_id)` and said why in a comment: "so a
-- double-tap or a retried request can never double-bill the center." That works
-- because an SMS send has a natural key — this exam, once. A fee payment does not: a
-- parent settling two months in one visit is two legitimate payments against the same
-- invoice on the same day for the same amount, and no combination of the columns
-- already here can tell that apart from the same payment recorded twice.
--
-- So the browser supplies the key. One uuid minted per form, sent with the submit,
-- and unique per centre. A retry carries the same one and loses the race; a second
-- deliberate payment carries a fresh one and is written. The uniqueness is decided
-- here rather than in the action, because two requests a millisecond apart both pass
-- any "does one already exist" check the application could make.
--
-- WHAT MAKES A ROLLED-BACK INSERT FREE HERE. `app.assign_receipt_no` counts
-- max()+1 under an advisory lock held to commit rather than drawing from a sequence,
-- precisely so a failed insert burns no number (20260811000017, step 1). The losing
-- retry therefore leaves no gap in the receipt book — the next real payment takes the
-- number the retry had briefly computed.
--
-- WHERE THIS STOPS, AND THAT IS A DECISION. Both money tables get the column and
-- nothing else does. A retried "create subject" writes a second subject, and that is
-- a row the owner can see on the screen they are standing on and delete in one tap.
-- A retried payment is money, is invisible until the register is read, and is
-- undeletable by design. The other retry-unsafe writes in the app were checked
-- rather than assumed: attendance and marks are upserts on their natural key,
-- `generateInvoices` upserts with ignoreDuplicates, and every SMS send is gated on
-- the `sms_dispatches` insert above, so credits cannot double-debit either.

-- ---------------------------------------------------------------------------
-- 1. Money students pay the centre.
--
-- uuid rather than text, so a value that is not a uuid is refused by the type
-- instead of being stored and silently never matching anything. Nullable, and it
-- has to be: every row already in the table predates this column, the CSV import
-- path in 20260811000009 writes payments nobody tapped a button for, and a browser
-- with no crypto.randomUUID (a plain-HTTP LAN address in development is not a
-- secure context) sends nothing. A null key means this payment has no retry
-- protection, which is exactly what every payment had until this migration.
-- ---------------------------------------------------------------------------

alter table public.fee_payments
  add column if not exists idempotency_key uuid;

-- Partial, `where idempotency_key is not null`. Postgres treats nulls as distinct in
-- a unique index by default, so an unqualified index would already admit any number
-- of null keys — the clause is here to say that out loud and to keep the index to the
-- rows it can actually decide anything about.
--
-- Scoped by centre like every other uniqueness in this schema. Not for collision
-- avoidance (a v4 uuid does not need help) but for the boundary: a key is only ever
-- compared against keys in the caller's own centre, so nothing a browser sends can
-- reach across it, and the read-back the action does after a duplicate cannot return
-- another centre's receipt even if the index were somehow global.
create unique index if not exists fee_payments_center_idempotency_key
  on public.fee_payments (coaching_center_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.fee_payments.idempotency_key is
  'A uuid the browser mints once per payment form and sends with the submit. Unique '
  'per centre, so a retried or double-tapped request loses to the row already there '
  'and src/app/(app)/fees/actions.ts answers it with the receipt that was written '
  'the first time. Null on rows written before this existed, on imported rows, and '
  'on any submit from a browser that could not mint one — all of which means no '
  'retry protection, never a failed payment.';

-- ---------------------------------------------------------------------------
-- 2. Money the centre pays us.
--
-- The same column on the founder panel's table, because the same thing happens on
-- the same connections and the stakes are the founder's own books. `payments` is
-- written only by service_role (20260811000024 revoked the rest), so the key comes
-- from the founder's own browser through src/app/founder/actions.ts and the gate in
-- front of it is requirePlatformAdmin, exactly as for every other column on the row.
--
-- This one matters out of proportion to how often it is used: it is one desk and one
-- person, but the total it feeds is the single number the founder would look at to
-- decide whether this business works, and a receipt entered twice inflates it with
-- nothing on screen to suggest it.
-- ---------------------------------------------------------------------------

alter table public.payments
  add column if not exists idempotency_key uuid;

create unique index if not exists payments_center_idempotency_key
  on public.payments (coaching_center_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.payments.idempotency_key is
  'A uuid the founder panel mints once per payment form and sends with the submit. '
  'Unique per centre, so a retried or double-tapped request is answered with the '
  'receipt already written rather than inflating what we believe we have been paid. '
  'Null on rows written before this existed.';

-- ---------------------------------------------------------------------------
-- 3. The key cannot be rewritten, for the same reason the receipt number cannot.
--
-- A mutable identity is not an identity. If `idempotency_key` can be changed after
-- the fact then the retry it is supposed to absorb stops being absorbed — clear the
-- key and the next arrival of the same tap is written as a second payment — and a key
-- set on a row *before* the real submit arrives would have that submit answered with
-- a receipt for money that was never handed over.
--
-- 20260811000017 already revoked UPDATE on this table from `authenticated` and handed
-- back only `(reference, note)`, so a browser session cannot name this column today.
-- The trigger is here for the reason that migration gave at length and which applies
-- word for word: a REVOKE only removes grants the revoking role made, so the column
-- grant may not be the fence it looks like, and one pasted `grant all on all tables
-- in schema public to authenticated` undoes it with no error anywhere.
--
-- In the `not server_role` list rather than the unconditional one above it. The
-- unconditional list holds `receipt_no` alone, because a receipt number names a piece
-- of paper in a household and no version of changing it is a fix. This column names a
-- request, and a support case that has to detach a key from a row — a centre migrated
-- between environments, a key written against the wrong row by a bug — is answerable
-- by somebody with the SQL editor open. Everything else about the function is
-- unchanged from 20260811000017; it is restated in full because `create or replace`
-- takes the whole body.
-- ---------------------------------------------------------------------------

create or replace function app.guard_payment_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  server_role boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
begin
  if tg_op = 'DELETE' then
    if not server_role then
      raise exception
        'a fee payment is a record of money received and cannot be deleted by %; '
        'enter a negative payment instead', current_user
        using errcode = '42501';
    end if;
    return old;
  end if;

  if new.receipt_no is distinct from old.receipt_no then
    raise exception
      'receipt_no % is already issued and cannot be changed to %',
      old.receipt_no, new.receipt_no
      using errcode = '42501';
  end if;

  if not server_role
     and (new.amount_bdt is distinct from old.amount_bdt
          or new.method is distinct from old.method
          or new.paid_at is distinct from old.paid_at
          or new.invoice_id is distinct from old.invoice_id
          or new.student_id is distinct from old.student_id
          or new.coaching_center_id is distinct from old.coaching_center_id
          or new.idempotency_key is distinct from old.idempotency_key)
  then
    raise exception
      'a fee payment says what was received and cannot be rewritten by %; '
      'only reference and note may be corrected', current_user
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Restated per the convention in 20260811000010. `create or replace` keeps the
-- existing grants, so this changes nothing today — it is here so that the day
-- somebody replaces it with a drop-and-create, the fence comes back with it.
revoke all on function app.guard_payment_immutable() from anon, authenticated, public;
