-- Every taka that leaves.
--
-- MASTERPLAN.md §9.6:
--
--   "Every taka that leaves, with a category: rent, electricity, internet,
--   marketing, printing, stationery, equipment, maintenance, transport, software,
--   salary, miscellaneous. Categories are a fixed list plus a free-text note, not
--   free-text alone — a category somebody types is a category no report can group.
--
--   Recurring expenses (rent, internet) are flagged as recurring so the owner is not
--   re-typing rent every month, but each month's actual payment is still its own row.
--   A template is not a transaction."
--
-- That second paragraph decides the shape of this table, and it decides it against
-- the obvious design. The obvious design is two tables: `expense_templates` holding
-- "rent, ৳12,000, monthly" and `expenses` holding what was paid. It is what a
-- bookkeeping product would ship, and it is wrong here for the reason a stale figure
-- is always wrong — the template says ৳12,000 for the eighteen months after the
-- landlord put the rent up, nobody notices because the template is not a screen
-- anybody opens, and the owner is offered the old number every month until they stop
-- reading the number at all. A `recurring` flag on the transaction has no such
-- second copy: what the month-close screen offers is last month's actual row, which
-- is the best available guess by definition and cannot go stale without the owner
-- having seen it.
--
-- APPEND-ONLY, like the money either side of it. 20260811000017 argued it for fee
-- receipts and 20260811000044 for salary vouchers, and the third case is the same
-- case: an expense that can be edited is a cash position that cannot be trusted, and
-- §9.8 subtracts this figure to get a profit line an owner may expand on. A wrong
-- entry is corrected by a negative row, which is why `amount_bdt` carries no sign
-- check and only zero is refused.
--
-- ITS OWN VOUCHER SERIES, a third one. Three near-identical assign functions is more
-- code than one clever generic taking a table name, and the generic would need
-- dynamic SQL inside a function pinned to an empty search_path — a string to build,
-- an identifier to quote, and a plan that cannot be cached, in the one place in the
-- schema where getting it wrong hands two pieces of paper the same number. Three
-- boring functions it is.
--
-- DATED BY WHEN THE MONEY LEFT, and this is the one place this file departs from the
-- shape 20260811000044 chose. A salary payment carries `for_month` because December's
-- salary is systematically handed over in January — that lag is how the country pays
-- staff, and a profit line that reads it as a January cost makes every January look
-- like a disaster. Rent does not lag: it is paid in the first days of the month it
-- covers. So an expense is dated by `spent_on` and grouped by it, which also keeps
-- this line cash-basis in step with §9.1's collected column. A profit figure that is
-- accrual on one side and cash on the other is not a figure.
--
-- WHAT IS NOT HERE. The expense screen is §16's step 15, and the profit line that
-- subtracts this is step 16. This is step 2's half: the table.

-- ---------------------------------------------------------------------------
-- 1. The categories, in the order §9.6 lists them.
--
-- The list is fixed and it is the masterplan's, unedited, because a category
-- somebody types is a category no report can group — and a list I improve is a list
-- that stops matching the document the product is being built from.
--
-- `salary` IS IN THE LIST AND IT IS A TRAP, so it is named here rather than left for
-- somebody to trip over. §9.8's profit is `collected − expenses − payroll`, with
-- payroll coming from 20260811000044's salary_payments. A centre that pays through
-- the payroll screen and ALSO logs the same money as a `salary` expense is subtracted
-- twice, and the profit line quietly reads worse than the business is.
--
-- It stays for two reasons. The category is real — a centre that has not set up terms
-- per person still knows it paid the staff ৳40,000 last month, and refusing to let
-- them write that down would send them to `miscellaneous`, where it is invisible
-- instead of merely awkward. And removing it would make this schema disagree with the
-- document, which is how the two drift apart.
--
-- SO THE ARITHMETIC GETS EXACTLY ONE HOME. When §16's step 16 builds the profit line
-- it must be one view, defining the expense side as `sum(amount_bdt) where category
-- <> 'salary'` and the payroll side from salary_payments — and nothing else in the
-- product may sum expenses to get a profit. This is the same failure mode that made
-- check-migrations.mjs grow its founder-panel invariant after three tables in a row
-- were forgotten, and the same fix applies: when the view exists, the schema gate
-- should assert it is the only place this sum lives.
-- ---------------------------------------------------------------------------

