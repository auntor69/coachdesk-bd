-- CoachDesk BD — a teacher with no phone number still needs a way in.
--
-- MASTERPLAN.md §5.1 keeps a teacher *record* apart from a *login account*, which
-- is why `teachers.user_id` has been nullable since the first migration: a
-- part-timer who takes two batches a week belongs in the register whether or not
-- they ever open the app. §5.2 is the other half — how you give that person an
-- account afterwards, when the only thing the centre knows about them is their
-- name. The answer is a username transliterated from that name: `rahim`, not
-- `usr_8f92a1c`, because an owner reads it out across a staffroom and the teacher
-- types it into a phone they are holding at arm's length, once, months later.
--
-- WHERE THE UNIQUENESS ACTUALLY COMES FROM, AND IT IS NOT THIS COLUMN. The
-- username is the local part of a login address at a second reserved domain —
-- `rahim@user.coachdesk.invalid`, see src/lib/bd/username.ts — so it inherits
-- `auth.users.email`'s unique constraint. That is what makes two managers who
-- both add a Rahim in the same second land on `rahim` and `rahim01`. §5.2 is
-- blunt about why the distinction matters: "a SELECT that found nothing is not a
-- reservation".
--
-- SO WHAT IS THE COLUMN FOR. Reading. A screen has to be able to tell a teacher
-- what to type, and `select username from profiles` is that, where digging a
-- local part out of a synthetic email address is not. The unique index below is
-- the second lock rather than the first: if the two ever disagree, the login
-- address decides who signs in, and the index is what stops this column claiming
-- otherwise.
--
-- COLLISIONS ARE RESOLVED IN ONE PLACE AND IT IS NOT HERE. The trigger writes
-- what it is handed, verbatim. A trigger that helpfully appended a suffix would
-- be a second resolver, and then this column would read `rahim01` while the
-- account signs in as `rahim` — a displayed username that is not the one that
-- works, which is the only way this feature can really fail. The candidate walk
-- lives in settings/actions.ts, next to the call that finds out a name was taken.

-- ---------------------------------------------------------------------------
-- 1. The column, and the shape the login screen depends on.
--
-- §5.3 puts one field on that screen, labelled "Phone number or username", and
-- lets the server work out which it got — "no radio button, no second tab, no
-- 'are you a teacher?' question". That dispatch is only unambiguous if the two
-- sets cannot overlap, so a username begins with a letter: no form of a
-- Bangladeshi mobile number does. The rest is letters and digits, with no dots or
-- underscores, because this identifier gets read aloud and "rahim underscore two"
-- is a support call.
--
-- Checked in the database as well as in TypeScript because of how the column is
-- written: by a SECURITY DEFINER trigger, out of `raw_user_meta_data`, which is
-- the one channel into `profiles` that does not pass through the app's own code.
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists username text;

alter table profiles
  drop constraint if exists profiles_username_shape;

alter table profiles
  add constraint profiles_username_shape
  check (username is null or username ~ '^[a-z][a-z0-9]{2,29}$');

-- Partial, because `username` is null for everybody who signs in with a number
-- and a pile of nulls is fine. Same shape as `profiles_phone_key` in
-- 20260811000003, for the same reason: the constraint is about the values that
-- exist, not about the absence of a value.
create unique index if not exists profiles_username_key
  on profiles (username)
  where username is not null;

