import test from 'node:test'
import assert from 'node:assert/strict'

import { isHqMember } from '../src/lib/branches.ts'

const MIRPUR = '11111111-1111-1111-1111-111111111111'

test('the head office is a null branch', () => {
  // 20260811000053's rule, from the app's side. `app.branch_ok` reads a null
  // membership branch as the whole organisation and a uuid as one location, and the
  // branches screen decides what to draw from the same distinction.
  assert.equal(isHqMember({ branchId: null }), true)
  assert.equal(isHqMember({ branchId: MIRPUR }), false)
})

test('an empty string is not the head office', () => {
  // Nothing produces one today — `branchId` comes off a uuid column — but the whole
  // point of the helper is that the null is load-bearing, and `!member.branchId`
  // would have made every falsy value the head office.
  assert.equal(isHqMember({ branchId: '' }), false)
})
