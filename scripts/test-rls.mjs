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

// ---------------------------------------------------------------------------
// Sideways references — the hole 20260811000005 closed.
//
// Everything above tests coaching_center_id: can this actor reach a row whose
// centre is not theirs. This section tests the other axis. A write can carry a
// perfectly legitimate coaching_center_id — passing every policy above —
// alongside a *sibling* id belonging to another centre. Before the composite
// foreign keys, all of these succeeded.
//
// Nothing here reads across tenants, which is why it survived so long. What it
// does is stitch two centres' records together, so a mark or an invoice hangs
// off a child who belongs to someone else, and every dashboard that joins
// through a sideways id reports a number that is partly not the centre's.
//
// Half of these run as the superuser on purpose. That is the service_role path,
// where no policy is consulted at all — the SMS queue and the invoice generator
// will run there. If these assertions passed only under RLS, the constraint
// would not be doing the work and the next thing I write as service_role would
// walk straight through.
// ---------------------------------------------------------------------------

console.log('\nSideways references (same centre, wrong sibling):')

/**
 * Attempts a write as the connection owner — no RLS in the path, so only a
 * constraint can refuse — and returns true only when a *tenant* foreign key was
 * what refused it.
 *
 * Checking which constraint fired is the whole point. "The database said no" is
 * cheap to get by accident: a unique conflict left behind by an earlier
 * assertion, a check constraint, a bad enum label in the test itself. Any of
 * those would turn this section green while the hole stayed open, and it would
 * read exactly like a pass. So the error has to name a _center_fkey.
 */
async function refusedByTenantFk(sql, params = []) {
  try {
    await db.query(sql, params)
    return { ok: false, why: 'accepted' }
  } catch (error) {
    const message = String(error.message)
    return { ok: /_center_fkey/.test(message), why: message.split('\n')[0] }
  }
}

/** Reads better at each call site than repeating the destructure. */
async function checkRefused(name, sql, params) {
  const result = await refusedByTenantFk(sql, params)
  check(name, result.ok, result.why)
}

await checkRefused(
  "a batch cannot borrow another centre's subject (service_role)",
  `insert into batches (coaching_center_id, subject_id, name) values ($1, $2, 'Smuggled')`,
  [centerA, sPhy],
)
await checkRefused(
  "a batch cannot be handed another centre's teacher (service_role)",
  `insert into batches (coaching_center_id, subject_id, teacher_id, name)
   values ($1, $2, $3, 'Borrowed')`,
  [centerA, sBio, tRahim],
)
await checkRefused(
  "an enrollment cannot point at another centre's student (service_role)",
  `insert into enrollments (coaching_center_id, student_id, subject_id, batch_id)
   values ($1, $2, $3, $4)`,
  [centerA, stB, sBio, bBioMorning],
)
await checkRefused(
  "a guardian cannot be attached to another centre's student (service_role)",
  `insert into guardians (coaching_center_id, student_id, phone)
   values ($1, $2, '+8801711111111')`,
  [centerA, stB],
)
await checkRefused(
  "marks cannot be recorded against another centre's enrollment (service_role)",
  `insert into exam_results (coaching_center_id, exam_id, enrollment_id, obtained_marks)
   values ($1, $2, $3, 40)`,
  [centerA, examBio, eB],
)
await checkRefused(
  "an invoice cannot be raised against another centre's student (service_role)",
  `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
   values ($1, $2, date_trunc('month', current_date)::date, 800, current_date + 5)`,
  [centerA, stB],
)

// Centre B's student has no seeded guardian, and a null guardian_id would make
// MATCH SIMPLE skip the check — the insert would succeed and the test would
// "pass" for the wrong reason. It needs a real guardian to aim at, so make one
// and take it away again.
const gB = await one(
  `insert into guardians (coaching_center_id, student_id, phone, name)
   values ($1, $2, '01799999999', 'B father') returning id`,
  [centerB, stB],
)
await checkRefused(
  "a result SMS cannot be logged against another centre's guardian (service_role)",
  `insert into sms_logs (coaching_center_id, guardian_id, to_phone, kind, body)
   values ($1, $2, '+8801711111111', 'exam_result', 'x')`,
  [centerA, gB],
)
await db.query('delete from guardians where id = $1', [gB])

