import { test } from 'node:test'
import assert from 'node:assert/strict'

import { measureSms, creditCost } from '../src/lib/sms/encoding.ts'
import {
  buildResultSms,
  buildResultText,
  buildFeeReminderSms,
  buildFeeReminderText,
  buildProgressSummarySms,
  buildProgressSummaryText,
  buildAbsenceSms,
  buildAbsenceText,
  buildNoticeSms,
  type ProgressSummaryInput,
  type AbsenceInput,
} from '../src/lib/sms/templates.ts'

test('plain ASCII is GSM-7 and fits 160 characters', () => {
  const short = measureSms('Result published')
  assert.equal(short.encoding, 'gsm7')
  assert.equal(short.segments, 1)

  const exact = measureSms('a'.repeat(160))
  assert.equal(exact.segments, 1, '160 GSM characters is still one SMS')

  const over = measureSms('a'.repeat(161))
  assert.equal(over.segments, 2, 'one character past 160 costs a second SMS')
})

test('any Bangla character forces UCS-2 for the whole message', () => {
  const mixed = measureSms('Result: ভালো')
  assert.equal(mixed.encoding, 'ucs2')

  // This is the expensive fact the whole module exists for: 70, not 160.
  assert.equal(measureSms('অ'.repeat(70)).segments, 1)
  assert.equal(measureSms('অ'.repeat(71)).segments, 2)
})

test('concatenated messages lose capacity to the reassembly header', () => {
  // 153 septets per part once a message splits, not 160.
  assert.equal(measureSms('a'.repeat(306)).segments, 2)
  assert.equal(measureSms('a'.repeat(307)).segments, 3)

  // 67 UCS-2 characters per part, not 70.
  assert.equal(measureSms('অ'.repeat(134)).segments, 2)
  assert.equal(measureSms('অ'.repeat(135)).segments, 3)
})

test('GSM escape characters cost two septets', () => {
  assert.equal(measureSms('[').length, 2)
  assert.equal(measureSms('a'.repeat(159) + '[').segments, 2)
})

test('an empty message costs nothing', () => {
  const empty = measureSms('')
  assert.equal(empty.segments, 0)
  assert.equal(creditCost('', 40), 0)
})

test('credits are per recipient per segment', () => {
  // 40 parents, one Bangla segment each.
  assert.equal(creditCost('ফলাফল', 40), 40)
  // A message that spilled to two segments doubles the bill.
  assert.equal(creditCost('অ'.repeat(71), 40), 80)
})

const CENTER = 'আলো কোচিং সেন্টার'

test('a result message fits one segment', () => {
  const sms = buildResultSms({
    studentName: 'রাফিদ হাসান',
    examTitle: 'সাপ্তাহিক পরীক্ষা',
    obtainedMarks: 42,
    totalMarks: 50,
    isAbsent: false,
    centerName: CENTER,
  })

  assert.equal(sms.segments, 1, `two segments: ${sms.body}`)
  assert.ok(sms.body.includes('42/50'))
  assert.ok(sms.body.includes('রাফিদ'))
})

test('the centre name survives even when everything else is too long', () => {
  const sms = buildResultSms({
    studentName: 'মোহাম্মদ আব্দুল্লাহ আল মামুন চৌধুরী',
    examTitle: 'দ্বিতীয় সাময়িক মডেল টেস্ট পরীক্ষা ২০২৬',
    obtainedMarks: 88.5,
    totalMarks: 100,
    isAbsent: false,
    centerName: CENTER,
  })

  assert.equal(sms.segments, 1, `two segments: ${sms.body}`)
  // Without an identifiable sender the message reads as spam, so the brand is
  // the one part that is never sacrificed to fit.
  assert.ok(sms.body.includes('আলো'), `brand missing: ${sms.body}`)
})

test('an absent student gets words, not a zero', () => {
  const sms = buildResultSms({
    studentName: 'রাফিদ',
    examTitle: 'সাপ্তাহিক',
    obtainedMarks: null,
    totalMarks: 50,
    isAbsent: true,
    centerName: CENTER,
  })

  assert.ok(sms.body.includes('অনুপস্থিত'))
  assert.ok(!sms.body.includes('0/50'), 'absent must never read as zero marks')
})

