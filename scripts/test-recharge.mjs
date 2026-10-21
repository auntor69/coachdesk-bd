/**
 * The recharge, the bonus, and the fence that stops one transfer being spent twice —
 * MASTERPLAN.md §11.9/§11.11, which is build-order step 25 (`§16.1`).
 *
 * WHY THIS HAS A SUITE OF ITS OWN. `public.approve_recharge_claim` is the only function in
 * the product that credits money, and it is called by a human looking at a bKash app
 * rather than by a customer's own tap. Everything that can go wrong with it is expensive
 * and quiet: a bonus credited twice, a transaction ID credited to two centres, a claim
 * approved after it was rejected, a `payments` row that says ৳8,190 arrived when ৳7,800
 * did. Each of the four writes it makes is checked here, and so is each of the ways it
 * must refuse.
 *
 * THE WORKED FIGURES ARE §11.6'S OWN LADDER. ৳7,800 sent, 5% bonus, ৳8,190 of credit;
 * ৳15,600 and 10%; ৳31,200 and 20%. They are asserted as literals because a suite that
 * computes its expectations with the code under test agrees with an off-by-one instead of
 * catching it.
 *
 * Run: node scripts/test-recharge.mjs
 */
import { bootDatabase, asUser, deniedAsUser } from './lib/pg-harness.mjs'

const { db } = await bootDatabase()

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

const asService = async (sql, params = []) => {
  await db.exec('set role service_role;')
  try {
    return await db.query(sql, params)
  } finally {
    await db.exec('reset role;')
  }
}

const CARD = '(select id from price_versions order by effective_from desc limit 1)'

const balance = async (center) =>
  Number(
    (await db.query('select balance_poisha from coaching_centers where id = $1', [center]))
      .rows[0].balance_poisha,
  )

/** A centre on the Center plan, fresh, with nothing owed. */
const centre = async (name = `Recharge ${Math.random().toString(36).slice(2, 8)}`) =>
  (
    await asService(
      'insert into coaching_centers (name, plan, status) values ($1, $2, $3) returning id',
      [name, 'center', 'active'],
    )
  ).rows[0].id

/**
 * A claim as the Server Action files it: priced by the server, unique transaction.
 *
 * The counts price ৳2,600 a month (100/3/1 on the founding card — the masterplan's own
 * worked example), which is the month the ladder's months are counted from at approval.
 */
const fileClaim = async (
  center,
  { quoted = 780000, bonus = 39000, trx = `TRX${Math.random().toString(36).slice(2, 10)}` } = {},
) =>
  (
    await asService(
      `insert into recharge_claims
         (coaching_center_id, quoted_poisha, quoted_bonus_poisha, price_version_id,
          usage_students, usage_teachers, usage_branches, trx_id, sender_msisdn)
       values ($1, $2, $3, ${CARD}, 100, 3, 1, $4, '01700000000')
       returning id, reference_code, trx_id`,
      [center, quoted, bonus, trx],
    )
  ).rows[0]

const row = async (sql, params = []) => (await db.query(sql, params)).rows[0]

/** The founder, as a session: the panel is a signed-in platform admin, not a key. */
const founder = (
  await db.query(
    `insert into auth.users (email) values ('founder-recharge@coachdesk.invalid')
     returning id`,
  )
).rows[0].id
await db.query('update profiles set is_platform_admin = true where id = $1', [founder])

/**
 * An approval by the founder, through their own session — the ordinary path, and the
 * one that puts a name on the decision.
 */
const approve = (claim, arrived = null, note = null) =>
  asUser(db, founder, (tx) =>
    tx.query('select public.approve_recharge_claim($1, $2, $3) as out', [
      claim,
      arrived,
      note,
    ]),
  )

const approveDenied = async (claim, arrived = null) => {
  try {
    await approve(claim, arrived)
    return false
  } catch {
    return true
  }
}

/** The back-office path: the platform's own key, with no person behind it. */
const approveAsPlatform = (claim, arrived = null) =>
  asService('select public.approve_recharge_claim($1, $2, $3) as out', [claim, arrived, null])

