import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  arrearsPlan,
  arrearsTyped,
  oldestEnrollments,
  type ArrearsEnrollment,
} from '../src/lib/fees/arrears.ts'
import { MAX_TAKA } from '../src/lib/money.ts'

/** One enrolment row, with a timestamp that reads in the order it sorts. */
function enrolment(
  id: string,
  studentId: string,
  enrolledAt = '2026-01-01T06:00:00.000Z',
): ArrearsEnrollment {
  return { id, student_id: studentId, enrolled_at: enrolledAt }
}

/** The map the plan takes, from a list of [studentId, enrollmentId] pairs. */
function map(pairs: [string, string][]) {
  return new Map(pairs)
}

test('one bill per student, on the enrolment the map names', () => {
  const plan = arrearsPlan(
    [
      { studentId: 's1', raw: '3000' },
      { studentId: 's2', raw: '1500' },
    ],
    map([
      ['s1', 'e1'],
      ['s2', 'e2'],
    ]),
  )

  assert.deepEqual(plan.invoices, [
    { studentId: 's1', enrollmentId: 'e1', amount: 3000 },
    { studentId: 's2', enrollmentId: 'e2', amount: 1500 },
  ])
  assert.equal(plan.total, 4500)
  assert.deepEqual(plan.rejects, [])
})

test('a blank box is not a debt', () => {
  // The common case by a distance: most families in a centre are square, so most
  // of the three hundred boxes on this screen are never touched.
  for (const raw of ['', '   ', '\t']) {
    const plan = arrearsPlan([{ studentId: 's1', raw }], map([['s1', 'e1']]))
    assert.deepEqual(plan.invoices, [], JSON.stringify(raw))
    assert.deepEqual(plan.rejects, [])
    assert.equal(plan.total, 0)
  }
})

test('a typed zero is not a debt either, and is not an error', () => {
  // An owner writing 0 against a family is saying "this one is square" — the same
  // thing the empty box says. Raising a ৳0 invoice would put that family on the fee
  // board and bury the ones who owe money.
  for (const raw of ['0', '0.00', '০']) {
    const plan = arrearsPlan([{ studentId: 's1', raw }], map([['s1', 'e1']]))
    assert.deepEqual(plan.invoices, [], raw)
    assert.deepEqual(plan.rejects, [], raw)
  }
})

test('Bangla digits and a typed taka sign are read, not refused', () => {
  // A phone keyboard set to Bangla produces these, and so does an owner who types
  // the amount the way they would write it on the register.
  const plan = arrearsPlan(
    [
      { studentId: 's1', raw: '৩০০০' },
      { studentId: 's2', raw: '৳ 1,250' },
    ],
    map([
      ['s1', 'e1'],
      ['s2', 'e2'],
    ]),
  )
  assert.deepEqual(
    plan.invoices.map((i) => i.amount),
    [3000, 1250],
  )
  assert.equal(plan.total, 4250)
})

test('nonsense in a box is named, not silently dropped', () => {
  const plan = arrearsPlan([{ studentId: 's1', raw: 'three thousand' }], map([['s1', 'e1']]))
  assert.deepEqual(plan.invoices, [])
  assert.deepEqual(plan.rejects, [{ studentId: 's1', problem: 'unreadable' }])
})

test('a negative amount is refused as its own answer', () => {
  // Not folded in with unreadable. Somebody typing -500 is trying to record a credit
  // on a screen that records debt, and the message for that is not "we could not
  // read that".
  const plan = arrearsPlan([{ studentId: 's1', raw: '-500' }], map([['s1', 'e1']]))
  assert.deepEqual(plan.invoices, [])
  assert.deepEqual(plan.rejects, [{ studentId: 's1', problem: 'negative' }])
})

test('the column ceiling is enforced, one taka either side of it', () => {
  const ok = arrearsPlan([{ studentId: 's1', raw: String(MAX_TAKA) }], map([['s1', 'e1']]))
  assert.equal(ok.invoices.length, 1)
  assert.deepEqual(ok.rejects, [])

  const over = arrearsPlan(
    [{ studentId: 's1', raw: String(MAX_TAKA + 1) }],
    map([['s1', 'e1']]),
  )
  assert.deepEqual(over.invoices, [])
  assert.deepEqual(over.rejects, [{ studentId: 's1', problem: 'tooLarge' }])
})

