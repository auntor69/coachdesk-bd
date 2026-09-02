-- CoachDesk BD — a waiver with a name on it, and a percentage the owner does not have to
-- work out on paper (MASTERPLAN.md §9.3).
--
-- WHAT 20260811000030 LEFT. An owner can waive a fee by typing taka, and the bill keeps
-- the figure, the reason, who granted it and when. Two things §9.3 asks for are still
-- missing, and they are one request from two ends.
--
-- A PERCENTAGE. "Half fee for the topper" is how a centre says it, and today the owner
-- does that arithmetic themselves, once per student, every month, against a different
-- bill each time. It goes wrong in the direction nobody notices: ৳1,150 waived on a
-- ৳2,300 bill is half, ৳1,150 on next term's ৳2,500 bill is not half of anything, and the
-- family's fee has quietly changed.
--
-- A NAME. §9.3: "A scholarship is not a discount typed twice. It is a named thing —
-- sibling waiver, merit 50%, hardship — that a report needs to total separately, because
-- 'why is our collection rate 82%' has a very different answer depending on whether the
-- missing 18% was waived on purpose or simply never paid." `discount_reason` is free
-- text, so those three are today spelled differently on every bill and total nowhere.
--
-- THE FIGURE IS STILL A FIGURE ON THE BILL. `discount_bdt` stays the money and the two
-- new columns only say how it was arrived at. Nothing derives a waiver at read time from
-- a percentage or from a scholarship, because both can be renamed and retired, and a bill
-- from March must not move when they are. Same decision and the same reason as
-- 20260811000068's `priced_lines`: the rate that was charged is recorded, not recomputed.
--
-- THE APP COMPUTES, THE CONSTRAINT VERIFIES. src/lib/fees/scholarship.ts resolves a
-- percentage in whole poisha and `fee_invoices_discount_percent_agrees` refuses the row
-- if the two disagree. A trigger doing the arithmetic instead was written first and
-- thrown away: it would have to fire before app.guard_invoice_void() for that guard's
-- stamping and cancelled-bill branches to see the real figure, and trigger order in
-- Postgres is alphabetical by trigger name — a load-bearing fact invisible to anybody
-- reading either function. It also cannot express the fixed-taka award capped at a
-- smaller bill, which is a two-row question.

-- ---------------------------------------------------------------------------
-- 1. The named thing.
--
-- ONE RULE PER SCHOLARSHIP, and the shape of the two nullable columns says which it is.
-- No `kind` column beside them: a third column naming which of the two is in force is a
-- third thing that can disagree with the other two.
--
-- A PERCENTAGE CAN NEVER OVERRUN A BILL, because it is bounded at 100 — so the percent
-- case is exact and needs no cap anywhere. A fixed award can: "sibling waiver ৳300"
-- against a ৳200 bill is capped at the bill by the app and by
-- fee_invoices_discount_bound, which has held since migration 1.
-- ---------------------------------------------------------------------------

