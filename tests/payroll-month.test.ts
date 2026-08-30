/**
 * A month's payroll: what it counts, what it refuses to fold together, and who it chases.
 *
 * THE FIGURE UNDER TEST HERE LEAVES THE SCREEN. 20260811000049's `center_profit_month`
 * sums `salary_payments.amount_bdt` grouped by `for_month`, so `tallyMonth().paid` is the
 * same arithmetic over the same rows — and an owner reads the difference between it and
 * their collections as the answer to whether the centre is worth running. A sum that has
 * never been run against a fixture is a sum nobody has checked.
 *
 * THE TRAP THIS FILE EXISTS FOR: "already paid" cannot be a constraint. 20260811000044 has
 * no unique index on (payee, for_month) on purpose — half a salary on the 5th and half on
 * the 20th is two real rows, and a reversing correction is a third — so every guard against
 * paying somebody twice is arithmetic in ../src/lib/payroll/month.ts and nothing else. The
 * tests below pin the three figures a screen needs to say it: what has been handed over,
 * in how many rows, and what is left.
 *
 * THE SECOND TRAP: an overpayment must not cancel somebody else's shortfall. `outstanding`
 * is summed per line over positive remainders only, because `agreed − paid` across a whole
 * centre would let a teacher paid ৳2,000 over hide a cook who has had nothing — and the
 * screen would report the month settled while somebody is still waiting for their salary.
 *
 * Relative imports with extensions — `node --test` on TS, no tsconfig paths.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MONTHLY_BASIS, PER_CLASS_BASIS } from '../src/lib/payroll/basis.ts'
import { payeeValue, type Payee, type TermsSourceRow } from '../src/lib/payroll/bill.ts'
import {
  payLines,
  tallyMonth,
  voucherLines,
  type PaymentSourceRow,
} from '../src/lib/payroll/month.ts'
import { sumTaka } from '../src/lib/money.ts'

/**
 * One live agreement. `net_bdt` is computed from the four parts for the reason the bill's
 * own fixture gives: the column is generated, so a row that let the net disagree with the
 * parts is a row Postgres could never have handed back.
 */
function terms(
  id: string,
  opts: {
    employee?: string
    teacher?: string
    basis?: TermsSourceRow['basis']
    basic?: string | number
    allowances?: string | number
    other?: string | number
    deductions?: string | number
    perClass?: string | number | null
    since?: string
    note?: string | null
  } = {},
): TermsSourceRow {
  const basis = opts.basis ?? MONTHLY_BASIS
  const basic = opts.basic ?? (basis === PER_CLASS_BASIS ? 0 : 13000)
  const allowances = opts.allowances ?? 0
  const other = opts.other ?? 0
  const deductions = opts.deductions ?? 0

  return {
    id,
    employee_id: opts.teacher ? null : (opts.employee ?? 'emp-1'),
    teacher_id: opts.teacher ?? null,
    basis,
    basic_bdt: basic,
    allowances_bdt: allowances,
    other_bdt: other,
    deductions_bdt: deductions,
    net_bdt: sumTaka([
      Number(basic),
      Number(allowances),
      Number(other),
      -Number(deductions),
    ]),
    per_class_bdt: opts.perClass ?? (basis === PER_CLASS_BASIS ? 350 : null),
    effective_from: opts.since ?? '2026-08-01',
    note: opts.note ?? null,
  }
}

/**
 * One payment already on the record.
 *
 * `amount_bdt` is passed rather than derived, unlike the terms fixture, and for the opposite
 * reason: the screen queries the generated column and never the four parts, so what a test
 * needs to control is the one number PostgREST hands back. Strings where a test is about the
 * serialisation, numbers where it is about the arithmetic.
 */
