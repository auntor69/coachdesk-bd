/**
 * The five sheets an owner can download, and what goes in each column.
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
import { dict, localName, type Locale } from '../i18n/index.ts'
import { addMonths, todayInDhaka } from '../bd/time.ts'
import { formatBdMobile } from '../bd/phone.ts'
import type { createClient } from '../supabase/server.ts'
import type {
  AttendanceStatus,
  OutreachChannel,
  PaymentMethod,
  StudentStatus,
} from '../supabase/types.ts'

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * The catalogue, in the order the download screen lists them.
 *
 * Grouped by what the reader is holding it for: who is here, what came in, what is
 * owed, who is turning up, how they are doing. The two teaching sheets come last
 * because the money ones are what an owner opens this screen for in month one.
 */
export const REPORT_IDS = [
  'students',
  'collections',
  'dues',
  'attendance',
  'marks',
] as const

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
  attendance: true,
  marks: true,
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

const STUDENT_COLUMNS = 'name, student_code, class_level, institution, phone, guardian_name, guardian_phone, status, sms_opt_out, preferred_channel, admitted_on, enrollments (status, batches (name))'

const PAYMENT_COLUMNS = 'receipt_no, amount_bdt, method, reference, paid_at, students (name, student_code)'

const INVOICE_COLUMNS = 'student_name, student_code, guardian_phone, amount_bdt, discount_bdt, net_bdt, paid_bdt, remaining_bdt, due_date, period_month, enrollment_id'

const ENROLLMENT_COLUMNS = 'id, batches (name)'

/*
 * The two teaching sheets both read a child table through its parent, and that is a
 * choice worth stating once. PostgREST can filter on an embedded table with an
 * `!inner` join — `attendance_records` filtered by `attendance_sessions.session_date`
 * — but supabase-js then loses the row shape and hands back `unknown` for every
 * column, and the filter itself is one of the few places PostgREST's semantics
 * surprise people. The parent is the thing being filtered here anyway: a month of
 * sessions, a month of exams. So the date filter goes on the parent, where it is
 * ordinary, and the children ride along as an embedded array.
 */

const ATTENDANCE_SESSION_COLUMNS = 'batch_id, session_date, attendance_records (enrollment_id, status)'

const ROSTER_COLUMNS = 'id, batch_id, enrolled_at, ended_at, students (name, student_code, guardian_phone), batches (name)'

const EXAM_COLUMNS = 'title, exam_date, total_marks, pass_marks, batches (name), subjects (name, name_bn), exam_types (name, name_bn), exam_results (enrollment_id, obtained_marks, is_absent)'

const MARK_ROSTER_COLUMNS = 'id, students (name, student_code)'

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
  preferred_channel: OutreachChannel | null
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

type SessionRow = {
  batch_id: string
  session_date: string
  attendance_records:
    | { enrollment_id: string; status: AttendanceStatus }[]
    | null
}

type RosterRow = {
  id: string
  batch_id: string
  enrolled_at: string
  ended_at: string | null
  students: Embed<{
    name: string
    student_code: string | null
    guardian_phone: string | null
  }>
  batches: Embed<{ name: string }>
}

type ExamRow = {
  title: string
  exam_date: string
  total_marks: number
  pass_marks: number | null
  batches: Embed<{ name: string }>
  subjects: Embed<{ name: string; name_bn: string | null }>
  exam_types: Embed<{ name: string; name_bn: string | null }>
  exam_results:
    | {
        enrollment_id: string
        obtained_marks: number | null
        is_absent: boolean
      }[]
    | null
}

type MarkRosterRow = {
  id: string
  students: Embed<{ name: string; student_code: string | null }>
}

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
    case 'attendance':
      return buildAttendance(ctx)
    case 'marks':
      return buildMarks(ctx)
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
    /*
     * Next to the opt-out because they are the two contact columns and an owner
     * reading the file wants them together — one says whether this family may be
     * messaged, the other which button gets tapped first.
     *
     * It is here at all because this is the column the centre *typed*. Everything
     * else on the row came off an admission form and could be retyped from one;
     * which of three channels a particular father actually answers is a thing the
     * owner learned over a term, 150 times, and it exists nowhere but this
     * database. A file an owner keeps before switching phones has to contain it.
     *
     * The same word the dropdown that set it uses, including for null — "not
     * known" is the honest reading, and an empty cell would be indistinguishable
     * from a column the export forgot.
     */
    s.preferred_channel ? d.channels[s.preferred_channel] : d.optOutList.channelAny,
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
        t.colChannel,
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

