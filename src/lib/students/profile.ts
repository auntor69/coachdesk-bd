/**
 * One student's record, assembled from the four things a centre knows about them.
 *
 * This is the arithmetic behind FOUNDATION workflow 7 — "owner opens a student →
 * sees attendance rate, marks across exams, fee status, and flags in one screen".
 * It is the screen a parent's phone call is answered from, so the numbers on it
 * have to be the same numbers as everywhere else in the app.
 *
 * WHAT THIS FILE IS NOT ALLOWED TO DECIDE
 *
 * Whether the student is in trouble. `student_risk` owns every threshold in this
 * product — see 20260811000014 and ./risk.ts — and a second opinion computed here
 * would be a second answer to the one question an owner acts on. So the flags
 * section of the profile reads the view like the other two screens do, and nothing
 * below compares a percentage against a number.
 *
 * The same rule is why there is no average mark here. "How is this child doing at
 * exams" already has an answer with thresholds behind it (`marks_pct` on the view,
 * compared against the previous window); a mean of whatever twelve results happen
 * to be on screen would sit next to it and disagree, and the reader would have no
 * way to know which one the at-risk list used. Each result carries its own
 * percentage, which is a fact about that exam rather than a judgement about the
 * student.
 *
 * WHAT IT DOES DECIDE
 *
 * How to fold rows into per-batch counts, in what order the batches go, and how
 * far back to look. Those are screen decisions, they invert silently, and none of
 * them is visible in a screenshot — which is the same argument ./risk.ts and
 * ../attendance/rates.ts make for living here and being tested.
 *
 * Relative imports with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */
import { daysBetween, todayInDhaka } from '../bd/time.ts'
import { tallyOutstanding } from '../money.ts'
import type { AttendanceStatus } from '../supabase/types.ts'

/**
 * How far back the attendance panel looks, in days.
 *
 * Eight weeks, and the length is a compromise between two ways of being useless. A
 * month is too short to show a trend at a centre whose batch meets twice a week —
 * eight or nine classes, one of them cancelled for a holiday, and a single absence
 * moves the figure eleven points. A year is long enough that a student who
 * straightened out in March still reads as a problem in August, which is the
 * failure mode that makes an owner stop trusting the screen.
 *
 * It is also the window that keeps the query cheap. Marks are fetched per session
 * for one student, so the cost is sessions-in-window, and 56 days of a thrice-weekly
 * batch is about two dozen rows. This screen is opened while a parent is on the
 * phone, on a mid-range Android, on 3G.
 *
 * Not in SQL, unlike every attendance threshold: nothing else reads this number, and
 * a number with exactly one reader belongs next to its reader. See the note on
 * SUMMARY_AGAIN_AFTER_DAYS in ./progress.ts for the same call made the same way.
 */
export const PROFILE_ATTENDANCE_DAYS = 56

/**
 * How many exam results the marks panel shows.
 *
 * Twelve is roughly a term of weekly tests, and it is a screen limit rather than a
 * statement about the student: the list is newest first, so the cut is always the
 * oldest thing on it. A centre that tests daily will have older results than this
 * that the profile does not show, and that is the right trade for a page an owner
 * opens mid-conversation.
 */
export const PROFILE_EXAM_LIMIT = 12

/**
 * How many invoices the fee panel shows.
 *
 * A year of monthly bills. Newest first, again, so the oldest is what falls off —
 * but note that *unpaid* invoices are never allowed to fall off silently, because
 * the outstanding total is summed from the same rows the panel lists. If a centre
 * ever has a student with more than a year of unpaid months, the total would
 * understate the debt. Twelve rows is the wrong shape for that centre and they
 * would be reading the fee board instead; the fee board has no limit.
 */
export const PROFILE_INVOICE_LIMIT = 12

/**
 * How many branch moves the history panel shows.
 *
 * Newest first, so the cut is the oldest move — and a student who has changed
 * building a dozen times is not a row anybody reads to the bottom of. The one move
 * that matters is always the most recent, because it is the one the attendance and
 * fee panels above have to be read against.
 */
export const PROFILE_TRANSFER_LIMIT = 12

/** A to-one embed arrives as an object, or an array, or null. All three happen. */
type Embed<T> = T | T[] | null

