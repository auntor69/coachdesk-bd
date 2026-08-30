-- Which branch paid this salary, kept where a transfer cannot rewrite it.
--
-- 20260811000049 stopped short and said why: "§8.3's per-branch profit cannot be built
-- because `salary_payments` has no branch_id … needs a snapshot column on
-- salary_payments first, on the same argument and in its own migration." This is that
-- migration, and the argument is 20260811000047's, one table further along.
--
-- MASTERPLAN.md §8.3 asks for "revenue and expenses per branch … A branch comparison
-- table where the branches are rows, so the owner can see which one is carrying the
-- others." Three of the four sides of that table already exist: fee invoices and fee
-- payments carry a branch from 20260811000047, and expenses carry one from
-- 20260811000045. Payroll is the fourth side, and it is the largest number on it —
-- salaries are most of what a coaching centre spends — so a comparison table without it
-- would not be wrong at the margin, it would be a table of the small half of each
-- branch's costs.
--
-- WHY THE PAYEE'S OWN BRANCH WILL NOT DO. `salary_payments` reaches a branch today by
-- joining to `employees` or `teachers`, both of which carry `branch_id`, and that join
-- answers the question wrongly in a way nobody would notice. A teacher moved from Mirpur
-- to Uttara in July takes every salary they were ever paid with them: last year's Mirpur
-- wage bill becomes Uttara's, the comparison table rewrites its own past, and an owner
-- reading it in August sees a different history from the one they read in June. §7.2
-- makes moving a person one UPDATE on purpose — that is the right design for a person —
-- which is exactly why the money cannot be derived from it.
--
-- So the branch that paid is stored on the payment. A snapshot, taken once, of a fact
-- that was true when the money left the centre and stays true afterwards.
--
-- AND ON `salary_payments` ALONE, NOT ON `salary_terms`. The pair in 20260811000047 was
-- the charge and the cash, because both are money and §8.3 divides one by the other. The
-- payroll pair is not that shape: a salary term is an agreement with a person, it has no
-- month and no amount that has landed anywhere, and nothing in §8.3 asks what a branch
-- has promised. Which branch a live agreement belongs to is a question about the person,
-- and the person's own row already answers it — correctly, and for the current month,
-- which is the only month an agreement is about. A snapshot there would be a second copy
-- of a fact that is allowed to change.
--
-- FILLED BY A TRIGGER, for the reason 20260811000042, 20260811000046 and 20260811000047
-- all give: a value the application supplies is a value the next code path forgets, and
-- here the forgetting is quiet — a null branch is not an error, it is a salary missing
-- from one row of the comparison table. The call site most likely to forget is the month
-- salary run, which pays a centre's whole staff in one loop, so the first month a branch
-- looked cheap would be a month it had paid everybody.
--
-- ON INSERT ONLY. There is no UPDATE branch in the function below: once written, the
-- snapshot does not follow the employee.
--
-- WHAT IS NOT HERE, and it is the same list 20260811000047 left. The RLS half — §8.2's
-- "a branch-scoped member reads and writes their branch, an HQ member reads and writes
-- all of them, and the check is in the database" — is §16's step 14, one policy written
-- across a dozen tables at once plus the cross-branch leak tests §8.2 asks for by name.
-- The per-branch profit view is not here either: 20260811000049 built the centre-wide one
-- beside the screen that reads it, and the branch comparison table has no screen yet.
-- This migration's job is to make sure that when both are written there is a column on
-- the payroll table holding the right value for every row that already exists — which is
-- a thing only a migration can do.

-- ---------------------------------------------------------------------------
-- 1. The column.
--
-- Nullable, and it will stay nullable, for 20260811000047's reason: most centres are one
-- location and a single-branch centre has nothing to put here.
--
-- Composite, per 20260811000005, so this centre's salary cannot be filed under another
-- centre's branch. The column list on SET NULL is what 20260811000043, 20260811000045 and
-- 20260811000047 all needed and for the same reason — a bare `set null` would try to null
-- coaching_center_id, which is NOT NULL, and closing a branch would fail rather than
-- releasing what it paid.
--
-- SET NULL RATHER THAN BLOCKING THE DELETE, consistent with the other five tables that
-- carry this column, and here it costs a little more than it does there: delete the Mirpur
-- branch and last year's Mirpur wage bill becomes unattributed, which is the largest figure
-- on that branch's side of §8.3. The alternative costs more still — a branch that has ever
-- paid anybody could never be removed — and a centre that wants the history kept closes
-- the branch rather than deleting it, which is what `branches.active` has been for since
-- 20260811000001.
-- ---------------------------------------------------------------------------

