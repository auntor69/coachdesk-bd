import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  firstClash,
  isClashRefusal,
  proposedHours,
  TEACHER_CLASH,
  type Booking,
} from '../src/lib/settings/clash.ts'

/**
 * One teacher cannot be in two rooms at four o'clock. §7.3.
 *
 * The rule is stated twice on purpose — here for the sentence an owner reads, and in
 * 20260811000071 for the refusal a race cannot get past — so these tests are also the
 * record of what the two halves are supposed to agree about. Each one names the case in
 * the words a centre would use.
 */

const at = (day: number | null, start: string, end: string): Booking => ({
  batchId: `b-${day}-${start}`,
  name: `Batch ${day ?? 'every'} ${start}`,
  day,
  start,
  end,
})

test('the same teacher at the same hour on the same day is a clash', () => {
  const hit = firstClash([{ day: 1, start: '16:00', end: '18:00' }], [at(1, '16:00', '18:00')])
  assert.ok(hit)
  assert.equal(hit.day, 1)
})

test('a class that starts as the other ends is not a clash', () => {
  // Back-to-back batches are how a coaching centre actually runs. A rule that refused
  // them would be worked around within a week, and then it would be protecting nothing.
  assert.equal(
    firstClash([{ day: 1, start: '16:00', end: '18:00' }], [at(1, '18:00', '20:00')]),
    null,
  )
  assert.equal(
    firstClash([{ day: 1, start: '18:00', end: '20:00' }], [at(1, '16:00', '18:00')]),
    null,
  )
})

test('one minute of overlap is a clash', () => {
  assert.ok(firstClash([{ day: 1, start: '16:00', end: '18:00' }], [at(1, '17:59', '19:00')]))
  assert.ok(firstClash([{ day: 1, start: '17:59', end: '19:00' }], [at(1, '16:00', '18:00')]))
})

test('a class wholly inside another is a clash both ways round', () => {
  // Neither edge lines up, so a rule written as "does either end fall inside" would miss
  // the containing direction. Both directions asserted because the proposal is sometimes
  // the longer class and sometimes the shorter one.
  assert.ok(firstClash([{ day: 2, start: '16:30', end: '17:00' }], [at(2, '16:00', '18:00')]))
  assert.ok(firstClash([{ day: 2, start: '16:00', end: '18:00' }], [at(2, '16:30', '17:00')]))
})

test('the same hour on a different day is not a clash', () => {
  assert.equal(
    firstClash([{ day: 1, start: '16:00', end: '18:00' }], [at(2, '16:00', '18:00')]),
    null,
  )
})

test('a batch with no chosen days clashes on whichever day the other meets', () => {
  // No days means every day, which is what the form says and what the teacher panel
  // reads. This is the case the database trigger cannot see — such a batch writes no day
  // row — so it is the case this file is load-bearing for.
  assert.ok(firstClash([{ day: null, start: '16:00', end: '18:00' }], [at(4, '17:00', '19:00')]))
  assert.ok(firstClash([{ day: 4, start: '17:00', end: '19:00' }], [at(null, '16:00', '18:00')]))
  assert.ok(
    firstClash([{ day: null, start: '16:00', end: '18:00' }], [at(null, '17:00', '19:00')]),
  )
})

test('a batch with no chosen days does not clash at an hour it does not meet', () => {
  // Every day, not every hour. The looser reading would refuse a morning batch because
  // the teacher has an evening one seven days a week.
  assert.equal(
    firstClash([{ day: null, start: '08:00', end: '10:00' }], [at(null, '16:00', '18:00')]),
    null,
  )
})

test('a five-day batch is refused for the one day that collides', () => {
  const week = [1, 2, 3, 4, 5].map((day) => ({ day, start: '16:00', end: '18:00' }))
  const hit = firstClash(week, [at(3, '17:00', '19:00')])
  assert.ok(hit)
  assert.equal(hit.day, 3)
})

test('the clash named is the earliest one, so two saves name the same batch', () => {
  // Unordered, the answer would be whatever the read happened to return first, and an
  // owner saving twice would be sent to two different batches and conclude something
  // changed under them.
  const hit = firstClash(
    [{ day: null, start: '16:00', end: '18:00' }],
    [at(5, '16:00', '18:00'), at(1, '17:00', '18:00'), at(3, '16:00', '17:00')],
  )
  assert.ok(hit)
  assert.equal(hit.day, 1)
})

test('an every-day booking is named before a day of the week', () => {
  const hit = firstClash(
    [{ day: 0, start: '16:00', end: '18:00' }],
    [at(0, '16:00', '18:00'), at(null, '16:00', '18:00')],
  )
  assert.ok(hit)
  assert.equal(hit.day, null)
})

