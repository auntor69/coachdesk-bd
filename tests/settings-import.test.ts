/**
 * Loading a register, and the shape it has on something wider than a phone.
 *
 * WHAT THIS FILE IS GUARDING. The paste box, everything the screen reads back off it,
 * the batch ticks and the Add button ran down one column at every width — so on a
 * 1,216px page the one question the paste does not answer (which batches these join)
 * sat under a hundred problem rows, and the button whose face says "add 40 students"
 * sat a scroll below the count that produced the 40. It is seven columns of list beside
 * five of where-they-go from `xl` now, with the button ending the narrow one.
 *
 * WHY THE RAIL IS NOT PINNED, since the other five rails in settings are. The narrow
 * half holds one tick per active batch and a centre may open a hundred of them (§6), so
 * `xl:sticky xl:top-8` would hide the bottom of that column — the button — the moment
 * the list outgrew the viewport. It is negative-asserted here so a later pass does not
 * "finish the idiom" and break the only control on the screen that submits.
 *
 * §24 AND §10 ARE WHY THE GUARDS OUTNUMBER THE LAYOUT. Every limit this screen draws is
 * re-decided inside `importStudents`, which is a public HTTP endpoint: the permission,
 * the roster count, the room, the per-batch cap and the 500-row ceiling. And the whole
 * paste lands or none of it does — no half-created register — which is why the Add
 * button is disabled rather than the list being trimmed to fit. A redesign that drops
 * one of those leaves a screen offering an import the action will refuse, or worse,
 * offering one it will half-do.
 *
 * THE PRICE AND THE ASK ARE GONE FROM IT (§16.1 step 28), and so is the one shape that
 * drew neither — the card for a plan that was full and sold no places. What is left is
 * one form, one Add button, and a `room` that is null on both per-student tiers because
 * there is no ceiling to be short of.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const IMPORT_DIR = ['src', 'app', '(app)', 'settings', 'students', 'import']
const PAGE = read(...IMPORT_DIR, 'page.tsx')
const FORM = read(...IMPORT_DIR, 'import-form.tsx')
const ACTIONS = read('src', 'app', '(app)', 'settings', 'actions.ts')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** An index that is -1 makes `a < b` true by accident. Never compare without this. */
const at = (hay: string, needle: string) => {
  const i = hay.indexOf(needle)
  assert.notEqual(i, -1, `missing anchor: ${needle}`)
  return i
}

/**
 * `addStudent` and `updateStudent` live in the same file and re-check the same
 * permission and the same per-batch cap, so `ACTIONS.includes(...)` is satisfied by
 * their copies while this one is wrong. Every guard below is asserted on the slice.
 */
const IMPORT_ACTION = (() => {
  const start = at(ACTIONS, 'export async function importStudents(')
  const end = ACTIONS.indexOf('\nexport async function ', start + 1)
  assert.notEqual(end, -1, 'importStudents is not the last export in actions.ts')
  return ACTIONS.slice(start, end)
})()

/* -------------------------------------------------------------------------- */
/* The shape                                                                  */
/* -------------------------------------------------------------------------- */

test('the list is seven columns and where-they-go is five, from xl', () => {
  assert.ok(
    FORM.includes(
      'className="flex flex-col gap-4 xl:grid xl:grid-cols-12 xl:items-start\n' +
        '          xl:gap-x-6 xl:gap-y-4"',
    ),
  )
  assert.ok(FORM.includes('<div className="flex flex-col gap-4 xl:col-span-7">'))
  assert.ok(FORM.includes('<div className="flex flex-col gap-4 xl:col-span-5">'))
  assert.equal(count(FORM, 'xl:col-span'), 2, 'two halves, and they add to twelve')

  // `items-start` is what lets the halves be different heights: the left one grows
  // with the paste, the right one is as tall as the batch list.
  assert.ok(FORM.includes('xl:items-start'))
  assert.doesNotMatch(FORM, /xl:grid-cols-[1-9]\b/)
})