function one<T>(embed: Embed<T>): T | null {
  return (Array.isArray(embed) ? embed[0] : embed) ?? null
}

/** `numeric` over the wire is a string. Anything unreadable is no figure at all. */
function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** One batch this student is on the roll of, named for the reader. */
export type EnrolledBatch = {
  batchId: string
  /** Already resolved through `localName` — this file does no translation. */
  label: string
}

/** One session of one batch, as the sessions query returns it. */
export type ProfileSessionRow = {
  id: string
  batch_id: string
  session_date: string
}

/** One of this student's marks. `session_id` is what ties it to a batch and a day. */
export type ProfileMarkRow = {
  session_id: string
  status: AttendanceStatus
}

/**
 * How one batch went for this student over the window.
 *
 * `ratePct` is computed exactly as `batch_attendance_monthly` computes it —
 * (present + late) over (present + late + absent), excused excluded from the
 * denominator, null when there is nothing to divide. That is not a coincidence to
 * be tidied up later: the dashboard prints the batch's rate and this prints one
 * student's inside the same batch, and an owner reads them in the same hour. Two
 * definitions of "attendance rate" in one product is a support call nobody can
 * answer. The reasoning for each part of it — why late counts as attendance, why
 * excused is excluded rather than counted against, why null is not zero — is
 * written out at length in 20260811000011_attendance_rate.sql and is not repeated
 * here.
 */
export type BatchAttendance = {
  batchId: string
  label: string
  /**
   * Classes this batch has on record in the window, whoever was marked.
   *
   * "On record" and not "held": a session row exists from the moment a teacher
   * opens the register, so an opened-and-abandoned register counts here. The gap
   * between this and `marked` is the useful part — a student on the roll for six
   * weeks of a batch with twenty classes and eleven marks against their name has a
   * register problem, not an attendance problem, and those two need different
   * conversations with different people.
   */
  sessions: number
  /** Classes in the window this student was marked for, any status. */
  marked: number
  present: number
  late: number
  absent: number
  excused: number
  /** The denominator: present + late + absent. */
  counted: number
  ratePct: number | null
}

const STATUS_KEYS: Record<AttendanceStatus, 'present' | 'late' | 'absent' | 'excused'> = {
  present: 'present',
  late: 'late',
  absent: 'absent',
  excused: 'excused',
}

/**
 * The attendance panel: every batch the student is enrolled in, worst first.
 *
 * EVERY ENROLLED BATCH, including ones with nothing recorded. A batch that shows
 * zero classes in eight weeks is the most actionable row this panel can produce —
 * it means the register for that batch has stopped being taken — and it is exactly
 * the row a query-driven list would omit, because there is no session to build it
 * from. So the batches come from the enrolment side and the sessions are folded
 * into them.
 *
 * WORST FIRST, and batches with no rate last. Same order as the dashboard's rate
 * card and for the same reason: the reader looks at the top of the panel, so the
 * top has to be the batch worth mentioning when the guardian picks up. A batch with
 * nothing recorded is not a failing one, and sorting it above a measured 41% would
 * cost the panel its one job.
 *
 * Label breaks the final tie so the order is stable across renders. Without it two
 * batches with identical figures can swap places between two loads of the same
 * screen, which reads as the numbers being recomputed on every tap.
 *
 * `marks` is expected to be this student's marks only — the query filters by their
 * enrolment ids — and `sessions` is expected to cover `batches`. A mark whose
 * session is not in the list is ignored rather than counted into some other batch:
 * that combination means the window boundaries of the two queries disagree, and
 * silently attributing a class to the wrong batch is worse than dropping it.
 */
