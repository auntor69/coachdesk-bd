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
  // And Nasrin's, deliberately. batches_member_read admits every member of the
  // centre, because a batch's name and time are not a secret from the people
  // inside it and the owner's setup screens depend on reading all of them.
  //
  // This is asserted rather than assumed because two screens are built on it being
  // true: /teach filters by teachers.id in the app, and /teach/[batchId] answers
  // forbidden() for a batch in the reader's own centre that is not theirs. Anyone
  // narrowing this policy will land here first, and the fix is to delete those two
  // filters — not to leave them contradicting a boundary that has moved.
  //
  // What a teacher still cannot reach through a foreign batch is anyone in it: the
  // enrolments, the students, the marks and the guardians' phone numbers are all
  // checked above, and all scoped by app.teaches_batch.
  check(
    "Karim can read Nasrin's batch row, which is why /teach filters in the app",
    (await n(tx, 'select count(*)::int as n from batches where id = $1', [bChemEvening])) === 1,
  )
  check(
    "Karim sees nobody in Nasrin's batch",
    (await n(tx, 'select count(*)::int as n from enrollments where batch_id = $1', [bChemEvening])) === 0,
  )
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
// Receipt numbers (20260811000017).
//
// The number the owner writes on the slip and the parent reads back down a phone
// line. Three things have to hold or the receipt is worse than none at all: it
// must be unique inside the centre, it must not be derived from anything global
// (centre A's count is not centre B's business), and once issued it must not
// change — renumbering is how a payment gets hidden.
// ---------------------------------------------------------------------------

const receiptNo = async (id) =>
  (await db.query('select receipt_no from fee_payments where id = $1', [id])).rows[0].receipt_no

const nextFor = async (center) =>
  (
    await db.query(
      'select coalesce(max(receipt_no), 0) + 1 as n from fee_payments where coaching_center_id = $1',
      [center],
    )
  ).rows[0].n

const expectA = await nextFor(centerA)
const rFirst = (await pay(100)).rows[0].id
const rSecond = (await pay(100)).rows[0].id

check(
  'a payment is numbered without being told to',
  (await receiptNo(rFirst)) === expectA,
  `got ${await receiptNo(rFirst)}, expected ${expectA}`,
)
check(
  'and the next one is the next number',
  (await receiptNo(rSecond)) === expectA + 1,
  `got ${await receiptNo(rSecond)}`,
)

// The isolation that matters. Centre B's rFirst receipt is 1 even though centre A
// has already issued several: a shared sequence would let an owner read the
// platform's whole volume off their own receipt book.
const bInvoice = await one(
  `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
   values ($1, $2, '2026-02-01', 500, '2026-02-10') returning id`,
  [centerB, stB],
)
const bPayment = await one(
  `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt)
   values ($1, $2, $3, 500) returning id`,
  [centerB, bInvoice, stB],
)
check(
  'the other centre numbers from one, not from ours',
  (await receiptNo(bPayment)) === 1,
  `centre B got ${await receiptNo(bPayment)} while centre A is at ${expectA + 1}`,
)

// A used number is never handed out again, and the thing that guarantees it is
// that a payment cannot be deleted at all. Counting from max() would reissue the
// top number the moment the newest payment vanished, so the revoke in step 4 of
// 20260811000017 is load-bearing and not housekeeping.
check(
  'a staff admin cannot delete a payment',
  await deniedAsUser(db, ids.ownerA, 'delete from fee_payments where id = $1', [rSecond]),
)
check(
  'and the receipt is still there to be found',
  (await receiptNo(rSecond)) === expectA + 1,
)
check(
  'nor can they rewrite the amount the receipt says',
  await deniedAsUser(db, ids.ownerA, 'update fee_payments set amount_bdt = 9999 where id = $1', [
    rSecond,
  ]),
)
check(
  'nor the method it was collected by',
  await deniedAsUser(db, ids.ownerA, `update fee_payments set method = 'bkash' where id = $1`, [
    rSecond,
  ]),
)
check(
  'nor renumber it',
  await deniedAsUser(db, ids.ownerA, 'update fee_payments set receipt_no = 7 where id = $1', [
    rSecond,
  ]),
)

// The two columns that were handed back. A mistyped bKash transaction id is a
// real thing an owner has to fix, and fixing it changes no number on the paper.
await asUser(db, ids.ownerA, async (tx) => {
  await tx.query(`update fee_payments set reference = 'TRX7788', note = 'retyped' where id = $1`, [
    rSecond,
  ])
})
check(
  'a staff admin can correct the reference and the note',
  (
    await db.query('select reference, note from fee_payments where id = $1', [rSecond])
  ).rows[0].reference === 'TRX7788',
)

// The import path: a centre moving off a paper book keeps the numbers already on
// the slips its parents are holding.
const rImported = await one(
  `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt, receipt_no)
   values ($1, $2, $3, 100, 90001) returning id`,
  [centerA, invoiceAli, stAli],
)
check('an explicit receipt number is kept', (await receiptNo(rImported)) === 90001)
check(
  'and the next automatic number continues from it',
  (await receiptNo((await pay(100)).rows[0].id)) === 90002,
)

// checkRefused is not the helper for this one: it insists the error names a
// _center_fkey, and the constraint that has to fire here is the unique index.
// Naming it is the same discipline for the same reason — "the database said no"
// is cheap to get by accident.
let duplicate = { ok: false, why: 'accepted' }
try {
  await db.query(
    `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt, receipt_no)
     values ($1, $2, $3, 100, 90001)`,
    [centerA, invoiceAli, stAli],
  )
} catch (error) {
  const message = String(error.message)
  duplicate = { ok: /fee_payments_center_receipt_key/.test(message), why: message.split('\n')[0] }
}
check('the same number cannot be issued twice in one centre', duplicate.ok, duplicate.why)

// The grant above stops a browser session. This one runs as the migration role —
// the SQL editor, a support script, the next migration — and the trigger stops it
// too. Two independent mechanisms, because the receipt number is the one thing on
// the paper that cannot be re-derived from anything else.
let renumbered = false
try {
  await db.query('update fee_payments set receipt_no = 7 where id = $1', [rFirst])
  renumbered = true
} catch {
  /* expected */
}
check('not even the migration role can change an issued receipt number', !renumbered)
check(
  'and the row still carries the number that was printed',
  (await receiptNo(rFirst)) === expectA,
)

// An update that leaves receipt_no alone must still work — the guard is on the
// column, not on the row.
await db.query('update fee_payments set note = $2 where id = $1', [rFirst, 'cash counted twice'])
check(
  'an unrelated edit to the same row is allowed',
  (
    await db.query('select note from fee_payments where id = $1', [rFirst])
  ).rows[0].note === 'cash counted twice',
)

// Two mechanisms, proven separately.
//
// Every refusal above would also be produced by the REVOKE on its own, which
// leaves the trigger untested — and 20260811000004 spells out why that is not good
// enough: a REVOKE only removes grants the revoking role made, so if the live
// database's grant came from supabase_admin rather than postgres, the revoke
// succeeds while changing nothing and this suite would be proving a lock that
// production does not have. One pasted `grant all on all tables in schema public`
// does the same thing on purpose.
//
// So hand the privilege back, inside a transaction that is thrown away, and check
// that the refusal is still a refusal. RLS cannot be what refuses here: ownerA is a
// staff admin in centre A and the policy is `for all`, and a policy refusal on
// DELETE or UPDATE is silent — nought rows, no error. An exception can only be the
// trigger.
const guard = { del: '', amount: '', allowed: false }
await db.query('begin')
try {
  await db.query('grant update, delete on public.fee_payments to authenticated')
  await db.query('set local role authenticated')
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ids.ownerA])
  await db.query('savepoint probe')

  try {
    await db.query('delete from fee_payments where id = $1', [rFirst])
  } catch (error) {
    guard.del = String(error.message)
  }
  await db.query('rollback to savepoint probe')

  try {
    await db.query('update fee_payments set amount_bdt = 1 where id = $1', [rFirst])
  } catch (error) {
    guard.amount = String(error.message)
  }
  await db.query('rollback to savepoint probe')

  // And the two columns that were handed back still go through, so what is being
  // observed is a guard on the money and not a trigger that refuses everything.
  const edited = await db.query(
    `update fee_payments set note = 'probe' where id = $1 returning note`,
    [rFirst],
  )
  guard.allowed = edited.rows[0]?.note === 'probe'
} finally {
  await db.query('rollback')
}

check(
  'a trigger refuses the delete even when the privilege is handed back',
  /cannot be deleted by authenticated/.test(guard.del),
  guard.del.split('\n')[0] || 'accepted',
)
check(
  'and refuses the amount even when the privilege is handed back',
  /cannot be rewritten by authenticated/.test(guard.amount),
  guard.amount.split('\n')[0] || 'accepted',
)
check('while still letting the note through', guard.allowed)
check(
  'and the thrown-away transaction took the grant with it',
  await deniedAsUser(db, ids.ownerA, 'delete from fee_payments where id = $1', [rFirst]),
)

await db.query('delete from fee_payments where coaching_center_id = $1', [centerA])
await db.query('delete from fee_payments where id = $1', [bPayment])
await db.query('delete from fee_invoices where id = $1', [bInvoice])

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
  grant update (name, phone, address, bd_area, timezone, payment_wallet, payment_number)
    on coaching_centers to authenticated;