test('a student with no active enrolment has nowhere to hang the debt', () => {
  // The screen offers no box for one, so this is a page that went stale while it was
  // being filled in. It has to be said out loud: attaching the row to nothing would
  // cost it the unique key that makes the write safe to repeat.
  const plan = arrearsPlan([{ studentId: 'gone', raw: '3000' }], map([]))
  assert.deepEqual(plan.invoices, [])
  assert.deepEqual(plan.rejects, [{ studentId: 'gone', problem: 'notEnrolled' }])
})

test('one bad box does not take the good ones out of the plan', () => {
  // The caller refuses the whole submission on any reject — that decision is its
  // own, and this keeps the reporting honest enough for it to name both halves.
  const plan = arrearsPlan(
    [
      { studentId: 's1', raw: '3000' },
      { studentId: 's2', raw: '??' },
      { studentId: 's3', raw: '500' },
    ],
    map([
      ['s1', 'e1'],
      ['s2', 'e2'],
      ['s3', 'e3'],
    ]),
  )
  assert.deepEqual(
    plan.invoices.map((i) => i.studentId),
    ['s1', 's3'],
  )
  assert.deepEqual(plan.rejects, [{ studentId: 's2', problem: 'unreadable' }])
  assert.equal(plan.total, 3500)
})

test('the total is added in poisha, not with a running float', () => {
  // Eight amounts that a float would get wrong. The screen shows this figure to the
  // owner before they submit and the fee board shows it again afterwards, and the two
  // have to agree to the taka.
  const raws = Array.from({ length: 8 }, () => '1500.10')
  const plan = arrearsPlan(
    raws.map((raw, i) => ({ studentId: `s${i}`, raw })),
    map(raws.map((_, i) => [`s${i}`, `e${i}`] as [string, string])),
  )
  assert.equal(plan.total, 12000.8)
})

test('a repeated student id in the form body is taken once', () => {
  // Not producible from the screen, which draws one box per student. Two rows for one
  // key would make the upsert fail as a whole, so the first wins and the rest go.
  const plan = arrearsPlan(
    [
      { studentId: 's1', raw: '3000' },
      { studentId: 's1', raw: '9000' },
    ],
    map([['s1', 'e1']]),
  )
  assert.deepEqual(plan.invoices, [{ studentId: 's1', enrollmentId: 'e1', amount: 3000 }])
})

test('an empty submission is an empty plan, not a crash', () => {
  const plan = arrearsPlan([], map([]))
  assert.deepEqual(plan.invoices, [])
  assert.deepEqual(plan.rejects, [])
  assert.equal(plan.total, 0)
})

/* -------------------------------------------------------------------------- */
/* Which enrolment the debt lands on                                          */
/* -------------------------------------------------------------------------- */

test('the oldest enrolment wins, so the slot cannot move later', () => {
  const chosen = oldestEnrollments([
    enrolment('new', 's1', '2026-06-01T06:00:00.000Z'),
    enrolment('old', 's1', '2025-01-01T06:00:00.000Z'),
    enrolment('mid', 's1', '2025-09-01T06:00:00.000Z'),
  ])
  assert.equal(chosen.get('s1'), 'old')
})

test('a tie is broken by id, because a tie is the normal case', () => {
  // enrolled_at defaults to now(), and now() is one value for a whole import — so
  // every student loaded from a paper register has all their enrolments stamped
  // identically. Leaving the choice to the query's row order would mean a replay
  // could pick a different slot and write the same debt twice.
  const sameStamp = '2026-08-01T06:00:00.000Z'
  const forwards = oldestEnrollments([
    enrolment('e-b', 's1', sameStamp),
    enrolment('e-a', 's1', sameStamp),
  ])
  const backwards = oldestEnrollments([
    enrolment('e-a', 's1', sameStamp),
    enrolment('e-b', 's1', sameStamp),
  ])
  assert.equal(forwards.get('s1'), 'e-a')
  assert.equal(backwards.get('s1'), 'e-a')
})

