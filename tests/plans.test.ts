import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PLANS,
  planFor,
  planName,
  roomFor,
  wouldExceed,
  capIsQuota,
  hasStaff,
  overStaffSeats,
  has,
  monthlyBillBdt,
  studentChargeBdt,
  teacherChargeBdt,
  branchChargeBdt,
  branchOpeningRefusal,
  teacherSeatOpeningRefusal,
  nextBranchCostBdt,
  STUDENT_BANDS,
  CENTER_MONTHLY_FLOOR_BDT,
  CENTER_FREE_TEACHER_SEATS,
  CENTER_TEACHER_SEAT_BDT,
  INSTITUTION_MONTHLY_FLOOR_BDT,
  INSTITUTION_INCLUDED_BRANCHES,
  INSTITUTION_BRANCH_BDT,
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
})

test('the centre tiers bound batches and subjects, far above any real centre', () => {
  // These were null — "unlimited" — and that was a claim nothing was built against:
  // no screen, index or export was designed for a centre with nine thousand batches,
  // and a paste or a script is all it takes. A centre pays by student, so there is no
  // revenue reason to bound batches and there is still a reason to bound them.
  for (const plan of [PLANS.center, PLANS.institution]) {
    assert.equal(wouldExceed(plan, 'maxBatches', 99), false, plan.id)
    assert.equal(wouldExceed(plan, 'maxBatches', 100), true, plan.id)
    assert.equal(wouldExceed(plan, 'maxSubjects', 199), false, plan.id)
    assert.equal(wouldExceed(plan, 'maxSubjects', 200), true, plan.id)

    // Where the ceiling sits is the whole difference between a guardrail and a limit
    // somebody was sold. Well clear of four batches a day for a month, and of every
    // subject a school board recognises — a centre that reaches either is a
    // conversation, not a number to raise quietly.
    assert.ok((plan.maxBatches ?? 0) >= 60, `${plan.id} bounds batches inside real use`)
    assert.ok((plan.maxSubjects ?? 0) >= 100, `${plan.id} bounds subjects inside real use`)

    // And the caps a per-student tier must NOT carry. A number on any of these three
    // would refuse a row the centre has already been billed for — students come from
    // studentCeiling and what they bought, teachers are charged by the seat, and a
    // per-batch cap would price a lecture hall the same as a section and then refuse
    // to hold it.
    assert.equal(plan.maxStudents, null, `${plan.id} caps the students it bills for`)
    assert.equal(plan.maxTeachers, null, `${plan.id} caps the teachers it bills for`)
    assert.equal(plan.maxStudentsPerBatch, null, plan.id)
  }
})

test('a guardrail is enforced but not shown as a quota', () => {
  // The distinction the three screens depend on. They used to ask `=== null`, which
  // was right only while the centre tiers claimed to be unlimited — so the moment the
  // ceiling existed, the settings hub would have started telling a paying owner their
  // plan was "100 batches", and the batch and subject lists would have counted them
  // towards a number nobody sold them.
  for (const plan of [PLANS.center, PLANS.institution]) {
    assert.equal(capIsQuota(plan, 'maxBatches'), false, plan.id)
    assert.equal(capIsQuota(plan, 'maxSubjects'), false, plan.id)
    // Enforced all the same, which is the half that makes this a display decision
    // rather than a retreat.
    assert.equal(wouldExceed(plan, 'maxBatches', 100), true, plan.id)
  }

  // On a teacher tier every cap IS the pitch — "free means one batch" is the sentence
  // the tier is sold with, and hiding it would be hiding the reason to upgrade.
  for (const plan of [PLANS.teacher_free, PLANS.teacher_plus]) {
    for (const key of ['maxBatches', 'maxStudents', 'maxSubjects', 'maxTeachers'] as const) {
      assert.equal(capIsQuota(plan, key), true, `${plan.id}/${key}`)
    }
  }

  // Nothing that has no cap is a quota, on any tier. A screen asking about a null
  // limit must get false rather than a claim it cannot render.
  assert.equal(capIsQuota(PLANS.center, 'maxStudents'), false)
  assert.equal(capIsQuota(PLANS.teacher_free, 'maxStudentsPerBatch'), true)
})