`)

// ---------------------------------------------------------------------------
// The payment number — the only editable column on this table that moves money.
//
// Everything above protects what a centre is charged. This protects where the
// centre's income lands. A parent reads this number out of a fee reminder and
// types it into a Send Money screen, so whoever can write it can redirect a
// month of fees and the owner finds out when the money does not arrive.
//
// Note what these assertions look at. centers_owner_update filters rows with
// `using (app.is_owner(id))`, so a teacher's UPDATE does not raise anything — it
// matches nothing and reports success. deniedAsUser would pass on a wide-open
// column. The only honest question is what the row says afterwards.
// ---------------------------------------------------------------------------

console.log('\nPayment number (where a parent sends the fee):')

const payTo = async (center = centerA) =>
  (
    await db.query(
      'select payment_wallet, payment_number from coaching_centers where id = $1',
      [center],
    )
  ).rows[0]

const setPay = (assignments) =>
  `update coaching_centers set ${assignments} where id = $1`

await asUser(db, ids.ownerA, (tx) =>
  tx.query(setPay(`payment_wallet = 'bkash', payment_number = '+8801711000012'`), [
    centerA,
  ]),
)
let money = await payTo()
check(
  'owner can set where the fees are sent',
  money.payment_wallet === 'bkash' && money.payment_number === '+8801711000012',
  `${money.payment_wallet} ${money.payment_number}`,
)

// A well-formed number, deliberately. If it were malformed the check constraint
// would reject it and this would pass without RLS having done anything.
await asUser(db, ids.karim, (tx) =>
  tx.query(setPay(`payment_wallet = 'nagad', payment_number = '+8801999999999'`), [
    centerA,
  ]),
)
money = await payTo()
check(
  'a teacher cannot point the fees at their own wallet',
  money.payment_wallet === 'bkash' && money.payment_number === '+8801711000012',
  `${money.payment_wallet} ${money.payment_number}`,
)

await asUser(db, ids.ownerB, (tx) =>
  tx.query(setPay(`payment_wallet = 'rocket', payment_number = '+8801811000099'`), [
    centerA,
  ]),
)
money = await payTo()
check(
  "an owner cannot redirect another centre's fees",
  money.payment_wallet === 'bkash' && money.payment_number === '+8801711000012',
  `${money.payment_wallet} ${money.payment_number}`,
)

// Half-configured is refused in the database, not only in the action. A wallet
// with no number tells a parent nothing; a number with no wallet does not say
// which app to open, and the three are not interchangeable.
check(
  'a wallet with no number is refused',
  await deniedAsUser(
    db,
    ids.ownerA,
    setPay(`payment_wallet = 'nagad', payment_number = null`),
    [centerA],
  ),
)
check(
  'a number with no wallet is refused',
  await deniedAsUser(
    db,
    ids.ownerA,
    setPay(`payment_wallet = null, payment_number = '+8801711000012'`),
    [centerA],
  ),
)

// Each of these is a shape that would reach a parent looking almost right.
const BAD_NUMBERS = [
  ['01711000012', 'local form that never got normalised'],
  ['+880171100001', 'one digit short'],
  ['+8801711000012 ', 'trailing space from a paste'],
  ['+8801111000012', '011 — Citycell, dead since 2016'],
]
for (const [bad, why] of BAD_NUMBERS) {
  check(
    `a malformed payment number is refused (${why})`,
    await deniedAsUser(db, ids.ownerA, setPay('payment_number = $2'), [centerA, bad]),
  )
}

await asUser(db, ids.ownerA, (tx) =>
  tx.query(setPay('payment_wallet = null, payment_number = null'), [centerA]),
)
money = await payTo()
check(
  'clearing both is how a centre says it takes no mobile payments',
  money.payment_wallet === null && money.payment_number === null,
  `${money.payment_wallet} ${money.payment_number}`,
)

console.log('\nBulk import (import_students):')

// The jsonb the Server Action sends is exactly the parser's ImportStudent shape,
// so these literals are what a pasted register turns into.
const pasted = (...rows) => JSON.stringify(rows)
const listed = (name, phone, guardianName = null) => ({
  name,
  guardian_phone: phone,
  guardian_name: guardianName,
})
const uuids = (...list) => `{${list.join(',')}}`
const IMPORT = 'select * from import_students($1::uuid, $2::jsonb, $3::uuid[])'

const importAs = (user, center, students, batches = uuids()) =>
  asUser(
    db,
    user,
    async (tx) => (await tx.query(IMPORT, [center, students, batches])).rows[0],
  )

// Counted as superuser: what the caller can see is a separate question from what
// actually landed, and here we want the truth.
const countOf = (sql, params = []) => n(db, sql, params)
const studentsIn = (center) =>
  countOf('select count(*)::int as n from students where coaching_center_id = $1', [center])
const namedAnywhere = (name) =>
  countOf('select count(*)::int as n from students where name = $1', [name])

const beforeA = await studentsIn(centerA)
const beforeB = await studentsIn(centerB)

// A teacher pastes the register. The function is security invoker on purpose, so
// there is nothing to argue with: the insert hits students_staff_admin_write and
// raises. A definer function here would have been a hole straight through the
// tenant boundary.
check(
  'a teacher cannot import a roster',
  await deniedAsUser(db, ids.karim, IMPORT, [
    centerA,
    pasted(listed('Sabbir Ahmed', '+8801712345678')),
    uuids(),
  ]),
)
check(
  'the refused import left nothing behind',
  (await studentsIn(centerA)) === beforeA && (await namedAnywhere('Sabbir Ahmed')) === 0,
)

// The centre id is an argument, so it is the argument an attacker changes.
check(
  "an owner cannot import into another centre's roster",
  await deniedAsUser(db, ids.ownerA, IMPORT, [
    centerB,
    pasted(listed('Nadia Islam', '+8801812345678')),
    uuids(),
  ]),
)
check(
  "centre B's roster is untouched",
  (await studentsIn(centerB)) === beforeB && (await namedAnywhere('Nadia Islam')) === 0,
)

// The real thing: four pasted lines, of which one is already on the roster under
// different spacing and case, and one repeats a line above it.
const run = await importAs(
  ids.ownerA,
  centerA,
  pasted(
    listed('Sabbir Ahmed', '+8801712345678', 'Abdul Karim'),
    listed('  ali   HASAN ', '01700000000'),
    listed('Sabbir Ahmed', '+8801712345678'),
    listed('Rumana Begum', '+8801812345679'),
  ),
  uuids(bBioMorning),
)

check(
  'an owner imports the new names and skips the known one',
  run.added === 2 && run.already_there === 1 && run.enrolled === 2,
  `added ${run.added}, already ${run.already_there}, enrolled ${run.enrolled}`,
)
check('the roster grew by exactly the new names', (await studentsIn(centerA)) === beforeA + 2)
check(
  'the same name twice in one paste is one student',
  (await namedAnywhere('Sabbir Ahmed')) === 1,
)
// Whitespace and case are how a register differs from a database. If the match
// were exact, every re-paste would double the roster.
check(
  '"  ali   HASAN " matched the seeded Ali Hasan',
  (await namedAnywhere('  ali   HASAN ')) === 0 &&
    (await countOf('select count(*)::int as n from students where id = $1', [stAli])) === 1,
)

// The reason this is a database function at all: a student whose guardian row is
// missing is a student no SMS ever reaches, and nobody would find out until a
// parent complained.
check(
  'every imported student got a primary guardian row',
  (await countOf(
    `select count(*)::int as n from students s
     where s.coaching_center_id = $1 and s.name in ('Sabbir Ahmed', 'Rumana Begum')
       and not exists (
         select 1 from guardians g
         where g.student_id = s.id and g.is_primary and g.phone = s.guardian_phone
           and g.coaching_center_id = s.coaching_center_id)`,
    [centerA],
  )) === 0,
)
check(
  "the guardian's name came across when the line had one",
  (await countOf(
    `select count(*)::int as n from guardians g
     join students s on s.id = g.student_id
     where s.name = 'Sabbir Ahmed' and g.name = 'Abdul Karim'`,
  )) === 1,
)
check(
  'a line with no guardian name still gets the number',
  (await countOf(
    `select count(*)::int as n from guardians g
     join students s on s.id = g.student_id
     where s.name = 'Rumana Begum' and g.name is null and g.phone = '+8801812345679'`,
  )) === 1,
)
check(
  "the enrollment took the batch's own subject",
  (await countOf(
    `select count(*)::int as n from enrollments e
     join students s on s.id = e.student_id
     where e.batch_id = $1 and e.subject_id = $2 and s.name = 'Sabbir Ahmed'`,
    [bBioMorning, sBio],
  )) === 1,
)
check(
  'the student already on the roster was not enrolled again',
  (await countOf(
    'select count(*)::int as n from enrollments where student_id = $1 and batch_id = $2',
    [stAli, bBioMorning],
  )) === 1,
)
check(
  'and did not collect a second guardian row',
  (await countOf('select count(*)::int as n from guardians where student_id = $1', [stAli])) === 1,
)

// Pasting the same register twice is what an owner does when the first attempt
// looked like it had not worked.
const again = await importAs(
  ids.ownerA,
  centerA,
  pasted(
    listed('Sabbir Ahmed', '+8801712345678', 'Abdul Karim'),
    listed('Rumana Begum', '+8801812345679'),
  ),
  uuids(bBioMorning),
)
check(
  'a second identical paste adds nobody',
  again.added === 0 && again.already_there === 2 && again.enrolled === 0,
  `added ${again.added}, already ${again.already_there}`,
)

// Same guardian number, different child. Siblings must not collapse into one
// student, which is why identity is the name AND the number, not either alone.
const sibling = await importAs(
  ids.ownerA,
  centerA,
  pasted(listed('Sadia Ahmed', '+8801712345678')),
)
check('a sibling on the same number is a second student', sibling.added === 1)

// A batch id from the other centre. The function joins batches on the centre id
// as well as the array, so the enrollment is dropped rather than raising — the
// sideways hole this codebase keeps closing.
const wrongBatch = await importAs(
  ids.ownerA,
  centerA,
  pasted(listed('Tanvir Islam', '+8801912345678')),
  uuids(bPhyB),
)
check(
  'a batch from the other centre enrolls nobody',
  wrongBatch.added === 1 && wrongBatch.enrolled === 0,
  `added ${wrongBatch.added}, enrolled ${wrongBatch.enrolled}`,
)
check(
  "and centre B's batch has no new members",
  (await countOf('select count(*)::int as n from enrollments where batch_id = $1', [bPhyB])) === 1,
)

// Garbage the parser would never produce, because the jsonb arrives from a public
// endpoint and does not have to have come from our form.
check(
  'a jsonb object instead of an array is refused',
  await deniedAsUser(db, ids.ownerA, IMPORT, [centerA, '{"name":"x"}', uuids()]),
)
const partial = await importAs(
  ids.ownerA,
  centerA,
  pasted(
    listed('   ', '+8801912345670'),
    listed('Nusrat Jahan', null),
    listed('Nusrat Jahan', '+8801912345671'),
  ),
)
check(
  'a blank name or missing number is skipped, not fatal',
  partial.added === 1,
  `added ${partial.added}`,
)
const empty = await importAs(ids.ownerA, centerA, pasted())
check('an empty list is a no-op, not an error', empty.added === 0)

// All-or-nothing. The three inserts are CTEs of one statement precisely so that
// the enrollment failing cannot leave a student behind with no guardian row — the
// state that sends nothing to a parent and that nobody notices for a month. No
// realistic input can fail that last step, so the failure is bolted on: a check
// constraint on enrollments, one import, then the constraint comes off. This is
// the test that fails the day someone splits the function into separate
// statements, or wraps a row loop in an exception block.
const countBeforeBreak = await studentsIn(centerA)
await db.query('alter table enrollments add constraint tmp_break check (false) not valid')
let brokeCleanly = false
try {
  await importAs(
    ids.ownerA,
    centerA,
    pasted(listed('Farhana Akter', '+8801612345678')),
    uuids(bBioMorning),
  )
} catch {
  brokeCleanly = true
}
await db.query('alter table enrollments drop constraint tmp_break')
check('a failure at the last step fails the whole import', brokeCleanly)
check(
  'no half-imported student was left behind',
  (await studentsIn(centerA)) === countBeforeBreak &&
    (await namedAnywhere('Farhana Akter')) === 0,
)
check(
  'and no orphan guardian row either',
  (await countOf(
    "select count(*)::int as n from guardians where phone = '+8801612345678'",
  )) === 0,
)

// Every function in `public` is a PostgREST endpoint, and Supabase's default
// privileges hand EXECUTE to anon at creation — so a migration's
// `revoke ... from public` looks like it closed a door it never touched. Asked
// of the whole schema rather than of import_students, because the point is to
// catch the NEXT RPC somebody adds. Extension functions (citext) are excluded:
// they are granted to PUBLIC by their own install script and are not ours.
const anonCallable = (
  await db.query(
    `select p.proname as name
     from pg_proc p
     join pg_namespace nsp on nsp.oid = p.pronamespace
     join aclexplode(p.proacl) a on a.privilege_type = 'EXECUTE'
     where nsp.nspname = 'public' and p.prokind = 'f'
       and coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC') in ('anon', 'PUBLIC')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     order by 1`,
  )
).rows.map((r) => r.name)
check(
  'no function in public is callable without a session',
  anonCallable.length === 0,
  anonCallable.join(', '),
)
check(
  'the import is still callable by a signed-in user',
  (
    await db.query(
      `select count(*)::int as n from pg_proc p, aclexplode(p.proacl) a
       where p.proname = 'import_students' and a.privilege_type = 'EXECUTE'
         and a.grantee::regrole::text = 'authenticated'`,
    )
  ).rows[0].n === 1,
)

// ---------------------------------------------------------------------------
// Attendance rate per batch — the dashboard's third number.
//
// The second view in this schema and the first aggregate, and both halves need
// their own assertions.
//
// A view runs as its OWNER unless told otherwise, and 20260811000006 has the
// measurement: as owner B, a naive view over students returned the other
// centre's child. A green answer for fee_invoice_balances says nothing about a
// view written five migrations later, so the question gets asked again.
//
// The aggregate is the new part. security_invoker means the caller's own RLS
// decides which rows reach the count — and a count assembled from a subset of
// the rows is not a smaller answer, it is a different answer under the same
// column name. Ali can read his own attendance records and nobody else's, so
// RLS alone would have handed him a row labelled batch_name 'Bio Morning' with
// a rate_pct that described only himself. Nothing downstream could tell. That
// is why the view carries app.is_staff_admin itself, and why the three
// zero-row checks at the bottom are worth more than they look.
//
// The arithmetic is here rather than in a unit test because this is where it
// happens: 'late' is attendance, and 'excused' leaves the denominator instead
// of counting against the batch.
// ---------------------------------------------------------------------------

console.log('\nAttendance rate view (security_invoker, staff-admin only):')

// Dated inside a past month, so the fixture does not depend on which day the
// suite runs and cannot collide with the current-date session Karim took above —
// attendance_sessions is unique on (batch_id, session_date).
const heldOn = (center, batch, monthsBack, day) =>
  one(
    `insert into attendance_sessions (coaching_center_id, batch_id, session_date)
     values ($1, $2, (date_trunc('month', current_date::timestamp)
       - make_interval(months => $3::int))::date + $4::int)
     returning id`,
    [center, batch, monthsBack, day],
  )

const mark = (center, sessionId, enrollment, status) =>
  db.query(
    `insert into attendance_records (coaching_center_id, session_id, enrollment_id, status)
     values ($1, $2, $3, $4::attendance_status)`,
    [center, sessionId, enrollment, status],
  )

// Bio Morning, last month: five sessions — present, present, late, absent,
// excused. Four marks count and three of them are attendance, so 75%. Under a
// rate that docked lateness it would be 50, and under one that counted the
// excused day as an absence it would be 60.
for (const [day, status] of [
  [1, 'present'], [3, 'present'], [5, 'late'], [8, 'absent'], [10, 'excused'],
]) {
  await mark(centerA, await heldOn(centerA, bBioMorning, 1, day), eAli, status)
}

