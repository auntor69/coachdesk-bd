-- Which branch billed this, kept where it cannot be rewritten by a transfer.
--
-- MASTERPLAN.md §8.2 lists what has to become branch-scoped and names both of these
-- tables: "Students, batches, teachers, employees, attendance, exams, marks, fee
-- invoices, fee payments, expenses, payroll, reports, dashboards, and permissions."
-- §8.3 says what the scoping is for: "revenue and expenses per branch, students per
-- branch, collection rate per branch … A branch comparison table where the branches are
-- rows, so the owner can see which one is carrying the others."
--
-- Six tables already carry `branch_id` — center_members, teachers, batches, students,
-- notices from 20260811000001, and employees and expenses from the two migrations
-- before this one. Attendance, exams and marks need no column of their own: they reach a
-- branch through `batch_id`, and a batch does not move, because a batch is a room in a
-- building at a time of day. §8.4 says so in as many words — "Rooms and timetables are
-- physical and do not pool."
--
-- WHICH LEAVES THE TWO MONEY TABLES, AND THEY ARE LEFT FOR A REASON RATHER THAN BY
-- OVERSIGHT. They are the two whose subject moves. §7.2 spells out how a student changes
-- branch: "one row, `branch_id` updated, and a transfer history record". That is the
-- right design and 20260811000042 built the history for it — but it means the sentence
-- "this invoice belongs to the Mirpur branch" cannot be answered by joining to the
-- student, because next month the student is at Uttara and the join now says last
-- quarter's Mirpur revenue was always Uttara's. §8.3's comparison table would rewrite
-- itself every time a centre moved a child, and the owner would be reading a different
-- past each time they opened it.
--
-- So the branch that billed is stored on the bill. A snapshot, taken once, of a fact
-- that was true when the money was charged and stays true afterwards.
--
-- A PAYMENT TAKES ITS BRANCH FROM THE INVOICE AND NOT FROM THE COUNTER, which is the
-- one decision here somebody could reasonably make the other way. A family from the
-- Mirpur branch can hand cash to whoever is at the Uttara desk, and "where was this
-- money received" is a real question. It is not, however, the question §8.3 asks.
-- Collection rate per branch is collected over charged; charge is grouped by the branch
-- that billed, so if collection is grouped by the desk that took the note then the two
-- halves of the ratio count different things and the ratio is not a rate. One branch
-- with a convenient car park would appear to be collecting more than it billed.
--
-- If a centre later needs the desk, that is a second column answering a second question,
-- added by the migration that ships the screen asking it. It is not this one.
--
-- FILLED BY A TRIGGER, for the reason 20260811000042 and 20260811000046 both give: a
-- value the application supplies is a value the next code path forgets, and here the
-- forgetting is quiet — a null branch is not an error, it is an invoice missing from one
-- row of the comparison table. The call site most likely to forget is the month-close
-- generator, which raises every invoice a centre has in one statement, so the first
-- month a branch looks cheap would be the month it was busiest.
--
-- ON INSERT ONLY, and that is the whole point of the exercise. There is no UPDATE branch
-- in either function: once written, the snapshot does not follow the student.
--
-- WHAT IS NOT HERE. The RLS half. §8.2's rule — "A branch-scoped member reads and writes
-- their branch. An HQ member reads and writes all of them. There is no third answer, and
-- the check is in the database" — is §16's step 14, and it needs the same policy written
-- across a dozen tables at once plus the cross-branch leak tests §8.2 asks for by name.
-- Doing half of it here would leave the schema in the state §8.1 already complains about:
-- a column that exists and nothing that reads it. This migration's job is to make sure
-- that when those policies are written, there is a column on the money tables for them to
-- be written against — and that it holds the right value for every row that already
-- exists, which is a thing only a migration can do.

-- ---------------------------------------------------------------------------
-- 1. The columns.
--
-- Nullable, and it will stay nullable, because most centres are one location and a
-- single-branch centre has nothing to put here. §8.1 is about the tier above them.
--
-- Composite, per 20260811000005, so this centre's invoice cannot be filed under another
-- centre's branch. The column list on SET NULL matters for the reason 20260811000043 and
-- 20260811000045 both give: a bare `set null` would try to null coaching_center_id, which
-- is NOT NULL, and closing a branch would fail rather than releasing what it billed.
--
-- SET NULL RATHER THAN BLOCKING THE DELETE, consistent with employees and expenses, and
-- it does cost something: delete the Mirpur branch and last year's Mirpur revenue becomes
-- unattributed. The alternative costs more — a branch that ever raised an invoice could
-- never be removed, for ever, which is not a promise to make to somebody reorganising
-- their business. A centre that wants the history kept closes the branch instead of
-- deleting it, which is what `branches.active` has been for since 20260811000001 and what
-- §16's step 13 should offer as the ordinary path.
-- ---------------------------------------------------------------------------