test('room is what a bulk import needs, and never negative', () => {
  // The import refuses a paste whole and says how many would have fit, so this
  // number is read aloud to an owner. A negative one would be nonsense, and a
  // centre downgraded below its current roster is exactly how it happens.
  assert.equal(roomFor(PLANS.teacher_free, 'maxStudents', 0), 30)
  assert.equal(roomFor(PLANS.teacher_free, 'maxStudents', 28), 2)
  assert.equal(roomFor(PLANS.teacher_free, 'maxStudents', 30), 0)
  assert.equal(roomFor(PLANS.teacher_free, 'maxStudents', 400), 0)
  // Null on a centre, and it does not mean unlimited there — it means this table is
  // not what answers. Which is why no screen asks this about students any more: the
  // import used to, read the null as "no ceiling", and offered a paste of three
  // hundred names to a centre with seventy-nine places. `studentRoom` is what both
  // the screen and the action ask now, and it is covered in plan-allowances.test.ts.
  assert.equal(roomFor(PLANS.center, 'maxStudents', 400), null)
})

test('the tiers do not overlap, which is what makes the prices defensible', () => {
  // The pricing bug this replaced. Teacher Pro used to hold 300 students, which
  // put a teacher's ceiling above a small centre's floor: the same 250-student
  // customer could stand in either tier and pay either ৳499 or several thousand.
  // Pro's cap must stay at or below the point where a centre plan starts making
  // sense, or the gap needs justifying with features instead of scale.
  assert.ok(
    PLANS.teacher_plus.maxStudents !== null
      && PLANS.teacher_plus.maxStudents <= 150,
    'Teacher Pro reaches into centre territory',
  )
  // And the wall itself: one teacher, at any price. A purchasable second seat
  // would rebuild the overlap from the other side.
  assert.equal(PLANS.teacher_plus.maxTeachers, 1)
  assert.equal(hasStaff(PLANS.teacher_plus), false)
})

test('both student caps bite, because they stop different things', () => {
  // A total cap alone would let 150 students sit in one batch, which is a lecture
  // hall rather than the five-batches-of-thirty the tier is sold as.
  const pro = PLANS.teacher_plus
  assert.equal(wouldExceed(pro, 'maxStudentsPerBatch', 29), false)
  assert.equal(wouldExceed(pro, 'maxStudentsPerBatch', 30), true)
  assert.equal(wouldExceed(pro, 'maxStudents', 149), false)
  assert.equal(wouldExceed(pro, 'maxStudents', 150), true)
  // And the caps have to agree with the pitch: five batches at thirty each.
  assert.equal(
    (pro.maxBatches ?? 0) * (pro.maxStudentsPerBatch ?? 0),
    pro.maxStudents,
  )
})

test('the free tier withholds exactly what sells Pro, and nothing else', () => {
  // The paywall, asserted. Every tier used to carry every feature, which meant a
  // paid teacher tier would have sold nothing the free one already did.
  const free = PLANS.teacher_free

  // The hook. Gating any of these would mean a teacher never finds out what the
  // product does, and teachers are how we reach centre owners.
  for (const feature of ['attendance', 'exams', 'feeTracking', 'manualMessaging'] as const) {
    assert.equal(has(free, feature), true, `free withholds ${feature}`)
  }

  // What Pro is for.
  for (const feature of ['printedReceipts', 'exportReports', 'parentSummary', 'buySmsCredits'] as const) {
    assert.equal(has(free, feature), false, `free gives away ${feature}`)
    assert.equal(has(PLANS.teacher_plus, feature), true, `Pro withholds ${feature}`)
  }
})

test('every tier above free is a superset of the one below it', () => {
  // A ladder, not four unrelated bundles: an upgrade must never take something
  // away, or a centre that grows discovers a feature it used to have. Asserted
  // over the whole flag set so a new flag cannot be added to one tier only.
  const ladder = [PLANS.teacher_free, PLANS.teacher_plus, PLANS.center, PLANS.institution]

  for (let i = 1; i < ladder.length; i++) {
    const lower = ladder[i - 1]
    const upper = ladder[i]
    for (const [feature, on] of Object.entries(lower.features)) {
      if (!on) continue
      assert.equal(
        upper.features[feature as keyof typeof upper.features],
        true,
        `${upper.id} takes ${feature} away from ${lower.id}`,
      )
    }
  }
})

