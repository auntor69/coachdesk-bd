// Relative, with the extension, rather than the usual `@/lib/...` alias: this
// module and its tests run under `node --test` directly, and Node resolves
// neither tsconfig paths nor extensionless specifiers. Billing arithmetic is
// worth keeping runnable outside the bundler.
import { measureSms } from './encoding.ts'
import { formatTaka } from '../money.ts'
import { formatBdMobile, normalizeBdMobile } from '../bd/phone.ts'
import { monthName, formatDate, toBanglaDigits } from '../bd/time.ts'
// Type-only, so Node erases the whole statement rather than loading the
// generated types module when these tests run outside the bundler.
import type { PayoutWallet } from '../supabase/types.ts'

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
  /**
   * True when the teacher's note had to be dropped to avoid buying a segment.
   * The gate counts these and names the students, so a note can be shortened
   * before the credits are spent rather than going missing quietly.
   */
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
  //
  // Dropped only when it would actually cost something. A long student name, a
  // long exam title and a long centre name can push the message past 70
  // characters between them, and once that second segment is already being paid
  // for the note rides along inside it for nothing — the fee reminder makes the
  // same call about its payment number, for the same reason.
  const bare = `${core}${tail}`
  const bareSegments = measureSms(bare).segments

  const note = (input.note ?? '').trim().replace(/\s+/g, ' ')
  if (note) {
    const withNote = `${core} ${note}${tail}`
    const { segments } = measureSms(withNote)
    if (segments <= bareSegments) {
      return { body: withNote, segments, trimmed: false }
    }
  }

  return { body: bare, segments: bareSegments, trimmed: Boolean(note) }
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

/**
 * The same result for WhatsApp, where nothing is metered.
 *
 * So it says what 70 characters cannot, and the thing it most has room for is the
 * one thing the SMS gives up first: the teacher's note. `buildResultSms` drops
 * that note whenever keeping it would buy a second segment, which is the right
 * call when somebody is paying by the segment and the wrong one here — "হাতের
 * লেখা ভালো করতে হবে" is the whole reason a parent reads the message twice, and
 * it costs nothing on this channel. Nothing is clamped either: the full name, the
 * full exam title, the full note.
 *
 * ABSENCE IS ITS OWN SENTENCE AND NEVER A ZERO. A child marked absent has no mark
 * by constraint, and a parent who reads "0" concludes something about their child
 * that the centre did not say. The same rule the weekly summary follows.
 *
 * THE PASS MARK IS NAMED WHEN THERE IS ONE, and only then. A number on its own —
 * "34/50" — is a fact a parent cannot act on unless they know what was needed,
 * and most of them do not; a centre that set no pass mark has not decided, and
 * inventing a threshold here would put the app's opinion in the centre's mouth.
 * Never a verdict, though: the numbers are stated and the parent draws the
 * conclusion, because "ফেল করেছে" from an automated message about a weekly test
 * is how a child gets hit.
 *
 * "প্রিয় অভিভাবক" rather than a religious greeting, for the reason the fee
 * reminder gives: the default salutation in Bangladesh assumes a Muslim family,
 * and a coaching centre's roster is not uniformly one thing.
 */
export function buildResultText(
  input: ResultSmsInput & { passMarks?: number | null },
): string {
  const name = input.studentName.trim()
  const title = input.examTitle.trim()
  const note = (input.note ?? '').trim().replace(/\s+/g, ' ')

  const lines: string[] = ['প্রিয় অভিভাবক,', '']
  lines.push(title ? `${name} — ${title}।` : `${name} — পরীক্ষার ফলাফল।`)
  lines.push('')

  if (input.isAbsent) {
    lines.push('এই পরীক্ষায় অনুপস্থিত ছিল।')
  } else {
    lines.push(`প্রাপ্ত নম্বর: ${marksText(input.obtainedMarks, input.totalMarks)}`)
    // Only a real threshold, and only one that this exam could actually be
    // measured against. A pass mark at or above the total is a typo somebody
    // made on the exam form, and repeating it to a parent spreads the typo.
    if (
      typeof input.passMarks === 'number'
      && input.passMarks > 0
      && input.passMarks < input.totalMarks
    ) {
      lines.push(`পাস নম্বর: ${String(Number(input.passMarks.toFixed(2))).replace(/\.00$/, '')}`)
    }
  }

  // Its own paragraph, because this is the sentence the parent will read to the
  // child, and one buried at the end of a line of figures is one they skim past.
  if (note) {
    lines.push('')
    lines.push(`শিক্ষকের মন্তব্য: ${note}`)
  }

  lines.push('')
  lines.push('কোনো প্রশ্ন থাকলে জানাবেন।')
  lines.push('')
  lines.push(`- ${input.centerName}`)

  return lines.join('\n')
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
  /** Which app the parent should open. Null until the owner sets one. */
  paymentWallet?: PayoutWallet | null
  /** E.164, as coaching_centers stores it. Rendered local and in ASCII. */
  paymentNumber?: string | null
}

