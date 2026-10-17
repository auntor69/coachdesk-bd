-- CoachDesk BD — a teacher record past the two a centre includes is ৳100 a month on the
-- bill, so it is opened the way a branch is: only when there is money on the balance to
-- carry the line.
--
-- THE SECOND HALF OF 20260811000096, AND IT WAS FOUND BY READING THE FIRST ONE BACK.
-- `settle_billing` prices exactly two things past what a tier includes —
--
--     + greatest(0, v_teachers - card.free_teacher_seats) * card.teacher_seat_poisha
--     + greatest(0, v_branches - card.included_branches) * card.branch_poisha
--
-- — and 096 fenced the second. The first was open for the same reason and with the same
-- shape of hole. `plan_allowances.max_teachers` is null on both centre tiers, and that is
-- deliberate rather than an omission: a seat is not a quota the customer runs out of, it is
-- a price they pay (§2.4, §3.2, §2.7's list of engineering ceilings does not include it). So
-- `app.guard_teacher_ceiling` returns before it counts — `if ceiling is null then return
-- new` — and `teachers` holds INSERT for `authenticated` since 20260811000002. An owner's own
-- token posted straight at PostgREST therefore writes the two-hundredth teacher record, and a
-- signup is given DAYS rather than money (§4.3): a trialling centre or institution could
-- record unlimited staff on a balance of nothing, in a product that charges per seat, and
-- never send a taka.
--
-- AND IT IS THE LAST ONE OF ITS KIND, which is why it is worth a migration rather than a
-- note. The dimensions a free account can grow are now each answered somewhere: students are
-- what the daily rate is computed FROM (app.guard_student_capacity, 20260811000060), batches,
-- subjects and seats-per-batch have ceilings that are data (20260811000075), buildings need
-- money (20260811000096), and seats need money (here). Anything else a trialling account can
-- add is either not billed at all — an expense, a fee, a membership row — or is bounded by
-- one of those.
--
-- THE RULE, ONE SENTENCE, THE SAME ONE 096 STATES: **the two seats the tier includes are the
-- tier's; every seat past them is ৳100 a month, so it is opened only when there is money on
-- the balance.** §11.6 already prices the seat inside the day's rate and §11.7 makes the
-- balance the only currency; what was missing is the half a prepaid product needs, which is
-- that the money carrying a recurring line has to be there before the line starts. A trial has
-- none, because its days are granted rather than bought, so a trial runs the two seats the
-- tier includes and no more.
--
-- THE FOUNDER'S OWN SALES TRIAL MEETS THIS TOO, and that is intended rather than collateral.
-- §9's sales trial advances `charged_through` — granted days, no money — so a hand-loaded
-- prospect with thirty teachers hits the same wall as a self-serve signup, and the answer is
-- the same one §11.7 gives everywhere: a customer who needs a paid dimension funds the
-- balance first, and the founder's money screen is where that happens. A trial that grants the
-- paid dimensions of a tier for nothing is the thing this pair of migrations exists to end,
-- and the two numbers are the honest ones to draw it at: three buildings and two seats are
-- what the price card says are included.
--
-- NOT A CEILING, AND NOT A REWRITE OF THE ONE THAT IS. `app.guard_teacher_ceiling` in
-- 20260811000075 is the teacher tiers' wall — one record at any price, `CD003`, `limit=teachers`
-- — and it is left exactly as it is, because a tier whose ceiling is not null never reaches
-- this rule at all (the early return below asks `app.plan_ceiling` first). Replacing that
-- function to bolt this on would have put two different sentences and two different codes in
-- one body, and `scripts/check-sql.mjs` would refuse the second code anyway: a code is traced
-- to the migration that first declared the function raising it, `CD003` belongs to 075 and this
-- file cannot re-home it.
--
-- `CD005`, AND NOT `CD004` WITH ANOTHER DIMENSION ON IT. The code above it is the branch fence
-- and its `raise` lives in 096, so sharing would put one code in two migrations' ownership and
-- fail that same check. The sentence is the same *kind* — this is money, not the plan, and the
-- reader's errand is to send something rather than to change tier — so the two codes are told
-- apart by `detail` the way `CD003`'s four dimensions are: `limit=teachers`. src/lib/capacity.ts
-- names it.
--
-- WHAT THIS DOES NOT CHANGE. Existing teacher rows are untouched: a centre moved down to a
-- one-seat plan keeps every record it has (§4.5 — limits apply to new actions, never
-- retroactively), a name, a phone number or a subject list is not in the trigger's own column
-- list so a correction never reaches the rule, a teacher switched off gives the seat back, and
-- a funded centre may have as many seats as it can carry, because the burn prices each one.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The refusal.
--
-- SECURITY INVOKER, like every guard in this schema, and for the reason 096 records: inside a
-- definer function `current_user` is the function's owner and the superuser exemption below
-- would match every caller.
--
-- `service_role` IS NOT EXEMPT, matching `app.guard_branch_ceiling` and the four ceilings in
-- 75. It is the app's own admin client, and the app has no teacher write path through it —
-- `createTeacher` and `toggleTeacherActive` both run as the owner, which is what makes every
-- assertion in the RLS suite about this rule a real session's.
--
-- THE LOCK IS TAKEN BEFORE THE COUNT, and it is what makes the arithmetic true: two owners
-- recording the second and third seat at one desk both count two without it, both pass the
-- money test, and the organisation runs four on a funded allowance of two.
-- ---------------------------------------------------------------------------

create or replace function app.guard_teacher_seat_funding()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target   public.plan_type;
  included integer;
  in_use   integer;
  balance  bigint;
begin
  /*
   * A SWITCHED-OFF TEACHER IS NOT A SEAT ANYBODY PAYS FOR, and giving it back is always
   * allowed — that is how a centre stops paying for somebody who left, and `toggleTeacherActive`
   * is the screen for it. Refusing a closure would be charging a customer for leaving.
   */
  if not new.active then
    return new;
  end if;

  /*
   * A ROW BECOMING ACTIVE IS THE CLAIM: an insert, or a record switched back on, which is why
   * both are asked and why the second is asked on the same terms as the first — a teacher who
   * left in March and returns in June returns on the same terms as a new appointment. A row
   * that is already open is a correction: the seat is on the bill already and nothing in this
   * statement changes that, so a rename or a branch move is not held to the rule.
   */
  if tg_op = 'UPDATE' and old.active and old.coaching_center_id = new.coaching_center_id then
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  target := app.ceiling_plan(new.coaching_center_id);

  if target is null then
    raise exception 'teacher % names no coaching centre', new.name
      using errcode = '23503';
  end if;

  /*
   * One question and it decides which rule this insert meets. The teacher tiers — including a
   * centre trialling one, because `ceiling_plan` resolves the live trial exactly as it does for
   * the batch and teacher ceilings — have a hard one-seat ceiling, and `app.guard_teacher_ceiling`
   * refuses on it with `CD003`. This rule is about the tiers where the seat is a price rather
   * than a wall, so that is the only case it handles.
   */
  if app.plan_ceiling(target, 'teachers') is not null then
    return new;
  end if;

  /*
   * How many are included comes off the card in force — the same column `settle_billing` and
   * `teacherChargeBdt` price from, so the guard cannot disagree with the bill about whether the
   * third record costs anything. This is also the one number an owner changes if they want a
   * trial to carry more staff, and changing it moves the bill too: one number, both answers.
   *
   * A MISSING CARD IS A DEPLOYMENT FAULT AND REFUSES, the narrow direction every failed read in
   * this schema takes.
   */
  select v.free_teacher_seats into included
  from public.price_versions v
  where v.effective_from <= (pg_catalog.now() at time zone 'Asia/Dhaka')::date
  order by v.effective_from desc
  limit 1;

  if included is null then
    raise exception 'no price version is in force' using errcode = '23503';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('teachers.seats'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  in_use := app.active_teachers(new.coaching_center_id);

  -- Inside the allowance: this record changes no line on any bill, so there is nothing to fund
  -- and the count is not asked about money at all.
  if in_use < included then
    return new;
  end if;

  /*
   * Past it, and the organisation has to be a paying one.
   *
   * THE BAR IS MONEY ON THE BALANCE AND NOT "A SEAT'S WORTH", which is 096's judgement as well
   * and is worth the same sentence here: a day's worth of a seat is ৳3.33, a bar no customer
   * could reason about, and a nearly-dry centre would be refused a colleague it could still be
   * charged for tomorrow. Money on the balance is the honest minimum — the burn prices the seat
   * the day it appears, a balance that cannot carry the new rate takes the whole organisation
   * read-only the next morning (§4.4) — and what it refuses is the account that has never paid
   * us anything at all.
   *
   * NULL IS NOT MONEY. A balance nobody could read is a refusal, the same reading `billingStanding`
   * takes of an unreadable rate.
   */
  select c.balance_poisha into balance
  from public.coaching_centers c
  where c.id = new.coaching_center_id;

  if balance is null or balance <= 0 then
    raise exception
      'this organisation runs its % included teacher seats and holds nothing on the balance',
      included
      using errcode = 'CD005',
            detail  = 'limit=teachers',
            hint    = 'Add money to the balance to record another teacher.';
  end if;

  return new;
end;
$$;

comment on function app.guard_teacher_seat_funding() is
  'BEFORE INSERT (or a record switched back on) on public.teachers: a seat past '
  'price_versions.free_teacher_seats needs money on the balance, because the daily rate is '
  'what pays for it. The teacher tiers'' one-seat wall stays app.guard_teacher_ceiling''s. '
  'MASTERPLAN.md §2.4, §3.2 and §11.6. CD005, named in src/lib/capacity.ts.';

-- ---------------------------------------------------------------------------
-- 2. Where it fires.
--
-- `update of active, coaching_center_id` rather than a bare `update`, copying the four ceilings
-- in 75 and the branch guard in 096: a rename, a phone number or a subject list never enters the
-- trigger at all, and the early return above is the second line rather than the first. The centre
-- column is in the list because a record moved to another organisation is a seat that
-- organisation did not have a moment ago.
--
-- A COMPANION TRIGGER AND NOT A REPLACED FUNCTION, which is the one structural difference from
-- 096. There the ceiling itself was the new rule, so the function was new. Here the rule already
-- has a function and it is keeping its meaning — 75's wall — so this is a second trigger on the
-- same table and the same columns. Postgres fires both, in name order, and only one of them can
-- ever refuse an insert: the tiers with a ceiling never reach section 1's money test, and the
-- tiers without one are not refused by CD003 at all.
-- ---------------------------------------------------------------------------

drop trigger if exists teachers_guard_seat_funding on public.teachers;
create trigger teachers_guard_seat_funding
  before insert or update of active, coaching_center_id on public.teachers
  for each row execute function app.guard_teacher_seat_funding();

-- ---------------------------------------------------------------------------
-- 3. Who may call what.
--
-- The guard is granted to nobody, like every other trigger function here: a trigger's execute
-- right is checked when the trigger is created, not when it fires. It calls three functions that
-- are already granted to `authenticated` — `app.ceiling_plan`, `app.plan_ceiling` and
-- `app.active_teachers` — and reads two tables a signed-in member may read.
-- ---------------------------------------------------------------------------

revoke all on function app.guard_teacher_seat_funding() from public, anon, authenticated;
