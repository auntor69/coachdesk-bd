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

  // In order, and all of them before the split: box, counts, over-500, the price
  // when it does not fit, the unreadable lines, then the preview of the readable.
  for (const anchor of [
    'id="roster"',
    '{fill(t.fresh, { n: newCount })}',
    '{fill(t.tooMany, { max: MAX_IMPORT_ROWS, got: rows.length })}',
    '{fill(t.shortTitle, { n: short })}',
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
  assert.equal(count(FORM, 'type="submit"'), 4, 'add, buy, ask, withdraw')
})

test('the page caps its prose and its two refusals', () => {
  assert.equal(count(PAGE, 'max-w-2xl'), 3, 'the subtitle and both dead ends')
  assert.ok(PAGE.includes('<Card className="max-w-2xl border-late/30 bg-late/5">'))
  assert.ok(PAGE.includes('<Card className="max-w-2xl">'))
  assert.ok(PAGE.includes('<p className="mt-1 max-w-2xl text-sm text-ink-soft">{t.body}</p>'))

  // Both arms name the screen that refused, at the size the other settings screens use.
  assert.equal(count(PAGE, '<h1 className="mt-1 text-xl font-bold text-ink lg:text-2xl">'), 2)
  assert.equal(count(PAGE, '<h1'), 2)
})

/* -------------------------------------------------------------------------- */
/* §38: what the redesign may not drop                                        */
/* -------------------------------------------------------------------------- */

test('the gate is the permission, and the same one the action re-checks', () => {
  assert.ok(PAGE.includes("const session = await pagePermission('can_manage_students')"))
  // The call, not the word: two comments here name `pageRole` to say what this is not.
  assert.doesNotMatch(PAGE, /await pageRole\(/)
  assert.ok(IMPORT_ACTION.includes("const session = await mayManage('can_manage_students', 'students')"))

  // Who may buy, who may ask, who may read the plan — three different answers, and
  // none of them is "whoever reached this page".
  assert.ok(PAGE.includes("mayBuy={session.active.role === 'owner'}"))
  assert.ok(PAGE.includes("const mayAsk = session.active.role === 'manager'"))
  assert.ok(PAGE.includes('mayReadPlan={isStaffAdmin(session)}'))
})

test('a count that did not arrive takes the paste box away', () => {
  // Before `studentRoom`, because room computed from a failed count is a number
  // this screen would then draw.
  const guard = at(PAGE, 'if (batches === null || studentCount === null) {')
  assert.ok(guard < at(PAGE, 'studentRoom(session.ceiling, studentCount)'))
  assert.ok(PAGE.includes('{t.unreadable}'))

  // And the action refuses the same way rather than reading it as zero.
  assert.ok(IMPORT_ACTION.includes('if (count === null) return { error: t.errors.limitUnknown }'))
  assert.ok(IMPORT_ACTION.includes('if (fresh === null) return { error: t.errors.limitUnknown }'))
})

test('the roster is a hint, and null means no hint rather than no matches', () => {
  assert.ok(PAGE.includes('const HINT_CEILING = 1000'))
  assert.ok(
    PAGE.includes(`            roster === null || roster.length > HINT_CEILING
              ? null`),
  )

  // The count is active students; the roster deliberately is not filtered, so a
  // leaver is still "already on the roster" and re-importing them skips.
  assert.equal(count(PAGE, "eq('status', 'active')"), 1)
  assert.ok(PAGE.includes('.limit(HINT_CEILING + 1)'))

  // A missing hint counts every line as new, which is the honest direction.
  assert.ok(FORM.includes('const hinting = existingKeys !== null'))
  assert.ok(FORM.includes('const newCount = hinting ? ready.length - alreadyThere : ready.length'))
})

test('the price is quoted off the paid ceiling, and nothing is created before it', () => {
  // Not `session.ceiling`: a trial moves what fits, while settle_payment_intent
  // reads the paid row, so a quote off the trial is one the database refuses.
  assert.ok(
    PAGE.includes(
      'const paid = studentCeiling(planFor(session.active.plan), session.active.studentCapacity)',
    ),
  )
  assert.ok(PAGE.includes("const forSale = paid.kind === 'purchased' ? paid.ceiling : null"))

  assert.ok(FORM.includes('const short = overRoom ? newCount - room : 0'))
  assert.ok(FORM.includes('capacityBands(forSale, forSale + short)'))
  assert.ok(FORM.includes('capacityCostBdt(forSale, forSale + short)'))
  assert.ok(FORM.includes('<input type="hidden" name="places" value={short} readOnly />'))

  // §10: the whole paste lands or none of it does, so an over-room list disables the
  // button instead of being trimmed to fit.
  assert.ok(FORM.includes('disabled={pending || newCount === 0 || tooMany || overRoom}'))
  assert.ok(IMPORT_ACTION.includes('if (fresh.length > room) {'))
  assert.ok(IMPORT_ACTION.includes('if (rows.length > MAX_IMPORT_ROWS) {'))
  assert.ok(IMPORT_ACTION.includes('if (full.length > 0) {'), 'and the per-batch cap')
})

test('one form, three actions, and the batch ticks are controlled', () => {
  // A second <form> inside the first is illegal, and a link to /settings/plan would
  // throw away a five-hundred-line paste to buy the places it needs. Counted on the
  // opening attribute, because three comments say the tag name to explain the rule.
  assert.equal(count(FORM, '<form action='), 1)
  assert.ok(FORM.includes('formAction={buy}'))
  assert.ok(FORM.includes('formAction={ask}'))
  assert.ok(FORM.includes('formAction={withdraw}'))

  // React 19 resets an uncontrolled field after a Server Action, and the box keeps
  // the failed lines on purpose — so an uncontrolled tick imported the retry into
  // no batch at all.
  assert.ok(FORM.includes('checked={chosen.includes(batch.id)}'))
  assert.ok(FORM.includes("const [chosen, setChosen] = useState<string[]>([])"))
})