// Chem Evening, last month: one absence and nothing else.
await mark(centerA, await heldOn(centerA, bChemEvening, 1, 2), eMim, 'absent')

// Bio Morning, the month before: a single excused mark. The batch ran, so a row
// has to exist, but there is nothing to take a percentage of.
await mark(centerA, await heldOn(centerA, bBioMorning, 2, 4), eAli, 'excused')

// Centre B, last month: one present, so a leak into centre A reads as a number
// rather than as an absence of one.
await mark(centerB, await heldOn(centerB, bPhyB, 1, 6), eB, 'present')

const rateRow = async (tx, batch, monthsBack = 1) =>
  (
    await tx.query(
      `select sessions, present, late, absent, excused, counted, rate_pct,
              batch_name, batch_active, period_month::text as period_month
       from batch_attendance_monthly
       where batch_id = $1
         and period_month = (date_trunc('month', current_date::timestamp)
           - make_interval(months => $2::int))::date`,
      [batch, monthsBack],
    )
  ).rows[0] ?? null

await asUser(db, ids.ownerA, async (tx) => {
  check(
    'the owner gets one row per batch per month, and only their own centre',
    (await n(tx, 'select count(*)::int as n from batch_attendance_monthly')) === 3,
  )

  const bio = await rateRow(tx, bBioMorning)
  check(
    'five sessions, four marks counted: the excused day is not in the denominator',
    Number(bio?.sessions) === 5 && Number(bio?.counted) === 4,
    `sessions=${bio?.sessions} counted=${bio?.counted}`,
  )
  check(
    'late is attendance: two present plus one late over four is 75%',
    Number(bio?.rate_pct) === 75,
    `rate=${bio?.rate_pct} present=${bio?.present} late=${bio?.late} absent=${bio?.absent}`,
  )
  check(
    'and the batch name travels with it, so the card is readable',
    bio?.batch_name === 'Bio Morning' && bio?.batch_active === true,
  )

  const chem = await rateRow(tx, bChemEvening)
  check(
    'a batch nobody attended reads 0, which is not the same fact as no rate',
    Number(chem?.rate_pct) === 0 && Number(chem?.counted) === 1,
    `rate=${chem?.rate_pct} counted=${chem?.counted}`,
  )

  const older = await rateRow(tx, bBioMorning, 2)
  check(
    'a month of nothing but excused marks has a row but no rate',
    older !== null && older.rate_pct === null && Number(older.counted) === 0,
    `row=${older ? 'yes' : 'no'} rate=${older?.rate_pct} counted=${older?.counted}`,
  )
  check(
    'and it is its own month, not folded into the one after it',
    Boolean(older) && older.period_month !== bio?.period_month,
    `${older?.period_month} vs ${bio?.period_month}`,
  )

  // The session Karim took at the top of this file was never marked. Counting it
  // would put a day nobody was registered for into "how often did this batch
  // run", so an unmarked session is not a session here.
  check(
    'a session opened and never marked produces no row at all',
    (await rateRow(tx, bBioMorning, 0)) === null,
  )

  check(
    "owner A sees nothing of centre B's attendance",
    (await n(
      tx,
      'select count(*)::int as n from batch_attendance_monthly where batch_id = $1',
      [bPhyB],
    )) === 0,
  )
})

await asUser(db, ids.ownerB, async (tx) => {
  check(
    'owner B sees their own batch through the view',
    (await n(tx, 'select count(*)::int as n from batch_attendance_monthly')) === 1,
  )
  check(
    "and none of centre A's batches, by id",
    (await n(
      tx,
      'select count(*)::int as n from batch_attendance_monthly where batch_id = $1',
      [bBioMorning],
    )) === 0,
  )
})

// The three the aggregate exists to rule out. Karim teaches Bio Morning, so the
// teacher policy on attendance_records would have given him every mark in the
// fixture and a rate of 75% that happens to be true; Ali can read his own marks,
// so he would have got a row saying 'Bio Morning' and meaning himself. Neither is
// a tenant leak and neither is caught by counting rows in another centre — the
// view's own predicate is the only thing that makes both of them nothing.
//
// Each pair asserts the open door before the shut one. A zero from a reader who
// could not see the marks anyway proves nothing about the view, and that is the
// shape this section would rot into if the fixture ever moved.
await asUser(db, ids.karim, async (tx) => {
  check(
    'the teacher policy really does hand Karim the marks under this view',
    (await n(tx, 'select count(*)::int as n from attendance_records')) > 0,
  )
  check(
    'a teacher reads no batch rate, not even for the batch he teaches',
    (await n(tx, 'select count(*)::int as n from batch_attendance_monthly')) === 0,
  )
})

await asUser(db, ids.studentUser, async (tx) => {
  check(
    'and the student policy hands Ali his own',
    (await n(tx, 'select count(*)::int as n from attendance_records')) > 0,
  )
  check(
    "a student cannot read their own attendance as if it were the batch's",
    (await n(tx, 'select count(*)::int as n from batch_attendance_monthly')) === 0,
  )
})

await asUser(db, ids.guardianUser, async (tx) => {
  check(
    'nor can a guardian, for the same reason',
    (await n(tx, 'select count(*)::int as n from batch_attendance_monthly')) === 0,
  )
})

await asUser(db, null, async (tx) => {
  check(
    'and a signed-out reader gets nothing',
    (await n(tx, 'select count(*)::int as n from batch_attendance_monthly')) === 0,
  )
})

// ---------------------------------------------------------------------------
// The teacher fee permission.
//
// teacher_permissions.can_view_fees shipped in the init migration and was read by
// nothing for eleven migrations: stored, defaulted false, rendered as a checkbox on
// the owner's teacher form, and named in the comment above the fee policies — which
// claimed "the app checks it before querying". Nothing checked it. Ticking the box
// granted a teacher exactly nothing. 20260811000012 is the policy that makes it
// mean something, and this section is what stops it going quiet again.
//
// Every pair here has the shape of the deactivation section above: assert the open
// door before the shut one. "Karim sees no fees for Mim" is worth nothing unless
// somebody can see fees for Mim — a policy that returned zero rows to everyone
// would otherwise pass this whole section.
//
// Predicates on a named child rather than bare counts, wherever a bare count would
// do. The import section above leaves two extra students in Karim's own batch, so
// `count(*) from students` is not 1 here and an assertion written that way would
// have been read as a leak.
// ---------------------------------------------------------------------------

console.log('\nTeacher fee visibility (can_view_fees):')

// Mim is the control group: Nasrin's student, never Karim's. Her own invoice with
// money against it, so the zeros below had something to be non-zero about.
const invoiceMim = await one(
  `insert into fee_invoices
     (coaching_center_id, student_id, enrollment_id, period_month, amount_bdt, due_date)
   values ($1, $2, $3, '2026-02-01', 1200, '2026-02-10') returning id`,
  [centerA, stMim, eMim],
)

const payOn = (invoice, st, amount, method = 'cash') =>
  db.query(
    `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt, method)
     values ($1, $2, $3, $4, $5)`,
    [centerA, invoice, st, amount, method],
  )

await payOn(invoiceAli, stAli, 300, 'bkash')
await payOn(invoiceMim, stMim, 200)

// One chase on Ali's invoice: the row Karim must still not see even once the fees
// themselves have opened up.
await remind(db, invoiceAli, centerA)

// The row the owner's teacher form writes. `on conflict` so each flip below is one
// statement rather than a delete and an insert.
const feePerm = (value) =>
  db.query(
    `insert into teacher_permissions (teacher_id, coaching_center_id, can_view_fees)
     values ($1, $2, $3)
     on conflict (teacher_id) do update set can_view_fees = excluded.can_view_fees`,
    [tKarim, centerA, value],
  )

await asUser(db, ids.ownerA, async (tx) => {
  check(
    "the owner sees both children's invoices, so the zeros below mean something",
    (await n(tx, 'select count(*)::int as n from fee_invoices where student_id in ($1, $2)', [
      stAli,
      stMim,
    ])) === 2,
  )
  check(
    'and the money against both',
    (await n(tx, 'select count(*)::int as n from fee_payments where invoice_id in ($1, $2)', [
      invoiceAli,
      invoiceMim,
    ])) === 2,
  )
})

// No row at all is the state bootstrap_center leaves an owner's own teacher row in,
// and the state every teacher created before this migration is in. It has to read
// as no — the opposite of how can_send_sms reads the same absence, because that one
// would lock an owner out of their own marks sheet and this one is money.
await asUser(db, ids.karim, async (tx) => {
  check(
    'with no permissions row, a teacher sees no invoice for their own student',
    (await n(tx, 'select count(*)::int as n from fee_invoices where student_id = $1', [
      stAli,
    ])) === 0,
  )
  check(
    'and no payments',
    (await n(tx, 'select count(*)::int as n from fee_payments where invoice_id = $1', [
      invoiceAli,
    ])) === 0,
  )
})

await feePerm(false)
await asUser(db, ids.karim, async (tx) => {
  check(
    'with the box explicitly unticked, still nothing',
    (await n(tx, 'select count(*)::int as n from fee_invoices where student_id = $1', [
      stAli,
    ])) === 0,
  )
})

await feePerm(true)
await asUser(db, ids.karim, async (tx) => {
  check(
    'ticked: the teacher reads the invoice of a student they teach',
    (await n(tx, 'select count(*)::int as n from fee_invoices where student_id = $1', [
      stAli,
    ])) === 1,
  )
  check(
    "and not the invoice of a colleague's student in the same centre",
    (await n(tx, 'select count(*)::int as n from fee_invoices where student_id = $1', [
      stMim,
    ])) === 0,
  )

  // Through the view, which is what the board actually queries. It inner-joins
  // students under security_invoker, so this is also the assertion that the fee
  // policy and the student policy are scoped alike: had the fee policy been written
  // centre-wide, the join would have dropped Mim's row anyway and the total at the
  // top of the board would have been a subset calling itself the centre's.
  check(
    'the board row comes with the name, or the row is unreadable',
    (
      await tx.query('select student_name from fee_invoice_balances where id = $1', [
        invoiceAli,
      ])
    ).rows[0]?.student_name === 'Ali Hasan',
  )
  check(
    "and the colleague's row is not on the board",
    (await n(tx, 'select count(*)::int as n from fee_invoice_balances where id = $1', [
      invoiceMim,
    ])) === 0,
  )
  check(
    'so the whole board is their own batches and nothing else',
    (await n(tx, 'select count(*)::int as n from fee_invoice_balances')) === 1,
  )

  check(
    'the payments follow their invoice',
    (await n(tx, 'select count(*)::int as n from fee_payments where invoice_id = $1', [
      invoiceAli,
    ])) === 1,
  )
  check(
    'and stop at it',
    (await n(tx, 'select count(*)::int as n from fee_payments where invoice_id = $1', [
      invoiceMim,
    ])) === 0,
  )

  // What the box must NOT also grant. can_manage_students is a separate checkbox an
  // owner may well have left off, and a guardian's mobile number is not part of
  // "see fees" — so the fee policies match the student policy instead of widening
  // it, and these three are how that stays true.
  check(
    "seeing fees does not hand over a colleague's student",
    (await n(tx, 'select count(*)::int as n from students where id = $1', [stMim])) === 0,
  )
  check(
    'nor the guardian phone number of one',
    (await n(tx, 'select count(*)::int as n from guardians where student_id = $1', [
      stMim,
    ])) === 0,
  )
  check(
    'nor the record of who has been chased for money',
    (await n(tx, 'select count(*)::int as n from fee_reminders')) === 0,
  )
  check(
    'nor what the centre pays us',
    (await n(tx, 'select count(*)::int as n from subscriptions')) === 0,
  )
})

