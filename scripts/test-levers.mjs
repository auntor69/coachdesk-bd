/**
 * The two founder levers, against real PostgreSQL — MASTERPLAN.md §11.7, build-order
 * step 26, in `public.founder_adjust_balance` and `public.founder_grant_days`
 * (20260811000086).
 *
 * WHY ITS OWN SUITE, NEXT TO test-billing.mjs AND test-recharge.mjs. Those two carry the
 * burn and the money coming in. This one carries the two ways a human overrides either,
 * and it is the only place in the product where a person moves money or days by hand — so
 * the failures it guards are the ones nothing else can catch: a grant that credits taka
 * (§11.7 says days are days), a grant that lands on a line that lapsed a fortnight ago and
 * therefore changes nothing, an adjustment that takes a balance below nothing, and a lever
 * that a customer's own session can pull.
 *
 * THE TWO ENGINES ARE CHECKED AGAINST EACH OTHER HERE. `lib/billing/levers.ts` works out
 * the date the days form promises before the tap; the function works out the date it
 * writes. The assertions below compare the function's answer with `grantReach`'s, so the
 * screen and the database cannot drift into telling a founder two different days.
 *
 * Run: node scripts/test-levers.mjs
 */
import { bootDatabase, asUser, deniedAsUser } from './lib/pg-harness.mjs'
import { grantReach } from '../src/lib/billing/levers.ts'

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

const n = async (tx, sql, params = []) =>
  Number((await tx.query(sql, params)).rows[0].n)

const asService = async (sql, params = []) => {
  await db.exec('set role service_role;')
  try {
    return await db.query(sql, params)
  } catch (error) {
    throw error
  } finally {
    await db.exec('reset role;')
  }
}

const today = (
  await db.query(`select (now() at time zone 'Asia/Dhaka')::date::text as d`)
).rows[0].d

/** A centre as the schema makes one: the opening entry written, the line seeded today. */
const centre = async (plan = 'center') =>
  (
    await asService(
      `insert into coaching_centers (name, plan, status)
       values ('Lever ' || gen_random_uuid()::text, $1, 'active')
       returning id, charged_through::text as line`,
      [plan],
    )
  ).rows[0]

const balance = async (center) =>
  Number(
    (await db.query('select balance_poisha from coaching_centers where id = $1', [center]))
      .rows[0].balance_poisha,
  )

const line = async (center) =>
  (await db.query('select charged_through::text as d from coaching_centers where id = $1', [
    center,
  ])).rows[0].d

const recharge = (center, poisha) =>
  asService(
    `insert into billing_ledger
       (coaching_center_id, kind, amount_poisha, description, price_version_id)
     values ($1, 'recharge', $2, 'from the suite',
             (select id from price_versions order by effective_from desc limit 1))`,
    [center, poisha],
  )

/** The founder, as a session: the panel is a signed-in platform admin, not a key. */
const founder = (
  await db.query(
    `insert into auth.users (email) values ('founder-levers@coachdesk.invalid') returning id`,
  )
).rows[0].id
await db.query('update profiles set is_platform_admin = true where id = $1', [founder])

/** A customer's own owner: a member of the centre, and not the platform admin. */
const owner = (
  await db.query(
    `insert into auth.users (email) values ('owner-levers@coachdesk.invalid') returning id`,
  )
).rows[0].id

const grant = (center, days, reason) =>
  asUser(db, founder, (tx) =>
    tx.query('select public.founder_grant_days($1, $2, $3) as out', [center, days, reason]),
  )

const adjust = (center, poisha, reason) =>
  asUser(db, founder, (tx) =>
    tx.query('select public.founder_adjust_balance($1, $2, $3) as out', [
      center,
      poisha,
      reason,
    ]),
  )

/**
 * A refusal, by its SQLSTATE rather than by its message.
 *
 * The code is what the Server Action reads (§11.7's fences are raised in `42501` and
 * `23514`), so asserting the sentence instead would be a test of the wording.
 */
const refusal = async (run) => {
  try {
    await run()
    return null
  } catch (error) {
    return error.code ?? String(error.message)
  }
}

/* -------------------------------------------------------------------------- */
/* A grant is days, and it moves the line and nothing else (§11.7)            */
/* -------------------------------------------------------------------------- */

