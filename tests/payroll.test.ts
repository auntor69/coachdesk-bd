/**
 * The wage bill: what it adds up, and what it is careful not to.
 *
 * The trap here is not arithmetic either. It is that `salary_terms` holds two kinds of
 * agreement and only one of them carries a monthly figure — 20260811000044 refuses to
 * store what a per-class teacher earns in a month, because "storing it would be a number
 * that goes stale the next time they teach" — so a screen that prints one total over every
 * row is telling an owner their payroll is smaller than it is. §9.8 then subtracts a figure
 * of that size from collections to get a profit line, which is the direction that costs
 * somebody money.
 *
 * The second trap is that nothing joins these rows for us. The composite foreign keys make
 * a PostgREST embed ambiguous, so the payee's name is looked up in a map built here, over
 * two tables whose ids share no namespace — and a map keyed on the bare uuid would hand a
 * cook's salary to a teacher the first time the two collide.
 *
 * Relative imports with extensions — `node --test` on TS, no tsconfig paths.
 *
 * The last section reads the page's own source and guards the screen's shape; see the
 * comment above it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  billRows,
  payeeValue,
  readPayeeValue,
  tallyBill,
  withoutTerms,
  type Payee,
  type TermsSourceRow,
} from '../src/lib/payroll/bill.ts'
import { MONTHLY_BASIS, PER_CLASS_BASIS, SALARY_BASES } from '../src/lib/payroll/basis.ts'
import { sumTaka } from '../src/lib/money.ts'

/**
 * One live agreement, with only the parts a given test cares about spelled out.
 *
 * `net_bdt` is computed here rather than passed in, and that is the point of the helper:
 * the column is `generated always as (basic + allowances + other - deductions) stored`, so
 * a fixture that let a test set the net independently of the four parts could assert
 * agreement between two numbers the database would never disagree about. Every row this
 * makes is a row Postgres could have handed back.
 */
function terms(
  id: string,
  opts: {
    employee?: string
    teacher?: string
    basis?: TermsSourceRow['basis']
    basic?: string | number
    allowances?: string | number
    other?: string | number
    deductions?: string | number
    perClass?: string | number | null
    net?: string | number | null
    since?: string
    note?: string | null
  } = {},
): TermsSourceRow {
  const basis = opts.basis ?? MONTHLY_BASIS
  const parts = [opts.basic ?? 0, opts.allowances ?? 0, opts.other ?? 0, opts.deductions ?? 0]
  const [basic, allowances, other, deductions] = parts

  return {
    id,
    // Exactly one of the pair, which is what `salary_terms_one_payee` enforces. A default
    // employee keeps the common case short without letting a test make an impossible row.
    employee_id: opts.teacher ? null : (opts.employee ?? 'emp-1'),
    teacher_id: opts.teacher ?? null,
    basis,
    basic_bdt: basic,
    allowances_bdt: allowances,
    other_bdt: other,
    deductions_bdt: deductions,
    net_bdt:
      opts.net !== undefined
        ? opts.net
        : sumTaka([Number(basic), Number(allowances), Number(other), -Number(deductions)]),
    per_class_bdt: opts.perClass ?? (basis === PER_CLASS_BASIS ? 300 : null),
    effective_from: opts.since ?? '2026-08-01',
    note: opts.note ?? null,
  }
}

/** Somebody the centre pays, as the page hands them over. */
function payee(id: string, opts: { kind?: Payee['kind']; name?: string; job?: string | null; active?: boolean } = {}): Payee {
  return {
    id,
    kind: opts.kind ?? 'employee',
    name: opts.name ?? 'Rahim Uddin',
    job: opts.job ?? null,
    active: opts.active ?? true,
  }
}

test('the value one option carries survives the round trip', () => {
  // The form writes it and the action reads it. Two definitions of this format is a form
  // that can submit a teacher id into `employee_id`, which the composite foreign key
  // refuses as a Postgres error rather than a sentence.
  for (const kind of ['employee', 'teacher'] as const) {
    const id = '9f1b2c3d-0000-4000-8000-000000000001'
    assert.deepEqual(readPayeeValue(payeeValue(kind, id)), { kind, id })
  }
})

