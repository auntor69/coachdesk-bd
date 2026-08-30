-- A branch-scoped member sees one branch, and the check is in the database.
--
-- MASTERPLAN.md §8.1 describes the state this file ends: "`branch_id` is loaded into the
-- session and then never used again — three references in the whole of `src/`, all in one
-- file. The branches RLS policy is centre-wide: any member of the organisation can read
-- and write every branch's rows. So today an Institution is a Center with a table nobody
-- consults, and a branch manager can see every branch."
--
-- §8.2 states the rule in one sentence and it is the whole design:
--
--   > A branch-scoped member reads and writes their branch. An HQ member reads and
--   > writes all of them. There is no third answer, and the check is in the database.
--
-- NOT IN A QUERY FILTER, and §8.2 says why better than this comment could: "a
-- branch-scoped `.eq('branch_id', …)` in application code is one forgotten call site away
-- from a cross-branch leak, and the call site that forgets will be a report — the screen
-- where the leak is largest and least visible." Every screen in this product that reads
-- money reads it through a view or a count, which is precisely the shape of query whose
-- WHERE clause nobody checks twice.
--
-- RESTRICTIVE POLICIES, NOT A REWRITE OF THE HUNDRED THAT EXIST. There are 102 policies in
-- this schema. Branch scoping could be spelled by adding `and app.branch_ok(...)` to each
-- relevant `using` clause, and that would mean one migration editing every access rule in
-- the product, where the cost of a typo is a policy that got WIDER and no test that fails.
-- A RESTRICTIVE policy is ANDed with whatever permissive policies a table already has, so
-- this file does not touch one of them: the existing rules keep deciding who belongs to the
-- centre and which role may reach what, and this file adds one further sentence to all of
-- them at once. The rule then lives in one place, which is what somebody auditing "can the
-- Mirpur manager see Uttara's payroll" actually needs to read.
--
-- NOTHING CHANGES FOR ANY CENTRE TODAY, AND THAT IS THE POINT OF LANDING IT NOW.
-- `center_members.branch_id` is null on every row in every centre, because no screen sets
-- it yet. A member with no branch is HQ. So every policy below evaluates to true for
-- everybody, in every centre, until an owner pins somebody to a branch — and the pinning
-- screen is the next commit. That order is deliberate: the rule goes in first, proven from
-- a hostile client by the leak tests §8.2 asks for by name, so that the screen which
-- switches it on cannot be the thing that also has to get it right.
--
-- WHAT IS NOT HERE.
--   * The screens: a branch picker on the staff form, the branch list, a branch on the
--     spending form. That is the other half of §16's step 13 and it is a separate commit,
--     because a policy and a form fail in different ways and should not be reviewed as one
--     change.
--   * The shared capacity pool and its three warning thresholds — step 14, and it needs
--     this. Note that the pool is deliberately untouched by everything below: §17 settles
--     that "capacity pools at the organisation, not the branch", a place being a licence
--     rather than a chair, and `app.active_students` is SECURITY DEFINER, so no policy in
--     this file can narrow the count that enforces it. A branch manager admitting their
--     branch's 40th student is still counted against the organisation's 300.
--   * The branch comparison table — §8.3, and the reason the five snapshot columns exist.
--     Reporting comes last, on settled data, which is what §16 has said all along.
--   * Batches capped per branch (§8.4). That is a count in a guard, not a policy, and it
--     belongs beside the screen that creates a batch.
--
-- ONE CONSEQUENCE WORTH STATING BEFORE SOMEBODY FINDS IT. The eight finance views are
-- `security_invoker`, so the moment a member is pinned to a branch, `center_profit_month`
-- and its siblings start answering with that branch's slice of the month rather than the
-- organisation's. That is §8.2's rule reaching the dashboard exactly as intended, and the
-- figures are true — but the card above them is titled for a centre, not a branch. Fixing
-- the label is §8.3's work, where a per-branch figure is finally something the screen is
-- allowed to say out loud.