create table public.fee_scholarships (
  id uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null
    references public.coaching_centers (id) on delete cascade,
  name text not null,
  percent numeric(5, 2) check (percent > 0 and percent <= 100),
  amount_bdt numeric(10, 2) check (amount_bdt > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint fee_scholarships_one_rule
    check ((percent is null) <> (amount_bdt is null))
);

-- Required of every tenant table by scripts/check-migrations.mjs, and used by the
-- composite foreign key in section 5: a bill may only name a scholarship of its own
-- centre, which a reference to `id` alone would not say.
create unique index fee_scholarships_id_center_key
  on public.fee_scholarships (id, coaching_center_id);

-- One name, one rule. Two rows both reading "মেধাবৃত্তি" with different figures would
-- make the report in section 9 unreadable and unarguable — the owner sees two lines with
-- the same label and no way to tell which bills went where. Case-folded, because
-- "Hardship" and "hardship" are the same word to everybody except a unique index.
create unique index fee_scholarships_center_name_key
  on public.fee_scholarships (coaching_center_id, lower(name));

-- What the picker on a bill reads: this centre's live awards, newest first.
create index fee_scholarships_center_active_idx
  on public.fee_scholarships (coaching_center_id, created_at desc)
  where active;

comment on table public.fee_scholarships is
  'A reusable named waiver — sibling, merit, hardship — carrying either a percentage or a '
  'fixed figure in taka, never both. MASTERPLAN.md section 9.3. Granting one writes '
  'fee_invoices.discount_bdt as usual and records the attribution beside it, so a bill '
  'never changes when the award is renamed or retired.';

comment on column public.fee_scholarships.percent is
  'The share of a bill this award waives, 0 to 100 exclusive of zero. Null when the award '
  'is a fixed figure. Frozen once created: an award whose rate can be edited turns '
  '"merit 50%" into 60% on every future bill with nothing on any screen to say when or '
  'why, and an owner comparing two months has no way back to the answer.';

comment on column public.fee_scholarships.amount_bdt is
  'The flat sum this award waives, in taka. Null when the award is a percentage. Capped '
  'at the bill when the bill is smaller, which is the app''s decision and not a '
  'constraint, because it is a fact about two rows.';

comment on column public.fee_scholarships.active is
  'False retires the award: it stops being offered on a bill and keeps every waiver '
  'already granted under it, name and all. This is how an award changes — retire it and '
  'create the replacement — because the alternative rewrites bills nobody looked at '
  'again.';

-- ---------------------------------------------------------------------------
-- 2. The wording moves, the rule does not.
--
-- `truncate` for the reason check-migrations.mjs gives: Supabase's default privileges
-- grant it on every new table, no row trigger fires for it, and the audit log would
-- record nothing. `delete` because deleting an award unlabels every bill it was ever
-- granted on — the foreign key in section 5 is `on delete set null`, so the money would
-- stay and the reason for it would vanish, which is the one outcome retiring exists to
-- avoid.
--
-- `name` and `active` are the whole of what a session may write: a typo gets fixed and an
-- award gets retired. `percent`, `amount_bdt` and `created_at` are outside the grant and
-- the guard refuses them a second time, in the place a public HTTP endpoint cannot argue
-- with.
-- ---------------------------------------------------------------------------

revoke update, delete, truncate on public.fee_scholarships from authenticated, anon;

grant update (name, active) on public.fee_scholarships to authenticated;

create or replace function app.guard_fee_scholarship()
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
        'scholarship % has bills granted under it and cannot be deleted by %; '
        'retire it instead, which stops it being offered and keeps the bills labelled',
        old.id, current_user
        using errcode = '42501';
    end if;
    return old;
  end if;

  if not server_role
     and (new.id is distinct from old.id
          or new.coaching_center_id is distinct from old.coaching_center_id
          or new.percent is distinct from old.percent
          or new.amount_bdt is distinct from old.amount_bdt
          or new.created_at is distinct from old.created_at)
  then
    raise exception
      'a scholarship''s rule is what past bills were waived by and cannot be changed '
      'by %; retire this one and create its replacement', current_user
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists fee_scholarships_guard on public.fee_scholarships;

create trigger fee_scholarships_guard
  before update or delete on public.fee_scholarships
  for each row execute function app.guard_fee_scholarship();

revoke all on function app.guard_fee_scholarship() from public, anon, authenticated;

comment on function app.guard_fee_scholarship() is
  'Belt and braces over the column grant on fee_scholarships. Refuses a DELETE, which '
  'would unlabel every bill granted under the award, and refuses any change to the rule '
  'the bills were waived by.';

-- ---------------------------------------------------------------------------
-- 3. Who sees the awards and who creates them.
--
-- READ IS WIDER THAN WRITE, AND HAS TO BE. Section 8 puts the award's name on
-- fee_invoice_balances through a join, and every view in this schema is
-- security_invoker — so a teacher with can_view_fees reading their batch's board would
-- get a null name for every waiver and a row reading "৳500 waived" with no explanation.
-- The name is not a private figure; it is the label on a number they can already see.
--
-- WRITE IS STAFF-ADMIN, like the waiver itself. Inventing an award is a fee policy for
-- the whole centre, which is further-reaching than granting one on a single bill.
--
-- AND THE `fees` CAPABILITY (§6.2, 20260811000063), restrictive over both, so the manager
-- whose owner took the fee book away cannot read the awards either. Same sentence for
-- reads and writes: a narrowed manager must not be able to edit a row they cannot see.
-- ---------------------------------------------------------------------------

alter table public.fee_scholarships enable row level security;

create policy fee_scholarships_read on public.fee_scholarships
  for select to authenticated
  using (
    app.is_staff_admin(coaching_center_id)
    or app.can_view_fees(coaching_center_id)
    or app.is_platform_admin()
  );

create policy fee_scholarships_staff_admin_write on public.fee_scholarships
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy fee_scholarships_capability on public.fee_scholarships
  as restrictive for all to authenticated
  using (app.member_allows(coaching_center_id, 'fees'));

-- §10's "who changed this". An award's name and whether it is offered are the two things
-- a session may write, and both change what future bills say.
create trigger fee_scholarships_audit
  after insert or update or delete on public.fee_scholarships
  for each row execute function app.log_audit_entry();

-- ---------------------------------------------------------------------------
-- 4. What the bill records about how its waiver was arrived at.
--
-- THREE WAYS A WAIVER HAPPENS, and the two columns tell them apart. Both null is a figure
-- the owner typed, which is every row that exists today and stays exactly as it was. Only
-- `discount_percent` is an ad-hoc share of one bill. `scholarship_id` set is a named
-- award, and `discount_percent` is copied onto the bill alongside it when that award is a
-- percentage — so the bill explains itself in full after the award has been retired, and
-- without a join.
--
-- THE FIGURE AND THE PERCENTAGE CANNOT DISAGREE. `round(amount_bdt * discount_percent /
-- 100, 2)` is the whole rule, asserted here rather than computed here for the reason in
-- the header. src/lib/fees/scholarship.ts is the twin that produces it and
-- tests/scholarship.test.ts pins the pairs both must agree on; a one-poisha drift between
-- them is an owner who cannot save a waiver and has nothing on screen explaining why.
--
-- AND NOTHING IS ATTRIBUTED WHEN NOTHING IS WAIVED, which is the insert-time half of what
-- app.guard_invoice_void() normalises on update. `generateInvoices` holds INSERT on this
-- table, so without this check a raised bill could arrive already labelled with an award
-- that waived nothing.
-- ---------------------------------------------------------------------------

alter table public.fee_invoices
  add column if not exists scholarship_id uuid;

alter table public.fee_invoices
  add column if not exists discount_percent numeric(5, 2);

alter table public.fee_invoices
  add constraint fee_invoices_scholarship_fkey
  foreign key (scholarship_id, coaching_center_id)
  references public.fee_scholarships (id, coaching_center_id)
  on delete set null (scholarship_id);

alter table public.fee_invoices
  add constraint fee_invoices_discount_percent_range
  check (discount_percent is null or (discount_percent > 0 and discount_percent <= 100));

alter table public.fee_invoices
  add constraint fee_invoices_discount_percent_agrees
  check (
    discount_percent is null
    or discount_bdt = round(amount_bdt * discount_percent / 100, 2)
  );

alter table public.fee_invoices
  add constraint fee_invoices_waiver_attributed
  check (
    discount_bdt > 0
    or (scholarship_id is null and discount_percent is null)
  );

comment on column public.fee_invoices.scholarship_id is
  'The named award this waiver was granted under, or null for one the owner simply typed. '
  'Set null if the award is ever deleted by a support request, which is why '
  'fee_scholarships refuses a DELETE from a session: the money would stay and the reason '
  'for it would go.';

comment on column public.fee_invoices.discount_percent is
  'The share of the bill that was waived, when the waiver was expressed as one — either '
  'ad hoc or copied from a percentage award at the moment it was granted. Held to '
  'discount_bdt by fee_invoices_discount_percent_agrees, so it is a record of what was '
  'charged and never a rate anything recomputes from.';

-- ---------------------------------------------------------------------------
-- 5. The fence widens by the two columns that describe the waiver.
--
-- Restated whole rather than added to, for the reason 20260811000030 gives: `grant update
-- (a)` after `grant update (b)` leaves privileges on both and a reader of either line
-- would not know it. Six columns is now the complete list of what a browser session may
-- write on a bill that has been raised.
--
-- `discounted_by` and `discounted_at` stay outside it, and now so does everything about
-- the award itself: a session may say which award a waiver was granted under, and cannot
-- touch what that award waives.
-- ---------------------------------------------------------------------------

revoke update, delete, truncate on public.fee_invoices from authenticated;

grant update (
  voided_at,
  void_reason,
  discount_bdt,
  discount_reason,
  discount_percent,
  scholarship_id
) on public.fee_invoices to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The invoice guard, restated for the two new columns.
--
-- Composed from 20260811000067's body, which is the current one. Two changes, and both
-- treat the attribution as part of the waiver rather than as something beside it:
--
-- CHANGING WHICH AWARD A WAIVER WAS GRANTED UNDER IS CHANGING THE WAIVER. It re-stamps who
-- and when, and it is refused on a cancelled bill, on the same argument the figure is:
-- relabelling a waiver that is in no total on any screen cannot do anything except mislead
-- whoever reads it next.
--
-- AND A WAIVER SET BACK TO ZERO CLEARS THEM, alongside the reason and the stamp it already
-- cleared. fee_invoices_waiver_attributed would otherwise refuse the update outright,
-- which is the wrong answer to an owner undoing something: this is the path that takes a
-- waiver off, and it should take all of it off.
--
-- Everything else is unchanged, including which columns are frozen. `scholarship_id` and
-- `discount_percent` are deliberately not in that list — they are the waiver, and the
-- waiver is the one thing about a raised bill that moves.
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
          or new.idempotency_key is distinct from old.idempotency_key)
  then
    raise exception
      'a fee invoice says what was billed and cannot be rewritten by %; '
      'cancel it and raise the right one', current_user
      using errcode = '42501';
  end if;

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
  'rewrite of what was billed, refuses cancelling a bill that holds money, refuses '
  'waiving a fee on a cancelled bill or relabelling one, and stamps who cancelled or '
  'discounted it and when rather than taking either from the client.';

