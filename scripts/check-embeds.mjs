/**
 * Asks the live PostgREST API to resolve every embedded select the app uses.
 *
 * Why this exists: PostgREST does not read our code, it reads pg_constraint. It
 * decides what `batches (name)` means by looking for a foreign key between the
 * two tables. 20260811000005 dropped all 36 of those foreign keys and replaced
 * them with composite ones on (sibling_id, coaching_center_id), which changes
 * both their names and their shape.
 *
 * That leaves a specific, plausible failure: coaching_center_id now takes part
 * in several foreign keys on the same table — batches alone has four — and if
 * PostgREST cannot decide which one an embed means, it answers PGRST201
 * ("more than one relationship found") and the page renders empty. RLS would
 * still be intact; the screen would just be blank, which is the kind of bug that
 * looks like a data problem for a day before anyone suspects a constraint.
 *
 * A type check cannot catch it and the RLS suite cannot either — both talk to
 * Postgres directly, and this is the layer above. So ask the real API.
 *
 * Uses the anon key, so RLS applies and every response is legitimately empty:
 * we are checking that the *relationship resolves*, not that rows come back.
 * An embed that PostgREST cannot parse fails with 400 before RLS is consulted,
 * which is exactly the signal we want.
 *
 * Run: node --env-file=.env.local scripts/check-embeds.mjs
 */
import { readFileSync } from 'node:fs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.')
  process.exit(1)
}

/**
 * The at-risk column list, read out of the module that owns it.
 *
 * Copied here as a literal it would be two hand-typed copies of twenty-one column
 * names, and the copy that went stale would be this one — which is the check, so
 * it would go on passing while the app 400ed. check-scoping.mjs reads types.ts the
 * same way and for the same reason.
 */
const riskColumns = (() => {
  const source = readFileSync(
    new URL('../src/lib/students/risk.ts', import.meta.url),
    'utf8',
  )
  const match = source.match(/export const RISK_COLUMNS\s*=\s*\n?\s*'([^']+)'/)
  if (!match) {
    console.error(
      'check-embeds: could not find RISK_COLUMNS in src/lib/students/risk.ts.\n' +
        'If it was renamed or reformatted, update the pattern here — a silently\n' +
        'skipped check is worse than a failing one.',
    )
    process.exit(1)
  }
  return match[1]
})()