-- ---------------------------------------------------------------------------
-- 1. The predicate, once.
--
-- Two sentences, and the second one is not decoration:
--
--   1. my membership at this centre covers this row — either it names the row's branch, or
--      it names no branch at all, which is what HQ is;
--   2. or I hold no membership at this centre, which is not this policy's question.
--
-- THE SECOND DISJUNCT IS THE FOUNDER. Support reads run as a signed-in user holding
-- `profiles.is_platform_admin` and no `center_members` row anywhere — that is the whole
-- design of `app.is_platform_admin`, and seventeen policy clauses across the schema are
-- written on it. A restrictive policy demanding a membership row would refuse the founder on
-- every table in the product at once, and turn every support request into a database
-- console. Nothing is widened by it: a stranger with no membership is already refused by
-- the permissive policies, which are the ones that decide who is in the centre.
--
-- A ROW WITH NO BRANCH IS NOT EVERYBODY'S ROW. `m.branch_id = branch` is NULL when the row
-- carries no branch, so a pinned member is refused it, and that strictness is chosen. In a
-- centre that has branches but has not yet filed some rows under one — every row written
-- before the picker exists, and every payment whose payee has no branch — those rows are
-- visible to HQ and to nobody else. The alternative, treating an unfiled row as shared,
-- reads well until a report runs over it: each branch's total would silently include the
-- same unattributed rows, every branch would look bigger than it is, and the sum of the
-- branches would not be the organisation. Loud and missing beats quiet and wrong, which is
-- the same call `app.branch_ok`'s callers make about a failed read everywhere else.
--
-- SECURITY DEFINER, PINNED, AND NOT OPTIONAL. This reads `public.center_members`, which
-- gets a restrictive policy of its own below — one that calls this function. Under INVOKER
-- that is infinite recursion, and Postgres says so at query time rather than at migration
-- time. Every helper in 20260811000002 is SECURITY DEFINER for this reason; this is the
-- first one where the recursion would be through the function's own policy.
--
-- STABLE, so a policy can be evaluated once per statement against a snapshot rather than
-- re-read per row. Unlike `app.active_students`, nothing here is racing a concurrent
-- insert: a membership that changes mid-statement is not a hole, it is a manager whose
-- branch was reassigned while a page was loading.
--
-- AND NOT REVOKED FROM `authenticated`, unlike the trigger functions in 20260811000047 and
-- 20260811000052. A policy expression is evaluated as the querying role, so this function
-- has to be executable BY that role or every query on every table below fails with a
-- permission error. It is in `app`, which PostgREST does not expose, so it is not callable
-- over the wire regardless — and a caller who did reach it would learn one boolean about
-- their own membership, which they can read from their own row anyway.
-- ---------------------------------------------------------------------------

create or replace function app.branch_ok(center uuid, branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.center_members m
    where m.user_id = auth.uid()
      and m.active
      and m.coaching_center_id = center
      and (m.branch_id is null or m.branch_id = branch)
  )
  or not exists (
    select 1
    from public.center_members m
    where m.user_id = auth.uid()
      and m.active
      and m.coaching_center_id = center
  );
$$;

comment on function app.branch_ok(uuid, uuid) is
  'True when the signed-in member may reach a row in this centre filed under this branch: '
  'HQ members (no branch on their membership) reach every branch, a pinned member reaches '
  'only theirs and never an unfiled row, and a non-member is left to the permissive '
  'policies. Called from restrictive policies, so it must stay executable.';

