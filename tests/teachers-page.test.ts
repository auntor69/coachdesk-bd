/**
 * The teachers screen: three aligned columns, and one person's record beside their access.
 *
 * WHAT THIS FILE IS GUARDING. §20.8 step 7 asks for a person's record and their access in
 * one place. Before this, the panel behind each name stacked four forms — name and
 * subjects, five permission checkboxes, an account form, an on/off button — inside one
 * `<details>` in a 700px column, so an owner ticking "can send SMS" could not see the name
 * it was about, and the password box was two disclosures deep.
 *
 * The layout that fixes it is arithmetic, not taste, and two numbers have to agree for it
 * to hold: the strip of column heads and the row beneath it both reserve `w-44` for the
 * login cell and split the rest in two. A change to one of those and the columns stop
 * lining up — which no typechecker can see, so it is asserted here.
 *
 * §38 is the other half: the redesign moved boxes on the screen and must not have changed
 * what any of the five forms writes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const HERE = ['src', 'app', '(app)', 'settings', 'teachers']
const PAGE = read(...HERE, 'page.tsx')
const LIST = read(...HERE, 'teacher-list.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** See plan-page.test.ts: the lookbehind keeps `border-2` and `lg:col-span-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s`])order-(\d+|last)\b/g)].map((m) => m[1])
}

/* -------------------------------------------------------------------------- */
/* The page: one column on purpose, and the primary action in the letterhead  */
/* -------------------------------------------------------------------------- */

test('the roster is one column at every width, and says so', () => {
  // Not an oversight and not the old default. Every block on this screen would be
  // twelve columns wide, and a twelve-column grid whose every child spans twelve is
  // a flex column with extra words — so the width is spent inside the list instead.
  assert.doesNotMatch(PAGE, /lg:grid-cols-12/)
  assert.deepEqual(ordersIn(PAGE), [])
  assert.ok(PAGE.includes('ONE COLUMN AND NO RAIL'))
})

