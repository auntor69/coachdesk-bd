import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

/**
 * Admitting one student: the two shapes of the screen, and the one bug that is invisible.
 *
 * THREE THINGS ARE GUARDED HERE, and they fail in three different ways.
 *
 * The layout is the dashboard's arrangement (see dashboard.test.ts and plan-page.test.ts):
 * one DOM, `order-N` per block, two wrappers that are `display: contents` below `lg`. A
 * block with no order lands at 0, above the heading; a reused number swaps two blocks.
 * That one is at least visible to whoever opens the page.
 *
 * The lapsed centre is the second, and it fails in the most expensive way of the three:
 * `createStudent` runs `requireWritable`, so the form drawn to a read-only centre is
 * twelve fields somebody fills in with a family at the desk to be refused on save.
 *
 * THE THIRD SHAPE IS GONE (§16.1 step 28). This screen used to fork a second time on
 * `atLimit` — no places left, so one column whose whole content was the way out: the
 * price of the next place, the control that bought it, the reference for the transfer and
 * the branch manager's ask. §3.4 exists because that refusal used to name a destination
 * instead of a price. A per-student tier has no ceiling now, so the wall is gone rather
 * than moved: what is left is asserted as an absence, because a fork that comes back
 * comes back with a priced card on the product's most-used write path.
 *
 * THE FORM'S TICKS FAIL SILENTLY AND THAT IS WHY THEY ARE TESTED IN SOURCE. React 19 wraps
 * every form action as `requestFormReset(form); return action(formData)` and calls the
 * native `form.reset()` at the end of the commit. `updateInput` mirrors a controlled text
 * field's `value` into the DOM's `defaultValue` on every commit, so text survives — but it
 * only writes `defaultChecked` when `checked == null`, so a *controlled* checkbox is
 * unticked by the reset while React state still says it is ticked. FormData is read from
 * the DOM. So the second submit after a refusal would post no `batchIds` at all: the
 * student is created, nothing errors, and they are quietly in no batch — no register, no
 * fee bill, found in September. Hence `key={attempt}`, which remounts the ticks so
 * mount-time `initInput` rewrites their defaults from the values that were kept.
 */

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const PAGE = read('src', 'app', '(app)', 'settings', 'students', 'new', 'page.tsx')
const FORM = read('src', 'app', '(app)', 'settings', 'students', 'new', 'student-form.tsx')
const BILLING = read('src', 'app', '(app)', 'settings', 'billing', 'actions.ts')

/** The lapsed-centre shape, which is written first because it answers first. */
const LAPSED_AT = PAGE.indexOf("if (session.access !== 'full') {")
const LAPSED = PAGE.slice(LAPSED_AT, PAGE.indexOf('const [{ data: batches }'))
/** The ordinary shape: the grid that opens it to the end of the component. */
const GRID_AT = PAGE.indexOf('<div className="flex flex-col gap-5 lg:grid')
const RENDER = PAGE.slice(GRID_AT)

const MAIN_AT = RENDER.indexOf('contents lg:order-2 lg:col-span-7')
const RAIL_AT = RENDER.indexOf('contents lg:order-3 lg:col-span-5')

/** See plan-page.test.ts: the lookbehind keeps `border-line` and `lg:order-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s])order-(\d+|last)\b/g)].map((m) => m[1])
}

/**
 * Source with its comments removed.
 *
 * THE ABSENCE CHECKS BELOW ARE ABOUT CODE, and half of this cut's evidence is prose: every
 * place that used to hold a ceiling now carries a sentence naming what went and why (§18).
 * Those sentences have to name the vocabulary — that is what makes them useful — so they
 * are taken out before the scan. See pinned-manager.test.ts for the same helper.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\w])\/\/[^\n]*/g, '$1')
}

const PAGE_CODE = code(PAGE)

