-- CoachDesk BD — a number the parent can quote back.
--
-- A payment already has an id, and that id is a uuid. Nobody writes
-- `9f3c1a7e-4b2d-…` on the slip they hand across a desk, nobody reads it down a
-- phone line, and no parent standing in a doorway saying "I paid, I have the
-- paper" can be found from it. Every fee receipt in this country carries a small
-- serial number, and it carries it because that number is how a dispute gets
-- settled: the parent reads four digits, the owner finds the row.
--
-- So this migration gives fee_payments a per-centre serial. It is the last thing
-- standing between the payment log and a receipt that can actually be printed,
-- which is what 20260811000006's balance view and the /fees screen were building
-- toward.
--
-- PER CENTRE, not global. Centre A's first receipt is 1 and centre B's first
-- receipt is also 1. A global sequence would leak: an owner watching their own
-- numbers jump from 41 to 58 learns how much business seventeen other centres did
-- that week, and on a shared-tenant product that is a real disclosure and not a
-- theoretical one.
--
-- MONOTONIC, not restarted each year. Paper books usually reset — 2026/0001 —
-- and the cost of that is that no number means anything on its own: every
-- reference has to carry the year, and the first week of January is when two rows
-- share a number and somebody voids the wrong one. A number that only ever climbs
-- is a number that can be said out loud with nothing attached to it.

-- ---------------------------------------------------------------------------
-- 1. The column, and why it is not a sequence.
--
-- `serial`/`identity` would be one line and would be wrong twice. A sequence is
-- global, and the section above is about why that leaks. A sequence also does not
-- roll back: an insert that fails a constraint still burns its number, so a
-- centre's receipts would read 14, 15, 17 with no 16 anywhere — and a hole in a
-- receipt book is what an audit reads as a removed page. Step 3 counts instead,
-- and step 4 is what makes counting sound.
--
-- Nullable to begin with, because the rows already there have no number yet.
-- Made NOT NULL at step 5, once every one of them does.
-- ---------------------------------------------------------------------------

alter table public.fee_payments
  add column if not exists receipt_no integer;

-- ---------------------------------------------------------------------------
-- 2. The rows that already exist.
--
-- Ordered by paid_at first, because that is the order the money actually arrived
-- in and the order the register will print. created_at breaks a tie between two
-- payments recorded as the same instant (the import path in 20260811000009 can
-- produce those), and id breaks a tie between two rows that agree on both — not
-- because it means anything, but because an ORDER BY that is not total gives a
-- different answer every time it runs, and this one must be reproducible if it is
-- ever re-derived.
-- ---------------------------------------------------------------------------

with numbered as (
  select id,
         row_number() over (
           partition by coaching_center_id
           order by paid_at, created_at, id
         ) as n
  from public.fee_payments
)
update public.fee_payments p
set receipt_no = numbered.n
from numbered
where numbered.id = p.id
  and p.receipt_no is null;

-- ---------------------------------------------------------------------------
-- 3. Uniqueness, and the trigger that assigns the next number.
--
-- The index first, so the constraint exists before anything can rely on the
-- function being correct. If the trigger is ever wrong, the insert fails; without
-- the index it would succeed and two parents would hold receipt 42.
-- ---------------------------------------------------------------------------

create unique index if not exists fee_payments_center_receipt_key
  on public.fee_payments (coaching_center_id, receipt_no);

-- The advisory lock is the whole point of this function.
--
-- Two people at one centre's desk hitting Save in the same second both read
-- `max(receipt_no) = 41`, both write 42, and the second insert dies on the index
-- above. That is *correct* — nobody gets a duplicate — but a failed payment entry
-- is the worst possible place to be correct: the cash is on the table, the parent
-- is waiting, and the owner has just been told the app broke. A transaction-scoped
-- lock on the centre makes the second one wait a few milliseconds and get 43.
-- Released at commit or rollback by Postgres, with no unlock call to forget.
--
-- Holding it until commit is also what keeps the series gapless. A transaction
-- that takes 42 and then rolls back still holds the lock while it does so, so the
-- next one reads max() = 41 and takes 42 as well. That is the behaviour a sequence
-- cannot give, and it is why this counts rather than nextval()s.
--
-- Two keys rather than one, so the namespace is ours: the first is a constant
-- derived from this column's name, the second from the centre. Anything else in
-- the database using advisory locks (pg_cron, a future job runner) cannot collide
-- with us by accident. A hash collision *between two centres* costs one of them a
-- short wait and nothing else — hashtext is only picking a lock slot here, it is
-- never stored and never compared.
--
-- SECURITY INVOKER (the default, stated by omission as everywhere else in this
-- schema). It means max() is filtered by the caller's RLS, and that is the safe
-- direction: the only role the fee_payments policy lets insert is a staff admin,
-- who can already read every payment in their own centre, so the filtered max is
-- the true max. If some future policy narrows that, the number comes out too low
-- and the unique index rejects the insert — loud, in front of somebody who can
-- act on it. A SECURITY DEFINER version would read past RLS to get the same
-- answer on the happy path and hide that mistake on the unhappy one.