// Read, and only read. A teacher was already refused all three of these with no
// permissions row at all, higher up; what these assert is that ticking the box did
// not quietly grant them too.
check(
  'a teacher who can see fees still cannot record a payment',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt)
     values ($1, $2, $3, 500)`,
    [centerA, invoiceAli, stAli],
  ),
)
check(
  'nor raise an invoice',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
     values ($1, $2, '2026-03-01', 900, '2026-03-10')`,
    [centerA, stAli],
  ),
)
check(
  'nor log a reminder, even against the invoice they can now read',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into fee_reminders (coaching_center_id, invoice_id, channel, amount_bdt)
     values ($1, $2, 'sms', 800)`,
    [centerA, invoiceAli],
  ),
)

// UPDATE is the one that cannot be asserted with deniedAsUser, and it is the one
// that would cost the most. A reader who can SELECT a row and has no write policy
// gets no error from `update` — the row is filtered out and Postgres reports nought
// rows changed, which deniedAsUser reads as allowed. So the assertion is the stored
// number. Setting discount_bdt to the full 800 is a legal value that clears
// fee_invoices_discount_bound, which is the point: if the policy ever opened, a
// teacher would be writing off the owner's fees and nothing in the schema would
// stop them.
await asUser(db, ids.karim, async (tx) => {
  await tx.query('update fee_invoices set discount_bdt = 800 where id = $1', [invoiceAli])
})

// Deleting the payment used to belong in that transaction, silently changing
// nothing. 20260811000017 revoked DELETE on fee_payments from `authenticated`
// altogether — the receipt series counts from max() and a removed payment would
// let a used number be handed out again — so it is now a refusal rather than a
// no-op, which is why it moved out here.
check(
  'nor delete the payment on it',
  await deniedAsUser(db, ids.karim, 'delete from fee_payments where invoice_id = $1', [
    invoiceAli,
  ]),
)

const untouched = (
  await db.query(
    `select f.discount_bdt,
            (select count(*)::int from fee_payments p where p.invoice_id = f.id) as payments
     from fee_invoices f where f.id = $1`,
    [invoiceAli],
  )
).rows[0]
check(
  'a teacher cannot write the fee off, not even one they can read',
  Number(untouched.discount_bdt) === 0,
  `discount is now ${untouched.discount_bdt}`,
)
check(
  'and the payment is still on the record',
  untouched.payments === 1,
  `${untouched.payments} payment(s) left`,
)

// The grant is per teacher, not per centre. Nasrin teaches Mim and has no
// permissions row of her own, so ticking Karim's box must leave her board shut.
await asUser(db, ids.nasrin, async (tx) => {
  check(
    "one teacher's permission is not the centre's",
    (await n(tx, 'select count(*)::int as n from fee_invoices where student_id = $1', [
      stMim,
    ])) === 0,
  )
})

// Centre B's teacher, ticked, at his own centre. can_view_fees takes the centre as
// an argument and the policy passes the row's own tenant column into it; a version
// that had asked "is this caller a fee-reading teacher anywhere" would pass every
// assertion above and fail this one.
await db.query(
  `insert into teacher_permissions (teacher_id, coaching_center_id, can_view_fees)
   values ($1, $2, true)`,
  [tRahim, centerB],
)
await asUser(db, ids.rahim, async (tx) => {
  check(
    "a fee-reading teacher at centre B reads none of centre A's invoices",
    (await n(tx, 'select count(*)::int as n from fee_invoices')) === 0,
  )
  check(
    'and nothing at all through the board',
    (await n(tx, 'select count(*)::int as n from fee_invoice_balances')) === 0,
  )
})

// The two off switches, both of which the settings screen promises when an owner
// turns a teacher off. `teachers.active` is the flag; the membership is the second
// write toggleTeacherActive makes. Either has to be enough on its own, which is why
// can_view_fees ands is_member onto a query that already filters on teachers.active.
await db.query('update teachers set active = false where id = $1', [tKarim])
await asUser(db, ids.karim, async (tx) => {
  check(
    'deactivating a teacher closes the fee board along with everything else',
    (await n(tx, 'select count(*)::int as n from fee_invoices where student_id = $1', [
      stAli,
    ])) === 0,
  )
})
await db.query('update teachers set active = true where id = $1', [tKarim])

await db.query(
  `delete from center_members
   where coaching_center_id = $1 and user_id = $2 and role = 'teacher'`,
  [centerA, ids.karim],
)
await asUser(db, ids.karim, async (tx) => {
  check(
    'and revoking the membership closes it too, with the teacher row left active',
    (await n(tx, 'select count(*)::int as n from fee_invoices where student_id = $1', [
      stAli,
    ])) === 0,
  )
})
await addMember(centerA, ids.karim, 'teacher')

await asUser(db, ids.karim, async (tx) => {
  check(
    'putting both back reopens it, so neither zero above was a broken fixture',
    (await n(tx, 'select count(*)::int as n from fee_invoices where student_id = $1', [
      stAli,
    ])) === 1,
  )
})

// Leave the seed as found, permission included. Nothing below counts fee rows
// today; the next section added here will.
await db.query('delete from fee_payments where invoice_id in ($1, $2)', [
  invoiceAli,
  invoiceMim,
])
await db.query('delete from fee_reminders where invoice_id = $1', [invoiceAli])
await db.query('delete from fee_invoices where id = $1', [invoiceMim])
await db.query('delete from teacher_permissions where teacher_id in ($1, $2)', [
  tKarim,
  tRahim,
])

// ---------------------------------------------------------------------------
// The exam checkbox.
//
// teacher_permissions.can_manage_exams is the second of the five that did nothing.
// exams_teacher_write was one `for all` policy on app.teaches_batch, so unticking
// "Exams & marks" left a teacher creating exams and entering marks exactly as
// before. 20260811000013 splits it into read / insert / update / delete and ANDs
// the permission onto the last three.
//
// The split is the part worth testing. `for all` covers SELECT, so the obvious
// one-line version of this migration — AND the permission onto the existing policy
// — would have taken a teacher's own exams and their own students' marks off their
// screen. A teacher who may not enter marks is still the person standing in front
// of the class that got them. So every "refused" below is paired with a "still
// reads", and the read assertions are the ones that would fail if anyone ever
// collapses these four policies back into one.
// ---------------------------------------------------------------------------

console.log('\nTeacher exam permission (can_manage_exams):')

// Three exams of this section's own, all inserted by the migration role so that
// everything below is about the policy rather than about whether the fixture
// happened to be writable. Two on Karim's batch and one on Nasrin's.
//
// exam_results is unique on (exam_id, enrollment_id), which is why the refusals
// need somewhere fresh to aim: a second insert of a pair the seed already holds
// raises a unique violation, deniedAsUser cannot tell that apart from an RLS
// refusal, and the test would pass while the policy was wide open. examSpare and
// examTheirs exist so that every "refused" here is refused for its own reason.
const examMine = await one(
  `insert into exams (coaching_center_id, subject_id, batch_id, teacher_id, title, total_marks, exam_date)
   values ($1, $2, $3, $4, 'Bio Weekly 2', 50, current_date) returning id`,
  [centerA, sBio, bBioMorning, tKarim],
)
const examSpare = await one(
  `insert into exams (coaching_center_id, subject_id, batch_id, teacher_id, title, total_marks, exam_date)
   values ($1, $2, $3, $4, 'Bio Weekly 3', 50, current_date) returning id`,
  [centerA, sBio, bBioMorning, tKarim],
)
const examTheirs = await one(
  `insert into exams (coaching_center_id, subject_id, batch_id, teacher_id, title, total_marks, exam_date)
   values ($1, $2, $3, $4, 'Chem Weekly 2', 50, current_date) returning id`,
  [centerA, sChem, bChemEvening, tNasrin],
)

const examPerm = (value) =>
  db.query(
    `insert into teacher_permissions (teacher_id, coaching_center_id, can_manage_exams)
     values ($1, $2, $3)
     on conflict (teacher_id) do update set can_manage_exams = excluded.can_manage_exams`,
    [tKarim, centerA, value],
  )

const titleOf = async (exam) =>
  (await db.query('select title from exams where id = $1', [exam])).rows[0]?.title

const marksOn = async (exam) =>
  (await db.query('select count(*)::int as n from exam_results where exam_id = $1', [exam]))
    .rows[0].n

const namedExams = async (title) =>
  (await db.query('select count(*)::int as n from exams where title = $1', [title])).rows[0].n

// No permissions row at all, which is where every teacher created before this
// migration sits and where bootstrap_center leaves an owner's own teacher row.
// Allowed — the opposite of how can_view_fees reads the same absence, and not an
// inconsistency: that column defaults false and this one defaults true, so in both
// cases the absence agrees with the column and only the owner's explicit choice
// changes an answer.
await asUser(db, ids.karim, async (tx) => {
  await tx.query(
    `insert into exams (coaching_center_id, subject_id, batch_id, title, total_marks, exam_date)
     values ($1, $2, $3, 'Made With No Row', 50, current_date)`,
    [centerA, sBio, bBioMorning],
  )
  await tx.query(
    `insert into exam_results (coaching_center_id, exam_id, enrollment_id, obtained_marks)
     values ($1, $2, $3, 44)`,
    [centerA, examMine, eAli],
  )
})

check('with no permissions row a teacher can create an exam', (await namedExams('Made With No Row')) === 1)
check('and enter a mark on one', (await marksOn(examMine)) === 1)

await examPerm(true)
await asUser(db, ids.karim, async (tx) => {
  await tx.query(`update exams set title = 'Renamed While Ticked' where id = $1`, [examMine])
})
check(
  'ticked, the same teacher can rename their exam',
  (await titleOf(examMine)) === 'Renamed While Ticked',
  `title is now ${await titleOf(examMine)}`,
)

// The three refusals. INSERT is the only one deniedAsUser can see: a `with check`
// violation raises, where an UPDATE or DELETE that matches no policy touches nought
// rows and reports success. See the fee section for the same distinction.
await examPerm(false)

check(
  'unticked, the teacher cannot create an exam on the batch they teach',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into exams (coaching_center_id, subject_id, batch_id, title, total_marks, exam_date)
     values ($1, $2, $3, 'Made While Unticked', 50, current_date)`,
    [centerA, sBio, bBioMorning],
  ),
)
check('and no exam landed', (await namedExams('Made While Unticked')) === 0)

check(
  'nor enter a mark for a student they teach',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into exam_results (coaching_center_id, exam_id, enrollment_id, obtained_marks)
     values ($1, $2, $3, 12)`,
    [centerA, examSpare, eAli],
  ),
)
check('and no mark landed', (await marksOn(examSpare)) === 0)

// The two silent ones. A teacher can still SELECT both of these rows, so the
// statements below raise nothing at all — Postgres filters them out and reports
// nought rows changed, which deniedAsUser reads as allowed. The assertion is the
// stored value, and this is exactly the pair the marks sheet leans on: clearing a
// mark is a DELETE, so a saveMarks that trusted the policy alone would have told a
// teacher their correction was saved while the old number stayed in the row the
// result SMS reads.
await asUser(db, ids.karim, async (tx) => {
  await tx.query(`update exams set title = 'Renamed While Unticked' where id = $1`, [examMine])
  await tx.query('delete from exam_results where exam_id = $1', [examMine])
})

check(
  'unticked, the teacher cannot rename an exam they can read',
  (await titleOf(examMine)) === 'Renamed While Ticked',
  `title is now ${await titleOf(examMine)}`,
)
check(
  'nor clear a mark on it, which is the one the marks sheet depends on',
  (await marksOn(examMine)) === 1,
  `${await marksOn(examMine)} mark(s) left`,
)

// What the split exists for. Everything above is refused and all of this is still
// open, because a teacher who may not enter marks still has to read the marks that
// were entered for the class they teach.
await asUser(db, ids.karim, async (tx) => {
  check(
    'unticked, the teacher still reads their own exam',
    (await n(tx, 'select count(*)::int as n from exams where id = $1', [examMine])) === 1,
  )
  check(
    'and the marks already on it',
    (await n(tx, 'select count(*)::int as n from exam_results where exam_id = $1', [
      examMine,
    ])) === 1,
  )
  check(
    'and the exam list for their batch is not empty',
    (await n(tx, 'select count(*)::int as n from exams where batch_id = $1', [
      bBioMorning,
    ])) >= 2,
  )
})

// The permission is not a boundary on its own. app.can_manage_exams answers true
// for an owner, a student and a stranger; every policy pairs it with
// app.teaches_batch, and this is the assertion that says so — ticked, and still
// nothing of Nasrin's.
await examPerm(true)
check(
  'ticked does not widen: still no mark on a colleague-taught student',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into exam_results (coaching_center_id, exam_id, enrollment_id, obtained_marks)
     values ($1, $2, $3, 12)`,
    [centerA, examTheirs, eMim],
  ),
)
check('and none landed', (await marksOn(examTheirs)) === 0)
await asUser(db, ids.karim, async (tx) => {
  await tx.query(`update exams set title = 'Karim Was Here' where id = $1`, [examTheirs])
})
check(
  "nor a rename of a colleague's exam",
  (await titleOf(examTheirs)) === 'Chem Weekly 2',
  `title is now ${await titleOf(examTheirs)}`,
)

