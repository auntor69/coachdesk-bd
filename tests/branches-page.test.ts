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
 * THE ORDER IS THE TEST. Three grid children, and their source order is not their painted
 * order: the pinned manager's card is written first so a phone reads "whose decision this
 * is" before the one row it is allowed to see, and painted second so it fills the rail's
 * place instead of leaving a five-column hole. `xl:order-N` is the only thing holding that,
 * and nothing else in the repo would notice it being shuffled.
 *
 * THE BAND IS THE PAGE BAR NOW (§20.1). The count and the door to §8.3's comparison used to
 * be a twelfth-column cell of the grid; they are the bar's title, subtitle and action, above
 * the grid entirely — a sticky box only travels inside its containing block, and a grid cell's
 * block is one grid row.
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
  // capped by its own content rather than by the column. Three cells, not four — the
  // band that used to take all twelve is the page bar now, above the grid entirely.
  assert.deepEqual(variantsIn(PAGE, 'col-span'), ['5', '7', '5'])
  assert.doesNotMatch(PAGE, /lg:grid-cols-12/, 'not at lg — 279px is a squeeze, not a rail')
  assert.doesNotMatch(PAGE, /xl:col-span-12/, 'nothing spans the grid it is no longer in')

  // The rail does not scroll away from a list of eleven buildings: "what does the next one
  // cost" is asked at the bottom of the list as often as at the top. `top-16` because the
  // bar above it is 56px of sticky furniture and paints over this.
  assert.ok(PAGE.includes('<div className="xl:sticky xl:top-16 xl:order-3 xl:col-span-5">'))
})

test('source order and painted order differ, and only for the pinned manager', () => {
  // Written: the card for a reader with no controls, the list, the form.
  // Painted: the list, that card in the rail's place, the form.
  assert.deepEqual(variantsIn(PAGE, 'order'), ['2', '1', '3'])

  const card = PAGE.indexOf('<Card className="xl:order-2 xl:col-span-5">')
  const list = PAGE.indexOf('<div className="contents xl:order-1 xl:col-span-7')
  assert.ok(card > 0 && list > card, 'the sentence before the row it explains, on a phone')

  // `contents` below `xl`, so the phone stack is one column with one gap rather than a box
  // inside a box — the wrapper only becomes a column at the width it has one.
  assert.ok(PAGE.includes('xl:col-span-7 xl:flex xl:flex-col xl:gap-4">'))
  assert.equal(count(PAGE, 'className="contents'), 1)
})

test('the bar carries the count and the one door to the comparison', () => {
  // §8.3's comparison is the bar's action now. It used to sit below the last building, on
  // the screen where an owner has just finished naming them. One door, and only where it
  // opens on something: the table refuses a pinned manager, and a door into a refusal is
  // worse than no door.
  assert.equal(count(PAGE, 'href="/hq"'), 1)
  assert.ok(PAGE.includes('rows.length > 0 &&\n          isHq && ('))
  assert.ok(PAGE.includes('{d.hq.title} →'))

  // The subtitle answers "how many are open", not "how many rows are below", and it is
  // the bar's rather than a `<p>` of the page's own.
  assert.ok(PAGE.includes('subtitle={rows.length === 0 ? t.subtitle : t.count(activeCount)}'))
  assert.ok(PAGE.includes('const activeCount = rows.filter((row) => row.active).length'))

  // The band this replaced was a `sm:flex-row` header row of its own, and leaving it in
  // place under the bar would title the screen twice.
  assert.doesNotMatch(PAGE, /sm:items-end sm:justify-between/)
})

