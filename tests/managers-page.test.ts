/**
 * The administrators screen: the roster and the appointment, side by side.
 *
 * WHAT THIS FILE IS GUARDING. §20.8 step 7 again, and the defect here was the other one
 * §26 names: not a narrow column stretched, but a form handed four times the width it
 * wants. The appoint form — a select, a building, six boxes with a line of explanation
 * each, a submit — was set across the whole page under a list of two or three rows, and
 * its three save buttons ran the full 1,184px.
 *
 * The fix is seven columns of roster beside five of form from `xl`, and `xl` rather than
 * `lg` is arithmetic: five of twelve is 279px at `lg`, which is a squeeze and not a rail.
 * /expenses gates its own split the same way.
 *
 * The row's own change is the word on the right. What a manager may do was the fourth item
 * in a dot-joined line that truncated, on the screen whose entire subject is what each
 * administrator may do.
 *
 * §38 is the other half: every read, every gate and all three actions are untouched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const HERE = ['src', 'app', '(app)', 'settings', 'managers']
const PAGE = read(...HERE, 'page.tsx')
const ROW = read(...HERE, 'manager-row.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** See plan-page.test.ts: the lookbehind keeps `border-2` and `lg:col-span-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s`])order-(\d+|last)\b/g)].map((m) => m[1])
}

/* -------------------------------------------------------------------------- */
/* The page: seven and five from xl, and source order is reading order        */
/* -------------------------------------------------------------------------- */

test('the roster and the form are two columns from xl, and twelve of them', () => {
  assert.ok(PAGE.includes('xl:grid xl:grid-cols-12 xl:items-start xl:gap-6'))

  // Seven and five, which is the whole of the arithmetic: the roster keeps the width its
  // rows want and the form gets 386px at `xl` rather than 1,184.
  assert.equal(count(PAGE, 'xl:col-span-7'), 1)
  assert.equal(count(PAGE, 'xl:col-span-5'), 1)
  // No twelfth-column cell for the heading any more: the bar sits above the grid, because
  // a sticky box only travels inside its containing block and a cell's is one grid row.
  assert.equal(count(PAGE, 'xl:col-span-12'), 0)

  // `xl` and not `lg`, deliberately: five of twelve is 279px at `lg`.
  assert.doesNotMatch(PAGE, /lg:grid-cols-12/)
  assert.doesNotMatch(PAGE, /lg:col-span-/)
})

test('nothing on this screen is reordered, because nothing needs to be', () => {
  // Two blocks under the bar, written in the order they are read. `order-N` would be a
  // number to keep in step for no gain — and it moves neither keyboard nor screen-reader
  // order, so a screen that does not need it should not carry it.
  assert.deepEqual(ordersIn(PAGE), [])

  const ul = PAGE.indexOf('<ul className="flex flex-col gap-2 xl:col-span-7">')
  const rail = PAGE.indexOf('<div className="xl:col-span-5">')
  const appoint = PAGE.indexOf('<AppointManager')
  assert.ok(ul >= 0 && rail > ul, 'who administers, then how to appoint somebody')
  assert.ok(appoint > rail, 'and the form is inside that column')
})

test('all three shapes of this screen draw the same heading', () => {
  // Three returns — the locked plan, the failed read, the list — and the locked one had no
  // h1 at all, so a bookmark landed a reader on a card about their plan with nothing above
  // it naming the screen that had refused them. One `bar` const now serves all three, so
  // the three cannot drift; the two that are not the locked branch share the object.
  assert.equal(count(PAGE, '<PageHeader'), 2)
  assert.equal(count(PAGE, '{bar}'), 2)
  assert.equal(count(PAGE, '<h1'), 0)
  assert.doesNotMatch(PAGE, /text-xl font-bold text-ink lg:text-2xl/)
})

test('a one-sentence refusal is capped rather than set across the page', () => {
  // The cap is on the card and not on the column, or the bar's `lg:-mx-8` background would
  // stop 672px into a 1,216px workspace.
  assert.equal(count(PAGE, '<Card className="max-w-2xl'), 2)
  assert.doesNotMatch(PAGE, /flex max-w-2xl flex-col/)
})

test('the list gets no strip of column heads, unlike the two long rosters', () => {
  // One owner and a manager or two. Three words over three rows is furniture, and every
  // row here says what it is.
  assert.doesNotMatch(PAGE, /uppercase tracking-wide/)
  assert.doesNotMatch(PAGE, /aria-hidden/)
})

