-- ---------------------------------------------------------------------------
-- Coverage becomes a column, so a lapsed subscription can suspend itself.
--
-- MASTERPLAN.md §4.4: "When today is past `covers_period_end` the account is in
-- grace; past grace it is suspended ... the transition is computed from coverage,
-- not from a flag somebody remembered to set." Everything that sentence needs has
-- been in the schema since 20260811000023 except a way for the app to read it.
--
-- WHY A COLUMN AND NOT A JOIN. `payments` is SELECT-only and owner-scoped
-- (20260811000024, and the policy before it), which is right: a teacher has no
-- business reading what their centre pays us. But entitlement is resolved once per
-- session for *every* member, so a resolver reading coverage from `payments` would
-- answer "paid up" to the teacher whose select came back empty and "lapsed" to the
-- owner reading the same centre a second later. The loose answer would go to the
-- session with no right to the data. Denormalising the one date onto the row every
-- member already reads is what makes the answer the same for all of them.
--
-- DERIVED, NEVER SET BY HAND. max(covers_period_end) over the centre's payments and
-- nothing cleverer — the same expression `platform_centers()` has returned as
-- `paid_through` for thirty-six migrations, which is where the name comes from. That
-- function keeps its own derivation rather than reading this column: restating 250
-- lines of security definer body to save one aggregate is a bad trade, and two
-- independent derivations of the same number can be asserted against each other,
-- which scripts/test-rls.mjs now does.
--
-- A TRIGGER THAT RECOMPUTES, NOT ONE THAT ACCUMULATES. `greatest(old, new)` would be
-- cheaper and wrong: §3.8's correction mechanism is a counter-entry, a founder can
-- fix a mistyped period, and both have to be able to pull the date back. Recomputing
-- from the table is the only version where the column cannot drift from the rows.
--
-- NULL IS NOT LAPSED. A centre with no payment row, or with receipts entered before
-- anybody recorded a period, leaves this null — and null must never suspend anyone.
-- The first real customer on this product is `active` with no row in `payments`,
-- because the money arrived before the code that writes receipts did. Reading null as
-- "coverage ran out in 1970" would put the one account we cannot afford to insult into
-- read-only. Lapse bites only where there is coverage to lapse; src/lib/entitlement.ts
-- says the same thing in TypeScript and tests/entitlement.test.ts holds it there.
-- ---------------------------------------------------------------------------

alter table public.coaching_centers
  add column paid_through date;

comment on column public.coaching_centers.paid_through is
  'The furthest date any payment from this centre covers: max(payments.covers_period_end), '
  'maintained by the payments_refresh_coverage trigger. Derived — never written by hand, '
  'and unwritable from a browser session by 20260811000004''s column grants and by '
  'app.guard_center_billing. Null means no payment has said what period it bought, which '
  'is a different fact from lapsed and must never suspend anybody.';

-- ---------------------------------------------------------------------------
-- 1. The recompute, callable on its own.
--
-- Returns the date it settled on so a test can read the answer without a second
-- query, and so the backfill below can be checked by eye.
--
-- SECURITY DEFINER for one reason: the guard trigger in section 3 refuses this very
-- column to anybody but the server, and `current_user` inside a definer function is
-- the function owner, so the recompute passes its own fence. Without it, the day a
-- payment is ever written by something other than service_role — a future settlement
-- path, a support script signed in as a person — the insert would succeed and the
-- coverage update behind it would raise 42501.
--
-- `is distinct from` on the update so an unchanged date writes nothing: the row has an
-- updated_at trigger, and a no-op that bumps it makes the founder panel's "last
-- touched" column lie about a centre nobody has touched.
-- ---------------------------------------------------------------------------

create or replace function app.refresh_paid_through(p_center uuid)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  through date;
begin
  -- max() ignores nulls, so a receipt with no coverage window neither sets this nor
  -- drags it backwards. Same rule as 20260811000023's `billed` CTE, on purpose.
  select max(y.covers_period_end)
    into through
    from public.payments y
   where y.coaching_center_id = p_center;

  update public.coaching_centers c
     set paid_through = through
   where c.id = p_center
     and c.paid_through is distinct from through;

  return through;
end;
$$;

