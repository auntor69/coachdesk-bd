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

/** The two shapes the sheet draws instead of words — see `icons.tsx`. */
const ICONS = read('src', 'components', 'icons.tsx')
/** The same file with its prose taken off: a docblock naming a tag is not that tag. */
const ICON_CODE = ICONS.replace(/\/\*[\s\S]*?\*\//g, '')

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

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

  // 3 to 6 with nothing missing: paste door, two problem cards, roster. There is no
  // `order-1` — that was the heading's twelfth-column cell, and the bar above the grid
  // replaced it — and no `order-2`, which was §3.7's places warning and went with the
  // ceiling (§16.1 step 28). The numbers were left where they were rather than shifted
  // down, because only their relative order matters and renumbering four blocks to save a
  // 2 is four chances to swap two of them.
  const used = [...counts.keys()]
  for (let n = 3; n <= 6; n += 1) {
    assert.ok(used.includes(String(n)), `no block is order-${n}`)
  }
  assert.equal(used.length, 4, `${used.length} distinct positions, expected 4`)

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
  assert.equal(widths.length, 6, `${widths.length} headings carry a width, expected 6`)
  assert.equal(widths.reduce((a, b) => a + b, 0), 100, 'the columns do not add up to 100%')

  // The guardian's number keeps its share whatever else is re-cut: 'Guardian’s number' is
  // the longest heading on the sheet, and a thead that wraps is a column that truncates
  // its own name. The buttons' 15% came out of the name, the batches and the class instead.
  const phone = TABLE.match(/<Th className="w-\[(\d+)%\]" num>\s+\{t\.colPhone\}/)
  assert.ok(phone && Number(phone[1]) >= 19, 'the guardian’s number lost width')

  // The name is the link and the row is not: a stretched overlay would make the
  // guardian's number unselectable, and that number is what the sheet is read for.
  assert.doesNotMatch(TABLE, /after:absolute|after:inset-0/)
  const nameCell = TABLE.slice(TABLE.indexOf('<tbody>'), TABLE.indexOf('row.batchNames'))
  assert.match(nameCell, /className="block truncate font-medium text-brand-800/)

  // Shared cells, not a fifth copy of the same padding value.
  assert.match(PAGE, /import \{ Th, Td \} from '@\/components\/table'/)
})

