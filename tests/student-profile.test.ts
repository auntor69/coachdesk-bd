/**
 * The student profile's arithmetic.
 *
 * Three shapers, and what is tested is the part that inverts silently: which batches
 * appear when nothing has been recorded against them, whether a rate matches the one
 * SQL computes for the same rows, whether an absence survives to the screen, and
 * whether a credit on one invoice pays off a debt on another. None of those is
 * visible in a screenshot and every one of them is a wrong sentence said to a parent.
 *
 * Relative imports with extensions — `node --test` on TS, no tsconfig paths.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  attendanceByBatch,
  examMarks,
  feeHistory,
  PROFILE_ATTENDANCE_DAYS,
  PROFILE_EXAM_LIMIT,
  PROFILE_INVOICE_LIMIT,
  type EnrolledBatch,
  type ProfileInvoiceRow,
  type ProfileMarkRow,
  type ProfilePaymentRow,
  type ProfileResultRow,
  type ProfileSessionRow,
} from '../src/lib/students/profile.ts'

const PHYSICS: EnrolledBatch = { batchId: 'b-phy', label: 'HSC 26 Physics' }
const CHEM: EnrolledBatch = { batchId: 'b-chem', label: 'HSC 26 Chemistry' }

function session(id: string, batchId: string, date = '2026-08-01'): ProfileSessionRow {
  return { id, batch_id: batchId, session_date: date }
}

function mark(sessionId: string, status: ProfileMarkRow['status']): ProfileMarkRow {
  return { session_id: sessionId, status }
}

test('the windows are the documented ones', () => {
  // Guarding the numbers rather than the reasoning: each is a screen decision with
  // an argument written above it, and a silent edit to one changes what an owner is
  // told about a child without changing anything a reader of the diff would notice.
  assert.equal(PROFILE_ATTENDANCE_DAYS, 56)
  assert.equal(PROFILE_EXAM_LIMIT, 12)
  assert.equal(PROFILE_INVOICE_LIMIT, 12)
})

test('attendance: an enrolled batch with nothing recorded is still a row', () => {
  // The most actionable row the panel can produce — the register for that batch has
  // stopped being taken — and the one a query-driven list would silently omit.
  const rows = attendanceByBatch([PHYSICS, CHEM], [session('s1', 'b-phy')], [mark('s1', 'present')])

  assert.equal(rows.length, 2)
  const chem = rows.find((r) => r.batchId === 'b-chem')
  assert.ok(chem)
  assert.equal(chem.sessions, 0)
  assert.equal(chem.marked, 0)
  assert.equal(chem.ratePct, null)
})

test('attendance: rate is (present + late) over (present + late + absent)', () => {
  // The formula in 20260811000011, copied exactly. Excused leaves the denominator
  // rather than counting against the student: 3 of 4 counted, not 3 of 5.
  const rows = attendanceByBatch(
    [PHYSICS],
    ['s1', 's2', 's3', 's4', 's5'].map((id) => session(id, 'b-phy')),
    [
      mark('s1', 'present'),
      mark('s2', 'present'),
      mark('s3', 'late'),
      mark('s4', 'absent'),
      mark('s5', 'excused'),
    ],
  )

  const row = rows[0]
  assert.equal(row.sessions, 5)
  assert.equal(row.marked, 5)
  assert.equal(row.present, 2)
  assert.equal(row.late, 1)
  assert.equal(row.absent, 1)
  assert.equal(row.excused, 1)
  assert.equal(row.counted, 4)
  assert.equal(row.ratePct, 75)
})

test('attendance: every absence excused leaves no rate at all', () => {
  // Zero would say the student attended nothing. Null says nobody counted, which is
  // what happened — the same call the rate card and the SQL view both make.
  const rows = attendanceByBatch([PHYSICS], [session('s1', 'b-phy')], [mark('s1', 'excused')])

  assert.equal(rows[0].counted, 0)
  assert.equal(rows[0].ratePct, null)
  assert.equal(rows[0].excused, 1)
})

test('attendance: sessions held and marks against the student are counted apart', () => {
  // The gap between them is a register somebody stopped taking, which needs a
  // different conversation from a child who stopped turning up. A panel that only
  // knew "2 present" would report 100% attendance for a student marked twice in ten.
  const rows = attendanceByBatch(
    [PHYSICS],
    ['s1', 's2', 's3', 's4', 's5'].map((id) => session(id, 'b-phy')),
    [mark('s1', 'present'), mark('s2', 'present')],
  )

  assert.equal(rows[0].sessions, 5)
  assert.equal(rows[0].marked, 2)
  assert.equal(rows[0].ratePct, 100)
})

test('attendance: worst rate first, unmeasured batches last', () => {
  const rows = attendanceByBatch(
    [PHYSICS, CHEM, { batchId: 'b-math', label: 'HSC 26 Maths' }],
    [session('s1', 'b-phy'), session('s2', 'b-chem')],
    [mark('s1', 'present'), mark('s2', 'absent')],
  )

  // Chemistry 0%, Physics 100%, Maths nothing recorded.
  assert.deepEqual(
    rows.map((r) => r.batchId),
    ['b-chem', 'b-phy', 'b-math'],
  )
})

test('attendance: two enrolments pointing at one batch make one row', () => {
  // A paused enrolment and its replacement. Two identical lines side by side reads
  // as the screen having double-counted something.
  const rows = attendanceByBatch(
    [PHYSICS, { batchId: 'b-phy', label: 'HSC 26 Physics' }],
    [session('s1', 'b-phy')],
    [mark('s1', 'present')],
  )

  assert.equal(rows.length, 1)
  assert.equal(rows[0].sessions, 1)
  assert.equal(rows[0].marked, 1)
})

test('attendance: a mark whose session is unknown is dropped, not reattributed', () => {
  // Means the two queries' windows disagree. Putting the class in some other batch
  // would be a wrong figure; dropping it is a figure that is merely incomplete.
  const rows = attendanceByBatch([PHYSICS], [session('s1', 'b-phy')], [mark('s-orphan', 'absent')])

  assert.equal(rows[0].marked, 0)
  assert.equal(rows[0].absent, 0)
  assert.equal(rows[0].ratePct, null)
})

test('attendance: a session for a batch the student left is ignored', () => {
  const rows = attendanceByBatch([PHYSICS], [session('s1', 'b-phy'), session('s9', 'b-old')], [])

  assert.equal(rows.length, 1)
  assert.equal(rows[0].sessions, 1)
})

test('attendance: no enrolments is an empty panel and not a zero', () => {
  assert.deepEqual(attendanceByBatch([], [session('s1', 'b-phy')], [mark('s1', 'present')]), [])
})

test('attendance: null rows from a failed query are survivable', () => {
  const rows = attendanceByBatch([PHYSICS], null, undefined)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].sessions, 0)
  assert.equal(rows[0].ratePct, null)
})

function result(
  id: string,
  obtained: string | number | null,
  opts: {
    title?: string
    total?: string | number | null
    on?: string
    batch?: string | null
    absent?: boolean
  } = {},
): ProfileResultRow {
  return {
    id,
    obtained_marks: obtained,
    is_absent: opts.absent ?? false,
    exams: {
      title: opts.title ?? `Test ${id}`,
      total_marks: opts.total ?? 100,
      exam_date: opts.on ?? '2026-08-01',
      batch_id: opts.batch ?? 'b-phy',
    },
  }
}

const LABELS = new Map([
  ['b-phy', 'HSC 26 Physics'],
  ['b-chem', 'HSC 26 Chemistry'],
])

test('marks: ordered by the exam date, not the order they were entered', () => {
  // A teacher typing last week's test in on Sunday evening has not made it this
  // week's news. This is the screen a result gets read off to a parent.
  const rows = examMarks(
    [
      result('r1', 40, { on: '2026-06-01' }),
      result('r2', 50, { on: '2026-08-10' }),
      result('r3', 60, { on: '2026-07-05' }),
    ],
    LABELS,
  )

  assert.deepEqual(
    rows.map((r) => r.resultId),
    ['r2', 'r3', 'r1'],
  )
})

test('marks: two exams on one day hold their order across renders', () => {
  const rows = examMarks(
    [result('r1', 40, { title: 'Zoology', on: '2026-08-01' }), result('r2', 50, { title: 'Algebra', on: '2026-08-01' })],
    LABELS,
  )

  assert.deepEqual(
    rows.map((r) => r.title),
    ['Algebra', 'Zoology'],
  )
})

test('marks: an absence is a row with no figure, never a zero', () => {
  // Averaging an absence in as zero is how a screen turns "stopped turning up" into
  // "doing badly", and dropping it hides the thing worth a phone call.
  const rows = examMarks([result('r1', 0, { absent: true })], LABELS)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].absent, true)
  assert.equal(rows[0].obtained, null)
  assert.equal(rows[0].pct, null)
})

test('marks: an unentered result is not the same row as an absence', () => {
  const rows = examMarks([result('r1', null)], LABELS)

  assert.equal(rows[0].absent, false)
  assert.equal(rows[0].obtained, null)
  assert.equal(rows[0].pct, null)
})

test('marks: numeric over the wire is a string and still divides', () => {
  // PostgREST serialises numeric as a string. '37.5' / '50' has to be 75, not NaN.
  const rows = examMarks([result('r1', '37.5', { total: '50' })], LABELS)

  assert.equal(rows[0].obtained, 37.5)
  assert.equal(rows[0].total, 50)
  assert.equal(rows[0].pct, 75)
})

test('marks: a zero total leaves no percentage rather than dividing by it', () => {
  const rows = examMarks([result('r1', 0, { total: 0 })], LABELS)

  assert.equal(rows[0].obtained, 0)
  assert.equal(rows[0].pct, null)
})

test('marks: an embed arriving as a one-element array is read the same way', () => {
  const row: ProfileResultRow = {
    id: 'r1',
    obtained_marks: 80,
    is_absent: false,
    exams: [{ title: 'Weekly', total_marks: 100, exam_date: '2026-08-01', batch_id: 'b-chem' }],
  }

  const rows = examMarks([row], LABELS)
  assert.equal(rows[0].pct, 80)
  assert.equal(rows[0].batchLabel, 'HSC 26 Chemistry')
})

test('marks: a result with no exam behind it is dropped', () => {
  // RLS hid the exam, or it was deleted between the two reads. Either way there is
  // no title, no total and no date to sort by.
  const row: ProfileResultRow = { id: 'r1', obtained_marks: 80, is_absent: false, exams: null }
  assert.deepEqual(examMarks([row], LABELS), [])
})

test('marks: a batch with no label gets none rather than a wrong one', () => {
  // A result from a batch the student has left, which the label map does not cover.
  const rows = examMarks([result('r1', 70, { batch: 'b-gone' })], LABELS)
  assert.equal(rows[0].batchLabel, null)
})

function invoice(
  id: string,
  month: string | null,
  due: string | null,
  net: string | number,
  paid: string | number,
  remaining: string | number,
  /**
   * The waiver, when there is one. Optional because almost no bill has one — and a
   * bill without one has its fee and its net equal, which is exactly what the view
   * returns for it.
   */
  waiver?: {
    billed: string | number
    discount: string | number
    reason?: string | null
  },
): ProfileInvoiceRow {
  return {
    id,
    period_month: month,
    due_date: due,
    amount_bdt: waiver?.billed ?? net,
    discount_bdt: waiver?.discount ?? 0,
    discount_reason: waiver?.reason ?? null,
    net_bdt: net,
    paid_bdt: paid,
    remaining_bdt: remaining,
  }
}