console.log('\nA grant of days:')

const granted = await centre()
await recharge(granted.id, 500_000)

const seven = (await grant(granted.id, 7, 'Closed for Eid')).rows[0].out

check('the grant answers with the day it reaches', seven.ok === true, JSON.stringify(seven))
check(
  "the day is the masterplan's own arithmetic, and the same one the screen promised",
  seven.chargedThrough === grantReach(granted.line, 7, today),
  `${seven.chargedThrough} against ${grantReach(granted.line, 7, today)}`,
)
check(
  'and the line on the row moved with it',
  (await line(granted.id)) === seven.chargedThrough,
  await line(granted.id),
)
check(
  'the entry carries no money, which is the whole of §11.7',
  (await n(
    db,
    `select count(*)::int as n from billing_ledger
      where coaching_center_id = $1 and kind = 'founder_grant_days'
        and amount_poisha = 0 and charge_date = ($2::date + 7)`,
    [granted.id, today],
  )) === 1,
)
check(
  'the balance did not move at all',
  (await balance(granted.id)) === 500_000,
  String(await balance(granted.id)),
)
check(
  'the reason and the count are on the row the customer will read',
  (await n(
    db,
    `select count(*)::int as n from billing_ledger
      where coaching_center_id = $1 and kind = 'founder_grant_days'
        and description = 'Closed for Eid' and metadata ->> 'days' = '7'
        and created_by = $2`,
    [granted.id, founder],
  )) === 1,
)

// The point of the lever: a line ahead of today stops the burn. Nothing is charged while
// the granted days last, and no amount of money is spent on them.
const settled = (
  await asService('select public.settle_billing($1, $2) as out', [granted.id, 'founder'])
).rows[0].out

check(
  'a granted line buys the days: the burn has nothing to charge',
  settled.status === 'nothing_due' && settled.days === 0 && settled.chargedPoisha === 0,
  JSON.stringify(settled),
)
check(
  'and the money it did not spend is still theirs',
  (await balance(granted.id)) === 500_000,
  String(await balance(granted.id)),
)

/* -------------------------------------------------------------------------- */
/* A lapsed centre is granted days from today, not from where it lapsed       */
/* -------------------------------------------------------------------------- */

console.log('\nA centre that ran dry a fortnight ago:')

const lapsed = await centre()
await asService(
  `update coaching_centers set charged_through = ($2::date - 14) where id = $1`,
  [lapsed.id, today],
)
await recharge(lapsed.id, 200_000)

const rescued = (await grant(lapsed.id, 3, 'Sorry about that')).rows[0].out

check(
  'three days from today, not three days from the day it lapsed',
  rescued.chargedThrough === grantReach(today, 3, today),
  `${rescued.chargedThrough} against ${grantReach(today, 3, today)}`,
)
check(
  'so the centre is writable again the moment the grant lands',
  (await line(lapsed.id)) === rescued.chargedThrough && rescued.chargedThrough > today,
  await line(lapsed.id),
)
check(
  'and `owed` is nothing on the day the grant was made',
  (await n(
    db,
    `select greatest(0, $2::date - charged_through)::int as n
       from coaching_centers where id = $1`,
    [lapsed.id, today],
  )) === 0,
)

/* -------------------------------------------------------------------------- */
/* A grant from a line already ahead keeps counting from that line            */
/* -------------------------------------------------------------------------- */

const ahead = await centre()
await asService(`update coaching_centers set charged_through = ($2::date + 10) where id = $1`, [
  ahead.id,
  today,
])

const stacked = (await grant(ahead.id, 5, 'One more week')).rows[0].out

check(
  'a second grant adds to a line that is already ahead',
  stacked.chargedThrough === grantReach(addDays(today, 10), 5, today),
  stacked.chargedThrough,
)

/**
 * Local day arithmetic, so the "already ahead" fixture's expectation is not computed by
 * `grantReach` and the assertion is not two copies of the same module agreeing.
 */
function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/* -------------------------------------------------------------------------- */
/* The refusals                                                               */
/* -------------------------------------------------------------------------- */

console.log('\nWho may pull a lever, and what may not be written:')

