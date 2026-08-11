// Relative, with the extension, rather than the usual `@/lib/...` alias: this
// module and its tests run under `node --test` directly, and Node resolves
// neither tsconfig paths nor extensionless specifiers. Billing arithmetic is
// worth keeping runnable outside the bundler.
import { measureSms } from './encoding.ts'

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