const TODAY = '2026-08-26'

test('fees: newest month first — the opposite of the fee board, on purpose', () => {
  // The board is a worklist and the oldest debt goes on top. This panel answers "has
  // this family paid", asked by somebody looking at that family, and the answer is
  // almost always about the current month.
  const { lines } = feeHistory(
    [
      invoice('i1', '2026-06-01', '2026-06-10', 2000, 2000, 0),
      invoice('i2', '2026-08-01', '2026-08-10', 2000, 0, 2000),
      invoice('i3', '2026-07-01', '2026-07-10', 2000, 2000, 0),
    ],
    TODAY,
  )

  assert.deepEqual(
    lines.map((l) => l.invoiceId),
    ['i2', 'i3', 'i1'],
  )
})

test('fees: a credit on one invoice does not pay off a debt on another', () => {
  // A family that overpaid ৳500 in June and skipped July owes July in full. Netting
  // the two would tell an owner they are square — see tallyOutstanding.
  const { outstanding, credit } = feeHistory(
    [
      invoice('i1', '2026-06-01', '2026-06-10', 2000, 2500, -500),
      invoice('i2', '2026-07-01', '2026-07-10', 2000, 0, 2000),
    ],
    TODAY,
  )

  assert.equal(outstanding, 2000)
  assert.equal(credit, 500)
})

