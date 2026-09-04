import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

/**
 * The roster: two layouts out of one DOM, and two renderings of one row.
 *
 * THE LAYOUT FAILS VISIBLY (see dashboard.test.ts, plan-page.test.ts, add-student.test.ts):
 * `order-N` per block, one wrapper that is `display: contents` below `lg`, a block with no
 * order landing at 0 above the heading, a reused number swapping two blocks.
 *
 * THE TWO SHAPES FAIL INVISIBLY, and that is the reason for most of this file. From `xl`
 * the list is a table; below it, cards. Both are drawn from `shown`, and nothing in the
 * type system makes them agree — a column added to the sheet and forgotten on the card is
 * a fact that exists on a laptop and not on the phone the owner actually carries. So the
 * five facts are asserted in both.
 *
 * AND THE DOM ORDER IS THE PHONE'S READING ORDER, which is why the rail is written before
 * the roster here and after the form on the add-student screen. `order` moves nothing for a
 * keyboard or a screen reader. With the rail written last, a phone would tab through three
 * hundred student links before reaching "Show these" — and this rail, unlike that one, is
 * four interactive blocks.
 */

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const PAGE = read('src', 'app', '(app)', 'settings', 'students', 'page.tsx')

const GRID_AT = PAGE.indexOf('<div className="flex flex-col gap-5 lg:grid')
const RENDER = PAGE.slice(GRID_AT)

const RAIL_AT = RENDER.indexOf('contents lg:order-3 lg:col-span-4')
// The whole tag, not the class: the `ordersIn` lookbehind wants the quote in front of
// `order-6`, and a slice that begins at the class itself hands it the start of a string.
const MAIN_AT = RENDER.indexOf('<div className="order-6 flex flex-col gap-3 lg:order-2 lg:col-span-8">')

const RAIL = RENDER.slice(RAIL_AT, MAIN_AT)
const MAIN = RENDER.slice(MAIN_AT)

/** The wide sheet and the cards, in the order the DOM holds them. */
const TABLE_AT = MAIN.indexOf('<div className="hidden xl:block">')
const CARDS_AT = MAIN.indexOf('<ul className="flex flex-col gap-2 xl:hidden">')
const TABLE = MAIN.slice(TABLE_AT, CARDS_AT)
const CARDS = MAIN.slice(CARDS_AT)

/** The two GET controls at the foot of the file. */
const FOOT_AT = PAGE.indexOf('function WarningFilter(')
const SCOPE_AT = PAGE.indexOf('function ScopeFilter(')
const WARN_FN = PAGE.slice(FOOT_AT, SCOPE_AT)
const SCOPE_FN = PAGE.slice(SCOPE_AT)

