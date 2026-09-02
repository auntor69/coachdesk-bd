import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  byRegisterOrder,
  chargePlan,
  chargeRoster,
  CHARGE_CATEGORIES,
  isChargeCategory,
  type ChargeStudent,
} from '../src/lib/fees/charge.ts'
import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

/** A roster entry, coded unless the test is about the ones with no code. */
function student(id: string, name: string, code: string | null = id): ChargeStudent {
  return { id, name, code }
}

/** An enrolment row as PostgREST hands it over, embed and all. */
function enrolled(id: string, name: string, code: string | null = id) {
  return { students: { id, name, student_code: code } }
}

test('tuition is not a category this form can raise', () => {
  // The schema is what refuses it — `fee_invoices_category_enrollment_bound` allows a
  // non-tuition bill only when there is no enrolment, and a monthly fee is raised
  // against one — but the refusal arrives as a bare 400 an owner can do nothing with.
  assert.equal(isChargeCategory('tuition'), false)
  for (const category of CHARGE_CATEGORIES) {
    assert.equal(isChargeCategory(category), true, category)
  }
})

test('anything else off a form fails closed', () => {
  for (const raw of ['', ' ', 'Exam', 'salary', 'rent', 'admission ', 'null']) {
    assert.equal(isChargeCategory(raw), false, JSON.stringify(raw))
  }
})

test('every category the form offers has a label in both languages', () => {
  // `tsc` already fails on a missing key through the shared dictionary type; this is
  // about the label actually being there to read inside the select.
  for (const category of CHARGE_CATEGORIES) {
    for (const d of [bn, en]) {
      const label = d.fees.categories[category]
      assert.equal(typeof label, 'string', category)
      assert.ok(label.trim().length > 0, category)
    }
  }
})

test('tuition keeps a label too, because the breakdown has a row for it', () => {
  for (const d of [bn, en]) {
    assert.ok(d.fees.categories.tuition.trim().length > 0)
  }
})

test('the roster is one row per student, however many enrolments they hold', () => {
  // A child can sit two subjects in the same batch, and a re-enrolment after a break is
  // a second active row. Two boxes for one child is two rows in one insert carrying the
  // same idempotency key, which the unique index refuses — rolling back the whole run.
  const roster = chargeRoster([
    enrolled('s1', 'Fahmida', '01'),
    enrolled('s1', 'Fahmida', '01'),
    enrolled('s2', 'Rashed', '02'),
  ])

  assert.deepEqual(roster, [
    { id: 's1', name: 'Fahmida', code: '01' },
    { id: 's2', name: 'Rashed', code: '02' },
  ])
})

test('the embed arrives as a row or as a one-element array, and both read', () => {
  // PostgREST answers a to-one embed either way depending on how it resolves the
  // relationship, and the app has been bitten by assuming the object form before.
  const asRow = chargeRoster([enrolled('s1', 'Fahmida', '01')])
  const asArray = chargeRoster([{ students: [{ id: 's1', name: 'Fahmida', student_code: '01' }] }])

  assert.deepEqual(asRow, asArray)
})

test('an enrolment with no student behind it is skipped, not counted', () => {
  const roster = chargeRoster([
    { students: null },
    { students: [] },
    enrolled('s1', 'Fahmida', '01'),
  ])

  assert.deepEqual(roster, [{ id: 's1', name: 'Fahmida', code: '01' }])
})

test('the roster is in register order — code first, then name', () => {
  const roster = chargeRoster([
    enrolled('s3', 'Anika', '07'),
    enrolled('s1', 'Zubair', '02'),
    enrolled('s2', 'Bilkis', '02'),
  ])

  assert.deepEqual(
    roster.map((s) => s.id),
    ['s2', 's1', 's3'],
  )
})

test('a student with no code sorts after one who has it', () => {
  // A centre that numbers its register has numbered the students it wants to find
  // quickly, which is `nullsFirst: false` in the query this mirrors.
  const sorted = [
    student('s1', 'Anika', null),
    student('s2', 'Zubair', '99'),
  ].sort(byRegisterOrder)

  assert.deepEqual(
    sorted.map((s) => s.id),
    ['s2', 's1'],
  )

  // Both uncoded, so the name decides.
  const byName = [
    student('s1', 'Zubair', null),
    student('s2', 'Anika', null),
  ].sort(byRegisterOrder)

  assert.deepEqual(
    byName.map((s) => s.id),
    ['s2', 's1'],
  )
})

