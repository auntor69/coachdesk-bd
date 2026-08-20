import { test } from 'node:test'
import assert from 'node:assert/strict'

import { riskLevel, studentsAtRisk, type RiskRow } from '../src/lib/students/risk.ts'

/**
 * A row with nothing flagged, to be overridden one field at a time.
 *
 * Built as a factory rather than a shared constant because every test here sorts
 * or maps the result, and a shared object would let one test's mutation decide
 * another's outcome.
 */
function row(over: Partial<RiskRow> = {}): RiskRow {
  return {
    student_id: 'a',
    student_name: 'A',
    student_code: null,
    guardian_phone: null,
    att_marks: 0,
    att_pct: null,
    att_prev_marks: 0,
    att_prev_pct: null,
    marks_pct: null,
    marks_prev_pct: null,
    marks_prev_n: 0,
    exams_missed: 0,
    fee_days_late: 0,
    fee_owed_bdt: 0,
    att_low: false,
    att_fell: false,
    marks_low: false,
    marks_fell: false,
    marks_missed: false,
    fee_flag: false,
    signals: 1,
    ...over,
  }
}

/** The one row out of a single-row list, so a test reads as one sentence. */
function only(over: Partial<RiskRow>) {
  const out = studentsAtRisk([row(over)], '—')
  assert.equal(out.length, 1, 'expected exactly one student')
  return out[0]
}

test('the level names an action, and every signal count has one', () => {
  assert.equal(riskLevel(1), 'watch')
  assert.equal(riskLevel(2), 'talk')
  assert.equal(riskLevel(3), 'call')

  // Neither end can throw or return undefined on the owner's home screen. 0 is
  // unreachable through the view, which returns only flagged rows, and 4 would
  // mean a fourth signal was added to the view and not to riskLevel.
  assert.equal(riskLevel(0), 'watch')
  assert.equal(riskLevel(4), 'call')
})

test('a signal that did not fire writes no line', () => {
  // Every screen renders one line per reason, so an unfired signal must leave
  // nothing behind at all. The failure this guards against is a page printing
  // "0% attendance" beside a student whose only problem is an unpaid fee.
  const s = only({ fee_flag: true, fee_days_late: 9, fee_owed_bdt: 500 })
  assert.deepEqual(s.reasons, [{ kind: 'feeLate', daysLate: 9, owed: 500 }])
})

test('each arm carries exactly the figures its sentence needs', () => {
  assert.deepEqual(only({ att_low: true, att_pct: 55, att_marks: 9 }).reasons, [
    { kind: 'attendanceLow', pct: 55, marks: 9 },
  ])

  assert.deepEqual(
    only({ att_fell: true, att_pct: 72, att_marks: 8, att_prev_pct: 95, att_prev_marks: 9 })
      .reasons,
    [{ kind: 'attendanceFell', pct: 72, prevPct: 95, marks: 8 }],
  )

  assert.deepEqual(only({ marks_low: true, marks_pct: 31 }).reasons, [
    { kind: 'marksLow', pct: 31 },
  ])

  assert.deepEqual(
    only({ marks_fell: true, marks_pct: 65, marks_prev_pct: 85, marks_prev_n: 3 }).reasons,
    [{ kind: 'marksFell', pct: 65, prevPct: 85, prevN: 3 }],
  )

  assert.deepEqual(only({ marks_missed: true, exams_missed: 2 }).reasons, [
    { kind: 'examsMissed', n: 2 },
  ])
})

test('when both arms of one signal fire, only the richer sentence is written', () => {
  // 55% and 55%-was-88% on two lines is one fact printed twice, and reads as a bug.
  // The fell wording already contains the low one's only figure.
  const att = only({
    att_low: true,
    att_fell: true,
    att_pct: 55,
    att_prev_pct: 88,
    att_marks: 9,
  })
  assert.deepEqual(att.reasons, [{ kind: 'attendanceFell', pct: 55, prevPct: 88, marks: 9 }])

  const marks = only({
    marks_low: true,
    marks_fell: true,
    marks_pct: 31,
    marks_prev_pct: 62,
    marks_prev_n: 2,
  })
  assert.deepEqual(marks.reasons, [{ kind: 'marksFell', pct: 31, prevPct: 62, prevN: 2 }])
})

test('a missed exam is its own line, even beside a good mark', () => {
  // "90%, sat none of the last two" is the whole point of counting absences
  // separately instead of averaging them in as zeroes.
  const s = only({ marks_missed: true, exams_missed: 2, marks_pct: 90 })
  assert.deepEqual(s.reasons, [{ kind: 'examsMissed', n: 2 }])
})