const member = await centre()
await asService(
  `insert into center_members (coaching_center_id, user_id, role) values ($1, $2, 'owner')`,
  [member.id, owner],
)

check(
  "a centre's own owner cannot grant themselves days",
  await refusal(() =>
    asUser(db, owner, (tx) =>
      tx.query('select public.founder_grant_days($1, $2, $3) as out', [member.id, 30, 'please']),
    ),
  ) === '42501',
)
check(
  "and cannot move their own balance either",
  await refusal(() =>
    asUser(db, owner, (tx) =>
      tx.query('select public.founder_adjust_balance($1, $2, $3) as out', [
        member.id,
        100_000,
        'please',
      ]),
    ),
  ) === '42501',
)
check(
  'a signed-out request can do neither',
  (await deniedAsUser(db, null, 'select public.founder_grant_days($1, $2, $3)', [
    member.id,
    30,
    'please',
  ])) &&
    (await deniedAsUser(db, null, 'select public.founder_adjust_balance($1, $2, $3)', [
      member.id,
      100,
      'please',
    ])),
)

check('a grant of no days grants nothing', (await refusal(() => grant(member.id, 0, 'none'))) === '22023')
check(
  'a grant of a negative number of days is refused — a pause is not this lever',
  (await refusal(() => grant(member.id, -5, 'pause'))) === '22023',
)
check(
  'a lever without a written reason is refused',
  (await refusal(() => grant(member.id, 5, '   '))) === '22023' &&
    (await refusal(() => adjust(member.id, 100, ''))) === '22023',
)
check(
  'an adjustment of nothing adjusts nothing',
  (await refusal(() => adjust(member.id, 0, 'rounding'))) === '22023',
)

// The sign, asserted against the database rather than against the function: a direct
// service-role insert is the shortest path a future writer could take.
check(
  'the ledger itself refuses a grant with money on it',
  (await refusal(() =>
    asService(
      `insert into billing_ledger (coaching_center_id, kind, amount_poisha, charge_date, description)
       values ($1, 'founder_grant_days', 50000, ($2::date + 1), 'a bug')`,
      [member.id, today],
    ),
  )) === '23514',
)

/* -------------------------------------------------------------------------- */
/* The money lever                                                            */
/* -------------------------------------------------------------------------- */

console.log('\nMoving the balance:')

const wallet = await centre()
await recharge(wallet.id, 100_000)

const credited = (await adjust(wallet.id, 50_000, 'Charged for the Eid week by mistake')).rows[0].out

check('the adjustment answers with the balance after it', credited.balanceAfter === 150_000, JSON.stringify(credited))
check('and the balance column says the same', (await balance(wallet.id)) === 150_000)
check(
  'the entry is a decision, with a person and a reason on it',
  (await n(
    db,
    `select count(*)::int as n from billing_ledger
      where coaching_center_id = $1 and kind = 'founder_money_adjustment'
        and amount_poisha = 50000 and created_by = $2
        and description = 'Charged for the Eid week by mistake'
        and price_version_id is null`,
    [wallet.id, founder],
  )) === 1,
)

const took = (await adjust(wallet.id, -20_000, 'Took the goodwill back')).rows[0].out
check('money can come off again, down to nothing', took.balanceAfter === 130_000, JSON.stringify(took))

check(
  'but never below nothing',
  (await refusal(() => adjust(wallet.id, -500_000, 'too much'))) === '23514',
)
check('and the refused amount changed nothing', (await balance(wallet.id)) === 130_000)

/* -------------------------------------------------------------------------- */
/* The money a customer sent, recorded by the founder (§11.5)                 */
/* -------------------------------------------------------------------------- */

console.log('\nRecording a payment that has arrived:')

/*
 * 20260811000093'S OWN REGRESSION, as a call rather than a text match.
 *
 * `founder_record_payment` writes a `recharge`, and 20260811000080 requires a card on that
 * kind — an invariant the function broke for exactly one migration: on the live database
 * every call raised 23514 after the receipt and before the balance moved, while the panel
 * drew, the API spec listed the RPC and every suite stayed green, because nothing here
 * called the function at all. The second check below is the one that would have caught it.
 */
const card = (
  await db.query(
    `select id, teacher_plus_monthly_poisha::int as monthly
       from price_versions
      order by effective_from desc
      limit 1`,
  )
).rows[0]

