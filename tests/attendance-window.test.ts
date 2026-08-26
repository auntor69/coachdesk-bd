import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ATTENDANCE_MAX_REVISION,
  attendanceVerdict,
  isDateString,
  lastClassDate,
} from '../src/lib/attendance/window.ts'
import { dayOfWeekOn } from '../src/lib/bd/time.ts'

/**
 * Real days, chosen so the weekday is checkable by hand and asserted below before
 * anything else leans on it. Bangladesh's working week is Saturday to Thursday.
 */
const SAT = '2026-08-22'
const SUN = '2026-08-23'
const MON = '2026-08-24'
const TUE = '2026-08-25'
const WED = '2026-08-26'
const THU = '2026-08-27'
const FRI = '2026-08-28'

test('the fixture dates are the weekdays this file claims they are', () => {
  // If this fails, every other case here is testing something else.
  assert.deepEqual(
    [SAT, SUN, MON, TUE, WED, THU, FRI].map(dayOfWeekOn),
    [6, 0, 1, 2, 3, 4, 5],
  )
})

test('a date that rolls over is not a date', () => {
  assert.equal(isDateString(THU), true)
  assert.equal(isDateString('2024-02-29'), true, 'a leap day exists')
  // Date.parse reads this as the 3rd of March. A register filed a fortnight late
  // on a day nobody has is worse than a refusal.
  assert.equal(isDateString('2026-02-31'), false)
  assert.equal(isDateString('2026-02-29'), false, '2026 is not a leap year')
  assert.equal(isDateString('2026-13-01'), false)
  assert.equal(isDateString('2026-08-00'), false)
  assert.equal(isDateString('26-08-27'), false)
  assert.equal(isDateString('2026-8-27'), false)
  assert.equal(isDateString(''), false)
  assert.equal(isDateString('today'), false)
  assert.equal(isDateString(`${THU}T00:00:00Z`), false)
})

test('a batch that meets every weekday can be corrected back to yesterday', () => {
  const weekdays = [6, 0, 1, 2, 3, 4]
  assert.equal(lastClassDate(THU, weekdays, null), WED)
  assert.equal(lastClassDate(SUN, weekdays, null), SAT)
})

test('a batch that meets once a week reaches back to that day, not to yesterday', () => {
  // The whole reason the walk is day by day. A Saturday-only batch asked on Friday
  // has to answer "last Saturday", six days back — a weekday-arithmetic shortcut
  // would answer Thursday and offer a register for a class that never happened.
  assert.equal(lastClassDate(FRI, [6], null), SAT)
  assert.equal(lastClassDate(SAT, [6], null), '2026-08-15', 'the Saturday before')
})

test('a batch with no timetable is treated as meeting yesterday', () => {
  // The same absence /teach already reads as "meets every day". A centre that has
  // not filled in its schedule is not a centre whose registers should be uneditable.
  assert.equal(lastClassDate(THU, [], null), WED)
})

test('nothing earlier is open when the timetable holds no real day', () => {
  assert.equal(lastClassDate(THU, [9], null), null)
})

test('a class held off-timetable is still correctable the next day', () => {
  // A Saturday-only batch that ran an extra Wednesday session before an exam. The
  // register exists, so the teacher who took it may fix it — the timetable does not
  // get to say the class did not happen.
  assert.equal(lastClassDate(THU, [6], WED), WED)
})

test('the timetable wins when it is the more recent of the two', () => {
  // A register from three weeks ago must not drag the window back past yesterday's
  // actual class.
  assert.equal(lastClassDate(THU, [3, 4], '2026-08-05'), WED)
})

test('a register dated today or later never widens the window', () => {
  // The action queries `session_date < today`, so this is defence in depth: today
  // is open on its own account and a future register must not make itself open.
  assert.equal(lastClassDate(THU, [4], THU), '2026-08-20')
  assert.equal(lastClassDate(THU, [4], FRI), '2026-08-20')
})

test('today and the last class are open, and everything else is not', () => {
  assert.equal(attendanceVerdict(THU, THU, WED), 'open')
  assert.equal(attendanceVerdict(WED, THU, WED), 'open')
  assert.equal(attendanceVerdict(TUE, THU, WED), 'closed')
  assert.equal(attendanceVerdict(MON, THU, WED), 'closed')
  assert.equal(attendanceVerdict('2025-08-27', THU, WED), 'closed')
})

test('tomorrow is future, and so is next year', () => {
  assert.equal(attendanceVerdict(FRI, THU, WED), 'future')
  assert.equal(attendanceVerdict('2027-01-01', THU, WED), 'future')
})

test('a batch on its first day has today and nothing else', () => {
  assert.equal(attendanceVerdict(THU, THU, null), 'open')
  assert.equal(attendanceVerdict(WED, THU, null), 'closed')
})

test('a date that is not a date is closed, never open and never future', () => {
  // Closed rather than future, because the caller refuses both and closed is the
  // verdict that cannot be widened by a staff-admin reading a mangled bookmark.
  assert.equal(attendanceVerdict('', THU, WED), 'closed')
  assert.equal(attendanceVerdict('2026-02-31', THU, WED), 'closed')
  assert.equal(attendanceVerdict('9999-99-99', THU, WED), 'closed')
})

test('the correction budget the screen draws is the one the trigger enforces', () => {
  // Its twin is `max_revision` in app.guard_attendance_mark(). This asserts the
  // number, not the agreement — the migration is the one that holds, and the RLS
  // suite is where a second correction is actually refused.
  assert.equal(ATTENDANCE_MAX_REVISION, 1)
})