test('every shape of the screen is titled by the bar, in one hand', () => {
  // Three returns — locked plan, failed read, the list — and each draws the bar. The
  // locked one had no heading at all before this, so the reader who cannot use the screen
  // could not see which screen was refusing them.
  assert.equal(count(PAGE, '<PageHeader'), 3)
  assert.equal(count(PAGE, '<h1'), 0, 'the bar owns the heading')
  assert.doesNotMatch(PAGE, /text-xl font-bold text-ink/, 'no heading left in the old hand')
  assert.equal(
    count(PAGE, "back={{ href: '/settings', label: d.settings.hub.title }}"),
    3,
    'and each keeps the way back',
  )

  // A one-sentence refusal is capped on the card rather than on the column, so the bar
  // above it still reaches the workspace edges.
  assert.doesNotMatch(PAGE, /max-w-2xl flex-col/)
  assert.ok(PAGE.includes('<Card className="max-w-2xl">'))
  assert.ok(PAGE.includes('<Card className="max-w-2xl border-late/30 bg-late/5">'))
})

/* -------------------------------------------------------------------------- */
/* The row, the form, and the ids they render                                 */
/* -------------------------------------------------------------------------- */

test('both shapes of a row are the fragment target the branches table links to', () => {
  // /hq links a branch name to `#branch-<id>`. The editable row and the pinned manager's
  // read-only row are two different elements, and either can be the one being jumped to.
  assert.ok(ROW.includes('id={`branch-${branch.id}`}'))
  assert.ok(PAGE.includes('id={`branch-${row.id}`}'))

  // 80px clears both sticky headers: the phone's shell header, and the 56px page bar a
  // desktop now has. One value at every width, which is why neither file overrides it
  // past `lg` any more — the old `lg:scroll-mt-4` landed the row under the new bar.
  assert.equal(count(ROW, 'scroll-mt-20'), 1)
  assert.equal(count(PAGE, 'scroll-mt-20'), 1)
  assert.doesNotMatch(ROW, /lg:scroll-mt/)
  assert.doesNotMatch(PAGE, /lg:scroll-mt/)
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

test('a building that cannot be paid for is explained instead of offered', () => {
  // THE DEFECT THE OWNER FOUND, and this is the half of it that was on a screen. An
  // institution signup is given days rather than money (§4.3), so it is perfectly
  // writable while its balance holds nothing — and the rail used to offer a fourth
  // building, and a fifth, and a fiftieth. The screen now asks the same question the
  // trigger does, before the tap.
  assert.ok(PAGE.includes('? branchOpeningRefusal(session.plan, {'))
  assert.ok(PAGE.includes('activeBranches: activeCount,'))
  assert.ok(PAGE.includes('balancePoisha: session.billing.balancePoisha,'))

  // The rail carries the reason and the way to the one screen that takes money. A form
  // that could only refuse is the door into a refusal this page already refuses to draw
  // for a locked tier.
  assert.ok(PAGE.includes("{refusal === 'needs_money' ? ("))
  assert.ok(PAGE.includes('{t.fundTitle}'))
  assert.ok(PAGE.includes('{t.fundBody('))
  assert.ok(PAGE.includes('href="/settings/billing"'))
  assert.ok(PAGE.includes('{t.fundLink}'))
  assert.equal(count(PAGE, '<AddBranch'), 1, 'one form, and only one place it can be drawn')

  // And the action asks before the insert, with the sentence a SQLSTATE cannot write:
  // what the building costs and where the money goes. The trigger
  // (`app.guard_branch_ceiling`) is the fence under both.
  assert.ok(ACTIONS.includes('const refused = await fence(session)'))
  assert.ok(ACTIONS.includes('branchOpeningRefusal(session.plan, {'))
  assert.ok(ACTIONS.includes("if (refusal === 'needs_money') return { error: notFunded(session) }"))
  assert.ok(ACTIONS.includes("if (refusal === 'no_branches') return { error: d.errors.branchesNeedInstitution }"))
  assert.ok(ACTIONS.includes('if (isBranchRefusal(error)) return { error: notFunded(session) }'))

  // Closing a building stops a line on the bill and is never asked about money; switching
  // one back on starts one again and always is. The same pair of arms is in the trigger —
  // see tests/branch-ceiling.test.ts, which is where the SQL is read.
  assert.ok(ACTIONS.includes('if (next) {\n    const refused = await fence(session)'))
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
