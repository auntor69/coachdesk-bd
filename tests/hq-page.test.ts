/**
 * The organisation's screen: nine columns, and two subjects under them.
 *
 * WHAT THIS FILE IS GUARDING. §20.6 asks for a row per branch with Students, Teachers,
 * Revenue, Expenses and Profit, and the table had eight columns and no Teachers — so an
 * owner comparing two branches on profit alone could not see that one of them earns it
 * with half the staff. Under the table, five blocks of two sentences each ran one below
 * the other across 1,216px; they are two subjects and are now two columns.
 *
 * The arithmetic that decides the shape: nine columns want 52rem, which is wider than the
 * 704px a laptop gives the workspace, so there is no rail to be had beside the table and
 * the bleed has to follow <main>'s own padding at each width. A four-column rail would
 * leave the table narrower here than it is on a phone.
 *
 * §38 is the other half. The redesign added a column and moved boxes; it must not have
 * changed a gate, a read, or which figure the foot prints.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { bn } from '../src/lib/i18n/bn.ts'
import { en } from '../src/lib/i18n/en.ts'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const PAGE = read('src', 'app', '(app)', 'hq', 'page.tsx')
const ROW = read('src', 'app', '(app)', 'settings', 'branches', 'branch-row.tsx')

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** See plan-page.test.ts: the lookbehind keeps `border-2` and `lg:col-span-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s`])order-(\d+|last)\b/g)].map((m) => m[1])
}

/* -------------------------------------------------------------------------- */
/* The table is the screen                                                    */
/* -------------------------------------------------------------------------- */

test('nine columns are drawn once each, in the order §20.6 names them', () => {
  const head = PAGE.indexOf('<thead>')
  const body = PAGE.indexOf('<tbody>')
  assert.ok(head >= 0 && body > head)

  const HEAD = PAGE.slice(head, body)
  assert.deepEqual(
    [...HEAD.matchAll(/\{t\.(\w+)\}<\/Th>/g)].map((m) => m[1]),
    [
      'branch',
      'students',
      'teachers',
      'collected',
      'spending',
      'salaries',
      'profit',
      'owed',
      'rate',
    ],
    'who, how many of each, then the money, then the bills',
  )

  // A cell for every head, and a foot cell for every cell. Nine, nine and nine: a table
  // whose foot is one cell short prints every total under the wrong column.
  const foot = PAGE.indexOf('<tfoot>')
  assert.equal(count(PAGE.slice(body, foot), '<Td'), 9)
  assert.equal(count(PAGE.slice(foot), '<td className='), 9)
})

test('the teachers column is a count of standing staff and dashes when it did not arrive', () => {
  // §20.6's second column, and the reason for it: two branches with the same profit and
  // half the staff between them are not the same branch.
  assert.ok(PAGE.includes("<Td num right>{row.teachers === null ? '—' : row.teachers}</Td>"))
  assert.ok(PAGE.includes("<Td num right>{row.students === null ? '—' : row.students}</Td>"))

  // Two head queries per building in the one round, and the teachers one filtered to
  // people who still work there.
  assert.ok(PAGE.includes("const teacherQuery = supabase\n        .from('teachers')"))
  assert.ok(PAGE.includes("const studentQuery = supabase\n        .from('students')"))
  assert.ok(PAGE.includes("teacherQuery.is('branch_id', null)"))
  assert.ok(PAGE.includes("studentQuery.is('branch_id', null)"))
  assert.ok(PAGE.includes('return { branchId, students: students.count, teachers: teachers.count }'))

  // Each column reads its own count. A branch with students and no teacher figure must
  // not borrow the figure beside it — branch-money.test.ts asserts the other half.
  assert.ok(PAGE.includes('students: heads.map((head) => ({ branchId: head.branchId, count: head.students }))'))
  assert.ok(PAGE.includes('teachers: heads.map((head) => ({ branchId: head.branchId, count: head.teachers }))'))
})

