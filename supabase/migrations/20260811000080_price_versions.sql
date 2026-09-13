-- CoachDesk BD — prices have versions, and old entries are never repriced
-- (MASTERPLAN §11.10, build-order step 21a).
--
-- WHY THIS TABLE EXISTS. The bands in §3.1 are a founder's judgement with no
-- market survey behind them, so they WILL change — and the day they do, a
-- centre holding ৳31,200 of credit bought at ৳25 has a reasonable expectation
-- about what that money buys, while the ledger will by then hold two years of
-- entries computed from a rate card that no longer exists. Without versions a
-- price change is a silent rewrite of history: last March's ৳86.66 day becomes
-- unexplainable, and a customer who screenshotted their balance screen is
-- holding a document the product now contradicts.
--
-- ONE PUBLISHED CARD AT A TIME, SEEDED BY MIGRATION, exactly as §11.10 asks.
-- There is no app write path at all, for the reason `plan_allowances` already
-- gives in its own migration: repricing should be a reviewed diff, not an
-- UPDATE somebody ran once. A new price is a new migration and a new row, and
-- the old row stays exactly as it was for ever.
--
-- WHY `app.settle_billing` CANNOT JUST IMPORT plans.ts: it runs in SQL, and
-- TypeScript does not reach it. So the rate has to exist in the database too —
-- which is two copies of the numbers, and the bug two copies always are. The
-- fence is tests/price-versions.test.ts, which parses this file's seed out and
-- compares it against `src/lib/plans.ts`: the same pattern
-- tests/plan-allowances.test.ts has held plan_allowances to since
-- 20260811000036, applied to the new table. A third copy of the numbers written
-- into the test itself would pass while both of the others drifted — that
-- sentence is in the existing test and is the whole reason this pattern exists.
--
-- THE COLUMN LIST, AND WHERE IT GREW FROM. §11.10 sketched
-- `monthly_floor_poisha` as one column, but plans.ts holds THREE monthly
-- figures — the Center floor, the Institution floor, and Teacher Pro's flat
-- ৳499 — and a card that cannot price a teacher tier cannot price the product.
-- Each gets its own column rather than one jsonb, so the reconciliation test
-- can fail on a named number instead of a diff of a document. The bands stay
-- jsonb because they are a list of any length; `upTo: null` is the open last
-- band, spelled `null` in SQL as it is in TypeScript.
--
-- POISHA THROUGHOUT, as §11.7 settled: ৳2,600 ÷ 30 is neither a whole taka nor
-- a whole poisha, and the ledger is integers. The seed multiplies each taka
-- figure by one hundred exactly once, here, in the only place the copies meet.

create table public.price_versions (
  id uuid primary key default gen_random_uuid(),

  -- The first Dhaka date this card is in force from. One card per date: a
  -- second row for the same date would be two prices in force at once, and the
  -- `order by effective_from desc` that resolves "the card in force" would
  -- answer by insertion order instead of by decision.
  effective_from date not null unique,

  -- §3.1's marginal bands, in poisha per student, cumulatively bounded.
  -- [{"upTo":100,"poishaEach":2500},{"upTo":300,"poishaEach":1800},
  --  {"upTo":600,"poishaEach":1200},{"upTo":null,"poishaEach":800}]
  -- The last band's upTo is null and takes everything above 600.
  student_bands jsonb not null
    check (pg_catalog.jsonb_typeof(student_bands) = 'array'
           and pg_catalog.jsonb_array_length(student_bands) > 0),

  -- §3.2: the bill is max(floor, bandSum(students)) + seats + branches, and the
  -- floor is the software fee. Two floors, because §2.5's Institution floor is
  -- higher than §2.4's Center floor and a card that could not tell them apart
  -- would bill every institution at a centre's minimum — the exact discount
  -- monthlyBillBdt's own docblock records fixing.
  center_monthly_floor_poisha bigint not null check (center_monthly_floor_poisha >= 0),
  institution_monthly_floor_poisha bigint not null check (institution_monthly_floor_poisha >= 0),

  -- Teacher Pro is flat: no bands, no floor arithmetic, one monthly figure that
  -- the whole tier costs (§2.3). Teacher Free is zero and is not a column at
  -- all — §11.6 settled that a free plan burns nothing, and a price of nothing
  -- is the absence of a price, not one of its values.
  teacher_plus_monthly_poisha bigint not null check (teacher_plus_monthly_poisha > 0),

  -- §2.4/§2.5: two teacher seats and three branches included before any are
  -- charged for.
  teacher_seat_poisha bigint not null check (teacher_seat_poisha >= 0),
  free_teacher_seats integer not null check (free_teacher_seats >= 0),
  branch_poisha bigint not null check (branch_poisha >= 0),
  included_branches integer not null check (included_branches >= 1),

  published_at timestamptz not null default pg_catalog.now(),
  note text
);