test('every row draws its own way in, rather than leaving it to be discovered', () => {
  // THE DEFECT THIS FIXES was reported by an owner: the only way into a student's record
  // was to click their name, and they said they found it by being an engineer. So the
  // whole card is no longer one big invisible link, and both shapes carry a button.
  assert.doesNotMatch(CARDS, /<Link\s+href=\{`\/students\/\$\{row\.id\}`\}\s+className="block rounded-xl/,
    'the card is a link again, and nothing on it says so')
  assert.match(CARDS, /<div className="rounded-xl border border-line bg-white px-4 py-3">/)

  // Below `xl` the words stay on the buttons, with the icon beside them — there is room
  // for both at 320px, and an icon next to its label is what teaches the bare icon on the
  // sheet. The full tap target there and a shorter one on the sheet: 3rem on forty rows is
  // 24px of extra height each, on the one shape whose reason for existing is that §20.7
  // wants forty rows visible.
  assert.match(CARDS, /className=\{ROW_BUTTON\}>\s+<EyeIcon \/>\s+\{t\.rowView\}/)
  assert.match(CARDS, /className=\{ROW_BUTTON\}\s*>\s+<PencilIcon \/>\s+\{t\.rowEdit\}/)
  assert.match(PAGE, /const ROW_BUTTON =\s+'inline-flex min-h-tap /)
  assert.match(PAGE, /const SHEET_ICON =\s+'inline-flex size-9 /)
  assert.doesNotMatch(CARDS, /SHEET_ICON/, 'the cards use the sheet’s smaller target')
  assert.doesNotMatch(TABLE, /\{ROW_BUTTON\}/, 'the sheet uses the card’s taller row')

  // One import for both shapes, so the eye on the card and the eye on the sheet cannot
  // become two different eyes.
  assert.match(PAGE, /import \{ EyeIcon, PencilIcon \} from '@\/components\/icons'/)

  // Neither is brand-filled. Three hundred rows of a coloured button is a screen nobody
  // can read, and the name is the thing on the row that should draw the eye.
  const DECLS = {
    ROW_BUTTON: PAGE.slice(PAGE.indexOf('const ROW_BUTTON ='), PAGE.indexOf('/**', PAGE.indexOf('const ROW_BUTTON ='))),
    SHEET_ICON: PAGE.slice(PAGE.indexOf('const SHEET_ICON ='), PAGE.indexOf('const SHEET_ICON =') + 220),
  }
  for (const [name, decl] of Object.entries(DECLS)) {
    assert.ok(decl.length > 40, `${name} is not declared where this test looks`)
    assert.match(decl, /border-line bg-white/, `${name} is not the quiet one`)
    assert.doesNotMatch(decl, /bg-brand-600/, `${name} shouts`)
  }
  // Only the worded one can wrap, and a button that wraps in Bangla and not in English is
  // a row that is a different height in one language. The square one holds a shape.
  assert.match(DECLS.ROW_BUTTON, /whitespace-nowrap/, 'the worded button may wrap')
  assert.doesNotMatch(DECLS.SHEET_ICON, /px-3/, 'the square button is not square')

  // The sheet's sixth heading is read aloud and never drawn: the two buttons under it say
  // what they do, and a word above them would be the widest thing in the narrowest
  // column. Asserted as the whole cell, so a visible label added beside the screen-reader
  // one fails too.
  assert.match(
    TABLE,
    /<Th className="w-\[\d+%\]" right>\s+<span className="sr-only">\{t\.colActions\}<\/span>\s+<\/Th>/,
  )

  // A printed roster is a list to read, so the buttons come off the paper in both shapes —
  // as the two GET controls in the rail already do.
  assert.match(CARDS, /className="mt-3 flex items-center gap-2 print:hidden">/)
  assert.match(TABLE, /className="flex items-center justify-end gap-1 print:hidden">/)

  // The name stays a link on the card too — the same destination as View, kept because a
  // name that opens a record is the gesture every reader already knows. Coloured like a
  // link now, instead of hiding inside one.
  const cardName = CARDS.slice(0, CARDS.indexOf('row.batchNames'))
  assert.match(cardName, /className="text-brand-800 hover:underline"/)

  // And the hint that told the reader to tap is gone, in both dictionaries: an
  // instruction that teaches an invisible control is a control that should be drawn.
  assert.doesNotMatch(PAGE, /openHint/)
  for (const [name, dict] of [['en', en], ['bn', bn]] as const) {
    assert.ok(
      !('openHint' in dict.settings.students),
      `${name} still carries the hint the button replaced`,
    )
  }
})

test('both shapes offer View to every reader and Edit only to whoever may edit', () => {
  // §20.4 in its smallest form. The edit screen is `pageRole('manager')` while this one
  // opens on `can_manage_students` — 20260811000019 gives that box SELECT and INSERT and
  // deliberately no UPDATE — so a permitted teacher may read a student and admit one and
  // not rewrite a guardian's number. A button to a refusal is worse than no button.
  assert.match(PAGE, /const mayEdit =[\s\S]{0,600}isStaffAdmin\(session\)/)

  // THE DEFECT THIS FIXES was reported by the same owner as the one above: the sheet drew
  // one button where the card drew two, on the reasoning that the coloured name in the
  // first cell was already the other one. Reading a record and rewriting one are two
  // errands, and a reader who has to deduce the second from a text colour has not been
  // offered it. So the sheet gates only Edit now, exactly as the card does — no ternary
  // that swaps one control for the other.
  assert.doesNotMatch(TABLE, /\{mayEdit \? \(/, 'the sheet still swaps one button for the other')
  for (const [name, shape] of [['table', TABLE], ['cards', CARDS]] as const) {
    const view = shape.indexOf(name === 'table' ? 'aria-label={t.rowView}' : '{t.rowView}')
    const edit = shape.indexOf(name === 'table' ? 'aria-label={t.rowEdit}' : '{t.rowEdit}')
    assert.ok(view > 0 && edit > view, `the ${name} shape does not draw View then Edit`)
    assert.match(shape.slice(view, edit), /\{mayEdit && \(/, `the ${name} shape’s Edit is not gated`)
    assert.doesNotMatch(shape.slice(0, view), /mayEdit/, `the ${name} shape’s View is gated`)
  }

  // And the sheet's two say their names, because they draw no word. An icon-only link with
  // no accessible name is read out as its own href — "slash settings slash students slash
  // a uuid" — and `title` is what a mouse gets, on the one shape that only exists where
  // there is a pointer to hover with.
  for (const key of ['rowView', 'rowEdit'] as const) {
    assert.equal(count(TABLE, `aria-label={t.${key}}`), 1, `the sheet’s ${key} has no name`)
    assert.equal(count(TABLE, `title={t.${key}}`), 1, `the sheet’s ${key} has no hover name`)
  }
  // The shapes themselves are hidden from the name, or a screen reader gets two.
  assert.match(ICON_CODE, /aria-hidden="true"/)
  assert.match(ICON_CODE, /focusable="false"/)
  assert.doesNotMatch(ICON_CODE, /<title>/, 'an icon names itself, and now the button has two names')
  // `currentColor`, so the shape follows the button's hover instead of sitting one colour
  // inside a box that moved.
  assert.match(ICON_CODE, /stroke="currentColor"/)
  assert.doesNotMatch(ICON_CODE, /'use client'/, 'the icons are server components')
  // One svg wrapper for both, so the pair cannot drift into two stroke weights.
  assert.equal(count(ICON_CODE, '<svg'), 1, 'the two icons no longer share one svg')

  // Every Edit href in the file is the edit screen, and every View href the student's
  // page: two routes that differ by one path segment, in a file that writes both. The
  // sheet's `aria-label`s and `title`s are caught by this too, which is the point — a
  // pencil that opens the read-only page is a button that lies.
  for (const [label, href] of [
    ['{t.rowEdit}', '/settings/students/${row.id}'],
    ['{t.rowView}', '/students/${row.id}'],
  ] as const) {
    for (const shape of [TABLE, CARDS]) {
      let at = shape.indexOf(label)
      while (at > 0) {
        assert.ok(
          shape.slice(Math.max(0, at - 220), at).includes(`href={\`${href}\`}`),
          `${label} does not go to ${href}`,
        )
        at = shape.indexOf(label, at + 1)
      }
    }
  }
})

test('a lapsed centre keeps the list and loses all three doors out of it', () => {
  /*
   * §4.4: read-only is a discomfort, not a locked door — the register keeps reading, and
   * what stops is saving. So the sheet, the cards, the counts and the two filters are
   * untouched here, and what goes is every control that leads to a refusal.
   *
   * All three actions behind them run `requireWritable`: `createStudent`, `importStudents`
   * and `updateStudent`. This screen used to offer all three, so a lapsed centre reached
   * the admit form, filled in twelve fields with a family at the desk, and learned the
   * subscription had lapsed by pressing save. See tests/read-only.test.ts for the
   * repo-wide half of this rule.
   */
  assert.match(PAGE, /const mayWrite = session\.access === 'full'/)

  /*
   * The New button in the bar, and the paste box below it — each gated a second time now, and
   * the second gate is the trial's roster (20260811000098, `door.open`): an organisation that
   * has never funded its balance is refused another student by `createStudent` and refused a
   * paste whole by `importStudents`, so a door to either is a door to a refusal for the same
   * reason a lapsed subscription is one. Two conditions on one door, in this product's own
   * order: what the reader is entitled to, then what the balance carries.
   */
  assert.match(
    PAGE,
    /actions=\{\s*mayWrite &&\s*door\.open && \(\s*<Link\s+href="\/settings\/students\/new"/,
  )
  assert.match(
    PAGE,
    /\{mayWrite && \(\s*<div className="order-3">\s*\{door\.open \? \(\s*<Link\s+href="\/settings\/students\/import"/,
  )
  // And the card that stands in its place is the same refusal the action writes, with the
  // way to the one screen that takes money.
  assert.match(PAGE, /if \(!door\.open\)|door\.open \? \(/)

  // And Edit, which was already narrowed to a role: both have to hold, because an owner of
  // a lapsed centre passes `isStaffAdmin` all day and the edit form would still refuse.
  assert.match(PAGE, /const mayEdit = isStaffAdmin\(session\) && mayWrite/)

  // The list is not gated on it anywhere. A read-only roster that hid its own rows would
  // be the opposite of what §4.4 promises, and this is the one assertion that would catch
  // somebody "finishing" the gating above by wrapping the sheet in it too.
  assert.doesNotMatch(TABLE, /mayWrite/, 'the sheet itself is gated on standing')
  assert.doesNotMatch(CARDS, /mayWrite/, 'the cards themselves are gated on standing')
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

  // The places warning and its staff-admin gate went with the ceiling (§16.1 step 28),
  // and so did the pooled headcount it was fed. Asserted as an absence, because the two
  // arrived together: a warning cannot come back without the read behind it.
  assert.doesNotMatch(PAGE, /warnPlaces|PlacesWarning|centerStudentCount/)
  assert.match(PAGE, /subtitle=\{t\.usedHere\(activeCount\)\}/)
})

test('both languages have the sheet’s headings, the scope label and the row buttons', () => {
  const HEADINGS = ['colName', 'colBatches', 'colClass', 'colPhone', 'colCode'] as const
  const WORDS = [...HEADINGS, 'showCurrent', 'colActions', 'rowView', 'rowEdit'] as const

  for (const [name, dict] of [['en', en], ['bn', bn]] as const) {
    const t = dict.settings.students
    for (const key of WORDS) {
      const value = t[key]
      assert.equal(typeof value, 'string', `${name}.settings.students.${key} is missing`)
      assert.ok((value as string).trim().length > 1, `${name}.${key} is too short to be a word`)
    }

    // The button toggles between this label and `search.clear`, so two identical labels
    // would ask the reader to work out which of them undoes what.
    assert.notEqual(t.showCurrent, dict.search.clear, `${name} labels both directions alike`)

    // A heading has to fit its share of 640px: 'Guardian’s number' is the longest at
    // 19%, and a sentence in the thead is a column that truncates its own name.
    // `colActions` is exempt — it is read aloud and never drawn.
    for (const key of HEADINGS) {
      assert.ok((t[key] as string).length <= 20, `${name}.${key} is too long for a heading`)
    }

    // And the two buttons have to fit side by side on a 320px card, each now carrying an
    // icon as well as its word — 22px per button that the label used to have. The sheet no
    // longer constrains them at all: there they are read out, not drawn.
    for (const key of ['rowView', 'rowEdit'] as const) {
      assert.ok((t[key] as string).length <= 10, `${name}.${key} is too long for a row button`)
    }
    assert.notEqual(t.rowView, t.rowEdit, `${name} gives both buttons the same label`)
  }

  // Bangla in Bangla. A heading left in English is the half-and-half screen.
  for (const key of WORDS) {
    assert.doesNotMatch(bn.settings.students[key] as string, /[A-Za-z]/, `bn.${key} is English`)
  }
})
