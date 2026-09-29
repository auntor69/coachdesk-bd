/**
 * Plan limits — the single source of truth for what each tier may do.
 *
 * Four tiers, two shapes. The teacher tiers are one person and can never be more
 * than one person; the centre tiers are an organisation with staff. That is the
 * line, and it is not a number — see `hasStaff`.
 *
 * WHY TEACHER PRO STOPS AT 150 STUDENTS. It used to stop at 300, which put a
 * teacher's ceiling above a small centre's floor, and that made the price
 * indefensible: 250 students on Pro was ৳499 while 250 students on a centre plan
 * was several thousand, for a customer who could stand in either tier and choose.
 * Five batches of thirty is the realistic ceiling for one human who is actually
 * teaching; past it they have hired somebody, and a person with staff is a centre
 * by definition. The tiers no longer overlap, so the gap needs no justifying.
 *
 * WHY THE FEATURE FLAGS ARE PER-TIER. Every tier used to carry `...ALL_FEATURES`,
 * which meant nothing was behind the paywall except scale — a paid teacher tier
 * would have sold nothing the free tier already did. The free tier is marketing:
 * one batch, thirty students, and the things that make a teacher look
 * institutional in front of a parent are exactly what it does not get.
 *
 * WHY THE SMS ALLOWANCES ARE ALL ZERO. Not a pricing decision — a factual one. No
 * BTRC sender ID exists, so no aggregator account exists, so there is no gateway
 * for an automated message to leave through. A non-zero allowance here would be a
 * counter decrementing against nothing, and a teacher told পাঠানো হয়েছে while the
 * parent heard nothing is the one failure this product cannot afford. Tap-to-send
 * from the owner's own phone is unmetered on every tier and always will be: it
 * costs us nothing, needs no licence, and cannot be switched off by a regulator.
 * See docs/PLANS-AND-MESSAGING.md §2.
 */

import type { Locale } from './i18n/locale.ts'

export type PlanId = 'teacher_free' | 'teacher_plus' | 'center' | 'institution'

/**
 * What a tier can do, as opposed to how much of it.
 *
 * Every flag is a thing a free teacher taps and is told about, never a thing that
 * silently is not there. A control that vanishes reads as a bug and generates a
 * support message; a control that explains itself sells the upgrade.
 */
export type PlanFeatures = {
  /** Roll call. Never gated on any tier — it is the hook. */
  attendance: boolean
  /** Marks entry and the exam screens. Never gated. */
  exams: boolean
  /** Recording money against an invoice. Never gated. */
  feeTracking: boolean
  /**
   * The printable A4 two-copy slip and the collection register.
   *
   * The highest-frequency moment in the product — money crossing a desk — and the
   * one feature that makes a teacher look institutional to a parent. A teacher who
   * has handed out thirty printed slips cannot go back to a notebook, because the
   * parents now expect paper. Costs us nothing to serve, so gating it is margin.
   *
   * The receipt *number* is not gated and cannot be: it is assigned by a trigger
   * on every payment regardless of tier, and a free teacher can read it out. What
   * Pro buys is the sheet, not the number.
   */
  printedReceipts: boolean
  /** CSV export of anything. */
  exportReports: boolean
  /** The weekly guardian progress summary. */
  parentSummary: boolean
  /**
   * Tap-to-send SMS, WhatsApp and call links. True on every tier including free,
   * and separate from `automatedSms` on purpose: this is the owner's own phone
   * sending from the owner's own number, which is unmetered because it costs us
   * nothing and needs no sender ID.
   */
  manualMessaging: boolean
  /**
   * Messages a cron job sends without anybody tapping. False everywhere until an
   * aggregator account exists — see the header note.
   */
  automatedSms: boolean
  /** Whether the tier may top up credits at all. Free may not, by design. */
  buySmsCredits: boolean
  /** Colleagues, roles, per-teacher permissions. The teacher/centre line. */
  staffManagement: boolean
  /** Centre-wide fees, batches and risk rather than one teacher's own. */
  centerWideReporting: boolean
  /** More than one centre under one account. */
  multipleBranches: boolean
}

