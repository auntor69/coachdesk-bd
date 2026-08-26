import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildReport,
  isReportId,
  REPORT_IDS,
  NEEDS_MONTH,
  MAX_EXPORT_ROWS,
  type BuildResult,
  type ReportContext,
  type Sheet,
} from '../src/lib/export/reports.ts'
import { dict } from '../src/lib/i18n/index.ts'
import { todayInDhaka } from '../src/lib/bd/time.ts'

/**
 * What goes in the file an owner hands to their accountant.
 *
 * The builders are the one place in the product where a mistake is invisible: a
 * screen with a wrong figure on it gets questioned, a spreadsheet column that is
 * one month out gets reconciled against a bank statement and blamed on the bank. So
 * these tests are mostly about boundaries and completeness — the Dhaka month cutoff,
 * whether a dropped student is in the roster, whether paging returns everything —
 * rather than about whether a heading reads well.
 *
 * Supabase is stubbed rather than mocked out of the picture, because half of what is
 * being tested is the *query*: which filters were applied, in which order the pages
 * were asked for, and whether a second round trip happened at all.
 */

/* -------------------------------------------------------------------------- */
/* The stub                                                                   */
/* -------------------------------------------------------------------------- */

type Query = {
  table: string
  select: string
  /** Recorded as `op column value` so an assertion reads like the call did. */
  filters: string[]
  orders: string[]
  range: [number, number] | null
}

type Stub = { rows?: unknown[]; error?: string }

/**
 * A chainable stand-in for the two or three PostgREST calls a builder makes.
 *
 * `.range()` is the only terminal — everything else records and returns itself —
 * which mirrors the real client closely enough that a builder written against it
 * cannot compile against this and then fail against Supabase for a reason this
 * would have caught.
 */
function fake(tables: Record<string, Stub>) {
  const queries: Query[] = []

  const supabase = {
    from(table: string) {
      // Pushed here rather than in `.select()`, so one entry is one round trip and
      // the length of this array is the page count.
      const q: Query = { table, select: '', filters: [], orders: [], range: null }
      queries.push(q)

      const chain = {
        select(cols: string) {
          q.select = cols
          return chain
        },
        eq(column: string, value: unknown) {
          q.filters.push(`eq ${column} ${String(value)}`)
          return chain
        },
        gte(column: string, value: unknown) {
          q.filters.push(`gte ${column} ${String(value)}`)
          return chain
        },
        lt(column: string, value: unknown) {
          q.filters.push(`lt ${column} ${String(value)}`)
          return chain
        },
        is(column: string, value: unknown) {
          q.filters.push(`is ${column} ${String(value)}`)
          return chain
        },
        order(column: string) {
          q.orders.push(column)
          return chain
        },
        range(from: number, to: number) {
          q.range = [from, to]
          const stub = tables[table]
          if (!stub || stub.error !== undefined) {
            return Promise.resolve({
              data: null,
              error: { message: stub?.error ?? `no stub for ${table}` },
            })
          }
          return Promise.resolve({ data: (stub.rows ?? []).slice(from, to + 1), error: null })
        },
      }

      return chain
    },
  }

  return { queries, supabase: supabase as unknown as ReportContext['supabase'] }
}

function context(
  supabase: ReportContext['supabase'],
  over: Partial<ReportContext> = {},
): ReportContext {
  return {
    supabase,
    centerId: 'center-1',
    month: '2026-08-01',
    locale: 'bn',
    ...over,
  }
}

/** Unwraps a successful build, and fails with the reason rather than a type error. */
function sheetOf(result: BuildResult): Sheet {
  if (!result.ok) assert.fail(`build failed: ${result.reason}`)
  return result.sheet
}

