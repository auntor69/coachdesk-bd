-- ---------------------------------------------------------------------------
-- Consent is a row, not a checkbox (MASTERPLAN.md §14.1 — build-order step 25a).
--
-- WHY THIS TABLE EXISTS AT ALL. Seven pages of terms are worth nothing on their
-- own: the first taka arrives against a promise that the balance is
-- non-refundable and never expires, and a promise nobody can show that a
-- particular person agreed to is a promise that loses a dispute. So what is
-- recorded here is not a tick — it is *which wording of which document* a named
-- profile agreed to, and when.
--
-- VERSIONED PER POLICY, and that is the whole design. A term we change is a term
-- somebody agreed to a different form of, and "they ticked a box once" is not an
-- answer when the box has been re-worded twice. The version is the date the page
-- was last written (`PolicyDoc.version` in src/lib/legal/policies.ts), stored as
-- text and compared for equality — never ordered, never parsed, and never
-- derived from `accepted_at`, which is the date the agreement happened rather
-- than the date the words were written.
--
-- NO STUDENT AND NO GUARDIAN IS ANYWHERE IN THIS TABLE. The person accepting is
-- the account holder — the centre — and a child cannot consent to a contract.
-- `profile_id` names the adult, and that is the only person this table is about.
--
-- WHAT THIS FILE DOES NOT DO. It does not write the pages (§14.1's seven
-- documents, in src/lib/legal), and it does not decide when somebody is asked:
-- the screen calls `recordAcceptance` in src/lib/legal/acceptance.ts at signup
-- and at the first recharge, and the re-ask rule is a comparison of the version
-- stored here against the version a page is showing today.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The vocabulary.
--
-- A type rather than free text, for the reason every other vocabulary in this
-- schema is one: a misspelt kind is not a refused write, it is a seventh policy
-- nobody wrote, sitting in a row that reads as an acceptance of something.
--
-- The seven names are §14.1's own list, in the order the pages are read: money
-- first, because the money is the part that cannot wait.
-- ---------------------------------------------------------------------------

create type public.policy_kind as enum (
  'prepaid_billing',
  'refunds',
  'terms',
  'privacy',
  'acceptable_use',
  'deletion',
  'security'
);

comment on type public.policy_kind is
  'MASTERPLAN.md §14.1. One value per legal page. `prepaid_billing`, `refunds`, '
  '`terms`, `privacy` and `acceptable_use` are the five a person is actually '
  'asked to accept; `deletion` and `security` are statements of what we do with '
  'a request, and a checkbox on them would be consent theatre.';

-- ---------------------------------------------------------------------------
-- 2. The rows.
--
-- `coaching_center_id` IS NULLABLE AND THAT IS NOT A GAP. Signup happens before
-- a centre exists — the same person creates one on the next screen, and a
-- teacher never creates one at all — so the acceptance that matters most (the
-- one taken at the door) has no centre to name yet. §14.1 lists the column and
-- this is why it can be empty: it is the *context* of an acceptance, not its
-- subject.
--
-- ON DELETE SET NULL rather than cascade, for the same reason. A centre being
-- removed must not erase the record that its owner agreed to the terms; the
-- agreement is with the platform. Deleting the profile does cascade, because a
-- row about a person who no longer exists is the only row here with nothing
-- left to point at.
--
-- `ip` IS DECLARED AND DELIBERATELY NEVER WRITTEN. §14.1 says to hold it "only
-- where there is a legal reason to hold it", and there is none in Bangladesh for
-- this product. The column exists so that adding one is an INSERT and not a
-- migration on a table that will by then hold every customer's consent — and the
-- comment on it says so, because a column with a name like this one is otherwise
-- a column somebody fills in "for safety".
-- ---------------------------------------------------------------------------

create table public.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  coaching_center_id uuid references public.coaching_centers (id) on delete set null,
  policy_kind public.policy_kind not null,
  -- The date the page was last written, as YYYY-MM-DD. The regex is not
  -- decoration: the format is what makes a row readable by eye in psql for a
  -- year, and a shape that cannot drift into 'v2' is a shape that cannot be
  -- compared wrongly against a page's own version.
  policy_version text not null check (policy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  accepted_at timestamptz not null default now(),
  -- Not a timestamptz: accepting twice on the same day at the same version is not
  -- a fact about when before, it is the same fact, and the unique index below
  -- already says so.
  ip inet
);

comment on table public.policy_acceptances is
  'MASTERPLAN.md §14.1. One row per person per policy per version they agreed '
  'to. The agreement is with the platform, so a centre going away leaves the '
  'rows behind (coaching_center_id becomes null) while a profile going away '
  'takes them with it.';

