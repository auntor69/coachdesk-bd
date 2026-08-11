/**
 * The tenant-isolation suite, run against the REAL Supabase database.
 *
 * scripts/test-rls.mjs proves the policies against local pglite. This proves
 * them against production Postgres, with the real triggers, the real `app`
 * helper functions, and real auth.users rows — the things a local stub can
 * only approximate.
 *
 * Everything runs inside ONE transaction and ends in ROLLBACK, so the database
 * is left exactly as it was found. Seeding happens as the connection owner
 * (which bypasses RLS, like our service-role client at signup); assertions run
 * under SET LOCAL ROLE with a fabricated JWT claim, exactly as Supabase scopes
 * a request.
 *
 * Needs SUPABASE_DB_URL. Run with:  npm run test:rls:live
 */
import pg from 'pg'

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL is not set. Add it to .env.local.')
  process.exit(1)
}

const url = new URL(dbUrl)
const client = new pg.Client({
  host: url.hostname,
  port: Number(url.port || 5432),
  database: url.pathname.replace(/^\//, '') || 'postgres',
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

await client.connect()
await client.query('begin')

let passed = 0
let failed = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const header = (t) => console.log(`\n${t}`)

/** Run `sql` as `userId` (or anonymously when null), then restore superuser. */
async function runAs(userId, sql, params = []) {
  const role = userId ? 'authenticated' : 'anon'
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
    userId ?? '',
  ])
  await client.query(`select set_config('request.jwt.claim.role', $1, true)`, [role])
  await client.query(`set local role ${role}`)
  try {
    return await client.query(sql, params)
  } finally {
    await client.query('set local role postgres')
  }
}

const n = async (userId, sql, params = []) =>
  Number((await runAs(userId, sql, params)).rows[0].n)

/**
 * True when the statement was rejected. A blocked write inside our single
 * transaction would poison it, so each attempt gets a savepoint to roll back to.
 */
async function denied(userId, sql, params = []) {
  await client.query('savepoint attempt')
  try {
    await runAs(userId, sql, params)
    await client.query('release savepoint attempt')
    return false
  } catch {
    await client.query('rollback to savepoint attempt')
    await client.query('set local role postgres')
    return true
  }
}

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0].id