const recordPayment = (center, { amount = null, months = null, reason = 'Sent by bKash', key = null } = {}) =>
  asUser(db, founder, (tx) =>
    tx.query(
      `select public.founder_record_payment(
         $1::uuid, $2::bigint, $3::integer, $4::text, 'bkash', null, $5::uuid
       ) as out`,
      [center, amount, months, reason, key],
    ),
  )

/* The kind is set by hand, because `account_kind` defaults to `teacher`. */
const paidCentre = (
  await asService(
    `insert into coaching_centers (name, plan, status, account_kind)
     values ('Paid ' || gen_random_uuid()::text, 'center', 'active', 'center')
     returning id`,
  )
).rows[0].id

const key = '7a5e2c9d-0000-4000-8000-000000000001'
const first = (await recordPayment(paidCentre, { amount: 500_000, key })).rows[0].out

check(
  'the money reaches the balance the burn spends',
  first.ok === true && first.already === false && first.balanceAfter === 500_000,
  JSON.stringify(first),
)
check(
  'and the recharge names the card in force — what 20260811000080 requires of the kind',
  (await n(
    db,
    `select count(*)::int as n from billing_ledger
      where coaching_center_id = $1 and kind = 'recharge' and amount_poisha = 500000
        and price_version_id = $2 and payment_id is not null`,
    [paidCentre, card.id],
  )) === 1,
)

const replay = (await recordPayment(paidCentre, { amount: 500_000, key })).rows[0].out
check(
  'a replayed submit is the same payment, not a second credit',
  replay.already === true && replay.balanceAfter === 500_000,
  JSON.stringify(replay),
)
check(
  'and one receipt exists',
  (await n(db, 'select count(*)::int as n from payments where coaching_center_id = $1', [paidCentre])) === 1,
)
check(
  'a customer pulling the same lever is refused',
  (await refusal(() =>
    asUser(db, owner, (tx) =>
      tx.query(`select public.founder_record_payment($1::uuid, 100000, null, 'mine now')`, [
        paidCentre,
      ]),
    ),
  )) === '42501',
)

/* A teacher: the amount is the published price for the months, never the founder's typing. */
const teacherPaid = (
  await asService(
    `insert into coaching_centers (name, plan, status, account_kind)
     values ('Teacher ' || gen_random_uuid()::text, 'teacher_free', 'active', 'teacher')
     returning id`,
  )
).rows[0].id

const pro = (await recordPayment(teacherPaid, { months: 2, reason: 'Two months of Pro' })).rows[0].out
check(
  'a teacher pays the published price for the months',
  pro.amountPoisha === card.monthly * 2,
  JSON.stringify({ got: pro.amountPoisha, expected: card.monthly * 2 }),
)
const teacherRow = (
  await db.query('select plan, trial_plan from coaching_centers where id = $1', [teacherPaid])
).rows[0]
check(
  'and the plan moves to Teacher Pro with the trial pair cleared',
  teacherRow.plan === 'teacher_plus' && teacherRow.trial_plan === null,
  JSON.stringify(teacherRow),
)
check(
  "and a teacher's recharge names the card as well",
  (await n(
    db,
    `select count(*)::int as n from billing_ledger
      where coaching_center_id = $1 and kind = 'recharge' and price_version_id = $2`,
    [teacherPaid, card.id],
  )) === 1,
)

/* -------------------------------------------------------------------------- */
/* The books still reconcile, which is what the founder's panel reads         */
/* -------------------------------------------------------------------------- */

const findings = (
  await asUser(db, founder, (tx) => tx.query('select * from public.platform_reconciliation()'))
).rows

const aboutLevers = findings.filter(
  (row) =>
    row.coaching_center_id === granted.id ||
    row.coaching_center_id === lapsed.id ||
    row.coaching_center_id === ahead.id ||
    row.coaching_center_id === wallet.id,
)

check(
  'a granted line is explained, not reported (§11.13)',
  aboutLevers.length === 0,
  JSON.stringify(aboutLevers),
)

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`)
console.log(`${migrations.length} migration(s) applied cleanly.\n`)
await db.close()
process.exit(failed ? 1 : 0)
