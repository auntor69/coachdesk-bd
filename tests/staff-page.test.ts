/**
 * The staff screen: three aligned columns, and the number on the row.
 *
 * WHAT THIS FILE IS GUARDING. §20.8 step 7 is a person's record and their access in one
 * place. Before this, the list was one 700px column at every width; a row showed a name,
 * a job and a joined date with the Edit word 1,100px away from them; and the mobile number
 * — on the screen whose whole subject is employment — was behind that tap, in a stack of
 * seven fields inside a panel wide enough for three.
 *
 * The layout that fixes it is arithmetic, and two numbers have to agree for it to hold:
 * the strip of column heads in page.tsx and the row in staff-row.tsx both reserve `w-44`
 * for the phone cell and split the rest in two. Those live in different files, so nothing
 * but this file can notice when one of them moves.
 *
 * §38 is the other half: the redesign moved boxes and must not have changed what either
 * form writes, or which label points at which row's input.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const HERE = ['src', 'app', '(app)', 'settings', 'staff']
const PAGE = read(...HERE, 'page.tsx')
const ROW = read(...HERE, 'staff-row.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** See plan-page.test.ts: the lookbehind keeps `border-2` and `lg:col-span-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s`])order-(\d+|last)\b/g)].map((m) => m[1])
}

/* -------------------------------------------------------------------------- */
/* The page: one column on purpose, both ways on in the letterhead            */
/* -------------------------------------------------------------------------- */

test('the list is one column at every width, and says so', () => {
  // The same answer the teacher roster reached: every block here would span twelve, and
  // a twelve-column grid whose every child spans twelve is a flex column with extra
  // words. The width is spent inside the list instead.
  assert.doesNotMatch(PAGE, /lg:grid-cols-12/)
  assert.deepEqual(ordersIn(PAGE), [])
  assert.ok(PAGE.includes('ONE COLUMN AND NO RAIL'))
})

test('adding somebody and the payroll are both beside the heading', () => {
  // In the bar's own `actions` slot now, so both stay on screen while fourteen rows
  // scroll past. They used to be in a hand-rolled letterhead row that also carried the h1.
  const bar = PAGE.lastIndexOf('<PageHeader')
  assert.ok(bar >= 0, 'the list lost its page bar')

  const add = PAGE.indexOf('href="/settings/staff/new"')
  const payroll = PAGE.indexOf('href="/payroll"')
  const list = PAGE.indexOf('<StaffRow')

  assert.ok(add > bar && payroll > add, 'add first, then the payroll: the sequence')
  assert.ok(payroll < list, 'and both above the list rather than under fourteen rows')

  // One door to each. Two would be two things to keep in step.
  assert.equal(count(PAGE, 'href="/settings/staff/new"'), 1)
  assert.equal(count(PAGE, 'href="/payroll"'), 1)

  // The dashed panel is the primary action and the payroll stays a plain link — §20.7
  // asks for one unambiguous primary action per screen.
  assert.ok(PAGE.includes('border-dashed border-brand-300'))
  assert.equal(count(PAGE, 'border-dashed'), 1)
  assert.ok(PAGE.includes('underline underline-offset-4'))
})

test('all three shapes of this screen draw the same heading', () => {
  // Three returns — the locked plan, the failed read, the list — and the locked one had
  // no h1 at all, so a bookmark landed a reader on a card about their plan with nothing
  // above it saying which screen had refused them. The bar carries it on all three now
  // and owns the h1, so a card's own title is an h2.
  assert.equal(count(PAGE, '<PageHeader'), 3)
  assert.equal(count(PAGE, 'title={t.title}'), 3)
  assert.equal(count(PAGE, '<h1'), 0)
  assert.doesNotMatch(PAGE, /text-xl font-bold text-ink lg:text-2xl/)
})