function payment(
  id: string,
  amount: string | number | null,
  opts: {
    employee?: string
    teacher?: string
    voucherNo?: number
    method?: PaymentSourceRow['method']
    reference?: string | null
    note?: string | null
    paidAt?: string
  } = {},
): PaymentSourceRow {
  return {
    id,
    voucher_no: opts.voucherNo ?? 1,
    employee_id: opts.teacher ? null : (opts.employee ?? 'emp-1'),
    teacher_id: opts.teacher ?? null,
    amount_bdt: amount,
    method: opts.method ?? 'cash',
    reference: opts.reference ?? null,
    note: opts.note ?? null,
    paid_at: opts.paidAt ?? '2026-08-05T09:00:00+00:00',
  }
}

/** Somebody the centre pays, as the page hands them over. */
function payee(
  id: string,
  opts: { kind?: Payee['kind']; name?: string; job?: string | null; active?: boolean } = {},
): Payee {
  return {
    id,
    kind: opts.kind ?? 'employee',
    name: opts.name ?? 'Rahim Uddin',
    job: opts.job ?? null,
    active: opts.active ?? true,
  }
}

test('a line carries what the screen prints, field for field', () => {
  const lines = payLines(
    [terms('t1', { employee: 'emp-9', basic: 12000, allowances: 1500, other: 500, deductions: 1000 })],
    [],
    [payee('emp-9', { name: 'Sultana Begum', job: 'হিসাবরক্ষক' })],
  )

  assert.deepEqual(lines[0], {
    payeeKind: 'employee',
    payeeId: 'emp-9',
    name: 'Sultana Begum',
    job: 'হিসাবরক্ষক',
    gone: false,
    terms: {
      termsId: 't1',
      basis: MONTHLY_BASIS,
      net: 13000,
      perClass: null,
      parts: { basic: 12000, allowances: 1500, other: 500, deductions: 1000 },
    },
    paid: 0,
    payments: 0,
    remaining: 13000,
    pending: true,
  })
})

test('the parts are the agreement, so the form opens on what was agreed', () => {
  // The prefill is the whole reason `parts` exists. A form that opened empty would make an
  // owner retype four figures they already agreed, on a phone, fourteen times a month — and
  // a retyped figure is a figure that can be typed differently.
  const lines = payLines(
    [terms('t1', { basic: '12000.00', allowances: '1500.50', other: '0.00', deductions: '250.25' })],
    [],
    [],
  )

  assert.deepEqual(lines[0].terms?.parts, {
    basic: 12000,
    allowances: 1500.5,
    other: 0,
    deductions: 250.25,
  })
  // Read from the generated column rather than re-added here: the payment that results is
  // generated from the parts the form submits, and this is the figure the month is measured
  // against. Both come out of the same row, so they agree — the assertion is that neither is
  // invented.
  assert.equal(lines[0].terms?.net, 13250.25)
  assert.equal(lines[0].remaining, 13250.25)
})

test('nothing paid is a full shortfall and a row that needs attention', () => {
  const lines = payLines([terms('t1', { basic: 8000 })], [], [])

  assert.equal(lines[0].paid, 0)
  assert.equal(lines[0].payments, 0)
  assert.equal(lines[0].remaining, 8000)
  assert.equal(lines[0].pending, true)
})

test('two instalments for one month are summed and counted, not treated as a mistake', () => {
  // 20260811000044 has no unique index on (payee, for_month) on purpose. Half on the 5th and
  // half on the 20th is what a centre short of cash actually does, and both rows are real.
  const lines = payLines(
    [terms('t1', { basic: 13000 })],
    [payment('p1', 6000), payment('p2', 7000, { voucherNo: 2 })],
    [],
  )

  assert.equal(lines[0].paid, 13000)
  assert.equal(lines[0].payments, 2)
  assert.equal(lines[0].remaining, 0)
  assert.equal(lines[0].pending, false)
})

test('a half-paid month is still pending, and says by how much', () => {
  const lines = payLines([terms('t1', { basic: 13000 })], [payment('p1', 5000)], [])

  assert.equal(lines[0].paid, 5000)
  assert.equal(lines[0].remaining, 8000)
  assert.equal(lines[0].pending, true)
})

