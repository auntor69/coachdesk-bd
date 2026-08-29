-- What the staff are owed, and what they have actually been paid.
--
-- MASTERPLAN.md §9.5 is unusual in the document: most of it argues against asking
-- for more information.
--
--   "Simple mode: one number. Most Bangladeshi coaching centres pay a flat monthly
--   amount, or a per-class rate, and have never written the word allowance down. A
--   form that demands a breakdown of a single figure will be filled with the same
--   number in the Basic box and zeroes everywhere else, which is worse than not
--   asking: it teaches the owner that the software does not understand their
--   business. So the detailed fields exist, default to zero, and stay collapsed
--   until asked for. `gross` and `net` are derived, never typed."
--
-- The schema that serves both modes is the same schema: four money columns that
-- default to zero, and a gross and a net that are generated from them. Simple mode
-- writes `basic_bdt` and touches nothing else, and the net comes out equal to it.
-- Full mode opens the other three boxes. Neither mode can produce a row where the
-- total disagrees with its parts, because the total is not a column anybody writes.
--
-- TWO TABLES, BECAUSE §9.5 SAYS SO AND IT IS RIGHT: "A salary payment is a
-- separate record from the salary terms — paid on this date, for this month, this
-- amount, by this method, recorded by this person." Terms are what was agreed and
-- they change; a payment is a thing that happened and never does. Folding them
-- together gives a row that is edited every raise and consulted for what was paid
-- last March, which is how a payroll dispute becomes unanswerable.
--
-- THE PAYEE IS A TEACHER OR AN EMPLOYEE, and this is the one design decision here
-- worth arguing. 20260811000043 kept non-teaching staff out of `teachers` so a
-- cleaner cannot occupy a billable teacher seat — but teachers are paid too, and
-- they are usually the largest line in the salary bill. That leaves three ways to
-- model payroll:
--
--   1. Salary columns on both tables, and every payroll query is a union. The
--      failure mode is a report that reads one table and quietly halves the wage
--      bill, and §9.8 makes profit depend on that figure. A union somebody forgets
--      is exactly the mistake 20260811000034 was written to stop repeating.
--   2. An `employees` row for every teacher as well, so payroll has one parent.
--      Then a teacher has two `active` flags in two tables and they can disagree,
--      which puts a resigned teacher back on the payroll list.
--   3. One payroll pair with two possible parents and exactly one of them set.
--
-- Three is the one where nobody can be missed and nothing can disagree. It costs a
-- check constraint and a null column per row, and both foreign keys are composite,
-- so neither can reach another centre's staff.
--
-- MONEY OUT IS APPEND-ONLY, on the same terms as money in. §9.5: "Same append-only
-- rule as fees." So `salary_payments` copies 20260811000017 line for line — a
-- per-centre voucher serial assigned under an advisory lock, DELETE and UPDATE
-- revoked from browser sessions with `reference` and `note` handed back, and a
-- trigger that says so in a sentence rather than a privilege error. A salary paid
-- in error is corrected by a negative row, never by an edit, exactly as a fee
-- refund is.
--
-- ITS OWN VOUCHER SERIES, not a share of the receipt numbers. A fee receipt and a
-- salary voucher are two different pieces of paper in two different hands, and a
-- shared series would mean an employee's voucher number jumping by forty because
-- the centre had a busy collection week — which tells them nothing and makes a
-- missing number look like a removed page.
--
-- WHAT IS NOT HERE. The payroll screen, the salary bill on the dashboard and the
-- profit line that subtracts it are §16's steps 15 to 17. This is step 2's half:
-- the tables, so that when those screens are written there is nothing left to
-- decide about where a figure lives.

-- ---------------------------------------------------------------------------
-- 1. How the pay is worked out.
--
-- Two values, because §9.5 names two: a flat monthly amount, or a rate per class.
-- Not a third for "hourly" — nobody in this market is paid by the hour, and an
-- unused enum value is a picker option somebody eventually selects by accident.
-- ---------------------------------------------------------------------------

create type public.salary_basis as enum ('monthly', 'per_class');

-- ---------------------------------------------------------------------------
-- 2. What was agreed.
-- ---------------------------------------------------------------------------