alter table public.fee_invoices add column branch_id uuid;
alter table public.fee_payments add column branch_id uuid;

alter table public.fee_invoices
  add constraint fee_invoices_branch_id_center_fkey
  foreign key (branch_id, coaching_center_id)
  references public.branches (id, coaching_center_id) on delete set null (branch_id);

alter table public.fee_payments
  add constraint fee_payments_branch_id_center_fkey
  foreign key (branch_id, coaching_center_id)
  references public.branches (id, coaching_center_id) on delete set null (branch_id);

-- §8.3's comparison, one index per side of it. Partial for the reason employees' and
-- expenses' branch indexes are: a single-branch centre leaves this null on every row, and
-- an index of nulls is bytes that answer nothing.
create index fee_invoices_branch_idx
  on public.fee_invoices (branch_id, period_month)
  where branch_id is not null;

create index fee_payments_branch_idx
  on public.fee_payments (branch_id, paid_at desc)
  where branch_id is not null;

comment on column public.fee_invoices.branch_id is
  'The branch that raised this bill, snapshotted on insert. Not a join through the '
  'student: a student moves branches and the bill must not move with them, or the '
  'per-branch comparison rewrites its own past.';

comment on column public.fee_payments.branch_id is
  'Copied from the invoice, not from the desk that took the money. Collection rate per '
  'branch divides collected by charged, and the two have to be grouped by the same thing.';

-- ---------------------------------------------------------------------------
-- 2. The rows that already exist.
--
-- Every invoice and every payment in the database predates this column, so their branch
-- has to come from the only place it is recorded: the student's current one. That is the
-- best available answer and it is not always the right one — a student who transferred
-- before this migration ran will have their old branch's invoices attributed to the new
-- branch, and nothing in the database can now tell them apart. It is also a problem that
-- cannot recur: from the trigger below onwards, every new row is stamped at the moment it
-- is written. Worth knowing rather than worth hiding, because an owner comparing branches
-- across this date should know why the line moves.
--
-- WITH THE AUDIT TRIGGER OFF, AND THAT IS NOT A CONVENIENCE. 20260811000046 promises the
-- log answers "my manager says he never entered that". A backfill left audited would put
-- one line per invoice into every centre's log, each saying `branch_id` changed with no
-- actor beside it — and because it runs the moment this migration applies, those lines
-- would be the first thing any owner ever saw in their audit log. A backfill is not an
-- event. Nobody did it, so the log must not claim somebody did.
--
-- `updated_at` off for the same reason on the invoice side: nobody updated the invoice,
-- and a `last modified` that jumps for the whole table on a Tuesday is a column that has
-- stopped meaning anything. The immutability guards stay on — this runs as the migration
-- role, which they already treat as the server, so there is nothing to suppress and
-- disabling them would only widen what this file is allowed to do.
-- ---------------------------------------------------------------------------

alter table public.fee_invoices disable trigger fee_invoices_audit;
alter table public.fee_invoices disable trigger fee_invoices_updated_at;
alter table public.fee_payments disable trigger fee_payments_audit;

update public.fee_invoices i
   set branch_id = s.branch_id
  from public.students s
 where s.id = i.student_id
   and s.branch_id is not null;

-- From the invoice rather than the student, so the two sides agree even where the student
-- has since moved and the invoice was stamped by the line above.
update public.fee_payments p
   set branch_id = i.branch_id
  from public.fee_invoices i
 where i.id = p.invoice_id
   and i.branch_id is not null;

alter table public.fee_invoices enable trigger fee_invoices_audit;
alter table public.fee_invoices enable trigger fee_invoices_updated_at;
alter table public.fee_payments enable trigger fee_payments_audit;

