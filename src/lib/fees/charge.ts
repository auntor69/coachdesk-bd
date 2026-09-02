/**
 * The bills that are not a monthly fee: admission, registration, exam, form, other.
 *
 * WHY A MODULE AND NOT FOUR LINES IN THE ACTION. Two of the three decisions here are
 * ones a Server Action must not take from the browser, and the third is a compile-time
 * fence:
 *
 *   - which categories a one-off charge may be, which is every value of the enum except
 *     `tuition` — and `tuition` is excluded by the schema, not by taste. 20260811000048's
 *     `fee_invoices_category_enrollment_bound` allows a non-tuition bill only when
 *     `enrollment_id is null`, and a bill with no enrolment is outside the
 *     `(enrollment_id, period_month)` key that makes month-close safe to repeat. So a
 *     one-off charge is exactly the categories that carry no enrolment.
 *   - who is actually billed, intersected against the roster the server read for itself.
 *   - and one row per student, because the idempotency index added in 20260811000067 is
 *     `(coaching_center_id, idempotency_key, student_id)`: a student listed twice in one
 *     submission collides with themselves and rolls the whole run back.
 */
import type { RevenueCategory } from '@/lib/supabase/types'

/**
 * The five a one-off charge may be, in the enum's own order.
 *
 * `tuition` is absent on purpose and is the only absence — see the header. A monthly fee
 * is raised by the generator against an enrolment, and this form cannot raise one at all.
 */
export const CHARGE_CATEGORIES = [
  'admission',
  'registration',
  'exam',
  'form',
  'other',
] as const satisfies readonly RevenueCategory[]

export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number]

/**
 * All six, tuition first, for the screen that reads a month back rather than writes it.
 *
 * Here rather than in lib/finance, so the fence below guards one list instead of two —
 * a second copy of the vocabulary somewhere else is exactly the drift `Unlisted` exists
 * to catch. Tuition leads because it is the largest line in every month a centre has,
 * and the rest follow the enum's own order.
 */
export const REVENUE_CATEGORIES = [
  'tuition',
  ...CHARGE_CATEGORIES,
] as const satisfies readonly RevenueCategory[]

/**
 * Whatever the list above left out, `tuition` aside. `never` while it is complete.
 *
 * The same mechanism as ALL_METHODS_LISTED in ./methods.ts, and it earns its keep the
 * same way: a migration that adds a revenue category regenerates
 * src/lib/supabase/types.ts and the next `tsc --noEmit` fails here — one line above the
 * list to add it to — rather than leaving a category the schema allows and no screen
 * can raise.
 */
type Unlisted = Exclude<RevenueCategory, ChargeCategory | 'tuition'>

export const ALL_CATEGORIES_LISTED: Unlisted extends never ? true : Unlisted = true

const CHARGEABLE: ReadonlySet<string> = new Set(CHARGE_CATEGORIES)

/**
 * Whether a string off a form is a category this form may raise.
 *
 * Fails closed, and `tuition` fails with everything else. A browser sending it would
 * otherwise reach the insert, where the check constraint refuses it — a 400 the owner
 * reads as "the bill was not created" with nothing to do about it.
 */
export function isChargeCategory(value: string): value is ChargeCategory {
  return CHARGEABLE.has(value)
}

/**
 * The `?batch=` value that means the whole centre rather than one batch.
 *
 * A word rather than an empty string, because an empty `?batch=` is what a browser sends
 * for "nothing chosen" and those are different screens: one lists everybody, the other
 * asks the owner to choose. Not a uuid, so it can never collide with a batch id.
 */
export const EVERY_BATCH = 'all'

/** A student as both the picker and the confirmation name them. */
export type ChargeStudent = {
  id: string
  name: string
  code: string | null
}

/** A student as the enrolment embed hands them over. */
type EnrolledStudent = {
  id: string
  name: string
  student_code: string | null
}

/**
 * The students of a batch, one row each, in register order.
 *
 * ONE ROW EACH IS THE POINT. A child can hold two active enrolments in the same batch —
 * nothing in the schema forbids it, and a re-enrolment after a break is how it happens —
 * and this list becomes checkboxes carrying `student_id`. Two boxes for one child is two
 * rows in one insert with the same idempotency key, which the unique index refuses:
 * the whole run rolls back and the owner is told the charge failed, over a list that
 * looks correct.
 *
 * Code then name, which is the order the paper register is in and the order
 * fees/arrears/page.tsx asks Postgres for. Sorted here rather than in the query so a
 * batch read through the enrolments and the whole centre read straight off `students`
 * come out in the same order.
 */
export function chargeRoster(
  rows: readonly { students: EnrolledStudent | EnrolledStudent[] | null }[],
): ChargeStudent[] {
  const byId = new Map<string, ChargeStudent>()

  for (const row of rows) {
    const student = Array.isArray(row.students) ? row.students[0] : row.students
    if (!student?.id || byId.has(student.id)) continue
    byId.set(student.id, {
      id: student.id,
      name: student.name,
      code: student.student_code,
    })
  }

  return [...byId.values()].sort(byRegisterOrder)
}

/**
 * Register order: code first, then name.
 *
 * A student with no code sorts after one who has it — `nullsFirst: false` in the query
 * this mirrors — because a centre that numbers its register has numbered the students it
 * cares to find quickly.
 */
export function byRegisterOrder(a: ChargeStudent, b: ChargeStudent): number {
  if (a.code !== b.code) {
    if (a.code === null) return 1
    if (b.code === null) return -1
    return a.code.localeCompare(b.code)
  }
  return a.name.localeCompare(b.name)
}

/** Who this submission actually bills, and how much of it was not billable. */
export type ChargePlan = {
  /** Student ids, deduped, in the roster's own order. */
  students: string[]
  /** Ticked boxes that name nobody the caller may bill. */
  unknown: number
}

/**
 * Which of the ticked boxes become bills.
 *
 * THE ROSTER DECIDES, NOT THE FORM. A Server Action is a public HTTP endpoint, so the
 * list of student ids arriving with a submission is a claim. Every id is checked against
 * students the caller's own session could read a moment earlier — the composite foreign
 * key would refuse a student from another centre anyway, but as a 400 with no sentence
 * attached, and a manager narrowed away from the fee capability would get one bill per
 * row of a list they cannot see.
 *
 * ORDERED BY THE ROSTER RATHER THAN BY THE FORM, which is what makes a replayed
 * submission deterministic: the same tick marks in a different field order produce the
 * same insert, so the unique index sees the same first row and refuses at the same place.
 */
export function chargePlan(
  ticked: readonly string[],
  roster: readonly ChargeStudent[],
): ChargePlan {
  const wanted = new Set<string>()
  for (const id of ticked) {
    const trimmed = id.trim()
    if (trimmed !== '') wanted.add(trimmed)
  }

  const students: string[] = []
  for (const student of roster) {
    if (wanted.delete(student.id)) students.push(student.id)
  }

  // Whatever is left named nobody on the roster. Counted rather than listed: there is no
  // name to print for an id that matched nothing, and the count is what tells an owner
  // whether the number of bills is the number of ticks.
  return { students, unknown: wanted.size }
}