test('Sunday is not sorted last', () => {
  // 0 = Sunday, and `x.day ?? -1` is what keeps every-day ahead of it. Written as
  // `x.day ?? 0` the two would tie and Sunday would sometimes win, which is the kind of
  // ordering bug that only shows up on one day of the week.
  const hit = firstClash(
    [{ day: null, start: '16:00', end: '18:00' }],
    [at(6, '16:00', '18:00'), at(0, '16:00', '18:00')],
  )
  assert.ok(hit)
  assert.equal(hit.day, 0)
})

test('nothing booked is no clash', () => {
  assert.equal(firstClash([{ day: 1, start: '16:00', end: '18:00' }], []), null)
  assert.equal(firstClash([], [at(1, '16:00', '18:00')]), null)
})

test("a time column's seconds compare the same as the form's minutes", () => {
  // The form's parseTime hands over 'HH:MM' and a `time` column comes back as
  // 'HH:MM:SS'. Both arrive in the same call, so the two forms have to be one number.
  assert.ok(firstClash([{ day: 1, start: '16:00', end: '18:00' }], [at(1, '17:00:00', '19:00:00')]))
  assert.equal(
    firstClash([{ day: 1, start: '16:00', end: '18:00' }], [at(1, '18:00:00', '19:00:00')]),
    null,
  )
})

test('a time without a leading zero is read as the hour it is', () => {
  // The failure this replaces: comparing 'HH:MM' as strings put '9:00' after '16:00',
  // so a morning batch clashed with an evening one and an evening one with nothing.
  assert.ok(firstClash([{ day: 1, start: '9:00', end: '11:00' }], [at(1, '10:00', '12:00')]))
  assert.equal(
    firstClash([{ day: 1, start: '9:00', end: '11:00' }], [at(1, '16:00', '18:00')]),
    null,
  )
})

test('an unreadable clock is not a clash', () => {
  // The form has already refused a malformed time with its own message by the time this
  // is reached. Guessing here would turn a typo into a refusal naming an innocent batch.
  for (const bad of ['', 'evening', '25:00', '16:70', '16', 'সকাল', '-1:00', '16:0x']) {
    assert.equal(
      firstClash([{ day: 1, start: bad, end: '18:00' }], [at(1, '16:00', '18:00')]),
      null,
      bad,
    )
    assert.equal(
      firstClash([{ day: 1, start: '16:00', end: '18:00' }], [at(1, bad, '18:00')]),
      null,
      bad,
    )
  }
})

test('midnight is a readable hour', () => {
  // '00:00' is falsy nowhere in this file, but it has been elsewhere. A batch at
  // midnight is nonsense in a coaching centre and the arithmetic still has to hold.
  assert.ok(firstClash([{ day: 1, start: '00:00', end: '01:00' }], [at(1, '00:30', '02:00')]))
})

test('no days means one booking on every day', () => {
  assert.deepEqual(proposedHours([], '16:00', '18:00'), [
    { day: null, start: '16:00', end: '18:00' },
  ])
})

test('chosen days mean one booking each, at the same hour', () => {
  assert.deepEqual(proposedHours([0, 2], '16:00', '18:00'), [
    { day: 0, start: '16:00', end: '18:00' },
    { day: 2, start: '16:00', end: '18:00' },
  ])
})

test('a batch with no hours occupies nothing', () => {
  // A batch carrying only a slot — "evening" — has nothing to overlap. Inventing hours
  // for it would refuse saves on a routine that was never written down.
  assert.deepEqual(proposedHours([1, 2], null, '18:00'), [])
  assert.deepEqual(proposedHours([1, 2], '16:00', null), [])
  assert.deepEqual(proposedHours([], null, null), [])
})

test('the clash SQLSTATE is the one the migration raises', () => {
  // Both halves of the grep. 20260811000071 names these five characters next to its
  // `raise`; if either end moves, a real refusal falls through to "could not save".
  assert.equal(TEACHER_CLASH, 'CD002')
  assert.equal(isClashRefusal({ code: 'CD002' }), true)
})

test('any other failure is not a clash', () => {
  // False on anything unrecognised. A true here would tell somebody to move a class to
  // fix an error that had nothing to do with the timetable.
  for (const code of ['23505', '23503', '23514', '42501', 'P0001', 'CD001', '', 'cd002']) {
    assert.equal(isClashRefusal({ code }), false, code)
  }
  for (const junk of [null, undefined, '', 'CD002', 0, 1, true, [], () => 'CD002', NaN]) {
    assert.equal(isClashRefusal(junk), false, String(junk))
  }
  for (const code of [1, {}, ['CD002'], null, undefined]) {
    assert.equal(isClashRefusal({ code }), false, String(code))
  }
})
