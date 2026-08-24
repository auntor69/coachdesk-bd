import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  progressTotals,
  progressToTell,
  weeklyProgress,
  SUMMARY_AGAIN_AFTER_DAYS,
  type ProgressRow,
} from '../src/lib/students/progress.ts'

/**
 * The weekly progress roster's own arithmetic.
 *
 * What is NOT tested here is anything the view decided: the seven-day window, the
 * excused-absence rule and which exam counts as the latest are all
 * 20260811000021_progress_summary.sql, and scripts/test-rls.mjs exercises them
 * against real Postgres. What is left for this file is what goes wrong in
 * JavaScript — a numeric arriving as a string and reaching a parent as "45.00/50",
 * a missing register reading as a child who came to nothing, a family offered the
 * same message twice in a week.
 */

const NOW = new Date('2026-08-25T09:00:00.000Z')

/** A student with a full week behind them, to be overridden one field at a time. */
function row(over: Partial<ProgressRow> = {}): ProgressRow {
  return {
    student_id: 'a',
    student_name: 'রাফিদ হাসান',
    student_code: 'S-01',
    guardian_phone: '+8801711000111',
    sms_opt_out: false,
    week_from: '2026-08-19',
    week_to: '2026-08-25',
    sessions_counted: 6,
    sessions_present: 5,
    sessions_absent: 1,
    sessions_late: 1,
    sessions_excused: 0,
    exams_taken: 1,
    exams_missed: 0,
    marks_pct: 90,
    last_exam_title: 'পদার্থবিজ্ঞান সাপ্তাহিক',
    // Strings, because that is what PostgREST sends for numeric(6,2). Every test
    // below that touches a mark depends on this being a string.
    last_exam_obtained: '45.00',
    last_exam_total: '50.00',
    last_exam_date: '2026-08-23',
    last_sent_at: null,
    ...over,
  }
}

/** The one student out of a single-row list, so a test reads as one sentence. */
function only(over: Partial<ProgressRow> = {}) {
  const out = weeklyProgress([row(over)], '—', NOW)
  assert.equal(out.length, 1, 'expected exactly one student')
  return out[0]
}

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

test('numeric marks arrive as strings and become numbers', () => {
  // The bug this exists to catch: the mark reaching a guardian as "45.00/50.00",
  // which reads as a system talking rather than a teacher.
  const s = only()
  assert.equal(s.lastExamObtained, 45)
  assert.equal(s.lastExamTotal, 50)
})

test('a student with no exam has no mark, rather than a zero', () => {
  const s = only({
    exams_taken: 0,
    marks_pct: null,
    last_exam_title: null,
    last_exam_obtained: null,
    last_exam_total: null,
    last_exam_date: null,
  })
  assert.equal(s.lastExamObtained, null)
  assert.equal(s.lastExamTotal, null)
  assert.equal(s.marksPct, null)
  // Attendance alone is still worth a message.
  assert.equal(s.status, 'send')
})

test('no register taken reads as no figure, not as a missed week', () => {
  // The one mistake in this feature that would get it switched off: telling a
  // parent their child attended 0% of classes because nobody opened the register.
  const s = only({ sessions_counted: 0, sessions_present: 0, sessions_absent: 0 })
  assert.equal(s.attendancePct, null)

  const none = only({ sessions_counted: 6, sessions_present: 0, sessions_absent: 6 })
  assert.equal(none.attendancePct, 0, 'came to none of six is a real zero')
})

test('attendance is a share of the sessions that counted', () => {
  assert.equal(only({ sessions_counted: 6, sessions_present: 5 }).attendancePct, 83)
  assert.equal(only({ sessions_counted: 4, sessions_present: 4 }).attendancePct, 100)
})

/* -------------------------------------------------------------------------- */
/* What the owner does about each row                                         */
/* -------------------------------------------------------------------------- */

test('nothing recorded is its own status, not a message with zeroes in it', () => {
  const s = only({
    sessions_counted: 0,
    sessions_present: 0,
    sessions_absent: 0,
    exams_taken: 0,
    exams_missed: 0,
    marks_pct: null,
    last_exam_title: null,
    last_exam_obtained: null,
    last_exam_total: null,
    last_exam_date: null,
  })
  assert.equal(s.status, 'nothing')
})

