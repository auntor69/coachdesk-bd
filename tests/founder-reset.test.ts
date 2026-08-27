import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FOUNDER_RESET_REFUSALS,
  founderResetRefusal,
  type FounderResetTarget,
} from '../src/lib/auth/founder-reset.ts'
import type { MemberRole } from '../src/lib/supabase/types.ts'

/*
 * The founder's own reset, which is the other half of a recovery story with no email
 * in it. tests/password-reset.test.ts covers the owner's half and refuses far more
 * than this does; the two are deliberately opposite shapes, and the head of
 * src/lib/auth/founder-reset.ts is where that is argued out.
 */

const FOUNDER = 'user-founder'
const OWNER = 'user-owner'

/** A resettable centre owner, which every case below spoils in exactly one way. */
function target(over: Partial<FounderResetTarget> = {}): FounderResetTarget {
  return {
    userId: OWNER,
    readerId: FOUNDER,
    rolesAtCenter: ['owner'],
    isPlatformAdmin: false,
    ...over,
  }
}

test('a locked-out centre owner can be given a new password', () => {
  // The whole reason this rule exists. Nobody else in the product can do it: the
  // owner's own screen refuses any account holding an owner membership.
  assert.equal(founderResetRefusal(target()), null)
})

test('a manager can be reset too, because nobody else can reset one', () => {
  assert.equal(founderResetRefusal(target({ rolesAtCenter: ['manager'] })), null)
})

test('a teacher who works at two centres passes here and nowhere else', () => {
  /*
   * The case the owner's rule refuses on purpose — owner B resetting a teacher they
   * share with centre C could sign in as them and read C's roster. It has to pass
   * here, because otherwise it passes nowhere and the teacher is locked out for good.
   *
   * Nothing in this target says the account belongs elsewhere as well, and that is
   * the point: unlike the owner's rule, this one never asks.
   */
  assert.equal(founderResetRefusal(target({ rolesAtCenter: ['teacher'] })), null)
})

test('a number nobody has an account on is refused before anything else', () => {
  // Typed by hand off a phone call, so this is the ordinary failure, not the exotic
  // one.
  assert.equal(founderResetRefusal(target({ userId: null })), 'noAccount')
})

test('the founder cannot reset their own account from the panel', () => {
  // Refused ahead of the platform-admin rule, which their account also fails, so the
  // sentence points at /account instead of talking about reading every centre.
  assert.equal(founderResetRefusal(target({ userId: FOUNDER })), 'self')
})

test('a second platform admin cannot be reset either', () => {
  /*
   * The one refusal that is not about typos. A founder session that leaks would
   * otherwise be a way to mint a permanent one, and no platform admin needs this
   * button: knowing your password means /account, and not knowing it means you cannot
   * reach this screen at all.
   */
  assert.equal(
    founderResetRefusal(target({ userId: 'user-other-admin', isPlatformAdmin: true })),
    'platformAdmin',
  )
})

test('an account that is not staff at this centre is refused', () => {
  // A mistyped digit landing on a real account somewhere else on the platform. The
  // reset stops at the centre the founder is actually looking at.
  assert.equal(founderResetRefusal(target({ rolesAtCenter: [] })), 'notStaff')
})

test('a student or guardian is not staff, whatever else is on the account', () => {
  /*
   * Minors' records. A student login is not a thing a founder hands out over the
   * phone, and the centre has no screen to do it either — deliberately, because the
   * decision belongs to whoever knows the family.
   */
  for (const role of ['student', 'guardian'] as MemberRole[]) {
    assert.equal(founderResetRefusal(target({ rolesAtCenter: [role] })), 'notStaff')
  }
})

test('a teacher whose own child studies there is still staff', () => {
  // Both memberships are real and the staff one wins. `some`, not the first row.
  assert.equal(
    founderResetRefusal(target({ rolesAtCenter: ['guardian', 'teacher'] })),
    null,
  )
})

test('every refusal the rule can return is in the published list', () => {
  /*
   * The list is what i18n.test walks to prove each refusal has copy, so a reason
   * returned from the function but missing from the list would reach a founder as a
   * blank line.
   */
  const spoiled: Partial<FounderResetTarget>[] = [
    { userId: null },
    { userId: FOUNDER },
    { isPlatformAdmin: true },
    { rolesAtCenter: [] },
    { rolesAtCenter: ['student'] },
  ]

  for (const over of spoiled) {
    const refusal = founderResetRefusal(target(over))
    if (refusal !== null) assert.ok(FOUNDER_RESET_REFUSALS.includes(refusal), refusal)
  }

  assert.equal(
    new Set(FOUNDER_RESET_REFUSALS).size,
    FOUNDER_RESET_REFUSALS.length,
  )
})