test('no tier promises an automated SMS it cannot send', () => {
  // Not a pricing decision — a factual one. No sender ID exists, so no gateway
  // exists, so an allowance here would be a counter decrementing against nothing
  // while a teacher is told the parent was messaged. The day an aggregator is
  // live this test is what says which line to change.
  for (const plan of Object.values(PLANS)) {
    assert.equal(plan.monthlySmsCredits, 0, `${plan.id} promises credits`)
    assert.equal(has(plan, 'automatedSms'), false, `${plan.id} promises automation`)
  }
})

test('tap-to-send is on every tier, including free', () => {
  // It costs us nothing, needs no licence, and cannot be switched off by a
  // regulator — so it is the one thing the free tier gets without limit. It is
  // also the whole messaging story until an aggregator exists.
  for (const plan of Object.values(PLANS)) {
    assert.equal(has(plan, 'manualMessaging'), true, `${plan.id} cannot message`)
  }
})

test('the student bands are marginal, so the bill never falls as a centre grows', () => {
  // The pricing-page bug this shape prevents. With a flat rate per band, a centre
  // at 301 students (301 × ৳12 = ৳3,612) would pay less than one at 300
  // (300 × ৳18 = ৳5,400) — a price list that makes the founder look like they
  // cannot count, and an owner who discovers it will enrol a phantom student.
  //
  // Walked one student at a time across every boundary, because a band arithmetic
  // error is invisible in a spot check and obvious here.
  let previous = 0
  for (let n = 1; n <= 700; n++) {
    const bill = studentChargeBdt(n)
    assert.ok(bill > previous, `bill fell or flattened at ${n} students`)
    previous = bill
  }
})

test('each band charges only the students inside it', () => {
  // The first band, exactly.
  assert.equal(studentChargeBdt(100), 100 * 25)
  // One over: the 101st student is charged at the second band's rate, not the
  // whole roster re-rated.
  assert.equal(studentChargeBdt(101), 100 * 25 + 18)
  // The stated example from the pricing conversation: 250 students.
  assert.equal(studentChargeBdt(250), 100 * 25 + 150 * 18)
  // Across three bands.
  assert.equal(studentChargeBdt(400), 100 * 25 + 200 * 18 + 100 * 12)
  // Into the open-ended last band.
  assert.equal(studentChargeBdt(900), 100 * 25 + 200 * 18 + 300 * 12 + 300 * 8)
})

test('a zero or nonsense roster costs nothing rather than NaN', () => {
  // These figures reach a pricing calculator an owner is typing into, and NaN on
  // a price is worse than any number.
  for (const n of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(studentChargeBdt(n), 0, `${n} students`)
    assert.equal(teacherChargeBdt(n), 0, `${n} teachers`)
  }
})

test('the bands are ordered and taper, which is the only reason the taper works', () => {
  // Guards the table rather than the arithmetic: a band inserted out of order, or
  // one whose rate rises, would compute a plausible-looking bill that contradicts
  // the pitch. The last band must be open-ended or a large centre bills as zero
  // past its ceiling.
  let previousUpTo = 0
  for (const [i, band] of STUDENT_BANDS.entries()) {
    const last = i === STUDENT_BANDS.length - 1
    if (last) {
      assert.equal(band.upTo, null, 'the last band must be open-ended')
    } else {
      assert.ok(band.upTo !== null && band.upTo > previousUpTo, `band ${i} is out of order`)
      assert.ok(band.rateBdt > STUDENT_BANDS[i + 1].rateBdt, `band ${i} does not taper`)
      previousUpTo = band.upTo
    }
  }
})