test('each student gets their own enrolment', () => {
  const chosen = oldestEnrollments([
    enrolment('e1', 's1', '2025-01-01T06:00:00.000Z'),
    enrolment('e2', 's2', '2026-01-01T06:00:00.000Z'),
    enrolment('e3', 's1', '2026-05-01T06:00:00.000Z'),
  ])
  assert.equal(chosen.size, 2)
  assert.equal(chosen.get('s1'), 'e1')
  assert.equal(chosen.get('s2'), 'e2')
})

test('a row missing its ids is not a student anybody can bill', () => {
  const chosen = oldestEnrollments([
    { id: '', student_id: 's1', enrolled_at: '2026-01-01T06:00:00.000Z' },
    { id: 'e2', student_id: '', enrolled_at: '2026-01-01T06:00:00.000Z' },
  ])
  assert.equal(chosen.size, 0)
})

test('no enrolments is an empty map, and the plan then rejects everything', () => {
  assert.equal(oldestEnrollments([]).size, 0)
})

/* -------------------------------------------------------------------------- */
/* The running figure the owner checks before pressing                        */
/* -------------------------------------------------------------------------- */

test('the running total agrees with the plan to the taka', () => {
  // The whole point of the figure on the screen. Amounts a float would get wrong,
  // added the two different ways the two halves of this screen add them — the owner
  // reads one before submitting and the fee board shows the other afterwards, and an
  // owner who finds them a taka apart stops believing the board.
  const raws = ['1500.10', '1500.10', '1500.10', '2999.95', '0.05', '৩,০০০', '৳ 12.35']
  const typed = arrearsTyped(raws)
  const plan = arrearsPlan(
    raws.map((raw, i) => ({ studentId: `s${i}`, raw })),
    map(raws.map((_, i) => [`s${i}`, `e${i}`] as [string, string])),
  )

  assert.equal(typed.filled, plan.invoices.length)
  assert.equal(typed.total, plan.total)
})

test('a blank box and a typed zero are not counted as filled', () => {
  const typed = arrearsTyped(['', '   ', '0', '0.00', '০', '500'])
  assert.equal(typed.filled, 1)
  assert.equal(typed.total, 500)
})

test('nonsense adds nothing rather than making the figure disappear', () => {
  // A half-typed box exists for as long as it takes to type the rest of it. A total
  // that blanked or NaN'd while an owner was mid-keystroke would be unreadable during
  // the one activity this screen is for.
  const typed = arrearsTyped(['three thousand', '-', '.', '3000'])
  assert.equal(typed.filled, 1)
  assert.equal(typed.total, 3000)
})

test('a typo the plan will refuse is still shown in the total', () => {
  // The refusals are the plan's job; this figure's job is to look wrong. A negative
  // that was silently dropped, or a ৳30,000,000 hidden from the total, would take the
  // one thing that catches a fat-fingered amount off the screen.
  const typed = arrearsTyped(['-500', '3000'])
  assert.equal(typed.filled, 2)
  assert.equal(typed.total, 2500)

  const huge = arrearsTyped([String(MAX_TAKA + 1)])
  assert.equal(huge.total, MAX_TAKA + 1)
})

test('nothing typed is a zero total, not an empty box on the screen', () => {
  assert.deepEqual(arrearsTyped([]), { filled: 0, total: 0 })
})

/* -------------------------------------------------------------------------- */
/* And the screen's own shape                                                 */
/* -------------------------------------------------------------------------- */

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const PAGE = read('src', 'app', '(app)', 'fees', 'arrears', 'page.tsx')
const FORM = read('src', 'app', '(app)', 'fees', 'arrears', 'arrears-form.tsx')

/** From the form's own tag, so `border-2` in the two class consts is out of reach. */
const RENDER = FORM.slice(FORM.indexOf('<form'))

const SETTINGS_AT = RENDER.indexOf('<Card className="lg:col-span-12">')
const LIST_AT = RENDER.indexOf('overflow-hidden rounded-2xl')
/**
 * Anchored on the whole `className="`, not on the class name: `ordersIn` and every span
 * check below read from the quote, and a slice that begins at `lg:sticky` has already
 * thrown away the four classes in front of it.
 */
const RAIL_AT = RENDER.indexOf(
  '<div className="flex flex-col gap-4 lg:sticky lg:top-16 lg:col-span-4">',
)
const ROWS_AT = RENDER.indexOf('const ArrearsRows = memo(')

