/**
 * The buildings screen: a list, and the price of the next one beside it.
 *
 * WHAT THIS FILE IS GUARDING. The screen was one column at every width — a row 1,216px
 * wide carrying a building's name and a head count, with the form for the next building
 * below all six of them. §20.8.8 asks for the width to be spent, so the form is now a
 * 384px rail from `xl` and the list is seven columns of twelve beside it.
 *
 * `xl` and not `lg`: five of twelve at `lg` is 279px, and a form in it would be narrower
 * than the same form on a phone.
 *
 * THE ORDER IS THE TEST. Four grid children, and their source order is not their painted
 * order: the pinned manager's card is written second so a phone reads "whose decision this
 * is" before the one row it is allowed to see, and painted third so it fills the rail's
 * place instead of leaving a five-column hole. `xl:order-N` is the only thing holding that,
 * and nothing else in the repo would notice it being shuffled.
 *
 * §38 is the other half: a redesign must not have moved a gate, a read, or the delete this
 * screen has never offered.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const HERE = ['src', 'app', '(app)', 'settings', 'branches']
const PAGE = read(...HERE, 'page.tsx')
const ROW = read(...HERE, 'branch-row.tsx')
const FORM = read(...HERE, 'add-branch.tsx')
const ACTIONS = read(...HERE, 'actions.ts')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** `xl:`-prefixed, so the lookbehind of the other layout tests would find none of them. */
const variantsIn = (source: string, prop: string) =>
  [...source.matchAll(new RegExp(String.raw`(?<=["\s\x60])xl:${prop}-(\d+|last)\b`, 'g'))].map(
    (m) => m[1],
  )

/* -------------------------------------------------------------------------- */
/* The list and the rail                                                      */
/* -------------------------------------------------------------------------- */

test('the screen is one column on a phone and a list with a rail from xl', () => {
  assert.ok(
    PAGE.includes(
      '<div className="flex flex-col gap-5 xl:grid xl:grid-cols-12 xl:items-start xl:gap-6">',
    ),
    'a flex stack that becomes a grid, and the shorter column not stretched by the taller',
  )

  // Seven and five of twelve: 699px of list and 492px of form at 2xl, and the form is
  // capped by its own content rather than by the column.
  assert.deepEqual(variantsIn(PAGE, 'col-span'), ['12', '5', '7', '5'])
  assert.doesNotMatch(PAGE, /lg:grid-cols-12/, 'not at lg — 279px is a squeeze, not a rail')

  // The rail does not scroll away from a list of eleven buildings: "what does the next one
  // cost" is asked at the bottom of the list as often as at the top.
  assert.ok(PAGE.includes('<div className="xl:sticky xl:top-8 xl:order-4 xl:col-span-5">'))
})

test('source order and painted order differ, and only for the pinned manager', () => {
  // Written: band, the card for a reader with no controls, the list, the form.
  // Painted: band, the list, that card in the rail's place, the form.
  assert.deepEqual(variantsIn(PAGE, 'order'), ['1', '3', '2', '4'])

  const card = PAGE.indexOf('<Card className="xl:order-3 xl:col-span-5">')
  const list = PAGE.indexOf('<div className="contents xl:order-2 xl:col-span-7')
  assert.ok(card > 0 && list > card, 'the sentence before the row it explains, on a phone')

  // `contents` below `xl`, so the phone stack is one column with one gap rather than a box
  // inside a box — the wrapper only becomes a column at the width it has one.
  assert.ok(PAGE.includes('xl:col-span-7 xl:flex xl:flex-col xl:gap-4">'))
  assert.equal(count(PAGE, 'className="contents'), 1)
})

