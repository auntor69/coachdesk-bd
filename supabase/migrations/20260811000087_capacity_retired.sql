-- CoachDesk BD — capacity is retired, and the ceiling outlived it by one migration.
-- (MASTERPLAN.md §3.3, §11.2, §11.14, §16.1 step 28, §18.)
--
-- WHAT THIS MIGRATION IS, IN ONE SENTENCE: the last thing that made a purchased
-- student place mean anything, removed from the two functions that read and wrote it.
--
-- WHAT IT DELIBERATELY DOES NOT DO, and this is §11.14's decision rather than this
-- file's. `coaching_centers.student_capacity` is **archived, not dropped**: the column
-- stays, stops being read, stops being written, and gains a comment saying so — the
-- same treatment 20260811000082 gave `paid_through`, for the same reason. The money
-- that bought those places is on the record as `payment_intents` and `payments` rows,
-- and dropping the number those rows raised would leave the record unable to explain
-- itself. `payment_intents.purpose`, `quantity` and `grants_capacity` are likewise
-- **preserved**, and `public.payment_purpose` keeps all four of its values, because
-- §11.14 says historic intents must still read. New intents use the top-up purpose
-- only (§11.2) — that is an app-side fact, and it is enforced where intents are
-- created rather than by removing a value from a Postgres enum, which cannot be done.
--
-- WHY THE PER-STUDENT TIERS COME OUT UNCAPPED RATHER THAN CAPPED-AT-THE-ALLOWANCE,
-- which is the one genuinely dangerous line in this file. §18 replaces purchased
-- capacity with "there is no ceiling on a per-student tier" (§3.3) — it does **not**
-- say the allowance stands, and reading it that way would have been the defect that
-- matters: `plan_allowances.included_students` is 79 for `center` and 238 for
-- `institution`, and those are not unlimited, they are the number of students the
-- monthly floor already pays for. Deleting the `student_capacity` term instead of
-- loosening it would have refused a 500-student centre its 80th active student, on the
-- day the product stopped selling seats, in the middle of an admission season. So the
-- per-student tiers return `integer`'s maximum and the teacher tiers keep the allowance
-- they always had — 30 and 150, which §18 preserves by name as §2.7's engineering
-- ceilings.
--
-- 2147483647 rather than a null, and the reason is not laziness. `app.student_ceiling`
-- returns null today for a centre that does not exist, and `app.guard_student_capacity`
-- reads that null as "this insert has no tenant" and raises 23503. Reusing null for
-- "uncapped" would put two meanings on one value inside the single function every
-- admission in this product passes through, and the day they were confused a student
-- with no centre would be admitted. The sentinel is also not an invention: 2147483647
-- is the spelling 20260811000075 already uses for "no ceiling sorts last", and no
-- roster reaches it — 2.1 billion active students is past every other limit in the
-- schema.
--
-- WHY THE GUARD ITSELF SURVIVES. `app.guard_student_capacity()` and its trigger are
-- the enforcement of the plan allowance, which §18 keeps, and they are the only thing
-- that decides an admission on the teacher tiers. What goes is the sentence it raises:
-- a refusal that tells an owner to "buy more student places" is selling something the
-- product no longer sells, and it is the last user-facing promise of a purchase left in
-- the database. The code `CD001` is unchanged, because three Server Actions and their
-- tests recognise it and nothing about the refusal's cause has moved.
--
-- WHY `settle_payment_intent` REFUSES RATHER THAN IGNORES. A pending intent that still
-- carries `grants_capacity > 0` was priced under the old model, and the ceiling it names
-- can no longer be raised — this migration has just removed the only code that raised
-- one. Settling it would take the customer's money and hand over nothing, which is the
-- one failure this product cannot have (§11.2). So it fails loudly, before the receipt
-- is written, and the intent has to be re-quoted as what it now is: money on the
-- balance. The read-back path for an intent that already settled is untouched, because a
-- retry has to stay idempotent.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The ceiling, for the plans that still have one.
--
-- `greatest(a.included_students, c.student_capacity)` was the whole of purchased
-- capacity's effect on the product, and the `case` around it was doing real work: a
-- centre that bought 900 places and moved down to Teacher Pro landed on 150 rather than
-- keeping 900, because the plan prices the admission. With the column out of the
-- expression there is nothing left for the `case` to protect — the teacher tiers take
-- their allowance, the per-student tiers take the sentinel, and both branches now say
-- what the plan is rather than what was bought.
--
-- `coalesce` and `greatest` are no longer written anywhere in this function. It keeps
-- `security definer` and the empty `search_path`, and every reference stays qualified.
-- ---------------------------------------------------------------------------