/** Every embed shape in src/, with where it is used, so a failure names a file. */
const embeds = [
  ['exams/page.tsx', 'exams', 'id, title, total_marks, exam_date, sms_sent_at, sms_declined_at, batches (name), subjects (name, name_bn), exam_results (id)'],
  ['exams/[examId]/page.tsx', 'exams', 'id, title, total_marks, pass_marks, exam_date, batch_id, sms_sent_at, sms_declined_at, batches (name), subjects (name, name_bn), exam_types (name, name_bn)'],
  ['exams/[examId]/page.tsx', 'enrollments', 'id, students (id, name, student_code)'],
  ['exams/new/page.tsx', 'batches', 'id, name, slot, subjects (name, name_bn)'],
  ['fees/actions.ts', 'enrollments', 'id, student_id, batches (monthly_fee_bdt)'],
  ['me/page.tsx', 'exam_results', 'id, obtained_marks, is_absent, exams (title, total_marks, exam_date)'],
  ['settings/batches/page.tsx', 'batches', 'id, name, slot, start_time, end_time, monthly_fee_bdt, active, subjects (name, name_bn), teachers (name), batch_schedules (day_of_week), enrollments (id, status)'],
  ['settings/exam-types/page.tsx', 'exam_types', 'id, name, name_bn, exams (id)'],
  ['settings/students/page.tsx', 'students', 'id, name, student_code, guardian_phone, class_level, institution, status, sms_opt_out, enrollments (id, status, batches (name))'],
  ['settings/students/new/page.tsx', 'batches', 'id, name, slot, subjects (name, name_bn)'],
  ['settings/subjects/page.tsx', 'subjects', 'id, name, name_bn, subject_kind, active, batches (id)'],
  // The one that worried me most: teachers reaches three ways at once, and
  // teacher_subjects is a junction table PostgREST may try to collapse.
  ['settings/teachers/page.tsx', 'teachers', 'id, name, phone, active, user_id, teacher_permissions (can_manage_students, can_manage_exams, can_send_sms, can_view_fees, can_manage_batches), teacher_subjects (subjects (name, name_bn)), batches (id, active)'],
  ['teach/page.tsx', 'batches', 'id, name, slot, start_time, end_time, subjects (name, name_bn), batch_schedules (day_of_week, start_time, end_time), enrollments (id, status)'],
  ['teach/[batchId]/page.tsx', 'batches', 'id, name, slot, start_time, end_time, teacher_id, subjects (name, name_bn)'],
  ['teach/[batchId]/page.tsx', 'enrollments', 'id, students (id, name, student_code)'],
  ['teach/[batchId]/page.tsx', 'attendance_sessions', 'id, note, attendance_records (enrollment_id, status)'],
  ['lib/auth/session.ts', 'center_members', 'coaching_center_id, role, branch_id, coaching_centers (name, plan, sms_credit_balance)'],
  // The busiest embed in the app, and the one whose failure would be quietest:
  // this single row answers which batches /teach calls theirs, whether the fee
  // board is drawn, whether the marks sheet is editable, and whether the SMS
  // button appears. An embed PostgREST could not resolve would answer "no
  // batches" and "no permission" to all four rather than failing loudly.
  ['lib/auth/session.ts', 'teachers', 'id, teacher_permissions (can_manage_exams, can_send_sms, can_view_fees)'],
  // Three hops, and the last one is the guardian phone the result SMS goes to.
  ['lib/sms/result-dispatch.ts', 'exam_results', 'id, obtained_marks, is_absent, note, enrollments (id, students (id, name, guardian_phone, sms_opt_out, guardians (id, phone, is_primary, sms_opt_out)))'],
  // The fee board reads a view, not a table, and it is here for a different
  // reason than the embeds. PostgREST serves views through the same schema cache
  // as tables, so a view added by a migration stays invisible to the API until
  // that cache reloads — and the failure looks like a 404 on a relation that
  // plainly exists in psql. There are deliberately no embeds in these two: a join
  // with an aggregate in it is not something PostgREST can always resolve through
  // a view, so the student's name is a column of the view instead.
  ['fees/page.tsx', 'fee_invoice_balances', 'id, student_name, student_code, amount_bdt, discount_bdt, net_bdt, paid_bdt, remaining_bdt, due_date, period_month, guardian_phone, sms_opt_out'],
  ['fees/page.tsx', 'fee_reminders', 'invoice_id, channel, created_at'],
  ['fees/actions.ts', 'fee_invoice_balances', 'id, student_id, student_name, remaining_bdt, voided_at'],
  ['dashboard/page.tsx', 'fee_invoice_balances', 'id, student_name, remaining_bdt, due_date, guardian_phone'],
  // student_risk is here for the schema-cache reason above and for a second one:
  // its select is twenty-one column names shared by two screens. PostgREST parses
  // the column list before RLS, so a typo there is a 400 at runtime rather than a
  // wrong number — but it is a 400 on the owner's home screen, and nothing else in
  // the gate would see it. The list is read from RISK_COLUMNS above, so this checks
  // the string the app actually sends.
  ['dashboard/page.tsx + at-risk/page.tsx', 'student_risk', riskColumns],
]

let passed = 0
const failures = []

for (const [where, table, select] of embeds) {
  const endpoint = `${url}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`
  const response = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })

  if (response.ok) {
    passed++
    console.log(`  OK    ${table} <- ${where}`)
    continue
  }

  const body = await response.json().catch(() => ({}))
  failures.push({ where, table, status: response.status, body })
  console.log(`  FAIL  ${table} <- ${where}  [${response.status} ${body.code ?? ''}]`)
  console.log(`        ${body.message ?? ''}`)
  if (body.details) console.log(`        ${body.details}`)
  if (body.hint) console.log(`        hint: ${body.hint}`)
}