comment on column public.policy_acceptances.coaching_center_id is
  'Which centre the person was acting for, or null when they had none yet — '
  'which is every signup, because the centre is created on the next screen.';

comment on column public.policy_acceptances.policy_version is
  'The PolicyDoc.version of the page as it read when it was accepted, as '
  'YYYY-MM-DD. Compared for equality against the version in force today; a '
  'mismatch is what asks the reader again.';

comment on column public.policy_acceptances.ip is
  'Never written. No legal reason to hold it in Bangladesh for this product '
  '(§14.1), and the column is here so that adding one later is an INSERT rather '
  'than a migration on a table holding every customer''s consent.';

-- ---------------------------------------------------------------------------
-- 3. One row per person, per policy, per version.
--
-- TWO PARTIAL INDEXES RATHER THAN ONE UNIQUE CONSTRAINT, and the reason is the
-- null. Postgres treats nulls as distinct in a unique index, so
-- `unique (profile_id, coaching_center_id, policy_kind, policy_version)` would
-- accept the same signup acceptance any number of times — the exact row this
-- table exists to hold once — because `coaching_center_id` is null on all of
-- them. (`UNIQUE NULLS NOT DISTINCT` would say it in one line, and this schema
-- does not depend on a server version for a guarantee.) The two indexes below
-- say it in two, and each is reachable on its own columns, which is also what
-- makes the write path's "insert and treat a duplicate as done" work.
--
-- The uniqueness is the fence behind the screen's idempotency: `recordAcceptance`
-- inserts and treats a unique violation as success, so a form submitted twice —
-- a double tap, a retry on a flaky connection — records one consent and not two.
-- ---------------------------------------------------------------------------

create unique index policy_acceptances_center_version
  on public.policy_acceptances (profile_id, coaching_center_id, policy_kind, policy_version)
  where coaching_center_id is not null;

create unique index policy_acceptances_platform_version
  on public.policy_acceptances (profile_id, policy_kind, policy_version)
  where coaching_center_id is null;

-- The read the app actually makes: every version this person has agreed to, so
-- the re-ask rule can compare them against today's. Centres are few per person
-- and this is a small table, but it is read on the signup path and on the plan
-- screen, and both of those are on the critical path of a customer paying.
create index policy_acceptances_profile_idx
  on public.policy_acceptances (profile_id, policy_kind);

-- ---------------------------------------------------------------------------
-- 4. The fences.
--
-- SELF-READ AND SELF-INSERT ONLY. There is no staff policy and no platform
-- policy, and both absences are deliberate rather than an omission:
--
--   * another member of the centre never needs this row. It answers "has this
--     person agreed", and the only reader that ever asks is the person's own
--     session and the server action acting for it.
--   * the founder's own audit is a `platform_*` function away if it is ever
--     needed, and §11.4's rule applies here too: a table of who agreed to what
--     is not something a browser should be able to page through.
--
-- NO UPDATE AND NO DELETE FOR ANYBODY. A consent that can be edited is not a
-- record of consent. The rows are append-only from the app's side, the same
-- posture `billing_ledger` takes, and the cascade on `profiles` is the database
-- doing what the person asked rather than a screen rewriting history.
--
-- NO INSERT GRANT IN PRACTICE, THOUGH THIS MIGRATION GRANTS ONE: the app writes
-- through the service role (see src/lib/legal/acceptance.ts), because the live
-- generated types are older than this table. The grant and the policy stay
-- because they are what makes the boundary true rather than incidental — a
-- future session-scoped write gets `profile_id = auth.uid()` enforced by
-- Postgres, not by a Server Action remembering to.
-- ---------------------------------------------------------------------------

alter table public.policy_acceptances enable row level security;

create policy policy_acceptances_self_read on public.policy_acceptances
  for select to authenticated
  using (profile_id = auth.uid());

-- The `with check` asks two questions, and the second one is not decoration: a row that names
-- a centre is a claim that the person was acting for it, and `app.is_member` is what makes
-- that claim true. Without it, anybody signed in could record "I agreed while acting for
-- somebody else's centre" — their own consent, so not a tenant leak, and a lie about the
-- context that the founder's audit would read as fact. Null stays allowed, because every
-- signup acceptance has no centre yet (see the column's comment).
create policy policy_acceptances_self_insert on public.policy_acceptances
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and (coaching_center_id is null or app.is_member(coaching_center_id))
  );

revoke all on public.policy_acceptances from anon, public;
revoke update, delete, truncate on public.policy_acceptances from authenticated;
grant select, insert on public.policy_acceptances to authenticated, service_role;