create table public.salary_terms (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references public.coaching_centers (id) on delete cascade,

  -- Exactly one of these, enforced below. Both cascade: terms are a fact about a
  -- person the centre still employs, and they carry no money that happened.
  employee_id  uuid,
  teacher_id   uuid,

  basis        public.salary_basis not null default 'monthly',

  -- The one number simple mode writes. Every other box defaults to zero and stays
  -- collapsed, so a centre that pays a flat 14,000 taka a month types 14000 here
  -- and is asked nothing else.
  basic_bdt      numeric(10, 2) not null default 0 check (basic_bdt >= 0),
  allowances_bdt numeric(10, 2) not null default 0 check (allowances_bdt >= 0),
  other_bdt      numeric(10, 2) not null default 0 check (other_bdt >= 0),
  deductions_bdt numeric(10, 2) not null default 0 check (deductions_bdt >= 0),

  -- Derived, never typed. A stored generated column rather than a view or an app
  -- calculation, so there is no path — not psql, not a future screen, not an import
  -- — by which a gross can be written that its own parts do not add up to.
  gross_bdt numeric(10, 2)
    generated always as (basic_bdt + allowances_bdt + other_bdt) stored,
  net_bdt   numeric(10, 2)
    generated always as (basic_bdt + allowances_bdt + other_bdt - deductions_bdt) stored,

  -- The per-class rate, and null unless that is how this person is paid. What a
  -- per-class teacher earns in a month is a count of classes times this, which is a
  -- report and not a stored figure — storing it would be a number that goes stale
  -- the next time they teach.
  per_class_bdt numeric(10, 2) check (per_class_bdt is null or per_class_bdt >= 0),

  effective_from date not null default (now() at time zone 'Asia/Dhaka')::date,
  active       boolean not null default true,
  note         text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- One payee, and one of them. `<>` on two null tests is the shortest way to say
  -- exactly-one, and it refuses both halves of the mistake: terms belonging to
  -- nobody, and terms claiming a teacher and an employee at once.
  constraint salary_terms_one_payee
    check ((employee_id is null) <> (teacher_id is null)),

  -- The basis decides which figure is meaningful, so the other one must be absent.
  -- Without this a row can carry a monthly salary and a per-class rate together, and
  -- a payroll screen would have to guess which the centre meant.
  constraint salary_terms_basis_matches_rate
    check (
      case when basis = 'per_class'
           then per_class_bdt is not null
           else per_class_bdt is null
      end
    ),

  -- Composite, per 20260811000005: this centre's terms cannot name another centre's
  -- teacher or another centre's employee.
  constraint salary_terms_employee_id_center_fkey
    foreign key (employee_id, coaching_center_id)
    references public.employees (id, coaching_center_id) on delete cascade,
  constraint salary_terms_teacher_id_center_fkey
    foreign key (teacher_id, coaching_center_id)
    references public.teachers (id, coaching_center_id) on delete cascade
);

-- At most one live agreement per person. A raise is a new row, so the old figure
-- stays readable — "what was Karim on in January" is a question a centre asks, and
-- an UPDATE in place is the answer being overwritten.
create unique index salary_terms_employee_active_idx
  on public.salary_terms (employee_id)
  where active and employee_id is not null;

create unique index salary_terms_teacher_active_idx
  on public.salary_terms (teacher_id)
  where active and teacher_id is not null;

-- The salary bill: every live agreement at this centre, which is the query the
-- payroll screen and §9.10's dashboard both open with.
create index salary_terms_center_idx
  on public.salary_terms (coaching_center_id) where active;

create trigger salary_terms_updated_at
  before update on public.salary_terms
  for each row execute function public.set_updated_at();

comment on table public.salary_terms is
  'MASTERPLAN.md §9.5 — what a teacher or an employee has been agreed. A raise is '
  'a new row; the previous one is retired by a trigger so the old figure stays '
  'readable. gross and net are generated, never written.';

comment on column public.salary_terms.gross_bdt is
  'basic + allowances + other, computed by the database. @generated';

comment on column public.salary_terms.net_bdt is
  'gross - deductions, computed by the database. This is the monthly figure a '
  'payroll screen shows. @generated';