alter table public.salary_payments add column branch_id uuid;

alter table public.salary_payments
  add constraint salary_payments_branch_id_center_fkey
  foreign key (branch_id, coaching_center_id)
  references public.branches (id, coaching_center_id) on delete set null (branch_id);

-- Partial, like the other five: a single-branch centre leaves this null on every row, and
-- an index of nulls is bytes that answer nothing.
--
-- ON for_month, WHERE fee_payments_branch_idx IS ON paid_at desc, and the difference is
-- deliberate rather than drift. 20260811000044 had to make this choice once already —
-- "on for_month and not paid_at, because that is the month it belongs to whatever day it
-- left the drawer" — and §9.5's whole point is that December's salary handed over in
-- January is December's cost. `center_profit_month` groups the payroll side by for_month
-- for exactly that reason, so a per-branch version of it has to as well, or the two
-- disagree every January. Money coming in has no such distinction: a fee payment is dated
-- by the day it arrived.
create index salary_payments_branch_idx
  on public.salary_payments (branch_id, for_month)
  where branch_id is not null;

comment on column public.salary_payments.branch_id is
  'The branch that paid this salary, snapshotted on insert. Not a join through the '
  'employee or teacher: moving a person between branches is one UPDATE by design, and '
  'the salaries they have already been paid must not move with them.';

-- ---------------------------------------------------------------------------
-- 2. The rows that already exist.
--
-- Every salary payment in the database predates this column, so its branch has to come from
-- the only place it is recorded: the payee's current one. That is the best available answer
-- and it is not always the right one — somebody who changed branch before this migration
-- ran has all of their old salaries attributed to the new branch, and nothing in the
-- database can now tell them apart. It is also a problem that cannot recur: from the trigger
-- below onwards every new row is stamped as it is written. Worth knowing rather than worth
-- hiding, because an owner comparing branches across this date should know why the line
-- moves.
--
-- TWO STATEMENTS AND NOT A COALESCE, because `salary_payments_one_payee` makes exactly one
-- of the payee columns non-null on every row. The two updates therefore touch disjoint sets
-- of rows, neither can overwrite the other, and the order between them says nothing.
--
-- WITH THE AUDIT TRIGGER OFF, AND THAT IS NOT A CONVENIENCE — 20260811000047's sentence,
-- and it holds harder here. 20260811000046 promises the log answers "my manager says he
-- never entered that". A backfill left audited would put one line per payment into every
-- centre's log, each saying `branch_id` changed with no actor beside it, and on the payroll
-- table of all places those lines would be the first thing an owner ever saw in an audit
-- log they will one day use to settle a wage dispute. A backfill is not an event. Nobody
-- did it, so the log must not claim somebody did.
--
-- There is no `updated_at` trigger to disable beside it, and no oversight in that:
-- 20260811000044 gave this table `created_at` and `paid_at` and no `updated_at` at all,
-- because a payment is not edited. The immutability guard stays on, and unlike the audit
-- trigger it needs no suppressing — it refuses `voucher_no` for everybody and ten other
-- columns for a browser session, and the statements below write neither.
-- ---------------------------------------------------------------------------

alter table public.salary_payments disable trigger salary_payments_audit;

update public.salary_payments p
   set branch_id = e.branch_id
  from public.employees e
 where e.id = p.employee_id
   and e.branch_id is not null;

update public.salary_payments p
   set branch_id = t.branch_id
  from public.teachers t
 where t.id = p.teacher_id
   and t.branch_id is not null;

alter table public.salary_payments enable trigger salary_payments_audit;