try {
  // --- Seed -----------------------------------------------------------------
  const ids = {}
  for (const key of ['ownerA', 'ownerB', 'karim', 'nasrin', 'rahim', 'studentUser', 'guardianUser']) {
    ids[key] = await one(
      `insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data)
       values (gen_random_uuid(), $1, 'authenticated', 'authenticated', '{}', '{}')
       returning id`,
      [`${key}@livetest.invalid`],
    )
  }

  const centerA = await one(
    `insert into coaching_centers (name, created_by) values ('Dhaka Science Care', $1) returning id`,
    [ids.ownerA],
  )
  const centerB = await one(
    `insert into coaching_centers (name, created_by) values ('Khulna Model Coaching', $1) returning id`,
    [ids.ownerB],
  )

  const addMember = (center, user, role) =>
    client.query(
      `insert into center_members (coaching_center_id, user_id, role) values ($1, $2, $3)
       on conflict do nothing`,
      [center, user, role],
    )

  // ownerA/ownerB become owners via the claim trigger; the rest are explicit.
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
    one(`insert into subjects (coaching_center_id, name) values ($1, $2) returning id`, [center, name])

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

  const stAli = await student(centerA, 'Ali Hasan', ids.studentUser)
  const stMim = await student(centerA, 'Mim Akter')
  const stB = await student(centerB, 'Jubayer Khan')

  await client.query(
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

  const examChem = await one(
    `insert into exams (coaching_center_id, subject_id, batch_id, teacher_id, title, total_marks, exam_date)
     values ($1, $2, $3, $4, 'Chem Weekly 1', 50, current_date) returning id`,
    [centerA, sChem, bChemEvening, tNasrin],
  )
  await client.query(
    `insert into exam_results (coaching_center_id, exam_id, enrollment_id, obtained_marks)
     values ($1, $2, $3, 42)`,
    [centerA, examChem, eMim],
  )

  const examBio = await one(
    `insert into exams (coaching_center_id, subject_id, batch_id, teacher_id, title, total_marks, exam_date)
     values ($1, $2, $3, $4, 'Bio Weekly 1', 50, current_date) returning id`,
    [centerA, sBio, bBioMorning, tKarim],
  )
  await client.query(
    `insert into exam_results (coaching_center_id, exam_id, enrollment_id, obtained_marks)
     values ($1, $2, $3, 31)`,
    [centerA, examBio, eAli],
  )

  await client.query(
    `insert into fee_invoices (coaching_center_id, student_id, enrollment_id, period_month, amount_bdt, due_date)
     values ($1, $2, $3, date_trunc('month', current_date)::date, 800, current_date + 5)`,
    [centerA, stAli, eAli],
  )
  await client.query(`insert into subscriptions (coaching_center_id, plan) values ($1, 'center')`, [
    centerA,
  ])

  console.log('Seeded 2 centers, 3 teachers, 3 students against live Postgres.')

  // --- Assertions -----------------------------------------------------------

  header('Ownership')
  // Scoped to the two centres this run created, not counted across the whole
  // table. This assertion said `owners === 2` with no filter until the live
  // database had its first real centre in it, at which point a test about a
  // trigger started failing because someone had signed up. Every other count
  // here goes through `n()` and is scoped by RLS; this one runs as the migration
  // role, which sees everything, so it has to scope itself.
  const owners = Number(
    (
      await client.query(
        `select count(*)::int as n from center_members
         where role = 'owner' and coaching_center_id = any($1)`,
        [[centerA, centerB]],
      )
    ).rows[0].n,
  )
  check('claim trigger made both creators owners', owners === 2, `found ${owners}`)

  header('Cross-tenant isolation (Center A vs Center B)')
  check('owner A sees only own students', (await n(ids.ownerA, 'select count(*)::int as n from students')) === 2)
  check("owner A cannot read center B's student by id",
    (await n(ids.ownerA, 'select count(*)::int as n from students where id = $1', [stB])) === 0)
  check("owner A cannot read center B's center row",
    (await n(ids.ownerA, 'select count(*)::int as n from coaching_centers where id = $1', [centerB])) === 0)
  check("owner A cannot read center B's enrollments",
    (await n(ids.ownerA, 'select count(*)::int as n from enrollments where id = $1', [eB])) === 0)
  check('owner A sees own subscription',
    (await n(ids.ownerA, 'select count(*)::int as n from subscriptions')) === 1)
  check('owner B sees only own student',
    (await n(ids.ownerB, 'select count(*)::int as n from students')) === 1)
  check("owner B cannot read center A's guardians (parent phones)",
    (await n(ids.ownerB, 'select count(*)::int as n from guardians')) === 0)
  check("owner B cannot read center A's exam results",
    (await n(ids.ownerB, 'select count(*)::int as n from exam_results')) === 0)
  check("owner B cannot read center A's subscription",
    (await n(ids.ownerB, 'select count(*)::int as n from subscriptions')) === 0)

  header('Teacher scoping inside one center (Karim vs Nasrin)')
  check('Karim sees only students in his own batch',
    (await n(ids.karim, 'select count(*)::int as n from students')) === 1)
  check("Karim cannot read Nasrin's student Mim",
    (await n(ids.karim, 'select count(*)::int as n from students where id = $1', [stMim])) === 0)
  check("Karim cannot read Nasrin's exam results",
    (await n(ids.karim, 'select count(*)::int as n from exam_results where enrollment_id = $1', [eMim])) === 0)
  check('Karim CAN read his own batch exam results',
    (await n(ids.karim, 'select count(*)::int as n from exam_results where enrollment_id = $1', [eAli])) === 1)
  check("Karim cannot read guardian phone of Nasrin's student",
    (await n(ids.karim, 'select count(*)::int as n from guardians where student_id = $1', [stMim])) === 0)
  check('Karim cannot see fee invoices',
    (await n(ids.karim, 'select count(*)::int as n from fee_invoices')) === 0)
  check('Karim cannot see what the center pays us',
    (await n(ids.karim, 'select count(*)::int as n from subscriptions')) === 0)
  check('Karim sees his own batch',
    (await n(ids.karim, 'select count(*)::int as n from batches where id = $1', [bBioMorning])) === 1)

  header('Teacher write scoping')
  check("Karim cannot take attendance for Nasrin's batch",
    await denied(ids.karim,
      `insert into attendance_sessions (coaching_center_id, batch_id, session_date)
       values ($1, $2, current_date)`, [centerA, bChemEvening]))
  check('Karim CAN take attendance for his own batch',
    !(await denied(ids.karim,
      `insert into attendance_sessions (coaching_center_id, batch_id, session_date)
       values ($1, $2, current_date)`, [centerA, bBioMorning])))
  check("Karim cannot enter marks on Nasrin's exam",
    await denied(ids.karim,
      `insert into exam_results (coaching_center_id, exam_id, enrollment_id, obtained_marks)
       values ($1, $2, $3, 50)`, [centerA, examChem, eMim]))
  check('teacher from center B cannot create an exam in center A',
    await denied(ids.rahim,
      `insert into exams (coaching_center_id, subject_id, batch_id, title, total_marks, exam_date)
       values ($1, $2, $3, 'Injected', 100, current_date)`, [centerA, sBio, bBioMorning]))
  check('teacher cannot forge a membership to escalate to owner',
    await denied(ids.karim,
      `insert into center_members (coaching_center_id, user_id, role) values ($1, $2, 'owner')`,
      [centerA, ids.karim]))
  check('owner A cannot insert a student into center B',
    await denied(ids.ownerA,
      `insert into students (coaching_center_id, name) values ($1, 'Smuggled')`, [centerB]))

  // -------------------------------------------------------------------------
  // Sideways references — the hole 20260811000005 closed.
  //
  // Everything above tests coaching_center_id: can this actor reach a row whose
  // centre is not theirs. This tests the other axis. A write can carry a
  // perfectly legitimate coaching_center_id — passing every policy above —
  // alongside a *sibling* id belonging to another centre. Before the composite
  // foreign keys, all of these succeeded.
  //
  // Nothing here reads across tenants, which is why it survived so long. What it
  // does is stitch two centres' records together, so a mark or an invoice hangs
  // off a child who belongs to someone else, and every dashboard that joins
  // through a sideways id reports a number that is partly not the centre's.
  //
  // Most of these run as the connection owner on purpose. That is the
  // service_role path, where no policy is consulted at all — the SMS queue and
  // the invoice generator will run there. If these passed only under RLS, the
  // constraint would not be doing the work, and the next thing written as
  // service_role would walk straight through.
  //
  // Running it here as well as locally is the point of this file: constraint
  // behaviour is exactly the kind of thing pglite can approximate and a real
  // server can contradict. ON DELETE SET NULL with a column list needs PG 15+,
  // and it is live Supabase whose version decides whether that holds.
  // -------------------------------------------------------------------------
  header('Sideways references (same centre, wrong sibling)')

  /**
   * Attempts a write as the connection owner — no RLS in the path, so only a
   * constraint can refuse — and returns true only when a *tenant* foreign key
   * was what refused it.
   *
   * Checking which constraint fired is the whole point. "The database said no"
   * is cheap to get by accident: a unique conflict left by an earlier
   * assertion, a check constraint, a bad enum label in the test itself. Any of
   * those would turn this section green while the hole stayed open, and it
   * would read exactly like a pass. So the error has to name a _center_fkey.
   */
  const refusedByTenantFk = async (name, sql, params = []) => {
    await client.query('savepoint sideways')
    try {
      await client.query(sql, params)
      await client.query('release savepoint sideways')
      check(name, false, 'accepted')
    } catch (error) {
      await client.query('rollback to savepoint sideways')
      const message = String(error.message)
      check(name, /_center_fkey/.test(message), message.split('\n')[0])
    }
  }

  await refusedByTenantFk(
    "a batch cannot borrow another centre's subject (service_role)",
    `insert into batches (coaching_center_id, subject_id, name) values ($1, $2, 'Smuggled')`,
    [centerA, sPhy],
  )
  await refusedByTenantFk(
    "a batch cannot be handed another centre's teacher (service_role)",
    `insert into batches (coaching_center_id, subject_id, teacher_id, name)
     values ($1, $2, $3, 'Borrowed')`,
    [centerA, sBio, tRahim],
  )
  await refusedByTenantFk(
    "an enrollment cannot point at another centre's student (service_role)",
    `insert into enrollments (coaching_center_id, student_id, subject_id, batch_id)
     values ($1, $2, $3, $4)`,
    [centerA, stB, sBio, bBioMorning],
  )
  await refusedByTenantFk(
    "a guardian cannot be attached to another centre's student (service_role)",
    `insert into guardians (coaching_center_id, student_id, phone)
     values ($1, $2, '+8801711111111')`,
    [centerA, stB],
  )
  await refusedByTenantFk(
    "marks cannot be recorded against another centre's enrollment (service_role)",
    `insert into exam_results (coaching_center_id, exam_id, enrollment_id, obtained_marks)
     values ($1, $2, $3, 40)`,
    [centerA, examBio, eB],
  )
  await refusedByTenantFk(
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
  await refusedByTenantFk(
    "a result SMS cannot be logged against another centre's guardian (service_role)",
    `insert into sms_logs (coaching_center_id, guardian_id, to_phone, kind, body)
     values ($1, $2, '+8801711111111', 'exam_result', 'x')`,
    [centerA, gB],
  )
  await client.query('delete from guardians where id = $1', [gB])

  await refusedByTenantFk(
    "a permissions row cannot be attached to another centre's teacher (service_role)",
    `insert into teacher_permissions (teacher_id, coaching_center_id) values ($1, $2)`,
    [tRahim, centerA],
  )
  await refusedByTenantFk(
    "teacher_subjects cannot pair a teacher with another centre's subject (service_role)",
    `insert into teacher_subjects (teacher_id, subject_id, coaching_center_id)
     values ($1, $2, $3)`,
    [tKarim, sPhy, centerA],
  )

  // And the same attack down the path a real request takes.
  check("owner A cannot create an exam on another centre's subject",
    await denied(ids.ownerA,
      `insert into exams (coaching_center_id, subject_id, batch_id, title, total_marks, exam_date)
       values ($1, $2, $3, 'Injected', 100, current_date)`,
      [centerA, sPhy, bBioMorning]))
  check("owner A cannot enroll another centre's student into their own batch",
    await denied(ids.ownerA,
      `insert into enrollments (coaching_center_id, student_id, subject_id, batch_id)
       values ($1, $2, $3, $4)`,
      [centerA, stB, sBio, bBioMorning]))

  // The legitimate shapes have to keep working, or this is just an outage with a
  // security rationale. Everything below is created and then removed again: the
  // sections after this one assert exact counts, and a test that quietly leaves a
  // student behind makes the next one fail for a reason that has nothing to do
  // with what it is testing.
  const spareBatch = await one(
    `insert into batches (coaching_center_id, subject_id, name)
     values ($1, $2, 'Not yet staffed') returning id`, [centerA, sBio])
  check('a batch with no teacher assigned yet is still legal', Boolean(spareBatch))
  const spareEnrollment = await one(
    `insert into enrollments (coaching_center_id, student_id, subject_id, batch_id)
     values ($1, $2, $3, $4) returning id`, [centerA, stMim, sBio, spareBatch])
  check('an ordinary same-centre enrollment still inserts', Boolean(spareEnrollment))

  // The ON DELETE SET NULL (column) case, which is the one that would turn
  // "sack a teacher" into an error message if the column list were missing.
  const spareTeacher = await one(
    `insert into teachers (coaching_center_id, name) values ($1, 'Temp Sir') returning id`,
    [centerA])
  await client.query('update batches set teacher_id = $1 where id = $2',
    [spareTeacher, spareBatch])
  await client.query('delete from teachers where id = $1', [spareTeacher])
  const released = (await client.query(
    'select teacher_id, coaching_center_id from batches where id = $1', [spareBatch])).rows[0]
  check('deleting a teacher nulls the batch teacher and keeps the centre',
    released.teacher_id === null && released.coaching_center_id === centerA,
    `teacher_id=${released.teacher_id} center=${released.coaching_center_id}`)

  await client.query('delete from batches where id = $1', [spareBatch])
  check('and removing the batch takes its enrollment with it, leaving the seed as found',
    (await client.query('select count(*)::int as n from enrollments where id = $1',
      [spareEnrollment])).rows[0].n === 0)

  // -------------------------------------------------------------------------
  // Deactivating a teacher. The settings screen promises an owner that turning a
  // teacher off means they stop seeing their batches, their students, and those
  // students' guardians — said about someone who may have just been fired, so it
  // had better be true. It takes two writes, and this is why toggleTeacherActive
  // does both.
  // -------------------------------------------------------------------------
  header('Deactivating a teacher')

  await client.query('update teachers set active = false where id = $1', [tKarim])

  check('an inactive teacher sees no students',
    (await n(ids.karim, 'select count(*)::int as n from students')) === 0)
  check('an inactive teacher sees no guardian phone numbers',
    (await n(ids.karim, 'select count(*)::int as n from guardians')) === 0)
  check('an inactive teacher sees no exam results',
    (await n(ids.karim, 'select count(*)::int as n from exam_results')) === 0)
  // Deliberate, and the reason the action does more than flip `active`:
  // batches_member_read admits anyone holding a membership, because students and
  // guardians need batch names and times. batches also carries monthly_fee_bdt.
  check('flipping `active` alone does NOT hide the batch list — membership still does',
    (await n(ids.karim, 'select count(*)::int as n from batches')) > 0)
  check('an inactive teacher cannot take attendance for what was their own batch',
    await denied(ids.karim,
      `insert into attendance_sessions (coaching_center_id, batch_id, session_date)
       values ($1, $2, current_date - 1)`, [centerA, bBioMorning]))

  // The second write. Only the 'teacher' role, so a teacher who is also a manager
  // keeps that, and an owner in Teacher Mode cannot lock themselves out.
  await client.query(
    `delete from center_members
     where coaching_center_id = $1 and user_id = $2 and role = 'teacher'`,
    [centerA, ids.karim],
  )

  check('with the membership gone the batch list goes too',
    (await n(ids.karim, 'select count(*)::int as n from batches')) === 0)
  check('and so does the center itself',
    (await n(ids.karim, 'select count(*)::int as n from coaching_centers')) === 0)
  check('and the list of colleagues',
    (await n(ids.karim, 'select count(*)::int as n from teachers')) === 0)

  const keptMarks = Number(
    (await client.query('select count(*)::int as n from exam_results where exam_id = $1',
      [examBio])).rows[0].n,
  )
  check('their past marks survive deactivation', keptMarks === 1)

  await client.query('update teachers set active = true where id = $1', [tKarim])
  await addMember(centerA, ids.karim, 'teacher')

  check('reactivating gives the teacher their students back',
    (await n(ids.karim, 'select count(*)::int as n from students')) === 1)
  check('and their batch back',
    (await n(ids.karim, 'select count(*)::int as n from batches where id = $1',
      [bBioMorning])) === 1)

  header('Student and guardian scoping')
  check('student sees only themselves',
    (await n(ids.studentUser, 'select count(*)::int as n from students')) === 1)
  check("student cannot read a classmate's marks",
    (await n(ids.studentUser, 'select count(*)::int as n from exam_results where enrollment_id = $1', [eMim])) === 0)
  check('student sees their own fee invoice',
    (await n(ids.studentUser, 'select count(*)::int as n from fee_invoices')) === 1)
  check('student sees their own mark',
    (await n(ids.studentUser, 'select count(*)::int as n from exam_results where enrollment_id = $1', [eAli])) === 1)
  check('guardian sees only their own child',
    (await n(ids.guardianUser, 'select count(*)::int as n from students')) === 1)
  check('guardian cannot read other students',
    (await n(ids.guardianUser, 'select count(*)::int as n from students where id = $1', [stMim])) === 0)

  // With no permissive UPDATE policy the write matches zero rows rather than
  // raising, so the assertion that matters is the stored value.
  await runAs(ids.studentUser, `update exam_results set obtained_marks = 50 where enrollment_id = $1`, [eAli])
  const markAfter = (
    await client.query('select obtained_marks from exam_results where enrollment_id = $1', [eAli])
  ).rows[0].obtained_marks
  check('student cannot edit their own marks', Number(markAfter) === 31,
    `mark is now ${markAfter}, expected 31`)

  // -------------------------------------------------------------------------
  // The fee board's balance view.
  //
  // A Postgres view runs as its OWNER unless told otherwise, which means the
  // first view in this schema was a chance to undo all 63 policies at once —
  // not by weakening them, but by routing around them. Measured before writing
  // 20260811000006: as owner B, the students table returned 1 row and a naive
  // view over it returned 2, including the other centre's child's name.
  //
  // This runs live as well as locally for the same reason the sideways-FK
  // section does. security_invoker needs PG 15+, the view owner here is whatever
  // role Supabase's pooler connects as rather than the local `postgres`, and
  // "who owns the view" is precisely the variable the whole thing turns on. A
  // green pglite run does not settle it.
  //
  // The arithmetic is checked here rather than in a unit test because this is
  // where it happens — numeric(10, 2) in Postgres, not floats in JavaScript. An
  // owner will check this board against a bKash statement, and a board that is
  // off by one taka is a board they stop believing.
  // -------------------------------------------------------------------------
  header('Fee board view (security_invoker)')

  const invoiceAli = (
    await client.query('select id from fee_invoices where student_id = $1', [stAli])
  ).rows[0].id

  check('owner A sees their own invoice through the view',
    (await n(ids.ownerA, 'select count(*)::int as n from fee_invoice_balances')) === 1)
  check('and the name comes with it, so the board is readable',
    (await runAs(ids.ownerA, 'select student_name from fee_invoice_balances')).rows[0]
      ?.student_name === 'Ali Hasan')

  // The one that matters. Centre B has no invoices at all, so a leak shows up as
  // any number other than zero.
  check("owner B sees nothing of centre A's money through the view",
    (await n(ids.ownerB, 'select count(*)::int as n from fee_invoice_balances')) === 0)
  check('a teacher still sees no fees through the view',
    (await n(ids.karim, 'select count(*)::int as n from fee_invoice_balances')) === 0)
  check("the guardian sees their own child's bill through the view",
    (await n(ids.guardianUser, 'select count(*)::int as n from fee_invoice_balances')) === 1)
  check('a signed-out reader sees nothing through the view',
    (await n(null, 'select count(*)::int as n from fee_invoice_balances')) === 0)

  // --- The money ------------------------------------------------------------

  const balance = async () =>
    (
      await client.query(
        'select net_bdt, paid_bdt, remaining_bdt from fee_invoice_balances where id = $1',
        [invoiceAli],
      )
    ).rows[0]

  const pay = (amount, method = 'cash') =>
    client.query(
      `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt, method)
       values ($1, $2, $3, $4, $5)`,
      [centerA, invoiceAli, stAli, amount, method],
    )

  let bal = await balance()
  check('nothing paid yet: remaining is the full fee',
    Number(bal.net_bdt) === 800 && Number(bal.paid_bdt) === 0 && Number(bal.remaining_bdt) === 800,
    `net=${bal.net_bdt} paid=${bal.paid_bdt} remaining=${bal.remaining_bdt}`)

  // A discount lowers what the family owes without rewriting what was billed —
  // the owner needs both numbers to explain the bill to a parent.
  await client.query('update fee_invoices set discount_bdt = 100 where id = $1', [invoiceAli])
  bal = await balance()
  check('a discount lowers what is owed, not what was billed',
    Number(bal.net_bdt) === 700 && Number(bal.remaining_bdt) === 700,
    `net=${bal.net_bdt} remaining=${bal.remaining_bdt}`)

  await pay(400)
  bal = await balance()
  check('a partial payment leaves the difference outstanding',
    Number(bal.paid_bdt) === 400 && Number(bal.remaining_bdt) === 300,
    `paid=${bal.paid_bdt} remaining=${bal.remaining_bdt}`)

  await pay(300, 'bkash')
  bal = await balance()
  check('paying the rest clears it exactly',
    Number(bal.paid_bdt) === 700 && Number(bal.remaining_bdt) === 0,
    `paid=${bal.paid_bdt} remaining=${bal.remaining_bdt}`)

  // A refund is a negative payment, not a deleted one: the original stays on the
  // record and the family owes the money again.
  await pay(-200)
  bal = await balance()
  check('a refund puts the money back on the bill',
    Number(bal.paid_bdt) === 500 && Number(bal.remaining_bdt) === 200,
    `paid=${bal.paid_bdt} remaining=${bal.remaining_bdt}`)
  check('and the payment it reverses is still on the record',
    Number((await client.query(
      'select count(*)::int as n from fee_payments where invoice_id = $1', [invoiceAli],
    )).rows[0].n) === 3)

  // Fractional taka, the case JavaScript gets wrong: 1500.10 has no exact float
  // representation, and three of them added as doubles give 4500.299999999999.
  await client.query(
    'update fee_invoices set amount_bdt = 1500.10, discount_bdt = 0 where id = $1', [invoiceAli])
  await client.query('delete from fee_payments where invoice_id = $1', [invoiceAli])
  await pay(500.05)
  await pay(500.05)
  bal = await balance()
  check('fractional taka add up exactly, because Postgres does the adding',
    Number(bal.paid_bdt) === 1000.1 && Number(bal.remaining_bdt) === 500,
    `paid=${bal.paid_bdt} remaining=${bal.remaining_bdt}`)

  // Leave the seed as found. The whole file rolls back at the end, but the
  // sections below assert exact counts before it does.
  await client.query('delete from fee_payments where invoice_id = $1', [invoiceAli])
  await client.query(
    'update fee_invoices set amount_bdt = 800, discount_bdt = 0 where id = $1', [invoiceAli])

  // -------------------------------------------------------------------------
  // The two writes the fee board makes.
  //
  // Everything above proves reads. Nothing yet proved the owner who runs this
  // screen can write to it — a policy that grants SELECT and forgets INSERT
  // reads like a working one right up until someone tries to take money, and
  // the first person to try will be standing in front of a parent.
  //
  // The other half is the generator's promise. The button tells the owner that
  // pressing it twice is safe, which rests entirely on `on conflict
  // (enrollment_id, period_month) do nothing` and on RETURNING listing only the
  // rows really inserted. Worth checking against the real server because the
  // unique constraint it depends on treats NULL enrollment_id as distinct, and
  // "how this database handles nulls in a unique key" is not something to take
  // on faith from a WASM build.
  // -------------------------------------------------------------------------
  header('Fee board writes (raise, re-raise, collect)')

  // Mim has no seeded invoice, so this is a genuine first insert. The SQL is the
  // shape the generator's upsert compiles to, not an approximation of it.
  const RAISE = `insert into fee_invoices
       (coaching_center_id, student_id, enrollment_id, period_month, amount_bdt, due_date)
     values ($1, $2, $3, date_trunc('month', current_date)::date, 1500, current_date + 10)
     on conflict (enrollment_id, period_month) do nothing
     returning id`

  const firstRaise = await runAs(ids.ownerA, RAISE, [centerA, stMim, eMim])
  const mimInvoice = firstRaise.rows[0]?.id ?? null
  check('the owner can raise an invoice for their own enrollment',
    firstRaise.rows.length === 1)

  const secondRaise = await runAs(ids.ownerA, RAISE, [centerA, stMim, eMim])
  check('pressing generate again inserts nothing and says so',
    secondRaise.rows.length === 0, `returned ${secondRaise.rows.length} row(s)`)

  check('so the family is billed once, not twice',
    (await n(ids.ownerA,
      `select count(*)::int as n from fee_invoices
       where enrollment_id = $1 and period_month = date_trunc('month', current_date)::date`,
      [eMim])) === 1)

  await runAs(ids.ownerA,
    `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt, method)
     values ($1, $2, $3, 1500, 'bkash')`,
    [centerA, mimInvoice, stMim])
  check('the owner can record a payment, and the board clears',
    Number((await runAs(ids.ownerA,
      'select remaining_bdt from fee_invoice_balances where id = $1', [mimInvoice],
    )).rows[0].remaining_bdt) === 0)

  // A payment aimed at another centre's invoice. The insert names centre B in
  // its own tenant column, so RLS lets it through — what refuses it is the
  // composite foreign key from 20260811000005.
  check("owner B cannot put money on centre A's invoice",
    await denied(ids.ownerB,
      `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt)
       values ($1, $2, $3, 500)`,
      [centerB, mimInvoice, stB]))

  check('a teacher cannot record a payment at all',
    await denied(ids.karim,
      `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt)
       values ($1, $2, $3, 500)`,
      [centerA, mimInvoice, stMim]))

  // Put the seed back: the sections below count invoices and expect one.
  await client.query('delete from fee_payments where invoice_id = $1', [mimInvoice])
  await client.query('delete from fee_invoices where id = $1', [mimInvoice])

  // -------------------------------------------------------------------------
  // Billing columns — the free tier only exists if these cannot be edited by
  // the person who benefits from editing them. Worth repeating against the real
  // database rather than only pglite, because the fix is a column privilege and
  // a REVOKE only removes grants the revoking role made: if Supabase's original
  // grant came from supabase_admin rather than postgres, the revoke in
  // 20260811000004 succeeded locally and changed nothing here. This section is
  // how we find that out. The guard trigger is the backstop either way.
  //
  // The GRANT/REVOKE below are transactional like everything else in this file
  // and roll back with the seed data.
  // -------------------------------------------------------------------------
  header('Billing columns (plan, status, credit balance)')

  check('owner cannot raise their own SMS credit balance',
    await denied(ids.ownerA,
      'update coaching_centers set sms_credit_balance = 999999 where id = $1', [centerA]))
  check('owner cannot upgrade their own plan',
    await denied(ids.ownerA,
      `update coaching_centers set plan = 'institution' where id = $1`, [centerA]))
  check('owner cannot move their center out of trial',
    await denied(ids.ownerA,
      `update coaching_centers set status = 'active' where id = $1`, [centerA]))
  check('owner cannot create a second center to escape the plan limit',
    await denied(ids.ownerA,
      `insert into coaching_centers (name, created_by, plan)
       values ('Free Institution', $1, 'institution')`, [ids.ownerA]))

  const billing = async () =>
    (await client.query(
      'select plan, status, sms_credit_balance from coaching_centers where id = $1',
      [centerA],
    )).rows[0]

  let billed = await billing()
  check('nothing actually moved after those attempts',
    billed.plan === 'teacher_free' && billed.status === 'trial' &&
      billed.sms_credit_balance === 0,
    `plan=${billed.plan} status=${billed.status} balance=${billed.sms_credit_balance}`)

  // The lock must not catch our own dispatcher. If it did, every SMS send would
  // fail closed — safe, but the product would look broken instead.
  let dispatcherOk = true
  try {
    await client.query('set local role service_role')
    await client.query(
      'update coaching_centers set sms_credit_balance = 50 where id = $1', [centerA])
  } catch (error) {
    dispatcherOk = false
    console.log(`        ${error.message}`)
  } finally {
    await client.query('set local role postgres')
  }
  billed = await billing()
  check('service_role can still top up credits',
    dispatcherOk && billed.sms_credit_balance === 50,
    `balance=${billed.sms_credit_balance}`)

  // An owner still has to be able to fix their own centre's details, or the lock
  // has broken the settings screen instead of the exploit.
  await runAs(ids.ownerA,
    `update coaching_centers set name = 'Dhaka Science Care (Mirpur)', bd_area = 'Mirpur'
     where id = $1`, [centerA])
  const renamed = (await client.query(
    'select name, bd_area from coaching_centers where id = $1', [centerA])).rows[0]
  check('owner can still edit their own center details',
    renamed.name === 'Dhaka Science Care (Mirpur)' && renamed.bd_area === 'Mirpur',
    `name=${renamed.name} area=${renamed.bd_area}`)

  // The accident the guard trigger exists for: someone pastes the blanket
  // `grant all on all tables in schema public to authenticated` that appears in
  // half the Supabase setup snippets, and the column revoke stops mattering.
  await client.query('grant update on coaching_centers to authenticated')
  check('guard trigger still refuses after a blanket re-grant',
    await denied(ids.ownerA,
      'update coaching_centers set sms_credit_balance = 999999 where id = $1', [centerA]))
  billed = await billing()
  check('balance survived the re-grant', billed.sms_credit_balance === 50,
    `balance=${billed.sms_credit_balance}`)

  header('Anonymous access')
  check('signed-out user reads no students',
    (await n(null, 'select count(*)::int as n from students')) === 0)
  check('signed-out user reads no guardian phone numbers',
    (await n(null, 'select count(*)::int as n from guardians')) === 0)
  check('signed-out user reads no centers',
    (await n(null, 'select count(*)::int as n from coaching_centers')) === 0)

  console.log(`\n${passed} passed, ${failed} failed  (against live Supabase)`)
  if (failed) console.log('Failures:', failures.join(', '))
} catch (error) {
  console.error('\nLIVE TEST ERROR:', error.message)
  failed++
} finally {
  // Nothing above is kept. The production database is untouched.
  await client.query('rollback')
  await client.end()
  process.exit(failed ? 1 : 0)
}