-- ---------------------------------------------------------------------------
-- 3. A raise retires the agreement it replaces.
--
-- The partial indexes above make two live agreements for one person impossible,
-- which leaves the question of who retires the old one. If the answer is "the
-- screen that grants the raise", then the second screen that grants a raise — a
-- bulk revision at the start of a year, an import from a spreadsheet — is one
-- forgotten UPDATE away from a unique-violation error in front of an owner who has
-- done nothing wrong. It is the same argument 20260811000042 makes about transfer
-- history: a step the application has to remember is a step some code path will not.
--
-- So an insert of a live agreement stands the previous one down, and granting a
-- raise is one write. SECURITY INVOKER, so the UPDATE it performs is filtered by
-- the same policies as the insert that triggered it — a staff admin can only retire
-- their own centre's terms, and nothing here reads past RLS to find rows to touch.
--
-- Inserting an INACTIVE row changes nothing, which is how a historical agreement
-- can be back-filled without disturbing the live one.
-- ---------------------------------------------------------------------------

create or replace function app.retire_previous_salary_terms()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not new.active then
    return new;
  end if;

  update public.salary_terms t
     set active = false
   where t.coaching_center_id = new.coaching_center_id
     and t.active
     and (
       (new.employee_id is not null and t.employee_id = new.employee_id)
       or (new.teacher_id is not null and t.teacher_id = new.teacher_id)
     );

  return new;
end;
$$;

drop trigger if exists salary_terms_retire_previous on public.salary_terms;

-- BEFORE INSERT, and not also BEFORE UPDATE. An insert is how a raise is granted, so
-- an insert is the event that has an old agreement to stand down. Switching a retired
-- row back on by hand is not that event: it collides with the partial unique index and
-- fails, which is the right kind of loud. The old figure is history, and the way to
-- change what somebody earns is to say what they now earn.
--
-- The UPDATE this performs fires salary_terms_updated_at, which is a BEFORE UPDATE
-- trigger and cannot re-enter this one, so there is no recursion to guard against.
create trigger salary_terms_retire_previous
  before insert on public.salary_terms
  for each row execute function app.retire_previous_salary_terms();

revoke all on function app.retire_previous_salary_terms()
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 4. Who may see what the staff are paid.
--
-- Owners and managers, and the founder on reads for §10's support conversation.
-- The same pair of policies every administrative table in this schema carries.
--
-- NOT TEACHERS — not even their own row, and this is the narrowing worth defending.
-- A teacher reading their own terms sounds harmless and is the first half of a
-- payslip screen, which §16's step 15 will build. What makes it wait is that a
-- policy is not a screen: shipping the read now means a teacher's own salary is
-- queryable from a browser console months before anything renders it, and the first
-- version of that policy is the one somebody widens to `coaching_center_id in
-- (select app.member_center_ids())` while adding a feature. There is nothing to
-- serve today, so there is nothing open today.
-- ---------------------------------------------------------------------------

alter table public.salary_terms enable row level security;

create policy salary_terms_staff_admin_read on public.salary_terms
  for select to authenticated
  using (app.is_staff_admin(coaching_center_id) or app.is_platform_admin());

create policy salary_terms_staff_admin_write on public.salary_terms
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

-- ---------------------------------------------------------------------------
-- 5. What was actually handed over.
--
-- §9.5: "A salary payment is a separate record from the salary terms — paid on this
-- date, for this month, this amount, by this method, recorded by this person."
--
-- THE MONEY COLUMNS CARRY NO SIGN CHECK, unlike the terms above, and the difference
-- is the point rather than an oversight. Terms are a figure agreed, and a negative
-- agreed salary is nonsense. A payment is a thing that happened, and the only honest
-- way to undo one is another row that reverses it — the rule `fee_payments` has
-- carried since 20260811000001 (`check (amount_bdt <> 0)`) and 20260811000017 made
-- structural. So all four columns may go negative, the net may go negative, and the
-- single thing refused is a row that moves nothing.
--
-- THE BREAKDOWN IS COPIED, NOT JOINED. Storing one amount and reading the parts off
-- `salary_terms` would be smaller and would be wrong for the reason a receipt freezes
-- what it says: terms change, and a payslip printed in March has to still read in
-- December. The generated columns mean the copy cannot disagree with itself.
-- ---------------------------------------------------------------------------

