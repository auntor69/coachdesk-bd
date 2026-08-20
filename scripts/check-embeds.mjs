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
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.')
  process.exit(1)
}

/** Every embed shape in src/, with where it is used, so a failure names a file. */
const embeds = [
  ['exams/page.tsx', 'exams', 'id, title, total_marks, exam_date, sms_sent_at, sms_declined_at, batches (name), subjects (name, name_bn), exam_results (id)'],
  ['exams/[examId]/page.tsx', 'exams', 'id, title, total_marks, pass_marks, exam_date, batch_id, sms_sent_at, sms_declined_at, batches (name), subjects (name, name_bn), exam_types (name, name_bn)'],
  ['exams/[examId]/page.tsx', 'enrollments', 'id, students (id, name, student_code)'],
  ['exams/[examId]/page.tsx', 'teachers', 'id, teacher_permissions (can_send_sms)'],
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
  // Nearly the exam screen's shape, from a different file, and listed separately
  // because that is the point of naming the file: this one decides whether a
  // teacher is shown the fee board at all and which batches /teach calls theirs,
  // and an embed PostgREST cannot resolve would answer "no permission" and "no
  // batches" rather than failing loudly.
  ['lib/auth/session.ts', 'teachers', 'id, teacher_permissions (can_view_fees)'],
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
