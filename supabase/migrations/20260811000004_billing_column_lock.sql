-- CoachDesk BD — lock the columns that decide what a center has paid for.
--
-- `coaching_centers` carries three columns that are not the center's to edit:
-- `plan`, `status`, and the denormalised `sms_credit_balance` that the SMS
-- sender reads before every send. The `centers_owner_update` policy in
-- 20260811000002 granted UPDATE on the whole row, so any signed-in owner could
-- raise their own credit balance and upgrade their own plan straight through the
-- Supabase client — no payment, no server action, no UI needed. Confirmed
-- against the real policies before this migration was written:
--
--   UPDATE ALLOWED -> {"sms_credit_balance":999999,"plan":"institution"}
--
-- That defeats the whole free tier (one batch, 50 capped credits) and every
-- credit charge in sendResultSms.
--
-- The sibling tables were already right: `sms_credit_ledger`, `subscriptions`
-- and `payments` are owner-SELECT only, because rows that move money are written
-- by us after the money moves. The balance those rows are supposed to explain
-- was the one thing left writable — and a ledger can only show tampering after
-- the fact, it cannot prevent it.
--
-- RLS alone cannot fix this. A `with check` expression sees the new row and
-- never the old one, so a policy cannot say "this column did not change".
-- Column privileges can, and they are checked before any policy runs.

-- ---------------------------------------------------------------------------
-- 1. Column privileges — the actual fix.
--
-- Supabase grants `authenticated` table-level UPDATE on everything in `public`
-- and relies entirely on RLS to filter rows. A table-level grant covers every
-- column, so the narrow grant below only means something once the broad one is
-- gone. Order matters: revoke first, then re-grant the presentation columns.
--
-- The whitelist is "what a center-details settings screen may edit". Adding a
-- column to that screen means adding it here; forgetting to means a save that
-- fails loudly, which is the right way round.
-- ---------------------------------------------------------------------------

revoke update on public.coaching_centers from authenticated, anon;

grant update (name, phone, address, bd_area, timezone)
  on public.coaching_centers
  to authenticated;

-- Creating a center is `bootstrap_center`'s job: it is SECURITY DEFINER, so it
-- runs as the table owner and is unaffected by the revoke, and it enforces one
-- center per owner. A direct insert skipped that limit *and* could name its own
-- plan — a second free center is a cheaper way around the one-batch cap than
-- editing the plan column was. Both the privilege and the policy behind it go.
revoke insert on public.coaching_centers from authenticated, anon;

drop policy if exists centers_create on coaching_centers;

-- ---------------------------------------------------------------------------
-- 2. Belt and braces — the guard trigger.
--
-- The revoke above is the real fix, but its failure mode is silent and
-- expensive in two ways. Someone pastes `grant all on all tables in schema
-- public to authenticated` from a Supabase setup snippet and the hole reopens
-- with no error anywhere. And a REVOKE only removes grants the revoking role
-- made, so if the original grant came from `supabase_admin` rather than
-- `postgres`, the statement above succeeds while changing nothing.
--
-- A trigger cannot be granted away, and it is the same three columns either way.
--
-- SECURITY INVOKER on purpose: inside a SECURITY DEFINER function `current_user`
-- is the function owner, which would make the check below always pass.
-- ---------------------------------------------------------------------------

create or replace function app.guard_center_billing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.plan is distinct from old.plan
     or new.status is distinct from old.status
     or new.sms_credit_balance is distinct from old.sms_credit_balance
  then
    -- The server, and only the server. `service_role` is our admin client (the
    -- credit debit and refund in sendResultSms); `postgres`/`supabase_admin` are
    -- migrations and the Supabase SQL editor. A browser session is neither.
    if current_user not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception
        'plan, status and sms_credit_balance are set by the server after payment, not by %',
        current_user
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists coaching_centers_guard_billing on coaching_centers;

create trigger coaching_centers_guard_billing
  before update on coaching_centers
  for each row execute function app.guard_center_billing();
