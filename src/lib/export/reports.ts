/**
 * The three sheets an owner can download, and what goes in each column.
 *
 * WHY THIS EXISTS AT ALL. Everything in the product is a screen on a phone, and a
 * phone is the wrong shape for two jobs a coaching centre actually has: handing the
 * roster to somebody who is not a user of the app, and taking a year of takings to
 * whoever does the accounts. Both of those end in a spreadsheet no matter what we
 * build, and the only question is whether the owner retypes it. `exportReports` has
 * been priced into the Pro tier since the plan engine was written; until these
 * builders existed it was a flag that switched on nothing.
 *
 * DATES AND MONEY GO OUT MACHINE-READABLE, NOT LOCALISED. Every other surface in
 * this product renders ১১ আগস্ট ২০২৬ and ৳1,250, and both would be wrong here. A
 * spreadsheet sorts, filters and totals these columns, and a date in Bangla numerals
 * is text that sorts alphabetically while a ৳ with a thousands separator is text that
 * will not add up. So dates are ISO (YYYY-MM-DD, the Dhaka calendar day) and amounts
 * are bare numbers. The *words* — a status, a payment method, a column heading — are
 * in the reader's own language, because those are read rather than computed.
 *
 * NOTHING IS SILENTLY TRUNCATED. PostgREST answers at most 1000 rows per request, so
 * every query here pages until it is exhausted; and because a file that stops
 * halfway looks exactly like a complete one, hitting the ceiling is an error the
 * owner is told about rather than a shorter download.
 *
 * WHAT IS DELIBERATELY NOT HERE: any write. An export is a read, it is reached over
 * GET, and a GET that changes something is a link a browser may follow twice.
 */
/*
 * Relative, with extensions, and not the `@/` alias — the convention every other
 * module under src/lib follows, for one reason: the test runner is `node --test`
 * over TypeScript directly, and node resolves neither tsconfig `paths` nor
 * extensionless specifiers. A `@/lib/i18n` here would compile and ship and still be
 * unreachable from a test, which for the module that decides what lands in an
 * owner's accounts is the wrong module to leave untestable.
 *
 * `createClient` is imported as a type only, so nothing in src/lib/supabase/server
 * — `next/headers` included — is ever loaded by a test.
 */
import type { CsvCell } from '../csv.ts'
import { dict, type Locale } from '../i18n/index.ts'
import { addMonths, todayInDhaka } from '../bd/time.ts'
import { formatBdMobile } from '../bd/phone.ts'
import type { createClient } from '../supabase/server.ts'
import type { PaymentMethod, StudentStatus } from '../supabase/types.ts'

type Supabase = Awaited<ReturnType<typeof createClient>>

/** The catalogue, in the order the download screen lists them. */
export const REPORT_IDS = ['students', 'collections', 'dues'] as const

export type ReportId = (typeof REPORT_IDS)[number]

/** A `kind` off a query string is a string until this says otherwise. */
export function isReportId(value: string): value is ReportId {
  return (REPORT_IDS as readonly string[]).includes(value)
}

/**
 * Whether the sheet covers a month or the present moment.
 *
 * The roster is a snapshot — "who is enrolled here now" — and a month picker above
 * it would promise a history this product does not keep: a student inactivated in
 * June does not leave behind what their record looked like in May. The other two are
 * genuinely per-month and are meaningless without one.
 */
export const NEEDS_MONTH: Record<ReportId, boolean> = {
  students: false,
  collections: true,
  dues: true,
}

export type Sheet = {
  /** Column headings, in the reader's language. */
  header: string[]
  rows: CsvCell[][]
  /**
   * What the sheet covers, for the filename: a YYYY-MM for the two monthly sheets,
   * a YYYY-MM-DD for the roster. Built here rather than by the caller so a
   * downloaded file cannot be named after a month it does not contain.
   */
  period: string
}

export type BuildResult =
  | { ok: true; sheet: Sheet }
  /** `unreadable` is a failed query; `tooLarge` is the ceiling below. */
  | { ok: false; reason: 'unreadable' | 'tooLarge' }

/* -------------------------------------------------------------------------- */
/* Paging                                                                     */
/* -------------------------------------------------------------------------- */

/** PostgREST's own default ceiling per request. Asking for more gets 1000. */
const PAGE = 1000

/**
 * The point at which we stop and say so.
 *
 * Twenty thousand rows is far past any coaching centre in the country — the largest
 * chains run a few thousand students across all branches — so reaching it means
 * either a runaway query or a customer we should be talking to rather than quietly
 * handing a broken file. Either way the honest answer is an error.
 */
