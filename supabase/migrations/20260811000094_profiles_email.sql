-- CoachDesk BD — the address an account signs up with lives on `profiles`, so a screen
-- can show it and a founder can search by it.
--
-- WHAT WAS WRONG. §5.4 moved signup onto a real email address (20260811000079), so the
-- login field has held three identifiers ever since: a number, a username a centre minted
-- for a teacher who has none, and an address somebody owns. `profiles` kept a readable
-- copy of exactly one of them — `username`, added by 20260811000038 for the same reason
-- this column is being added now — and the real address existed only inside `auth.users`,
-- which no screen can reach: PostgREST exposes `public`, RLS is row-level, and the founder
-- panel is a screen rather than a SQL console.
--
-- The cost of that gap was not cosmetic. Every surface that needed to *name* an account
-- fell back to `profiles.phone`, which is null for precisely the accounts §5.4 created:
-- the founder's customer list had nobody to ring for a centre that signed up through the
-- app, the lockout reset refused a typed address as "not a number" and left the person who
-- could not get in with no way back in at all, and the audit log named actors by a number
-- they do not have. One missing readable column, three dead ends.
--
-- WHY A COLUMN AND NOT A READ OF auth.users. Three ways to reach it were available and
-- all three are worse. A definer function over `auth.users` adds a grant of the auth table
-- to the API surface. `auth.admin.listUsers()` reads every account in the project to find
-- one address, and the founder panel would pay that cost on every page load. A per-screen
-- lookup is the same read repeated. This is the shape the schema already uses for the
-- other two identifiers: the trigger writes what creation knows, and a screen reads it
-- with one column select.
--
-- WHAT IT HOLDS, AND WHAT IT DELIBERATELY DOES NOT. Only a real address. A synthetic login
-- is a key and not somewhere a person reads mail — `8801XXXXXXXXX@phone.coachdesk.invalid`
-- and `rahim@user.coachdesk.invalid` are both on RFC 2606's reserved TLD, which is what
-- guarantees no mail addressed to them can reach a real inbox. §5.3's whole dispatch is
-- built on telling the three apart, so the two `*.invalid` addresses stay out of this
-- column by condition, in the trigger and in the backfill alike. Null therefore means
-- "this account signs in with a number or a username", which is exactly what every reader
-- of the column wants to know.
--
-- NOBODY CAN WRITE IT, AND THAT IS THE POINT. The grant on `profiles` lets an authenticated
-- user update `full_name` and `locale` and nothing else — see the column-level grant the
-- self-service name form relies on. An address is an identity, not a profile field: moving
-- one is the same class of act as moving a number or a username, and none of the three is a
-- form. GoTrue writes `auth.users.email`; this column is the readable copy, and a copy a
-- user could rewrite would be a copy that could disagree with what actually signs them in.
--
-- WHY NOT UNIQUE. Uniqueness is already enforced where it is true — `auth.users.email` — and
-- a duplicate here would be a backfill bug rather than a state anybody can reach. A unique
-- index would turn that bug into a failed deploy at whatever hour it is discovered, on a
-- table every sign-in reads. The index below is for the founder's lockout form, which looks
-- an account up by whatever the person on the line can read out.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists email text;

comment on column public.profiles.email is
  'The address this account signs up with and can be written to. Null for a staff login, '
  'which is keyed on a number or a username instead — see app.handle_new_user. Readable by '
  'the account itself and by a platform admin (profiles_self_read); writable by neither.';

-- ---------------------------------------------------------------------------
-- The rows that already exist. The trigger below only runs on INSERT, so every
-- account created between 20260811000079 and now is backfilled here from the one
-- place the address has lived. `is distinct from` so a re-run is a no-op rather
-- than a write of the same value to every row.
-- ---------------------------------------------------------------------------

update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and u.email is not null
   and u.email not like '%.invalid'
   and p.email is distinct from u.email;

create index if not exists profiles_email_idx on public.profiles (email);

-- ---------------------------------------------------------------------------
-- And the trigger keeps it true for every account created from now on.
--
-- Otherwise 20260811000038's function, restated whole because a function is
-- replaced whole: the guard that reads `ours`, the username that is only taken
-- when the address is a synthetic one, and the `on conflict do nothing` are all
-- unchanged. One value is added, and it is the mirror of the username beside it —
-- that one keeps the readable half of a username login, this one keeps the
-- readable half of an email login, and the two are mutually exclusive by the same
-- boolean.
--
-- `coalesce(..., 'bn')` and the phone branch are untouched. The phone metadata is
-- still only honoured for a staff login, because a self-signup must not be able to
-- write a number onto its own row — `profiles_phone_key` is unique platform-wide and
-- that is the squatting attack §5.4 names.
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
  insert into public.profiles (id, full_name, phone, locale, username, email)
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
    end,
    -- Not lowercased here: GoTrue stores addresses lowercased already, and a
    -- second normalisation in a trigger is a second definition of the same thing.
    case when not ours then new.email end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
