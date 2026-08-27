import { test } from 'node:test'
import assert from 'node:assert/strict'

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