export const MAX_EXPORT_ROWS = 20_000

/** The shape of an awaited PostgREST response, narrowed to what paging needs. */
type PageResponse<T> = { data: T[] | null; error: { message: string } | null }

type Paged<T> = { rows: T[] } | { failed: 'unreadable' | 'tooLarge' }

/**
 * Every row a query can return, one page at a time.
 *
 * `.range(from, to)` rather than `.limit()` plus a cursor, because these queries are
 * ordered by a non-unique column (a student's name, a payment's timestamp) and a
 * cursor needs a unique one. An offset can in principle skip or repeat a row if
 * something is written between pages; over a read that takes a few hundred
 * milliseconds and rows nobody is editing at that moment, that is the smaller risk
 * than a keyset paginator that gets the tie-breaking wrong.
 */
async function pageAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
): Promise<Paged<T>> {
  const rows: T[] = []

  for (;;) {
    const { data, error } = await fetchPage(rows.length, rows.length + PAGE - 1)
    if (error) return { failed: 'unreadable' }

    const page = data ?? []
    rows.push(...page)

    // A short page is the last page. Asking again would cost a round trip to be
    // handed nothing, and on an exact multiple of PAGE the next call returns empty
    // and ends the loop there instead.
    if (page.length < PAGE) return { rows }
    if (rows.length >= MAX_EXPORT_ROWS) return { failed: 'tooLarge' }
  }
}

/* -------------------------------------------------------------------------- */
/* Column strings                                                             */
/* -------------------------------------------------------------------------- */

/*
 * One line each, never a concatenation — see the note on the fee board's own
 * COLUMNS. supabase-js parses the select string at the type level to work out the
 * row shape, and it can only do that with a string literal; split one across two
 * lines with a `+` and every column comes back as an error type.
 */

const STUDENT_COLUMNS = 'name, student_code, class_level, institution, phone, guardian_name, guardian_phone, status, sms_opt_out, admitted_on, enrollments (status, batches (name))'

const PAYMENT_COLUMNS = 'receipt_no, amount_bdt, method, reference, paid_at, students (name, student_code)'

const INVOICE_COLUMNS = 'student_name, student_code, guardian_phone, amount_bdt, discount_bdt, net_bdt, paid_bdt, remaining_bdt, due_date, period_month, enrollment_id'

const ENROLLMENT_COLUMNS = 'id, batches (name)'

/** A to-one embed arrives as an object, or an array, or null. All three happen. */
type Embed<T> = T | T[] | null

function one<T>(embed: Embed<T>): T | null {
  return (Array.isArray(embed) ? embed[0] : embed) ?? null
}

type StudentRow = {
  name: string
  student_code: string | null
  class_level: string | null
  institution: string | null
  phone: string | null
  guardian_name: string | null
  guardian_phone: string | null
  status: StudentStatus
  sms_opt_out: boolean
  admitted_on: string | null
  enrollments: { status: string; batches: Embed<{ name: string }> }[] | null
}

type PaymentRow = {
  receipt_no: number
  amount_bdt: number
  method: PaymentMethod
  reference: string | null
  paid_at: string
  students: Embed<{ name: string; student_code: string | null }>
}

/** Every column of a view is nullable as far as Postgres can prove. */
type InvoiceRow = {
  student_name: string | null
  student_code: string | null
  guardian_phone: string | null
  amount_bdt: number | null
  discount_bdt: number | null
  net_bdt: number | null
  paid_bdt: number | null
  remaining_bdt: number | null
  due_date: string | null
  period_month: string | null
  enrollment_id: string | null
}

type EnrollmentRow = { id: string; batches: Embed<{ name: string }> }

/* -------------------------------------------------------------------------- */
/* The builders                                                               */
/* -------------------------------------------------------------------------- */

export type ReportContext = {
  supabase: Supabase
  centerId: string
  /** YYYY-MM-01. Ignored by the sheets that NEEDS_MONTH says are snapshots. */
  month: string
  locale: Locale
}

export async function buildReport(
  id: ReportId,
  ctx: ReportContext,
): Promise<BuildResult> {
  switch (id) {
    case 'students':
      return buildStudents(ctx)
    case 'collections':
      return buildCollections(ctx)
    case 'dues':
      return buildDues(ctx)
  }
}

/**
 * The roster: every student the centre has on its books, active or not.
 *
 * Not filtered to active, unlike every screen that shows this list, and that is the
 * difference between a screen and an export. A screen is a working surface and a
 * student who left last year is noise on it; a file is a record, and the one an owner
 * downloads to hand to their accountant or to keep before switching phones has to
 * contain the people who left. The status column says which is which, and a
 * spreadsheet filters on it in one click.
 */