/* -------------------------------------------------------------------------- */
/* The ladder, as arithmetic (§11.6)                                          */
/* -------------------------------------------------------------------------- */

console.log('\nThe bonus ladder:')

const bonusFor = async (amount, monthly = 260000) =>
  Number(
    (
      await db.query(
        `select app.bonus_poisha(tiers, $1, $2) as b from promotions where code = 'LAUNCH'`,
        [amount, monthly],
      )
    ).rows[0].b,
  )

check('one month carries no bonus', (await bonusFor(260000)) === 0, String(await bonusFor(260000)))
check('three months is five percent, to the poisha', (await bonusFor(780000)) === 39000)
check('six months is ten percent', (await bonusFor(1560000)) === 156000)
check('twelve months is twenty percent', (await bonusFor(3120000)) === 624000)
check(
  'a typed amount takes the highest band its WHOLE months reach',
  // ৳2,000,000 at ৳260,000 a month is 7.69 months — 7 whole — so the 6-month rung.
  (await bonusFor(2000000)) === 200000,
  String(await bonusFor(2000000)),
)
check(
  'a fraction of a poisha is floored in the customer\'s favour',
  (await bonusFor(780001)) === 39000,
  String(await bonusFor(780001)),
)
check(
  'a fraction of a MONTH is floored in the founder\'s favour',
  // ৳779,999 is 2.99 months — two whole months, no bonus. A centre 1 poisha short
  // of the third month did not buy the third month.
  (await bonusFor(779999)) === 0,
  String(await bonusFor(779999)),
)
check(
  'the ladder is the centre\'s OWN month, not the worked example\'s taka',
  // THE CASE THE FOUNDER FOUND: ৳2,099 a month. Its three months now carries the
  // 5% the button promises; its one month still carries nothing.
  (await bonusFor(629700, 209900)) === 31485 && (await bonusFor(209900, 209900)) === 0,
  `3mo: ${await bonusFor(629700, 209900)}, 1mo: ${await bonusFor(209900, 209900)}`,
)
check(
  'and Teacher Pro\'s twelve months reaches the top rung at last',
  // The absolute ladder could never serve this tier: 12 × ৳499 never reached ৳7,800.
  (await bonusFor(598800, 49900)) === 119760,
  String(await bonusFor(598800, 49900)),
)
check(
  'no monthly figure means no months means no bonus',
  (await bonusFor(780000, 0)) === 0 && (await bonusFor(780000, -1)) === 0,
)
check(
  'a tier list nobody ordered still answers the same',
  Number(
    (
      await db.query(
        `select app.bonus_poisha('[{"min_months": 12, "bonus_bps": 2000},
            {"min_months": 3, "bonus_bps": 500}]'::jsonb, 3120000, 260000) as b`,
      )
    ).rows[0].b,
  ) === 624000,
)
check(
  'a malformed tier is no bonus rather than an error',
  Number(
    (
      await db.query(
        `select app.bonus_poisha('[{"min_months": "lots", "bonus_bps": "some"}]'::jsonb, 780000, 260000) as b`,
      )
    ).rows[0].b,
  ) === 0,
)
check(
  'an empty tier list bonuses nothing',
  Number(
    (await db.query(`select app.bonus_poisha('[]'::jsonb, 780000, 260000) as b`)).rows[0].b,
  ) === 0,
)
check(
  'the old two-argument shape is gone, not silently wrong',
  // The ladder changed meaning in the same commit that changed the signature, so a
  // stale caller fails loudly here rather than crediting a wrong gift in production.
  await db
    .query(`select app.bonus_poisha('[{"min_months": 3, "bonus_bps": 500}]'::jsonb, 780000) as b`)
    .then(() => false)
    .catch(() => true),
)

/* -------------------------------------------------------------------------- */
/* The approval, and the three numbers it writes (§11.9)                      */
/* -------------------------------------------------------------------------- */

console.log('\nApproving a recharge:')

const paid = await centre()
const claim = await fileClaim(paid)
const decided = (await approve(claim.id)).rows[0].out