test('a picker value that is not one of ours is refused rather than passed down', () => {
  // An empty select, a kind nobody offers, a value with nothing after the colon. Each of
  // these reaching a foreign key would be "something went wrong" where "choose somebody"
  // was the sentence.
  for (const raw of ['', 'employee', 'employee:', ':abc', 'student:abc', ':', 'teacher']) {
    assert.equal(readPayeeValue(raw), null, raw)
  }
})

test('the first colon splits, so an id is never half-read', () => {
  // Nothing produces this — the ids are uuids — but the split has to be unambiguous, and
  // the alternative reading (split on the last colon) turns 'employee:a:b' into a kind
  // nobody offers. An id that is not a uuid is refused by the read-back in the action,
  // which asks the database whether this centre has such a person.
  assert.deepEqual(readPayeeValue('employee:a:b'), { kind: 'employee', id: 'a:b' })
})

test('a monthly line carries what the bill prints, field for field', () => {
  const rows = billRows(
    [
      terms('t1', {
        employee: 'emp-9',
        basic: 12000,
        allowances: 1500,
        other: 500,
        deductions: 1000,
        since: '2026-07-01',
        note: 'ঈদ বোনাস আলাদা',
      }),
    ],
    [payee('emp-9', { name: 'Sultana Begum', job: 'হিসাবরক্ষক' })],
  )

  assert.deepEqual(rows[0], {
    termsId: 't1',
    payeeKind: 'employee',
    payeeId: 'emp-9',
    name: 'Sultana Begum',
    job: 'হিসাবরক্ষক',
    gone: false,
    basis: MONTHLY_BASIS,
    net: 13000,
    perClass: null,
    since: '2026-07-01',
    note: 'ঈদ বোনাস আলাদা',
  })
})

test('the net is the four parts, deductions taken off', () => {
  // The column is generated, so this is the database's arithmetic being read rather than a
  // second implementation of it. What the assertion pins is that it is read at all: a bill
  // that printed `basic_bdt` would show ৳12,000 for somebody on ৳13,000, and be right in
  // every fixture where the other three parts are zero.
  const rows = billRows([terms('t1', { basic: 12000, allowances: 1500, other: 500, deductions: 1000 })], [])
  assert.equal(rows[0].net, 13000)
  assert.equal(tallyBill(rows).monthly, 13000)
})

test('numeric over the wire is a string and still adds up as money', () => {
  // PostgREST serialises numeric as a string, so this is what a real read looks like.
  // '8000.50' + '4499.50' has to be 12500, not '8000.504499.50'.
  const rows = billRows(
    [terms('t1', { net: '8000.50' }), terms('t2', { employee: 'emp-2', net: '4499.50' })],
    [],
  )

  assert.equal(rows[0].net, 8000.5)
  assert.equal(tallyBill(rows).monthly, 12500)
})

test('a monthly agreement whose net will not parse is dropped, not counted as nothing', () => {
  // A line reading ৳0 for somebody on ৳14,000 is a wrong number where an absent one would
  // have been a question — and a wage bill short by ৳14,000 overstates the profit line by
  // the same amount.
  const rows = billRows(
    [
      terms('t1', { net: 14000 }),
      terms('t2', { employee: 'emp-2', net: 'oops' }),
      terms('t3', { employee: 'emp-3', net: null }),
      terms('t4', { employee: 'emp-4', net: 9000 }),
    ],
    [],
  )

  assert.deepEqual(
    rows.map((r) => r.termsId),
    ['t1', 't4'],
  )
  assert.equal(tallyBill(rows).monthly, 23000)
})