test('the note is dropped rather than paying for a second segment', () => {
  const withLongNote = buildResultSms({
    studentName: 'রাফিদ হাসান',
    examTitle: 'সাপ্তাহিক পরীক্ষা',
    obtainedMarks: 42,
    totalMarks: 50,
    isAbsent: false,
    centerName: CENTER,
    note: 'হাতের লেখা আরও ভালো করতে হবে এবং নিয়মিত ক্লাসে আসতে হবে',
  })

  assert.equal(withLongNote.segments, 1)
  assert.equal(withLongNote.trimmed, true)

  const withShortNote = buildResultSms({
    studentName: 'রাফিদ',
    examTitle: 'সাপ্তাহিক',
    obtainedMarks: 42,
    totalMarks: 50,
    isAbsent: false,
    centerName: 'আলো',
    note: 'ভালো',
  })

  assert.equal(withShortNote.segments, 1)
  assert.equal(withShortNote.trimmed, false, 'a note that fits should be kept')
  assert.ok(withShortNote.body.includes('ভালো'))
})

test('a note rides along free once the message is already two segments', () => {
  // Student name, exam title and centre name all at their clamp limits: the
  // message crosses 70 characters before the note is even considered, so the
  // second segment is already being paid for and dropping the note buys nothing.
  const sms = buildResultSms({
    studentName: 'শারমিন সুলতানা খান',
    examTitle: 'বার্ষিক পরীক্ষা ২০২৬',
    obtainedMarks: 42,
    totalMarks: 50,
    isAbsent: false,
    centerName: 'আলোর পথে কোচিং সেন্টার',
    note: 'ভালো করেছে',
  })

  assert.equal(sms.segments, 2, sms.body)
  assert.equal(sms.trimmed, false, 'dropping the note would not have saved a segment')
  assert.ok(sms.body.includes('ভালো করেছে'), sms.body)
})

test('marks keep ASCII digits and lose trailing zeros', () => {
  const sms = buildResultSms({
    studentName: 'রাফিদ',
    examTitle: 'পরীক্ষা',
    obtainedMarks: 42.5,
    totalMarks: 50,
    isAbsent: false,
    centerName: 'আলো',
  })

  assert.ok(sms.body.includes('42.5/50'), sms.body)
  assert.ok(!/[০-৯]/.test(sms.body.split(':')[1] ?? ''), 'marks must stay ASCII')
})

/* -------------------------------------------------------------------------- */
/* The same result, unmetered                                                 */
/* -------------------------------------------------------------------------- */

test('the chat version gives up nothing to fit', () => {
  const LONG_NAME = 'মোহাম্মদ আব্দুল্লাহ আল মামুন চৌধুরী'
  const LONG_TITLE = 'দ্বিতীয় সাময়িক মডেল টেস্ট পরীক্ষা ২০২৬'
  const NOTE = 'হাতের লেখা আরও ভালো করতে হবে এবং নিয়মিত ক্লাসে আসতে হবে'

  const input = {
    studentName: LONG_NAME,
    examTitle: LONG_TITLE,
    obtainedMarks: 88.5,
    totalMarks: 100,
    isAbsent: false,
    centerName: CENTER,
    note: NOTE,
  }

  // The same inputs the metered builder has to clamp. WhatsApp meters nothing, so
  // every one of them survives here — including the note, which is the first
  // thing buildResultSms drops.
  const sms = buildResultSms(input)
  assert.equal(sms.trimmed, true, 'the metered version should have dropped the note')

  const text = buildResultText(input)
  assert.ok(text.includes(LONG_NAME), text)
  assert.ok(text.includes(LONG_TITLE), text)
  assert.ok(text.includes(NOTE), text)
  assert.ok(text.includes('88.5/100'), text)
  assert.ok(text.includes(CENTER), 'the centre still signs it')
})

test('an absent student is words in the chat version too', () => {
  const text = buildResultText({
    studentName: 'রাফিদ',
    examTitle: 'সাপ্তাহিক',
    obtainedMarks: null,
    totalMarks: 50,
    isAbsent: true,
    passMarks: 20,
    centerName: CENTER,
  })

  assert.ok(text.includes('অনুপস্থিত'), text)
  assert.ok(!text.includes('0/50'), 'absent must never read as zero marks')
  // No marks means no pass mark either: quoting one against an absence invites
  // the reading that the child scored below it.
  assert.ok(!text.includes('20'), text)
})

test('the pass mark is named only when it is a real threshold', () => {
  const base = {
    studentName: 'রাফিদ',
    examTitle: 'সাপ্তাহিক',
    obtainedMarks: 42,
    totalMarks: 50,
    isAbsent: false,
    centerName: CENTER,
  }

  assert.ok(buildResultText({ ...base, passMarks: 20 }).includes('20'), 'a real pass mark')
  assert.ok(!buildResultText({ ...base, passMarks: null }).includes('পাস'), 'none set')
  assert.ok(!buildResultText({ ...base, passMarks: 0 }).includes('পাস'), 'zero is not one')
  assert.ok(
    !buildResultText({ ...base, passMarks: 50 }).includes('পাস'),
    'a pass mark equal to the total is a data-entry slip, not a threshold',
  )
})