check('the approval answers with all four figures', decided.ok === true, JSON.stringify(decided))
check('and the credit is the money plus the gift', decided.creditPoisha === 819000)
check('the balance is what the customer now holds', (await balance(paid)) === 819000)

const payment = await row(
  'select amount_bdt, method, reference, note from payments where coaching_center_id = $1',
  [paid],
)
check(
  'revenue is the money that actually arrived, and not the credit',
  Number(payment.amount_bdt) === 7800,
  String(payment.amount_bdt),
)
check('and the transaction ID is on the receipt', payment.reference === claim.trx_id)
check('recorded as bKash', payment.method === 'bkash')

const entries = (
  await db.query(
    `select kind, amount_poisha, price_version_id, payment_id
       from billing_ledger where coaching_center_id = $1 and kind in ('recharge', 'promotion_bonus')
      order by kind`,
    [paid],
  )
).rows
check('the credit and the gift are two rows, not one', entries.length === 2, String(entries.length))
check(
  'the money is a recharge entry for what arrived',
  entries[0].kind === 'recharge' && Number(entries[0].amount_poisha) === 780000,
  JSON.stringify(entries[0]),
)
check(
  'the gift is a bonus entry of its own',
  entries[1].kind === 'promotion_bonus' && Number(entries[1].amount_poisha) === 39000,
  JSON.stringify(entries[1]),
)
check(
  'the recharge names the card it was priced from',
  entries[0].price_version_id !== null,
)
check(
  'and the bonus names none, being a gift rather than a price',
  entries[1].price_version_id === null,
)

const closed = await row(
  'select state, arrived_poisha, granted_poisha, granted_bonus_poisha, reviewed_by, reviewed_at, granted_promotion_id from recharge_claims where id = $1',
  [claim.id],
)
check('the claim is approved', closed.state === 'approved')
check('with what arrived recorded', Number(closed.arrived_poisha) === 780000)
check(
  'and the money and the gift kept apart',
  Number(closed.granted_poisha) === 780000 && Number(closed.granted_bonus_poisha) === 39000,
)
check('and the reviewer named', closed.reviewed_by !== null && closed.reviewed_at !== null)
check('and the promotion that paid it recorded', closed.granted_promotion_id !== null)
check('and the founder who decided is named', closed.reviewed_by === founder)

// The back-office path: the platform approving through its own key, which is what a
// queue too long to read one row at a time will eventually be worked through with.
// No person to name, and `reviewed_at` is what the constraint insists on.
const keyed = await centre()
const keyedClaim = await fileClaim(keyed)
const keyedOut = (await approveAsPlatform(keyedClaim.id)).rows[0].out
check('the platform can approve through its own key', keyedOut.ok === true)
check(
  'and that decision names nobody, because there was nobody',
  (await row('select reviewed_by, reviewed_at from recharge_claims where id = $1', [keyedClaim.id]))
    .reviewed_by === null,
)
check('while still crediting the balance', (await balance(keyed)) === 819000)

/* -------------------------------------------------------------------------- */
/* Approval overrides the quote (§11.9)                                       */
/* -------------------------------------------------------------------------- */

console.log('\nWhen the customer sends the wrong figure:')

const wrong = await centre()
const quotedSmall = await fileClaim(wrong, { quoted: 780000, bonus: 39000 })
const bigger = (await approve(quotedSmall.id, 1560000)).rows[0].out

check(
  'the bonus is re-derived from what arrived, not from the quote',
  // ৳15,600 at the claim's own ৳2,600 month is 6 whole months — the 10% rung.
  bigger.bonusPoisha === 156000,
  JSON.stringify(bigger),
)
check('and the credit follows the money', bigger.creditPoisha === 1716000)
check(
  'the receipt says what arrived rather than what was quoted',
  Number(
    (await row('select amount_bdt from payments where coaching_center_id = $1', [wrong]))
      .amount_bdt,
  ) === 15600,
)