create table public.salary_payments (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references public.coaching_centers (id) on delete cascade,

  -- Exactly one payee, the same shape as the terms and for the same reason: one
  -- table that a payroll report cannot half-read.
  employee_id  uuid,
  teacher_id   uuid,

  -- Which month's salary this settles, as a date on the first — the convention
  -- fee_invoices.period_month set. Not the month it was paid in: December's salary
  -- handed over in January is December's cost, and §9.8's profit line has to put it
  -- in the month it belongs to or every January reads as a disaster.
  for_month    date not null,

  -- Simple mode writes basic_bdt and nothing else, exactly as in the terms.
  basic_bdt      numeric(10, 2) not null default 0,
  allowances_bdt numeric(10, 2) not null default 0,
  other_bdt      numeric(10, 2) not null default 0,
  deductions_bdt numeric(10, 2) not null default 0,

  -- `amount_bdt` rather than `net_bdt`, deliberately, so it is named the same thing
  -- as the figure on a fee payment. Money out and money in should answer to the same
  -- column name when §9.8 subtracts one from the other.
  gross_bdt  numeric(10, 2)
    generated always as (basic_bdt + allowances_bdt + other_bdt) stored,
  amount_bdt numeric(10, 2)
    generated always as (basic_bdt + allowances_bdt + other_bdt - deductions_bdt) stored,

  -- The same list a fee payment uses, because it is the same question: cash, one of
  -- the three wallets, a bank transfer, a card, or something else. A second enum of
  -- its own would mean two pickers to widen on the day a centre starts paying through
  -- a fourth wallet, and one of the two would be missed.
  method       public.payment_method not null default 'cash',

  -- The bKash trxID or the cheque number, null for cash. One of the only two columns
  -- on this row that stays correctable, for the reason 20260811000017 gives: a
  -- mistyped reference is a real thing that needs fixing and fixing it changes no
  -- number.
  reference    text,
  note         text,

  -- The number on the piece of paper. Assigned by the trigger below, NOT NULL from
  -- the start because there are no existing rows to backfill — and NOT NULL is also
  -- the failure mode we want if a later migration ever drops that trigger: the insert
  -- fails here instead of writing a voucher with no number on it.
  voucher_no   integer not null,

  paid_at      timestamptz not null default now(),
  paid_by      uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint salary_payments_one_payee
    check ((employee_id is null) <> (teacher_id is null)),

  -- A month is its first day, so two rows for December cannot be filed under two
  -- different Decembers. The cast to timestamp is what picks date_trunc's immutable
  -- overload, which a check constraint requires — the timestamptz one reads the
  -- session's time zone. Character for character 20260811000011's expression.
  constraint salary_payments_month_is_first
    check (for_month = date_trunc('month', for_month::timestamp)::date),

  -- Written on the arithmetic rather than on `amount_bdt`. A check that reads a
  -- generated column is a check whose correctness depends on when that column is
  -- computed; the sum is the same either way and this way there is nothing to know.
  constraint salary_payments_not_zero
    check (basic_bdt + allowances_bdt + other_bdt - deductions_bdt <> 0),

  -- NO ACTION on both payee keys, stated by omission, and the omission is chosen
  -- three times over. CASCADE would erase a wage bill the moment somebody is deleted,
  -- which is the history this table exists to hold. SET NULL would leave a row with
  -- no payee and break the check above, so it is RESTRICT wearing a confusing error.
  -- And RESTRICT itself is checked immediately, which would make `delete from
  -- coaching_centers` fail for ever: that cascade removes the employee and these rows
  -- in one statement, and only NO ACTION waits until the end of the statement to
  -- look. What is left is the honest rule — somebody who has been paid cannot be
  -- deleted, they are marked as left — and a centre that closes still closes.
  constraint salary_payments_employee_id_center_fkey
    foreign key (employee_id, coaching_center_id)
    references public.employees (id, coaching_center_id),
  constraint salary_payments_teacher_id_center_fkey
    foreign key (teacher_id, coaching_center_id)
    references public.teachers (id, coaching_center_id)
);