/**
 * Who turned up this month: one row per student per batch, counted not listed.
 *
 * NOT THE PAPER REGISTER, AND THAT IS THE DECISION IN THIS FILE MOST WORTH ARGUING
 * WITH. The obvious shape is the grid a centre already keeps on paper — names down
 * the side, the days of the month across the top, a mark in each box. It was written
 * that way first and thrown away, for two reasons. One CSV has one heading row, so
 * the day columns would have to be a fixed 1–31 while every batch meets on its own
 * three days a week, which leaves a sheet that is nine-tenths blank and in which
 * "no class that day" and "class held, nobody marked it" look identical. And a mark
 * per box is a record to look things up in, which is what the app itself is for: the
 * register screen already answers "was Rahim here on the 12th" in two taps.
 *
 * What no screen answers is "who is slipping", sorted, with a number beside each
 * name and their guardian's phone in the next column. That is a spreadsheet's job and
 * it is this sheet.
 *
 * THE SESSIONS COLUMN IS PER STUDENT, NOT PER BATCH. A student who enrolled on the
 * 20th is counted against the classes held after the 20th; charging them for the
 * whole month's classes would read as three weeks of truancy on their first sheet.
 * The enrolment's own window bounds it.
 *
 * LATE COUNTS AS PRESENT IN THE RATE, AND EXCUSED COMES OUT OF THE DENOMINATOR. A
 * student who was there but late was there, and a granted leave is not a day they
 * failed to attend. Both are also in columns of their own, so an owner who disagrees
 * can work out their own figure from the same row.
 */
