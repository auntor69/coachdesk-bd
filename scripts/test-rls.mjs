/**
 * Tenant isolation test — the one that decides whether this business is safe
 * to sell. Runs against real Postgres with the real policies.
 *
 * Two centers, cross-wired on purpose:
 *   Center A (Dhaka)  — owner A, teachers Karim (Biology) and Nasrin (Chemistry)
 *   Center B (Khulna) — owner B, teacher Rahim
 *
 * Every assertion attempts to reach data the actor must not see.
 * Run: node scripts/test-rls.mjs
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

// --- Seed as superuser (bypasses RLS, like our service-role client) ---------

const ids = {}
for (const key of [
  'ownerA', 'ownerB', 'karim', 'nasrin', 'rahim', 'guardianUser', 'studentUser',
]) {
  ids[key] = (
    await db.query('insert into auth.users (id) values (gen_random_uuid()) returning id')
  ).rows[0].id
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0].id

const centerA = await one(
  `insert into coaching_centers (name, created_by) values ('Dhaka Science Care', $1) returning id`,
  [ids.ownerA],
)
const centerB = await one(
  `insert into coaching_centers (name, created_by) values ('Khulna Model Coaching', $1) returning id`,
  [ids.ownerB],
)

const addMember = (center, user, role) =>
  db.query(
    `insert into center_members (coaching_center_id, user_id, role) values ($1, $2, $3)
     on conflict do nothing`,
    [center, user, role],
  )

// ownerA/ownerB are already owners via the claim trigger; the rest are explicit.
await addMember(centerA, ids.karim, 'teacher')
await addMember(centerA, ids.nasrin, 'teacher')
await addMember(centerB, ids.rahim, 'teacher')
await addMember(centerA, ids.studentUser, 'student')
await addMember(centerA, ids.guardianUser, 'guardian')

const tKarim = await one(
  `insert into teachers (coaching_center_id, user_id, name) values ($1, $2, 'Karim Sir') returning id`,
  [centerA, ids.karim],
)
const tNasrin = await one(
  `insert into teachers (coaching_center_id, user_id, name) values ($1, $2, 'Nasrin Madam') returning id`,
  [centerA, ids.nasrin],
)
const tRahim = await one(
  `insert into teachers (coaching_center_id, user_id, name) values ($1, $2, 'Rahim Sir') returning id`,
  [centerB, ids.rahim],
)

const subject = (center, name) =>
  one(`insert into subjects (coaching_center_id, name) values ($1, $2) returning id`, [
    center,
    name,
  ])

const sBio = await subject(centerA, 'Biology')
const sChem = await subject(centerA, 'Chemistry')
const sPhy = await subject(centerB, 'Physics')

const batch = (center, subj, teacher, name, slot) =>
  one(
    `insert into batches (coaching_center_id, subject_id, teacher_id, name, slot, monthly_fee_bdt)
     values ($1, $2, $3, $4, $5, 800) returning id`,
    [center, subj, teacher, name, slot],
  )

const bBioMorning = await batch(centerA, sBio, tKarim, 'Bio Morning', 'morning')
const bChemEvening = await batch(centerA, sChem, tNasrin, 'Chem Evening', 'evening')
const bPhyB = await batch(centerB, sPhy, tRahim, 'Physics Night', 'night')

const student = (center, name, userId = null) =>
  one(
    `insert into students (coaching_center_id, name, user_id, guardian_phone)
     values ($1, $2, $3, '01700000000') returning id`,
    [center, name, userId],
  )

const stAli = await student(centerA, 'Ali Hasan', ids.studentUser) // Karim's batch
const stMim = await student(centerA, 'Mim Akter') // Nasrin's batch only
const stB = await student(centerB, 'Jubayer Khan') // other center

await db.query(
  `insert into guardians (coaching_center_id, student_id, user_id, phone, name)
   values ($1, $2, $3, '01711111111', 'Ali father')`,
  [centerA, stAli, ids.guardianUser],
)

const enroll = (center, st, subj, b) =>
  one(
    `insert into enrollments (coaching_center_id, student_id, subject_id, batch_id)
     values ($1, $2, $3, $4) returning id`,
    [center, st, subj, b],
  )

const eAli = await enroll(centerA, stAli, sBio, bBioMorning)
const eMim = await enroll(centerA, stMim, sChem, bChemEvening)
const eB = await enroll(centerB, stB, sPhy, bPhyB)

// An exam in Nasrin's batch, which Karim must not touch.
const examChem = await one(
  `insert into exams (coaching_center_id, subject_id, batch_id, teacher_id, title, total_marks, exam_date)
   values ($1, $2, $3, $4, 'Chem Weekly 1', 50, current_date) returning id`,
  [centerA, sChem, bChemEvening, tNasrin],
)

await db.query(
  `insert into exam_results (coaching_center_id, exam_id, enrollment_id, obtained_marks)
   values ($1, $2, $3, 42)`,
  [centerA, examChem, eMim],
)

// A mark of Ali's own, so we can test that a student cannot inflate it.
const examBio = await one(
  `insert into exams (coaching_center_id, subject_id, batch_id, teacher_id, title, total_marks, exam_date)
   values ($1, $2, $3, $4, 'Bio Weekly 1', 50, current_date) returning id`,
  [centerA, sBio, bBioMorning, tKarim],
)

await db.query(
  `insert into exam_results (coaching_center_id, exam_id, enrollment_id, obtained_marks)
   values ($1, $2, $3, 31)`,
  [centerA, examBio, eAli],
)

await db.query(
  `insert into fee_invoices (coaching_center_id, student_id, enrollment_id, period_month, amount_bdt, due_date)
   values ($1, $2, $3, date_trunc('month', current_date)::date, 800, current_date + 5)`,
  [centerA, stAli, eAli],
)

await db.query(
  `insert into subscriptions (coaching_center_id, plan) values ($1, 'center')`,
  [centerA],
)

console.log('\nSeeded 2 centers, 3 teachers, 3 students.\n')

// Sanity: the claim trigger must have made each creator an owner, otherwise
// the tests below would "pass" simply because nobody can see anything.
const ownerRows = await db.query(
  `select count(*)::int as n from center_members where role = 'owner'`,
)
check('claim trigger made both creators owners', ownerRows.rows[0].n === 2,
  `found ${ownerRows.rows[0].n}`)

const n = async (tx, sql, params = []) =>
  Number((await tx.query(sql, params)).rows[0].n)

console.log('\nCross-tenant isolation (Center A vs Center B):')

await asUser(db, ids.ownerA, async (tx) => {
  check('owner A sees only own students', (await n(tx, 'select count(*)::int as n from students')) === 2)
  check(
    "owner A cannot read center B's student by id",
    (await n(tx, 'select count(*)::int as n from students where id = $1', [stB])) === 0,
  )
  check(
    "owner A cannot read center B's center row",
    (await n(tx, 'select count(*)::int as n from coaching_centers where id = $1', [centerB])) === 0,
  )
  check(
    "owner A cannot read center B's enrollments",
    (await n(tx, 'select count(*)::int as n from enrollments where id = $1', [eB])) === 0,
  )
  check(
    'owner A sees own subscription',
    (await n(tx, 'select count(*)::int as n from subscriptions')) === 1,
  )
})

await asUser(db, ids.ownerB, async (tx) => {
  check('owner B sees only own student', (await n(tx, 'select count(*)::int as n from students')) === 1)
  check(
    "owner B cannot read center A's guardians (parent phones)",
    (await n(tx, 'select count(*)::int as n from guardians')) === 0,
  )
  check(
    "owner B cannot read center A's exam results",
    (await n(tx, 'select count(*)::int as n from exam_results')) === 0,
  )
  check(
    "owner B cannot read center A's subscription",
    (await n(tx, 'select count(*)::int as n from subscriptions')) === 0,
  )
})

console.log('\nTeacher scoping inside one center (Karim vs Nasrin):')

await asUser(db, ids.karim, async (tx) => {
  check(
    'Karim sees only students in his own batch',
    (await n(tx, 'select count(*)::int as n from students')) === 1,
  )
  check(
    "Karim cannot read Nasrin's student Mim",
    (await n(tx, 'select count(*)::int as n from students where id = $1', [stMim])) === 0,
  )
  check(
    "Karim cannot read Nasrin's exam results",
    (await n(tx, 'select count(*)::int as n from exam_results where enrollment_id = $1', [eMim])) === 0,
  )
  check(
    'Karim CAN read his own batch exam results',
    (await n(tx, 'select count(*)::int as n from exam_results where enrollment_id = $1', [eAli])) === 1,
  )
  check(
    "Karim cannot read guardian phone of Nasrin's student",
    (await n(tx, 'select count(*)::int as n from guardians where student_id = $1', [stMim])) === 0,
  )
  check('Karim cannot see fee invoices', (await n(tx, 'select count(*)::int as n from fee_invoices')) === 0)
  check(
    'Karim cannot see what the center pays us',
    (await n(tx, 'select count(*)::int as n from subscriptions')) === 0,
  )
  check('Karim sees his own batch', (await n(tx, 'select count(*)::int as n from batches where id = $1', [bBioMorning])) === 1)
})

console.log('\nTeacher write scoping:')

check(
  "Karim cannot take attendance for Nasrin's batch",
  await deniedAsUser(
    db,
    ids.karim,
    `insert into attendance_sessions (coaching_center_id, batch_id, session_date)
     values ($1, $2, current_date)`,
    [centerA, bChemEvening],
  ),
)

check(
  'Karim CAN take attendance for his own batch',
  !(await deniedAsUser(
    db,
    ids.karim,
    `insert into attendance_sessions (coaching_center_id, batch_id, session_date)
     values ($1, $2, current_date)`,
    [centerA, bBioMorning],
  )),
)

check(
  "Karim cannot enter marks on Nasrin's exam",
  await deniedAsUser(
    db,
    ids.karim,
    `insert into exam_results (coaching_center_id, exam_id, enrollment_id, obtained_marks)
     values ($1, $2, $3, 50)`,
    [centerA, examChem, eMim],
  ),
)

check(
  'teacher from center B cannot create an exam in center A',
  await deniedAsUser(
    db,
    ids.rahim,
    `insert into exams (coaching_center_id, subject_id, batch_id, title, total_marks, exam_date)
     values ($1, $2, $3, 'Injected', 100, current_date)`,
    [centerA, sBio, bBioMorning],
  ),
)

check(
  'teacher cannot forge a membership to escalate to owner',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into center_members (coaching_center_id, user_id, role) values ($1, $2, 'owner')`,
    [centerA, ids.karim],
  ),
)

check(
  'owner A cannot insert a student into center B',
  await deniedAsUser(
    db,
    ids.ownerA,
    `insert into students (coaching_center_id, name) values ($1, 'Smuggled')`,
    [centerB],
  ),
)

console.log('\nStudent and guardian scoping:')

await asUser(db, ids.studentUser, async (tx) => {
  check('student sees only themselves', (await n(tx, 'select count(*)::int as n from students')) === 1)
  check(
    "student cannot read a classmate's marks",
    (await n(tx, 'select count(*)::int as n from exam_results where enrollment_id = $1', [eMim])) === 0,
  )
  check(
    'student sees their own fee invoice',
    (await n(tx, 'select count(*)::int as n from fee_invoices')) === 1,
  )
})

await asUser(db, ids.guardianUser, async (tx) => {
  check('guardian sees only their own child', (await n(tx, 'select count(*)::int as n from students')) === 1)
  check(
    'guardian cannot read other students',
    (await n(tx, 'select count(*)::int as n from students where id = $1', [stMim])) === 0,
  )
})

// A student CAN read their own mark, so a bare UPDATE matches no rows rather
// than raising — RLS filters it out silently. The assertion that matters is
// therefore the stored value, not whether an error was thrown.
await asUser(db, ids.studentUser, async (tx) => {
  check(
    'student sees their own mark',
    (await n(tx, 'select count(*)::int as n from exam_results where enrollment_id = $1', [eAli])) === 1,
  )
  await tx.query(`update exam_results set obtained_marks = 50 where enrollment_id = $1`, [eAli])
})

const markAfter = (
  await db.query('select obtained_marks from exam_results where enrollment_id = $1', [eAli])
).rows[0].obtained_marks

check(
  'student cannot edit their own marks',
  Number(markAfter) === 31,
  `mark is now ${markAfter}, expected 31`,
)

// ---------------------------------------------------------------------------
// Billing columns. The free tier only exists if these three cannot be edited
// by the person who benefits from editing them.
//
// This section started as a probe, not a test. Against the original policies it
// printed:  UPDATE ALLOWED -> {"sms_credit_balance":999999,"plan":"institution"}
// — an owner self-granting unlimited SMS and an institution plan through the
// Supabase client, no payment involved. 20260811000004 closed it.
// ---------------------------------------------------------------------------

console.log('\nBilling columns (plan, status, credit balance):')

check(
  'owner cannot raise their own SMS credit balance',
  await deniedAsUser(
    db,
    ids.ownerA,
    'update coaching_centers set sms_credit_balance = 999999 where id = $1',
    [centerA],
  ),
)
check(
  'owner cannot upgrade their own plan',
  await deniedAsUser(
    db,
    ids.ownerA,
    `update coaching_centers set plan = 'institution' where id = $1`,
    [centerA],
  ),
)
check(
  'owner cannot move their center out of trial',
  await deniedAsUser(
    db,
    ids.ownerA,
    `update coaching_centers set status = 'active' where id = $1`,
    [centerA],
  ),
)
// A second free center is a cheaper way around the one-batch cap than editing
// the plan column was, so the insert path has to close with it.
check(
  'owner cannot create a second center to escape the plan limit',
  await deniedAsUser(
    db,
    ids.ownerA,
    `insert into coaching_centers (name, created_by, plan)
     values ('Free Institution', $1, 'institution')`,
    [ids.ownerA],
  ),
)

const billing = async () =>
  (
    await db.query(
      'select plan, status, sms_credit_balance from coaching_centers where id = $1',
      [centerA],
    )
  ).rows[0]

let row = await billing()
check(
  'nothing actually moved after those attempts',
  row.plan === 'teacher_free' && row.status === 'trial' && row.sms_credit_balance === 0,
  `plan=${row.plan} status=${row.status} balance=${row.sms_credit_balance}`,
)

// The lock must not catch our own dispatcher. If it did, every SMS send would
// fail closed — safe, but the product would look broken instead.
let dispatcherOk = true
try {
  await db.transaction(async (tx) => {
    await tx.exec('set local role service_role;')
    await tx.query(
      'update coaching_centers set sms_credit_balance = 50, plan = $2 where id = $1',
      [centerA, 'teacher_plus'],
    )
  })
} catch (error) {
  dispatcherOk = false
  console.log(`        ${error.message}`)
}
row = await billing()
check(
  'service_role can still top up credits and change the plan',
  dispatcherOk && row.sms_credit_balance === 50 && row.plan === 'teacher_plus',
  `plan=${row.plan} balance=${row.sms_credit_balance}`,
)

// An owner still has to be able to fix their own centre's name and address, or
// the lock has broken the settings screen instead of the exploit.
await asUser(db, ids.ownerA, (tx) =>
  tx.query(
    `update coaching_centers set name = 'Dhaka Science Care (Mirpur)', bd_area = 'Mirpur'
     where id = $1`,
    [centerA],
  ),
)
const renamed = (
  await db.query('select name, bd_area from coaching_centers where id = $1', [centerA])
).rows[0]
check(
  'owner can still edit their own center details',
  renamed.name === 'Dhaka Science Care (Mirpur)' && renamed.bd_area === 'Mirpur',
  `name=${renamed.name} area=${renamed.bd_area}`,
)

// The accident the guard trigger exists for: someone pastes the blanket
// `grant all on all tables in schema public to authenticated` that appears in
// half the Supabase setup snippets, and the column revoke silently stops
// mattering. A trigger cannot be granted away.
await db.exec('grant update on coaching_centers to authenticated;')
check(
  'guard trigger still refuses after a blanket re-grant',
  await deniedAsUser(
    db,
    ids.ownerA,
    'update coaching_centers set sms_credit_balance = 999999 where id = $1',
    [centerA],
  ),
)
row = await billing()
check(
  'balance survived the re-grant',
  row.sms_credit_balance === 50,
  `balance=${row.sms_credit_balance}`,
)
await db.exec(`
  revoke update on coaching_centers from authenticated;
  grant update (name, phone, address, bd_area, timezone)
    on coaching_centers to authenticated;
`)

console.log('\nAnonymous access:')

await asUser(db, null, async (tx) => {
  check('signed-out user reads no students', (await n(tx, 'select count(*)::int as n from students')) === 0)
  check(
    'signed-out user reads no guardian phone numbers',
    (await n(tx, 'select count(*)::int as n from guardians')) === 0,
  )
  check('signed-out user reads no centers', (await n(tx, 'select count(*)::int as n from coaching_centers')) === 0)
})

console.log(`\n${passed} passed, ${failed} failed`)
await db.close()
process.exit(failed ? 1 : 0)