-- ---------------------------------------------------------------------------
-- 2. The signup trigger writes it — and stops trusting metadata it cannot vouch
--    for, which closes a squat that was already open on `phone`.
--
-- `app.handle_new_user` copies three fields out of `raw_user_meta_data` into
-- `profiles`, and that metadata arrives from whoever created the account. Our
-- server creates accounts through `auth.admin.createUser`, so the metadata is
-- ours. But GoTrue's *public* signup endpoint is still live on the project and it
-- also accepts a `data` object, which lands in the same column — so a browser
-- could sign up with a real email address, put somebody else's number in the
-- metadata, and have this trigger write it into a `profiles` row. Nothing about
-- that lets them sign in as anybody, but `profiles_phone_key` is unique across the
-- platform: the number is then denied to the person it belongs to, forever, and
-- they are the one who cannot sign up. That is MASTERPLAN.md §5.4's squatting
-- attack, arriving through the front door rather than through an UPDATE — which is
-- the door 20260811000037 closed.
--
-- A username is unique in exactly the same way, so it would inherit exactly the
-- same hole on the day it was added. Hence the one condition below, applied to
-- both columns.
--
-- WHAT MAKES `ours` TRUSTWORTHY. Not a role check — a GoTrue insert runs as
-- `supabase_auth_admin` whether it came from the admin API or from public signup,
-- so `current_user` cannot tell them apart. The email can. GoTrue's public signup
-- rejects an RFC 2606 reserved TLD outright while `auth.admin.createUser` accepts
-- one, verified against the live project and the whole reason src/lib/bd/phone.ts
-- puts synthetic logins on `.invalid` in the first place. So a `.invalid` address
-- is evidence of the admin endpoint, which only the service_role key reaches, and
-- a browser cannot forge it because the endpoint it can reach refuses to issue it.
--
-- The suffix rather than the two exact domains, because the guarantee comes from
-- the reserved TLD and not from which subdomain sits in front of it.
--
-- `full_name` and `locale` stay unconditional. Neither is unique and neither is
-- identity, so the worst a self-signup can do with them is name its own row.
-- ---------------------------------------------------------------------------

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ours boolean := coalesce(new.email like '%.invalid', false);
  claimed text := nullif(new.raw_user_meta_data ->> 'username', '');
begin
  insert into public.profiles (id, full_name, phone, locale, username)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    case when ours then nullif(new.raw_user_meta_data ->> 'phone', '') end,
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'bn'),
    -- The same expression as `profiles_username_shape`, on purpose and not by
    -- accident: the constraint is what protects the column from a service_role
    -- write, and this is what protects *account creation* from the constraint. A
    -- generator bug that produced `AB` should cost a username somebody has not
    -- been told yet, not the ability to give any teacher a login at all.
    case
      when ours and claimed ~ '^[a-z][a-z0-9]{2,29}$' then claimed
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- No `create trigger` here. `on_auth_user_created` from 20260811000003 points at
-- this function by name and `create or replace` keeps that binding, so recreating
-- the trigger would only be a chance to get its timing wrong.

-- ---------------------------------------------------------------------------
-- 3. The identity guard from 20260811000037 covers the new column too.
--
-- `username` is identity in the same way `phone` is: unique across the platform,
-- so writing somebody else's into your own row denies it to them, and it is what a
-- teacher types to sign in. The column privileges from that migration already
-- refuse a browser write — `grant update (full_name, locale)` names two columns and
-- this is not one of them, and a column added afterwards does not inherit a grant —
-- so, as there, the trigger is what holds if a broad `grant all on all tables`
-- from some setup snippet ever puts the table-level privilege back.
--
-- SECURITY INVOKER on purpose, as in 37: inside a SECURITY DEFINER function
-- `current_user` is the function's owner, which would make the check below pass
-- for everybody.
-- ---------------------------------------------------------------------------

create or replace function app.guard_profile_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.phone is distinct from old.phone
     or new.username is distinct from old.username
     or new.is_platform_admin is distinct from old.is_platform_admin
  then
    if current_user not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception
        'id, phone, username and is_platform_admin are not editable by %',
        current_user
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.guard_profile_identity() is
  'Refuses a browser-side change to profiles.id, phone, username or '
  'is_platform_admin. Belt and braces behind the column privileges in '
  '20260811000037.';

comment on column profiles.username is
  'Sign-in name for a teacher with no phone number (MASTERPLAN.md §5.2). The local '
  'part of the account''s synthetic login address, so auth.users.email is what '
  'actually enforces uniqueness; this column is what a screen can read. Generated '
  'on the server from the teacher''s name, never proposed by a browser.';
