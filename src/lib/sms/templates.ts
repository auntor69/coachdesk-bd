// Relative, with the extension, rather than the usual `@/lib/...` alias: this
// module and its tests run under `node --test` directly, and Node resolves
// neither tsconfig paths nor extensionless specifiers. Billing arithmetic is
// worth keeping runnable outside the bundler.
import { measureSms } from './encoding.ts'
import { formatTaka } from '../money.ts'
import { monthNameBn, formatDateBn } from '../bd/time.ts'

/**
 * The result SMS.
 *
 * Written to fit **one UCS-2 segment (70 characters)**, because Bangla costs a
 * segment every 70 characters and a centre on the free plan has 50 credits to
 * spend. A two-segment template silently halves what they get.
 *
 * The centre's name is last and never trimmed. Bangladeshi operators deliver
 * bulk SMS from a shared numeric mask unless the centre has registered its own
 * sender ID with the aggregator, so without the name in the body a parent
 * receives marks about their child from an unidentified number — which reads as
 * spam and gets the centre reported.
 */

/** Room reserved for the centre's name and the separator before it. */
const BRAND_BUDGET = 24

export type ResultSmsInput = {
  studentName: string
  examTitle: string
  obtainedMarks: number | null
  totalMarks: number
  isAbsent: boolean
  centerName: string
  /** The teacher's per-student remark. Included only if it fits for free. */
  note?: string | null
}

/**
 * Trims to a whole word where it can, mid-word only when the first word is
 * itself too long. A name cut to "রাফি" is recognisable; one cut to "রাফিদ হা"
 * looks like a bug to the parent reading it.
 */
function clamp(value: string, max: number): string {
  const text = value.trim().replace(/\s+/g, ' ')
  if ([...text].length <= max) return text

  const words = text.split(' ')
  let out = ''
  for (const word of words) {
    const candidate = out ? `${out} ${word}` : word
    if ([...candidate].length > max) break
    out = candidate
  }
  return out || [...text].slice(0, max).join('')
}

/**
 * Marks stay in ASCII digits.
 *
 * A parent compares this number against a report card and sometimes asks the
 * centre about it over the phone; mixing numeral systems around a figure that
 * gets read aloud and re-typed is how a 45 becomes a ৪৫ becomes a 40. Bangla
 * numerals are used for dates and times, where nobody re-types anything.
 */
function marksText(obtained: number | null, total: number): string {
  const clean = (n: number) => String(Number(n.toFixed(2))).replace(/\.00$/, '')
  return obtained === null ? clean(total) : `${clean(obtained)}/${clean(total)}`
}

export type ResultSms = {
  body: string
  segments: number
  /** True when the note or title had to be dropped to hold one segment. */
  trimmed: boolean
}

export function buildResultSms(input: ResultSmsInput): ResultSms {
  const brand = clamp(input.centerName, BRAND_BUDGET - 2)
  const name = clamp(input.studentName, 18)
  const title = clamp(input.examTitle, 20)

  const result = input.isAbsent
    ? 'অনুপস্থিত'
    : marksText(input.obtainedMarks, input.totalMarks)

  const core = `${name}, ${title}: ${result}।`
  const tail = ` -${brand}`

  // The note is the first thing to go. It is genuinely useful — "হাতের লেখা
  // ভালো করতে হবে" tells a parent more than a number does — but it is the only
  // part that is optional, and paying double for it is not the centre's choice
  // to make silently. It stays visible in the app either way.
  const note = (input.note ?? '').trim().replace(/\s+/g, ' ')
  if (note) {
    const withNote = `${core} ${note}${tail}`
    if (measureSms(withNote).segments <= 1) {
      return { body: withNote, segments: 1, trimmed: false }
    }
  }

  const body = `${core}${tail}`
  const { segments } = measureSms(body)

  return { body, segments, trimmed: Boolean(note) }
}

/**
 * One line of the preview an owner approves before any credit is spent.
 *
 * Built from the same function that builds the real message, so what they read
 * is what the parent receives — not an approximation of it.
 */
export function previewResultSms(input: ResultSmsInput): string {
  return buildResultSms(input).body
}

/* -------------------------------------------------------------------------- */
/* Fee reminders                                                              */
/* -------------------------------------------------------------------------- */