test('adding a teacher is beside the heading, not under the last row', () => {
  // In the bar's own `actions` slot now, so it stays on screen while nine names scroll
  // past. It used to be in a hand-rolled letterhead row that also carried the h1.
  const bar = PAGE.lastIndexOf('<PageHeader')
  assert.ok(bar >= 0, 'the roster lost its page bar')

  const add = PAGE.indexOf('href="/settings/teachers/new"')
  const list = PAGE.indexOf('<TeacherList')
  assert.ok(add > bar, 'the add link is inside the bar')
  assert.ok(add < list, 'and above the list rather than below it')
  assert.match(PAGE, /actions=\{\s+staff &&\s+!atLimit && \(/)

  // One door to the add form. Two would be two things to keep in step.
  assert.equal(count(PAGE, 'href="/settings/teachers/new"'), 1)
})

test('the refusal that replaces the add button is where the button was', () => {
  // A capped tier that has filled its seats gets the cap card. Above the list, because
  // it answers the question the reader arrived with.
  assert.ok(PAGE.includes('{staff && atLimit && ('))
  const cap = PAGE.indexOf('{t.capTitle}')
  const list = PAGE.indexOf('<TeacherList')
  assert.ok(cap >= 0 && cap < list, 'the cap card is above the list')

  // And the two are exclusive: the old nested ternary is gone, so neither condition
  // may be written in a way that draws both.
  assert.doesNotMatch(PAGE, /!staff \? null : atLimit \?/)
})

test('all three shapes of this screen draw the same heading', () => {
  // Three returns — the failed read, the one-seat plan, the roster — and the solo one
  // had no h1 at all, so a bookmark landed a reader on a card with nothing above it
  // saying which screen had refused them. The bar carries it on all three now, and
  // owns the h1, so a hand-rolled heading beside it would be two titles.
  assert.equal(count(PAGE, '<PageHeader'), 3)
  assert.equal(count(PAGE, 'title={t.title}'), 3)
  assert.equal(count(PAGE, "back={{ href: '/settings', label: d.settings.hub.title }}"), 3)
  assert.equal(count(PAGE, '<h1'), 0)
  assert.doesNotMatch(PAGE, /text-xl font-bold text-ink lg:text-2xl/)
})

test('a one-sentence refusal is capped rather than set across the page', () => {
  // §26: the defect this whole step is about is a narrow column stretched, and the
  // opposite mistake is one sentence set 1,216px wide. The cap is on the card and not
  // on the column, or the bar's `lg:-mx-8` background would stop 672px in.
  assert.equal(count(PAGE, 'flex flex-col gap-5'), 3)
  assert.doesNotMatch(PAGE, /flex max-w-2xl flex-col/)
  assert.equal(count(PAGE, '<Card className="max-w-2xl'), 2)
  assert.equal(count(PAGE, '<Card className="max-w-3xl">'), 3)
})

test('the reads and the gates the redesign moved past are unchanged', () => {
  // §38, on the file that decides who may write a permission.
  assert.ok(PAGE.includes("pageCapability('staff')"))
  assert.ok(PAGE.includes('const staff = hasStaff(session.plan)'))
  assert.ok(PAGE.includes('overStaffSeats(session.plan, activeCount)'))
  assert.ok(PAGE.includes("wouldExceed(session.plan, 'maxTeachers', activeCount)"))
  assert.ok(PAGE.includes('trim={!staff}'))

  // Four reads, all scoped to the active centre, and the subject list deliberately
  // includes switched-off subjects — a form drawn from the live ones would unlink a
  // retired subject the next time a name was saved.
  assert.equal(count(PAGE, ".eq('coaching_center_id', session.active.centerId)"), 3)
  assert.ok(PAGE.includes("from('teachers')"))
  assert.ok(PAGE.includes("from('subjects')"))
  assert.ok(PAGE.includes("from('center_members')"))
  assert.ok(PAGE.includes('branchChoicesFor(supabase, session)'))
  assert.ok(PAGE.includes('teacher_permissions ('))
  assert.ok(PAGE.includes('can_manage_students, can_manage_exams, can_send_sms'))
  assert.ok(PAGE.includes('teacher_subjects (subjects (id, name, name_bn))'))
  assert.ok(PAGE.includes('batches (id, active)'))
  assert.ok(PAGE.includes('PERMISSION_DEFAULTS.can_send_sms'))

  // The two branch columns are different things and stay different: where they teach,
  // and what their login may reach. `undefined` means "do not ask", which is what
  // keeps updateTeacher from reading a silence as head office.
  assert.ok(PAGE.includes('branchId: teacher.branch_id'))
  assert.ok(PAGE.includes('accessBranchId:'))
  assert.ok(PAGE.includes(': undefined,'))
  assert.ok(PAGE.includes('isSelf: teacher.user_id === session.userId'))
})

/* -------------------------------------------------------------------------- */
/* The list: aligned columns, and a panel that is not a tower                  */
/* -------------------------------------------------------------------------- */

const STRIP_AT = LIST.indexOf('        aria-hidden')
const UL_AT = LIST.indexOf('<ul className="flex flex-col gap-2">')
const STRIP = LIST.slice(STRIP_AT, UL_AT)

test('the column heads sit above the list, from lg, and are a scanning aid only', () => {
  assert.ok(STRIP_AT >= 0 && UL_AT > STRIP_AT, 'the strip is above the <ul>')
  assert.ok(STRIP.includes('hidden px-4 text-xs font-medium uppercase'))
  assert.ok(STRIP.includes('lg:flex lg:gap-3'))

  // aria-hidden because nothing ties these three words to the cells under them: a
  // <table> would, and a <details> cannot wrap <tr>s, so the row is a <li> and the
  // labels are decoration. Each row says what it is without them.
  assert.ok(STRIP.includes('aria-hidden'))

  assert.ok(STRIP.includes('{t.colTeacher}'))
  assert.ok(STRIP.includes('{trim ? t.colBatches : t.colWork}'))
  assert.ok(STRIP.includes('{t.colLogin}'))
})

test('the strip and the row reserve the same width for the login cell', () => {
  // The load-bearing pair. The strip splits `flex-1` in two and keeps `w-44` for the
  // login column; the row does the same with `lg:` in front of it. Change one number
  // and every column head sits over the wrong cell — which nothing else can catch.
  assert.ok(STRIP.includes('className="grid flex-1 grid-cols-2 gap-4"'))
  assert.ok(STRIP.includes('className="w-44 text-right"'))

  assert.ok(LIST.includes('className="min-w-0 flex-1 lg:grid lg:grid-cols-2 lg:gap-4"'))
  assert.ok(LIST.includes('className="shrink-0 text-right lg:w-44"'))

  assert.equal(count(LIST, 'w-44'), 2, 'one width, written twice and no more')
  assert.equal(count(LIST, 'grid-cols-2 gap-4'), 1, 'the strip splits its half once')
  assert.equal(count(LIST, 'lg:grid-cols-2 lg:gap-4'), 1, 'and the row matches it once')
})

test('a teacher with nothing ticked says so rather than showing a gap', () => {
  // An empty cell under a heading reads as a figure that failed to arrive.
  assert.ok(LIST.includes("granted.length > 0 ? granted.join(', ') : t.noExtras"))

  // Except on a plan with no staff features, where those grants no longer take
  // effect — see lib/auth/session — so naming them would be a lie.
  assert.ok(LIST.includes('{!trim && ('))
  assert.doesNotMatch(LIST, /granted\.join\(', '\)}`/, 'no longer joined onto the batch line')
})

test("the record and the access are side by side, which is the step's whole errand", () => {
  const panel = LIST.indexOf('lg:items-start lg:gap-6 2xl:grid-cols-3')
  assert.ok(panel >= 0, 'two columns from lg and three from 2xl')
  assert.ok(LIST.includes('mt-1 flex flex-col gap-4 lg:grid lg:grid-cols-2'))

  // Order inside the panel: the repair that can never be refused, then what they may
  // do, then their account. Below lg they stack in that same order — `order` moves
  // nothing for a keyboard, so the DOM order is the real one.
  const details = LIST.indexOf('{details}', panel)
  const perms = LIST.indexOf('{t.permissionsTitle}', panel)
  const login = LIST.indexOf('{login}', panel)
  const toggle = LIST.indexOf('{toggle}</div>', panel)
  assert.ok(details > panel && perms > details && login > perms && toggle > login)
})

test('the panel is one disclosure deep, not two', () => {
  // The password box used to be a <details> inside a <details>: Change this teacher →
  // Forgotten their password? → type. One closed row is already enough to keep a
  // password box off a list of twelve names.
  assert.equal(count(LIST, '<details className='), 1)
  assert.equal(count(LIST, '</details>'), 1)
  assert.equal(count(LIST, '<summary'), 1)
  assert.ok(LIST.includes('<p className="font-medium text-ink">{t.loginSummary}</p>'))
  assert.ok(LIST.includes('<p className="font-medium text-ink">{t.resetSummary}</p>'))
})

test('each block of the panel carries the rule that separates it below lg', () => {
  // Where they stack, a line between them; where they are columns, the gap does it.
  // Three blocks after the first, so three of these and no more.
  assert.equal(count(LIST, 'border-t border-line pt-3\n                        lg:border-t-0 lg:pt-0'), 1)
  assert.equal(count(LIST, 'border-t border-line pt-3 lg:border-t-0 lg:pt-0'), 2)
  assert.ok(LIST.includes('<form action={detailsAction} className="flex flex-col gap-3">'))
})

test('switching a teacher off is last and across the width', () => {
  // Not a column of the panel: it is not part of any of the three, and it is not a
  // thing to reach for while correcting a spelling. `lastIndexOf`, because the trimmed
  // branch draws the same button higher up the file and it belongs there.
  assert.ok(LIST.includes('<div className="mt-4 border-t border-line pt-3">{toggle}</div>'))
  assert.ok(LIST.lastIndexOf('{toggle}</div>') > LIST.indexOf('2xl:grid-cols-3'))
  assert.equal(count(LIST, '{toggle}'), 2, 'one button, drawn in each branch once')
})

test('all five forms still write what they wrote', () => {
  // §38. The redesign moved boxes; it did not touch an action, a field name, or the
  // per-row ids that keep nine labels from pointing at the first row.
  //
  // Each name paired with the submit that records it, and not merely present in the
  // file: five actions are imported at the top, so `includes('saveTeacherPermissions')`
  // stays true after the permissions form has been rewired to save a name instead.
  for (const [what, action] of [
    ['details', 'updateTeacher'],
    ['permissions', 'saveTeacherPermissions'],
    ['active', 'toggleTeacherActive'],
    ['password', 'resetTeacherPassword'],
    ['login', 'giveTeacherLogin'],
  ]) {
    assert.match(
      LIST,
      new RegExp(
        `setLast\\('${what}'\\)\\s+(setLoginRow\\([^\\n]*\\)\\s+)?return ${action}\\(prev, formData\\)`,
      ),
      `${what} → ${action}`,
    )
  }
  assert.ok(LIST.includes('PERMISSION_KEYS.map((key) => ('))
  assert.ok(LIST.includes('name="teacherId" value={teacher.id}'))
  assert.ok(LIST.includes('id={`teacher-name-${teacher.id}`}'))
  assert.ok(LIST.includes('id={`teacher-branch-${teacher.id}`}'))
  assert.ok(LIST.includes('id={`teacher-access-${teacher.id}`}'))
  assert.ok(LIST.includes('id={`login-phone-${teacher.id}`}'))
  assert.ok(LIST.includes('id={`reset-password-${teacher.id}`}'))
  assert.ok(LIST.includes('name="subjectIds"'))

  // The tick list is the live subjects plus any switched-off one already linked, or
  // saving a spelling correction would quietly cut the other link. Both halves of the
  // test asserted, because the first alone is the bug.
  assert.ok(
    LIST.includes('(subject) => !subject.off || teacher.subjectIds.includes(subject.id),'),
  )

  // The access field only where there is a membership row to pin.
  assert.ok(LIST.includes('{teacher.accessBranchId !== undefined && ('))

  // And the confirm tick never ahead of the server saying whose number it is.
  assert.ok(LIST.includes('const asking = loginRow === teacher.id && loginState?.confirm'))
  assert.ok(LIST.includes('{asking && ('))
  assert.ok(LIST.includes('name="confirmLink"'))

  // One message at a time, the newest, or "Permissions saved" outlives its own row.
  assert.equal(count(LIST, "setLast('"), 5)
})

test('the trimmed list still hides everything that plan does not sell', () => {
  // A plan with no staff features and more teachers switched on than it covers: the
  // names, and the one button that gets back down to one.
  assert.ok(LIST.includes('{trim ? (') || LIST.includes('trim ?'))
  assert.ok(LIST.includes('teacher.isSelf ? ('))
  assert.ok(LIST.includes('{t.yourSeat}'))
})

/* -------------------------------------------------------------------------- */
/* And the words                                                              */
/* -------------------------------------------------------------------------- */

test('the column heads are written in both languages and mean different things', () => {
  for (const d of [bn, en]) {
    const l = d.teacherList
    for (const key of ['colTeacher', 'colWork', 'colBatches', 'colLogin', 'noExtras'])
      assert.ok(l[key as 'colTeacher'].length > 0, key)

    // The trimmed column is the untrimmed one with the grants taken out, so the two
    // labels cannot be the same word.
    assert.notEqual(l.colWork, l.colBatches)
    assert.notEqual(l.colTeacher, l.colLogin)
  }
  assert.notEqual(bn.teacherList.colTeacher, en.teacherList.colTeacher)
  assert.notEqual(bn.teacherList.noExtras, en.teacherList.noExtras)
})
