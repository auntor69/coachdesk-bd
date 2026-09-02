-- CoachDesk BD — one tap, one bill, however many times the request arrives.
--
-- THE COLUMN 20260811000048 SAID WOULD NEED A WRITER. `revenue_category` has read
-- 'tuition' on every row in every centre since it landed, because nothing in the product
-- raises a non-tuition bill. The form that does — §9.7's admission, registration, exam
-- and form fees — is a money-writing form on a table where a duplicate is permanent:
-- 20260811000028 revoked DELETE, and the remedy for a bill raised twice is to cancel it,
-- which leaves two rows where there was one charge.
--
-- THE GENERATOR NEEDS NO KEY AND THIS FORM CANNOT BORROW ITS ONE. Month-close is
-- idempotent through `unique (enrollment_id, period_month)` and PostgREST's
-- `onConflict`, and 20260811000048 explains at length why that key cannot be widened to
-- include the category. A non-tuition bill carries no enrollment at all, so it sits
-- outside that key by construction — two exam fees in one month are two real bills, and
-- nothing in these columns tells that apart from one exam fee entered twice. Only the
-- browser knows that two arrivals are one tap.
--
-- THE KEY IS PER SUBMISSION AND THE INDEX IS PER STUDENT, which is the one thing here
-- that differs from 20260811000025, ...50 and ...51. Those three protect a form that
-- writes one row. An exam fee is charged to a batch: one press, forty bills, one uuid.
-- So `student_id` joins the index, every row of the run carries the same key, and a
-- retry loses on the first row it reaches — rolling the whole statement back, which is
-- also the right answer for a run that is all-or-nothing anyway.

-- ---------------------------------------------------------------------------
-- 1. The token.
--
-- Nullable, and load-bearing for the reason 20260811000025 gave: a browser with no
-- `crypto.randomUUID` sends nothing, and the honest degradation is a bill recorded
-- without retry protection rather than a refused write. Every row raised by month-close
-- is null too, and stays that way — it has a better key.
-- ---------------------------------------------------------------------------

alter table public.fee_invoices
  add column if not exists idempotency_key uuid;

-- Partial, centre-scoped, and third-keyed on the student. Nulls are already distinct in
-- a unique index and the clause says so out loud; a key is only ever compared against
-- keys inside the caller's own centre, so nothing a browser sends can reach across the
-- boundary.
create unique index if not exists fee_invoices_center_idempotency_key
  on public.fee_invoices (coaching_center_id, idempotency_key, student_id)
  where idempotency_key is not null;

comment on column public.fee_invoices.idempotency_key is
  'A uuid the browser mints once per one-off charge form and sends with the submit. '
  'Unique per centre per student, so one press charging a batch writes one row each and '
  'a retried or double-tapped request loses to the rows already there rather than '
  'billing forty families twice. Null on every invoice month-close raised, which is '
  'idempotent through (enrollment_id, period_month) instead, and on any submit from a '
  'browser that could not mint one — which means no retry protection, never a refused '
  'write.';

-- ---------------------------------------------------------------------------
-- 2. The token cannot be rewritten.
--
-- 20260811000030 revoked UPDATE on this table and handed back four named columns, so a
-- column added afterwards is already unwritable from a browser session — the same
-- whitelist property 20260811000047 and ...48 leaned on. The guard is here for the
-- reason 20260811000050 put the same line in the expense guard: the grant is the lock,
-- and the guard is the lock that survives somebody pasting a wholesale grant.
--
-- In the `not server_role` list rather than the unconditional one, matching every other
-- table's placement of this column: it names a request, not a figure, and a support case
-- that has to detach a key from a row is answerable by somebody with the SQL editor
-- open. Everything else is 20260811000048's body unchanged, restated only because
-- `create or replace` takes the whole thing.
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
          or new.revenue_category is distinct from old.revenue_category
          or new.due_date is distinct from old.due_date
          or new.note is distinct from old.note
          or new.created_at is distinct from old.created_at
          or new.idempotency_key is distinct from old.idempotency_key)
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

-- Rebound by name, and recreated for the reason 20260811000048 recreated it: a reader
-- looking for what fires on a fee invoice should find it in the file that last changed it.
drop trigger if exists fee_invoices_guard_void on public.fee_invoices;

create trigger fee_invoices_guard_void
  before update or delete on public.fee_invoices
  for each row execute function app.guard_invoice_void();

revoke all on function app.guard_invoice_void() from anon, authenticated, public;

comment on function app.guard_invoice_void() is
  'Belt and braces over the column grant on fee_invoices. Refuses a DELETE, refuses '
  'any rewrite of what was billed — including what it was billed for and the uuid that '
  'made it idempotent — refuses cancelling a bill that holds money, refuses waiving a '
  'fee on a cancelled bill, and stamps who cancelled or discounted it and when rather '
  'than taking either from the client.';