test('fees: overdueSince is the oldest unpaid due date', () => {
  // The figure that turns "৳4,000 owed" into a sentence worth saying out loud.
  const { overdueSince } = feeHistory(
    [
      invoice('i1', '2026-06-01', '2026-06-10', 2000, 0, 2000),
      invoice('i2', '2026-07-01', '2026-07-10', 2000, 0, 2000),
    ],
    TODAY,
  )

  assert.equal(overdueSince, '2026-06-10')
})

test('fees: a settled invoice past its date is not overdue', () => {
  const { overdueSince, outstanding } = feeHistory(
    [invoice('i1', '2026-06-01', '2026-06-10', 2000, 2000, 0)],
    TODAY,
  )

  assert.equal(overdueSince, null)
  assert.equal(outstanding, 0)
})

test('fees: an invoice paid in advance of its due date is not late', () => {
  // daysLate is negative before the date, matching the fee board's convention, so a
  // single comparison tells the row whether to shout.
  const { lines, overdueSince } = feeHistory(
    [invoice('i1', '2026-09-01', '2026-09-10', 2000, 0, 2000)],
    TODAY,
  )

  assert.equal(lines[0].daysLate, -15)
  assert.equal(lines[0].late, false)
  assert.equal(overdueSince, null)
})

test('fees: due today is not yet late', () => {
  const { lines } = feeHistory([invoice('i1', '2026-08-01', TODAY, 2000, 0, 2000)], TODAY)

  assert.equal(lines[0].daysLate, 0)
  assert.equal(lines[0].late, false)
})