test('the chat version never delivers a verdict', () => {
  // A parent hearing "your child failed" from an automated message is how a child
  // gets hit. The numbers go out; the judgement is the teacher's to make in person.
  const failed = buildResultText({
    studentName: 'রাফিদ',
    examTitle: 'সাপ্তাহিক',
    obtainedMarks: 9,
    totalMarks: 50,
    passMarks: 20,
    isAbsent: false,
    centerName: CENTER,
  })

  assert.ok(failed.includes('9/50'), failed)
  for (const verdict of ['ফেল', 'অকৃতকার্য', 'খারাপ', 'পাস করেছে', 'কৃতকার্য']) {
    assert.ok(!failed.includes(verdict), `${verdict} must never appear: ${failed}`)
  }
})

/* -------------------------------------------------------------------------- */
/* Fee reminders                                                              */
/* -------------------------------------------------------------------------- */

test('a fee reminder names the child, the month, the amount and the centre', () => {
  const sms = buildFeeReminderSms({
    studentName: 'মিম আক্তার',
    periodMonth: '2026-08-01',
    amount: 700,
    dueDate: '2026-08-10',
    daysLate: 1,
    centerName: 'উত্তরা আইডিয়াল কোচিং',
  })

  assert.equal(sms.segments, 1)
  assert.ok(sms.body.includes('মিম আক্তার'), sms.body)
  assert.ok(sms.body.includes('আগস্ট'), sms.body)
  assert.ok(sms.body.includes('৳700'), sms.body)
  assert.ok(sms.body.includes('উত্তরা আইডিয়াল কোচিং'), sms.body)
  // The natural phrasing, since there is room for it.
  assert.ok(sms.body.includes('বাকি আছে'), sms.body)
})

test('the worst case a real centre can produce still costs one SMS', () => {
  // Everything at its maximum at once: the longest month name in Bangla
  // (ফেব্রুয়ারি, eleven characters), a five-figure balance from a family several
  // months behind, a long student name, and a centre name longer than the brand
  // budget. This is the test that decides the name budget — at 18 characters the
  // month gets dropped here, and a parent owing two months cannot tell which one
  // the message is about.
  const sms = buildFeeReminderSms({
    studentName: 'মোহাম্মদ সাদিয়া রহমান',
    periodMonth: '2026-02-01',
    amount: 99999,
    dueDate: '2026-02-10',
    daysLate: 40,
    centerName: 'উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি',
  })

  assert.equal(sms.segments, 1, sms.body)
  assert.equal(measureSms(sms.body).encoding, 'ucs2')
  // The four things that must survive any amount of trimming.
  assert.ok(sms.body.startsWith('মোহাম্মদ'), sms.body)
  assert.ok(sms.body.includes('ফেব্রুয়ারি'), sms.body)
  assert.ok(sms.body.includes('৳99,999'), sms.body)
  assert.ok(sms.body.includes('উত্তরা'), sms.body)
})

test('reminder money stays ASCII, like every other figure a parent re-types', () => {
  const sms = buildFeeReminderSms({
    studentName: 'রাফিদ',
    periodMonth: '2026-08-01',
    amount: 1500.5,
    dueDate: '2026-08-10',
    daysLate: 0,
    centerName: 'আলো',
  })

  assert.ok(sms.body.includes('৳1,500.50'), sms.body)
  assert.ok(!/[০-৯]/.test(sms.body), 'no Bangla numerals in a fee reminder')
})

test('the WhatsApp reminder keeps what the SMS has no room for', () => {
  const text = buildFeeReminderText({
    studentName: 'মোহাম্মদ সাদিয়া রহমান',
    periodMonth: '2026-02-01',
    amount: 99999,
    dueDate: '2026-02-10',
    daysLate: 40,
    centerName: 'উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি',
  })

  // Nothing is metered here, so nothing is clamped.
  assert.ok(text.includes('মোহাম্মদ সাদিয়া রহমান'), text)
  assert.ok(text.includes('উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি'), text)
  assert.ok(text.includes('ফেব্রুয়ারি'), text)
  assert.ok(text.includes('৳99,999'), text)
  // The due date, in Bangla numerals — a date is read, not re-typed.
  assert.ok(text.includes('১০ ফেব্রুয়ারি ২০২৬'), text)
  assert.ok(text.startsWith('প্রিয় অভিভাবক,'), text)
})

