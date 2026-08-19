import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  pickActive,
  strongestPerCenter,
  ACTIVE_CENTER_COOKIE,
} from '../src/lib/auth/active-center.ts'

/** Two centres one person really belongs to, and one they do not. */
const UTTARA = { centerId: 'c-uttara', centerName: 'উত্তরা আইডিয়াল কোচিং' }
const UDVASH = { centerId: 'c-udvash', centerName: 'UDVASH' }
const MINE = [UTTARA, UDVASH]

/** The role ranks session.ts passes in, so these tests exercise the real order. */
const RANK: Record<string, number> = {
  owner: 40,
  manager: 30,
  teacher: 20,
  guardian: 10,
  student: 0,
}
const rankOf = (m: { role: string }) => RANK[m.role]

test('a person with two roles at one centre gets one entry for it', () => {
  // The demo account, and the bug that found this: the owner of উত্তরা is also
  // its one teacher, so center_members holds two rows — the table is unique on
  // (centre, user, role) on purpose. The switcher listed the centre twice, both
  // entries marked "you are here".
  const rows = [
    { centerId: 'c-uttara', role: 'teacher' },
    { centerId: 'c-uttara', role: 'owner' },
  ]
  assert.deepEqual(strongestPerCenter(rows, rankOf), [
    { centerId: 'c-uttara', role: 'owner' },
  ])
})

test('the strongest role wins whichever order the rows arrive in', () => {
  // Nothing orders the query, so both orders are what production returns.
  const weakFirst = [
    { centerId: 'c-a', role: 'student' },
    { centerId: 'c-a', role: 'manager' },
  ]
  assert.deepEqual(strongestPerCenter(weakFirst, rankOf), [
    { centerId: 'c-a', role: 'manager' },
  ])
  assert.deepEqual(strongestPerCenter([...weakFirst].reverse(), rankOf), [
    { centerId: 'c-a', role: 'manager' },
  ])
})

test('centres come back strongest first, so the default lands on the one they run', () => {
  const rows = [
    { centerId: 'c-teach-here', role: 'teacher' },
    { centerId: 'c-own-this', role: 'owner' },
  ]
  assert.deepEqual(
    strongestPerCenter(rows, rankOf).map((m) => m.centerId),
    ['c-own-this', 'c-teach-here'],
  )
})

test('distinct centres are all kept', () => {
  // The other half: collapsing by centre must not collapse by role.
  const rows = [
    { centerId: 'c-a', role: 'owner' },
    { centerId: 'c-b', role: 'owner' },
    { centerId: 'c-c', role: 'owner' },
  ]
  assert.equal(strongestPerCenter(rows, rankOf).length, 3)
  assert.deepEqual(strongestPerCenter([], rankOf), [])
})

test('a chosen centre wins over the default', () => {
  assert.equal(pickActive(MINE, 'c-udvash'), UDVASH)
  assert.equal(pickActive(MINE, 'c-uttara'), UTTARA)
})

test('no choice yet falls back to the first membership', () => {
  // Sorted highest-role-first upstream, so "first" means the centre they run
  // rather than one they teach at — which is where an owner wants to land.
  assert.equal(pickActive(MINE, undefined), UTTARA)
  assert.equal(pickActive(MINE, null), UTTARA)
  assert.equal(pickActive(MINE, ''), UTTARA)
})

test('a centre the reader does not belong to is not honoured', () => {
  // The whole security property. A cookie is client-writable, so this string can
  // be anything: a stale choice after a membership was revoked, or one typed into
  // devtools. Either way the answer is a centre they really have.
  for (const forged of ['c-somebody-else', 'null', '../c-uttara', 'c-uttara ']) {
    assert.equal(pickActive(MINE, forged), UTTARA)
  }
})

test('the answer is always one of the memberships, never the cookie', () => {
  // Stated as its own test because it is the invariant the paragraph above rests
  // on: nothing from the browser can become session.active.centerId. A future
  // version that "helpfully" synthesised a membership from the cookie would keep
  // every other test in this file passing.
  const answer = pickActive(MINE, 'c-udvash')
  assert.ok(MINE.includes(answer!))
  assert.equal(pickActive([], 'c-udvash'), null)
})

test('somebody with no centre at all has no active centre', () => {
  // A fresh signup mid-onboarding. Returning undefined here would put
  // `undefined` where every screen expects `Membership | null`.
  assert.equal(pickActive([], undefined), null)
  assert.equal(pickActive([], 'anything'), null)
})

test('one membership needs no choice, and a stale cookie cannot break it', () => {
  // The common case, and the one a regression would be quietest in: almost every
  // centre has a single owner with a single centre, so a bug that dropped them to
  // null would look like "the app logged me out" and not like a scoping change.
  assert.equal(pickActive([UTTARA], undefined), UTTARA)
  assert.equal(pickActive([UTTARA], 'c-udvash'), UTTARA)
})

test('the cookie name is stable', () => {
  // Renaming it silently returns every reader to their default centre. Worth a
  // deliberate decision and a failing test, not a rename-symbol.
  assert.equal(ACTIVE_CENTER_COOKIE, 'cd_center')
})