test('two teacher seats are included and the rest are charged', () => {
  assert.equal(teacherChargeBdt(1), 0)
  assert.equal(teacherChargeBdt(CENTER_FREE_TEACHER_SEATS), 0)
  assert.equal(teacherChargeBdt(3), CENTER_TEACHER_SEAT_BDT)
  assert.equal(teacherChargeBdt(30), 28 * CENTER_TEACHER_SEAT_BDT)
})

test('a small centre pays the floor, and its staff on top of it', () => {
  assert.equal(monthlyBillBdt(PLANS.teacher_free, 40), 0)
  assert.equal(monthlyBillBdt(PLANS.teacher_plus, 40), 499)

  // Fifty students bills ৳1,250 of students, which is under the floor. The floor
  // is the base model and nothing goes under it.
  assert.equal(monthlyBillBdt(PLANS.center, 50), CENTER_MONTHLY_FLOOR_BDT)

  // The floor applies to the student charge, not to the total: a small centre that
  // hires a sixth teacher pays the floor PLUS those seats, rather than having the
  // seats quietly swallowed by it.
  assert.equal(
    monthlyBillBdt(PLANS.center, 50, 6),
    CENTER_MONTHLY_FLOOR_BDT + 4 * CENTER_TEACHER_SEAT_BDT,
  )

  // And a centre past the floor pays what the bands say, plus seats.
  assert.equal(monthlyBillBdt(PLANS.center, 250, 6), 5200 + 400)
})

test('an institution gets three branches and pays for the fourth', () => {
  // Three, because one branch is a centre and two is a centre with a second room. The
  // customer this tier was drawn for has three buildings, and charging them for the
  // third would make the tier's own headline a lie.
  assert.equal(branchChargeBdt(PLANS.institution, 0), 0)
  assert.equal(branchChargeBdt(PLANS.institution, INSTITUTION_INCLUDED_BRANCHES), 0)
  assert.equal(branchChargeBdt(PLANS.institution, 4), INSTITUTION_BRANCH_BDT)
  assert.equal(branchChargeBdt(PLANS.institution, 10), 7 * INSTITUTION_BRANCH_BDT)
})

test('the add-a-branch form names what the next one costs, not what all of them cost', () => {
  // The marginal figure, because §3.7 makes the form say what the signature costs and
  // an owner with six branches is not being asked to approve ৳2,250 again.
  assert.equal(nextBranchCostBdt(PLANS.institution, 6), INSTITUTION_BRANCH_BDT)

  // Free while the included three are not used up, and free is the answer for the
  // third itself. A form that always printed ৳750 would invent a charge for the centre
  // opening its second building.
  for (let n = 0; n < INSTITUTION_INCLUDED_BRANCHES; n += 1) {
    assert.equal(nextBranchCostBdt(PLANS.institution, n), 0, `${n} branches`)
  }
  assert.equal(nextBranchCostBdt(PLANS.institution, INSTITUTION_INCLUDED_BRANCHES), INSTITUTION_BRANCH_BDT)

  // And it agrees with the bill rather than restating its rule: the difference between
  // two totals is what the sentence promises the owner they are about to owe.
  assert.equal(
    nextBranchCostBdt(PLANS.institution, 4),
    monthlyBillBdt(PLANS.institution, 200, 2, 5) - monthlyBillBdt(PLANS.institution, 200, 2, 4),
  )

  // Nothing on a tier that has no branches to add. Correct without being useful —
  // those tiers have no form to print it on.
  assert.equal(nextBranchCostBdt(PLANS.center, 9), 0)
})

