-- CoachDesk BD — a one-off fee agreed in advance and collected in parts. §9.3.
--
-- THE FEE THAT IS TOO BIG TO PAY AT ONCE. An admission fee is ৳6,000 in a country where the
-- household paying it earns ৳20,000 a month, so centres already agree to take it in three —
-- on paper, in a notebook, and then chase it from memory. This is the first thing in the
-- product that writes the agreement down.
--
-- A PLAN IS N BILLS, NOT ONE BILL WITH A SCHEDULE, and that is the whole design. A schedule
-- table beside the invoice would need its own allocation rule — which part does a ৳500
-- payment pay? — and its own arrears arithmetic, and then there would be two answers to
-- "what does this family owe" with no way to tell which is right. Three rows instead reuse
-- every mechanism already keyed to an invoice: partial payments, the arrears list and its
-- index on `due_date`, receipts, the collection register, a waiver, cancelling, month close,
-- and the profit view. "Part two is overdue" needs no new code at all.
--
-- WHAT THE COLUMNS ARE FOR, then, is only saying that a row is part of something bigger:
-- which part, of how many, and which agreement. Every figure stays where it already was.
--
-- THE PARTS ARE NOT CHECKED AGAINST A TOTAL, because there is no total stored anywhere —
-- deliberately. A plan row holding "৳6,000 agreed" would be a second answer to what the
-- family owes, and the first thing to disagree with the bills the moment one is cancelled or
-- waived. So the split is arithmetic the app does once, in poisha, guarded by
-- tests/instalments.test.ts asserting the parts add back up; the schema's job is to make
-- sure a part cannot be renumbered, duplicated, or quietly rewritten afterwards.

-- ---------------------------------------------------------------------------
-- 1. Which part of which agreement.
--
-- Three columns and no plan table. A table would buy a foreign key and cost a row that says
-- nothing the parts do not already say — and the one thing it would hold, the agreed total,
-- is the thing that must not be stored twice (see the header).
--
-- `instalment_plan_id` is minted per student, not per submission: an agreement is with one
-- family, so one press billing forty students on a schedule writes forty agreements. A
-- shared id would make "show me this family's plan" return a hundred and twenty rows.
--
-- smallint for both counters. The range check below caps them at twelve, and a bill that
-- claims to be part 40,000 of 40,000 is a form that went wrong rather than a column that
-- needed to be wider.
-- ---------------------------------------------------------------------------

alter table public.fee_invoices
  add column if not exists instalment_plan_id uuid,
  add column if not exists instalment_no      smallint,
  add column if not exists instalment_of      smallint;

-- ---------------------------------------------------------------------------
-- 2. What a part may say about itself.
--
-- All three or none, because each is meaningless alone: a part number with no count cannot
-- be labelled, a count with no number cannot be ordered, and either without the agreement id
-- cannot be grouped. `num_nulls` says that in one expression rather than three.
--
-- TWO IS THE FLOOR because a plan of one is a bill, and the form calls that "pay in full" and
-- writes nulls. Twelve is the ceiling because a year of instalments is the longest thing an
-- owner writes down as a single agreement; past that it is a monthly fee, which this product
-- already bills every month.
--
-- AND NOT ON TUITION. A monthly fee is raised by month-close against an enrolment, and
-- `unique (enrollment_id, period_month)` allows exactly one per cycle — so a tuition bill in
-- parts is unrepresentable anyway, and saying so here turns a confusing unique violation into
-- a sentence. A family paying this month's tuition in two goes is two payments against one
-- bill, which has always worked.
-- ---------------------------------------------------------------------------

alter table public.fee_invoices
  add constraint fee_invoices_instalment_whole
    check (num_nulls(instalment_plan_id, instalment_no, instalment_of) in (0, 3)),
  add constraint fee_invoices_instalment_range
    check (
      instalment_no is null
      or (instalment_of between 2 and 12 and instalment_no between 1 and instalment_of)
    ),
  add constraint fee_invoices_instalment_one_off
    check (instalment_no is null or revenue_category <> 'tuition');