export function attendanceByBatch(
  batches: readonly EnrolledBatch[],
  sessions: readonly ProfileSessionRow[] | null | undefined,
  marks: readonly ProfileMarkRow[] | null | undefined,
): BatchAttendance[] {
  const byBatch = new Map<string, BatchAttendance>()

  for (const batch of batches) {
    // First wins. A student with two enrolment rows pointing at one batch — a
    // paused row and its replacement — is one line on this panel, not two
    // identical ones side by side.
    if (byBatch.has(batch.batchId)) continue
    byBatch.set(batch.batchId, {
      batchId: batch.batchId,
      label: batch.label,
      sessions: 0,
      marked: 0,
      present: 0,
      late: 0,
      absent: 0,
      excused: 0,
      counted: 0,
      ratePct: null,
    })
  }

  const batchOfSession = new Map<string, string>()

  for (const session of sessions ?? []) {
    const row = byBatch.get(session.batch_id)
    // A session for a batch this student is not enrolled in. Reachable when a
    // former batch is still in the query's `in` list; not this panel's business.
    if (!row) continue
    batchOfSession.set(session.id, session.batch_id)
    row.sessions += 1
  }

  for (const mark of marks ?? []) {
    const batchId = batchOfSession.get(mark.session_id)
    if (!batchId) continue
    const row = byBatch.get(batchId)
    if (!row) continue
    row.marked += 1
    row[STATUS_KEYS[mark.status]] += 1
  }

  const rows = [...byBatch.values()]

  for (const row of rows) {
    row.counted = row.present + row.late + row.absent
    row.ratePct =
      row.counted > 0 ? Math.round((100 * (row.present + row.late)) / row.counted) : null
  }

  rows.sort((a, b) => {
    // Infinity, so a batch with no figure sorts below every measured one.
    // Comparing nulls directly would put them first, silently.
    const rateA = a.ratePct ?? Infinity
    const rateB = b.ratePct ?? Infinity
    if (rateA !== rateB) return rateA - rateB
    return a.label.localeCompare(b.label, 'bn-BD')
  })

  return rows
}

/** One exam result as the marks query returns it, exam embed and all. */
export type ProfileResultRow = {
  id: string
  obtained_marks: string | number | null
  is_absent: boolean | null
  exams: Embed<{
    title: string
    total_marks: string | number | null
    exam_date: string
    batch_id: string | null
  }>
}

/** One result, ready to render. */
export type ExamMark = {
  resultId: string
  title: string
  /** YYYY-MM-DD. The exam's own date, never the date it was entered. */
  on: string
  /**
   * Null on an absence and on a result nobody has entered a figure for. The two
   * are different rows on the screen, which is why `absent` is carried separately
   * rather than inferred from this being null.
   */
  obtained: number | null
  total: number | null
  /** Rounded, and null whenever there is nothing to divide. Never on an absence. */
  pct: number | null
  absent: boolean
  /** Null when the exam's batch is not one this reader can see a name for. */
  batchLabel: string | null
}

/**
 * The marks panel, newest exam first.
 *
 * Sorted by the exam's own date and not by when the marks were typed in. A teacher
 * entering last week's test on Sunday evening has not made it this week's news, and
 * a panel that said otherwise would put a stale result at the top on the one screen
 * an owner reads a result off to a parent.
 *
 * An absence is a row, not a gap. A child who sat none of the last three tests is
 * the thing this panel exists to make visible, and dropping those rows — or worse,
 * averaging them in as zeroes — is how a screen turns "stopped turning up" into
 * "doing badly". `student_risk` makes the same call in SQL; see its `exams_missed`.
 */
export function examMarks(
  rows: readonly ProfileResultRow[] | null | undefined,
  /** batch id → the label the reader sees. Missing ids simply get no label. */
  batchLabels: ReadonlyMap<string, string>,
): ExamMark[] {
  const list: ExamMark[] = []

  for (const row of rows ?? []) {
    const exam = one(row.exams)
    // No exam behind the result. RLS hid it, or it was deleted between the two
    // reads; either way there is no title, no total and no date to sort by.
    if (!exam) continue

    const absent = row.is_absent === true
    const obtained = absent ? null : num(row.obtained_marks)
    const total = num(exam.total_marks)

    list.push({
      resultId: row.id,
      title: exam.title,
      on: exam.exam_date,
      obtained,
      total,
      pct:
        obtained !== null && total !== null && total > 0
          ? Math.round((100 * obtained) / total)
          : null,
      absent,
      batchLabel: (exam.batch_id && batchLabels.get(exam.batch_id)) || null,
    })
  }

  // Newest first, then title so two tests on one day hold their order across
  // renders.
  list.sort((a, b) => (a.on === b.on ? a.title.localeCompare(b.title, 'bn-BD') : a.on < b.on ? 1 : -1))

  return list
}