test('only students the caller could read for themselves are billed', () => {
  // The ticked ids arrive over HTTP, so they are a claim. The composite foreign key
  // would refuse another centre's student anyway, but as a 400 with no sentence on it.
  const roster = [student('s1', 'Fahmida'), student('s2', 'Rashed')]
  const plan = chargePlan(['s1', 'someone-elses-student', 's2'], roster)

  assert.deepEqual(plan.students, ['s1', 's2'])
  assert.equal(plan.unknown, 1)
})

test('a name that left the roster is counted, not billed', () => {
  // The window between rendering the list and pressing submit is long enough for a
  // student to be retired, and the count is what tells the owner the number of bills is
  // not the number of ticks.
  const plan = chargePlan(['s1', 'gone'], [student('s1', 'Fahmida')])

  assert.deepEqual(plan.students, ['s1'])
  assert.equal(plan.unknown, 1)
})

test('the same student ticked twice is billed once', () => {
  // Not reachable from the form — one checkbox per row — but a replayed or hand-made
  // submission can say it, and the index is (centre, key, student): a doubled student
  // collides with themselves and rolls the whole statement back.
  const plan = chargePlan(['s1', 's1', 's1'], [student('s1', 'Fahmida')])

  assert.deepEqual(plan.students, ['s1'])
  assert.equal(plan.unknown, 0)
})

test('blank and padded ids are dropped without becoming unknowns', () => {
  const roster = [student('s1', 'Fahmida')]
  const plan = chargePlan(['', '   ', ' s1 '], roster)

  assert.deepEqual(plan.students, ['s1'])
  assert.equal(plan.unknown, 0)
})

test('the roster decides the order, so a replay hits the same first row', () => {
  // What makes the retry deterministic: the same ticks in a different field order
  // produce the same insert, so the unique index refuses at the same place rather than
  // part-writing a batch on the second arrival.
  const roster = [student('s1', 'A', '01'), student('s2', 'B', '02'), student('s3', 'C', '03')]

  assert.deepEqual(chargePlan(['s3', 's1', 's2'], roster).students, ['s1', 's2', 's3'])
  assert.deepEqual(chargePlan(['s2', 's3', 's1'], roster).students, ['s1', 's2', 's3'])
})

test('nobody ticked is nobody billed, and nothing unknown', () => {
  const plan = chargePlan([], [student('s1', 'Fahmida')])

  assert.deepEqual(plan.students, [])
  assert.equal(plan.unknown, 0)
})

test('every tick unknown leaves an empty bill list the action can refuse', () => {
  const plan = chargePlan(['x', 'y'], [student('s1', 'Fahmida')])

  assert.deepEqual(plan.students, [])
  assert.equal(plan.unknown, 2)
})

test('the confirmation counts bills and names the fee, in both languages', () => {
  for (const d of [bn, en]) {
    for (const n of [1, 40]) {
      const line = d.fees.chargeCreated(d.fees.categories.exam, n, '৳4,000')
      assert.ok(line.includes(String(n)), line)
      assert.ok(line.includes(d.fees.categories.exam), line)
      assert.ok(line.includes('৳4,000'), line)
    }
    for (const n of [1, 3]) {
      assert.ok(d.fees.chargeUnknown(n).includes(String(n)))
    }
  }
})

/* -------------------------------------------------------------------------- */
/* And the screen's own shape                                                 */
/* -------------------------------------------------------------------------- */

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const PAGE = read('src', 'app', '(app)', 'fees', 'charge', 'page.tsx')
const FORM = read('src', 'app', '(app)', 'fees', 'charge', 'charge-form.tsx')

/** From the form's own tag, so `border-2` in the two class consts is out of reach. */
const RENDER = FORM.slice(FORM.indexOf('<form\n'))

/** Each anchor is an assertion: a changed span makes its `indexOf` -1. */
const FEE_AT = RENDER.indexOf('<Card className="lg:col-span-7">')
const LIST_AT = RENDER.indexOf('overflow-hidden rounded-2xl')
const RAIL_AT = RENDER.indexOf('<div className="flex flex-col gap-4 lg:col-span-7">')
const ROWS_AT = RENDER.indexOf('const ChargeRows = memo(')