export type FeeReminderInput = {
  studentName: string
  /** YYYY-MM-01, the shape fee_invoices.period_month uses. */
  periodMonth: string
  /** Taka still owed on the invoice, as the board computed it. */
  amount: number
  /** YYYY-MM-DD. */
  dueDate: string
  /** Positive when the due date has passed, which changes the tense used. */
  daysLate: number
  centerName: string
}

export type FeeReminderSms = {
  body: string
  segments: number
}

/**
 * The fee reminder, sized for one SMS.
 *
 * Today this goes out through the owner's own handset via a prefilled `sms:`
 * link, so the segment it costs is billed to them by their own operator rather
 * than to their credit balance. That makes the 70-character UCS-2 limit exactly
 * as real as it is for a gateway send — an owner working through twenty overdue
 * families should pay for twenty messages, not forty — and it means this is
 * already the template the cron worker will use once a sender ID exists.
 *
 * Phrasing degrades in steps rather than being clamped to fit. A long centre
 * name, a long month ("ফেব্রুয়ারি" is eleven characters), and a five-figure
 * amount can genuinely not coexist with a natural sentence inside 70, and the
 * thing to give up is politeness — never the name, the month, the amount, or who
 * is asking. The name budget is 14 rather than the 18 a result SMS allows,
 * because that is what buys the month a place at the worst case: a guardian
 * reading "মোহাম্মদ সাদিয়া" knows which child this is, and a family two months
 * behind genuinely does not know which month a bare amount refers to.
 *
 * Which step was needed is not something the owner is asked to care about; the
 * message they see before sending is the message that goes.
 */
export function buildFeeReminderSms(input: FeeReminderInput): FeeReminderSms {
  const brand = clamp(input.centerName, BRAND_BUDGET - 2)
  const name = clamp(input.studentName, 14)
  const month = monthNameBn(input.periodMonth)
  const money = formatTaka(input.amount)
  const tail = ` -${brand}`

  const ladder = [
    `${name}, ${month} মাসের ফি ${money} বাকি আছে।${tail}`,
    `${name}, ${month} মাসের ফি ${money} বাকি।${tail}`,
    `${name}, ${month}: ফি ${money} বাকি।${tail}`,
  ]

  for (const body of ladder) {
    if (measureSms(body).segments <= 1) return { body, segments: 1 }
  }

  // Nothing fit, which takes a centre name and a student name both at their
  // limits. Send the terse one anyway rather than dropping the month or the
  // amount: two segments costs the owner one extra SMS, a message the parent
  // cannot act on costs them the fee.
  const body = ladder[ladder.length - 1]
  return { body, segments: measureSms(body).segments }
}

/**
 * The same reminder for WhatsApp, where nothing is metered.
 *
 * So it says what an SMS has no room for: which month, what the deadline was,
 * and that the centre will listen if the family is struggling. Parents in
 * Bangladesh receive a great deal of terse automated SMS and very little of it
 * politely; a message that reads as though a person at the centre wrote it is
 * more likely to be answered, and this is a request for money from a family that
 * has already been late once.
 *
 * "প্রিয় অভিভাবক" rather than a religious greeting on purpose. The default
 * salutation in Bangladesh assumes a Muslim family, and a coaching centre's
 * roster is not uniformly one thing — a fee reminder is the wrong place to guess
 * wrong about somebody's household.
 */
export function buildFeeReminderText(input: FeeReminderInput): string {
  const money = formatTaka(input.amount)
  const month = monthNameBn(input.periodMonth)
  const due = formatDateBn(input.dueDate)

  // Tense follows the fact. A row can be unpaid without being late — an owner
  // may well send this the morning a bill is raised — and telling a family the
  // deadline "was" a date still in their future reads as a threat over nothing.
  const deadline =
    input.daysLate > 0
      ? `জমা দেওয়ার শেষ তারিখ ছিল ${due}।`
      : `জমা দেওয়ার শেষ তারিখ ${due}।`

  return [
    'প্রিয় অভিভাবক,',
    '',
    `${input.studentName} — ${month} মাসের কোচিং ফি ${money} বাকি আছে। ${deadline}`,
    '',
    'সুবিধামতো সময়ে জমা দিয়ে দিলে ভালো হয়। কোনো অসুবিধা থাকলে জানাবেন।',
    '',
    `- ${input.centerName}`,
  ].join('\n')
}