export type PlanLimits = {
  id: PlanId
  /** Shown to users; Bangla is the primary language. */
  nameBn: string
  nameEn: string
  /**
   * null means unlimited.
   *
   * PER BRANCH on a plan that has them (§8.4): "Rooms and timetables are physical and
   * do not pool", so an institution running four buildings runs four timetables of this
   * size. `batchRoomRefusal` in settings/actions.ts is what counts it that way; below
   * the institution tier the whole organisation is one building and the number is the
   * organisation's. Student places are the opposite — see `maxStudents`.
   */
  maxBatches: number | null
  /**
   * Distinct students the PLAN grants, on the tiers that grant a number at all.
   *
   * NULL ON THE PER-STUDENT TIERS, and it means unlimited there rather than "the number is
   * not ours to give" — which is what it used to mean when a centre's limit was
   * `greatest(what the floor included, what it had bought)` in a column. Capacity is
   * retired (§16.1 step 28): a centre pays for the students it has, the balance carries
   * them, and there is no limit for a plan table to hold or a purchase to raise.
   *
   * SO NULL IS THE WHOLE ANSWER, and every student gate depends on reading it that way —
   * `wouldExceed` answers no for a null cap, `roomFor` answers null, and `limitRefusal`
   * returns before it counts. A null read as zero here would refuse a centre's first
   * student, on the tiers that are the actual business.
   */
  maxStudents: number | null
  /**
   * Students in any one batch. null means unlimited.
   *
   * Separate from `maxStudents` and both are enforced, because they stop different
   * things: the per-batch cap stops one giant batch pretending to be a class, the
   * total stops five batches of five hundred. A teacher tier with only a total cap
   * would let 150 students sit in a single batch, which is a lecture hall, not the
   * product we are describing.
   */
  maxStudentsPerBatch: number | null
  maxTeachers: number | null
  maxSubjects: number | null
  /**
   * Automated SMS granted per month. Zero on every tier today — see the header.
   * Kept as a number rather than removed because the metering, the ledger and the
   * refund path are all built and tested against it, and the day a gateway exists
   * this is the only line that changes.
   */
  monthlySmsCredits: number
  /** Flat monthly price in BDT. Zero for tiers priced by size. */
  priceBdt: number
  pricing: 'free' | 'flat' | 'per_student'
  features: PlanFeatures
}

/** What a teacher gets on the free tier: the hook, and nothing that sells Pro. */
const FREE_FEATURES: PlanFeatures = {
  attendance: true,
  exams: true,
  feeTracking: true,
  manualMessaging: true,
  printedReceipts: false,
  exportReports: false,
  parentSummary: false,
  automatedSms: false,
  buySmsCredits: false,
  staffManagement: false,
  centerWideReporting: false,
  multipleBranches: false,
}

/** Everything one teacher needs, and nothing that belongs to an organisation. */
const PRO_FEATURES: PlanFeatures = {
  ...FREE_FEATURES,
  printedReceipts: true,
  exportReports: true,
  parentSummary: true,
  buySmsCredits: true,
}

/** Pro, plus the things that only mean anything once there are colleagues. */
const CENTER_FEATURES: PlanFeatures = {
  ...PRO_FEATURES,
  staffManagement: true,
  centerWideReporting: true,
}