test('a reminder sent before the due date does not speak in the past tense', () => {
  const base = {
    studentName: 'রাফিদ হাসান',
    periodMonth: '2026-08-01',
    amount: 1500,
    dueDate: '2026-08-10',
    centerName: 'আলো কোচিং',
  }

  // Raised on the 1st, chased the same day: the deadline is still ahead, and
  // telling a family the date "was" something in their future reads as a threat
  // over a bill that is not yet late.
  const early = buildFeeReminderText({ ...base, daysLate: 0 })
  assert.ok(early.includes('শেষ তারিখ ১০ আগস্ট ২০২৬'), early)
  assert.ok(!early.includes('ছিল'), early)

  const late = buildFeeReminderText({ ...base, daysLate: 5 })
  assert.ok(late.includes('শেষ তারিখ ছিল ১০ আগস্ট ২০২৬'), late)
})

test('a reminder tells the parent where to send the money', () => {
  const sms = buildFeeReminderSms({
    studentName: 'মিম আক্তার',
    periodMonth: '2026-08-01',
    amount: 700,
    dueDate: '2026-08-10',
    daysLate: 2,
    centerName: 'আলো কোচিং',
    paymentWallet: 'bkash',
    paymentNumber: '+8801711000012',
  })

  assert.equal(sms.segments, 1, sms.body)
  assert.ok(sms.body.includes('বিকাশ'), sms.body)
  // Local form and ASCII digits. A parent retypes this into a Send Money
  // screen, so +880 is four characters of a shape nobody writes, and Bangla
  // numerals would have to be converted in their head first.
  assert.ok(sms.body.includes('01711000012'), sms.body)
  assert.ok(!sms.body.includes('+880'), sms.body)
  assert.ok(!/[০-৯]/.test(sms.body), 'no Bangla numerals in a fee reminder')
})

test('the payment number outlives politeness but not the month or the amount', () => {
  const base = {
    studentName: 'মিম আক্তার',
    periodMonth: '2026-08-01',
    amount: 700,
    dueDate: '2026-08-10',
    daysLate: 2,
    paymentWallet: 'bkash' as const,
    paymentNumber: '+8801711000012',
  }

  // A 17-character centre name leaves no room for both the number and the
  // natural phrasing. The number stays, because a message naming it is one the
  // family can act on without ringing anybody.
  const tight = buildFeeReminderSms({ ...base, centerName: 'আলো কোচিং সেন্টার' })
  assert.equal(tight.segments, 1, tight.body)
  assert.ok(tight.body.includes('01711000012'), tight.body)
  assert.ok(!tight.body.includes('বাকি আছে'), tight.body)

  // At 21 characters even the terse form cannot hold it, and here the number is
  // what goes — not the month and not the amount. A family who cannot see the
  // number can still pay the way they always have; a family who cannot see
  // which month is being asked for cannot pay at all.
  const full = buildFeeReminderSms({ ...base, centerName: 'উত্তরা আইডিয়াল কোচিং' })
  assert.equal(full.segments, 1, full.body)
  assert.ok(!full.body.includes('01711000012'), full.body)
  assert.ok(full.body.includes('আগস্ট'), full.body)
  assert.ok(full.body.includes('৳700'), full.body)
  assert.ok(full.body.includes('মিম আক্তার'), full.body)
  assert.ok(full.body.includes('উত্তরা আইডিয়াল কোচিং'), full.body)
})

test('a centre with no wallet set sends exactly what it sent before', () => {
  const base = {
    studentName: 'রাফিদ হাসান',
    periodMonth: '2026-08-01',
    amount: 1500,
    dueDate: '2026-08-10',
    daysLate: 0,
    centerName: 'আলো কোচিং',
  }

  const none = buildFeeReminderSms(base)
  assert.equal(none.body, 'রাফিদ হাসান, আগস্ট মাসের ফি ৳1,500 বাকি আছে। -আলো কোচিং')

  // Half-configured is the same as unconfigured, in both directions. A wallet
  // with no number names an app the parent cannot send to; a number with no
  // wallet does not say which app to open. The database rejects the pair
  // outright — this is the settings form mid-keystroke, which must stay quiet.
  for (const half of [
    { ...base, paymentWallet: 'bkash' as const, paymentNumber: null },
    { ...base, paymentWallet: 'bkash' as const, paymentNumber: '017' },
    { ...base, paymentWallet: null, paymentNumber: '+8801711000012' },
  ]) {
    assert.equal(buildFeeReminderSms(half).body, none.body)
  }
})