test('the reads and the gates the redesign moved past are unchanged', () => {
  // §38, on the screen that decides who can reach a centre's money. `await` in the anchor
  // because the docblock names `pageRole('owner')` too, and a comment is a substring.
  assert.ok(PAGE.includes("await pageRole('owner')"))
  assert.ok(PAGE.includes('if (!hasStaff(session.plan)) {'))
  assert.ok(PAGE.includes('if (memberRead.error || memberRead.data === null) {'))

  // Only live appointments, only the two roles this screen draws, and all three reads
  // scoped to the active centre as well as governed by RLS.
  assert.ok(PAGE.includes(".eq('active', true)"))
  assert.ok(PAGE.includes(".in('role', ['owner', 'manager'])"))
  assert.equal(count(PAGE, ".eq('coaching_center_id', centerId)"), 3)
  assert.ok(PAGE.includes('branchChoicesFor(supabase, session)'))

  // The roster is joined in application code because `profiles` is self-read: teachers
  // first, so somebody in both lists is shown under the name their colleagues use.
  assert.ok(PAGE.includes('teacherRead.error || employeeRead.error'))
  assert.ok(PAGE.includes("from: 'teachers' as const"))
  assert.ok(PAGE.includes("from: 'employees' as const"))
  assert.ok(PAGE.includes('jobTitle(row.role, row.designation, d.settings.staff.roles)'))
  assert.ok(
    PAGE.includes('administratorsFrom(members, people ?? [], session.userId, usernames)'),
  )
  assert.ok(PAGE.includes('candidatesFrom(people, members)'))

  // A pin onto a building the centre has closed reads as a closed branch and not as head
  // office: the difference between somebody confined and somebody who reads everything.
  assert.ok(PAGE.includes('branchNames.get(branchId) ?? t.branchClosed'))
  assert.ok(PAGE.includes('d.branchAccess.hq'))
  assert.ok(PAGE.includes('branchLabel={branches === null ? null : branchLabel(admin.branchId)}'))
})

test('the appointment column draws one of three things', () => {
  // A failed staff read, nobody to offer, or the form. All three in the rail, and the
  // heading is the page's so the two cards can share it.
  assert.equal(count(PAGE, '{t.staffUnreadable}'), 1)
  assert.equal(count(PAGE, '{t.nobodyTitle}'), 1)
  assert.equal(count(PAGE, '<AppointManager'), 1)
  assert.ok(PAGE.includes('candidates === null ? ('))
  assert.ok(PAGE.includes('candidates.length === 0 ? ('))
  assert.ok(PAGE.includes('title={t.appointTitle}'))
  assert.ok(PAGE.includes('href="/settings/staff"'), 'and the screen that fixes it')
})

/* -------------------------------------------------------------------------- */
/* The row: the access word on the right, and the panel under a rule          */
/* -------------------------------------------------------------------------- */

test('what they may do is a word on the right, and never a blank one', () => {
  // An owner's cell is their role, because nothing narrows an owner; a manager's is the
  // bundle, the words for a hand-picked set, or Deputy owner for all six.
  assert.ok(ROW.includes('const accessLabel = !editable\n    ? roleLabel\n'))
  assert.ok(ROW.includes('? caps.custom\n      : caps.bundle[bundle]'))
  assert.ok(ROW.includes('{accessLabel}'))
  assert.ok(ROW.includes('const bundle = editable ? bundleOf(admin.capabilities) : null'))

  // And it is out of the dot-joined line, which is what used to truncate it away.
  assert.ok(ROW.includes("{[admin.job, branchLabel].filter(Boolean).join(' · ')}"))
  assert.doesNotMatch(ROW, /roleLabel, admin\.job/)
  assert.doesNotMatch(ROW, /capLabel/)
})

test('the name truncates and the line under it wraps', () => {
  // A job and a building is the line where the building was the half being cut off. The
  // count is of the class and not the word: two comments in this file say "truncated"
  // about the defect, and a comment is a substring like any other.
  assert.equal(count(ROW, 'className="truncate'), 1, 'the name, and nothing else')
  assert.ok(ROW.includes('<p className="truncate font-medium text-ink">{name}</p>'))
  assert.ok(ROW.includes('<p className="text-sm text-ink-soft">'))
})

test('the row is one box with its own padding, aligned at the top', () => {
  assert.ok(ROW.includes('<li className="rounded-xl border border-line bg-white px-4 py-3">'))
  assert.equal(count(ROW, 'px-4 py-3'), 1)
  assert.ok(ROW.includes('<div className="flex items-start justify-between gap-3">'))

  // The panel used to carry a second left edge of its own.
  assert.doesNotMatch(ROW, /border-t border-line px-4 py-4/)
  assert.ok(ROW.includes('<div className="mt-3 flex flex-col gap-4 border-t border-line pt-3">'))
})