test('past the included three, a building needs money on the balance', () => {
  const money = 250_000

  // The three the tier includes change no line on any bill, so they are never asked
  // about money — not even on the signup, which holds days rather than taka (§4.3).
  for (let n = 0; n < INSTITUTION_INCLUDED_BRANCHES; n += 1) {
    assert.equal(
      branchOpeningRefusal(PLANS.institution, { activeBranches: n, balancePoisha: 0 }),
      null,
      `${n} buildings`,
    )
  }

  // The fourth is a line on the bill, and the bill comes off the balance. This is the
  // three-day trial the owner found: writable, owing nothing, holding nothing.
  assert.equal(
    branchOpeningRefusal(PLANS.institution, {
      activeBranches: INSTITUTION_INCLUDED_BRANCHES,
      balancePoisha: 0,
    }),
    'needs_money',
  )

  // And money is the whole of what was missing, however little of it there is. The burn
  // prices the building from the day it opens, so an organisation that funds one badly
  // takes itself read-only the next morning rather than being refused here.
  assert.equal(
    branchOpeningRefusal(PLANS.institution, {
      activeBranches: INSTITUTION_INCLUDED_BRANCHES,
      balancePoisha: 1,
    }),
    null,
  )
  assert.equal(
    branchOpeningRefusal(PLANS.institution, {
      activeBranches: 40,
      balancePoisha: money,
    }),
    null,
  )

  // NULL IS NOT MONEY. A balance nobody could read is a refusal, the same direction
  // every unreadable figure in this product takes — and a debt is not money either.
  assert.equal(
    branchOpeningRefusal(PLANS.institution, {
      activeBranches: INSTITUTION_INCLUDED_BRANCHES,
      balancePoisha: null,
    }),
    'needs_money',
  )
  assert.equal(
    branchOpeningRefusal(PLANS.institution, {
      activeBranches: INSTITUTION_INCLUDED_BRANCHES,
      balancePoisha: -1,
    }),
    'needs_money',
  )
})

test('one tier sells buildings, and that is the sentence the database repeats', () => {
  // `app.guard_branch_ceiling()` names `institution` rather than reading this flag,
  // because there is no plan table in SQL — the same hardcode `settle_billing` bills
  // with. This is the assertion that keeps the two honest: a second tier gaining the
  // feature would be refused in the app and allowed by the trigger.
  assert.deepEqual(
    Object.values(PLANS)
      .filter((plan) => plan.features.multipleBranches)
      .map((plan) => plan.id),
    ['institution'],
  )

  // And no amount of money buys them elsewhere — a Coaching Center is one building by
  // price and by shape (§2.4), so the answer is a tier and not a top-up.
  for (const plan of [PLANS.teacher_free, PLANS.teacher_plus, PLANS.center]) {
    assert.equal(
      branchOpeningRefusal(plan, { activeBranches: 0, balancePoisha: 500_000 }),
      'no_branches',
      plan.id,
    )
  }
})

test('past the two included seats, a teacher needs money on the balance', () => {
  const money = 250_000

  // The two a centre includes change no line on any bill, so they are never asked about
  // money — which is exactly why a three-day trial may record its staff. This is the same
  // sentence `branchOpeningRefusal` states three buildings over, and the reason the two
  // are tested apart is that neither tier's number is the other's.
  for (const plan of [PLANS.center, PLANS.institution]) {
    for (let n = 0; n < CENTER_FREE_TEACHER_SEATS; n += 1) {
      assert.equal(
        teacherSeatOpeningRefusal(plan, { activeTeachers: n, balancePoisha: 0 }),
        null,
        `${plan.id}: ${n} seats`,
      )
    }

    // The third is ৳100 a month, and the bill comes off the balance: the trial the owner
    // found, writable, owing nothing, holding nothing.
    assert.equal(
      teacherSeatOpeningRefusal(plan, {
        activeTeachers: CENTER_FREE_TEACHER_SEATS,
        balancePoisha: 0,
      }),
      'needs_money',
      plan.id,
    )

    // And money is the whole of what was missing, however little of it there is: the burn
    // prices the seat from the day it is taken, so an organisation that funds one badly
    // takes itself read-only the next morning rather than being refused here.
    assert.equal(
      teacherSeatOpeningRefusal(plan, {
        activeTeachers: CENTER_FREE_TEACHER_SEATS,
        balancePoisha: 1,
      }),
      null,
      plan.id,
    )
    assert.equal(
      teacherSeatOpeningRefusal(plan, { activeTeachers: 40, balancePoisha: money }),
      null,
      plan.id,
    )

    // NULL IS NOT MONEY, and a debt is not money either — the direction every unreadable
    // figure in this product takes.
    assert.equal(
      teacherSeatOpeningRefusal(plan, {
        activeTeachers: CENTER_FREE_TEACHER_SEATS,
        balancePoisha: null,
      }),
      'needs_money',
      plan.id,
    )
    assert.equal(
      teacherSeatOpeningRefusal(plan, {
        activeTeachers: CENTER_FREE_TEACHER_SEATS,
        balancePoisha: -1,
      }),
      'needs_money',
      plan.id,
    )
  }

  // THE TEACHER TIERS ARE NOT THIS RULE, and reading `maxTeachers` backwards would refuse a
  // teacher their own seat: their wall is a hard one seat, answered by `limitRefusal` with a
  // sentence of its own, and `app.guard_teacher_ceiling` refuses it in the database with
  // `CD003`. So this function has nothing to say on those tiers at all, at any count, funded
  // or not.
  for (const plan of [PLANS.teacher_free, PLANS.teacher_plus]) {
    assert.equal(
      teacherSeatOpeningRefusal(plan, { activeTeachers: 9, balancePoisha: 0 }),
      null,
      plan.id,
    )
  }

  /*
   * AND EVERY TIER HAS ONE OF THE TWO ANSWERS, which is the invariant that makes the first
   * line of this function safe. `limitRefusal` returns early on a null cap, so a null cap is
   * a dimension nothing else in the app is watching: this rule is the only thing standing
   * there, and it is a money test rather than a number. A tier added with `maxTeachers: null`
   * and a flat price would therefore sell unlimited staff for a fixed fee — asserted here so
   * that tier fails in the suite rather than on a customer's roster.
   */
  for (const plan of Object.values(PLANS)) {
    assert.equal(
      plan.maxTeachers === null,
      plan.pricing === 'per_student',
      `${plan.id}: a null seat cap belongs to a per-student tier and nowhere else`,
    )
  }
})