await checkRefused(
  "a permissions row cannot be attached to another centre's teacher (service_role)",
  `insert into teacher_permissions (teacher_id, coaching_center_id) values ($1, $2)`,
  [tRahim, centerA],
)
await checkRefused(
  "teacher_subjects cannot pair a teacher with another centre's subject (service_role)",
  `insert into teacher_subjects (teacher_id, subject_id, coaching_center_id)
   values ($1, $2, $3)`,
  [tKarim, sPhy, centerA],
)

// And the same attack down the path a real request takes.
check(
  "owner A cannot create an exam on another centre's subject",
  await deniedAsUser(
    db,
    ids.ownerA,
    `insert into exams (coaching_center_id, subject_id, batch_id, title, total_marks, exam_date)
     values ($1, $2, $3, 'Injected', 100, current_date)`,
    [centerA, sPhy, bBioMorning],
  ),
)
check(
  "owner A cannot enroll another centre's student into their own batch",
  await deniedAsUser(
    db,
    ids.ownerA,
    `insert into enrollments (coaching_center_id, student_id, subject_id, batch_id)
     values ($1, $2, $3, $4)`,
    [centerA, stB, sBio, bBioMorning],
  ),
)

// The legitimate shapes have to keep working, or this is just an outage with a
// security rationale. Everything below is created and then removed again: the
// sections after this one assert exact counts, and a test that quietly leaves a
// student behind makes the next one fail for a reason that has nothing to do
// with what it is testing.
const spareBatch = await one(
  `insert into batches (coaching_center_id, subject_id, name)
   values ($1, $2, 'Not yet staffed') returning id`,
  [centerA, sBio],
)
// Worth stating on its own: a nullable sideways id must stay legal. MATCH SIMPLE
// skips the check when any key column is null, and an unassigned batch is
// exactly that — a real batch a centre creates before deciding who teaches it.
check('a batch with no teacher assigned yet is still legal', Boolean(spareBatch))

const spareEnrollment = await one(
  `insert into enrollments (coaching_center_id, student_id, subject_id, batch_id)
   values ($1, $2, $3, $4) returning id`,
  [centerA, stMim, sBio, spareBatch],
)
check('an ordinary same-centre enrollment still inserts', Boolean(spareEnrollment))

// Deleting a teacher must release their batches without taking the tenant
// column with it — the reason every "set null" in the migration names its
// column. A bare SET NULL on a composite key would try to null
// coaching_center_id too, and NOT NULL would turn this delete into an error.
const spareTeacher = await one(
  `insert into teachers (coaching_center_id, name) values ($1, 'Temp Sir') returning id`,
  [centerA],
)
await db.query('update batches set teacher_id = $1 where id = $2', [
  spareTeacher,
  spareBatch,
])
await db.query('delete from teachers where id = $1', [spareTeacher])
const released = (
  await db.query('select teacher_id, coaching_center_id from batches where id = $1', [
    spareBatch,
  ])
).rows[0]
check(
  'deleting a teacher nulls the batch teacher and keeps the centre',
  released.teacher_id === null && released.coaching_center_id === centerA,
  `teacher_id=${released.teacher_id} center=${released.coaching_center_id}`,
)

await db.query('delete from batches where id = $1', [spareBatch])
check(
  'and removing the batch takes its enrollment with it, leaving the seed as found',
  (await db.query('select count(*)::int as n from enrollments where id = $1', [
    spareEnrollment,
  ])).rows[0].n === 0,
)

// ---------------------------------------------------------------------------
// Deactivating a teacher. The settings screen tells an owner that turning a
// teacher off means "তিনি আর তাঁর ব্যাচ, শিক্ষার্থী বা অভিভাবকের নম্বর দেখতে পাবেন
// না" — a promise about a person who may have just been fired, so it had better
// be true. It takes two writes, and this section is why toggleTeacherActive does
// both of them.
// ---------------------------------------------------------------------------

console.log('\nDeactivating a teacher:')

await db.query('update teachers set active = false where id = $1', [tKarim])

