-- Auth support: one account per phone number, and a profile for every user.
--
-- Phone is identity in Bangladesh. If two accounts could hold the same number
-- a teacher would sign in to an empty account and quietly re-enter a term of
-- attendance, so the database enforces it rather than the application.

-- ---------------------------------------------------------------------------
-- One account per number.
-- ---------------------------------------------------------------------------

-- Partial, because phone is nullable and several NULLs are fine.
create unique index if not exists profiles_phone_key
  on profiles (phone)
  where phone is not null;

-- Stored E.164 only. Without this, '01712345678' and '+8801712345678' are two
-- different rows to the unique index above and the guarantee is worthless.
alter table profiles
  drop constraint if exists profiles_phone_e164;

alter table profiles
  add constraint profiles_phone_e164
  check (phone is null or phone ~ '^\+8801[3-9][0-9]{8}$');

-- ---------------------------------------------------------------------------
-- Every auth user gets a profile row, created by the database.
--
-- Doing this in application code means a crash between createUser and the
-- profile insert leaves an account that can sign in but has no name, no locale
-- and no phone. A trigger cannot be skipped.
-- ---------------------------------------------------------------------------

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, locale)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'bn')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Center creation must also create the owner's membership. The claim trigger
-- from the RLS migration does that, but it inserts with role 'owner' only.
-- Teacher Mode needs the same person to also be a teacher, so that the batch
-- and attendance screens — which key off app.my_teacher_ids() — see them.
--
-- Lives in public, not app: PostgREST only exposes public, and this is a
-- deliberate API surface rather than an RLS helper. It is security definer, so
-- it is written defensively — every branch checks auth.uid() itself.
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_center(
  center_name text,
  owner_phone text,
  owner_name text,
  teacher_mode boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_center uuid;
  claimant uuid := auth.uid();
  clean_name text := nullif(btrim(center_name), '');
begin
  if claimant is null then
    raise exception 'bootstrap_center requires an authenticated user'
      using errcode = '28000';
  end if;

  if clean_name is null then
    raise exception 'A center needs a name' using errcode = '22023';
  end if;

  -- One center per owner. Without this a single account could create unlimited
  -- centers and route around every plan limit by spreading batches across them.
  if exists (
    select 1 from public.center_members m
    where m.user_id = claimant and m.role = 'owner'
  ) then
    raise exception 'This account already owns a center' using errcode = '23505';
  end if;

  insert into public.coaching_centers (name, phone, created_by, plan)
  values (clean_name, owner_phone, claimant, 'teacher_free')
  returning id into new_center;

  -- The coaching_centers_claim_owner trigger already added the owner membership.

  if teacher_mode then
    insert into public.center_members (coaching_center_id, user_id, role)
    values (new_center, claimant, 'teacher')
    on conflict do nothing;

    insert into public.teachers (coaching_center_id, user_id, name, phone)
    values (new_center, claimant, coalesce(nullif(btrim(owner_name), ''), 'শিক্ষক'), owner_phone);
  end if;

  return new_center;
end;
$$;

revoke all on function public.bootstrap_center(text, text, text, boolean) from public;
grant execute on function public.bootstrap_center(text, text, text, boolean) to authenticated;