-- The voucher register: what this centre has paid out lately, newest first.
create index salary_payments_center_paid_idx
  on public.salary_payments (coaching_center_id, paid_at desc);

-- The month's wage bill, which is the figure §9.8 subtracts from collections to get
-- a profit line. On for_month and not paid_at, because that is the month it belongs
-- to whatever day it left the drawer.
create index salary_payments_center_month_idx
  on public.salary_payments (coaching_center_id, for_month);

-- One person's payment history, for the payslip screen §16's step 15 will build.
-- Partial, because half these rows have a null in either column.
create index salary_payments_employee_idx
  on public.salary_payments (employee_id, for_month desc)
  where employee_id is not null;

create index salary_payments_teacher_idx
  on public.salary_payments (teacher_id, for_month desc)
  where teacher_id is not null;

comment on table public.salary_payments is
  'MASTERPLAN.md §9.5 — one row per salary handed over, append-only on the same '
  'terms as fee_payments. Corrected by a reversing negative row, never by an edit '
  'or a delete. Its own per-centre voucher series.';

comment on column public.salary_payments.for_month is
  'The month this settles, as a date on the first. December salary paid in January '
  'is December cost.';

comment on column public.salary_payments.voucher_no is
  'Per-centre voucher serial, assigned by a trigger. Never supplied by a caller and '
  'never changed once issued. @generated';

comment on column public.salary_payments.gross_bdt is
  'basic + allowances + other, computed by the database. @generated';

comment on column public.salary_payments.amount_bdt is
  'gross - deductions: what actually left the drawer, and the column §9.8 sums '
  'against fee_payments.amount_bdt. Computed by the database. @generated';

-- ---------------------------------------------------------------------------
-- 6. The voucher number.
--
-- 20260811000017's argument, unchanged, about a different piece of paper: an
-- employee handed a slip needs a number they can quote, a uuid is not that number,
-- and a global sequence would tell one centre how much salary sixteen others paid
-- last week. Per centre, monotonic, counted rather than sequenced so a rolled-back
-- insert leaves no hole — a gap in a voucher book reads as a removed page.
--
-- The index before the function, so that if the function is ever wrong the insert
-- fails instead of two employees holding voucher 12.
-- ---------------------------------------------------------------------------

create unique index salary_payments_center_voucher_key
  on public.salary_payments (coaching_center_id, voucher_no);

-- SECURITY INVOKER by omission, exactly as `assign_receipt_no` is, and for the same
-- reason: max() is filtered by the caller's own policies, the only role that may
-- insert here is a staff admin who can read every one of their centre's vouchers, so
-- the filtered max is the true max. If a future policy narrows that, the number comes
-- out low and the unique index refuses the row — loud, in front of somebody who can
-- do something about it. A DEFINER version would paper over exactly that mistake.
--
-- The first lock key is this column's own name, so the series cannot contend with
-- fee_payments' receipts. A busy collection week no longer makes an employee's
-- voucher number jump.

create or replace function app.assign_salary_voucher_no()
returns trigger
language plpgsql
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

  select coalesce(pg_catalog.max(p.voucher_no), 0) + 1
    into new.voucher_no
  from public.salary_payments p
  where p.coaching_center_id = new.coaching_center_id;

  return new;
end;
$$;

drop trigger if exists salary_payments_assign_voucher_no on public.salary_payments;

create trigger salary_payments_assign_voucher_no
  before insert on public.salary_payments
  for each row execute function app.assign_salary_voucher_no();

