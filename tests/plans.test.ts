import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PLANS,
  planFor,
  planName,
  roomFor,
  wouldExceed,
  monthlyBillBdt,
  CENTER_MONTHLY_FLOOR_BDT,
} from '../src/lib/plans.ts'
import { LOCALES } from '../src/lib/i18n/locale.ts'

test('every tier is named in both languages', () => {
  // A tier added with only one name compiles and only fails on the screen of
  // whichever reader was not thought about. The name is on the settings hub, the
  // subject cap card and four plan-limit cards.
  for (const plan of Object.values(PLANS)) {
    for (const locale of LOCALES) {
      assert.notEqual(planName(plan, locale).trim(), '', `${plan.id}/${locale}`)
    }
  }
  assert.equal(planName(PLANS.teacher_free, 'bn'), 'শিক্ষক (ফ্রি)')
  assert.equal(planName(PLANS.teacher_free, 'en'), 'Teacher (Free)')
})

test('an unknown plan id is the free tier, not a crash', () => {
  // The column is text, and a row written by a migration or by hand can say
  // anything. A centre with a typo in it should see the smallest plan, not a
  // white screen.
  for (const id of [null, undefined, '', 'gold', 'teacher_freee']) {
    assert.equal(planFor(id).id, 'teacher_free')
  }
  assert.equal(planFor('center').id, 'center')
})

test('the free plan admits its first batch and refuses its second', () => {
  const free = PLANS.teacher_free
  assert.equal(wouldExceed(free, 'maxBatches', 0), false)
  assert.equal(wouldExceed(free, 'maxBatches', 1), true)
  // null is unlimited, and must never read as zero.
  assert.equal(wouldExceed(PLANS.center, 'maxBatches', 9000), false)
})

test('room is what a bulk import needs, and never negative', () => {
  // The import refuses a paste whole and says how many would have fit, so this
  // number is read aloud to an owner. A negative one would be nonsense, and a
  // centre downgraded below its current roster is exactly how it happens.
  assert.equal(roomFor(PLANS.teacher_free, 'maxStudents', 0), 60)
  assert.equal(roomFor(PLANS.teacher_free, 'maxStudents', 58), 2)
  assert.equal(roomFor(PLANS.teacher_free, 'maxStudents', 60), 0)
  assert.equal(roomFor(PLANS.teacher_free, 'maxStudents', 400), 0)
  assert.equal(roomFor(PLANS.center, 'maxStudents', 400), null)
})

test('a tiny centre still pays the floor, a big one pays per enrollment', () => {
  assert.equal(monthlyBillBdt(PLANS.teacher_free, 40), 0)
  assert.equal(monthlyBillBdt(PLANS.teacher_plus, 40), 300)
  assert.equal(monthlyBillBdt(PLANS.center, 10), CENTER_MONTHLY_FLOOR_BDT)
  assert.equal(monthlyBillBdt(PLANS.center, 200), 1600)
})

test('no tier is sold as a worse product, only a smaller one', () => {
  // The whole pitch, asserted: every feature except multiple branches is on at
  // every price. A cap on scale is a sales conversation; a cap on capability is
  // a teacher who never finds out what the app does.
  for (const plan of Object.values(PLANS)) {
    const { multipleBranches, ...rest } = plan.features
    void multipleBranches
    for (const [feature, on] of Object.entries(rest)) {
      assert.equal(on, true, `${plan.id} withholds ${feature}`)
    }
  }
})
