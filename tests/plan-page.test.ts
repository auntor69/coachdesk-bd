import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The plan screen's two shapes, and the two things on it that must not be printed.
 *
 * WHAT THIS GUARDS. Two invariants, and they fail differently.
 *
 * The layout one is the dashboard's (see dashboard.test.ts): one DOM, ten blocks, an
 * `order-N` on each, and two column wrappers that are `display: contents` below `lg` so
 * on a phone every block is a direct child of the one column again. Add a card with no
 * order and it lands at 0, above the heading. Reuse a number and two cards swap.
 *
 * The other is a business rule. §33 says the billing engine does not go on the page and
 * §8 says the internal ceilings are never advertised, so the rate bands live behind a
 * disclosure and the difference block prints a per-student tier's finite caps nowhere.
 * That one cannot fail loudly at all: it renders beautifully while quietly publishing
 * the rate card an owner is meant to be quoted, and nothing but a reader would notice.
 */

const ROOT = path.join(import.meta.dirname, '..')
const PAGE = readFileSync(
  path.join(ROOT, 'src', 'app', '(app)', 'settings', 'plan', 'page.tsx'),
  'utf8',
)
const CALC = readFileSync(
  path.join(ROOT, 'src', 'app', '(app)', 'settings', 'plan', 'calculator.tsx'),
  'utf8',
)

/** The render, from the grid that opens it to the end of the component. */
const RENDER = PAGE.slice(PAGE.indexOf('<div className="flex flex-col gap-5 lg:grid'))

const MAIN_AT = RENDER.indexOf('contents lg:order-2 lg:col-span-7')
const RAIL_AT = RENDER.indexOf('contents lg:order-3 lg:col-span-5')

/**
 * Every phone-order class in a stretch of source, in the order it is written.
 *
 * The lookbehind keeps out `border-line` and its cousins, where the character before
 * `order` is `b` rather than a quote or a space, and `lg:order-N`, which is a different
 * thing entirely — the two wrappers use those to sit after the header.
 */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s])order-(\d+|last)\b/g)].map((m) => m[1])
}

test('the render is one column on a phone and twelve from lg up', () => {
  // `lg:items-start` is asserted here rather than on its own, because the comment
  // beside the div names the class too and a loose /lg:items-start/ over the render
  // passes on the strength of the prose after the class itself is deleted.
  assert.match(
    RENDER,
    /^<div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">/,
  )

  assert.ok(MAIN_AT > 0, 'the main column wrapper is not where this test expects it')
  assert.ok(RAIL_AT > MAIN_AT, 'the rail should be written after the main column')

  // Seven and five, not eight and four: the rail holds sentences rather than figures
  // ("SMS, WhatsApp and calls from your own phone") and a third of 1,280px wraps them.
  assert.match(RENDER, /lg:col-span-7/)
  assert.match(RENDER, /lg:col-span-5/)
})

test('the wrappers disappear on a phone and become columns on a laptop', () => {
  for (const wrapper of ['lg:order-2 lg:col-span-7', 'lg:order-3 lg:col-span-5']) {
    const at = RENDER.indexOf(wrapper)
    const decl = RENDER.slice(at - 20, at + 120)
    assert.match(decl, /contents/, `${wrapper} is not contents on a phone`)
    assert.match(decl, /lg:flex lg:flex-col/, `${wrapper} never becomes a column`)
  }

  // The header spans the lot. A heading and the three facts under it in a
  // seven-column column is a third of the page left blank beside them.
  assert.match(RENDER, /className="order-1 lg:col-span-12"/)

  // And exactly the two wrappers carry an `lg:order`, because a grid item with none
  // is 0 and would draw above the header.
  assert.equal(
    [...RENDER.matchAll(/lg:order-[23]\b/g)].length,
    2,
    'exactly the two wrappers carry an lg:order',
  )
})

test('every block has a place in the phone order, and no two share one', () => {
  const all = ordersIn(RENDER)
  const counts = new Map<string, number>()
  for (const value of all) counts.set(value, (counts.get(value) ?? 0) + 1)

  for (const [value, n] of counts) {
    assert.equal(n, 1, `order-${value} is used ${n} times`)
  }

  // 1 to 9 with nothing missing, then `last` for the card that says how to reach us.
  // A gap is survivable in itself; it is also how a tenth card quietly reuses a free
  // number six months from now.
  const used = [...counts.keys()]
  for (let n = 1; n <= 9; n += 1) {
    assert.ok(used.includes(String(n)), `no block is order-${n}`)
  }
  assert.ok(used.includes('last'), 'nothing is order-last')
  assert.equal(used.length, 10, `${used.length} distinct positions, expected 10`)
})

test('the order a column is written in is the order it draws', () => {
  // At `lg` the numbers still apply, inside each wrapper's own flex context — which is
  // only harmless while each column's numbers ascend in source order. Otherwise the
  // phone and the laptop disagree about one column, which is the whole bug this
  // arrangement exists to avoid keeping two lists for.
  const columns: [string, string[]][] = [
    ['main', ordersIn(RENDER.slice(MAIN_AT, RAIL_AT))],
    ['rail', ordersIn(RENDER.slice(RAIL_AT))],
  ]

  for (const [name, values] of columns) {
    assert.ok(values.length >= 3, `${name} has only ${values.length} blocks`)
    const numeric = values.map((v) => (v === 'last' ? Infinity : Number(v)))
    assert.deepEqual([...numeric].sort((a, b) => a - b), numeric,
      `${name} draws in a different order than it is written`)
  }

  // And the split: what an owner came to do is in the wide column, what they check
  // once they are here is in the rail. §20.4's reading order for a centre —
  // usage, then capacity, then payment — is the main column top to bottom.
  const main = RENDER.slice(MAIN_AT, RAIL_AT)
  assert.match(main, /t\.usageTitle/, 'the usage table left the main column')
  assert.match(main, /<BuyPlaces/, 'buying places left the main column')
  assert.match(main, /<BuySubscription/, 'paying for the plan left the main column')
  assert.match(RENDER.slice(RAIL_AT), /t\.haveTitle/, 'the feature list left the rail')
})

