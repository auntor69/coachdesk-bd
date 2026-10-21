import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The dashboard's two shapes, held to each other.
 *
 * WHAT THIS GUARDS. The page draws thirteen blocks. On a phone they are one column in the
 * order they have always been in; from `lg` they are two, split by errand. Both shapes come
 * out of one DOM, and the mechanism is small enough to break silently: every block carries
 * an `order-N`, and the two column wrappers are `display: contents` below `lg` so on a phone
 * they generate no box and every block is a direct child of the grid again.
 *
 * The failure that mechanism has is not a crash. Add a fourteenth block with no order and it
 * lands at 0 — first on the phone, above the greeting. Reuse a number and two blocks swap
 * unpredictably. Drop `contents` and the phone gets the laptop's order, which puts the
 * student count below the arrears table. `tsc` sees none of this, and neither does a green
 * render: the page still draws, in the wrong sequence, on the device most owners use.
 *
 * So the invariant is asserted as itself. Same arrangement as navigation.test.ts, which
 * holds a menu row to the page it points at for the same reason.
 */

const ROOT = path.join(import.meta.dirname, '..')
const PAGE = readFileSync(
  path.join(ROOT, 'src', 'app', '(app)', 'dashboard', 'page.tsx'),
  'utf8',
)

/** The render, from the grid that opens it to the end of the component. */
const RENDER = PAGE.slice(PAGE.indexOf('<div className="flex flex-col gap-5 lg:grid'))

/** Where each column begins, which is all the structure this file needs to know. */
const MAIN_AT = RENDER.indexOf('contents lg:order-3 lg:col-span-8')
const RAIL_AT = RENDER.indexOf('contents lg:order-4 lg:col-span-4')

/**
 * Every phone-order class in a stretch of source, in the order it is written.
 *
 * The lookbehind is doing two jobs: it keeps `border-line` and its dozen cousins out (the
 * character before `order` there is `b`, not a quote or a space), and it keeps `lg:order-2`
 * out, which is a different thing entirely — `Stat` uses one to put a figure to the right
 * of its label, and the wrappers use two to sit after the header.
 */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s])order-(\d+|last)\b/g)].map((m) => m[1])
}

