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
/** The write behind the buttons. Read for the removal section at the bottom. */
const ACTIONS = read('src', 'app', '(app)', 'settings', 'actions.ts')
const USAGE = read('src', 'lib', 'settings', 'usage.ts')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/**
 * One exported action's source, and nothing after it.
 *
 * A bare `slice(indexOf(name))` runs to the end of the file, which for the last few
 * actions means half the module — and seven actions in there open with the same
 * `staffAdminWith('staff')` line, so an assertion that the guard is present would be
 * satisfied by a different function's copy of it. Bounded at the next export.
 */
function action(name: string): string {
  const start = ACTIONS.indexOf(`export async function ${name}(`)
  assert.ok(start >= 0, `${name} exists`)
  const after = ACTIONS.indexOf('\nexport async function ', start + 1)
  return after < 0 ? ACTIONS.slice(start) : ACTIONS.slice(start, after)
}

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
  // Three conditions on the one door, and the third is money rather than a plan: a tier
  // that charges per seat may not offer the form while the balance holds nothing to pay
  // the ৳100 a month the next colleague adds. See teacherSeatOpeningRefusal.
  assert.match(PAGE, /actions=\{\s+staff &&\s+!atLimit &&\s+seatRefusal === null && \(/)

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
  //
  // Four `max-w-3xl` cards now, and the fourth is the one the seat rule added: what
  // stands where the add button was when the next seat is a price this centre has no
  // balance to pay (20260811000097). It sits beside the seat cap in the same shape
  // because the two are told apart by their sentences, not by their frames.
  assert.equal(count(PAGE, 'flex flex-col gap-5'), 3)
  assert.doesNotMatch(PAGE, /flex max-w-2xl flex-col/)
  assert.equal(count(PAGE, '<Card className="max-w-2xl'), 2)
  assert.equal(count(PAGE, '<Card className="max-w-3xl">'), 4)
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

/* -------------------------------------------------------------------------- */
/* The username, which used to be shown once and then lost                     */
/* -------------------------------------------------------------------------- */

test('the page reads what each teacher types to sign in', () => {
  // The defect this section is about. `giveTeacherLogin` returned the minted username
  // inside the sentence reporting the account was made, and that sentence is gone on the
  // next render — so an owner who closed the panel could not tell the teacher what to type
  // a week later, and their only route back was to reset a password for a login they could
  // not name. Migration 38 wrote `profiles.username` for a screen to read, and no screen
  // was reading it.
  assert.ok(PAGE.includes("import { usernamesFor } from '@/lib/auth/username-login'"))
  assert.ok(PAGE.includes("import { createAdminClient } from '@/lib/supabase/admin'"))
  assert.ok(PAGE.includes('teachers.map((teacher) => teacher.user_id),'))

  // Past RLS, because `profiles` is self-read and a policy wide enough to show a colleague
  // their username would hand over four other columns with it — `is_platform_admin` among
  // them. The marker is what tests/admin-actor.test.ts requires of a service-role client
  // with nobody behind it, and it sits *inside* the argument list on purpose: that gate
  // walks up from the `createAdminClient()` line through comment lines only and stops at
  // the first line of code, so a marker above the `const` would be invisible to it.
  //
  // `\s+` and not `\n`, because this file is read without normalising line endings and a
  // `\n` anchor would silently match nothing in a CRLF checkout.
  assert.match(
    PAGE,
    /const usernames = await usernamesFor\(\s+\/\/ actor-less: [^\n]{8,}\s+createAdminClient\(\),/,
  )

  // The ids come from the read that is already filtered by this centre, which is the whole
  // of the boundary on a query that consults no policy. Asserted as an ordering rather than
  // as a string, because what matters is that the centre is fixed before the ids are taken.
  const scoped = PAGE.indexOf(".eq('coaching_center_id', session.active.centerId)")
  const read = PAGE.indexOf('const usernames = await usernamesFor(')
  assert.ok(scoped >= 0 && read > scoped, 'the ids are taken before the centre is fixed')

  // One entry per teacher, and null where there is no account — not a lookup on `''`, which
  // would be a map hit if a profile row ever carried an empty id.
  assert.ok(
    PAGE.includes(
      'username: teacher.user_id ? (usernames.get(teacher.user_id) ?? null) : null,',
    ),
  )
})

test('the row shows the username labelled, beside the number', () => {
  // In the login cell, on the row itself: an owner asked for it by a teacher over the phone
  // should not have to open a disclosure, and after the minting sentence has gone this row
  // is the only thing in the app that can answer.
  const cell = LIST.indexOf('<div className="shrink-0 text-right lg:w-44">')
  const shown = LIST.indexOf('{teacher.username}')
  assert.ok(cell >= 0 && shown > cell, 'the username is not in the login cell')
  assert.ok(LIST.indexOf('{t.noLogin}') > shown, 'and above "no login", which is its absence')

  // Drawn only where there is one — an account minted against a phone number has none —
  // and labelled, because a bare lowercase word under a mobile number is not self-explaining.
  assert.ok(LIST.includes('{teacher.username && ('))
  assert.ok(LIST.includes('{t.usernameLabel} '))

  // `break-all` and not `truncate`: the cell is 176px and a username runs to thirty
  // characters, so truncating here would be this same defect in a new place — a login id
  // the owner cannot read out.
  assert.ok(LIST.includes('<p className="break-all text-sm text-ink-soft">'))
  assert.ok(LIST.includes('username: string | null'), 'nullable, or a phone login draws "null"')
})

test('the label is written in both languages', () => {
  for (const d of [bn, en]) assert.ok(d.teacherList.usernameLabel.length > 0)
  // Not the same word in both: the Bangla is the borrowed term this file already uses for
  // লগইন, and a shared string here would mean one of the two was never written.
  assert.notEqual(bn.teacherList.usernameLabel, en.teacherList.usernameLabel)
})

/* -------------------------------------------------------------------------- */
/* Removing the record, which the screen could not do at all                   */
/* -------------------------------------------------------------------------- */

test('the removal is offered on the row, and never on the reader’s own', () => {
  // The defect: the screen had an off switch and nothing else, so a duplicate teacher
  // row sat on the roster for ever — and on a capped plan the owner had to look at it.
  const toggle = LIST.lastIndexOf('{toggle}</div>')
  const remove = LIST.indexOf('{remove}</div>')
  assert.ok(toggle >= 0 && remove > toggle, 'below the switch, not above it')
  assert.ok(LIST.includes('{!teacher.isSelf && ('), 'not on your own record')
  assert.equal(count(LIST, '{remove}'), 1, 'one control, drawn once')

  // A quiet underlined word that arms a step, the same shape as every other removal in
  // settings — see list-row.tsx — and not a button sitting live next to Save.
  assert.ok(LIST.includes('onClick={() => setRemoveRow(teacher.id)}'))
  assert.ok(LIST.includes('{t.removeOpen}'))
  assert.ok(LIST.includes('const armed = removeRow === teacher.id'))
})

test('a teacher who is still switched on is told the order, not hidden from', () => {
  // The arm word is drawn on a live row too. Hiding it there would be tidier and worse:
  // a control that only appears after an unrelated step is one an owner never finds,
  // which is the whole reason this section exists.
  const armed = LIST.indexOf('{!armed ? (')
  const blocked = LIST.indexOf(') : teacher.active ? (', armed)
  const confirm = LIST.indexOf('<form action={removeAction}', blocked)
  assert.ok(armed >= 0 && blocked > armed && confirm > blocked, 'three states in order')

  assert.ok(LIST.includes('{t.removeBlockedTitle}'))
  assert.ok(LIST.includes('{t.removeNeedsOff}'))
  assert.equal(count(LIST, '{t.keep}'), 2, 'a way out of both states')
})

test('the confirm step keeps the app’s button order', () => {
  // Keep-it first and full width, remove second and narrow: the habit this product
  // builds is "the wide one at the bottom is the one you press", and a confirm step is
  // the worst place to break it. Matched with `\s+`, not `\n` — teacher-list.tsx is LF
  // today and actions.ts next door is CRLF, and neither is read normalised here.
  const keep = LIST.search(/variant="secondary"\s+onClick=\{\(\) => setRemoveRow\(null\)\}/)
  const danger = LIST.indexOf('variant="danger"')
  assert.ok(keep >= 0 && danger > keep, 'keep-it is first')
  assert.ok(LIST.includes('{removePending ? t.removing : t.removeConfirm}'))
  assert.ok(LIST.includes('className="self-start"'), 'and the danger one is narrow')
  assert.equal(count(LIST, 'variant="danger"'), 1, 'one destructive submit on the screen')
})

test('the sixth form reports into the row, not into the banner', () => {
  // The other five call setLast so the newest of them owns the banner at the top. This
  // one must not: it either makes the row vanish, and there is nowhere for a sentence
  // to sit, or it refuses about one teacher among nine. So the action goes into
  // useActionState bare, with no wrapper.
  assert.match(
    LIST,
    /useActionState<ActionState, FormData>\(\s+deleteTeacher,\s+null,\s+\)/,
  )
  assert.equal(count(LIST, "setLast('"), 5, 'still five, which is what makes that count mean something')
  assert.ok(LIST.includes('{armed && removeState?.error && <Alert>{removeState.error}</Alert>}'))
})

test('the action refuses the two things the row knows before it counts anything', () => {
  // §20.4: the panel hides the control on the reader's own row and explains the order on
  // a live one, and neither of those is a permission — a Server Action is a public
  // endpoint. Both facts are re-read from the row here.
  const body = action('deleteTeacher')

  assert.ok(body.includes("const session = await staffAdminWith('staff')"))
  const self = body.indexOf('teacher.user_id === session.userId')
  const off = body.indexOf('if (teacher.active)')
  const count_ = body.indexOf('await readTeacherUse(supabase, centerId, teacher.id)')
  assert.ok(self >= 0 && off > self && count_ > off, 'both guards, then the counts')
  assert.ok(body.includes('t.teachers.errors.deleteSelf'))
  assert.ok(body.includes('t.teachers.errors.deleteNeedsOff'))
  assert.ok(body.includes('t.teachers.errors.deleteCheckFailed'), 'a failed count refuses')
})

test('all four verdicts are written out, so a fifth is a type error', () => {
  const body = action('deleteTeacher')
  const sw = body.indexOf('switch (teacherDeleteVerdict(use)) {')
  assert.ok(sw >= 0, 'the verdict decides, not the action')

  for (const [verdict, message] of [
    ['paid', 'deletePaid(use.paidCount)'],
    ['attendance', 'deleteAttendance(use.attendanceCount)'],
    ['exams', 'deleteExams(use.examCount)'],
    ['batches', 'deleteBatches(use.batchCount)'],
  ]) {
    assert.match(
      body.slice(sw),
      new RegExp(`case '${verdict}':\\s+return \\{ error: t\\.teachers\\.errors\\.${message.replace(/[().]/g, (c) => '\\' + c)} \\}`),
      verdict,
    )
  }
  assert.ok(body.slice(sw).includes("case 'ok':"), 'and no default')
})

test('the write is scoped, and the membership goes with it', () => {
  const body = action('deleteTeacher')

  // The teaching membership first, then the row. Switching a teacher off already
  // deleted the membership — requiring `active === false` is what makes that true — so
  // this is the belt on a row some older path left behind. A membership with no teacher
  // row is app.has_role('teacher') returning true for somebody the centre cannot see.
  //
  // `search` and not `indexOf`, because this file reads bytes without normalising line
  // endings and a `\n` between the two calls would find nothing in a CRLF checkout.
  const member = body.indexOf("from('center_members')")
  const row = body.search(/from\('teachers'\)\s+\.delete\(\)/)
  assert.ok(member >= 0 && row > member, 'the access goes before the record')
  assert.ok(body.includes(".eq('role', 'teacher')"), 'only the teaching membership')

  assert.match(
    body.slice(row),
    /\.eq\('coaching_center_id', centerId\)\s+\.eq\('id', teacher\.id\)\s+\.select\('id'\)/,
  )
  assert.ok(body.includes('if (error || !gone || gone.length === 0)'))

  // The screens whose numbers moved. The admin roster reads teacher names, and the pay
  // screens read a rate that cascaded away with the row.
  for (const path of [
    '/settings/teachers',
    '/settings/managers',
    '/payroll',
    '/teach',
    '/settings/billing',
  ]) {
    assert.ok(body.includes(`revalidatePath('${path}')`), path)
  }
})

test('the counts name the centre as well as the teacher', () => {
  // Four tables, and every one of them filtered by the centre — not only by the teacher
  // id, which arrives from a form. `check-scoping` also holds this, and it is asserted
  // here because that gate cannot see whether the id was proved to be ours.
  const body = USAGE.slice(USAGE.indexOf('export async function readTeacherUse'))
  for (const table of ['salary_payments', 'attendance_sessions', 'exams', 'batches']) {
    assert.match(
      body,
      new RegExp(
        `from\\('${table}'\\)\\s+\\.select\\('id', head\\)\\s+\\.eq\\('coaching_center_id', centerId\\)\\s+\\.eq\\('teacher_id', teacherId\\)`,
      ),
      table,
    )
  }

  // Null means a count did not run, and never zero: a `?? 0` here would read a dropped
  // connection as permission to delete a teacher with a year of registers behind them.
  assert.ok(body.includes('paid.count === null ||'))
  assert.ok(body.includes('return null'))
})

test('the removal words are written in both languages', () => {
  for (const d of [bn, en]) {
    const l = d.teacherList
    for (const key of [
      'removeOpen',
      'removeBlockedTitle',
      'removeNeedsOff',
      'removeHeading',
      'removeWarning',
      'removeConfirm',
      'removing',
      'keep',
    ]) {
      assert.ok(l[key as 'removeOpen'].length > 0, key)
    }

    // Removing the record and switching somebody off are different errands, so their
    // words cannot be the same word — that is the confusion the whole section is about.
    assert.notEqual(l.removeOpen, l.deactivate)
    assert.notEqual(l.removeConfirm, l.deactivate)

    const e = d.settings.teachers.errors
    assert.ok(e.deleteSelf.length > 0)
    assert.ok(e.deleteNeedsOff.length > 0)
    assert.ok(e.deleteCheckFailed.length > 0)
    assert.ok(e.deleteFailed.length > 0)

    // The counted ones agree with one and with many, in a language where the noun does
    // not inflect and in one where it does.
    assert.notEqual(e.deletePaid(1), e.deletePaid(4))
    assert.notEqual(e.deleteAttendance(1), e.deleteAttendance(210))
    assert.notEqual(e.deleteExams(1), e.deleteExams(8))
    assert.notEqual(e.deleteBatches(1), e.deleteBatches(4))
    for (const n of [1, 4]) assert.ok(e.deleteBatches(n).includes(String(n)), 'the figure')
  }
  assert.notEqual(bn.teacherList.removeOpen, en.teacherList.removeOpen)
  assert.notEqual(bn.settings.teachers.errors.deleteSelf, en.settings.teachers.errors.deleteSelf)
})

test('the removal words say the person is out, and claim nothing about their login', () => {
  // AN OWNER READ THE OLD WARNING AND ASKED WHAT IT MEANT. It ended "their login is not
  // deleted — they may use it at another centre", which is frightening in the one place a
  // reader is deciding whether to press a red button, irrelevant to the decision, and for
  // a teacher with no phone number simply untrue: `giveTeacherLogin` can only re-find an
  // existing account by phone, so a username-only login is not reachable from anywhere.
  //
  // The auth account does survive, and deliberately — `profiles` is one row per human, not
  // per appointment, and deleting it here would be this centre reaching across a tenant
  // boundary to break somebody else's teacher. That belongs in deleteTeacher's docblock,
  // which is where it is. A confirm screen gets the fact the owner needs instead.
  for (const [name, d] of [['en', en], ['bn', bn]] as const) {
    const l = d.teacherList
    for (const key of ['removeWarning', 'removeNeedsOff'] as const) {
      const said = l[key]
      for (const claim of [/another cent/i, /অন্য.{0,12}সেন্টার/, /elsewhere/i]) {
        assert.doesNotMatch(said, claim, `${name}.${key} sends the login somewhere else`)
      }
      for (const claim of [/login/i, /লগইন/]) {
        assert.doesNotMatch(said, claim, `${name}.${key} talks about the login again`)
      }
    }

    // And both say the thing that replaced it: the person is out of this centre. Off is
    // what does it — `toggleTeacherActive` deletes the centre_members row — so the order
    // sentence and the confirm sentence have to agree about that, or the owner is told the
    // access ends at two different moments.
    for (const key of ['removeWarning', 'removeNeedsOff'] as const) {
      assert.match(l[key], /cent|সেন্টার/, `${name}.${key} never says whose access ended`)
    }
  }
})

test('the teacher list can be searched, and the seat count does not move with it', () => {
  /*
   * Fifteen teachers, and an owner looking for the one whose password has to be reset —
   * holding a name, a number, a subject or a username they cannot remember. Read off the
   * source, like the rest of this file.
   *
   * What it catches is the drift a screenshot does not show. `shown` and not `rows`: the
   * list is drawn from the narrowed set, and the seat figure under the heading is not — a
   * centre with fifteen teachers who types one name must not be told it employs one, on the
   * screen where a seat costs ৳100 a month.
   */
  assert.match(PAGE, /searchParams: Promise<\{ q\?: string \}>/)
  assert.match(PAGE, /import \{ SearchBox, SearchEmpty \} from '@\/components\/search-box'/)
  assert.match(PAGE, /import \{ matchesSearch, searchTerms \} from '@\/lib\/search'/)

  // The four things an owner arrives holding, and the subjects are already strings by the
  // time the rows are built — see `subjects` above.
  assert.match(
    PAGE,
    /matchesSearch\(\[row\.name, row\.phone, row\.username, \.\.\.row\.subjects\], words\)/,
  )

  // The count is the narrowed one over the whole list.
  assert.match(PAGE, /count=\{\{ shown: shown\.length, total: rows\.length \}\}/)

  // The heading still counts the centre: active count and the seat limit.
  assert.match(PAGE, /subtitle=\{limit === null \? t\.count\(activeCount\) : t\.used\(activeCount, limit\)\}/)

  // A filtered list that matched nobody says so in the search's own words.
  assert.match(PAGE, /\{shown\.length === 0 \? \(\s*\r?\n\s*<SearchEmpty t=\{d\.search\} \/>/)

  // And the list is handed the narrowed rows.
  assert.match(PAGE, /<TeacherList\s*\r?\n\s*teachers=\{shown\}/)
})