-- ---------------------------------------------------------------------------
-- 2. The eleven tables that carry a branch of their own.
--
-- `as restrictive for all to authenticated`, and each word is load-bearing:
--
--   restrictive     ANDed with the table's existing policies instead of adding a way in.
--                   A permissive policy here would GRANT every member every branch, which
--                   is the opposite of this file.
--   for all         one policy per table rather than four. WITH CHECK is omitted
--                   throughout, and Postgres then uses the USING expression for it, so a
--                   write has to land in a branch the writer can reach. That is the half
--                   of §8.2 a filter in application code never covers: "reads AND writes
--                   their branch."
--   to authenticated
--                   the only role that reaches these tables through PostgREST.
--                   `service_role`, `postgres` and `supabase_admin` bypass RLS entirely,
--                   which is what keeps the migration above and the founder's admin client
--                   working, and is the same boundary every other policy in this schema
--                   draws.
--
-- WRITES ARE CHECKED AFTER THE STAMP TRIGGERS RUN. On the four money tables the branch is
-- filled by a BEFORE INSERT trigger (20260811000047 and 20260811000052), and WITH CHECK is
-- evaluated on the row as those triggers left it. So a Mirpur manager billing a Mirpur
-- student passes, and the same manager billing an Uttara student is refused by the branch
-- the trigger just stamped from that student — not by a filter the screen might forget, and
-- not by an error about the student, which they can already see is not theirs.
--
-- AN HQ ROLE WINS OVER A PINNED ONE, which falls out of `app.branch_ok` reading every
-- membership row rather than one. `center_members` is unique on (centre, user, role), so a
-- person can be the organisation's manager and also a teacher at Mirpur; the manager row
-- carries no branch, so it covers everything, and the teacher row does not take that away.
-- The alternative — narrowest role wins — would mean an owner who also teaches losing the
-- organisation.
-- ---------------------------------------------------------------------------

-- The organisation's shape. A pinned member reads the row for their own branch and no
-- other: they need its name on their screens, and which other locations exist, what they
-- are called and where they are is the owner's business rather than a branch manager's.
create policy branches_branch_scope on public.branches
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, id));

-- §8.2 lists "permissions" among the things that have to become branch-scoped, and this is
-- where that lands: a Mirpur manager sees Mirpur's staff. They do not see the owner's own
-- membership row, because HQ is not a branch and the strict reading of §8.2 refuses it —
-- which is right, since a staff list that shows HQ to every branch manager is how one
-- branch's manager learns who else administers the organisation. Their own row is always
-- visible: it is the row they are pinned to.
create policy center_members_branch_scope on public.center_members
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, branch_id));

-- The people.
create policy teachers_branch_scope on public.teachers
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, branch_id));

create policy employees_branch_scope on public.employees
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, branch_id));

create policy students_branch_scope on public.students
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, branch_id));

-- The teaching. Batches are the spine of teacher scoping — `app.my_batch_ids` and
-- `app.teaches_batch` both read them — so this policy is also what narrows attendance and
-- marks for a teacher whose membership is pinned, before section 3 says a word about
-- either.
create policy batches_branch_scope on public.batches
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, branch_id));

-- A notice already carries a branch precisely because a notice is posted to one location.
create policy notices_branch_scope on public.notices
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, branch_id));

-- The money, and the reason the five snapshot columns were worth their own migrations.
-- §8.2 warns that the call site which forgets a branch filter will be a report; every one
-- of these four tables is summed by a view that a screen reads without naming a branch at
-- all, and this is what makes those views answer honestly for a pinned member.
create policy fee_invoices_branch_scope on public.fee_invoices
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, branch_id));

create policy fee_payments_branch_scope on public.fee_payments
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, branch_id));

create policy expenses_branch_scope on public.expenses
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, branch_id));

create policy salary_payments_branch_scope on public.salary_payments
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, branch_id));

