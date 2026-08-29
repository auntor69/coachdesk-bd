-- CoachDesk BD — a browser may not promote itself to platform admin.
--
-- `profiles` carries three columns that are not the account holder's to edit,
-- and `is_platform_admin` is the worst of them. The `profiles_self_update`
-- policy from 20260811000002 granted UPDATE on the whole row to whoever owns
-- it, so any signed-in user could run one PostgREST call against their own row
-- and become a platform administrator. Confirmed against the real policies
-- before this migration was written:
--
--   UPDATE ALLOWED -> {"is_platform_admin":true}
--
-- What that buys is not one screen. `app.is_platform_admin()` is an arm of the
-- read policy on nearly every table in the schema — students, guardians and
-- their phone numbers, fee invoices, payments, SMS logs — for *every centre on
-- the platform*, plus the whole founder panel. It is the single largest
-- privilege this database can grant, and it was self-service.
--
-- `phone` is the second, and it is the squatting attack MASTERPLAN.md §5.4
-- describes rather than an escalation: `profiles_phone_key` is unique across the
-- platform, so writing somebody else's number into your own row denies that
-- number to its actual owner forever, and they are the ones who cannot sign up.
-- Nothing in the product edits this column after signup — the trigger in
-- 20260811000003 writes it once from the account metadata — so nothing legible
-- is lost by closing it.
--
-- `id` is the third and is the same shape as both: the primary key is what every
-- policy in the schema resolves an identity through.
--
-- RLS cannot fix any of this. A `with check` expression sees the new row and
-- never the old one, so a policy cannot say "this column did not change" — it
-- can only say the row still belongs to you, which it does. Column privileges
-- can, and they are checked before any policy runs. This is the same fix as the
-- billing column lock in 20260811000004, applied to the other table where a
-- single column decides what somebody is allowed to see.

-- ---------------------------------------------------------------------------
-- 1. Column privileges — the actual fix.
--
-- Supabase grants `authenticated` table-level UPDATE on everything in `public`
-- and relies entirely on RLS to filter rows. A table-level grant covers every
-- column, so the narrow grant below only means something once the broad one is
-- gone. Order matters: revoke first, then re-grant.
--
-- The whitelist is exactly what the app writes as the reader themselves: their
-- display name (account/actions.ts `updateName`) and their language
-- (lib/i18n/actions.ts `setLocale`). Both go through the caller's own client on
-- purpose, so that `profiles_self_update` is what decides whose row it is.
--
-- Adding a self-editable column to the account screen means adding it here.
-- Forgetting to means a save that fails loudly, which is the right way round.
-- ---------------------------------------------------------------------------

revoke update on public.profiles from authenticated, anon;

grant update (full_name, locale)
  on public.profiles
  to authenticated;

-- Creating a profile is the `on_auth_user_created` trigger's job, and only its
-- job: it is SECURITY DEFINER, so it runs as the table owner and is unaffected
-- by this revoke. Every account therefore already has its row by the time it can
-- authenticate, which makes a self-insert unreachable on the primary key — but
-- an INSERT privilege on a table with an `is_platform_admin` column is a loaded
-- gun, and PostgREST turns one into an UPDATE on request: `Prefer:
-- resolution=merge-duplicates` compiles to `insert ... on conflict do update`.
-- The narrow grant above already bounds what that could reach. This removes the
-- route.
revoke insert on public.profiles from authenticated, anon;

drop policy if exists profiles_self_insert on profiles;

-- ---------------------------------------------------------------------------
-- 2. Belt and braces — the guard trigger.
--
-- The revoke above is the real fix, and its failure mode is silent in the two
-- ways 20260811000004 already found the hard way. Someone pastes `grant all on
-- all tables in schema public to authenticated` from a Supabase setup snippet
-- and the hole reopens with no error anywhere. And a REVOKE only removes grants
-- the revoking role made, so if the original grant came from `supabase_admin`
-- rather than `postgres`, the statement above succeeds while changing nothing.
--
-- A trigger cannot be granted away, and it is the same three columns either way.
--
-- SECURITY INVOKER on purpose — the absence of `security definer` here is
-- load-bearing. Inside a SECURITY DEFINER function `current_user` is the
-- function's owner, which would make the check below pass for everybody.
-- ---------------------------------------------------------------------------

create or replace function app.guard_profile_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.phone is distinct from old.phone
     or new.is_platform_admin is distinct from old.is_platform_admin
  then
    -- The server, and only the server. `service_role` is our admin client;
    -- `postgres`/`supabase_admin` are migrations and the Supabase SQL editor,
    -- which is where the founder flag is actually set. A browser session is
    -- neither.
    if current_user not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception
        'id, phone and is_platform_admin are not editable by %',
        current_user
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_identity on profiles;

create trigger profiles_guard_identity
  before update on profiles
  for each row execute function app.guard_profile_identity();

comment on function app.guard_profile_identity() is
  'Refuses a browser-side change to profiles.id, phone or is_platform_admin. '
  'Belt and braces behind the column privileges in 20260811000037.';