export const PLANS: Record<PlanId, PlanLimits> = {
  // Marketing, and honest about it. One batch of thirty runs a real section for a
  // term — enough to learn what the product does, not enough to be a permanent
  // answer for a teacher whose actual class is forty to sixty.
  teacher_free: {
    id: 'teacher_free',
    nameBn: 'শিক্ষক (ফ্রি)',
    nameEn: 'Teacher (Free)',
    maxBatches: 1,
    maxStudents: 30,
    maxStudentsPerBatch: 30,
    maxTeachers: 1,
    maxSubjects: 1,
    monthlySmsCredits: 0,
    priceBdt: 0,
    pricing: 'free',
    features: FREE_FEATURES,
  },

  // One teacher, five batches, thirty a batch. A teacher billing ৳1,000 a student
  // covers this with half of one student's monthly fee.
  teacher_plus: {
    id: 'teacher_plus',
    nameBn: 'শিক্ষক প্রো',
    nameEn: 'Teacher Pro',
    maxBatches: 5,
    maxStudents: 150,
    maxStudentsPerBatch: 30,
    // One, always, at any price. This is the wall between the tiers: a teacher who
    // needs a colleague needs a centre plan, and no amount of money moves this to
    // two. Making it purchasable would rebuild the overlap the caps just removed.
    maxTeachers: 1,
    maxSubjects: 5,
    monthlySmsCredits: 0,
    priceBdt: 499,
    pricing: 'flat',
    features: PRO_FEATURES,
  },

  // The real business. Priced by distinct students in marginal bands, with two
  // teacher seats included and the rest per seat — see monthlyBillBdt.
  //
  // THE CAPS HERE ARE ABUSE CEILINGS, NOT PRODUCT LIMITS, and the distinction is
  // why the numbers are round and large. A centre pays for students, so batches and
  // subjects are free to it and there is no revenue reason to bound them — but
  // "unbounded" is a different claim, and it is one no screen, index or export was
  // designed against. A hundred batches is four a day for a month; two hundred
  // subjects is every subject a school board recognises, twice. A customer who
  // needs more is a customer to talk to, not a limit to raise silently.
  center: {
    id: 'center',
    nameBn: 'কোচিং সেন্টার',
    nameEn: 'Coaching Center',
    maxBatches: 100,
    maxStudents: null,
    maxStudentsPerBatch: null,
    maxTeachers: null,
    maxSubjects: 200,
    monthlySmsCredits: 0,
    priceBdt: 0,
    pricing: 'per_student',
    features: CENTER_FEATURES,
  },

  // Everything a centre has, plus branches. Same bands, higher floor, and the only
  // feature flag that separates the two tiers.
  institution: {
    id: 'institution',
    nameBn: 'প্রতিষ্ঠান',
    nameEn: 'Institution',
    maxBatches: 100,
    maxStudents: null,
    maxStudentsPerBatch: null,
    maxTeachers: null,
    maxSubjects: 200,
    monthlySmsCredits: 0,
    priceBdt: 0,
    pricing: 'per_student',
    features: { ...CENTER_FEATURES, multipleBranches: true },
  },
}

/**
 * The tiers in order of what they grant, so "is this one better than that one" is a
 * comparison rather than a chain of `||`.
 *
 * Written down rather than inferred from the order of `PLANS` above, which is only
 * the order the founder panel happens to list them in — a tier inserted in the
 * middle of that object for readability would silently re-rank every comparison
 * that used its index. Total by construction, so a fifth tier cannot be added
 * without saying where it sits.
 *
 * NOT A PRICE ORDER, and the two are not the same question. A centre plan bills
 * less than Teacher Pro at fifty students; it still grants strictly more. This is
 * about entitlement.
 *
 * The one caller today is the trial in `effectiveEntitlement`, which needs it for a
 * reason worth stating: a trial is *a temporary better plan*, and a trial row left
 * behind on a centre that has since paid for `center` would otherwise drop them to
 * Teacher Pro — taking staff management off a customer the week they bought it.
 */
export const PLAN_RANK: Record<PlanId, number> = {
  teacher_free: 0,
  teacher_plus: 1,
  center: 2,
  institution: 3,
}

/* -------------------------------------------------------------------------- */
/* Centre pricing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The floor. Fifty students is the base model and nothing goes under this.
 *
 * A centre at fifty students bills the first band to ৳1,250, which is less than
 * the floor, and that is the floor's whole job: below a certain size the cost of
 * carrying a customer — support, storage, the founder's attention — does not
 * scale down with them.
 */
export const CENTER_MONTHLY_FLOOR_BDT = 1999

/**
 * The Institution floor.
 *
 * Higher than the centre floor and not because branches cost us more to store. An
 * institution is a customer with a head office, several buildings and somebody whose
 * job is asking us questions — the support load is a different shape, and the floor
 * is where that gets paid for. The per-student bands above it are identical, so a
 * 400-student institution and a 400-student centre pay the same for their students
 * and differ only in what the floor bought.
 *
 * UNCALIBRATED, exactly as the bands are. No institution has been sold anything yet.
 */
export const INSTITUTION_MONTHLY_FLOOR_BDT = 4999

/**
 * Which floor this plan pays.
 *
 * A function rather than a field on PlanLimits because the floor is only meaningful
 * for a per-student tier: a free plan has no floor and a flat plan IS its floor. Put
 * on the type, it would need a value for `teacher_free`, and any number there is a
 * lie somebody eventually reads.
 */
export function monthlyFloorBdt(plan: PlanLimits): number {
  return plan.id === 'institution' ? INSTITUTION_MONTHLY_FLOOR_BDT : CENTER_MONTHLY_FLOOR_BDT
}

/** Teacher seats included before any are charged for. */
export const CENTER_FREE_TEACHER_SEATS = 2

/** Monthly price per teacher seat beyond the included two. */
export const CENTER_TEACHER_SEAT_BDT = 100

