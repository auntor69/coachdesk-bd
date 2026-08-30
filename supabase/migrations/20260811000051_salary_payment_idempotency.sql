-- CoachDesk BD — one tap, one salary paid, however many times the request arrives.
--
-- 20260811000050 SAID WHEN THIS WOULD BE DUE, AND IT IS DUE NOW. Its closing note
-- named the rule that decides which tables get a token — "money, invisible until a
-- total is read, and undeletable by design" — found that `salary_payments`
-- (20260811000044) is all three, and then deliberately did not touch it: "that one
-- gets the same column when its form is built, and not before, because a column with
-- no writer is a column nobody has tested." The form is being built in the same change
-- as this migration, so the column arrives with the code that writes it and with the
-- read-back that answers a retry.
--
-- WHAT A DOUBLE-TAP COSTS HERE, AND WHY IT IS THE WORST OF THE THREE. An owner pays a
-- teacher ৳13,000 for August, the insert lands in Postgres, and the response dies on
-- the way back to a phone in a tin-roofed room. The button unsticks with an error for
-- a payment that is in fact recorded. They tap again, and now:
--
--   · 20260811000049's `center_profit_month` takes its payroll side from this table
--     and subtracts it, so August's profit is ৳13,000 lower than the truth for money
--     that never left the drawer — on the one figure an owner uses to decide whether
--     the centre is worth running.
--   · 20260811000044 revoked DELETE from `authenticated` outright. The duplicate is
--     permanent from a browser, and the only correction is a reversing negative
--     payment, which leaves three rows where there was one real ৳13,000.
--   · The trigger below assigns a voucher number per centre, so the duplicate also
--     burns a number. Two slips exist for one payment and either could be the one in
--     the teacher's hand.
--
-- NO NATURAL KEY HERE EITHER, WHICH IS SHARPER THAN ON THE OTHER TWO TABLES. It is
-- deliberate that 20260811000044 has no unique index on (payee, for_month): a centre
-- paying half a salary on the 5th and half on the 20th writes two rows for one month
-- and one person, both real, and a correction is a third. So "already paid for this
-- month" is a question this schema answers with a read and never with a constraint —
-- which leaves nothing at all in the columns to tell two arrivals of one tap apart
-- from two genuine instalments. Only the browser knows, so the browser says so. See
-- src/lib/idempotency.ts, which mints and reads the token already and needs no change
-- to serve a third form.

-- ---------------------------------------------------------------------------
-- 1. The token.
--
-- uuid, nullable, and the nullability is load-bearing for the reason 20260811000025
-- gave and 50 repeated: `crypto.randomUUID` needs a secure context, a plain-HTTP LAN
-- address on a real handset is not one, and the honest degradation there is a salary
-- recorded without retry protection rather than a refused payment. Every row written
-- before this migration is null too, and there is no backfill to do: nulls are already
-- distinct in a unique index.
-- ---------------------------------------------------------------------------

alter table public.salary_payments
  add column if not exists idempotency_key uuid;

-- Partial and centre-scoped, both for the reasons 20260811000025 spells out: nulls are
-- already distinct in a unique index and the clause says so out loud, and a key is only
-- ever compared against keys inside the caller's own centre, so nothing a browser sends
-- can reach across the boundary.
create unique index if not exists salary_payments_center_idempotency_key
  on public.salary_payments (coaching_center_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.salary_payments.idempotency_key is
  'A uuid the browser mints once per pay form and sends with the submit. Unique per '
  'centre, so a retried or double-tapped request loses to the row already there and '
  'src/app/(app)/payroll/pay/actions.ts answers it with the voucher written the first '
  'time instead of paying one salary twice and taking it off the month twice. Null on '
  'rows written before this existed and on any submit from a browser that could not '
  'mint one — which means no retry protection, never a refused payment.';

-- ---------------------------------------------------------------------------
-- 2. The token cannot be rewritten, for the reason the voucher number cannot.
--
-- A mutable identity is not an identity. Clear the key and the next arrival of the same
-- tap is written as a second salary; set a key on a row before its real submit arrives
-- and that submit is answered with a voucher for money nobody was paid.
--
-- 20260811000044 already revoked UPDATE on this table from `authenticated` and handed
-- back only `(reference, note)`, so a browser session cannot name this column today.
-- The trigger is here for the reason that migration gave, which applies word for word:
-- a REVOKE only removes grants the revoking role made, and one pasted `grant all on all
-- tables in schema public to authenticated` undoes the column grant with no error
-- anywhere.
--
-- In the `not server_role` list rather than the unconditional one, matching 50's
-- placement of the same column on `expenses` and 25's on `fee_payments`: `voucher_no`
-- names a slip in somebody's hand and no version of changing it is a fix, while this
-- names a request, and a support case that has to detach a key from a row is answerable
-- by somebody with the SQL editor open. Everything else is unchanged from
-- 20260811000044 and is restated only because `create or replace` takes the whole body.
-- ---------------------------------------------------------------------------

create or replace function app.guard_salary_payment_immutable()
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
        'a salary payment is a record of money paid out and cannot be deleted by %; '
        'enter a reversing negative payment instead', current_user
        using errcode = '42501';
    end if;
    return old;
  end if;

  if new.voucher_no is distinct from old.voucher_no then
    raise exception
      'voucher_no % is already issued and cannot be changed to %',
      old.voucher_no, new.voucher_no
      using errcode = '42501';
  end if;

  if not server_role
     and (new.basic_bdt is distinct from old.basic_bdt
          or new.allowances_bdt is distinct from old.allowances_bdt
          or new.other_bdt is distinct from old.other_bdt
          or new.deductions_bdt is distinct from old.deductions_bdt
          or new.method is distinct from old.method
          or new.for_month is distinct from old.for_month
          or new.paid_at is distinct from old.paid_at
          or new.employee_id is distinct from old.employee_id
          or new.teacher_id is distinct from old.teacher_id
          or new.coaching_center_id is distinct from old.coaching_center_id
          or new.idempotency_key is distinct from old.idempotency_key)
  then
    raise exception
      'a salary payment says what was paid and cannot be rewritten by %; '
      'only reference and note may be corrected', current_user
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Restated per the convention in 20260811000010. `create or replace` keeps the existing
-- grants, so this changes nothing today — it is here so that the day somebody replaces
-- it with a drop-and-create, the fence comes back with it.
revoke all on function app.guard_salary_payment_immutable() from anon, authenticated, public;