test('a per-class agreement keeps its line and carries its rate, not a monthly figure', () => {
  const rows = billRows(
    [terms('t1', { teacher: 'tea-1', basis: PER_CLASS_BASIS, perClass: '350.00' })],
    [payee('tea-1', { kind: 'teacher', name: 'Nazmul Hasan' })],
  )

  assert.equal(rows[0].payeeKind, 'teacher')
  assert.equal(rows[0].perClass, 350)
  assert.equal(rows[0].net, 0)
  assert.equal(rows[0].job, null)
})

test('a per-class agreement is not droppable on a net nothing shows', () => {
  // The four money columns default to 0 on a per-class row and `net_bdt` is generated from
  // them, so the net there is zero by construction — and a null one, which the generated
  // types admit, is a column this basis does not use. Reading it would let a per-class
  // teacher vanish off the bill on the strength of a figure the screen never prints.
  const rows = billRows(
    [terms('t1', { teacher: 'tea-1', basis: PER_CLASS_BASIS, net: null, perClass: 300 })],
    [],
  )

  assert.equal(rows.length, 1)
  assert.equal(rows[0].net, 0)
})

test('a per-class rate that will not parse leaves the line and empties the rate', () => {
  // The rate is what the line prints, not what the total adds, so an unreadable one costs a
  // dash in one cell. Dropping the row would take a real agreement off the bill over a cell.
  const rows = billRows(
    [terms('t1', { teacher: 'tea-1', basis: PER_CLASS_BASIS, perClass: 'oops' })],
    [],
  )

  assert.equal(rows.length, 1)
  assert.equal(rows[0].perClass, null)
})

test('the total covers the monthly rows and says how many it does not', () => {
  // The whole reason the tally returns five figures. Four monthly agreements and two
  // per-class ones is a total over four of six rows, and an owner has to be able to see that
  // from the foot of the screen.
  const rows = billRows(
    [
      terms('t1', { employee: 'emp-1', net: 12000 }),
      terms('t2', { employee: 'emp-2', net: 8000 }),
      terms('t3', { teacher: 'tea-1', basis: PER_CLASS_BASIS }),
      terms('t4', { teacher: 'tea-2', basis: PER_CLASS_BASIS }),
    ],
    [],
  )
  const tally = tallyBill(rows)

  assert.equal(tally.monthly, 20000)
  assert.equal(tally.monthlyCount, 2)
  assert.equal(tally.perClassCount, 2)
  assert.equal(tally.count, 4)
})

test('every row is in exactly one half of the count', () => {
  // Stated out loud rather than relied on quietly: if a third basis ever arrives, the total
  // keeps adding it (anything that is not per-class carries a monthly figure) and this fails
  // here rather than in a profit line six months later.
  const rows = billRows(
    SALARY_BASES.map((basis, i) => terms(`t${i}`, { employee: `emp-${i}`, basis, net: 5000 })),
    [],
  )
  const tally = tallyBill(rows)

  assert.equal(tally.monthlyCount + tally.perClassCount, tally.count)
  assert.equal(tally.count, SALARY_BASES.length)
})

test('a bill of nothing but per-class agreements has no total to print', () => {
  // Zero and a zero count, which is how the page knows to draw no total rather than a ৳0 one
  // over two teachers who are certainly paid something.
  const tally = tallyBill(
    billRows([terms('t1', { teacher: 'tea-1', basis: PER_CLASS_BASIS })], []),
  )

  assert.equal(tally.monthly, 0)
  assert.equal(tally.monthlyCount, 0)
  assert.equal(tally.perClassCount, 1)
})

test('an employee and a teacher with the same id are two different people', () => {
  // The two tables share no namespace, and a map keyed on the bare uuid would name a
  // teacher's agreement after an employee. Nothing generates a collision — these are uuids —
  // but the key is the one thing standing between two tables and one lookup, so it is
  // asserted rather than assumed.
  const id = 'same-id'
  const rows = billRows(
    [terms('t1', { employee: id }), terms('t2', { teacher: id, basis: PER_CLASS_BASIS })],
    [
      payee(id, { kind: 'employee', name: 'Rahim the cook' }),
      payee(id, { kind: 'teacher', name: 'Rahim who teaches' }),
    ],
  )

  assert.equal(rows[0].name, 'Rahim the cook')
  assert.equal(rows[1].name, 'Rahim who teaches')
})

