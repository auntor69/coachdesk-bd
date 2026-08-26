/**
 * The founder's customer list: `platform_centers()` rows turned into the screen.
 *
 * Everything about *who* the customers are and how much they use the product
 * happens in 20260811000020_platform_panel.sql, which is the only thing that may
 * read past a platform admin's RLS. What is left for this file is the part that is
 * about the business rather than the database: what each centre should be billed,
 * which of them have gone quiet, and what the row of totals across the top says.
 *
 * THE BILL IS NOT COMPUTED HERE EITHER. `monthlyBillBdt` in ../plans.ts is called,
 * never reimplemented — the bands, the ৳1999 floor and the ৳100 seat live there
 * once, because the pricing calculator an owner reads on /settings/plan and this
 * panel have to quote the same figure. A centre told ৳2,400 on their screen and
 * invoiced ৳2,700 from this one is a refund and an apology.
 *
 * WHAT THIS FILE IS ALLOWED TO DECIDE is `QUIET_AFTER_DAYS`, and that is the
 * mirror of the argument student_risk makes: a threshold with two readers belongs
 * in the database where neither can drift, and a threshold with exactly one reader
 * belongs next to its reader. Nothing but this panel asks whether a centre has
 * gone quiet.
 *
 * Relative imports with the extension, like every other unit-tested module here:
 * these tests run under `node --test`, which resolves neither tsconfig paths nor
 * extensionless specifiers.
 */

import type { CsvCell } from '../csv.ts'
import type { Locale } from '../i18n/locale.ts'
import { monthlyBillBdt, planFor, planName, type PlanId } from '../plans.ts'
import { formatTaka } from '../money.ts'
import { digits, todayInDhaka } from '../bd/time.ts'

/** Matches `center_status` in 20260811000001_init_schema.sql. */
export type CenterStatus = 'trial' | 'active' | 'suspended' | 'cancelled'

/**
 * One row of `platform_centers()` as PostgREST hands it back.
 *
 * Written out rather than imported from the generated types, for the same reason
 * RiskRow is: this is the contract between one SQL function and one screen, and
 * spelling it here means a column renamed in the migration is a type error at
 * every call site instead of an `undefined` that renders as a blank cell.
 *
 * The two `numeric` columns arrive as **strings**. PostgREST serialises numeric
 * that way on purpose — the type is arbitrary-precision and a double would round
 * it — so both go through Number() below. Reading `collected_30d` directly would
 * concatenate rather than add, and a totals row of "0450012000" is the kind of bug
 * that looks like a font problem.
 */
export type PlatformCenterRow = {
  center_id: string | null
  center_name: string | null
  center_phone: string | null
  bd_area: string | null
  status: CenterStatus | null
  plan: PlanId | null
  created_at: string | null
  owner_name: string | null
  owner_phone: string | null
  students: number | null
  teachers: number | null
  batches: number | null
  sms_credit_balance: number | null
  attendance_30d: number | null
  exams_30d: number | null
  fee_payments_30d: number | null
  collected_30d: string | number | null
  taps_30d: number | null
  notes_30d: number | null
  sms_30d: number | null
  last_active_at: string | null
  paid_bdt: string | number | null
  last_paid_at: string | null
  /** A `date`, so YYYY-MM-DD with no time. Null when nothing says what was bought. */
  paid_through: string | null
  /**
   * The centre's open upgrade request, from a left join, so all three are null
   * together when there isn't one.
   *
   * The one column on this row that came from the customer rather than from their
   * behaviour: everything else here is counted, and this is asked for. Which is why
   * it is worth a chip on the card and a tile in the totals — a founder with eleven
   * customers and one asking to pay more has exactly one thing to do today.
   */
  wants_plan: PlanId | null
  wants_since: string | null
  wants_note: string | null
}