async function buildAttendance(ctx: ReportContext): Promise<BuildResult> {
  const d = dict(ctx.locale)
  const t = d.exportSheet
  const nextMonth = addMonths(ctx.month, 1)

  const sessions = await pageAll<SessionRow>((from, to) =>
    ctx.supabase
      .from('attendance_sessions')
      .select(ATTENDANCE_SESSION_COLUMNS)
      .eq('coaching_center_id', ctx.centerId)
      // `session_date` is a date and not a timestamptz, so these are plain calendar
      // bounds that need none of the +06:00 the collections sheet lives or dies by.
      // Half-open anyway, so both monthly sheets are read the same way.
      .gte('session_date', ctx.month)
      .lt('session_date', nextMonth)
      .order('session_date', { ascending: true })
      .range(from, to),
  )
  if ('failed' in sessions) return { ok: false, reason: sessions.failed }

  // When each batch met, and what each student was marked, off the same pass. A
  // second query for the records would have to name every session id in a URL.
  const metOn = new Map<string, string[]>()
  const tally = new Map<string, Tally>()

  for (const session of sessions.rows) {
    const dates = metOn.get(session.batch_id)
    if (dates) dates.push(session.session_date)
    else metOn.set(session.batch_id, [session.session_date])

    for (const record of session.attendance_records ?? []) {
      const counts = tally.get(record.enrollment_id) ?? blankTally()
      // A status this build has never heard of is dropped rather than counted into
      // the wrong column: the enum can grow in a migration before this file knows.
      if (record.status in counts) counts[record.status] += 1
      tally.set(record.enrollment_id, counts)
    }
  }

  // The whole centre's enrolments, filtered here rather than in the query — the same
  // trade the fee sheet makes, and for the same reason. The month test needs two
  // comparisons against a nullable timestamp, which is a PostgREST `or(…)` string
  // that no reader of this file could check; in JS it is three lines.
  const roster = await pageAll<RosterRow>((from, to) =>
    ctx.supabase
      .from('enrollments')
      .select(ROSTER_COLUMNS)
      .eq('coaching_center_id', ctx.centerId)
      .order('id', { ascending: true })
      .range(from, to),
  )
  if ('failed' in roster) return { ok: false, reason: roster.failed }

  const monthStart = Date.parse(`${ctx.month}T00:00:00+06:00`)
  const monthEnd = Date.parse(`${nextMonth}T00:00:00+06:00`)

  const assembled: { batch: string; name: string; cells: CsvCell[] }[] = []

  for (const e of roster.rows) {
    const student = one(e.students)
    const counts = tally.get(e.id)

    const startedAt = Date.parse(e.enrolled_at)
    const endedAt = e.ended_at === null ? null : Date.parse(e.ended_at)
    const overlaps =
      startedAt < monthEnd && (endedAt === null || endedAt >= monthStart)

    // A mark inside the month keeps the row whatever the dates say. An owner who
    // adds a student in September and then backfills August's register has an
    // enrolment younger than its own attendance, and dropping those rows would
    // quietly lose the marks a teacher sat down and entered.
    if (!overlaps && !counts) continue

    const from = todayInDhaka(new Date(e.enrolled_at))
    const until = e.ended_at === null ? null : todayInDhaka(new Date(e.ended_at))
    const inWindow = (metOn.get(e.batch_id) ?? []).filter(
      (date) => date >= from && (until === null || date <= until),
    ).length

    const c = counts ?? blankTally()
    const marked = c.present + c.absent + c.late + c.excused
    // Never fewer classes than the student has marks for. The two are counted from
    // different places — sessions inside the enrolment's window, marks anywhere in
    // the month — and without this a backfilled mark would produce a negative
    // "not marked" and a rate above 100%.
    const held = Math.max(inWindow, marked)
    const countable = held - c.excused
    const batch = one(e.batches)?.name ?? ''
    const name = student?.name ?? d.common.unknown

    assembled.push({
      batch,
      name,
      cells: [
        batch,
        student?.student_code,
        name,
        formatBdMobile(student?.guardian_phone),
        held,
        c.present,
        c.absent,
        c.late,
        c.excused,
        held - marked,
        // Blank, not 0, when there is nothing to divide by. A batch that has not met
        // yet this month would otherwise show every student at 0% — which is a
        // number an owner acts on, and it would be about the wrong person.
        countable > 0 ? Math.round(((c.present + c.late) / countable) * 100) : '',
      ],
    })
  }

  // Batch first, then name: a sheet an owner scrolls is read one batch at a time,
  // and it is the order the register screen already puts students in.
  assembled.sort(
    (a, b) =>
      a.batch.localeCompare(b.batch, 'bn-BD') ||
      a.name.localeCompare(b.name, 'bn-BD'),
  )

  return {
    ok: true,
    sheet: {
      header: [
        t.colBatch,
        t.colCode,
        t.colName,
        t.colGuardianPhone,
        t.colSessions,
        d.attendance.present,
        d.attendance.absent,
        d.attendance.late,
        d.attendance.excused,
        t.colUnmarked,
        t.colRate,
      ],
      rows: assembled.map((row) => row.cells),
      period: ctx.month.slice(0, 7),
    },
  }
}

type Tally = Record<AttendanceStatus, number>

function blankTally(): Tally {
  return { present: 0, absent: 0, late: 0, excused: 0 }
}

/**
 * A month of marks, one row per mark, exam by exam and alphabetical inside each.
 *
 * ONLY MARKS THAT WERE ENTERED. A student with no result row is left out rather than
 * carried as a blank, because this sheet is the record of an exam and not the list of
 * what a teacher has left to do — the exam list already shows how many of a batch
 * have been marked. An absence is an entered mark and is here, in the result column.
 *
 * ONE ROW PER STUDENT PER EXAM, WHICH IS THE LONG SHAPE AND DELIBERATELY SO. The
 * report-card shape — students down the side, subjects across the top — cannot be one
 * CSV: each batch sits a different set of exams, so there is no column set that fits
 * two batches. The long shape pivots into every one of those in a spreadsheet, and it
 * is also the shape a filter works on: one click gives one batch, one subject, or
 * everybody who failed.
 *
 * THE PERCENTAGE IS COMPUTED, NOT STORED. Nothing in the database holds it, marks are
 * out of whatever that exam was out of, and comparing 38 against 45 across two exams
 * is exactly the arithmetic an owner should not be doing by hand.
 */