-- ---------------------------------------------------------------------------
-- 3. The stamp.
--
-- ONE FUNCTION WITH A BRANCH INSIDE IT, where 20260811000047 wrote two. That split was
-- between two tables, each reading a different table to find its answer; this is one table,
-- one column and one insert path, and which lookup applies is decided by the row in front of
-- it. Two functions here would mean two triggers on the same table with WHEN clauses that
-- have to keep agreeing about which of them fires — the same code with a condition moved
-- somewhere harder to read.
--
-- The `else` rather than a second `if new.teacher_id is not null`, because
-- `salary_payments_one_payee` makes those the same test. A row-level BEFORE trigger runs
-- ahead of the check constraints, so this function may not assume the row is valid — only
-- that an invalid one will not survive the statement. A row with both payee columns null
-- reads its branch as null here and is refused by the constraint a moment later, which is
-- the right order for those two complaints.
--
-- SECURITY DEFINER, PINNED, and the reason is one step further out than 20260811000047's.
-- There the INVOKER failure is reachable today: a teacher taking a fee payment under §6.5
-- cannot necessarily read the student. Here everybody who can insert a salary payment is a
-- staff admin, and both payee tables' read policies are centre-wide, so an INVOKER lookup
-- would work — today. §8.2's branch policies are step 14, and what they say is that a
-- branch-scoped member reads their branch. The day that lands, an INVOKER lookup would
-- return no row for precisely the cross-branch payment somebody needed attributed, the
-- insert would still succeed, and the salary would go missing from one line of §8.3's
-- table. Silence is the failure mode this whole file exists to prevent, and it costs
-- nothing to close now rather than to remember later.
--
-- Nothing is widened by the elevation. The function reads exactly one row, named by a
-- foreign key the caller had to satisfy anyway, and returns one uuid into a column whose own
-- composite key refuses any branch outside this centre. There is no argument a caller can
-- pass and no row they can reach that they could not already reach.
--
-- If the payee has no branch the payment has no branch, which is the correct answer for
-- every single-location centre in the country.
-- ---------------------------------------------------------------------------

create or replace function app.stamp_salary_payment_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is null then
    if new.employee_id is not null then
      select e.branch_id into new.branch_id
      from public.employees e
      where e.id = new.employee_id;
    else
      select t.branch_id into new.branch_id
      from public.teachers t
      where t.id = new.teacher_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists salary_payments_stamp_branch on public.salary_payments;

create trigger salary_payments_stamp_branch
  before insert on public.salary_payments
  for each row execute function app.stamp_salary_payment_branch();

-- ---------------------------------------------------------------------------
-- 4. Who may change it: nobody with a browser, and no new statement was needed.
--
-- 20260811000044 revoked UPDATE on this table wholesale and handed back two named columns,
-- `reference` and `note`. A column grant is a list of what is allowed, so a column added
-- afterwards is refused by default — `branch_id` is unwritable from a session the moment it
-- exists, without this file saying anything. 20260811000047 named that property the first
-- time it paid off; this is the second, and it is the reason that migration's closing
-- sentence about widening being "a deliberate act" was worth writing down.
--
-- INSERT IS A DIFFERENT QUESTION, and the answer is deliberate. The function above fills
-- only a null, so a staff admin may name a branch on the insert and it will be respected —
-- which is what lets a later HQ screen record a payment made on one branch's behalf without
-- a second write path. What bounds it is the composite key: the branch has to be one of this
-- centre's. So the worst a browser can do is file its own centre's salary under its own
-- centre's wrong branch, which is a data entry mistake of the same kind as the wrong month,
-- and it has the same remedy — a reversing negative row, per section 7 of 20260811000044.
--
-- AND branch_id IS DELIBERATELY ABSENT FROM app.guard_salary_payment_immutable(). Ten
-- columns are refused there for a browser session and `voucher_no` for everybody, and this
-- one must be in neither list. It is the landmine this schema has now walked into five times
-- — 20260811000042 dropped a foreign key for it, 20260811000044 chose NO ACTION,
-- 20260811000046 skips writing a log line for it, 20260811000047 says all of this about the
-- fee tables — and on this table it is sharper than it was there. That guard is SECURITY
-- INVOKER and reads `current_user`, treating service_role, postgres and supabase_admin as
-- the server and every other caller as a browser. An owner closing a branch through the app
-- is `authenticated`. The SET NULL in section 1 is an UPDATE, performed by the system, and a
-- row trigger fires for it exactly as it would for an edit. In the ten-column list,
-- branch_id would therefore make any branch that has ever paid anybody undeletable by its
-- own owner, for ever, with an error message about rewriting a payslip that names no branch
-- and no delete. In the `voucher_no` position it would take service_role down with it.
--
-- Nothing is lost by leaving it out. The grant already refuses every caller a browser can
-- be, and the referential action is the only other writer.
-- ---------------------------------------------------------------------------

-- Per the convention in 20260811000010. It is in `app`, which PostgREST does not expose, and
-- it returns `trigger`, which PostgREST would refuse anyway — and a firing trigger never
-- consults EXECUTE. Revoked regardless, and this one is SECURITY DEFINER, which is the case
-- where "a function nobody should call by name should not be callable by name" stops being
-- tidiness. `public` and `anon` are named separately because Supabase's default privilege
-- grants EXECUTE to the role directly rather than through PUBLIC, so revoking one leaves the
-- other.

revoke all on function app.stamp_salary_payment_branch() from anon, authenticated, public;
