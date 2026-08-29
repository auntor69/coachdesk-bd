-- What the money was charged for.
--
-- MASTERPLAN.md §9.7, in full:
--
--   "Student fees are most of it, but not all: admission fees, registration fees, exam
--   fees, form fees, and other income. Categorised for the same reason expenses are —
--   an owner who wants to know whether admission season carried the year needs those
--   separable from monthly tuition."
--
-- A COLUMN ON fee_invoices, NOT A SECOND TABLE, and that is the decision this file is
-- mostly about. An admission fee has every part of a fee invoice and no part that is
-- different: a student owes it, it has an amount, it has a due date, it is paid in
-- instalments or not at all, it earns a receipt, it can be waived, it can be cancelled,
-- and until it is paid it is arrears. A separate `other_income` table would need every
-- one of those built again — a second receipt series, a second arrears list, a second
-- void path, a second discount stamp — and the moment it existed, §9.1's collected
-- column would have two sources and the two would drift. One table, one column saying
-- what the bill was for.
--
-- THE DEFAULT IS 'tuition' AND THAT IS NOT THE SHAPE §9.6 CHOSE. The expense enum
-- defaults to 'miscellaneous', the bucket for a cost nobody categorised, because an
-- expense arrives from a person typing it and the honest default is "unsorted". An
-- invoice does not: every one in this database was raised by the month-close generator
-- against a monthly fee, and every one the product can raise today is the same. So the
-- default here is a statement of fact about the rows rather than a shrug about them,
-- which is also what makes the backfill in §2 below unnecessary.
--
-- THE UNIQUE KEY IS WHY THERE IS A CHECK CONSTRAINT, and this is the trap in the
-- feature. `fee_invoices` has carried `unique (enrollment_id, period_month)` since
-- 20260811000001, and the month-close generator depends on it by name — both call sites
-- in src/app/(app)/fees/actions.ts pass `onConflict: 'enrollment_id,period_month'` with
-- `ignoreDuplicates`, which is what makes raising a month's bills safe to re-run.
--
-- That key cannot be widened to include the category. PostgREST compiles `onConflict`
-- into `on conflict (enrollment_id, period_month)`, and Postgres infers an arbiter index
-- only from an exact column match — a unique index on three columns would not be found,
-- and neither would a partial one, because inference needs the statement to restate the
-- predicate and PostgREST emits none. Either change turns re-running month-close into an
-- error on the one screen that has to work every month.
--
-- So the key stays exactly as it is, and a non-tuition invoice carries no enrollment.
-- The CHECK is there to say so out loud, because without it the rule is enforced by
-- accident and enforced badly: a future "add admission fee" screen that named the
-- student's enrollment would collide with that month's tuition bill and get a
-- duplicate-key error that mentions neither tuition nor categories — and it would only
-- collide for students who had already been billed, so it would pass every test written
-- against a new student and fail in front of a queue at admission season. The CHECK
-- turns that into the same refusal every time, on the first attempt, in development.
--
-- WHAT IS NOT HERE.
--
-- Income with no student behind it. §9.7's "other income" reads, in a coaching centre,
-- as hall rent from the centre next door and books sold at the counter — and neither is
-- a fee invoice, because `fee_invoices.student_id` and `fee_payments.student_id` are
-- both NOT NULL and every non-admin policy on both tables filters by them
-- (20260811000012's `fee_invoices_teacher_read` matches `student_id in (select
-- app.my_taught_student_ids())`, and the family self-read does the same). Making that
-- column nullable to fit a book sale would create rows those policies cannot describe.
-- So `'other'` on this table means other money from a student, and money from nobody
-- needs its own table and its own decision. §9.8's profit reads the collected column,
-- which is `fee_payments`, so until that table exists non-student income is outside the
-- profit line — worth knowing rather than worth papering over with an enum value that
-- looks like it covers it.
--
-- The balances view. `fee_invoice_balances` is about money owed now, and what a bill was
-- for does not change what is left on it — the same reason 20260811000030 kept
-- `discounted_at` off the board. The category is for the revenue report, which is the
-- other half of §16's step 16 and the migration after this one.
--
-- The screen. Nothing in the product raises a non-tuition invoice yet, so this column
-- reads 'tuition' on every row in every centre until one does. Dormant on purpose, like
-- 20260811000042's transfer history: the reporting view being built next has to have a
-- categorised past to read, and a column added later is a column every existing row has
-- to be guessed into.

-- ---------------------------------------------------------------------------
-- 1. The categories.
--
-- §9.7's list, its wording, its order, with `tuition` in front because it is the
-- default and the overwhelming majority — and because a report drawn in enum order
-- should open with the line that carries the centre.
--
-- Fixed for the reason §9.6 gives for the expense list: a category somebody types is a
-- category no report can group.
-- ---------------------------------------------------------------------------

create type public.revenue_category as enum (
  'tuition',
  'admission',
  'registration',
  'exam',
  'form',
  'other'
);

-- ---------------------------------------------------------------------------
-- 2. The column.
--
-- NOT NULL WITH A DEFAULT, WHICH IS A METADATA-ONLY CHANGE. Since PostgreSQL 11 this
-- rewrites no rows: the default is recorded once and handed to every existing row on
-- read. So it fires no row trigger, which means — unlike 20260811000047, which had to
-- disable three of them around its backfill — there is nothing here for
-- 20260811000046's audit log to record and nothing for `fee_invoices_updated_at` to
-- stamp. No suppression, because nothing is being suppressed. The contrast is worth
-- naming: 47 needed it because it ran an UPDATE, and an UPDATE is a row event even when
-- a migration is the one issuing it.
--
-- The CHECK is a separate statement rather than part of the ALTER, so that the
-- metadata-only property above stays visible. It does scan the table to validate, which
-- is a read, and it passes for every row that exists because every row that exists is
-- tuition by the default just added.
--
-- A tuition invoice may still have a null enrollment and always could — the composite
-- foreign key from 20260811000005 is `on delete set null (enrollment_id)`, so deleting a
-- batch already leaves its bills behind without one. This constraint does not touch
-- that; it only refuses the reverse.
-- ---------------------------------------------------------------------------

alter table public.fee_invoices
  add column revenue_category public.revenue_category not null default 'tuition';

alter table public.fee_invoices
  add constraint fee_invoices_category_enrollment_bound
  check (revenue_category = 'tuition' or enrollment_id is null);

-- §9.7's question — "did admission season carry the year" — is one contiguous range per
-- category once the centre and the category lead the index.
--
-- `where voided_at is null` because a cancelled bill was never charged, so every query
-- that reads this column will carry that predicate and the index should not hold the
-- rows it will never be asked for. Matches `fee_invoices_center_due_idx`, which has been
-- partial on the same condition since 20260811000001.
create index fee_invoices_center_revenue_idx
  on public.fee_invoices (coaching_center_id, revenue_category, period_month)
  where voided_at is null;

comment on column public.fee_invoices.revenue_category is
  'What this bill was for, so §9.7 can separate admission season from monthly tuition. '
  'A non-tuition invoice must leave enrollment_id null: the unique key on '
  '(enrollment_id, period_month) is the month-close generator''s idempotency and cannot '
  'be widened, so a second bill in the same month has to sit outside it.';

comment on type public.revenue_category is
  'Fee revenue sources, per MASTERPLAN.md §9.7. Fixed list, because a category '
  'somebody types is a category no report can group. `other` means other money from a '
  'student — income with no student behind it is not a fee invoice and has no home in '
  'this schema yet.';

-- ---------------------------------------------------------------------------
-- 3. Who may change it, once it is set.
--
-- NOBODY WITH A BROWSER, AND NO NEW GRANT STATEMENT WAS NEEDED. 20260811000028 revoked
-- UPDATE on this table wholesale and 20260811000030 handed back four named columns, so a
-- column added afterwards is refused by default — the same whitelist property
-- 20260811000047 leaned on. That is already the whole of the protection this column has
-- today, because nothing in the product writes it after the insert.
--
-- IT GOES INTO THE GUARD ANYWAY, and the reason is what the guard is for. The grant is
-- the lock; the guard is the lock that survives somebody widening the grant. Every other
-- column that decides what a month's report says is in that frozen list — and this one
-- decides which line of §9.7 a figure lands on, which is the same kind of fact as the
-- figure itself. 20260811000045 froze `expenses.category` on exactly this argument, and
-- an invoice's category disagreeing with an expense's about whether it can be rewritten
-- would be a difference with no reason behind it.
--
-- AND FREEZING IT IS SAFE HERE, WHERE FREEZING branch_id WAS NOT. That is the trap
-- 20260811000047 documented: `branch_id` has a referential action, `on delete set null`
-- is an UPDATE performed by the system, and a row trigger fires for it — so a guard
-- refusing it would have made any branch that ever took a payment undeletable. This
-- column has no foreign key, no referential action and no trigger writing it. The only
-- writer is an INSERT, which this guard never sees.
--
-- THE CORRECTION PATH IS THE ONE EVERY FROZEN COLUMN HAS. A wrong category is fixed the
-- way a wrong amount is: cancel the bill and raise the right one — and if money has
-- already landed on it, refund that as a negative payment first, which the void branch
-- below insists on. That is four movements to fix a dropdown, which is why the server
-- role stays exempt: §10's support conversation has to be answerable, and straightening
-- out a centre that miscategorised a term of admission fees is precisely the case for it.
--
-- Restated whole, because Postgres has no way to amend a function body. Composed from
-- 20260811000030's, with one line added to the frozen list and nothing else touched.
-- SECURITY INVOKER by omission, as it has been since 20260811000028: inside a SECURITY
-- DEFINER function `current_user` is the owner, which would make the server test below
-- true for everybody.
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

-- The trigger is already bound to this function by name, and `create or replace` keeps
-- that binding — but recreated all the same, for the reason 20260811000030 recreated it:
-- a reader looking for what fires on a fee invoice should find the answer in the file
-- that last changed it.
drop trigger if exists fee_invoices_guard_void on public.fee_invoices;

create trigger fee_invoices_guard_void
  before update or delete on public.fee_invoices
  for each row execute function app.guard_invoice_void();

-- Per the convention in 20260811000010, and restated because `create or replace
-- function` preserves privileges but a reader should not have to know that. In `app`,
-- which PostgREST does not expose, returning `trigger`, which PostgREST would refuse
-- anyway — and a firing trigger never consults EXECUTE. `public` and `anon` are named
-- separately because Supabase's default privilege grants EXECUTE to the role directly
-- rather than through PUBLIC, so revoking one leaves the other.
revoke all on function app.guard_invoice_void() from anon, authenticated, public;

comment on function app.guard_invoice_void() is
  'Belt and braces over the column grant on fee_invoices. Refuses a DELETE, refuses '
  'any rewrite of what was billed — including what it was billed for — refuses '
  'cancelling a bill that holds money, refuses waiving a fee on a cancelled bill, and '
  'stamps who cancelled or discounted it and when rather than taking either from the '
  'client.';