test('the band carries the count and the one door to the comparison', () => {
  assert.ok(
    PAGE.includes('className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'),
    'a row from sm, like every other header band in the app',
  )
  assert.ok(PAGE.includes('sm:gap-6 xl:order-1 xl:col-span-12"'), 'and the full width of the grid')

  // §8.3's comparison used to sit below the last building, on the screen where an owner has
  // just finished naming them. One door, and only where it opens on something: the table
  // refuses a pinned manager, and a door into a refusal is worse than no door.
  assert.equal(count(PAGE, 'href="/hq"'), 1)
  assert.ok(PAGE.includes('{rows.length > 0 && isHq && ('))
  assert.ok(PAGE.includes('{d.hq.title} →'))

  // The subtitle answers "how many are open", not "how many rows are below".
  assert.ok(PAGE.includes('{rows.length === 0 ? t.subtitle : t.count(activeCount)}'))
  assert.ok(PAGE.includes('const activeCount = rows.filter((row) => row.active).length'))
})

test('every shape of the screen has a heading, in one hand', () => {
  // Three returns draw their own: locked plan, failed read, the list. The locked one had no
  // <h1> at all before this, so the reader who cannot use the screen could not see which
  // screen was refusing them.
  assert.equal(count(PAGE, 'text-xl font-bold text-ink lg:text-2xl'), 3)
  assert.doesNotMatch(PAGE, /font-bold text-ink"/, 'no heading left in the old hand')

  // A one-sentence refusal is capped rather than set across 1,216px.
  assert.equal(count(PAGE, 'flex max-w-2xl flex-col gap-5'), 2)
  assert.equal(count(PAGE, '← {d.settings.hub.title}'), 3, 'and each keeps the way back')
})

/* -------------------------------------------------------------------------- */
/* The row, the form, and the ids they render                                 */
/* -------------------------------------------------------------------------- */

test('both shapes of a row are the fragment target the branches table links to', () => {
  // /hq links a branch name to `#branch-<id>`. The editable row and the pinned manager's
  // read-only row are two different elements, and either can be the one being jumped to.
  assert.ok(ROW.includes('id={`branch-${branch.id}`}'))
  assert.ok(PAGE.includes('id={`branch-${row.id}`}'))

  // A phone has a sticky header over the workspace, and a jump that lands the row
  // underneath it looks like a jump to the wrong row.
  assert.equal(count(ROW, 'scroll-mt-20'), 1)
  assert.equal(count(PAGE, 'scroll-mt-20'), 1)
  assert.equal(count(ROW, 'lg:scroll-mt-4'), 1)
  assert.equal(count(PAGE, 'lg:scroll-mt-4'), 1)
})

test('two open rows cannot collide on a DOM id', () => {
  // `Field` falls back to `id ?? name`, so a row that passes no id renders `id="name"` —
  // and this list opens as many panels as the reader taps. Two of them, and every label on
  // the screen points at the first one.
  assert.ok(ROW.includes('id={`branch-name-${branch.id}`}'))
  assert.ok(ROW.includes('id={`branch-address-${branch.id}`}'))

  // The add form is the exception and needs no key: there is one of it, and no row renders
  // the bare names it uses.
  assert.doesNotMatch(FORM, /id=\{/)
})

test('the panel and the rail pair their two fields, and unpair them at the rail width', () => {
  // A building's name and where it stands. Neither is a sentence, so neither needs the row
  // to itself, and a panel 520px wide holding one field per line throws half of it away.
  assert.ok(ROW.includes('<div className="grid gap-3 sm:grid-cols-2">'))

  // The same pair in the form, stacked again once the form is 384px of rail.
  assert.ok(FORM.includes('<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">'))

  // And neither button is the width of its column any more: `full` on a 492px rail is a
  // 492px Add button.
  assert.ok(FORM.includes('<Button type="submit" disabled={pending}>'))
  assert.ok(ROW.includes('<Button type="submit" disabled={saving} className="self-start">'))

  // The consequence under the button, where the staff row and the bill screen put theirs,
  // and capped so it reads as a sentence rather than a banner.
  assert.ok(FORM.includes('<p className="mt-2 max-w-prose text-sm text-ink-soft">{costLine}</p>'))
  assert.ok(ROW.includes('<p className="mt-2 max-w-prose text-sm text-ink-soft">{t.turnOffHint}</p>'))
})

/* -------------------------------------------------------------------------- */
/* §38: what the redesign moved past                                          */
/* -------------------------------------------------------------------------- */

test('the gate, the order and the fail-closed read are unchanged', () => {
  assert.ok(PAGE.includes("const session = await pageRole('manager')"))
  assert.ok(PAGE.includes("if (!has(session.plan, 'multipleBranches')) {"))
  assert.ok(PAGE.includes(".eq('coaching_center_id', session.active.centerId)"))

  // Closed buildings sink, like the staff who have left.
  assert.ok(PAGE.includes(".order('active', { ascending: false })"))
  assert.ok(PAGE.includes(".order('name', { ascending: true })"))

  // A dropped read must not draw "No branches written down yet" over an add form on the
  // screen of an organisation with six of them — the second one cannot be deleted after.
  assert.ok(PAGE.includes('if (branches === null) {'))
  assert.ok(PAGE.includes('{d.settings.listUnreadable}'))
})

test('the head count is still per building and bounded by buildings', () => {
  // Six queries returning six integers, not one returning nine hundred rows. §8.2 forbids
  // an application-code branch filter as a boundary; this is a group-by for a reader the
  // policies have already handed the rows to, and the figure sits beside a close button.
  assert.ok(PAGE.includes('const counts = await Promise.all('))
  assert.ok(PAGE.includes(".eq('branch_id', branch.id)"))
  assert.ok(PAGE.includes(".eq('status', 'active')"))

  // As it came, null and all: a failed count draws no figure rather than a nought, because
  // "0 students" beside the branch holding half the organisation is the one number here an
  // owner would act on.
  assert.ok(PAGE.includes('studentCount: counts[index] ?? null'))
  assert.ok(ROW.includes('{branch.studentCount !== null && ('))
  assert.ok(PAGE.includes('{row.studentCount !== null && ('))
})

test('the price is the marginal figure, and only for the reader who can add', () => {
  // A pinned manager's list is their own branch alone, so a figure worked out from
  // `activeCount` on their screen would be the price of the organisation's second building
  // on the screen of its fifth.
  assert.ok(PAGE.includes('const isHq = isHqMember(session.active)'))
  assert.ok(PAGE.includes('const nextCost = isHq ? nextBranchCostBdt(session.plan, activeCount) : 0'))
  assert.ok(PAGE.includes('t.addFree(INSTITUTION_INCLUDED_BRANCHES)'))
  assert.ok(PAGE.includes('t.addCost(formatTaka(nextCost))'))
  assert.ok(PAGE.includes('{isHq && costLine && ('))

  // §33: a whole sentence about this month's bill, and never the bands behind it.
  assert.doesNotMatch(PAGE, /PER_STUDENT|BAND|nextBranchCostBdt\(session\.plan, activeCount \+/)
})

test('there is still no way to delete a building', () => {
  // Every foreign key onto `branches` is `on delete set null`: a delete would unfile a year
  // of fees and salaries from the building that took them, and promote every manager pinned
  // to it to reading the whole organisation. Two verbs and a close, in three actions.
  assert.deepEqual(
    [...ACTIONS.matchAll(/export async function (\w+)/g)].map((m) => m[1]),
    ['createBranch', 'saveBranch', 'setBranchActive'],
  )
  for (const source of [PAGE, ROW, FORM]) {
    assert.doesNotMatch(source, /deleteBranch|removeBranch/)
  }

  // The close is a form with a direction, so the button says which way it goes.
  assert.equal(count(ROW, '<input type="hidden" name="branchId" value={branch.id} />'), 2)
  assert.ok(ROW.includes("value={branch.active ? 'off' : 'on'}"))
  assert.ok(ROW.includes('{branch.active && ('), 'nobody is afraid of opening a building')
})