drop trigger if exists fee_invoices_guard_void on public.fee_invoices;

create trigger fee_invoices_guard_void
  before update or delete on public.fee_invoices
  for each row execute function app.guard_invoice_void();

-- ---------------------------------------------------------------------------
-- 7. The balances view carries the award's name.
--
-- Restated whole because Postgres has no "add a column to a view", and the three go last
-- because `create or replace view` may only append. Composed from 20260811000030's body,
-- which is the current one. security_invoker restated rather than trusted to survive the
-- replace — it is the difference between a view and a data breach, and
-- check-migrations.mjs fails the build without it.
--
-- The name is joined and not stored, which is the one place a waiver's attribution is
-- read live rather than frozen: renaming "merit" to "merit 50%" should correct it
-- everywhere, because it is a label rather than a figure. What must not move is the money
-- and the rate, and neither is on this side of the join.
--
-- LEFT, because most waivers have no award — the join must not drop the ad-hoc ones — and
-- carrying the centre through it for the reason 20260811000005 gives about every other
-- join in this schema.
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
  sc.name as scholarship_name
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

-- ---------------------------------------------------------------------------
-- 8. What the awards cost, by name and by month. §9.3's whole reason for existing.
--
-- "Why is our collection rate 82%" has a very different answer depending on whether the
-- missing 18% was waived on purpose or simply never paid, and a centre cannot ask it of
-- free text. This is the relation that answers the first half: one row per award per
-- month, and one row per month with a null award for everything waived without a name,
-- which is the line an owner should be able to see growing.
--
-- A VIEW AND NOT A SUM IN TYPESCRIPT, because PostgREST cannot group and the alternative
-- is reading every discounted bill of every month onto a phone to add it up. The month
-- rows are summed further on screen for a running total, which is a display of this
-- view's own answers rather than a second answer to the same question.
--
-- BILLS AND CHILDREN COUNTED SEPARATELY, because this product bills per enrolment: a
-- student on merit taking three subjects is three bills, and "we carry eleven children on
-- merit" is the sentence an owner actually says. Cancelled bills are excluded, as they are
-- from every other total in the schema.
--
-- NOT SPLIT BY BRANCH. §8.3's comparison needs a snapshot column this schema does not have
-- yet, and a branch dimension here would multiply the rows for an answer nothing asks for
-- today.
-- ---------------------------------------------------------------------------

create view fee_waiver_month with (security_invoker = true) as
select
  i.coaching_center_id,
  i.period_month,
  i.scholarship_id,
  sc.name as scholarship_name,
  sc.percent as scholarship_percent,
  sc.amount_bdt as scholarship_amount_bdt,
  sc.active as scholarship_active,
  count(*)::int as bills,
  count(distinct i.student_id)::int as students,
  sum(i.discount_bdt) as waived_bdt
from fee_invoices i
left join fee_scholarships sc
  on sc.id = i.scholarship_id
 and sc.coaching_center_id = i.coaching_center_id
where i.voided_at is null
  and i.discount_bdt > 0
group by
  i.coaching_center_id,
  i.period_month,
  i.scholarship_id,
  sc.name,
  sc.percent,
  sc.amount_bdt,
  sc.active;

comment on view fee_waiver_month is
  'What the centre waived in each month, totalled by named award, with a null '
  'scholarship_id row for everything waived without one. MASTERPLAN.md section 9.3: a '
  'report has to total the deliberate waivers separately from the unpaid bills, because '
  'the two say opposite things about the same missing money. Cancelled bills excluded.';
