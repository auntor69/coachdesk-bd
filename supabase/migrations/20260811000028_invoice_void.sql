-- CoachDesk BD — a bill raised by mistake can be cancelled, and nothing else about
-- it can be rewritten.
--
-- THE HOLE THIS CLOSES HAS BEEN OPEN SINCE MIGRATION 1. `fee_invoices.voided_at`
-- has existed from the first schema. The partial index skips voided rows, the
-- balances view carries the column, and every read path in the app filters on it:
-- the fee board, the dashboard, the reminder worklist, /me, the student profile,
-- the CSV exports, and lib/fees/month-close.ts, which reasons about voids at
-- length. `recordPayment` refuses to take money against a voided invoice and there
-- is a dictionary string written for that refusal in both languages.
--
-- Nothing in the product can set the column. Not one write path. The only UPDATE
-- the app has ever issued against this table is `generateInvoices`, and that is an
-- insert-what-is-missing upsert that touches no existing row on purpose.
--
-- So the state is this: an owner runs the generator, and it bills a student who
-- left in June because nobody closed the enrolment. That family now owes ৳2,000
-- forever. It is in the headline outstanding figure on the board they show a
-- business partner, it is in the arrears the month-close screen opens July with, it
-- is on the chase worklist telling them to message a parent whose child does not
-- come here any more — and there is no button, on any screen, that ends it. The
-- same is true of a duplicate enrolment billed twice and of a bill raised against
-- the wrong child.
--
-- WHY THE FIX IS A CANCELLATION AND NOT A DELETE. Deleting the row would free the
-- (enrollment_id, period_month) slot and read as tidier. It is the wrong shape for
-- two reasons. A bill that was issued is a thing that happened — a parent may have
-- been messaged about it, and "we never billed you" is a worse answer than "we
-- cancelled it". And DELETE cascades to fee_payments, where 20260811000017 has
-- already decided that money received cannot be deleted by a browser session; a
-- correction path whose first step is a cascade into that table is a correction path
-- that fails at the least convenient moment.
--
-- WHAT A CANCELLATION MAY NOT DO IS MOVE MONEY, and that is enforced below rather
-- than argued in the application. A voided invoice is excluded from the balances
-- entirely, so voiding a part-paid bill would take a family's payment off their own
-- record while leaving it in the centre's takings — the exact discrepancy an owner
-- would ring about, produced by the button meant to fix their books. So a bill with
-- money on it cannot be cancelled. Refund it first (a negative payment, which is how
-- this schema has always spelled a refund) and then it can be.
--
-- Money on it means the sum, not the row count. A payment that was fully handed back
-- nets to zero, and such a bill is exactly as cancellable as one nobody ever paid —
-- which is also the reading month-close.ts already documents for the report.
--
-- THE SLOT STAYS TAKEN, DELIBERATELY. A cancelled invoice keeps its unique
-- (enrollment_id, period_month), so re-running the generator will not raise a second
-- bill for that student and month. That is right for the cases this exists for: a
-- student who left should not be re-billed by the next press of the button. It does
-- mean cancelling is not the way to fix a wrong *amount*, and the way back is the
-- restore below rather than a regeneration.

-- ---------------------------------------------------------------------------
-- 1. Who cancelled it, and why.
--
-- Both nullable. Every row predates them, and a cancellation from the SQL editor
-- during a support call has no auth.uid() to record.
--
-- `void_reason` is on the invoice rather than in a log because it is read in one
-- place and by one person: the owner, on the board, three weeks later, deciding
-- whether the bill they are looking at was cancelled on purpose. An audit table
-- would answer a question nobody in a coaching centre asks.
--
-- `voided_by` is never named by the browser — the trigger in step 3 stamps it — so
-- it cannot be a claim, only a record.
-- ---------------------------------------------------------------------------

alter table public.fee_invoices
  add column if not exists voided_by uuid references auth.users (id) on delete set null;

alter table public.fee_invoices
  add column if not exists void_reason text;

comment on column public.fee_invoices.voided_at is
  'When this bill was cancelled, or null while it stands. Every read path in the '
  'app filters it out: a cancelled bill is not owed, not chased, not exported and '
  'not counted in any total. Stamped by app.guard_invoice_void() rather than taken '
  'from the client, so it cannot be backdated into a month the owner has already '
  'closed and reported on.';

comment on column public.fee_invoices.voided_by is
  'The staff admin who cancelled it, from auth.uid() at the moment of the update. '
  'Null on a cancellation made outside a browser session — a support case run '
  'through the SQL editor has no authenticated user to name.';

comment on column public.fee_invoices.void_reason is
  'Why, in the owner''s own words, up to 200 characters. Optional: a bill raised '
  'against a child who left is self-evident to the person cancelling it, and a '
  'required field here would be answered with a full stop. Cleared when the bill '
  'is restored, so it never describes an invoice that is live.';

