/**
 * Adding a teacher: the record on the left, what they may do on the right.
 *
 * WHAT THIS FILE IS GUARDING. §20.8 step 7's last screen, and the defect was height rather
 * than width. A name, a number, a building, the subject ticks, five permissions with a line
 * of explanation each and the login opt-in were one column at every width: on a laptop the
 * submit sat two scrolls below the name, and the login decision — the one an owner comes
 * here to make — was off screen when the form loaded.
 *
 * The split lives on the `<form>` and not on the page, because one form has to hold both
 * halves. So the page's own share is the letterhead, the seat count the list screen also
 * carries, and two refusals that are capped rather than stretched.
 *
 * §19 has a foothold here too: the phone box must never become required, and this file
 * fails if a `required` appears inside it.
 *
 * §38 is the other half: the form still writes every field it wrote.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
/** Normalised: unlike the two roster screens, both of these files are CRLF on disk, and a
 *  multi-line anchor written with `\n` would silently match nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const HERE = ['src', 'app', '(app)', 'settings', 'teachers']
const PAGE = read(...HERE, 'new', 'page.tsx')
const FORM = read(...HERE, 'new', 'teacher-form.tsx')
const LIST = read(...HERE, 'page.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** See plan-page.test.ts: the lookbehind keeps `border-2` and `lg:col-span-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s`])order-(\d+|last)\b/g)].map((m) => m[1])
}

/* -------------------------------------------------------------------------- */
/* The page: a letterhead, a seat count, and two capped refusals             */
/* -------------------------------------------------------------------------- */

test('the page holds no grid, because the form is the thing that splits', () => {
  assert.doesNotMatch(PAGE, /grid-cols/)
  assert.deepEqual(ordersIn(PAGE), [])
})

test('all three shapes of this screen draw the same heading', () => {
  // The plan refusal had no h1 at all, so a bookmark landed a reader on a card about
  // their plan with nothing above it naming the screen that had refused them. The bar
  // carries it on all three now, and owns the h1, so a card's own title is an h2.
  assert.equal(count(PAGE, '<PageHeader'), 3)
  assert.equal(count(PAGE, 'title={t.newTitle}'), 3)
  assert.equal(count(PAGE, '<h1'), 0)
  assert.doesNotMatch(PAGE, /text-xl font-bold text-ink lg:text-2xl/)
})

