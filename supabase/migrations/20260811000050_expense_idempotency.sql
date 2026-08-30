-- CoachDesk BD — one tap, one expense, however many times the request arrives.
--
-- THE SAME BUG AS 20260811000025, ON THE TABLE THAT IS ABOUT TO GET A FORM. An owner
-- on a Grameenphone connection in a tin-roofed room types the month's rent, taps save,
-- and the insert reaches Postgres while the response dies on the way back. The button
-- unsticks with an error for a row that is in fact written. So they tap it again, and
-- 20260811000045 has made both rows permanent: an expense cannot be deleted from a
-- browser session, by anybody, for exactly the reason a fee payment cannot.
--
-- WHAT THE DUPLICATE COSTS HERE IS MORE THAN A WRONG LIST. 20260811000049's
-- `center_profit_month` subtracts this table, so ৳15,000 of rent entered twice is
-- ৳15,000 off the month's profit for money that never left the drawer — on the one
-- figure an owner would use to decide whether the centre is worth running. Nothing on
-- the screen suggests it: two identical rows in a month's spending look exactly like a
-- centre that paid two bills.
--
-- AND THE REMEDY IS THE UGLY ONE. The correction is a negative expense, so undoing a
-- double-tap leaves three lines where there was one real payment — the row, the
-- duplicate, and the counter-entry. That is the right rule for a table that records
-- money, and it is why 20260811000045 revoked DELETE; but it is a rule about correcting
-- mistakes, and a mistake a uuid prevents should not need correcting.
--
-- NO NATURAL KEY HERE EITHER, which is the whole reason the browser supplies one. Two
-- ৳500 photocopy runs on the same afternoon are two real expenses, same category, same
-- amount, same date, same method, and nothing in 20260811000045's columns tells that
-- apart from one run entered twice. Only the browser knows that two arrivals are one
-- tap, so only the browser can say so. See src/lib/idempotency.ts, which already mints
-- and reads the token and needs no change to be used from a second form.
--
-- WHY NOT THE OTHER TABLES 20260811000025 LEFT OUT. Its rule was: money, invisible
-- until a total is read, and undeletable by design. `expenses` is all three, and
-- `salary_payments` (20260811000044) is too — that one gets the same column when its
-- form is built, and not before, because a column with no writer is a column nobody
-- has tested.

-- ---------------------------------------------------------------------------
-- 1. The token.
--
-- uuid, nullable, and the nullability is load-bearing for the reason 20260811000025
-- gave: a browser with no `crypto.randomUUID` — a plain-HTTP LAN address in
-- development is not a secure context — sends nothing, and the honest degradation is
-- an expense recorded without retry protection rather than a refused write. Every row
-- written before this migration is null too.
-- ---------------------------------------------------------------------------

alter table public.expenses
  add column if not exists idempotency_key uuid;

-- Partial and centre-scoped, both for the reasons 20260811000025 spells out: nulls are
-- already distinct in a unique index and the clause says so out loud, and a key is only
-- ever compared against keys inside the caller's own centre so nothing a browser sends
-- can reach across the boundary.
create unique index if not exists expenses_center_idempotency_key
  on public.expenses (coaching_center_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.expenses.idempotency_key is
  'A uuid the browser mints once per expense form and sends with the submit. Unique '
  'per centre, so a retried or double-tapped request loses to the row already there '
  'and src/app/(app)/expenses/actions.ts answers it with the voucher written the first '
  'time instead of subtracting the same rent from the month twice. Null on rows '
  'written before this existed and on any submit from a browser that could not mint '
  'one — which means no retry protection, never a refused write.';

-- ---------------------------------------------------------------------------
-- 2. The token cannot be rewritten, for the reason the voucher number cannot.
--
-- A mutable identity is not an identity. Clear the key and the next arrival of the
-- same tap is written as a second expense; set a key on a row before its real submit
-- arrives and that submit is answered with a voucher for money nobody spent.
--
-- 20260811000045 already revoked UPDATE on this table from `authenticated` and handed
-- back only `(reference, note, recurring)`, so a browser session cannot name this
-- column today. The trigger is here for the reason that migration gave and which
-- applies word for word: a REVOKE only removes grants the revoking role made, and one
-- pasted `grant all on all tables in schema public to authenticated` undoes the column
-- grant with no error anywhere.
--
-- In the `not server_role` list rather than the unconditional one, matching
-- 20260811000025's placement of the same column on `fee_payments`: `voucher_no` names
-- a slip in a file and no version of changing it is a fix, while this names a request,
-- and a support case that has to detach a key from a row is answerable by somebody
-- with the SQL editor open. Everything else is unchanged from 20260811000045 and is
-- restated only because `create or replace` takes the whole body.
-- ---------------------------------------------------------------------------

create or replace function app.guard_expense_immutable()
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
        'an expense is a record of money spent and cannot be deleted by %; '
        'enter a negative expense instead', current_user
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
     and (new.amount_bdt is distinct from old.amount_bdt
          or new.category is distinct from old.category
          or new.method is distinct from old.method
          or new.spent_on is distinct from old.spent_on
          or new.branch_id is distinct from old.branch_id
          or new.coaching_center_id is distinct from old.coaching_center_id
          or new.idempotency_key is distinct from old.idempotency_key)
  then
    raise exception
      'an expense says what was spent and cannot be rewritten by %; '
      'only reference and note may be corrected', current_user
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Restated per the convention in 20260811000010. `create or replace` keeps the
-- existing grants, so this changes nothing today — it is here so that the day somebody
-- replaces it with a drop-and-create, the fence comes back with it.
revoke all on function app.guard_expense_immutable() from anon, authenticated, public;