comment on table public.price_versions is
  'MASTERPLAN.md §11.10 — the published rate cards. Seeded by migration only: '
  'a new price is a new migration and a new row, and there is no write path '
  'from the app at all. tests/price-versions.test.ts holds the seed against '
  'src/lib/plans.ts, which remains the engine and the authority for screens.';

comment on column public.price_versions.student_bands is
  'Marginal per-student bands in poisha, as [{upTo, poishaEach}] with the last '
  'band open (upTo null). Mirrors STUDENT_BANDS in plans.ts, which owns the '
  'numbers and is compared by test.';

-- The founding card: everything plans.ts charges today, in poisha, in force
-- from the day the ledger opened. Every figure is §3.1/§3.2's and every one is
-- uncalibrated — recorded as an open item in §11, not as a settled fact.
insert into public.price_versions (
  effective_from, student_bands,
  center_monthly_floor_poisha, institution_monthly_floor_poisha,
  teacher_plus_monthly_poisha,
  teacher_seat_poisha, free_teacher_seats, branch_poisha, included_branches,
  note
) values (
  '2026-09-13',
  '[{"upTo":100,"poishaEach":2500},{"upTo":300,"poishaEach":1800},{"upTo":600,"poishaEach":1200},{"upTo":null,"poishaEach":800}]',
  199900, 499900,
  49900,
  10000, 2, 75000, 3,
  'The founding card. The same numbers plans.ts holds, uncalibrated; the '
  'reconciliation test is what keeps them one set.'
);

-- ---------------------------------------------------------------------------
-- Who may read a price, and who may write one.
--
-- Read: any signed-in member, because the recharge screen (step 25) shows an
-- owner their own numbers priced from the card in force, and because a price
-- nobody can read is a price nobody can dispute. Select only — there is no
-- UPDATE, no DELETE and no INSERT for anybody from the app, and the revokes
-- below are the belt to the RLS braces: a pasted
-- `grant all on all tables in schema public to authenticated` reopens grants,
-- never policies.
--
-- RLS with a permissive select policy, as `plan_allowances` carries: the table
-- is platform-wide, so the boundary is not tenant but role.
-- ---------------------------------------------------------------------------

alter table public.price_versions enable row level security;

create policy price_versions_member_read on public.price_versions
  for select to authenticated
  using (true);

revoke all on public.price_versions from anon, public;
revoke insert, update, delete, truncate on public.price_versions from authenticated;
grant select on public.price_versions to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Which card an entry was priced from, on the entry (§11.7's row spec).
--
-- 20260811000078 left this column out on purpose — "a uuid column with nothing
-- to reference is exactly the sort of thing that is added 'for later'" — and
-- named this migration as the one that adds it, with its foreign key, in the
-- same file that creates the thing it points at.
--
-- REQUIRED ON A CHARGE AND ON A RECHARGE, NULL ON EVERYTHING ELSE: a
-- settlement records the card it charged from and a recharge the card the quote
-- was priced against (§11.10). A founder adjustment is a decision and not a
-- price; a promotion bonus carries `metadata.promotion_id` and the promotion
-- row itself is pinned to a card (§11.11); the opening balance priced nothing;
-- a settlement failure/retry carries no money and the run that records it
-- (step 22a) names the card instead.
--
-- The reference is deliberately NOT composite with coaching_center_id, because
-- a price version is platform-wide — there is one card for every centre, which
-- is the whole point of publishing prices. check-migrations.mjs's tenant-hole
-- query only joins references whose PARENT is a tenant table, so this is not a
-- hole in that fence.
-- ---------------------------------------------------------------------------

alter table public.billing_ledger
  add column price_version_id uuid references public.price_versions (id);

comment on column public.billing_ledger.price_version_id is
  'The published rate card this entry was priced from. Required on a '
  'daily_charge and on a recharge, null on every other kind; so "why was 14 '
  'March ৳86.66" is answered by joining two rows, for ever, without '
  'recomputing anything.';

alter table public.billing_ledger
  add constraint billing_ledger_price_version_purpose check (
    (price_version_id is not null) = (kind in ('daily_charge', 'recharge'))
  );
