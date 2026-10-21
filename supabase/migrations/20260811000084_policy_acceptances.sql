-- CoachDesk BD — policy acceptances ledger
--
-- MASTERPLAN.md §14.1:
-- "Consent is a row, not a checkbox. policy_acceptances: id, profile_id,
-- coaching_center_id, policy_kind, policy_version, accepted_at, and — only where
-- there is a legal reason to hold it — ip. Versioned, because a term we change
-- is a term somebody agreed to a different form of, and 'they ticked a box once'
-- is not an answer when the box has been re-worded twice. Recorded at signup
-- and at the first recharge, and re-asked when a version changes. Nothing about
-- a student or a guardian is in this table: the person accepting is the account
-- holder, and a child cannot consent to a contract."
--
-- APPEND-ONLY BY DESIGN. No update or delete policy is granted to authenticated
-- or anon. Every row represents an immutable legal record of policy agreement.

create table if not exists public.policy_acceptances (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null references public.profiles (id) on delete cascade,
  coaching_center_id uuid not null references public.coaching_centers (id) on delete cascade,
  policy_kind        text not null,
  policy_version     text not null,
  accepted_at        timestamptz not null default now(),
  ip                 text
);

-- ---------------------------------------------------------------------------
-- Indexes for tenant isolation, profile lookup, and policy version gating.
-- ---------------------------------------------------------------------------

create index if not exists policy_acceptances_center_idx
  on public.policy_acceptances (coaching_center_id);

create index if not exists policy_acceptances_profile_idx
  on public.policy_acceptances (profile_id);

create index if not exists policy_acceptances_lookup_idx
  on public.policy_acceptances (coaching_center_id, policy_kind, policy_version);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.policy_acceptances enable row level security;

-- Read: center owner, the accepting user themselves, or platform admin
drop policy if exists policy_acceptances_read on public.policy_acceptances;
create policy policy_acceptances_read on public.policy_acceptances
  for select to authenticated
  using (
    profile_id = auth.uid()
    or app.is_owner(coaching_center_id)
    or app.is_platform_admin()
  );

-- Insert: authenticated user accepting for themselves in a center where they are a member
drop policy if exists policy_acceptances_insert on public.policy_acceptances;
create policy policy_acceptances_insert on public.policy_acceptances
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and (app.is_member(coaching_center_id) or app.is_platform_admin())
  );

-- Revoke all mutations from clients; only select and insert are permitted
revoke update, delete, truncate on public.policy_acceptances from public, anon, authenticated;
grant select, insert on public.policy_acceptances to authenticated;

-- Hard revoke on TRUNCATE to satisfy check-migrations.mjs
revoke truncate on public.policy_acceptances from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Audit trigger
-- ---------------------------------------------------------------------------

drop trigger if exists policy_acceptances_audit on public.policy_acceptances;
create trigger policy_acceptances_audit
  after insert or update or delete on public.policy_acceptances
  for each row execute function app.log_audit_entry();