test('the screen has three shapes, and no wall at all', () => {
  assert.ok(LAPSED_AT > 0, 'the read-only arm is gone from the add-student screen')
  assert.ok(GRID_AT > LAPSED_AT, 'the grid should be written after the read-only arm')

  // §16.1 step 28: the at-limit fork, its priced card and the two controls on it are gone,
  // and nothing replaced them. Asserted by name rather than by counting returns, because
  // the fork would come back as a *conditional*, which is what a return count misses.
  for (const gone of ['atLimit', 'mayBuy', 'mayAsk', 'PlacesWarning', 'BuyPlaces', 'AskPlaces']) {
    assert.equal(PAGE_CODE.includes(gone), false, `${gone} is back on the add-student screen`)
  }

  /*
   * AND THE THIRD SHAPE IS THE TRIAL'S ROSTER (20260811000098). A per-student tier has no
   * ceiling to be full of, so the wall this test was written to prove absent cannot come back
   * as a plan limit — but a trial is bounded by one number instead, and `createStudent` refuses
   * past it exactly as it refuses a lapsed centre. The arm is asserted here rather than left to
   * the roster's own test file because it shares this screen's bar: a form drawn for a reader
   * who could only be refused is the defect this screen is written against.
   */
  assert.match(PAGE, /const door = await rosterDoor\(supabase, session\)/)
  assert.match(PAGE, /if \(!door\.open\) \{/)
  assert.ok(
    PAGE.indexOf('if (!door.open) {') < GRID_AT,
    'the bound is answered before the form is drawn',
  )

  // And the bar is the same JSX on all three shapes, so a back link cannot go missing from one.
  assert.equal([...PAGE.matchAll(/const head = \(/g)].length, 1)
  assert.match(PAGE, /const head = \(\s+<PageHeader title=\{t\.newTitle\}/)
  assert.equal([...PAGE.matchAll(/\{head\}/g)].length, 3)
})

test('a lapsed centre gets no form, and is told that before anything is read', () => {
  // `createStudent` runs requireWritable, so the form could only ever be filled in and
  // refused — with a family at the desk, which is the whole cost of this screen's version
  // of the defect.
  assert.match(LAPSED, /\{head\}/, 'the arm draws no heading, so nothing names the screen')
  assert.match(LAPSED, /<ReadOnlyNote t=\{d\.readOnly\}/)
  assert.match(PAGE, /import \{ ReadOnlyNote \} from '@\/components\/read-only-note'/)

  // And before every read, so the arm costs no round trips rather than two wasted ones.
  for (const query of ['branchChoicesFor(supabase', "from('batches')"]) {
    assert.ok(PAGE.indexOf(query) > LAPSED_AT, `${query} runs for a centre that cannot write`)
  }
})

test('the render is one column on a phone and twelve from lg up', () => {
  // `lg:items-start` on the class rather than on a loose match: the comment above the
  // div names the arrangement, and prose passes a sloppy regex after the class is gone.
  assert.match(
    RENDER,
    /^<div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">/,
  )

  assert.ok(MAIN_AT > 0, 'the main column wrapper is not where this test expects it')
  assert.ok(RAIL_AT > MAIN_AT, 'the rail should be written after the main column')

  // Seven and five, as on the plan screen: the form is what the reader came for and the
  // rail is sentences, which a third of 1,280px wraps.
  assert.match(RENDER, /lg:col-span-7/)
  assert.match(RENDER, /lg:col-span-5/)

  // No twelfth-column cell for the heading any more: the bar sits above the grid, because
  // a sticky box only travels inside its containing block and a cell's is one grid row.
  assert.doesNotMatch(RENDER, /lg:col-span-12/)
})

test('the wrappers disappear on a phone and become columns on a laptop', () => {
  for (const wrapper of ['lg:order-2 lg:col-span-7', 'lg:order-3 lg:col-span-5']) {
    const at = RENDER.indexOf(wrapper)
    const decl = RENDER.slice(at - 20, at + 120)
    assert.match(decl, /contents/, `${wrapper} is not contents on a phone`)
    assert.match(decl, /lg:flex lg:flex-col/, `${wrapper} never becomes a column`)
  }

  // Exactly the two, because a grid item with no `lg:order` is 0 and draws above the
  // header — which is the one place nothing may go.
  assert.equal(
    [...RENDER.matchAll(/lg:order-[23]\b/g)].length,
    2,
    'exactly the two wrappers carry an lg:order',
  )
})

test('every block has a place in the phone order, and no two share one', () => {
  const counts = new Map<string, number>()
  for (const value of ordersIn(RENDER)) counts.set(value, (counts.get(value) ?? 0) + 1)

  for (const [value, n] of counts) {
    assert.equal(n, 1, `order-${value} is used ${n} times`)
  }

  // 3 to 5 with nothing missing: form, import door, saves card. There is no `order-1` — that
  // was the heading's twelfth-column cell, replaced by the bar above the grid — and no
  // `order-2`, which was the places warning and went with the ceiling. The numbers were left
  // where they were rather than shifted down, because only their relative order matters and
  // renumbering three blocks to save a 1 is three chances to swap two of them.
  const used = [...counts.keys()]
  for (let n = 3; n <= 5; n += 1) {
    assert.ok(used.includes(String(n)), `no block is order-${n}`)
  }
  assert.equal(used.length, 3, `${used.length} distinct positions, expected 3`)
})

test('each column draws in the order it is written', () => {
  const main = RENDER.slice(MAIN_AT, RAIL_AT)
  const rail = RENDER.slice(RAIL_AT)

  assert.match(main, /<StudentForm/, 'the form left the main column')
  assert.equal(ordersIn(main).join(), '3', 'the form is not the only block in the main column')
  assert.equal(ordersIn(rail).join(), '4,5', 'the rail is the door then the card')

  // Inside each wrapper the numbers still apply at `lg`, so a column whose numbers do not
  // ascend in source order is a phone and a laptop that disagree.
  for (const [name, values] of [['main', ordersIn(main)], ['rail', ordersIn(rail)]] as const) {
    const numeric = values.map((v) => (v === 'last' ? Infinity : Number(v)))
    assert.deepEqual([...numeric].sort((a, b) => a - b), numeric,
      `${name} draws in a different order than it is written`)
  }

  // The import door, word for word the roster's: two hundred names typed one at a time is
  // an evening nobody spends, and this form is where somebody finds that out on student
  // four. The count comes from the same constant the paste box enforces.
  assert.match(rail, /href="\/settings\/students\/import"/)
  assert.match(rail, /t\.importBody\(MAX_IMPORT_ROWS\)/)
})

test('the wall is gone, with every control it carried', () => {
  // §3.4's card, §3.7's ask, the paid-ceiling arithmetic behind both, and the two reads
  // they needed. Each is named, because each was a way for the purchase to come back.
  for (const gone of [
    'studentRoom',
    'studentCeiling',
    'capacityPressure',
    'nextSeatCostBdt',
    'ASK_PLACES',
    'placesNext',
    'placesFreeLink',
    "'student_capacity'",
  ]) {
    assert.equal(PAGE_CODE.includes(gone), false, `${gone} is back on the add-student screen`)
  }

  // The action it submitted to is gone from the billing module as well, and so are the
  // three that answered and withdrew a branch's ask. A control is not the only half.
  for (const gone of ['buyStudentPlaces', 'requestPlaces', 'withdrawPlacesRequest', 'answerAsk']) {
    assert.equal(BILLING.includes(`export async function ${gone}`), false, `${gone} is back`)
  }

  // The batch list is still scoped as well as governed by RLS: an owner of two centres
  // passes is_staff_admin for both, so the policy alone offers the other one's batches.
  assert.match(PAGE, /\.from\('batches'\)[\s\S]{0,400}\.eq\('coaching_center_id', session\.active\.centerId\)/)
})

test('the refusal that keeps the record also keeps the ticks', () => {
  // A remount, not `checked` alone: see the head of this file for what `updateInput`
  // does and does not write. Bumped on the failure branch only, because it costs one.
  assert.match(FORM, /if \(result\?\.ok\) router\.push\('\/settings\/students'\)\s*\n\s*else setAttempt\(\(n\) => n \+ 1\)/)
  assert.match(FORM, /<div key=\{attempt\} className="flex flex-col gap-2">/)
  assert.match(FORM, /<BranchPicker\s+key=\{attempt\}/)
  assert.match(FORM, /onPick=\{setBranchId\}/, 'the branch choice is not mirrored back')

  // Every text field is controlled, which is what makes `reset()` restore it. Counted
  // rather than matched: a field added without `value` is the regression, and it looks
  // exactly like the seven that have one.
  const fields = [...FORM.matchAll(/<Field\b/g)].length
  const valued = [...FORM.matchAll(/value=\{fields\./g)].length
  assert.ok(fields >= 7, `only ${fields} fields found — has the form changed shape?`)
  assert.equal(valued, fields, `${fields} fields but ${valued} are controlled`)

  // The disclosure is left alone on purpose: `reset()` does not close a `<details>`, and
  // a controlled `open` would fight the reader's own tap.
  assert.doesNotMatch(FORM, /<details[^>]*\sopen=/)
})

test('both languages still say what saving the form does', () => {
  // THE PLACES COPY IS STILL HERE AND NOTHING DRAWS IT (§16.1 step 28): `places`,
  // `placesNext`, `placesBuyNote`, `placesFreeLink`, `placesPlanLink` and the ask leaves
  // are retired words waiting on the dictionary pass, so this asserts the half that is
  // drawn rather than the half that is orphaned. A key deleted from en and left in bn is
  // the failure this catches, and it is the same failure either way.
  for (const [name, dict] of [['en', en], ['bn', bn]] as const) {
    const t = dict.settings.students
    for (const [key, least] of [
      ['savesTitle', 8],
      ['savesPhone', 40],
      ['savesBatch', 40],
      ['importTitle', 10],
    ] as const) {
      const value = t[key]
      assert.equal(typeof value, 'string', `${name}.settings.students.${key} is missing`)
      assert.ok(
        (value as string).trim().length >= least,
        `${name}.${key} is ${(value as string).trim().length} characters — too short to say it`,
      )
    }

    // The list line is a function and not a template: it counts, and a count-dependent
    // string cannot be serialised into a client component. See `T`.
    assert.match(t.importBody(200), /200/, `${name}.importBody drops the count`)
  }
})

test('the rail says what saving the form actually does', () => {
  const rail = RENDER.slice(RAIL_AT)
  for (const key of ['savesTitle', 'savesPhone', 'savesBatch']) {
    assert.ok(rail.includes(`t.${key}`), `the rail does not draw t.${key}`)
  }
})
