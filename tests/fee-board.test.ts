import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

/**
 * The fee board's shape.
 *
 * §20.8 step 6, first screen. What was wrong with it was not the figures — every one of
 * them is added up by Postgres and tested elsewhere — but that an owner opening the screen
 * to take a payment scrolled past the total, the once-a-month generator and three bare
 * links before reaching the list. On a laptop it was all of that in one column with the
 * other two thirds of the screen empty.
 *
 * Seven columns of the work beside five of what the money is, out of one DOM: `order-N`
 * per block and two wrappers that are `display: contents` below `lg`. The failures this
 * catches are the ones that are invisible in a screenshot — a block with no order landing
 * at 0 above the heading, a reused number swapping two blocks, a column whose numbers do
 * not ascend in source order so the phone and the laptop disagree.
 *
 * AND THE RAIL IS WRITTEN FIRST, because `order` moves nothing for a keyboard or a screen
 * reader and the main column holds a form per row. Written last, a phone would tab through
 * three hundred payment forms to reach the generator.
 */

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const PAGE = read('src', 'app', '(app)', 'fees', 'page.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

const GRID_AT = PAGE.indexOf('<div className="flex flex-col gap-5 lg:grid')
const RENDER = PAGE.slice(GRID_AT)

// Whole tags, not the classes: `ordersIn`'s lookbehind wants the quote in front of an
// `order-N`, and a slice that begins at the class itself hands it the start of a string.
const RAIL_AT = RENDER.indexOf('<div className="contents lg:order-3 lg:col-span-5')
const MAIN_AT = RENDER.indexOf('<div className="contents lg:order-2 lg:col-span-7')

const RAIL = RENDER.slice(RAIL_AT, MAIN_AT)
const MAIN = RENDER.slice(MAIN_AT)

/** See plan-page.test.ts: the lookbehind keeps `border-line` and `lg:order-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s])order-(\d+|last)\b/g)].map((m) => m[1])
}

test('one column on a phone, twelve from lg, and the board gets seven of them', () => {
  assert.ok(GRID_AT > 0, 'the grid is not where this test expects it')
  assert.match(
    RENDER,
    /^<div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">/,
  )

  // No twelfth-column cell for the heading any more: the bar sits above the grid, because
  // a sticky box only travels inside its containing block and a cell's is one grid row.
  assert.doesNotMatch(RENDER, /lg:col-span-12/)
  assert.equal(count(PAGE, '<PageHeader title={t.title} subtitle={t.subtitle} />'), 2)
  assert.equal(count(PAGE, '<h1'), 0)

  // Seven and five, not the dashboard's 8/4: the rail carries a 4xl figure and a form,
  // and a total that wraps onto two lines is not a total anybody reads at a glance.
  assert.ok(RAIL_AT > 0, 'the rail wrapper is not where this test expects it')
  assert.ok(MAIN_AT > RAIL_AT, 'the rail must be written before the board')
  for (const [name, at] of [['rail', RAIL_AT], ['board', MAIN_AT]] as const) {
    const decl = RENDER.slice(at, at + 120)
    assert.match(decl, /contents/, `the ${name} is not contents on a phone`)
    assert.match(decl, /lg:flex lg:flex-col/, `the ${name} never becomes a column`)
  }

  // Exactly the two, because a grid item with no `lg:order` is 0 and draws above the
  // heading — the one place nothing may go.
  assert.equal([...RENDER.matchAll(/lg:order-[23]\b/g)].length, 2)
})

test('every block has a place in the phone order, and no two share one', () => {
  const counts = new Map<string, number>()
  for (const value of ordersIn(RENDER)) counts.set(value, (counts.get(value) ?? 0) + 1)

  for (const [value, n] of counts) assert.equal(n, 1, `order-${value} is used ${n} times`)

  // 2 to 7 with nothing missing: the total, the generator, the chase door, the board, the
  // three other ways a bill is raised, the cancelled fold-out. There is no `order-1` any
  // more — that was the heading's twelfth-column cell, and the bar above the grid replaced
  // it. The numbers were left where they were rather than shifted down, because only their
  // relative order matters and renumbering six blocks to save a 1 is six chances to swap
  // two of them.
  for (let n = 2; n <= 7; n += 1) {
    assert.ok([...counts.keys()].includes(String(n)), `no block is order-${n}`)
  }
  assert.equal(counts.size, 6, `${counts.size} distinct positions, expected 6`)

  // Per column the numbers still apply at `lg`, so a column whose numbers do not ascend
  // in source order is a phone and a laptop that disagree. The rail's 2, 3, 6 and the
  // board's 4, 5, 7 interleave on purpose: the setup card is last on a phone.
  for (const [name, values] of [['rail', ordersIn(RAIL)], ['board', ordersIn(MAIN)]] as const) {
    const numeric = values.map(Number)
    assert.deepEqual([...numeric].sort((a, b) => a - b), numeric,
      `${name} draws in a different order than it is written`)
  }
  assert.equal(ordersIn(RAIL).join(), '2,3,6', 'the rail no longer holds the money and the doors')
  assert.equal(ordersIn(MAIN).join(), '4,5,7', 'the board column holds something else now')
})

test('the work is in the wide column and the reading is in the rail', () => {
  // The total, the generator and the three setup doors.
  assert.match(RAIL, /\{t\.outstanding\}/, 'the outstanding total left the rail')
  assert.match(RAIL, /<InvoiceGenerator/, 'the generator left the rail')
  assert.match(RAIL, /t\.otherBillsTitle/, 'the setup card left the rail')

  // The chase door, the board and the cancelled bills.
  assert.match(MAIN, /<ReminderEntry dueToday=\{dueToday\}/, 'the chase door left the board')
  assert.match(MAIN, /<SearchBox/, 'the search left the board')
  assert.match(MAIN, /<PaymentRow/, 'the rows left the board')
  assert.match(MAIN, /<CancelledRow/, 'the cancelled list left the board')

  // And neither is in both.
  assert.doesNotMatch(RAIL, /<PaymentRow|<SearchBox/)
  assert.doesNotMatch(MAIN, /<InvoiceGenerator|t\.otherBillsTitle/)
})

test('the two sentences about a short read stay with the rows they are about', () => {
  // In the board's own block, not the column's: a note explaining the list that ended
  // up in the other column would be a sentence about nothing.
  const block = MAIN.slice(MAIN.indexOf('<div className="order-5'))
  const boardAt = block.indexOf('<SearchBox')
  assert.ok(boardAt > 0, 'the search is not in the order-5 block')
  for (const key of ['t.chaseHistoryUnreadable', 'd.chase.payUnreadable']) {
    const at = block.indexOf(key)
    assert.ok(at > 0 && at < boardAt, `${key} is not above the list it is about`)
  }
  // `gap-3`, not the column's `gap-5`. A note is not a panel.
  assert.match(block.slice(0, 60), /order-5 flex flex-col gap-3/)
})

test('the three setup doors are one card, not three stacked links', () => {
  const card = RAIL.slice(RAIL.indexOf('t.otherBillsTitle'))
  for (const key of ['t.arrearsLink', 't.chargeLink', 't.scholarshipsLink']) {
    assert.ok(card.includes(key), `${key} is not in the card`)
  }
  // Underlined text, no borders: a bordered row inside a card is the nested container
  // §20.7 names, and three of them would out-shout the board.
  assert.doesNotMatch(card, /border-2|rounded-xl/, 'the doors are boxes inside a box')

  // Staff-admin only, all three, as they were. A teacher on `can_view_fees` reads what
  // their own students owe and raises nothing.
  const at = RAIL.indexOf('t.otherBillsTitle')
  assert.match(RAIL.slice(Math.max(0, at - 700), at), /\{canWrite && \(/)
})

test('a board that could not be read is one capped column', () => {
  const wall = PAGE.slice(PAGE.indexOf('if (boardProblem !== null) {'), GRID_AT)
  assert.ok(wall.length > 100, 'the failed-read return is not where this test expects it')
  // One column, and the cap on the card rather than the column: a 7/5 split with an empty
  // rail beside one sentence is most of a laptop screen saying nothing, and a cap on the
  // column would stop the bar's `lg:-mx-8` background 672px into a 1,216px workspace.
  assert.match(wall, /<div className="flex flex-col gap-5">/)
  assert.match(wall, /<Card className="max-w-2xl border-late\/30 bg-late\/5">/)
  assert.doesNotMatch(wall, /flex max-w-2xl flex-col/)
  assert.doesNotMatch(wall, /lg:grid-cols-12/, 'the failure is a twelve-column grid')

  // And it draws the same bar as the board, so a reader who bookmarked this screen is
  // told which one refused them.
  assert.match(wall, /<PageHeader title=\{t\.title\} subtitle=\{t\.subtitle\} \/>/)

  // And it still says which of the two failures happened, and still takes the generator
  // off the page with everything else.
  assert.match(wall, /boardProblem === 'tooLarge' \? t\.tooLarge : t\.unreadable/)
  assert.doesNotMatch(wall, /InvoiceGenerator/)
})

test('nothing about who may read or write what has moved', () => {
  // §38. This was a layout change.
  assert.match(PAGE, /const session = await pageCenter\(\)\r?\n\s+if \(!\(await canReadFees\(\)\)\) forbidden\(\)/)
  assert.match(PAGE, /const canWrite = isStaffAdmin\(session\)/)
  assert.match(PAGE, /\.eq\('coaching_center_id', session\.active\.centerId\)/)

  // The read-only board still says its total is a subset, and still says it inside the
  // card rather than at the foot of the page.
  const at = RAIL.indexOf('t.yoursOnly')
  assert.ok(at > 0, 'the read-only boundary line is gone')
  assert.match(RAIL.slice(at - 160, at), /\{!canWrite && \(/)

  // The four reads a teacher never makes are still skipped rather than refused.
  assert.equal((PAGE.match(/canWrite\r?\n\s+\? page(All|OrNull)\(/g) ?? []).length, 3)
  assert.match(PAGE, /canWrite\r?\n\s+\? supabase\r?\n\s+\.from\('coaching_centers'\)/)

  // Every figure is still computed off the unfiltered rows, so nothing on the board's
  // headline moves when somebody types.
  assert.match(PAGE, /const \{ outstanding, credit \} = tallyOutstanding\(rows\.map/)
  assert.match(PAGE, /const shown = terms\.length === 0/)
})

test('both languages name the card of doors, and name it in their own script', () => {
  for (const [name, dict] of [['en', en], ['bn', bn]] as const) {
    const value = dict.fees.otherBillsTitle
    assert.equal(typeof value, 'string', `${name}.fees.otherBillsTitle is missing`)
    assert.ok(value.trim().length > 3, `${name}.fees.otherBillsTitle is too short`)
    // A heading over three links in a 253px rail, not a sentence.
    assert.ok(value.length <= 42, `${name}.fees.otherBillsTitle is too long for a heading`)
    assert.doesNotMatch(value, /[.।]$/, `${name}.fees.otherBillsTitle is a sentence`)
  }
  assert.doesNotMatch(bn.fees.otherBillsTitle, /[A-Za-z]/, 'bn.fees.otherBillsTitle is English')
})