create type public.expense_category as enum (
  'rent',
  'electricity',
  'internet',
  'marketing',
  'printing',
  'stationery',
  'equipment',
  'maintenance',
  'transport',
  'software',
  'salary',
  'miscellaneous'
);

-- ---------------------------------------------------------------------------
-- 2. The row.
-- ---------------------------------------------------------------------------

create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references public.coaching_centers (id) on delete cascade,

  -- Branch from birth, per §8.2 and for the reason 20260811000043 gives: a column
  -- added later is a column every existing row has to be guessed into. Null for a
  -- single-branch centre, and for a cost the group carries rather than a branch —
  -- the accounting software subscription, the head office rent.
  branch_id    uuid,

  category     public.expense_category not null default 'miscellaneous',

  -- The free-text half of "a fixed list plus a free-text note". What the electricity
  -- bill was for, which month the rent covers, which printer was repaired. Correctable
  -- later, because it changes no number.
  note         text,

  -- Unsigned nowhere, zero refused, exactly as fee_payments and salary_payments have
  -- it. A wrong expense is undone by a negative row and the original stays visible.
  amount_bdt   numeric(10, 2) not null check (amount_bdt <> 0),

  -- Dhaka's calendar. The day money left is a day, not an instant, and which day it
  -- is depends on where the centre is.
  spent_on     date not null default (now() at time zone 'Asia/Dhaka')::date,

  method       public.payment_method not null default 'cash',
  reference    text,

  -- Not a template, a flag. See the header: the month-close screen offers last month's
  -- actual rows back, so there is no second copy of the rent figure to go stale.
  recurring    boolean not null default false,

  -- Own series, assigned by the trigger below. NOT NULL from the start because there
  -- is nothing to backfill, and because that is the failure we want if a later
  -- migration ever drops the trigger.
  voucher_no   integer not null,

  recorded_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),

  -- Composite, per 20260811000005. The column list on SET NULL matters: a bare one
  -- would try to null coaching_center_id, which is NOT NULL, and closing a branch
  -- would fail instead of leaving its costs on the centre's books.
  constraint expenses_branch_id_center_fkey
    foreign key (branch_id, coaching_center_id)
    references public.branches (id, coaching_center_id) on delete set null (branch_id)
);

-- The expense list, newest first, which is what the screen in §16's step 15 opens
-- with and what §9.8 groups by month.
create index expenses_center_spent_idx
  on public.expenses (coaching_center_id, spent_on desc);

-- "Where did the money go" — the whole point of having a fixed category list.
create index expenses_center_category_idx
  on public.expenses (coaching_center_id, category, spent_on desc);

-- What repeats, so month-close can offer last month's rows back without reading the
-- whole ledger. Partial, because most rows are one-offs.
create index expenses_center_recurring_idx
  on public.expenses (coaching_center_id, spent_on desc)
  where recurring;

-- Per-branch costs, for §8.3's branch comparison. Partial for the same reason
-- employees' is: a single-branch centre leaves this null on every row.
create index expenses_branch_idx
  on public.expenses (branch_id, spent_on desc)
  where branch_id is not null;

comment on table public.expenses is
  'MASTERPLAN.md §9.6 — every taka that leaves, on a fixed category list plus a '
  'free-text note. Append-only: corrected by a negative row, never by an edit. '
  'Recurring is a flag on the transaction, not a template.';

comment on column public.expenses.recurring is
  'This cost repeats, so month-close may offer it again. A flag and not a template: '
  'the figure offered is last month actual, so it cannot go stale unseen.';

comment on column public.expenses.category is
  'Fixed list, because a category somebody types is a category no report can group. '
  'Note carries the words. See this migration header on why summing this table for a '
  'profit line must exclude the salary category.';

comment on column public.expenses.voucher_no is
  'Per-centre expense voucher serial, assigned by a trigger. Never supplied by a '
  'caller and never changed once issued. @generated';

-- ---------------------------------------------------------------------------
-- 3. The voucher number.
--
-- 20260811000017's argument for the third time, and §9.9 asks for it in as many
-- words: "A printable record for a fee payment ✅, and — ❌ — for a salary payment, an
-- expense, a refund". Per centre so nothing leaks about the centre next door,
-- monotonic, counted rather than sequenced so a rolled-back insert leaves no hole.
--
-- The index before the function, so a wrong function fails the insert instead of
-- issuing voucher 12 twice.
-- ---------------------------------------------------------------------------

