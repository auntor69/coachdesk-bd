-- A new row is filed under the branch that wrote it, and no form has to ask.
--
-- 20260811000053 gave `center_members.branch_id` its meaning, and left one sentence in the
-- middle of itself that this file exists to answer:
--
--   > A ROW WITH NO BRANCH IS NOT EVERYBODY'S ROW. `m.branch_id = branch` is NULL when the
--   > row carries no branch, so a pinned member is refused it.
--
-- That is the right rule — a shared reading would put the same unattributed child in both
-- branches' reports, and the sum of the branches would stop being the organisation. But
-- EVERY ADD FORM IN THIS PRODUCT WRITES AN UNFILED ROW, because until the commit before
-- this one no screen could name a branch at all. Put those two facts together and a manager
-- pinned to Mirpur cannot admit a student, hire a teacher, open a batch, write down a
-- cleaner, record what the rent cost or post a notice. Not "can and then loses it" — the
-- restrictive policy reads `app.branch_ok(centre, null)` as false and refuses the insert,
-- with a message that names row-level security and no branch and no repair.
--
-- Nobody has hit it, because nobody is pinned: the screen that pins a member is still ahead
-- of this file, and that ordering is the whole reason this migration comes first. §16's
-- step 13 has three parts and they have to land in this order — the rule (53), the filing
-- (here), the pinning (next). A member pinned before their branch could hold anything would
-- open a roster that is empty and a form that refuses.
--
-- NOT A PICKER ON SIX FORMS, and §8.2's own argument is why: "a branch-scoped
-- `.eq('branch_id', …)` in application code is one forgotten call site away from a
-- cross-branch leak". A branch-scoped `<select name="branch">` on six add forms is the same
-- sentence with the same ending. Worse, for the reader this file is about it would be a
-- required select with exactly one option in it — a form asking a question it already knows
-- the answer to, six times, and each of the six a place to forget.
--
-- So the writer's own membership fills the column, in a BEFORE INSERT trigger, which is the
-- shape 20260811000047 and 20260811000052 already chose for the same problem one table
-- over. A column DEFAULT cannot do this: a default expression cannot read another column of
-- the row being inserted, and the centre is what decides which membership to look at.
--
-- WHAT THIS DOES NOT DO. It fills a null and nothing else. An HQ member's insert stays
-- unfiled exactly as it is today, so no centre in the country changes shape when this
-- applies — and a branch named on the insert is respected, which is what lets the head
-- office's own picker (the next commit's app work) file a row under a building the person
-- typing is not standing in.

-- ---------------------------------------------------------------------------
-- 1. Which branch the writer belongs to, or none.
--
-- THE SAME THREE ANSWERS AS app.branch_ok, IN THE SAME ORDER OF PRECEDENCE, and they have
-- to be or the stamp would file rows its own policy then refuses:
--
--   * HQ FILES NOTHING. A member with a null branch on any active membership in this centre
--     reads the whole organisation, so there is no branch that is theirs, and the honest
--     answer is the null the column already holds. This is why the `not exists` below
--     disqualifies on `other.branch_id is null` rather than ignoring those rows: somebody
--     who is a manager of the organisation and also a teacher at Mirpur is HQ — 53 settled
--     that "an HQ role wins over a pinned one because branch_ok reads every membership row"
--     — and stamping Mirpur onto their work would hide it from themselves.
--   * A PINNED MEMBER FILES UNDER THEIR PIN. The ordinary case, and the whole point.
--   * NOBODY ELSE FILES ANYTHING. A caller with no membership here — the founder, a cron
--     job, `service_role`, this migration itself — has no branch to be pinned to and
--     `auth.uid()` is frequently null besides. The subquery finds nothing and returns null,
--     which is why every fixture and every server-side writer in this repo is untouched by
--     this file.
--
-- AND ONE ANSWER OR NONE. `center_members` is unique on (centre, user, role), so one person
-- can hold two active memberships in one centre — manager and teacher is the common pair —
-- and nothing stops an owner pinning those two rows to two different buildings. There is no
-- branch to file under in that case, so nothing is filed, and the restrictive policy then
-- refuses the insert. That refusal is the right outcome and it is worth naming what it looks
-- like: a row-level security error, on a form, with nothing on the screen about branches.
-- The repair is on the membership screen, and the state is one an owner has to type on
-- purpose. Better than the alternative, which is to guess a building and file a year of one
-- branch's money into another's.
--
-- STABLE rather than volatile, for the reason 53 gives about the same read: a membership
-- that changes mid-statement is not a hole, it is a manager whose branch was reassigned
-- while a page was loading.
--
-- SECURITY DEFINER because `center_members` is itself branch-scoped as of 53, and an
-- INVOKER read would be the snake eating its tail — a pinned member reading their own
-- membership row through a policy that has to know their branch to let them see it. It
-- happens to work (`m.branch_id = branch` is true for their own row), and depending on that
-- coincidence to decide where a row gets filed is not a thing to leave for later.
--
-- Nothing is widened by the elevation. The function reads the caller's own membership rows
-- and returns one uuid from among them, which they can read from their own session anyway.
-- ---------------------------------------------------------------------------

