import test from 'node:test'
import assert from 'node:assert/strict'

import {
  administratorsFrom,
  candidatesFrom,
  isAdminRole,
  parsePerson,
  type MemberRow,
  type Person,
} from '../src/lib/staff/admins.ts'

const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const RUBEL = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const NASRIN = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const STRANGER = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const MIRPUR = '11111111-1111-1111-1111-111111111111'

function person(over: Partial<Person> = {}): Person {
  return {
    id: 'p1',
    from: 'teachers',
    userId: null,
    name: 'Karim',
    role: null,
    phone: '01712345678',
    branchId: null,
    active: true,
    ...over,
  }
}

function member(over: Partial<MemberRow> = {}): MemberRow {
  return {
    id: 'm1',
    userId: OWNER,
    role: 'manager',
    branchId: null,
    capabilities: null,
    ...over,
  }
}

test('owner and manager are the two administrator roles', () => {
  // The pair `members_owner_write` reaches, and nothing else. A teacher membership is
  // what most of these people also hold, so it has to stay out of both lists.
  assert.equal(isAdminRole('owner'), true)
  assert.equal(isAdminRole('manager'), true)
  assert.equal(isAdminRole('teacher'), false)
  assert.equal(isAdminRole('student'), false)
  assert.equal(isAdminRole('guardian'), false)
})

test('a teaching membership is not an appointment', () => {
  // The page filters by role in the query too. Asserted here because the filter is what
  // keeps every teacher in the centre off a list of who can reach the money.
  const admins = administratorsFrom(
    [member({ id: 'm1', role: 'teacher' }), member({ id: 'm2', role: 'manager' })],
    [],
    STRANGER,
  )

  assert.deepEqual(
    admins.map((admin) => admin.memberId),
    ['m2'],
  )
})

test('the name comes from the teacher row when somebody is on both lists', () => {
  // A teacher who also does the books is written down twice, and the caller passes
  // teachers first: their colleagues look for them under the name they teach as.
  const admins = administratorsFrom(
    [member({ userId: RUBEL })],
    [
      person({ id: 't1', from: 'teachers', userId: RUBEL, name: 'Rubel', role: 'Teacher' }),
      person({
        id: 'e1',
        from: 'employees',
        userId: RUBEL,
        name: 'Md. Rubel Hossain',
        role: 'Accountant',
      }),
    ],
    STRANGER,
  )

  assert.equal(admins[0].name, 'Rubel')
  assert.equal(admins[0].job, 'Teacher')
})

test('an administrator in neither list has no name', () => {
  /*
   * The case the screen's `noName` sentence exists for, and it is reachable: `profiles`
   * is self-read, so a membership whose holder was never written down as a teacher or an
   * employee carries a `user_id` and nothing else. A crash or a blank row would both be
   * worse than a line saying somebody is there.
   */
  const admins = administratorsFrom([member({ userId: STRANGER })], [], OWNER)

  assert.equal(admins.length, 1)
  assert.equal(admins[0].name, null)
  assert.equal(admins[0].job, null)
  assert.equal(admins[0].userId, STRANGER)
})

test('a person with no account never names an administrator', () => {
  // Both are unnamed rows in their own way, and joining on a null `user_id` would have
  // pinned the accountant's name onto whichever membership was read first.
  const admins = administratorsFrom(
    [member({ userId: STRANGER })],
    [person({ userId: null, name: 'Nobody' })],
    OWNER,
  )

  assert.equal(admins[0].name, null)
})

test('the reader knows themselves', () => {
  const admins = administratorsFrom(
    [member({ id: 'm1', userId: OWNER, role: 'owner' }), member({ id: 'm2', userId: RUBEL })],
    [],
    OWNER,
  )

  assert.deepEqual(
    admins.map((admin) => admin.isSelf),
    [true, false],
  )
})

test('owners first, then managers, then names, with the unnamed last', () => {
  /*
   * Four rows and every rule in one list. The owner leads whatever their name does; the
   * managers sort by name between themselves; and the manager nobody can name sits at the
   * bottom rather than wherever a null happens to fall.
   */
  const admins = administratorsFrom(
    [
      member({ id: 'm1', userId: STRANGER, role: 'manager' }),
      member({ id: 'm2', userId: NASRIN, role: 'manager' }),
      member({ id: 'm3', userId: OWNER, role: 'owner' }),
      member({ id: 'm4', userId: RUBEL, role: 'manager' }),
    ],
    [
      person({ id: 't1', userId: OWNER, name: 'Zahid' }),
      person({ id: 't2', userId: NASRIN, name: 'Nasrin' }),
      person({ id: 't3', userId: RUBEL, name: 'Rubel' }),
    ],
    OWNER,
  )

  assert.deepEqual(
    admins.map((admin) => admin.name),
    ['Zahid', 'Nasrin', 'Rubel', null],
  )
})