// Per teacher, not per centre. Nasrin has no permissions row of her own, so
// unticking Karim's box must leave her able to work.
await examPerm(false)
await asUser(db, ids.nasrin, async (tx) => {
  await tx.query(
    `insert into exams (coaching_center_id, subject_id, batch_id, title, total_marks, exam_date)
     values ($1, $2, $3, 'Nasrin Unaffected', 50, current_date)`,
    [centerA, sChem, bChemEvening],
  )
})
check(
  "one teacher's unticked box is not the centre's",
  (await namedExams('Nasrin Unaffected')) === 1,
)

// And the off switch still wins over the tick. teachers.active is deliberately not
// in app.can_manage_exams — app.teaches_batch already resolves only through active
// rows — so this is the assertion that says the omission is safe rather than merely
// intended.
await examPerm(true)
await db.query('update teachers set active = false where id = $1', [tKarim])
check(
  'a deactivated teacher cannot create an exam even with the box ticked',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into exams (coaching_center_id, subject_id, batch_id, title, total_marks, exam_date)
     values ($1, $2, $3, 'Made While Off', 50, current_date)`,
    [centerA, sBio, bBioMorning],
  ),
)
check('and none landed', (await namedExams('Made While Off')) === 0)
await db.query('update teachers set active = true where id = $1', [tKarim])

// Leave the seed as found. examBio keeps its one mark of 31 for Ali, which the
// student-edit assertions above already read; everything created here goes,
// marks first even though the exam cascade would take them anyway.
await db.query('delete from exam_results where exam_id = any($1)', [
  [examMine, examSpare, examTheirs],
])
await db.query('delete from exams where id = any($1)', [[examMine, examSpare, examTheirs]])
await db.query(`delete from exams where title in ('Made With No Row', 'Nasrin Unaffected')`)
await db.query('delete from teacher_permissions where teacher_id = $1', [tKarim])

// ---------------------------------------------------------------------------
// The last two checkboxes.
//
// can_manage_students and can_manage_batches are the fourth and fifth, and they
// were the two that did nothing at all — not narrowed by a policy that ignored
// them, like the exam box above, but simply unreferenced. `students` had one write
// policy on app.is_staff_admin and `batches` had one, every screen behind them asked
// requireRole('manager'), and a teacher ranks below a manager. So an owner ticking
// either box handed over exactly nothing while the label said otherwise.
//
// 20260811000019 adds SELECT and INSERT, and no more than that. The refusals below
// are therefore as much the point as the grants: no UPDATE and no DELETE on any of
// these five tables, because there is no edit-a-student and no edit-a-batch screen
// in this product for anybody, and a policy wider than any screen is a capability
// nobody chose to grant.
//
// An UPDATE or DELETE that matches no policy touches zero rows and raises nothing,
// so deniedAsUser cannot see it. Every such assertion here reads the stored value
// back instead. That is the failure mode that would let a `for all` slip in
// unnoticed — a passing deniedAsUser and a quietly rewritten row.
// ---------------------------------------------------------------------------

console.log('\nTeacher roster permissions (can_manage_students, can_manage_batches):')

/**
 * Set one box on Karim, clearing the other. Both columns default false, so passing
 * a single flag is enough to say "this one and not the other" — and the upsert
 * writes both every time so a leftover tick from the previous assertion cannot be
 * the reason the next one passes.
 */
const rosterPerm = (students, batches) =>
  db.query(
    `insert into teacher_permissions
       (teacher_id, coaching_center_id, can_manage_students, can_manage_batches)
     values ($1, $2, $3, $4)
     on conflict (teacher_id) do update set
       can_manage_students = excluded.can_manage_students,
       can_manage_batches  = excluded.can_manage_batches`,
    [tKarim, centerA, students, batches],
  )

const nameOf = async (student) =>
  (await db.query('select name from students where id = $1', [student])).rows[0]?.name

const batchesNamed = (name) =>
  countOf('select count(*)::int as n from batches where name = $1', [name])

// Counted as superuser, because the import section above deliberately leaves a
// register's worth of students at centre A. A hardcoded 2 here would break the day
// somebody adds a line to that paste — and it would be asserting the wrong thing
// anyway. What this permission grants is "the whole centre", so the whole centre is
// what gets counted.
const rosterA = await countOf(
  'select count(*)::int as n from students where coaching_center_id = $1',
  [centerA],
)
const guardiansA = await countOf(
  'select count(*)::int as n from guardians where coaching_center_id = $1',
  [centerA],
)
const enrolmentsA = await countOf(
  'select count(*)::int as n from enrollments where coaching_center_id = $1',
  [centerA],
)

// And Karim's own view, taken while he still has no permissions row: his batch, not
// the centre. Every "does not widen" assertion below compares against these.
const [karimSees, karimGuardians, karimEnrolments] = await asUser(
  db,
  ids.karim,
  async (tx) => [
    await n(tx, 'select count(*)::int as n from students'),
    await n(tx, 'select count(*)::int as n from guardians'),
    await n(tx, 'select count(*)::int as n from enrollments'),
  ],
)

// No permissions row, which is where every teacher created before this migration
// sits. Refused, and that is the column agreeing with itself: can_manage_students
// defaults false, so absence and an unticked box mean the same thing. The exam box
// reads the same absence the other way because it defaults true.
//
// Asserted as a strict inequality with a floor under it: `karimSees > 0` is there so
// this cannot pass because Karim can see nothing at all, which would make every
// comparison below vacuous.
check(
  'a teacher with no permissions row cannot read the whole roster',
  karimSees > 0 && karimSees < rosterA,
  `sees ${karimSees} of ${rosterA}`,
)
check(
  'a teacher with no permissions row cannot admit a student',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into students (coaching_center_id, name, guardian_phone)
     values ($1, 'No Row Admitted', '01799999999')`,
    [centerA],
  ),
)

// Ticked. The read is the whole centre and not the teacher's own batch, which is
// the widening this migration argues for at length: the roster screen *is* the
// list, and import_students deduplicates a pasted register against every name on
// it, so a keyhole view would re-add half the centre.
await rosterPerm(true, false)
await asUser(db, ids.karim, async (tx) => {
  check(
    'a permitted teacher reads every student at the centre',
    (await n(tx, 'select count(*)::int as n from students')) === rosterA,
    `expected ${rosterA}`,
  )
  check(
    'and still not the other centre’s',
    (await n(tx, 'select count(*)::int as n from students where coaching_center_id = $1', [
      centerB,
    ])) === 0,
  )
  check(
    'a permitted teacher reads the guardian rows behind them',
    (await n(tx, 'select count(*)::int as n from guardians')) === guardiansA &&
      guardiansA > karimGuardians,
    `expected ${guardiansA}, was ${karimGuardians}`,
  )
  check(
    'a permitted teacher reads every enrolment at the centre',
    (await n(tx, 'select count(*)::int as n from enrollments')) === enrolmentsA &&
      enrolmentsA > karimEnrolments,
    'the roster screen embeds these to name each student’s batches',
  )
})

// The whole admission, in the three statements createStudent runs — each with the
// `returning` that needs SELECT on the new row, which is the half of this migration
// that is easiest to leave out and looks like a broken form when it is missing.
await asUser(db, ids.karim, async (tx) => {
  const admitted = (
    await tx.query(
      `insert into students (coaching_center_id, name, guardian_phone)
       values ($1, 'Admitted By Karim', '01788888888') returning id`,
      [centerA],
    )
  ).rows[0].id
  check('a permitted teacher admits a student', Boolean(admitted))

  const guardian = (
    await tx.query(
      `insert into guardians (coaching_center_id, student_id, name, phone, is_primary)
       values ($1, $2, 'Admitted father', '01788888888', true) returning id`,
      [centerA, admitted],
    )
  ).rows[0].id
  check('and the guardian row that makes the parent reachable', Boolean(guardian))

  const enrolment = (
    await tx.query(
      `insert into enrollments (coaching_center_id, student_id, subject_id, batch_id)
       values ($1, $2, $3, $4) returning id`,
      [centerA, admitted, sChem, bChemEvening],
    )
  ).rows[0].id
  check(
    'and enrols them into a batch they do not teach themselves',
    Boolean(enrolment),
    'admissions is not scoped to your own classes',
  )
})

// import_students, which is how a centre's register actually arrives. security
// invoker, so this is the same grant doing the work — and it exercises the
// centre-wide read in the one place where a narrow one would silently duplicate.
await asUser(db, ids.karim, async (tx) => {
  const { rows } = await tx.query(
    `select * from import_students($1, $2::jsonb, $3::uuid[])`,
    [
      centerA,
      JSON.stringify([
        { name: 'Imported One', guardian_phone: '01766666661' },
        { name: 'Mim Akter', guardian_phone: '01700000000' },
      ]),
      [bChemEvening],
    ],
  )
  check('a permitted teacher can import a register', rows[0].added === 1, JSON.stringify(rows[0]))
  check(
    'and the centre-wide read is what skips a name already on it',
    rows[0].already_there === 1,
    'Mim is in the seed with that number; a batch-scoped read would re-add her',
  )
  check('and the new name is enrolled', rows[0].enrolled === 1)
})

// Not an editor. Both of these match no policy, so both change nothing and raise
// nothing — the stored value is the only witness.
await asUser(db, ids.karim, (tx) =>
  tx.query(`update students set guardian_phone = '01700000009' where id = $1`, [stMim]),
)
check(
  'a permitted teacher cannot change a guardian’s number',
  (
    await db.query('select guardian_phone from students where id = $1', [stMim])
  ).rows[0].guardian_phone === '01700000000',
  'the label used to promise exactly this; the screen never existed',
)
await asUser(db, ids.karim, (tx) =>
  tx.query('update students set name = $1 where id = $2', ['Renamed By Karim', stMim]),
)
check(
  'a permitted teacher cannot rename a student',
  (await nameOf(stMim)) === 'Mim Akter',
)
await asUser(db, ids.karim, (tx) =>
  tx.query('delete from students where id = $1', [stMim]),
)
check('a permitted teacher cannot delete a student', (await nameOf(stMim)) === 'Mim Akter')

// One box is one box. Admissions does not carry batch creation.
check(
  'the students box does not open a batch',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into batches (coaching_center_id, subject_id, name, monthly_fee_bdt)
     values ($1, $2, 'Opened By Students Box', 700)`,
    [centerA, sBio],
  ),
)
check('and none landed', (await batchesNamed('Opened By Students Box')) === 0)

// The other box, on its own. A batch and its schedule, which createBatch writes in
// the same submit — a batch without its schedule rows is a batch that meets every
// day, which is the register showing a teacher an empty room.
await rosterPerm(false, true)
await asUser(db, ids.karim, async (tx) => {
  const opened = (
    await tx.query(
      `insert into batches (coaching_center_id, subject_id, name, slot, start_time, end_time, monthly_fee_bdt)
       values ($1, $2, 'Opened By Karim', 'afternoon', '15:00', '16:30', 900) returning id`,
      [centerA, sBio],
    )
  ).rows[0].id
  check('a permitted teacher opens a batch', Boolean(opened))

  await tx.query(
    `insert into batch_schedules (coaching_center_id, batch_id, day_of_week, start_time, end_time)
     values ($1, $2, 3, '15:00', '16:30')`,
    [centerA, opened],
  )
  check(
    'and writes the days it meets',
    (await n(tx, 'select count(*)::int as n from batch_schedules where batch_id = $1', [
      opened,
    ])) === 1,
  )
})

// And it grants nothing on the roster, which is what keeps the two boxes separate.
// The settings/batches screen leans on exactly this: it draws a headcount per batch
// only when the reader also holds the students box, because otherwise the column
// would read "0" beside every batch in the centre.
//
// Back to the same two numbers as before any box was ticked — which holds because
// the student admitted above went into Nasrin's batch, the point the assertion two
// blocks up makes on purpose.
await asUser(db, ids.karim, async (tx) => {
  check(
    'the batches box does not widen the roster',
    (await n(tx, 'select count(*)::int as n from students')) === karimSees,
    `back to his own ${karimSees}`,
  )
  check(
    'nor the enrolments behind it',
    (await n(tx, 'select count(*)::int as n from enrollments')) === karimEnrolments,
  )
})
check(
  'the batches box does not admit a student',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into students (coaching_center_id, name, guardian_phone)
     values ($1, 'Admitted By Batches Box', '01755555555')`,
    [centerA],
  ),
)
check('and none landed', (await namedAnywhere('Admitted By Batches Box')) === 0)