async function buildStudents(ctx: ReportContext): Promise<BuildResult> {
  const d = dict(ctx.locale)
  const t = d.exportSheet

  const got = await pageAll<StudentRow>((from, to) =>
    ctx.supabase
      .from('students')
      .select(STUDENT_COLUMNS)
      // Scoped as well as governed by RLS: an owner of two centres passes
      // is_staff_admin for both, so the policy alone would mix two rosters into
      // one file — and a file is the one place that would never be noticed.
      .eq('coaching_center_id', ctx.centerId)
      .order('name', { ascending: true })
      .range(from, to),
  )
  if ('failed' in got) return { ok: false, reason: got.failed }

  const rows: CsvCell[][] = got.rows.map((s) => [
    s.student_code,
    s.name,
    s.class_level,
    s.institution,
    // The local form, 01712345678, not the stored +8801712345678. Two reasons and
    // both are about the reader: it is how a Bangladeshi reads a number back to
    // somebody, and a leading `+` is a formula character, so the E.164 form would
    // arrive in the sheet with an apostrophe in front of it. Excel will still eat
    // the leading zero on a double-click — see the note in csv.ts for why that is
    // the fight not worth picking.
    formatBdMobile(s.phone),
    s.guardian_name,
    formatBdMobile(s.guardian_phone),
    // ' · ' rather than a comma, even though the writer would quote a comma
    // correctly. A batch may itself be called "Class 9, Morning", and an owner
    // splitting this column on a comma would get two batches out of one. The
    // middle dot appears in no name anybody types.
    activeBatchNames(s).join(' · '),
    d.studentForm.status[s.status] ?? s.status,
    s.sms_opt_out ? t.yes : t.no,
    s.admitted_on,
  ])

  return {
    ok: true,
    sheet: {
      header: [
        t.colCode,
        t.colName,
        t.colClass,
        t.colInstitution,
        t.colStudentPhone,
        t.colGuardianName,
        t.colGuardianPhone,
        t.colBatch,
        t.colStatus,
        t.colSmsOff,
        t.colAdmitted,
      ],
      rows,
      // A snapshot is dated by the day it was taken. Two rosters downloaded a
      // month apart otherwise land in the same folder under the same name, and
      // the older one wins or is silently overwritten depending on the browser.
      period: todayInDhaka(),
    },
  }
}

function activeBatchNames(s: StudentRow): string[] {
  return (s.enrollments ?? [])
    .filter((e) => e.status === 'active')
    .map((e) => one(e.batches)?.name ?? '')
    .filter(Boolean)
}

/**
 * A month's takings, one row per payment, in the order they were received.
 *
 * The same query as the printed register, deliberately: an owner who reconciles on
 * paper and an owner who reconciles in a spreadsheet must not be able to get two
 * different answers for one month. No running total column — a spreadsheet computes
 * that better than we can, and the printed register is where it is load-bearing.
 */
async function buildCollections(ctx: ReportContext): Promise<BuildResult> {
  const d = dict(ctx.locale)
  const t = d.exportSheet
  const nextMonth = addMonths(ctx.month, 1)

  const got = await pageAll<PaymentRow>((from, to) =>
    ctx.supabase
      .from('fee_payments')
      .select(PAYMENT_COLUMNS)
      .eq('coaching_center_id', ctx.centerId)
      // The +06:00 offsets are load-bearing, exactly as on the register: paid_at is
      // a timestamptz and these are Dhaka calendar boundaries. Compared against
      // bare dates the cutoff lands at 6am Dhaka, and every payment taken before
      // breakfast on the 1st is counted into the wrong month — in a file whose
      // entire purpose is to be reconciled against a statement that got it right.
      // Half-open, so nothing at the boundary is dropped or counted twice.
      .gte('paid_at', `${ctx.month}T00:00:00+06:00`)
      .lt('paid_at', `${nextMonth}T00:00:00+06:00`)
      .order('paid_at', { ascending: true })
      .order('receipt_no', { ascending: true })
      .range(from, to),
  )
  if ('failed' in got) return { ok: false, reason: got.failed }

  const rows: CsvCell[][] = got.rows.map((p) => {
    const student = one(p.students)
    return [
      // The Dhaka calendar day, not a slice of the UTC timestamp — a payment taken
      // at 1am would otherwise be dated to the day before.
      todayInDhaka(new Date(p.paid_at)),
      p.receipt_no,
      student?.name ?? d.common.unknown,
      student?.student_code,
      d.feeRow.methods[p.method] ?? p.method,
      p.reference,
      Number(p.amount_bdt),
    ]
  })

  return {
    ok: true,
    sheet: {
      header: [
        t.colDate,
        t.colReceipt,
        t.colName,
        t.colCode,
        t.colMethod,
        t.colReference,
        t.colAmount,
      ],
      rows,
      period: ctx.month.slice(0, 7),
    },
  }
}