-- ---------------------------------------------------------------------------
-- 2. The balances view gains the reason, and nothing else changes.
--
-- A passenger, exactly like guardian_phone and preferred_channel beside it: the
-- view computes nothing from it. It is carried so the board can draw a cancelled
-- row with its reason on it without a second round trip on a 3G phone.
--
-- `voided_by` is deliberately NOT carried. It is a uuid, and the only useful thing
-- to render would be a name — which would mean joining auth.users, a table this
-- schema never exposes to a view. A centre wanting "who cancelled this" is a
-- support question with an answer in the column.
--
-- Restated in full because Postgres has no "add a column to a view", and the new
-- column goes last because `create or replace view` may only append: every existing
-- column must keep its name, its type and its position. Composed from
-- 20260811000026's body — which is itself 20260811000006's — with one line added.
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
  i.void_reason
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
-- 3. The fence: two columns, and no others.
--
-- `fee_invoices_staff_admin` is `for all`, which has always meant a staff admin's
-- browser session could UPDATE or DELETE any column of any bill in their centre
-- through PostgREST. Nothing in the app has ever used it, so nothing is being taken
-- away here — the privilege is being narrowed to the writes that now exist.
--
-- What that closes is not an attack so much as a footgun with the owner's own hand
-- on it: `amount_bdt` and `period_month` are the numbers every report in this product
-- is built from, and a bill silently moved from July to August changes a month the
-- owner has already shown somebody. Cancelling is the correction this table needs,
-- and it is the only one it gets.
--
-- Widening this later is a deliberate act. A discount screen adds `discount_bdt`
-- here, in a migration, with a sentence saying why.
--
-- INSERT is untouched: `generateInvoices` raises the month's bills, and its upsert
-- is ON CONFLICT DO NOTHING, which needs no UPDATE privilege at all.
--
-- `voided_by` is not in the grant. The trigger below stamps it from auth.uid(), so a
-- browser cannot name the person who cancelled a bill even to name themselves.
-- ---------------------------------------------------------------------------

revoke update, delete, truncate on public.fee_invoices from authenticated;

grant update (voided_at, void_reason) on public.fee_invoices to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The guard, because a revoke is not a fence.
--
-- Belt and braces for the reason 20260811000004 and 20260811000017 both spelled out
-- and which applies word for word: a REVOKE only removes grants the revoking role
-- made. If `authenticated`'s grant on this table came from `supabase_admin` rather
-- than `postgres`, the statement above succeeds while changing nothing, and the local
-- suite would prove a lock production does not have. One pasted `grant all on all
-- tables in schema public to authenticated` from a setup snippet undoes it with no
-- error anywhere. A trigger cannot be granted away.
--
-- SECURITY INVOKER on purpose, exactly as in 20260811000004 and 20260811000017:
-- inside a SECURITY DEFINER function `current_user` is the owner, which would make
-- the role check below always pass.
--
-- WHICH MEANS THE PAYMENT SUM IS READ UNDER THE CALLER'S OWN RLS, and it is complete
-- because of two facts that hold today. Only a staff admin may update this table
-- (`fee_invoices_staff_admin` is the only write policy on it), and a staff admin's
-- policy on fee_payments is `for all` over their whole centre. The payment and the
-- invoice always share a coaching_center_id — 20260811000005 put the tenant column in
-- every foreign key precisely so a sideways reference is impossible — so there is no
-- payment against this bill that the caller cannot see. A future policy that let a
-- narrower reader void a bill would have to revisit this: the check would still run,
-- and it would be answering from a shorter list.
--
-- WHY DELETE IS REFUSED AT ALL. With a cancellation on the table there is no
-- remaining use for it, and its cascade reaches fee_payments — where a DELETE is
-- already refused by 20260811000017 for anybody but the server. So a browser deleting
-- a paid invoice fails today, in the middle of a cascade, with an error about
-- payments. Refusing it here makes the answer the owner gets name the thing they were
-- doing and the thing to do instead. No student-delete path exists in the app (a
-- student who leaves is deactivated, never removed), so nothing legitimate cascades
-- through here.
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

  -- The cancellation, and only the cancellation. Everything else about a bill is
  -- what the month's reports are made of.
  if not server_role
     and (new.id is distinct from old.id
          or new.coaching_center_id is distinct from old.coaching_center_id
          or new.student_id is distinct from old.student_id
          or new.enrollment_id is distinct from old.enrollment_id
          or new.period_month is distinct from old.period_month
          or new.amount_bdt is distinct from old.amount_bdt
          or new.discount_bdt is distinct from old.discount_bdt
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

