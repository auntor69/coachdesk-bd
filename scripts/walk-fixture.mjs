/**
 * Builds a throwaway centre to walk permission screens in, and tears it down.
 *
 *   node --env-file=.env.local scripts/walk-fixture.mjs up
 *   node --env-file=.env.local scripts/walk-fixture.mjs status
 *   node --env-file=.env.local scripts/walk-fixture.mjs down
 *
 * Why this exists. Half of what needs walking in a browser only shows up for a
 * teacher who is *not* the owner: a permission checkbox does nothing to an owner,
 * because every canX() answers true from the role before it reaches a query. The
 * demo account owns its own centre, so the only non-owner seat it held was at a
 * real customer's centre — and putting a scratch exam and a flipped permission
 * into somebody's live data to look at a screen is the kind of shortcut that gets
 * noticed by the person whose data it is.
 *
 * So: a centre of our own, owned by an account nobody can sign in to (created
 * with no password), with the demo account seated in it as a plain teacher. Plan
 * 'center', because these screens are the centre product's; the free teacher
 * tiers have no staff and therefore no permissions to test.
 *
 * `down` deletes the centre, and every row here hangs off it by
 * `on delete cascade`, so the teardown is one statement plus the owner account.
 * Run it. A scratch centre left behind is a third centre in the demo account's
 * switcher and a wrong number on every "how many centres" answer after it.
 */
import pg from 'pg'

const CENTER_NAME = 'Walkthrough Scratch Center'
const OWNER_EMAIL = 'walk-owner@scratch.coachdesk.invalid'

/** Whose seat the scratch teacher is. Overridable so a second account can walk. */
const TEACHER_EMAIL =
  process.argv[3] ?? '8801711000001@phone.coachdesk.invalid'

