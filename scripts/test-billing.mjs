/**
 * The burn, and the fences on it — MASTERPLAN.md §4.4/§11.6/§11.7/§11.13, which is
 * build-order step 24 (`§16.1`).
 *
 * WHY THE BALANCE HAS A SUITE OF ITS OWN, NEXT TO test-rls.mjs. That one carries the
 * tenant boundary: whose rows are these, and can a hand-posted form reach them. This one
 * carries arithmetic and access — what a day costs, what happens when the balance cannot
 * cover it, and what a member's first page load of the day is allowed to write. They are
 * different questions with different failure modes: a tenancy bug leaks a customer's data
 * once, and a billing bug charges every customer wrong for a month or locks a paying
 * centre out of its own register. Both boot the same database from the same harness, so
 * neither is a paper test.
 *
 * WHAT IS NEW HERE, AND WHY IT IS THE MOST IMPORTANT THING IN THE FILE. Until step 24
 * nothing in `src/` called `public.settle_billing`, so a wrong number in it changed
 * nobody's day. `src/lib/auth/session.ts` now calls it on the first request of a Dhaka
 * day for any centre that is behind with money in the balance, and
 * `src/lib/entitlement.ts` reads the two figures it returns back as `balance < owed`.
 * That makes this the code path that decides, every morning, whether a customer can run
 * their centre — and every assertion below is about one of its three ways to be wrong:
 * charging the wrong day, charging the wrong amount, or refusing something it should
 * have allowed (or the reverse).
 *
 * THE WORKED FIGURES ARE THE MASTERPLAN'S OWN (§11.6). Center, 60 students and 3
 * teachers: `max(199900, 60 × 2500) + 1 × 10000 = 209900` poisha a month, 6996 a day.
 * At 100 students: `250000 + 10000 = 260000`, 8666 a day. They are asserted as literals
 * because a suite that computes its expectations with the code under test agrees with
 * an off-by-one instead of catching it.
 *
 * Run: node scripts/test-billing.mjs
 */
import { readFileSync } from 'node:fs'

import { bootDatabase, asUser, deniedAsUser } from './lib/pg-harness.mjs'

const { db, migrations } = await bootDatabase()

let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const n = async (tx, sql, params = []) => Number((await tx.query(sql, params)).rows[0].n)

const asService = async (sql, params = []) => {
  await db.exec('set role service_role;')
  try {
    return await db.query(sql, params)
  } finally {
    await db.exec('reset role;')
  }
}

const ledgerBalance = async (center) =>
  Number(
    (await db.query('select balance_poisha from coaching_centers where id = $1', [center]))
      .rows[0].balance_poisha,
  )

const chargedThrough = async (center) =>
  (
    await db.query(
      'select charged_through::text as d from coaching_centers where id = $1',
      [center],
    )
  ).rows[0].d

// The founding card, priced into every charge since migration 80 made a daily_charge
// name the rate it was computed from.
const CARD = '(select id from price_versions order by effective_from desc limit 1)'

const entry = (center, kind, poisha) =>
  asService(
    // A recharge names the card it was priced from (migration 80's purpose check);
    // every other kind carries none.
    kind === 'recharge'
      ? `insert into billing_ledger
           (coaching_center_id, kind, amount_poisha, description, price_version_id)
         values ($1, $2, $3, 'from the suite', ${CARD})`
      : `insert into billing_ledger (coaching_center_id, kind, amount_poisha, description)
         values ($1, $2, $3, 'from the suite')`,
    [center, kind, poisha],
  )

const today = (
  await db.query(`select (now() at time zone 'Asia/Dhaka')::date::text as d`)
).rows[0].d
const yesterday = (await db.query(`select (($1::date) - 1)::text as d`, [today])).rows[0].d

const settle = async (center, ranBy = 'session') =>
  (await asService('select public.settle_billing($1, $2) as out', [center, ranBy])).rows[0].out

/**
 * A centre straight from the schema, named for the plan it burns on.
 *
 * `charged_through` is set to YESTERDAY unless `seededToday` says otherwise, because
 * migration 78 gives every new centre today as a gift (§11.14) and the ordinary cases
 * here want a day that is actually owed. The gift has its own test.
 *
 * The name is built here rather than in the SQL: a parameter used both in a string
 * concatenation and as the plan enum makes Postgres deduce two types for it and refuse
 * the statement.
 */
const burnCentre = async (plan, { recharge = 0, seededToday = false } = {}) => {
  const name = `Burn ${plan} ${Math.random().toString(36).slice(2, 8)}`
  const { rows } = await asService(
    `insert into coaching_centers (name, plan, status, charged_through)
     values ($1, $2, 'active', ${seededToday ? '$3' : '($3::date - 1)'})
     returning id`,
    [name, plan, today],
  )
  const id = rows[0].id
  if (recharge > 0) await entry(id, 'recharge', recharge)
  return id
}

