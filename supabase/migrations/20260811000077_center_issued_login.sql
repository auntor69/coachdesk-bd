-- A login the centre minted cannot found a centre of its own.
--
-- MASTERPLAN.md §5.2 lets a manager mint a teacher a login out of nothing but
-- their name — `rahim@user.coachdesk.invalid`, with a password the manager chose
-- and can still read off the roster. That credential belongs to the centre, not
-- to the teacher. `toggleTeacherActive` then DELETES the `center_members` row
-- when a teacher is switched off, so a teacher off for the summer holds a working
-- account with zero memberships, and `homePathForRole(null)` sends exactly that
-- session to /onboarding — the create-a-coaching-centre form.
--
-- None of that reaches the old centre: the membership is gone and RLS refuses.
-- What it reached was this function, which asked only whether the claimant
-- already OWNS a centre. So a manager could mint staff logins and every one of
-- them was a self-serve centre signup: past the phone gate in 20260811000065,
-- with the 14-day Teacher Pro trial the insert below stamps, on a password
-- somebody else knows.
--
-- THE CREDENTIAL IS REFUSED, NOT THE PERSON. A teacher who wants their own
-- Teacher Free batches signs up with their own number and gets the form exactly
-- as before — §1 keeps that tier open to anybody, and §5.1 has always kept a
-- teacher *record* apart from a *login account*. What cannot happen is founding a
-- centre on a login whose password a third party holds.
--
-- BOTH SIGNALS, EITHER ONE ENOUGH. The login address is authoritative, being
-- what actually signs the person in; `profiles.username` is the readable copy
-- 20260811000038's trigger writes and `app.guard_profile_identity` keeps a
-- browser out of. Reading both means a disagreement between them refuses rather
-- than admits.
--
-- THE DOMAIN LITERAL IS COPIED FROM src/lib/bd/username.ts and has to be. This
-- function is `grant execute … to authenticated`, so a browser holding the anon
-- key can call it directly and a check in TypeScript would be advice; Postgres
-- has nowhere to import the constant from. tests/onboarding.test.ts asserts the
-- two strings are the same one. Note it is the username domain and not the suffix
-- — phone logins are `.invalid` too, so `like '%.invalid'` would refuse every
-- owner alive.

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

  -- See the header. A staff login is the centre's key, not this person's.
  if exists (
    select 1 from auth.users u
    where u.id = claimant and u.email like '%@user.coachdesk.invalid'
  ) or exists (
    select 1 from public.profiles p
    where p.id = claimant and p.username is not null
  ) then
    raise exception 'A center-issued login cannot create a center'
      using errcode = '42501';
  end if;

  -- One center per owner. Without this a single account could create unlimited
  -- centers and route around every plan limit by spreading batches across them.
  if exists (
    select 1 from public.center_members m
    where m.user_id = claimant and m.role = 'owner'
  ) then
    raise exception 'This account already owns a center' using errcode = '23505';
  end if;

  -- The two trial columns are set here, on the INSERT, and this is the only place
  -- in the product that may set them from a request. `coaching_centers_guard_billing`
  -- is `before update` only, so creation is free to write the locked columns while
  -- every later write to them is refused unless it comes from the service role —
  -- which is what keeps a browser from extending its own trial by a year.
  insert into public.coaching_centers (
    name, phone, created_by, plan, trial_plan, trial_ends_at
  )
  values (
    clean_name,
    owner_phone,
    claimant,
    'teacher_free',
    'teacher_plus',
    pg_catalog.now() + interval '14 days'
  )
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

-- Re-emitted so a reader checking who may call this does not have to know which
-- migration created it first. `create or replace` kept these anyway.
revoke all on function public.bootstrap_center(text, text, text, boolean) from public;
grant execute on function public.bootstrap_center(text, text, text, boolean) to authenticated;
