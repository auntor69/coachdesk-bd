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
  /** null means unlimited. */
  maxBatches: number | null
  /** Distinct students across the whole centre. null means unlimited. */
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
  center: {
    id: 'center',
    nameBn: 'কোচিং সেন্টার',
    nameEn: 'Coaching Center',
    maxBatches: null,
    maxStudents: null,
    maxStudentsPerBatch: null,
    maxTeachers: null,
    maxSubjects: null,
    monthlySmsCredits: 0,
    priceBdt: 0,
    pricing: 'per_student',
    features: CENTER_FEATURES,
  },

  institution: {
    id: 'institution',
    nameBn: 'প্রতিষ্ঠান',
    nameEn: 'Institution',
    maxBatches: null,
    maxStudents: null,
    maxStudentsPerBatch: null,
    maxTeachers: null,
    maxSubjects: null,
    monthlySmsCredits: 0,
    priceBdt: 0,
    pricing: 'per_student',
    features: { ...CENTER_FEATURES, multipleBranches: true },
  },
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

/** Teacher seats included before any are charged for. */
export const CENTER_FREE_TEACHER_SEATS = 2

/** Monthly price per teacher seat beyond the included two. */
export const CENTER_TEACHER_SEAT_BDT = 100

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

/** What the teacher seats cost, beyond the two the plan includes. */
export function teacherChargeBdt(teachers: number): number {
  if (!Number.isFinite(teachers)) return 0
  const billable = Math.max(0, Math.floor(teachers) - CENTER_FREE_TEACHER_SEATS)
  return billable * CENTER_TEACHER_SEAT_BDT
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
 */
export function monthlyBillBdt(
  plan: PlanLimits,
  activeStudents: number,
  activeTeachers = 0,
): number {
  if (plan.pricing === 'free') return 0
  if (plan.pricing === 'flat') return plan.priceBdt

  const students = Math.max(CENTER_MONTHLY_FLOOR_BDT, studentChargeBdt(activeStudents))
  return students + teacherChargeBdt(activeTeachers)
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