test('a tier without branches is never charged for one', () => {
  // The downgrade, again: branch rows outlive the plan that bought them exactly as
  // teacher rows do. An institution moved down to `center` keeps four branch rows, and
  // billing them for a feature they can no longer use is the one outcome nobody could
  // defend on a phone call. Keyed on the feature flag, so this holds for any future
  // tier that lacks it too.
  for (const plan of [PLANS.teacher_free, PLANS.teacher_plus, PLANS.center]) {
    assert.equal(branchChargeBdt(plan, 9), 0, plan.id)
  }

  // And through the bill, which is where it would actually have been charged.
  assert.equal(monthlyBillBdt(PLANS.center, 50, 0, 9), CENTER_MONTHLY_FLOOR_BDT)
})

test('the bill adds branches to students and seats, not instead of them', () => {
  // Three parts, and the floor applies only to the first. An institution with four
  // branches and six teachers pays its own floor, plus the four seats past the two
  // included, plus the one branch past the three — a branch must not be swallowed by
  // the floor any more than a teacher seat is.
  assert.equal(
    monthlyBillBdt(PLANS.institution, 50, 6, 4),
    INSTITUTION_MONTHLY_FLOOR_BDT + 4 * CENTER_TEACHER_SEAT_BDT + INSTITUTION_BRANCH_BDT,
  )

  // One branch by default, not zero: every organisation has a building, and a default
  // of zero would have quietly given the first one away twice.
  assert.equal(monthlyBillBdt(PLANS.institution, 50), INSTITUTION_MONTHLY_FLOOR_BDT)
  assert.equal(
    monthlyBillBdt(PLANS.institution, 50, 0, 1),
    monthlyBillBdt(PLANS.institution, 50),
  )

  // A nonsense count costs nothing rather than NaN — these figures reach a calculator
  // an owner is typing into.
  for (const n of [-3, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(branchChargeBdt(PLANS.institution, n), 0, `${n} branches`)
  }

  // And a teacher tier reaches none of it, at any size.
  assert.equal(monthlyBillBdt(PLANS.teacher_plus, 900, 9, 9), PLANS.teacher_plus.priceBdt)
  assert.equal(monthlyBillBdt(PLANS.teacher_free, 900, 9, 9), 0)
})

test('the bill counts students, not enrollments', () => {
  // The correction this replaced, asserted so it cannot come back. The old
  // signature took `activeEnrollments`, and a centre charges by subject — so a
  // student taking Physics, Chemistry and Maths was billed three times. At ৳25
  // that is ৳75 for one child, which is not a number anybody was quoted.
  //
  // One student in three subjects and one student in one subject cost the same,
  // because they are one student. Were the bill still per-enrollment, three
  // subjects would treble it.
  assert.equal(studentChargeBdt(1), 25)
  assert.equal(studentChargeBdt(3), 75)
  assert.notEqual(studentChargeBdt(3), 3 * 3 * 25)
})

test('staff belongs to the centre tiers, not the solo ones', () => {
  // The product decision, asserted: a teacher tier is one person, and the whole
  // idea of colleagues — a list of them, permissions per person, who may send
  // SMS — arrives with the centre tiers.
  assert.equal(hasStaff(PLANS.teacher_free), false)
  assert.equal(hasStaff(PLANS.teacher_plus), false)
  assert.equal(hasStaff(PLANS.center), true)
  assert.equal(hasStaff(PLANS.institution), true)
})

test('hasStaff is not the teacher count check', () => {
  // The bug this replaced. bootstrap_center only writes the owner's own teacher
  // row in teacher mode, so a centre that signed up as a centre has zero teacher
  // rows — and zero is under a cap of one, so the count check said "room for one
  // more" and a free plan could take on staff.
  assert.equal(wouldExceed(PLANS.teacher_free, 'maxTeachers', 0), false)
  assert.equal(hasStaff(PLANS.teacher_free), false)

  // And the converse: an unlimited plan is never at its cap, which is the same
  // answer for a different reason. Anything reading only one of these two is
  // wrong on one of the four tiers.
  assert.equal(wouldExceed(PLANS.center, 'maxTeachers', 500), false)
  assert.equal(hasStaff(PLANS.center), true)
})

test('a plan with staff can hold more than the one teacher', () => {
  // Guards the definition rather than the current numbers: whatever a future
  // multi-teacher tier caps at, "has staff" has to mean room for someone
  // besides the owner, or the screens offer an add button the action refuses.
  for (const plan of Object.values(PLANS)) {
    if (!hasStaff(plan)) continue
    assert.equal(
      wouldExceed(plan, 'maxTeachers', 1),
      false,
      `${plan.id} claims staff but has no room for a second teacher`,
    )
  }
})

test('overStaffSeats is about what is already there, not room for one more', () => {
  // The pair that the settings hub and the teacher list both read, and the reason
  // they cannot read wouldExceed instead. A teacher tier with its one teacher is
  // full — no room for another — and it is not over anything: that centre is
  // exactly what it paid for and gets the card explaining the plan.
  assert.equal(wouldExceed(PLANS.teacher_plus, 'maxTeachers', 1), true)
  assert.equal(overStaffSeats(PLANS.teacher_plus, 1), false)

  // Two is the state a downgrade leaves behind, and the only one that turns the
  // staff row and the trimmed list back on.
  assert.equal(overStaffSeats(PLANS.teacher_plus, 2), true)
  assert.equal(overStaffSeats(PLANS.teacher_free, 6), true)

  // Zero is not a problem to solve. A centre that signed up as a centre and was
  // moved down has no teacher rows at all until somebody adds one.
  assert.equal(overStaffSeats(PLANS.teacher_free, 0), false)

  // Uncapped is never over, at any size — the centre tiers sell seats by the head
  // and bill for them, they do not cap them.
  assert.equal(overStaffSeats(PLANS.center, 500), false)
  assert.equal(overStaffSeats(PLANS.institution, 500), false)
})

test('a downgraded centre can always be told it is over its seats', () => {
  // The invariant the way back down depends on. /settings hides the staff row on a
  // plan without staff and /settings/teachers draws a card instead of a list, both
  // unless this returns true — so a tier where it could not would strand an owner
  // with colleagues they are unable to switch off.
  for (const plan of Object.values(PLANS)) {
    if (hasStaff(plan)) continue
    assert.equal(
      overStaffSeats(plan, 2),
      true,
      `${plan.id} has no staff but two teachers on it read as within the plan`,
    )
  }
})
