import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SETUP_ORDER,
  setupSteps,
  type SetupCounts,
} from '../src/lib/setup.ts'

/** A fully set-up centre, so each case says only what it is about. */
function counts(over: Partial<SetupCounts> = {}): SetupCounts {
  return { students: 40, batches: 3, enrolments: 40, sessions: 12, ...over }
}

/** The ids the checklist offers, in the order it offers them. */
function ids(steps: NonNullable<ReturnType<typeof setupSteps>>) {
  return steps.map((s) => s.id)
}

test('a centre that is running gets no card at all', () => {
  // The card has to end. Nothing stores that it has been dismissed, so "finished"
  // is derived from the centre's own data, and derived means it must come out null.
  assert.equal(setupSteps(counts()), null)
})

test('a brand-new centre is told to add students, and only that', () => {
  const steps = setupSteps(counts({ students: 0, enrolments: 0, sessions: 0 }))
  assert.ok(steps)
  assert.deepEqual(ids(steps), ['students', 'batches', 'enrolments', 'attendance'])
  assert.deepEqual(
    steps.filter((s) => s.next).map((s) => s.id),
    ['students'],
  )
  // Every step is listed even though only one is asked for: an owner deciding
  // whether this is worth an evening needs to see how much is left.
  assert.deepEqual(
    steps.map((s) => s.done),
    [false, true, false, false],
  )
})

test('a pasted register with no batch is told to open one, not to enrol', () => {
  // The failure this whole card exists for. Two hundred names are in, so step one
  // is done and the roster looks healthy; nothing can be billed or marked until a
  // batch exists, and asking for the enrolment first would be an instruction the
  // owner cannot follow.
  const steps = setupSteps(counts({ batches: 0, enrolments: 0, sessions: 0 }))
  assert.ok(steps)
  assert.deepEqual(
    steps.filter((s) => s.next).map((s) => s.id),
    ['batches'],
  )
})

test('students and a batch but nobody enrolled asks for the enrolment', () => {
  const steps = setupSteps(counts({ enrolments: 0, sessions: 0 }))
  assert.ok(steps)
  assert.deepEqual(
    steps.filter((s) => s.next).map((s) => s.id),
    ['enrolments'],
  )
})

test('the last thing asked for is the first register', () => {
  const steps = setupSteps(counts({ sessions: 0 }))
  assert.ok(steps)
  assert.deepEqual(
    steps.filter((s) => s.next).map((s) => s.id),
    ['attendance'],
  )
  assert.deepEqual(
    steps.map((s) => s.done),
    [true, true, true, false],
  )
})

test('exactly one step is ever asked for', () => {
  // Two "next" steps would be two instructions on one card, which is a to-do list
  // again. Checked across every combination rather than trusting the find().
  for (let mask = 0; mask < 16; mask++) {
    const steps = setupSteps({
      students: mask & 1 ? 1 : 0,
      batches: mask & 2 ? 1 : 0,
      enrolments: mask & 4 ? 1 : 0,
      sessions: mask & 8 ? 1 : 0,
    })
    if (steps === null) {
      assert.equal(mask, 15, 'only the finished centre gets no card')
      continue
    }
    assert.equal(steps.filter((s) => s.next).length, 1)
    // And it is always the earliest unfinished one, so prerequisites hold.
    const asked = steps.find((s) => s.next)!.id
    const before = SETUP_ORDER.slice(0, SETUP_ORDER.indexOf(asked))
    assert.ok(
      before.every((id) => steps.find((s) => s.id === id)!.done),
      `${asked} was asked for with something before it unfinished`,
    )
  }
})

test('a count that failed to load says nothing rather than something false', () => {
  // The bug this guards. `count: 'exact', head: true` returns null when the query
  // fails, and a null read as zero would put "add your students" on the dashboard
  // of a centre with three hundred of them — on the one screen an owner trusts.
  assert.equal(setupSteps(counts({ students: null })), null)
  assert.equal(setupSteps(counts({ batches: null })), null)
  assert.equal(setupSteps(counts({ enrolments: null })), null)
  assert.equal(setupSteps(counts({ sessions: null })), null)
})

test('a null is not rescued by the others being fine', () => {
  // Belt and braces on the case that would matter most: everything unfinished and
  // one count missing is exactly when the card is loudest.
  assert.equal(
    setupSteps({ students: null, batches: 0, enrolments: 0, sessions: 0 }),
    null,
  )
})

test('the order is the dependency order', () => {
  // Asserted on the exported constant rather than only through the cases above,
  // because reordering it silently changes what every centre is asked to do next.
  assert.deepEqual(SETUP_ORDER, ['students', 'batches', 'enrolments', 'attendance'])
})
