import test from 'node:test'
import assert from 'node:assert/strict'

import {
  branchChoicesFor,
  elsewhere,
  isHqMember,
  mayChooseBranch,
  postedBranchId,
} from '../src/lib/branches.ts'
import { PLANS } from '../src/lib/plans.ts'

const MIRPUR = '11111111-1111-1111-1111-111111111111'
const CENTER = '22222222-2222-2222-2222-222222222222'
const UTTARA = '33333333-3333-3333-3333-333333333333'

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

test('only the head office of an institution is asked which branch', () => {
  const hq = { branchId: null }
  const pinned = { branchId: MIRPUR }

  // The one reader with a real question: head office is the desk that is not in any
  // building, so the row it writes has no branch to inherit.
  assert.equal(mayChooseBranch({ plan: PLANS.institution, active: hq }), true)

  // Pinned, and therefore not asked. 20260811000054 fills the column from their own
  // membership, and the restrictive policy refuses every other answer they could give.
  assert.equal(mayChooseBranch({ plan: PLANS.institution, active: pinned }), false)

  // Every tier below institution is one building. Keyed on the feature and not on the
  // plan id, so a tier that gains branches later gains the picker with them.
  assert.equal(mayChooseBranch({ plan: PLANS.center, active: hq }), false)
  assert.equal(mayChooseBranch({ plan: PLANS.teacher_plus, active: hq }), false)
  assert.equal(mayChooseBranch({ plan: PLANS.teacher_free, active: hq }), false)
})

/**
 * A client that fails if it is touched.
 *
 * The assertion is not about branches at all, it is about the bill: `branchChoicesFor`
 * is called by four add forms, and three of the four tiers can never have an answer for
 * it. A query fired before the decision would cost every centre in the country a round
 * trip on the screen they use most.
 */
const NO_QUERY = {
  from() {
    throw new Error('queried the database with nothing to ask')
  },
} as unknown as Parameters<typeof branchChoicesFor>[0]

test('nothing to ask costs no query', async () => {
  assert.equal(
    await branchChoicesFor(NO_QUERY, {
      plan: PLANS.center,
      active: { centerId: CENTER, branchId: null },
    }),
    null,
  )

  assert.equal(
    await branchChoicesFor(NO_QUERY, {
      plan: PLANS.institution,
      active: { centerId: CENTER, branchId: MIRPUR },
    }),
    null,
  )
})

test('the head office option is the absence of a branch', () => {
  const posted = (value?: string) => {
    const form = new FormData()
    if (value !== undefined) form.set('branchId', value)
    return postedBranchId(form)
  }

  // The select's first option carries an empty string, and it has to mean what a form
  // with no branch field at all means — file this under no branch.
  assert.equal(posted(''), null)
  assert.equal(posted(), null)

  // A real answer is passed on as it came.
  assert.equal(posted(MIRPUR), MIRPUR)
})

test('a branch that is not a branch reaches the database', () => {
  const form = new FormData()
  form.set('branchId', 'not-a-uuid')

  // Deliberately not validated here. Postgres refuses a uuid column a value like this
  // and the action answers "could not save", which is loud and missing. Swallowing it
  // into `null` would file the row at head office instead, which is quiet and wrong.
  assert.equal(postedBranchId(form), 'not-a-uuid')
})

test('a row in another building is named, and one in this building is not', () => {
  const rows = [
    { name: 'HSC Physics', branchId: MIRPUR },
    { name: 'HSC Chemistry', branchId: UTTARA },
    { name: 'SSC Maths', branchId: MIRPUR },
  ]

  assert.deepEqual(elsewhere(MIRPUR, rows), ['HSC Chemistry'])
  assert.deepEqual(elsewhere(UTTARA, rows), ['HSC Physics', 'SSC Maths'])
  assert.deepEqual(elsewhere(MIRPUR, []), [])
})

test('head office is a building and not a wildcard', () => {
  // The half that is easy to get wrong. A student filed at head office in a Mirpur
  // batch is the same broken pair as the other way round: `app.student_branch` says
  // null, `app.batch_branch` says Mirpur, and Mirpur's manager gets a register with a
  // child in it whose enrolment they cannot see. So null matches null and nothing else.
  assert.deepEqual(elsewhere(null, [{ name: 'HSC Physics', branchId: MIRPUR }]), [
    'HSC Physics',
  ])
  assert.deepEqual(elsewhere(MIRPUR, [{ name: 'Head office batch', branchId: null }]), [
    'Head office batch',
  ])
  assert.deepEqual(elsewhere(null, [{ name: 'Head office batch', branchId: null }]), [])
})