comment on function app.refresh_paid_through(uuid) is
  'Recomputes coaching_centers.paid_through for one centre from max(payments.'
  'covers_period_end) and returns it. The payments trigger''s only job; exposed as a '
  'function so a backfill and a test can call it directly.';

-- ---------------------------------------------------------------------------
-- 2. The trigger.
--
-- AFTER, because max() has to see the row that caused this. FOR EACH ROW rather than
-- per statement: receipts are recorded one at a time by a human confirming money
-- arrived, and a row-level trigger is the version that can name the centre.
--
-- BOTH CENTRES ON AN UPDATE. Moving a payment between centres is not a thing the app
-- does, but `coaching_center_id` is an ordinary column on a table the SQL editor can
-- reach, and a correction that leaves the old centre still claiming coverage it no
-- longer has is exactly the drift this trigger exists to prevent.
-- ---------------------------------------------------------------------------

create or replace function app.refresh_center_coverage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform app.refresh_paid_through(new.coaching_center_id);
  end if;

  if tg_op in ('UPDATE', 'DELETE') and
     (tg_op = 'DELETE' or old.coaching_center_id is distinct from new.coaching_center_id)
  then
    perform app.refresh_paid_through(old.coaching_center_id);
  end if;

  return null;
end;
$$;

comment on function app.refresh_center_coverage() is
  'Trigger on public.payments: keeps coaching_centers.paid_through equal to '
  'max(covers_period_end) for every centre a written row touches, including the centre '
  'a corrected row moved away from.';

drop trigger if exists payments_refresh_coverage on public.payments;

create trigger payments_refresh_coverage
  after insert or update or delete on public.payments
  for each row execute function app.refresh_center_coverage();

-- ---------------------------------------------------------------------------
-- 3. Backfill, and the guard.
--
-- The backfill is one statement rather than a loop over the function: it is the same
-- aggregate, it runs once, and a centre with no payments is left null by the left join
-- instead of being visited to be told nothing changed.
-- ---------------------------------------------------------------------------

update public.coaching_centers c
   set paid_through = bi.through
  from (
    select y.coaching_center_id, max(y.covers_period_end) as through
      from public.payments y
     group by y.coaching_center_id
  ) bi
 where bi.coaching_center_id = c.id
   and c.paid_through is distinct from bi.through;

-- Same body, same roles, one more column — 20260811000036's note applies verbatim, and
-- so does its reason for restating the whole function: `create or replace` gives no
-- other option and the guard is worth reading in one place.
--
-- `paid_through` belongs on this list even though it is derived, because "derived" is a
-- fact about who *should* write it. A browser that could set its own coverage to 2099
-- would buy itself permanent full access without a taka changing hands, which is the
-- same hole as writing `status` directly and reads less like tampering in a log.
create or replace function app.guard_center_billing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.plan is distinct from old.plan
     or new.status is distinct from old.status
     or new.sms_credit_balance is distinct from old.sms_credit_balance
     or new.student_capacity is distinct from old.student_capacity
     or new.trial_plan is distinct from old.trial_plan
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.paid_through is distinct from old.paid_through
  then
    -- The server, and only the server. `service_role` is our admin client (the credit
    -- debit and refund in sendResultSms, and the capacity write after a payment is
    -- confirmed); `postgres`/`supabase_admin` are migrations, the Supabase SQL editor,
    -- and the two definer functions above. A browser session is neither.
    if current_user not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception
        'plan, status, credits, capacity, trial and coverage are set by the server after payment, not by %',
        current_user
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Who may call the two new functions.
--
-- Neither is anybody's to call. `refresh_paid_through` writes a billing column as its
-- owner, so a signed-in session holding EXECUTE on it could not choose the date but
-- could still make the write happen; `refresh_center_coverage` is a trigger function
-- and has no meaning outside one. Postgres grants EXECUTE to PUBLIC on creation and
-- 20260811000002 gave `anon` USAGE on this schema, so both revokes are needed for the
-- reason 20260811000036 sets out.
-- ---------------------------------------------------------------------------

revoke all on function app.refresh_paid_through(uuid) from public, anon;
revoke all on function app.refresh_center_coverage() from public, anon;

grant execute on function app.refresh_paid_through(uuid) to service_role;