test('the first question is answered in three facts, not in a subtitle', () => {
  // §20.4 question 1: the tier, the price, and the date the money runs to. The date
  // used to be printed only inside the subscription card, which a manager never sees.
  // On the prop, not on the substring: `t.factPaid` is also the start of
  // `t.factPaidNone`, so a bare includes() passes with the label swapped out.
  for (const key of ['factPlan', 'factPrice', 'factPaid']) {
    assert.ok(
      PAGE.includes(`label={t.${key}}`),
      `the header strip does not draw t.${key}`,
    )
  }
  assert.match(PAGE, /<Fact\b[\s\S]{0,400}session\.active\.paidThrough/)

  // Stacked below `sm`. Three facts across 375px is three columns of wrapped words.
  assert.match(PAGE, /sm:grid-cols-3 sm:divide-x sm:divide-y-0/)
})

test('the fourth question is a difference, not two lists to compare by eye', () => {
  // Strictly above, so the top tier draws nothing rather than an empty card.
  assert.match(PAGE, /PLAN_RANK\[tier\.id\] > PLAN_RANK\[plan\.id\]/)

  // What it adds comes from the same list and the same labels as the card in the rail,
  // so a feature can never be missing from one and present in the other.
  assert.match(PAGE, /SHIPPED\.filter\(\(key\) => !has\(plan, key\) && has\(nextUp, key\)\)/)

  // And the price is one figure from the same function the tier list uses.
  assert.match(PAGE, /t\.nextTitle\(planName\(nextUp, locale\)\)[\s\S]{0,200}priceLine\(nextUp, t\)/)

  // One primary action, pointing at the control rather than repeating it: a second
  // priced dropdown beside this block is how a month gets bought twice.
  assert.match(PAGE, /href=\{selfServe \? '#pay' : '#ask'\}/)
  assert.match(PAGE, /<Card className="order-4" id="pay">/)
  assert.match(PAGE, /id="ask"/)
})

test('a per-student tier advertises no ceiling this product would enforce', async () => {
  // §8 and §6: 100 batches and 200 subjects are abuse ceilings, not headroom. A centre
  // sold ninety-nine more batches has been sold a number we would refuse them at.
  assert.match(
    PAGE,
    /from !== to && \(to === null \|\| nextUp\.pricing !== 'per_student'\)/,
  )

  // Which leaves exactly the three that are true of every centre: no student cap, no
  // teacher cap, no cap on one batch. Asserted against the plan table itself rather
  // than against the string, so a tier gaining a finite cap fails here.
  const { PLANS } = await import('../src/lib/plans.ts')
  for (const id of ['center', 'institution'] as const) {
    const tier = PLANS[id]
    assert.equal(tier.maxStudents, null, `${id} would advertise a student ceiling`)
    assert.equal(tier.maxTeachers, null, `${id} would advertise a teacher ceiling`)
    assert.equal(tier.maxStudentsPerBatch, null, `${id} would advertise a batch size`)
    assert.ok(
      tier.maxBatches !== null && tier.pricing === 'per_student',
      `${id} is no longer the shape this rule was written for`,
    )
  }
})

test('the bands are behind a disclosure, and the total is not', () => {
  // §33 and §20.4. The rate card was the tallest thing on the screen where somebody
  // decides to start paying us; one tap and it is all still there, from one engine.
  const detailsAt = CALC.indexOf('<details')
  const bandsAt = CALC.indexOf('STUDENT_BANDS.map')
  const totalAt = CALC.indexOf('t.monthly')

  assert.ok(detailsAt > 0, 'the calculator has no disclosure')
  assert.ok(bandsAt > detailsAt, 'the rate bands are printed outside the disclosure')
  assert.ok(CALC.indexOf('t.breakdown') > detailsAt, 'the working is outside it')
  assert.ok(totalAt < detailsAt, 'the total is inside the disclosure')

  // The seat rate is part of the rate card, and it is the one line that used to sit
  // below the bands rather than among them.
  assert.ok(CALC.indexOf('t.seatRate') > detailsAt, 't.seatRate is outside it')
})

test('a full row says so, and an over-full one says which', () => {
  // A line reading "30 / 30" is the reason this screen gets opened and it looked like
  // every other line on it. Over is reachable: a centre moved down a tier keeps its
  // students, and the teachers row is drawn specifically to say so.
  assert.match(PAGE, /const full = used !== null && limit !== null && used >= limit/)
  assert.match(PAGE, /const over = used !== null && limit !== null && used > limit/)
  assert.match(PAGE, /over \? 'text-absent' : full \? 'text-late' : 'text-ink'/)
  assert.match(PAGE, /\{over \? t\.capOver : t\.capFull\}/)

  // Bangla numerals in Bangla, in a table of figures that printed ASCII ones.
  assert.match(PAGE, /digits\(used, locale\)/)
  assert.match(PAGE, /digits\(limit, locale\)/)
})