/**
 * Branches an Institution includes before any are charged for.
 *
 * Three, because one branch is a centre and two is a centre with a second room. An
 * institution that has three buildings is the customer this tier was drawn for, and
 * charging them for the third would make the tier's own headline a lie.
 */
export const INSTITUTION_INCLUDED_BRANCHES = 3

/**
 * Monthly price per branch beyond the included three.
 *
 * Below a teacher seat times eight and above one, which is the honest position: a
 * branch is a reporting boundary and a set of registers, not eight new people. The
 * cost it stands for is the head office's — consolidated collection, a dashboard
 * that has to add up across buildings, and the support call when it does not.
 *
 * UNCALIBRATED, like every other figure in this block.
 */
export const INSTITUTION_BRANCH_BDT = 750

/**
 * Per-student rates, as MARGINAL bands — the same shape as income tax.
 *
 * Marginal and not flat-rate-per-tier, and the difference is the point: with flat
 * per-band rates a centre at 301 students would pay less than one at 300, which is
 * a pricing page that makes the founder look like they cannot count. Each band's
 * rate applies only to the students inside it, so the bill is continuous and
 * always rises with size.
 *
 * The taper exists because ৳25 flat is right at fifty students and wrong at nine
 * hundred — a large centre facing ৳22,500 a month starts building a spreadsheet
 * instead, and the cost of serving the nine-hundredth student is nowhere near the
 * cost of serving the fiftieth.
 *
 * THESE FIGURES ARE UNCALIBRATED. The structure is sound; the rates are a founder's
 * judgement with no market survey behind them, and the first twenty customers will
 * all sit in the first two bands, so the ৳12 and ৳8 rates are theoretical until
 * year two. Documented rather than quietly assumed.
 */
export const STUDENT_BANDS: { upTo: number | null; rateBdt: number }[] = [
  { upTo: 100, rateBdt: 25 },
  { upTo: 300, rateBdt: 18 },
  { upTo: 600, rateBdt: 12 },
  { upTo: null, rateBdt: 8 },
]

/**
 * What the students alone cost, before the floor and before teacher seats.
 *
 * Exported because the pricing calculator shows the breakdown — an owner deciding
 * between plans wants to see which part of the bill is students and which is
 * staff, and a single total invites the suspicion that it was invented.
 */
export function studentChargeBdt(students: number): number {
  if (!Number.isFinite(students) || students <= 0) return 0

  let remaining = Math.floor(students)
  let charged = 0
  let bandFloor = 0

  for (const band of STUDENT_BANDS) {
    if (remaining <= 0) break
    // null upTo is the last band and takes everything left.
    const bandSize = band.upTo === null ? remaining : band.upTo - bandFloor
    const inBand = Math.min(remaining, bandSize)
    charged += inBand * band.rateBdt
    remaining -= inBand
    bandFloor = band.upTo ?? bandFloor
  }

  return charged
}

/**
 * How many students the floor has already paid for.
 *
 * A centre that pays ৳1,999 and is then refused its first student has bought
 * nothing, so the floor comes with seats. This is what those seats are: the largest
 * number of students whose band-sum still fits inside the floor. At ৳1,999 that is
 * 79 (79 x ৳25 = ৳1,975, and the eightieth tips it to ৳2,000); at ৳4,999 it is 238
 * (৳2,500 for the first hundred, then 138 at ৳18).
 *
 * DERIVED AND NOT TYPED IN, which is the whole reason this function exists. 79 and
 * 238 are consequences of the floor and the first two band rates; writing them down
 * as constants would mean three numbers that must be changed together, and the day
 * the first band moves to ৳22 somebody updates the rate, ships it, and the included
 * seats silently stop matching what the floor buys.
 *
 * The floor is a parameter rather than read from a plan so a caller can ask the
 * question about a price that is not on sale yet — the pricing page's own "what if"
 * column does exactly that.
 */
export function seatsCoveredByFloor(floorBdt: number): number {
  if (!Number.isFinite(floorBdt) || floorBdt <= 0) return 0

  let seats = 0
  let spent = 0
  let bandFloor = 0

  for (const band of STUDENT_BANDS) {
    const bandSize = band.upTo === null ? Infinity : band.upTo - bandFloor
    // Integer division on purpose: a part-paid student is not a student.
    const affordable = Math.floor((floorBdt - spent) / band.rateBdt)
    const taken = Math.min(bandSize, affordable)

    seats += taken
    spent += taken * band.rateBdt

    // Ran out of money inside this band, so this is the answer. The last band's
    // size is Infinity, so this always returns before the loop ends.
    if (taken < bandSize) return seats
    bandFloor = band.upTo ?? bandFloor
  }

  return seats
}