test('the rail is not pinned, and nothing is reordered', () => {
  // A hundred batches is a column taller than the viewport, and a pinned column
  // that tall cannot be scrolled to its own bottom — where the button is. Prefixed,
  // because the comment explaining the absence says the bare word too.
  assert.doesNotMatch(FORM, /xl:sticky/)
  assert.doesNotMatch(FORM, /(?<=["\s`])order-\d/)
  assert.doesNotMatch(FORM, /xl:max-h-/, 'no capped scroll box to make pinning work')
})

test('the two alerts are capped and sit outside the grid', () => {
  // `Alert` takes no className, so the cap goes on a wrapper — and the wrapper is
  // above the grid so there is no empty cell on the load where there is no message.
  assert.equal(count(FORM, '<div className="max-w-2xl">'), 2)
  assert.ok(at(FORM, '<div className="max-w-2xl">') < at(FORM, 'xl:grid-cols-12'))
  assert.ok(at(FORM, 'tone="ok"') < at(FORM, 'xl:grid-cols-12'))
})

test('the left half is the paste and everything read back off it', () => {
  const left = at(FORM, 'xl:col-span-7')
  const right = at(FORM, 'xl:col-span-5')
  assert.ok(left < right)

  // In order, and all of them before the split: box, counts, over-500, what does not
  // fit, the unreadable lines, then the preview of the readable. The priced breakdown
  // that used to sit between the over-500 alert and the problem list went with capacity
  // (§16.1 step 28) — the sentence about the plan's room took its place.
  for (const anchor of [
    'id="roster"',
    '{fill(t.fresh, { n: newCount })}',
    '{fill(t.tooMany, { max: MAX_IMPORT_ROWS, got: rows.length })}',
    '{fill(t.overRoom, { room, fresh: newCount })}',
    '{t.problemsTitle}',
    '{fill(t.readyTitle, { n: ready.length })}',
  ]) {
    const i = at(FORM, anchor)
    assert.ok(i > left && i < right, `${anchor} belongs in the wide half`)
  }
})

test('the right half is the batches, the warning, then the button', () => {
  const right = at(FORM, 'xl:col-span-5')
  const batches = at(FORM, '{t.whichBatch}')
  const warning = at(FORM, '{t.noBatchPicked}')
  const submit = at(FORM, 'disabled={pending || newCount === 0 || tooMany || overRoom}')

  assert.ok(right < batches)
  assert.ok(batches < warning, 'the ticks come before the complaint about them')
  assert.ok(warning < submit, 'and the complaint sits on the button it explains')

  // Last in the column, so there is nothing under the thing that submits.
  assert.ok(submit < at(FORM, '</form>'))
  // ONE SUBMIT, where there were four — add, buy, ask, withdraw. The other three were
  // `formAction`s into billing/actions.ts and went with the places they bought.
  assert.equal(count(FORM, 'type="submit"'), 1)
})

test('the page caps its prose and its two refusals', () => {
  assert.equal(count(PAGE, 'max-w-2xl'), 2, 'read-only, and a count that did not arrive')
  assert.ok(PAGE.includes('<Card className="max-w-2xl border-late/30 bg-late/5">'))
  assert.ok(PAGE.includes('<ReadOnlyNote t={d.readOnly} className="max-w-2xl" />'))
  // The third was the full-and-cannot-buy card, and it is gone with the ceiling.
  assert.doesNotMatch(PAGE, /<Card className="max-w-2xl">/)

  // The sentence under the title is the bar's subtitle now, which caps itself at 672px
  // — so the page no longer writes a `max-w-2xl` for it.
  assert.ok(PAGE.includes('subtitle={t.body}'))

  // Every arm names the screen that refused, and the bar is what names it.
  assert.equal(count(PAGE, '<PageHeader'), 3)
  assert.equal(count(PAGE, '<h1'), 0, 'the bar owns the heading')
  assert.equal(
    count(PAGE, "back={{ href: '/settings/students', label: d.settings.students.title }}"),
    3,
    'and the way back is to the roster, not to the settings hub',
  )
})

test('a lapsed centre never sees the paste box, and pays nothing to find out', () => {
  // §10 is the whole cost of this arm having been missing: `importStudents` refuses the
  // paste whole rather than in part, so a read-only centre typed three hundred lines and
  // saved none of them.
  const lapsed = at(PAGE, "if (session.access !== 'full') {")
  assert.ok(PAGE.includes("import { ReadOnlyNote } from '@/components/read-only-note'"))

  // Before all three reads: the arm has nothing to learn from any of them.
  for (const query of ['.from(\'batches\')', 'centerStudentCount(supabase', '.from(\'students\')']) {
    assert.ok(lapsed < at(PAGE, query), `${query} runs for a centre that cannot write`)
  }

  // It was written above a full-and-cannot-buy card as well, for the reason the
  // add-student screen ordered its own two arms that way: places bought on a lapsed
  // subscription were capacity nobody could use until the bill was settled, so the bill
  // won. That card went with capacity (§16.1 step 28) and the paste box is the only
  // other arm left — asserted as an absence, because the ordering rule has nothing left
  // to order.
  assert.doesNotMatch(PAGE, /forSale/)
})

/* -------------------------------------------------------------------------- */
/* §38: what the redesign may not drop                                        */
/* -------------------------------------------------------------------------- */

test('the gate is the permission, and the same one the action re-checks', () => {
  assert.ok(PAGE.includes("const session = await pagePermission('can_manage_students')"))
  // The call, not the word: two comments here name `pageRole` to say what this is not.
  assert.doesNotMatch(PAGE, /await pageRole\(/)
  assert.ok(IMPORT_ACTION.includes("const session = await mayManage('can_manage_students', 'students')"))

  // The three role answers that used to be resolved here — who may buy, who may ask,
  // who may read the plan — are gone with the controls they gated, and `isStaffAdmin`
  // went with the last of them. Asserted as an absence: a role test on this page with no
  // control behind it is a refusal nobody can reach.
  assert.doesNotMatch(PAGE, /mayBuy|mayAsk|mayReadPlan|isStaffAdmin/)
  assert.doesNotMatch(PAGE, /session\.active\.role/)
})

test('a count that did not arrive takes the paste box away', () => {
  // Before `roomFor`, because room computed from a failed count is a number this screen
  // would then draw. Only where a count was asked for: on a per-student tier the read is
  // skipped entirely and there is no `room` to get wrong.
  const guard = at(
    PAGE,
    'if (batches === null || (session.plan.maxStudents !== null && studentCount === null)) {',
  )
  assert.ok(guard < at(PAGE, "roomFor(session.plan, 'maxStudents', studentCount)"))
  assert.ok(PAGE.includes('{t.unreadable}'))
  assert.ok(PAGE.includes('session.plan.maxStudents === null\n        ? null\n        : centerStudentCount'))

  // And the action refuses the same way rather than reading it as zero — only where
  // there is a cap to read against, since a per-student tier counts nothing.
  assert.ok(
    IMPORT_ACTION.includes(
      'if (cap !== null && count === null) return { error: t.errors.limitUnknown }',
    ),
  )
  assert.ok(IMPORT_ACTION.includes('const cap = session.plan.maxStudents'))
  assert.ok(IMPORT_ACTION.includes('if (fresh === null) return { error: t.errors.limitUnknown }'))
})

test('the roster is a hint, and null means no hint rather than no matches', () => {
  assert.ok(PAGE.includes('const HINT_CEILING = 1000'))
  assert.ok(
    PAGE.includes(`          roster === null || roster.length > HINT_CEILING
            ? null`),
  )

  // The count is active students — `app.active_students` behind the RPC, which is why
  // this page no longer filters a status itself. The roster read deliberately is not
  // filtered either, so a leaver is still "already on the roster" and re-importing
  // them skips.
  assert.equal(count(PAGE, 'centerStudentCount(supabase, centerId)'), 1)
  assert.equal(count(PAGE, "eq('status', 'active')"), 0, 'the RPC counts, not the page')
  assert.ok(PAGE.includes('.limit(HINT_CEILING + 1)'))

  // A missing hint counts every line as new, which is the honest direction.
  assert.ok(FORM.includes('const hinting = existingKeys !== null'))
  assert.ok(FORM.includes('const newCount = hinting ? ready.length - alreadyThere : ready.length'))
})

test('nothing here is priced, and nothing is created before anything is', () => {
  // §3.5's steps 4 to 6 — the bands, the total and the buy button that opened the
  // intent — are gone (§16.1 step 28). There is no ceiling to be short of on a
  // per-student tier, so a paste that does not fit is a teacher tier past its own plan
  // allowance and the answer is a different plan, not a price.
  for (const gone of [
    'capacityBands',
    'capacityCostBdt',
    'studentCeiling',
    'name="places"',
    'buyStudentPlaces',
    'requestPlaces',
  ]) {
    assert.equal(count(FORM, gone), 0, `${gone} is back in the import form`)
  }

  // What is left is one sentence naming the number that fits, and the same null rule as
  // the page: a tier that caps nothing never sees it.
  assert.ok(FORM.includes('const overRoom = room !== null && newCount > room'))
  assert.ok(FORM.includes('{room !== null && overRoom && ('))
  assert.ok(FORM.includes('room: number | null'))

  // §10: the whole paste lands or none of it does, so an over-room list disables the
  // button instead of being trimmed to fit.
  assert.ok(FORM.includes('disabled={pending || newCount === 0 || tooMany || overRoom}'))
  assert.ok(IMPORT_ACTION.includes('if (room !== null && fresh.length > room) {'))
  assert.ok(IMPORT_ACTION.includes('if (rows.length > MAX_IMPORT_ROWS) {'))
  assert.ok(IMPORT_ACTION.includes('if (full.length > 0) {'), 'and the per-batch cap')
})

test('one form, one action, and the batch ticks are controlled', () => {
  // The rule that made the buy and the ask live inside this form is kept where it was
  // written — a second <form> in the first is illegal, and a link to /settings/billing
  // would throw away a five-hundred-line paste — but there is nothing to submit to it
  // any more: the paste is the only thing that crosses (§16.1 step 28).
  assert.equal(count(FORM, '<form action='), 1)
  assert.doesNotMatch(FORM, /formAction=/)

  // React 19 resets an uncontrolled field after a Server Action, and the box keeps
  // the failed lines on purpose — so an uncontrolled tick imported the retry into
  // no batch at all.
  assert.ok(FORM.includes('checked={chosen.includes(batch.id)}'))
  assert.ok(FORM.includes("const [chosen, setChosen] = useState<string[]>([])"))
})