test('fees: a missing period month falls back to the due date, never to blank', () => {
  // Same fallback the fee board's toRow uses. A row headed with the wrong month is
  // worse than one headed with none, and a row headed with none is worse than this.
  const { lines } = feeHistory([invoice('i1', null, '2026-07-10', 2000, 0, 2000)], TODAY)

  assert.equal(lines[0].periodMonth, '2026-07-01')
})

test('fees: an invoice with no id at all is dropped', () => {
  // The view types every column nullable and never returns one without an id; with
  // no id there is no key to render under.
  const { lines } = feeHistory(
    [invoice('i1', '2026-08-01', '2026-08-10', 2000, 0, 2000), { ...invoice('x', null, null, 0, 0, 0), id: null }],
    TODAY,
  )

  assert.equal(lines.length, 1)
  assert.equal(lines[0].invoiceId, 'i1')
})

test('fees: numeric strings from the view add up as money', () => {
  const { lines, outstanding } = feeHistory(
    [invoice('i1', '2026-08-01', '2026-08-10', '2000.00', '500.50', '1499.50')],
    TODAY,
  )

  assert.equal(lines[0].net, 2000)
  assert.equal(lines[0].paid, 500.5)
  assert.equal(outstanding, 1499.5)
})

test('fees: nothing billed is an empty panel, not a paid-up one', () => {
  const empty = feeHistory(null, TODAY)

  assert.deepEqual(empty.lines, [])
  assert.equal(empty.outstanding, 0)
  assert.equal(empty.credit, 0)
  assert.equal(empty.overdueSince, null)
})

