/**
 * Consent is a row, not a checkbox — MASTERPLAN.md §14.1, build-order step 25a, migration
 * 20260811000085.
 *
 * WHY THIS HAS A SUITE OF ITS OWN, on the same argument `test-recharge.mjs` gives. Every
 * other table in this schema is about a centre's own rows, and the four questions worth asking
 * about it are the tenant questions. This table is different in kind: it is the record that a
 * named person agreed to a *version* of a document, and every way it can be wrong is quiet.
 * A consent written for somebody else, a version that can be edited after the fact, the same
 * agreement stored twice — none of those break a screen, and none of them are visible until the
 * day a dispute turns on the row.
 *
 * THE NULL-CENTRE ASSERTION IS THE ONE THAT MATTERS MOST, and it is the reason `nulls distinct`
 * did not do. Every signup acceptance has `coaching_center_id is null` — the centre does not
 * exist yet — and Postgres treats nulls as distinct in a unique index, so a single unique
 * constraint would have let the same person agree to the same wording on every reload. Two
 * partial indexes are what close it, and this suite is what goes red if somebody simplifies
 * them back into one.
 *
 * Run: node scripts/test-legal.mjs
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

/** A person with a profile, which is what an acceptance points at. */
const person = async () =>
  (
    await db.query('insert into auth.users (id) values (gen_random_uuid()) returning id')
  ).rows[0].id

const ownerA = await person()
const ownerB = await person()

const centreA = (
  await asService(
    `insert into coaching_centers (name, created_by) values ('Consent Test A', $1) returning id`,
    [ownerA],
  )
).rows[0].id
const centreB = (
  await asService(
    `insert into coaching_centers (name, created_by) values ('Consent Test B', $1) returning id`,
    [ownerB],
  )
).rows[0].id

/** 2026-09-18 is the version every page in src/lib/legal carries today. */
const accept = (kind, centerSql) =>
  `insert into policy_acceptances (profile_id, coaching_center_id, policy_kind, policy_version)
   values ($1, ${centerSql}, '${kind}', '2026-09-18')`

const rows = async (sql, params = []) => (await db.query(sql, params)).rows

// --- The happy path, which is a signup and then a recharge --------------------------------

await asUser(db, ownerA, (tx) => tx.query(accept('terms', 'null'), [ownerA]))
const afterSignup = await asUser(db, ownerA, (tx) =>
  tx.query('select policy_kind, policy_version, accepted_at from policy_acceptances'),
)
check(
  'a signup acceptance is written and read back, versioned and dated',
  afterSignup.rows.length === 1
    && afterSignup.rows[0].policy_kind === 'terms'
    && afterSignup.rows[0].policy_version === '2026-09-18'
    && afterSignup.rows[0].accepted_at !== null,
  JSON.stringify(afterSignup.rows),
)

await asUser(db, ownerA, (tx) => tx.query(accept('prepaid_billing', '$2'), [ownerA, centreA]))
check(
  'and the first recharge adds its own, against the centre',
  (
    await asUser(db, ownerA, (tx) =>
      tx.query('select 1 from policy_acceptances where coaching_center_id = $1', [centreA]),
    )
  ).rows.length === 1,
)

// --- Idempotence, in both shapes of row ---------------------------------------------------

check(
  'the same wording agreed to twice is one row, not two',
  await deniedAsUser(db, ownerA, accept('terms', 'null'), [ownerA]),
)
check(
  'and it is still one row when there is a centre on it',
  await deniedAsUser(db, ownerA, accept('prepaid_billing', '$2'), [ownerA, centreA]),
)

// A re-worded page is a new version and therefore a new row, which is the entire reason the
// version is stored rather than just a timestamp.
await asService(
  `insert into policy_acceptances (profile_id, coaching_center_id, policy_kind, policy_version)
   values ($1, null, 'terms', '2027-01-01')`,
  [ownerA],
)
check(
  'a different version of the same page is a second row, beside the first',
  (await rows('select 1 from policy_acceptances where profile_id = $1', [ownerA])).length === 3,
)

// --- Whose consent, and who may read it ---------------------------------------------------

check(
  "nobody can write somebody else's consent",
  await deniedAsUser(db, ownerB, accept('privacy', '$2'), [ownerA, centreA]),
)
check(
  'nor for a centre they are not in',
  await deniedAsUser(db, ownerB, accept('privacy', '$2'), [ownerB, centreA]),
)
check(
  'a member reads their own rows, and only their own',
  (
    await asUser(db, ownerB, (tx) => tx.query('select * from policy_acceptances'))
  ).rows.length === 0,
)
check(
  'and a signed-out request gets nothing at all',
  await deniedAsUser(db, null, 'select * from policy_acceptances'),
)

// --- A record of agreement, not an editable row ------------------------------------------

check(
  'an acceptance cannot be edited, deleted or truncated from a session',
  (await deniedAsUser(
    db,
    ownerA,
    "update policy_acceptances set policy_version = '2020-01-01' where profile_id = $1",
    [ownerA],
  ))
    && (await deniedAsUser(
      db,
      ownerA,
      'delete from policy_acceptances where profile_id = $1',
      [ownerA],
    ))
    && (await deniedAsUser(db, ownerA, 'truncate policy_acceptances')),
)

// --- The vocabulary, and the one thing that must not be in here --------------------------

check(
  'a kind nobody wrote is refused by the enum',
  await deniedAsUser(db, ownerA, accept('not_a_policy', '$2'), [ownerA, centreA]),
)
check(
  'a version that is not a date is refused by the shape',
  await deniedAsUser(
    db,
    ownerA,
    `insert into policy_acceptances (profile_id, policy_kind, policy_version)
     values ($1, 'refunds', 'v2')`,
    [ownerA],
  ),
)

/*
 * §14.1: "Nothing about a student or a guardian is in this table." The columns are the
 * fence — there is nowhere to put a name, a number or a student id — and this asserts that
 * the fence is still the shape it was, so that a later migration adding a column has to say
 * so out loud rather than by accident.
 */
const columns = (
  await rows(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'policy_acceptances'
     order by column_name`,
  )
).map((c) => c.column_name)
check(
  'the table is the six columns §14.1 asks for, and nothing about a child',
  JSON.stringify(columns)
    === JSON.stringify([
      'accepted_at',
      'coaching_center_id',
      'id',
      'ip',
      'policy_kind',
      'policy_version',
      'profile_id',
    ]),
  JSON.stringify(columns),
)

// --- Deleting the person, and removing the centre ----------------------------------------

await asUser(db, ownerB, (tx) => tx.query(accept('terms', 'null'), [ownerB]))

await asService('delete from coaching_centers where id = $1', [centreA])
check(
  'a centre going away leaves the agreement standing, with no centre named on it',
  (
    await rows(
      `select coaching_center_id from policy_acceptances
       where profile_id = $1 and policy_kind = 'prepaid_billing'`,
      [ownerA],
    )
  ).length === 1
    && (
      await rows(
        `select coaching_center_id from policy_acceptances
         where profile_id = $1 and policy_kind = 'prepaid_billing'`,
        [ownerA],
      )
    )[0].coaching_center_id === null,
)

await asService('delete from profiles where id = $1', [ownerB])
check(
  'and a person going away takes their own consents with them',
  (await rows('select 1 from policy_acceptances where profile_id = $1', [ownerB])).length === 0,
)

console.log(`\n${passed} passed, ${failed} failed`)
await db.close()
process.exit(failed ? 1 : 0)