test('a one-sentence refusal is capped rather than set across the page', () => {
  // §26 is a narrow column stretched; the opposite mistake is one sentence set 1,216px
  // wide. Both refusals are one sentence — and the cap is on the card rather than the
  // column, or the bar's `lg:-mx-8` background would stop 672px into the workspace.
  assert.equal(count(PAGE, 'flex flex-col gap-5'), 3)
  assert.doesNotMatch(PAGE, /flex max-w-2xl flex-col/)
  assert.equal(count(PAGE, '<Card className="max-w-2xl'), 2)
  assert.equal(count(PAGE, '<Card className="max-w-3xl">'), 1)
})

test('the column heads sit above the list, from lg, and are a scanning aid only', () => {
  const strip = PAGE.indexOf('        aria-hidden')
  const ul = PAGE.indexOf('<ul className="flex flex-col gap-2">')
  assert.ok(strip >= 0 && ul > strip, 'the strip is above the <ul>')

  const STRIP = PAGE.slice(strip, ul)
  assert.ok(STRIP.includes('hidden px-4 text-xs font-medium uppercase'))
  assert.ok(STRIP.includes('lg:flex lg:gap-3'))

  // aria-hidden because nothing ties these three words to the cells under them: a
  // <table> would, and a disclosure cannot wrap <tr>s. Each row says what it is.
  assert.ok(STRIP.includes('aria-hidden'))

  assert.ok(STRIP.includes('{t.colStaff}'))
  assert.ok(STRIP.includes('{t.colTenure}'))
  assert.ok(STRIP.includes('{t.colPhone}'))
})

test('the strip and the row reserve the same width for the phone cell', () => {
  // The load-bearing pair, and it spans two files: the strip splits `flex-1` in two and
  // keeps `w-44` for the number, and the row does the same with `lg:` in front of it.
  // Move one and every column head sits over the wrong cell.
  assert.ok(PAGE.includes('className="grid flex-1 grid-cols-2 gap-4"'))
  assert.ok(PAGE.includes('className="w-44 text-right"'))

  assert.ok(ROW.includes('className="min-w-0 flex-1 lg:grid lg:grid-cols-2 lg:gap-4"'))
  assert.ok(ROW.includes('className="shrink-0 text-right lg:w-44"'))

  // Once each. `lg:w-44` and not `w-44` on the row, because the comment above that cell
  // names the width too and a comment is a substring like any other.
  assert.equal(count(PAGE, 'w-44 text-right'), 1, 'the strip writes the width once')
  assert.equal(count(ROW, 'lg:w-44'), 1, 'and so does the row')
  assert.equal(count(PAGE, 'grid-cols-2 gap-4'), 1)
  assert.equal(count(ROW, 'lg:grid-cols-2 lg:gap-4'), 1)
})

test('the reads and the gates the redesign moved past are unchanged', () => {
  // §38, on the screen where a dropped read used to invite a duplicate on the payroll.
  assert.ok(PAGE.includes("pageCapability('staff')"))
  assert.ok(PAGE.includes("has(session.plan, 'staffManagement')"))
  assert.ok(PAGE.includes('if (employees === null) {'), 'failing closed, not empty')

  // Scoped to the active centre as well as governed by RLS, and both orderings kept:
  // people who have left sink to the bottom.
  assert.ok(PAGE.includes(".eq('coaching_center_id', session.active.centerId)"))
  assert.ok(PAGE.includes(".order('active', { ascending: false })"))
  assert.ok(PAGE.includes(".order('name', { ascending: true })"))
  assert.ok(PAGE.includes('branchChoicesFor(supabase, session)'))
  assert.ok(PAGE.includes('id, name, role, designation, phone, joined_on, left_on, active, note,'))
  assert.ok(PAGE.includes('user_id, branch_id'))

  // The row's three derived facts. `left_on` only for somebody who has gone, the job
  // title decided in one place because a payslip will print it, and the login line as
  // a fact about signing in rather than a permission.
  assert.ok(PAGE.includes('!employee.active && employee.left_on'))
  assert.ok(PAGE.includes('jobTitle(employee.role, employee.designation, t.roles)'))
  assert.ok(PAGE.includes('employee.user_id ? t.hasLogin : null'))
  assert.ok(PAGE.includes("employee.designation?.trim() ? t.roleUnder(t.roles[employee.role]) : null"))
  assert.ok(PAGE.includes('branchId: employee.branch_id'))
})