/**
 * The word a parent uses for each wallet, not the company's own styling.
 *
 * Shared with the settings form on purpose: the owner picking a wallet should be
 * reading the same word the parent will read, so there is no gap between what
 * was configured and what goes out.
 */
export const WALLET_LABEL_BN: Record<PayoutWallet, string> = {
  bkash: 'বিকাশ',
  nagad: 'নগদ',
  rocket: 'রকেট',
}

/**
 * "বিকাশ 01711000012", or empty when the centre has not set a number.
 *
 * ASCII digits, and local form rather than +880. This is the one string in the
 * whole product that a stranger retypes into a Send Money screen: Bangla
 * numerals would have to be converted in their head, and +8801… is four
 * characters of a shape nobody writes a wallet number in.
 *
 * Deliberately does not name a button. bKash receives money as "Send Money" into
 * a personal account and as "Payment" into a Personal Retail Account, the fee
 * differs, and we do not know which one the centre holds — a wrong instruction
 * either costs the parent extra or fails outright. The number is unambiguous;
 * the flow is theirs to know.
 */
function walletText(
  wallet: PayoutWallet | null | undefined,
  number: string | null | undefined,
): string {
  // Normalised first, and an unusable number is absent rather than shown.
  // formatBdMobile alone would not do: it returns whatever it was given when it
  // cannot parse it, which is right for display — a legacy number is better
  // rendered than blanked — and wrong here. This string is an instruction to
  // send money, and the settings form calls it on every keystroke while a half-
  // typed "017" is in the field.
  const e164 = normalizeBdMobile(number)
  if (!wallet || !e164) return ''
  return `${WALLET_LABEL_BN[wallet]} ${formatBdMobile(e164)}`
}

export type FeeReminderSms = {
  body: string
  segments: number
}

/**
 * What a student's name gets in a fee reminder: fewer characters than a result
 * SMS allows, because this message also has to name a month.
 *
 * Exported because the settings form has to reason about it — see
 * `WORST_CASE_NAME` — and a second copy of the number there would drift the
 * moment this one is tuned, which would make that form's promise about the
 * payment number quietly false.
 */
export const FEE_NAME_BUDGET = 14

/**
 * The longest name this template will ever have to carry.
 *
 * `FEE_NAME_BUDGET` code points with no space in them, so `clamp` cannot trim it
 * back to a whole word and it occupies the full budget. It therefore stands in
 * for every name on the roster at once: whatever survives beside this survives
 * for everybody. Never sent and never displayed — it exists so the settings form
 * can ask "does the payment number fit for my worst case?" and get an answer
 * that does not depend on which student happened to sort first.
 */
export const WORST_CASE_NAME = [...'মোহাম্মদসাদিয়ারহমান']
  .slice(0, FEE_NAME_BUDGET)
  .join('')

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
 * The payment number sits between those two groups: every polite form is tried
 * with it before any form is tried without it, because a message naming the
 * number is one a parent can act on without asking anybody, and that is the
 * whole reason to send it. But it is the first *content* to go, unlike the month
 * and the amount, because a family that cannot see the number can still pay the
 * way they paid before this feature existed — whereas a family that cannot see
 * which month is being asked for cannot pay at all.
 *
 * Which step was needed is not something the owner is asked to care about; the
 * message they see before sending is the message that goes.
 */