await asUser(db, ids.karim, async (tx) => {
  check(
    'an inactive teacher sees no students',
    (await n(tx, 'select count(*)::int as n from students')) === 0,
  )
  check(
    'an inactive teacher sees no guardian phone numbers',
    (await n(tx, 'select count(*)::int as n from guardians')) === 0,
  )
  check(
    'an inactive teacher sees no exam results',
    (await n(tx, 'select count(*)::int as n from exam_results')) === 0,
  )
  // Not a bug, and the reason the action does more than flip `active`.
  // batches_member_read admits anyone with a membership, deliberately — students
  // and guardians need to see batch names and times. But `batches` also carries
  // monthly_fee_bdt, so leaving the membership in place leaves an ex-employee
  // reading the centre's price list and their former colleagues' phone numbers.
  check(
    'flipping `active` alone does NOT hide the batch list — membership still does',
    (await n(tx, 'select count(*)::int as n from batches')) > 0,
  )
})

check(
  'an inactive teacher cannot take attendance for what was their own batch',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into attendance_sessions (coaching_center_id, batch_id, session_date)
     values ($1, $2, current_date - 1)`,
    [centerA, bBioMorning],
  ),
)

// The second write. Only the 'teacher' membership, so a teacher who is also a
// manager keeps that one and an owner in Teacher Mode cannot lock themselves out.
await db.query(
  `delete from center_members
   where coaching_center_id = $1 and user_id = $2 and role = 'teacher'`,
  [centerA, ids.karim],
)

await asUser(db, ids.karim, async (tx) => {
  check(
    'with the membership gone the batch list goes too',
    (await n(tx, 'select count(*)::int as n from batches')) === 0,
  )
  check(
    'and so does the center itself',
    (await n(tx, 'select count(*)::int as n from coaching_centers')) === 0,
  )
  check(
    'and the list of colleagues',
    (await n(tx, 'select count(*)::int as n from teachers')) === 0,
  )
})

// The other half of the promise: the records they entered do not leave with them.
const keptMarks = await db.query(
  'select count(*)::int as n from exam_results where exam_id = $1',
  [examBio],
)
check('their past marks survive deactivation', keptMarks.rows[0].n === 1)

await db.query('update teachers set active = true where id = $1', [tKarim])
await addMember(centerA, ids.karim, 'teacher')

await asUser(db, ids.karim, async (tx) => {
  check(
    'reactivating gives the teacher their students back',
    (await n(tx, 'select count(*)::int as n from students')) === 1,
  )
  check(
    'and their batch back',
    (await n(tx, 'select count(*)::int as n from batches where id = $1', [bBioMorning])) === 1,
  )
})

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
// The fee board's balance view.
//
// A Postgres view runs as its OWNER unless told otherwise, and the owner here is
// the migration role, which bypasses RLS. So the first view added to this schema
// was a chance to undo every policy above at once — not by weakening them, but
// by routing around them. Measured before writing 20260811000006: as owner B,
// the students table returned 1 row and a naive view over it returned 2,
// including the other centre's child's name.
//
// security_invoker = true fixes it, check-migrations.mjs now refuses a view
// without it, and this section is the behavioural half of that: it asks the
// question an owner would ask, which is whether the fee board shows anyone
// else's money.
//
// The arithmetic checks are here rather than in a unit test because this is
// where the arithmetic actually happens. numeric(10, 2) in Postgres, not floats
// in JavaScript — a fee board that is off by a taka is a fee board an owner
// stops believing, and they will check it against a bKash statement.
// ---------------------------------------------------------------------------

console.log('\nFee board view (security_invoker):')

// The seeded invoice: centre A, Ali, ৳800, nothing paid yet.
const invoiceAli = (
  await db.query('select id from fee_invoices where student_id = $1', [stAli])
).rows[0].id

await asUser(db, ids.ownerA, async (tx) => {
  check(
    'owner A sees their own invoice through the view',
    (await n(tx, 'select count(*)::int as n from fee_invoice_balances')) === 1,
  )
  check(
    'and the name comes with it, so the board is readable',
    (await tx.query('select student_name from fee_invoice_balances')).rows[0]
      .student_name === 'Ali Hasan',
  )
})

// The one that matters. Centre B has no invoices at all, so a leak shows up as
// any number other than zero.
await asUser(db, ids.ownerB, async (tx) => {
  check(
    "owner B sees nothing of centre A's money through the view",
    (await n(tx, 'select count(*)::int as n from fee_invoice_balances')) === 0,
  )
})

await asUser(db, ids.karim, async (tx) => {
  check(
    'a teacher still sees no fees through the view',
    (await n(tx, 'select count(*)::int as n from fee_invoice_balances')) === 0,
  )
})

await asUser(db, ids.guardianUser, async (tx) => {
  check(
    "the guardian sees their own child's bill through the view",
    (await n(tx, 'select count(*)::int as n from fee_invoice_balances')) === 1,
  )
})

await asUser(db, null, async (tx) => {
  check(
    'a signed-out reader sees nothing through the view',
    (await n(tx, 'select count(*)::int as n from fee_invoice_balances')) === 0,
  )
})

// --- The money -------------------------------------------------------------

const balance = async (invoiceId) =>
  (
    await db.query(
      'select net_bdt, paid_bdt, remaining_bdt from fee_invoice_balances where id = $1',
      [invoiceId],
    )
  ).rows[0]

let bal = await balance(invoiceAli)
check(
  'nothing paid yet: remaining is the full fee',
  Number(bal.net_bdt) === 800 && Number(bal.paid_bdt) === 0 && Number(bal.remaining_bdt) === 800,
  `net=${bal.net_bdt} paid=${bal.paid_bdt} remaining=${bal.remaining_bdt}`,
)

// A discount reduces what the family owes without rewriting what was billed —
// the owner needs both numbers to explain the bill to a parent.
await db.query('update fee_invoices set discount_bdt = 100 where id = $1', [invoiceAli])
bal = await balance(invoiceAli)
check(
  'a discount lowers what is owed, not what was billed',
  Number(bal.net_bdt) === 700 && Number(bal.remaining_bdt) === 700,
  `net=${bal.net_bdt} remaining=${bal.remaining_bdt}`,
)

const pay = (amount, method = 'cash') =>
  db.query(
    `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt, method)
     values ($1, $2, $3, $4, $5) returning id`,
    [centerA, invoiceAli, stAli, amount, method],
  )

await pay(400)
bal = await balance(invoiceAli)
check(
  'a partial payment leaves the difference outstanding',
  Number(bal.paid_bdt) === 400 && Number(bal.remaining_bdt) === 300,
  `paid=${bal.paid_bdt} remaining=${bal.remaining_bdt}`,
)

await pay(300, 'bkash')
bal = await balance(invoiceAli)
check(
  'paying the rest clears it exactly',
  Number(bal.paid_bdt) === 700 && Number(bal.remaining_bdt) === 0,
  `paid=${bal.paid_bdt} remaining=${bal.remaining_bdt}`,
)

// A refund is a negative payment, not a deleted one: the original stays on the
// record and the family owes the money again.
await pay(-200)
bal = await balance(invoiceAli)
check(
  'a refund puts the money back on the bill',
  Number(bal.paid_bdt) === 500 && Number(bal.remaining_bdt) === 200,
  `paid=${bal.paid_bdt} remaining=${bal.remaining_bdt}`,
)
check(
  'and the payment it reverses is still on the record',
  (await db.query('select count(*)::int as n from fee_payments where invoice_id = $1', [
    invoiceAli,
  ])).rows[0].n === 3,
)

// Fractional taka, which is the case JavaScript gets wrong. 1500.10 has no exact
// float representation; three of them added as doubles give 4500.299999999999.
await db.query('update fee_invoices set amount_bdt = 1500.10, discount_bdt = 0 where id = $1', [
  invoiceAli,
])
await db.query('delete from fee_payments where invoice_id = $1', [invoiceAli])
await pay(500.05)
await pay(500.05)
bal = await balance(invoiceAli)
check(
  'fractional taka add up exactly, because Postgres does the adding',
  Number(bal.paid_bdt) === 1000.1 && Number(bal.remaining_bdt) === 500,
  `paid=${bal.paid_bdt} remaining=${bal.remaining_bdt}`,
)

// Leave the seed as found: the sections below assert exact counts, and a
// payment or a changed fee left behind here would fail one of them for a reason
// that has nothing to do with what it is testing.
await db.query('delete from fee_payments where invoice_id = $1', [invoiceAli])
await db.query(
  'update fee_invoices set amount_bdt = 800, discount_bdt = 0 where id = $1',
  [invoiceAli],
)

// ---------------------------------------------------------------------------
// The two writes the fee board makes.
//
// Everything above this proves reads. Nothing yet proved that the owner who is
// supposed to run this screen can actually write to it — a policy that grants
// SELECT and forgets INSERT reads exactly like a working one until someone tries
// to take money, and the first person to try will be standing in front of a
// parent.
//
// The other half is the generator's promise. The button says pressing it twice is
// safe, which rests entirely on `on conflict (enrollment_id, period_month) do
// nothing` and on RETURNING listing only the rows that were really inserted. If
// that ever stopped holding, an owner with a flaky connection would double-bill
// every family in the centre, and the arithmetic above would report the doubled
// figure perfectly correctly.
// ---------------------------------------------------------------------------