test('an agreement belonging to somebody switched off is flagged and stays in the total', () => {
  // Marking a cook as gone on the staff screen does not touch their agreement — the two
  // tables know nothing about each other — so the ৳8,000 is still agreed in August. Dropping
  // the row would quietly correct a figure the centre is wrong about; the flag is how they
  // find out there is an agreement to stand down.
  const rows = billRows(
    [terms('t1', { employee: 'emp-1', net: 8000 }), terms('t2', { employee: 'emp-2', net: 12000 })],
    [
      payee('emp-1', { name: 'Jasim', active: false }),
      payee('emp-2', { name: 'Rokeya', active: true }),
    ],
  )
  const tally = tallyBill(rows)

  assert.equal(rows[0].gone, true)
  assert.equal(rows[1].gone, false)
  assert.equal(tally.goneCount, 1)
  assert.equal(tally.monthly, 20000)
})

test('an agreement nobody can put a name to keeps its money and is not called gone', () => {
  // Nothing ordinary makes this row: the page reads every employee and every teacher, active
  // or not, and the foreign keys make an agreement without a payee impossible. It stays in
  // the total because the money is agreed either way, and it is not flagged, because a name
  // we could not find is not evidence that somebody left.
  const rows = billRows([terms('t1', { employee: 'ghost', net: 5000 })], [])
  const tally = tallyBill(rows)

  assert.equal(rows[0].name, null)
  assert.equal(rows[0].gone, false)
  assert.equal(tally.monthly, 5000)
  assert.equal(tally.goneCount, 0)
})

test('the rows come out in the order they went in, so the page can decide the order', () => {
  // Not an idle property. The name is not known until the map inside has been consulted,
  // so this module cannot sort by it — and the query cannot either, because ordering by a
  // payee's name means an embed and the composite foreign keys make that ambiguous. The
  // page sorts what comes back; this is the guarantee that lets it.
  const rows = billRows(
    [terms('t1', { employee: 'emp-b' }), terms('t2', { employee: 'emp-a' })],
    [payee('emp-a', { name: 'Aleya' }), payee('emp-b', { name: 'Babul' })],
  )

  assert.deepEqual(
    rows.map((r) => r.name),
    ['Babul', 'Aleya'],
  )
})

test('the day the agreement started is passed through, not shifted a day either way', () => {
  // `effective_from` is a `date`, defaulted in Postgres from Asia/Dhaka, so it is already a
  // Dhaka day. Treating it as a UTC midnight and formatting it hands back the day before in
  // any environment west of Greenwich.
  const rows = billRows([terms('t1', { since: '2026-08-01' })], [])
  assert.equal(rows[0].since, '2026-08-01')
})

test('who has no agreement is listed, because an absent row looks like an absent person', () => {
  // The question this screen is actually opened with the first time. Somebody with no
  // agreement is not paid nothing, they are unrecorded, and the difference is a wage bill
  // short by a cook.
  const people = [
    payee('emp-1', { name: 'Has terms' }),
    payee('emp-2', { name: 'Has none' }),
    payee('tea-1', { kind: 'teacher', name: 'Teaches, unpaid on paper' }),
  ]
  const rows = billRows([terms('t1', { employee: 'emp-1' })], people)

  assert.deepEqual(
    withoutTerms(people, rows).map((p) => p.name),
    ['Has none', 'Teaches, unpaid on paper'],
  )
})

test('somebody who has left and never had terms is not an omission', () => {
  // Otherwise every centre that has ever had staff turnover carries a permanent "you have
  // not finished" prompt naming people who stopped coming years ago.
  const people = [payee('emp-1', { name: 'Long gone', active: false })]
  assert.deepEqual(withoutTerms(people, []), [])
})