test('the WhatsApp reminder always carries the number, on its own line', () => {
  // The case the SMS above had to drop it in: nothing is metered here, so the
  // longest centre name in the fixtures keeps everything.
  const text = buildFeeReminderText({
    studentName: 'মোহাম্মদ সাদিয়া রহমান',
    periodMonth: '2026-02-01',
    amount: 99999,
    dueDate: '2026-02-10',
    daysLate: 40,
    centerName: 'উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি',
    paymentWallet: 'nagad',
    paymentNumber: '01911000013',
  })

  assert.ok(text.includes('নগদ 01911000013'), text)
  // Its own paragraph, because this is the line the parent comes back to while
  // standing in the wallet app.
  assert.ok(text.includes('\n\nফি পাঠাতে পারেন — নগদ 01911000013\n\n'), text)
  assert.ok(text.includes('৳99,999'), text)

  // And nothing dangling when there is nothing to say.
  const without = buildFeeReminderText({
    studentName: 'রাফিদ হাসান',
    periodMonth: '2026-08-01',
    amount: 1500,
    dueDate: '2026-08-10',
    daysLate: 0,
    centerName: 'আলো কোচিং',
  })
  assert.ok(!without.includes('ফি পাঠাতে পারেন'), without)
})

/* -------------------------------------------------------------------------- */
/* The weekly progress summary                                                */
/* -------------------------------------------------------------------------- */

/** A full week, to be overridden one field at a time. */
function week(over: Partial<ProgressSummaryInput> = {}): ProgressSummaryInput {
  return {
    studentName: 'রাফিদ হাসান',
    weekFrom: '2026-08-19',
    weekTo: '2026-08-25',
    sessionsCounted: 6,
    sessionsPresent: 5,
    sessionsLate: 1,
    examTitle: 'পদার্থবিজ্ঞান',
    examObtained: 45,
    examTotal: 50,
    examsMissed: 0,
    centerName: 'আলো কোচিং',
    ...over,
  }
}

test('a weekly summary names the child, the attendance, the mark and the centre', () => {
  const sms = buildProgressSummarySms(week())

  assert.equal(sms.segments, 1, sms.body)
  assert.ok(sms.body.includes('রাফিদ হাসান'), sms.body)
  assert.ok(sms.body.includes('5/6'), sms.body)
  assert.ok(sms.body.includes('45/50'), sms.body)
  assert.ok(sms.body.includes('আলো কোচিং'), sms.body)
})

test('both figures stay in ASCII, because a parent reads them back', () => {
  // The rule the rest of the product follows for money and marks, extended to the
  // attendance ratio: this is the figure that gets quoted down the phone, and one
  // that has to be converted in somebody's head first gets repeated wrong.
  const sms = buildProgressSummarySms(week())
  assert.ok(!/[০-৯]/.test(sms.body), sms.body)
})

test('the worst case a real centre can produce still costs one SMS', () => {
  // Everything at its maximum at once: a name with no space in it so it occupies
  // the whole budget, a long subject title, a perfect score in three digits, a
  // twelve-session week, and a centre name past the brand budget. This is the test
  // that forces the ladder to exist — the exam title cannot survive here.
  const sms = buildProgressSummarySms(
    week({
      studentName: 'মোহাম্মদসাদিয়ারহমান',
      examTitle: 'উচ্চতরগণিতসাপ্তাহিক',
      examObtained: 100,
      examTotal: 100,
      sessionsCounted: 12,
      sessionsPresent: 12,
      centerName: 'উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি',
    }),
  )

  assert.equal(sms.segments, 1, sms.body)
  assert.equal(measureSms(sms.body).encoding, 'ucs2')
  // The three things that must survive any amount of trimming.
  assert.ok(sms.body.startsWith('মোহাম্মদ'), sms.body)
  assert.ok(sms.body.includes('12/12'), sms.body)
  assert.ok(sms.body.includes('100/100'), sms.body)
  assert.ok(sms.body.includes('উত্তরা'), sms.body)
})

test('the exam title is what gets given up, never a figure', () => {
  // A parent learns the same thing from "পরীক্ষা 45/50" as from the subject name,
  // and only one of those costs thirteen characters. The subject is in the WhatsApp
  // version, which is free.
  //
  // Three-digit figures on both sides, because that is where the title stops
  // fitting: with 5/6 and 45/50 there is room for all of it and the ladder never
  // has to descend, which is the outcome to want and not the one to test.
  const sms = buildProgressSummarySms(
    week({
      studentName: 'মোহাম্মদসাদিয়ারহমান',
      examTitle: 'উচ্চতরগণিতসাপ্তাহিক',
      examObtained: 100,
      examTotal: 100,
      sessionsCounted: 12,
      sessionsPresent: 12,
      centerName: 'উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি',
    }),
  )
  assert.equal(sms.segments, 1, sms.body)
  assert.ok(!sms.body.includes('উচ্চতর'), sms.body)
  assert.ok(sms.body.includes('পরীক্ষা 100/100'), sms.body)

  // And where it does fit, it is kept — the ladder descends only under pressure.
  const roomy = buildProgressSummarySms(week({ examTitle: 'পদার্থবিজ্ঞান' }))
  assert.ok(roomy.body.includes('পদার্থবিজ্ঞান 45/50'), roomy.body)
})