test('fees: a waiver arrives as three figures and none of them is recomputed', () => {
  // ৳2,000 charged, ৳500 waived, ৳1,500 payable, ৳1,000 in — so ৳500 still owed.
  // The point of the assertion is that all four come off the view: the moment this
  // file works out net from billed minus discount there are two answers to what the
  // family owes, and the fee board's is the other one.
  const { lines } = feeHistory(
    [
      invoice('i1', '2026-08-01', '2026-08-10', 1500, 1000, 500, {
        billed: 2000,
        discount: 500,
        reason: 'দুই ভাইবোন একসাথে পড়ে',
      }),
    ],
    TODAY,
  )

  assert.equal(lines[0].billed, 2000)
  assert.equal(lines[0].discount, 500)
  assert.equal(lines[0].net, 1500)
  assert.equal(lines[0].remaining, 500)
  assert.equal(lines[0].discountReason, 'দুই ভাইবোন একসাথে পড়ে')
})

test('fees: a bill with no waiver reports none, and its fee is its net', () => {
  // The condition the row is drawn on. `discount > 0` and not `discount !== null`,
  // because the column defaults to 0 and the view hands back '0.00'.
  const { lines } = feeHistory(
    [invoice('i1', '2026-08-01', '2026-08-10', '2000.00', 0, '2000.00')],
    TODAY,
  )

  assert.equal(lines[0].discount, 0)
  assert.equal(lines[0].billed, 2000)
  assert.equal(lines[0].discountReason, null)
})

test('fees: a waiver reason of only whitespace is no reason at all', () => {
  // Otherwise the screen prints "ছাড়ের কারণ:" with nothing after it, which reads as
  // a reason the app has lost rather than one nobody wrote.
  const { lines } = feeHistory(
    [
      invoice('i1', '2026-08-01', '2026-08-10', 1500, 0, 1500, {
        billed: 2000,
        discount: 500,
        reason: '   ',
      }),
    ],
    TODAY,
  )

  assert.equal(lines[0].discountReason, null)
})

test('fees: the whole fee waived is a bill of nothing, not a missing bill', () => {
  // A real case — a student carried through a term free — and the row still belongs
  // on the panel: it is the record of the arrangement.
  const { lines, outstanding } = feeHistory(
    [
      invoice('i1', '2026-08-01', '2026-08-10', 0, 0, 0, {
        billed: 2000,
        discount: 2000,
        reason: 'পুরো ফি ছাড়',
      }),
    ],
    TODAY,
  )

  assert.equal(lines.length, 1)
  assert.equal(lines[0].billed, 2000)
  assert.equal(lines[0].discount, 2000)
  assert.equal(lines[0].net, 0)
  assert.equal(lines[0].late, false)
  assert.equal(outstanding, 0)
})

/**
 * A payment as the receipts query returns it. `at` is a timestamptz in UTC, written
 * out in full here rather than as a date, because half the point of these tests is
 * that the conversion to a Dhaka day happens and is not a slice.
 */
function payment(
  id: string,
  invoiceId: string,
  receiptNo: number,
  amount: string | number,
  at: string,
): ProfilePaymentRow {
  return {
    id,
    invoice_id: invoiceId,
    receipt_no: receiptNo,
    amount_bdt: amount,
    paid_at: at,
  }
}

test('fees: every slip against a bill is carried, oldest first', () => {
  // The order the money arrived, which is the order a parent reconstructs it in.
  const { lines } = feeHistory(
    [invoice('i1', '2026-08-01', '2026-08-10', 2000, 2000, 0)],
    TODAY,
    [
      payment('p2', 'i1', 108, 1500, '2026-08-12T05:00:00Z'),
      payment('p1', 'i1', 104, 500, '2026-08-05T05:00:00Z'),
    ],
  )

  assert.deepEqual(
    lines[0].receipts.map((r) => r.receiptNo),
    [104, 108],
  )
  assert.deepEqual(
    lines[0].receipts.map((r) => r.paymentId),
    ['p1', 'p2'],
  )
})

test('fees: two slips in one second are ordered by receipt number', () => {
  // paid_at cannot settle them, and receipt_no cannot be trusted alone either — an
  // imported slip carries a number from the old paper book. Both, in that order.
  const { lines } = feeHistory(
    [invoice('i1', '2026-08-01', '2026-08-10', 2000, 2000, 0)],
    TODAY,
    [
      payment('p2', 'i1', 109, 1000, '2026-08-12T05:00:00Z'),
      payment('p1', 'i1', 108, 1000, '2026-08-12T05:00:00Z'),
    ],
  )

  assert.deepEqual(
    lines[0].receipts.map((r) => r.receiptNo),
    [108, 109],
  )
})