create unique index expenses_center_voucher_key
  on public.expenses (coaching_center_id, voucher_no);

-- SECURITY INVOKER by omission, as the other two are: max() is filtered by the
-- caller's own policies, the only role that may insert here is a staff admin who can
-- read every one of their centre's vouchers, so the filtered max is the true max. If
-- some future policy narrows that, the number comes out low and the unique index
-- refuses the row — loud, in front of somebody who can act on it.
--
-- The first lock key is this column's own name, so the series contends with neither
-- fee receipts nor salary vouchers.

create or replace function app.assign_expense_voucher_no()
returns trigger
language plpgsql
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

  select coalesce(pg_catalog.max(e.voucher_no), 0) + 1
    into new.voucher_no
  from public.expenses e
  where e.coaching_center_id = new.coaching_center_id;

  return new;
end;
$$;

drop trigger if exists expenses_assign_voucher_no on public.expenses;

create trigger expenses_assign_voucher_no
  before insert on public.expenses
  for each row execute function app.assign_expense_voucher_no();

-- ---------------------------------------------------------------------------
-- 4. Append-only.
--
-- The same two mechanisms as the other two money tables, and the same reason for
-- both: with DELETE available, counting from max() re-issues a used number the moment
-- the newest voucher is removed. What is different here is who is being protected
-- from what. A fee receipt protects a parent from the centre; a salary voucher
-- protects an employee. An expense row protects the owner from their own manager —
-- §10 predicts the first serious support conversation word for word: "my manager says
-- he never entered that". A ledger the person who entered a row can silently edit
-- cannot answer it.
--
-- `reference` and `note` stay open, because a mistyped bKash trxID and "which month's
-- rent" are both real corrections that change no number.
--
-- TRUNCATE is in the list because `grant all` includes it and a row trigger does not
-- fire for it. From anon as well, for the belt-and-braces reason 20260811000042 gives.
-- service_role keeps everything, because a support request has to be answerable.
-- ---------------------------------------------------------------------------

revoke update, delete, truncate on public.expenses from authenticated, anon;

-- Three columns handed back rather than two. `reference` and `note` for the reason
-- the other tables give, and `recurring` because it is a hint about next month rather
-- than a statement about what happened — an owner who forgot to tick the rent should
-- be able to tick it, and refusing that is friction with nothing behind it. Every
-- column that decides what the voucher says stays shut.
grant update (reference, note, recurring) on public.expenses to authenticated;

-- SECURITY INVOKER on purpose, as in 20260811000017: inside a SECURITY DEFINER
-- function `current_user` is the owner, which would make the test below pass for
-- everybody. voucher_no is refused for the server too — it is not data about the
-- expense, it is the name of a slip in a file, and changing it makes that slip point
-- at a different row.

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
          or new.coaching_center_id is distinct from old.coaching_center_id)
  then
    raise exception
      'an expense says what was spent and cannot be rewritten by %; '
      'only reference and note may be corrected', current_user
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists expenses_guard_immutable on public.expenses;

create trigger expenses_guard_immutable
  before update or delete on public.expenses
  for each row execute function app.guard_expense_immutable();

-- ---------------------------------------------------------------------------
-- 5. Who may see the spending.
--
-- Owners and managers write; the founder reads for §10's support conversation and
-- never writes. Not teachers, and not through teacher_permissions either — §6.5's
-- `can_view_fees` is about a teacher collecting money for their own batch, which is a
-- different thing from reading what the centre pays in rent.
-- ---------------------------------------------------------------------------

alter table public.expenses enable row level security;

create policy expenses_staff_admin_read on public.expenses
  for select to authenticated
  using (app.is_staff_admin(coaching_center_id) or app.is_platform_admin());

create policy expenses_staff_admin_write on public.expenses
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

-- ---------------------------------------------------------------------------
-- 6. The function revokes, per the convention in 20260811000010.
--
-- Both are in `app`, which PostgREST does not expose, both return `trigger`, and a
-- firing trigger never consults EXECUTE. Revoked anyway: a function nobody should
-- call by name should not be callable by name. `public` and `anon` are named
-- separately because Supabase's default privilege grants EXECUTE to the role directly
-- rather than through PUBLIC, so revoking one leaves the other.
-- ---------------------------------------------------------------------------

revoke all on function app.assign_expense_voucher_no() from anon, authenticated, public;
revoke all on function app.guard_expense_immutable() from anon, authenticated, public;