test('a subject name goes whole or not at all', () => {
  // পদার্থবিজ্ঞান is thirteen code points and one of the four subjects a coaching
  // centre types most. A budget that clipped it would put "পদার্থবিজ্ঞা" — not a
  // word — on a parent's phone, so the budget is set above it.
  const physics = buildProgressSummarySms(week({ examTitle: 'পদার্থবিজ্ঞান' }))
  assert.ok(physics.body.includes('পদার্থবিজ্ঞান'), physics.body)

  // One word that genuinely will not fit is dropped for the generic word rather
  // than cut in half.
  const runOn = buildProgressSummarySms(week({ examTitle: 'উচ্চতরগণিতসাপ্তাহিকপরীক্ষা' }))
  assert.ok(runOn.body.includes('পরীক্ষা 45/50'), runOn.body)
  assert.ok(!runOn.body.includes('উচ্চতর'), runOn.body)

  // A multi-word title still trims to a whole word, which is a title somebody
  // wrote rather than a fragment of one.
  const long = buildProgressSummarySms(week({ examTitle: 'সাপ্তাহিক পরীক্ষা ২০২৬' }))
  assert.ok(long.body.includes('সাপ্তাহিক'), long.body)
  assert.ok(!long.body.includes('২০২৬'), long.body)
})

test('attendance alone and a mark alone each make a sentence', () => {
  const attOnly = buildProgressSummarySms(
    week({ examTitle: null, examObtained: null, examTotal: null }),
  )
  assert.equal(attOnly.segments, 1, attOnly.body)
  assert.ok(attOnly.body.includes('5/6'), attOnly.body)
  assert.ok(!attOnly.body.includes('/50'), attOnly.body)

  const marksOnly = buildProgressSummarySms(week({ sessionsCounted: 0, sessionsPresent: 0 }))
  assert.equal(marksOnly.segments, 1, marksOnly.body)
  assert.ok(marksOnly.body.includes('45/50'), marksOnly.body)
  // No "হাজিরা 0/0" — nobody took the register, which is not a week the child
  // missed. See student_progress_week's comment on the same distinction.
  assert.ok(!marksOnly.body.includes('0/0'), marksOnly.body)
})

test('nothing recorded produces no message at all', () => {
  // The screen offers no chip in this case, and an empty body is what says so. A
  // template that invented a sentence about an unrecorded week would put the
  // centre's own omission in front of a parent as a fact about their child.
  const sms = buildProgressSummarySms(
    week({
      sessionsCounted: 0,
      sessionsPresent: 0,
      examTitle: null,
      examObtained: null,
      examTotal: null,
    }),
  )
  assert.equal(sms.body, '')
  assert.equal(sms.segments, 0)
})

test('marks lose trailing zeros on the way into the message', () => {
  // numeric(6,2) reaches the app as 45.00. "45.00/50.00" reads as a machine
  // talking; lib/students/progress.ts converts, and this is the sentence that
  // proves the conversion arrives.
  const sms = buildProgressSummarySms(week({ examObtained: 45, examTotal: 50 }))
  assert.ok(sms.body.includes('45/50'), sms.body)
  assert.ok(!sms.body.includes('45.00'), sms.body)
})

test('the WhatsApp summary says what 70 characters cannot', () => {
  const text = buildProgressSummaryText(
    week({
      studentName: 'মোহাম্মদ সাদিয়া রহমান',
      examTitle: 'উচ্চতর গণিত সাপ্তাহিক',
      examsMissed: 2,
      centerName: 'উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি',
    }),
  )

  // Nothing is metered here, so nothing is clamped.
  assert.ok(text.startsWith('প্রিয় অভিভাবক,'), text)
  assert.ok(text.includes('মোহাম্মদ সাদিয়া রহমান'), text)
  assert.ok(text.includes('উচ্চতর গণিত সাপ্তাহিক'), text)
  assert.ok(text.includes('উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি'), text)
  // The window, in Bangla numerals — dates are read, never re-typed.
  assert.ok(text.includes('১৯ আগস্ট ২০২৬'), text)
  assert.ok(text.includes('২৫ আগস্ট ২০২৬'), text)
  // The mark keeps its ASCII ratio inside a Bangla sentence. Both halves of the
  // numeral rule, in one message.
  assert.ok(text.includes('45/50'), text)
  // The absence a parent most needs to hear about, and the SMS has no room for.
  assert.ok(text.includes('২টি পরীক্ষায় অনুপস্থিত'), text)
  assert.ok(text.includes('কোনো প্রশ্ন থাকলে জানাবেন।'), text)
})

