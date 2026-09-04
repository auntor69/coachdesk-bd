/**
 * A waiver said as a share of the bill, and a named award that carries its own rule.
 *
 * WHAT THIS FILE IS ACTUALLY GUARDING. `fee_invoices_discount_percent_agrees` holds
 * `discount_bdt = round(amount_bdt * discount_percent / 100, 2)`, computed by Postgres in
 * exact decimal. The app computes the same figure from a float and sends both. A
 * disagreement of one poisha is not a rounding curiosity: it is an owner tapping Save,
 * getting a constraint violation, and having nothing on screen that explains it.
 *
 * So the triples below are hand-computed against what Postgres would round to, and
 * scripts/test-rls.mjs writes the same triples to a real invoice and lets the constraint
 * be the judge. Neither file computes the other's answer — that is the point of writing
 * the figures out twice.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  MAX_PERCENT,
  awardBasis,
  normalizePercent,
  percentHundredths,
  percentVerdict,
  percentWaiver,
  readAwardId,
  readBasis,
  ruleWaiver,
  scholarshipVerdict,
} from '../src/lib/fees/scholarship.ts'
import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

/**
 * (bill, share, what Postgres rounds it to). Shared with scripts/test-rls.mjs.
 *
 * The three that earn their place: 333.33 at 50% is exactly 166.665, which a float
 * multiplication rounds *down* to 166.66 because the double nearest 166.665 is a hair
 * under it — Postgres rounds half away from zero and gives 166.67. 1999.99 at 50% is the
 * same tie one order of magnitude up. 999.99 at 33.33% is the case with a long tail, where
 * truncating instead of rounding loses a poisha.
 */
const TRIPLES: ReadonlyArray<readonly [number, number, number]> = [
  [2000, 50, 1000],
  [1500, 50, 750],
  [2200, 50, 1100],
  [1000, 100, 1000],
  [1500, 0.5, 7.5],
  [1250, 12.5, 156.25],
  [1500, 33.33, 499.95],
  [1234.56, 7.5, 92.59],
  [777.77, 25, 194.44],
  [333.33, 50, 166.67],
  [1999.99, 50, 1000],
  [999.99, 33.33, 333.3],
]

test('a share of a bill comes to what the constraint would compute', () => {
  for (const [billed, percent, figure] of TRIPLES) {
    assert.equal(
      percentWaiver(billed, percent),
      figure,
      `${percent}% of ${billed} should be ${figure}`,
    )
  }
})

test('a half poisha rounds away from zero, as round(numeric, 2) does', () => {
  // The one line that would break if this file ever multiplied floats: Math.round on
  // 333.33 * 50 / 100 * 100 gives 16666, a poisha short of the constraint's answer.
  assert.equal(percentWaiver(333.33, 50), 166.67)
})

test('a share of nothing is nothing', () => {
  assert.equal(percentWaiver(0, 50), 0)
  assert.equal(percentWaiver(-100, 50), 0)
  assert.equal(percentWaiver(Number.NaN, 50), 0)
})

test('a share outside the column is priced at nothing rather than guessed at', () => {
  assert.equal(percentWaiver(2000, 0), 0)
  assert.equal(percentWaiver(2000, 101), 0)
  assert.equal(percentWaiver(2000, Number.NaN), 0)
})

test('the whole fee is a legal share', () => {
  assert.equal(percentVerdict(MAX_PERCENT), 'ok')
  assert.equal(percentVerdict(100.01), 'outOfRange')
})

test('zero is out of range rather than a way of clearing a waiver', () => {
  // Unlike the taka figure, where zero is exactly how an owner takes one back. The column
  // itself checks `discount_percent > 0`, so a zero arriving here is a broken form.
  assert.equal(percentVerdict(0), 'outOfRange')
  assert.equal(percentVerdict(-5), 'outOfRange')
})