-- One part two per agreement, per centre.
--
-- Centre-scoped like every other unique index here, and for the reason 20260811000067 gives
-- about its own: an id arriving on an insert is a claim until something checks it, and a key
-- that is only ever compared inside the caller's own centre cannot be used to find out what
-- exists in somebody else's.
create unique index if not exists fee_invoices_instalment_part
  on public.fee_invoices (coaching_center_id, instalment_plan_id, instalment_no)
  where instalment_plan_id is not null;

comment on column public.fee_invoices.instalment_plan_id is
  'The agreement this bill is part of: one uuid per student per plan, minted by the server '
  'when the charge is raised. Null on every bill that is not part of a plan, which is nearly '
  'all of them. No plan table and no stored total - the parts are the plan, and the figure '
  'they add up to is not written down twice.';

comment on column public.fee_invoices.instalment_no is
  'Which part of the agreement this bill is, from 1. Null unless instalment_plan_id is set.';

comment on column public.fee_invoices.instalment_of is
  'How many parts the agreement has, 2 to 12. The same on every row of one plan, because it '
  'is what the label on screen reads from - "part 2 of 3" has to be true on the row being '
  'looked at without reading the other two.';

-- ---------------------------------------------------------------------------
-- 3. One press, one agreement, however many times the request arrives.
--
-- 20260811000067's index is `(coaching_center_id, idempotency_key, student_id)`: one press
-- charging a batch writes one row per student, and a retry loses on the first row it reaches.
-- A plan writes three rows for the same student under the same key, so that index would
-- refuse the second part of every plan — the retry protection would have become the bug.
--
-- Rekeyed on the part rather than widened, and through `coalesce` rather than the column
-- itself, which is the load-bearing detail: nulls are distinct in a unique index, so a fourth
-- column that is null on every ordinary charge would let a double-tapped press through
-- unnoticed. `coalesce(instalment_no, 0)` is 0 on every one of those rows, so they still
-- collide exactly as they did, while the parts of a plan differ by their own number.
--
-- Same name, because it is the same protection and a reader looking for what makes this form
-- safe to repeat should find one index, not two with a story about which is live.
-- ---------------------------------------------------------------------------

drop index if exists public.fee_invoices_center_idempotency_key;

create unique index fee_invoices_center_idempotency_key
  on public.fee_invoices
     (coaching_center_id, idempotency_key, student_id, coalesce(instalment_no, 0))
  where idempotency_key is not null;

comment on column public.fee_invoices.idempotency_key is
  'A uuid the browser mints once per one-off charge form and sends with the submit. Unique '
  'per centre per student per instalment, so one press charging a batch writes one row each '
  '- or one row per part when the charge is an agreed plan - and a retried or double-tapped '
  'request loses to the rows already there rather than billing forty families twice. Null on '
  'every invoice month-close raised, which is idempotent through (enrollment_id, '
  'period_month) instead, and on any submit from a browser that could not mint one - which '
  'means no retry protection, never a refused write.';