// Not an editor here either. batches_member_read means Karim can see this batch;
// seeing it is not moving its time.
//
// 15:30 rather than a later hour on purpose: batches_time_order would reject
// anything past 16:30, so a version of this that granted UPDATE would raise on the
// constraint and leave the row unchanged — and this assertion would pass for the
// wrong reason. A legal time makes the readback the only thing standing in the way.
await asUser(db, ids.karim, (tx) =>
  tx.query(`update batches set start_time = '15:30' where name = 'Opened By Karim'`),
)
check(
  'a permitted teacher cannot move a batch’s time',
  (await n(
    db,
    `select count(*)::int as n from batches
     where name = 'Opened By Karim' and start_time = time '15:00'`,
  )) === 1,
  'the label used to promise this too',
)

// The tenant boundary, which no checkbox crosses. Rahim's box is ticked at centre
// B; app.can_manage_students takes the centre as an argument and ANDs is_member on
// top, so both halves have to be his own.
await db.query(
  `insert into teacher_permissions
     (teacher_id, coaching_center_id, can_manage_students, can_manage_batches)
   values ($1, $2, true, true)
   on conflict (teacher_id) do update set
     can_manage_students = true, can_manage_batches = true`,
  [tRahim, centerB],
)
await asUser(db, ids.rahim, async (tx) => {
  check(
    'a permitted teacher at B reads none of A’s students',
    (await n(tx, 'select count(*)::int as n from students where coaching_center_id = $1', [
      centerA,
    ])) === 0,
  )
})
check(
  'a permitted teacher at B cannot admit into A',
  await deniedAsUser(
    db,
    ids.rahim,
    `insert into students (coaching_center_id, name, guardian_phone)
     values ($1, 'Admitted Across Centres', '01744444444')`,
    [centerA],
  ),
)
check('and none landed', (await namedAnywhere('Admitted Across Centres')) === 0)
check(
  'a permitted teacher at B cannot open a batch in A',
  await deniedAsUser(
    db,
    ids.rahim,
    `insert into batches (coaching_center_id, subject_id, name, monthly_fee_bdt)
     values ($1, $2, 'Opened Across Centres', 700)`,
    [centerA, sBio],
  ),
)
check('and none landed', (await batchesNamed('Opened Across Centres')) === 0)

// Per teacher, not per centre. Nasrin teaches at A alongside Karim and has no
// permissions row of her own, so Karim's ticks must not reach her.
const nasrinSees = await asUser(db, ids.nasrin, (tx) =>
  n(tx, 'select count(*)::int as n from students'),
)
await rosterPerm(true, true)
await asUser(db, ids.nasrin, async (tx) => {
  check(
    'one teacher’s ticked box is not the centre’s',
    (await n(tx, 'select count(*)::int as n from students')) === nasrinSees &&
      nasrinSees < rosterA,
    `still her own ${nasrinSees} of ${rosterA}`,
  )
})
check(
  'and it does not let her admit either',
  await deniedAsUser(
    db,
    ids.nasrin,
    `insert into students (coaching_center_id, name, guardian_phone)
     values ($1, 'Admitted By Nasrin', '01733333333')`,
    [centerA],
  ),
)