test('the render is one column on a phone and twelve from lg up', () => {
  assert.match(RENDER, /^<div className="flex flex-col gap-5 lg:grid lg:grid-cols-12/)

  // `items-start` or the two columns stretch to the taller one, which on a centre with no
  // at-risk students is a rail of cards with a hundred pixels of white under the last.
  assert.match(RENDER, /lg:items-start/)

  // Both wrappers found, and in this order: main is the wide one and comes first, so a
  // reader with JavaScript off and CSS on still gets the day's work before the summary.
  assert.ok(MAIN_AT > 0, 'the main column wrapper is not where this test expects it')
  assert.ok(RAIL_AT > MAIN_AT, 'the rail should be written after the main column')
})

test('the wrappers disappear on a phone and become columns on a laptop', () => {
  // `contents` is the whole trick: no box below `lg`, so the blocks inside are flex items
  // of the one column and their order numbers apply to the page rather than to a wrapper
  // nobody can see. `lg:flex` then overrides the display at the breakpoint.
  for (const wrapper of ['lg:order-3 lg:col-span-8', 'lg:order-4 lg:col-span-4']) {
    const at = RENDER.indexOf(wrapper)
    const decl = RENDER.slice(at - 20, at + 120)
    assert.match(decl, /contents/, `${wrapper} is not contents on a phone`)
    assert.match(decl, /lg:flex lg:flex-col/, `${wrapper} never becomes a column`)
  }

  // The setup card is a grid item in its own right and spans the lot: an instruction in an
  // eight-column column is an instruction with a third of the page beside it. The greeting
  // no longer has a cell of its own — it is the page bar, which sits above the grid,
  // because a sticky box only travels inside its containing block and a cell's block is one
  // grid row.
  assert.doesNotMatch(RENDER, /className="order-1 lg:col-span-12"/)
  assert.match(RENDER, /className="order-2 lg:col-span-12"/)
  assert.equal(RENDER.split('lg:col-span-12').length - 1, 1)

  // And the wrappers need their own `lg:order`, because a grid item with none is 0 and
  // would draw before the header. Below `lg` they have no box, so nothing collides.
  assert.equal(
    [...RENDER.matchAll(/lg:order-[34]\b/g)].length,
    2,
    'exactly the two wrappers carry an lg:order',
  )
})

test('every block has a place in the phone order, and no two share one', () => {
  const all = ordersIn(RENDER)

  // Thirteen blocks, fifteen classes: the outstanding figure and the profit each have a
  // second version for the read that failed, and an alternative is not a duplicate.
  const alternates = ['3', '6']
  const counts = new Map<string, number>()
  for (const value of all) counts.set(value, (counts.get(value) ?? 0) + 1)

  for (const [value, n] of counts) {
    const allowed = alternates.includes(value) ? 2 : 1
    assert.ok(n <= allowed, `order-${value} is used ${n} times, expected at most ${allowed}`)
  }

  // 2 to 12 with nothing missing, then `last` for the arrears table. There is no `order-1`
  // any more — that was the greeting's own cell, and the page bar above the grid replaced
  // it; the rest were left at the numbers they had rather than shifted down, because only
  // their relative order matters and renumbering eleven blocks to reclaim a 1 is eleven
  // chances to swap two of them. A gap anywhere else is a block that was deleted without
  // its neighbours being renumbered, which is survivable — but it is also how a fourteenth
  // block ends up quietly reusing a free number later.
  const used = [...counts.keys()]
  assert.ok(!used.includes('1'), 'the greeting is a grid cell again, so it scrolls away')
  for (let n = 2; n <= 12; n += 1) {
    assert.ok(used.includes(String(n)), `no block is order-${n}`)
  }
  assert.ok(used.includes('last'), 'nothing is order-last')
  assert.equal(used.length, 12, `${used.length} distinct positions, expected 12`)
})

test('the greeting is the page bar, and nothing else on the screen is an h1', () => {
  // The bar owns the h1, so the arrears table's own title stays an h2. It carries no crumb:
  // this is the screen every other one comes back to.
  assert.equal(PAGE.split('<PageHeader').length - 1, 1)
  assert.equal(PAGE.split('<h1').length - 1, 0)
  assert.doesNotMatch(PAGE, /text-xl font-bold text-ink lg:text-2xl/)
  assert.match(
    PAGE,
    /<PageHeader title=\{greetingFor\(session\)\} subtitle=\{session\.active\.centerName\} \/>/,
  )
  assert.doesNotMatch(PAGE, /<PageHeader[\s\S]{0,120}back=/)

  // Above the grid rather than inside it, and the grid nested under the page's own column.
  assert.ok(PAGE.indexOf('<PageHeader') < PAGE.indexOf('lg:grid-cols-12'))
  assert.match(PAGE, /return \(\r?\n\s+<div className="flex flex-col gap-5">/)
})

test('the order a column is written in is the order it draws', () => {
  // At `lg` the numbers still apply, inside each wrapper's own flex context. That is only
  // harmless while each column's numbers ascend in source order — otherwise the phone and
  // the laptop disagree about one column, which is the bug this whole scheme exists to
  // avoid having two lists for.
  const columns: [string, string[]][] = [
    ['main', ordersIn(RENDER.slice(MAIN_AT, RAIL_AT))],
    ['rail', ordersIn(RENDER.slice(RAIL_AT))],
  ]

  for (const [name, values] of columns) {
    assert.ok(values.length >= 5, `${name} has only ${values.length} blocks`)

    const numeric = values.map((v) => (v === 'last' ? Infinity : Number(v)))
    const sorted = [...numeric].sort((a, b) => a - b)
    assert.deepEqual(numeric, sorted, `${name} draws in a different order than it is written`)
  }

  // And the split itself: the money that is still owed is in the wide column, the month's
  // profit is in the rail. §20.7's one primary action — chasing beats reporting, and a
  // screen cannot have two most-important errands.
  const main = RENDER.slice(MAIN_AT, RAIL_AT)
  assert.match(main, /t\.outstanding\b/, 'the arrears figure left the main column')
  assert.match(main, /<ReminderEntry/, 'the door that chases money left the main column')
  assert.match(RENDER.slice(RAIL_AT), /<ProfitCard/, 'the profit working left the rail')
})

test('who owes is a table, and shows a morning of it', () => {
  // §20.7: a real table when the data is tabular, and density where density helps. Eight
  // rows rather than the five this page showed while it was a phone layout at every width.
  assert.match(PAGE, /overdue\.slice\(0, 8\)/)
  assert.match(PAGE, /<table className="w-full border-separate/)

  // A row header and column headers, so the amount in row four is announced with the name
  // it belongs to rather than as a number on its own.
  assert.match(PAGE, /<th\s+scope="row"/)
  assert.equal([...PAGE.matchAll(/scope="col"/g)].length, 3, 'three column heads')

  // Hidden below `sm`, not absent: stacked rows of name, date and ৳ explain themselves at
  // 375px and the head would cost a line of chrome, but a screen reader gets it either way.
  assert.match(PAGE, /hidden sm:table-header-group/)
  assert.doesNotMatch(PAGE, /aria-hidden[\s\S]{0,40}scope="col"/)

  // The head is still a door to the rest, because eight of forty is a sample.
  assert.match(PAGE, /href="\/fees"[\s\S]{0,120}seeAll/)
})

test('the two aggregates stream instead of holding the page', () => {
  /*
   * WHAT THIS GUARDS, and why it is asserted rather than left to review. The dashboard
   * used to await seventeen reads before it could return a byte, and two of them are
   * aggregates over the centre's whole history — `student_risk` measured 2.24 s at 250
   * students, `batch_attendance_monthly` 1.2 s (docs/PERFORMANCE-AUDIT.md §2.2b). The
   * arrears figure, the chase door and today's registers waited on the slowest of them,
   * which is most of why the screen felt slow with nothing on it to explain why.
   *
   * The fix is structural and silent: the queries moved into `RatesBlock` and `RiskBlock`,
   * each behind its own `<Suspense>`. Put either `.from(...)` back into the page's
   * `Promise.all` and the page still renders correctly — just slowly again — so nothing
   * but this test would notice.
   */
  const read = (...parts: string[]) =>
    readFileSync(path.join(ROOT, 'src', 'app', '(app)', 'dashboard', ...parts), 'utf8')

  assert.match(PAGE, /<Suspense fallback=\{<LoadingCard rows=\{2\} \/>\}>\s*\n\s*<RatesBlock/)
  assert.match(PAGE, /<Suspense fallback=\{<LoadingCard \/>\}>\s*\n\s*<RiskBlock/)
  assert.match(PAGE, /<Suspense fallback=\{<LoadingCard rows=\{1\} \/>\}>\s*\n\s*<ProgressBlock/)

  // And the reads are the blocks' own business now. A page that asks for them again
  // would be doing the work twice, slowly, and the boundary would be decoration.
  assert.doesNotMatch(PAGE, /from\('student_risk'\)/, 'student_risk is back in the page')
  assert.doesNotMatch(PAGE, /from\('batch_attendance_monthly'\)/, 'the rates read is back')
  assert.doesNotMatch(PAGE, /from\('student_progress_week'\)/, 'the progress read is back')
  assert.match(read('rates-block.tsx'), /\.from\('batch_attendance_monthly'\)/)
  assert.match(read('risk-block.tsx'), /\.from\('student_risk'\)/)
  assert.match(read('progress-block.tsx'), /\.from\('student_progress_week'\)/)

  // `[&:empty]:hidden` on both wrappers: each block renders null for the ordinary empty
  // case, and an empty box in this column still contributes the column's `gap-5` — twenty
  // pixels of nothing where a card is not. Without it, a centre with no registers gets a
  // gap that reads as a card that failed to load.
  for (const order of ['order-9', 'order-10']) {
    assert.match(
      PAGE,
      new RegExp(`className="${order} \\[&:empty\\]:hidden"`),
      `${order} would leave a gap when its card has nothing to draw`,
    )
  }

  // A teacher is not staff-admin, and the risk view refuses them in SQL — so their read
  // came back empty from a round trip. It is its own request now, so the role check the
  // view enforces anyway is the cheap way not to send it.
  assert.match(PAGE, /\{isAdmin && \(\s*\n\s*<div className="order-10/)
})

test('the tiles are three across on a phone and three rows in the rail', () => {
  // At a quarter of the width, three boxes put "৳1,24,000" on two lines. Same markup with
  // the border living on the container alone — §20.7's typography over boxes — one card
  // of ruled rows rather than three floating ones. The Stat tile goes further now: it
  // draws no border at any width, so the container's is the only one on the block.
  assert.match(PAGE, /lg:grid-cols-1 lg:gap-0 lg:divide-y/)
  assert.doesNotMatch(PAGE, /lg:border-0/, 'a tile reserving an override for a border it does not draw')

  // The glance figures are the bigger text in the block, and read figure-first on a phone
  // and to the right of their label in the rail.
  assert.match(PAGE, /<p className="num text-xl font-bold text-ink lg:order-2">\{value\}<\/p>/)

  // Two or three columns on the phone, both written out so Tailwind's scanner sees them.
  assert.match(PAGE, /seeCollected \? 'grid-cols-3' : 'grid-cols-2'/)
})