const lying = await centre()
const overstated = await fileClaim(lying, { quoted: 780000, bonus: 624000 })
const honest = (await approve(overstated.id)).rows[0].out
check(
  'a quote that overstates its own bonus buys nothing',
  honest.bonusPoisha === 39000,
  JSON.stringify(honest),
)
check('and the balance is the arithmetic one', (await balance(lying)) === 819000)

/* -------------------------------------------------------------------------- */
/* The months come from the claim's own snapshot (§11.12's rule, at approval)  */
/* -------------------------------------------------------------------------- */

console.log('\nThe months the approval counts:')

// A small centre whose claim was priced at ITS size: 60/3/1 = ৳2,099 a month.
// The old absolute ladder answered 0% for its three months; the month-anchored
// one answers the 5% the button promised.
const smallCentre = await centre()
const smallQuote = 629700
const smallClaim = await fileClaim(smallCentre, {
  quoted: smallQuote,
  bonus: 0,
  trx: 'SMALL3M',
})
await asService(
  `update recharge_claims set usage_students = 60, usage_teachers = 3, usage_branches = 1
    where id = $1`,
  [smallClaim.id],
)
const smallOut = (await approve(smallClaim.id)).rows[0].out
check(
  'a ৳2,099-a-month centre gets its three months\' 5%',
  smallOut.bonusPoisha === 31485,
  JSON.stringify(smallOut),
)
check('and the answer names the month it counted from', smallOut.monthlyPoisha === 209900)

// Growth between quote and approval must not reprice the ladder's months: the
// counts are the claim's own snapshot, not today's roster.
await asService(
  `insert into students (coaching_center_id, name, guardian_phone)
   select id, 'Student ' || g, '01700000001' from coaching_centers, generate_series(1, 40) g
   where id = $1`,
  [smallCentre],
)
const grownCentre = await centre()
const grownClaim = await fileClaim(grownCentre, { quoted: 3120000, bonus: 624000, trx: 'GROWN12' })
await asService(
  `update recharge_claims set usage_students = 100, usage_teachers = 3, usage_branches = 1
    where id = $1`,
  [grownClaim.id],
)
await asService(
  `insert into students (coaching_center_id, name, guardian_phone)
   select id, 'Student ' || g, '01700000001' from coaching_centers, generate_series(1, 200) g
   where id = $1`,
  [grownCentre],
)
const grownOut = (await approve(grownClaim.id)).rows[0].out
check(
  'roster growth after the quote does not reprice the approval',
  // 100/3/1 from the claim's snapshot = ৳2,600 → 12 months → 20%, regardless of
  // the 300 students now on the roster (which would have moved the month to a
  // different band and the bonus with it).
  grownOut.bonusPoisha === 624000 && grownOut.monthlyPoisha === 260000,
  JSON.stringify(grownOut),
)

/* -------------------------------------------------------------------------- */
/* The fences                                                                 */
/* -------------------------------------------------------------------------- */

console.log('\nThe fences:')

const replayCentre = await centre()
const first = await fileClaim(replayCentre, { trx: 'BKASH9H7K2M' })
await approve(first.id)

const second = await fileClaim(replayCentre, { trx: '  bkash9h7k2m  ' })
check(
  'one transfer credits one balance, whatever case it is typed in',
  await approveDenied(second.id),
)
check(
  'and the refused claim is left untouched rather than half-approved',
  (await row('select state, granted_poisha from recharge_claims where id = $1', [second.id]))
    .state === 'submitted',
)
check(
  'nor did the refusal write a receipt',
  Number(
    (await row('select count(*)::int as n from payments where coaching_center_id = $1', [
      replayCentre,
    ])).n,
  ) === 1,
)

check(
  'a claim cannot be approved twice',
  await approveDenied(first.id),
)

const reopened = await db
  .query(
    `update recharge_claims set granted_poisha = 999999 where id = $1`,
    [first.id],
  )
  .then(() => false)
  .catch(() => true)
check('and a closed claim cannot be rewritten', reopened)

