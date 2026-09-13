/**
 * The seeded price card and `plans.ts` must agree.
 *
 * WHY THIS TEST EXISTS. `app.settle_billing` runs in SQL and cannot import
 * TypeScript, so the rate has to exist in the database as well as in
 * `plans.ts` — which is two copies of every number, and the bug two copies
 * always are. The failure is silent in the worst direction: reprice the first
 * band, forget the migration, and every centre's daily charge quietly stops
 * matching what every screen quotes — no error anywhere, just a burn and a
 * price that disagree.
 *
 * So the migration's INSERT is parsed out of the file rather than restated
 * here, exactly as tests/plan-allowances.test.ts has done for
 * `plan_allowances` since 20260811000036. A copy of the numbers in this test
 * would be a third source of truth and would pass while both of the others
 * drifted.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  PLANS,
  STUDENT_BANDS,
  CENTER_MONTHLY_FLOOR_BDT,
  CENTER_FREE_TEACHER_SEATS,
  CENTER_TEACHER_SEAT_BDT,
  INSTITUTION_INCLUDED_BRANCHES,
  INSTITUTION_MONTHLY_FLOOR_BDT,
  INSTITUTION_BRANCH_BDT,
} from '../src/lib/plans.ts'

const ROOT = path.join(import.meta.dirname, '..')
const MIGRATION = readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260811000080_price_versions.sql'),
  'utf8',
)

/** The seed's bands, parsed out of the INSERT as JSON. */
function seededBands(): { upTo: number | null; poishaEach: number }[] {
  const bands = /\[\{"upTo".*?\}\]'/.exec(MIGRATION)
  assert.ok(bands, 'the price_versions seed no longer carries its bands as a jsonb literal')
  return JSON.parse(bands[0].slice(0, -1))
}

test('exactly one card is seeded, and it is in force from the day the ledger opened', () => {
  // One published rate card at a time is §11.10's rule, and the seed is where
  // it starts holding: two rows here would be two prices in force at once.
  const seeds = [...MIGRATION.matchAll(/insert\s+into\s+public\.price_versions/gi)]
  assert.equal(seeds.length, 1, 'the price card is seeded more than once, or not at all')

  // The founding card is in force immediately, not announced for a future date —
  // there is no previous card for it to succeed.
  assert.match(MIGRATION, /'2026-09-13'/)

  // And the table enforces one card per date, so the second price change cannot
  // land on a date the first already owns.
  assert.match(MIGRATION, /effective_from date not null unique/)
})

test('the bands in the database are the bands in plans.ts, in poisha', () => {
  const seeded = seededBands()

  assert.deepEqual(
    seeded.map((band) => band.upTo),
    STUDENT_BANDS.map((band) => band.upTo),
    'the band boundaries moved without a migration',
  )

  for (let i = 0; i < STUDENT_BANDS.length; i += 1) {
    assert.equal(
      seeded[i].poishaEach,
      STUDENT_BANDS[i].rateBdt * 100,
      `band ${i} (${STUDENT_BANDS[i].upTo ?? 'open'}) charges a different rate than plans.ts`,
    )
  }

  // Marginal and open-ended, the two properties §3.1 rests on. The rate may fall
  // as size rises — that is the taper — but a boundary that moved past the band
  // before it would make the bill non-monotonic somewhere.
  for (let i = 1; i < seeded.length; i += 1) {
    if (seeded[i - 1].upTo !== null) {
      assert.ok(seeded[i].upTo === null || seeded[i].upTo! > seeded[i - 1].upTo!)
    }
  }
  assert.equal(seeded[seeded.length - 1].upTo, null, 'the last band is closed')
})

test('every scalar on the card is the one plans.ts charges, in poisha', () => {
  // The seed's column list, in order, is what the regexes below walk. If the
  // INSERT is reordered, these fail loudly rather than comparing the wrong pair.
  const columns =
    /values\s*\(\s*'2026-09-13',\s*'[^']+',\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/i
      .exec(MIGRATION)
  assert.ok(columns, 'the price_versions seed no longer lists its scalars in the order this test reads')

  const [
    , centerFloor, institutionFloor, teacherPlus, seatPoisha, freeSeats, branchPoisha, includedBranches,
  ] = columns.map(Number)

  assert.equal(centerFloor, CENTER_MONTHLY_FLOOR_BDT * 100, 'the Center floor')
  assert.equal(institutionFloor, INSTITUTION_MONTHLY_FLOOR_BDT * 100, 'the Institution floor')
  assert.equal(teacherPlus, PLANS.teacher_plus.priceBdt * 100, "Teacher Pro's flat monthly")
  assert.equal(seatPoisha, CENTER_TEACHER_SEAT_BDT * 100, 'the teacher seat')
  assert.equal(freeSeats, CENTER_FREE_TEACHER_SEATS, 'the included teacher seats')
  assert.equal(branchPoisha, INSTITUTION_BRANCH_BDT * 100, 'the branch')
  assert.equal(includedBranches, INSTITUTION_INCLUDED_BRANCHES, 'the included branches')
})

test('the card has no write path from the app', () => {
  // §11.10: repricing is a reviewed diff, not an UPDATE somebody ran once. The
  // revokes are the belt to the RLS braces — a pasted blanket grant reopens
  // grants, never policies — and both halves have to be in the migration.
  assert.match(MIGRATION, /alter table public\.price_versions enable row level security/)
  assert.match(MIGRATION, /create policy price_versions_member_read on public\.price_versions\s+for select to authenticated\s+using \(true\)/)
  assert.match(MIGRATION, /revoke all on public\.price_versions from anon, public/)
  assert.match(MIGRATION, /revoke insert, update, delete, truncate on public\.price_versions from authenticated/)
  assert.match(MIGRATION, /grant select on public\.price_versions to authenticated, service_role/)

  // And no function in this migration was created that could write one, since a
  // SECURITY DEFINER helper is the one shape the revokes above cannot speak to.
  assert.doesNotMatch(MIGRATION, /insert into public\.price_versions[\s\S]*?language plpgsql/i)
})

test('a ledger entry names its card exactly when it was priced', () => {
  // §11.10: a settlement records the card it charged from and a recharge the
  // card the quote was priced against; every other kind is a decision, a
  // promotion (whose own row is pinned to a card), or priced nothing at all.
  // The constraint is what keeps "which card" from becoming a column somebody
  // forgets to fill on the one row a customer disputes.
  assert.match(
    MIGRATION,
    /billing_ledger_price_version_purpose check \(\s*\(price_version_id is not null\) = \(kind in \('daily_charge', 'recharge'\)\)\s*\)/,
  )

  // The reference is a plain foreign key, not composite, because a price
  // version is platform-wide — one card for every centre is the point of
  // publishing prices. Spelled out here so a future "make it tenant-safe"
  // refactor knows it was considered, not missed.
  assert.match(MIGRATION, /price_version_id uuid references public\.price_versions \(id\)/)
})