-- ---------------------------------------------------------------------------
-- 3. The fifteen tables that reach a branch through their parent.
--
-- Attendance, marks, enrolments, guardians, the four tap-to-send logs, the salary
-- agreements and the staff permission rows carry no branch of their own, and should not:
-- a mark belongs to an exam, an exam belongs to a batch, and a batch is what belongs to a
-- location. §8.2 names attendance, exams, marks and permissions anyway, because a report
-- over any of them leaks exactly as much as a report over the parent.
--
-- SO THE BRANCH IS LOOKED UP, THROUGH ONE SMALL PINNED FUNCTION PER PARENT KIND. Seven of
-- them, each a primary-key read returning one uuid, and the policies below are then all the
-- same sentence: this row's branch, run past `app.branch_ok`. A reader auditing the file
-- does not have to hold a different rule in their head per table.
--
-- WHY NOT AN INLINE `exists (select 1 from public.students …)`, WHICH IS SHORTER. Because a
-- subquery written directly into a policy is evaluated as the querying role, so the parent's
-- own policies apply inside it — and those policies say a great deal more than "which
-- branch". A teacher can read their own batch's rows and not another teacher's; an inline
-- existence test would silently fold that rule into this file, so branch scoping would
-- change what a teacher sees about their own students. These functions are SECURITY DEFINER
-- and answer only the branch question, which leaves every existing policy deciding exactly
-- what it decided before. This file narrows by branch and by nothing else.
--
-- A NULL FROM ANY OF THEM MEANS THE SAME AS A NULL COLUMN IN SECTION 2: unfiled, therefore
-- HQ's and nobody else's. It is also what a deleted parent leaves behind, which cannot
-- happen through a foreign key here but can happen mid-transaction, and refusing is the
-- right answer for a row whose parent is gone.
--
-- WHAT THEY GIVE AWAY, SINCE THEY MUST STAY EXECUTABLE. Being DEFINER and callable, each one
-- will tell any signed-in caller the branch uuid behind a row uuid they already hold — no
-- name, no phone, no amount, and no way to walk from one uuid to the next. That is the same
-- bargain every helper in `app` already makes, and it is forced: a policy expression runs as
-- the querying role, so revoking EXECUTE here would refuse every read of these tables.
-- ---------------------------------------------------------------------------

create or replace function app.student_branch(student uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.branch_id from public.students s where s.id = student;
$$;

create or replace function app.batch_branch(batch uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.branch_id from public.batches b where b.id = batch;
$$;

create or replace function app.teacher_branch(teacher uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.branch_id from public.teachers t where t.id = teacher;
$$;

-- Two hops, because an attendance record names a session and a session names the batch.
create or replace function app.session_branch(session uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.branch_id
  from public.attendance_sessions a
  join public.batches b on b.id = a.batch_id
  where a.id = session;
$$;

create or replace function app.exam_branch(exam uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.branch_id
  from public.exams e
  join public.batches b on b.id = e.batch_id
  where e.id = exam;
$$;

-- One hop, and only one: an invoice carries its own branch since 20260811000047, so a
-- reminder's branch is the invoice's rather than the student's current one. The two differ
-- for exactly the family this snapshot exists for — one that moved branch after being
-- billed — and the reminder is about the bill.
create or replace function app.invoice_branch(invoice uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.branch_id from public.fee_invoices i where i.id = invoice;
$$;

-- A salary agreement names an employee or a teacher, never both and never neither, per
-- `salary_terms_one_payee`. The unused side reads as `id = null`, which returns no row, so
-- coalesce picks the side that exists without a CASE.
create or replace function app.payee_branch(employee uuid, teacher uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.branch_id from public.employees e where e.id = employee),
    (select t.branch_id from public.teachers t where t.id = teacher)
  );
$$;

-- Enrolments and the people around a student. The parent is the STUDENT and not the batch,
-- deliberately: a branch admits a student, and every one of these rows is a fact about that
-- student's schooling rather than about a room. A student enrolled in another branch's batch
-- would make the two answers differ, which is a thing the picker in the next commit should
-- refuse rather than a thing a policy should adjudicate.
create policy enrollments_branch_scope on public.enrollments
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.student_branch(student_id)));

create policy guardians_branch_scope on public.guardians
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.student_branch(student_id)));

-- The tap-to-send logs. Each one records a phone number that was dialled or messaged about
-- a child, which is the most private thing in the database and the least defensible to leak
-- sideways to another location's staff.
create policy absence_notices_branch_scope on public.absence_notices
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.student_branch(student_id)));

create policy progress_updates_branch_scope on public.progress_updates
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.student_branch(student_id)));

create policy result_notices_branch_scope on public.result_notices
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.student_branch(student_id)));

-- A transfer is scoped by where the student is NOW, which is `to_branch_id` after the move.
-- So the receiving branch's manager sees the arrival and the sending branch's manager stops
-- seeing the record — and HQ, who authorised it, sees the whole history. That is the right
-- reading: the row exists to answer "why is this student's branch different from last
-- month's", and the person who needs that answer is whoever has the student today.
create policy student_transfers_branch_scope on public.student_transfers
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.student_branch(student_id)));