test('a reversing payment takes the money back off the month and re-opens the shortfall', () => {
  // The only correction this table permits from a browser: 20260811000044 revokes DELETE and
  // the guard trigger says "enter a reversing negative payment instead".
  const lines = payLines(
    [terms('t1', { basic: 13000 })],
    [payment('p1', 13000), payment('p2', -13000, { voucherNo: 2 })],
    [],
  )

  assert.equal(lines[0].paid, 0)
  // Both rows counted, because both are on the record and the register prints both. A screen
  // reading "0 payments" over two vouchers would be a screen nobody could reconcile.
  assert.equal(lines[0].payments, 2)
  assert.equal(lines[0].remaining, 13000)
  assert.equal(lines[0].pending, true)
})

test('an overpayment reads as a negative remainder rather than a settled month', () => {
  const lines = payLines([terms('t1', { basic: 13000 })], [payment('p1', 13500)], [])

  assert.equal(lines[0].remaining, -500)
  // Not pending: the money is there and then some. What the negative figure is for is an
  // owner seeing it once, which a clamp to zero would deny them for ever.
  assert.equal(lines[0].pending, false)
})

test('a per-class agreement has no shortfall, because nothing knows what the month cost', () => {
  // 20260811000044 refuses to store a monthly figure for a per-class teacher — it would go
  // stale the next time they taught — so `remaining` is not zero here, it is unknown, and the
  // two must never look the same on a screen somebody pays people from.
  const lines = payLines(
    [terms('t1', { teacher: 'tea-1', basis: PER_CLASS_BASIS, perClass: 350 })],
    [],
    [],
  )

  assert.equal(lines[0].terms?.net, 0)
  assert.equal(lines[0].terms?.perClass, 350)
  assert.equal(lines[0].remaining, null)
  // Pending on nothing paid: a per-class teacher who has had nothing this month is exactly as
  // unpaid as a monthly one, and the rate is on the row for them to work it out.
  assert.equal(lines[0].pending, true)
})

test('a per-class teacher who has been paid something stops being chased', () => {
  const lines = payLines(
    [terms('t1', { teacher: 'tea-1', basis: PER_CLASS_BASIS })],
    [payment('p1', 4200, { teacher: 'tea-1' })],
    [],
  )

  assert.equal(lines[0].paid, 4200)
  assert.equal(lines[0].remaining, null)
  // False, and this is a judgement rather than arithmetic: twelve classes at ৳350 is ৳4,200
  // and thirteen is ৳4,550, and nothing here knows which. A permanent prompt on the row would
  // be the screen asking a question it cannot check the answer to.
  assert.equal(lines[0].pending, false)
})

test('money on a month with no live agreement keeps its line', () => {
  // Paid on the 5th, agreement stood down on the 20th — or a final settlement after somebody
  // left. The money is on the record either way, and a list built from live agreements alone
  // would hide a row the month's total includes.
  const lines = payLines(
    [terms('t1', { employee: 'emp-1', basic: 9000 })],
    [payment('p1', 9000), payment('p2', 5000, { employee: 'emp-2', voucherNo: 2 })],
    [payee('emp-1', { name: 'Rahim' }), payee('emp-2', { name: 'Karim', active: false })],
  )

  assert.equal(lines.length, 2)
  // Live agreements first, then the rest: the page sorts, but the shape of the list is what
  // lets it tell the two groups apart.
  assert.equal(lines[0].name, 'Rahim')

  const settled = lines[1]
  assert.equal(settled.name, 'Karim')
  assert.equal(settled.terms, null)
  assert.equal(settled.paid, 5000)
  assert.equal(settled.remaining, null)
  // Not chased: nothing says what they were due, and a prompt here would be an obligation
  // invented out of an absent agreement.
  assert.equal(settled.pending, false)
  assert.equal(settled.gone, true)
})