create or replace function app.writer_branch(center uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.branch_id
  from public.center_members m
  where m.user_id = auth.uid()
    and m.active
    and m.coaching_center_id = center
    and m.branch_id is not null
    and not exists (
      select 1
      from public.center_members other
      where other.user_id = auth.uid()
        and other.active
        and other.coaching_center_id = center
        and (other.branch_id is null or other.branch_id <> m.branch_id)
    )
  limit 1;
$$;

comment on function app.writer_branch(uuid) is
  'The one branch every active membership this user holds in this centre agrees on, or null '
  'when they hold an HQ membership, hold none at all, or are pinned to two different '
  'branches. Called from the BEFORE INSERT stamp, never from a policy.';

-- ---------------------------------------------------------------------------
-- 2. The stamp, and the six tables that take it.
--
-- ONE FUNCTION FOR ALL SIX, where 20260811000047 wrote two for two tables and
-- 20260811000052 wrote one for one. Those stamps read a parent row, so each of them had to
-- know which parent and which column — a bill takes the student's branch, a payment takes
-- the bill's, a payslip takes the payee's. This one reads no parent. It asks the same
-- question of the same table with the same argument every time, and the only thing that
-- varies is which table the trigger is attached to, which is what a trigger already says.
--
-- FILLS ONLY A NULL, like both of them, and section 4 of 20260811000047 explains what that
-- buys better than a repeat would: a caller may name a branch and have it respected, and
-- what bounds them is the composite foreign key onto (branch_id, coaching_center_id) plus
-- the restrictive policy from 53. So the worst a browser can do is file its own centre's row
-- under its own centre's wrong branch, which is a data entry mistake with a data entry
-- remedy, and a pinned browser cannot even do that.
--
-- THE SIX ARE THE SIX A FORM CREATES. Eleven tables carry a branch of their own; five of
-- them are not here and section 3 says why each one is out.
--
-- Trigger order is alphabetical within an event, which puts this one after
-- `students_guard_capacity` and after `expenses_assign_voucher_no`. Neither reads the
-- branch: capacity pools at the organisation by §17, and section 5 of 53 made all three
-- number series read the centre's whole book on purpose. So nothing here depends on the
-- ordering, and this note exists so that a trigger which does depend on it is added
-- knowing that.
-- ---------------------------------------------------------------------------

create or replace function app.stamp_writer_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is null then
    new.branch_id := app.writer_branch(new.coaching_center_id);
  end if;

  return new;
end;
$$;

drop trigger if exists students_stamp_writer_branch on public.students;

create trigger students_stamp_writer_branch
  before insert on public.students
  for each row execute function app.stamp_writer_branch();

drop trigger if exists batches_stamp_writer_branch on public.batches;

create trigger batches_stamp_writer_branch
  before insert on public.batches
  for each row execute function app.stamp_writer_branch();

drop trigger if exists teachers_stamp_writer_branch on public.teachers;

create trigger teachers_stamp_writer_branch
  before insert on public.teachers
  for each row execute function app.stamp_writer_branch();

drop trigger if exists employees_stamp_writer_branch on public.employees;

create trigger employees_stamp_writer_branch
  before insert on public.employees
  for each row execute function app.stamp_writer_branch();

drop trigger if exists expenses_stamp_writer_branch on public.expenses;

create trigger expenses_stamp_writer_branch
  before insert on public.expenses
  for each row execute function app.stamp_writer_branch();

drop trigger if exists notices_stamp_writer_branch on public.notices;

create trigger notices_stamp_writer_branch
  before insert on public.notices
  for each row execute function app.stamp_writer_branch();

-- ---------------------------------------------------------------------------
-- 3. The five branch-carrying tables that are deliberately not stamped.
--
-- `fee_invoices`, `fee_payments` and `salary_payments` ALREADY HAVE A BETTER ANSWER.
-- 20260811000047 and 20260811000052 file money under the branch of the thing the money is
-- about — the student who was billed, the invoice that was paid, the person being paid —
-- and that is not the same as the branch of the desk it was taken at. §8.3's comparison
-- table asks what each building earned, not who typed it, and an HQ accountant collecting a
-- Mirpur fee at head office must not move that fee to head office. Two BEFORE INSERT
-- triggers on one column is also a fight nobody wins twice: the first would fill the null
-- and the second would find it filled.
--
-- `center_members` IS A PERMISSION AND HAS TO BE TYPED. The branch on a membership row is
-- not where somebody's work is filed, it is the entire limit of what they can reach —
-- attack 7 in the branch-scoping suite is the manager who tries to unpin themselves.
-- Inferring it would mean a pinned manager's new colleague is silently confined to Mirpur
-- with nothing on the screen saying so, and an owner's is silently HQ, which is the same
-- guess made in the direction that grants rather than withholds. That column gets a picker,
-- read by whoever pays for the organisation, and until it has one a pinned member cannot
-- add a colleague at all. That is the correct refusal: hiring is not their decision.
--
-- `branches` HAS NO BRANCH TO INHERIT. Its restrictive policy is
-- `app.branch_ok(coaching_center_id, id)`, so a pinned member sees exactly their own row
-- and structurally cannot insert a new one — 53 chose that, §3.7 says opening a building is
-- the bill-payer's decision, and a stamp cannot apply to a table whose branch is its own
-- primary key.
--
-- The other fifteen scoped tables reach a branch through a parent — `app.student_branch`,
-- `app.batch_branch` and the five others in section 3 of 53 — and carry no column to fill.
-- A guardian is at the branch their child is at, and there is nothing for a trigger to say
-- about it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. Who may call these two by name: nobody with a browser.
--
-- Per the convention in 20260811000010, and both halves of it apply. `app` is not exposed
-- through PostgREST, `app.stamp_writer_branch()` returns `trigger` which PostgREST would
-- refuse anyway, and a firing trigger never consults EXECUTE. Revoked regardless because
-- both are SECURITY DEFINER, which is the case where "a function nobody should call by name
-- should not be callable by name" stops being tidiness.
--
-- app.writer_branch IS REVOKED, UNLIKE app.branch_ok, and the difference is where each one
-- is evaluated. A policy expression runs as the querying role, so 53 had to leave its
-- predicate executable by `authenticated` or every query on twenty-six tables would fail on
-- a permission error. This one is called only from the stamp above, which runs as its owner,
-- so there is no role that needs it.
--
-- `public` and `anon` are named separately because Supabase's default privilege grants
-- EXECUTE to the role directly rather than through PUBLIC, so revoking one leaves the other.
-- ---------------------------------------------------------------------------

revoke all on function app.writer_branch(uuid) from anon, authenticated, public;
revoke all on function app.stamp_writer_branch() from anon, authenticated, public;