export function buildFeeReminderSms(input: FeeReminderInput): FeeReminderSms {
  const brand = clamp(input.centerName, BRAND_BUDGET - 2)
  const name = clamp(input.studentName, FEE_NAME_BUDGET)
  const month = monthName(input.periodMonth)
  const money = formatTaka(input.amount)
  const tail = ` -${brand}`

  const pay = walletText(input.paymentWallet, input.paymentNumber)
  const suffix = pay ? ` ${pay}${tail}` : tail

  const ladder = [
    `${name}, ${month} মাসের ফি ${money} বাকি আছে।`,
    `${name}, ${month} মাসের ফি ${money} বাকি।`,
    `${name}, ${month}: ফি ${money} বাকি।`,
  ]

  const bodies = pay
    ? [...ladder.map((s) => `${s}${suffix}`), ...ladder.map((s) => `${s}${tail}`)]
    : ladder.map((s) => `${s}${tail}`)

  for (const body of bodies) {
    if (measureSms(body).segments <= 1) return { body, segments: 1 }
  }

  // Nothing fit one segment, which takes a centre name and a student name both
  // at their limits. Send the terse one anyway rather than dropping the month or
  // the amount: two segments costs the owner one extra SMS, a message the parent
  // cannot act on costs them the fee.
  //
  // And once the second segment is already paid for, the number rides along in
  // it for nothing — so it is dropped here only if it would buy a third.
  const terse = `${ladder[ladder.length - 1]}${tail}`
  const bare = measureSms(terse)

  if (pay) {
    const withPay = `${ladder[ladder.length - 1]}${suffix}`
    const paid = measureSms(withPay)
    if (paid.segments <= bare.segments) {
      return { body: withPay, segments: paid.segments }
    }
  }

  return { body: terse, segments: bare.segments }
}

/* -------------------------------------------------------------------------- */
/* The weekly progress summary                                                */
/* -------------------------------------------------------------------------- */

/**
 * What a guardian is told once a week.
 *
 * ATTENDANCE AND MARKS, AND NO FEE. The masterplan's Tier 2 names exactly those
 * two, and the omission is deliberate rather than an oversight — fees have their
 * own screen, their own schedule and their own dedup table, none of which knows
 * about this one, so a fee sentence here would let two features chase the same
 * family in the same week each certain it was the first. It would also turn the
 * only message a parent gets from this product that is not about money into
 * another one that is. See 20260811000021_progress_summary.sql.
 *
 * THE WINDOW IS CARRIED, NOT ASSUMED. `weekFrom`/`weekTo` come from the view that
 * counted the sessions, so the sentence a parent reads names the same seven days
 * the figures were taken from — and the row recording the send freezes the same
 * pair. A template that said "this week" and computed its own dates would drift
 * from the numbers beside it the moment a request crossed midnight.
 */
export type ProgressSummaryInput = {
  studentName: string
  /** YYYY-MM-DD, inclusive. */
  weekFrom: string
  /** YYYY-MM-DD, inclusive. */
  weekTo: string
  /** Sessions that counted against them — excused ones are already excluded. */
  sessionsCounted: number
  /** Present or late. Both are "they came". */
  sessionsPresent: number
  /** Arrived late, a subset of present. Mentioned only where there is room. */
  sessionsLate: number
  /** The one result worth naming, or null when nothing was tested. */
  examTitle?: string | null
  examObtained?: number | null
  examTotal?: number | null
  /** Tests they were marked absent from. Its own sentence, never a zero. */
  examsMissed: number
  centerName: string
}

/** Shorter than a result SMS allows, because this message carries two figures. */
export const PROGRESS_NAME_BUDGET = 14

/**
 * How much of an exam title this template will carry.
 *
 * Sixteen because পদার্থবিজ্ঞান — Physics, and one of the four subject names a
 * Bangladeshi coaching centre types most — is thirteen code points on its own, and a
 * budget that clipped it would put "পদার্থবিজ্ঞা" in front of a parent. জীববিজ্ঞান
 * and উচ্চতর গণিত fit inside the same number.
 *
 * It is still the first thing the ladder gives up, wholesale rather than clipped;
 * see `examTitleFor`.
 */
const PROGRESS_TITLE_BUDGET = 16

/**
 * The subject to name, or nothing.
 *
 * `clamp` trims to a whole word wherever it can, and falls back to a mid-word cut
 * only when the first word alone is over budget. For a student's name that fallback
 * is the right call — a parent reading a shortened name still knows which child it
 * is. For a subject it is not: "পদার্থবিজ্ঞা" is not a subject, it is a bug printed
 * on somebody's phone, and this template already has an honest shorter word for the
 * same thing. So a single word that will not fit is dropped, and the ladder's next
 * rung says "পরীক্ষা".
 *
 * A multi-word title still trims: "সাপ্তাহিক পরীক্ষা ২০২৬" becomes "সাপ্তাহিক", which
 * is a title somebody wrote rather than a fragment of one.
 */