/* -------------------------------------------------------------------------- */
/* The source, because a wrong day here is a wrong charge nobody can see      */
/* -------------------------------------------------------------------------- */

console.log('\nThe burn — what the SQL must say (§11.6, §11.7):')

const burnMigrations = [
  'supabase/migrations/20260811000078_billing_ledger.sql',
  'supabase/migrations/20260811000081_settle_billing.sql',
  'supabase/migrations/20260811000082_billing_access.sql',
]
  // Prose taken off, the same way onboarding.test.ts reads a migration: a comment naming
  // a rule is not the rule, and the headers name `current_date` only to forbid it.
  .map((f) => readFileSync(f, 'utf8').replace(/^\s*--.*$/gm, ''))
  .join('\n')

check(
  'the day is a Dhaka calendar day, never the database clock',
  /at time zone 'Asia\/Dhaka'/.test(burnMigrations) && !/current_date/.test(burnMigrations),
)
check(
  "the lock is taken before the balance is read, in the trigger's own namespace",
  burnMigrations.indexOf("hashtext('billing_ledger.balance')") <
    burnMigrations.indexOf('select coalesce(pg_catalog.sum(l.amount_poisha), 0)'),
)
check(
  'the function takes a centre and a caller, and never an amount',
  /create or replace function public\.settle_billing\(\s*p_center uuid,\s*p_ran_by text default 'session'\s*\)/.test(
    burnMigrations,
  ),
)
check(
  'the base charge is unique per day and the top-up is a row of its own',
  /create unique index billing_ledger_one_base_charge_per_day[\s\S]*?where kind = 'daily_charge' and not top_up/.test(
    burnMigrations,
  ),
)
// Step 24's own requirement, and the one a test can catch before a customer does: the
// figures the access comparison is made of have to come back from the call, not from the
// row the session read before it.
check(
  'the return carries the line and the balance, which is what access is compared from',
  /'balanceAfter', v_balance/.test(burnMigrations) &&
    /'chargedThrough', v_line/.test(burnMigrations),
)
check(
  'and a rate that could not be read comes back null, never as a zero',
  /'dailyPoisha', null/.test(burnMigrations),
)
check(
  'every attempt is numbered, so two of them can never collide on the day',
  (burnMigrations.match(/coalesce\(max\(r\.attempt\), 0\) \+ 1/g) ?? []).length >= 4,
)
check(
  'a day may hold one note about not settling, however many times it is asked',
  (await n(
    db,
    `select count(*)::int as n from pg_indexes
      where schemaname = 'app' and indexname = 'settlement_runs_one_note_per_day'`,
  )) === 1,
)

/* -------------------------------------------------------------------------- */
/* One day, charged whole and once                                            */
/* -------------------------------------------------------------------------- */

console.log('\nA day, charged whole and once (§11.7):')

const centre = await burnCentre('center', { recharge: 250000 })
await asService('update coaching_centers set student_capacity = 100 where id = $1', [centre])

for (let i = 0; i < 60; i += 1) {
  await asService(
    `insert into students (coaching_center_id, name, guardian_phone)
     values ($1, 'Student ' || $2, '01700000001')`,
    [centre, String(i)],
  )
}
for (let i = 0; i < 3; i += 1) {
  await asService(`insert into teachers (coaching_center_id, name) values ($1, 'Teacher ' || $2)`, [
    centre,
    String(i),
  ])
}

const settled = await settle(centre)

check(
  "a day is charged whole, at the masterplan's own worked rate",
  settled.dailyPoisha === 6996 && settled.days === 1 && settled.status === 'settled',
  JSON.stringify(settled),
)
check(
  'the money left is the recharge less the day, and the call says so itself',
  settled.balanceAfter === 250000 - 6996 && (await ledgerBalance(centre)) === 250000 - 6996,
  JSON.stringify(settled),
)
check(
  'and it reports the line it moved to, not the one it read',
  settled.chargedThrough === today && (await chargedThrough(centre)) === today,
  JSON.stringify(settled),
)
check(
  'the charge is one base row carrying the counts and the card it was priced from',
  (await n(
    db,
    `select count(*)::int as n from billing_ledger
      where coaching_center_id = $1 and kind = 'daily_charge' and not top_up
        and charge_date = $2 and amount_poisha = -6996
        and usage_students = 60 and usage_teachers = 3 and usage_branches = 1
        and price_version_id is not null`,
    [centre, today],
  )) === 1,
)

/* -------------------------------------------------------------------------- */
/* The high-water top-up                                                      */
/* -------------------------------------------------------------------------- */

console.log('\nA roster that grew at noon (§11.7 step 4):')