test('a lapsed centre gets no form, and is not sold a bigger plan instead', () => {
  // §4.4. `createTeacher` runs requireWritable, so every field here would be typed in
  // and refused on save. The repo-wide half is in read-only.test.ts.
  assert.match(PAGE, /if \(session\.access !== 'full'\) \{/)
  assert.ok(PAGE.includes('<ReadOnlyNote t={d.readOnly} className="max-w-2xl" />'))
  assert.ok(PAGE.includes("import { ReadOnlyNote } from '@/components/read-only-note'"))

  // Above the solo card, which is a Coaching Center upsell: one ask per screen, and for a
  // centre whose own subscription has stopped the bill is the ask worth making. Seats
  // bought on a lapsed subscription are capacity nobody can use until it is settled.
  const lapsed = PAGE.indexOf("if (session.access !== 'full') {")
  assert.ok(lapsed < PAGE.indexOf('if (!hasStaff(session.plan)) {'))

  // And above both reads, so the arm costs a lapsed centre no round trips.
  assert.ok(lapsed < PAGE.indexOf('await Promise.all'))

  // The crumb is the teachers list, which still reads. The solo card goes to the hub
  // instead, because on a one-teacher plan that list is the same refusal again.
  assert.ok(PAGE.includes("back={{ href: '/settings/teachers', label: t.title }}"))
})

test('the two refusals are capped, each the way its twin on the list is', () => {
  // A refusal is two sentences. `max-w-2xl` for the plan card, and the seat-limit card
  // takes the `max-w-3xl` its identical twin on the list screen already had. The cap is
  // on the card and not the column, or the bar's background would stop 672px in.
  assert.equal(count(PAGE, '<Card className="max-w-2xl'), 1)
  assert.doesNotMatch(PAGE, /flex max-w-2xl flex-col/)
  assert.equal(count(PAGE, '<Card className="max-w-3xl">'), 1)
  assert.ok(LIST.includes('<Card className="max-w-3xl">'), 'and the list says it too')
})

test('the seat count is the line the list already carries', () => {
  // Same words, same two shapes: a bare count where the tier is uncapped, x of y where
  // it is not. An owner adding somebody is the reader most likely to want it, and it is
  // the bar's subtitle now rather than a line under a hand-rolled heading.
  assert.ok(PAGE.includes('subtitle={limit === null ? t.count(active) : t.used(active, limit)}'))
  assert.ok(LIST.includes('t.count(activeCount) : t.used(activeCount, limit)'))
  assert.ok(PAGE.includes('const limit = session.plan.maxTeachers'))
  assert.ok(PAGE.includes('const active = teacherCount ?? 0'))
})

test('the reads and the gates the redesign moved past are unchanged', () => {
  // §38, on the write that `staff` is the word for.
  assert.ok(PAGE.includes("await pageCapability('staff')"))
  assert.ok(PAGE.includes('if (!hasStaff(session.plan)) {'))
  assert.ok(PAGE.includes("wouldExceed(session.plan, 'maxTeachers', active)"))

  // Both reads scoped to the active centre: an owner of two centres passes is_staff_admin
  // for both, and an unscoped count would refuse a teacher this centre has room for.
  assert.equal(count(PAGE, ".eq('coaching_center_id', session.active.centerId)"), 2)
  assert.equal(count(PAGE, ".eq('active', true)"), 2)
  assert.ok(PAGE.includes("select('id', { count: 'exact', head: true })"))
  assert.ok(PAGE.includes(".order('name')"))
  assert.ok(PAGE.includes('branchChoicesFor(supabase, session)'))

  // `null` goes down as `null`, so the form says the ticks are missing rather than
  // letting a dropped read look like a centre with no subjects on its books.
  assert.ok(PAGE.includes('subjects &&\n    subjects.map('))
  assert.ok(PAGE.includes('localName(subject, locale)'))

  for (const prop of ['t={d.teacherForm}', 'permissions={d.teacherPermissions}',
    'common={d.common}', 'subjects={subjectOptions}', 'branchPick={d.branchPick}',
    'branches={branches}'])
    assert.ok(PAGE.includes(prop), prop)
})

/* -------------------------------------------------------------------------- */
/* The form: two halves from lg, and the width capped                         */
/* -------------------------------------------------------------------------- */

test('the form is two columns from lg, and capped so neither half runs wide', () => {
  assert.equal(count(FORM, '<div className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">'), 1)
  assert.ok(FORM.includes('<form action={formAction} className="flex max-w-5xl flex-col gap-4">'))

  // Two halves, and nothing reordered: source order is reading order, so the tab order
  // is the same order it was in one column.
  assert.equal(count(FORM, '<div className="flex flex-col gap-4">'), 2)
  assert.deepEqual(ordersIn(FORM), [])
  assert.doesNotMatch(FORM, /grid-cols-12/, 'the page owns twelve columns, not the form')
})

test('the record is the left half and the access is the right, in that order', () => {
  const name = FORM.indexOf('name="name"')
  const phone = FORM.indexOf('name="phone"')
  const branch = FORM.indexOf('<BranchPicker')
  const subjects = FORM.indexOf('{t.whichSubjects}')
  const perms = FORM.indexOf('{t.whatTheyCanDo}')
  const login = FORM.indexOf('{t.loginNow}')
  const submit = FORM.indexOf('type="submit"')

  assert.ok(name < phone && phone < branch && branch < subjects, 'who, number, where, what')
  assert.ok(subjects < perms && perms < login, 'then the two things they may do')
  assert.ok(login < submit, 'and the submit under both columns')
})

test('the subject ticks pair up from xl, where the half is 468px', () => {
  // One two-word name per row down a 468px column is a list that scrolls for no reason.
  assert.equal(count(FORM, '<div className="grid gap-2 xl:grid-cols-2">'), 1)
  // The permissions stay one per row: a label and a line of explanation each.
  assert.ok(FORM.includes('{PERMISSION_KEYS.map((key) => ('))
  assert.equal(count(FORM, '<div className="flex flex-col gap-2">'), 1)
})

test('nothing here is a button stretched to the width of the form', () => {
  // Two of them: the submit, and the one on the screen that reports the new username.
  assert.equal(count(FORM, 'className="self-start"'), 2)
  assert.ok(FORM.includes('<Button type="submit" disabled={pending} className="self-start">'))
  assert.doesNotMatch(FORM, /submit" full/)
  assert.doesNotMatch(FORM, /"button" full/)
})

test('the sentence an owner has to read out loud is capped, not set across the page', () => {
  // A minted username and a linked account both stay on this screen, and both are one
  // sentence: §26's defect inside out if it is 1,216px wide.
  assert.ok(FORM.includes('<div className="flex max-w-2xl flex-col gap-4">'))
  assert.ok(FORM.includes('if (state?.linked || state?.username) {'))
  assert.ok(FORM.includes('{state.linked && <p className="text-sm text-ink-soft">{t.wrongPerson}</p>}'))
})

test('the phone box is optional, and the layout must not quietly make it required', () => {
  // §19: a teacher's number is optional and there is no teacher OTP. The slice is the
  // phone field itself, so a `required` on the name above it does not satisfy this.
  const from = FORM.indexOf('name="phone"')
  const to = FORM.indexOf('{showEcho && normalized')
  assert.ok(from >= 0 && to > from)
  assert.doesNotMatch(FORM.slice(from, to), /required/)

  assert.ok(FORM.includes('label={`${t.phone} (${common.optional})`}'))
  assert.ok(FORM.includes('normalizeBdMobile(phone)'))
  assert.ok(FORM.includes('{formatBdMobile(normalized)} ✓'))
})

test('the form still writes every field it wrote', () => {
  // §38. The redesign moved two halves apart; it did not touch a name, a default or the
  // one condition that decides whether this screen redirects or stays to be read.
  assert.ok(FORM.includes('const result = await createTeacher(prev, formData)'))
  assert.ok(FORM.includes('if (result?.ok && !result.linked && !result.username) {'))
  // Twice: the redirect on an ordinary success, and the button on the screen that stays.
  assert.equal(count(FORM, "router.push('/settings/teachers')"), 2)

  for (const field of ['name', 'phone', 'subjectIds', 'wantsLogin', 'password', 'confirmLink'])
    assert.ok(FORM.includes(`name="${field}"`), field)
  assert.ok(FORM.includes('name={key}'), 'and the five permissions by key')

  assert.ok(FORM.includes('defaultChecked={PERMISSION_DEFAULTS[key]}'))
  assert.ok(FORM.includes('maxLength={MAX_NAME}'))
  assert.ok(FORM.includes('minLength={MIN_PASSWORD}'))
  assert.ok(FORM.includes('<BranchPicker t={branchPick} branches={branches} current={null} />'))

  // The password only when a login was asked for, and the link tick only once the server
  // has said the number belongs to somebody: the warning banner and the tick, both gated.
  assert.ok(FORM.includes('{wantsLogin && ('))
  assert.equal(count(FORM, '{state?.confirm &&'), 2, 'the banner and the tick')
  assert.ok(FORM.includes('{state?.confirm && <Alert tone="warn">{state.confirm}</Alert>}'))
  assert.ok(FORM.includes('{state?.confirm && ('))

  // A dropped subject read says so rather than drawing an empty legend.
  assert.ok(FORM.includes('{subjects === null ? ('))
  assert.ok(FORM.includes('{t.subjectsUnreadable}'))
  assert.ok(FORM.includes('subjects.length > 0 && ('))
})