test('a missed exam is something to say even with no register and no mark', () => {
  // "Sat none of this week's tests" is the whole message, and the family most needs
  // that one. A status of `nothing` here would silence it.
  const s = only({
    sessions_counted: 0,
    sessions_present: 0,
    exams_taken: 0,
    exams_missed: 2,
    marks_pct: null,
    last_exam_title: null,
    last_exam_obtained: null,
    last_exam_total: null,
    last_exam_date: null,
  })
  assert.equal(s.status, 'send')
})

test('a family told recently is not offered again until the window passes', () => {
  assert.equal(only({ last_sent_at: daysAgo(0) }).status, 'sent')
  assert.equal(
    only({ last_sent_at: daysAgo(SUMMARY_AGAIN_AFTER_DAYS - 1) }).status,
    'sent',
    'the day before the threshold is still too soon',
  )
  assert.equal(
    only({ last_sent_at: daysAgo(SUMMARY_AGAIN_AFTER_DAYS) }).status,
    'send',
    'on the threshold the chip comes back',
  )
})

test('days since the last note are whole days, and never negative', () => {
  assert.equal(only({ last_sent_at: null }).daysSinceSent, null)
  assert.equal(only({ last_sent_at: daysAgo(3) }).daysSinceSent, 3)
  // Clock skew between the database and the server. "-1 days ago" on the screen is
  // a bug report about the panel rather than about the clock.
  assert.equal(only({ last_sent_at: '2026-09-01T00:00:00.000Z' }).daysSinceSent, 0)
})

test('a missing number is reported only once there is something to send', () => {
  assert.equal(only({ guardian_phone: null }).status, 'noNumber')

  // Asking the owner to chase a guardian's number for a week nobody recorded is
  // work in the wrong order.
  const blank = only({
    guardian_phone: null,
    sessions_counted: 0,
    sessions_present: 0,
    exams_taken: 0,
    exams_missed: 0,
  })
  assert.equal(blank.status, 'nothing')
})

test('an opt-out is a flag and not a status — the call still stands', () => {
  // Same rule as fee reminders: an opt-out silences the two message channels and
  // neither of them silences the phone. So the row stays sendable.
  const s = only({ sms_opt_out: true })
  assert.equal(s.smsOptOut, true)
  assert.equal(s.status, 'send')
})

/* -------------------------------------------------------------------------- */
/* The order 150 names go in                                                  */
/* -------------------------------------------------------------------------- */

test('the families to message come first and the finished ones last', () => {
  const list = weeklyProgress(
    [
      row({ student_id: 'done', last_sent_at: daysAgo(1) }),
      row({ student_id: 'blank', sessions_counted: 0, sessions_present: 0, exams_taken: 0, exams_missed: 0 }),
      row({ student_id: 'nophone', guardian_phone: null }),
      row({ student_id: 'go' }),
    ],
    '—',
    NOW,
  )

  assert.deepEqual(
    list.map((s) => s.studentId),
    ['go', 'blank', 'nophone', 'done'],
  )
})

test('worst attendance first among the families to message', () => {
  const list = weeklyProgress(
    [
      row({ student_id: 'ok', sessions_counted: 6, sessions_present: 6 }),
      row({ student_id: 'bad', sessions_counted: 6, sessions_present: 2 }),
      row({ student_id: 'mid', sessions_counted: 6, sessions_present: 4 }),
    ],
    '—',
    NOW,
  )
  assert.deepEqual(
    list.map((s) => s.studentId),
    ['bad', 'mid', 'ok'],
  )
})

test('no attendance figure sorts below every measured one, not above', () => {
  // The row with nothing recorded is not the worst week — it is an unknown week,
  // and putting it above a measured 2 out of 6 costs this list its one job.
  const list = weeklyProgress(
    [
      row({ student_id: 'unknown', sessions_counted: 0, sessions_present: 0 }),
      row({ student_id: 'bad', sessions_counted: 6, sessions_present: 2 }),
    ],
    '—',
    NOW,
  )
  assert.deepEqual(
    list.map((s) => s.studentId),
    ['bad', 'unknown'],
  )
})

test('missed exams break an attendance tie, then the name', () => {
  const list = weeklyProgress(
    [
      row({ student_id: 'b', student_name: 'বকুল', exams_missed: 0 }),
      row({ student_id: 'a', student_name: 'অনিক', exams_missed: 0 }),
      row({ student_id: 'skipped', student_name: 'জাহিদ', exams_missed: 2 }),
    ],
    '—',
    NOW,
  )
  assert.deepEqual(
    list.map((s) => s.studentId),
    ['skipped', 'a', 'b'],
    'Bangla names sort in Bangla collation, and the order is stable',
  )
})