/* -------------------------------------------------------------------------- */
/* The row: three cells, the number among them, and a paired panel            */
/* -------------------------------------------------------------------------- */

test('the number is on the row rather than behind the Edit tap', () => {
  // The fact this screen exists to hold, and it used to be one tap and seven fields away.
  assert.ok(ROW.includes("import { formatBdMobile } from '@/lib/bd/phone'"))
  assert.ok(ROW.includes('{formatBdMobile(employee.phone)}'))

  // And a word where there is no number: an empty cell under a column head reads as a
  // figure that failed to arrive.
  assert.ok(ROW.includes('employee.phone ? ('))
  assert.ok(ROW.includes('{noPhoneLabel}'))
  assert.ok(PAGE.includes('noPhoneLabel={t.noPhone}'))
})

test('the three cells are what the strip names, in that order', () => {
  const head = ROW.indexOf('className="flex items-start justify-between gap-3"')
  assert.ok(head >= 0, 'the row head is a row of cells, aligned at the top')

  const name = ROW.indexOf('{employee.name}', head)
  const title = ROW.indexOf('{employee.title}', head)
  const meta = ROW.indexOf('{employee.meta}', head)
  const phone = ROW.indexOf('formatBdMobile(employee.phone)', head)
  assert.ok(name < title && title < meta && meta < phone, 'who, what, how long, number')

  // The badge for somebody switched off stays beside the name, not in a column.
  assert.ok(ROW.includes('{offLabel}'))
  assert.ok(ROW.indexOf('{offLabel}') < meta)
})

test('the Edit word is under the row, not a fourth column inside it', () => {
  // Three cells of data with a control in the middle of them is a column that means
  // nothing. The teacher list puts its summary in the same place.
  assert.ok(ROW.includes('<div className="mt-2 border-t border-line pt-2">'))
  const rule = ROW.indexOf('<div className="mt-2 border-t border-line pt-2">')
  const button = ROW.indexOf('onClick={() => setOpen(!open)}')
  const panel = ROW.indexOf('{open && (')
  assert.ok(rule < button && button < panel)

  // Still a toggle that says which way it goes, and still a plain word.
  assert.ok(ROW.includes('{open ? common.cancel : common.edit}'))
  assert.doesNotMatch(ROW, /shrink-0 items-center text-sm font-medium/)
})

test('the seven fields are paired rather than stacked', () => {
  // The §26 half of the step: one column of seven inside a panel 1,184px wide throws
  // the width away beside it.
  assert.ok(ROW.includes('className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3"'))
  assert.equal(count(ROW, 'lg:grid-cols-2 2xl:grid-cols-3'), 1)

  // The note across the row, because free text is the one field that wants the width.
  assert.ok(ROW.includes('<div className="lg:col-span-2 2xl:col-span-3">'))
  assert.equal(count(ROW, 'col-span'), 2)

  // And the save button sized to itself. `full` across 1,184px is the same defect.
  assert.ok(ROW.includes('<Button type="submit" disabled={saving} className="self-start">'))
  assert.doesNotMatch(ROW, /disabled=\{saving\} full/)
})

test('the panel no longer carries its own padding', () => {
  // The <li> holds it now, the way the teacher row does, so the head and the panel line
  // up on one left edge instead of two.
  assert.ok(ROW.includes('className="rounded-xl border border-line bg-white px-4 py-3"'))
  assert.doesNotMatch(ROW, /border-t border-line px-4 py-4/)
  assert.equal(count(ROW, 'px-4 py-3'), 1)
})

