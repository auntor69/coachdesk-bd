-- CoachDesk BD — signup verifies an email; the phone OTP gate is retired unread
-- (MASTERPLAN §5.4, rewritten 2026-09-13; the retirement list is §18).
--
-- WHAT THIS REMOVES, AND WHY IT IS SAFE TO REMOVE. Everything
-- 20260811000065 created was built for a gate that could never switch on: it
-- needed an SMS route, which needed a BTRC sender ID, which needed an
-- aggregator account, which needed an NID, and the owner has decided email
-- verification replaces the whole idea — a Gmail address is free to verify and
-- a mobile number is not. The table has never held a row outside tests, because
-- the only writers were the two functions below and the only caller was the
-- signup action, which reached them exclusively through `phoneGateOn()` — and
-- that answered false every day of its life. Dropping it unread is the best
-- available outcome for a table that held hashed codes: nothing was ever
-- leaked, because nothing was ever there.
--
-- Email verification itself is not in this file, because it is not ours to
-- build: Supabase's own confirmation flow sends the code, counts the wrong
-- attempts and confirms the account. The app side (signUp, verifyOtp, resend,
-- the /auth/confirm route for link templates) is src/app/(auth)/actions.ts.
--
-- WHAT SURVIVES, ON PURPOSE. `profiles.phone` — a teacher's contact number is a
-- fact about the register, not a credential. `giveTeacherLogin` and
-- `appointManager` still mint staff accounts keyed on a number through
-- `phoneToLoginEmail`, and those accounts sign in with that number (§5.3).
-- Nothing in this migration touches any of that.

drop function if exists public.issue_phone_code(
  text, text, text, text, integer, integer, integer, integer
);
drop function if exists public.verify_phone_code(text, text, text, integer);
drop table if exists app.phone_verifications;

-- ---------------------------------------------------------------------------
-- bootstrap_center: the centre-issued-login guard, widened to both domains.
--
-- The guard of 20260811000077 refused only `@user.coachdesk.invalid`, because
-- at the time phone-keyed logins were also self-serve signups — an owner — and
-- refusing `%.invalid` outright would have refused every owner on the platform.
-- That reasoning is now inverted by §5.4's rewrite: self-serve signup creates
-- real email addresses only, so the ONLY accounts left on either reserved
-- domain (`phone.` or `user.coachdesk.invalid`) are the ones a centre minted
-- for its staff — exactly the population this fence exists for. A number-keyed
-- staff login could found a centre this morning; it cannot tonight.
--
-- `%.coachdesk.invalid` rather than `%.invalid`: the suffix is ours alone, both
-- domains share it, no real email can end in `.invalid` (RFC 2606 reserves the
-- TLD), and every owner alive has a real address.
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

  -- See the header. A staff login is the centre's key, not this person's — and
  -- since 2026-09-13 every login on a reserved domain is a staff login.
  if exists (
    select 1 from auth.users u
    where u.id = claimant and u.email like '%.coachdesk.invalid'
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
-- migration created it first.
revoke all on function public.bootstrap_center(text, text, text, boolean) from public;
grant execute on function public.bootstrap_center(text, text, text, boolean) to authenticated;