function examTitleFor(raw: string | null | undefined): string {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return ''
  const first = text.split(' ')[0]
  if ([...first].length > PROGRESS_TITLE_BUDGET) return ''
  return clamp(text, PROGRESS_TITLE_BUDGET)
}

/**
 * "5/6" — the week's attendance as one compound figure.
 *
 * ASCII, like marks and unlike every other count in a Bangla sentence, and for the
 * same reason `marksText` is: this is the figure a parent quotes back down the
 * phone ("you said five of six, he was there all week"), and a ratio that has to
 * be converted in somebody's head before it can be repeated is a ratio that gets
 * repeated wrong. The prose form below uses Bangla numerals, because there the two
 * numbers are words in a sentence rather than one figure to be read out.
 */
function attendanceRatio(present: number, counted: number): string {
  return `${present}/${counted}`
}

export type ProgressSummary = {
  body: string
  /** Zero when there was nothing true to say; every caller checks `body` first. */
  segments: number
}

/**
 * The weekly summary, sized for one SMS.
 *
 * Phrasing degrades in steps, the same ladder shape the fee reminder uses and for
 * the same reason: a long name, a long subject title and a long centre name
 * genuinely cannot coexist with a natural sentence inside 70 UCS-2 characters, and
 * the thing to give up is the wording — never the attendance figure, never the
 * mark, and never who is asking.
 *
 * WHAT GOES FIRST IS THE EXAM TITLE. "পদার্থবিজ্ঞান 45/50" and "পরীক্ষা 45/50" tell
 * a parent the same thing about their child; only one of them costs sixteen
 * characters. The subject is named in the WhatsApp version, which is free — and it
 * goes whole or not at all, because a clipped subject name is worse than a generic
 * one. See `examTitleFor`.
 *
 * A student with no counted sessions and no result produces no message. The screen
 * offers no chip in that case — there is nothing true to say — so this returns an
 * empty body rather than inventing a sentence about a week that was not recorded.
 */
export function buildProgressSummarySms(input: ProgressSummaryInput): ProgressSummary {
  const brand = clamp(input.centerName, BRAND_BUDGET - 2)
  const name = clamp(input.studentName, PROGRESS_NAME_BUDGET)
  const title = examTitleFor(input.examTitle)
  const tail = ` -${brand}`

  const hasAtt = input.sessionsCounted > 0
  const hasMarks =
    input.examObtained !== null &&
    input.examObtained !== undefined &&
    typeof input.examTotal === 'number' &&
    input.examTotal > 0

  const att = attendanceRatio(input.sessionsPresent, input.sessionsCounted)
  const marks = hasMarks
    ? marksText(input.examObtained as number, input.examTotal as number)
    : ''

  // Nothing recorded either way. See the note above: an empty body is the honest
  // answer, and every caller checks `body` before offering a link.
  if (!hasAtt && !hasMarks) return { body: '', segments: 0 }

  const ladder: string[] = []

  if (hasAtt && hasMarks) {
    if (title) ladder.push(`${name}: হাজিরা ${att}, ${title} ${marks}।`)
    ladder.push(`${name}: হাজিরা ${att}, পরীক্ষা ${marks}।`)
    ladder.push(`${name}: হাজিরা ${att}, ${marks}।`)
  } else if (hasAtt) {
    ladder.push(`${name}: এ সপ্তাহে হাজিরা ${att}।`)
    ladder.push(`${name}: হাজিরা ${att}।`)
  } else {
    if (title) ladder.push(`${name}: ${title} ${marks}।`)
    ladder.push(`${name}: পরীক্ষা ${marks}।`)
  }

  for (const line of ladder) {
    const body = `${line}${tail}`
    if (measureSms(body).segments <= 1) return { body, segments: 1 }
  }

  // Nothing fit, which takes a name and a centre name both at their limits. Send
  // the terse rung anyway rather than dropping a figure: one extra segment costs
  // the owner one SMS from their own handset, a message with the numbers missing
  // costs them the only reason to send it.
  const terse = `${ladder[ladder.length - 1]}${tail}`
  return { body: terse, segments: measureSms(terse).segments }
}

