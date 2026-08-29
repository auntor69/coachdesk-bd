-- Give every new centre the 14-day Teacher Pro trial it was promised.
--
-- MASTERPLAN.md §4.3, first row: "Teacher signs up | trial_plan = teacher_plus,
-- trial_ends_at = now + 14 days". Every other row of that table already works.
-- `effectiveEntitlement` in src/lib/entitlement.ts reads both columns, refuses a
-- half-set pair, expires strictly on `ends <= now`, and has twenty tests over it —
-- so the trial has been fully implemented on the reading side for some time, with
-- nothing anywhere writing the pair. Both columns were NULL on every row in the
-- table, which the resolver correctly reads as "no trial", so every signup landed
-- on Teacher Free: a 30-student cap and no Pro feature, on day one, silently.
--
-- WHY THE 14 DAYS LIVES HERE AND NOT IN TYPESCRIPT. A constant with no reader is
-- the thing this arc keeps removing. Nothing in the app needs to compute the end
-- date — it is stamped once, at creation, and every later question ("is the trial
-- live?", "how many days left?") is answered by reading `trial_ends_at` off the
-- row. `TRIAL_DAYS = 30` in src/lib/platform/centers.ts is NOT this number and
-- must not be reused for it: that is the founder's own 30-day sales trial for
-- coaching centres, run by hand with weekly check-ins and priced in the room on
-- day 28. §4.3 is explicit — "Do not merge the two clocks; they answer different
-- questions, for different customers, on different timescales."
--
-- `plan` STAYS `teacher_free`, AND THAT IS NOT AN OVERSIGHT. `plan` records what
-- has been paid for, and a signup has paid nothing. The trial is a separate state
-- laid on top of it, which is the whole of §2.2: "A Pro trial is not a fifth
-- plan." Writing `plan = teacher_plus` for fourteen days would mean an expiring
-- trial has to write the column back down again — a job that must run, on a
-- deadline, or a customer keeps a tier they never bought. The comparison in the
-- resolver cannot fail that way.
--
-- `status` keeps its own default too, for the same shape of reason: §4.4 lists
-- `trial` as reached by "signup, or the founder starting a sales trial", and it
-- means full access rather than any particular tier.
--
-- SAFE FOR A CENTRE-MODE SIGNUP, which is why this is granted unconditionally
-- rather than only when `teacher_mode`. `teacher_mode` chooses whether the owner
-- also gets a teacher row so the teach screens can see them; it does not choose a
-- plan, and both modes start on Teacher Free today. When the founder later sells
-- that centre the Center plan, the leftover `trial_plan = teacher_plus` does not
-- drag them back down: `trialPlan` refuses a trial that ranks below what has been
-- paid for, which is tested in tests/entitlement.test.ts. A trial that cannot
-- downgrade anybody is a trial that is safe to hand out at the door.

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

-- `create or replace` keeps the privileges migration 3 granted, so these two lines
-- change nothing on an existing database. They are re-emitted because a reader
-- checking who may call this function should not have to know which migration
-- happened to create it first.
revoke all on function public.bootstrap_center(text, text, text, boolean) from public;
grant execute on function public.bootstrap_center(text, text, text, boolean) to authenticated;