console.log('\nFee board writes (raise, re-raise, collect):')

// Mim has no seeded invoice, so this is a genuine first insert. The SQL is the
// shape the generator's upsert compiles to, not an approximation of it.
const raiseForMim = (tx) =>
  tx.query(
    `insert into fee_invoices
       (coaching_center_id, student_id, enrollment_id, period_month, amount_bdt, due_date)
     values ($1, $2, $3, date_trunc('month', current_date)::date, 1500, current_date + 10)
     on conflict (enrollment_id, period_month) do nothing
     returning id`,
    [centerA, stMim, eMim],
  )

let mimInvoice = null
await asUser(db, ids.ownerA, async (tx) => {
  const first = await raiseForMim(tx)
  mimInvoice = first.rows[0]?.id ?? null
  check('the owner can raise an invoice for their own enrollment', first.rows.length === 1)

  const second = await raiseForMim(tx)
  check(
    'pressing generate again inserts nothing and says so',
    second.rows.length === 0,
    `returned ${second.rows.length} row(s)`,
  )

  check(
    'so the family is billed once, not twice',
    (await n(
      tx,
      `select count(*)::int as n from fee_invoices
       where enrollment_id = $1 and period_month = date_trunc('month', current_date)::date`,
      [eMim],
    )) === 1,
  )

  await tx.query(
    `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt, method)
     values ($1, $2, $3, 1500, 'bkash')`,
    [centerA, mimInvoice, stMim],
  )
  check(
    'the owner can record a payment, and the board clears',
    Number(
      (
        await tx.query('select remaining_bdt from fee_invoice_balances where id = $1', [
          mimInvoice,
        ])
      ).rows[0].remaining_bdt,
    ) === 0,
  )
})