const SETTINGS = RENDER.slice(SETTINGS_AT, LIST_AT)
const LIST = RENDER.slice(LIST_AT, RAIL_AT)
const RAIL = RENDER.slice(RAIL_AT, ROWS_AT)
const ROWS = RENDER.slice(ROWS_AT)

/** See plan-page.test.ts: the lookbehind keeps `border-2` and `lg:col-span-N` out. */
function ordersIn(source: string): string[] {
  return [...source.matchAll(/(?<=["\s`])order-(\d+|last)\b/g)].map((m) => m[1])
}

test('the boxes take eight columns and the figure four, and the figure stays put', () => {
  assert.ok(SETTINGS_AT > 0, 'the month and the deadline are not one full-width card')
  assert.ok(LIST_AT > SETTINGS_AT, 'the column of boxes is not written after them')
  assert.ok(RAIL_AT > LIST_AT, 'the total is not written after the column')

  assert.match(RENDER, /lg:grid lg:grid-cols-12 lg:items-start lg:gap-6/)
  assert.match(LIST, /border border-line bg-white\s+lg:col-span-8/)
  // `top-16` and not `top-8`: the page bar is 56px of sticky furniture at `lg`, and it
  // paints over this rail, so a total pinned 8px from the top would sit under it.
  // page-header.test.ts holds the repo-wide half of that, across every rail at once.
  assert.match(RAIL, /flex flex-col gap-4 lg:sticky lg:top-16 lg:col-span-4/)

  // The month and the deadline are two selects set once before any typing starts, so
  // they go side by side rather than taking two lines of a full-width card.
  assert.match(SETTINGS, /mt-4 grid gap-3 sm:grid-cols-2/)
  assert.match(SETTINGS, /id="periodMonth"/)
  assert.match(SETTINGS, /id="dueDay"/)

  // Sticky from `lg` and not before it. A phone already has the shell's nav fixed to
  // the bottom of the screen, and the figure is next to the button there anyway.
  // (A bare `sticky` in a comment in the source trips this too, which is why the note
  // above the rail says "the page bar's 56px" rather than "the sticky page bar".)
  assert.doesNotMatch(RENDER, /(?<!lg:)sticky/)
})

test('no block is moved, because the source order is the order somebody types in', () => {
  // The month, then the three hundred boxes, then the total and the button: that is the
  // reading order, the tab order and the phone order all at once, so there is nothing
  // for `order-N` to do. `order` moves neither a keyboard nor a screen reader, and this
  // is the one screen in the product somebody sits and types into for twenty minutes.
  assert.deepEqual(ordersIn(RENDER), [])
  assert.doesNotMatch(RENDER, /lg:order-/)
})

test('the total is drawn once, beside the button, and is the tested arithmetic', () => {
  assert.equal(RENDER.split('formatTaka(tally.total)').length - 1, 1)
  assert.match(RAIL, /className="num text-3xl font-bold text-ink">\{formatTaka\(tally\.total\)\}/)
  assert.match(RAIL, /\{fill\(t\.filledCount, \{ n: digits\(tally\.filled, locale\) \}\)\}/)
  assert.match(RAIL, /type="submit"/)

  // Read out of the DOM by the module the action's own plan comes from, so the figure
  // checked before the press and the figure written by it cannot drift.
  assert.match(FORM, /setTally\(arrearsTyped\(raws\)\)/)
  assert.match(FORM, /if \(form\.current\) recount\(form\.current\)\n  \}, \[month\]\)/)
  assert.doesNotMatch(LIST, /tally\./, 'the figure is drawn inside the column of boxes')
})

test('what the press came back with is drawn in the rail, not at the top', () => {
  for (const branch of ['state?.error', 'state?.warn', 'state?.ok']) {
    assert.ok(RAIL.includes(branch), `${branch} is not beside the button`)
    assert.equal(RENDER.split(branch).length - 1, 1, `${branch} is drawn twice`)
  }
  assert.match(RAIL, /role="status"/)
})

test('the boxes stay uncontrolled and the column stays memoised', () => {
  // The load-bearing decision in the file: three hundred boxes whose text lives in
  // React state re-render the whole column on every keystroke, which on the phone this
  // is built for is a visible stutter on the one screen an owner types into for twenty
  // minutes. A `value=` or a `defaultValue=` on the box would undo it silently.
  assert.match(ROWS, /<input\n\s+id=\{`\$\{ARREARS_FIELD_PREFIX\}\$\{row\.id\}`\}/)
  assert.doesNotMatch(ROWS, /value=/, 'an amount box became controlled')
  assert.match(FORM, /const ArrearsRows = memo\(function ArrearsRows\(/)

  // And a fresh `{}` for a month with nothing in it would give the memo a new prop on
  // every keystroke, which is the same bug arriving by the other road.
  assert.match(RENDER, /taken=\{taken\[month\] \?\? NOTHING_TAKEN\}/)
  assert.match(FORM, /onChange=\{\(e\) => recount\(e\.currentTarget\)\}/)
})

test('a slot that already holds a bill has a figure in it and no box', () => {
  // One input in the file, and it is the amount. A disabled box would take an amount
  // and drop it: the write leaves a taken slot alone, and `unique (enrollment_id,
  // period_month)` is what makes pressing twice safe.
  assert.equal(FORM.split('<input').length - 1, 1)
  assert.match(ROWS, /\{held \? \(/)
  assert.match(ROWS, /held\.cancelled \? billedCancelled : billed/)
  assert.match(ROWS, /className="num w-28 shrink-0 text-right/)
  assert.match(ROWS, /aria-label=\{fill\(amountFor, \{ name: row\.name \}\)\}/)
})

test('the bar says what the screen is on both shapes, and the empty card is not a metre wide', () => {
  // Two bars and one crumb: the refused screen draws its own, and a mutation to either
  // one leaves the other standing to answer for it.
  assert.equal(PAGE.split('<PageHeader').length - 1, 2)
  assert.equal(PAGE.split('back={back}').length - 1, 2, 'a way back went missing')
  assert.equal(PAGE.split("{ href: '/fees' as const, label: t.backToFees }").length - 1, 1)
  assert.equal(PAGE.split('{t.subtitle}').length - 1, 1)
  // The bar owns the title on every screen that has one; a hand-rolled h1 beside it is
  // two titles and only one of them scrolls away.
  assert.equal(PAGE.split('<h1').length - 1, 0)
  assert.match(PAGE, /<Card className="lg:max-w-2xl">/)
  // The refusal gave its column cap up to its card, or the bar's background would stop
  // 672px into a 1,216px workspace.
  assert.match(PAGE, /<Card className="max-w-2xl border-late\/30/)
  assert.doesNotMatch(PAGE, /flex flex-col gap-4 lg:max-w-2xl/)
})

test('§38: the reads, the gate and the months are the ones that were there', () => {
  assert.match(PAGE, /pageCapability\('fees'\)/)
  // Deliberately ungated. A free-tier board reading zero while the teacher is owed
  // nine thousand is a board that lies, and the argument for this screen is that the
  // figure on the board is the figure in the owner's head.
  assert.doesNotMatch(PAGE, /has\(session\.plan/, 'a plan gate appeared on the arrears screen')

  assert.equal(PAGE.split('pageAll((from, to) =>').length - 1, 3)
  assert.equal(PAGE.split(".eq('coaching_center_id', session.active.centerId)").length - 1, 3)
  assert.match(PAGE, /\.eq\('status', 'active'\)/)
  assert.match(PAGE, /\.in\('period_month', months\.map\(\(m\) => m\.value\)\)/)
  assert.match(PAGE, /select\('enrollment_id, period_month, amount_bdt, voided_at'\)/)

  // All three or none: a form built on a read that failed accepts an afternoon's
  // typing and saves some of it.
  assert.match(PAGE, /const problem = worstFailure\(enrollments, students, billed\)/)
  assert.match(
    PAGE,
    /!\('rows' in enrollments\) \|\| !\('rows' in students\) \|\| !\('rows' in billed\)/,
  )
  assert.match(PAGE, /oldestEnrollments\(enrollments\.rows\)/)

  // Backwards only, and never this month: a row in the current month's slot makes the
  // invoice generator skip that family, so their real monthly fee is never billed.
  assert.match(PAGE, /addMonths\(currentPeriodMonth\(\), -\(i \+ 1\)\)/)
  assert.match(PAGE, /Array\.from\(\{ length: 12 \}/)
})

