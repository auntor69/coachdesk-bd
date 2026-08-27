/**
 * How far a centre is from the product actually doing anything.
 *
 * WHY THIS EXISTS. Every screen in this product hangs off an enrolment. The invoice
 * generator bills enrolments; the attendance sheet lists a batch; the old-dues screen
 * hangs each debt on one; the at-risk view and the weekly summary are built out of
 * attendance and marks that only exist once a register has been taken. So a centre can
 * finish signing up, paste two hundred names, and land on a dashboard that reports ৳0
 * outstanding, 0 batches marked, nobody at risk — every number true, every number
 * useless, and nothing on the screen saying which of the four things still has to
 * happen. That is the afternoon an owner decides the app does not work.
 *
 * The order is the dependency order, and the first unfinished step is the whole point:
 * a checklist that says "do these four things" is a to-do list, and a card that says
 * "next, open a batch" is an instruction. Enrolling needs both students and a batch to
 * enrol them into, so putting batches before enrolments is not a preference.
 *
 * WHAT IT DELIBERATELY DOES NOT INCLUDE. Nothing about money. Raising a bill is a
 * monthly errand rather than a setup step, it already has its own doors on the fee
 * board, and a step that goes undone every month would keep this card on the dashboard
 * for ever — which would turn it into furniture and cost the four steps that matter
 * their entire effect. Setup finishes, and then this is gone.
 *
 * NO ROUTES IN HERE. The component owns where each step sends somebody; this owns only
 * what state the centre is in, so it stays testable without a router.
 */

/** The four things, in the order they have to happen. */
export type SetupStepId = 'students' | 'batches' | 'enrolments' | 'attendance'

export const SETUP_ORDER: readonly SetupStepId[] = [
  'students',
  'batches',
  'enrolments',
  'attendance',
]

/**
 * What the dashboard counted. Each is `number | null` because that is what
 * PostgREST's `count: 'exact', head: true` hands back, and the null matters — see
 * `setupSteps`.
 */
export type SetupCounts = {
  /** Active students on the roster. */
  students: number | null
  /** Active batches. */
  batches: number | null
  /** Active enrolments — students actually attached to a batch. */
  enrolments: number | null
  /** Registers taken, ever. One is enough; this is "have they done it once". */
  sessions: number | null
}

export type SetupStep = {
  id: SetupStepId
  done: boolean
  /** The first unfinished step, and only that one. What the card asks for. */
  next: boolean
}

/**
 * The checklist, or null when there is nothing to say.
 *
 * Null in two quite different cases, both of which have to be silent:
 *
 * Every step is done. The card has served its purpose and never comes back. There is
 * no flag stored anywhere for this — it is derived from the centre's own data every
 * time, so a centre that closes its last batch in the winter break gets the card back,
 * correctly, because it genuinely cannot take a register that week.
 *
 * A count is missing. `null` from Supabase means the query failed, not that the answer
 * is zero, and the difference is the whole card: a failed student count rendered as 0
 * would tell a centre with three hundred students to go and add some. The dashboard
 * makes the same distinction about its fee figures for the same reason. When any count
 * is unknown, nothing is claimed.
 */
export function setupSteps(counts: SetupCounts): SetupStep[] | null {
  const { students, batches, enrolments, sessions } = counts
  if (students === null || batches === null) return null
  if (enrolments === null || sessions === null) return null

  const done: Record<SetupStepId, boolean> = {
    students: students > 0,
    batches: batches > 0,
    enrolments: enrolments > 0,
    attendance: sessions > 0,
  }

  if (SETUP_ORDER.every((id) => done[id])) return null

  const next = SETUP_ORDER.find((id) => !done[id])

  return SETUP_ORDER.map((id) => ({ id, done: done[id], next: id === next }))
}