for (let i = 60; i < 100; i += 1) {
  await asService(
    `insert into students (coaching_center_id, name, guardian_phone)
     values ($1, 'Student ' || $2, '01700000001')`,
    [centre, String(i)],
  )
}

const toppedUp = await settle(centre)

check(
  'the day is topped up to the larger rate, by the difference and on a row of its own',
  toppedUp.days === 1 &&
    toppedUp.dailyPoisha === 8666 &&
    (await n(
      db,
      `select count(*)::int as n from billing_ledger
        where coaching_center_id = $1 and kind = 'daily_charge' and top_up
          and charge_date = $2 and amount_poisha = -(8666 - 6996)`,
      [centre, today],
    )) === 1,
  JSON.stringify(toppedUp),
)
// A settlement is a consequence of use, so it is asked for again on every page load of
// the day. The second and the hundredth must be free: the day already holds its base
// charge at its high-water rate, and the difference is zero.
const again = await settle(centre)
check(
  'a later call with the same roster is convergent — nothing new is charged',
  again.days === 0 && (await ledgerBalance(centre)) === 250000 - 8666,
  JSON.stringify(again),
)

/* -------------------------------------------------------------------------- */
/* Whole days or nothing                                                      */
/* -------------------------------------------------------------------------- */

console.log('\nA balance that cannot cover a day buys no day (§11.7):')

const dry = await burnCentre('center')
await entry(dry, 'recharge', 50)

const refused = await settle(dry)

check(
  'fifty poisha against an eighty-six taka day charges nothing at all',
  refused.status === 'insufficient_balance' && refused.days === 0,
  JSON.stringify(refused),
)
check(
  'the money it did have stays theirs',
  (await ledgerBalance(dry)) === 50,
  String(await ledgerBalance(dry)),
)
check(
  'and the line does not move, because a day that was not paid for has not been paid for',
  (await chargedThrough(dry)) === yesterday,
  await chargedThrough(dry),
)
check(
  'the refusal is on the record, with what the call could see',
  (await n(
    db,
    `select count(*)::int as n from app.settlement_runs
      where coaching_center_id = $1 and charge_date = $2
        and status = 'insufficient_balance' and amount_poisha = 0
        and usage_students = 0 and ran_by = 'session'`,
    [dry, today],
  )) === 1,
)

// THE REGRESSION THIS FILE EXISTS FOR. 81 numbered a settled attempt and left a refused
// one on the column's default of 1, so the second refusal of a day collided with
// `settlement_runs_once` and the whole statement raised — including any day the same call
// had managed to charge before it. Step 24 calls this from the session, so "the second
// attempt of the day" is the second page load of the day, and raising there is a blank
// screen for the customer who most needs to see their balance.
const refusedAgain = await settle(dry)

check(
  'a second refusal the same day answers instead of raising',
  refusedAgain.status === 'insufficient_balance' && refusedAgain.days === 0,
  JSON.stringify(refusedAgain),
)
check(
  'and the day keeps one note about it, not one per tap',
  (await n(
    db,
    `select count(*)::int as n from app.settlement_runs
      where coaching_center_id = $1 and charge_date = $2`,
    [dry, today],
  )) === 1,
)
check(
  'no second row was written to the ledger either',
  (await n(
    db,
    `select count(*)::int as n from billing_ledger
      where coaching_center_id = $1 and kind = 'daily_charge'`,
    [dry],
  )) === 0,
)

/* -------------------------------------------------------------------------- */
/* Catch-up, and the day the migration gave everybody                         */
/* -------------------------------------------------------------------------- */

console.log('\nDays missed while nobody was looking, and days that were granted:')

await asService('update coaching_centers set charged_through = ($2::date - 3) where id = $1', [
  centre,
  today,
])
const caughtUp = await settle(centre)

// Two days are charged and today was already paid for — so `days` is two and the line
// lands on today either way, which is the invariant the reconciliation reads it for.
check(
  'the missed days are charged at the current size, oldest first',
  caughtUp.days === 2 && caughtUp.chargedThrough === today,
  JSON.stringify(caughtUp),
)
check(
  'one row per day, and the series has no hole in it',
  (await n(
    db,
    `select count(*)::int as n from billing_ledger
      where coaching_center_id = $1 and kind = 'daily_charge'
        and charge_date in (($2::date - 2), ($2::date - 1))`,
    [centre, today],
  )) === 2,
)

const gifted = await burnCentre('center', { recharge: 250000, seededToday: true })
const giftedSettle = await settle(gifted)

// The day the ledger opened is a gift (§11.14): the line is already at today, so there is
// no day to charge and the balance is untouched. The status is `settled` and not
// `nothing_due` because the function did reach the today branch and found it already
// paid — the distinction the founder's reconciliation walks.
check(
  'a centre on its seeding day is charged nothing, balance or no balance',
  giftedSettle.days === 0 && giftedSettle.balanceAfter === 250000,
  JSON.stringify(giftedSettle),
)
check(
  'and nothing was written for a day it does not owe',
  (await n(
    db,
    `select count(*)::int as n from billing_ledger
      where coaching_center_id = $1 and kind = 'daily_charge'`,
    [gifted],
  )) === 0,
)