function rowsOf(table: string, n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${table}-${i}`, name: `row ${i}` }))
}

/* -------------------------------------------------------------------------- */
/* The catalogue                                                              */
/* -------------------------------------------------------------------------- */

test('only the five known report ids are accepted', () => {
  for (const id of REPORT_IDS) assert.equal(isReportId(id), true)
  // A hand-edited URL, and the two that a loose `in` check would have let through.
  assert.equal(isReportId('payments'), false)
  assert.equal(isReportId(''), false)
  assert.equal(isReportId('__proto__'), false)
  assert.equal(isReportId('Students'), false)
})

test('every report says whether it needs a month, and has words in both languages', () => {
  assert.deepEqual(Object.keys(NEEDS_MONTH).sort(), [...REPORT_IDS].sort())
  for (const locale of ['bn', 'en'] as const) {
    for (const id of REPORT_IDS) {
      const words = dict(locale).settings.export.reports[id]
      assert.ok(words.title.length > 0, `${locale}.${id}.title`)
      assert.ok(words.body.length > 0, `${locale}.${id}.body`)
    }
  }
})

/* -------------------------------------------------------------------------- */
/* The roster                                                                 */
/* -------------------------------------------------------------------------- */

const STUDENT = {
  name: 'রাফিদ হাসান',
  student_code: 'S-001',
  class_level: '১০',
  institution: 'Dhaka College',
  phone: '+8801712345678',
  guardian_name: 'হাসান আলী',
  guardian_phone: '+8801812345678',
  status: 'active',
  sms_opt_out: false,
  // Nobody has said, which is where every student starts and what most rows in a
  // real download will hold.
  preferred_channel: null,
  admitted_on: '2026-01-15',
  enrollments: [
    { status: 'active', batches: { name: 'Class 9, Morning' } },
    // The same embed arriving as an array, which PostgREST does depending on how it
    // resolved the relationship. Both shapes have to survive.
    { status: 'active', batches: [{ name: 'Physics' }] },
    { status: 'dropped', batches: { name: 'পুরনো ব্যাচ' } },
  ],
}

test('a roster row carries the numbers as a person reads them', async () => {
  const f = fake({ students: { rows: [STUDENT] } })
  const sheet = sheetOf(await buildReport('students', context(f.supabase)))
  const d = dict('bn')
  const [row] = sheet.rows

  assert.equal(sheet.rows.length, 1)
  assert.equal(row.length, sheet.header.length)
  assert.equal(row[0], 'S-001')
  assert.equal(row[1], 'রাফিদ হাসান')
  // Local form, not the stored E.164 — a leading + is a formula character.
  assert.equal(row[4], '01712345678')
  assert.equal(row[6], '01812345678')
  assert.equal(row[8], d.studentForm.status.active)
  assert.equal(row[9], d.exportSheet.no)
  // Nobody marked, and the cell says so in words. An empty cell here would be
  // indistinguishable from an export that dropped the column.
  assert.equal(row[10], d.optOutList.channelAny)
  assert.equal(row[11], '2026-01-15')
  // A snapshot is dated by the day it was taken, not by ctx.month.
  assert.equal(sheet.period, todayInDhaka())
})

test('only the batches a student is still in are listed, joined by a middle dot', async () => {
  const f = fake({ students: { rows: [STUDENT] } })
  const sheet = sheetOf(await buildReport('students', context(f.supabase)))
  const batches = String(sheet.rows[0][7])

  // A comma would be quoted correctly and still be wrong: "Class 9, Morning" is one
  // batch, and an owner splitting the column on a comma would get two.
  assert.equal(batches, 'Class 9, Morning · Physics')
  assert.ok(!batches.includes('পুরনো ব্যাচ'), 'a dropped enrolment is not a batch')
})

test('the roster is every student on the books, not only the active ones', async () => {
  const left = { ...STUDENT, name: 'মীম', student_code: 'S-002', status: 'dropped' }
  const f = fake({ students: { rows: [STUDENT, left] } })
  const sheet = sheetOf(await buildReport('students', context(f.supabase)))
  const d = dict('bn')

  assert.equal(sheet.rows.length, 2)
  assert.equal(sheet.rows[1][8], d.studentForm.status.dropped)
  // The absence of the filter, not just the presence of the row: a `status` filter
  // added to this query later would silently shorten every roster ever exported.
  assert.ok(!f.queries[0].filters.some((x) => x.includes('status')))
  assert.ok(f.queries[0].filters.includes('eq coaching_center_id center-1'))
})

test('an unknown status falls back to the code rather than a blank cell', async () => {
  // Only reachable if the enum gains a value before the dictionary does. A blank
  // there reads as "no status", which is a different and wrong claim.
  const odd = { ...STUDENT, status: 'transferred' }
  const f = fake({ students: { rows: [odd] } })
  const sheet = sheetOf(await buildReport('students', context(f.supabase)))
  assert.equal(sheet.rows[0][8], 'transferred')
})

test('how a family is reached comes out in words, in the reader’s language', async () => {
  /*
   * The column the centre typed rather than copied off an admission form, so it is
   * the one worth having in a file. Asserted against the dictionary the settings
   * dropdown reads from, not against a literal: if the two ever disagreed, an owner
   * would set "WhatsApp" on the screen and read something else back out of their
   * own backup.
   */
  const marked = { ...STUDENT, preferred_channel: 'whatsapp' }
  const f = fake({ students: { rows: [marked] } })

  for (const locale of ['bn', 'en'] as const) {
    const sheet = sheetOf(
      await buildReport('students', context(f.supabase, { locale })),
    )
    assert.equal(sheet.rows[0][10], dict(locale).channels.whatsapp)
    // Beside the opt-out, because they are the two contact columns and the pair is
    // read together. This also pins the position the previous test's index depends on.
    assert.equal(sheet.header[9], dict(locale).exportSheet.colSmsOff)
    assert.equal(sheet.header[10], dict(locale).exportSheet.colChannel)
  }
})

/* -------------------------------------------------------------------------- */
/* Collections                                                                */
/* -------------------------------------------------------------------------- */

test("a month's collections are cut at midnight Dhaka, not midnight UTC", async () => {
  const f = fake({ fee_payments: { rows: [] } })
  await buildReport('collections', context(f.supabase, { month: '2026-08-01' }))

  const filters = f.queries[0].filters
  assert.ok(filters.includes('gte paid_at 2026-08-01T00:00:00+06:00'), filters.join(' | '))
  assert.ok(filters.includes('lt paid_at 2026-09-01T00:00:00+06:00'), filters.join(' | '))
  assert.ok(filters.includes('eq coaching_center_id center-1'))
})

test('a payment taken after midnight Dhaka is dated to the Dhaka day', async () => {
  const f = fake({
    fee_payments: {
      rows: [
        {
          receipt_no: 41,
          amount_bdt: '1500.00',
          method: 'bkash',
          reference: 'TRX9911',
          // 01:00 on the 1st in Dhaka. A UTC slice would date this to July.
          paid_at: '2026-07-31T19:00:00Z',
          students: { name: 'রাফিদ হাসান', student_code: 'S-001' },
        },
      ],
    },
  })
  const sheet = sheetOf(await buildReport('collections', context(f.supabase)))
  const d = dict('bn')
  const [row] = sheet.rows

  assert.equal(row.length, sheet.header.length)
  assert.equal(row[0], '2026-08-01')
  assert.equal(row[1], 41)
  assert.equal(row[4], d.feeRow.methods.bkash)
  assert.equal(row[5], 'TRX9911')
  // numeric comes back from PostgREST as a string. A column of strings does not add
  // up in any spreadsheet.
  assert.equal(row[6], 1500)
  assert.equal(typeof row[6], 'number')
  assert.equal(sheet.period, '2026-08')
})

test('a payment whose student is gone still appears, named as unknown', async () => {
  // The money moved. Leaving the row out to avoid an empty name would make the
  // sheet disagree with the printed register and with the bank.
  const f = fake({
    fee_payments: {
      rows: [
        {
          receipt_no: 7,
          amount_bdt: 500,
          method: 'cash',
          reference: null,
          paid_at: '2026-08-10T06:00:00Z',
          students: null,
        },
      ],
    },
  })
  const sheet = sheetOf(await buildReport('collections', context(f.supabase)))
  assert.equal(sheet.rows[0][2], dict('bn').common.unknown)
  assert.equal(sheet.rows[0][3], undefined)
})

/* -------------------------------------------------------------------------- */
/* Dues                                                                       */
/* -------------------------------------------------------------------------- */

const INVOICE = {
  student_name: 'রাফিদ হাসান',
  student_code: 'S-001',
  guardian_phone: '+8801812345678',
  amount_bdt: 1200,
  discount_bdt: 200,
  net_bdt: 1000,
  paid_bdt: 400,
  remaining_bdt: 600,
  due_date: '2026-08-10',
  period_month: '2026-08-01',
  enrollment_id: 'enr-1',
}

test('the fee sheet asks for one month, and leaves cancelled bills out of it', async () => {
  const f = fake({
    fee_invoice_balances: { rows: [INVOICE] },
    enrollments: { rows: [{ id: 'enr-1', batches: { name: 'ক্লাস ১০ সকাল' } }] },
  })
  await buildReport('dues', context(f.supabase))

  const filters = f.queries[0].filters
  assert.ok(filters.includes('eq period_month 2026-08-01'), filters.join(' | '))
  // Without this the billed column stops totalling to what the centre charged.
  assert.ok(filters.includes('is voided_at null'), filters.join(' | '))
})

test('a fee row says what is owed and what state the bill is in', async () => {
  const f = fake({
    fee_invoice_balances: { rows: [INVOICE] },
    enrollments: { rows: [{ id: 'enr-1', batches: { name: 'ক্লাস ১০ সকাল' } }] },
  })
  const sheet = sheetOf(await buildReport('dues', context(f.supabase)))
  const t = dict('bn').exportSheet
  const [row] = sheet.rows

  assert.equal(row.length, sheet.header.length)
  assert.equal(row[0], 'S-001')
  assert.equal(row[1], 'রাফিদ হাসান')
  // Joined in JS, because a PostgREST embed through a view is not reliable.
  assert.equal(row[2], 'ক্লাস ১০ সকাল')
  assert.equal(row[3], '2026-08')
  assert.deepEqual(row.slice(4, 9), [1200, 200, 1000, 400, 600])
  assert.equal(row[9], t.partial)
  assert.equal(row[10], '2026-08-10')
  assert.equal(row[11], '01812345678')
  assert.equal(sheet.period, '2026-08')
})

test('paid, part paid and unpaid are told apart by what is left, not by what came in', async () => {
  const rows = [
    { ...INVOICE, student_name: 'ক', paid_bdt: 1000, remaining_bdt: 0 },
    { ...INVOICE, student_name: 'খ', paid_bdt: 400, remaining_bdt: 600 },
    { ...INVOICE, student_name: 'গ', paid_bdt: 0, remaining_bdt: 1000 },
    // An overpayment is settled, not "more than paid" — a negative remaining must
    // not fall through to unpaid.
    { ...INVOICE, student_name: 'ঘ', paid_bdt: 1100, remaining_bdt: -100 },
    // A row the view could not compute. 0 is the safe direction: NaN would spread
    // down the column and take the owner's totals with it.
    { ...INVOICE, student_name: 'ঙ', paid_bdt: null, remaining_bdt: null, net_bdt: null },
  ]
  const f = fake({
    fee_invoice_balances: { rows },
    enrollments: { rows: [] },
  })
  const sheet = sheetOf(await buildReport('dues', context(f.supabase)))
  const t = dict('bn').exportSheet

  assert.deepEqual(
    sheet.rows.map((r) => r[9]),
    [t.paid, t.partial, t.unpaid, t.paid, t.paid],
  )
  assert.deepEqual(sheet.rows[4].slice(6, 9), [0, 0, 0])
})

test('an empty month costs one query, not two', async () => {
  // Most months for a centre in its first weeks. Resolving batch names for nothing
  // is a round trip an owner waits for.
  const f = fake({ fee_invoice_balances: { rows: [] }, enrollments: { rows: [] } })
  const sheet = sheetOf(await buildReport('dues', context(f.supabase)))

  assert.equal(sheet.rows.length, 0)
  assert.equal(sheet.header.length > 0, true, 'an empty month still has its columns')
  assert.equal(f.queries.filter((q) => q.table === 'enrollments').length, 0)
})

test('a fee row whose enrolment cannot be resolved leaves the batch blank', async () => {
  const f = fake({
    fee_invoice_balances: { rows: [{ ...INVOICE, enrollment_id: null }] },
    enrollments: { rows: [] },
  })
  const sheet = sheetOf(await buildReport('dues', context(f.supabase)))
  assert.equal(sheet.rows[0][2], '')
})

/* -------------------------------------------------------------------------- */
/* Paging, ceilings and failure                                               */
/* -------------------------------------------------------------------------- */

test('a query longer than one page is followed until it is exhausted', async () => {
  const f = fake({ students: { rows: rowsOf('students', 1500) } })
  const sheet = sheetOf(await buildReport('students', context(f.supabase)))

  assert.equal(sheet.rows.length, 1500)
  assert.equal(f.queries.length, 2)
  assert.deepEqual(f.queries[0].range, [0, 999])
  assert.deepEqual(f.queries[1].range, [1000, 1999])
})

test('an exact multiple of the page size takes one more round trip and stops', async () => {
  const f = fake({ students: { rows: rowsOf('students', 1000) } })
  const sheet = sheetOf(await buildReport('students', context(f.supabase)))

  assert.equal(sheet.rows.length, 1000)
  assert.equal(f.queries.length, 2, 'a full page cannot be assumed to be the last')
})

test('too much data is an error the owner reads, never a shorter file', async () => {
  // A file that stops halfway looks exactly like a complete one, which is the whole
  // argument for failing here.
  const f = fake({ students: { rows: rowsOf('students', MAX_EXPORT_ROWS + 10) } })
  const result = await buildReport('students', context(f.supabase))

  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.reason, 'tooLarge')
})

test('a failed query is reported, not written out as an empty sheet', async () => {
  for (const id of REPORT_IDS) {
    const f = fake({}) // no stub for any table — every query errors
    const result = await buildReport(id, context(f.supabase))
    assert.equal(result.ok, false, id)
    assert.equal(result.ok === false && result.reason, 'unreadable', id)
  }
})

test('a fee sheet whose batch names fail to load is an error, not a blank column', async () => {
  // Silently blanking the column would produce a plausible sheet that quietly lost
  // the one field a batch teacher sorts it by.
  const f = fake({
    fee_invoice_balances: { rows: [INVOICE] },
    enrollments: { error: 'connection reset' },
  })
  const result = await buildReport('dues', context(f.supabase))

  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.reason, 'unreadable')
})

/* -------------------------------------------------------------------------- */
/* The month's attendance                                                     */
/* -------------------------------------------------------------------------- */

/** Five class days in August, which is a realistic three-a-week fortnight. */
const MET_ON = ['2026-08-03', '2026-08-05', '2026-08-07', '2026-08-10', '2026-08-12']

/** Sessions for one batch, each carrying whatever marks it was given. */
function sessions(
  marks: Record<string, (string | undefined)[]>,
  dates: string[] = MET_ON,
): { rows: unknown[] } {
  return {
    rows: dates.map((session_date, day) => ({
      batch_id: 'batch-1',
      session_date,
      attendance_records: Object.entries(marks)
        .filter(([, statuses]) => statuses[day] !== undefined)
        .map(([enrollment_id, statuses]) => ({
          enrollment_id,
          status: statuses[day],
        })),
    })),
  }
}

function enrolment(over: Record<string, unknown> = {}) {
  return {
    id: 'enr-1',
    batch_id: 'batch-1',
    enrolled_at: '2026-01-10T04:00:00Z',
    ended_at: null,
    students: {
      name: 'রাফিদ হাসান',
      student_code: 'S-001',
      guardian_phone: '+8801812345678',
    },
    batches: { name: 'Class 9, Morning' },
    ...over,
  }
}

test('an attendance row counts what happened and works out the rate', async () => {
  const f = fake({
    attendance_sessions: sessions({
      'enr-1': ['present', 'present', 'absent', 'late', 'present'],
    }),
    enrollments: { rows: [enrolment()] },
  })
  const sheet = sheetOf(await buildReport('attendance', context(f.supabase)))
  const [row] = sheet.rows

  assert.equal(sheet.rows.length, 1)
  assert.equal(row.length, sheet.header.length)
  assert.equal(row[0], 'Class 9, Morning')
  assert.equal(row[1], 'S-001')
  assert.equal(row[2], 'রাফিদ হাসান')
  // The local form, exactly as on the roster: this column is dialled, not parsed.
  assert.equal(row[3], '01812345678')
  assert.equal(row[4], 5, 'classes held')
  assert.equal(row[5], 3, 'present')
  assert.equal(row[6], 1, 'absent')
  assert.equal(row[7], 1, 'late')
  assert.equal(row[8], 0, 'excused')
  assert.equal(row[9], 0, 'not marked')
  // Late is a day they were there: (3 present + 1 late) of 5.
  assert.equal(row[10], 80)
  assert.equal(sheet.period, '2026-08')
})

test('the attendance month is a plain date range, with no timezone offsets', async () => {
  // session_date is a `date`, so a +06:00 here would be the bug the collections
  // sheet has to have — comparing a timestamptz against a bare date.
  const f = fake({ attendance_sessions: sessions({}), enrollments: { rows: [] } })
  await buildReport('attendance', context(f.supabase))

  assert.deepEqual(f.queries[0].filters, [
    'eq coaching_center_id center-1',
    'gte session_date 2026-08-01',
    'lt session_date 2026-09-01',
  ])
})

test('a student who joined mid-month is only counted against the classes since', async () => {
  const f = fake({
    // Marked at the two sessions after they joined; the first three predate them.
    attendance_sessions: sessions({
      'enr-1': [undefined, undefined, undefined, 'present', 'present'],
    }),
    // 04:00Z on the 8th is 10am Dhaka on the 8th.
    enrollments: { rows: [enrolment({ enrolled_at: '2026-08-08T04:00:00Z' })] },
  })
  const sheet = sheetOf(await buildReport('attendance', context(f.supabase)))
  const [row] = sheet.rows

  assert.equal(row[4], 2, 'only the classes held after they enrolled')
  assert.equal(row[9], 0, 'nothing unmarked')
  assert.equal(row[10], 100, 'a perfect fortnight, not 40%')
})

test('a student who left before the month is not in it', async () => {
  const f = fake({
    attendance_sessions: sessions({}),
    enrollments: {
      rows: [enrolment({ ended_at: '2026-07-15T00:00:00Z' })],
    },
  })
  const sheet = sheetOf(await buildReport('attendance', context(f.supabase)))
  assert.deepEqual(sheet.rows, [])
})

test('a backfilled mark keeps a row the enrolment dates would have dropped', async () => {
  // An owner who adds the student in September and then fills in August has an
  // enrolment younger than its own attendance. Losing those marks would be silent.
  const f = fake({
    attendance_sessions: sessions({ 'enr-1': ['present'] }),
    enrollments: { rows: [enrolment({ enrolled_at: '2026-09-10T04:00:00Z' })] },
  })
  const sheet = sheetOf(await buildReport('attendance', context(f.supabase)))
  const [row] = sheet.rows

  assert.equal(sheet.rows.length, 1)
  // Never fewer classes held than the student has marks for, so 'not marked'
  // cannot go negative and the rate cannot exceed 100.
  assert.equal(row[4], 1)
  assert.equal(row[9], 0)
  assert.equal(row[10], 100)
})

test('an excused day is taken out of the rate rather than counted against it', async () => {
  const f = fake({
    attendance_sessions: sessions({
      'enr-1': ['present', 'present', 'late', 'excused', undefined],
    }),
    enrollments: { rows: [enrolment()] },
  })
  const [row] = sheetOf(await buildReport('attendance', context(f.supabase))).rows

  assert.equal(row[4], 5, 'five classes were held')
  assert.equal(row[8], 1, 'excused')
  assert.equal(row[9], 1, 'the fifth day was never marked')
  // (2 present + 1 late) of the four days that counted, not of five.
  assert.equal(row[10], 75)
})

test('a batch that has not met leaves the rate blank rather than saying nought', async () => {
  // Every student at 0% is a figure an owner acts on, and it would be about the
  // teacher who has not opened the register yet.
  const f = fake({
    attendance_sessions: { rows: [] },
    enrollments: { rows: [enrolment()] },
  })
  const [row] = sheetOf(await buildReport('attendance', context(f.supabase))).rows

  assert.equal(row[4], 0)
  assert.equal(row[10], '')
})

test('a mark this build has never heard of is not counted into another column', async () => {
  const f = fake({
    // One class, one mark, and the mark is a word the enum did not have when this
    // was written — which is what a migration adding a fifth state looks like here.
    attendance_sessions: sessions({ 'enr-1': ['holiday'] }, ['2026-08-03']),
    enrollments: { rows: [enrolment()] },
  })
  const [row] = sheetOf(await buildReport('attendance', context(f.supabase))).rows

  assert.deepEqual(row.slice(5, 9), [0, 0, 0, 0], 'not silently a present or an absent')
  assert.equal(row[9], 1, 'counted as unmarked, which is what it is')
})

test('attendance rows are ordered by batch and then by name', async () => {
  const f = fake({
    attendance_sessions: sessions({}),
    enrollments: {
      rows: [
        enrolment({ id: 'c', batches: { name: 'ঘ ব্যাচ' } }),
        enrolment({
          id: 'b',
          batches: { name: 'ক ব্যাচ' },
          students: { name: 'সাকিব', student_code: 'S-3', guardian_phone: null },
        }),
        enrolment({
          id: 'a',
          batches: { name: 'ক ব্যাচ' },
          students: { name: 'আরিফ', student_code: 'S-2', guardian_phone: null },
        }),
      ],
    },
  })
  const sheet = sheetOf(await buildReport('attendance', context(f.supabase)))

  assert.deepEqual(
    sheet.rows.map((row) => [row[0], row[2]]),
    [
      ['ক ব্যাচ', 'আরিফ'],
      ['ক ব্যাচ', 'সাকিব'],
      ['ঘ ব্যাচ', 'রাফিদ হাসান'],
    ],
  )
})

/* -------------------------------------------------------------------------- */
/* The month's marks                                                          */
/* -------------------------------------------------------------------------- */

function exam(over: Record<string, unknown> = {}) {
  return {
    title: 'সাপ্তাহিক পরীক্ষা ১',
    exam_date: '2026-08-12',
    // Numerics arrive from PostgREST as strings, which is the whole reason the
    // builder puts Number() round them.
    total_marks: '50.00',
    pass_marks: '20.00',
    batches: { name: 'Class 9, Morning' },
    subjects: { name: 'Physics', name_bn: 'পদার্থবিজ্ঞান' },
    exam_types: { name: 'Weekly', name_bn: 'সাপ্তাহিক' },
    exam_results: [
      { enrollment_id: 'enr-1', obtained_marks: '38.50', is_absent: false },
    ],
    ...over,
  }
}

const MARK_ROSTER = {
  rows: [{ id: 'enr-1', students: { name: 'রাফিদ হাসান', student_code: 'S-001' } }],
}

test('a marks row carries the exam, the mark and the percentage', async () => {
  const f = fake({ exams: { rows: [exam()] }, enrollments: MARK_ROSTER })
  const sheet = sheetOf(await buildReport('marks', context(f.supabase)))
  const [row] = sheet.rows

  assert.equal(sheet.rows.length, 1)
  assert.equal(row.length, sheet.header.length)
  assert.equal(row[0], '2026-08-12')
  assert.equal(row[1], 'সাপ্তাহিক পরীক্ষা ১')
  // The centre's own Bangla words for both, since this reader asked for Bangla.
  assert.equal(row[2], 'সাপ্তাহিক')
  assert.equal(row[3], 'পদার্থবিজ্ঞান')
  assert.equal(row[4], 'Class 9, Morning')
  assert.equal(row[5], 'S-001')
  assert.equal(row[6], 'রাফিদ হাসান')
  // Numbers, not the '50.00' strings they arrived as: a spreadsheet has to add
  // these up and average them.
  assert.equal(row[7], 50)
  assert.equal(row[8], 38.5)
  assert.equal(row[9], 77)
  assert.equal(row[10], dict('bn').exportSheet.resultPass)
  assert.equal(sheet.period, '2026-08')
})

test('an English reader gets the centre’s English names for subject and type', async () => {
  const f = fake({ exams: { rows: [exam()] }, enrollments: MARK_ROSTER })
  const [row] = sheetOf(
    await buildReport('marks', context(f.supabase, { locale: 'en' })),
  ).rows

  // `name` where the centre typed both, which is the opposite of what a Bangla
  // reader gets off the same row.
  assert.equal(row[2], 'Weekly')
  assert.equal(row[3], 'Physics')
  assert.equal(row[10], dict('en').exportSheet.resultPass)
})

test('a student below the pass mark is failed, and one who was away is neither', async () => {
  const f = fake({
    exams: {
      rows: [
        exam({
          exam_results: [
            { enrollment_id: 'enr-1', obtained_marks: '19.00', is_absent: false },
            { enrollment_id: 'enr-2', obtained_marks: null, is_absent: true },
          ],
        }),
      ],
    },
    enrollments: {
      rows: [
        ...MARK_ROSTER.rows,
        { id: 'enr-2', students: { name: 'সাকিব', student_code: 'S-002' } },
      ],
    },
  })
  const sheet = sheetOf(await buildReport('marks', context(f.supabase)))
  const d = dict('bn')

  // Alphabetical inside the exam, so সাকিব comes before রাফিদ in Bangla collation.
  const byName = new Map(sheet.rows.map((row) => [row[6], row]))
  assert.equal(byName.get('রাফিদ হাসান')?.[10], d.exportSheet.resultFail)

  const away = byName.get('সাকিব')
  assert.equal(away?.[8], null, 'no mark at all, not a nought')
  assert.equal(away?.[9], '', 'and so no percentage')
  assert.equal(away?.[10], d.attendance.absent)
})

test('an exam with no pass mark set reports no verdict', async () => {
  const f = fake({
    exams: { rows: [exam({ pass_marks: null })] },
    enrollments: MARK_ROSTER,
  })
  const [row] = sheetOf(await buildReport('marks', context(f.supabase))).rows

  assert.equal(row[8], 38.5, 'the mark is still there')
  assert.equal(row[10], '', 'the verdict is not invented')
})

test('the exam’s own date decides its month, and the range is half-open', async () => {
  const f = fake({ exams: { rows: [] } })
  await buildReport('marks', context(f.supabase))

  assert.deepEqual(f.queries[0].filters, [
    'eq coaching_center_id center-1',
    'gte exam_date 2026-08-01',
    'lt exam_date 2026-09-01',
  ])
  // Date first, then title: two tests on one day should not come back interleaved.
  assert.deepEqual(f.queries[0].orders, ['exam_date', 'title'])
})

test('a month with no exams costs one query, not two', async () => {
  const f = fake({ exams: { rows: [] } })
  const sheet = sheetOf(await buildReport('marks', context(f.supabase)))

  assert.deepEqual(sheet.rows, [])
  assert.equal(f.queries.length, 1, 'nobody to name, so nobody was looked up')
})

test('a mark whose enrolment cannot be resolved is still exported', async () => {
  // Losing a mark because a name could not be found would be the worse failure:
  // the total on the sheet would no longer match the total in the app.
  const f = fake({ exams: { rows: [exam()] }, enrollments: { rows: [] } })
  const [row] = sheetOf(await buildReport('marks', context(f.supabase))).rows

  assert.equal(row[6], dict('bn').common.unknown)
  assert.equal(row[8], 38.5)
})

test('more marks than the ceiling is an error, even off a single page of exams', async () => {
  // The marks ride in as an embedded array, so pageAll's own ceiling never sees
  // them. This is the check that does.
  const f = fake({
    exams: {
      rows: [
        exam({
          exam_results: Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, i) => ({
            enrollment_id: `enr-${i}`,
            obtained_marks: '10.00',
            is_absent: false,
          })),
        }),
      ],
    },
    enrollments: { rows: [] },
  })
  const result = await buildReport('marks', context(f.supabase))

  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.reason, 'tooLarge')
})

test('an attendance sheet whose roster fails to load is an error', async () => {
  const f = fake({
    attendance_sessions: sessions({}),
    enrollments: { error: 'connection reset' },
  })
  const result = await buildReport('attendance', context(f.supabase))

  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.reason, 'unreadable')
})

/* -------------------------------------------------------------------------- */
/* Shape                                                                      */
/* -------------------------------------------------------------------------- */

test('every row in every sheet is exactly as wide as its heading, in both languages', async () => {
  const tables = {
    students: { rows: [STUDENT, { ...STUDENT, status: 'graduated' }] },
    fee_payments: {
      rows: [
        {
          receipt_no: 1,
          amount_bdt: 100,
          method: 'other',
          reference: null,
          paid_at: '2026-08-02T05:00:00Z',
          students: { name: 'ক', student_code: null },
        },
      ],
    },
    fee_invoice_balances: { rows: [INVOICE] },
    attendance_sessions: sessions({ 'enr-1': ['present'] }),
    exams: { rows: [exam()] },
    // One stub, read by four builders that each want different columns off it: the
    // fee sheet takes the batch name, the marks sheet the student, the attendance
    // sheet all of it. `batches: null` keeps the fee sheet's unresolvable-batch case.
    enrollments: {
      rows: [
        {
          id: 'enr-1',
          batch_id: 'batch-1',
          enrolled_at: '2026-01-10T04:00:00Z',
          ended_at: null,
          students: {
            name: 'ক',
            student_code: null,
            guardian_phone: null,
          },
          batches: null,
        },
      ],
    },
  }

  const widths: Record<string, number[]> = {}

  for (const locale of ['bn', 'en'] as const) {
    for (const id of REPORT_IDS) {
      const f = fake(tables)
      const sheet = sheetOf(await buildReport(id, context(f.supabase, { locale })))

      assert.ok(sheet.rows.length > 0, `${locale}/${id} produced no rows`)
      for (const row of sheet.rows) {
        assert.equal(row.length, sheet.header.length, `${locale}/${id} row width`)
      }
      // No blank heading: an unnamed column in a spreadsheet is a column nobody
      // trusts, and a missing dictionary entry would render as one.
      for (const cell of sheet.header) assert.ok(cell.length > 0, `${locale}/${id} heading`)

      ;(widths[id] ??= []).push(sheet.header.length)
    }
  }

  // Translation changes the words, never the shape.
  for (const id of REPORT_IDS) assert.equal(widths[id][0], widths[id][1], id)
})