test('an unreadable share is named as unreadable, not as out of range', () => {
  assert.equal(percentVerdict(Number.NaN), 'unreadable')
  assert.equal(percentVerdict(Number.POSITIVE_INFINITY), 'unreadable')
})

test('a share is held to two places, because the column is', () => {
  // numeric(5, 2) rounds on the way in. Rounding here first means the percentage that is
  // stored is the percentage the figure was priced from — otherwise the row is refused.
  assert.equal(normalizePercent(33.333), 33.33)
  assert.equal(normalizePercent(12.5), 12.5)
  assert.equal(percentHundredths(33.333), 3333)
})

test('a share priced from a rounded percentage agrees with the stored one', () => {
  const typed = 33.333
  assert.equal(percentWaiver(1500, normalizePercent(typed)), percentWaiver(1500, typed))
})

test('an award that is a share prices like a share', () => {
  assert.equal(ruleWaiver({ percent: 50, amountBdt: null }, 2200), 1100)
})

test('an award that is a figure waives that figure', () => {
  assert.equal(ruleWaiver({ percent: null, amountBdt: 300 }, 2000), 300)
})

test('a fixed award larger than the bill is capped at the bill', () => {
  // "Sibling waiver ৳300" against a ৳200 bill. Refusing it would be the wrong answer —
  // the family owes nothing, which is what the award was for — and 300 would break
  // fee_invoices_discount_bound.
  assert.equal(ruleWaiver({ percent: null, amountBdt: 300 }, 200), 200)
})

test('a fixed award against a bill of nothing waives nothing', () => {
  assert.equal(ruleWaiver({ percent: null, amountBdt: 300 }, 0), 0)
})

test('a malformed rule is null, not zero', () => {
  // So a caller cannot mistake "this award is broken" for "this award waives nothing".
  assert.equal(ruleWaiver({ percent: null, amountBdt: null }, 2000), null)
  assert.equal(ruleWaiver({ percent: 50, amountBdt: 300 }, 2000), null)
  assert.equal(ruleWaiver({ percent: 0, amountBdt: null }, 2000), null)
  assert.equal(ruleWaiver({ percent: 120, amountBdt: null }, 2000), null)
  assert.equal(ruleWaiver({ percent: null, amountBdt: -50 }, 2000), null)
})

test('an award needs a name and exactly one rule', () => {
  assert.equal(scholarshipVerdict({ name: 'Merit', percent: 50, amountBdt: null }), 'ok')
  assert.equal(scholarshipVerdict({ name: '  ', percent: 50, amountBdt: null }), 'noName')
  assert.equal(
    scholarshipVerdict({ name: 'Merit', percent: null, amountBdt: null }),
    'noRule',
  )
  assert.equal(
    scholarshipVerdict({ name: 'Merit', percent: 50, amountBdt: 300 }),
    'twoRules',
  )
})

test('the two opposite mistakes are named separately', () => {
  // An owner who filled in neither box and one who filled in both need different
  // sentences, so the verdicts cannot be collapsed.
  assert.notEqual(
    scholarshipVerdict({ name: 'Merit', percent: null, amountBdt: null }),
    scholarshipVerdict({ name: 'Merit', percent: 50, amountBdt: 300 }),
  )
})

test('a rule out of range is refused before the constraint sees it', () => {
  assert.equal(
    scholarshipVerdict({ name: 'Merit', percent: 101, amountBdt: null }),
    'percentRange',
  )
  assert.equal(
    scholarshipVerdict({ name: 'Sibling', percent: null, amountBdt: 0 }),
    'amountRange',
  )
})

test('a missing basis is taka, so a replayed offline request still waives', () => {
  // The load-bearing one. useOffline replays a queued Server Action, and a request queued
  // before this field existed carries no basis at all.
  assert.deepEqual(readBasis(null), { kind: 'taka' })
  assert.deepEqual(readBasis(''), { kind: 'taka' })
  assert.deepEqual(readBasis('taka'), { kind: 'taka' })
})

