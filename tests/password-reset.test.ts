import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  RESET_REFUSALS,
  passwordResetRefusal,
  type Membership,
} from '../src/lib/auth/reset.ts'

/*
 * The rule that stops an owner-initiated password reset from being an
 * account-takeover chain. See the head of src/lib/auth/reset.ts for the chain in
 * full; the short version is that linking a teacher deliberately joins an account
 * that already exists, so "a teacher of my centre" and "an account that is mine to
 * reset" are not the same set, and the second one is the only safe one.
 */

const OURS = 'center-ours'
const THEIRS = 'center-theirs'
const READER = 'user-owner'
const TEACHER = 'user-teacher'

/** A resettable teacher, which every case below spoils in exactly one way. */
function target(over: Partial<Parameters<typeof passwordResetRefusal>[0]> = {}) {
  return {
    userId: TEACHER,
    readerId: READER,
    memberships: [{ coaching_center_id: OURS, role: 'teacher' }] as Membership[],
    isPlatformAdmin: false,
    ...over,
  }
}

test('a teacher who only works here can be given a new password', () => {
  assert.equal(passwordResetRefusal(target(), OURS), null)
})

test('an owner of another centre cannot be reset from this one', () => {
  // The takeover. Owner A's number is on their signboard; owner B types it into
  // their own teacher form, confirms the link, and A is now a teacher at B. The
  // membership B cannot see is the one that decides this, which is why the query
  // behind it runs past RLS.
  const refusal = passwordResetRefusal(
    target({
      memberships: [
        { coaching_center_id: THEIRS, role: 'owner' },
        { coaching_center_id: OURS, role: 'teacher' },
      ],
    }),
    OURS,
  )

  assert.equal(refusal, 'notOurs')
})

test('a teacher who also teaches at another centre is nobody here to reset', () => {
  // Common in this market, and refused anyway: signing in as them would read the
  // other centre's batches, marks and guardian numbers. The copy says so instead of
  // offering a button that will not work.
  const refusal = passwordResetRefusal(
    target({
      memberships: [
        { coaching_center_id: OURS, role: 'teacher' },
        { coaching_center_id: THEIRS, role: 'teacher' },
      ],
    }),
    OURS,
  )

  assert.equal(refusal, 'notOurs')
})

test('being staff here is not the same as being a teacher here', () => {
  // A manager holds a manager membership, so the rule refuses them — deliberately.
  // Whoever can reset a manager can reset the person who can edit the payment
  // number every fee reminder points at.
  for (const memberships of [
    [{ coaching_center_id: OURS, role: 'manager' }],
    [{ coaching_center_id: OURS, role: 'owner' }],
    [
      { coaching_center_id: OURS, role: 'teacher' },
      { coaching_center_id: OURS, role: 'manager' },
    ],
  ] as Membership[][]) {
    assert.equal(passwordResetRefusal(target({ memberships }), OURS), 'notOurs')
  }
})

test('a teacher row here whose account belongs only elsewhere is refused', () => {
  const refusal = passwordResetRefusal(
    target({ memberships: [{ coaching_center_id: THEIRS, role: 'teacher' }] }),
    OURS,
  )

  assert.equal(refusal, 'notOurs')
})

test('the platform account is never resettable from a centre screen', () => {
  // Everything else about this target is fine: one teacher membership, this centre.
  // The founder's own account can read every centre in the country, so a teacher
  // form is not allowed to change its password no matter how it got listed.
  assert.equal(
    passwordResetRefusal(target({ isPlatformAdmin: true }), OURS),
    'notOurs',
  )
})

test('your own account is not something you reset from the staff list', () => {
  // Said as its own refusal rather than falling through to "not only this centre's",
  // which is a strange sentence to read about yourself.
  assert.equal(
    passwordResetRefusal(target({ userId: READER }), OURS),
    'self',
  )
})

test('a teacher with no login has no password to change', () => {
  // Checked first: a record without an account is a name in a list, and plenty of
  // part-timers never get one.
  assert.equal(passwordResetRefusal(target({ userId: null }), OURS), 'noAccount')
})

test('a teacher who was switched off has to be switched on first', () => {
  // Switching a teacher off deletes their membership, so this is the ordinary route
  // to an account with none — not an exotic state. Actionable, and safe: an account
  // belonging to another centre still holds that centre's membership.
  assert.equal(passwordResetRefusal(target({ memberships: [] }), OURS), 'inactive')
})

test('a refusal is always one of the four the dictionary answers', () => {
  // The action picks its sentence by this value. A fifth reason invented in the
  // function and not added to the list would reach an owner as a blank line.
  const cases = [
    target(),
    target({ userId: null }),
    target({ userId: READER }),
    target({ memberships: [] }),
    target({ isPlatformAdmin: true }),
    target({ memberships: [{ coaching_center_id: THEIRS, role: 'guardian' }] }),
  ]

  for (const one of cases) {
    const refusal = passwordResetRefusal(one, OURS)
    if (refusal !== null) assert.ok(RESET_REFUSALS.includes(refusal), refusal)
  }

  assert.equal(new Set(RESET_REFUSALS).size, RESET_REFUSALS.length)
})