/** What the teacher seats cost, beyond the two the plan includes. */
export function teacherChargeBdt(teachers: number): number {
  if (!Number.isFinite(teachers)) return 0
  const billable = Math.max(0, Math.floor(teachers) - CENTER_FREE_TEACHER_SEATS)
  return billable * CENTER_TEACHER_SEAT_BDT
}

/**
 * What the branches cost, beyond the three an Institution includes.
 *
 * Zero on any tier without `multipleBranches`, and keyed on the feature rather than
 * on `plan.id === 'institution'` on purpose: a centre cannot create a second branch,
 * so if one somehow has two rows the answer must be "we do not charge you for that"
 * rather than a bill for something they were never sold. A downgrade is exactly how
 * that state arrives — the branch rows outlive the plan that bought them, the same
 * way teacher rows do.
 */
export function branchChargeBdt(plan: PlanLimits, activeBranches: number): number {
  if (!plan.features.multipleBranches) return 0
  if (!Number.isFinite(activeBranches)) return 0
  const billable = Math.max(0, Math.floor(activeBranches) - INSTITUTION_INCLUDED_BRANCHES)
  return billable * INSTITUTION_BRANCH_BDT
}

/**
 * What adding one more branch adds to the monthly bill.
 *
 * The marginal figure, not the total, because that is the question somebody standing
 * in front of the add form is asking. §3.7 is why it is asked at all: "a branch
 * manager is not the billing owner and must not be able to increase the organisation's
 * monthly cost on their own signature" — and the same sentence obliges the form an
 * owner uses to say what the signature costs before they give it.
 *
 * A DIFFERENCE RATHER THAN A CONSTANT, and that is the whole reason this is a function
 * instead of `INSTITUTION_BRANCH_BDT` printed on the screen. The fourth branch is the
 * first that costs anything; the first three are free, so a form that always named
 * ৳750 would invent a charge for the centre opening its second building. Subtracting
 * `branchChargeBdt` from itself means the included-branch rule is stated once, and a
 * change to `INSTITUTION_INCLUDED_BRANCHES` cannot leave this line disagreeing with
 * the bill.
 *
 * Zero on any tier without `multipleBranches`, inherited from `branchChargeBdt`, which
 * is correct without being useful: those tiers have no add form to put it on.
 */
export function nextBranchCostBdt(plan: PlanLimits, activeBranches: number): number {
  const now = branchChargeBdt(plan, activeBranches)
  return branchChargeBdt(plan, activeBranches + 1) - now
}

/**
 * What we charge this month.
 *
 * COUNTED IN DISTINCT STUDENTS, NOT ENROLLMENTS, and that is a correction rather
 * than a preference. This used to be `rate × activeEnrollments`, and a centre
 * charges by subject — so a student taking Physics, Chemistry and Maths is three
 * enrollments and was billed three times. At ৳25 that is ৳75 for one child, which
 * is not the number anybody was quoted.
 *
 * The floor applies to the student charge, not to the total, so a small centre that
 * hires a sixth teacher pays the floor plus those seats rather than having the
 * seats swallowed by it.
 *
 * The floor comes from the plan (`monthlyFloorBdt`) and not from the centre constant,
 * because Institution's is higher. Reading `CENTER_MONTHLY_FLOOR_BDT` here would have
 * billed an institution at a centre's minimum — a ৳3,000 discount nobody decided on.
 *
 * `activeBranches` defaults to one because that is what every organisation has: a
 * centre has exactly one and an institution's head office is a branch too. A default
 * of zero would have been the tidier-looking number and would have quietly given the
 * first branch away twice.
 */
export function monthlyBillBdt(
  plan: PlanLimits,
  activeStudents: number,
  activeTeachers = 0,
  activeBranches = 1,
): number {
  if (plan.pricing === 'free') return 0
  if (plan.pricing === 'flat') return plan.priceBdt

  const students = Math.max(monthlyFloorBdt(plan), studentChargeBdt(activeStudents))
  return students + teacherChargeBdt(activeTeachers) + branchChargeBdt(plan, activeBranches)
}