test('an agreement for somebody switched off is flagged and kept on the month', () => {
  const lines = payLines(
    [terms('t1', { employee: 'emp-1', basic: 8000 })],
    [],
    [payee('emp-1', { name: 'Cook', active: false })],
  )

  assert.equal(lines[0].gone, true)
  // Still counted and still chased. The overstatement is the point: a cook who left in March
  // is on the August wage bill at ৳8,000 until somebody stands the agreement down, and
  // dropping the row would quietly correct a figure the centre is wrong about.
  assert.equal(lines[0].remaining, 8000)
  assert.equal(tallyMonth(lines).goneCount, 1)
})

test('a payee with no name keeps their line and their money', () => {
  const lines = payLines([terms('t1', { employee: 'ghost', basic: 5000 })], [payment('p1', 5000, { employee: 'ghost' })], [])

  assert.equal(lines[0].name, null)
  assert.equal(lines[0].paid, 5000)
  // Unknown counts as present rather than gone, matching the bill: a payee we could not put a
  // name to is not evidence that they left.
  assert.equal(lines[0].gone, false)
})

test('a teacher and an employee sharing an id do not share a salary', () => {
  // The two tables have separate uuid namespaces, so nothing stops a collision. A map keyed on
  // the bare id would hand a cook's ৳8,000 to a teacher.
  const lines = payLines(
    [terms('t1', { employee: 'same' }), terms('t2', { teacher: 'same' })],
    [payment('p1', 8000, { employee: 'same' })],
    [],
  )

  const emp = lines.find((l) => l.payeeKind === 'employee')
  const tea = lines.find((l) => l.payeeKind === 'teacher')

  assert.equal(emp?.paid, 8000)
  assert.equal(tea?.paid, 0)
  assert.equal(tea?.payments, 0)
  assert.equal(payeeValue('employee', 'same') === payeeValue('teacher', 'same'), false)
})

test('an amount that will not parse is dropped from the month, not counted as nothing', () => {
  // The same rule in the tally and the register, because a row the register shows and the
  // total does not include is a page that cannot be reconciled.
  const rows = [payment('p1', 6000), payment('p2', 'কিছু নয়', { voucherNo: 2 }), payment('p3', null, { voucherNo: 3 })]
  const lines = payLines([terms('t1', { basic: 13000 })], rows, [])

  assert.equal(lines[0].paid, 6000)
  assert.equal(lines[0].payments, 1)
  assert.equal(voucherLines(rows, []).length, 1)
})

test('the money survives PostgREST serialising numeric as a string', () => {
  const lines = payLines(
    [terms('t1', { basic: '13000.00' })],
    [payment('p1', '6500.50'), payment('p2', '6499.50', { voucherNo: 2 })],
    [],
  )

  assert.equal(lines[0].paid, 13000)
  assert.equal(lines[0].remaining, 0)
})

test('nothing at all is a month of zeroes rather than a crash', () => {
  assert.deepEqual(payLines(null, null, []), [])
  assert.deepEqual(payLines(undefined, undefined, []), [])
  assert.deepEqual(voucherLines(null, []), [])

  const tally = tallyMonth([])
  assert.deepEqual(tally, {
    paid: 0,
    payments: 0,
    agreed: 0,
    monthlyCount: 0,
    perClassCount: 0,
    outstanding: 0,
    pendingCount: 0,
    goneCount: 0,
    unagreedCount: 0,
  })
})

test('an overpayment cannot cancel somebody else being unpaid', () => {
  // THE ASSERTION THIS FILE EXISTS FOR. `agreed − paid` over the whole centre is 26000 − 26000
  // = 0, and a screen printing that says the month is settled while the cook has had nothing.
  const lines = payLines(
    [
      terms('t1', { employee: 'emp-1', basic: 13000 }),
      terms('t2', { employee: 'emp-2', basic: 13000 }),
    ],
    [payment('p1', 26000, { employee: 'emp-1' })],
    [],
  )

  const tally = tallyMonth(lines)
  assert.equal(tally.agreed, 26000)
  assert.equal(tally.paid, 26000)
  assert.equal(tally.outstanding, 13000)
  assert.equal(tally.pendingCount, 1)
})

