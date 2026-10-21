/**
 * Adding a teacher writes four rows, and a failure in any of the last three must stop the add.
 *
 * WHAT THIS FILE IS GUARDING. `createTeacher` inserts the teacher, then their permissions,
 * subjects and membership. The last three were awaited and their results dropped, so a
 * permissions write that failed left the teacher with no permissions row — and a missing row
 * reads as the table defaults, where marks and SMS are allowed. An owner who unticked both
 * had a teacher who could do both, behind a success message. A dropped membership left a
 * teacher with a login that opened no centre and no "give login" button to fix it.
 *
 * The fix reads each result and takes the teacher row back when one fails. These checks are
 * on the source because the action needs a live Supabase to run; the RLS suite covers the
 * policies the take-back relies on (a staff-admin may delete a teacher at their own centre).
 *
 * The second half pins the other side of the same absence: the session helpers that read a
 * missing permissions row must keep reading it the way PERMISSION_DEFAULTS and the app.*
 * helpers do — absent allows marks and SMS, and grants nothing else.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { PERMISSION_DEFAULTS } from '../src/lib/permissions.ts'

const ROOT = path.join(import.meta.dirname, '..')
/** CRLF on disk; normalised so multi-line anchors match. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const ACTIONS = read('src', 'app', '(app)', 'settings', 'actions.ts')
const SESSION = read('src', 'lib', 'auth', 'session.ts')

/** The body of one exported function, from its signature to the next top-level export. */
function body(source: string, signature: string): string {
  const from = source.indexOf(signature)
  assert.ok(from >= 0, `${signature} not found`)
  const next = source.indexOf('\nexport ', from + signature.length)
  return source.slice(from, next === -1 ? undefined : next)
}

const CREATE = body(ACTIONS, 'export async function createTeacher(')

test('no write in createTeacher is awaited with its result thrown away', () => {
  // A statement that starts `await supabase.from(` is a write nobody reads. Every read in
  // this action destructures, so any such line is one of the four writes, unchecked.
  assert.doesNotMatch(CREATE, /^\s*await supabase\s*\.from\(/m)
})

test('each of the three follow-on writes is read, in order, and each stops the next', () => {
  const perms = CREATE.indexOf(
    "const { error: permissionsError } = await supabase.from('teacher_permissions').insert(",
  )
  const subjects = CREATE.indexOf(
    "const { error: subjectsError } = await supabase.from('teacher_subjects').insert(",
  )
  const member = CREATE.indexOf(
    "const { error: memberError } = await supabase.from('center_members').upsert(",
  )
  assert.ok(perms >= 0 && subjects > perms && member > subjects, 'permissions, subjects, membership')

  assert.ok(CREATE.includes('let childError = permissionsError'))
  assert.ok(CREATE.includes('if (!childError && ownSubjectIds.length > 0) {'))
  assert.ok(CREATE.includes('childError = subjectsError'))
  assert.ok(CREATE.includes('if (!childError && userId) {'))
  assert.ok(CREATE.includes('childError = memberError'))

  // The membership still never resets an existing member's access.
  assert.ok(CREATE.includes("{ onConflict: 'coaching_center_id,user_id,role', ignoreDuplicates: true }"))
})

test('a failed follow-on write takes the teacher back, scoped, before any success path', () => {
  const branch = CREATE.indexOf('if (childError) {')
  assert.ok(branch >= 0)
  const arm = CREATE.slice(branch, CREATE.indexOf('\n  }\n', branch))

  // Deleted at this centre and only this row: the same two filters deleteTeacher uses.
  assert.ok(arm.includes(".from('teachers')"))
  assert.ok(arm.includes('.delete()'))
  assert.ok(arm.includes(".eq('coaching_center_id', centerId)"))
  assert.ok(arm.includes(".eq('id', teacher.id)"))
  assert.ok(arm.includes('return { error: t.errors.addFailed }'))

  // The auth account is not touched here: it may be the person's login at another centre.
  assert.doesNotMatch(arm, /deleteUser/)

  // And it comes before anything that tells the owner it worked.
  assert.ok(branch < CREATE.indexOf("revalidatePath('/settings/teachers')"))
  assert.ok(branch < CREATE.indexOf('return { ok:'))
})

test('a missing permissions row is read the way the defaults say, by every session helper', () => {
  // Absent allows: only an explicit false refuses.
  assert.equal(PERMISSION_DEFAULTS.can_manage_exams, true)
  assert.equal(PERMISSION_DEFAULTS.can_send_sms, true)
  assert.ok(SESSION.includes('!rows.some((row) => row.perms?.can_manage_exams === false)'))
  assert.ok(SESSION.includes('!rows.some((row) => row.perms?.can_send_sms === false)'))

  // Absent grants nothing: only an explicit true allows.
  assert.equal(PERMISSION_DEFAULTS.can_view_fees, false)
  assert.equal(PERMISSION_DEFAULTS.can_manage_students, false)
  assert.equal(PERMISSION_DEFAULTS.can_manage_batches, false)
  assert.ok(SESSION.includes('rows.some((row) => row.perms?.can_view_fees === true)'))
  assert.ok(SESSION.includes('rows.some((row) => row.perms?.can_manage_students === true)'))
  assert.ok(SESSION.includes('rows.some((row) => row.perms?.can_manage_batches === true)'))
})