/**
 * What a day costs, in poisha (§11.6: one balance, burned by the day).
 *
 * DERIVED FROM `monthlyBillBdt` AND NEVER TYPED IN, which is the whole reason
 * this is a function and not a constant — the same argument
 * `seatsCoveredByFloor`'s docblock makes about its own figure. A daily rate
 * typed anywhere would be a third number that must change with every repricing,
 * and the day it drifted from the monthly figure a customer would be quoted one
 * price and burned another.
 *
 * `floor(monthly × 100 / 30)`, floored in the CUSTOMER's favour and never
 * rounded up: rounding up would make a year cost ৳434 more than twelve months
 * and a 31-day month dearer than a 30-day one (§17). ৳2,600 a month is
 * ৳86.666… — not a whole taka, not a whole poisha — so the unit is poisha and
 * integers all the way down, and the ~20 poisha a month the floor gives away
 * is below the resolution of anything anyone looks at.
 *
 * THE SQL TWIN. `public.settle_billing` computes the same figure as
 * `monthly / 30` in integer poisha (integer division floors), from the same
 * card held to this file by `tests/price-versions.test.ts`. Two engines was
 * never the design — one engine, one card, and two doors into them; the worked
 * figures in `tests/daily-rate.test.ts` are the same ones the RLS suite
 * asserts of the SQL, so the two doors answer alike or a test fails.
 *
 * Zero on the free tier without a special case: §11.6's rule that "the
 * arithmetic returns zero", not a branch someone has to remember.
 */
export function dailyRatePoisha(
  plan: PlanLimits,
  activeStudents: number,
  activeTeachers = 0,
  activeBranches = 1,
): number {
  const monthlyPoisha = monthlyBillBdt(plan, activeStudents, activeTeachers, activeBranches) * 100
  return Math.floor(monthlyPoisha / 30)
}

/* -------------------------------------------------------------------------- */
/* How many students this organisation may have                               */
/* -------------------------------------------------------------------------- */

/**
 * Students the plan includes before anything is bought.
 *
 * The one place the two halves of this meet: for a teacher tier the included figure
 * IS the cap, because 30 and 150 never move; for a per-student tier it is what the
 * floor already paid for at the band rates. `plan_allowances` in 20260811000036
 * holds the same four numbers for the trigger to read, and
 * tests/plan-allowances.test.ts fails if the two ever disagree.
 */
export function includedStudents(plan: PlanLimits): number {
  if (plan.pricing === 'per_student') return seatsCoveredByFloor(monthlyFloorBdt(plan))
  return plan.maxStudents ?? 0
}

/* -------------------------------------------------------------------------- */
/* Reading a plan                                                             */
/* -------------------------------------------------------------------------- */

export function planFor(id: PlanId | string | null | undefined): PlanLimits {
  return PLANS[(id ?? 'teacher_free') as PlanId] ?? PLANS.teacher_free
}

/**
 * What to call the plan in front of the person paying for it.
 *
 * A plan name is not a dictionary string — it is closer to a product name, and
 * both spellings live above with the limits they belong to, where a new tier
 * cannot be added without naming it twice. Screens used to read `plan.nameBn`
 * directly, which was invisibly correct until the app grew a second language.
 *
 * The `Locale` import is type-only, so this file still pulls in nothing at
 * runtime — `wouldExceed` and `roomFor` are read by client components.
 */
export function planName(plan: PlanLimits, locale: Locale): string {
  return locale === 'en' ? plan.nameEn : plan.nameBn
}

export type LimitKey =
  | 'maxBatches'
  | 'maxStudents'
  | 'maxStudentsPerBatch'
  | 'maxTeachers'
  | 'maxSubjects'

export type FeatureKey = keyof PlanFeatures

/**
 * Whether the tier includes a capability at all.
 *
 * A function rather than reading `plan.features.x` at the call site, for the reason
 * `planName` is one: it is the seam where a locked feature's explanation hangs, and
 * every screen asking the same way means a new tier cannot half-answer.
 */
export function has(plan: PlanLimits, feature: FeatureKey): boolean {
  return plan.features[feature]
}

/**
 * True when creating one more of `what` would exceed the plan.
 * Callers pass the current count; the check is deliberately dumb and pure so
 * it can be unit-tested and reused on both server and client.
 */
export function wouldExceed(
  plan: PlanLimits,
  what: LimitKey,
  currentCount: number,
): boolean {
  const limit = plan[what]
  if (limit === null) return false
  return currentCount + 1 > limit
}