const crowded = await centre()
const open = []
for (let i = 0; i < 3; i += 1) open.push(await fileClaim(crowded, { trx: `MANY${i}` }))
check('three claims may wait at once', open.length === 3)
check(
  'and a fourth is stopped at the door',
  await fileClaim(crowded, { trx: 'MANY4' }).then(() => false).catch(() => true),
)
await db.query(
  `update recharge_claims
      set state = 'approved', arrived_poisha = 1, granted_poisha = 1,
          granted_bonus_poisha = 0, reviewed_by = $1, reviewed_at = now()
    where id = $2`,
  [founder, open[0].id],
)
check(
  'and a closed one makes room for another',
  await fileClaim(crowded, { trx: 'MANY5' }).then(() => true).catch(() => false),
)

const shape = await fileClaim(await centre())
check(
  'a reference code has no letter that can be misread',
  /^CD-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(shape.reference_code),
  shape.reference_code,
)
const codes = new Set(
  (
    await db.query(
      `select reference_code from recharge_claims where reference_code like 'CD-%'`,
    )
  ).rows.map((r) => r.reference_code),
)
check('and two claims do not share one', codes.size >= 6, String(codes.size))

/* -------------------------------------------------------------------------- */
/* Who may decide                                                             */
/* -------------------------------------------------------------------------- */

console.log('\nWho may decide:')

const ownerCentre = await centre()
await asService(
  `insert into center_members (coaching_center_id, user_id, role) values ($1, $2, 'owner')`,
  [ownerCentre, (await db.query('insert into auth.users (id) values (gen_random_uuid()) returning id')).rows[0].id],
)
const ownedClaim = await fileClaim(ownerCentre)
const ownerId = (
  await row('select user_id from center_members where coaching_center_id = $1', [ownerCentre])
).user_id

check(
  'a centre owner cannot approve their own recharge',
  await deniedAsUser(db, ownerId, 'select public.approve_recharge_claim($1)', [ownedClaim.id]),
)
check(
  'nor can they reject it',
  await deniedAsUser(db, ownerId, `select public.reject_recharge_claim($1, 'other')`, [
    ownedClaim.id,
  ]),
)
check(
  'nor can a signed-out request',
  await deniedAsUser(db, null, 'select public.approve_recharge_claim($1)', [ownedClaim.id]),
)
check(
  'and a centre cannot read the promotions that price its bonus',
  (await asUser(db, ownerId, (tx) => tx.query('select count(*)::int as n from promotions'))).rows[0]
    .n === 0,
)

/* -------------------------------------------------------------------------- */
/* Rejection                                                                  */
/* -------------------------------------------------------------------------- */

console.log('\nRejection:')

const rejected = (
  await asUser(db, founder, (tx) =>
    tx.query(`select public.reject_recharge_claim($1, 'not_received', 'nothing in the account') as out`, [
      ownedClaim.id,
    ]),
  )
).rows[0].out

check('the founder closes it with a reason', rejected.ok === true, JSON.stringify(rejected))
const closedRow = await row('select state, reject_reason, granted_poisha from recharge_claims where id = $1', [
  ownedClaim.id,
])
check('the claim says a decision was made', closedRow.state === 'rejected')
check('with the reason from the list', closedRow.reject_reason === 'not_received')
check('and nothing was credited', closedRow.granted_poisha === null)
check('so the balance is where it was', (await balance(ownerCentre)) === 0)
check(
  'and a rejected claim cannot then be approved',
  await approveDenied(ownedClaim.id),
)

/* -------------------------------------------------------------------------- */
/* The books agree                                                            */
/* -------------------------------------------------------------------------- */

console.log('\nThe books, after all of it:')

const drift = await n2(
  `select count(*)::int as n from (
     select c.id, c.balance_poisha,
            coalesce((select sum(l.amount_poisha) from billing_ledger l
                       where l.coaching_center_id = c.id), 0) as ledger
       from coaching_centers c
   ) x where x.balance_poisha <> x.ledger`,
)
check('every balance is the sum of its entries', drift === 0, String(drift))

async function n2(sql) {
  return Number((await db.query(sql)).rows[0].n)
}

console.log(`\n${passed} passed, ${failed} failed`)
await db.close()
process.exit(failed ? 1 : 0)