console.log(`\n${passed}/${embeds.length} embedded selects resolve against live PostgREST.`)

if (failures.length > 0) {
  console.error(
    `
${failures.length} embed(s) no longer resolve. If the code is PGRST201, the embed
is ambiguous and needs to name its constraint explicitly:

  subjects!batches_subject_id_center_fkey (name, name_bn)

If it is PGRST200, PostgREST has not reloaded its schema cache since the
migration — send NOTIFY pgrst, 'reload schema' and try again before changing
any code.`,
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// And the doors that must stay shut.
//
// Every function in `public` is an endpoint at POST /rest/v1/rpc/<name>. The SMS
// worker's are the most dangerous in the schema: one marks a message sent, two
// credit a balance an owner cannot otherwise move by a single taka. They are
// granted to service_role alone.
//
// This is asked of the live project rather than only of the local suite because
// the local suite cannot fully prove it. Supabase ships its own default
// privileges — `grant all on functions to postgres, anon, authenticated,
// service_role` — so a function is handed to both browser-facing roles at the
// instant it is created, and the idiomatic `revoke all ... from public` does not
// touch either grant. pg-harness reproduces those defaults deliberately, but a
// harness that models a platform is a guess about the platform. This asks it.
//
// claim_sms_batch is deliberately NOT probed here. A successful probe would claim
// a real centre's message and leave it in 'sending' for ten minutes, and until
// the cron endpoint is live nothing would come back for it — a check that damages
// what it is checking. Its grant is identical to these three, written in the same
// migration by the same four lines, so the failure mode this catches is covered;
// its own ACL is asserted from the catalogue in test-rls.mjs.
// ---------------------------------------------------------------------------

/**
 * Each probe uses the function's REAL signature, so a 404 means "not exposed"
 * rather than "no such overload" — and each is harmless if it does execute:
 * finish_sms on the nil uuid finds no row and returns 'missing', and the other
 * two only tidy a queue that a worker would tidy anyway.
 */
const closedRpcs = [
  ['finish_sms', { p_id: '00000000-0000-0000-0000-000000000000', p_ok: false }],
  ['cancel_opted_out_sms', {}],
  ['reap_stranded_sms', {}],
]

console.log('\nServer-only RPCs, asked with the anon key:')

let shut = 0
const open = []

for (const [name, body] of closedRpcs) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (response.status === 401 || response.status === 403) {
    shut++
    console.log(`  SHUT  ${name} (${response.status})`)
    continue
  }

  const detail = await response.json().catch(() => ({}))
  open.push({ name, status: response.status, code: detail.code, message: detail.message })
  console.log(`  OPEN  ${name} [${response.status} ${detail.code ?? ''}] ${detail.message ?? ''}`)
}

console.log(`${shut}/${closedRpcs.length} server-only RPCs refuse an anonymous call.`)

if (open.length > 0) {
  const cacheOnly = open.every((o) => o.code === 'PGRST202')
  console.error(
    cacheOnly
      ? `
INCONCLUSIVE — PostgREST cannot see these functions yet, so "not callable" here
means "not in the schema cache", which is not the same as "not granted". Send

  notify pgrst, 'reload schema';

and run this again. Do not read the 404 as a pass.`
      : `
SERVER-ONLY RPC IS PUBLICLY CALLABLE — ${open.length} of them, with no session.

Revoking PUBLIC is not enough on Supabase: the project's default privileges hand
EXECUTE to anon and authenticated by name at creation time, and PUBLIC is a
different grantee. Fix it in a new migration, naming the roles:

  revoke all on function public.<name>(<args>) from anon, authenticated, public;
  grant execute on function public.<name>(<args>) to service_role;`,
  )
  process.exit(1)
}