test('the lines are ordered attendance, marks, fee', () => {
  const s = only({
    att_low: true,
    att_pct: 50,
    marks_fell: true,
    marks_pct: 30,
    marks_missed: true,
    exams_missed: 3,
    fee_flag: true,
    fee_days_late: 20,
    signals: 3,
  })
  assert.deepEqual(
    s.reasons.map((r) => r.kind),
    ['attendanceLow', 'marksFell', 'examsMissed', 'feeLate'],
  )
  assert.equal(s.level, 'call')
})

test('two arms of one signal are still one signal', () => {
  // signals comes from the view, which ORs the arms. Counting reasons instead
  // would rank a student drifting one way above one drifting in three.
  const s = only({ att_low: true, att_fell: true, att_pct: 40, att_prev_pct: 80, signals: 1 })
  assert.equal(s.reasons.length, 1)
  assert.equal(s.signals, 1)
  assert.equal(s.level, 'watch')
})

test('more signals come first, whatever the figures under them say', () => {
  const rows = [
    row({ student_id: 'one', student_name: 'One', signals: 1, att_low: true, att_pct: 5 }),
    row({ student_id: 'three', student_name: 'Three', signals: 3, att_low: true, att_pct: 68 }),
    row({ student_id: 'two', student_name: 'Two', signals: 2, att_low: true, att_pct: 40 }),
  ]
  assert.deepEqual(
    studentsAtRisk(rows, '—').map((s) => s.studentId),
    ['three', 'two', 'one'],
  )
})

test('within a tie the student attending least comes first', () => {
  // Not the largest debt. This list is an early warning about a seat going empty,
  // not a collection worklist — see the note on studentsAtRisk.
  const rows = [
    row({ student_id: 'b', student_name: 'B', att_low: true, att_pct: 60 }),
    row({ student_id: 'a', student_name: 'A', att_low: true, att_pct: 22 }),
    row({ student_id: 'c', student_name: 'C', att_fell: true, att_pct: 69, att_prev_pct: 95 }),
  ]
  assert.deepEqual(
    studentsAtRisk(rows, '—').map((s) => s.studentId),
    ['a', 'b', 'c'],
  )
})

test('a student with no attendance signal sorts below every student who has one', () => {
  // Nothing recorded is not the same fact as nobody attending: it usually means
  // the batch has not been registered yet. Sorting the absent figure first would
  // put an unmeasured student above a real 20% and cost the list its whole point.
  const rows = [
    row({ student_id: 'fee-only', student_name: 'Fee Only', fee_flag: true, fee_days_late: 30 }),
    row({ student_id: 'measured', student_name: 'Measured', att_low: true, att_pct: 20 }),
  ]
  assert.deepEqual(
    studentsAtRisk(rows, '—').map((s) => s.studentId),
    ['measured', 'fee-only'],
  )
})

test('with attendance equal, the longest-owed fee breaks the tie', () => {
  const rows = [
    row({ student_id: 'recent', student_name: 'Recent', fee_flag: true, fee_days_late: 8 }),
    row({ student_id: 'old', student_name: 'Old', fee_flag: true, fee_days_late: 45 }),
  ]
  assert.deepEqual(
    studentsAtRisk(rows, '—').map((s) => s.studentId),
    ['old', 'recent'],
  )
})

test('identical rows keep a stable order rather than swapping between renders', () => {
  // Two students with the same figures must not trade places between two loads of
  // the same screen; it reads as the list being wrong rather than as a tie.
  const rows = [
    row({ student_id: 'z', student_name: 'Zaman', marks_low: true, marks_pct: 30 }),
    row({ student_id: 'a', student_name: 'Aman', marks_low: true, marks_pct: 30 }),
  ]
  const once = studentsAtRisk(rows, '—').map((s) => s.studentId)
  const twice = studentsAtRisk([...rows].reverse(), '—').map((s) => s.studentId)
  assert.deepEqual(once, ['a', 'z'])
  assert.deepEqual(twice, once)
})

test('nothing to show is an empty list, never a throw', () => {
  // The dashboard renders this before it knows whether the centre has any
  // students at all, and a null from PostgREST is what an error looks like there.
  assert.deepEqual(studentsAtRisk(null, '—'), [])
  assert.deepEqual(studentsAtRisk(undefined, '—'), [])
  assert.deepEqual(studentsAtRisk([], '—'), [])
})

test('a student with nothing wrong is dropped rather than listed blank', () => {
  // The view cannot return such a row. A caller passing rows from somewhere else
  // can, and a name on the worklist with no reason under it is worse than a name
  // missing from it.
  assert.deepEqual(studentsAtRisk([row({ signals: 0 })], '—'), [])
})

test('a nameless student is named, and one with no id is dropped', () => {
  const out = studentsAtRisk(
    [
      row({ student_id: 'kept', student_name: null, att_low: true, att_pct: 10 }),
      row({ student_id: null, student_name: 'Ghost', fee_flag: true }),
    ],
    'নাম নেই',
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].name, 'নাম নেই')
})