/* -------------------------------------------------------------------------- */
/* The rest                                                                   */
/* -------------------------------------------------------------------------- */

test('a row with no student id is skipped rather than rendered', () => {
  const list = weeklyProgress([row({ student_id: null }), row({ student_id: 'ok' })], '—', NOW)
  assert.equal(list.length, 1)
  assert.equal(list[0].studentId, 'ok')
})

test('a nameless student gets the caller’s word for it', () => {
  assert.equal(only({ student_name: null }).name, '—')
  assert.equal(only({ student_name: '' }).name, '—')
})

test('the window is carried through untouched', () => {
  // The message, the screen and the row recording the send must all name the same
  // seven days. Recomputing any of them here is how they drift.
  const s = only()
  assert.equal(s.weekFrom, '2026-08-19')
  assert.equal(s.weekTo, '2026-08-25')
})

test('totals count each status once and the recorded weeks separately', () => {
  const list = weeklyProgress(
    [
      row({ student_id: 'go' }),
      row({ student_id: 'done', last_sent_at: daysAgo(1) }),
      row({ student_id: 'nophone', guardian_phone: null }),
      row({
        student_id: 'blank',
        sessions_counted: 0,
        sessions_present: 0,
        exams_taken: 0,
        exams_missed: 0,
      }),
    ],
    '—',
    NOW,
  )

  const totals = progressTotals(list)
  assert.equal(totals.students, 4)
  assert.equal(totals.send, 1)
  assert.equal(totals.sent, 1)
  assert.equal(totals.noNumber, 1)
  assert.equal(totals.nothing, 1)
  // Three of the four had a register; the blank one had neither figure.
  assert.equal(totals.withAttendance, 3)
  assert.equal(totals.withMarks, 3)
})

test('totals of nothing are zeroes, not NaN', () => {
  const totals = progressTotals([])
  for (const [key, value] of Object.entries(totals)) {
    assert.equal(value, 0, key)
  }
})

/* -------------------------------------------------------------------------- */
/* The number on the dashboard's door                                         */
/* -------------------------------------------------------------------------- */

test('the door counts exactly what the screen would list', () => {
  // The failure this exists to prevent: an owner taps a card promising twelve
  // families and lands on a screen with three. The count reads six columns and the
  // screen reads twenty, so the only thing holding them together is that both go
  // through progressDecision — and that is what this asserts.
  const rows = [
    row({ student_id: 'go' }),
    row({ student_id: 'go2', sessions_counted: 4, sessions_present: 1 }),
    row({ student_id: 'done', last_sent_at: daysAgo(1) }),
    row({ student_id: 'nophone', guardian_phone: null }),
    row({
      student_id: 'blank',
      sessions_counted: 0,
      sessions_present: 0,
      exams_taken: 0,
      exams_missed: 0,
    }),
  ]

  const listed = weeklyProgress(rows, '—', NOW).filter((s) => s.status === 'send')
  assert.equal(progressToTell(rows, NOW), listed.length)
  assert.equal(progressToTell(rows, NOW), 2)
})

test('the door counts from the narrow select, without the columns it did not ask for', () => {
  // What the dashboard actually hands it: six columns, no name, no window, no marks.
  // Typed as the count's own row rather than the screen's, so dropping a column from
  // PROGRESS_COUNT_COLUMNS is a compile error here rather than a silent zero.
  const narrow = [
    {
      student_id: 'go',
      guardian_phone: '+8801711000111',
      sessions_counted: 6,
      exams_taken: 1,
      exams_missed: 0,
      last_sent_at: null,
    },
    {
      student_id: 'blank',
      guardian_phone: '+8801711000222',
      sessions_counted: 0,
      exams_taken: 0,
      exams_missed: 0,
      last_sent_at: null,
    },
  ]

  assert.equal(progressToTell(narrow, NOW), 1)
})

test('the door reads zero rather than crashing on nothing at all', () => {
  // A teacher's dashboard, where RLS returns nothing, and a free teacher's, where
  // the query is never run. Zero is the honest answer to both and the card says so.
  assert.equal(progressToTell(null, NOW), 0)
  assert.equal(progressToTell(undefined, NOW), 0)
  assert.equal(progressToTell([], NOW), 0)
  assert.equal(progressToTell([row({ student_id: null })], NOW), 0)
})