async function buildMarks(ctx: ReportContext): Promise<BuildResult> {
  const d = dict(ctx.locale)
  const t = d.exportSheet
  const nextMonth = addMonths(ctx.month, 1)

  const exams = await pageAll<ExamRow>((from, to) =>
    ctx.supabase
      .from('exams')
      .select(EXAM_COLUMNS)
      .eq('coaching_center_id', ctx.centerId)
      // A date column again, and the exam's own date — not when the marks were
      // entered. A test sat on the 30th and marked on the 2nd belongs to the month
      // it was sat in, which is the month a parent will ask about.
      .gte('exam_date', ctx.month)
      .lt('exam_date', nextMonth)
      .order('exam_date', { ascending: true })
      .order('title', { ascending: true })
      .range(from, to),
  )
  if ('failed' in exams) return { ok: false, reason: exams.failed }

  // Whose mark each row is. Skipped when the month held no exams, which is every
  // month for a centre that has not started taking them.
  const whoIs = new Map<string, { name: string; code: string | null }>()
  if (exams.rows.length > 0) {
    const roster = await pageAll<MarkRosterRow>((from, to) =>
      ctx.supabase
        .from('enrollments')
        .select(MARK_ROSTER_COLUMNS)
        .eq('coaching_center_id', ctx.centerId)
        .order('id', { ascending: true })
        .range(from, to),
    )
    if ('failed' in roster) return { ok: false, reason: roster.failed }
    for (const e of roster.rows) {
      const student = one(e.students)
      if (student) {
        whoIs.set(e.id, { name: student.name, code: student.student_code })
      }
    }
  }

  const rows: CsvCell[][] = []

  for (const exam of exams.rows) {
    const total = Number(exam.total_marks)
    const passMark = exam.pass_marks === null ? null : Number(exam.pass_marks)
    const batch = one(exam.batches)?.name ?? ''
    // The centre's own words for the subject and the kind of test: the reader's
    // language where they typed both, and whichever one they did type otherwise.
    const subject = localName(one(exam.subjects), ctx.locale)
    const kind = localName(one(exam.exam_types), ctx.locale)

    const marks = (exam.exam_results ?? [])
      .map((result) => ({ result, who: whoIs.get(result.enrollment_id) ?? null }))
      .sort((a, b) =>
        (a.who?.name ?? '').localeCompare(b.who?.name ?? '', 'bn-BD'),
      )

    for (const { result, who } of marks) {
      const obtained =
        result.is_absent || result.obtained_marks === null
          ? null
          : Number(result.obtained_marks)

      rows.push([
        exam.exam_date,
        exam.title,
        kind,
        subject,
        batch,
        who?.code,
        who?.name ?? d.common.unknown,
        total,
        obtained,
        // `total_marks > 0` is a CHECK constraint, so the second test is about what
        // lands in the file if that ever stops being true: a blank, rather than
        // Infinity in a column somebody averages.
        obtained === null || total <= 0
          ? ''
          : Math.round((obtained / total) * 100),
        // Absent first: a student who was not there neither passed nor failed, and
        // an exam with no pass mark set has no verdict to report at all.
        result.is_absent
          ? d.attendance.absent
          : passMark === null || obtained === null
            ? ''
            : obtained >= passMark
              ? t.resultPass
              : t.resultFail,
      ])
    }
  }

  // The one sheet whose length is not bounded by a paged query: the marks ride in on
  // the exams as embedded arrays, so thirty exams of two hundred students is six
  // thousand rows off thirty paged ones. Checked here for the reason pageAll checks
  // it — a file cut short looks exactly like a complete one.
  if (rows.length > MAX_EXPORT_ROWS) return { ok: false, reason: 'tooLarge' }

  return {
    ok: true,
    sheet: {
      header: [
        t.colDate,
        t.colExam,
        t.colExamType,
        t.colSubject,
        t.colBatch,
        t.colCode,
        t.colName,
        t.colTotalMarks,
        t.colObtained,
        t.colPercent,
        t.colResult,
      ],
      rows,
      period: ctx.month.slice(0, 7),
    },
  }
}