-- ---------------------------------------------------------------------------
-- 7. Append-only, which is what makes counting from max() sound.
--
-- With DELETE available, counting from max() hands a used number out again the moment
-- the newest voucher is removed, and then two slips in two pockets claim voucher 12
-- with one of them silently gone. That is the same failure 20260811000017 spent a
-- migration preventing, and the argument does not weaken for money going the other
-- way — it gets sharper. A salary dispute is between an employer and an employee, the
-- record is the employer's, and the employee has only the paper. A payroll history
-- that can be edited by the side holding it is not evidence of anything.
--
-- So: DELETE goes, UPDATE goes, and `reference` and `note` come back. Everything that
-- decides what the voucher says — the four money columns, the method, the month, the
-- date, the payee — becomes unwritable from a browser session, so the slip in a hand
-- and the row in the table can never disagree.
--
-- TRUNCATE is in the list because `grant all` includes it and a row trigger does not
-- fire for it.
--
-- FROM anon AS WELL, unlike 20260811000017, which named only `authenticated`. There
-- is no policy for anon on this table so it can do nothing regardless, and the revoke
-- costs one word — the reasoning 20260811000042 gives for the same belt and braces:
-- one pasted `grant all on all tables in schema public` from a setup snippet is all
-- it takes, and it fails silently.
--
-- service_role keeps everything. It holds its own grants from Supabase's defaults, a
-- REVOKE from `authenticated` does not touch them, and it is how a support request
-- about a wrongly entered salary gets answered at all.
--
-- Widening this later is a deliberate act: an edit screen that needs `method` adds
-- `method` here, in a migration, with a sentence saying why.
-- ---------------------------------------------------------------------------

revoke update, delete, truncate on public.salary_payments from authenticated, anon;

grant update (reference, note) on public.salary_payments to authenticated;

-- A trigger cannot be granted away, and a privilege error is a sentence nobody can
-- act on. SECURITY INVOKER on purpose, as in 20260811000017: inside a SECURITY
-- DEFINER function `current_user` is the owner, which would make the test below pass
-- for everybody.
--
-- voucher_no is refused for everybody, the server included. Every other column here
-- is refused for a browser session and allowed for service_role, because somebody has
-- to be able to answer a support request. A voucher number is different in kind: it is
-- not data about the payment, it is the name of a slip in an employee's hand, and
-- changing it makes that slip point at a different row. There is no version of that
-- which is a fix.
--
-- The generated columns are absent from the list because they cannot be written at
-- all — Postgres refuses an UPDATE that names one — and they are derived from four
-- columns that are already guarded.

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
          or new.coaching_center_id is distinct from old.coaching_center_id)
  then
    raise exception
      'a salary payment says what was paid and cannot be rewritten by %; '
      'only reference and note may be corrected', current_user
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists salary_payments_guard_immutable on public.salary_payments;

create trigger salary_payments_guard_immutable
  before update or delete on public.salary_payments
  for each row execute function app.guard_salary_payment_immutable();

-- ---------------------------------------------------------------------------
-- 8. Who may see the payroll.
--
-- The same pair as the terms, and the same narrowing: owners and managers write, the
-- founder reads for support and never writes, teachers see none of it — not even
-- their own vouchers — until there is a payslip screen to serve them.
-- ---------------------------------------------------------------------------

alter table public.salary_payments enable row level security;

create policy salary_payments_staff_admin_read on public.salary_payments
  for select to authenticated
  using (app.is_staff_admin(coaching_center_id) or app.is_platform_admin());

-- `for all` and not `for insert`, matching fee_payments. The UPDATE and DELETE halves
-- of it are unreachable — the privileges are revoked above and the trigger refuses
-- besides — and writing it this way is what lets a widening be one grant rather than a
-- new policy somebody has to get right in a hurry.
create policy salary_payments_staff_admin_write on public.salary_payments
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

-- ---------------------------------------------------------------------------
-- 9. The function revokes, per the convention in 20260811000010.
--
-- Supabase's default privileges grant EXECUTE on every new function to anon and
-- authenticated. Both of these are in `app`, which PostgREST does not expose, and
-- both return `trigger`, which PostgREST would refuse anyway — and a firing trigger
-- never consults EXECUTE. Revoked regardless: a function nobody should ever call by
-- name should not be callable by name. `retire_previous_salary_terms` got the same
-- treatment beside its own trigger in section 3.
--
-- `public` and `anon` are both named because the default privilege is granted to the
-- role directly, not through PUBLIC, so revoking one leaves the other.
-- ---------------------------------------------------------------------------

revoke all on function app.assign_salary_voucher_no() from anon, authenticated, public;
revoke all on function app.guard_salary_payment_immutable()
  from anon, authenticated, public;