test('the branch pin travels with the membership, not with the job', () => {
  // §6.2's whole distinction between an HQ admin and a branch admin, and it is the
  // membership's column: where somebody sits and what they may read are two questions.
  const admins = administratorsFrom(
    [member({ userId: RUBEL, branchId: MIRPUR })],
    [person({ userId: RUBEL, branchId: null })],
    OWNER,
  )

  assert.equal(admins[0].branchId, MIRPUR)
})

test('somebody who has left is not offered', () => {
  // Their teacher membership was deleted when they were switched off. A manager row
  // would be a second way back in, granted from a screen about promotions.
  const candidates = candidatesFrom(
    [person({ id: 'p1', name: 'Gone', active: false }), person({ id: 'p2', name: 'Here' })],
    [],
  )

  assert.deepEqual(
    candidates.map((candidate) => candidate.name),
    ['Here'],
  )
})

test('an administrator is not offered a second appointment', () => {
  // `unique (coaching_center_id, user_id, role)` would refuse the insert anyway. The
  // useful answer is a shorter list, not an error after the tap.
  const candidates = candidatesFrom(
    [
      person({ id: 'p1', userId: RUBEL, name: 'Rubel' }),
      person({ id: 'p2', userId: NASRIN, name: 'Nasrin' }),
    ],
    [member({ userId: RUBEL, role: 'manager' })],
  )

  assert.deepEqual(
    candidates.map((candidate) => candidate.name),
    ['Nasrin'],
  )
})

test('a teaching membership does not exclude somebody', () => {
  // The ordinary case in a coaching centre: the person being appointed is a teacher, and
  // filtering on any membership rather than an admin one would empty the list.
  const candidates = candidatesFrom(
    [person({ userId: RUBEL, name: 'Rubel' })],
    [member({ userId: RUBEL, role: 'teacher' })],
  )

  assert.equal(candidates.length, 1)
})

test('the value carries the table as well as the id', () => {
  // A teacher and an employee can share an id — both are `gen_random_uuid()` — so the
  // action has to be told which table to read the chosen person back out of.
  const candidates = candidatesFrom(
    [
      person({ id: 'same-id', from: 'teachers', name: 'A' }),
      person({ id: 'same-id', from: 'employees', name: 'B' }),
    ],
    [],
  )

  assert.deepEqual(
    candidates.map((candidate) => candidate.value),
    ['teachers:same-id', 'employees:same-id'],
  )
})

test('a password is asked for only where there is no account', () => {
  const candidates = candidatesFrom(
    [
      person({ id: 'p1', name: 'A', userId: RUBEL }),
      person({ id: 'p2', name: 'B', userId: null, phone: '01712345678' }),
      person({ id: 'p3', name: 'C', userId: null, phone: null }),
    ],
    [],
  )

  assert.deepEqual(
    candidates.map((candidate) => [candidate.needsLogin, candidate.byUsername]),
    [
      [false, false],
      [true, false],
      // No account and no number, so §5.2's username is what gets minted and the form
      // has to say the owner will be reading it out.
      [true, true],
    ],
  )
})

test('an existing account with no number is not a username case', () => {
  // Their login was minted one way or the other months ago and this screen is not
  // changing it, so a missing phone column says nothing about how they sign in.
  const [candidate] = candidatesFrom([person({ userId: RUBEL, phone: null })], [])

  assert.equal(candidate.needsLogin, false)
  assert.equal(candidate.byUsername, false)
})

test('candidates are offered in name order', () => {
  const candidates = candidatesFrom(
    [
      person({ id: 'p1', name: 'Zahid' }),
      person({ id: 'p2', name: 'Amina' }),
      person({ id: 'p3', name: 'Nasrin' }),
    ],
    [],
  )

  assert.deepEqual(
    candidates.map((candidate) => candidate.name),
    ['Amina', 'Nasrin', 'Zahid'],
  )
})

test('a posted person is read as a table and an id', () => {
  assert.deepEqual(parsePerson('teachers:abc'), { from: 'teachers', id: 'abc' })
  assert.deepEqual(parsePerson('employees:abc'), { from: 'employees', id: 'abc' })
})

test('anything else posts nothing', () => {
  /*
   * The one place in the app a string off a form reaches `.from()`, so this is checked
   * against the two literals rather than cast. An unknown table, a missing id and a bare
   * uuid all mean the same thing to the action: nobody was chosen.
   */
  assert.equal(parsePerson('profiles:abc'), null)
  assert.equal(parsePerson('teachers:'), null)
  assert.equal(parsePerson('teachers'), null)
  assert.equal(parsePerson(''), null)
  assert.equal(parsePerson(':abc'), null)
})

test('the id keeps everything after the first colon', () => {
  // Split on the first `:` and not on every one, so a mangled value fails the centre-
  // scoped lookup in the action rather than being quietly trimmed into a valid id here.
  assert.deepEqual(parsePerson('teachers:a:b'), { from: 'teachers', id: 'a:b' })
})