test('fees: a slip taken after midnight Dhaka is dated the Dhaka day', () => {
  // 2026-08-11T20:00:00Z is 2am on the 12th in Dhaka. Slicing ten characters off the
  // ISO string would date the receipt to the 11th, and the date on a receipt is what
  // a dispute turns on.
  const { lines } = feeHistory(
    [invoice('i1', '2026-08-01', '2026-08-10', 2000, 2000, 0)],
    TODAY,
    [payment('p1', 'i1', 104, 2000, '2026-08-11T20:00:00Z')],
  )

  assert.equal(lines[0].receipts[0].on, '2026-08-12')
})

test('fees: a refund is a slip like any other, and says which way it went', () => {
  // A negative fee_payments row is the product's only way of handing money back, so
  // it is the same slip and the same link — a parent given cash back has nothing in
  // writing until it is printed.
  const { lines } = feeHistory(
    [invoice('i1', '2026-08-01', '2026-08-10', 2000, 1500, 500)],
    TODAY,
    [
      payment('p1', 'i1', 104, 2000, '2026-08-05T05:00:00Z'),
      payment('p2', 'i1', 111, -500, '2026-08-20T05:00:00Z'),
    ],
  )

  assert.deepEqual(
    lines[0].receipts.map((r) => r.refund),
    [false, true],
  )
  assert.equal(lines[0].receipts[1].amount, -500)
})

test('fees: the slips against a bill add up to what the view says was paid', () => {
  // Not asserted arithmetic — asserted equality with a figure this file never
  // computes. `paid_bdt` on the view is sum(amount_bdt) over exactly these rows, and
  // the panel prints both, so a truncated list would read as money the app has lost.
  const { lines } = feeHistory(
    [invoice('i1', '2026-08-01', '2026-08-10', 2000, 1500, 500)],
    TODAY,
    [
      payment('p1', 'i1', 104, '2000.00', '2026-08-05T05:00:00Z'),
      payment('p2', 'i1', 111, '-500.00', '2026-08-20T05:00:00Z'),
    ],
  )

  const summed = lines[0].receipts.reduce((total, r) => total + r.amount, 0)
  assert.equal(summed, lines[0].paid)
})

test('fees: a slip is filed under its own bill and never another', () => {
  const { lines } = feeHistory(
    [
      invoice('i1', '2026-08-01', '2026-08-10', 2000, 2000, 0),
      invoice('i2', '2026-07-01', '2026-07-10', 2000, 2000, 0),
    ],
    TODAY,
    [
      payment('p1', 'i2', 100, 2000, '2026-07-05T05:00:00Z'),
      payment('p2', 'i1', 104, 2000, '2026-08-05T05:00:00Z'),
    ],
  )

  assert.deepEqual(
    lines.map((l) => l.receipts.map((r) => r.receiptNo)),
    [[104], [100]],
  )
})

test('fees: a slip for a bill that is not on the panel is dropped, not reattached', () => {
  // Reachable whenever the twelve-invoice window cuts a bill whose payment is still
  // in the list. Attaching it to some other month would put a receipt under a bill it
  // was never raised against — worse than leaving it off a panel that says it is a
  // window.
  const { lines } = feeHistory(
    [invoice('i1', '2026-08-01', '2026-08-10', 2000, 2000, 0)],
    TODAY,
    [payment('p1', 'i-old', 40, 2000, '2025-01-05T05:00:00Z')],
  )

  assert.equal(lines.length, 1)
  assert.deepEqual(lines[0].receipts, [])
})

test('fees: no payments given is no slips listed, not a throw', () => {
  // The caller skips the query for a reader it would tell nothing new, so both the
  // omitted argument and a null from a failed query have to land somewhere safe.
  assert.deepEqual(
    feeHistory([invoice('i1', '2026-08-01', '2026-08-10', 2000, 0, 2000)], TODAY)
      .lines[0].receipts,
    [],
  )
  assert.deepEqual(
    feeHistory([invoice('i1', '2026-08-01', '2026-08-10', 2000, 0, 2000)], TODAY, null)
      .lines[0].receipts,
    [],
  )
})