test('the missing list tells the two tables apart as well', () => {
  // Same collision as the bill's own lookup, on the other side of it: a teacher covered by
  // an employee's id would drop off the list of people still to be recorded.
  const people = [
    payee('same-id', { kind: 'employee', name: 'Cook' }),
    payee('same-id', { kind: 'teacher', name: 'Teacher' }),
  ]
  const rows = billRows([terms('t1', { employee: 'same-id' })], people)

  assert.deepEqual(
    withoutTerms(people, rows).map((p) => p.name),
    ['Teacher'],
  )
})

test('a centre with nobody on payroll is a set of zeroes, not a crash', () => {
  for (const rows of [[], null, undefined]) {
    const tally = tallyBill(billRows(rows, []))
    assert.equal(tally.count, 0)
    assert.equal(tally.monthly, 0)
    assert.equal(tally.monthlyCount, 0)
    assert.equal(tally.perClassCount, 0)
    assert.equal(tally.goneCount, 0)
  }
})

test('both bases the picker offers are the two the bill knows how to draw', () => {
  // The runtime half of the pair in basis.ts. `ALL_BASES_LISTED` fails the build if the enum
  // widens and the list does not; this fails if the two named constants ever stop being
  // members of it — which would leave a picker offering a basis the bill cannot classify,
  // and a total that quietly includes a rate per class.
  assert.ok(SALARY_BASES.includes(MONTHLY_BASIS))
  assert.ok(SALARY_BASES.includes(PER_CLASS_BASIS))
  assert.equal(SALARY_BASES.length, 2)
})

/**
 * And the screen's own shape.
 *
 * §20.8 step 6, fourth screen. The sums above were already right; what was wrong was that
 * the page printed them last. What the centre's agreements come to every month sat under
 * every card, so twenty agreements meant scrolling all twenty to reach the figure — and
 * "who have we missed", the question a centre actually opens this screen with, sat under
 * that. Both are in a rail beside the bill now, and the cards go two abreast wherever two
 * fit, because a card holding a name and a figure wastes two thirds of a laptop row.
 *
 * Read off the page's source because there is no renderer here. What these catch is the
 * drift a screenshot does not show: the total sliding back under the cards, the rail being
 * written after the column it labels (which would move it for a keyboard even though
 * `order` moves nothing), the ৳0 total coming back on an all-per-class bill, and the
 * warning that somebody has left losing its colour or its words.
 */
const PAGE = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'app', '(app)', 'payroll', 'page.tsx'),
  'utf8',
)

/**
 * The render begins at the grid root. Anchored on a newline-free substring including
 * `lg:grid`, which neither the plan wall's nor the failed-read branch's own
 * `flex flex-col gap-4` root has — the working tree is CRLF and a pattern spanning a line
 * break would find nothing here and everything on a Linux checkout.
 */
const SHEET = PAGE.slice(PAGE.indexOf('<div className="flex flex-col gap-4 lg:grid'))
const RAIL_AT = SHEET.indexOf('<div className="contents lg:order-3 lg:col-span-5')
const MAIN_AT = SHEET.indexOf('<div className="contents lg:order-2 lg:col-span-7')
/** The main arm's bar, above the grid. `lastIndexOf` keeps the two refusal arms' out. */
const BAR = PAGE.slice(
  PAGE.lastIndexOf('<PageHeader'),
  PAGE.indexOf('<div className="flex flex-col gap-4 lg:grid'),
)
const RAIL = SHEET.slice(RAIL_AT, MAIN_AT)
const MAIN = SHEET.slice(MAIN_AT)