-- The teaching, through the batch.
create policy batch_schedules_branch_scope on public.batch_schedules
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.batch_branch(batch_id)));

create policy attendance_sessions_branch_scope on public.attendance_sessions
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.batch_branch(batch_id)));

create policy attendance_records_branch_scope on public.attendance_records
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.session_branch(session_id)));

create policy exams_branch_scope on public.exams
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.batch_branch(batch_id)));

create policy exam_results_branch_scope on public.exam_results
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.exam_branch(exam_id)));

-- The staff rows that hang off a teacher. `teacher_permissions` is §8.2's "permissions" seen
-- from the other end: what a teacher at Mirpur is allowed to do is Mirpur's business.
create policy teacher_subjects_branch_scope on public.teacher_subjects
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.teacher_branch(teacher_id)));

create policy teacher_permissions_branch_scope on public.teacher_permissions
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.teacher_branch(teacher_id)));

-- What a person is paid, scoped to the branch that employs them. The payments themselves
-- carry their own branch (section 2); this is the agreement behind them.
create policy salary_terms_branch_scope on public.salary_terms
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.payee_branch(employee_id, teacher_id)));

-- A reminder is about a bill, so it follows the bill.
create policy fee_reminders_branch_scope on public.fee_reminders
  as restrictive for all to authenticated
  using (app.branch_ok(coaching_center_id, app.invoice_branch(invoice_id)));

-- ---------------------------------------------------------------------------
-- 4. The thirteen tables that stay whole, and why each one does.
--
-- Twenty-six of the schema's thirty-nine tables are scoped above. The rest are listed here
-- ON PURPOSE, so that the next person to add a table has a settled question to answer rather
-- than a silence to interpret: does this belong to a location, or to the organisation?
--
-- ONE BILL, ONE OWNER. `coaching_centers`, `subscriptions`, `payments`, `upgrade_requests`,
-- `plan_allowances`. A branch has no plan, buys no capacity and receives no invoice from us;
-- the organisation does. Scoping these would either hide the bill from the person paying it
-- or invent five subscriptions where the owner signed one. §17 settled this as "capacity
-- pools at the organisation, not the branch", and the money side follows the same line: a
-- second branch is something an owner opens, not something an owner is billed for twice.
--
-- ONE PERSON, MANY MEMBERSHIPS. `profiles` is a row per human being, not per centre — the
-- same teacher may hold a free personal plan and a job at somebody's centre, which is the
-- separation §5 insists on. There is no branch to put a person's own name and phone under.
--
-- SHARED CATALOGUES. `subjects`, `exam_types`, `sms_templates`. Physics is physics at every
-- branch, a mid-term is a mid-term, and a reminder's wording is the centre's voice. Splitting
-- these would give one organisation five spellings of the same subject and make a
-- cross-branch comparison meaningless, which is the exact report §8.3 is for.
--
-- ONE QUEUE. `sms_dispatches`, `sms_logs`, `sms_credit_ledger`. Credits are bought by the
-- organisation and spent from one balance, so a per-branch view of the ledger would show
-- five different balances for one pot of money. When a provider exists and a manager is shown
-- a send history, the send rows will need the recipient's branch to answer "who did MY branch
-- message" — that is a snapshot column like 47's and 52's, and it belongs to the commit that
-- builds the screen, not to this one.
--
-- AND ONE DEFERRAL, STATED PLAINLY. `audit_log` is not branch-scoped, and today that leaks
-- nothing: 20260811000046 opens it to `audit_log_owner_read` only, and an owner is HQ by
-- definition. The moment a branch manager is given a log screen, the log needs the branch of
-- the row it describes, which cannot be looked up after the fact for a row that has since
-- been deleted. So it is a column stamped at write time, in the migration that opens that
-- screen. Recorded here so that nobody reads this file's silence about `audit_log` as a
-- finding about `audit_log`.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. THE THREE NUMBER SERIES THAT ASSUMED EVERY READER SAW THE WHOLE CENTRE.
--
-- Found by the leak tests in scripts/test-rls.mjs and fixed here, in the migration that
-- broke it, rather than left for whoever hit it in production.
--
-- A receipt number, a salary voucher number and an expense voucher number are each the next
-- one up in that centre's book, and each is worked out the same way: lock the series for the
-- centre, then `select max(...) + 1` from the table itself. Those three functions are
-- SECURITY INVOKER, so that max is taken through the CALLER'S policies — and until section 2
-- of this file, that was safe, because anybody allowed to write one of these rows was also
-- allowed to read all of them. A branch manager is the first caller for whom that stopped
-- being true: they see Mirpur's eleven expenses, compute twelve, and collide with the
-- twelfth that Uttara wrote and they cannot see.
--
-- WHAT THE COLLISION DID, WHICH IS THE ONLY REASON THERE IS TIME TO FIX IT PROPERLY. The
-- unique index refused the insert. `expenses_center_voucher_key` and its two siblings are
-- what 20260811000017 called "loud, in front of somebody who can act on it" — a duplicate
-- number was never issuable, so no centre has two receipts numbered 12. The bug was a
-- refusal, not a corruption.
--
-- THE SERIES IS THE CENTRE'S AND NOT THE BRANCH'S, so the three functions become SECURITY
-- DEFINER and take the max over the whole organisation again. The alternative — a series per
-- branch — would be a product decision nobody has made, would need a wider unique index to
-- hold, and would give one owner five receipts numbered 12 to reconcile at the end of a
-- month. §9.9's printable receipt is one centre's book.
--
-- Nothing else in the schema has this shape. Every other function that aggregates over a
-- branch-scoped table is either already DEFINER (app.active_students, so 20260811000036's
-- capacity ceiling still counts the organisation, per §17), or reads only rows belonging to
-- the same parent the caller is already holding (app.guard_invoice_void and
-- app.guard_payment_floor sum the payments against one invoice, which is in the caller's own
-- branch by construction), or is reachable only with the service-role key (the SMS worker's
-- RPCs, shut to anon and authenticated). The three below are the whole list.
-- ---------------------------------------------------------------------------

