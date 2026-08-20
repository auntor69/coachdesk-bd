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

// UPDATE and DELETE are the two that cannot be asserted with deniedAsUser, and
// they are the two that would cost the most. A reader who can SELECT a row and has
// no write policy gets no error from `update` — the row is filtered out and
// Postgres reports nought rows changed, which deniedAsUser reads as allowed. So
// the assertion is the stored number. Setting discount_bdt to the full 800 is a
// legal value that clears fee_invoices_discount_bound, which is the point: if the
// policy ever opened, a teacher would be writing off the owner's fees and nothing
// in the schema would stop them.
await asUser(db, ids.karim, async (tx) => {
  await tx.query('update fee_invoices set discount_bdt = 800 where id = $1', [invoiceAli])
  await tx.query('delete from fee_payments where invoice_id = $1', [invoiceAli])
})

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
  'nor delete the payment on it',
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