// The off switch wins over both ticks. Unlike app.can_manage_exams, these two check
// teachers.active themselves — there is no app.teaches_batch alongside them to do it
// — so this is the assertion that says the column is actually being read.
await db.query('update teachers set active = false where id = $1', [tKarim])
await asUser(db, ids.karim, async (tx) => {
  check(
    'a deactivated teacher reads no roster even with the box ticked',
    (await n(tx, 'select count(*)::int as n from students')) === 0,
    'app.my_taught_student_ids resolves through active rows too',
  )
})
check(
  'a deactivated teacher cannot admit a student even with the box ticked',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into students (coaching_center_id, name, guardian_phone)
     values ($1, 'Admitted While Off', '01722222222')`,
    [centerA],
  ),
)
check('and none landed', (await namedAnywhere('Admitted While Off')) === 0)
check(
  'a deactivated teacher cannot open a batch even with the box ticked',
  await deniedAsUser(
    db,
    ids.karim,
    `insert into batches (coaching_center_id, subject_id, name, monthly_fee_bdt)
     values ($1, $2, 'Opened While Off', 700)`,
    [centerA, sBio],
  ),
)
check('and none landed', (await batchesNamed('Opened While Off')) === 0)
await db.query('update teachers set active = true where id = $1', [tKarim])

// A member who is not a teacher at all. center_members says student, and the
// helpers are `exists` over teachers — no row, no grant, whatever any checkbox
// anywhere says.
check(
  'a student member cannot admit a student',
  await deniedAsUser(
    db,
    ids.studentUser,
    `insert into students (coaching_center_id, name, guardian_phone)
     values ($1, 'Admitted By A Student', '01711000000')`,
    [centerA],
  ),
)
check('and none landed', (await namedAnywhere('Admitted By A Student')) === 0)

// Leave the seed as found: three students, one guardian and one batch created here,
// plus both permissions rows. Students go last of the three because guardians and
// enrollments cascade off them, and the batch after its schedule for the same
// reason — explicit rather than relying on the cascade, so a schema change that
// drops one does not quietly leave rows behind for the next section to count.
await db.query(
  `delete from enrollments where student_id in
     (select id from students where name in ('Admitted By Karim', 'Imported One'))`,
)
await db.query(
  `delete from guardians where student_id in
     (select id from students where name in ('Admitted By Karim', 'Imported One'))`,
)
await db.query(
  `delete from students where name in ('Admitted By Karim', 'Imported One')`,
)
await db.query(
  `delete from batch_schedules where batch_id in
     (select id from batches where name = 'Opened By Karim')`,
)
await db.query(`delete from batches where name = 'Opened By Karim'`)
await db.query('delete from teacher_permissions where teacher_id = any($1)', [
  [tKarim, tRahim],
])

console.log('\nAt-risk students (student_risk arithmetic and reach):')

/*
 * One fixture student per arm of the view, because the arms are what break.
 *
 * Each of the three signals has two ways to fire — a level and a fall — and a
 * minimum below which it must stay quiet. That is nine behaviours, and a test
 * built on one student showing "at risk" proves none of them: a view that
 * flagged everybody would pass it. So every student below is aimed at exactly one
 * arm, with the other two arms deliberately clean, and each is asserted by name.
 *
 * Asserted by name and never by a count of the view, on purpose. Ali and Mim have
 * been accumulating attendance, marks, invoices, payments and reminders through
 * fourteen sections of this file, and whether either of them lands on this
 * worklist depends on which day of which month the suite runs. A total is a test
 * that goes red in February for a reason nobody can find.
 *
 * A dedicated batch, so session dates can be stated relative to today without
 * colliding with the rate section's fixtures — attendance_sessions is unique on
 * (batch_id, session_date).
 */
const bRisk = await one(
  `insert into batches (coaching_center_id, subject_id, teacher_id, name, slot)
   values ($1, $2, $3, 'Risk Fixture Batch', 'morning') returning id`,
  [centerA, sBio, tKarim],
)

// Sixteen sessions: eight inside the 30-day window, eight in the 30 before it.
// The view's boundary is `> today - 30`, so day 30 belongs to the prior window
// and the fixture stays clear of it in both directions.
const RECENT_DAYS = [2, 4, 6, 8, 10, 12, 14, 16]
const PRIOR_DAYS = [32, 34, 36, 38, 40, 42, 44, 46]

const sessionOn = (daysBack) =>
  one(
    `insert into attendance_sessions (coaching_center_id, batch_id, session_date)
     values ($1, $2, current_date - $3::int) returning id`,
    [centerA, bRisk, daysBack],
  )

const recentSessions = []
for (const day of RECENT_DAYS) recentSessions.push(await sessionOn(day))
const priorSessions = []
for (const day of PRIOR_DAYS) priorSessions.push(await sessionOn(day))

const riskStudent = async (name, status = 'active') => {
  const id = await one(
    `insert into students (coaching_center_id, name, status, guardian_phone)
     values ($1, $2, $3::student_status, '01799000000') returning id`,
    [centerA, name, status],
  )
  return { id, enrollment: await enroll(centerA, id, sBio, bRisk) }
}

/**
 * Marks the first `present` of `sessions` as attended and the rest absent.
 *
 * Present rather than late for the attended ones, and absent rather than excused
 * for the others, because this view's job is not to re-decide what counts as
 * attendance — batch_attendance_monthly settled that and its own section proves
 * it. Here the only question is what the percentage does to the flag.
 */
const attend = async (enrollment, sessions, present) => {
  for (const [i, session] of sessions.entries()) {
    await mark(centerA, session, enrollment, i < present ? 'present' : 'absent')
  }
}

// 2 of 8 recently, 2 of 8 before: 25% both windows. The level arm fires and the
// fall arm cannot, because nothing fell.
const rina = await riskStudent('Rina Level')
await attend(rina.enrollment, recentSessions, 2)
await attend(rina.enrollment, priorSessions, 2)

// 6 of 8 recently against 8 of 8 before: 75%, down 25 points. The mirror image —
// 75% is above the 70% floor, so only the fall arm can produce this flag. This is
// the assertion that would fail if anyone ever "simplified" the view to a
// threshold on the recent rate alone.
const sumon = await riskStudent('Sumon Falling')
await attend(sumon.enrollment, recentSessions, 6)
await attend(sumon.enrollment, priorSessions, 8)

// 0 of 3 — worse than everyone above, and deliberately not flagged. Three marks
// is not a measurement, and a view that flagged this would put a student who
// missed one week of a twice-weekly batch on the same list as one who has stopped
// coming. Carries one exam absence too, for the same reason: one is not two.
const shanto = await riskStudent('Shanto Too Few')
await attend(shanto.enrollment, recentSessions.slice(0, 3), 0)

// Attendance perfect in both windows, so anything that flags these four is
// coming from the marks or fee arm and not leaking in from attendance.
const tanu = await riskStudent('Tanu Low Mark')
const mukti = await riskStudent('Mukti Falling Mark')
const joy = await riskStudent('Joy Missed Exams')
for (const s of [tanu, mukti, joy]) {
  await attend(s.enrollment, recentSessions, 8)
  await attend(s.enrollment, priorSessions, 8)
}

// Three exams with three different totals, so a view comparing raw marks instead
// of percentages gets a different answer from every one of them.
const riskExam = (title, daysBack, total) =>
  one(
    `insert into exams (coaching_center_id, subject_id, batch_id, teacher_id,
                        title, total_marks, exam_date)
     values ($1, $2, $3, $4, $5, $6, current_date - $7::int) returning id`,
    [centerA, sBio, bRisk, tKarim, title, total, daysBack],
  )

const examFirst = await riskExam('Risk Exam One', 90, 100)
const examSecond = await riskExam('Risk Exam Two', 45, 50)
const examLatest = await riskExam('Risk Exam Three', 5, 100)

const scored = (exam, enrollment, obtained) =>
  db.query(
    `insert into exam_results (coaching_center_id, exam_id, enrollment_id, obtained_marks)
     values ($1, $2, $3, $4)`,
    [centerA, exam, enrollment, obtained],
  )

const skipped = (exam, enrollment) =>
  db.query(
    `insert into exam_results (coaching_center_id, exam_id, enrollment_id, is_absent)
     values ($1, $2, $3, true)`,
    [centerA, exam, enrollment],
  )

// One mark, 30 out of 100. Under the pass line, with no earlier exam to have
// fallen from — the level arm alone.
await scored(examLatest, tanu.enrollment, 30)

// 80% then 90%, then 65%. The average of the earlier two is 85 and the fall is
// 20 points, so the trend arm fires; 65% is comfortably above the 40% floor, so
// the level arm cannot be what did it. Note the second exam is out of 50: a view
// averaging raw marks would read 80, 45, 65 and see a *rise*.
await scored(examFirst, mukti.enrollment, 80)
await scored(examSecond, mukti.enrollment, 45)
await scored(examLatest, mukti.enrollment, 65)

// Sat the first, missed the next two. Missing exams is its own signal and is
// never averaged as a zero — his one real mark is a 90%, which is what makes this
// student the test of that: a view scoring absences as nought would flag him on
// the trend arm instead and read his ability as 30%.
await scored(examFirst, joy.enrollment, 90)
await skipped(examSecond, joy.enrollment)
await skipped(examLatest, joy.enrollment)

// One missed exam for Shanto, who must still stay off the list.
await skipped(examLatest, shanto.enrollment)

/**
 * One invoice for one risk fixture, aged by its due date.
 *
 * `period_month` is derived from the due date because that is what a real bill
 * looks like — a month's fee, due in the first days of the next one — and the view
 * never reads it: the fee arm keys on `due_date`, `voided_at` and what is still
 * owed. It exists here only to satisfy the one-bill-per-enrollment-per-month
 * constraint.
 *
 * WHICH IS WHY `periodMonthsBack` EXISTS. Two invoices for the same enrollment
 * must land in different months, and deriving both from a due date makes that an
 * accident of arithmetic rather than a fact. Kabir's pair used to be 20 and 21
 * days back, which straddles a month boundary on exactly one day of the month —
 * the day they were written — and collided on the other thirty. So a second
 * invoice states its month explicitly and the reader can see that it differs.
 */
const riskInvoice = async (student, enrollment, dueDaysBack, amount, opts = {}) => {
  const id = await one(
    `insert into fee_invoices (coaching_center_id, student_id, enrollment_id,
                              period_month, amount_bdt, due_date, voided_at)
     values ($1, $2, $3,
             (date_trunc('month', (current_date - $4::int)::timestamp)
               - make_interval(months => $7::int))::date,
             $5, current_date - $4::int, $6)
     returning id`,
    [
      centerA,
      student,
      enrollment,
      dueDaysBack,
      amount,
      opts.voided ? new Date().toISOString() : null,
      opts.periodMonthsBack ?? 0,
    ],
  )
  if (opts.paid) {
    await db.query(
      `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt, method)
       values ($1, $2, $3, $4, 'cash')`,
      [centerA, id, student, opts.paid],
    )
  }
  return id
}

// Ten days past due and unpaid. Attendance and marks untouched — she is never
// marked and never sat an exam, which is also the case that proves a student with
// no attendance record at all does not flag on attendance: null is not below 70.
const faria = await riskStudent('Faria Late Fee')
await riskInvoice(faria.id, faria.enrollment, 10, 500)

// Three days past due, which the reminder engine does not call late either. A
// centre collects through the first week of the month; flagging this would put
// every family on the list every month.
const nabila = await riskStudent('Nabila Just Late')
await riskInvoice(nabila.id, nabila.enrollment, 3, 500)

// Twenty days past due, and settled. Plus a second, voided, invoice a month
// earlier at a similar age. Both are the kind of row that shows the money as
// still owed if the view forgets a predicate, and both must leave this student
// off the list entirely. The second is put a month back explicitly, so the two
// bills never share a (enrollment, period_month) whatever day the suite runs.
const kabir = await riskStudent('Kabir Settled')
await riskInvoice(kabir.id, kabir.enrollment, 20, 500, { paid: 500 })
await riskInvoice(kabir.id, kabir.enrollment, 21, 700, { voided: true, periodMonthsBack: 1 })

// All three at once, which is the row an owner should phone about today.
const rifat = await riskStudent('Rifat Everything')
await attend(rifat.enrollment, recentSessions, 1)
await scored(examLatest, rifat.enrollment, 20)
await riskInvoice(rifat.id, rifat.enrollment, 20, 1200)

// Everything wrong and already gone. A dropped student is not at risk of leaving.
const gone = await riskStudent('Gone Already', 'dropped')
await attend(gone.enrollment, recentSessions, 0)
await riskInvoice(gone.id, gone.enrollment, 40, 900)

// Centre B gets a risky student of its own, so a cross-tenant leak reads as a row
// rather than as the absence of one.
await db.query(
  `insert into fee_invoices (coaching_center_id, student_id, enrollment_id,
                            period_month, amount_bdt, due_date)
   values ($1, $2, $3, date_trunc('month', (current_date - 30)::timestamp)::date, 600,
           current_date - 30)`,
  [centerB, stB, eB],
)

const riskRow = async (tx, student) =>
  (
    await tx.query(
      `select signals, attendance_flag, marks_flag, fee_flag,
              att_low, att_fell, marks_low, marks_fell, marks_missed,
              att_marks, att_pct, att_prev_marks, att_prev_pct,
              marks_pct, marks_prev_pct, marks_prev_n, exams_missed,
              fee_days_late, fee_owed_bdt, student_name
       from student_risk where student_id = $1`,
      [student],
    )
  ).rows[0] ?? null

await asUser(db, ids.ownerA, async (tx) => {
  const r = await riskRow(tx, rina.id)
  check(
    'a quarter of classes attended flags on the level alone',
    r?.attendance_flag === true && r?.marks_flag === false && r?.fee_flag === false
      && Number(r?.signals) === 1,
    JSON.stringify(r),
  )
  check(
    'and it says which arm fired, so the screen picks the sentence rather than guessing',
    r?.att_low === true && r?.att_fell === false,
    JSON.stringify(r),
  )
  check(
    'and the figures behind it travel with the row, so the screen can say why',
    Number(r?.att_pct) === 25 && Number(r?.att_marks) === 8
      && Number(r?.att_prev_pct) === 25 && Number(r?.att_prev_marks) === 8,
    `${r?.att_pct}% of ${r?.att_marks}, was ${r?.att_prev_pct}% of ${r?.att_prev_marks}`,
  )

  const s = await riskRow(tx, sumon.id)
  check(
    '75% is above the floor and still flags, because it fell 25 points',
    s?.attendance_flag === true && Number(s?.att_pct) === 75
      && Number(s?.att_prev_pct) === 100,
    JSON.stringify(s),
  )
  check(
    'and only the fall arm claims it, so the sentence carries both months',
    s?.att_fell === true && s?.att_low === false,
    JSON.stringify(s),
  )

  check(
    'three marks and one missed exam are not enough to flag anybody',
    (await riskRow(tx, shanto.id)) === null,
  )

  const t = await riskRow(tx, tanu.id)
  check(
    '30% in the only exam sat flags on marks and not on attendance',
    t?.marks_flag === true && t?.attendance_flag === false
      && Number(t?.marks_pct) === 30 && Number(t?.marks_prev_n) === 0,
    JSON.stringify(t),
  )
  check(
    'on the level arm alone, because one exam cannot be a trend',
    t?.marks_low === true && t?.marks_fell === false && t?.marks_missed === false,
    JSON.stringify(t),
  )

  const m = await riskRow(tx, mukti.id)
  check(
    '65% after an 85% average flags on the fall, out of a different total each time',
    m?.marks_flag === true && Number(m?.marks_pct) === 65
      && Number(m?.marks_prev_pct) === 85 && Number(m?.marks_prev_n) === 2,
    JSON.stringify(m),
  )
  check(
    'and on the fall arm alone — 65% is a fine mark, the drop is the story',
    m?.marks_fell === true && m?.marks_low === false,
    JSON.stringify(m),
  )

  const j = await riskRow(tx, joy.id)
  check(
    'two missed exams flag on their own, and are not averaged in as zeroes',
    j?.marks_flag === true && Number(j?.exams_missed) === 2
      && Number(j?.marks_pct) === 90,
    JSON.stringify(j),
  )
  check(
    'on the missed arm only, so the screen never writes "90%" as a complaint',
    j?.marks_missed === true && j?.marks_low === false && j?.marks_fell === false,
    JSON.stringify(j),
  )

  const f = await riskRow(tx, faria.id)
  check(
    'a fee ten days past due flags, and no attendance record is not 0% attendance',
    f?.fee_flag === true && f?.attendance_flag === false
      && Number(f?.fee_days_late) === 10 && Number(f?.fee_owed_bdt) === 500,
    JSON.stringify(f),
  )

  check(
    'three days past due is not late, here or in the reminder engine',
    (await riskRow(tx, nabila.id)) === null,
  )
  check(
    'a settled invoice and a voided one leave a student off the list',
    (await riskRow(tx, kabir.id)) === null,
  )
  check(
    'a dropped student is not at risk of leaving',
    (await riskRow(tx, gone.id)) === null,
  )

  const all = await riskRow(tx, rifat.id)
  check(
    'all three signals count up rather than collapsing into one flag',
    Number(all?.signals) === 3 && all?.attendance_flag === true
      && all?.marks_flag === true && all?.fee_flag === true,
    JSON.stringify(all),
  )

  // Bounded above by construction, so this stays honest whatever Ali and Mim have
  // accumulated by the day the suite runs. It is worth asserting because the arms
  // outnumber the signals: five booleans OR down to three, and adding them instead
  // would let one student drifting in a single way outrank one drifting in all
  // three — and it would put riskLevel's 'call' on a student who does not need one.
  check(
    'the arms fold back into three signals however many of them fired',
    (await n(
      tx,
      'select count(*)::int as n from student_risk where signals < 1 or signals > 3',
    )) === 0,
  )

  check(
    "owner A sees no part of centre B's worklist",
    (await n(
      tx,
      'select count(*)::int as n from student_risk where coaching_center_id = $1',
      [centerB],
    )) === 0,
  )
})

await asUser(db, ids.ownerB, async (tx) => {
  check(
    'owner B sees their own late-paying student',
    (await riskRow(tx, stB)) !== null,
  )
  check(
    "and none of centre A's, though nine of them are flagged",
    (await n(
      tx,
      'select count(*)::int as n from student_risk where coaching_center_id = $1',
      [centerA],
    )) === 0,
  )
})

// The predicate the view carries itself, and the reason it does. A teacher's own
// RLS would let some rows through — their batch's attendance, their subject's
// marks — and the aggregate would come out as a fraction of each student's real
// picture wearing the whole picture's name.
await asUser(db, ids.karim, async (tx) => {
  check(
    'a teacher reads nothing from the worklist, not a narrowed version of it',
    (await n(tx, 'select count(*)::int as n from student_risk')) === 0,
  )
})

await asUser(db, ids.studentUser, async (tx) => {
  check(
    'a student cannot read the file the centre keeps on them',
    (await n(tx, 'select count(*)::int as n from student_risk')) === 0,
  )
})

// ---------------------------------------------------------------------------
// The SMS delivery worker — claim, settle, cancel, reap.
//
// This is the first code in the product that spends and un-spends credits
// without a person in the room, so the questions are different from every other
// section above. Not "can centre A see centre B's rows" — the claim is
// deliberately global, because one cron drains everybody's queue — but:
//
//   * can anything holding a cookie call these at all? A browser session that
//     could reach finish_sms could mark a message sent that never went, which is
//     the one lie this product must not be able to tell, and could mint itself
//     credits one refunded row at a time.
//   * does a message get claimed exactly once?
//   * when a message is given up on, do the credits come back — to the right
//     centre, with a ledger row explaining them?
//
// What this cannot test: two workers racing. PGlite is a single connection, so
// `for update skip locked` has nothing to skip. The assertions below check the
// sequential half of the claim (a claimed row is not claimable again), which is
// what a retried cron invocation does; the concurrent half rests on the lock
// clause being in the same statement as the status change.
// ---------------------------------------------------------------------------

console.log('\nSMS delivery worker (claim, settle, cancel, reap):')

// The queue is global by design, so the test needs a known one. Earlier sections
// left rows behind; nothing after this reads them.
await db.query('delete from sms_logs')
await db.query('delete from sms_credit_ledger')

/**
 * A statement as the worker runs it.
 *
 * `set role` at session level rather than `set local role` inside a transaction,
 * because a claim has to COMMIT before the next assertion asks whether the row
 * is claimable again — a claim rolled back at the end of the test's transaction
 * would prove nothing about a second cron tick.
 */
const asService = async (sql, params = []) => {
  await db.exec('set role service_role;')
  try {
    return await db.query(sql, params)
  } finally {
    await db.exec('reset role;')
  }
}

const queueSms = (center, student, cost = 2) =>
  one(
    `insert into sms_logs
       (coaching_center_id, student_id, to_phone, kind, body, credit_cost)
     values ($1, $2, '+8801711111111', 'exam_result', 'ফলাফল', $3)
     returning id`,
    [center, student, cost],
  )

const logRow = async (id) =>
  (
    await db.query(
      `select status::text as status, attempts, error, provider_ref,
              sent_at is not null as has_sent_at,
              claimed_at is not null as has_claimed_at,
              retry_after > now() as backing_off
         from sms_logs where id = $1`,
      [id],
    )
  ).rows[0]

const creditsOf = async (center) =>
  (
    await db.query('select sms_credit_balance from coaching_centers where id = $1', [
      center,
    ])
  ).rows[0].sms_credit_balance

// --- The fence, before anything else -------------------------------------

const workerFunctions = [
  'claim_sms_batch',
  'finish_sms',
  'cancel_opted_out_sms',
  'reap_stranded_sms',
]

// The schema-wide anon check above catches a function the browser can reach with
// no session. This is the other half: `authenticated` is handed EXECUTE by
// Supabase's default privileges at creation time exactly as anon is, so a
// migration that revokes PUBLIC and grants service_role has closed nothing.
const signedInCallable = (
  await db.query(
    `select p.proname as name
     from pg_proc p
     join pg_namespace nsp on nsp.oid = p.pronamespace and nsp.nspname = 'public'
     join aclexplode(p.proacl) a on a.privilege_type = 'EXECUTE'
     where p.proname = any($1)
       and a.grantee::regrole::text in ('authenticated', 'anon')
     order by 1`,
    [workerFunctions],
  )
).rows.map((r) => r.name)
check(
  'no worker function is callable by a signed-in browser session',
  signedInCallable.length === 0,
  signedInCallable.join(', '),
)

check(
  'every worker function is callable by the server',
  (
    await db.query(
      `select count(distinct p.proname)::int as n
         from pg_proc p
         join pg_namespace nsp on nsp.oid = p.pronamespace and nsp.nspname = 'public'
         join aclexplode(p.proacl) a on a.privilege_type = 'EXECUTE'
        where p.proname = any($1) and a.grantee::regrole::text = 'service_role'`,
      [workerFunctions],
    )
  ).rows[0].n === workerFunctions.length,
)

check(
  'the refund helper is not reachable through PostgREST at all',
  (
    await db.query(
      `select count(*)::int as n from pg_proc p
       join pg_namespace nsp on nsp.oid = p.pronamespace
       where p.proname = 'refund_sms' and nsp.nspname = 'app'`,
    )
  ).rows[0].n === 1,
)

// And down the path a real request takes, not only through the catalogue.
const oldest = await queueSms(centerA, stAli)
check(
  'an owner cannot claim their own centre’s queue',
  await deniedAsUser(db, ids.ownerA, 'select * from claim_sms_batch(10)'),
)
check(
  'an owner cannot mark a message sent',
  await deniedAsUser(db, ids.ownerA, 'select finish_sms($1, true, $2)', [
    oldest,
    'forged',
  ]),
)
check(
  'an owner cannot trigger the refund path',
  await deniedAsUser(db, ids.ownerA, 'select cancel_opted_out_sms()'),
)
check(
  'a teacher cannot either',
  await deniedAsUser(db, ids.karim, 'select * from claim_sms_batch(10)'),
)
check(
  'and the message they were refused is untouched',
  (await logRow(oldest)).status === 'queued',
)

// --- Claiming happens once ------------------------------------------------

const second = await queueSms(centerA, stAli)
const third = await queueSms(centerA, stMim)

const firstBatch = (await asService('select * from claim_sms_batch(2)')).rows
check(
  'the worker claims exactly the batch size it asked for',
  firstBatch.length === 2,
  `got ${firstBatch.length}`,
)
// The set, not the sequence. `returning` from an `update ... where id in (select
// ... order by queued_at)` follows whatever order the planner updates rows in, so
// asserting firstBatch[0].id would be asserting a coincidence — it failed once
// and passed once on the same code. What the ordering promises is which rows get
// taken, which is what a centre that queued forty messages this morning cares
// about; the worker itself never looks at the order they arrive in.
check(
  'oldest first, so a queue drains in the order it filled',
  [oldest, second].every((id) => firstBatch.some((r) => r.id === id)) &&
    !firstBatch.some((r) => r.id === third),
)
check(
  'a claimed message is in flight, and counted as attempted',
  (await logRow(oldest)).status === 'sending' && (await logRow(oldest)).attempts === 1,
)
check(
  'the claim hands over the phone number and the body, and nothing else',
  Object.keys(firstBatch[0]).sort().join(',') === 'attempts,body,id,to_phone',
  Object.keys(firstBatch[0]).join(','),
)

const secondBatch = (await asService('select * from claim_sms_batch(10)')).rows
check(
  'a second tick takes only what is left, never a message already in flight',
  secondBatch.length === 1 && secondBatch[0].id === third,
  `got ${secondBatch.length}`,
)
check(
  'and a third tick over a drained queue takes nothing',
  (await asService('select * from claim_sms_batch(10)')).rows.length === 0,
)

check(
  'the batch size is clamped, not trusted',
  (await asService('select * from claim_sms_batch(50000)')).rows.length === 0,
)

// --- Settling one message -------------------------------------------------

const balanceBefore = await creditsOf(centerA)

check(
  'a delivered message is marked sent, with the gateway’s reference',
  (await asService('select finish_sms($1, true, $2) as s', [oldest, 'gw-77'])).rows[0]
    .s === 'sent',
)
let logged = await logRow(oldest)
check(
  'and carries a sent timestamp, no error, and no claim',
  logged.status === 'sent' &&
    logged.has_sent_at &&
    logged.provider_ref === 'gw-77' &&
    logged.error === null &&
    !logged.has_claimed_at,
  `status=${logged.status} ref=${logged.provider_ref}`,
)
check(
  'a successful send costs nothing extra — credits went at queue time',
  (await creditsOf(centerA)) === balanceBefore,
)

check(
  'settling the same message twice is a no-op, not a second outcome',
  (await asService('select finish_sms($1, false, null, $2) as s', [oldest, 'again']))
    .rows[0].s === 'sent',
)
check(
  'so a retried worker cannot un-send a delivered message',
  (await logRow(oldest)).error === null &&
    (await creditsOf(centerA)) === balanceBefore,
)

// A refusal below the cap goes back in the queue rather than being lost, and
// waits before it is tried again — three attempts inside one gateway restart is
// the same as one attempt.
check(
  'a refused message returns to the queue',
  (await asService('select finish_sms($1, false, null, $2) as s', [
    second,
    'gateway 503',
  ])).rows[0].s === 'queued',
)
logged = await logRow(second)
check(
  'with the gateway’s complaint kept and a backoff set',
  logged.status === 'queued' &&
    logged.error === 'gateway 503' &&
    logged.backing_off === true &&
    !logged.has_claimed_at,
  `status=${logged.status} backing_off=${logged.backing_off}`,
)
check(
  'and it is not claimable again until the backoff expires',
  (await asService('select * from claim_sms_batch(10)')).rows.length === 0,
)
check(
  'a message still in the queue has not been refunded',
  (await creditsOf(centerA)) === balanceBefore,
)

// --- Giving up, and giving the credits back -------------------------------

// Straight to the cap rather than looping the gateway three times: the number
// lives in SQL and the test should not hold a second copy of it to count to.
await db.query(
  `update sms_logs set attempts = 3, status = 'sending', claimed_at = now(),
                       retry_after = null
     where id = $1`,
  [second],
)
check(
  'out of attempts, a message is failed rather than retried for ever',
  (await asService('select finish_sms($1, false, null, $2) as s', [
    second,
    'invalid number',
  ])).rows[0].s === 'failed',
)
check(
  'and the centre gets its credits back',
  (await creditsOf(centerA)) === balanceBefore + 2,
  `${await creditsOf(centerA)} vs ${balanceBefore + 2}`,
)
check(
  'with a ledger row naming the message, so the balance stays explainable',
  (await countOf(
    `select count(*)::int as n from sms_credit_ledger
      where coaching_center_id = $1 and delta = 2
        and reason = 'refund:failed:' || $2::text`,
    [centerA, second],
  )) === 1,
)

// --- The refund lands in the right centre --------------------------------

const otherCentre = await queueSms(centerB, stB, 3)
const bBefore = await creditsOf(centerB)
const aBefore = await creditsOf(centerA)
await db.query(
  `update sms_logs set attempts = 3, status = 'sending', claimed_at = now()
     where id = $1`,
  [otherCentre],
)
await asService('select finish_sms($1, false, null, $2)', [otherCentre, 'dead'])
check(
  'a failed message refunds the centre that paid for it',
  (await creditsOf(centerB)) === bBefore + 3,
  `B ${bBefore} -> ${await creditsOf(centerB)}`,
)
check(
  'and not the one that happened to be next in the queue',
  (await creditsOf(centerA)) === aBefore,
)
check(
  'the ledger row is centre B’s too',
  (await countOf(
    `select count(*)::int as n from sms_credit_ledger
      where coaching_center_id = $1 and reason like 'refund:failed:%'`,
    [centerB],
  )) === 1,
)

// --- Opting out after the message was queued -----------------------------
//
// The gap the settings screen does not mention: approved and paid for at 9:02, a
// guardian rings at 9:04, the worker's next tick is at 9:05. That switch is
// promised to win over everything.

const optedOut = await queueSms(centerA, stMim, 4)
const stays = await queueSms(centerA, stAli, 4)
await db.query('update students set sms_opt_out = true where id = $1', [stMim])
const aBeforeCancel = await creditsOf(centerA)

check(
  'a message for a student taken off the list is cancelled before it goes',
  (await asService('select cancel_opted_out_sms() as n')).rows[0].n === 1,
)
check(
  'the cancelled message says why',
  (await logRow(optedOut)).status === 'cancelled' &&
    (await logRow(optedOut)).error === 'opted out after queueing',
)
check(
  'a message nobody opted out of is left alone',
  (await logRow(stays)).status === 'queued',
)
check(
  'cancelling refunds it — the owner flipping a switch is not a charge',
  (await creditsOf(centerA)) === aBeforeCancel + 4,
)
check(
  'and says so in the ledger',
  (await countOf(
    `select count(*)::int as n from sms_credit_ledger
      where reason = 'refund:opted_out:' || $1::text`,
    [optedOut],
  )) === 1,
)

// The guardian's own switch, which is a different row from the student's. A
// second number on the same child — Ali already has a primary guardian, and one
// household can hold one parent who wants the messages and one who does not.
const gOptOut = await one(
  `insert into guardians (coaching_center_id, student_id, phone, name, is_primary, sms_opt_out)
   values ($1, $2, '01766666666', 'Ali mother', false, true) returning id`,
  [centerA, stAli],
)
const viaGuardian = await one(
  `insert into sms_logs
     (coaching_center_id, student_id, guardian_id, to_phone, kind, body, credit_cost)
   values ($1, $2, $3, '+8801766666666', 'exam_result', 'ফলাফল', 1)
   returning id`,
  [centerA, stAli, gOptOut],
)
await asService('select cancel_opted_out_sms()')
check(
  'a guardian’s own opt-out cancels the message too',
  (await logRow(viaGuardian)).status === 'cancelled',
)

// --- Rows nobody is coming back for --------------------------------------

const stranded = await queueSms(centerA, stAli)
await db.query('update students set sms_opt_out = false where id = $1', [stMim])
await asService('select * from claim_sms_batch(10)')
check(
  'a message being sent right now is not treated as abandoned',
  (await asService('select reap_stranded_sms() as n')).rows[0].n === 0,
)
await db.query(
  `update sms_logs set claimed_at = now() - interval '20 minutes' where id = $1`,
  [stranded],
)
check(
  'a message left in flight by a worker that died is reclaimed',
  (await asService('select reap_stranded_sms() as n')).rows[0].n === 1,
)
logged = await logRow(stranded)
check(
  'and goes back in the queue, with the reason recorded',
  logged.status === 'queued' && logged.error === 'worker stopped mid-send',
  `status=${logged.status} error=${logged.error}`,
)

// A strand at the cap is a failure like any other, refund included, because the
// reaper settles through finish_sms rather than deciding for itself.
const strandedOut = await queueSms(centerA, stAli, 5)
await asService('select * from claim_sms_batch(10)')
await db.query(
  `update sms_logs set attempts = 3, claimed_at = now() - interval '20 minutes'
     where id = $1`,
  [strandedOut],
)
const beforeReap = await creditsOf(centerA)
await asService('select reap_stranded_sms()')
check(
  'a strand out of attempts is failed and refunded, not left in flight',
  (await logRow(strandedOut)).status === 'failed' &&
    (await creditsOf(centerA)) === beforeReap + 5,
)

// The ledger has to add up, or the balance on the settings screen is a number
// with no story behind it. Asked of centre A over the whole section.
check(
  'every credit given back this section has a ledger row that explains it',
  (await countOf(
    `select count(*)::int as n from sms_credit_ledger
      where coaching_center_id = $1 and delta > 0
        and reason not like 'refund:%'`,
    [centerA],
  )) === 0,
)

console.log('\nAnonymous access:')

await asUser(db, null, async (tx) => {
  check('signed-out user reads no students', (await n(tx, 'select count(*)::int as n from students')) === 0)
  check(
    'signed-out user reads no guardian phone numbers',
    (await n(tx, 'select count(*)::int as n from guardians')) === 0,
  )
  check('signed-out user reads no centers', (await n(tx, 'select count(*)::int as n from coaching_centers')) === 0)
})

check(
  'signed-out user cannot call the import',
  await deniedAsUser(db, null, IMPORT, [
    centerA,
    pasted(listed('Anon Inserted', '+8801512345678')),
    uuids(),
  ]),
)
check(
  'and no anonymous student landed',
  (await namedAnywhere('Anon Inserted')) === 0,
)

console.log(`\n${passed} passed, ${failed} failed`)
await db.close()
process.exit(failed ? 1 : 0)
