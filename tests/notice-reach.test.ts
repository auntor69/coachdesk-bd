/**
 * What one notice reaches, and the four ways that count goes wrong.
 *
 * The interesting cases are all duplicates, because a notice is the only message in
 * this product where the same text goes to a list: every other one is built per student
 * and cannot repeat a family by construction. Here a second subject, a sibling, an
 * opted-out guardian and a missing number each bend the number the screen shows, and
 * the screen shows it next to a chip that pastes those numbers into a phone.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  noticeReach,
  chunkPhones,
  CLIPBOARD_RECIPIENTS,
  type AudienceRow,
} from '../src/lib/notices/audience.ts'

/** One enrolment, spelled out so each test can say only what it is about. */
function row(
  batchId: string,
  id: string,
  opts: {
    phone?: string | null
    optOut?: boolean
    guardians?: { phone: string; is_primary: boolean; sms_opt_out: boolean }[]
  } = {},
): AudienceRow {
  return {
    batch_id: batchId,
    students: {
      id,
      guardian_phone: opts.phone === undefined ? '+8801711000001' : opts.phone,
      sms_opt_out: opts.optOut ?? false,
      guardians: opts.guardians ?? null,
    },
  }
}

test('one student in one batch is one number', () => {
  const reach = noticeReach([row('b1', 's1')], ['b1'])

  assert.deepEqual(reach.all.phones, ['+8801711000001'])
  assert.deepEqual(reach.byBatch.b1.phones, ['+8801711000001'])
  assert.equal(reach.all.students, 1)
})

test('two subjects in one batch is still one number', () => {
  // The ordinary case, and the one that would double every count: enrolments are per
  // subject, so a student taking physics and chemistry in the same batch is two rows.
  const reach = noticeReach(
    [row('b1', 's1', { phone: '+8801711000009' }), row('b1', 's1', { phone: '+8801711000009' })],
    ['b1'],
  )

  assert.deepEqual(reach.byBatch.b1.phones, ['+8801711000009'])
  assert.equal(reach.byBatch.b1.students, 1)
})

test('two siblings on one number get one message, and count as two students', () => {
  const reach = noticeReach(
    [row('b1', 's1', { phone: '+8801711000002' }), row('b1', 's2', { phone: '+8801711000002' })],
    ['b1'],
  )

  assert.deepEqual(reach.byBatch.b1.phones, ['+8801711000002'])
  assert.equal(reach.byBatch.b1.students, 2)
})

test('a student in two batches is reached from each of them', () => {
  // Not a duplicate to remove: two batches means two different pieces of news, and a
  // notice about the morning batch is not the one about the evening batch.
  const reach = noticeReach([row('b1', 's1'), row('b2', 's1')], ['b1', 'b2'])

  assert.deepEqual(reach.byBatch.b1.phones, ['+8801711000001'])
  assert.deepEqual(reach.byBatch.b2.phones, ['+8801711000001'])
  // Centre-wide they are one family and get one message.
  assert.deepEqual(reach.all.phones, ['+8801711000001'])
  assert.equal(reach.all.students, 1)
})

test('the guardian row wins over the copy on the student', () => {
  const reach = noticeReach(
    [
      row('b1', 's1', {
        phone: '+8801711000003',
        guardians: [{ phone: '+8801811000003', is_primary: true, sms_opt_out: false }],
      }),
    ],
    ['b1'],
  )

  assert.deepEqual(reach.byBatch.b1.phones, ['+8801811000003'])
})

test('an opted-out student is counted, not messaged', () => {
  const reach = noticeReach([row('b1', 's1', { optOut: true })], ['b1'])

  assert.deepEqual(reach.byBatch.b1.phones, [])
  assert.equal(reach.byBatch.b1.skippedOptedOut, 1)
  assert.equal(reach.byBatch.b1.skippedNoPhone, 0)
})

test('an opted-out primary guardian silences the family too', () => {
  const reach = noticeReach(
    [
      row('b1', 's1', {
        guardians: [{ phone: '+8801811000004', is_primary: true, sms_opt_out: true }],
      }),
    ],
    ['b1'],
  )

  assert.deepEqual(reach.byBatch.b1.phones, [])
  assert.equal(reach.byBatch.b1.skippedOptedOut, 1)
})

test('opted out is reported ahead of having no number', () => {
  // Both are true of this family, and only one of the two sentences leads an owner to
  // go and do something. "Add a number" would be the wrong errand.
  const reach = noticeReach([row('b1', 's1', { phone: null, optOut: true })], ['b1'])

  assert.equal(reach.byBatch.b1.skippedOptedOut, 1)
  assert.equal(reach.byBatch.b1.skippedNoPhone, 0)
})

test('a family with no number at all is counted separately', () => {
  const reach = noticeReach([row('b1', 's1', { phone: null })], ['b1'])

  assert.deepEqual(reach.byBatch.b1.phones, [])
  assert.equal(reach.byBatch.b1.skippedNoPhone, 1)
})

test('a batch nobody is enrolled in still has an entry', () => {
  // Otherwise choosing it in the picker shows nothing at all, which reads as a screen
  // that failed rather than as a batch with nobody in it yet.
  const reach = noticeReach([], ['b1', 'b2'])

  assert.deepEqual(reach.byBatch.b1.phones, [])
  assert.deepEqual(reach.byBatch.b2.phones, [])
  assert.equal(reach.all.students, 0)
})

test('an enrolment whose student did not come back is skipped, not crashed on', () => {
  // RLS can hide the student row while leaving the enrolment readable, and a null embed
  // must not take the whole count down with it.
  const reach = noticeReach([{ batch_id: 'b1', students: null }, row('b1', 's1')], ['b1'])

  assert.deepEqual(reach.byBatch.b1.phones, ['+8801711000001'])
})

test('a to-one embed arriving as an array is read the same way', () => {
  const one = row('b1', 's1')
  const asArray: AudienceRow = {
    batch_id: 'b1',
    students: [one.students as NonNullable<AudienceRow['students']>].flat(),
  }

  assert.deepEqual(noticeReach([asArray], ['b1']).byBatch.b1.phones, ['+8801711000001'])
})

test('an empty list still yields one group, so a caller has something to render', () => {
  assert.deepEqual(chunkPhones([]), [[]])
})

test('a short list is one group and is not split', () => {
  assert.deepEqual(chunkPhones(['a', 'b', 'c']), [['a', 'b', 'c']])
})

test('numbers are split into groups a handset will actually accept', () => {
  const phones = Array.from({ length: 45 }, (_, i) => `+88017110000${i}`)
  const groups = chunkPhones(phones)

  assert.equal(groups.length, 3)
  assert.equal(groups[0].length, CLIPBOARD_RECIPIENTS)
  assert.equal(groups[1].length, CLIPBOARD_RECIPIENTS)
  assert.equal(groups[2].length, 45 - 2 * CLIPBOARD_RECIPIENTS)
  // Every number lands in exactly one group, in order — the chip labels say "1–20"
  // and "21–40", and an owner pasting eight times is trusting that arithmetic.
  assert.deepEqual(groups.flat(), phones)
})

test('a list exactly one group long is not followed by an empty one', () => {
  const phones = Array.from({ length: CLIPBOARD_RECIPIENTS }, (_, i) => `n${i}`)

  assert.deepEqual(chunkPhones(phones), [phones])
})
