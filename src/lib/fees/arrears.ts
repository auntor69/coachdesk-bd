/**
 * The opening balance: what a centre was already owed on the day it started using
 * this product.
 *
 * WHY THIS EXISTS. A centre is signed up by loading their paper register in — names,
 * guardian numbers, batches — and then the fee board is opened in front of the owner
 * and they are shown their outstanding total. That is the moment the product is sold,
 * and until this file existed the total was ৳0, because the importer loads students
 * and the invoice generator only bills the month it is pressed in. Every family
 * already three months behind arrived owing nothing, and the screen the sale rests on
 * opened by telling the owner something they knew to be false.
 *
 * The arrears are typed, not inferred. The roster paste deliberately refuses to read
 * an amount off a line — see lib/bd/roster.ts, which will not guess a student code
 * either, because "১২। রাফিদ হাসান — ০১৭১২৩৪৫৬৭৮" would turn a serial number into a
 * ৳12 debt and nobody would ever find out. So the amounts come from a box per
 * student, one screen, one submit, and this module is the arithmetic in between.
 *
 * EVERY ARREARS BILL HANGS OFF AN ENROLMENT, and specifically off the oldest active
 * one. That is not a modelling preference, it is what makes the write safe to repeat.
 * fee_invoices carries `unique (enrollment_id, period_month)` and a nullable
 * enrollment_id — and Postgres holds two NULLs to be distinct, so an unattached
 * arrears row has no unique key at all. `useOffline` replays server actions, so an
 * owner who submits this on a dying connection would have a family's debt written
 * twice, on the one screen whose whole job is to be believed. Attached to an
 * enrolment, the existing key does the work and `ignoreDuplicates` makes the second
 * press a no-op, exactly as it already does for the monthly generator.
 *
 * Oldest, and tie-broken by id, so the answer cannot move between the first press and
 * the replay: enrolling a student in a new subject tomorrow must not relocate
 * yesterday's debt into a slot that is still free. Ties are the common case rather
 * than the rare one — `enrolled_at` defaults to now(), and now() is one value for a
 * whole import — so a tie-break that was left to the query's row order would be no
 * tie-break at all.
 *
 * A STUDENT WITH NO ACTIVE ENROLMENT IS NOT BILLABLE HERE, for the same reason. The
 * screen offers no box for one, so an entry naming one is a page that went stale
 * while it was being filled in, and the honest answer is to say so rather than to
 * hang the debt on a closed enrolment or on nothing.
 */
import { MAX_TAKA, parseTaka, sumTaka } from '../money.ts'

/**
 * Every amount box on the arrears screen is named `arrears:<studentId>`.
 *
 * A prefix rather than parallel `studentId[]` and `amount[]` arrays, because those two
 * lists can arrive at different lengths — a browser that drops one field pairs every
 * debt after it with the wrong child, and on this screen that is three hundred
 * silently wrong invoices.
 *
 * It lives here rather than beside either half because both halves need it and they
 * cannot share it any other way: the form reads it to name the boxes and to add up
 * what has been typed so far, the action reads it to find them again, and a
 * `"use server"` module may not export a constant. Two copies of a wire format is two
 * chances to change one of them.
 */
export const ARREARS_FIELD_PREFIX = 'arrears:'

/** One enrolment as the arrears screen reads it. The query filters `active`. */
export type ArrearsEnrollment = {
  id: string
  student_id: string
  enrolled_at: string
}

/** What the owner typed in one student's box, straight off the form. */
export type ArrearsEntry = {
  studentId: string
  raw: string
}

/** One line of the upsert: whose debt, which slot, how much. */
export type ArrearsInvoice = {
  studentId: string
  enrollmentId: string
  amount: number
}

/**
 * Why one box could not be used.
 *
 * `unreadable` and `negative` are different answers on purpose. parseTaka returns
 * null for anything it cannot read as a number, which is what separates "they typed
 * a dash" from "they typed -500" — the first is a slip and the second is somebody
 * trying to record a credit on a screen that only records debt.
 *
 * camelCase because these are dictionary keys as well as verdicts: the caller looks
 * each one up to name the box in words, the way discountVerdict's `tooMuch` is.
 */
export type ArrearsProblem = 'unreadable' | 'negative' | 'tooLarge' | 'notEnrolled'

export type ArrearsReject = {
  studentId: string
  problem: ArrearsProblem
}

export type ArrearsPlan = {
  invoices: ArrearsInvoice[]
  /** What the whole submission adds up to, through sumTaka rather than `+`. */
  total: number
  /** Empty on a submission that may be written. See the note on the caller. */
  rejects: ArrearsReject[]
}

/**
 * Which enrolment each student's arrears attach to: student id → enrolment id.
 *
 * Exported separately because the page needs it too — a student with no entry in
 * this map gets no box to type in, which is the same rule the plan below enforces,
 * decided once.
 */