test('the agreed figure covers the monthly rows and says how many it does not', () => {
  const lines = payLines(
    [
      terms('t1', { employee: 'emp-1', basic: 13000 }),
      terms('t2', { employee: 'emp-2', basic: 8000 }),
      terms('t3', { teacher: 'tea-1', basis: PER_CLASS_BASIS }),
      terms('t4', { teacher: 'tea-2', basis: PER_CLASS_BASIS }),
    ],
    [],
    [],
  )

  const tally = tallyMonth(lines)
  assert.equal(tally.agreed, 21000)
  assert.equal(tally.monthlyCount, 2)
  assert.equal(tally.perClassCount, 2)
  // Every live agreement is in exactly one of the two counts, which is the property that lets
  // a reader see which rows the total covers. Asserted rather than assumed.
  assert.equal(tally.monthlyCount + tally.perClassCount, lines.length)
  assert.equal(tally.pendingCount, 4)
})

test('the month total is what the profit line will subtract', () => {
  // 20260811000049 sums `amount_bdt` over `for_month`, including the rows this screen shows as
  // unagreed and including corrections. If these two ever disagree, one of them is reading the
  // wrong month.
  const rows = [
    payment('p1', 13000, { employee: 'emp-1' }),
    payment('p2', 4200, { teacher: 'tea-1', voucherNo: 2 }),
    payment('p3', -13000, { employee: 'emp-1', voucherNo: 3 }),
    payment('p4', 5000, { employee: 'gone-1', voucherNo: 4 }),
  ]
  const lines = payLines(
    [terms('t1', { employee: 'emp-1', basic: 13000 }), terms('t2', { teacher: 'tea-1', basis: PER_CLASS_BASIS })],
    rows,
    [],
  )

  const tally = tallyMonth(lines)
  assert.equal(tally.paid, 9200)
  assert.equal(tally.paid, sumTaka(voucherLines(rows, []).map((v) => v.amount)))
  // Rows, not people: four vouchers over three payees.
  assert.equal(tally.payments, 4)
  assert.equal(tally.unagreedCount, 1)
})

test('a register line carries what the table prints, field for field', () => {
  const lines = voucherLines(
    [
      payment('p1', '13000.00', {
        employee: 'emp-9',
        voucherNo: 41,
        method: 'bkash',
        reference: 'BKX7712',
        note: 'আগস্টের বেতন',
        paidAt: '2026-09-02T04:30:00+00:00',
      }),
    ],
    [payee('emp-9', { name: 'Sultana Begum', job: 'হিসাবরক্ষক' })],
  )

  assert.deepEqual(lines[0], {
    id: 'p1',
    voucherNo: 41,
    name: 'Sultana Begum',
    job: 'হিসাবরক্ষক',
    amount: 13000,
    method: 'bkash',
    reference: 'BKX7712',
    note: 'আগস্টের বেতন',
    paidAt: '2026-09-02T04:30:00+00:00',
    correction: false,
  })
})

test('a reversing row is flagged in the register rather than left as one minus sign', () => {
  const lines = voucherLines([payment('p1', -13000), payment('p2', 13000, { voucherNo: 2 })], [])

  assert.equal(lines[0].correction, true)
  assert.equal(lines[1].correction, false)
})

test('the register keeps the order the query chose', () => {
  // `paid_at desc, voucher_no desc` is decided in the page's query and printed as it arrives.
  // Re-sorting here would be this module disagreeing with the page about which register it is
  // describing.
  const lines = voucherLines(
    [payment('p3', 1, { voucherNo: 9 }), payment('p1', 2, { voucherNo: 4 }), payment('p2', 3, { voucherNo: 7 })],
    [],
  )

  assert.deepEqual(
    lines.map((l) => l.voucherNo),
    [9, 4, 7],
  )
})

test('a voucher for somebody in neither list still shows', () => {
  const lines = voucherLines([payment('p1', 5000, { employee: 'ghost' })], [payee('emp-1')])

  assert.equal(lines[0].name, null)
  assert.equal(lines[0].job, null)
  assert.equal(lines[0].amount, 5000)
})