test('the absence is stated rather than left to be subtracted', () => {
  const missed = buildProgressSummaryText(week({ sessionsCounted: 6, sessionsPresent: 5 }))
  assert.ok(missed.includes('৬ দিনের ক্লাসে ৫ দিন উপস্থিত, ১ দিন অনুপস্থিত'), missed)

  // A perfect week reads as one, not as "0 days absent".
  const perfect = buildProgressSummaryText(week({ sessionsCounted: 6, sessionsPresent: 6 }))
  assert.ok(perfect.includes('৬ দিনই উপস্থিত'), perfect)
  assert.ok(!perfect.includes('অনুপস্থিত'), perfect)
})

test('lateness is its own clause and only when it happened', () => {
  const late = buildProgressSummaryText(week({ sessionsLate: 2 }))
  assert.ok(late.includes('২ দিন দেরিতে এসেছে'), late)

  const punctual = buildProgressSummaryText(week({ sessionsLate: 0 }))
  assert.ok(!punctual.includes('দেরিতে'), punctual)
})

test('nothing dangles in the WhatsApp summary when there is nothing to say', () => {
  const text = buildProgressSummaryText(
    week({
      sessionsCounted: 0,
      sessionsPresent: 0,
      sessionsLate: 0,
      examTitle: null,
      examObtained: null,
      examTotal: null,
      examsMissed: 0,
    }),
  )
  assert.ok(!text.includes('হাজিরা'), text)
  assert.ok(!text.includes('পরীক্ষা'), text)
  // Still addressed and still signed, because the screen only offers this when
  // there is something above it.
  assert.ok(text.startsWith('প্রিয় অভিভাবক,'), text)
  assert.ok(text.includes('- আলো কোচিং'), text)
})

/* -------------------------------------------------------------------------- */
/* The missed class                                                           */
/* -------------------------------------------------------------------------- */

const absence = (over: Partial<AbsenceInput> = {}): AbsenceInput => ({
  studentName: 'সাদিয়া আক্তার',
  batchName: 'সকাল ৭টা জীববিজ্ঞান',
  sessionDate: '2026-08-25',
  isToday: true,
  centerName: 'আলো কোচিং',
  ...over,
})

test('a same-day absence fits one segment and names the child and the centre', () => {
  const sms = buildAbsenceSms(absence())

  assert.equal(sms.segments, 1, sms.body)
  assert.equal(measureSms(sms.body).segments, 1, sms.body)
  assert.ok(sms.body.includes('সাদিয়া আক্তার'), sms.body)
  assert.ok(sms.body.endsWith('-আলো কোচিং'), sms.body)
  // Today is `আজ` and never a date: it is shorter, and it is what a parent reading
  // at six in the evening actually needs to hear.
  assert.ok(sms.body.includes('আজ'), sms.body)
  assert.ok(!sms.body.includes('২৫ আগস্ট'), sms.body)
})

test('the absence SMS states the empty seat and never a reason for it', () => {
  const sms = buildAbsenceSms(absence())

  // No blame, no truancy, no threat. The register knows a seat was empty and
  // nothing else, and a message that guesses gets a child punished for a fever.
  for (const word of ['ফাঁকি', 'পালিয়ে', 'দোষ', 'শাস্তি', 'জরিমানা', 'সতর্ক']) {
    assert.ok(!sms.body.includes(word), `${word} must never appear: ${sms.body}`)
  }
  // Nor a running total. A pattern is a conversation, not a chip.
  assert.ok(!/\d+\s*(দিন|বার)/.test(sms.body), sms.body)
})

test('a back-dated register names the date and never says today', () => {
  const sms = buildAbsenceSms(absence({ isToday: false }))

  assert.ok(sms.body.includes('২৫ আগস্ট ২০২৬'), sms.body)
  assert.ok(sms.body.includes('তারিখে'), sms.body)
  // The one thing that must not happen: a teacher fixing yesterday's register
  // telling a parent their child missed a class they are sitting in now.
  assert.ok(!sms.body.includes('আজ'), sms.body)
})