test('the two head counts in the foot are the organisation own reads', () => {
  // Never a sum of the column, and the comment under the table used to claim the wrong
  // reason for it. The pool is one allowance for the whole organisation (§17), and the
  // seats are counted the same way, so both are unfiltered reads beside the money.
  assert.ok(PAGE.includes('const totalHeads = centerHeads.error ? null : centerHeads.count'))
  assert.ok(
    PAGE.includes('const totalTeachers = centerTeachers.error ? null : centerTeachers.count'),
  )
  assert.ok(PAGE.includes("{totalTeachers === null ? '—' : totalTeachers}"))
  assert.ok(PAGE.includes("{totalHeads === null ? '—' : totalHeads}"))

  // The false sentence this file was written to keep out: head office is a row of the
  // table, so a student filed there is in the foot AND in a row.
  assert.doesNotMatch(PAGE, /is in one and not the other/)
  assert.ok(PAGE.includes('the only way a foot can differ from its column is a building'))

  // And the money foot is still the library's, summed in poisha rather than four reduces.
  assert.ok(PAGE.includes('const total = tallyBranchMoney(rows)'))
})

test('the table keeps the whole width and no rail is drawn beside it', () => {
  // Nine columns want 52rem; a laptop gives the workspace 704px. There is nothing to
  // put beside a table that already overflows.
  assert.ok(PAGE.includes('min-w-[52rem]'))
  assert.ok(PAGE.includes('className="-mx-4 overflow-x-auto px-4 lg:-mx-8 lg:px-8"'))
  assert.ok(PAGE.includes('Nine columns do not fit 320px'))

  // The bleed follows <main>'s padding at both widths, so the scroll runs edge to edge
  // instead of stopping inside a 32px margin.
  assert.equal(count(PAGE, 'overflow-x-auto'), 1)
  assert.doesNotMatch(PAGE, /min-w-\[46rem\]/, 'the eight-column width is gone')
})

test('the month is the table caption rather than a line floating above it', () => {
  const caption = PAGE.indexOf('<caption')
  const thead = PAGE.indexOf('<thead>')
  assert.ok(caption >= 0 && caption < thead, 'first child of the table, as HTML requires')
  assert.ok(PAGE.includes('className="mb-2 text-left font-medium text-ink-soft"'))
  assert.equal(count(PAGE, 'formatMonth(month, locale)'), 1, 'named once, next to the figures')
})

test('a branch name opens its record, and only where there is one to open', () => {
  // §20.6 asks for a click into the branch. What exists today is the record on the
  // branches screen; a filtered copy of this screen would need the scope-narrowing
  // mechanism §8.2 puts in the database, and inventing one in a query string is the
  // cross-branch leak that section forbids.
  assert.ok(PAGE.includes('href={`/settings/branches#branch-${row.branchId}`}'))
  assert.ok(PAGE.includes('const listed = new Set(branches.map((branch) => branch.id))'))
  assert.ok(PAGE.includes('{row.branchId !== null && listed.has(row.branchId) ? ('))

  // Head office is not a branch, and a row `branchMoneyRows` had to name itself has an
  // id with nothing on that screen to scroll to. Both stay plain text.
  assert.ok(PAGE.includes('<span className="font-medium">{row.name}</span>'))

  // THE ANCHOR IS IN ANOTHER FILE. Nothing but this line notices when it moves.
  assert.ok(ROW.includes('id={`branch-${branch.id}`}'))
  assert.ok(ROW.includes('scroll-mt-20'), 'a phone has a sticky header over the workspace')
})

/* -------------------------------------------------------------------------- */
/* The letterhead, and the two columns under the table                        */
/* -------------------------------------------------------------------------- */

/** The letterhead alone — Shell's own bar, below it in the file, cannot answer for this. */
const BAR = PAGE.slice(PAGE.indexOf('const header = ('), PAGE.indexOf('if (profitRows'))