/**
 * How long a centre may say nothing before it is worth a phone call.
 *
 * Fourteen days, and the unit is what makes it defensible: a coaching centre runs
 * classes six days a week, so two weeks without a single register, exam, payment or
 * chase is not a slow patch — it is a customer who has stopped using the product
 * and has not yet told us. Shorter than this and every Eid holiday lights the panel
 * up; much longer and the call happens after they have already gone back to the
 * notebook.
 *
 * Deliberately not the thirty days the usage counts use. Those measure how much a
 * live customer does; this one asks whether they are still there at all, and the
 * second question has to be answered sooner than the first.
 */
export const QUIET_AFTER_DAYS = 14

const MS_PER_DAY = 86_400_000

/** A customer, as the founder panel and its CSV both read them. */
export type Customer = {
  centerId: string
  name: string
  phone: string | null
  area: string | null
  status: CenterStatus
  plan: PlanId
  /** ISO timestamp of signup, straight through for formatting by the caller. */
  createdAt: string | null
  ownerName: string | null
  ownerPhone: string | null
  students: number
  teachers: number
  batches: number
  smsCredits: number
  /** What we should invoice this month, from ../plans.ts. */
  billBdt: number
  attendance30d: number
  exams30d: number
  feePayments30d: number
  /** Taka this centre collected from parents through the product, net of refunds. */
  collected30d: number
  /** Tap-to-send fee chases from the owner's own handset. Free, and the large one. */
  taps30d: number
  /**
   * Weekly progress notes, also tap-to-send and also free, counted apart.
   *
   * Apart from `taps30d` because the two are two different products: chases mean a
   * centre using this to get paid, notes mean a teacher using it to keep parents.
   * Which of the two a customer does is the most useful thing on this screen when
   * the question is what to build next, and a sum cannot be un-summed.
   */
  notes30d: number
  /** Metered gateway sends. Zero everywhere until a BTRC sender ID exists. */
  sms30d: number
  lastActiveAt: string | null
  /** Whole days since the last sign of life; null if there has never been one. */
  daysQuiet: number | null
  /** Past QUIET_AFTER_DAYS, or never active at all. */
  quiet: boolean
  /** All-time taka received from this centre. Zero until a payment is recorded. */
  paidBdt: number
  lastPaidAt: string | null
  /**
   * The furthest day any payment from this centre covers, or null if none says.
   *
   * A calendar date and not a timestamp, straight through for formatting: it is a
   * billing boundary, not an instant, and the day it lands on does not move with a
   * timezone.
   */
  paidThrough: string | null
  /**
   * A live customer whose paid-up date has passed, or who has never paid at all.
   *
   * Deliberately narrow. Only `active` centres on a billing plan can owe anything —
   * the same rule `mrrBdt` uses, and for the same reason: a trial owes nothing by
   * definition, a free teacher owes nothing at any date, and a cancelled centre is
   * not a debt but a decision that has already been made. Widening this to suspended
   * centres would light up every account that was switched off *because* it never
   * paid, turning a call list into a graveyard.
   */
  owes: boolean
  /**
   * The tier this centre has asked to be moved onto, or null if they have not asked.
   *
   * Not a plan they are on and not a plan they are entitled to — `coaching_centers.plan`
   * stays locked to the founder's own action, and this is a note saying "ring me". The
   * distinction matters on the screen: a chip that read like a tier would have a
   * founder believing a customer is already paying for something nobody has invoiced.
   */
  wantsPlan: PlanId | null
  /** When they asked. ISO through, formatted by the caller. */
  wantsSince: string | null
  /** Whatever the owner typed with the request. Usually empty; occasionally the deal. */
  wantsNote: string | null
}