/**
 * Whether this cap is part of what the tier sells, and so worth showing as a quota.
 *
 * NOT the same question as `wouldExceed`, and the difference is what a screen says
 * rather than what an action allows. Both centre tiers cap batches and subjects, and
 * those caps are abuse ceilings set far above any real centre — so a centre shown
 * "3 of 100 batches" reads a guardrail as a quota to manage, and worse, reads 100 as
 * the thing they paid for. What they paid for is students.
 *
 * The list headers and the settings hub used to ask `plan.maxBatches === null`, which
 * gave the right answer only while the centre tiers claimed to be unlimited. Once the
 * ceiling exists that test silently changes what three screens mean, so the reason is
 * named here instead — the same reason `hasStaff` exists rather than a fourth reading
 * of `maxTeachers`.
 *
 * The money screen is the deliberate exception and prints the raw number: its
 * difference block states the limits a move would raise, on the teacher tiers where
 * the ladder is still a choice rather than a consequence of size — and the refusal
 * copy on the add forms names the cap at the moment somebody reaches it.
 */
export function capIsQuota(plan: PlanLimits, what: LimitKey): boolean {
  if (plan[what] === null) return false
  // Every non-null cap on a per-student tier is a guardrail: that tier sells students and
  // does not limit them at all, so the only numbers left on it — batches, subjects — are
  // abuse ceilings we set rather than anything it paid for.
  return plan.pricing !== 'per_student'
}

/**
 * Whether this plan has staff at all.
 *
 * The teacher tiers are one person — the owner. Everything about staff (a list
 * of colleagues, per-teacher permissions, who may send SMS) is a coaching-centre
 * concern, and on a solo plan the whole section is a list containing only the
 * reader plus a button that cannot work.
 *
 * Reads the feature flag rather than the teacher cap, and the difference is a real
 * hole rather than a nicety: `bootstrap_center` only writes the owner's own teacher
 * row in teacher mode, so a centre that signed up as a centre counts *zero*
 * teachers — and zero is comfortably under a cap of one. The cap answers "is there
 * room for one more row"; this answers "does this plan have colleagues", which is
 * the question the screens are really asking.
 */
export function hasStaff(plan: PlanLimits): boolean {
  return plan.features.staffManagement
}

/**
 * Whether this centre has more teachers switched on than its plan covers.
 *
 * A state a centre cannot get into by itself, and one the app has to be able to
 * describe: `setCenterPlan` moves a customer down a tier by writing the plan and
 * warning the founder, so a centre with six teachers can end the day on a plan
 * that covers one. The teacher rows outlive the plan that bought them — nothing
 * deletes staff on a downgrade, and nothing should, because the fix belongs to the
 * owner and it takes them a minute.
 *
 * Distinct from `wouldExceed`, which asks whether there is room for one more. This
 * asks whether what is already there fits, and only that answer can turn a screen
 * on: three of them hide their staff row or their staff list on a one-seat plan —
 * the settings hub, the plan screen and /settings/teachers itself — and this is
 * what puts all three back, so an over-cap owner is told and has somewhere to go.
 *
 * `activeTeachers` and not every row: a teacher who has been switched off costs
 * nothing and holds no seat, which is the whole shape of the way back down.
 */
export function overStaffSeats(plan: PlanLimits, activeTeachers: number): boolean {
  const limit = plan.maxTeachers
  if (limit === null) return false
  return activeTeachers > limit
}

/**
 * How many more of `what` the plan still allows; null when unlimited.
 *
 * wouldExceed answers "may I add one more", which is the wrong question for a
 * bulk import: a paste of 80 names against 15 remaining slots must be refused
 * whole, with the number that would fit, rather than let 15 through and lose 65
 * without saying which.
 *
 * ONE CALLER, AND IT IS THE STUDENT PASTE (§16.1 step 28). `importStudents` asks it how
 * many of the pasted names fit the plan's own `maxStudents`, and the null above is read
 * as "nothing to run out of" — which is every per-student tier, the plans whose students
 * are priced by the balance instead. That reading is the whole reason this is a function
 * and not a subtraction at the call site: null and zero are opposite answers, and a paste
 * is where confusing them costs an afternoon's typing.
 */
export function roomFor(
  plan: PlanLimits,
  what: LimitKey,
  currentCount: number,
): number | null {
  const limit = plan[what]
  if (limit === null) return null
  return Math.max(0, limit - currentCount)
}