test('the letterhead is the page bar, and the level is the line under it', () => {
  // Two bars in the file and no heading left in the old hand: the letterhead for the three
  // arms that have a month to pick, and Shell's for the two refusals that do not.
  assert.equal(count(PAGE, '<PageHeader'), 2)
  assert.equal(count(PAGE, '<h1'), 0)
  assert.doesNotMatch(PAGE, /text-xl font-bold text-ink lg:text-2xl/)
  assert.ok(PAGE.includes("import { PageHeader } from '@/components/page-header'"))

  // §20.6: "the reader must never be in doubt which level they are reading". Every figure
  // on this screen is an aggregate of buildings, and the sidebar's centre name looks the
  // same on the branch-level screens beside it.
  //
  // UNDER THE BAR AND NOT IN IT. The bar is one line and its `<h1>` truncates, so a level
  // appended to the title is the half that gets cut — which is the doubt this line exists
  // to remove. `title={t.title}` exactly, so nothing can be smuggled into the heading.
  assert.ok(BAR.includes('title={t.title}'))
  assert.match(BAR, /subtitle=\{[\s\S]{0,200}\{t\.level\(session\.active\.centerName\)\}/)
  assert.ok(BAR.includes('{t.subtitle}'), 'the sentence under the level went with it')

  // And the way back out, from every one of the five shapes.
  assert.equal(count(PAGE, "back={{ href: '/dashboard'"), 2)
})

test('the month picker is the bar own action, capped and label-less', () => {
  // The one control on the screen, at the far end of the line rather than under the title.
  assert.match(BAR, /actions=\{\n\s+<form method="get" className="flex items-center gap-2">/)

  // A 56px bar has no room for a word above a select, so the control says what it is to a
  // screen reader instead — and the table's caption names the month again beside the
  // figures, which is where a sighted reader checks it.
  assert.match(BAR, /name="month"\n\s+aria-label=\{t\.monthLabel\}\n\s+defaultValue=\{month\}/)
  assert.doesNotMatch(BAR, /\{t\.monthLabel\}<\/span>/, 'a visible label is back in the bar')

  // Capped and not stretched: `w-full` inside `actions` is a select as wide as the line is
  // long, and twelve month names do not need 400px.
  assert.match(BAR, /min-h-tap max-w-44 rounded-xl border-2 border-line bg-white px-3/)
  assert.match(BAR, /sm:max-w-56/)

  // Still one GET form with a submit button — the month lands in a bookmarkable URL, and
  // Android Chrome fires no navigation on a bare <select> change, so the button is not
  // decoration.
  assert.equal(count(PAGE, '<form method="get"'), 1)
  assert.ok(PAGE.includes('type="submit"'))
})

test('every shape of this screen draws the same heading', () => {
  // Five returns: locked plan, pinned manager, failed read, no branches, the table. The
  // three that carry the picker share the letterhead; the two refusals get Shell's bar,
  // which is a `PageHeader` and not a crumb and an `<h1>` of its own — a wrapper of its own
  // would give the sticky bar a containing block 90px tall.
  assert.equal(count(PAGE, 'refusal={{ home: d.shell.nav.home, title: t.title }}'), 2)
  assert.equal(count(PAGE, '{header}'), 3)
  assert.ok(PAGE.includes('title={refusal.title}'))

  // A one-sentence refusal is capped rather than set across 1,216px — the opposite
  // mistake to §26's narrow column, and just as bad to read. Four cards: locked, pinned,
  // the failed read and the organisation with no branches yet.
  assert.equal(count(PAGE, '<Card className="max-w-2xl'), 4)

  // THE CAP IS ON THE CARD AND NEVER ON SHELL'S COLUMN. The bar bleeds `lg:-mx-8` to reach
  // the workspace edges, so a capped page root would stop its background 672px into a
  // 1,216px screen and leave the border hanging in mid-air.
  assert.ok(PAGE.includes('<div className="flex flex-col gap-6">'))
  assert.doesNotMatch(PAGE, /flex flex-col gap-6[^"]*max-w-/)
})

test('what the table means and what to do about it are two columns from lg', () => {
  const grid = PAGE.indexOf('<div className="grid gap-6 lg:grid-cols-2 lg:items-start">')
  assert.ok(grid >= 0, 'two columns, and the taller one not stretching the shorter')

  const AFTER = PAGE.slice(grid)
  const legend = AFTER.indexOf('{t.legend}')
  const dashed = AFTER.indexOf('{t.chargesUnreadable}')
  // Not `{t.payrollAllNote}`: the gap box picks its note in a ternary, so the brace is
  // three tokens away and an anchor carrying one silently matches nothing.
  const payroll = AFTER.indexOf('t.payrollAllNote')
  const pool = AFTER.indexOf('{t.poolNote}')
  const growing = AFTER.indexOf('{t.growingTitle}')
  const asks = AFTER.indexOf('{d.settings.plan.places.asksTitle}')

  // Every anchor found first. A typo returns -1, and -1 reads as "before everything" in
  // each comparison below, so a missing anchor would pass the order test twice over.
  for (const at of [legend, dashed, payroll, pool, growing, asks]) assert.ok(at > 0)

  // Left: the footnotes belonging to the columns above. Right: §3.7's argument, where the
  // pool, the places running out and the branches asking for more read as one thing
  // instead of three separate notes.
  assert.ok(legend < dashed && dashed < payroll, 'the footnotes in that order')
  assert.ok(payroll < pool && pool < growing && growing < asks, 'then the decision')

  // Source order is reading order, so the phone keeps the stack it had and no `order-N`
  // is needed to place either column.
  assert.deepEqual(ordersIn(PAGE), [])
  assert.doesNotMatch(PAGE, /lg:grid-cols-12/)
})

test('the payroll gap and the pool warning are still the same two objects', () => {
  // §38, on the two blocks the redesign moved into columns. The warning 20260811000055
  // left to this screen: entering payroll centrally leaves every branch but head office
  // looking free, and every profit figure above is then wrong in the flattering direction.
  assert.ok(PAGE.includes('const gap = payrollGap(rows)'))
  assert.ok(PAGE.includes("{gap.kind === 'all' ? t.payrollAll : t.payrollSome(gap.names.join(', '))}"))
  assert.ok(PAGE.includes('border-late/30 bg-late/5'))

  // The calm card and the boxed warning stay two objects, on the ≤ 20% and ≤ 5% rows.
  assert.ok(PAGE.includes("pressure.level === 'fine' ? ("))
  assert.ok(PAGE.includes('<PlacesWarning pressure={pressure} t={d.dashboard} note={t.poolNote} />'))
  assert.equal(count(PAGE, '{t.poolNote}'), 2, 'the note travels with both')

  // And the growing box only on the urgent row, with a failed read given its own sentence
  // rather than falling into "nothing is growing".
  assert.ok(PAGE.includes("pressure.level === 'urgent' || pressure.level === 'full'"))
  assert.ok(PAGE.includes('{grew === null ? ('))
  assert.ok(PAGE.includes('{t.growingUnreadable}'))
})

test('the gates and the reads the redesign moved past are unchanged', () => {
  // §38 and §24 in one test: this screen is a money table for a whole organisation.
  assert.ok(PAGE.includes("const session = await pageRole('manager')"))
  assert.ok(PAGE.includes("if (!has(session.plan, 'multipleBranches')) {"))
  assert.ok(PAGE.includes('if (!isHqMember(session.active)) {'))
  assert.ok(PAGE.includes('if (!canReadMoney(session.active.capabilities)) forbidden()'))

  // Both views scoped to the active centre as well as governed by their own policies, and
  // the month still validated before it reaches a query. Seven: the two views, the branch
  // list, the two organisation-wide head counts and the two per-branch ones.
  assert.equal(count(PAGE, ".eq('coaching_center_id', session.active.centerId)"), 7)
  assert.equal(count(PAGE, ".eq('period_month', month)"), 2)
  assert.ok(PAGE.includes("MONTH_RE.test(rawMonth ?? '')"))
  assert.ok(PAGE.includes("from('branch_profit_month')"))
  assert.ok(PAGE.includes("from('branch_charges_month')"))

  // The failed-read shapes: the profit side or nothing, and the charges side allowed to
  // fail on its own into two dashed columns.
  assert.ok(PAGE.includes('if (profitRows === null || branches === null) {'))
  assert.ok(PAGE.includes('const chargeRows = bills.error ? null : (bills.data ?? [])'))
})

/* -------------------------------------------------------------------------- */
/* And the words                                                              */
/* -------------------------------------------------------------------------- */

test('both new lines are written in both languages and say different things', () => {
  for (const d of [bn, en]) {
    assert.ok(d.hq.teachers.length > 0)
    assert.notEqual(d.hq.teachers, d.hq.students, 'two columns, two nouns')

    // The level line carries the organisation's name, or it is not naming a level.
    assert.ok(d.hq.level('Udvash').includes('Udvash'))
    assert.notEqual(d.hq.level('Udvash'), 'Udvash')
  }

  assert.notEqual(bn.hq.teachers, en.hq.teachers)
  assert.notEqual(bn.hq.level('X'), en.hq.level('X'))
})