const command = process.argv[2]
if (!['up', 'down', 'status', 'perm'].includes(command)) {
  console.error('usage: walk-fixture.mjs <up|down|status> [teacher-email]')
  console.error('       walk-fixture.mjs perm <can_manage_exams|...> <on|off|clear>')
  process.exit(1)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const dbUrl = process.env.SUPABASE_DB_URL

if (!supabaseUrl || !serviceKey || !dbUrl) {
  console.error(
    'Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL in .env.local.',
  )
  process.exit(1)
}

const url = new URL(dbUrl)
const db = new pg.Client({
  host: url.hostname,
  port: Number(url.port || 5432),
  database: url.pathname.replace(/^\//, '') || 'postgres',
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

await db.connect()

/**
 * The auth admin API, which is the only way to make a user: auth.users stores a
 * bcrypt hash, so an INSERT would have to know how GoTrue salts it.
 */
const admin = async (path, init = {}) => {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const body = await response.text()
  if (!response.ok) {
    // The key itself must never reach a log, and an error body from GoTrue does
    // not contain it — but the URL might, so only the status and message go out.
    throw new Error(`admin ${path} -> ${response.status} ${body.slice(0, 300)}`)
  }
  return body ? JSON.parse(body) : null
}

const userIdByEmail = async (email) => {
  const { rows } = await db.query('select id from auth.users where email = $1', [email])
  return rows[0]?.id ?? null
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0]

// ---------------------------------------------------------------------------

if (command === 'status') {
  const { rows } = await db.query(
    `select c.id, c.name, c.plan,
            (select count(*) from teachers t where t.coaching_center_id = c.id) as teachers,
            (select count(*) from students s where s.coaching_center_id = c.id) as students,
            (select count(*) from exams e where e.coaching_center_id = c.id) as exams
       from coaching_centers c where c.name = $1`,
    [CENTER_NAME],
  )
  if (!rows.length) {
    console.log('no scratch centre — clean')
  } else {
    for (const row of rows) {
      console.log(
        `${row.name}  plan=${row.plan}  teachers=${row.teachers}  students=${row.students}  exams=${row.exams}`,
      )
      const { rows: perms } = await db.query(
        `select t.name, p.can_manage_exams, p.can_send_sms, p.can_view_fees
           from teachers t
           left join teacher_permissions p on p.teacher_id = t.id
          where t.coaching_center_id = $1`,
        [row.id],
      )
      for (const p of perms) {
        console.log(
          `  ${p.name}: exams=${p.can_manage_exams ?? '(no row)'} sms=${p.can_send_sms ?? '(no row)'} fees=${p.can_view_fees ?? '(no row)'}`,
        )
      }
    }
  }
  const owner = await userIdByEmail(OWNER_EMAIL)
  console.log(owner ? `scratch owner account: present` : 'scratch owner account: absent')
  await db.end()
  process.exit(0)
}

/**
 * Flips one checkbox on the scratch teacher, because half of a permission walk is
 * the positive control: a screen that stays shut after the owner ticks the box is
 * not a permission, it is a bug that happened to look like one.
 *
 * `clear` deletes the row rather than setting anything, which is a third state and
 * not the same as `off` — can_manage_exams and can_send_sms read an absent row as
 * allowed and can_view_fees reads it as denied.
 */
if (command === 'perm') {
  const PERMS = [
    'can_manage_exams',
    'can_send_sms',
    'can_view_fees',
    'can_manage_students',
    'can_manage_batches',
  ]
  const [, , , key, value] = process.argv
  if (!PERMS.includes(key) || !['on', 'off', 'clear'].includes(value)) {
    console.error(`usage: walk-fixture.mjs perm <${PERMS.join('|')}> <on|off|clear>`)
    await db.end()
    process.exit(1)
  }

  const teacher = await one(
    `select t.id from teachers t
       join coaching_centers c on c.id = t.coaching_center_id
      where c.name = $1 and t.user_id is not null`,
    [CENTER_NAME],
  )
  if (!teacher) {
    console.error('no scratch centre — run `up` first')
    await db.end()
    process.exit(1)
  }

  if (value === 'clear') {
    await db.query('delete from teacher_permissions where teacher_id = $1', [teacher.id])
    console.log(`${key}: row deleted (absent)`)
  } else {
    await db.query(
      `insert into teacher_permissions (teacher_id, coaching_center_id, ${key})
       select $1, t.coaching_center_id, $2 from teachers t where t.id = $1
       on conflict (teacher_id) do update set ${key} = excluded.${key}`,
      [teacher.id, value === 'on'],
    )
    console.log(`${key}: ${value}`)
  }

  const row = await one(
    `select can_manage_exams, can_send_sms, can_view_fees
       from teacher_permissions where teacher_id = $1`,
    [teacher.id],
  )
  console.log(row ? JSON.stringify(row) : '(no permissions row)')
  await db.end()
  process.exit(0)
}

if (command === 'down') {
  const { rowCount } = await db.query('delete from coaching_centers where name = $1', [
    CENTER_NAME,
  ])
  console.log(rowCount ? 'centre deleted (cascade)' : 'no scratch centre to delete')

  const owner = await userIdByEmail(OWNER_EMAIL)
  if (owner) {
    await admin(`users/${owner}`, { method: 'DELETE' })
    console.log('scratch owner account deleted')
  } else {
    console.log('no scratch owner account to delete')
  }
  await db.end()
  process.exit(0)
}

// ---------------------------------------------------------------------------
// up
// ---------------------------------------------------------------------------

const teacherUser = await userIdByEmail(TEACHER_EMAIL)
if (!teacherUser) {
  console.error(`No account for ${TEACHER_EMAIL}. Sign it up first.`)
  await db.end()
  process.exit(1)
}

const existing = await one('select id from coaching_centers where name = $1', [CENTER_NAME])
if (existing) {
  console.error('A scratch centre already exists. Run `down` first.')
  await db.end()
  process.exit(1)
}

// No password. The account exists to own a row and to be the "someone else" that
// makes the demo account a subordinate; being unable to sign in is the point.
let ownerUser = await userIdByEmail(OWNER_EMAIL)
if (!ownerUser) {
  const created = await admin('users', {
    method: 'POST',
    body: JSON.stringify({
      email: OWNER_EMAIL,
      email_confirm: true,
      user_metadata: { full_name: 'Scratch Owner', locale: 'bn' },
    }),
  })
  ownerUser = created.id
  console.log('created scratch owner account (no password)')
}

const center = await one(
  `insert into coaching_centers (name, plan, created_by, sms_credit_balance)
   values ($1, 'center', $2, 200) returning id`,
  [CENTER_NAME, ownerUser],
)

// The claim trigger seats created_by as owner. Everything below is the demo
// account's seat, and it is a teacher seat only — no owner row, or none of this
// tests anything.
await db.query(
  `insert into center_members (coaching_center_id, user_id, role) values ($1, $2, 'teacher')`,
  [center.id, teacherUser],
)

const subject = await one(
  `insert into subjects (coaching_center_id, name, name_bn) values ($1, 'Mathematics', $2)
   returning id`,
  [center.id, 'গণিত'],
)

const teacher = await one(
  `insert into teachers (coaching_center_id, user_id, name, phone)
   values ($1, $2, 'Scratch Teacher', '+8801711000001') returning id`,
  [center.id, teacherUser],
)

// A second teacher with nobody behind it, so the exam belongs to someone and the
// teachers list is not a list of one.
const otherTeacher = await one(
  `insert into teachers (coaching_center_id, name) values ($1, 'Other Teacher') returning id`,
  [center.id],
)

const batch = await one(
  `insert into batches (coaching_center_id, subject_id, teacher_id, name, slot,
                        start_time, end_time, monthly_fee_bdt)
   values ($1, $2, $3, 'Scratch SSC Maths', 'evening', '17:00', '18:30', 1000)
   returning id`,
  [center.id, subject.id, teacher.id],
)

// A batch that is somebody else's, so "only my batches" has something to exclude.
await db.query(
  `insert into batches (coaching_center_id, subject_id, teacher_id, name, slot, monthly_fee_bdt)
   values ($1, $2, $3, 'Scratch Morning Maths', 'morning', 1000)`,
  [center.id, subject.id, otherTeacher.id],
)

const students = []
for (const [code, name, phone] of [
  ['W01', 'Scratch Student One', '+8801711000011'],
  ['W02', 'Scratch Student Two', '+8801711000012'],
  ['W03', 'Scratch Student Three', '+8801711000013'],
]) {
  const student = await one(
    `insert into students (coaching_center_id, name, student_code, guardian_name, guardian_phone)
     values ($1, $2, $3, 'Scratch Guardian', $4) returning id`,
    [center.id, name, code, phone],
  )
  const enrollment = await one(
    `insert into enrollments (coaching_center_id, student_id, subject_id, batch_id)
     values ($1, $2, $3, $4) returning id`,
    [center.id, student.id, subject.id, batch.id],
  )
  students.push({ ...student, enrollment: enrollment.id })
}

const exam = await one(
  `insert into exams (coaching_center_id, subject_id, batch_id, teacher_id, title,
                      total_marks, pass_marks, exam_date)
   values ($1, $2, $3, $4, 'Scratch Weekly Test', 50, 20,
           (now() at time zone 'Asia/Dhaka')::date) returning id`,
  [center.id, subject.id, batch.id, teacher.id],
)

// One mark already entered and one absence, so a read-only sheet has something to
// be read-only about. The third row stays blank, which is the state that used to
// look editable.
await db.query(
  `insert into exam_results (coaching_center_id, exam_id, enrollment_id, obtained_marks, note)
   values ($1, $2, $3, 38, 'Careless in the last two')`,
  [center.id, exam.id, students[0].enrollment],
)
await db.query(
  `insert into exam_results (coaching_center_id, exam_id, enrollment_id, is_absent)
   values ($1, $2, $3, true)`,
  [center.id, exam.id, students[1].enrollment],
)

// The reason for all of the above: the owner has unticked "Exams & marks".
await db.query(
  `insert into teacher_permissions (teacher_id, coaching_center_id, can_manage_exams, can_send_sms)
   values ($1, $2, false, true)`,
  [teacher.id, center.id],
)

console.log(`
centre:   ${CENTER_NAME} (plan center)
owner:    ${OWNER_EMAIL} — no password, cannot sign in
teacher:  ${TEACHER_EMAIL} — seated as teacher, can_manage_exams = false
batches:  Scratch SSC Maths (theirs), Scratch Morning Maths (not theirs)
students: 3 enrolled, exam "Scratch Weekly Test" with 1 mark and 1 absent

Switch to it from the centre picker in the header, then walk /exams.
Run \`down\` when finished.`)

await db.end()