test('the Edit word is beside the access chip, and only for a manager', () => {
  const chip = ROW.indexOf('{accessLabel}')
  const gate = ROW.indexOf('{editable && (', chip)
  const button = ROW.indexOf('onClick={() => setOpen(!open)}')
  const panel = ROW.indexOf('{open && editable && (')
  assert.ok(chip >= 0 && gate > chip && button > gate && panel > button)

  assert.ok(ROW.includes('<div className="flex shrink-0 flex-col items-end gap-1">'))
  assert.ok(ROW.includes('{open ? common.cancel : common.edit}'))

  // An owner is drawn and not edited: ./actions.ts carries .eq('role', 'manager') on
  // every read and write, so a control here would be one the database refuses.
  assert.ok(ROW.includes("const editable = admin.role === 'manager'"))
})

test('the three sections still write what they wrote', () => {
  // §38. Three independent forms, three actions, and the branch one only where there is
  // more than one building to move somebody between.
  assert.ok(ROW.includes('useActionState<ManagerState, FormData>(\n    setManagerBranch,'))
  assert.ok(ROW.includes('useActionState<ManagerState, FormData>(\n    setManagerCapabilities,'))
  assert.ok(ROW.includes('useActionState<ManagerState, FormData>(\n    removeManager,'))

  assert.equal(count(ROW, '<input type="hidden" name="memberId" value={admin.memberId} />'), 3)
  assert.ok(ROW.includes('{branches !== null && ('))
  assert.equal(count(ROW, '<form'), 3, 'three forms and no more')
  assert.ok(ROW.includes('<form action={branchAction}'))
  assert.ok(ROW.includes('action={capAction}'))
  assert.ok(ROW.includes('<form action={removeAction}'))

  // Prefilled from the row, so an owner is looking at what is true rather than at a
  // default, and a per-row id because six administrators mean six of these in one page.
  assert.ok(ROW.includes('<CapabilityPicker t={caps} current={admin.capabilities} />'))
  assert.ok(ROW.includes('current={admin.branchId}'))
  assert.ok(ROW.includes('id={`manager-branch-${admin.memberId}`}'))
})

test('the save buttons are sized to themselves', () => {
  // `full` inside a seven-column panel is the same defect as the form was: a control
  // stretched to a width that says nothing about what it does.
  assert.equal(count(ROW, 'className="self-start"'), 2)
  assert.doesNotMatch(ROW, /disabled=\{moving\} full/)
  assert.doesNotMatch(ROW, /disabled=\{scoping\} full/)

  // Taking the appointment back keeps its own weight and its reassurance is capped.
  assert.ok(ROW.includes('<Button type="submit" variant="secondary" disabled={removing}>'))
  assert.ok(ROW.includes('className="mt-2 max-w-prose text-sm text-ink-soft"'))
})

/* -------------------------------------------------------------------------- */
/* The username, which used to be shown once and then lost                    */
/* -------------------------------------------------------------------------- */

test('the page reads what each administrator types to sign in', () => {
  // `appointManager` says the username once, in the sentence reporting the appointment, and
  // an owner who reloaded before writing it down had no way back to it. This is that way
  // back, and `profiles` is self-read so it is a service-role read of one column.
  assert.ok(PAGE.includes("import { usernamesFor } from '@/lib/auth/username-login'"))
  assert.ok(PAGE.includes("import { createAdminClient } from '@/lib/supabase/admin'"))
  assert.ok(PAGE.includes('members.map((member) => member.userId),'))

  // The marker sits inside the argument list on purpose: tests/admin-actor.test.ts walks up
  // from the `createAdminClient()` line through comments only and stops at the first line of
  // code. `\s+` rather than `\n`, because this file reads bytes without normalising CRLF.
  assert.match(
    PAGE,
    /const usernames = await usernamesFor\(\s+\/\/ actor-less: [^\n]{8,}\s+createAdminClient\(\),/,
  )

  // The ids are the memberships already narrowed to this centre, which is the whole of the
  // boundary on a query that consults no policy — and the map has to reach the roster.
  const scoped = PAGE.indexOf(".eq('coaching_center_id', centerId)")
  const read = PAGE.indexOf('const usernames = await usernamesFor(')
  const join = PAGE.indexOf('administratorsFrom(')
  assert.ok(scoped >= 0 && read > scoped, 'the ids are taken before the centre is fixed')
  assert.ok(join > read, 'the map is read and then dropped')
})

test('the row shows the username under the name, labelled', () => {
  // Under the name and the job line, where the row already answers "who is this": an owner
  // asked for it over the phone should not have to open the edit panel to find it.
  const name = ROW.indexOf('<p className="truncate font-medium text-ink">{name}</p>')
  const shown = ROW.indexOf('{admin.username}')
  assert.ok(name >= 0 && shown > name, 'the username is above the name')
  assert.ok(ROW.includes('{admin.username && ('), 'drawn only where there is one')
  assert.ok(ROW.includes('{t.usernameLabel} '), 'and labelled')

  // `break-all` and not `truncate`: a login id cut short is the same defect in a new place.
  assert.ok(ROW.includes('<p className="break-all text-sm text-ink-soft">'))
})