/* -------------------------------------------------------------------------- */
/* Teacher tiers, and the free one that has no rate at all                    */
/* -------------------------------------------------------------------------- */

console.log('\nTeacher tiers (§11.6):')

const plus = await burnCentre('teacher_plus', { recharge: 50000 })
const plusSettle = await settle(plus)

check(
  "Teacher Pro is its flat figure over thirty, floored in the customer's favour",
  plusSettle.dailyPoisha === Math.floor(49900 / 30) && plusSettle.days === 1,
  JSON.stringify(plusSettle),
)

const free = await burnCentre('teacher_free', { recharge: 50000 })
const freeSettle = await settle(free)

check(
  'the free tier burns nothing and writes nothing',
  freeSettle.status === 'nothing_due' && freeSettle.dailyPoisha === 0 && freeSettle.days === 0,
  JSON.stringify(freeSettle),
)
check(
  'and its line does not move, because there is no day it could have bought',
  (await chargedThrough(free)) === yesterday,
  await chargedThrough(free),
)

/* -------------------------------------------------------------------------- */
/* The fences on the call itself                                              */
/* -------------------------------------------------------------------------- */

console.log('\nWho may settle, and who may not (§11.7):')

/* -------------------------------------------------------------------------- */
/* The chain has one order, whoever reads it (§11.12, §11.13)                 */
/* -------------------------------------------------------------------------- */

// THE DEFECT THIS SECTION EXISTS FOR. The reconciliation walks the ledger in `created_at`
// order and checks that each entry opens where the last one closed. Under PGlite
// `clock_timestamp()` resolves to the millisecond, two consecutive statements routinely
// land in the same one, and the walk then falls back to a uuid tiebreak — which puts
// entries in the wrong order half the time and reports a break that is not there. That is
// a false alarm on the founder's own screen, and 20260811000083 makes the stamp an order
// rather than a clock reading.
const outOfOrder = await n(
  db,
  `with walked as (
     select l.created_at,
            lag(l.created_at) over (order by l.created_at, l.id) as previous
       from public.billing_ledger l
      where l.coaching_center_id = $1
   )
   select count(*)::int as n from walked
    where previous is not null and created_at <= previous`,
  [centre],
)

check(
  'two entries written in the same clock tick still have a strict order',
  outOfOrder === 0,
  String(outOfOrder),
)

// The founder panel's own second question, over a centre that has had a recharge, a base
// charge, a noon top-up and three catch-up days written into it — the shape the flaky run
// had, and the walk that has to hold for every centre and not just this one.
const broken = await n(
  db,
  `with walked as (
     select l.balance_before, l.balance_after,
            lag(l.balance_after) over (
              partition by l.coaching_center_id order by l.created_at, l.id
            ) as previous
       from public.billing_ledger l
   )
   select count(*)::int as n from walked
    where balance_before <> coalesce(previous, 0)`,
)

check(
  'and the books hold wherever they are read from',
  broken === 0,
  String(broken),
)

const owner = (
  await db.query('insert into auth.users (id) values (gen_random_uuid()) returning id')
).rows[0].id

check(
  'a signed-out request cannot settle anything',
  await deniedAsUser(db, null, 'select public.settle_billing($1)', [plus]),
)

await asService(
  `insert into center_members (coaching_center_id, user_id, role) values ($1, $2, 'owner')`,
  [centre, owner],
)

check(
  "a member of one centre cannot settle another's",
  await deniedAsUser(db, owner, 'select public.settle_billing($1)', [plus]),
)

const asMember = await asUser(db, owner, (tx) =>
  tx.query('select public.settle_billing($1) as out', [centre]),
)
// The recharge less the day it opened on, the noon top-up, and the two catch-up days
// charged at the current size: 250000 − 6996 − 1670 − 8666 − 8666. Nothing is charged
// here — the day is paid up and the roster has not moved — and the balance it reports is
// the one the row holds, which is what makes the return an answer rather than a receipt.
check(
  "a member's own centre settles through their own session, and it charges nothing",
  asMember.rows[0].out.ok === true &&
    asMember.rows[0].out.days === 0 &&
    asMember.rows[0].out.balanceAfter === 250000 - 6996 - 1670 - 8666 - 8666,
  JSON.stringify(asMember.rows[0].out),
)

console.log(`\n${passed} passed, ${failed} failed`)
console.log(`${migrations.length} migration(s) applied cleanly.\n`)
await db.close()
process.exit(failed ? 1 : 0)