/** See plan-page.test.ts: the lookbehind keeps `border-2` and `lg:order-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s])order-(\d+|last)\b/g)].map((m) => m[1])
}

test('shape: one column on a phone, twelve from lg, and the bill gets seven', () => {
  assert.ok(SHEET.length > 500, 'the render is not where this test expects it')
  assert.ok(RAIL_AT > 0 && MAIN_AT > RAIL_AT, 'the two columns are gone or swapped')

  assert.match(SHEET, /lg:grid lg:grid-cols-12 lg:items-start lg:gap-6/)

  // Both wrappers are `contents` below lg, so every block inside them is a direct child of
  // the phone's flex column and its own `order-N` is what places it.
  assert.match(RAIL, /^<div className="contents lg:order-3 lg:col-span-5 lg:flex/)
  assert.match(MAIN, /^<div className="contents lg:order-2 lg:col-span-7 lg:flex/)

  // THE RAIL IS WRITTEN FIRST, and this is the assertion that matters most on this screen:
  // it holds the form, `order` moves nothing for a keyboard or a screen reader, and the DOM
  // is what a tab key follows. A rail written second reads correctly and tabs backwards.
  assert.ok(RAIL.includes('<TermsForm'), 'the form left the rail')
  assert.ok(!MAIN.includes('<TermsForm'), 'the form is in the column it should be beside')
})

test('shape: every block has a place in the phone order, and no two share one', () => {
  // Three blocks in the rail, one in the main column, and nothing above either of them
  // inside the grid: the letterhead and the door onwards are in the bar, which sits above
  // the grid rather than in a twelfth-column cell of it, because a sticky box only travels
  // inside its containing block and a grid cell's block is one grid row. The rail keeps 3,
  // 4, 6 rather than being renumbered from 1 — only the relative order matters, and moving
  // four numbers down to reclaim a 1 is four chances to swap two of them.
  assert.equal(ordersIn(SHEET.slice(0, RAIL_AT)).join(), '')
  assert.doesNotMatch(SHEET, /lg:col-span-12/)
  assert.equal(ordersIn(RAIL).join(), '3,4,6')
  assert.equal(ordersIn(MAIN).join(), '5')

  const all = ordersIn(SHEET)
  assert.equal(new Set(all).size, all.length, 'two blocks are fighting over one place')
})

test('shape: the wage bill total is beside the cards, not under them', () => {
  // The figure and the count of agreements behind it, as a headline rather than a line in a
  // list. On a phone it is above the cards; from lg it is the top of the rail.
  assert.match(RAIL, /<h2 className="font-medium text-ink-soft">\{t\.monthlyTotal\}/)
  assert.match(RAIL, /num text-3xl font-bold text-ink">\{formatTaka\(tally\.monthly\)\}/)
  assert.match(RAIL, /\{t\.monthlyCount\(tally\.monthlyCount\)\}/)

  // And it is not also drawn beside the cards it is a total of.
  assert.doesNotMatch(MAIN, /formatTaka\(tally\.monthly\)/, 'the total is printed twice')

  // `rows.length` is tested in both columns, because a ternary cannot span two of them.
  assert.match(RAIL, /\{rows\.length > 0 && \(/)
  assert.match(MAIN, /\{rows\.length === 0 \?/)
})

test('shape: an all-per-class bill still refuses to print a zero', () => {
  // Every row per-class means the monthly total is genuinely nothing, and ৳0 over teachers
  // who are certainly paid something is a figure an owner would stop and check for nothing.
  const summary = RAIL.slice(RAIL.indexOf('{rows.length > 0 && ('), RAIL.indexOf('{canWrite'))
  assert.match(summary, /\{tally\.monthlyCount > 0 \? \(/)
  assert.match(summary, /\{t\.noMonthly\}/)

  // The two per-class lines only exist in a bill that has some.
  assert.match(summary, /\{tally\.perClassCount > 0 && \(/)
  assert.match(summary, /\{t\.perClassNote\}/)
})

test('shape: somebody who left keeps the warning colour, the words, and no box', () => {
  const summary = RAIL.slice(RAIL.indexOf('{rows.length > 0 && ('), RAIL.indexOf('{canWrite'))
  const at = summary.indexOf('{tally.goneCount > 0 && (')
  assert.ok(at > 0, 'the page stopped flagging a live agreement for somebody who has left')

  const warning = summary.slice(at)
  // A rule and coloured words, not a tinted panel: a bordered box inside a bordered section
  // is the nested container §20.7 forbids.
  assert.match(warning, /border-t border-late\/40/)
  assert.match(warning, /font-medium text-late">\{t\.goneCount\(tally\.goneCount\)\}/)
  assert.match(warning, /\{t\.goneNote\}/, 'the colour is carrying the meaning on its own')
  assert.doesNotMatch(warning, /rounded-|bg-late/, 'the warning became a box again')
})

test('shape: the cards go two abreast wherever two fit, and one where they do not', () => {
  // From lg this column is 401px and half of that is narrower than the phone the card was
  // drawn for, so the middle step back to one column is load-bearing arithmetic.
  assert.match(MAIN, /<ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">/)
  assert.match(MAIN, /<TermsRow/)
  assert.match(MAIN, /\{t\.billTitle\}/)
})

test('shape: the way on is a door, and who has been missed is still asked', () => {
  // A bordered link and not an underlined line of text, and in the bar rather than adrift
  // above the form. Paying a salary is the monthly errand and agreeing one is the
  // twice-a-year errand, so this is the one with the button — and in the bar it is still
  // there once twenty agreements have scrolled past.
  assert.match(BAR, /href="\/payroll\/pay"/)
  assert.match(BAR, /\{t\.payLink\} →/)
  // The door is the shared tinted button now, and the border it was asserting lives in
  // `ui.tsx` — asserted there, so this stays a test of the shape rather than of one string
  // that happened to spell it out twice.
  assert.match(BAR, /actions=\{\s+<LinkButton href="\/payroll\/pay" variant="tinted">/)
  assert.match(
    readFileSync('src/components/ui.tsx', 'utf8'),
    /tinted: 'border-2 border-brand-500 bg-brand-50/,
  )

  // Not gated on canWrite: a read-only centre can read the month, and the figures are part
  // of what they need to decide whether to renew. Sliced from `actions={` rather than
  // searched whole, so the comment above it saying so does not answer for the code.
  const door = BAR.slice(BAR.indexOf('actions={'))
  assert.doesNotMatch(door, /canWrite/, 'the way to the month got gated on writing')

  // One bar per arm, and it owns the h1 — so the total's own heading is an h2.
  assert.equal(PAGE.split('<PageHeader').length - 1, 3)
  assert.equal(PAGE.split('<h1').length - 1, 0)
  assert.doesNotMatch(PAGE, /text-xl font-bold text-ink lg:text-2xl/)
  assert.doesNotMatch(PAGE, /<BackToFees/, 'a hand-rolled crumb is back above the bar')

  // And the list of people with no agreement is still drawn, last.
  assert.match(RAIL, /\{missing\.length > 0 && \(/)
  assert.match(RAIL, /\{t\.missingTitle\}/)
})

test('shape: nothing about who may read or write this has moved', () => {
  // §38. This was a layout change. Staff admin and `payroll`, a Center plan only, and the
  // plan wall still returns before anything is read.
  assert.match(PAGE, /const session = await pageCapability\('payroll'\)/)
  assert.match(PAGE, /if \(!has\(session\.plan, 'centerWideReporting'\)\) \{/)
  const wall = PAGE.indexOf("if (!has(session.plan, 'centerWideReporting'))")
  assert.ok(wall > 0 && wall < PAGE.indexOf('const supabase = await createClient()'))

  // Three reads, all three scoped on the centre as well as governed by RLS, live agreements
  // only, and any one of them failing draws none of the bill.
  assert.equal((PAGE.match(/\.eq\('coaching_center_id', centerId\)/g) ?? []).length, 3)
  assert.match(PAGE, /\.eq\('active', true\)/)
  assert.match(PAGE, /if \(terms === null \|\| employees === null \|\| teachers === null\) \{/)

  // The picker offers only people who are still here, and the write gate is one flag read
  // once for the form and for every row's stop verb.
  assert.match(PAGE, /const pickable = people\r?\n\s+\.filter\(\(p\) => p\.active\)/)
  assert.match(PAGE, /const canWrite = session\.access === 'full'/)
  assert.match(RAIL, /\{canWrite && \(/)
})