/**
 * A month's fee sheet: what was billed, what came in, and what is still outstanding.
 *
 * EVERY INVOICE, NOT ONLY THE UNPAID ONES. A sheet of arrears cannot answer "what
 * did we bill in June", which is half of what anybody opens this for, and the status
 * column plus one filter turns this into that sheet whenever the owner wants it.
 *
 * VOIDED INVOICES ARE LEFT OUT. A cancelled bill is not a bill, and including it
 * would mean the billed column no longer totals to what the centre charged — which
 * is the one number somebody will add up by hand to check us.
 */
async function buildDues(ctx: ReportContext): Promise<BuildResult> {
  const d = dict(ctx.locale)
  const t = d.exportSheet

  const got = await pageAll<InvoiceRow>((from, to) =>
    ctx.supabase
      .from('fee_invoice_balances')
      .select(INVOICE_COLUMNS)
      .eq('coaching_center_id', ctx.centerId)
      .eq('period_month', ctx.month)
      .is('voided_at', null)
      .order('student_name', { ascending: true })
      .range(from, to),
  )
  if ('failed' in got) return { ok: false, reason: got.failed }

  // Which batch each line is for, joined here rather than embedded. PostgREST
  // embeds through a view are unreliable — the view is the product of a join
  // already, and the relationship it would have to walk back through is not one
  // Postgres exposes on it — so the enrolment ids are resolved separately and the
  // two lists are stitched in JS. Skipped entirely on an empty month, which is
  // most of them for a centre in its first weeks.
  const batchOf = new Map<string, string>()
  if (got.rows.length > 0) {
    const enrollments = await pageAll<EnrollmentRow>((from, to) =>
      ctx.supabase
        .from('enrollments')
        .select(ENROLLMENT_COLUMNS)
        .eq('coaching_center_id', ctx.centerId)
        .order('id', { ascending: true })
        .range(from, to),
    )
    // The whole centre's enrolments rather than `.in('id', …)` over the ids on the
    // sheet: a thousand uuids is a 37KB query string, and PostgREST is behind a
    // proxy with an opinion about URL length. Paged, so the row count is bounded
    // by the same ceiling as everything else here.
    if ('failed' in enrollments) return { ok: false, reason: enrollments.failed }
    for (const e of enrollments.rows) {
      const name = one(e.batches)?.name
      if (name) batchOf.set(e.id, name)
    }
  }

  const rows: CsvCell[][] = got.rows.map((v) => {
    // Defaulting a missing amount to 0 is the safe direction, exactly as on the
    // board: a row that reads ৳0 is visibly wrong and gets asked about, whereas
    // NaN would spread down a spreadsheet column and take the totals with it.
    const paid = Number(v.paid_bdt ?? 0)
    const remaining = Number(v.remaining_bdt ?? 0)

    return [
      v.student_code,
      v.student_name ?? d.common.unknown,
      v.enrollment_id ? (batchOf.get(v.enrollment_id) ?? '') : '',
      // The month as YYYY-MM, so the column sorts. Every row on one sheet carries
      // the same value, which is not redundant once two months are pasted into
      // one workbook — and somebody always pastes two months into one workbook.
      (v.period_month ?? ctx.month).slice(0, 7),
      Number(v.amount_bdt ?? 0),
      Number(v.discount_bdt ?? 0),
      Number(v.net_bdt ?? 0),
      paid,
      remaining,
      remaining <= 0 ? t.paid : paid > 0 ? t.partial : t.unpaid,
      v.due_date,
      formatBdMobile(v.guardian_phone),
    ]
  })

  return {
    ok: true,
    sheet: {
      header: [
        t.colCode,
        t.colName,
        t.colBatch,
        t.colMonth,
        t.colBilled,
        t.colDiscount,
        t.colNet,
        t.colPaid,
        t.colRemaining,
        t.colStatus,
        t.colDueDate,
        t.colGuardianPhone,
      ],
      rows,
      period: ctx.month.slice(0, 7),
    },
  }
}