test('a share is read as a share', () => {
  assert.deepEqual(readBasis('percent'), { kind: 'percent' })
})

test('an award basis carries its id back', () => {
  const id = '2f2c8d1e-9a7b-4c3d-8e5f-1a2b3c4d5e6f'
  assert.deepEqual(readBasis(awardBasis(id)), { kind: 'scholarship', id })
})

test('an unrecognised basis is refused rather than guessed at', () => {
  // Three ways of spending the centre's money, so guessing between them is worse than
  // refusing. Only an absent field means taka.
  assert.equal(readBasis('percentage'), null)
  assert.equal(readBasis('sch:'), null)
  assert.equal(readBasis('sch:not-a-uuid'), null)
})

test('a field that is not text at all counts as absent', () => {
  // What FormData hands back for a field nobody filled in, or for one carrying a file.
  // Absent means taka, which is the default and is separately bounded by the amount box —
  // so this is the safe direction as well as the compatible one.
  assert.deepEqual(readBasis(42), { kind: 'taka' })
  assert.deepEqual(readBasis(undefined), { kind: 'taka' })
})

test('an id that merely looks like a uuid is not one', () => {
  // Shape-checked here so a malformed one never reaches Postgres, where it comes back as
  // "invalid input syntax for type uuid" rather than as "no such award".
  assert.equal(readAwardId('2f2c8d1e-9a7b-4c3d-8e5f-1a2b3c4d5e6f'), '2f2c8d1e-9a7b-4c3d-8e5f-1a2b3c4d5e6f')
  assert.equal(readAwardId(' 2f2c8d1e-9a7b-4c3d-8e5f-1a2b3c4d5e6f '), '2f2c8d1e-9a7b-4c3d-8e5f-1a2b3c4d5e6f')
  assert.equal(readAwardId('2f2c8d1e9a7b4c3d8e5f1a2b3c4d5e6f'), null)
  assert.equal(readAwardId('2f2c8d1e-9a7b-4c3d-8e5f-1a2b3c4d5e6'), null)
  assert.equal(readAwardId(null), null)
})

/* -------------------------------------------------------------------------- */
/* And the screen's own shape                                                 */
/* -------------------------------------------------------------------------- */

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const HERE = ['src', 'app', '(app)', 'fees', 'scholarships']
const PAGE = read(...HERE, 'page.tsx')
const FORM = read(...HERE, 'scholarship-form.tsx')
const ROW = read(...HERE, 'scholarship-row.tsx')

/** Each anchor is an assertion: a changed span makes its `indexOf` -1. */
const RENDER = PAGE.slice(
  PAGE.indexOf('<div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">'),
)
const HEAD_AT = PAGE.indexOf('<PageHeader')
const RAIL_AT = RENDER.indexOf(
  '<div className="contents lg:order-3 lg:col-span-5 lg:flex lg:flex-col lg:gap-5">',
)
const LIST_AT = RENDER.indexOf(
  '<div className="order-3 flex flex-col gap-2 lg:order-2 lg:col-span-7">',
)

const RAIL = RENDER.slice(RAIL_AT, LIST_AT)
const LIST = RENDER.slice(LIST_AT)

