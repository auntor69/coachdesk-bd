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
  const res = await client.query(sql, params)
  await client.query('set local role postgres')
  return res
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
  // Fee reminders — the record of having chased a fee.
  //
  // Repeated here rather than left to pglite because two of the three things
  // asserted are properties of the real database rather than of the SQL: that
  // the policy on a table created by migration 7 actually took effect on a
  // project where Supabase made the original grants, and that the composite
  // foreign key is present live rather than only in the harness.
  //
  // The third — that the same invoice can be chased more than once — is the
  // reason this table exists at all instead of sms_dispatches, whose unique
  // (coaching_center_id, kind, ref_id) would have silently swallowed the second
  // and third reminders of a due−3 / due / due+7 cadence.
  //
  // Explicit created_at because every statement in this file shares one
  // transaction timestamp, which would make "the latest" ambiguous in a way it
  // never is in production.
  // -------------------------------------------------------------------------
  header('Fee reminders (who chased whom)')

  const REMIND = `insert into fee_reminders
       (coaching_center_id, invoice_id, channel, amount_bdt, to_phone, body, created_at)
     values ($1, $2, $3, 800, '+8801712345678', 'test body', now() - $4::interval)
     returning id`

  check('the owner can record a reminder against their own invoice',
    (await runAs(ids.ownerA, REMIND, [centerA, invoiceAli, 'sms', '2 days'])).rows.length === 1)

  await runAs(ids.ownerA, REMIND, [centerA, invoiceAli, 'whatsapp', '1 day'])
  await runAs(ids.ownerA, REMIND, [centerA, invoiceAli, 'call', '1 minute'])
  check('the same invoice can be chased again, on another channel, and again',
    (await n(ids.ownerA,
      'select count(*)::int as n from fee_reminders where invoice_id = $1',
      [invoiceAli])) === 3)

  // The board's own query: the first row of a descending order.
  check('and the latest one is the one the board will show',
    (await runAs(ids.ownerA,
      `select channel from fee_reminders where invoice_id = $1
       order by created_at desc limit 1`, [invoiceAli],
    )).rows[0]?.channel === 'call')

  // Names centre B in its own tenant column, so RLS lets it through; the
  // composite foreign key to (id, coaching_center_id) is what refuses it.
  check("owner B cannot log a reminder against centre A's invoice",
    await denied(ids.ownerB,
      `insert into fee_reminders (coaching_center_id, invoice_id, channel, amount_bdt)
       values ($1, $2, 'sms', 800)`,
      [centerB, invoiceAli]))

  check('a teacher cannot log a reminder, like they cannot take money',
    await denied(ids.karim,
      `insert into fee_reminders (coaching_center_id, invoice_id, channel, amount_bdt)
       values ($1, $2, 'sms', 800)`,
      [centerA, invoiceAli]))

  check("owner B sees none of centre A's reminders",
    (await n(ids.ownerB, 'select count(*)::int as n from fee_reminders')) === 0)
  check('a teacher cannot read who has been chased',
    (await n(ids.karim, 'select count(*)::int as n from fee_reminders')) === 0)
  // Deliberate: a guardian reads their own invoices and their own receipts, but
  // a tally of how often they were chased for money is the centre's own note.
  check('a guardian cannot read the record of being chased, unlike their own bill',
    (await n(ids.guardianUser, 'select count(*)::int as n from fee_reminders')) === 0)
  check('a signed-out reader sees no reminders',
    (await n(null, 'select count(*)::int as n from fee_reminders')) === 0)

  // Cascade, on a throwaway invoice so the seeded one survives.
  const scratchInvoice = await one(
    `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
     values ($1, $2, '2026-01-01', 500, '2026-01-10') returning id`,
    [centerA, stAli])
  await client.query(REMIND, [centerA, scratchInvoice, 'sms', '0 minutes'])
  await client.query('delete from fee_invoices where id = $1', [scratchInvoice])
  check('deleting an invoice takes its reminders with it',
    (await n(ids.ownerA,
      'select count(*)::int as n from fee_reminders where invoice_id = $1',
      [scratchInvoice])) === 0)

  // Leave the seed as found.
  await client.query('delete from fee_reminders where invoice_id = $1', [invoiceAli])

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

  // --- Where the fees are sent ----------------------------------------------
  //
  // Before the blanket re-grant below, on purpose: this section has to prove the
  // column grant from 20260811000008 is actually present on the live table, and
  // a table-wide grant would hide its absence.
  //
  // These assertions read the row instead of catching an exception, because
  // centers_owner_update filters with `using (app.is_owner(id))` — a teacher's
  // update matches no rows and reports success. `denied` would pass on a
  // wide-open column, so it is only used where a constraint does the refusing.
  header('Payment number (where a parent sends the fee)')

  const payTo = async () =>
    (await client.query(
      'select payment_wallet, payment_number from coaching_centers where id = $1',
      [centerA],
    )).rows[0]
  const setPay = (assignments) =>
    `update coaching_centers set ${assignments} where id = $1`

  await runAs(ids.ownerA,
    setPay(`payment_wallet = 'bkash', payment_number = '+8801711000012'`), [centerA])
  let money = await payTo()
  check('owner can set where the fees are sent',
    money.payment_wallet === 'bkash' && money.payment_number === '+8801711000012',
    `${money.payment_wallet} ${money.payment_number}`)

  // The attack the column invites, with a well-formed number so that the check
  // constraint cannot pass this test on RLS's behalf. A teacher who could write
  // here would not steal a record — every reminder the centre sent from that
  // moment would name their wallet.
  await runAs(ids.karim,
    setPay(`payment_wallet = 'nagad', payment_number = '+8801999999999'`), [centerA])
  money = await payTo()
  check('a teacher cannot point the fees at their own wallet',
    money.payment_wallet === 'bkash' && money.payment_number === '+8801711000012',
    `${money.payment_wallet} ${money.payment_number}`)

  await runAs(ids.ownerB,
    setPay(`payment_wallet = 'rocket', payment_number = '+8801811000099'`), [centerA])
  money = await payTo()
  check("an owner cannot redirect another centre's fees",
    money.payment_wallet === 'bkash' && money.payment_number === '+8801711000012',
    `${money.payment_wallet} ${money.payment_number}`)

  check('a wallet with no number is refused',
    await denied(ids.ownerA,
      setPay(`payment_wallet = 'nagad', payment_number = null`), [centerA]))
  check('a number with no wallet is refused',
    await denied(ids.ownerA,
      setPay(`payment_wallet = null, payment_number = '+8801711000012'`), [centerA]))

  // Each of these is a shape that would reach a parent looking almost right.
  for (const [bad, why] of [
    ['01711000012', 'local form that never got normalised'],
    ['+880171100001', 'one digit short'],
    ['+8801711000012 ', 'trailing space from a paste'],
    ['+8801111000012', '011 — Citycell, dead since 2016'],
  ]) {
    check(`a malformed payment number is refused (${why})`,
      await denied(ids.ownerA, setPay('payment_number = $2'), [centerA, bad]))
  }

  await runAs(ids.ownerA,
    setPay('payment_wallet = null, payment_number = null'), [centerA])
  money = await payTo()
  check('clearing both is how a centre says it takes no mobile payments',
    money.payment_wallet === null && money.payment_number === null,
    `${money.payment_wallet} ${money.payment_number}`)

  header('Billing columns, continued')

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

  header('Bulk import (import_students)')

  // The jsonb the Server Action sends is exactly the parser's ImportStudent
  // shape, so these literals are what a pasted register turns into.
  const pasted = (...rows) => JSON.stringify(rows)
  const listed = (name, phone, guardianName = null) => ({
    name,
    guardian_phone: phone,
    guardian_name: guardianName,
  })
  const uuids = (...list) => `{${list.join(',')}}`
  const IMPORT = 'select * from import_students($1::uuid, $2::jsonb, $3::uuid[])'

  const importAs = async (user, center, students, batches = uuids()) =>
    (await runAs(user, IMPORT, [center, students, batches])).rows[0]

  // Counted as the connection owner: what the caller can see is a separate
  // question from what actually landed, and here we want the truth.
  const truth = async (sql, params = []) =>
    Number((await client.query(sql, params)).rows[0].n)
  const studentsIn = (center) =>
    truth('select count(*)::int as n from students where coaching_center_id = $1', [center])

  /*
   * HOW MANY STUDENTS THIS RUN CREATED UNDER A NAME, which is not the same question as
   * how many carry it — and the difference is the whole point of running against the real
   * database.
   *
   * `students` is not empty here the way pglite's is. There are three live centres in it,
   * one of them a paying customer's, and on 2026-09-03 somebody there admitted a student
   * called Nadia Islam. The assertion below used to read "no student anywhere is named
   * Nadia Islam", which was a statement about a fixture when it was written and is a
   * statement about a stranger's roster now: it went red on a real admission while every
   * policy it was guarding worked perfectly. The next common name would have done it
   * again.
   *
   * So each probe name is baselined before anything is imported, and every claim after
   * that is a delta. A row landing sideways into a third centre still shows up, which is
   * what "anywhere" was for. An unbaselined name throws rather than quietly baselining
   * itself mid-run, because a lazy baseline taken after a successful insert would read as
   * zero and pass forever.
   */
  const PROBE_NAMES = [
    'Sabbir Ahmed',
    'Nadia Islam',
    '  ali   HASAN ',
    'Farhana Akter',
    'Anon Inserted',
  ]
  const namedBefore = new Map()
  for (const name of PROBE_NAMES) {
    namedBefore.set(
      name,
      await truth('select count(*)::int as n from students where name = $1', [name]),
    )
  }
  const namedAnywhere = async (name) => {
    if (!namedBefore.has(name)) {
      throw new Error(`add ${JSON.stringify(name)} to PROBE_NAMES before asserting on it`)
    }
    const now = await truth('select count(*)::int as n from students where name = $1', [name])
    return now - namedBefore.get(name)
  }

  const beforeA = await studentsIn(centerA)
  const beforeB = await studentsIn(centerB)

  // A teacher pastes the register. The function is security invoker on purpose,
  // so there is nothing to argue with: the insert hits students_staff_admin_write
  // and raises. A definer function here would have been a hole straight through
  // the tenant boundary.
  check('a teacher cannot import a roster',
    await denied(ids.karim, IMPORT,
      [centerA, pasted(listed('Sabbir Ahmed', '+8801712345678')), uuids()]))
  check('the refused import left nothing behind',
    (await studentsIn(centerA)) === beforeA && (await namedAnywhere('Sabbir Ahmed')) === 0)

  // The centre id is an argument, so it is the argument an attacker changes.
  check("an owner cannot import into another centre's roster",
    await denied(ids.ownerA, IMPORT,
      [centerB, pasted(listed('Nadia Islam', '+8801812345678')), uuids()]))
  check("centre B's roster is untouched",
    (await studentsIn(centerB)) === beforeB && (await namedAnywhere('Nadia Islam')) === 0)

  // The real thing: four pasted lines, of which one is already on the roster
  // under different spacing and case, and one repeats a line above it.
  const imported = await importAs(ids.ownerA, centerA,
    pasted(
      listed('Sabbir Ahmed', '+8801712345678', 'Abdul Karim'),
      listed('  ali   HASAN ', '01700000000'),
      listed('Sabbir Ahmed', '+8801712345678'),
      listed('Rumana Begum', '+8801812345679'),
    ),
    uuids(bBioMorning))
  check('an owner imports the new names and skips the known one',
    imported.added === 2 && imported.already_there === 1 && imported.enrolled === 2,
    `added ${imported.added}, already ${imported.already_there}, enrolled ${imported.enrolled}`)
  check('the roster grew by exactly the new names',
    (await studentsIn(centerA)) === beforeA + 2)
  check('the same name twice in one paste is one student',
    (await namedAnywhere('Sabbir Ahmed')) === 1)

  // Whitespace and case are how a register differs from a database. If the match
  // were exact, every re-paste would double the roster.
  check('"  ali   HASAN " matched the seeded Ali Hasan',
    (await namedAnywhere('  ali   HASAN ')) === 0 &&
      (await truth('select count(*)::int as n from students where id = $1', [stAli])) === 1)

  // The reason this is a database function at all: a student whose guardian row
  // is missing is a student no SMS ever reaches, and nobody would find out until
  // a parent complained.
  check('every imported student got a primary guardian row',
    (await truth(
      `select count(*)::int as n from students s
       where s.coaching_center_id = $1 and s.name in ('Sabbir Ahmed', 'Rumana Begum')
         and not exists (
           select 1 from guardians g
           where g.student_id = s.id and g.is_primary and g.phone = s.guardian_phone
             and g.coaching_center_id = s.coaching_center_id)`,
      [centerA])) === 0)
  check("the guardian's name came across when the line had one",
    (await truth(
      `select count(*)::int as n from guardians g join students s on s.id = g.student_id
       where s.name = 'Sabbir Ahmed' and g.name = 'Abdul Karim'`)) === 1)
  check('a line with no guardian name still gets the number',
    (await truth(
      `select count(*)::int as n from guardians g join students s on s.id = g.student_id
       where s.name = 'Rumana Begum' and g.name is null
         and g.phone = '+8801812345679'`)) === 1)
  check("the enrollment took the batch's own subject",
    (await truth(
      `select count(*)::int as n from enrollments e join students s on s.id = e.student_id
       where e.batch_id = $1 and e.subject_id = $2 and s.name = 'Sabbir Ahmed'`,
      [bBioMorning, sBio])) === 1)
  check('the student already on the roster was not enrolled again',
    (await truth(
      'select count(*)::int as n from enrollments where student_id = $1 and batch_id = $2',
      [stAli, bBioMorning])) === 1)
  check('and did not collect a second guardian row',
    (await truth('select count(*)::int as n from guardians where student_id = $1',
      [stAli])) === 1)

  // Pasting the same register twice is what an owner does when the first attempt
  // looked like it had not worked.
  const again = await importAs(ids.ownerA, centerA,
    pasted(
      listed('Sabbir Ahmed', '+8801712345678', 'Abdul Karim'),
      listed('Rumana Begum', '+8801812345679'),
    ),
    uuids(bBioMorning))
  check('a second identical paste adds nobody',
    again.added === 0 && again.already_there === 2 && again.enrolled === 0,
    `added ${again.added}, already ${again.already_there}`)

  // Same guardian number, different child. Siblings must not collapse into one
  // student, which is why identity is the name AND the number, not either alone.
  const sibling = await importAs(ids.ownerA, centerA,
    pasted(listed('Sadia Ahmed', '+8801712345678')))
  check('a sibling on the same number is a second student', sibling.added === 1)

  // A batch id from the other centre. The function joins batches on the centre id
  // as well as the array, so the enrollment is dropped rather than raising — the
  // sideways hole this codebase keeps closing.
  const wrongBatch = await importAs(ids.ownerA, centerA,
    pasted(listed('Tanvir Islam', '+8801912345678')), uuids(bPhyB))
  check('a batch from the other centre enrolls nobody',
    wrongBatch.added === 1 && wrongBatch.enrolled === 0,
    `added ${wrongBatch.added}, enrolled ${wrongBatch.enrolled}`)
  check("and centre B's batch has no new members",
    (await truth('select count(*)::int as n from enrollments where batch_id = $1',
      [bPhyB])) === 1)

  // Garbage the parser would never produce, because the jsonb arrives from a
  // public endpoint and does not have to have come from our form.
  check('a jsonb object instead of an array is refused',
    await denied(ids.ownerA, IMPORT, [centerA, '{"name":"x"}', uuids()]))
  const partial = await importAs(ids.ownerA, centerA,
    pasted(
      listed('   ', '+8801912345670'),
      listed('Nusrat Jahan', null),
      listed('Nusrat Jahan', '+8801912345671'),
    ))
  check('a blank name or missing number is skipped, not fatal',
    partial.added === 1, `added ${partial.added}`)
  const empty = await importAs(ids.ownerA, centerA, pasted())
  check('an empty list is a no-op, not an error', empty.added === 0)

  // All-or-nothing. The three inserts are CTEs of one statement precisely so that
  // the enrollment failing cannot leave a student behind with no guardian row —
  // the state that sends nothing to a parent and that nobody notices for a month.
  // No realistic input can fail that last step, so the failure is bolted on. The
  // constraint lives inside its own savepoint, which is what removes it: it can
  // never outlive this block even if the attempt below throws somewhere
  // unexpected, and the whole suite rolls back regardless.
  const countBeforeBreak = await studentsIn(centerA)
  await client.query('savepoint breaking')
  await client.query(
    'alter table enrollments add constraint tmp_break check (false) not valid',
  )
  let brokeCleanly = false
  try {
    await importAs(ids.ownerA, centerA,
      pasted(listed('Farhana Akter', '+8801612345678')), uuids(bBioMorning))
  } catch {
    brokeCleanly = true
  }
  await client.query('rollback to savepoint breaking')
  await client.query('set local role postgres')
  check('a failure at the last step fails the whole import', brokeCleanly)
  check('no half-imported student was left behind',
    (await studentsIn(centerA)) === countBeforeBreak &&
      (await namedAnywhere('Farhana Akter')) === 0)
  check('and no orphan guardian row either',
    (await truth(
      "select count(*)::int as n from guardians where phone = '+8801612345678'")) === 0)

  // Every function in `public` is a PostgREST endpoint, and Supabase's default
  // privileges hand EXECUTE to anon at creation — so a migration's
  // `revoke ... from public` looks like it closed a door it never touched. This
  // suite is where that was caught, the local one having been testing a database
  // Supabase does not ship. Asked of the whole schema rather than of
  // import_students, because the point is to catch the NEXT RPC somebody adds.
  // Extension functions (citext) are excluded: granted to PUBLIC by their own
  // install script, and not ours.
  const anonCallable = (
    await client.query(
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
  check('no function in public is callable without a session',
    anonCallable.length === 0, anonCallable.join(', '))
  check('the import is still callable by a signed-in user',
    (await truth(
      `select count(*)::int as n from pg_proc p, aclexplode(p.proacl) a
       where p.proname = 'import_students' and a.privilege_type = 'EXECUTE'
         and a.grantee::regrole::text = 'authenticated'`)) === 1)

  // -------------------------------------------------------------------------
  // Attendance rate per batch — the dashboard's third number.
  //
  // The second view in this schema and the first aggregate, and both halves are
  // worth asking about on the real database rather than only in pglite. A view
  // runs as its OWNER unless told otherwise, and the owner here is whatever role
  // Supabase's pooler applied the migration as — which is the variable the whole
  // thing turns on, and the reason the fee board's view is checked live too.
  //
  // The aggregate is the new part. security_invoker means the caller's own RLS
  // decides which rows reach the count, and a count assembled from a subset of
  // the rows is not a smaller answer — it is a different answer under the same
  // column name. Ali can read his own attendance and nobody else's, so RLS alone
  // would have handed him a row labelled batch_name 'Bio Morning' carrying a
  // rate_pct that described only himself, and nothing downstream could have
  // told. That is what app.is_staff_admin inside the view is for, and what the
  // zero-row checks at the bottom are really testing.
  // -------------------------------------------------------------------------
  header('Attendance rate view (security_invoker, staff-admin only)')

  // Dated inside a past month, so the fixture does not depend on the day this
  // runs and cannot collide with the current-date session Karim took above —
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
    client.query(
      `insert into attendance_records (coaching_center_id, session_id, enrollment_id, status)
       values ($1, $2, $3, $4::attendance_status)`,
      [center, sessionId, enrollment, status],
    )

  // Bio Morning, last month: present, present, late, absent, excused. Four of
  // the five marks count and three of those are attendance, so 75%. A rate that
  // docked lateness would say 50; one that counted the excused day as an absence
  // would say 60.
  for (const [day, status] of [
    [1, 'present'], [3, 'present'], [5, 'late'], [8, 'absent'], [10, 'excused'],
  ]) {
    await mark(centerA, await heldOn(centerA, bBioMorning, 1, day), eAli, status)
  }
  // Chem Evening, last month: one absence and nothing else.
  await mark(centerA, await heldOn(centerA, bChemEvening, 1, 2), eMim, 'absent')
  // Bio Morning, the month before: one excused mark. The batch ran, so there has
  // to be a row, but there is nothing to take a percentage of.
  await mark(centerA, await heldOn(centerA, bBioMorning, 2, 4), eAli, 'excused')
  // Centre B, last month: one present, so a leak reads as a number.
  await mark(centerB, await heldOn(centerB, bPhyB, 1, 6), eB, 'present')

  const rateRow = async (userId, batch, monthsBack = 1) =>
    (
      await runAs(
        userId,
        `select sessions, present, late, absent, excused, counted, rate_pct,
                batch_name, batch_active, period_month::text as period_month
         from batch_attendance_monthly
         where batch_id = $1
           and period_month = (date_trunc('month', current_date::timestamp)
             - make_interval(months => $2::int))::date`,
        [batch, monthsBack],
      )
    ).rows[0] ?? null

  const rateRows = (userId, sql = '', params = []) =>
    n(userId, `select count(*)::int as n from batch_attendance_monthly ${sql}`, params)

  check('the owner gets one row per batch per month, and only their own centre',
    (await rateRows(ids.ownerA)) === 3)

  const bio = await rateRow(ids.ownerA, bBioMorning)
  check('five sessions, four marks counted: the excused day is not in the denominator',
    Number(bio?.sessions) === 5 && Number(bio?.counted) === 4,
    `sessions=${bio?.sessions} counted=${bio?.counted}`)
  check('late is attendance: two present plus one late over four is 75%',
    Number(bio?.rate_pct) === 75,
    `rate=${bio?.rate_pct} present=${bio?.present} late=${bio?.late} absent=${bio?.absent}`)
  check('and the batch name travels with it, so the card is readable',
    bio?.batch_name === 'Bio Morning' && bio?.batch_active === true)

  const chem = await rateRow(ids.ownerA, bChemEvening)
  check('a batch nobody attended reads 0, which is not the same fact as no rate',
    Number(chem?.rate_pct) === 0 && Number(chem?.counted) === 1,
    `rate=${chem?.rate_pct} counted=${chem?.counted}`)

  const older = await rateRow(ids.ownerA, bBioMorning, 2)
  check('a month of nothing but excused marks has a row but no rate',
    older !== null && older.rate_pct === null && Number(older.counted) === 0,
    `row=${older ? 'yes' : 'no'} rate=${older?.rate_pct} counted=${older?.counted}`)
  check('and it is its own month, not folded into the one after it',
    Boolean(older) && older.period_month !== bio?.period_month,
    `${older?.period_month} vs ${bio?.period_month}`)

  // The session Karim took earlier was never marked. Counting it would put a day
  // nobody was registered for into "how often did this batch run".
  check('a session opened and never marked produces no row at all',
    (await rateRow(ids.ownerA, bBioMorning, 0)) === null)

  check("owner A sees nothing of centre B's attendance",
    (await rateRows(ids.ownerA, 'where batch_id = $1', [bPhyB])) === 0)
  check('owner B sees their own batch through the view',
    (await rateRows(ids.ownerB)) === 1)
  check("and none of centre A's batches, by id",
    (await rateRows(ids.ownerB, 'where batch_id = $1', [bBioMorning])) === 0)

  // The three the predicate exists to rule out, and none of them is a tenant
  // leak — which is why counting another centre's rows would never have caught
  // them. Each reader can legitimately see *some* of the marks underneath, so
  // security_invoker alone would have handed each of them a row carrying a
  // batch_name and a rate_pct assembled from their own slice: Nasrin's would
  // happen to be true, Ali's would say 'Bio Morning' and describe nobody but
  // himself, and nothing downstream could have told the two apart.
  //
  // Nasrin rather than Karim, deliberately. Karim's membership was revoked
  // earlier in this suite, so a zero from him now proves the membership is gone
  // and nothing about this view. Nasrin still teaches Chem Evening, which has a
  // mark in the fixture above, so the door really is open behind her.
  const marksBelow = (userId) =>
    n(userId, 'select count(*)::int as n from attendance_records')

  check('the teacher policy really does hand Nasrin the marks under this view',
    (await marksBelow(ids.nasrin)) > 0)
  check('and the student policy hands Ali his own',
    (await marksBelow(ids.studentUser)) > 0)

  check('yet a teacher reads no batch rate, not even for the batch she teaches',
    (await rateRows(ids.nasrin)) === 0)
  check("a student cannot read their own attendance as if it were the batch's",
    (await rateRows(ids.studentUser)) === 0)
  check('nor can a guardian, for the same reason',
    (await rateRows(ids.guardianUser)) === 0)
  check('and a signed-out reader gets nothing',
    (await rateRows(null)) === 0)

  header('Who did that (audit actor, 20260811000046 + 20260811000056)')

  /*
   * The one property migration 56 rests on: the header can only FILL a null actor, never
   * replace one. Worth proving against the real trigger rather than reasoning about,
   * because the whole security argument is the order of three expressions inside a
   * coalesce, and reordering them is a one-line edit that no other gate would notice.
   *
   * Each case writes to `students` — audited, and an update of one column is the smallest
   * write that produces a log line — then reads back the line it just made.
   */
  const auditActor = async ({ jwt = null, header: hdr = null, setting = null }, name) => {
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [jwt ?? ''])
    await client.query(`select set_config('request.headers', $1, true)`, [
      hdr === null ? '' : JSON.stringify({ 'x-app-actor': hdr }),
    ])
    await client.query(`select set_config('app.actor', $1, true)`, [setting ?? ''])

    await client.query(`update students set name = $2 where id = $1`, [stMim, name])

    const { rows } = await client.query(
      `select actor from audit_log
       where entity = 'students' and entity_id = $1 and after ->> 'name' = $2
       order by created_at desc limit 1`,
      [stMim, name],
    )

    // Clear the settings again so a later section cannot inherit them.
    await client.query(`select set_config('request.headers', '', true)`)
    await client.query(`select set_config('app.actor', '', true)`)
    await client.query(`select set_config('request.jwt.claim.sub', '', true)`)

    return rows.length ? rows[0].actor : 'no line was written'
  }

  check('a write with no actor anywhere is logged as nobody',
    (await auditActor({}, 'Mim Akter A')) === null)

  check('the x-app-actor header names the actor when nothing else can',
    (await auditActor({ header: ids.ownerA }, 'Mim Akter B')) === ids.ownerA)

  // The one that matters. A request carrying a JWT is recorded as that JWT's user even
  // when a header disagrees — otherwise anybody who can reach PostgREST could stamp their
  // own writes with somebody else's id, which is precisely the accusation §10's support
  // conversation is about.
  check('a JWT outranks the header, so nobody can sign a write as somebody else',
    (await auditActor({ jwt: ids.karim, header: ids.ownerA }, 'Mim Akter C')) === ids.karim)

  check('and the transaction setting still fills a null, for a psql session',
    (await auditActor({ setting: ids.nasrin }, 'Mim Akter D')) === ids.nasrin)

  check('the setting also loses to a JWT',
    (await auditActor({ jwt: ids.karim, setting: ids.ownerA }, 'Mim Akter E')) === ids.karim)

  // A malformed header must cost the attribution and nothing else: these writes are
  // payments and plan changes, and an exception here would abort one over a bad string.
  check('a header that is not a uuid costs the name, not the write',
    (await auditActor({ header: 'rahim' }, 'Mim Akter F')) === null)
  check('nor does an empty one',
    (await auditActor({ header: '' }, 'Mim Akter G')) === null)

  // Reachable only by a holder of the service key. `authenticated` calling it directly is
  // harmless — it would read its own request's header — but the grant is what a future RPC
  // marked SECURITY DEFINER would inherit.
  check('app.request_actor is not callable by a signed-in user',
    await denied(ids.karim, 'select app.request_actor()'))
  check('nor by anyone signed out',
    await denied(null, 'select app.request_actor()'))

  header('Anonymous access')
  check('signed-out user reads no students',
    (await n(null, 'select count(*)::int as n from students')) === 0)
  check('signed-out user reads no guardian phone numbers',
    (await n(null, 'select count(*)::int as n from guardians')) === 0)
  check('signed-out user reads no centers',
    (await n(null, 'select count(*)::int as n from coaching_centers')) === 0)
  check('signed-out user cannot call the import',
    await denied(null, IMPORT,
      [centerA, pasted(listed('Anon Inserted', '+8801512345678')), uuids()]))
  check('and no anonymous student landed',
    (await namedAnywhere('Anon Inserted')) === 0)

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
