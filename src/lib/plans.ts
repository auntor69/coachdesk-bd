/**
 * Plan limits — the single source of truth for what each tier may do.
 *
 * The free teacher tier is a deliberate Trojan horse, not a crippled demo: one
 * batch, but every feature works. A teacher who can only take attendance never
 * discovers what the product does, and teachers are how we reach centre owners.
 * The cap is on scale, never on capability.
 *
 * SMS is the one hard cost we carry (~৳0.30-0.60 per 70-char Bangla segment),
 * so it is metered on every tier and never bundled generously.
 */

export type PlanId = 'teacher_free' | 'teacher_plus' | 'center' | 'institution'

export type PlanLimits = {
  id: PlanId
  /** Shown to users; Bangla is the primary language. */
  nameBn: string
  nameEn: string
  /** null means unlimited. */
  maxBatches: number | null
  maxStudents: number | null
  maxTeachers: number | null
  maxSubjects: number | null
  /** Free SMS credits granted per month; beyond this they buy credits. */
  monthlySmsCredits: number
  /** Monthly price in BDT. Per subject-enrollment for paid centre tiers. */
  priceBdt: number
  /** Whether price is per enrollment or a flat fee. */
  pricing: 'free' | 'flat' | 'per_enrollment'
  features: {
    attendance: boolean
    exams: boolean
    smsToParents: boolean
    feeTracking: boolean
    multipleBranches: boolean
    ownerDashboard: boolean
    exportReports: boolean
  }
}

const ALL_FEATURES = {
  attendance: true,
  exams: true,
  smsToParents: true,
  feeTracking: true,
  multipleBranches: false,
  ownerDashboard: true,
  exportReports: true,
} as const

export const PLANS: Record<PlanId, PlanLimits> = {
  // Free forever. One batch, everything unlocked, small SMS allowance.
  teacher_free: {
    id: 'teacher_free',
    nameBn: 'শিক্ষক (ফ্রি)',
    nameEn: 'Teacher (Free)',
    maxBatches: 1,
    maxStudents: 60,
    maxTeachers: 1,
    maxSubjects: 1,
    monthlySmsCredits: 50,
    priceBdt: 0,
    pricing: 'free',
    features: { ...ALL_FEATURES },
  },

  // A single teacher who outgrew one batch.
  teacher_plus: {
    id: 'teacher_plus',
    nameBn: 'শিক্ষক প্লাস',
    nameEn: 'Teacher Plus',
    maxBatches: 6,
    maxStudents: 300,
    maxTeachers: 1,
    maxSubjects: 4,
    monthlySmsCredits: 200,
    priceBdt: 300,
    pricing: 'flat',
    features: { ...ALL_FEATURES },
  },

  // The real business: a centre with staff. Priced per subject-enrollment
  // because that, not headcount, is what drives teacher workload and SMS volume.
  center: {
    id: 'center',
    nameBn: 'কোচিং সেন্টার',
    nameEn: 'Coaching Center',
    maxBatches: null,
    maxStudents: null,
    maxTeachers: null,
    maxSubjects: null,
    monthlySmsCredits: 0,
    priceBdt: 8,
    pricing: 'per_enrollment',
    features: { ...ALL_FEATURES },
  },

  institution: {
    id: 'institution',
    nameBn: 'প্রতিষ্ঠান',
    nameEn: 'Institution',
    maxBatches: null,
    maxStudents: null,
    maxTeachers: null,
    maxSubjects: null,
    monthlySmsCredits: 0,
    priceBdt: 6,
    pricing: 'per_enrollment',
    features: { ...ALL_FEATURES, multipleBranches: true },
  },
}

/** Monthly floor for per-enrollment plans, so a tiny centre still pays rent. */
export const CENTER_MONTHLY_FLOOR_BDT = 500

export function planFor(id: PlanId | string | null | undefined): PlanLimits {
  return PLANS[(id ?? 'teacher_free') as PlanId] ?? PLANS.teacher_free
}

export type LimitKey = 'maxBatches' | 'maxStudents' | 'maxTeachers' | 'maxSubjects'

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

/** What we charge a centre this month, before SMS credits. */
export function monthlyBillBdt(plan: PlanLimits, activeEnrollments: number): number {
  if (plan.pricing === 'free') return 0
  if (plan.pricing === 'flat') return plan.priceBdt
  return Math.max(CENTER_MONTHLY_FLOOR_BDT, plan.priceBdt * activeEnrollments)
}
