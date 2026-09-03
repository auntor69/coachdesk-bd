/**
 * Adding somebody to the payroll: six short fields, two across.
 *
 * WHAT THIS FILE IS GUARDING. §20.8 step 7's other add screen, and the defect is §26's
 * second shape rather than the teacher form's. This was one column of full-width boxes at
 * every width: a date input 704px wide on a laptop and 1,216 on a monitor, for a field
 * that holds ten characters.
 *
 * There is no rail here and there should not be one. The screen has one subject — a
 * record, and not a login or a salary, both of which are other screens on purpose — so
 * there is nothing to put beside the form and a rail holding nothing is worse than none.
 * The width is spent inside instead: capped at `max-w-3xl`, two columns from `sm`, and the
 * two fields that hold a sentence spanning both.
 *
 * This file also fails if the screen grows a seat count or a cap, because staff are not
 * priced per head, and if a login tick or a salary box appears among the fields.
 *
 * §38 is the other half: the form still writes every field it wrote.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
/** Normalised: both of these files are CRLF on disk, and a multi-line anchor written
 *  with `\n` would silently match nothing. See add-teacher.test.ts. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const HERE = ['src', 'app', '(app)', 'settings', 'staff', 'new']
const PAGE = read(...HERE, 'page.tsx')
const FORM = read(...HERE, 'employee-form.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** See plan-page.test.ts: the lookbehind keeps `border-2` and `sm:col-span-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s`])order-(\d+|last)\b/g)].map((m) => m[1])
}

/* -------------------------------------------------------------------------- */
/* The page: a letterhead, a capped refusal, and deliberately no figure       */
/* -------------------------------------------------------------------------- */

test('the page holds no grid, because the form is where the width is spent', () => {
  assert.doesNotMatch(PAGE, /grid-cols/)
  assert.deepEqual(ordersIn(PAGE), [])
})