/** One invoice as `fee_invoice_balances` returns it. Every view column is nullable. */
export type ProfileInvoiceRow = {
  id: string | null
  period_month: string | null
  due_date: string | null
  /** The fee the centre charges, before any waiver. */
  amount_bdt: string | number | null
  discount_bdt: string | number | null
  discount_reason: string | null
  net_bdt: string | number | null
  paid_bdt: string | number | null
  remaining_bdt: string | number | null
}

/**
 * One payment against one of those invoices, as the receipts query returns it.
 *
 * `paid_at` is a timestamptz and arrives in UTC. It is converted below rather than
 * sliced, because ten characters off the ISO string dates a payment taken at 1am
 * Dhaka to the day before — and the date on a receipt is what a dispute turns on.
 */
export type ProfilePaymentRow = {
  id: string
  receipt_no: number
  amount_bdt: string | number | null
  paid_at: string
  invoice_id: string
}

/**
 * One slip that exists, and can therefore be printed again.
 *
 * This is the answer to "the parent wants the receipt for July and July is not on
 * the fee board any more". The board only carries the current month's settled
 * bills, and the collection register is scoped to a month and locked behind a paid
 * plan, so a slip handed over in July used to be reachable from nowhere. It always
 * existed — `fee_payments` never loses a row and the receipt page renders from the
 * payment id alone — it simply could not be found.
 */
export type FeeReceipt = {
  paymentId: string
  receiptNo: number
  /** YYYY-MM-DD in Dhaka, converted from the timestamptz rather than sliced off it. */
  on: string
  /**
   * Signed, and the sign is the whole of it: a refund is a `fee_payments` row with a
   * negative amount and nothing else distinguishes one. See lib/fees/refund.ts.
   */
  amount: number
  refund: boolean
}

/** One bill, ready to render. */
export type FeeLine = {
  invoiceId: string
  /** YYYY-MM-01. The month billed for, which is not always the month due. */
  periodMonth: string
  dueDate: string | null
  /**
   * `amount_bdt` — the fee, before the waiver. Carried alongside `net` rather than
   * derived from it, and neither is derived from the other here: Postgres subtracts
   * once, in the view, and this file only ever reads the three figures it produced.
   */
  billed: number
  /** `discount_bdt`. Zero on almost every bill, which is why the line is conditional. */
  discount: number
  /**
   * The owner's own words for why, or null.
   *
   * This is the only place the answer to "why is this family's bill smaller" is
   * written down, and this is the screen it gets asked on — an owner with a parent on
   * the phone, months after whoever granted it has forgotten. The figure without the
   * reason is the half that raises the question rather than settling it.
   */
  discountReason: string | null
  net: number
  paid: number
  /** Positive is owed, negative is a credit on the invoice. Never rounded here. */
  remaining: number
  /**
   * Days past due, negative before the due date — the same sign convention the fee
   * board's `daysLate` uses, so a single comparison tells a row whether to shout.
   * Zero when there is no due date to compare against.
   */
  daysLate: number
  /** Only a row still owing money can be late. A credited one is settled. */
  late: boolean
  /**
   * Every slip raised against this bill, oldest first — the order the money arrived.
   *
   * Empty when nothing has been paid, and empty for a reader who was not given the
   * payments to fold in. These sum to `paid` exactly, because `paid_bdt` on the view
   * is `sum(amount_bdt)` over the same rows and a refund is negative in both. That
   * equality is why the list must not be truncated: a panel showing two slips
   * totalling ৳1,500 beside a paid figure of ৳2,000 reads as money the app has lost.
   */
  receipts: FeeReceipt[]
}

export type FeeHistory = {
  lines: FeeLine[]
  /** Every taka still owed across the listed invoices. */
  outstanding: number
  /** Money handed over beyond what was billed, kept separate from the debt. */
  credit: number
  /** The oldest unpaid invoice's due date, or null when nothing is overdue. */
  overdueSince: string | null
}