function count(value: number | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** numeric-as-string to a number, or 0. See the note on PlatformCenterRow. */
function taka(value: string | number | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * The customer list, in the order the function returned it.
 *
 * No re-sorting, and that is the promise the migration's own comment makes: the
 * screen and the downloaded CSV list the same centres in the same sequence, so a
 * founder working down one can pick up where they left off in the other. The quiet
 * ones are marked rather than moved, because the row that matters most on this
 * screen changes with what the founder is doing — chasing a lapse, checking a bill,
 * or looking up the centre they signed up on Tuesday — and any one order would be
 * wrong for the other two.
 *
 * `now` is a parameter so the quiet threshold is testable without freezing a clock.
 */
export function customers(
  rows: PlatformCenterRow[] | null | undefined,
  unnamed: string,
  now: Date = new Date(),
): Customer[] {
  const list: Customer[] = []

  // The founder's own calendar day, so "paid up until the 31st" stops meaning owed on
  // the 31st. Dhaka is six hours ahead of UTC, so a UTC date lags the local one from
  // midnight to 6am: a centre whose coverage ran out yesterday would still read as
  // paid up through the whole of the founder's morning, which is exactly when this
  // list gets worked through.
  const today = todayInDhaka(now)

  for (const row of rows ?? []) {
    // No id means nothing can be keyed, linked or rung. Unreachable through the
    // function, which selects a primary key; cheap to skip if it ever is.
    if (!row.center_id) continue

    const students = count(row.students)
    const teachers = count(row.teachers)
    const plan = row.plan ?? 'teacher_free'
    const status = row.status ?? 'trial'

    const lastActiveAt = row.last_active_at ?? null
    const lastActiveMs = lastActiveAt ? Date.parse(lastActiveAt) : NaN
    const daysQuiet = Number.isFinite(lastActiveMs)
      ? Math.max(0, Math.floor((now.getTime() - lastActiveMs) / MS_PER_DAY))
      : null

    const billBdt = monthlyBillBdt(planFor(plan), students, teachers)
    const paidThrough = row.paid_through ?? null

    list.push({
      centerId: row.center_id,
      name: row.center_name || unnamed,
      phone: row.center_phone ?? null,
      area: row.bd_area ?? null,
      status,
      plan,
      createdAt: row.created_at ?? null,
      ownerName: row.owner_name ?? null,
      ownerPhone: row.owner_phone ?? null,
      students,
      teachers,
      batches: count(row.batches),
      smsCredits: count(row.sms_credit_balance),
      billBdt,
      attendance30d: count(row.attendance_30d),
      exams30d: count(row.exams_30d),
      feePayments30d: count(row.fee_payments_30d),
      collected30d: taka(row.collected_30d),
      taps30d: count(row.taps_30d),
      notes30d: count(row.notes_30d),
      sms30d: count(row.sms_30d),
      lastActiveAt,
      daysQuiet,
      // A centre with no activity at all is quiet whatever its signup date. It may
      // simply be new — the screen says "never" rather than a day count, and a
      // founder can tell the difference between a customer who never started and
      // one who stopped.
      quiet: daysQuiet === null || daysQuiet >= QUIET_AFTER_DAYS,
      paidBdt: taka(row.paid_bdt),
      lastPaidAt: row.last_paid_at ?? null,
      paidThrough,
      // String comparison, which is exact on two YYYY-MM-DD and needs no parsing. A
      // null paid_through on a billing centre is the pay-first-at-signup case that
      // did not happen, so it counts as owing.
      owes:
        status === 'active' && billBdt > 0 && (paidThrough === null || paidThrough < today),
      wantsPlan: row.wants_plan ?? null,
      wantsSince: row.wants_since ?? null,
      // Trimmed to nothing rather than kept as whitespace: the screen decides whether
      // to render a line by asking whether this is null, and a note of three spaces
      // would draw an empty quotation mark under a customer's name.
      wantsNote: row.wants_note?.trim() || null,
    })
  }

  return list
}

/**
 * The strip across the top: the whole business in one line.
 *
 * `mrrBdt` counts centres whose status is `active` and nothing else. A trial is not
 * revenue — counting it would make the one number the founder checks daily go up
 * when somebody signs up for free, which is the number most likely to be believed
 * and the worst one to be wrong. `pipelineBdt` carries the trials separately,
 * because what they are worth on conversion is a real figure and worth watching; a
 * suspended or cancelled centre appears in neither.
 *
 * `collected30d` is not our money — it is what parents paid these centres through
 * the product. It belongs here because it is the honest measure of whether this
 * thing works, and because it is the number to quote to the next customer.
 */
export type PlatformTotals = {
  centers: number
  active: number
  trial: number
  quiet: number
  students: number
  teachers: number
  mrrBdt: number
  pipelineBdt: number
  collected30d: number
  taps30d: number
  notes30d: number
  sms30d: number
  paidBdt: number
  /** Live customers past their paid-up date. The founder's call list. */
  owing: number
  /**
   * What those customers owe for the month they are in, at today's size.
   *
   * A month and not the arrears to date, because arrears would need a per-centre
   * history this panel does not have and would be wrong the moment a centre changed
   * size. One month of billing is the honest, checkable version of "this is what is
   * sitting out there", and it is a subset of `mrrBdt` by construction — every centre
   * counted here is `active` and billing.
   */
  owedBdt: number
  /**
   * Customers who have asked to change plan and not been answered yet.
   *
   * The only figure in this row that is a to-do rather than a measurement, which is
   * why it earns a place beside twelve numbers about money: everything else here
   * describes what already happened, and this one is somebody waiting for a phone
   * call. Zero is the normal reading and the useful one — a non-zero is work.
   */
  asking: number
}

export function platformTotals(list: readonly Customer[]): PlatformTotals {
  const totals: PlatformTotals = {
    centers: list.length,
    active: 0,
    trial: 0,
    quiet: 0,
    students: 0,
    teachers: 0,
    mrrBdt: 0,
    pipelineBdt: 0,
    collected30d: 0,
    taps30d: 0,
    notes30d: 0,
    sms30d: 0,
    paidBdt: 0,
    owing: 0,
    owedBdt: 0,
    asking: 0,
  }

  for (const c of list) {
    if (c.status === 'active') {
      totals.active += 1
      totals.mrrBdt += c.billBdt
    }
    if (c.status === 'trial') {
      totals.trial += 1
      totals.pipelineBdt += c.billBdt
    }
    if (c.quiet) totals.quiet += 1
    // Counted whatever the status. A trial asking to be put on Centre is the single
    // most valuable row this panel can hold, and a status filter here would drop it.
    if (c.wantsPlan) totals.asking += 1
    if (c.owes) {
      totals.owing += 1
      totals.owedBdt += c.billBdt
    }
    totals.students += c.students
    totals.teachers += c.teachers
    totals.collected30d += c.collected30d
    totals.taps30d += c.taps30d
    totals.notes30d += c.notes30d
    totals.sms30d += c.sms30d
    totals.paidBdt += c.paidBdt
  }

  return totals
}

/* -------------------------------------------------------------------------- */
/* The download                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Column headings for the customer CSV, in the founder's own language.
 *
 * Separate from the dictionary group the screen uses, and passed in rather than
 * imported, so this module stays free of `@/` and testable under node --test.
 */
export type CustomerCsvHeadings = {
  name: string
  area: string
  status: string
  plan: string
  bill: string
  owner: string
  ownerPhone: string
  centerPhone: string
  students: string
  teachers: string
  batches: string
  signedUp: string
  attendance: string
  exams: string
  payments: string
  collected: string
  taps: string
  notes: string
  sms: string
  smsCredits: string
  lastActive: string
  quietDays: string
  paid: string
  lastPaid: string
  paidThrough: string
  owes: string
  wants: string
  wantsSince: string
  wantsNote: string
}

export type CustomerCsvWords = {
  headings: CustomerCsvHeadings
  /** One word per center_status, so a spreadsheet filter reads in Bangla. */
  status: Record<CenterStatus, string>
  /** The two words the `owes` column holds, so it can be filtered on. */
  yes: string
  no: string
}

/**
 * The customer list as a sheet.
 *
 * WHAT IS NOT IN IT: a single student. The founder's downloads folder is the last
 * place a minor's name, marks or guardian's number should end up, and "per-centre
 * export" in the masterplan means a row per centre — which is all this function
 * has to work with, because the RPC behind it cannot return anything else.
 *
 * Headings and the status words are localised; every value is machine-readable, the
 * same split the /api/export sheets use. Money is a bare number and not formatTaka
 * — a ৳ or a thousands separator turns the column into text that the founder's own
 * SUM cannot total, which is the entire reason to download it. Dates are the raw
 * ISO timestamp for the same reason: a spreadsheet can sort and subtract those, and
 * "২৪ আগস্ট" sorts alphabetically.
 */
export function customersSheet(
  list: readonly Customer[],
  words: CustomerCsvWords,
): { header: string[]; rows: CsvCell[][] } {
  const h = words.headings

  const header = [
    h.name,
    h.area,
    h.status,
    h.plan,
    h.bill,
    h.owner,
    h.ownerPhone,
    h.centerPhone,
    h.students,
    h.teachers,
    h.batches,
    h.signedUp,
    h.attendance,
    h.exams,
    h.payments,
    h.collected,
    h.taps,
    h.notes,
    h.sms,
    h.smsCredits,
    h.lastActive,
    h.quietDays,
    h.paid,
    h.lastPaid,
    h.paidThrough,
    h.owes,
    h.wants,
    h.wantsSince,
    h.wantsNote,
  ]

  const rows: CsvCell[][] = list.map((c) => [
    c.name,
    c.area,
    words.status[c.status],
    // The plan's product name rather than the enum: this file is read by a person,
    // and `teacher_plus` is not what anybody calls it.
    planName(planFor(c.plan), 'en'),
    c.billBdt,
    c.ownerName,
    c.ownerPhone,
    c.phone,
    c.students,
    c.teachers,
    c.batches,
    c.createdAt,
    c.attendance30d,
    c.exams30d,
    c.feePayments30d,
    c.collected30d,
    c.taps30d,
    c.notes30d,
    c.sms30d,
    c.smsCredits,
    c.lastActiveAt,
    c.daysQuiet,
    c.paidBdt,
    c.lastPaidAt,
    c.paidThrough,
    // A word rather than a boolean: TRUE/FALSE in a Bangla sheet is a column the
    // reader has to translate in their head, and a spreadsheet filters on either.
    c.owes ? words.yes : words.no,
    // Blank rather than a word when nobody asked, so sorting this column puts the
    // customers who did at one end. The product name for the same reason the `plan`
    // column carries one — this file is read by a person.
    c.wantsPlan ? planName(planFor(c.wantsPlan), 'en') : null,
    c.wantsSince,
    c.wantsNote,
  ])

  return { header, rows }
}

/**
 * `coachdesk-customers-2026-08-25.csv` — ASCII, dated, and sortable in a folder.
 *
 * `now` in, so the filename cannot be a day out from the data in it and so the test
 * does not have to mock a clock.
 */
export function customersFileName(now: Date = new Date()): string {
  // Sliced from the ISO string rather than built from getFullYear/getMonth: this is
  // a filename, UTC is unambiguous, and a founder in Dhaka downloading at 2am is
  // better served by a stable name than by a local-midnight edge case.
  const day = now.toISOString().slice(0, 10)
  return `coachdesk-customers-${day}.csv`
}

/**
 * One line of prose under a centre's name: "৩ batches · ৪৭ students".
 *
 * Here rather than in the page because the numerals rule is easy to get wrong in
 * JSX and impossible to test there — prose counts go through `digits` so they
 * render Bangla in Bangla, while `formatTaka` keeps every taka figure in ASCII.
 * The same two rules the rest of the product follows, applied in one place the
 * screen cannot forget.
 */
export function sizeLine(
  c: Customer,
  locale: Locale,
  words: { students: string; batches: string; teachers: string },
): string {
  return [
    `${digits(c.students, locale)} ${words.students}`,
    `${digits(c.batches, locale)} ${words.batches}`,
    `${digits(c.teachers, locale)} ${words.teachers}`,
  ].join(' · ')
}

/** The bill as the founder reads it: ASCII taka, like every other money figure. */
export function billLabel(c: Customer): string {
  return formatTaka(c.billBdt)
}