test('both shapes of this screen draw the same heading', () => {
  // The locked shape had no h1 at all, so a bookmark landed a reader on a card about
  // their plan with nothing above it naming the screen that had refused them.
  assert.equal(count(PAGE, 'text-xl font-bold text-ink lg:text-2xl'), 2)
  assert.equal(count(PAGE, '>{t.newTitle}</h1>'), 2)
  assert.doesNotMatch(PAGE, /font-bold text-ink"/, 'no heading left in the old hand')
})

test('the refusal is capped rather than set across the page', () => {
  assert.equal(count(PAGE, 'flex max-w-2xl flex-col gap-5'), 1)
})

test('there is no seat count here, because staff are not priced per head', () => {
  // The teacher screen carries one and this one must not grow one: `staffManagement` is
  // bought or it is not, and a centre that has it employs as many people as it employs.
  assert.doesNotMatch(PAGE, /t\.count\(/)
  assert.doesNotMatch(PAGE, /t\.used\(/)
  assert.doesNotMatch(PAGE, /count: 'exact'/, 'and no head-count query to base one on')
  assert.doesNotMatch(PAGE, /wouldExceed/)
})

test('the reads and the gate the redesign moved past are unchanged', () => {
  // §38. One query on this screen, and it comes after the plan card so a centre without
  // the capability still costs nothing.
  assert.ok(PAGE.includes("await pageCapability('staff')"))
  assert.ok(PAGE.includes("if (!has(session.plan, 'staffManagement')) {"))
  assert.ok(PAGE.includes('await branchChoicesFor(await createClient(), session)'))
  assert.ok(PAGE.includes('EMPLOYEE_ROLES.map((role) => ({ value: role, label: t.roles[role] }))'))

  for (const prop of ['t={d.staffForm}', 'roles={roles}', 'common={d.common}',
    'today={todayInDhaka()}', 'branchPick={d.branchPick}', 'branches={branches}'])
    assert.ok(PAGE.includes(prop), prop)
})

/* -------------------------------------------------------------------------- */
/* The form: capped, two across from sm, and the sentences spanning both      */
/* -------------------------------------------------------------------------- */

test('the form is capped and its short fields pair up from sm', () => {
  assert.ok(FORM.includes('<form action={action} className="flex max-w-3xl flex-col gap-4">'))
  assert.equal(count(FORM, '<div className="grid gap-4 sm:grid-cols-2 sm:items-end">'), 1)

  // `sm` and not `lg`: a role, a job title, a phone number and a date are each narrower
  // than a 328px column, and waiting for `lg` leaves a tablet on one box per line.
  assert.doesNotMatch(FORM, /lg:grid-cols/)
  assert.doesNotMatch(FORM, /grid-cols-12/, 'the page owns twelve columns, not the form')
  assert.deepEqual(ordersIn(FORM), [], 'source order is reading order')
})

test('the two fields that hold a sentence span both columns, and only those two', () => {
  assert.equal(count(FORM, '<div className="sm:col-span-2">'), 2)
  assert.ok(FORM.includes('<div className="sm:col-span-2">\n          <Field\n            label={t.nameLabel}'))
  assert.ok(FORM.includes(
    '<div className="sm:col-span-2">\n          <Field\n            label={`${t.noteLabel}'))
})

test('the fields are in the order they are read in', () => {
  const name = FORM.indexOf('name="name"')
  const role = FORM.indexOf('name="role"')
  const designation = FORM.indexOf('name="designation"')
  const branch = FORM.indexOf('<BranchPicker')
  const phone = FORM.indexOf('name="phone"')
  const joined = FORM.indexOf('name="joinedOn"')
  const note = FORM.indexOf('name="note"')
  const submit = FORM.indexOf('type="submit"')

  assert.ok(name < role && role < designation, 'who, what they do, which kind')
  assert.ok(designation < branch && branch < phone, 'then where, then how to reach them')
  assert.ok(phone < joined && joined < note && note < submit)
})

test('nothing here is a button stretched to the width of the form', () => {
  assert.equal(count(FORM, 'className="self-start"'), 1)
  assert.ok(FORM.includes('<Button type="submit" disabled={pending} className="self-start">'))
  assert.doesNotMatch(FORM, /full disabled=\{pending\}/)
  assert.doesNotMatch(FORM, /submit" full/)
})

test('this screen makes a record and not an account, and the layout keeps it that way', () => {
  // The two things a reader looks for here and will not find, both on purpose: access is
  // a membership row the teachers screen writes, and what somebody is paid is payroll's.
  assert.doesNotMatch(FORM, /name="wantsLogin"/)
  assert.doesNotMatch(FORM, /type="password"/)
  assert.doesNotMatch(FORM, /name="salary"/)
  assert.doesNotMatch(FORM, /name="password"/)
})

test('four of the six fields stay optional, and the layout must not change that', () => {
  // Two of six matter — a name and what they do — because the person typing is often a
  // receptionist writing down the new cleaner without their number to hand.
  assert.ok(FORM.includes('label={`${t.designationLabel} (${common.optional})`}'))
  assert.ok(FORM.includes('label={`${t.phoneLabel} (${common.optional})`}'))
  assert.ok(FORM.includes('label={`${t.noteLabel} (${common.optional})`}'))

  // The slice is each optional field itself, so a `required` on the name above does not
  // satisfy it. Three required fields in the file and no more.
  for (const [from, to] of [['name="designation"', 'app.payee_branch'],
    ['name="phone"', 'Defaulted to today'], ['name="note"', '</div>']]) {
    const start = FORM.indexOf(from)
    const end = FORM.indexOf(to, start)
    assert.ok(start >= 0 && end > start, from)
    assert.doesNotMatch(FORM.slice(start, end), /required/, from)
  }
  // Three required attributes in the file and no more. Not counted with `count`: the
  // select's comment says the word in backticks, and a comment is a substring like any
  // other, so the fourth match was prose.
  assert.equal([...FORM.matchAll(/(?<!`)required(?!`)/g)].length, 3,
    'the name, the role and the joining date')
})

test('the form still writes every field it wrote', () => {
  // §38. The redesign paired six boxes up; it did not touch a name, a floor or a ceiling.
  assert.ok(FORM.includes('const result = await addEmployee(prev, formData)'))
  assert.ok(FORM.includes("if (result?.ok) router.push('/settings/staff')"))

  for (const field of ['name', 'role', 'designation', 'phone', 'joinedOn', 'note'])
    assert.ok(FORM.includes(`name="${field}"`), field)

  assert.ok(FORM.includes('maxLength={MAX_NAME}'))
  assert.ok(FORM.includes('maxLength={MAX_LABEL}'))
  assert.ok(FORM.includes('maxLength={MAX_TEXT}'))
  assert.ok(FORM.includes('<BranchPicker t={branchPick} branches={branches} current={null} />'))

  // The select opens on nothing rather than on `other`, which is the column default and
  // exactly the answer nobody means.
  assert.ok(FORM.includes('<select name="role" required defaultValue="" className={SELECT_CLASS}>'))
  assert.ok(FORM.includes('<option value="">—</option>'))

  // Today, and no later: a date in the future puts somebody on this month's payroll
  // before they have worked a day of it.
  assert.ok(FORM.includes('defaultValue={today}'))
  assert.ok(FORM.includes('min={EARLIEST_JOIN}'))
  assert.ok(FORM.includes('max={today}'))
  assert.ok(FORM.includes("const EARLIEST_JOIN = '2000-01-01'"))
})