/**
 * The fee panel, this month at the top.
 *
 * Newest month first, which is the opposite of the fee board's oldest-first order,
 * and the difference is the question each screen answers. The board is a worklist —
 * the oldest debt is the one to chase, so it goes at the top. This panel answers
 * "has this family paid", asked by a person who is looking at that family, and the
 * answer is almost always about the current month.
 *
 * TOTALS COME FROM `tallyOutstanding`, not a sum. A credit on one invoice must not
 * pay off a debt on another: a family that overpaid ৳500 in June and skipped July
 * owes July's bill in full, and netting the two would tell an owner they are square.
 * The reasoning is in ../money.ts, and /me makes the same call across children.
 *
 * Money arithmetic that has to be exact stays in Postgres — `remaining_bdt` is
 * computed by the view, because numeric(10,2) through a JS float can leave a paid-up
 * invoice owing 2e-13. What happens here is only ever addition of figures the view
 * already settled. The fee, the waiver and the net are three of those figures and are
 * carried side by side rather than one being subtracted from another.
 *
 * PAYMENTS ARE FOLDED IN RATHER THAN SUMMED. Each bill carries the slips raised
 * against it so the panel can link them, and not one figure of them is used in any
 * total: `paid` and `remaining` still come off the view. The list is here to be
 * tapped, which is the only way a receipt from a month that has left the fee board
 * is reachable at all.
 */
export function feeHistory(
  rows: readonly ProfileInvoiceRow[] | null | undefined,
  /** Today in Dhaka, YYYY-MM-DD. A parameter so lateness is testable. */
  today: string,
  /**
   * Every payment against the invoices in `rows`, in any order.
   *
   * Optional, and absent means "no slips listed" rather than "no slips exist" — the
   * caller skips this query for a reader it would tell nothing new. A payment whose
   * invoice is not in `rows` is dropped rather than attached to some other bill,
   * which is the same call `attendanceByBatch` makes about an unknown session: the
   * combination means two queries disagree, and guessing is worse than omitting.
   */
  payments?: readonly ProfilePaymentRow[] | null,
): FeeHistory {
  const lines: FeeLine[] = []

  const receiptsOf = new Map<string, FeeReceipt[]>()
  for (const payment of payments ?? []) {
    if (!payment.invoice_id || !payment.id) continue
    const amount = num(payment.amount_bdt) ?? 0
    const list = receiptsOf.get(payment.invoice_id)
    const receipt: FeeReceipt = {
      paymentId: payment.id,
      receiptNo: payment.receipt_no,
      on: todayInDhaka(new Date(payment.paid_at)),
      amount,
      // `amount_bdt` is `check (<> 0)`, so there is no third case to think about.
      refund: amount < 0,
    }
    if (list) list.push(receipt)
    else receiptsOf.set(payment.invoice_id, [receipt])
  }

  // Oldest first — the order the money actually arrived, which is the order a parent
  // reconstructs from memory. `paid_at` alone cannot settle two payments taken in the
  // same second, and the receipt number cannot be relied on alone either: an imported
  // slip legitimately carries a number from the old paper book against a paid_at
  // months earlier. Same pair, same order, as the receipt page's own as-of balance.
  for (const list of receiptsOf.values()) {
    list.sort((a, b) => (a.on === b.on ? a.receiptNo - b.receiptNo : a.on < b.on ? -1 : 1))
  }

  for (const row of rows ?? []) {
    // No id means no receipt to link to and no key to render under. The view
    // types it nullable and never returns one.
    if (!row.id) continue

    const remaining = num(row.remaining_bdt) ?? 0
    const dueDate = row.due_date ?? null
    const daysLate = dueDate ? daysBetween(dueDate, today) : 0

    lines.push({
      invoiceId: row.id,
      // The invoice's own month, falling back to the due date's — the same
      // fallback the fee board's `toRow` uses. A row headed with the wrong month
      // is worse than one headed with none.
      periodMonth: row.period_month ?? (dueDate ? `${dueDate.slice(0, 7)}-01` : ''),
      dueDate,
      billed: num(row.amount_bdt) ?? 0,
      discount: num(row.discount_bdt) ?? 0,
      // Trimmed, so a reason of three spaces does not put an empty labelled line on
      // the screen. Empty becomes null, which is the one thing the renderer checks.
      discountReason: row.discount_reason?.trim() || null,
      net: num(row.net_bdt) ?? 0,
      paid: num(row.paid_bdt) ?? 0,
      remaining,
      daysLate,
      late: remaining > 0 && daysLate > 0,
      receipts: receiptsOf.get(row.id) ?? [],
    })
  }

  lines.sort((a, b) =>
    a.periodMonth === b.periodMonth
      ? (b.dueDate ?? '').localeCompare(a.dueDate ?? '')
      : a.periodMonth < b.periodMonth
        ? 1
        : -1,
  )

  const { outstanding, credit } = tallyOutstanding(lines.map((l) => l.remaining))

  // The oldest one still owed, which is the figure that turns "৳3,000 owed" into a
  // sentence worth saying out loud. Read off the sorted list from the bottom up.
  let overdueSince: string | null = null
  for (const line of lines) {
    if (!line.late || !line.dueDate) continue
    if (overdueSince === null || line.dueDate < overdueSince) overdueSince = line.dueDate
  }

  return { lines, outstanding, credit, overdueSince }
}