test('politeness degrades before the fact does', () => {
  const long = buildAbsenceSms(
    absence({
      studentName: 'মোহাম্মদ সাদিয়া রহমান',
      centerName: 'উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি',
    }),
  )

  assert.equal(long.segments, 1, long.body)
  // The request to check on the child is the first thing to go.
  assert.ok(!long.body.includes('খোঁজ নেবেন'), long.body)
  // What survives every rung: which child, which day, and who is telling them.
  assert.ok(long.body.includes('মোহাম্মদ'), long.body)
  assert.ok(long.body.includes('আজ'), long.body)
  assert.ok(long.body.includes('উত্তরা'), long.body)
})

test('a back-dated register buys a second segment rather than dropping the date', () => {
  const sms = buildAbsenceSms(
    absence({
      isToday: false,
      studentName: 'মোহাম্মদ সাদিয়া রহমান',
      centerName: 'উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি',
    }),
  )

  // Sixteen characters of Bangla date before the sentence starts. An extra taka is
  // cheaper than a message about the wrong day, so the ladder runs out and the
  // date stays — the same trade the fee reminder makes with the month.
  assert.equal(sms.segments, measureSms(sms.body).segments)
  assert.ok(sms.body.includes('২৫ আগস্ট ২০২৬'), sms.body)
  assert.ok(!sms.body.includes('আজ'), sms.body)
})

test('the WhatsApp absence keeps the batch, the full name, and the benefit of the doubt', () => {
  const text = buildAbsenceText(
    absence({
      studentName: 'মোহাম্মদ সাদিয়া রহমান',
      centerName: 'উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি',
    }),
  )

  assert.ok(text.startsWith('প্রিয় অভিভাবক,'), text)
  // Nothing is metered here, so nothing is clamped and the batch survives — a
  // guardian with two children at one centre needs to know which class.
  assert.ok(text.includes('মোহাম্মদ সাদিয়া রহমান'), text)
  assert.ok(text.includes('সকাল ৭টা জীববিজ্ঞান'), text)
  assert.ok(text.includes('উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি'), text)
  // The sentence the SMS has no room for: a reason is invited before one is
  // assumed, and the next class is named as an expectation rather than a warning.
  assert.ok(text.includes('শরীর খারাপ'), text)
  assert.ok(text.includes('পরের ক্লাসে দেখা হবে'), text)
})

test('nothing dangles in the WhatsApp absence when the batch has no name', () => {
  const text = buildAbsenceText(absence({ batchName: null }))

  assert.ok(text.includes('সাদিয়া আক্তার আজ ক্লাসে উপস্থিত ছিল না।'), text)
  // No stray double space where the batch would have been.
  assert.ok(!text.includes('  '), text)

  // A blank string is the same absence of a name as null — the batch column is
  // not null, so an owner who typed spaces is the case that reaches here.
  assert.equal(text, buildAbsenceText(absence({ batchName: '   ' })))
})



test('a notice keeps the words it was given and signs them', () => {
  const notice = buildNoticeSms({
    body: 'বৃহস্পতিবার ক্লাস বন্ধ থাকবে।',
    centerName: 'উত্তরা আইডিয়াল',
  })

  // The owner's sentence, untouched. Nothing above this in the file can say that —
  // every other builder rewrites what it is handed.
  assert.ok(notice.body.startsWith('বৃহস্পতিবার ক্লাস বন্ধ থাকবে।'), notice.body)
  assert.ok(notice.body.endsWith('\n-উত্তরা আইডিয়াল'), notice.body)
  assert.equal(notice.segments, 1)
})

test('a long notice is signed and counted, never shortened', () => {
  const body = 'ক'.repeat(300)
  const notice = buildNoticeSms({ body, centerName: 'কোচিং' })

  assert.ok(notice.body.startsWith(body), 'the owner decides how long their own notice is')
  assert.ok(notice.segments > 4, `300 Bangla characters is several SMS, got ${notice.segments}`)
})

test('the centre name is clamped in a notice as it is everywhere else', () => {
  const long = 'উত্তরা আইডিয়াল কোচিং সেন্টার ও একাডেমি'
  const notice = buildNoticeSms({ body: 'ছুটি', centerName: long })

  assert.ok(notice.body.length < `ছুটি\n-${long}`.length, notice.body)
})

test('a notice with nothing in it is nothing, not a lone signature', () => {
  // The action refuses an empty body long before this, but a builder that returned
  // "-কোচিং" would be a message a family could receive saying only the centre's name.
  assert.deepEqual(buildNoticeSms({ body: '   ', centerName: 'কোচিং' }), {
    body: '',
    segments: 0,
  })
})

test('a notice laid out over three lines stays three lines', () => {
  const body = 'ঈদ মোবারক।\n\nশনিবার থেকে ক্লাস শুরু।'
  const notice = buildNoticeSms({ body, centerName: 'কোচিং' })

  assert.ok(notice.body.startsWith(body), notice.body)
})