/** See plan-page.test.ts: the lookbehind keeps `border-line` and `lg:order-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s])order-(\d+|last)\b/g)].map((m) => m[1])
}

test('one column on a phone, twelve from lg, and the roster gets eight of them', () => {
  assert.ok(GRID_AT > 0, 'the grid is not where this test expects it')
  assert.match(
    RENDER,
    /^<div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">/,
  )

  // Eight and four, not the 7/5 of the plan and add-student screens: the sheet needs the
  // width, and the rail is four small blocks rather than paragraphs.
  assert.ok(RAIL_AT > 0, 'the rail wrapper is not where this test expects it')
  assert.ok(MAIN_AT > 0, 'the roster wrapper is not where this test expects it')
  assert.match(RENDER, /lg:col-span-8/)
  assert.match(RENDER, /lg:col-span-4/)

  // No twelfth-column cell for the heading any more: the bar sits above the grid, because
  // a sticky box only travels inside its containing block and a cell's is one grid row.
  assert.doesNotMatch(RENDER, /lg:col-span-12/)

  // The rail is written first so a phone's DOM order is its reading order.
  assert.ok(RAIL_AT < MAIN_AT, 'the rail must be written before the roster')
})

test('the rail vanishes on a phone and becomes a column on a laptop', () => {
  const decl = RENDER.slice(RAIL_AT - 20, RAIL_AT + 120)
  assert.match(decl, /contents/, 'the rail is not contents on a phone')
  assert.match(decl, /lg:flex lg:flex-col/, 'the rail never becomes a column')

  // The roster is one block, so the block is the column and needs no wrapper.
  assert.doesNotMatch(MAIN.slice(0, 80), /contents/)

  // Exactly the two, because a grid item with no `lg:order` is 0 and draws above the
  // header — the one place nothing may go.
  assert.equal(
    [...RENDER.matchAll(/lg:order-[23]\b/g)].length,
    2,
    'exactly the two columns carry an lg:order',
  )
})

test('every block has a place in the phone order, and no two share one', () => {
  const counts = new Map<string, number>()
  for (const value of ordersIn(RENDER)) counts.set(value, (counts.get(value) ?? 0) + 1)

  for (const [value, n] of counts) assert.equal(n, 1, `order-${value} is used ${n} times`)

  // 2 to 6 with nothing missing: places warning, paste door, two problem cards, roster.
  // There is no `order-1` any more — that was the heading's twelfth-column cell, and the
  // bar above the grid replaced it. The numbers were left where they were rather than
  // shifted down, because only their relative order matters and renumbering five blocks to
  // save a 1 is five chances to swap two of them.
  const used = [...counts.keys()]
  for (let n = 2; n <= 6; n += 1) {
    assert.ok(used.includes(String(n)), `no block is order-${n}`)
  }
  assert.equal(used.length, 5, `${used.length} distinct positions, expected 5`)

  // Per column the numbers still apply at `lg`, so a column whose numbers do not ascend
  // in source order is a phone and a laptop that disagree.
  for (const [name, values] of [['rail', ordersIn(RAIL)], ['roster', ordersIn(MAIN)]] as const) {
    const numeric = values.map((v) => Number(v))
    assert.deepEqual([...numeric].sort((a, b) => a - b), numeric,
      `${name} draws in a different order than it is written`)
  }
  assert.equal(ordersIn(MAIN).join(), '6', 'the roster is not the only block in its column')
})

test('the two shapes carry the same five facts', () => {
  // One at a time and never both: `hidden xl:block` against `xl:hidden`.
  assert.ok(TABLE_AT > 0, 'the wide sheet is not drawn, or not `hidden xl:block`')
  assert.ok(CARDS_AT > TABLE_AT, 'the cards are not drawn after the sheet, or not `xl:hidden`')
  assert.doesNotMatch(MAIN, /lg:hidden|hidden lg:block/, 'a shape switches at the wrong width')

  // Same rows, and the search count above them is the same number.
  for (const [name, shape] of [['table', TABLE], ['cards', CARDS]] as const) {
    assert.match(shape, /\{shown\.map\(\(row\) => \(/, `${name} does not draw shown`)
    for (const fact of [
      'row.name',
      'row.batchNames',
      't.noBatchRow',
      'row.classLevel',
      'row.institution',
      'row.guardianPhone',
      't.noPhone',
      'row.code',
      't.inactive',
      't.smsOff',
    ]) {
      assert.ok(shape.includes(fact), `the ${name} shape does not draw ${fact}`)
    }
    // Both open the student, not the edit form — the roster is the only way in.
    assert.match(shape, /href=\{`\/students\/\$\{row\.id\}`\}/, `${name} opens nothing`)
  }

  // "In no batch" is only claimed of somebody still coming, in both shapes: a leaver in
  // no batch is not a problem, and amber on their row would be work nobody has to do.
  for (const [name, shape] of [['table', TABLE], ['cards', CARDS]] as const) {
    const at = shape.indexOf('t.noBatchRow')
    assert.match(shape.slice(Math.max(0, at - 260), at), /row\.active/,
      `the ${name} shape warns about a leaver's missing batch`)
  }
})

test('the sheet is fixed, its columns are shared out by hand, and they add up', () => {
  // `table-fixed`, so one long school name cannot re-shape every other column, and
  // `truncate` on a block child inside the cell rather than on the cell itself.
  assert.match(TABLE, /<table className="w-full table-fixed border-collapse text-sm">/)

  const widths = [...TABLE.matchAll(/<Th className="w-\[(\d+)%\]"/g)].map((m) => Number(m[1]))
  assert.equal(widths.length, 5, `${widths.length} headings carry a width, expected 5`)
  assert.equal(widths.reduce((a, b) => a + b, 0), 100, 'the columns do not add up to 100%')

  // The name is the link and the row is not: a stretched overlay would make the
  // guardian's number unselectable, and that number is what the sheet is read for.
  assert.doesNotMatch(TABLE, /after:absolute|after:inset-0/)
  const nameCell = TABLE.slice(TABLE.indexOf('<tbody>'), TABLE.indexOf('row.batchNames'))
  assert.match(nameCell, /className="block truncate font-medium text-brand-800/)

  // Shared cells, not a fifth copy of the same padding value.
  assert.match(PAGE, /import \{ Th, Td \} from '@\/components\/table'/)
})

test('the hint that says to tap a student is not shown where the name is a link', () => {
  // "Tap a student" on a desk is the giant-phone tell §26 names, and from `xl` the name
  // says what it does by being a link. It is the bar's subtitle now rather than a line
  // under a hand-rolled heading, so it sits above the grid the rest of this file slices.
  const at = PAGE.indexOf('t.openHint')
  assert.ok(at > 0 && at < GRID_AT, 'the hint is gone, or it is no longer in the bar')
  assert.match(PAGE.slice(at - 80, at), /xl:hidden/, 'the hint is shown beside the table')

  // And only where there are rows: "tap a student" over an empty roster is an instruction
  // to do something the screen is not offering.
  assert.match(PAGE, /\{rows\.length > 0 && \(\s+<span className="text-ink-faint xl:hidden">/)
})

test('putting the leavers aside is offered only when there are some', () => {
  // The count in the heading said 280 of 312 while the list under it was all 312, and
  // there was no way at all to narrow it.
  assert.match(PAGE, /const leftCount = rows\.length - activeCount/)
  assert.match(PAGE, /rawShow === 'current' && leftCount > 0/)

  // And only while neither problem filter is on: both are active-only already, so
  // "current students" over one would narrow nothing and tapping it would quietly drop
  // the filter the reader is looking at.
  assert.match(
    MAIN,
    /\{leftCount > 0 && \(show === null \|\| show === 'current'\) && \(\s*<ScopeFilter/,
  )

  // The default stays everyone. Search has to reach a student who left — a re-admission
  // in July must find last year's record rather than type a second one.
  assert.match(
    PAGE,
    /\? rows\.filter\(\(r\) => r\.active\)\r?\n\s+: rows\b/,
    'the unfiltered roster is no longer the default',
  )
})

test('the scope control keeps the search where the warnings drop it', () => {
  assert.ok(FOOT_AT > 0 && SCOPE_AT > FOOT_AT, 'the two controls are not both defined')

  // Entering a warning drops `q`, because the card counts the whole centre and tapping
  // "12 in no batch" has to show twelve.
  assert.match(WARN_FN, /\{active && q !== '' && <input type="hidden" name="q"/)

  // The scope control counts nothing — it narrows whatever the reader is already looking
  // at — so throwing their search away would be a second, unasked-for change.
  assert.match(SCOPE_FN, /\{q !== '' && <input type="hidden" name="q" value=\{q\} \/>\}/)
  assert.doesNotMatch(SCOPE_FN, /active && q !== ''/, 'the scope control drops the search')

  // Both leave by dropping their own param, and neither prints on paper.
  for (const [name, fn] of [['WarningFilter', WARN_FN], ['ScopeFilter', SCOPE_FN]] as const) {
    assert.match(fn, /\{!active && <input type="hidden" name="show"/, `${name} cannot be left`)
    assert.match(fn, /<form method="get"/, `${name} is not a GET form`)
    assert.match(fn, /print:hidden/, `${name} prints`)
  }
  assert.match(SCOPE_FN, /name="show" value="current"/)

  // Neutral, not the warnings' amber: a student who left is not a problem with the data.
  assert.doesNotMatch(SCOPE_FN, /border-late/)
})

test('nothing about who may read what has moved', () => {
  // §38. The roster's logic is not what this redesign was for.
  assert.match(PAGE, /\.eq\('coaching_center_id', session\.active\.centerId\)/)
  assert.match(PAGE, /matchesSearch\(\[r\.name, r\.code, r\.guardianPhone\], terms\)/)
  assert.match(PAGE, /'rows' in students/, 'a failed read no longer draws an empty roster')

  // The places warning ends in a link to /settings/plan, which a teacher on
  // `can_manage_students` would be refused at.
  assert.match(PAGE, /const warnPlaces =[\s\S]{0,200}isStaffAdmin\(session\)/)
})

test('both languages have the sheet’s headings and the scope label', () => {
  for (const [name, dict] of [['en', en], ['bn', bn]] as const) {
    const t = dict.settings.students
    for (const key of ['showCurrent', 'colName', 'colBatches', 'colClass', 'colPhone', 'colCode'] as const) {
      const value = t[key]
      assert.equal(typeof value, 'string', `${name}.settings.students.${key} is missing`)
      assert.ok((value as string).trim().length > 1, `${name}.${key} is too short to be a word`)
    }

    // The button toggles between this label and `search.clear`, so two identical labels
    // would ask the reader to work out which of them undoes what.
    assert.notEqual(t.showCurrent, dict.search.clear, `${name} labels both directions alike`)

    // A heading has to fit its share of 640px: 'Guardian’s number' is the longest at
    // 19%, and a sentence in the thead is a column that truncates its own name.
    for (const key of ['colName', 'colBatches', 'colClass', 'colPhone', 'colCode'] as const) {
      assert.ok((t[key] as string).length <= 20, `${name}.${key} is too long for a heading`)
    }
  }

  // Bangla in Bangla. A heading left in English is the half-and-half screen.
  for (const key of ['showCurrent', 'colName', 'colBatches', 'colClass', 'colPhone', 'colCode'] as const) {
    assert.doesNotMatch(bn.settings.students[key] as string, /[A-Za-z]/, `bn.${key} is English`)
  }
})