-- ---------------------------------------------------------------------------
-- 4. A part cannot be renumbered.
--
-- 20260811000030 revoked UPDATE on this table and handed back named columns, so a column
-- added afterwards is unwritable from a browser session before this guard says anything. The
-- guard is here for the reason every migration since ...50 has put the same line in: the
-- grant is the lock, and the guard is the lock that survives somebody pasting a wholesale
-- grant.
--
-- IN THE FROZEN LIST, WITH WHAT WAS BILLED. Which part of which agreement a bill is is not a
-- label that can be corrected — it is what makes the other two parts add up to the fee that
-- was agreed. Turning part 2 of 3 into part 2 of 4 would leave a family owing a quarter more
-- than they signed for, on a row that looks perfectly ordinary. Cancelling it is the remedy,
-- and it stays available: a family that leaves halfway through an agreement should have the
-- rest of it cancelled, not rewritten.
--
-- Everything else is 20260811000069's body unchanged, restated only because `create or
-- replace` takes the whole thing.
-- ---------------------------------------------------------------------------

create or replace function app.guard_invoice_void()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  server_role boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
  on_it numeric;
  waiver_changed boolean;
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
          or new.idempotency_key is distinct from old.idempotency_key
          or new.instalment_plan_id is distinct from old.instalment_plan_id
          or new.instalment_no is distinct from old.instalment_no
          or new.instalment_of is distinct from old.instalment_of)
  then
    raise exception
      'a fee invoice says what was billed and cannot be rewritten by %; '
      'cancel it and raise the right one', current_user
      using errcode = '42501';
  end if;
-- GUARD-TAIL
  -- The figure, the share it was expressed as, and the award it was granted under are one
  -- decision. Any of the three moving is the waiver being changed.
  waiver_changed := new.discount_bdt is distinct from old.discount_bdt
    or new.discount_percent is distinct from old.discount_percent
    or new.scholarship_id is distinct from old.scholarship_id;

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
-- GUARD-TAIL-2
  -- A bill that is off every total is not a bill anybody should be waiving a fee on.
  -- Refused rather than normalised, because unlike the void columns there is no
  -- reading of it that is merely tidy: the owner meant to do something, and doing
  -- nothing quietly would leave them believing they had.
  if waiver_changed
     and not server_role
     and coalesce(new.voided_at, old.voided_at) is not null
  then
    raise exception
      'invoice % is cancelled, so waiving a fee on it changes no total anybody sees; '
      'restore it first', new.id
      using errcode = '42501';
  end if;

  if waiver_changed and not server_role then
    new.discounted_at := now();
    new.discounted_by := auth.uid();
  end if;

  -- No waiver, nothing beside it. The mirror of the voided_at branch above, and the
  -- reason is the same: these columns exist to explain a figure, and once the figure
  -- is gone they can only misdescribe the bill.
  if new.discount_bdt = 0 then
    new.discount_reason := null;
    new.discount_percent := null;
    new.scholarship_id := null;
    new.discounted_by := null;
    new.discounted_at := null;
  end if;

  return new;
end;
$$;

comment on function app.guard_invoice_void() is
  'Belt and braces over the column grant on fee_invoices. Refuses a DELETE, refuses any '
  'rewrite of what was billed - including what it was billed for, the uuid that made it '
  'idempotent, and which part of which instalment agreement it is - refuses cancelling a '
  'bill that holds money, refuses waiving a fee on a cancelled bill or relabelling one, and '
  'stamps who cancelled or discounted it and when rather than taking any of it from the '
  'client.';

-- Rebound by name, and recreated for the reason 20260811000048 recreated it: a reader
-- looking for what fires on a fee invoice should find it in the file that last changed it.
drop trigger if exists fee_invoices_guard_void on public.fee_invoices;

create trigger fee_invoices_guard_void
  before update or delete on public.fee_invoices
  for each row execute function app.guard_invoice_void();

revoke all on function app.guard_invoice_void() from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 5. The board carries the part number.
--
-- Restated whole because Postgres has no "add a column to a view", and the two go last
-- because `create or replace view` may only append. Composed from 20260811000069's body,
-- which is the current one. security_invoker restated rather than trusted to survive the
-- replace — it is the difference between a view and a data breach, and check-migrations.mjs
-- fails the build without it.
--
-- WHY THE BOARD NEEDS THEM AND NOT JUST THE FORM THAT RAISED THEM. An owner looking at
-- "Admission fee ৳2,000, overdue" cannot tell whether that is the whole fee unpaid or the
-- first third of an agreement being honoured, and those want opposite conversations with the
-- family. Two smallints on the row it is already reading answer it without a second query.
--
-- The agreement's own id is deliberately not here. Nothing on screen groups by it yet, and a
-- view column nobody selects is a column the next reader has to work out the purpose of.
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
  i.void_reason,
  i.discount_reason,
  i.scholarship_id,
  i.discount_percent,
  sc.name as scholarship_name,
  i.instalment_no,
  i.instalment_of
from fee_invoices i
-- The tenant column travels with this join for the same reason 20260811000005
-- put it in every foreign key: a join on id alone would be a sideways reference.
join students s
  on s.id = i.student_id
 and s.coaching_center_id = i.coaching_center_id
left join fee_scholarships sc
  on sc.id = i.scholarship_id
 and sc.coaching_center_id = i.coaching_center_id
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