/**
 * One move as `student_transfers` returns it.
 *
 * Both names are frozen: 20260811000042's trigger copies the branch names into the row
 * at the moment of the move, and there is no FK on either id — a branch that has been
 * renamed or deleted since must still read as what it was called on the day. So nothing
 * below looks a name up, and the ids are here only to tell head office (null) from a
 * building.
 */
export type ProfileTransferRow = {
  id: string
  from_branch_id: string | null
  from_branch_name: string | null
  to_branch_id: string | null
  to_branch_name: string | null
  moved_by: string | null
  created_at: string
}

/**
 * Who moved the student, as far as a browser session can honestly say.
 *
 * NOT A NAME, and it cannot become one from here. `profiles` is self-read only
 * (`profiles_self_read`, 20260811000002), so a session can read its own row and nobody
 * else's — the uuid in `moved_by` resolves to a person only for the person themselves.
 * Guessing from `teachers` or `employees` would be worse than saying nothing: a teacher
 * has no UPDATE on `students` at all, so the mover is almost always an owner, and an
 * owner appears in neither table.
 *
 * `unknown` is a null `moved_by` — a login since deleted (`on delete set null`), or a
 * write made where `auth.uid()` was null.
 */
export type TransferActor = 'you' | 'other' | 'unknown'

export type StudentTransfer = {
  id: string
  from: string
  to: string
  /** YYYY-MM-DD in Dhaka, converted from the timestamptz rather than sliced off it. */
  on: string | null
  by: TransferActor
}

/**
 * The branch-history panel, most recent move first.
 *
 * §7.2 asks for a transfer to be a move rather than a delete, and the write side of that
 * has shipped: `updateStudent` sets `branch_id` on the one row, so the child's
 * enrolments, marks, bills and payments follow them without being recreated. This is the
 * half that makes it auditable, because the first question after a transfer goes wrong is
 * always *who moved this child, and when*.
 *
 * A NULL BRANCH ID IS HEAD OFFICE and is labelled as such, never left blank. That is
 * 20260811000053's meaning for the null — `app.branch_ok` reads it as the whole
 * organisation — and a row reading "→ " would look like a bug in the one panel that
 * exists to explain a surprise.
 */
export function studentTransfers(
  rows: readonly ProfileTransferRow[] | null | undefined,
  labels: { viewerId: string; headOffice: string; unnamedBranch: string },
): StudentTransfer[] {
  const place = (id: string | null, name: string | null) =>
    id === null ? labels.headOffice : name?.trim() || labels.unnamedBranch

  // Ordered on the raw timestamp rather than the Dhaka date: two moves on one day
  // would otherwise lose their order, and the first row is where the child is today.
  // An unparseable stamp sinks rather than scrambling the rest.
  const ordered = [...(rows ?? [])].sort((a, b) => {
    const ta = Date.parse(a.created_at)
    const tb = Date.parse(b.created_at)
    if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1
    return tb === ta ? a.id.localeCompare(b.id) : tb - ta
  })

  return ordered.map((row) => {
    const at = new Date(row.created_at)
    return {
      id: row.id,
      from: place(row.from_branch_id, row.from_branch_name),
      to: place(row.to_branch_id, row.to_branch_name),
      on: Number.isNaN(at.getTime()) ? null : todayInDhaka(at),
      by:
        row.moved_by === null
          ? 'unknown'
          : row.moved_by === labels.viewerId
            ? 'you'
            : 'other',
    } satisfies StudentTransfer
  })
}