create or replace function app.assign_receipt_no()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- An explicit number is honoured, on purpose. A centre moving off a paper book
  -- has three hundred slips already numbered, and an import that renumbers them
  -- makes every receipt a parent is holding point at the wrong row. The unique
  -- index is what keeps that honest; this just gets out of the way.
  if new.receipt_no is not null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('fee_payments.receipt_no'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  -- coalesce is not schema-qualified because it cannot be: it is SQL syntax, not
  -- a function, so `pg_catalog.coalesce` is a parse error. max() is an aggregate
  -- and does need the qualification, because search_path is empty.
  select coalesce(pg_catalog.max(p.receipt_no), 0) + 1
    into new.receipt_no
  from public.fee_payments p
  where p.coaching_center_id = new.coaching_center_id;

  return new;
end;
$$;

drop trigger if exists fee_payments_assign_receipt_no on public.fee_payments;

create trigger fee_payments_assign_receipt_no
  before insert on public.fee_payments
  for each row execute function app.assign_receipt_no();

-- ---------------------------------------------------------------------------
-- 4. What makes counting from max() sound: the row cannot leave, and the paper
--    cannot be contradicted.
--
-- 20260811000001 says "payments are an append-only log" in a comment and then
-- grants `for all` to staff admins, which is not the same thing. With DELETE
-- available, counting from max() hands out a used number again the moment the
-- newest payment is removed — and then two pieces of paper in two households
-- claim receipt 42, one of them voided in a way neither parent can see. That is
-- the failure this whole migration exists to prevent, so the delete goes.
--
-- Nothing is taken away from anybody. The product has never deleted a payment:
-- src/app/(app)/fees/actions.ts only inserts, and a refund is already a negative
-- payment (20260811000006 sums them, and the RLS suite asserts the original stays
-- on the record). This makes the schema say what the code already does.
--
-- UPDATE goes the same way, with two columns handed back — the pattern
-- 20260811000004 used on coaching_centers. Everything that decides what the
-- receipt says (amount_bdt, method, paid_at, invoice_id, student_id, receipt_no)
-- becomes unwritable from a browser session, so the paper and the row can never
-- disagree. `reference` and `note` stay editable because a mistyped bKash trxID is
-- a real thing that needs correcting and correcting it changes no number.
--
-- TRUNCATE is in the list because `grant all` includes it and a row-level trigger
-- does not fire for it. Nothing in this product can issue one; a role that can is
-- one `truncate fee_payments` away from erasing every receipt in every centre.
--
-- service_role keeps all of it: it holds its own grants from Supabase's defaults
-- and a REVOKE from `authenticated` does not touch them. The admin client is how
-- demo fixtures get torn down and how a support request gets answered, and neither
-- of those goes through a policy.
--
-- Widening this later is a deliberate act. An edit screen that needs `method` adds
-- `method` here, in a migration, with a sentence saying why.
-- ---------------------------------------------------------------------------

revoke update, delete, truncate on public.fee_payments from authenticated;

grant update (reference, note) on public.fee_payments to authenticated;

-- Belt and braces, for the reason 20260811000004 spelled out and which applies
-- word for word here: a REVOKE only removes grants the revoking role made. If the
-- grant to `authenticated` came from `supabase_admin` rather than `postgres`, the
-- statement above succeeds while changing nothing, and the local suite would prove
-- a lock that production does not have. It is also one pasted `grant all on all
-- tables in schema public to authenticated` from a setup snippet away from being
-- undone with no error anywhere.
--
-- A trigger cannot be granted away. SECURITY INVOKER on purpose, exactly as in
-- 20260811000004: inside a SECURITY DEFINER function `current_user` is the owner,
-- which would make the check below always pass.
--
-- receipt_no is refused for everybody, including the server. Every other column
-- here is refused for a browser session and allowed for service_role, postgres and
-- the SQL editor, because a support request about a fee entered wrongly has to be
-- answerable by somebody. A receipt number is different in kind: it is not data
-- about the payment, it is the name of a piece of paper in a household, and
-- changing it makes that paper point at a different row. There is no version of
-- that which is a fix.

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
          or new.coaching_center_id is distinct from old.coaching_center_id)
  then
    raise exception
      'a fee payment says what was received and cannot be rewritten by %; '
      'only reference and note may be corrected', current_user
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists fee_payments_guard_immutable on public.fee_payments;

create trigger fee_payments_guard_immutable
  before update or delete on public.fee_payments
  for each row execute function app.guard_payment_immutable();

-- ---------------------------------------------------------------------------
-- 5. NOT NULL, last.
--
-- After the backfill so the existing rows pass, and after the trigger so the new
-- ones do. The order also decides the failure mode if the trigger is ever dropped
-- by a future migration: the insert fails on this constraint instead of writing a
-- payment with no receipt number on it.
-- ---------------------------------------------------------------------------

alter table public.fee_payments
  alter column receipt_no set not null;

-- ---------------------------------------------------------------------------
-- 6. The revoke, per the convention in 20260811000010.
--
-- Supabase's default privileges grant EXECUTE on every new function in public to
-- anon and authenticated; this one is in `app`, which PostgREST does not expose,
-- and it returns `trigger`, which PostgREST would refuse anyway. A trigger does
-- not consult EXECUTE when it fires either. Revoked regardless, for the same
-- reason the other two trigger functions were: a function nobody should ever call
-- by name should not be callable by name.
-- ---------------------------------------------------------------------------

revoke all on function app.assign_receipt_no() from anon, authenticated, public;
revoke all on function app.guard_payment_immutable() from anon, authenticated, public;