create or replace function app.assign_receipt_no()
returns trigger
language plpgsql
security definer
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
  --
  -- DEFINER as of 20260811000053: this max is the centre's next receipt number, and a
  -- branch-pinned caller can no longer see the centre.
  select coalesce(pg_catalog.max(p.receipt_no), 0) + 1
    into new.receipt_no
  from public.fee_payments p
  where p.coaching_center_id = new.coaching_center_id;

  return new;
end;
$$;

create or replace function app.assign_salary_voucher_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- An explicit number is honoured, for the reason 20260811000017 gives: a centre
  -- moving off a paper voucher book has slips already numbered, and renumbering them
  -- makes every one an employee is holding point at the wrong row.
  if new.voucher_no is not null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('salary_payments.voucher_no'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  -- DEFINER as of 20260811000053, per the note above app.assign_receipt_no().
  select coalesce(pg_catalog.max(p.voucher_no), 0) + 1
    into new.voucher_no
  from public.salary_payments p
  where p.coaching_center_id = new.coaching_center_id;

  return new;
end;
$$;

create or replace function app.assign_expense_voucher_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.voucher_no is not null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('expenses.voucher_no'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  -- DEFINER as of 20260811000053, per the note above app.assign_receipt_no().
  select coalesce(pg_catalog.max(e.voucher_no), 0) + 1
    into new.voucher_no
  from public.expenses e
  where e.coaching_center_id = new.coaching_center_id;

  return new;
end;
$$;

-- CREATE OR REPLACE keeps a function's existing privileges, so the three revokes in
-- 20260811000017, 20260811000044 and 20260811000045 still hold. Re-stated anyway, because a
-- SECURITY DEFINER function that anybody may call is the one mistake in this schema that
-- would not announce itself, and because this file should be readable on its own.
revoke all on function app.assign_receipt_no() from anon, authenticated, public;
revoke all on function app.assign_salary_voucher_no() from anon, authenticated, public;
revoke all on function app.assign_expense_voucher_no() from anon, authenticated, public;