const FEE = RENDER.slice(FEE_AT, LIST_AT)
const LIST = RENDER.slice(LIST_AT, RAIL_AT)
const RAIL = RENDER.slice(RAIL_AT, ROWS_AT)
const ROWS = RENDER.slice(ROWS_AT)

/** See plan-page.test.ts: the lookbehind keeps `border-2` and `lg:col-span-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s`])order-(\d+|last)\b/g)].map((m) => m[1])
}

test('the fee takes seven columns, the roster five, and the press goes under the fee', () => {
  // 7 + 5 fills the first row, so the third block lands in the second one on its own —
  // no `col-start` and no `row-span` holding it there, which is what lets the source
  // order stay the order somebody fills this in.
  assert.ok(FEE_AT > 0, 'the fee card is not seven columns')
  assert.ok(LIST_AT > FEE_AT, 'the roster is not written after the fee')
  assert.ok(RAIL_AT > LIST_AT, 'the press is not written after the roster')

  assert.match(RENDER, /lg:grid lg:grid-cols-12 lg:items-start lg:gap-6/)
  assert.match(LIST, /border border-line bg-white\s+lg:col-span-5/)
})

test('the roster is a panel that scrolls itself, and only where there are two columns', () => {
  // The fault this redesign exists to fix: the button and the figure that guards it sat
  // below every name in the batch, so a 250-student charge put them eight thousand
  // pixels down. A phone keeps the long list — a scrolling box inside a scrolling page
  // is worse than scrolling once.
  assert.match(LIST, /lg:max-h-\[70vh\] lg:overflow-y-auto/)
  assert.doesNotMatch(RENDER, /(?<!lg:)overflow-y-auto/, 'the panel scrolls on phones too')

  // Tick all and clear are above the scroll, so they are still there at row two hundred.
  assert.ok(LIST.indexOf('{t.tickAll}') < LIST.indexOf('lg:max-h-'))
  assert.ok(LIST.indexOf('lg:max-h-') < LIST.indexOf('<ChargeRows'))
})

test('no block is moved, because the source order is the order somebody fills it in', () => {
  // Fields, then ticks, then submit: the reading order, the tab order and the phone
  // order at once. `order` moves neither a keyboard nor a screen reader, so a laptop
  // arrangement that needed it would be one that tabs to the button before the names.
  assert.deepEqual(ordersIn(RENDER), [])
  assert.doesNotMatch(RENDER, /lg:order-/)
  assert.ok(RENDER.indexOf('<ChargeRows') < RENDER.indexOf('type="submit"'))
})

test('the total is drawn once, beside the button, and is the action’s own arithmetic', () => {
  assert.equal(RENDER.split('formatTaka(tally.total)').length - 1, 1)
  assert.match(RAIL, /className="num text-3xl font-bold text-ink">\{formatTaka\(tally\.total\)\}/)
  assert.match(RAIL, /\{fill\(t\.tickedCount, \{ n: digits\(tally\.ticked, locale\) \}\)\}/)
  assert.match(RAIL, /type="submit"/)
  assert.doesNotMatch(LIST, /tally\./, 'the figure is drawn inside the roster')

  // Read out of the DOM through the modules the action itself uses, so the figure
  // checked before the press and the figure written by it cannot drift.
  assert.match(FORM, /parseTaka\(String\(data\.get\('amount'\) \?\? ''\)\)/)
  assert.match(FORM, /sumTaka\(Array\(ticked\)\.fill\(each\)\)/)
  assert.match(FORM, /\? instalmentPlan\(\{/)
})

test('what the press came back with is drawn in the rail, not at the top', () => {
  for (const branch of ['state?.error', 'state?.warn', 'state?.ok']) {
    assert.ok(RAIL.includes(branch), `${branch} is not beside the button`)
    assert.equal(RENDER.split(branch).length - 1, 1, `${branch} is drawn twice`)
  }
  assert.match(RAIL, /role="status"/)
})

test('the ticks start on, stay out of state, and the column stays memoised', () => {
  // Same load-bearing decision as the arrears column: 250 boxes whose state lives in
  // React re-render the whole list on every tap. `checked={` is how that arrives.
  assert.match(ROWS, /defaultChecked/)
  assert.doesNotMatch(ROWS, /checked=\{/, 'a tick became controlled')
  assert.match(FORM, /const ChargeRows = memo\(function ChargeRows\(/)
  assert.match(FORM, /onChange=\{\(e\) => recount\(e\.currentTarget\)\}/)

  // Setting `.checked` in code fires no change event, so tick-all has to re-add itself.
  assert.match(FORM, /input\[name="studentId"\]/)
  assert.ok(FORM.indexOf('box.checked = checked') < FORM.indexOf('recount(el)'))

  // Minted on mount and re-minted after a success, because the form is reset: the same
  // key against a cleared form is refused by the index instead of raising the next charge.
  assert.match(FORM, /if \(state\?\.ok\) form\.current\?\.reset\(\)/)
  assert.match(FORM, /input\.value = mintIdempotencyKey\(\)/)
})

test('the schedule is a band inside the fee card, not a tile inside it', () => {
  // §20.7: a bordered, rounded box inside a bordered Card reads as a second card. Bled
  // to the card's edges instead, and still directly under the control that produces it —
  // an owner splitting ৳6,000 three ways is agreeing to three dates.
  assert.match(FEE, /-mx-5 bg-surface-alt px-5 py-3/)
  assert.doesNotMatch(FEE, /rounded-xl border border-line bg-surface-alt/)
  assert.match(FEE, /\{tally\.parts > 1 && tally\.each > 0 && \(/)
  assert.ok(FEE.indexOf('id="instalments"') < FEE.indexOf('-mx-5'))
  assert.match(FEE, /\{t\.scheduleTooSmall\}/)

  // Built from the module's list, so `tuition` cannot be offered by this form.
  assert.match(FEE, /CHARGE_CATEGORIES\.map/)
})

test('the letterhead says what the screen is, and no card is a metre wide', () => {
  assert.equal(
    PAGE.split('className="text-xl font-semibold text-ink lg:text-2xl">{t.title}').length - 1,
    1,
  )
  assert.equal(PAGE.split('{t.subtitle}').length - 1, 1)
  assert.equal(PAGE.split('{t.backToFees}').length - 1, 1, 'a way back went missing')

  // The picker, the refusal, "choose a batch" and the empty batch — four one-sentence
  // cards, none of them stretched across a laptop.
  assert.equal(PAGE.split('lg:max-w-2xl').length - 1, 4)

  // The picker's button beside its select from `sm`, full width under it on a phone.
  assert.match(PAGE, /method="get"/)
  assert.match(PAGE, /sm:flex-row sm:items-end sm:gap-3/)
  assert.match(PAGE, /className="mt-3 w-full sm:mt-0 sm:w-auto"/)
})

test('§38: the gate, the guard on the parameter and both reads are the ones that were there', () => {
  assert.match(PAGE, /pageCapability\('fees'\)/)

  // The batch list is the guard on `?batch=`: a uuid out of the address bar is only
  // accepted if this session could read that batch for itself.
  assert.match(PAGE, /wanted === EVERY_BATCH/)
  assert.match(PAGE, /\(batches \?\? \[\]\)\.some\(\(b\) => b\.id === wanted\)/)

  assert.equal(PAGE.split(".eq('coaching_center_id', session.active.centerId)").length - 1, 3)
  assert.match(PAGE, /\.eq\('active', true\)/)
  assert.match(PAGE, /\.eq\('batch_id', chosen\)/)
  assert.match(PAGE, /\.eq\('status', 'active'\)/)

  // Both roster reads paged, and one row per student out of the enrolment read.
  assert.equal(PAGE.split('pageAll((from, to) =>').length - 1, 2)
  assert.match(PAGE, /chargeRoster\(read\.rows\)/)
  assert.match(PAGE, /\.sort\(byRegisterOrder\)/)

  // Forwards one month is allowed here, unlike the arrears loader: a non-tuition bill
  // carries no enrolment, so it cannot take the slot the generator needs.
  assert.match(PAGE, /\[-1, 0, 1\]\.map\(\(delta\) =>/)
})