// A payment aimed at another centre's invoice. The insert names centre B in its
// own tenant column, so RLS lets it through — what refuses it is the composite
// foreign key from 20260811000005, and that distinction is why this is worth
// asserting rather than assuming.
check(
  "owner B cannot put money on centre A's invoice",
  await deniedAsUser(
    db,
    ids.ownerB,
    `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt)
     values ($1, $2, $3, 500)`,
    [centerB, mimInvoice, stB],
  ),
)

check(
  'a teacher cannot record a payment at all',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt)
     values ($1, $2, $3, 500)`,
    [centerA, mimInvoice, stMim],
  ),
)

// Put the seed back: the sections below count invoices and expect one.
await db.query('delete from fee_payments where invoice_id = $1', [mimInvoice])
await db.query('delete from fee_invoices where id = $1', [mimInvoice])

// ---------------------------------------------------------------------------
// The record of having chased a fee.
//
// Three things here are not obvious from reading the migration.
//
// The first is that repeat reminders for the same invoice must be *allowed*. The
// nearest existing table, sms_dispatches, carries unique (coaching_center_id,
// kind, ref_id) — which is exactly what makes "one exam sends once" a database
// guarantee, and exactly what would break a fee chase, because the planned
// cadence is due−3, due, and due+7 against one invoice. Routing reminders through
// that table would have silently dropped the second and third. So the absence of
// a unique key is a feature and gets asserted like one.
//
// The second is that a guardian must NOT be able to read these, even though they
// can read their own invoices and their own receipts. "This centre messaged you
// about money three times in October" is the centre's own working note; a parent
// reading a tally of how often they were chased learns nothing they need and
// something that only strains the relationship the reminder was protecting.
//
// The third is the cascade. A cancelled invoice takes its chases with it, so a
// deleted bill cannot leave behind a record of a parent being asked for money
// that no longer exists.
// ---------------------------------------------------------------------------

console.log('\nFee reminders (who chased whom):')

// Explicit created_at so the ordering assertion below means something. Three
// inserts inside one transaction all share that transaction's now(), which would
// make "the latest" ambiguous here in a way it never is in production, where each
// tap is its own statement.
const remind = (tx, invoice, center, channel = 'sms', ago = '0 minutes') =>
  tx.query(
    `insert into fee_reminders
       (coaching_center_id, invoice_id, channel, amount_bdt, to_phone, body, created_at)
     values ($1, $2, $3, 800, '+8801712345678', 'test body', now() - $4::interval)
     returning id`,
    [center, invoice, channel, ago],
  )

await asUser(db, ids.ownerA, async (tx) => {
  check(
    'the owner can record a reminder against their own invoice',
    (await remind(tx, invoiceAli, centerA, 'sms', '2 days')).rows.length === 1,
  )

  // The two sms_dispatches would have refused.
  await remind(tx, invoiceAli, centerA, 'whatsapp', '1 day')
  await remind(tx, invoiceAli, centerA, 'call', '1 minute')
  check(
    'the same invoice can be chased again, on another channel, and again',
    (await n(tx, 'select count(*)::int as n from fee_reminders where invoice_id = $1', [
      invoiceAli,
    ])) === 3,
  )

  // The board's own query, which takes the first row of a descending order.
  check(
    'and the latest one is the one the board will show',
    (
      await tx.query(
        `select channel from fee_reminders where invoice_id = $1
         order by created_at desc limit 1`,
        [invoiceAli],
      )
    ).rows[0].channel === 'call',
  )
})

// Named centre B in its own tenant column, so its RLS check passes; what refuses
// it is the composite foreign key to (id, coaching_center_id) on fee_invoices.
check(
  "owner B cannot log a reminder against centre A's invoice",
  await deniedAsUser(
    db,
    ids.ownerB,
    `insert into fee_reminders (coaching_center_id, invoice_id, channel, amount_bdt)
     values ($1, $2, 'sms', 800)`,
    [centerB, invoiceAli],
  ),
)

check(
  'a teacher cannot log a reminder, for the same reason they cannot take money',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into fee_reminders (coaching_center_id, invoice_id, channel, amount_bdt)
     values ($1, $2, 'sms', 800)`,
    [centerA, invoiceAli],
  ),
)