test('switching somebody off is last and across the width', () => {
  // Not a column beside the fields: it is not a correction, and it is not a thing to
  // reach for while fixing a spelling.
  const fields = ROW.indexOf('lg:grid-cols-2 2xl:grid-cols-3')
  const off = ROW.indexOf('<div className="border-t border-line pt-3">')
  assert.ok(off > fields, 'under the form, not beside it')
  assert.equal(count(ROW, '<div className="border-t border-line pt-3">'), 1)

  // The date box capped, and the reassurance not set across the panel.
  assert.ok(ROW.includes('<div className="sm:max-w-xs">'))
  assert.ok(ROW.includes('className="mt-2 max-w-prose text-sm text-ink-soft"'))
})

test('both forms still write what they wrote', () => {
  // §38. The redesign moved boxes; it did not touch an action, a field name, or the
  // hidden inputs that decide which way `setEmployeeActive` goes.
  assert.ok(ROW.includes('useActionState<StaffState, FormData>(\n    saveEmployee,'))
  assert.ok(ROW.includes('useActionState<StaffState, FormData>(\n    setEmployeeActive,'))
  assert.equal(count(ROW, '<form action={saveAction}'), 1)
  assert.equal(count(ROW, '<form action={activeAction}'), 2, 'one to go, one to come back')

  assert.equal(count(ROW, 'name="employeeId" value={employee.id}'), 3)
  assert.ok(ROW.includes('<input type="hidden" name="next" value="off" />'))
  assert.ok(ROW.includes('<input type="hidden" name="next" value="on" />'))

  for (const field of ['name', 'role', 'designation', 'phone', 'joinedOn', 'note', 'leftOn'])
    assert.ok(ROW.includes(`name="${field}"`), field)

  // The date bounds the action enforces, repeated so the picker refuses them too.
  assert.ok(ROW.includes('min={EARLIEST_JOIN}'))
  assert.ok(ROW.includes('min={employee.joinedOn}'))
  assert.equal(count(ROW, 'max={today}'), 2)
  assert.ok(ROW.includes('maxLength={MAX_NAME}'))
  assert.ok(ROW.includes('maxLength={MAX_LABEL}'))
  assert.ok(ROW.includes('maxLength={MAX_TEXT}'))
})

test('every input in an open panel has an id of its own', () => {
  // Two rows can be open at once, and `Field` falls back to the field name — so a
  // shared id points both labels at the first row's box. Six of the seven were sharing
  // one before this step, `leftOn` among them.
  for (const part of ['name', 'designation', 'branch', 'phone', 'joined', 'note', 'left'])
    assert.ok(ROW.includes(`id={\`employee-${part}-\${employee.id}\`}`), part)

  // The branch is asked in the record form and nowhere else: `setEmployeeActive` writes
  // `active` and `left_on` only, so a picker over that button would look like it decided
  // which building somebody left from.
  assert.equal(count(ROW, '<BranchPicker'), 1)
  assert.ok(ROW.includes('current={employee.branchId}'))
})

/* -------------------------------------------------------------------------- */
/* And the words                                                              */
/* -------------------------------------------------------------------------- */

test('the column heads are written in both languages and mean different things', () => {
  for (const d of [bn, en]) {
    const s = d.settings.staff
    for (const key of ['colStaff', 'colTenure', 'colPhone', 'noPhone'])
      assert.ok(s[key as 'colStaff'].length > 0, key)

    assert.notEqual(s.colStaff, s.colTenure)
    assert.notEqual(s.colTenure, s.colPhone)
    // The head over the tenure cell is not the joined sentence: that cell says the last
    // day on the rows of people who have left.
    assert.notEqual(s.colTenure, s.joined(''))
  }
  assert.notEqual(bn.settings.staff.colStaff, en.settings.staff.colStaff)
  assert.notEqual(bn.settings.staff.noPhone, en.settings.staff.noPhone)
})