/**
 * The same summary for WhatsApp, where nothing is metered.
 *
 * So it says what 70 characters cannot: which seven days, the subject that was
 * tested, and the exams the child was absent from — which is the sentence a parent
 * most needs and the SMS has no room for at all. It also asks them to reply, and
 * that is the point of sending progress rather than only ever sending bills: the
 * first message from a coaching centre that is not a demand for money is the one
 * that makes the next demand answerable.
 *
 * "প্রিয় অভিভাবক" rather than a religious greeting, for the reason the fee
 * reminder gives: the default salutation in Bangladesh assumes a Muslim family and
 * a centre's roster is not uniformly one thing.
 *
 * Prose counts use Bangla numerals here while the mark keeps its ASCII ratio —
 * both halves of the rule the rest of the product follows, in one message. A
 * number inside a Bangla sentence is a word; a score is a figure that gets read
 * aloud against a report card.
 */
export function buildProgressSummaryText(input: ProgressSummaryInput): string {
  const from = formatDate(input.weekFrom)
  const to = formatDate(input.weekTo)

  const lines: string[] = ['প্রিয় অভিভাবক,', '']
  lines.push(`${input.studentName} — ${from} থেকে ${to} পর্যন্ত সপ্তাহের রিপোর্ট।`)
  lines.push('')

  if (input.sessionsCounted > 0) {
    const counted = toBanglaDigits(input.sessionsCounted)
    const present = toBanglaDigits(input.sessionsPresent)
    const absent = input.sessionsCounted - input.sessionsPresent

    // The absence is stated rather than left to be worked out. A parent who has to
    // subtract two numbers to find out their child missed a class is a parent who
    // does not find out.
    lines.push(
      absent > 0
        ? `হাজিরা: ${counted} দিনের ক্লাসে ${present} দিন উপস্থিত, ${toBanglaDigits(absent)} দিন অনুপস্থিত।`
        : `হাজিরা: ${counted} দিনের ক্লাসে ${present} দিনই উপস্থিত ছিল।`,
    )

    // Late is not absent and must not read as it. Its own clause, and only when it
    // happened — a nil report on lateness would make every message longer to say
    // nothing.
    if (input.sessionsLate > 0) {
      lines.push(`${toBanglaDigits(input.sessionsLate)} দিন দেরিতে এসেছে।`)
    }
  }

  const hasMarks =
    input.examObtained !== null &&
    input.examObtained !== undefined &&
    typeof input.examTotal === 'number' &&
    input.examTotal > 0

  if (hasMarks) {
    const marks = marksText(input.examObtained as number, input.examTotal as number)
    const title = (input.examTitle ?? '').trim()
    lines.push(title ? `পরীক্ষা: ${title} — ${marks}।` : `পরীক্ষা: ${marks}।`)
  }

  // Absence from a test is a fact about the child, never a zero in the marks
  // column. Reported even when there is no mark beside it, because "sat none of
  // this week's tests" is the whole of what happened.
  if (input.examsMissed > 0) {
    lines.push(
      `${toBanglaDigits(input.examsMissed)}টি পরীক্ষায় অনুপস্থিত ছিল।`,
    )
  }

  lines.push('')
  lines.push('কোনো প্রশ্ন থাকলে জানাবেন।')
  lines.push('')
  lines.push(`- ${input.centerName}`)

  return lines.join('\n')
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
  const month = monthName(input.periodMonth)
  const due = formatDate(input.dueDate)

  // Tense follows the fact. A row can be unpaid without being late — an owner
  // may well send this the morning a bill is raised — and telling a family the
  // deadline "was" a date still in their future reads as a threat over nothing.
  const deadline =
    input.daysLate > 0
      ? `জমা দেওয়ার শেষ তারিখ ছিল ${due}।`
      : `জমা দেওয়ার শেষ তারিখ ${due}।`

  // Its own paragraph, not tucked into the sentence above. This is the line the
  // parent will come back to when they are standing in the wallet app, and a
  // number buried mid-sentence is one they have to hunt for twice.
  const pay = walletText(input.paymentWallet, input.paymentNumber)

  return [
    'প্রিয় অভিভাবক,',
    '',
    `${input.studentName} — ${month} মাসের কোচিং ফি ${money} বাকি আছে। ${deadline}`,
    ...(pay ? ['', `ফি পাঠাতে পারেন — ${pay}`] : []),
    '',
    'সুবিধামতো সময়ে জমা দিয়ে দিলে ভালো হয়। কোনো অসুবিধা থাকলে জানাবেন।',
    '',
    `- ${input.centerName}`,
  ].join('\n')
}