-- ---------------------------------------------------------------------------
-- 3. The stamp.
--
-- Two functions rather than one, and the split is the one 20260811000045 argued for its
-- three voucher counters rather than the one 20260811000046 argued for its single audit
-- trigger. The audit trigger could be generic because `to_jsonb` takes a row of any shape
-- and needed nothing from any other table. These two each read a different table to find
-- their answer, so a generic version would be a CASE on `tg_table_name` wrapping two
-- lookups — the same code with a branch in front of it, and one more thing to get wrong.
--
-- SECURITY DEFINER, PINNED, and this one is worth stating plainly because SECURITY INVOKER
-- is the default this schema prefers. The lookup reads the student's row, and a teacher
-- taking a payment for their own batch under §6.5's `can_view_fees` may not be able to
-- read every student their centre bills. Under INVOKER their lookup returns no row, the
-- branch comes out null, the insert succeeds, and the invoice is simply absent from one
-- line of §8.3's table. Silence is the failure mode this whole file exists to prevent.
--
-- Nothing is widened by the elevation. Each function reads exactly one row, named by a
-- foreign key the caller had to satisfy anyway, and returns one uuid into a column whose
-- own composite key refuses any branch outside this centre. There is no argument a caller
-- can pass and no row they can reach that they could not already reach.
--
-- If the student has no branch the invoice has no branch, which is the correct answer for
-- every single-location centre in the country.
-- ---------------------------------------------------------------------------

create or replace function app.stamp_invoice_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is null then
    select s.branch_id into new.branch_id
    from public.students s
    where s.id = new.student_id;
  end if;

  return new;
end;
$$;

drop trigger if exists fee_invoices_stamp_branch on public.fee_invoices;

create trigger fee_invoices_stamp_branch
  before insert on public.fee_invoices
  for each row execute function app.stamp_invoice_branch();

create or replace function app.stamp_payment_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is null then
    select i.branch_id into new.branch_id
    from public.fee_invoices i
    where i.id = new.invoice_id;
  end if;

  return new;
end;
$$;

drop trigger if exists fee_payments_stamp_branch on public.fee_payments;

create trigger fee_payments_stamp_branch
  before insert on public.fee_payments
  for each row execute function app.stamp_payment_branch();

-- ---------------------------------------------------------------------------
-- 4. Who may change it: nobody with a browser, and no new statement was needed.
--
-- 20260811000028 and 20260811000030 revoked UPDATE on fee_invoices wholesale and handed
-- back four named columns; 20260811000017 did the same for fee_payments and handed back
-- two. A column grant is a list of what is allowed, so a column added afterwards is
-- refused by default — `branch_id` is unwritable from a session on both tables the moment
-- it exists, without this file saying anything. That is the property those two migrations
-- were reaching for when they chose a column list over a trigger check, and it is worth
-- naming here because it is the first time it has paid off.
--
-- AND branch_id IS DELIBERATELY ABSENT FROM BOTH IMMUTABILITY GUARDS. Every other column
-- that decides what a receipt says is listed in `app.guard_payment_immutable` and refused
-- there as well as by the grant. This one must not be, and the reason is the landmine this
-- schema has now walked into four times — 20260811000042 dropped a foreign key for it,
-- 20260811000044 chose NO ACTION, 20260811000046 skips writing a log line for it. The
-- SET NULL above is an UPDATE, performed by the system when a branch is deleted, and a
-- row trigger fires for it exactly as it would for a browser. A guard that refused a
-- change to branch_id would therefore make any branch that has ever taken a payment
-- undeletable, permanently, with an error message about rewriting receipts that names no
-- branch and no delete.
--
-- Nothing is lost by leaving it out. The grant already refuses every caller a browser can
-- be, and the referential action is the only other writer.
-- ---------------------------------------------------------------------------

-- Per the convention in 20260811000010. Both are in `app`, which PostgREST does not
-- expose, and both return `trigger`, which PostgREST would refuse anyway — and a firing
-- trigger never consults EXECUTE. Revoked regardless, and these two are SECURITY DEFINER,
-- which is the case where "a function nobody should call by name should not be callable by
-- name" stops being tidiness. `public` and `anon` are named separately because Supabase's
-- default privilege grants EXECUTE to the role directly rather than through PUBLIC, so
-- revoking one leaves the other.

revoke all on function app.stamp_invoice_branch() from anon, authenticated, public;
revoke all on function app.stamp_payment_branch() from anon, authenticated, public;