create or replace function app.student_ceiling(center uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when c.plan in ('center', 'institution') then 2147483647
           else a.included_students
         end
  from public.coaching_centers c
  join public.plan_allowances a on a.plan = c.plan
  where c.id = center;
$$;

comment on function app.student_ceiling(uuid) is
  'Active students this plan allows: the allowance on the teacher tiers, and no '
  'ceiling at all on the per-student tiers, where size decides the daily rate rather '
  'than a door (§3.3). Read by app.admitted_ceiling and app.guard_student_capacity. '
  'Purchased capacity no longer appears here (§16.1 step 28).';

-- The trial's answer is unchanged — a live trial of a higher tier still grants that
-- tier's allowance, which is what the screen promised. Only its comment named the
-- retired mechanism, and a comment that describes what was bought is now a description
-- of nothing.
comment on function app.admitted_ceiling(uuid) is
  'Student places available for a new admission: what the plan allows, or a live '
  'trial of a higher tier, whichever is greater. Null for a centre that does not '
  'exist, which is how the trigger tells "no tenant" from "no room". MASTERPLAN.md '
  '§4.5.';

-- ---------------------------------------------------------------------------
-- 2. The refusal, and the sentence it hands an owner.
--
-- Replaced whole, because `create or replace function` has no other form — but the
-- only thing that changed is the `raise`: the status test, the already-holding-a-place
-- test, the migration bypass, the advisory lock, the tenant check and the count are
-- byte-for-byte what 20260811000060 left standing. `app.admitted_ceiling` is still what
-- it asks, and the lock is still taken before the count, because the race it closes —
-- two managers admitting the last student and both counting one short — is exactly the
-- race that would otherwise survive this migration.
-- ---------------------------------------------------------------------------

create or replace function app.guard_student_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ceiling integer;
  in_use  integer;
begin
  -- Only an active student occupies a place. History is free, or a centre would have
  -- to delete last year's students to admit this year's — and deleting a student
  -- deletes their attendance and their marks.
  if new.status <> 'active' then
    return new;
  end if;

  -- Already holding a place at this centre, so nothing new is being claimed. Both
  -- halves matter: the status test lets a rename or a phone correction through
  -- without a count, and the centre test means moving an active row to another
  -- organisation is still checked against that organisation's ceiling.
  if tg_op = 'UPDATE'
     and old.status = 'active'
     and old.coaching_center_id = new.coaching_center_id
  then
    return new;
  end if;

  -- Migrations and the SQL editor, and nothing else. `service_role` is absent on
  -- purpose: it is the app's own admin client, and the whole point of putting this in
  -- the database is that a Server Action cannot wave it through.
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  -- Held until commit, scoped to this organisation. Two managers adding the last
  -- student both arrive here; without the lock both count 119, both pass, and the
  -- centre quietly runs 121 students on a plan that allows 120.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('students.capacity'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  ceiling := app.admitted_ceiling(new.coaching_center_id);

  -- No ceiling means no centre row, which means this insert has no tenant. Not a
  -- capacity problem and must not be reported as one — and it is still reachable only
  -- this way, because the per-student tiers answer with 2147483647 rather than null.
  if ceiling is null then
    raise exception 'student % names no coaching centre', new.name
      using errcode = '23503';
  end if;

  in_use := app.active_students(new.coaching_center_id);

  if in_use >= ceiling then
    raise exception
      'this plan allows % active students and % are already active', ceiling, in_use
      using errcode  = 'CD001',
            detail   = 'coaching_center_id=' || new.coaching_center_id::text,
            hint     = 'A higher plan includes more active students; a student who has left should be set to a status other than active.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The column, named as what it now is.
--
-- Commented rather than dropped, and the comment is the deliverable: a future reader
-- who finds `student_capacity` on the centre row, and a number in it, has to be able to
-- tell a live mechanism from a fossil without reading the migration history. This says
-- which it is, who decided, and where the decision is written down.
-- ---------------------------------------------------------------------------

comment on column public.coaching_centers.student_capacity is
  'ARCHIVED — read and written by nothing (MASTERPLAN.md §11.14, §16.1 step 28). '
  'Student places bought under the retired seat model, kept because the payments that '
  'bought them are still on the record and dropping the number would leave those rows '
  'unable to explain themselves. The per-student tiers have no student ceiling at all '
  'now (§3.3); a non-zero value here is history and governs nothing.';

comment on column public.payment_intents.grants_capacity is
  'PRESERVED FOR HISTORY, never written again (MASTERPLAN.md §11.14, §16.1 step 28). '
  'Student places this purchase used to add to coaching_centers.student_capacity. A '
  'non-zero value on an intent raised before the retirement is why that intent can no '
  'longer be settled — see public.settle_payment_intent, which refuses rather than '
  'taking money for a ceiling it cannot raise. New intents carry zero.';

-- ---------------------------------------------------------------------------
-- 4. Money cannot buy a ceiling that no longer exists.
--
-- Placed before the first write rather than where the old `grants_capacity` branch was,
-- so a refused intent leaves no receipt, no settled state and no audit line to explain
-- away. Everything above the refusal — the row lock, the existence check, the
-- already-settled read-back, the state test, the expiry test and the provider-reference
-- test — is unchanged from 20260811000073; so is everything below it, including the
-- advisory lock, the receipt it writes and the tier move a subscription carries.
--
-- `capacity_after` stays in the return type and returns zero. It is the shape
-- `src/lib/billing/manual.ts` reads, a `returns table` cannot be altered in place, and
-- a number that means nothing is better than a column that is read back out of an
-- archived field.
-- ---------------------------------------------------------------------------

create or replace function public.settle_payment_intent(
  p_intent uuid,
  p_provider_ref text default null,
  p_method public.payment_method default 'bkash',
  p_settled_by uuid default null,
  p_note text default null
)
returns table (
  intent_id uuid,
  payment_id uuid,
  intent_state public.payment_intent_state,
  charged_bdt numeric(10,2),
  capacity_after integer,
  already boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  it public.payment_intents;
  paid uuid;
begin
  select i.* into it from public.payment_intents i where i.id = p_intent for update;

  if not found then
    raise exception 'payment intent % does not exist', p_intent
      using errcode = '42501';
  end if;

  -- The duplicate path. Reading the original result back is what lets a caller retry
  -- without deciding whether its own timeout meant failure.
  if it.state = 'successful' then
    select p.id into paid
      from public.payments p
     where p.intent_id = it.id
     order by p.created_at
     limit 1;

    return query select it.id, paid, it.state, it.amount_bdt, 0, true;
    return;
  end if;

  if it.state <> 'initiated' then
    raise exception 'payment intent % is % and cannot be settled', it.id, it.state
      using errcode = '42501',
            hint = 'Only an initiated intent settles; the provider reference arrives with that step.';
  end if;

  if it.expires_at <= pg_catalog.now() then
    raise exception 'payment intent % expired at %', it.id, it.expires_at
      using errcode = '42501',
            hint = 'Quote the purchase again at today''s price rather than honouring an old one.';
  end if;
  -- No settlement without something to reconcile against. For the manual provider this is
  -- the TrxID or the deposit slip the founder is looking at.
  if coalesce(p_provider_ref, it.provider_ref) is null then
    raise exception 'settling payment intent % needs the reference the money arrived with', it.id
      using errcode = '42501';
  end if;

  -- The retirement, and the only place it can be said out loud. A capacity intent that
  -- never settled is a place somebody tried to buy and could not be given, because
  -- app.student_ceiling stopped reading the column in this same migration. Refusing
  -- here rather than writing the old number is the difference between a customer being
  -- told to top up instead and a customer paying for nothing.
  if it.grants_capacity > 0 then
    raise exception
      'payment intent % was priced to add % student place(s), which this product no longer sells',
      it.id, it.grants_capacity
      using errcode = '42501',
            hint = 'Quote the centre a top-up instead: the balance pays for students by the day (MASTERPLAN.md §11.2).';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('students.capacity'),
    pg_catalog.hashtext(it.coaching_center_id::text)
  );

  insert into public.payments (
    coaching_center_id,
    intent_id,
    amount_bdt,
    method,
    reference,
    covers_period_start,
    covers_period_end,
    note,
    recorded_by,
    idempotency_key
  )
  values (
    it.coaching_center_id,
    it.id,
    it.amount_bdt,
    p_method,
    coalesce(p_provider_ref, it.provider_ref),
    it.covers_period_start,
    it.covers_period_end,
    coalesce(
      p_note,
      it.purpose::text || ' x' || it.quantity
        || case when it.target_plan is null then '' else ' -> ' || it.target_plan::text end
    ),
    p_settled_by,
    it.idempotency_key
  )
  returning id into paid;

  update public.payment_intents
     set state = 'successful',
         provider_ref = coalesce(p_provider_ref, provider_ref),
         settled_by = coalesce(p_settled_by, settled_by)
   where id = it.id;

  -- §5's tier, moved by the money rather than by a person. Admitted by
  -- 20260811000004's guard because this function is granted to `service_role` alone.
  -- This is now the only thing a settled intent moves: a tier is still something money
  -- buys, and `app.student_ceiling` answers the new one from the plan.
  if it.target_plan is not null then
    update public.coaching_centers
       set plan = it.target_plan,
           trial_plan = null,
           trial_ends_at = null
     where id = it.coaching_center_id;
  end if;

  return query
    select it.id,
           paid,
           'successful'::public.payment_intent_state,
           it.amount_bdt,
           0,
           false;
end;
$$;

-- Restated rather than assumed. `create or replace` carries the old grants over, so
-- these two statements change nothing — and they are here so the next reader of this
-- function does not have to reconstruct its permissions from three migrations back.
revoke all on function public.settle_payment_intent(
  uuid, text, public.payment_method, uuid, text
) from anon, authenticated, public;

grant execute on function public.settle_payment_intent(
  uuid, text, public.payment_method, uuid, text
) to service_role;

comment on function public.settle_payment_intent(
  uuid, text, public.payment_method, uuid, text
) is
  'MASTERPLAN.md §11.2 — mark an initiated intent successful, write its receipt and move '
  'the centre onto the tier it bought, or return the first settlement''s answer if it '
  'already happened. Server-only: the browser cannot reach it, and the intent owns both '
  'the amount and the tier. Refuses an intent priced to add student places, which the '
  'product no longer sells (§16.1 step 28).';