export function oldestEnrollments(
  rows: readonly ArrearsEnrollment[],
): Map<string, string> {
  const best = new Map<string, ArrearsEnrollment>()

  for (const row of rows) {
    if (!row.id || !row.student_id) continue
    const held = best.get(row.student_id)
    if (!held || earlier(row, held)) best.set(row.student_id, row)
  }

  const out = new Map<string, string>()
  for (const [studentId, row] of best) out.set(studentId, row.id)
  return out
}

/** Timestamps compare as strings: these are ISO-8601 from Postgres, all in UTC. */
function earlier(a: ArrearsEnrollment, b: ArrearsEnrollment): boolean {
  if (a.enrolled_at !== b.enrolled_at) return a.enrolled_at < b.enrolled_at
  return a.id < b.id
}

/**
 * Turns a screenful of typed amounts into the rows to write.
 *
 * A BLANK BOX IS NOT A ZERO AND NEITHER IS A TYPED ZERO — both are skipped without
 * complaint, and neither becomes an invoice. Most families in a centre are square,
 * so most boxes stay empty; and an owner who types 0 into one is saying the same
 * thing more emphatically. Raising a ৳0 bill for them would put a row on the fee
 * board for every student in the centre, all of them settled, burying the fifteen
 * families who actually owe money under three hundred who do not.
 *
 * ONE BAD BOX REFUSES THE WHOLE SUBMISSION. The caller checks `rejects` and writes
 * nothing if any came back, which is the opposite of how the rest of this product
 * handles a partial failure — the roster importer loads the good rows and reports the
 * bad ones, because a student left out of a list is visibly left out. An opening
 * balance is not like that: it is one act of bookkeeping producing one figure, and a
 * total that is short by one family looks exactly like a total that is right. The
 * owner is not made to retype anything either, because the form keeps what they typed
 * and only the named boxes need fixing.
 */
export function arrearsPlan(
  entries: readonly ArrearsEntry[],
  enrollmentByStudent: ReadonlyMap<string, string>,
): ArrearsPlan {
  const invoices: ArrearsInvoice[] = []
  const rejects: ArrearsReject[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    const studentId = entry.studentId
    // A duplicate name in the form body, which the screen cannot produce. Taking
    // the first and ignoring the rest keeps the write deterministic; the upsert
    // would otherwise be handed two rows for one key and fail as a whole.
    if (!studentId || seen.has(studentId)) continue
    seen.add(studentId)

    const raw = entry.raw.trim()
    if (raw === '') continue

    const amount = parseTaka(raw)
    if (amount === null) {
      rejects.push({ studentId, problem: 'unreadable' })
      continue
    }

    if (amount < 0) {
      rejects.push({ studentId, problem: 'negative' })
      continue
    }

    if (amount === 0) continue

    if (amount > MAX_TAKA) {
      rejects.push({ studentId, problem: 'tooLarge' })
      continue
    }

    const enrollmentId = enrollmentByStudent.get(studentId)
    if (!enrollmentId) {
      rejects.push({ studentId, problem: 'notEnrolled' })
      continue
    }

    invoices.push({ studentId, enrollmentId, amount })
  }

  return {
    invoices,
    total: sumTaka(invoices.map((i) => i.amount)),
    rejects,
  }
}

/**
 * What has been typed so far: how many boxes hold an amount, and what they add up to.
 *
 * THIS IS THE SCREEN'S ONLY SAFETY CHECK, so it is here where it can be tested rather
 * than inline in the form. Nothing in the arithmetic above can catch ৳30,000 typed for
 * ৳3,000 — the ceiling it enforces is the column's, not a guess at a plausible fee —
 * and the thing that does catch it is an owner reading a total they can hold against
 * the bottom of their own register. That figure has to be arrived at the same way the
 * written one is: the same reader, so a Bangla numeral counts, and the same summation,
 * so three hundred amounts ending in .50 do not drift a taka apart from the total the
 * fee board shows an hour later.
 *
 * A NEGATIVE OR OVER-THE-CEILING AMOUNT IS COUNTED IN, though the plan refuses it.
 * Excluding it would be the running total hiding the exact typo it exists to expose;
 * the owner sees a figure that looks wrong, which is the point, and the refusal on
 * submit then names the box.
 */
export function arrearsTyped(raws: readonly string[]): {
  filled: number
  total: number
} {
  const amounts: number[] = []

  for (const raw of raws) {
    const amount = parseTaka(raw)
    // Unreadable and zero are both "nothing typed here" as far as the figure goes.
    // A blank box is the common case, and a typed 0 means the same as a blank one.
    if (amount === null || amount === 0) continue
    amounts.push(amount)
  }

  return { filled: amounts.length, total: sumTaka(amounts) }
}
