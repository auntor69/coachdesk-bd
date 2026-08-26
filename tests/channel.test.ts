import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CHASE_CHANNELS,
  asPreferredChannel,
  chaseOrder,
} from '../src/lib/students/channel.ts'
import type { OutreachChannel } from '../src/lib/supabase/types.ts'

/**
 * The order the three chase buttons come in, and what a form is allowed to set.
 *
 * Two things are being protected here and only one of them is arithmetic. The
 * first is that the layout stays predictable: an owner works down 150 rows with a
 * thumb, so at most one chip may move and the rest must keep their order — a chip
 * whose position depends on the row is a chip that gets tapped by mistake, and a
 * mis-tap both opens the wrong app and writes a row claiming that channel was used.
 *
 * The second is that a preference can never become a permission. sms_opt_out is the
 * only column that decides who may be messaged, and every test below that narrows
 * `available` is really asking "did the preference just put a chip back?".
 */

test('with nobody marked, the chips are in the order they have always been', () => {
  assert.deepEqual(chaseOrder(null), {
    order: ['sms', 'whatsapp', 'call'],
    marked: null,
  })
})

test('the marked channel moves to the front and nothing else moves', () => {
  // Spelled out per channel rather than computed, because the point of the design
  // is that there are exactly three layouts. A test that derived them from the
  // same filter the implementation uses would pass on six.
  assert.deepEqual(chaseOrder('sms').order, ['sms', 'whatsapp', 'call'])
  assert.deepEqual(chaseOrder('whatsapp').order, ['whatsapp', 'sms', 'call'])
  assert.deepEqual(chaseOrder('call').order, ['call', 'sms', 'whatsapp'])
})

test('the marked channel comes back, so one chip can be drawn differently', () => {
  for (const channel of CHASE_CHANNELS) {
    const { order, marked } = chaseOrder(channel)
    assert.equal(marked, channel)
    // The one that moved is the one that looks different. If these two ever came
    // apart, the highlight would be on a button that did not change position.
    assert.equal(order[0], marked)
  }
})

test('every layout still offers all three ways to reach the family', () => {
  for (const preferred of [null, ...CHASE_CHANNELS]) {
    const { order } = chaseOrder(preferred)
    assert.equal(order.length, 3, `dropped a chip for ${preferred}`)
    assert.deepEqual(
      [...order].sort(),
      [...CHASE_CHANNELS].sort(),
      `changed the set of chips for ${preferred}`,
    )
  }
})

test('a family opted out of messages is offered the call, marked or not', () => {
  // What the two chip components pass for sms_opt_out. The preference cannot put a
  // message chip back: if it could, one dropdown on a settings screen would undo
  // the switch beside it and a parent who asked not to be texted would be texted.
  for (const preferred of [null, ...CHASE_CHANNELS] as const) {
    const { order } = chaseOrder(preferred, ['call'])
    assert.deepEqual(order, ['call'], `preference ${preferred} added a chip back`)
  }
})

test('nothing is highlighted when the mark names a chip that is not there', () => {
  // A highlight on a chip nobody rendered is nothing; a highlight that slid onto a
  // different chip would tell the owner this family prefers something they never
  // said. So the answer is null, and the call chip draws as an ordinary chip.
  assert.deepEqual(chaseOrder('sms', ['call']), { order: ['call'], marked: null })
  assert.deepEqual(chaseOrder('whatsapp', ['call']), {
    order: ['call'],
    marked: null,
  })
  assert.deepEqual(chaseOrder('call', ['call']), {
    order: ['call'],
    marked: 'call',
  })
})

test('the caller cannot set the layout by filtering in an odd order', () => {
  // `available` is a set, not a sequence. Two screens compute it from different
  // things — an opt-out on one, an empty week on the other — and the day one of
  // them builds the list backwards the rows must not reshuffle.
  assert.deepEqual(chaseOrder(null, ['call', 'whatsapp', 'sms']).order, [
    'sms',
    'whatsapp',
    'call',
  ])
  assert.deepEqual(chaseOrder('call', ['whatsapp', 'call']).order, [
    'call',
    'whatsapp',
  ])
})

test('a channel the database knows and this file does not is ignored', () => {
  // The outreach_channel enum can gain a value — an automated gateway is the one
  // that has been planned for — and a row written by something newer than this
  // build would arrive here as a channel no screen renders. `as const satisfies`
  // in channel.ts makes that a compile error in the normal case; the cast is how
  // this test reaches the state a *stale deployment* would actually see.
  const future = 'auto_sms' as OutreachChannel
  assert.deepEqual(chaseOrder(future), {
    order: ['sms', 'whatsapp', 'call'],
    marked: null,
  })
})

test('the three real channels are the only things a form can set', () => {
  for (const channel of CHASE_CHANNELS) {
    assert.equal(asPreferredChannel(channel), channel)
  }
})

test('an empty select is nobody having said, not an error', () => {
  // `<option value="">` is how a form says null, and clearing a mark has to be
  // possible: an owner who guessed wrong in week one needs to be able to say so.
  assert.equal(asPreferredChannel(''), null)
})

test('anything else off a public endpoint becomes null', () => {
  // A Server Action is a public HTTP endpoint, so this is whatever the caller put
  // in the FormData. Null rather than an error: there is nothing to tell a user
  // about a value no dropdown can produce, and null is the honest reading of a
  // channel we do not recognise. What must not happen is it reaching an enum
  // column, or being trusted by whatever reads it next.
  for (const value of [
    'auto_sms',
    'SMS',
    'whatsapp ',
    'email',
    'call; drop table students',
    null,
    undefined,
    0,
    1,
    true,
    ['sms'],
    { channel: 'sms' },
    new File([], 'x'),
  ]) {
    assert.equal(asPreferredChannel(value), null, `wrongly accepted: ${String(value)}`)
  }
})
