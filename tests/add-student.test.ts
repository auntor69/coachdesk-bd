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
 * §3.4 is a business rule and fails quietly. The refusal used to end with "ask for more
 * places on the plan screen" — the journey the masterplan opens by forbidding, because it
 * sends an owner with a family at the desk to another screen to work out how many places
 * to buy. The price, the control and the reference now live on this card, and the words no
 * longer name a destination.
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
const ACTIONS = read('src', 'app', '(app)', 'settings', 'plan', 'actions.ts')

/** The at-limit shape, from its early return to the end of it. */
const WALL_AT = PAGE.indexOf('if (atLimit) {')
/** The ordinary shape: the grid that opens it to the end of the component. */
const GRID_AT = PAGE.indexOf('<div className="flex flex-col gap-5 lg:grid')
const WALL = PAGE.slice(WALL_AT, GRID_AT)
const RENDER = PAGE.slice(GRID_AT)

const MAIN_AT = RENDER.indexOf('contents lg:order-2 lg:col-span-7')
const RAIL_AT = RENDER.indexOf('contents lg:order-3 lg:col-span-5')

/** See plan-page.test.ts: the lookbehind keeps `border-line` and `lg:order-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s])order-(\d+|last)\b/g)].map((m) => m[1])
}

test('the screen has two shapes and the wall is the narrow one', () => {
  assert.ok(WALL_AT > 0, 'the at-limit early return is not where this test expects it')
  assert.ok(GRID_AT > WALL_AT, 'the grid should be written after the early return')

  // One column and capped. A 7/5 split with an empty rail beside a single card is a
  // third of a laptop screen saying nothing.
  assert.match(WALL, /<div className="flex max-w-2xl flex-col gap-5">/)
  assert.doesNotMatch(WALL, /lg:grid-cols-12/, 'the wall is not a twelve-column grid')

  // And the header is the same JSX on both, so a back link cannot go missing from one.
  assert.equal([...PAGE.matchAll(/const head = \(/g)].length, 1)
  assert.match(WALL, /\{head\}/)
  assert.match(RENDER, /\{head\}/)
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

  // The header spans the lot rather than sitting above a seven-column column.
  assert.match(RENDER, /className="order-1 lg:col-span-12"/)
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

  // 1 to 5 with nothing missing: header, warning, form, import door, saves card.
  const used = [...counts.keys()]
  for (let n = 1; n <= 5; n += 1) {
    assert.ok(used.includes(String(n)), `no block is order-${n}`)
  }
  assert.equal(used.length, 5, `${used.length} distinct positions, expected 5`)
})

test('the warning draws above the form on a phone, and each column draws as written', () => {
  // The whole reason the numbers are not in source order. Eighteen students short of the
  // ceiling is something to read before typing a name, not after submitting one — and on
  // a phone the rail is written second, so only `order-2` puts it first.
  const main = RENDER.slice(MAIN_AT, RAIL_AT)
  const rail = RENDER.slice(RAIL_AT)

  assert.match(main, /<StudentForm/, 'the form left the main column')
  assert.match(rail, /<PlacesWarning/, 'the warning left the rail')
  assert.equal(ordersIn(main).join(), '3', 'the form is not the only block in the main column')
  assert.equal(ordersIn(rail)[0], '2', 'the warning does not draw above the form')

  // Inside each wrapper the numbers still apply at `lg`, so a column whose numbers do
  // not ascend in source order is a phone and a laptop that disagree.
  for (const [name, values] of [['main', ordersIn(main)], ['rail', ordersIn(rail)]] as const) {
    const numeric = values.map((v) => (v === 'last' ? Infinity : Number(v)))
    assert.deepEqual([...numeric].sort((a, b) => a - b), numeric,
      `${name} draws in a different order than it is written`)
  }

  // The warning is placed with a className rather than wrapped in a div, because it
  // returns null while there is room and a wrapper would cost a flex gap on every
  // screen where there is nothing to warn about.
  assert.match(rail, /<PlacesWarning\s+className="order-2"/)

  // Staff admins only, exactly as the roster gates it: the warning ends in a link to
  // /settings/plan, which a teacher on `can_manage_students` would be refused at.
  assert.match(rail, /\{isStaffAdmin\(session\) && \(\s*<PlacesWarning/)
})

test('the wall carries every way out that its reader actually has', () => {
  // §3.4: the buy control on the screen the refusal happened on, priced from the paid
  // ceiling because that is the number `settle_payment_intent` bills from.
  assert.match(WALL, /<BuyPlaces\s+ceiling=\{paid\.ceiling\}/)

  // §20.5, in as many words: the refusal names the price rather than the constraint,
  // from the same function the control quotes with and off the paid ceiling.
  assert.match(WALL, /t\.placesNext\(formatTaka\(nextSeatCostBdt\(paid\.ceiling\)\)\)/)

  // §22, and it is the sentence that changes what the owner does with the family in
  // front of them: the money is sent by hand, so this form admits nobody.
  const buyAt = WALL.indexOf('<BuyPlaces')
  assert.ok(WALL.indexOf('t.placesBuyNote') < buyAt, 'the honest note is not above the control')
  assert.ok(WALL.indexOf('t.placesNext') < WALL.indexOf('t.placesBuyNote'))

  // The reference below the control, because `places.opened` says to send the money as
  // shown below and after the revalidate this is what is below.
  assert.ok(WALL.indexOf('<OpenPurchase') > buyAt, 'the waiting purchase is above the control')
  assert.match(WALL, /places\.waitingTitle/)
  assert.match(WALL, /buys\.error &&/, 'a dropped purchase read says nothing')

  // The manager's ask, the free-a-place link every tier has, and the plan link last.
  assert.match(WALL, /\{mayAsk && \(\s*<AskPlaces/)
  assert.match(WALL, /t\.placesFreeLink/)
  assert.ok(
    WALL.indexOf('t.placesFreeLink') < WALL.indexOf('t.placesPlanLink'),
    'the plan link is offered before the one that costs nothing',
  )
  assert.match(WALL, /\{isStaffAdmin\(session\) && \(\s*<Link\s+href="\/settings\/plan"/)
})

test('who may buy and who may ask is decided the way the actions decide it', () => {
  // §3.7. `buyStudentPlaces` is planOwner() and `capacity_requests_manager_insert` is
  // the manager's only write here, so a control offered to the other reader is a button
  // that refuses. Exactly one of the two can ever be true.
  assert.match(PAGE, /const mayBuy = atLimit && sells && session\.active\.role === 'owner'/)
  assert.match(PAGE, /const mayAsk = atLimit && sells && session\.active\.role === 'manager'/)

  // Both gated on the PAID plan, not the effective ceiling: a trial of a teacher tier
  // over a paid centre subscription would otherwise hide the way out on the one centre
  // that could have had the places by the evening.
  assert.match(
    PAGE,
    /const paid = studentCeiling\(planFor\(session\.active\.plan\), session\.active\.studentCapacity\)/,
  )
  assert.match(PAGE, /const sells = paid\.kind === 'purchased'/)

  // A read that failed draws the form. `createStudent` refuses on the write if the
  // count is still unknown; turning a family away over a number nobody has would be
  // the wrong half to fail on.
  assert.match(PAGE, /const atLimit = studentRoom\(session\.ceiling, studentCount \?\? 0\) === 0/)

  // And the batch list is scoped as well as governed by RLS: an owner of two centres
  // passes is_staff_admin for both, so the policy alone offers the other one's batches.
  assert.match(PAGE, /\.from\('batches'\)[\s\S]{0,400}\.eq\('coaching_center_id', session\.active\.centerId\)/)
})

test('a purchase opened here refreshes the screen it was opened on', () => {
  // Without this the confirmation says "send the money as shown below" above nothing,
  // because the reference is read off the row rather than carried in the action state.
  //
  // Scoped to the one function that needed it. Five actions in the file revalidate this
  // path, so a bare search over the source passes on somebody else's line — which is
  // exactly what happened the first time this was asserted.
  const from = ACTIONS.indexOf('export async function buyStudentPlaces(')
  assert.ok(from > 0, 'buyStudentPlaces has been renamed')
  const body = ACTIONS.slice(from, ACTIONS.indexOf('export async function', from + 10))
  assert.match(body, /revalidatePath\('\/settings\/students\/new'\)/)
  assert.match(body, /revalidatePath\('\/settings\/plan'\)/)
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

test('neither language sends a refused reader to another screen', () => {
  // §3.4's regression, and it is a regression in prose: every way out is on the card
  // now, so a sentence that names a destination is one the reader has to leave for.
  for (const [name, places] of [
    ['en', en.settings.students.places(120)],
    ['bn', bn.settings.students.places(120)],
  ] as const) {
    assert.doesNotMatch(places, /plan screen|প্ল্যানের পাতা/, `${name} still points elsewhere`)
    assert.ok(places.length > 40, `${name} says too little to be the whole card's opening`)
  }

  // Bangla numerals in Bangla, ASCII in English — the figure is a count of places.
  assert.match(en.settings.students.places(120), /120/)
  assert.match(bn.settings.students.places(120), /১২০/)

  // The new leaves exist in both, and none of them is a stub. A key added to en and
  // forgotten in bn is a screen that reads half in each language.
  for (const [name, dict] of [['en', en], ['bn', bn]] as const) {
    const t = dict.settings.students
    for (const [key, least] of [
      ['placesBuyNote', 80],
      ['placesFreeLink', 12],
      ['savesTitle', 8],
      ['savesPhone', 40],
      ['savesBatch', 40],
    ] as const) {
      const value = t[key]
      assert.equal(typeof value, 'string', `${name}.settings.students.${key} is missing`)
      assert.ok(
        (value as string).trim().length >= least,
        `${name}.${key} is ${(value as string).trim().length} characters — too short to say it`,
      )
    }

    // The price line is a template, and the figure has to survive being put in it:
    // `formatTaka` hands over '৳25' already formatted, so a leaf that dropped the
    // parameter would print a sentence with no price in the place §20.5 wants one.
    assert.match(t.placesNext('৳25'), /৳25/, `${name}.placesNext drops the price`)

    // §22 in the one line that could quietly promise otherwise. The places arrive when a
    // human has matched a transfer; a note that says "instantly" or "automatically" would
    // have an owner keeping a family at the desk waiting for a form to finish.
    assert.doesNotMatch(
      t.placesBuyNote,
      /instant|automatic|straight away|at once|সঙ্গে সঙ্গে|স্বয়ংক্রিয়/i,
      `${name}.placesBuyNote promises the places arrive by themselves`,
    )
  }
})

test('the rail says what saving the form actually does', () => {
  const rail = RENDER.slice(RAIL_AT)
  for (const key of ['savesTitle', 'savesPhone', 'savesBatch']) {
    assert.ok(rail.includes(`t.${key}`), `the rail does not draw t.${key}`)
  }

  // The import door, word for word the roster's: two hundred names typed one at a time
  // is an evening nobody spends, and this form is where somebody finds that out on
  // student four. The count comes from the same constant the paste box enforces.
  assert.match(rail, /href="\/settings\/students\/import"/)
  assert.match(rail, /t\.importBody\(MAX_IMPORT_ROWS\)/)
})