await asUser(db, ids.ownerB, async (tx) => {
  check(
    "owner B sees none of centre A's reminders",
    (await n(tx, 'select count(*)::int as n from fee_reminders')) === 0,
  )
})

await asUser(db, ids.karim, async (tx) => {
  check(
    'a teacher cannot read who has been chased',
    (await n(tx, 'select count(*)::int as n from fee_reminders')) === 0,
  )
})

await asUser(db, ids.guardianUser, async (tx) => {
  check(
    'a guardian cannot read the record of being chased, unlike their own bill',
    (await n(tx, 'select count(*)::int as n from fee_reminders')) === 0,
  )
})

await asUser(db, null, async (tx) => {
  check(
    'a signed-out reader sees no reminders',
    (await n(tx, 'select count(*)::int as n from fee_reminders')) === 0,
  )
})

// The cascade, on a throwaway invoice so the seeded one survives.
const scratchInvoice = await one(
  `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
   values ($1, $2, '2026-01-01', 500, '2026-01-10') returning id`,
  [centerA, stAli],
)
await remind(db, scratchInvoice, centerA)
await db.query('delete from fee_invoices where id = $1', [scratchInvoice])
check(
  'deleting an invoice takes its reminders with it',
  (await n(db, 'select count(*)::int as n from fee_reminders where invoice_id = $1', [
    scratchInvoice,
  ])) === 0,
)

// Leave the seed as found.
await db.query('delete from fee_reminders where invoice_id = $1', [invoiceAli])

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