/** See plan-page.test.ts: the lookbehind keeps `border-2` and `lg:col-span-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s`])order-(\d+|last)\b/g)].map((m) => m[1])
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1

test('the awards and what they cost sit side by side from lg', () => {
  // The whole point of the redesign: "sibling, 50% of the fee" level with "sibling, 12
  // bills, 9,000" instead of three screens above it.
  assert.ok(RENDER.startsWith('<div className="flex flex-col gap-5 lg:grid'))
  assert.ok(HEAD_AT >= 0, 'the screen lost its page bar')
  assert.ok(RAIL_AT >= 0, 'rail takes five')
  assert.ok(LIST_AT >= 0, 'awards list takes seven')
  assert.ok(RAIL_AT < LIST_AT, 'rail, then list')

  // The bar is above the grid and not a twelfth-column cell inside it: a sticky box only
  // travels inside its containing block, and a grid cell's block is one grid row.
  assert.ok(HEAD_AT < PAGE.indexOf('lg:grid-cols-12'), 'the bar is inside the grid')
  assert.doesNotMatch(RENDER, /lg:col-span-12/)
})

test('the rail is written first and drawn second', () => {
  // order moves nothing for a keyboard, so naming a waiver has to come before the edit
  // button of every award the centre has ever granted. There is no `order-1` any more —
  // that was the letterhead's own cell, and the bar above the grid replaced it.
  assert.deepEqual(ordersIn(RENDER), ['2', '4', '3'])
  assert.deepEqual([...ordersIn(RENDER)].sort(), ['2', '3', '4'])
  assert.ok(RENDER.includes('lg:order-3 lg:col-span-5'))
  assert.ok(RENDER.includes('lg:order-2 lg:col-span-7'))
})

test('the rail generates no box below lg, so its two blocks fall into the one column', () => {
  assert.ok(RENDER.includes('className="contents lg:order-3'))
})

test('nothing on this screen is stuck to the top', () => {
  // The form plus the month's figures are taller than a laptop screen, and a stuck block
  // taller than the viewport cannot be scrolled past. The lookahead is what keeps the
  // comment saying so ("Not sticky:") from failing the test that enforces it.
  assert.doesNotMatch(RENDER, /sticky(?=[\s"])/)
})

test('the form takes its grid slot from the page, not from itself', () => {
  assert.ok(FORM.includes("className = ''"))
  assert.ok(FORM.includes('${className}'))
  assert.ok(RENDER.includes('<ScholarshipForm t={t} className="order-2" />'))
})

test('why anybody would name a waiver is inside the form it is about', () => {
  assert.equal(count(FORM, '>{t.why}'), 1)
  assert.equal(count(PAGE, '>{t.why}'), 0, 'no one-sentence card floating above the form')
})

test("the month's cost is in the rail and the awards are in the list", () => {
  assert.ok(RAIL.includes('{t.monthHeading} — {formatMonth(month, locale)}'))
  assert.ok(RAIL.includes('{t.monthTotal}'))
  assert.ok(RAIL.includes('{formatTaka(total)}'))
  assert.ok(RAIL.includes('{fill(t.countNote, {'))
  assert.ok(RAIL.includes('?? t.unnamed'))

  assert.ok(LIST.includes('{t.listHeading}'))
  assert.ok(LIST.includes('<ScholarshipRow'))

  // Neither half draws the other's figures, or the same money would be read twice.
  assert.doesNotMatch(LIST, /monthHeading|monthTotal|formatTaka\(total\)/)
  assert.doesNotMatch(RAIL, /<ScholarshipRow|t\.listHeading/)
})

test('a read that failed is not an empty list', () => {
  // fee_scholarships_center_name_key folds case, so an owner told "none yet" who adds
  // hardship again is refused by an index on the screen that just invited them to.
  assert.ok(PAGE.includes('error: awardsError'))
  assert.ok(PAGE.includes('error: waivedError'))
  assert.equal(count(PAGE, 'awardsError ?'), 1)
  assert.equal(count(PAGE, 'waivedError ?'), 1)

  const refused = LIST.indexOf('{t.unreadable}')
  const emptied = LIST.indexOf('{t.empty}')
  assert.ok(refused >= 0 && emptied > refused, 'unreadable is asked before empty')

  const monthRefused = RAIL.indexOf('{t.monthUnreadable}')
  const monthEmptied = RAIL.indexOf('{t.monthEmpty}')
  assert.ok(monthRefused >= 0 && monthEmptied > monthRefused)
})

test('both refusals are written in both languages, and say something else', () => {
  for (const d of [bn, en]) {
    assert.ok(d.scholarships.unreadable.length > 0)
    assert.ok(d.scholarships.monthUnreadable.length > 0)
    assert.notEqual(d.scholarships.unreadable, d.scholarships.empty)
    assert.notEqual(d.scholarships.monthUnreadable, d.scholarships.monthEmpty)
    assert.notEqual(d.scholarships.unreadable, d.scholarships.monthUnreadable)
  }
  assert.notEqual(bn.scholarships.unreadable, en.scholarships.unreadable)
})

test('the letterhead is the page bar, and the way back is in it', () => {
  // One bar, and it owns the h1 — so the two headings inside the grid are h2s.
  assert.equal(count(PAGE, '<PageHeader'), 1)
  assert.equal(count(PAGE, '<h1'), 0)
  assert.equal(count(PAGE, 'text-xl font-bold text-ink lg:text-2xl'), 0)

  // The crumb is the bar's, so it stays on screen while a hundred awards scroll past.
  assert.ok(PAGE.includes("back={{ href: '/fees', label: t.backLink }}"))
  assert.equal(count(PAGE, 'href="/fees"'), 0, 'no hand-rolled back link left behind')
})

test('the row still opens into the same form, and the rule is still frozen', () => {
  // §38: the redesign moved boxes on the page, it did not touch what a row can change.
  assert.ok(ROW.includes("import { updateScholarship, type FeeState } from '../actions'"))
  assert.ok(ROW.includes('useActionState<FeeState, FormData>(\n    updateScholarship,'))
  assert.ok(ROW.includes('<input type="hidden" name="awardId" value={id} />'))
  assert.ok(ROW.includes('name="active"'))
  assert.ok(ROW.includes('defaultChecked={active}'))
  assert.ok(ROW.includes('{t.ruleFrozen}'))

  // No box for the rule, because app.guard_fee_scholarship() refuses a change to it, and
  // no way to delete an award, because the invoice FK is `on delete set null`.
  assert.doesNotMatch(ROW, /name="percent"|name="value"|name="amount/)
  assert.doesNotMatch(ROW, /deleteScholarship|name="remove"/)
})

test('neither client component carries a grid slot of its own', () => {
  assert.deepEqual(ordersIn(FORM), [])
  assert.deepEqual(ordersIn(ROW), [])
})

test('the reads and the sums the redesign moved past are unchanged', () => {
  // §38 again, at the top of the file this time: two scoped reads, both months' worth of
  // ordering, and one addition done in poisha.
  assert.ok(PAGE.includes("pageCapability('fees')"))
  assert.equal(count(PAGE, ".eq('coaching_center_id', session.active.centerId)"), 2)
  assert.ok(PAGE.includes("from('fee_scholarships')"))
  assert.ok(PAGE.includes("from('fee_waiver_month')"))
  assert.ok(PAGE.includes("select('id, name, percent, amount_bdt, active')"))
  assert.ok(PAGE.includes("'scholarship_id, scholarship_name, bills, students, waived_bdt'"))
  assert.ok(PAGE.includes("order('active', { ascending: false })"))
  assert.ok(PAGE.includes("order('name', { ascending: true })"))
  assert.ok(PAGE.includes("order('waived_bdt', { ascending: false })"))
  assert.ok(PAGE.includes('const month = currentPeriodMonth()'))
  assert.ok(PAGE.includes(".eq('period_month', month)"))
  assert.ok(PAGE.includes('sumTaka(lines.map((line) => Number(line.waived_bdt ?? 0)))'))
  assert.ok(PAGE.includes('Number(award.percent)'))
  assert.ok(PAGE.includes('Number(award.amount_bdt)'))

  // Deliberately not paged: a centre names a handful of these, and the month's report has
  // one row per name. Neither can reach PostgREST's ceiling without a thousand awards.
  assert.doesNotMatch(PAGE, /pageAll/)
})
